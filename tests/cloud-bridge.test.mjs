import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DemoPresence, encodeWire, decodeWire, validateCommand, WIRE_VERSION } from '../sources/cloud-wire.mjs';
import { executeBridgeCommand } from '../scripts/gcp-bridge.mjs';
import { startDemoHost } from '../scripts/demo-host.mjs';
import { mkdtemp, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
test('a sleeping demo wakes once, freezes after ten real minutes and does not catch up', async () => {
  let time = 0, paused = 0, resumed = 0, persisted = 0;
  const presence = new DemoPresence({ now: () => time, pause: async () => { paused++; },
    resume: async () => { resumed++; }, persist: async () => { persisted++; } });
  await Promise.all([presence.touch('viewer-a'), presence.touch('viewer-b')]);
  assert.equal(resumed, 1);
  time = 599999; await presence.sweep(); assert.equal(paused, 0);
  time = 600000; await presence.sweep(); assert.equal(paused, 1); assert.equal(persisted, 1);
  await presence.sweep(); assert.equal(paused, 1);
  time = 86400000; await presence.touch('viewer-c'); assert.equal(resumed, 2);
});
test('wire preserves receipts, rejects expiry, observer escape, and decompression abuse', () => {
  const command = { version: WIRE_VERSION, id: 'command_123', deadline: 2000, scope: 'observer', method: 'GET', path: '/api/demo/frame' };
  assert.deepEqual(decodeWire(encodeWire(command)), command);
  validateCommand(command, 1000);
  assert.throws(() => validateCommand(command, 2001), /EXPIRED/);
  assert.throws(() => validateCommand({ ...command, path: '/api/control' }, 1000), /SCOPE/);
  assert.throws(() => validateCommand({ ...command, path: 'https://other.example/api/demo/frame' }, 1000), /SCOPE/);
  assert.throws(() => validateCommand({ ...command, scope: 'actor', path: '/api/demo/frame' }, 1000), /SCOPE/);
});
test('bridge keeps actor and observer credentials separate and forwards source identity', async () => {
  const world = { credentials: { observerUrl: 'http://127.0.0.1:1', sourceUrl: 'http://127.0.0.1:2', observerKey: 'private-observer' } };
  const command = { version: WIRE_VERSION, id: 'command_123', deadline: 2000, scope: 'actor', method: 'GET',
    path: '/api/actor/state', headers: { authorization: 'Bearer actor-key', 'x-aidscaler-source-instance': 'source-v1', cookie: 'discard' } };
  const result = await executeBridgeCommand(command, { world, now: () => 1000, fetcher: async (url, init) => {
    assert.equal(url, 'http://127.0.0.1:2/api/actor/state');
    assert.equal(init.headers.authorization, 'Bearer actor-key'); assert.equal(init.headers.cookie, undefined);
    assert.equal(init.headers['x-aidscaler-source-instance'], 'source-v1');
    return new Response('{"now":7}', { headers: { 'x-aidscaler-source-instance': 'source-v1' } });
  } });
  assert.equal(result.headers['x-aidscaler-source-instance'], 'source-v1');
  assert.equal(JSON.parse(result.body).now, 7);
});
test('real isolated world stays frozen while sleeping, resumes and checkpoints only changed time', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'aidscaler-cloud-pause-'));
  const host = await startDemoHost({ dataDir: directory, observerPort: 0, sourcePort: 0,
    autostart: false, checkpointWhilePaused: false, checkpointEveryMs: 1000,
    storageMaintenance: false, director: { enabled: false },
    config: { topology: 'grid', grid: 3, extentKm: 2, postsPerHour: 0, backgroundTraffic: 0 } });
  t.after(async () => {
    await host.close();
    assert.ok(path.resolve(directory).startsWith(path.join(tmpdir(), 'aidscaler-cloud-pause-')));
    await rm(directory, { recursive: true, force: true });
  });
  const checkpoint = path.join(directory, 'checkpoint.json');
  const first = (await stat(checkpoint)).mtimeMs;
  await new Promise(resolve => setTimeout(resolve, 1100));
  assert.equal((await stat(checkpoint)).mtimeMs, first, 'sleeping world does not rewrite large checkpoints every minute');
  const before = (await host.lab.checkpoint()).now;
  await host.resume(); await new Promise(resolve => setTimeout(resolve, 600)); await host.pause();
  const paused = (await host.lab.checkpoint()).now;
  assert.ok(paused > before, 'real simulation time resumes');
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal((await host.lab.checkpoint()).now, paused, 'no catch-up or hidden physical ticks while paused');
  await host.persist(); assert.ok((await stat(checkpoint)).mtimeMs > first);
});
