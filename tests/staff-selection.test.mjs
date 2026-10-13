import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../engine/world.mjs';
import { createResource, reserve, checkResource } from '../engine/ledger.mjs';
import { staffSnapshot, qualifiedStaffAvailable } from '../engine/staff.mjs';
import { replay } from '../evaluation/runs.mjs';

const config = { scenario: 'S09', compositionVariant: 'delayed', seed: 'selected-mixed-staff', policy: 'none', hazard: 'none',
  topology: 'grid', grid: 5, extentKm: 2, durationMs: 21600000, postsPerHour: 0,
  backgroundTraffic: 0, healthReports: false, recurringNeeds: false, packetLoss: 0,
  networkLatencyMs: 1000, loadMs: 1000, unloadMs: 1000, inspectionMs: 1000, setupMs: 1000 };
const skills = ['field_assessment', 'shelter_support', 'water_operations'];
let serial = 0;
const act = (w, org, type, params) => w.act({ id: `selector-${org}`, org, role: 'commander' },
  { type, params, idempotencyKey: `selector-${++serial}` });
const op = (w, id) => w.state.operations.find(x => x.id === id);
function until(w, predicate) { let n = 0; while (!predicate() && n++ < 30000) assert.ok(w.step()); assert.ok(predicate()); }
function dispatch(w, org, params) {
  const x = act(w, org, 'dispatch', { vehicle: `v-${org}-0`, ttlMs: 3600000, ...params });
  until(w, () => op(w, x.id).state === 'completed');
  until(w, () => w.actorView(org).known.vehicles[x.vehicle]?.state === 'idle');
  return op(w, x.id);
}
function transfer(w, from, to, quantity, resource, staffSkills) {
  const x = act(w, from, 'transfer', { resource: resource ?? `r-${from}-staff`, to, quantity,
    ttlMs: 3600000, ...(staffSkills ? { staffSkills } : {}) });
  act(w, to, 'transfer', { action: 'accept', id: x.id });
  return w.resource(dispatch(w, from, { transfer: x.id }).destinationStock);
}
function mixed(w) {
  const p = act(w, 'org0', 'purchase', { type: 'staff', quantity: 2, price: 1, leadMs: 60000 });
  until(w, () => w.state.purchases.find(x => x.id === p.id).state === 'received');
  const received=w.state.purchases.find(x=>x.id===p.id),purchased=w.resource(received.receipts[0].resource),native=w.resource('r-org0-staff');
  // New hires have no invented schedule or skill. The source owner declares
  // their actual schedule before combining the two compatible physical groups.
  w.inject('lab_intervention',{kind:'staff_calendar',resource:purchased.id,calendar:{
    shiftMs:native.staffCalendar.shiftMs,restMs:native.staffCalendar.restMs,epochAt:native.staffCalendar.epochAt}});
  w.advance(w.now);
  transfer(w, 'org0', 'org1', 2,purchased.id);
  return transfer(w, 'org0', 'org1', 2);
}
function clean(w) { assert.deepEqual(w.invariants(), []); w.advance(w.now);
  const r = replay(w.checkpoint()); assert.equal(r.matches, true); r.world.close(); w.close(); }

test('an approved selector takes only qualified people from a physically mixed depot and enables real service', () => {
  const w = new World(config), stock = mixed(w), b = w.building(w.state.map.shelterId);
  assert.equal(stock.quantity, 4); assert.deepEqual(stock.qualifications, []);
  const visit = act(w, 'org1', 'verify', { target: 'building', id: b.id, method: 'field',
    purpose: 'facility_safety', staff: stock.id, vehicle: 'v-org1-1' });
  until(w, () => w.state.inspections.find(i => i.id === visit.id).state === 'traveling');
  const before = w.checkpoint();
  assert.throws(() => act(w, 'org1', 'dispatch', { vehicle: 'v-org1-0', resource: stock.id,
    quantity: 2, destination: b.node, building: b.id, staffSkills: ['shelter_support'] }), { code: 'STAFF_QUALIFICATIONS' });
  assert.equal(stock.reserved, 1); assert.equal(w.state.operations.length, before.state.operations.length);
  until(w, () => w.actorView('org1').inspections.find(i => i.id === visit.id)?.state === 'completed');
  const delivery = dispatch(w, 'org1', { resource: stock.id, quantity: 2, destination: b.node,
    building: b.id, staffSkills: b.requiredStaffSkills });
  assert.deepEqual(delivery.staffSkills, [...b.requiredStaffSkills].sort());
  assert.deepEqual(delivery.receivedStaff.qualifications, skills);
  const site = w.resource(delivery.destinationStock);
  assert.equal(site.owner, 'org0'); assert.equal(site.quantity, 2);
  assert.equal(qualifiedStaffAvailable(site, b.requiredStaffSkills), 2);
  assert.deepEqual(staffSnapshot(stock).qualificationCounts, {});
  const assessment = act(w, 'org0', 'verify', { target: 'building', id: b.id, method: 'field', purpose: 'facility_safety' });
  until(w, () => w.actorView('org0').inspections.find(i => i.id === assessment.id)?.state === 'completed');
  for (const [type, quantity] of Object.entries(b.dependencies).filter(([type]) => type !== 'staff')) {
    const r = w.resource(`r-org0-${type}`), missing = Math.max(0, quantity - r.quantity + r.reserved + r.floor);
    if (missing) { const p = act(w, 'org0', 'purchase', { type, quantity: missing, price: 1, leadMs: 60000 });
      until(w, () => w.state.purchases.find(x => x.id === p.id).state === 'received'); }
    let left = quantity;
    while (left) { const q = Math.min(left, w.vehicle('v-org0-0').capacity);
      dispatch(w, 'org0', { resource: r.id, quantity: q, destination: b.node, building: b.id }); left -= q; }
  }
  act(w, 'org0', 'activate', { building: b.id, permit: true }); until(w, () => b.state === 'operating');
  assert.equal(site.reserved, b.dependencies.staff); assert.equal(qualifiedStaffAvailable(site, b.requiredStaffSkills), 0);
  clean(w);
});

