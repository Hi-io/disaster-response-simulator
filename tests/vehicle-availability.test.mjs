import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../engine/world.mjs';
import { replay } from '../evaluation/runs.mjs';

const config = {
  seed: 'terminal-availability',
  scenario: 'S23',
  policy: 'none',
  hazard: 'none',
  topology: 'grid',
  grid: 5,
  extentKm: 2,
  postsPerHour: 0,
  backgroundTraffic: 0,
  healthReports: false,
  recurringNeeds: false,
  packetLoss: 0,
  networkLatencyMs: 1000,
  loadMs: 1000,
  unloadMs: 1000,
  durationMs: 3600000,
};
const actor = { id: 'dispatcher', org: 'org0', role: 'commander' };
const observed = (w) => w.actorView('org0').known.vehicles['v-org0-0'];
const dispatch = (w, key) =>
  w.act(actor, {
    type: 'dispatch',
    params: {
      vehicle: 'v-org0-0',
      resource: 'r-org0-water',
      need: 'need-water-main',
      quantity: 100,
    },
    idempotencyKey: key,
  });
function until(w, predicate) {
  let count = 0;
  while (!predicate() && count++ < 10000)
    assert.ok(w.step(), 'The causal event queue must make progress');
  assert.ok(predicate(), 'Expected receipt must be reached within the finite event bound');
}

test('terminal vehicle telemetry enables two real deliveries by the same finite truck', () => {
  const w = new World(config);
  const first = dispatch(w, 'first-delivery');
  until(w, () => w.state.operations.find((o) => o.id === first.id).state === 'completed');
  assert.equal(w.vehicle('v-org0-0').state, 'idle');
  assert.equal(
    observed(w).state,
    'en_route',
    'Physical unloading does not grant instant knowledge',
  );
  until(w, () => observed(w).state === 'idle');
  assert.equal(observed(w).node, w.vehicle('v-org0-0').node);
  assert.equal(observed(w).operation, null);
  const second = dispatch(w, 'second-delivery');
  until(w, () => w.state.operations.find((o) => o.id === second.id).state === 'completed');
  until(w, () => observed(w).state === 'idle' && observed(w).at > first.createdAt);
  assert.equal(w.need('need-water-main').served, 200);
  assert.equal(
    w.state.operations.filter((o) => o.type === 'delivery' && o.state === 'completed').length,
    2,
  );
  assert.deepEqual(w.invariants(), []);
  w.advance(w.now); // Finish tied receipts at the replay timestamp boundary.
  assert.equal(
    replay(w.checkpoint()).matches,
    true,
    'The second pickup and terminal receipts replay exactly',
  );
});

test('a destination outage delays terminal availability without delaying already authorized unloading', () => {
  const w = new World(config),
    first = dispatch(w, 'outage-delivery');
  until(w, () => w.state.operations.find((o) => o.id === first.id).state === 'arrived');
  const cutAt = w.now,
    sector = w.sectorForNode(w.vehicle('v-org0-0').node);
  w.inject('intervention', { type: 'cut', sector, duration: 120000 });
  until(w, () => w.state.operations.find((o) => o.id === first.id).state === 'completed');
  const old = structuredClone(observed(w));
  assert.equal(w.vehicle('v-org0-0').state, 'idle');
  assert.notEqual(old.state, 'idle');
  w.advance(cutAt + 60000);
  assert.deepEqual(
    observed(w),
    old,
    'The disconnected owner view receives no terminal oracle update',
  );
  assert.ok(
    w.state.messages.some(
      (m) =>
        m.payload.kind === 'telemetry' && m.payload.view?.state === 'idle' && m.state === 'offline',
    ),
  );
  until(w, () => observed(w).state === 'idle');
  assert.ok(w.now >= cutAt + 120000);
  assert.deepEqual(w.invariants(), []);
  w.advance(w.now);
  assert.equal(replay(w.checkpoint()).matches, true);
});

test('an older telemetry retry cannot regress equal-time terminal availability', () => {
  const w = new World(config),
    v = w.vehicle('v-org0-0');
  w.advance(60000);
  const fresh = w.reportVehicle(v);
  w.advance(65000);
  assert.equal(fresh.state, 'delivered');
  const oldVersion = observed(w).version;
  w.send(
    {
      kind: 'telemetry',
      vehicle: v.id,
      node: v.node,
      observedAt: fresh.payload.observedAt,
      view: { ...fresh.payload.view, state: 'en_route', version: oldVersion - 1 },
    },
    'org0',
    { sector: w.sectorForNode(v.node), target: v.id },
  );
  w.advance(70000);
  assert.equal(observed(w).state, 'idle');
  assert.equal(observed(w).version, oldVersion);
});

test('resource verification preserves received staff qualifications instead of erasing them', () => {
  const w = new World({ ...config, inspectionMs: 1000, observationRate: 1 }),
    resource = w.resource('r-org0-staff'),
    expected = structuredClone(resource.qualifications);
  assert.ok(expected.includes('water_operations'));
  const inspection = w.act(actor, {
    type: 'verify',
    params: { target: 'resource', id: resource.id, method: 'clarification' },
    idempotencyKey: 'verify-qualified-staff',
  });
  until(w, () => w.state.inspections.find((i) => i.id === inspection.id).state === 'completed');
  assert.deepEqual(w.state.inspections.find((i) => i.id === inspection.id).result.qualifications, expected);
  assert.deepEqual(w.actorView('org0').known.resources[resource.id].qualifications, expected);
  assert.equal(w.actorView('org1').known.resources[resource.id], undefined, 'The verification does not grant another owner access');
  w.advance(w.now);
  assert.equal(replay(w.checkpoint()).matches, true);
});
