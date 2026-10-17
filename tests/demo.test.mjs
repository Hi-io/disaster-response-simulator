import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { World } from '../engine/world.mjs';
import { checkResource } from '../engine/ledger.mjs';
import { createViewerBootstrap } from '../sources/projections.mjs';
import { demoFrame, demoMap } from '../sources/demo-projection.mjs';
import { createLabServers } from '../sources/server.mjs';
import { startDemoHost } from '../scripts/demo-host.mjs';

const config = { seed: 'demo-contract-test', topology: 'grid', grid: 5, extentKm: 3,
  scenario: 'S01', hazard: 'none', policy: 'none', organizations: 4, backgroundTraffic: 0,
  postsPerHour: 0, packetLoss: 0, logMode: 'full', healthReports: false, recurringNeeds: false,
  mode: 'interactive', continuousDemo: true, clockLatency: 'wall' };
const create = (w, name = 'Sakura Response', key = 'visitor-register-001') =>
  w.demoCreateOrganization({ name, color: '#4477aa', idempotencyKey: key });

test('demo extensions are inert and inaccessible in benchmark worlds', () => {
  const a = new World({ ...config, continuousDemo: false }), b = new World({ ...config, continuousDemo: false });
  try {
    assert.throws(() => create(a), { code: 'DEMO_ONLY' });
    assert.throws(() => a.demoConfigureDirector({}), { code: 'DEMO_ONLY' });
    a.advance(900000); b.advance(900000);
    assert.equal(a.stateHash(), b.stateHash()); assert.equal(a.state.demo, undefined);
    assert.equal(a.log.some(e => e.type.startsWith('demo_')), false);
    assert.equal(a.queue.toJSON().some(e => e.type.startsWith('demo_')), false);
  } finally { a.close(); b.close(); }
});

test('registration creates exclusive physical ownership, finite kit and persistent idempotency', () => {
  const w = new World(config);
  try {
    const result = create(w), id = result.organization.id;
    assert.equal(w.state.vehicles.filter(v => v.owner === id).length, 3);
    assert.equal(w.resource(`r-${id}-water`).quantity, 600);
    assert.equal(w.resource(`r-${id}-food`).quantity, 120);
    assert.equal(w.resource(`r-${id}-staff`).quantity, 6);
    assert.deepEqual(create(w), result);
    assert.equal(w.state.map.organizations.length, 5);
    assert.throws(() => create(w, 'Another name'), { code: 'IDEMPOTENCY_CONFLICT' });
    assert.equal(Object.keys(w.state.observations[id].needs).length, 0, 'registration never copies spectator truth');
    assert.equal(w.state.resources.every(checkResource), true);
    assert.deepEqual(w.invariants(), []);
    const checkpoint = w.checkpoint(), resumed = new World(checkpoint.manifest.config, checkpoint);
    try { assert.deepEqual(create(resumed), result); assert.equal(resumed.stateHash(), w.stateHash()); }
    finally { resumed.close(); }
  } finally { w.close(); }
});

test('quota, validation, draining and retirement preserve distinct identities and ownership history', () => {
  const w = new World(config);
  try {
    for (let i = 0; i < 4; i++) create(w, `Response Team ${i}`, `registration-key-${i}`);
    assert.throws(() => create(w, 'Fifth team', 'registration-key-5'), { code: 'DEMO_CAPACITY' });
    assert.throws(() => create(w, '<script>', 'registration-invalid'), { code: 'DEMO_NAME' });
    const org = 'demo-org-1', vehicle = w.vehicle(`v-${org}-0`);
    vehicle.state = 'en_route';
    assert.throws(() => w.demoReleaseOrganization({ org, idempotencyKey: 'release-request-1' }), { code: 'DEMO_DRAINING' });
    vehicle.state = 'idle';
    assert.deepEqual(w.demoReleaseOrganization({ org, idempotencyKey: 'release-request-1' }), { org, retired: true });
    assert.deepEqual(w.demoReleaseOrganization({ org, idempotencyKey: 'release-request-1' }), { org, retired: true });
    assert.equal(w.state.integrations.revokedOrgs.includes(org), true);
    assert.equal(w.organization(org).sharing, 'private');
    const next = create(w, 'New team', 'registration-key-5');
    assert.equal(next.organization.id, 'demo-org-5');
    assert.equal(w.resource(`r-${org}-water`).owner, org, 'retirement does not transfer the previous visitor kit');
    assert.equal(w.state.map.organizations.length, 9);
  } finally { w.close(); }
});

