import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../engine/world.mjs';
import { replay, saveRun, readJSON } from '../evaluation/runs.mjs';
import { batch } from '../evaluation/batch.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const config = {
  policy: 'none',
  topology: 'grid',
  grid: 9,
  extentKm: 8,
  durationMs: 6 * 3600000,
  hazard: 'none',
  scenario: 'S23',
  grid: 3,
  extentKm: 1,
  postsPerHour: 1200,
  backgroundTraffic: 0,
  durationMs: 180000,
  packetLoss: 0,
  logMode: 'compact',
};
test('disk archives preserve mutable messages, search, revisions, scoped audio and exact replay', async () => {
  const w = new World(config);
  let restored, replayed;
  try {
    w.inject('lab_intervention', { kind: 'team_note', org: 'org0', text: 'PRIVATE-VOICE' });
    w.advance(60000);
    const post = w.publicFeed({ limit: 10 }).posts[0];
    assert.ok(post);
    w.inject('post_update', { id: post.id, text: 'Edited public report' });
    w.advance(90000);
    assert.equal(w.publicFeed({ q: 'Edited' }).posts.length, 1);
    assert.equal(w.publicFeed({ q: 'PRIVATE' }).posts.length, 0);
    assert.equal(w.publicFeed({ q: 'PRIVATE', org: 'org0', audience: 'team' }).posts.length, 1);
    const cp = w.checkpoint();
    restored = new World(config, cp);
    w.advance(180000);
    restored.advance(180000);
    assert.equal(w.stateHash(), restored.stateHash());
    const check = replay(w.checkpoint());
    replayed = check.world;
    assert.equal(check.matches, true);
    assert.ok(w.state.messages.filter((m) => m.state === 'delivered').length > 0);
  } finally {
    w.close();
    restored?.close();
    replayed?.close();
  }
});
test('a saved compact run can be restored from its portable archive bundle', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'disaster-bundle-'));
  const w = new World(config);
  let restored;
  try {
    w.advance(180000);
    await saveRun(
      { world: w, metrics: w.observer().metrics, wallMs: 1, hash: w.stateHash() },
      directory,
    );
    const cp = await readJSON(path.join(directory, 'checkpoint.json.gz'));
    restored = new World(config, cp);
    assert.equal(restored.stateHash(), w.stateHash());
  } finally {
    w.close();
    restored?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
test('isolated workers match a serial run and resume only matching completed manifests', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'disaster-batch-'));
  const configs = ['a', 'b'].map((seed) => ({ ...config, logMode: 'full', seed, policy: 'rules' }));
  try {
    const rows = await batch(configs, { directory, workers: 2 });
    for (let i = 0; i < 2; i++) {
      const w = new World(configs[i]);
      w.advance(180000);
      assert.equal(rows[i].hash, w.stateHash());
    }
    const resumed = await batch(configs, { directory, workers: 2, resume: true });
    assert.ok(resumed.every((r) => r.resumed));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
