import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { World } from '../engine/world.mjs';
import { createLabServers } from '../sources/server.mjs';
import { runRuntimeBenchmark } from '../scripts/runtime-benchmark.mjs';

test('Takamatsu HTTP consumers and an unacknowledged subscriber cannot pause the worker clock', { timeout: 120000 }, async () => {
  const report = await runRuntimeBenchmark({ durationMs: 1800, blockParentMs: 250 });
  assert.deepEqual(report.failures, []);
  assert.equal(report.map.buildings, 4300);
  assert.ok(report.map.nodes > 5000);
  assert.equal(report.profile.organizations, 5);
  assert.ok(report.requestCount >= 18);
  assert.ok(report.simulatedAdvanceMs >= 8000, `Advanced ${report.simulatedAdvanceMs} ms`);
  assert.ok(report.parentBlock.simulatedAdvanceMs >= 500,
    `Advanced ${report.parentBlock.simulatedAdvanceMs} during a blocked consumer event loop`);
  assert.ok(report.parentBlock.ticksDuringBlock >= 1);
  assert.ok(report.slowConsumer.pending > 0);
  assert.ok(report.requests.viewer.payloadBytes.max < 1000000);
  // This intentionally broad CI guard catches seconds-long tick stalls without
  // pretending every machine or individual physical event takes eight ms.
  assert.ok(report.engine.tickIntervalMs.p95 < 1500,
    `Tick p95 ${report.engine.tickIntervalMs.p95} ms`);
  assert.equal(report.engine.modelBlocked, false);
});

test('the isolated HTTP command path preserves exact seeded earthquake state with identical timed actions', { timeout: 120000 }, async t => {
  const config = { seed: 'isolated-http-equivalence', topology: 'grid', grid: 5, extentKm: 3,
    scenario: 'S23', hazard: 'earthquake', policy: 'none', backgroundTraffic: 12,
    postsPerHour: 180, packetLoss: 0, healthReports: false, recurringNeeds: false, logMode: 'full' };
  const storageDir = await mkdtemp(path.join(os.tmpdir(), 'aidscaler-load-'));
  const lab = await createLabServers({ isolated: true, observerPort: 0, sourcePort: 0,
    persistCredentials: false, config, storageDir, workBudgetMs: 2 });
  const reference = new World(config);
  t.after(async () => {
    await lab.close(); reference.close();
    const resolved = path.resolve(storageDir), base = path.resolve(os.tmpdir());
    assert.ok(resolved.startsWith(base + path.sep) && path.basename(resolved).startsWith('aidscaler-load-'));
    await rm(resolved, { recursive: true, force: true });
  });
  const [key, actor] = Object.entries(lab.actorKeys)[0];
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const observerHeaders = { Authorization: `Bearer ${lab.observerKey}`, 'Content-Type': 'application/json' };
  const actionURL = `http://127.0.0.1:${lab.sourcePort}/api/actor/action`;
  const controlURL = `http://127.0.0.1:${lab.observerPort}/api/control`;
  for (const [at, target] of [[0, 'inventory'], [60000, 'map'], [120000, 'vehicles']]) {
    reference.advance(at);
    const advance = await fetch(controlURL, { method: 'POST', headers: observerHeaders,
      body: JSON.stringify({ advanceTo: at }) });
    assert.equal(advance.status, 200);
    const command = { type: 'query', params: { target }, idempotencyKey: `same-${at}-${target}` };
    const expected = reference.act(actor, command);
    const response = await fetch(actionURL, { method: 'POST', headers, body: JSON.stringify(command) });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), expected);
  }
  reference.advance(3600000);
  assert.equal((await fetch(controlURL, { method: 'POST', headers: observerHeaders,
    body: JSON.stringify({ advanceTo: 3600000 }) })).status, 200);
  assert.deepEqual(await lab.checkpoint(), reference.checkpoint());
});

test('Takamatsu earthquake physical state remains exact under budgeted worker slices and identical actions', { timeout: 120000 }, async t => {
  const config = { seed: 'takamatsu-physical-equivalence', topology: 'takamatsu',
    hazard: 'earthquake', policy: 'none', organizations: 5, backgroundTraffic: 30, postsPerHour: 240, logMode: 'full' };
  const storageDir = await mkdtemp(path.join(os.tmpdir(), 'aidscaler-load-'));
  const lab = await createLabServers({ isolated: true, observerPort: 0, sourcePort: 0,
    persistCredentials: false, config, storageDir, workBudgetMs: 2 });
  const reference = new World(config);
  t.after(async () => {
    await lab.close(); reference.close();
    const resolved = path.resolve(storageDir), base = path.resolve(os.tmpdir());
    assert.ok(resolved.startsWith(base + path.sep) && path.basename(resolved).startsWith('aidscaler-load-'));
    await rm(resolved, { recursive: true, force: true });
  });
  const actor = Object.values(lab.actorKeys)[0];
  const input = { type: 'query', params: { target: 'inventory' }, idempotencyKey: 'takamatsu-stock' };
  assert.deepEqual(await lab.runtime.request('actorAction', actor, input), reference.act(actor, input));
  reference.advance(600000);
  assert.equal((await lab.advance(600000)).reached, true);
  assert.deepEqual(await lab.checkpoint(), reference.checkpoint());
});

test('paired live comparison uses presentation summaries and preserves the paired physical counts', { timeout: 120000 }, async t => {
  const storageDir = await mkdtemp(path.join(os.tmpdir(), 'aidscaler-load-'));
  const lab = await createLabServers({ isolated: true, observerPort: 0, sourcePort: 0,
    persistCredentials: false, storageDir, config: { topology: 'grid', grid: 5,
      extentKm: 3, hazard: 'none', backgroundTraffic: 0, postsPerHour: 0, policy: 'none' } });
  t.after(async () => {
    await lab.close();
    const resolved = path.resolve(storageDir), base = path.resolve(os.tmpdir());
    assert.ok(resolved.startsWith(base + path.sep) && path.basename(resolved).startsWith('aidscaler-load-'));
    await rm(resolved, { recursive: true, force: true });
  });
  await lab.runtime.request('compare', { create: true, policyA: 'none', policyB: 'none' });
  await lab.advance(60000);
  const pair = await lab.runtime.request('compare', { pair: true });
  assert.equal(pair.a.now, 60000);
  assert.equal(pair.b.now, 60000);
  assert.equal(pair.a.state.map.hash, pair.b.state.map.hash);
  assert.ok(Number.isFinite(pair.a.state.map.extentM / pair.a.state.map.grid));
  assert.equal(pair.a.metrics.presentation.kind, 'live-summary');
  assert.equal(pair.b.metrics.presentation.kind, 'live-summary');
  assert.deepEqual(pair.a.metrics.services, pair.b.metrics.services);
  assert.deepEqual(pair.a.metrics.population, pair.b.metrics.population);
  assert.equal(pair.a.metrics.ledgerValid, null);
  assert.equal(pair.a.metrics.response, undefined);
});