test('director publishes real needs over delayed source channels and visitor dispatch physically reduces demand', () => {
  const w = new World(config);
  try {
    w.demoConfigureDirector({ enabled: true, intervalMs: 300000, maxOpen: 2 }); w.advance(0);
    const { organization: { id } } = create(w);
    assert.equal(Object.keys(w.state.observations[id].needs).length, 0);
    w.advance(30000);
    const need = w.state.needs.find(n => n.id.startsWith('demo-need-'));
    assert.equal(w.state.observations[id].needs[need.id].quantity, 300);
    assert.ok(w.publicFeed({ limit: 100 }).posts.some(p => p.text.includes('300 L of water')));
    const op = w.act({ id: 'visitor-human', org: id, role: 'commander' }, {
      type: 'dispatch', params: { need: need.id, resource: `r-${id}-water`, vehicle: `v-${id}-0`, quantity: 300 },
      idempotencyKey: 'visitor-real-dispatch' });
    assert.throws(() => w.demoReleaseOrganization({ org: id, idempotencyKey: 'release-active-visitor' }), { code: 'DEMO_DRAINING' });
    assert.equal(need.served, 0, 'authorization alone cannot count as aid received');
    w.advance(1800000);
    assert.equal(w.state.operations.find(o => o.id === op.id).state, 'completed');
    assert.equal(need.served, 300); assert.equal(w.resource(`r-${id}-water`).quantity, 300);
    assert.equal(w.state.resources.every(checkResource), true); assert.deepEqual(w.invariants(), []);
  } finally { w.close(); }
});

test('continuous supply is an explicit balanced intervention; incident schedule and idempotency survive restore', () => {
  const w = new World(config);
  try {
    const id = create(w).organization.id, r = w.resource(`r-${id}-water`);
    r.quantity -= 300; r.consumed += 300;
    w.demoConfigureDirector({ enabled: true, intervalMs: 3600000, maxOpen: 2 });
    w.advance(21600000);
    assert.equal(r.quantity, 600); assert.equal(r.produced, 300); assert.equal(checkResource(r), true);
    assert.ok(w.log.some(e => e.type === 'demo_supply_replenished' && e.data.demoOnly));
    const checkpoint = w.checkpoint(), resumed = new World(checkpoint.manifest.config, checkpoint);
    try { assert.equal(resumed.state.demo.director.enabled, true); assert.equal(resumed.stateHash(), w.stateHash()); }
    finally { resumed.close(); }
  } finally { w.close(); }
});

test('scripted base teams use owned native dispatch and leave meaningful demand for visitors', () => {
  const w = new World(config);
  try {
    w.demoConfigureDirector({ baseOperations: true, intervalMs: 300000, maxOpen: 2 });
    w.advance(1200000);
    const base = w.state.operations.filter(op => op.demoBaseContribution);
    assert.ok(base.length > 0); assert.equal(base.every(op => op.quantity <= 100), true);
    const first = w.need('demo-need-1'); assert.equal(first.served, 100); assert.equal(first.quantity - first.served, 200);
    assert.equal(base.some(op => op.need === first.id && op.state === 'completed'), true);
    assert.ok(w.log.some(e => e.type === 'demo_base_response_authorized' && e.data.modelInference === false));
    assert.ok(w.log.some(e => e.type === 'demo_continuous_driver_roster' && e.data.demoOnly));
    assert.equal(w.state.resources.every(checkResource), true); assert.deepEqual(w.invariants(), []);
  } finally { w.close(); }
});

