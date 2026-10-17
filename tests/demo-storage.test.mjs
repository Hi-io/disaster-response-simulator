import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { World } from '../engine/world.mjs';
import { createLocalEventBus } from '../sources/local-event-bus.mjs';
import { capturePreviousDemoArchives, cleanPreviousDemoArchives, compactDemoAudit } from '../scripts/demo-storage.mjs';
import { startDemoHost } from '../scripts/demo-host.mjs';

const config = { seed: 'demo-retention-physical', topology: 'grid', grid: 5, extentKm: 3,
  scenario: 'S01', hazard: 'none', policy: 'none', organizations: 4, backgroundTraffic: 0,
  postsPerHour: 0, packetLoss: 0, logMode: 'full', healthReports: false, recurringNeeds: false,
  mode: 'interactive', continuousDemo: true, clockLatency: 'wall' };

test('archive cleanup removes only pre-start exact obsolete directories and preserves new active files and retained checkpoints', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aidscaler-demo-gc-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = async (dir, filename = 'records.sqlite') => {
    const folder = path.join(root, dir); await mkdir(folder); const value = path.join(folder, filename);
    await writeFile(value, 'preserved history'); return value;
  };
  const obsolete = await file('messages-ABC123'), retained = await file('snapshot-DEF456');
  const unrelated = await file('private-records'), unknown = await file('events-GHI789', 'other-data');
  const candidates = await capturePreviousDemoArchives(root);
  const active = await file('messages-NEW123'), newCheckpoint = await file('snapshot-NEW456');
  assert.equal(candidates.length, 2);
  const result = await cleanPreviousDemoArchives(root, candidates, [retained, newCheckpoint]);
  assert.equal(result.deleted, 1); assert.ok(result.bytes > 0);
  await assert.rejects(readFile(obsolete), { code: 'ENOENT' });
  for (const path of [retained, unrelated, unknown, active, newCheckpoint])
    assert.equal(await readFile(path, 'utf8'), 'preserved history');
});

test('checkpoint audit compaction retains physical history, future events, replay floors, dedupe and other consumers', async t => {
  const world = new World(config), bus = await createLocalEventBus({ databasePath: ':memory:' });
  t.after(async () => { world.close(); await bus.close(); });
  const checkpoint = world.checkpoint(); world.advance(60000);
  const full = world.checkpoint(), before = world.stateHash(), epoch = 'fixed-demo-epoch';
  const events = full.log.map((event, offset) => ({ eventId: `${epoch}:${world.runId}:generation:0:event:${offset}`,
    runId: world.runId, orderingKey: world.runId, audience: 'audit', type: 'simulation.event', simTimeMs: event.at,
    payload: { offset, event } }));
  await bus.publish(events); await bus.subscribe({ subscriptionId: 'independent-auditor', audience: 'audit' });
  const producer = { epoch, generation: 0, runId: world.runId, eventCursor: full.log.length };
  const protectedResult = await compactDemoAudit({ bus, checkpoint, producer });
  assert.equal(protectedResult.acknowledged, checkpoint.log.length); assert.equal(protectedResult.pruned, 0);
  const other = await bus.pull({ subscriptionId: 'independent-auditor' });
  await bus.ack({ subscriptionId: 'independent-auditor', deliveryIds: other.messages.slice(0, checkpoint.log.length).map(m => m.deliveryId) });
  if (other.messages.length > checkpoint.log.length)
    await bus.nack({ subscriptionId: 'independent-auditor', deliveryIds: other.messages.slice(checkpoint.log.length).map(m => m.deliveryId) });
  const compacted = await compactDemoAudit({ bus, checkpoint, producer });
  assert.equal(compacted.pruned, checkpoint.log.length);
  assert.equal((await bus.stats()).retained, full.log.length - checkpoint.log.length);
  assert.equal((await bus.publish(events[0])).duplicate, true, 'old retries still deduplicate after payload compaction');
  await assert.rejects(bus.replay({ subscriptionId: 'demo-durable-checkpoint-v1', afterSequence: 0 }), { code: 'RETENTION_GAP' });
  assert.deepEqual(world.checkpoint().log, full.log); assert.equal(world.stateHash(), before);
});

