import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../engine/world.mjs';
import { createResource, reserve, release, load, checkResource } from '../engine/ledger.mjs';
import { staffSnapshot, qualifiedStaffAvailable, receiveStaff, staffReservation } from '../engine/staff.mjs';
import { replay } from '../evaluation/runs.mjs';

const config = { scenario: 'S09', compositionVariant: 'delayed', seed: 'physical-staff-transport', policy: 'none', hazard: 'none',
  topology: 'grid', grid: 5, extentKm: 2, durationMs: 21600000, postsPerHour: 0,
  backgroundTraffic: 0, healthReports: false, recurringNeeds: false, packetLoss: 0,
  networkLatencyMs: 1000, loadMs: 1000, unloadMs: 1000, inspectionMs: 1000, setupMs: 1000 };
const allSkills = ['field_assessment', 'shelter_support', 'water_operations'];
let serial = 0;
const act = (w, org, type, params) => w.act({ id: `staff-owner-${org}`, org, role: 'commander' },
  { type, params, idempotencyKey: `staff-transport-${++serial}` });
const operation = (w, id) => w.state.operations.find(o => o.id === id);
function until(w, predicate) {
  let n = 0;
  while (!predicate() && n++ < 30000) assert.ok(w.step(), 'Physical events must progress');
  assert.ok(predicate(), 'Expected physical effect must occur');
}
function deliver(w, org, params) {
  const p = act(w, org, 'dispatch', { vehicle: `v-${org}-0`, ttlMs: 3600000, ...params });
  until(w, () => operation(w, p.id).state === 'completed');
  until(w, () => w.actorView(org).known.vehicles[p.vehicle]?.state === 'idle');
  return operation(w, p.id);
}
function transfer(w, from, to, quantity, resource = `r-${from}-staff`) {
  const t = act(w, from, 'transfer', { resource, to, quantity, ttlMs: 3600000 });
  act(w, to, 'transfer', { action: 'accept', id: t.id });
  const p = deliver(w, from, { transfer: t.id });
  until(w, () => w.actorView(to).known.resources[p.destinationStock]?.version === w.resource(p.destinationStock).version);
  return w.resource(p.destinationStock);
}
function cleanReplay(w) {
  assert.deepEqual(w.invariants(), []); w.advance(w.now);
  const r = replay(w.checkpoint()); assert.equal(r.matches, true); r.world.close(); w.close();
}
function counts(r, expected) {
  assert.deepEqual(staffSnapshot(r).qualificationCounts,
    Object.fromEntries(expected ? allSkills.map(s => [s, expected]) : []));
}

test('bilateral staff transfer, field assessment and re-expedition retain real skills through facility activation', () => {
  const w = new World(config), b = w.building(w.state.map.shelterId);
  const stock = transfer(w, 'org1', 'org0', 4);
  counts(w.resource('r-org1-staff'), 2); counts(stock, 4);
  assert.equal(stock.owner, 'org0');
  assert.deepEqual(w.actorView('org0').known.resources[stock.id].qualificationCounts, stock.qualificationCounts);
  const inventory = act(w, 'org0', 'query', { target: 'inventory' });
  until(w, () => w.state.queries.find(q => q.id === inventory.id).state === 'ready');
  assert.deepEqual(w.state.queries.find(q => q.id === inventory.id).result.find(r => r.id === stock.id).qualificationProfiles,
    stock.qualificationProfiles);
  const inspection = act(w, 'org0', 'verify', { target: 'building', id: b.id, method: 'field',
    purpose: 'facility_safety', staff: stock.id, vehicle: 'v-org0-1' });
  until(w, () => w.actorView('org0').inspections.find(i => i.id === inspection.id)?.state === 'completed');
  assert.ok(w.actorView('org0').inspections.find(i => i.id === inspection.id).result.assessment.qualifications.includes('field_assessment'));
  const staff = deliver(w, 'org0', { resource: stock.id, building: b.id, destination: b.node, quantity: b.dependencies.staff });
  const site = w.resource(staff.destinationStock);
  counts(stock, 4 - b.dependencies.staff); counts(site, b.dependencies.staff);
  for (const [type, quantity] of Object.entries(b.dependencies).filter(([t]) => t !== 'staff')) {
    const source = w.resource(`r-org0-${type}`), missing = Math.max(0, quantity - source.quantity + source.reserved + source.floor);
    if (missing) {
      const purchase = act(w, 'org0', 'purchase', { type, quantity: missing, price: 1, leadMs: 60000 });
      until(w, () => w.state.purchases.find(p => p.id === purchase.id).state === 'received');
    }
    let remaining = quantity;
    while (remaining) {
      const amount = Math.min(remaining, w.vehicle('v-org0-0').capacity);
      deliver(w, 'org0', { resource: `r-org0-${type}`, building: b.id, destination: b.node, quantity: amount });
      remaining -= amount;
    }
  }
  act(w, 'org0', 'activate', { building: b.id, permit: true }); until(w, () => b.state === 'operating');
  assert.equal(site.reserved, b.dependencies.staff);
  assert.equal(qualifiedStaffAvailable(site, ['shelter_support']), 0, 'Assigned service staff cannot be dispatched again');
  counts(site, b.dependencies.staff);
  cleanReplay(w);
});