test('spectator projection is an allowlist without private state, finance, actor observations or future sources', () => {
  const w = new World(config);
  try {
    create(w); w.demoConfigureDirector({}); w.advance(30000);
    const value = createViewerBootstrap(w, { runtime: { playing: true, rate: 10 } });
    const frame = demoFrame(value.frame, { sourceInstance: 'episode-test', feed: w.publicFeed({ limit: 12 }) });
    const encoded = JSON.stringify({ map: demoMap(value.map), frame });
    for (const field of ['private', 'truthCategory', 'causeEvent', 'observations', 'resources', 'funds', 'modelRequests', 'sourceUrl', 'manifest', 'initialPopulation'])
      assert.equal(encoded.includes(`"${field}"`), false, field);
    assert.equal(frame.spectatorOnly, true); assert.equal(frame.episodeId, 'episode-test');
    assert.equal(frame.organizations.find(o => o.demoVisitor).name, 'Sakura Response');
    assert.ok(frame.vehicles.length > 0); assert.ok(frame.needs.length > 0);
  } finally { w.close(); }
});

for (const isolated of [false, true]) test(`private HTTP demo endpoints preserve auth and actor isolation (${isolated ? 'worker' : 'inline'})`, async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'aidscaler-demo-http-'));
  const lab = await createLabServers({ config, isolated, observerPort: 0, sourcePort: 0,
    storageDir: dir, persistCredentials: false, projectionMs: 30 });
  t.after(async () => { await lab.close(); await rm(dir, { recursive: true, force: true }); });
  const observer = `http://127.0.0.1:${lab.observerPort}`, source = `http://127.0.0.1:${lab.sourcePort}`;
  for (const route of ['/api/demo/bootstrap', '/api/demo/frame', '/api/demo/organizations']) {
    assert.equal((await fetch(observer + route)).status, 401);
    assert.equal((await fetch(source + route)).status, 404);
  }
  const request = async (route, input) => {
    const r = await fetch(observer + route, { method: input ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${lab.observerKey}`, 'Content-Type': 'application/json' },
      ...(input ? { body: JSON.stringify(input) } : {}) });
    const value = await r.json(); assert.ok(r.ok, JSON.stringify(value)); return value;
  };
  const made = await request('/api/demo/organizations', { name: 'Harbor Volunteers', color: '#336688', idempotencyKey: 'http-registration-001' });
  const actor = await request('/api/actors/provision', { org: made.organization.id, role: 'agent' });
  const received = await (await fetch(source + '/api/actor/state?compact=1', { headers: { Authorization: `Bearer ${actor.key}` } })).json();
  assert.equal(received.organization.id, made.organization.id);
  assert.equal(Object.values(received.known.resources).every(r => r.owner === made.organization.id), true);
  let value;
  for (let i = 0; i < 100; i++) {
    value = await request('/api/demo/bootstrap');
    if (value.frame.organizations.some(o => o.id === made.organization.id)) break;
    await delay(25);
  }
  assert.ok(value.frame.organizations.some(o => o.id === made.organization.id));
  await request('/api/demo/organizations/release', { org: made.organization.id, idempotencyKey: 'http-release-001' });
  assert.equal((await fetch(source + '/api/actor/state', { headers: { Authorization: `Bearer ${actor.key}` } })).status, 403);
});

test('persistent demo host resumes world, clock, credentials, identity and live director', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'aidscaler-demo-host-'));
  const previousArchives = process.env.AIDSCALER_ARCHIVE_DIR;
  let host;
  t.after(async () => { await host?.close(); if (previousArchives === undefined) delete process.env.AIDSCALER_ARCHIVE_DIR;
    else process.env.AIDSCALER_ARCHIVE_DIR = previousArchives; await rm(dir, { recursive: true, force: true }); });
  host = await startDemoHost({ dataDir: dir, observerPort: 0, sourcePort: 0, config, autostart: false });
  const identity = host.credentials.sourceInstance, key = host.credentials.observerKey;
  const made = await host.lab.runtime.request('demoCreateOrganization', { name: 'Island Support', idempotencyKey: 'persistent-registration' });
  await host.lab.advance(60000); await host.close();
  host = await startDemoHost({ dataDir: dir, observerPort: 0, sourcePort: 0, autostart: false });
  assert.equal(host.credentials.sourceInstance, identity); assert.equal(host.credentials.observerKey, key);
  assert.equal(host.lab.runtime.meta.now, 60000);
  const same = await host.lab.runtime.request('demoCreateOrganization', { name: 'Island Support', idempotencyKey: 'persistent-registration' });
  assert.deepEqual(same, made);
  assert.equal(host.lab.runtime.meta.demo.director.enabled, true);
});

test('demo host refuses implicit code migration and explicit compatible upgrade preserves physical checkpoint identity', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'aidscaler-demo-upgrade-'));
  const previousArchives = process.env.AIDSCALER_ARCHIVE_DIR;
  let host;
  t.after(async () => { await host?.close(); if (previousArchives === undefined) delete process.env.AIDSCALER_ARCHIVE_DIR;
    else process.env.AIDSCALER_ARCHIVE_DIR = previousArchives; await rm(dir, { recursive: true, force: true }); });
  host = await startDemoHost({ dataDir: dir, observerPort: 0, sourcePort: 0, config, autostart: false });
  await host.lab.advance(90000); await host.close(); host = null;
  const file = path.join(dir, 'checkpoint.json'), checkpoint = JSON.parse(await readFile(file, 'utf8'));
  const source = JSON.parse(await readFile(path.join(dir, 'source.json'), 'utf8'));
  checkpoint.manifest.engineBuild = 'a-previous-compatible-demo-build';
  await writeFile(file, JSON.stringify(checkpoint));
  await assert.rejects(startDemoHost({ dataDir: dir, observerPort: 0, sourcePort: 0, autostart: false }), /Explicit allowDemoBuildUpgrade/);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).manifest.engineBuild, 'a-previous-compatible-demo-build');
  host = await startDemoHost({ dataDir: dir, observerPort: 0, sourcePort: 0, autostart: false, allowDemoBuildUpgrade: true });
  const restored = await host.lab.checkpoint();
  assert.equal(restored.runId, checkpoint.runId); assert.equal(restored.now, checkpoint.now);
  assert.deepEqual(restored.state, checkpoint.state); assert.deepEqual(restored.queue, checkpoint.queue);
  assert.deepEqual(restored.log, checkpoint.log); assert.deepEqual(restored.inputs, checkpoint.inputs);
  assert.equal(host.credentials.sourceInstance, source.sourceInstance);
  const upgrades = JSON.parse(await readFile(path.join(dir, 'build-upgrades.json'), 'utf8'));
  assert.equal(upgrades.length, 1); assert.equal(upgrades[0].benchmarkEligible, false);
});

test('explicit operational demonstration migration changes only the approved configuration allowlist', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'aidscaler-demo-operational-upgrade-'));
  const previousArchives = process.env.AIDSCALER_ARCHIVE_DIR;
  let host;
  t.after(async () => { await host?.close(); if (previousArchives === undefined) delete process.env.AIDSCALER_ARCHIVE_DIR;
    else process.env.AIDSCALER_ARCHIVE_DIR = previousArchives; await rm(dir, { recursive: true, force: true }); });
  host = await startDemoHost({ dataDir: dir, observerPort: 0, sourcePort: 0,
    config: { ...config, recurringNeeds: true, healthReports: true, waterFatalityBpPerHour: 150 }, autostart: false });
  await host.lab.advance(90000); await host.close(); host = null;
  const checkpoint = JSON.parse(await readFile(path.join(dir, 'checkpoint.json'), 'utf8'));
  host = await startDemoHost({ dataDir: dir, observerPort: 0, sourcePort: 0, autostart: false, allowOperationalDemoUpgrade: true });
  const restored = await host.lab.checkpoint();
  assert.equal(restored.runId, checkpoint.runId); assert.equal(restored.now, checkpoint.now);
  assert.deepEqual(restored.state, checkpoint.state); assert.deepEqual(restored.queue, checkpoint.queue);
  assert.equal(restored.manifest.config.recurringNeeds, false); assert.equal(restored.manifest.config.healthReports, false);
  assert.equal(restored.manifest.config.waterFatalityBpPerHour, 0); assert.equal(restored.manifest.config.vehicleFuelMl, checkpoint.manifest.config.vehicleFuelMl);
  const upgrades = JSON.parse(await readFile(path.join(dir, 'operational-upgrades.json'), 'utf8'));
  assert.equal(upgrades.length, 1); assert.equal(upgrades[0].benchmarkEligible, false);
});
