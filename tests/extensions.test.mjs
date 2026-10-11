import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../engine/world.mjs';
import { createLabServers } from '../sources/server.mjs';
import { replay } from '../evaluation/runs.mjs';
const config = {
  policy: 'none',
  topology: 'grid',
  grid: 9,
  extentKm: 8,
  durationMs: 6 * 3600000,
  scenario: 'S23',
  hazard: 'none',
  grid: 3,
  extentKm: 1,
  postsPerHour: 0,
  backgroundTraffic: 0,
  networkLatencyMs: 0,
  packetLoss: 0,
  sourceIndexMs: 0,
  loadMs: 1000,
  unloadMs: 1000,
  durationMs: 3600000,
};
let sequence = 0;
const act = (w, type, params, org = 'org0') =>
  w.act(
    { id: `owner-${org}`, org, role: 'commander' },
    { type, params, idempotencyKey: `test-${++sequence}` },
  );
test('team audio is absent from public HTML, search, permalinks and another organization', async () => {
  const lab = await createLabServers({
    config,
    observerPort: 0,
    sourcePort: 0,
    persistCredentials: false,
    actorKeys: {
      one: { id: 'one', org: 'org0', role: 'agent' },
      two: { id: 'two', org: 'org1', role: 'agent' },
    },
  });
  try {
    lab.world.inject('lab_intervention', {
      kind: 'team_note',
      org: 'org0',
      text: 'INTERNAL-REPORT-ONLY',
    });
    lab.world.advance(60000);
    const p = lab.world.state.posts.find((p) => p.public.text === 'INTERNAL-REPORT-ONLY');
    const base = `http://127.0.0.1:${lab.sourcePort}`;
    for (const route of [
      '/feed?org=org0&audience=team',
      '/search?q=INTERNAL',
      '/api/feed?org=org0&audience=team',
      `/users/${p.public.authorId}`,
    ])
      assert.doesNotMatch(await (await fetch(base + route)).text(), /INTERNAL-REPORT-ONLY/);
    assert.equal((await fetch(base + '/posts/' + p.public.id)).status, 404);
    const one = await (
      await fetch(base + '/api/actor/inbox', { headers: { Authorization: 'Bearer one' } })
    ).json();
    const two = await (
      await fetch(base + '/api/actor/inbox', { headers: { Authorization: 'Bearer two' } })
    ).json();
    assert.equal(one.posts.length, 1);
    assert.equal(two.posts.length, 0);
    assert.throws(
      () => act(lab.world, 'record_claim', { text: 'secret', references: [p.public.id] }, 'org1'),
      (e) => e.code === 'SOURCE',
    );
    assert.throws(
      () =>
        lab.world.acknowledge({ org: 'org1', id: 'x' }, { id: p.public.id, stage: 'downloaded' }),
      (e) => e.code === 'SOURCE',
    );
  } finally {
    await lab.close();
  }
});
test('source mutation methods, revocation and rate limits cannot bypass the gateway', async () => {
  const lab = await createLabServers({
    config: { ...config, sourceRequestLimit: 3 },
    observerPort: 0,
    sourcePort: 0,
    persistCredentials: false,
    actorKeys: { one: { id: 'one', org: 'org0', role: 'agent' } },
  });
  try {
    const base = `http://127.0.0.1:${lab.sourcePort}`;
    assert.equal(
      (await fetch(base + '/api/actor/action', { headers: { Authorization: 'Bearer one' } }))
        .status,
      405,
    );
    lab.world.inject('lab_intervention', { kind: 'integration', revokeOrg: 'org0' });
    assert.equal(
      (await fetch(base + '/api/actor/state', { headers: { Authorization: 'Bearer one' } })).status,
      403,
    );
    for (let i = 0; i < 3; i++) assert.equal((await fetch(base + '/feed')).status, 200);
    assert.equal((await fetch(base + '/feed')).status, 429);
    assert.equal(
      (
        await fetch(`http://127.0.0.1:${lab.observerPort}/api/config`, {
          headers: { Authorization: 'Bearer ' + lab.observerKey },
        })
      ).status,
      405,
    );
  } finally {
    await lab.close();
  }
});
test('resource sharing is owned, versioned and can be revoked without deleting source history', () => {
  const w = new World(config);
  act(w, 'share', { kind: 'resource', id: 'r-org0-energy', to: 'org1' });
  w.advance(1000);
  assert.ok(w.actorView('org1').known.resources['r-org0-energy']);
  assert.throws(
    () => act(w, 'share', { kind: 'resource', id: 'r-org0-energy', to: 'org2' }, 'org1'),
    (e) => e.code === 'FORBIDDEN',
  );
  act(w, 'share', { kind: 'resource', id: 'r-org0-energy', to: 'org1', revoke: true });
  w.advance(2000);
  assert.equal(w.actorView('org1').known.resources['r-org0-energy'], undefined);
  assert.ok(w.log.some((e) => e.type === 'sharing_revoked'));
  assert.equal(replay(w.checkpoint()).matches, true);
});
test('a loan returns through a second real trip and preserves total equipment', () => {
  const w = new World(config),
    initial = w.state.resources
      .filter((r) => r.type === 'energy')
      .reduce((n, r) => n + r.quantity, 0);
  const t = act(w, 'transfer', {
    resource: 'r-org0-energy',
    quantity: 1,
    to: 'org1',
    loan: true,
    returnBy: 900000,
  });
  act(w, 'transfer', { action: 'accept', id: t.id }, 'org1');
  act(w, 'dispatch', { transfer: t.id, vehicle: 'v-org0-0' });
  w.advance(600000);
  assert.equal(w.state.transfers[0].state, 'received');
  act(w, 'transfer', { action: 'return', id: t.id, vehicle: 'v-org1-0' }, 'org1');
  assert.equal(w.state.transfers[0].state, 'returning');
  w.advance(1200000);
  assert.equal(w.state.transfers[0].state, 'returned');
  assert.equal(
    w.state.resources.filter((r) => r.type === 'energy').reduce((n, r) => n + r.quantity, 0),
    initial,
  );
  assert.deepEqual(w.invariants(), []);
});
test('pledged funds are unavailable until settlement and failed donations never fund purchases', () => {
  const w = new World(config),
    initial = w.organization('org0').funds;
  w.inject('lab_intervention', { kind: 'donation', org: 'org0', amount: 800, delayMs: 60000 });
  w.inject('lab_intervention', {
    kind: 'donation',
    org: 'org0',
    amount: 1000,
    delayMs: 60000,
    fail: true,
  });
  assert.equal(w.organization('org0').funds, initial);
  w.advance(60000);
  assert.equal(w.organization('org0').funds, initial + 800);
  assert.equal(w.state.fundEntries.filter((e) => e.type === 'failed').length, 1);
});
test('an expired supply invalidates reservations and cannot be loaded', () => {
  const w = new World(config),
    c = act(w, 'commitment', { action: 'reserve', resource: 'r-org0-energy', quantity: 1 });
  w.inject('lab_intervention', { kind: 'resource_condition', id: 'r-org0-energy', expired: true });
  assert.equal(w.resource('r-org0-energy').lost, 2);
  assert.equal(w.state.commitments.find((x) => x.id === c.id).state, 'withdrawn');
  assert.throws(() =>
    act(w, 'dispatch', {
      resource: 'r-org0-energy',
      quantity: 1,
      vehicle: 'v-org0-0',
      destination: 'n1',
    }),
  );
  assert.deepEqual(w.invariants(), []);
});
test('memory records require received evidence and keep explicit revalidation conditions', () => {
  const w = new World(config);
  assert.throws(
    () => act(w, 'record_outcome', { summary: 'It worked', references: [] }),
    (e) => e.code === 'EVIDENCE',
  );
  const op = act(w, 'dispatch', {
    resource: 'r-org0-water',
    quantity: 100,
    vehicle: 'v-org0-0',
    need: 'need-water-main',
  });
  w.advance(600000);
  const record = act(w, 'record_outcome', {
    summary: 'A real shipment',
    references: [op.id],
    conditions: [{ type: 'power', connector: 'A' }],
  });
  assert.equal(record.applicability, 'must_revalidate');
  assert.ok(record.evidence[0].times.received);
});
test('a source schema change is observable and a failed API does not fabricate rows', async () => {
  const lab = await createLabServers({
    config,
    observerPort: 0,
    sourcePort: 0,
    persistCredentials: false,
  });
  try {
    const base = `http://127.0.0.1:${lab.sourcePort}`;
    lab.world.inject('lab_intervention', { kind: 'integration', schemaVersion: 2 });
    const result = await (await fetch(base + '/api/feed')).json();
    assert.equal(result.schemaVersion, 2);
    assert.ok(Array.isArray(result.items));
    lab.world.inject('lab_intervention', { kind: 'integration', available: false });
    assert.equal((await fetch(base + '/feed')).status, 503);
  } finally {
    await lab.close();
  }
});
test('corrupt checkpoints fail explicitly instead of becoming a plausible world', () => {
  const w = new World(config),
    cp = w.checkpoint();
  cp.state.resources[0].quantity = -1;
  assert.throws(() => new World(config, cp), /invariants/);
  const next = w.checkpoint();
  next.queue[0].type = 'future_secret_handler';
  assert.throws(() => new World(config, next), /Invalid checkpoint/);
});
test('regional geography and subsystem seeds preserve unrelated random streams', () => {
  const a = new World({ ...config, grid: 12, extentKm: 80, topology: 'regional' }),
    b = new World({
      ...config,
      grid: 12,
      extentKm: 80,
      topology: 'regional',
      subsystemSeeds: { map: 'alternate' },
    });
  assert.notEqual(a.state.map.hash, b.state.map.hash);
  assert.equal(a.random('hazard', 'b1', 'initial'), b.random('hazard', 'b1', 'initial'));
  assert.ok(a.state.map.edges.some((e) => e.maxWeight === 3700));
  assert.ok(new Set(a.state.map.sectors.map((s) => s.locality)).size > 1);
});
