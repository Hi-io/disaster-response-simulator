import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../engine/world.mjs';
import { replay } from '../evaluation/runs.mjs';

const config = { scenario: 'S23', seed: 'long-pickup-status', policy: 'none', hazard: 'none',
  topology: 'grid', grid: 5, extentKm: 12, durationMs: 21600000, postsPerHour: 0,
  backgroundTraffic: 0, healthReports: false, recurringNeeds: false, packetLoss: 0,
  networkLatencyMs: 1000, loadMs: 2000, unloadMs: 2000, inspectionMs: 1000, setupMs: 1000 };
const actor = { id: 'owner', org: 'org0', role: 'commander' };
let serial = 0;
const act = (w, type, params) => w.act(actor, { type, params, idempotencyKey: `status-${++serial}` });
const operation = (w, id) => w.state.operations.find(o => o.id === id);
const observed = (w, id) => w.actorView('org0').known.operations[id];
function until(w, predicate) {
  let n = 0;
  while (!predicate() && n++ < 20000) assert.ok(w.step(), 'Physical queue must progress');
  assert.ok(predicate(), 'Expected physical event or received observation must occur');
}
function dispatch(w, extra = {}) {
  return act(w, 'dispatch', { vehicle: 'v-org0-0', resource: 'r-org0-water',
    need: 'need-water-main', quantity: 100, ...extra });
}
function firstTrip(w) {
  const first = dispatch(w);
  until(w, () => operation(w, first.id).state === 'completed');
  until(w, () => w.actorView('org0').known.vehicles['v-org0-0'].state === 'idle');
  return first;
}
function replayClean(w) {
  assert.deepEqual(w.invariants(), []);
  w.advance(w.now);
  const r = replay(w.checkpoint());
  assert.equal(r.matches, true, 'All physical actions and connectivity interventions replay exactly');
  r.world.close(); w.close();
}

test('a real second pickup exceeding the default hold publishes failure without consuming stock', () => {
  const w = new World(config);
  firstTrip(w);
  const stock = w.resource('r-org0-water').quantity, second = dispatch(w);
  const c = w.state.commitments.find(c => c.id === second.commitment);
  assert.equal(c.expiresAt - second.createdAt, 900000, 'Implicit hold remains fifteen minutes');
  until(w, () => operation(w, second.id).state === 'failed');
  const failed = operation(w, second.id);
  assert.ok(failed.times.pickupArrived - second.createdAt > 900000);
  assert.equal(failed.failure, 'commitment_invalid');
  assert.equal(c.state, 'expired');
  assert.equal(w.resource('r-org0-water').quantity, stock);
  assert.equal(w.resource('r-org0-water').reserved, 0);
  assert.equal(w.need('need-water-main').served, 100);
  assert.notEqual(observed(w, second.id).state, 'failed', 'No immediate actor-side oracle');
  until(w, () => observed(w, second.id)?.state === 'failed');
  until(w, () => w.actorView('org0').known.vehicles['v-org0-0'].state === 'idle');
  assert.equal(observed(w, second.id).times.failed, failed.times.failed);
  assert.equal(w.actorView('org1').known.operations[second.id], undefined);
  replayClean(w);
});

test('explicit owner-authorized hold and received execution policy allow the same long pickup', () => {
  const w = new World(config), query = act(w, 'query', { target: 'policy' });
  assert.equal(w.actorView('org0').queries.find(q => q.id === query.id).result, undefined);
  until(w, () => w.actorView('org0').queries.find(q => q.id === query.id).state === 'ready');
  const policy = w.actorView('org0').queries.find(q => q.id === query.id).result;
  assert.deepEqual(policy.execution.reservation, { defaultTtlMs: 900000, maxTtlMs: 86400000 });
  assert.equal(policy.execution.delivery.loadMs, config.loadMs);
  assert.equal(policy.execution.delivery.unloadMs, config.unloadMs);
  assert.equal(policy.execution.delivery.commandNominalLatencyMs, 1001);
  assert.equal(policy.observedAt, query.createdAt);
  assert.ok(Number.isSafeInteger(policy.version));
  firstTrip(w);
  const second = dispatch(w, { ttlMs: 3600000 });
  assert.equal(w.state.commitments.find(c => c.id === second.commitment).expiresAt - second.createdAt, 3600000);
  until(w, () => operation(w, second.id).state === 'completed');
  until(w, () => observed(w, second.id)?.state === 'completed');
  assert.ok(operation(w, second.id).times.pickupArrived - second.createdAt > 900000);
  assert.equal(w.need('need-water-main').served, 200);
  replayClean(w);
});

