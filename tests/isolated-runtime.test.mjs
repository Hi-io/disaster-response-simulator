import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { spawnSync } from 'node:child_process';
import { createIsolatedRuntime } from '../sources/isolated-runtime.mjs';
import { createLocalEventBus } from '../sources/local-event-bus.mjs';
import { createQueuedDocuments } from '../sources/queued-documents.mjs';

const config = {
  seed: 'runtime-materializer',
  topology: 'grid',
  grid: 5,
  extentKm: 3,
  scenario: 'S23',
  hazard: 'earthquake',
  policy: 'none',
  backgroundTraffic: 4,
  postsPerHour: 180,
  packetLoss: 0,
  healthReports: false,
  recurringNeeds: false,
  logMode: 'full',
};
const actor = { id: 'runtime-reader', org: 'org0', role: 'agent' };
async function until(fn, label = 'condition', timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await delay(10);
  }
  throw Error(`Timed out waiting for ${label}`);
}
async function fixture(t, options = {}) {
  const storageDir = await mkdtemp(path.join(os.tmpdir(), 'aidscaler-isolated-'));
  let runtime = await createIsolatedRuntime({
    config,
    storageDir,
    tickMs: 15,
    projectionMs: 30,
    ...options,
  });
  t.after(async () => {
    try {
      await runtime.close();
    } finally {
      await rm(storageDir, { recursive: true, force: true });
    }
  });
  return {
    storageDir,
    get runtime() {
      return runtime;
    },
    async restart(checkpoint) {
      await runtime.close();
      runtime = await createIsolatedRuntime({
        config,
        storageDir,
        checkpoint,
        tickMs: 15,
        projectionMs: 30,
        ...options,
      });
      return runtime;
    },
  };
}
async function audit(bus, id = 'audit-test') {
  await bus.subscribe({ subscriptionId: id, audience: 'audit' });
  const events = [];
  for (;;) {
    const batch = await bus.pull({ subscriptionId: id, limit: 100 });
    if (!batch.messages.length) break;
    events.push(...batch.messages.map((item) => item.envelope.payload.event));
    await bus.ack({
      subscriptionId: id,
      deliveryIds: batch.messages.map((item) => item.deliveryId),
    });
  }
  return events;
}

test('isolated runtime materializes real queue documents and preserves actor/query results', async (t) => {
  const { runtime } = await fixture(t);
  assert.ok((await runtime.observer()).state.map.buildings.length);
  assert.equal((await runtime.actor('org0')).organization.id, 'org0');
  await runtime.request('actorAction', actor, {
    type: 'query',
    params: { target: 'map' },
    idempotencyKey: 'runtime-map',
  });
  await runtime.request('advance', 50000);
  await until(
    async () => (await runtime.actor('org0')).queries.some((query) => query.resultRef),
    'materialized map query',
  );
  const compact = await runtime.actor('org0'),
    reference = compact.queries.find((query) => query.resultRef).resultRef;
  const result = await runtime.queryResult('org0', reference.id, reference.version);
  assert.ok(result.result.nodes.length);
  assert.deepEqual(await runtime.legacyActor('org0'), await runtime.request('actorState', 'org0'));
  await assert.rejects(runtime.queryResult('org1', reference.id, reference.version), {
    code: 'NOT_FOUND',
  });
  await assert.rejects(runtime.queryResult('org0', reference.id, 'old'), {
    code: 'VERSION_CONFLICT',
  });
  await runtime.flush();
  assert.deepEqual(await audit(runtime.bus), (await runtime.request('checkpoint')).log);
  for (const value of [
    runtime.feed,
    runtime.timeline,
    await runtime.activity(),
    await runtime.frame(),
  ])
    assert.equal(
      Object.hasOwn(value, 'transport'),
      false,
      'delivery metadata is never exposed through cached API shapes',
    );
  const evaluation = runtime.evaluate();
  assert.equal(
    runtime.evaluate(),
    evaluation,
    'concurrent evaluations share one captured snapshot and worker',
  );
  assert.deepEqual(await evaluation, await runtime.request('metrics'));
});

