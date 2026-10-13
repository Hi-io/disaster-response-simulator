import test from 'node:test';
import assert from 'node:assert/strict';
import { integrateUtilization, utilizationMetrics } from '../engine/utilization.mjs';
import { World } from '../engine/world.mjs';

test('vehicle and staff capacity hours match hand-calculated intervals without background or cargo double counting', () => {
  const w = { now: 0, state: { statistics: {}, vehicles: [
    { id: 'owned', state: 'en_route', edge: 'road', operation: 'op', resourceType: 'staff', load: 3 },
    { id: 'idle', state: 'idle' }, { id: 'background', background: true, state: 'en_route', edge: 'road' } ],
    operations: [{ id: 'op', state: 'dispatched' }], resources: [{ type: 'staff', reserved: 2 }],
    commitments: [{ id: 'crew', state: 'confirmed', quantity: 2 }], inspections: [{ state: 'inspecting', staff: 'crew' }], repairs: [] } };
  integrateUtilization(w, 60000); w.now = 60000;
  w.state.vehicles[0] = { id: 'owned', state: 'arrived', load: 0 };
  w.state.resources[0].reserved = 0; w.state.inspections[0].state = 'completed';
  integrateUtilization(w, 120000); w.now = 120000;
  const m = utilizationMetrics(w);
  assert.equal(m.vehicleCommittedMs, 60000); assert.equal(m.vehicleMovingMs, 60000);
  assert.equal(m.staffTransitPersonMs, 180000); assert.equal(m.staffCommittedPersonMs, 300000);
  assert.equal(m.staffFieldWorkPersonMs, 120000); assert.equal(m.vehicleCommittedHours, 1 / 60);
  assert.equal(m.staffCommittedPersonHours, 5 / 60);
});

test('event-free source advance and checkpoint resume preserve exact finite vehicle-hours', () => {
  const w = new World({ scenario: 'S23', seed: 'hours-checkpoint-01', postsPerHour: 0, backgroundTraffic: 0, healthReports: false, recurringNeeds: false, hazard: 'none' });
  w.queue.heap = [];
  const v = w.state.vehicles[0]; v.state = 'blocked';
  w.advance(60000); assert.equal(utilizationMetrics(w).vehicleCommittedMs, 60000);
  const restored = new World(w.config, w.checkpoint()); restored.queue.heap = [];
  restored.advance(120000);
  const m = utilizationMetrics(restored);
  assert.equal(m.vehicleCommittedMs, 120000); assert.equal(m.vehicleBlockedMs, 120000);
  restored.vehicle(v.id).state = 'idle'; restored.advance(180000);
  assert.equal(utilizationMetrics(restored).vehicleCommittedMs, 120000);
});

test('a legacy checkpoint does not invent previously measured working hours', () => {
  assert.equal(utilizationMetrics({ now: 99, state: { statistics: {} } }).available, false);
});
