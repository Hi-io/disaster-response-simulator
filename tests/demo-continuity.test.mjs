import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { World } from '../engine/world.mjs';
import { checkResource } from '../engine/ledger.mjs';
import { createLabServers } from '../sources/server.mjs';
import { replay } from '../evaluation/runs.mjs';

const config = { seed: 'continuous-demo-contract', topology: 'grid', grid: 5, extentKm: 3,
  scenario: 'S01', hazard: 'none', policy: 'none', organizations: 4, backgroundTraffic: 0,
  postsPerHour: 0, packetLoss: 0, healthReports: false, recurringNeeds: false, logMode: 'full',
  waterFatalityBpPerHour: 0, foodFatalityBpPerHour: 0, injuryFatalityBpPerHour: 0, exposureFatalityBpPerHour: 0,
  mode: 'interactive', clockLatency: 'wall', continuousDemo: true };
const join = (world, extra = {}) => world.demoCreateOrganization({ name: 'Harbor Rescue', idempotencyKey: 'continuity-join', ...extra }).organization;
const human = org => ({ id: 'owned-warehouse-human', org, role: 'commander' });

test('scheduled depot arrivals are additive, capped, configurable and deterministic without replacing reservations', () => {
  const w = new World(config); let restored;
  try {
    const org = join(w), r = w.resource(`r-${org.id}-water`);
    assert.equal(org.resupply.intervalMs, 1800000); assert.equal(org.resupply.water, 300);
    w.act(human(org.id), { type: 'commitment', params: { action: 'reserve', resource: r.id, quantity: 100, ttlMs: 3600000 }, idempotencyKey: 'protected-reservation' });
    const commitment = structuredClone(w.state.commitments.at(-1));
    w.advance(1800000);
    assert.equal(r.quantity, 900); assert.equal(r.reserved, 100); assert.equal(r.produced, 300);
    assert.deepEqual(w.state.commitments.at(-1), commitment);
    assert.equal(w.organization(org.id).resupply.receiptsCount, 2);
    assert.equal(w.organization(org.id).resupply.lastReceivedAt, 1800000);
    w.advance(7200000); assert.equal(r.quantity, 1200); assert.equal(checkResource(r), true);
    const change = { org: org.id, idempotencyKey: 'configure-disabled-stock', resupply: { enabled: false, intervalMs: 300000, water: 0, food: 0 } };
    const ack = w.demoConfigureResupply(change); assert.deepEqual(w.demoConfigureResupply(change), ack);
    assert.equal(ack.resupply.nextAt, null);
    assert.throws(() => w.demoConfigureResupply({ ...change, resupply: { enabled: true } }), { code: 'IDEMPOTENCY_CONFLICT' });
    for (const resupply of [{ intervalMs: 1 }, { water: 601 }, { food: 121 }, { enabled: 'yes' }, { unknown: true }])
      assert.throws(() => w.demoConfigureResupply({ org: org.id, idempotencyKey: 'bad-supply-config', resupply }), { code: 'DEMO_RESUPPLY' });
    const snapshot = w.checkpoint(); restored = new World(snapshot.manifest.config, snapshot);
    w.advance(10800000); restored.advance(10800000); assert.equal(w.stateHash(), restored.stateHash());
    assert.equal(w.need('need-water-main').served, 0, 'incoming depot stock never counts as service to a need');
  } finally { w.close(); restored?.close(); }
});