test('isolated runtime rematerializes bootstrap/results and resumes audit cursors after restart', async (t) => {
  const f = await fixture(t);
  await f.runtime.request('actorAction', actor, {
    type: 'query',
    params: { target: 'map' },
    idempotencyKey: 'restart-map',
  });
  await f.runtime.request('advance', 60000);
  await f.runtime.flush();
  const checkpoint = await f.runtime.request('checkpoint');
  const before = await audit(f.runtime.bus, 'restart-audit');
  assert.deepEqual(before, checkpoint.log);
  await f.restart(checkpoint);
  assert.ok(
    (await f.runtime.observer()).state.map.buildings.length,
    'ACKed map must be rebuilt into a fresh materializer',
  );
  assert.deepEqual(
    await f.runtime.legacyActor('org0'),
    await f.runtime.request('actorState', 'org0'),
  );
  assert.deepEqual(
    await audit(f.runtime.bus, 'restart-audit'),
    [],
    'resuming a durable audit cursor does not duplicate old records',
  );
  await f.runtime.request('advance', 120000);
  await f.runtime.flush();
  const after = await f.runtime.request('checkpoint');
  assert.deepEqual([...before, ...(await audit(f.runtime.bus, 'restart-audit'))], after.log);
});

test('isolated runtime reset of the same seed cannot collide with earlier event/projection IDs', async (t) => {
  const { runtime } = await fixture(t);
  await runtime.request('advance', 60000);
  await runtime.flush();
  const first = await runtime.request('checkpoint');
  await runtime.request('reset', config);
  await runtime.refresh();
  await runtime.request('advance', 60000);
  await runtime.flush();
  await until(
    async () => (await runtime.frame())?.now === 60000 && runtime.meta.generation === 1,
    'new-generation frame',
  );
  assert.equal(runtime.error, undefined);
  const second = await runtime.request('checkpoint');
  assert.deepEqual(second.state, first.state);
  assert.deepEqual(second.log, first.log);
  assert.equal((await audit(runtime.bus)).length, first.log.length + second.log.length);
});

test('isolated runtime slow document consumers and a blocked HTTP thread do not stop engine ticks', async (t) => {
  const storageDir = await mkdtemp(path.join(os.tmpdir(), 'aidscaler-slow-'));
  const bus = await createLocalEventBus({ storageDir: path.join(storageDir, 'queue') });
  const base = await createQueuedDocuments({ bus, storageDir: path.join(storageDir, 'documents') });
  let slow = false;
  const documents = {
    ...base,
    async publish(value) {
      if (slow) await delay(35);
      return base.publish(value);
    },
  };
  const runtime = await createIsolatedRuntime({
    config,
    storageDir,
    bus,
    documents,
    tickMs: 15,
    projectionMs: 30,
  });
  t.after(async () => {
    await runtime.close();
    await bus.close();
    await rm(storageDir, { recursive: true, force: true });
  });
  slow = true;
  await runtime.request('control', { play: true, rate: 1000 });
  await delay(200);
  const before = await runtime.refresh();
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 180);
  await runtime.request('control', { play: false });
  const after = await runtime.refresh();
  assert.ok(
    after.now > before.now + 50000,
    `world advanced from ${before.now} to ${after.now} while consumer was blocked`,
  );
  assert.ok(after.performance.tickCount > 10);
  assert.ok(
    after.performance.tickIntervalMs.p95 < 150,
    `tick p95 ${after.performance.tickIntervalMs.p95} ms`,
  );
  slow = false;
  await runtime.flush();
  assert.deepEqual(await audit(bus), (await runtime.request('checkpoint')).log);
});

