import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createLabServers } from '../sources/server.mjs';
import { FEED_LIMIT, reconcileSnapshot, renderPost, sourceHTML } from '../sources/social-view.mjs';
import { World } from '../engine/world.mjs';
import { replay, runWorld, pairedComparison } from '../evaluation/runs.mjs';

const config = { seed: 'social-live', grid: 3, extentKm: 2, hazard: 'none', policy: 'none', topology: 'regional',
  postsPerHour: 3600, backgroundTraffic: 0, packetLoss: 0, language: 'en' };
const actor = { id: 'outside-model', org: 'org0', role: 'agent' };

test('live reconciliation keeps the newest bounded snapshot, not an animation backlog', () => {
  let state = null;
  for (let batch = 0; batch < 1000; batch++) {
    const posts = Array.from({ length: 100 }, (_, index) => ({ id: `p${batch * 100 + index}`, version: 1 }));
    state = reconcileSnapshot(state, { runId: 'same', now: batch * 1000, posts, total: (batch + 1) * 100 });
    assert.equal(state.posts.length, FEED_LIMIT);
    assert.equal(state.posts[0].id, posts[0].id);
    assert.equal(Object.hasOwn(state, 'queue'), false);
    assert.equal(state.added.length, FEED_LIMIT);
  }
  const changed = reconcileSnapshot(state, { ...state, posts: [{ ...state.posts[0], version: 2 }, state.posts[0], state.posts[2]] });
  assert.equal(changed.posts.length, 2, 'duplicate source IDs render once');
  assert.deepEqual(changed.updated, [state.posts[0].id]);
  const reset = reconcileSnapshot(state, { ...state, now: 0, posts: [] });
  assert.equal(reset.reset, true, 'same-seed world restart clears stale cards when the clock rewinds');
  assert.deepEqual(reset.posts, []);
  assert.equal(reconcileSnapshot(state, { ...state, runId: 'new' }).reset, true);
});

test('source presentation escapes post/media content and preserves crawler links', () => {
  const post = { id: 'public-1', version: 2, authorId: 'author-1', authorName: '<Aiko>', text: '<script>unsafe</script>',
    publishedAt: 3600000, likes: 2, location: 'b1', locationName: 'North Ridge Shelter', references: ['public-0'],
    attachments: [{ kind: 'photo', description: '<img onerror=unsafe>', duration: null }] };
  const card = renderPost(post);
  assert.match(card, /data-post-id="public-1" data-version="2"/);
  assert.match(card, /href="\/posts\/public-1"/);
  assert.match(card, /href="\/users\/author-1"/);
  assert.match(card, /North Ridge Shelter/);
  assert.match(card, /data-media-kind="photo"/);
  assert.doesNotMatch(card, /<script>|<img onerror=/);
  const html = sourceHTML('Latest', [post], 30, { runId: 'test', live: true });
  assert.match(html, /rel="next" href="\/feed\?cursor=30"/);
  assert.match(html, /\\u003cscript/);
  assert.doesNotMatch(html, /truthCategory|causeEvent/);
});

test('public live timeline follows source indexing and simulator controls without exposing team-only truth', async (t) => {
  const lab = await createLabServers({ observerPort: 0, sourcePort: 0, persistCredentials: false, config });
  t.after(() => lab.close());
  const base = `http://127.0.0.1:${lab.sourcePort}`;
  lab.world.inject('lab_intervention', { kind: 'team_note', org: 'org0', text: 'PRIVATE-TEAM-NOTE' });
  const a = await (await fetch(base + '/api/timeline?org=org0&audience=team')).json();
  assert.equal(a.now, 0);
  assert.equal(a.playing, false);
  lab.world.advance(90000);
  const b = await (await fetch(base + '/api/timeline?limit=30')).json();
  assert.equal(b.now, lab.world.now);
  assert.equal(b.runId, lab.world.runId);
  assert.ok(b.posts.length > a.posts.length);
  assert.ok(b.posts.length <= FEED_LIMIT);
  assert.ok(b.posts.every((p) => p.publishedAt <= b.now));
  const body = JSON.stringify(b);
  assert.doesNotMatch(body, /PRIVATE-TEAM-NOTE|truthCategory|causeEvent|"private"/);
  const html = await (await fetch(base + '/feed')).text();
  assert.match(html, /data-post-id=/);
  assert.match(html, /social-feed.mjs/);
  assert.equal((await fetch(base + '/assets/social.css')).status, 200);
  assert.equal((await fetch(base + '/assets/social-view.mjs')).status, 200);
  assert.equal((await fetch(base + '/assets/..%2f..%2f.local/session.json')).status, 404);
  lab.world.inject('lab_intervention', { kind: 'integration', available: false });
  assert.equal((await fetch(base + '/api/timeline')).status, 503);
});