test('manual receipt acknowledgments are owner-human scoped, reference-idempotent and rate limited only in the demo', () => {
  const w = new World(config);
  try {
    const org = join(w, { resupply: { enabled: false } }), r = w.resource(`r-${org.id}-water`);
    const input = { resource: r.id, quantity: 300, receiptReference: 'DELIVERY-0001', note: 'Confirmed at the depot', idempotencyKey: 'human-delivery-first' };
    assert.throws(() => w.receiveInventory({ ...human(org.id), role: 'agent' }, input), { status: 403 });
    assert.throws(() => w.receiveInventory(human('org0'), input), { status: 403 });
    const before = r.quantity, receipt = w.receiveInventory(human(org.id), input);
    assert.equal(receipt.receipt.manual, true); assert.equal(receipt.receipt.quantity, 300);
    assert.equal(r.quantity, before + 300); assert.equal(r.received, 300); assert.equal(r.produced, 0);
    assert.deepEqual(w.receiveInventory(human(org.id), { ...input, idempotencyKey: 'another-key-same-reference' }), receipt);
    assert.equal(r.quantity, before + 300, 'a replay cannot receive the same shipment twice');
    assert.throws(() => w.receiveInventory(human(org.id), { ...input, quantity: 301 }), { code: 'IDEMPOTENCY_CONFLICT' });
    assert.throws(() => w.receiveInventory(human(org.id), { ...input, receiptReference: 'OTHER-INVOICE', idempotencyKey: 'another-key-same-reference' }), { code: 'IDEMPOTENCY_CONFLICT' });
    assert.throws(() => w.receiveInventory(human(org.id), { ...input, receiptReference: 'DELIVERY-0002', idempotencyKey: 'other-delivery-fast' }), { code: 'DEMO_RECEIPT_COOLDOWN' });
    w.advance(1800000);
    assert.throws(() => w.receiveInventory(human(org.id), { ...input, quantity: 400, receiptReference: 'TOO-MUCH-STOCK', idempotencyKey: 'oversized-stock-receipt' }), { code: 'DEMO_STOCK_CAP' });
    assert.equal(checkResource(r), true); assert.equal(w.state.needs.every(n => n.served === 0), true);
    const normal = new World({ ...config, continuousDemo: false });
    try {
      const normalInput = { ...input, resource: 'r-org0-water', quantity: 5000 };
      normal.receiveInventory(human('org0'), normalInput);
      normal.receiveInventory(human('org0'), { ...normalInput, quantity: 5000, receiptReference: 'NORMAL-0002', idempotencyKey: 'normal-second-immediate' });
      assert.equal(normal.resource('r-org0-water').received, 10000);
      assert.equal(normal.state.demo, undefined); assert.equal(normal.organization('org0').resupply, undefined);
      assert.equal(checkResource(normal.resource('r-org0-water')), true);
      normal.advance(30000);
      const repeated = replay(normal.checkpoint());
      try { assert.equal(repeated.matches, true, 'ordinary human receipts replay from the seed and recorded external input'); }
      finally { repeated.world.close(); }
    } finally { normal.close(); }
    for (const mode of ['headless', 'replay']) {
      const finite = new World({ ...config, continuousDemo: false, mode });
      try { assert.throws(() => finite.receiveInventory(human('org0'), { ...input, resource: 'r-org0-water' }), { code: 'INTERACTIVE_ONLY' }); }
      finally { finite.close(); }
    }
  } finally { w.close(); }
});

test('a confirmed warehouse receipt leaves cargo, trip identity and active reservations untouched', () => {
  const w = new World(config);
  try {
    const org = join(w, { resupply: { enabled: false } });
    w.demoConfigureDirector({ baseOperations: false, maxOpen: 1 }); w.advance(30000);
    const n = w.need('demo-need-1');
    const op = w.act(human(org.id), { type: 'dispatch', params: { need: n.id, resource: `r-${org.id}-water`,
      vehicle: `v-${org.id}-0`, quantity: 200 }, idempotencyKey: 'warehouse-live-trip' });
    const v = w.vehicle(`v-${org.id}-0`), r = w.resource(`r-${org.id}-water`);
    for (let i = 0; i < 1000 && !v.load; i++) w.step();
    assert.equal(v.load, 200);
    w.act(human(org.id), { type: 'commitment', params: { action: 'reserve', resource: r.id, quantity: 50 }, idempotencyKey: 'keep-other-cargo-reserved' });
    const vehicleBefore = structuredClone(v), operationBefore = structuredClone(w.state.operations.find(o => o.id === op.id));
    const stockBefore = r.quantity, reserved = r.reserved;
    w.receiveInventory(human(org.id), { resource: r.id, quantity: 100, receiptReference: 'DEPOT-MIDTRIP-01', idempotencyKey: 'warehouse-live-receipt' });
    assert.equal(r.quantity, stockBefore + 100); assert.equal(r.reserved, reserved);
    assert.deepEqual(v, vehicleBefore); assert.deepEqual(w.state.operations.find(o => o.id === op.id), operationBefore);
    assert.equal(n.served, 0, 'recording depot stock does not pretend cargo has reached its recipients');
    assert.equal(w.state.resources.every(checkResource), true);
  } finally { w.close(); }
});

