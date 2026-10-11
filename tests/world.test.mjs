import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../engine/world.mjs';
import { PRESETS } from '../content/presets.mjs';
const config = {
  hazard: 'none',
  postsPerHour: 0,
  backgroundTraffic: 0,
  packetLoss: 0,
  scenario: 'S23',
};
const commander = { id: 'owner', org: 'org0', role: 'commander' };
const act = (w, type, params, key = type) =>
  w.act(commander, { type, params, idempotencyKey: key });

test('360 presets represent thirty families with separate evaluation content', () => {
  assert.equal(PRESETS.length, 360);
  assert.equal(new Set(PRESETS.map((p) => p.text)).size, 360);
  assert.equal(new Set(PRESETS.map((p) => p.family)).size, 30);
  assert.equal(PRESETS.filter((p) => p.split === 'heldout').length, 60);
});
test('same world and inputs reproduce; checkpoint continuation is exact', () => {
  const a = new World(config),
    b = new World(config);
  a.advance(900000);
  b.advance(900000);
  assert.equal(a.stateHash(), b.stateHash());
  const resumed = new World(config, a.checkpoint());
  a.advance(1800000);
  resumed.advance(1800000);
  assert.equal(a.stateHash(), resumed.stateHash());
  assert.deepEqual(a.invariants(), []);
});
test('authorized dispatch moves real stock and serves need after delivery', () => {
  const w = new World(config);
  const op = act(w, 'dispatch', {
    resource: 'r-org0-water',
    vehicle: 'v-org0-0',
    need: 'need-water-main',
    quantity: 300,
  });
  assert.equal(w.need('need-water-main').served, 0);
  w.advance(2 * 3600000);
  assert.equal(w.need('need-water-main').served, 300);
  assert.equal(w.state.operations.find((o) => o.id === op.id).state, 'completed');
  assert.deepEqual(w.invariants(), []);
});
test('reserve is atomic, versioned, idempotent and expires', () => {
  const w = new World(config);
  const r = act(
    w,
    'commitment',
    { action: 'reserve', resource: 'r-org0-water', quantity: 400, ttlMs: 60000 },
    'reserve-one',
  );
  assert.equal(
    act(
      w,
      'commitment',
      { action: 'reserve', resource: 'r-org0-water', quantity: 400, ttlMs: 60000 },
      'reserve-one',
    ).id,
    r.id,
  );
  assert.throws(
    () =>
      act(
        w,
        'commitment',
        { action: 'reserve', resource: 'r-org0-water', quantity: 400 },
        'reserve-two',
      ),
    /Insufficient/,
  );
  w.advance(60000);
  assert.equal(w.resource('r-org0-water').reserved, 0);
  assert.deepEqual(w.invariants(), []);
});
test('an agent cannot dispatch or spoof another organization ownership', () => {
  const w = new World(config);
  assert.throws(
    () =>
      w.act(
        { id: 'agent', org: 'org0', role: 'agent' },
        { type: 'dispatch', params: {}, idempotencyKey: 'bad' },
      ),
    /authority/,
  );
  assert.throws(
    () => act(w, 'commitment', { action: 'reserve', resource: 'r-org1-water', quantity: 1 }),
    /another organization/,
  );
});
test('fake news and observer truth do not leak through public sources or actor state', () => {
  const w = new World({ ...config, scenario: 'S16' });
  w.advance(600000);
  const publicData = JSON.stringify(w.publicFeed());
  assert.ok(w.state.posts.some((p) => p.private.false));
  for (const term of ['"private"', '"false"', '"truthCategory"', '"causeEvent"', '"preset"'])
    assert.ok(!publicData.includes(term));
  assert.ok(!JSON.stringify(w.actorView('org0')).includes('"hazards"'));
});
test('unconnected commands wait for reconnect instead of moving vehicles immediately', () => {
  const w = new World(config);
  const sector = w.sector(w.sectorForNode('n0'));
  sector.coverage = 0;
  act(w, 'dispatch', {
    resource: 'r-org0-water',
    vehicle: 'v-org0-0',
    need: 'need-water-main',
    quantity: 100,
  });
  w.advance(300000);
  assert.equal(w.vehicle('v-org0-0').node, 'n0');
  sector.coverage = 1;
  w.advance(2 * 3600000);
  assert.equal(w.need('need-water-main').served, 100);
});
test('all scenario fixtures can execute without breaking world invariants', () => {
  for (let i = 1; i <= 24; i++) {
    const w = new World({
      ...config,
      scenario: `S${String(i).padStart(2, '0')}`,
      postsPerHour: 60,
    });
    w.advance(3600000);
    assert.deepEqual(w.invariants(), [], w.config.scenario);
  }
});
