import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../engine/world.mjs';
import { replay } from '../evaluation/runs.mjs';

const config = { scenario: 'S09', seed: 'received-facility-stock', policy: 'none', hazard: 'none',
  topology: 'grid', grid: 5, extentKm: 2, durationMs: 21600000, postsPerHour: 0,
  backgroundTraffic: 0, healthReports: false, recurringNeeds: false, packetLoss: 0,
  networkLatencyMs: 1000, loadMs: 1000, unloadMs: 1000, inspectionMs: 1000, setupMs: 1000,
  waterMlPerPersonDay: 100000 };
let serial = 0;
const act = (w, org, type, params) => w.act({ id: `owner-${org}`, org, role: 'commander' },
  { type, params, idempotencyKey: `owned-site-${++serial}` });
const op = (w, id) => w.state.operations.find(o => o.id === id);
function until(w, predicate) {
  let n = 0;
  while (!predicate() && n++ < 30000) assert.ok(w.step(), 'Physical events must progress');
  assert.ok(predicate(), 'Physical effect or receipt must be reached');
}
function delivery(w, org, params) {
  const operation = act(w, org, 'dispatch', { vehicle: `v-${org}-0`, ...params });
  until(w, () => op(w, operation.id).state === 'completed');
  until(w, () => w.actorView(org).known.vehicles[`v-${org}-0`].state === 'idle');
  return op(w, operation.id);
}
function assess(w, b) {
  const i = act(w, 'org0', 'verify', { target: 'building', id: b.id, method: 'field',
    purpose: 'facility_safety', vehicle: 'v-org0-1' });
  until(w, () => w.actorView('org0').inspections.find(x => x.id === i.id)?.state === 'completed');
}
function provision(w, b) {
  for (const [type, quantity] of Object.entries(b.dependencies))
    delivery(w, 'org0', { resource: `r-org0-${type}`, building: b.id, destination: b.node, quantity });
}
function cleanReplay(w) {
  assert.deepEqual(w.invariants(), []); w.advance(w.now);
  const r = replay(w.checkpoint()); assert.equal(r.matches, true); r.world.close(); w.close();
}

test('foreign need delivery followed by own provisioning activates from actual owner stock', () => {
  const w = new World(config), b = w.building(w.state.map.shelterId);
  const foreignDelivery = delivery(w, 'org1', { resource: 'r-org1-water', need: 'need-water-main', quantity: 100 });
  const foreign = w.resource(foreignDelivery.destinationStock);
  assert.equal(foreign.id, `stock-${b.node}-water`);
  assert.equal(foreign.owner, 'org1'); assert.equal(foreign.quantity, 0); assert.equal(foreign.consumed, 100);
  assess(w, b); provision(w, b);
  const water = w.resource(`stock-${b.node}-water-org0`);
  assert.equal(water.owner, 'org0'); assert.equal(water.quantity, b.dependencies.water);
  act(w, 'org0', 'activate', { building: b.id, permit: true });
  until(w, () => b.state === 'operating');
  assert.ok(b.activeReservations.every(id => w.state.commitments.find(c => c.id === id).owner === 'org0'));
  assert.equal(foreign.quantity, 0); assert.equal(foreign.consumed, 100);
  assert.equal(w.need('need-water-main').served, 100, 'Activation does not fabricate delivery against another need');
  cleanReplay(w);
});

test('service cannot consume foreign water; bilateral replenishment preserves ownership after own water is exhausted', () => {
  const w = new World(config), b = w.building(w.state.map.shelterId);
  delivery(w, 'org1', { resource: 'r-org1-water', need: 'need-water-main', quantity: 100 });
  const parked = delivery(w, 'org2', { resource: 'r-org2-water', destination: b.node, quantity: 200 });
  const foreign = w.resource(parked.destinationStock);
  assert.equal(foreign.owner, 'org2'); assert.equal(foreign.quantity, 200);
  assess(w, b); provision(w, b);
  act(w, 'org0', 'activate', { building: b.id, permit: true });
  until(w, () => b.state === 'operating');
  const demand = w.need('need-case-2');
  const evacuation = act(w, 'org0', 'evacuate', { from: demand.building, to: b.id, vehicle: 'v-org0-1', quantity: 20 });
  until(w, () => op(w, evacuation.operation).state === 'completed');
  assert.equal(b.occupancy, 20);
  until(w, () => b.state === 'closed');
  const ownWater = w.resource(`stock-${b.node}-water-org0`);
  assert.ok(ownWater.consumed > 0); assert.ok(ownWater.quantity < 2);
  assert.equal(foreign.quantity, 200); assert.equal(foreign.consumed, 0,
    'Co-located private stock is never borrowed or consumed by the service site');
  assert.equal(b.activeReservations.length, 0);
  const transfer = act(w, 'org1', 'transfer', { resource: 'r-org1-water', to: 'org0', quantity: 60 });
  assert.throws(() => act(w, 'org1', 'dispatch', { transfer: transfer.id, vehicle: 'v-org1-0' }), e => e.code === 'TRANSFER');
  act(w, 'org0', 'transfer', { action: 'accept', id: transfer.id });
  const shipment = act(w, 'org1', 'dispatch', { transfer: transfer.id, vehicle: 'v-org1-0' });
  until(w, () => op(w, shipment.id).state === 'completed');
  const received = w.resource(op(w, shipment.id).destinationStock);
  assert.equal(received.owner, 'org0'); assert.equal(received.quantity, 60);
  assert.equal(w.state.transfers.find(t => t.id === transfer.id).state, 'received');
  assess(w, b);
  const replenishment = delivery(w, 'org0', { resource: received.id, building: b.id, destination: b.node, quantity: 60 });
  assert.equal(replenishment.destinationStock, ownWater.id);
  assert.equal(received.quantity, 0); assert.equal(ownWater.received, 120);
  act(w, 'org0', 'activate', { building: b.id, permit: true });
  until(w, () => b.state === 'operating');
  const before = ownWater.consumed;
  until(w, () => ownWater.consumed > before);
  assert.equal(foreign.quantity, 200); assert.equal(foreign.consumed, 0);
  cleanReplay(w);
});
