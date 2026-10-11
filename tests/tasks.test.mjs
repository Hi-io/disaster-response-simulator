import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../engine/world.mjs';
const world = () =>
  new World({
    hazard: 'none',
    postsPerHour: 0,
    backgroundTraffic: 0,
    packetLoss: 0,
    grid: 5,
    extentKm: 2,
    loadMs: 1000,
    unloadMs: 1000,
    inspectionMs: 1000,
    setupMs: 1000,
  });
let key = 0;
const act = (w, type, params = {}, org = 'org0', role = 'commander') =>
  w.act({ id: `${role}-${org}`, org, role }, { type, params, idempotencyKey: `test-${++key}` });
const clean = (w) => assert.deepEqual(w.invariants(), []);

test('field verification consumes staff, a vehicle and road travel before exposing the observation', () => {
  const w = world(),
    b = w.building(w.state.map.shelterId);
  const i = act(w, 'verify', { target: 'building', id: b.id });
  w.advance(1000);
  assert.equal(w.state.inspections[0].state, 'traveling');
  assert.equal(w.resource('r-org0-staff').reserved, 1);
  assert.equal(w.state.observations.org0.buildings[b.id], undefined);
  w.advance(600000);
  assert.equal(w.state.inspections[0].state, 'completed');
  assert.equal(w.resource('r-org0-staff').reserved, 0);
  assert.equal(w.state.observations.org0.buildings[b.id].safe, true);
  clean(w);
});
test('a late safe inspection cannot validate a newly damaged building', () => {
  const w = world(),
    b = w.building(w.state.map.shelterId);
  const i = { id: 'late', org: 'org0', target: 'building', entity: b.id, state: 'report_pending' };
  w.state.inspections.push(i);
  const oldVersion = b.version;
  b.damage = 2;
  b.version++;
  w.completeVerification({
    inspection: i.id,
    result: { id: b.id, safe: true, version: oldVersion },
    observedAt: 0,
  });
  assert.equal(b.assessed, false);
});
test('an evacuation occupies a real vehicle and finite shelter places until people arrive', () => {
  const w = world(),
    from = w.building('b0'),
    to = w.building(w.state.map.shelterId);
  to.state = 'operating';
  to.damage = 0;
  w.addNeed({
    id: 'need-shelter-test',
    building: from.id,
    type: 'shelter',
    quantity: 40,
    unit: 'place',
    population: 40,
    deadline: 3600000,
  });
  const t = act(w, 'evacuate', { from: from.id, to: to.id, vehicle: 'v-org0-0', quantity: 20 });
  assert.equal(to.reservedPlaces, 20);
  assert.equal(to.occupancy, 0);
  assert.throws(() =>
    act(w, 'evacuate', { from: from.id, to: to.id, vehicle: 'v-org0-0', quantity: 20 }),
  );
  w.advance(600000);
  assert.equal(to.occupancy, 20);
  assert.equal(to.reservedPlaces, 0);
  assert.equal(w.need(t.need).served, 20);
  clean(w);
});
test('shelter collapse after dispatch prevents a false completed evacuation', () => {
  const w = world(),
    from = w.building('b0'),
    to = w.building(w.state.map.shelterId);
  to.state = 'operating';
  w.addNeed({
    id: 'need-shelter-test',
    building: from.id,
    type: 'shelter',
    quantity: 20,
    unit: 'place',
    deadline: 3600000,
  });
  act(w, 'evacuate', { from: from.id, to: to.id, vehicle: 'v-org0-0', quantity: 20 });
  w.schedule(15000, 'damage', { building: to.id, severity: 2, cause: 'aftershock' }, 0);
  w.advance(600000);
  assert.equal(to.occupancy, 0);
  assert.equal(w.need('need-shelter-test').served, 0);
  assert.equal(w.vehicle('v-org0-0').passengers, 20);
});
test('loans require bilateral approval and physical transport before recipient stock exists', () => {
  const w = world(),
    t = act(w, 'transfer', { resource: 'r-org0-water', quantity: 100, to: 'org1', loan: true });
  assert.equal(w.resource('r-org0-water').reserved, 100);
  assert.throws(() => act(w, 'dispatch', { transfer: t.id, vehicle: 'v-org0-0' }));
  act(w, 'transfer', { action: 'accept', id: t.id }, 'org1');
  act(w, 'dispatch', { transfer: t.id, vehicle: 'v-org0-0' });
  w.advance(600000);
  const r = w.resource(`stock-${w.organization('org1').node}-water`);
  assert.equal(r.owner, 'org1');
  assert.equal(r.quantity, 100);
  assert.equal(r.loanOf, t.id);
  clean(w);
});
test('conditional commitments cannot be confirmed with a fabricated confirmed flag', () => {
  const w = world(),
    c = act(w, 'commitment', {
      action: 'reserve',
      resource: 'r-org0-water',
      quantity: 100,
      conditions: [{ confirmed: true }],
    });
  assert.throws(
    () => act(w, 'commitment', { action: 'confirm', id: c.id }),
    (e) => e.code === 'CONDITION',
  );
  assert.equal(w.resource('r-org0-water').reserved, 100);
  clean(w);
});
test('a completed inspection can satisfy an evidence-backed condition', () => {
  const w = world(),
    i = act(w, 'verify', { target: 'building', id: w.state.map.shelterId });
  w.advance(600000);
  const c = act(w, 'commitment', {
    action: 'reserve',
    resource: 'r-org0-water',
    quantity: 100,
    conditions: [{ type: 'inspection', id: i.id, field: 'safe', equals: true }],
  });
  act(w, 'commitment', { action: 'confirm', id: c.id });
  clean(w);
});
test('cancelling loaded cargo returns it over roads without erasing sunk travel', () => {
  const w = world(),
    initial = w.resource('r-org0-water').quantity,
    op = act(w, 'dispatch', {
      vehicle: 'v-org0-0',
      resource: 'r-org0-water',
      quantity: 100,
      need: 'need-water-main',
    });
  w.advance(15000);
  assert.equal(w.vehicle('v-org0-0').load, 100);
  act(w, 'cancel', { id: op.id });
  assert.equal(w.resource('r-org0-water').quantity, initial - 100);
  w.advance(600000);
  assert.equal(w.resource('r-org0-water').quantity, initial);
  assert.equal(w.need('need-water-main').served, 0);
  assert.ok(w.vehicle('v-org0-0').fuelUsed > 0);
  clean(w);
});
test('debris repair requires access, a crew and time; a flooded road cannot be cleared as rubble', () => {
  const w = world(),
    e = w.edge('n0:n1');
  e.open = false;
  const task = act(w, 'repair', { edge: e.id });
  assert.equal(e.open, false);
  w.advance(1000);
  assert.equal(w.resource('r-org0-staff').reserved, 2);
  w.advance(60000);
  assert.equal(e.open, true);
  assert.equal(w.resource('r-org0-staff').reserved, 0);
  e.waterDepth = 0.8;
  assert.throws(
    () => act(w, 'repair', { edge: e.id }),
    (error) => error.code === 'FLOOD',
  );
  clean(w);
});
test('a funded purchase waits for supplier receipt instead of creating immediate inventory', () => {
  const w = world(),
    stock = w.resource('r-org0-water').quantity;
  act(w, 'purchase', { type: 'water', quantity: 100, price: 2, leadMs: 60000 });
  assert.equal(w.resource('r-org0-water').quantity, stock);
  assert.equal(w.organization('org0').funds, 4800);
  w.advance(60000);
  assert.equal(w.resource('r-org0-water').quantity, stock + 100);
  clean(w);
});
test('public stages require real physical evidence when attached to an operation', () => {
  const w = world(),
    op = act(w, 'dispatch', {
      vehicle: 'v-org0-0',
      resource: 'r-org0-water',
      quantity: 100,
      need: 'need-water-main',
    });
  assert.throws(
    () => act(w, 'publish', { text: 'Help has arrived', stage: 'service', operation: op.id }),
    (e) => e.code === 'PUBLIC_EVIDENCE',
  );
  w.advance(600000);
  act(w, 'publish', { text: 'Water delivered', stage: 'service', operation: op.id });
  clean(w);
});