test('a participant trip protects its committed shortfall while bases keep uncommitted work moving', () => {
  const w = new World(config);
  try {
    const org = join(w); w.demoConfigureDirector({ baseOperations: true, intervalMs: 60000, maxOpen: 3 });
    let n = w.need('demo-need-1');
    for (let at = 60000; at <= 1800000; at += 30000) { w.advance(at); n = w.need('demo-need-1'); if (n?.served === 100) break; }
    assert.equal(n.served, 100);
    const op = w.act(human(org.id), { type: 'dispatch', params: { need: n.id, resource: `r-${org.id}-water`,
      vehicle: `v-${org.id}-0`, quantity: 200 }, idempotencyKey: 'participant-committed-shortfall' });
    w.advance(w.now + 1800000);
    assert.equal(w.state.operations.find(o => o.id === op.id).received, 200);
    assert.equal(n.served, 300);
    assert.equal(w.state.operations.filter(o => o.need === n.id).reduce((sum, op) => sum + op.received, 0), 300,
      'base fallback subtracts actual in-flight commitments instead of duplicating the visitor load');
    assert.equal(w.state.resources.every(checkResource), true); assert.deepEqual(w.invariants(), []);
  } finally { w.close(); }
});

test('continuous waves are physical, distinct, bounded and replayable while the full-cap watchdog retains missed targets', () => {
  const w = new World(config); let restored;
  try {
    join(w); w.demoConfigureDirector({ baseOperations: true, intervalMs: 60000, maxOpen: 8 });
    w.advance(21600000);
    const waves = w.log.filter(e => e.type === 'demo_wave_created');
    assert.ok(waves.some(e => e.data.reason === 'resolved'));
    for (const event of waves) {
      const needs = event.data.needs.map(id => w.need(id));
      assert.equal(new Set(needs.map(n => n.building)).size, needs.length);
    }
    assert.ok(w.state.needs.filter(n => n.id.startsWith('demo-need-') && n.completedAt !== null).length >= 3);
    assert.ok(w.state.needs.filter(n => n.id.startsWith('demo-need-') && n.quantity > n.served).length <= 8);
    const snapshot = w.checkpoint(); restored = new World(snapshot.manifest.config, snapshot);
    w.advance(25200000); restored.advance(25200000); assert.equal(w.stateHash(), restored.stateHash());
    const quiet = new World({ ...config, seed: 'quiet-full-cap-demo' });
    try {
      quiet.demoConfigureDirector({ intervalMs: 60000, maxOpen: 1, baseOperations: false }); quiet.advance(0);
      const n = quiet.need('demo-need-1'), original = n.deadline;
      quiet.advance(18000000);
      assert.equal(quiet.state.needs.filter(n => n.id.startsWith('demo-need-')).length, 1);
      assert.equal(n.served, 0); assert.equal(n.quantity, 300); assert.equal(n.completedAt, null);
      assert.equal(n.originalDeadline, original); assert.ok(n.deadline > original); assert.equal(n.createdAt, 0);
      assert.equal(n.demandEpisodes.length, 1);
      assert.ok(quiet.log.some(e => e.type === 'demo_need_reconfirmed' && e.data.physicalService === false));
    } finally { quiet.close(); }
  } finally { w.close(); restored?.close(); }
});