test('mismatched checkpoint audit payload is never acknowledged or pruned', async t => {
  const w = new World(config), bus = await createLocalEventBus({ databasePath: ':memory:' });
  t.after(async () => { w.close(); await bus.close(); });
  const checkpoint = w.checkpoint(), epoch = 'demo-invalid-proof';
  await bus.publish({ eventId: `${epoch}:${w.runId}:generation:0:event:0`, runId: w.runId,
    orderingKey: w.runId, audience: 'audit', type: 'simulation.event', simTimeMs: 0,
    payload: { offset: 0, event: { ...checkpoint.log[0], type: 'not-the-physical-event' } } });
  await assert.rejects(compactDemoAudit({ bus, checkpoint, producer: { epoch, generation: 0, runId: w.runId, eventCursor: 1 } }), /differs from the durable physical checkpoint/);
  const stats = await bus.stats(); assert.equal(stats.retained, 1);
  assert.equal(stats.subscriptions.find(s => s.subscriptionId === 'demo-durable-checkpoint-v1').cursor, 0);
  await assert.rejects(compactDemoAudit({ bus, checkpoint: { ...checkpoint, manifest: { config: { continuousDemo: false } } }, producer: {} }), /restricted/);
});

test('historical producer epochs compact only exact same-world checkpoint rows and protect other worlds and future events', async t => {
  const w = new World(config), bus = await createLocalEventBus({ databasePath: ':memory:' });
  t.after(async () => { w.close(); await bus.close(); });
  const checkpoint = w.checkpoint(); w.advance(60000); const later = w.checkpoint();
  const event = (epoch, runId, offset, record) => ({ eventId: `${epoch}:${runId}:generation:7:event:${offset}`,
    runId, orderingKey: runId, audience: 'audit', type: 'simulation.event', simTimeMs: record.at,
    payload: { offset, event: record } });
  const old = event('previous-producer-epoch', w.runId, 0, checkpoint.log[0]);
  const other = event('previous-producer-epoch', 'another-world', 0, checkpoint.log[0]);
  await bus.publish([old, other, event('current-producer-epoch', w.runId, checkpoint.log.length, later.log[checkpoint.log.length])]);
  const result = await compactDemoAudit({ bus, checkpoint,
    producer: { epoch: 'current-producer-epoch', generation: 99, runId: w.runId, eventCursor: checkpoint.log.length } });
  assert.equal(result.acknowledged, 1); assert.equal(result.pruned, 1);
  assert.equal((await bus.stats()).retained, 2); assert.equal((await bus.publish(old)).duplicate, true);
  const next = await bus.pull({ subscriptionId: 'demo-durable-checkpoint-v1' });
  assert.equal(next.messages[0].envelope.runId, 'another-world');
  assert.ok(next.messages.some(m => m.envelope.payload.offset >= checkpoint.log.length));
});

