import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { setTimeout as delay } from 'node:timers/promises';
import { World } from '../engine/world.mjs';
import { evaluate } from '../evaluation/metrics.mjs';

const config = { seed: 'isolated-runtime-regression', topology: 'grid', grid: 5, extentKm: 3,
  scenario: 'S23', hazard: 'earthquake', policy: 'none', backgroundTraffic: 12, postsPerHour: 180,
  packetLoss: 0, logMode: 'full', healthReports: false, recurringNeeds: false };
const actor = { id: 'isolated-reader', org: 'org0', role: 'agent' };
async function launch(t, options = {}) {
  const worker = new Worker(new URL('../sources/runtime-worker.mjs', import.meta.url), {
    workerData: { config, tickMs: 20, projectionMs: 50, workBudgetMs: 2, ...options },
  });
  const messages = [], pending = new Map(); let serial = 0, readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  worker.on('message', message => {
    messages.push(message);
    if (message.type === 'ready') readyResolve(message.meta);
    if (message.type === 'reply') {
      const result = pending.get(message.id); pending.delete(message.id);
      if (message.error) result?.reject(Object.assign(new Error(message.error.message), message.error));
      else result?.resolve(message.result);
    }
  });
  worker.on('error', error => { readyReject(error); for (const p of pending.values()) p.reject(error); pending.clear(); });
  const call = (method, ...args) => new Promise((resolve, reject) => {
    const id = ++serial; pending.set(id, { resolve, reject }); worker.postMessage({ type: 'request', id, method, args });
  });
  t.after(async () => { try { await call('close'); } finally { await worker.terminate(); } });
  return { worker, call, messages, meta: await ready };
}
function hydrate(packet) {
  const { compact, ...state } = packet.state;
  const results = new Map(packet.results.map(row => [row.version, row.result]));
  state.queries = state.queries.map(({ resultRef, ...query }) => resultRef
    ? { ...query, result: results.get(resultRef.version) } : query);
  if (compact.mapQueryId) state.known.map = state.queries.find(q => q.id === compact.mapQueryId).result;
  return state;
}

test('budgeted worker advancement preserves the exact engine checkpoint, event order and evaluation', async t => {
  const lab = await launch(t), direct = new World(config);
  t.after(() => direct.close());
  for (const target of [0, 600000, 3600000, 21600000]) {
    let progress;
    do { progress = direct.advance(target); } while (!progress.reached && !progress.blocked);
    assert.equal((await lab.call('advance', target)).reached, true);
    assert.deepEqual(await lab.call('checkpoint'), direct.checkpoint(), `checkpoint at ${target}`);
    assert.deepEqual(await lab.call('metrics'), evaluate(direct), `evaluation at ${target}`);
  }
});

test('unacknowledged viewer and event batches do not stop physics or accumulate IPC frames', async t => {
  const lab = await launch(t);
  await lab.call('control', { play: true, rate: 1000 });
  await delay(300);
  const before = await lab.call('meta');
  // Deliberately block the HTTP/consumer thread. The engine is isolated.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 180);
  await lab.call('control', { play: false });
  const after = await lab.call('meta');
  assert.ok(before.now > 100000, `physics advanced to ${before.now} despite no ACKs`);
  assert.ok(after.now > before.now + 50000, 'consumer event-loop blockage must not pause World');
  assert.equal(lab.messages.filter(m => m.type === 'projection').length, 1);
  assert.equal(lab.messages.filter(m => m.type === 'events').length, 1);
  assert.ok(after.performance.tickCount > 5);
  assert.ok(after.performance.eventBacklog > 0);
  assert.equal(lab.messages.some(m => m.type === 'runtimeError'), false);
});

test('event batches retain every authoritative record with exclusive offsets under slow consumption', async t => {
  const lab = await launch(t);
  await lab.call('advance', 3600000);
  const checkpoint = await lab.call('checkpoint'), received = [];
  let cursor = 0;
  while (cursor < checkpoint.log.length) {
    const batch = lab.messages.find(m => m.type === 'events' && m.fromOffset === cursor);
    if (!batch) { await delay(5); continue; }
    assert.ok(batch.events.length <= 100);
    assert.equal(batch.throughOffset, cursor + batch.events.length);
    received.push(...batch.events); cursor = batch.throughOffset;
    lab.worker.postMessage({ type: 'eventsAck', runId: batch.runId, generation: batch.generation, throughOffset: cursor });
  }
  assert.deepEqual(received, checkpoint.log);
  assert.equal((await lab.call('meta')).performance.eventBacklog, 0);
});