test('an outage delays an expired pickup failure receipt and later reconciles it', () => {
  const w = new World({ ...config, loadMs: 10000 });
  firstTrip(w);
  const second = dispatch(w);
  until(w, () => operation(w, second.id).state === 'arrived');
  until(w, () => observed(w, second.id)?.state === 'arrived');
  const cutAt = w.now, sector = w.sectorForNode(w.vehicle(second.vehicle).node);
  w.inject('intervention', { type: 'cut', sector, duration: 120000 });
  until(w, () => operation(w, second.id).state === 'failed');
  w.advance(cutAt + 60000);
  assert.equal(observed(w, second.id).state, 'arrived');
  assert.ok(w.state.messages.some(m => m.payload.kind === 'operation_status' &&
    m.payload.operation.id === second.id && m.payload.operation.state === 'failed' && m.state === 'offline'));
  until(w, () => observed(w, second.id).state === 'failed');
  assert.ok(w.now >= cutAt + 120000);
  assert.equal(w.need('need-water-main').served, 100);
  replayClean(w);
});

test('invalid hold windows are atomic and cannot extend an existing approved commitment', () => {
  for (const type of ['dispatch', 'commitment']) for (const ttlMs of [0, 86400001, 1.5]) {
    const w = new World(config), before = structuredClone(w.resource('r-org0-water'));
    const params = type === 'dispatch' ? { vehicle: 'v-org0-0', resource: before.id,
      need: 'need-water-main', quantity: 100, ttlMs } :
      { action: 'reserve', resource: before.id, quantity: 100, ttlMs };
    assert.throws(() => act(w, type, params));
    assert.deepEqual(w.resource(before.id), before);
    assert.equal(w.state.commitments.length, 0);
    assert.equal(w.state.operations.length, 0);
    assert.deepEqual(w.invariants(), []); w.close();
  }
  const w = new World(config), c = act(w, 'commitment',
    { action: 'reserve', resource: 'r-org0-water', quantity: 100, ttlMs: 60000 });
  act(w, 'commitment', { action: 'confirm', id: c.id });
  dispatch(w, { commitment: c.id, ttlMs: 86400000 });
  assert.equal(w.state.commitments.find(x => x.id === c.id).expiresAt, c.expiresAt,
    'Dispatch never rewrites the expiry already approved by the owner');
  replayClean(w);
});

test('material operation versions remain stable under polling and reject an equal-time stale retry', () => {
  const w = new World({ ...config, extentKm: 2 }), first = dispatch(w);
  until(w, () => operation(w, first.id).state === 'completed');
  const op = operation(w, first.id), terminalAt = w.now, version = op.version;
  for (let i = 0; i < 20; i++) w.reportOperation(op);
  assert.equal(op.version, version, 'Repeated reporting is not a material physical transition');
  w.advance(terminalAt + 5000);
  assert.equal(observed(w, op.id).state, 'completed');
  w.send({ kind: 'operation_status', observedAt: terminalAt,
    operation: { ...structuredClone(op), state: 'arrived', version: version - 1 } }, 'org0');
  w.advance(w.now + 5000);
  assert.equal(observed(w, op.id).state, 'completed');
  assert.equal(observed(w, op.id).version, version);
  assert.equal(w.actorView('org0').operationReportVersions, undefined);
  assert.deepEqual(w.invariants(), []); w.close();
});