test('isolated runtime bounds presentation blobs while retaining every physical audit event', async (t) => {
  const storageDir = await mkdtemp(path.join(os.tmpdir(), 'aidscaler-retention-'));
  const bus = await createLocalEventBus({ storageDir: path.join(storageDir, 'queue') });
  const documents = await createQueuedDocuments({
    bus,
    storageDir: path.join(storageDir, 'documents'),
    maxInlineBytes: 0,
  });
  const runtime = await createIsolatedRuntime({
    config,
    storageDir,
    bus,
    documents,
    tickMs: 15,
    projectionMs: 25,
    viewRetentionMessages: 8,
    pruneEveryProjections: 1,
  });
  t.after(async () => {
    await runtime.close();
    await bus.close();
    await rm(storageDir, { recursive: true, force: true });
  });
  for (let i = 1; i <= 7; i++) {
    await runtime.request('advance', i * 30000);
    await until(async () => (await runtime.frame())?.now >= i * 30000, 'new retained frame');
  }
  await runtime.flush();
  const audiences = ['observer', 'org:org0', 'org:org1', 'org:org2', 'org:org3'];
  const refs = await bus.retainedDocumentRefs({ audiences });
  const files = (await readdir(path.join(storageDir, 'documents'))).filter((name) =>
    name.endsWith('.json'),
  );
  assert.ok(refs.length <= 8, `retained references: ${refs.length}`);
  assert.deepEqual(new Set(files.map((name) => name.slice(0, -5))), new Set(refs));
  assert.ok(
    (await runtime.observer()).state.map.buildings.length,
    'cached map remains available after old blob GC',
  );
  assert.deepEqual(await audit(bus), (await runtime.request('checkpoint')).log);
});

test('isolated runtime preserves checkpoint/control maintenance after a transport failure and closes idempotently', async (t) => {
  const storageDir = await mkdtemp(path.join(os.tmpdir(), 'aidscaler-failed-'));
  const bus = await createLocalEventBus({ storageDir: path.join(storageDir, 'queue') });
  const base = await createQueuedDocuments({ bus, storageDir: path.join(storageDir, 'documents') });
  let broken = false;
  const documents = {
    ...base,
    async publish(value) {
      if (broken) throw Error('Injected disk failure');
      return base.publish(value);
    },
  };
  const runtime = await createIsolatedRuntime({
    config,
    storageDir,
    bus,
    documents,
    tickMs: 15,
    projectionMs: 25,
  });
  t.after(async () => {
    await runtime.close();
    await bus.close();
    await rm(storageDir, { recursive: true, force: true });
  });
  await runtime.request('advance', 30000);
  broken = true;
  await until(() => runtime.error, 'reported transport failure');
  assert.match(runtime.error.message, /Injected disk failure/);
  assert.equal((await runtime.request('checkpoint')).now, 30000);
  await runtime.request('control', { play: false });
  const first = runtime.close(),
    second = runtime.close();
  assert.equal(first, second);
  await first;
  assert.ok((await bus.stats()).published > 0, 'caller-owned bus is not closed by runtime');
});