test('new unqualified staff do not inherit depot credentials and an assigned assessor cannot be shipped concurrently', () => {
  const w = new World(config), b = w.building(w.state.map.shelterId);
  const donation = act(w, 'org0', 'purchase', { type: 'staff', quantity: 2, price: 1, leadMs: 60000 });
  until(w, () => w.state.purchases.find(p => p.id === donation.id).state === 'received');
  const native = w.resource('r-org0-staff');
  counts(native, 6); assert.equal(native.quantity, 8); assert.deepEqual(native.qualifications, []);
  const unqualified = transfer(w, 'org0', 'org1', 2); counts(unqualified, 0);
  const mixed = transfer(w, 'org0', 'org1', 1); assert.equal(mixed.id, unqualified.id);
  assert.equal(mixed.quantity, 3); counts(mixed, 1); assert.deepEqual(mixed.qualifications, []);
  const inspection = act(w, 'org1', 'verify', { target: 'building', id: b.id, method: 'field',
    purpose: 'facility_safety', staff: mixed.id, vehicle: 'v-org1-1' });
  until(w, () => w.state.inspections.find(i => i.id === inspection.id).state === 'traveling');
  assert.equal(qualifiedStaffAvailable(mixed, ['field_assessment']), 0);
  const shipment = deliver(w, 'org1', { resource: mixed.id, destination: w.organization('org2').node, quantity: 2 });
  counts(w.resource(shipment.destinationStock), 0); counts(mixed, 1);
  until(w, () => w.actorView('org1').inspections.find(i => i.id === inspection.id)?.state === 'completed');
  assert.ok(w.actorView('org1').inspections.find(i => i.id === inspection.id).result.assessment.qualifications.includes('field_assessment'));
  assert.equal(mixed.quantity, 1); assert.equal(mixed.reserved, 0);
  cleanReplay(w);
});

test('marginal counts and separate skill groups cannot fabricate a multi-qualified person', () => {
  const r = createResource('split', 'org0', 'n0', 'staff', 2, 0, {
    qualificationCounts: { shelter_support: 1, water_operations: 1 },
    qualificationProfiles: [{ quantity: 1, qualifications: ['shelter_support'] },
      { quantity: 1, qualifications: ['water_operations'] }] });
  assert.equal(qualifiedStaffAvailable(r, ['shelter_support', 'water_operations']), 0);
  assert.throws(() => reserve(r, 1, ['shelter_support', 'water_operations']));
  assert.equal(r.reserved, 0); assert.equal(checkResource(r), true);
  const marginal = createResource('native-counts', 'org0', 'n0', 'staff', 3, 0,
    { qualificationCounts: { shelter_support: 2, water_operations: 2 } });
  assert.equal(qualifiedStaffAvailable(marginal, ['shelter_support', 'water_operations']), 1,
    'Only the guaranteed intersection of unspecified native counts can be assigned');
  const key = reserve(marginal, 1, ['shelter_support', 'water_operations']);
  const cargo = load(marginal, 1, key), destination = createResource('received', 'org1', 'n1', 'staff', 0);
  receiveStaff(destination, 1, cargo); destination.quantity++; destination.received++;
  for (const skill of ['shelter_support', 'water_operations']) {
    assert.equal(staffSnapshot(marginal).qualificationCounts[skill] + staffSnapshot(destination).qualificationCounts[skill], 2);
    assert.equal(staffSnapshot(marginal).qualificationCounts[skill], 1);
  }
  assert.equal(qualifiedStaffAvailable(marginal, ['shelter_support', 'water_operations']), 0);
  assert.equal(checkResource(marginal), true); assert.equal(checkResource(destination), true);
});