test('unverifiable audit maintenance does not block durable checkpoints, startup or physical world progress', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'aidscaler-demo-audit-warning-'));
  const previousArchives = process.env.AIDSCALER_ARCHIVE_DIR;
  let host;
  t.after(async () => { await host?.close(); if (previousArchives === undefined) delete process.env.AIDSCALER_ARCHIVE_DIR;
    else process.env.AIDSCALER_ARCHIVE_DIR = previousArchives; await rm(dir, { recursive: true, force: true }); });
  host = await startDemoHost({ dataDir: dir, observerPort: 0, sourcePort: 0, config, autostart: false });
  const before = await host.lab.checkpoint(), physical = new World(before.manifest.config, before);
  const expected = physical.stateHash(); physical.close();
  const invalid = { eventId: `old-legacy-epoch:${before.runId}:generation:3:event:0`, runId: before.runId,
    orderingKey: before.runId, audience: 'audit', type: 'simulation.event', simTimeMs: 0,
    payload: { offset: 0, event: { ...before.log[0], type: 'private-unverified-legacy-record' } } };
  await host.lab.runtime.bus.publish(invalid);
  await host.persist();
  assert.equal(host.persistenceError, null);
  let maintenance = JSON.parse(await readFile(path.join(dir, 'storage-maintenance.json'), 'utf8'));
  assert.equal(maintenance.audit.warning, 'AUDIT_COMPACTION_DEFERRED');
  assert.equal(maintenance.audit.deferred, true);
  assert.equal(JSON.stringify(maintenance).includes('private-unverified-legacy-record'), false);
  assert.equal((await host.lab.runtime.bus.publish(invalid)).duplicate, true);
  await host.close(); host = null;
  // The same unverified retained row is encountered again during startup.
  host = await startDemoHost({ dataDir: dir, observerPort: 0, sourcePort: 0, autostart: false });
  assert.equal(host.persistenceError, null);
  maintenance = JSON.parse(await readFile(path.join(dir, 'storage-maintenance.json'), 'utf8'));
  assert.equal(maintenance.audit.warning, 'AUDIT_COMPACTION_DEFERRED');
  const restored = await host.lab.checkpoint(), checked = new World(restored.manifest.config, restored);
  try { assert.equal(checked.stateHash(), expected); } finally { checked.close(); }
  assert.deepEqual(restored.log, before.log);
  const retained = await host.lab.runtime.bus.pull({ subscriptionId: 'demo-durable-checkpoint-v1' });
  assert.equal(retained.messages[0].envelope.eventId, invalid.eventId);
  await host.lab.runtime.bus.nack({ subscriptionId: 'demo-durable-checkpoint-v1',
    deliveryIds: retained.messages.map(m => m.deliveryId) });
  await host.lab.advance(60000); await host.persist();
  assert.equal(host.persistenceError, null);
  assert.equal((await host.lab.runtime.request('viewerFrame', { org: 'org0', perspective: 'truth' })).now, 60000);
  assert.equal(JSON.parse(await readFile(path.join(dir, 'checkpoint.json'), 'utf8')).now, 60000);
  assert.equal((await host.lab.runtime.bus.publish(invalid)).duplicate, true);
});

test('compact archive host resumes identical physical state and source identity while removing previous working copies', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'aidscaler-demo-storage-host-'));
  const previousArchives = process.env.AIDSCALER_ARCHIVE_DIR;
  let host;
  t.after(async () => { await host?.close(); if (previousArchives === undefined) delete process.env.AIDSCALER_ARCHIVE_DIR;
    else process.env.AIDSCALER_ARCHIVE_DIR = previousArchives; await rm(dir, { recursive: true, force: true }); });
  host = await startDemoHost({ dataDir: dir, observerPort: 0, sourcePort: 0, config: { ...config, logMode: 'compact' }, autostart: false });
  await host.lab.advance(60000); await host.close(); host = null;
  const checkpoint = JSON.parse(await readFile(path.join(dir, 'checkpoint.json'), 'utf8'));
  const identity = JSON.parse(await readFile(path.join(dir, 'source.json'), 'utf8')).sourceInstance;
  const previous = await capturePreviousDemoArchives(path.join(dir, 'archives'));
  const baseline = new World(checkpoint.manifest.config, checkpoint), expected = baseline.stateHash(); baseline.close();
  host = await startDemoHost({ dataDir: dir, observerPort: 0, sourcePort: 0, autostart: false });
  const restored = await host.lab.checkpoint(), checked = new World(restored.manifest.config, restored);
  try { assert.equal(checked.stateHash(), expected); } finally { checked.close(); }
  assert.equal(host.credentials.sourceInstance, identity); assert.equal(host.lab.runtime.meta.now, 60000);
  const maintenance = JSON.parse(await readFile(path.join(dir, 'storage-maintenance.json'), 'utf8'));
  assert.ok(maintenance.oldArchives.deleted >= previous.length);
  assert.equal(maintenance.audit.physicalHistoryPreserved, true);
  assert.equal(maintenance.audit.deduplicationTombstonesPreserved, true);
  assert.equal(maintenance.presentationIntervalMs, 1500);
  const frame = await host.lab.runtime.frame(); assert.equal(frame.now, 60000);
  assert.ok(frame.state.vehicles.length > 0);
  await host.resume();
  const deadline = Date.now() + 5000;
  let next = frame;
  while (Date.now() < deadline && next.now <= frame.now) { await delay(50); next = await host.lab.runtime.frame(); }
  assert.ok(next.now > frame.now, 'the reduced presentation cadence still publishes actual advancing world frames');
  await host.pause();
  // A source checkpoint remains physically complete after queue duplication is removed.
  assert.ok((await readdir(path.join(dir, 'archives'))).some(name => name.startsWith('snapshot-')));
});
