import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../engine/world.mjs';
import { replay } from '../evaluation/runs.mjs';
import { createResource } from '../engine/ledger.mjs';
import { route } from '../generators/map.mjs';

const config = { scenario: 'S09', seed: 'dated-supplies', policy: 'none', hazard: 'none',
  topology: 'grid', grid: 5, extentKm: 2, durationMs: 21600000, postsPerHour: 0,
  backgroundTraffic: 0, healthReports: false, recurringNeeds: false, packetLoss: 0,
  networkLatencyMs: 1000, loadMs: 1000, unloadMs: 1000, inspectionMs: 1000, setupMs: 1000 };
let serial = 0;
const act = (w, org, type, params) => w.act({ id: `lot-${org}`, org, role: 'commander' },
  { type, params, idempotencyKey: `dated-lot-${++serial}` });
const op = (w, id) => w.state.operations.find(o => o.id === id);
function until(w, predicate) { let n = 0; while (!predicate() && n++ < 30000) assert.ok(w.step()); assert.ok(predicate()); }
function dated(w, id, lotId, useByAt) { w.inject('lab_intervention', { kind: 'resource_condition', id, lotId, useByAt }); }
function deliver(w, org, params) { const x = act(w, org, 'dispatch', { vehicle: `v-${org}-0`, ttlMs: 3600000, ...params });
  until(w, () => op(w, x.id).state === 'completed'); until(w, () => w.actorView(org).known.vehicles[x.vehicle]?.state === 'idle'); return op(w, x.id); }
function clean(w) { w.advance(w.now); assert.deepEqual(w.invariants(), []); const replayed = replay(w.checkpoint());
  assert.equal(replayed.matches, true); replayed.world.close(); w.close(); }

test('dated stock expires by the source clock, releases reservations and only communicates through the real outage channel', () => {
  const w = new World(config), r = w.resource('r-org0-water');
  dated(w, r.id, 'water-lot-A', 10000);
  w.advance(5000);
  const c = act(w, 'org0', 'commitment', { action: 'reserve', resource: r.id, quantity: 100 });
  const sector = w.sectorForNode(r.node);
  w.inject('intervention', { type: 'cut', sector, duration: 60000 });
  w.advance(10000);
  assert.equal(r.quantity, 0); assert.equal(r.reserved, 0); assert.equal(r.condition, 'expired');
  assert.equal(w.state.commitments.find(x => x.id === c.id).state, 'withdrawn');
  assert.throws(() => act(w, 'org0', 'dispatch', { resource: r.id, quantity: 100,
    vehicle: 'v-org0-0', need: 'need-water-main' }), { code: 'SUPPLY_EXPIRED' });
  assert.equal(w.actorView('org0').known.resources[r.id].condition, undefined,
    'Private expiry does not instantly leak through a disconnected source channel');
  w.advance(80000); assert.equal(w.actorView('org0').known.resources[r.id].condition, 'expired'); clean(w);
});

test('unexpired delivery serves people but expiry during a real trip is loss, never a useful receipt', () => {
  const w = new World(config), r = w.resource('r-org0-water');
  dated(w, r.id, 'fresh', 600000);
  const first = deliver(w, 'org0', { resource: r.id, quantity: 100, need: 'need-water-main' });
  assert.equal(first.received, 100); assert.equal(w.need('need-water-main').served, 100);
  const pickup = route(w.state.map, w.vehicle('v-org0-0').node, r.node, w.vehicle('v-org0-0'));
  dated(w, r.id, 'fresh', w.now + pickup.freeTimeMs + config.loadMs + 15000);
  const second = act(w, 'org0', 'dispatch', { resource: r.id, quantity: 100,
    vehicle: 'v-org0-0', need: 'need-water-main', ttlMs: 3600000 });
  until(w, () => w.vehicle(second.vehicle).load === 100);
  until(w, () => op(w, second.id).state === 'failed');
  assert.equal(op(w, second.id).failure, 'supply_expired'); assert.equal(op(w, second.id).received, 0);
  assert.equal(op(w, second.id).expiredQuantity, 100); assert.equal(w.need('need-water-main').served, 100);
  assert.ok(w.state.resources.find(x => x.id.startsWith('expired-cargo-') && x.lost === 100)); clean(w);
});

