import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createLabServers } from '../sources/server.mjs';
import { SOURCE_INSTANCE_HEADER } from '../sources/source-instance.mjs';
import { digest } from '../engine/determinism.mjs';

const config = { seed: 'same-seed-source-lifetime', topology: 'grid', grid: 3, extentKm: 1,
  scenario: 'S16', hazard: 'none', policy: 'none', backgroundTraffic: 0, postsPerHour: 0,
  packetLoss: 0, logMode: 'full', healthReports: false, recurringNeeds: false };
const query = id => ({ type: 'query', params: { target: 'vehicles' }, idempotencyKey: id });

for (const isolated of [false, true]) {
  test(`${isolated ? 'isolated' : 'inline'} same-seed reset changes source lifetime and fences every actor mutation`, async t => {
    const storageDir = await mkdtemp(path.join(os.tmpdir(), 'aid-source-lifetime-'));
    const lab = await createLabServers({ isolated, config, observerPort: 0, sourcePort: 0,
      persistCredentials: false, storageDir, projectionMs: 25 });
    t.after(async () => { await lab.close(); await rm(storageDir, { recursive: true, force: true }); });
    const source = `http://127.0.0.1:${lab.sourcePort}`, observer = `http://127.0.0.1:${lab.observerPort}`;
    const key = Object.entries(lab.actorKeys).find(([, a]) => a.org === 'org0')[0];
    const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
    const read = async () => {
      const response = await fetch(source + '/api/actor/state', { headers });
      assert.equal(response.status, 200);
      return { instance: response.headers.get(SOURCE_INSTANCE_HEADER), value: await response.json() };
    };
    const first = await read();
    assert.ok(first.instance);
    assert.equal(Object.hasOwn(first.value, 'sourceInstance'), false, 'legacy actor JSON is unchanged');
    const reset = await fetch(observer + '/api/config', { method: 'POST',
      headers: { Authorization: `Bearer ${lab.observerKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
    assert.equal(reset.status, 200);
    const second = await read();
    assert.equal(first.value.runId, second.value.runId, 'deterministic World identity is unchanged');
    assert.notEqual(first.instance, second.instance, 'a fresh episode cannot reuse old physical commitments');
    const snapshot = async () => isolated ? lab.checkpoint() : lab.world.checkpoint();
    const before = digest(await snapshot());
    for (const endpoint of ['action', 'ingestion', 'ingestion/batch', 'model/start', 'model/finish']) {
      const response = await fetch(`${source}/api/actor/${endpoint}`, { method: 'POST',
        headers: { ...headers, [SOURCE_INSTANCE_HEADER]: first.instance },
        body: JSON.stringify(endpoint === 'action' ? query('stale-query') : { items: [] }) });
      assert.equal(response.status, 409, endpoint);
      assert.equal((await response.json()).error, 'SOURCE_RESPONSE_CHANGED');
    }
    assert.equal(digest(await snapshot()), before, 'rejections happen before any engine mutation');
    const current = await fetch(source + '/api/actor/action', { method: 'POST',
      headers: { ...headers, [SOURCE_INSTANCE_HEADER]: second.instance }, body: JSON.stringify(query('new-query')) });
    assert.equal(current.status, 200);
    const legacy = await fetch(source + '/api/actor/action', { method: 'POST', headers,
      body: JSON.stringify(query('legacy-query')) });
    assert.equal(legacy.status, 200, 'existing unbound adapters remain compatible');
    assert.equal((await fetch(source + '/api/actor/state')).status, 401);
  });

  test(`${isolated ? 'isolated' : 'inline'} coordinated checkpoint resume retains source lifetime`, async t => {
    const storageDir = await mkdtemp(path.join(os.tmpdir(), 'aid-source-resume-'));
    let lab;
    t.after(async () => { await lab?.close(); await rm(storageDir, { recursive: true, force: true }); });
    const options = { isolated, config, observerPort: 0, sourcePort: 0, persistCredentials: false, storageDir, projectionMs: 25 };
    lab = await createLabServers(options);
    // Resume after an actual reset, so generation persistence is exercised.
    const reset = await fetch(`http://127.0.0.1:${lab.observerPort}/api/config`, { method: 'POST',
      headers: { Authorization: `Bearer ${lab.observerKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
    assert.equal(reset.status, 200);
    const actorKeys = lab.actorKeys, key = Object.keys(actorKeys)[0];
    const response = await fetch(`http://127.0.0.1:${lab.sourcePort}/api/actor/state`, { headers: { Authorization: `Bearer ${key}` } });
    const instance = response.headers.get(SOURCE_INSTANCE_HEADER);
    await response.json();
    const checkpoint = isolated ? await lab.checkpoint() : lab.world.checkpoint();
    await lab.close();
    lab = await createLabServers({ ...options, checkpoint, actorKeys, sourceInstance: instance });
    const resumed = await fetch(`http://127.0.0.1:${lab.sourcePort}/api/actor/state`, { headers: { Authorization: `Bearer ${key}` } });
    assert.equal(resumed.headers.get(SOURCE_INSTANCE_HEADER), instance);
    assert.deepEqual(await resumed.json(), JSON.parse(JSON.stringify(isolated
      ? await lab.runtime.legacyActor(actorKeys[key].org) : lab.world.actorView(actorKeys[key].org))));
    await lab.close();
    lab = await createLabServers({ ...options, actorKeys });
    const fresh = await fetch(`http://127.0.0.1:${lab.sourcePort}/api/actor/state`, { headers: { Authorization: `Bearer ${key}` } });
    assert.notEqual(fresh.headers.get(SOURCE_INSTANCE_HEADER), instance,
      'a fresh process in the same storage directory without a checkpoint is a new response');
    await fresh.json();
  });
}

test('isolated worker checks expected lifetime after earlier queued reset executes', async t => {
  const storageDir = await mkdtemp(path.join(os.tmpdir(), 'aid-source-queue-'));
  const lab = await createLabServers({ isolated: true, config, observerPort: 0, sourcePort: 0,
    persistCredentials: false, storageDir, projectionMs: 25 });
  t.after(async () => { await lab.close(); await rm(storageDir, { recursive: true, force: true }); });
  const old = lab.runtime.meta.sourceInstance;
  const reset = lab.runtime.request('reset', config);
  const mutation = lab.runtime.request('boundActorMutation', old, 'actorAction',
    [{ id: 'queue-agent', org: 'org0', role: 'agent' }, query('queued-stale-query')]);
  await assert.rejects(mutation, e => e.status === 409 && e.code === 'SOURCE_RESPONSE_CHANGED');
  await reset;
  const checkpoint = await lab.checkpoint();
  assert.equal((checkpoint.state.queries ?? []).some(q => q.idempotencyKey === 'queued-stale-query'), false);
  assert.equal(checkpoint.log.some(e => JSON.stringify(e).includes('queued-stale-query')), false);
});
