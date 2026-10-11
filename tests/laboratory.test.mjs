import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../engine/world.mjs';
import { replay, runWorld, pairedComparison } from '../evaluation/runs.mjs';
import { evaluate, quantile } from '../evaluation/metrics.mjs';
import { route } from '../generators/map.mjs';
import { INPUT_TYPES, validateObservation } from '../contracts/inputs.mjs';
const config = {
  hazard: 'none',
  backgroundTraffic: 0,
  postsPerHour: 0,
  packetLoss: 0,
  grid: 5,
  extentKm: 2,
  durationMs: 3600000,
  inspectionMs: 1000,
  loadMs: 1000,
  unloadMs: 1000,
  setupMs: 1000,
};
let seq = 0;
const act = (w, type, params, org = 'org0', role = 'commander') =>
  w.act({ id: `owner-${org}`, org, role }, { type, params, idempotencyKey: `laboratory-${++seq}` });

test('joint resources from four independent owners can open a service that the local team cannot open alone', () => {
  const w = new World({ ...config, scenario: 'S19' }),
    b = w.building(w.state.map.shelterId);
  act(w, 'verify', { target: 'building', id: b.id });
  w.advance(500000);
  assert.throws(
    () => act(w, 'activate', { building: b.id, permit: true }),
    (e) => e.code === 'DEPENDENCY',
  );
  for (const [org, type, quantity] of [
    ['org0', 'water', 60],
    ['org1', 'energy', 1],
    ['org2', 'staff', 2],
    ['org3', 'sanitation', 1],
  ])
    act(
      w,
      'dispatch',
      {
        vehicle: `v-${org}-1`,
        resource: `r-${org}-${type}`,
        quantity,
        building: b.id,
        destination: b.node,
      },
      org,
    );
  w.advance(1200000);
  assert.equal(b.state, 'candidate');
  assert.deepEqual(b.provisioned, { water: 60, sanitation: 1, staff: 2, energy: 1 });
  act(w, 'activate', { building: b.id, permit: true });
  w.advance(1201000);
  assert.equal(b.state, 'operating');
  assert.equal(b.activeReservations.length, 3);
  assert.deepEqual(w.invariants(), []);
});
test('a plant requires compatible physical power and staff, then produces finite water rather than infinite stock', () => {
  const w = new World(config),
    b = w.building(w.state.map.plantId);
  act(w, 'verify', { target: 'building', id: b.id });
  w.advance(500000);
  act(
    w,
    'dispatch',
    {
      vehicle: 'v-org1-1',
      resource: 'r-org1-energy',
      quantity: 1,
      building: b.id,
      destination: b.node,
    },
    'org1',
  );
  act(
    w,
    'dispatch',
    {
      vehicle: 'v-org2-1',
      resource: 'r-org2-staff',
      quantity: 1,
      building: b.id,
      destination: b.node,
    },
    'org2',
  );
  w.advance(1200000);
  act(w, 'activate', { building: b.id, permit: true });
  w.advance(1800000);
  assert.ok(w.resource(`production-${b.id}`).quantity > 0);
  assert.ok(w.resource(`raw-${b.id}`).consumed > 0);
  assert.equal(w.resource(`production-${b.id}`).quantity, w.resource(`raw-${b.id}`).consumed);
  assert.deepEqual(w.invariants(), []);
});
test('incompatible equipment arrives but never silently powers a facility', () => {
  const w = new World(config),
    b = w.building(w.state.map.plantId);
  w.resource('r-org1-energy').compatibility = { connector: 'B', powerKw: 4 };
  const op = act(
    w,
    'dispatch',
    {
      vehicle: 'v-org1-1',
      resource: 'r-org1-energy',
      quantity: 1,
      building: b.id,
      destination: b.node,
    },
    'org1',
  );
  w.advance(600000);
  assert.equal(
    w.state.operations.find((o) => o.id === op.id).state,
    'waiting_for_compatible_equipment',
  );
  assert.equal(b.provisioned.energy, 0);
  assert.equal(w.vehicle('v-org1-1').load, 1);
  assert.deepEqual(w.invariants(), []);
});
test('operator attention is finite, clarification does not authorize a plan, and agents cannot approve', () => {
  const w = new World({ ...config, operatorCount: 1, reviewMs: 60000 }),
    a = act(w, 'propose', { title: 'First' }),
    b = act(w, 'propose', { title: 'Second' });
  act(w, 'review', { id: a.id, decision: 'clarify' });
  act(w, 'review', { id: b.id, decision: 'approve' });
  assert.throws(
    () => act(w, 'review', { id: a.id, decision: 'approve' }, 'org0', 'agent'),
    (e) => e.code === 'FORBIDDEN',
  );
  w.advance(60000);
  assert.equal(w.state.proposals[0].state, 'needs_clarification');
  assert.equal(w.state.proposals[1].state, 'awaiting_approval');
  w.advance(120000);
  assert.equal(w.state.proposals[1].state, 'authorized');
});
test('manual inputs, interventions and ingestion acknowledgements all reproduce exactly', () => {
  const w = new World(config);
  w.advance(40000);
  act(w, 'dispatch', {
    vehicle: 'v-org0-0',
    resource: 'r-org0-water',
    quantity: 100,
    need: 'need-water-main',
  });
  w.advance(60000);
  w.inject('intervention', { type: 'cut', sector: 's0', duration: 60000 });
  w.advance(300000);
  const post = w.publicFeed().posts[0];
  w.acknowledge({ org: 'org0', id: 'connector' }, { id: post.id, stage: 'downloaded' });
  w.advance(600000);
  const result = replay(w.checkpoint());
  assert.equal(result.matches, true);
  assert.deepEqual(evaluate(result.world), evaluate(w));
});
test('a fork can choose a different action without changing the original checkpoint', () => {
  const w = new World(config);
  w.advance(40000);
  const cp = w.checkpoint(),
    originalHash = w.stateHash();
  const fork = new World(config, cp);
  act(fork, 'dispatch', {
    vehicle: 'v-org0-0',
    resource: 'r-org0-water',
    quantity: 100,
    need: 'need-water-main',
  });
  fork.advance(600000);
  assert.equal(w.stateHash(), originalHash);
  assert.equal(cp.state.needs[0].served, 0);
  assert.equal(fork.need('need-water-main').served, 100);
});
test('reference policies use real scoped proposals and shipments; their output is not credited to Gemini', () => {
  for (const policy of [
    'conventional',
    'rules',
    'extraction',
    'general',
    'investigation',
    'federated',
  ]) {
    const { world: w, metrics } = runWorld({ ...config, durationMs: 600000, policy });
    assert.ok(w.state.proposals.length > 0);
    assert.equal(metrics.modelCalls, 0);
    assert.ok(w.state.ingestion.every((r) => r.org));
    assert.deepEqual(w.invariants(), []);
  }
});
test('larger physical distances increase free travel time on the same topology', () => {
  const small = new World({ ...config, extentKm: 2 }),
    large = new World({ ...config, extentKm: 20 });
  const a = route(small.state.map, 'n0', 'n24', small.vehicle('v-org0-0')),
    b = route(large.state.map, 'n0', 'n24', large.vehicle('v-org0-0'));
  assert.ok(b.freeTimeMs > a.freeTimeMs);
  assert.equal(b.distanceM, a.distanceM * 10);
});
test('p95 includes the slow sample and paired comparisons retain losses as well as gains', () => {
  assert.equal(quantile([10, 90], 0.95), 90);
  const metric = (served, pending) => ({
    services: {
      water: {
        served,
        pending,
        overprovided: 0,
        uncoveredUnitMs: pending * 100,
        onTime: served ? 1 : 0,
      },
    },
  });
  const a = [{ seed: '1', scenario: 'S01', variant: 'standard', metrics: metric(100, 0) }],
    b = [{ seed: '1', scenario: 'S01', variant: 'standard', metrics: metric(50, 50) }];
  const result = pairedComparison(a, b);
  assert.equal(result.water.served.differenceBminusA, -50);
  assert.equal(result.water.pending.differenceBminusA, 50);
});
test('all twenty-six input kinds have versioned temporal contracts and private envelope fields are rejected', () => {
  assert.equal(Object.keys(INPUT_TYPES).length, 26);
  for (const kind of Object.values(INPUT_TYPES))
    validateObservation({
      schemaVersion: 1,
      id: 'opaque',
      source: 'authorized',
      kind,
      observedAt: 0,
      availableAt: 5,
      version: 1,
      payload: {},
    });
  assert.throws(() =>
    validateObservation({
      schemaVersion: 1,
      id: 'x',
      source: 'a',
      kind: 'media',
      observedAt: 10,
      availableAt: 5,
      version: 1,
      payload: {},
    }),
  );
  assert.throws(() =>
    validateObservation({
      schemaVersion: 1,
      id: 'x',
      source: 'a',
      kind: 'media',
      observedAt: 0,
      availableAt: 5,
      version: 1,
      payload: {},
      is_fake: true,
    }),
  );
});
test('non-finite lead times are rejected before money or supplier inventory is changed', () => {
  const w = new World(config),
    before = w.organization('org0').funds;
  assert.throws(() =>
    act(w, 'purchase', { type: 'water', quantity: 100, price: 2, leadMs: 'never' }),
  );
  assert.equal(w.organization('org0').funds, before);
  assert.equal(w.state.purchases.length, 0);
  assert.throws(() => w.schedule(NaN, 'hazard_start'));
});
test('old publication versions remain in connector receipts after a source edit or deletion', () => {
  const w = new World(config);
  w.advance(60000);
  const p = w.publicFeed().posts[0];
  w.acknowledge({ org: 'org0', id: 'connector' }, { id: p.id, stage: 'downloaded' });
  w.inject('post_update', { id: p.id, text: 'A later correction', deleted: false });
  w.advance(w.now + w.config.sourceIndexMs);
  assert.equal(w.state.ingestion[0].content.text, p.text);
  assert.equal(w.publicFeed().posts.find((x) => x.id === p.id).version, 2);
  w.inject('post_update', { id: p.id, deleted: true });
  w.advance(w.now + w.config.sourceIndexMs);
  assert.ok(!w.publicFeed().posts.some((x) => x.id === p.id));
  assert.equal(w.state.ingestion[0].content.version, 1);
});
test('radio can carry a field report while the internet channel is down', () => {
  const w = new World(config);
  w.sector('s0').coverage = 0;
  const m = w.send(
    { kind: 'road', edge: 'n0:n1', open: false, waterDepth: 0, version: 2, observedAt: 0 },
    'org0',
    { sector: 's0', channel: 'radio' },
  );
  w.advance(60000);
  assert.equal(m.state, 'delivered');
  assert.equal(w.state.observations.org0.edges['n0:n1'].open, false);
});