test('physical cancellation returns staff profiles without duplicating their credentials', () => {
  const w = new World(config), stock = transfer(w, 'org1', 'org0', 3);
  const p = act(w, 'org0', 'dispatch', { vehicle: 'v-org0-0', resource: stock.id,
    destination: w.organization('org2').node, quantity: 2, ttlMs: 3600000 });
  until(w, () => w.vehicle(p.vehicle).load === 2 && operation(w, p.id).phase !== 'pickup');
  counts(stock, 1); assert.equal(w.vehicle(p.vehicle).staffCargo.quantity, 2);
  act(w, 'org0', 'cancel', { id: p.id });
  until(w, () => operation(w, p.id).state === 'cancelled' && operation(w, p.id).times.returned !== undefined);
  counts(stock, 3); assert.equal(stock.quantity, 3); assert.equal(w.vehicle(p.vehicle).staffCargo, undefined);
  cleanReplay(w);
});

test('partial staff service consumes the transported people and leaves no reusable credentials at the receiver', () => {
  const w = new World(config), stock = transfer(w, 'org1', 'org0', 4);
  const b = w.building(w.state.map.shelterId);
  w.addNeed({ id: 'need-staff-partial', building: b.id, type: 'staff', quantity: 3,
    population: 20, unit: 'person', deadline: w.config.durationMs });
  const p = act(w, 'org0', 'dispatch', { vehicle: 'v-org0-0', resource: stock.id,
    need: 'need-staff-partial', quantity: 2, ttlMs: 3600000 });
  until(w, () => w.vehicle(p.vehicle).load === 2);
  const checkpoint = w.checkpoint(), resumed = new World(w.config, checkpoint);
  for (const world of [w, resumed]) {
    until(world, () => operation(world, p.id).state === 'completed');
    const destination = world.resource(operation(world, p.id).destinationStock);
    assert.equal(destination.quantity, 0); assert.equal(destination.consumed, 2); counts(destination, 0);
    counts(world.resource(stock.id), 2); assert.equal(world.need('need-staff-partial').served, 2);
    assert.equal(qualifiedStaffAvailable(destination, allSkills), 0);
    assert.deepEqual(world.invariants(), []); world.advance(world.now);
  }
  assert.equal(resumed.stateHash(), w.stateHash(), 'A loaded staff checkpoint resumes exactly');
  resumed.close(); w.close();
});

test('failed pickup, released holds and damaged stock do not consume or duplicate staff qualifications', () => {
  const w = new World({ ...config, extentKm: 12 });
  deliver(w, 'org0', { resource: 'r-org0-food', destination: w.organization('org3').node, quantity: 1 });
  const native = w.resource('r-org0-staff');
  const p = act(w, 'org0', 'dispatch', { vehicle: 'v-org0-0', resource: native.id,
    destination: w.organization('org1').node, quantity: 2 });
  until(w, () => operation(w, p.id).state === 'failed');
  assert.equal(native.quantity, 6); assert.equal(native.reserved, 0); counts(native, 6);
  assert.equal(native.staffReservations.length, 0);
  w.inject('lab_intervention', { kind: 'resource_condition', id: native.id, damaged: true });
  assert.equal(native.quantity, 0); assert.equal(native.lost, 6); counts(native, 0);
  cleanReplay(w);
});

test('separate reservations retain their actual selected skill groups when loaded out of order', () => {
  const r = createResource('people', 'org0', 'n0', 'staff', 3, 0, {
    qualificationProfiles: [{ quantity: 1, qualifications: allSkills }, { quantity: 2, qualifications: [] }] });
  const assessor = reserve(r, 1, ['field_assessment']), shipment = reserve(r, 2);
  assert.deepEqual(staffReservation(r, assessor).qualifications, allSkills);
  const cargo = load(r, 2, shipment); assert.deepEqual(cargo.qualificationCounts, {});
  assert.equal(r.quantity, 1); counts(r, 1); assert.equal(r.reserved, 1);
  release(r, 1, assessor); assert.equal(qualifiedStaffAvailable(r, allSkills), 1);
  assert.equal(checkResource(r), true);
});
