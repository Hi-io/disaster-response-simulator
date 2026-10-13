import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../engine/world.mjs';
import { replay } from '../evaluation/runs.mjs';

const config = { scenario: 'S09', seed: 'physical-evacuation-receipts', policy: 'none', hazard: 'none',
  topology: 'grid', grid: 5, extentKm: 2, durationMs: 21600000, postsPerHour: 0,
  backgroundTraffic: 0, healthReports: false, recurringNeeds: false, packetLoss: 0,
  networkLatencyMs: 1000, loadMs: 1000, unloadMs: 1000, inspectionMs: 1000, setupMs: 1000 };
let serial = 0;
const act = (w, type, params) => w.act({ id: 'evac-owner', org: 'org0', role: 'commander' },
  { type, params, idempotencyKey: `evac-receipt-${++serial}` });
const operation = (w, id) => w.state.operations.find(o => o.id === id);
const observed = (w, id) => w.actorView('org0').known.operations[id];
function until(w, predicate) { let n = 0; while (!predicate() && n++ < 30000) assert.ok(w.step()); assert.ok(predicate()); }
function setup() {
  const w = new World(config), to = w.building(w.state.map.shelterId), demand = w.need('need-case-2');
  assert.equal(demand.type, 'shelter');
  const check = act(w, 'verify', { target: 'building', id: to.id, method: 'field', purpose: 'facility_safety' });
  until(w, () => w.actorView('org0').inspections.find(i => i.id === check.id)?.state === 'completed');
  for (const [type, quantity] of Object.entries(to.dependencies)) {
    const trip = act(w, 'dispatch', { resource: `r-org0-${type}`, quantity, destination: to.node,
      building: to.id, vehicle: 'v-org0-0', ttlMs: 3600000 });
    until(w, () => operation(w, trip.id).state === 'completed');
    until(w, () => w.actorView('org0').known.vehicles[trip.vehicle]?.state === 'idle');
  }
  act(w, 'activate', { building: to.id, permit: true }); until(w, () => to.state === 'operating');
  return { w, to, demand };
}
function clean(w) { assert.deepEqual(w.invariants(), []); w.advance(w.now);
  const r = replay(w.checkpoint()); assert.equal(r.matches, true); r.world.close(); w.close(); }

test('three real serial evacuation trips retain distinct service quantities after clearing and reusing the vehicle', () => {
  const { w, to, demand } = setup(), receipts = [];
  for (const quantity of [17, 20, demand.quantity - 37]) {
    const task = act(w, 'evacuate', { from: demand.building, to: to.id, vehicle: 'v-org0-1', quantity });
    until(w, () => w.vehicle('v-org0-1').passengers === quantity);
    assert.equal(operation(w, task.operation).received, undefined, 'Departure is not admission or useful service');
    until(w, () => operation(w, task.operation).state === 'completed');
    assert.equal(operation(w, task.operation).received, quantity); assert.equal(w.vehicle('v-org0-1').passengers, 0);
    until(w, () => observed(w, task.operation)?.state === 'completed');
    assert.equal(observed(w, task.operation).received, quantity);
    assert.equal(observed(w, task.operation).times.service, operation(w, task.operation).times.service);
    receipts.push(task.operation);
  }
  assert.equal(new Set(receipts).size, 3);
  assert.equal(receipts.reduce((n, id) => n + observed(w, id).received, 0), demand.quantity);
  assert.equal(demand.served, demand.quantity); assert.equal(to.occupancy, demand.quantity);
  assert.equal(to.reservedPlaces, 0); assert.equal(demand.inTransit, 0);
  clean(w);
});

test('an outage delays the truthful admission receipt without exposing service early or losing the passenger quantity', () => {
  const { w, to, demand } = setup(), task = act(w, 'evacuate', {
    from: demand.building, to: to.id, vehicle: 'v-org0-1', quantity: 17 });
  until(w, () => w.vehicle('v-org0-1').passengers === 17);
  const cutAt = w.now;
  w.inject('intervention', { type: 'cut', sector: to.sector, duration: 180000 });
  until(w, () => operation(w, task.operation).state === 'completed');
  assert.equal(operation(w, task.operation).received, 17); assert.equal(demand.served, 17);
  assert.notEqual(observed(w, task.operation)?.state, 'completed');
  assert.equal(w.actorView('org1').known.operations[task.operation], undefined);
  until(w, () => observed(w, task.operation)?.state === 'completed');
  assert.ok(w.now >= cutAt + 180000); assert.equal(observed(w, task.operation).received, 17);
  assert.equal(w.vehicle('v-org0-1').passengers, 0);
  const resumed = new World(w.config, w.checkpoint());
  assert.equal(resumed.actorView('org0').known.operations[task.operation].received, 17);
  resumed.close(); clean(w);
});
