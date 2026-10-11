import test from 'node:test';
import assert from 'node:assert/strict';
import { createLab, activityView } from '../lab.mjs';

test('live activity is observer-only, read-only and carries exact source/receipt content', async (t) => {
  const lab = await createLab({
    observerPort: 0,
    sourcePort: 0,
    persistCredentials: false,
    config: { grid: 3, backgroundTraffic: 0, hazard: 'none', policy: 'none', postsPerHour: 3600 },
  });
  t.after(() => lab.close());
  const base = `http://127.0.0.1:${lab.observerPort}`;
  const headers = { Authorization: `Bearer ${lab.observerKey}` };
  lab.world.advance(600000);
  const post = lab.world.state.posts.find((p) => p.public.publishedAt !== null);
  lab.world.state.ingestion.push({
    org: 'org0',
    id: post.public.id,
    version: post.public.version,
    at: lab.world.now,
    stage: 'downloaded',
    content: structuredClone(post.public),
  });
  const hash = lab.world.stateHash();
  assert.equal((await fetch(base + '/api/activity')).status, 401);
  assert.equal((await fetch(base + '/api/activity', { method: 'POST', headers })).status, 405);
  assert.equal((await fetch(base + '/api/activity?org=unknown', { headers })).status, 400);
  const response = await fetch(base + '/api/activity?org=org0', { headers });
  const activity = await response.json();
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(activity.state.posts, lab.world.state.posts.slice(-200));
  assert.deepEqual(activity.state.ingestion, lab.world.state.ingestion.slice(-200));
  assert.deepEqual(activity.events, lab.world.log.slice(-200));
  assert.deepEqual(Object.keys(activity.state.observations), ['org0']);
  assert.ok(!Object.hasOwn(activity.state, 'map'));
  assert.ok(!Object.hasOwn(activity.state, 'queries'));
  assert.equal(lab.world.stateHash(), hash, 'polling must not advance time or consume a source');
  const both = await (
    await fetch(base + '/api/activity?org=org0&perspective=org1', { headers })
  ).json();
  assert.deepEqual(Object.keys(both.state.observations), ['org0', 'org1']);
});

test('a lightweight recent window leaves every archived event and source available', async (t) => {
  const lab = await createLab({
    observerPort: 0,
    sourcePort: 0,
    persistCredentials: false,
    config: { grid: 3, backgroundTraffic: 0, hazard: 'none', policy: 'none', postsPerHour: 7200 },
  });
  t.after(() => lab.close());
  lab.world.advance(600000);
  const eventsBefore = lab.world.log.length,
    postsBefore = lab.world.state.posts.length;
  const first = lab.world.log.slice(0, 1)[0];
  for (let i = 0; i < 20; i++) activityView(lab.world, ['org0'], 10);
  assert.equal(lab.world.log.length, eventsBefore);
  assert.equal(lab.world.state.posts.length, postsBefore);
  assert.deepEqual(lab.world.log.slice(0, 1)[0], first);
  const headers = { Authorization: `Bearer ${lab.observerKey}` };
  const archive = await (
    await fetch(`http://127.0.0.1:${lab.observerPort}/api/events?offset=0`, { headers })
  ).json();
  assert.deepEqual(archive.events[0], first);
  assert.equal(archive.total, eventsBefore);
  assert.ok(
    lab.world.state.posts.every((p) => p.public.language === 'en'),
    'new laboratory sources default to English',
  );
  assert.ok(
    !lab.world.state.posts.some((p) =>
      /Pensando|seguimos esperando|personas necesitan/.test(p.public.text),
    ),
  );
});