test('compact actor frames preserve scoped legacy results and protect pending inspection internals', async t => {
  const quiet = { ...config, hazard: 'none', backgroundTraffic: 0, postsPerHour: 0, networkLatencyMs: 0, inspectionMs: 60000 };
  const lab = await launch(t, { config: quiet }), direct = new World(quiet);
  t.after(() => direct.close());
  const command = { type: 'query', params: { target: 'map' }, idempotencyKey: 'same-map' };
  assert.deepEqual(await lab.call('actorAction', actor, command), direct.act(actor, command));
  direct.advance(50000); await lab.call('advance', 50000);
  const target = direct.state.map.buildings.find(b => b.use === 'residential').id;
  const verify = { type: 'verify', params: { target: 'building', id: target, method: 'clarification' }, idempotencyKey: 'check-building' };
  assert.deepEqual(await lab.call('actorAction', actor, verify), direct.act(actor, verify));
  const packet = await lab.call('actorCompact', 'org0');
  assert.deepEqual(hydrate(packet), direct.actorView('org0'));
  assert.equal(Object.hasOwn(packet.state.known, 'map'), false);
  assert.ok(packet.results.length > 0);
  const reference = packet.state.queries.find(q => q.resultRef).resultRef;
  assert.deepEqual(await lab.call('queryResult', 'org0', reference.id, reference.version), packet.results.find(q => q.id === reference.id));
  await assert.rejects(lab.call('queryResult', 'org1', reference.id, reference.version), { code: 'NOT_FOUND' });
  await assert.rejects(lab.call('queryResult', 'org0', reference.id, 'stale'), { code: 'SOURCE_RESULT_CHANGED' });
  assert.equal(packet.state.inspections.length, 1);
  for (const field of ['result', 'vehicle', 'operation', 'completedAt', 'observedAt'])
    assert.equal(Object.hasOwn(packet.state.inspections[0], field), false, field);
  const activity = await lab.call('activity');
  assert.equal(Object.hasOwn(activity.state.observations.org0, 'map'), false);
  assert.equal(Object.hasOwn(activity.state.observations.org0, 'queries'), false);
});

test('modeled computation barriers keep the declared virtual latency and cannot leak foreign results', async t => {
  const lab = await launch(t, { config: { ...config, mode: 'modeled', modelLatencyMs: 30000 } });
  await lab.call('advance', 1000);
  const job = await lab.call('startModelCall', actor, { model: 'test/no-network' });
  await lab.call('control', { play: true, rate: 1000 });
  await delay(100);
  assert.equal((await lab.call('meta')).now, 1000);
  assert.equal((await lab.call('advance', 100000)).blocked, 'model_result');
  await lab.call('control', { play: false });
  const done = await lab.call('finishModelCall', actor, { id: job.id, wallMs: 600000, promptTokens: 20, outputTokens: 10 });
  assert.equal(done.availableAt, 31000);
  assert.equal(done.now, 31000);
  assert.equal((await lab.call('actorState', 'org0')).modelRequests[0].state, 'available');
  assert.deepEqual((await lab.call('actorState', 'org1')).modelRequests, []);
});

test('compact actor receipts retain the conventional human-work extension exactly', async t => {
  const input = { ...config, policy: 'conventional', humanCapacity: { profile: 'burst' } };
  const lab = await launch(t, { config: input }), direct = new World(input);
  t.after(() => direct.close());
  direct.advance(600000); await lab.call('advance', 600000);
  assert.deepEqual(await lab.call('checkpoint'), direct.checkpoint());
  for (const org of ['org0', 'org1'])
    assert.deepEqual(hydrate(await lab.call('actorCompact', org)), direct.actorView(org));
});

test('restoring a checkpoint preserves results and reset invalidates previous projection delivery', async t => {
  const lab = await launch(t);
  await lab.call('advance', 120000);
  const saved = await lab.call('checkpoint');
  await lab.call('advance', 600000);
  await lab.call('restore', saved);
  assert.deepEqual(await lab.call('checkpoint'), saved);
  await lab.call('reset', { ...config, seed: 'new-runtime-episode' });
  const next = await lab.call('meta');
  assert.notEqual(next.runId, saved.runId); assert.equal(next.now, 0);
  const old = lab.messages.find(m => m.type === 'projection');
  lab.worker.postMessage({ type: 'projectionAck', version: old.version });
  await delay(80);
  assert.ok(lab.messages.some(m => m.type === 'projection' && m.meta.runId === next.runId));
  await assert.rejects(lab.call('actorCompact', 'missing-org'), { code: 'AUTHENTICATION' });
  await assert.rejects(lab.call('invented-method'), { code: 'METHOD' });
});