test('isolated runtime startup failures clean up worker handles instead of keeping a process alive', () => {
  const script = `
    import {createIsolatedRuntime} from ${JSON.stringify(new URL('../sources/isolated-runtime.mjs', import.meta.url).href)};
    try {await createIsolatedRuntime({config:${JSON.stringify(config)},documents:{async publish(){throw Error('startup disk failure')},async resolve(){}}});process.exitCode=2;}
    catch(error){if(!error.message.includes('startup disk failure'))throw error;}
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(child.status, 0, child.stderr || String(child.error));
});

test('isolated runtime drains an old unacknowledged sparse patch without applying it to an empty cache', async (t) => {
  const storageDir = await mkdtemp(path.join(os.tmpdir(), 'aidscaler-old-patch-'));
  const bus = await createLocalEventBus({ storageDir: path.join(storageDir, 'queue') });
  const documents = await createQueuedDocuments({
    bus,
    storageDir: path.join(storageDir, 'documents'),
  });
  await bus.subscribe({ subscriptionId: 'materializer-v1:org:org0', audience: 'org:org0' });
  await documents.publish({
    eventId: 'old-process-patch',
    runId: 'oldrun',
    orderingKey: 'oldrun:org0',
    audience: 'org:org0',
    type: 'actor.patch',
    simTimeMs: 0,
    payload: {
      org: 'org0',
      transport: { publicationId: 'old-process', generation: 0 },
      patch: { header: { now: 999 }, known: {}, removed: {}, removedKinds: [] },
    },
  });
  // Persist a lease as if the process died before acknowledgment.
  await bus.pull({ subscriptionId: 'materializer-v1:org:org0' });
  const runtime = await createIsolatedRuntime({
    config,
    storageDir,
    bus,
    documents,
    projectionMs: 30,
  });
  t.after(async () => {
    await runtime.close();
    await bus.close();
    await rm(storageDir, { recursive: true, force: true });
  });
  assert.equal((await runtime.actor('org0')).now, 0);
  assert.equal(runtime.error, undefined);
});

test('isolated runtime evicts retired result bodies and prior-generation map baselines', async (t) => {
  const quiet = {
    ...config,
    hazard: 'none',
    backgroundTraffic: 0,
    postsPerHour: 0,
    toolQuota: 10000,
    queryLatencyMs: 0,
    networkLatencyMs: 0,
  };
  const { runtime } = await fixture(t, { config: quiet });
  let retired;
  for (let index = 0; index < 110; index++) {
    await runtime.request('actorAction', actor, {
      type: 'query',
      params: { target: 'inventory' },
      idempotencyKey: `inventory-${index}`,
    });
    await runtime.request('advance', (index + 1) * 1000);
    if (!index) retired = (await runtime.request('actorCompact', 'org0')).state.queries[0];
  }
  const state = await until(async () => {
    const value = await runtime.actor('org0');
    return (
      value.now === 110000 &&
      value.queries.length === 100 &&
      value.queries.at(-1).resultRef &&
      value
    );
  }, 'bounded current query window');
  assert.equal(
    runtime.cacheStats.resultBodies,
    100,
    'only digests referenced by the last 100 queries remain',
  );
  await assert.rejects(runtime.queryResult('org0', retired.id, retired.resultRef.version), {
    code: 'NOT_FOUND',
  });
  const current = state.queries.at(-1).resultRef;
  assert.ok((await runtime.queryResult('org0', current.id, current.version)).result.length);
  assert.deepEqual(await runtime.legacyActor('org0'), await runtime.request('actorState', 'org0'));
  for (let index = 0; index < 3; index++) {
    await runtime.request('reset', { ...quiet, seed: `memory-generation-${index}` });
    await runtime.refresh();
    await until(
      async () => (await runtime.frame())?.runId === runtime.meta.runId,
      'replacement map generation',
    );
    assert.ok((await runtime.observer()).state.map.buildings.length);
    assert.equal(runtime.cacheStats.resultBodies, 0);
    assert.equal(runtime.cacheStats.maps, 1);
  }
});

test('isolated runtime close cancels and drains a coalesced evaluation and releases read-model caches', async (t) => {
  const { runtime } = await fixture(t);
  await runtime.request('advance', 60000);
  const pending = runtime.evaluate();
  const settled = pending.then(
    () => 'completed',
    (error) => error.name,
  );
  assert.equal(runtime.evaluate(), pending);
  assert.equal(runtime.cacheStats.evaluations, 1);
  const began = performance.now();
  await runtime.close();
  assert.equal(await settled, 'AbortError');
  assert.ok(
    performance.now() - began < 3000,
    'closing must not wait for the 180-second evaluation deadline',
  );
  assert.deepEqual(runtime.cacheStats, {
    maps: 0,
    frames: 0,
    resultBodies: 0,
    organizations: 0,
    evaluations: 0,
  });
  await assert.rejects(runtime.evaluate(), /closing or closed/);
});

test('a received frame requested immediately after reset can bootstrap its new map before periodic publication', async (t) => {
  const { runtime } = await fixture(t, { projectionMs: 10000 });
  await runtime.request('reset', { ...config, seed: 'fresh-received-baseline' });
  await runtime.refresh();
  const frame = await runtime.frame('org1', 'org1');
  const bootstrap = await runtime.bootstrap('org1', 'org1');
  assert.equal(bootstrap.map.projectionId, frame.mapId);
  assert.ok(bootstrap.map.nodes.length);
  assert.equal(bootstrap.frame.runId, runtime.meta.runId);
});