test('selectors cannot fabricate an intersection, modify an accepted crew, select nonstaff or bypass owner/version checks', () => {
  const w = new World(config), stock = mixed(w), node = w.organization('org2').node;
  for (const staffSkills of [['field_assessment', 'field_assessment'], ['Bad skill'], Array(33).fill('skill')])
    assert.throws(() => act(w, 'org1', 'dispatch', { resource: stock.id, vehicle: 'v-org1-0', quantity: 1, destination: node, staffSkills }), { code: 'STAFF_SELECTOR' });
  assert.throws(() => act(w, 'org1', 'dispatch', { resource: 'r-org1-water', vehicle: 'v-org1-0', quantity: 1,
    destination: node, staffSkills: [] }), { code: 'STAFF_SELECTOR' });
  assert.throws(() => act(w, 'org0', 'dispatch', { resource: stock.id, vehicle: 'v-org0-0', quantity: 1,
    destination: node, staffSkills: ['field_assessment'] }), { code: 'FORBIDDEN' });
  assert.throws(() => w.act({ id: 'owner', org: 'org1', role: 'commander' }, { type: 'commitment',
    params: { action: 'reserve', resource: stock.id, quantity: 1, staffSkills: ['field_assessment'] },
    expectedVersion: stock.version - 1, idempotencyKey: 'stale-selected-crew' }), { code: 'VERSION_CONFLICT' });
  assert.equal(stock.reserved, 0);
  const c = act(w, 'org1', 'commitment', { action: 'reserve', resource: stock.id, quantity: 1, ttlMs: 3600000 });
  act(w, 'org1', 'commitment', { action: 'confirm', id: c.id });
  assert.throws(() => act(w, 'org1', 'dispatch', { resource: stock.id, vehicle: 'v-org1-0', quantity: 1,
    destination: node, commitment: c.id, staffSkills: ['field_assessment'] }), { code: 'STAFF_SCOPE' });
  act(w, 'org1', 'commitment', { action: 'release', id: c.id });
  const t = act(w, 'org1', 'transfer', { resource: stock.id, to: 'org2', quantity: 1,
    ttlMs: 3600000, staffSkills: ['field_assessment'] });
  assert.throws(() => act(w, 'org2', 'transfer', { action: 'accept', id: t.id, staffSkills: ['water_operations'] }), { code: 'STAFF_SCOPE' });
  act(w, 'org2', 'transfer', { action: 'accept', id: t.id });
  assert.throws(() => act(w, 'org1', 'dispatch', { transfer: t.id, vehicle: 'v-org1-0', staffSkills: ['water_operations'] }), { code: 'STAFF_SCOPE' });
  assert.equal(stock.reserved, 1);
  dispatch(w, 'org1', { transfer: t.id });
  clean(w);
  const split = createResource('split-skills', 'org1', node, 'staff', 2, 0, {
    qualificationCounts: { field_assessment: 1, shelter_support: 1 },
    qualificationProfiles: [{ quantity: 1, qualifications: ['field_assessment'] }, { quantity: 1, qualifications: ['shelter_support'] }] });
  assert.throws(() => reserve(split, 1, ['field_assessment', 'shelter_support']));
  assert.equal(split.reserved, 0); assert.equal(checkResource(split), true);
});

test('typed cargo cancellation and checkpoint resume return the exact selected people once', () => {
  const w = new World(config), stock = mixed(w);
  const delivery = act(w, 'org1', 'dispatch', { resource: stock.id, vehicle: 'v-org1-0', quantity: 1,
    destination: w.organization('org3').node, staffSkills: ['water_operations'], ttlMs: 3600000 });
  until(w, () => w.vehicle(delivery.vehicle).load === 1 && op(w, delivery.id).phase !== 'pickup');
  assert.equal(staffSnapshot(stock).qualificationCounts.water_operations, 1);
  const resumed = new World(w.config, w.checkpoint());
  for (const world of [w, resumed]) {
    act(world, 'org1', 'cancel', { id: delivery.id });
    until(world, () => op(world, delivery.id).times.returned !== undefined);
    assert.equal(world.resource(stock.id).quantity, 4);
    assert.equal(staffSnapshot(world.resource(stock.id)).qualificationCounts.water_operations, 2);
    assert.equal(world.vehicle(delivery.vehicle).staffCargo, undefined);
    assert.deepEqual(world.invariants(), []);
  }
  // Both resumed branches retain the same physical qualification profile.
  assert.deepEqual(staffSnapshot(resumed.resource(stock.id)), staffSnapshot(stock));
  resumed.close(); clean(w);
});