test('bilateral transfers preserve distinct lot dates and a fresh lot is not lost when a co-located older lot expires', () => {
  const w = new World(config), stockIds = [];
  for (const [org, lotId, useByAt] of [['org0', 'older', 500000], ['org2', 'fresh', 1000000]]) {
    const resource = `r-${org}-water`; dated(w, resource, lotId, useByAt);
    const t = act(w, org, 'transfer', { resource, to: 'org1', quantity: 100, ttlMs: 3600000 });
    act(w, 'org1', 'transfer', { action: 'accept', id: t.id });
    const receipt = deliver(w, org, { transfer: t.id });
    const r = w.resource(receipt.destinationStock); stockIds.push(r.id);
    assert.equal(r.lotId, lotId); assert.equal(r.useByAt, useByAt); assert.equal(r.owner, 'org1');
    assert.deepEqual(r.lotOrigin, { owner: org, resource });
  }
  assert.notEqual(...stockIds); w.advance(600000);
  assert.equal(w.resource(stockIds[0]).quantity, 0); assert.equal(w.resource(stockIds[1]).quantity, 100);
  const next = deliver(w, 'org1', { resource: stockIds[1], quantity: 100, need: 'need-water-main' });
  assert.equal(next.received, 100); assert.equal(w.need('need-water-main').served, 100); clean(w);
});

test('identical supplier lot labels do not merge independent origins and a loaded expiry correction is physical', () => {
  const w = new World(config), ids = [];
  for (const org of ['org0', 'org2']) {
    const resource = `r-${org}-water`;
    dated(w, resource, 'supplier-label', 2000000);
    const t = act(w, org, 'transfer', { resource, to: 'org1', quantity: 100, ttlMs: 3600000 });
    act(w, 'org1', 'transfer', { action: 'accept', id: t.id });
    ids.push(deliver(w, org, { transfer: t.id }).destinationStock);
  }
  assert.notEqual(ids[0], ids[1]);
  for (const id of ids) assert.equal(w.resource(id).quantity, 100);
  const x = act(w, 'org1', 'dispatch', { resource: ids[0], quantity: 100,
    need: 'need-water-main', vehicle: 'v-org1-0', ttlMs: 3600000 });
  until(w, () => w.vehicle(x.vehicle).load === 100);
  dated(w, ids[0], 'supplier-label', w.now + 1000);
  w.advance(w.now + 1000);
  assert.equal(op(w, x.id).failure, 'supply_expired');
  assert.equal(op(w, x.id).received, 0); assert.equal(w.need('need-water-main').served, 0);
  assert.equal(w.resource(ids[1]).quantity, 100);
  clean(w);
});

test('a shelter consumes only usable owner lots; expired and foreign co-located water cannot satisfy startup dependencies', () => {
  const w = new World(config), b = w.building(w.state.map.shelterId), waterIds = [];
  const inspection = act(w, 'org0', 'verify', { target: 'building', id: b.id, method: 'field', purpose: 'facility_safety', vehicle: 'v-org0-1' });
  until(w, () => w.actorView('org0').inspections.find(i => i.id === inspection.id)?.state === 'completed');
  for (const [type, quantity] of Object.entries(b.dependencies).filter(([type]) => type !== 'water'))
    deliver(w, 'org0', { resource: `r-org0-${type}`, building: b.id, destination: b.node, quantity });
  const old = createResource('lot-old-water', 'org0', w.organization('org0').node, 'water', 40);
  w.state.resources.push(old); dated(w, old.id, 'old-at-site', w.now + 1000000);
  waterIds.push(deliver(w, 'org0', { resource: old.id, building: b.id, destination: b.node, quantity: 40 }).destinationStock);
  deliver(w, 'org1', { resource: 'r-org1-water', destination: b.node, quantity: 200 });
  until(w, () => old.condition === 'expired');
  assert.throws(() => act(w, 'org0', 'activate', { building: b.id, permit: true }), { code: 'DEPENDENCY' });
  for (const [id, quantity] of [['fresh-a', 30], ['fresh-b', 30]]) {
    const r = createResource(id, 'org0', w.organization('org0').node, 'water', quantity);
    w.state.resources.push(r); dated(w, r.id, id, w.now + 1000000);
    waterIds.push(deliver(w, 'org0', { resource: r.id, building: b.id, destination: b.node, quantity }).destinationStock);
  }
  act(w, 'org0', 'activate', { building: b.id, permit: true }); until(w, () => b.state === 'operating');
  assert.equal(w.resource(waterIds[0]).consumed, 0); assert.equal(b.provisioned.water, 60);
  assert.ok(w.state.resources.some(r => r.type === 'water' && r.node === b.node && r.owner === 'org1' && r.quantity === 200));
  // The last case authors additional physical lots, so compare a checkpoint
  // branch rather than pretending these private fixture rows are external inputs.
  assert.deepEqual(w.invariants(), []); const fork = new World(config, w.checkpoint());
  fork.advance(w.now + 60000); w.advance(w.now + 60000); assert.equal(fork.stateHash(), w.stateHash()); fork.close(); w.close();
});