test('a saved legacy full pool with no wave or resupply metadata resumes with current reports and preserves all unmet history', () => {
  const original = new World(config); let resumed;
  try {
    const sites = original.state.map.buildings.filter(b => b.use !== 'plant').slice(0, 8);
    for (let i = 0; i < 8; i++) original.addNeed({ id: `demo-need-${i + 1}`, building: sites[i].id,
      type: 'water', unit: 'L', quantity: 300, deadline: 3600000, population: 60 });
    original.advance(50400000);
    const checkpoint = original.checkpoint();
    checkpoint.state.demo = { schemaVersion: 1, nextOrganization: 1, maxActive: 4, maxLifetime: 2000,
      requests: {}, releases: {}, director: { enabled: true, generation: 1, tick: 200, intervalMs: 300000, maxOpen: 8, baseOperations: false } };
    resumed = new World(checkpoint.manifest.config, checkpoint);
    resumed.demoConfigureDirector({ enabled: true, intervalMs: 300000, maxOpen: 8, baseOperations: false });
    resumed.advance(51030000);
    const n = resumed.need('demo-need-1');
    assert.equal(resumed.runId, checkpoint.runId);
    assert.equal(resumed.state.needs.filter(n => n.id.startsWith('demo-need-')).length, 8);
    assert.equal(n.served, 0); assert.equal(n.createdAt, 0); assert.equal(n.originalDeadline, 3600000);
    assert.ok(n.deadline > resumed.now); assert.ok(n.reconfirmedAt >= 51000000);
    assert.ok(resumed.organization('org0').resupply.nextAt > checkpoint.now);
    assert.ok(resumed.log.some(e => e.type === 'demo_need_reconfirmed' && e.data.need === n.id));
    assert.deepEqual(resumed.invariants(), []);
  } finally { original.close(); resumed?.close(); }
});

for (const isolated of [false, true]) test(`HTTP human inventory receipts and supply settings preserve source scope (${isolated ? 'worker' : 'inline'})`, async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'aidscaler-inventory-http-'));
  const lab = await createLabServers({ config, isolated, observerPort: 0, sourcePort: 0, persistCredentials: false, storageDir: dir, projectionMs: 25 });
  t.after(async () => { await lab.close(); await rm(dir, { recursive: true, force: true }); });
  const admin = async (route, input) => {
    const response = await fetch(`http://127.0.0.1:${lab.observerPort}${route}`, { method: 'POST',
      headers: { Authorization: `Bearer ${lab.observerKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    const value = await response.json(); assert.ok(response.ok, JSON.stringify(value)); return value;
  };
  const made = await admin('/api/demo/organizations', { name: 'East Harbor Team', idempotencyKey: 'http-receipt-team', resupply: { enabled: false } });
  const org = made.organization.id;
  assert.equal(made.organization.resupply.enabled, false);
  const commander = await admin('/api/actors/provision', { org, role: 'commander' });
  const agent = await admin('/api/actors/provision', { org, role: 'agent' });
  const actorRequest = async (key, input, instance) => {
    const response = await fetch(`http://127.0.0.1:${lab.sourcePort}/api/actor/inventory/receipt`, { method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(instance ? { 'X-AidScaler-Source-Instance': instance } : {}) }, body: JSON.stringify(input) });
    return { status: response.status, data: await response.json() };
  };
  const input = { resource: `r-${org}-water`, quantity: 100, receiptReference: 'TRUCK-ARRIVAL-005', idempotencyKey: 'receipt-http-same-delivery' };
  assert.equal((await actorRequest(agent.key, input)).status, 403);
  const ack = await actorRequest(commander.key, input); assert.equal(ack.status, 200); assert.equal(ack.data.receipt.quantity, 100);
  assert.deepEqual((await actorRequest(commander.key, input)).data, ack.data);
  assert.equal((await actorRequest(commander.key, { ...input, quantity: 101 })).status, 409);
  assert.equal((await actorRequest(commander.key, input, 'stale-source-lifetime')).status, 409);
  const configured = await admin('/api/demo/organizations/resupply', { org, idempotencyKey: 'http-supply-setting', resupply: { enabled: true, intervalMs: 300000, water: 100, food: 10 } });
  assert.equal(configured.resupply.water, 100); assert.equal(configured.resupply.nextAt, 300000);
  if (isolated) await lab.advance(300000); else lab.world.advance(300000);
  const snapshot = isolated ? await lab.checkpoint() : lab.world.checkpoint();
  assert.equal(snapshot.state.resources.find(r => r.id === input.resource).quantity, 800);
  assert.equal(snapshot.state.resources.every(checkResource), true);
});
