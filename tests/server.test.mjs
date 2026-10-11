import test from 'node:test';
import assert from 'node:assert/strict';
import { createLabServers } from '../sources/server.mjs';
test('source server is scrapeable but cannot expose observer truth or accept unauthenticated actions', async (t) => {
  const lab = await createLabServers({
    observerPort: 0,
    sourcePort: 0,
    persistCredentials: false,
    config: {
      policy: 'none',
      grid: 9,
      extentKm: 8,
      topology: 'grid',
      hazard: 'none',
      postsPerHour: 0,
      backgroundTraffic: 0,
      packetLoss: 0,
      scenario: 'S16',
    },
  });
  t.after(() => lab.close());
  lab.world.advance(600000);
  const source = `http://127.0.0.1:${lab.sourcePort}`,
    observer = `http://127.0.0.1:${lab.observerPort}`;
  const html = await (await fetch(source + '/feed')).text();
  assert.ok(html.includes('data-post-id'));
  for (const term of ['truthCategory', 'causeEvent', 'private', 'preset'])
    assert.ok(!html.includes(`"${term}"`));
  assert.equal((await fetch(observer + '/api/state')).status, 401);
  assert.equal((await fetch(source + '/api/state')).status, 404);
  assert.equal((await fetch(source + '/api/actor/state')).status, 401);
  const key = Object.keys(lab.actorKeys)[0],
    headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const posts = (await (await fetch(source + '/api/feed')).json()).posts;
  const missing = await fetch(source + '/api/actor/ingestion', {
    method: 'POST',
    headers,
    body: JSON.stringify({ id: posts[0].id, stage: 'accepted' }),
  });
  assert.equal(missing.status, 400);
  const download = await fetch(source + '/api/actor/ingestion', {
    method: 'POST',
    headers,
    body: JSON.stringify({ id: posts[0].id, stage: 'downloaded' }),
  });
  assert.equal(download.status, 200);
  const receipt = await fetch(source + '/api/actor/ingestion', {
    method: 'POST',
    headers,
    body: JSON.stringify({ id: posts[0].id, stage: 'accepted' }),
  });
  assert.equal(receipt.status, 200);
  assert.equal(lab.world.state.ingestion.length, 2);
  const dispatch = await fetch(source + '/api/actor/action', {
    method: 'POST',
    headers,
    body: JSON.stringify({ type: 'dispatch', params: {}, idempotencyKey: 'unauthorized' }),
  });
  assert.equal(dispatch.status, 403);
  const state = await (
    await fetch(observer + '/api/state', {
      headers: { Authorization: `Bearer ${lab.observerKey}` },
    })
  ).json();
  assert.ok(state.state.posts.some((p) => p.private.false));
});