test('continuous demo advances during model inference and beyond its finite demonstration horizon', async (t) => {
  const demo = { ...config, durationMs: 1000, continuousDemo: true, mode: 'interactive', clockLatency: 'wall' };
  const lab = await createLabServers({ observerPort: 0, sourcePort: 0, persistCredentials: false, config: demo });
  t.after(() => lab.close());
  const job = lab.world.startModelCall(actor, { model: 'outside' });
  const headers = { Authorization: `Bearer ${lab.observerKey}`, 'Content-Type': 'application/json' };
  const base = `http://127.0.0.1:${lab.observerPort}`;
  await fetch(base + '/api/control', { method: 'POST', headers, body: JSON.stringify({ play: true, rate: 100 }) });
  await delay(180);
  const state = await (await fetch(base + '/api/state', { headers })).json();
  assert.equal(state.playing, true);
  assert.equal(state.benchmarkEligible, false);
  const comparison = await fetch(base + '/api/comparison', { method: 'POST', headers, body: '{}' });
  assert.equal(comparison.status, 409);
  assert.ok(state.now > demo.durationMs);
  assert.equal(lab.world.state.modelRequests[0].state, 'waiting');
  assert.equal(lab.world.modelBarrier(), false);
  await fetch(base + '/api/control', { method: 'POST', headers, body: JSON.stringify({ play: false }) });
  lab.world.finishModelCall(actor, { id: job.id, wallMs: 180 });
  lab.world.advance(lab.world.now + 120000);
  assert.ok(lab.world.state.posts.length > 1, 'content scheduling continues beyond the configured finite horizon');
  assert.deepEqual(lab.world.invariants(), []);
  const result = replay(lab.world.checkpoint());
  assert.equal(result.matches, true, 'continuous-demo inputs remain replayable at a finite checkpoint');
  result.world.close();
});

test('benchmark barriers remain strict and demo maps have stable readable names without changing IDs', () => {
  const w = new World({ ...config, clockLatency: 'modeled' });
  const a = new World(config);
  const b = new World(config);
  try {
    w.startModelCall(actor, { model: 'outside' });
    assert.equal(w.advance(10000).blocked, 'model_result');
    assert.equal(w.now, 0);
    assert.equal(a.state.map.hash, b.state.map.hash);
    assert.ok(a.state.map.buildings.every((building) => building.name && /^b\d+$/.test(building.id)));
    assert.equal(new Set(a.state.map.buildings.map((building) => building.name)).size, a.state.map.buildings.length);
    assert.ok(a.state.map.nodes.every((node) => node.name?.endsWith('Junction')));
    assert.equal(a.state.map.organizations[0].name, 'Relief North');
    assert.throws(() => new World({ ...config, continuousDemo: true }), /wall-clock/);
    assert.throws(() => runWorld({ ...config, continuousDemo: true, clockLatency: 'wall' }), /not benchmark/);
    assert.throws(() => pairedComparison([{ config: { continuousDemo: true } }], []), /not eligible/);
  } finally { w.close(); a.close(); b.close(); }
});