test('repair success and failure each publish terminal status after real work', () => {
  for (const flooded of [false, true]) {
    const w = new World({ ...config, extentKm: 2 }), edge = w.edge('n0:n1');
    w.inject('road_change', { edge: edge.id, open: false });
    const task = act(w, 'repair', { edge: edge.id });
    until(w, () => w.state.repairs.find(t => t.id === task.id).state === 'working');
    if (flooded) w.inject('road_change', { edge: edge.id, depth: 0.8 });
    until(w, () => ['completed', 'failed'].includes(operation(w, task.operation).state));
    until(w, () => observed(w, task.operation)?.state === (flooded ? 'failed' : 'completed'));
    assert.equal(w.resource('r-org0-staff').reserved, 0);
    assert.ok((operation(w, task.operation).times.failed ?? operation(w, task.operation).times.service) > task.createdAt);
    replayClean(w);
  }
});

test('loaded cancellation reports physical return without inventing useful service', () => {
  const w = new World({ ...config, extentKm: 2 }), stock = w.resource('r-org0-water').quantity,
    delivery = dispatch(w);
  until(w, () => w.vehicle(delivery.vehicle).load === 100);
  act(w, 'cancel', { id: delivery.id });
  until(w, () => operation(w, delivery.id).state === 'cancelled');
  until(w, () => observed(w, delivery.id)?.state === 'cancelled');
  assert.equal(w.resource('r-org0-water').quantity, stock);
  assert.equal(w.need('need-water-main').firstServiceAt, null);
  assert.ok(operation(w, delivery.id).times.returned > delivery.createdAt);
  assert.ok(w.vehicle(delivery.vehicle).fuelUsed > 0);
  replayClean(w);
});

test('field inspection publishes its completed operation while the typed assessment receipt remains authoritative', () => {
  const w = new World({ ...config, extentKm: 2 }), inspection = act(w, 'verify',
    { target: 'building', id: w.state.map.shelterId, method: 'field', purpose: 'facility_safety' });
  until(w, () => w.state.inspections.find(i => i.id === inspection.id).state === 'completed');
  const source = w.state.inspections.find(i => i.id === inspection.id);
  until(w, () => observed(w, source.operation)?.state === 'completed');
  assert.equal(source.result.assessment.competent, true);
  assert.equal(observed(w, source.operation).times.service, source.observedAt);
  replayClean(w);
});

test('fuel exhaustion publishes both operation failure and vehicle failure without losing loaded cargo', () => {
  const w = new World({ ...config, vehicleFuelMl: 1000 }), delivery = dispatch(w);
  until(w, () => operation(w, delivery.id).state === 'failed');
  until(w, () => observed(w, delivery.id)?.state === 'failed' &&
    w.actorView('org0').known.vehicles[delivery.vehicle].state === 'failed');
  assert.equal(observed(w, delivery.id).failure, 'fuel_or_shift');
  assert.equal(w.vehicle(delivery.vehicle).load, 100, 'Stranded cargo remains in the physical ledger');
  assert.equal(w.need('need-water-main').served, 0);
  assert.equal(w.need('need-water-main').firstServiceAt, null);
  replayClean(w);
});

test('a delayed receiving team produces an observable unloading wait before actual useful aid', () => {
  const w = new World({ ...config, extentKm: 2 }), delivery = dispatch(w),
    b = w.building(w.state.map.shelterId);
  w.inject('lab_intervention', { kind: 'facility_receiver', id: b.id, available: false });
  until(w, () => observed(w, delivery.id)?.state === 'waiting_to_unload');
  assert.equal(w.need('need-water-main').served, 0);
  assert.equal(w.vehicle(delivery.vehicle).load, 100);
  w.inject('lab_intervention', { kind: 'facility_receiver', id: b.id, available: true });
  until(w, () => observed(w, delivery.id)?.state === 'completed');
  assert.equal(w.need('need-water-main').served, 100);
  replayClean(w);
});
