import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { createIsolatedLabServers } from '../sources/isolated-server.mjs';
import { SourceClient } from '../adapters/client.mjs';

const config = { seed: 'isolated-http-regression', topology: 'grid', grid: 5, extentKm: 3,
  scenario: 'S16', hazard: 'none', policy: 'none', backgroundTraffic: 0, postsPerHour: 0,
  packetLoss: 0, logMode: 'full', healthReports: false, recurringNeeds: false };
const wire = value => JSON.parse(JSON.stringify(value));
async function fixture(t, overrides = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'aidscaler-isolated-http-'));
  const lab = await createIsolatedLabServers({ config: { ...config, ...overrides }, observerPort: 0,
    sourcePort: 0, persistCredentials: false, storageDir: directory, projectionMs: 50, tickMs: 20, workBudgetMs: 2 });
  t.after(async () => { await lab.close(); await rm(directory, { recursive: true, force: true }); });
  const source = `http://127.0.0.1:${lab.sourcePort}`, observer = `http://127.0.0.1:${lab.observerPort}`;
  const key = org => Object.entries(lab.actorKeys).find(([, actor]) => actor.org === org)[0];
  const actorHeaders = org => ({ Authorization: `Bearer ${key(org)}`, 'Content-Type': 'application/json' });
  const observerHeaders = { Authorization: `Bearer ${lab.observerKey}`, 'Content-Type': 'application/json' };
  const mutate = async (endpoint, input, expected = 200) => {
    const response = await fetch(observer + endpoint, { method: 'POST', headers: observerHeaders, body: JSON.stringify(input) });
    const result = await response.json(); assert.equal(response.status, expected, JSON.stringify(result)); return result;
  };
  const until = async predicate => {
    const end = Date.now() + 10000;
    while (Date.now() < end) { const result = await predicate(); if (result) return result; await delay(20); }
    throw Error('Materialized source frame did not become available');
  };
  const advance = async target => {
    await lab.advance(target);
    await until(async () => (await lab.runtime.actor('org0')).now >= target);
  };
  return { lab, directory, source, observer, key, actorHeaders, observerHeaders, mutate, until, advance };
}

test('isolated HTTP preserves observer authentication, origin checks, methods and source privacy', async t => {
  const f = await fixture(t);
  assert.equal((await fetch(f.observer + '/missing-static-file.ico')).status, 404);
  assert.equal((await fetch(f.source + '/assets/missing.css')).status, 404);
  assert.equal((await fetch(f.observer + '/')).status, 200, 'a missing static asset cannot crash the server');
  for (const endpoint of ['/api/state', '/api/activity', '/api/metrics', '/api/checkpoint', '/api/viewer/bootstrap', '/api/runtime'])
    assert.equal((await fetch(f.observer + endpoint)).status, 401, endpoint);
  for (const endpoint of ['/api/state', '/api/observer/state'])
    assert.equal((await fetch(f.source + endpoint)).status, 404, endpoint);
  for (const endpoint of ['/api/actor/state', '/api/actor/state?compact=1', '/api/actor/query-result?id=x&version=y'])
    assert.equal((await fetch(f.source + endpoint)).status, 401, endpoint);
  assert.equal((await fetch(f.source + '/api/actor/action', { headers: f.actorHeaders('org0') })).status, 405);
  assert.equal((await fetch(f.source + '/api/feed', { method: 'POST' })).status, 405);
  assert.equal((await fetch(f.observer + '/api/control', { headers: f.observerHeaders })).status, 405);
  const origin = await fetch(f.observer + '/api/control', { method: 'POST',
    headers: { ...f.observerHeaders, Origin: 'https://unapproved.example' }, body: '{}' });
  assert.equal(origin.status, 403);
  assert.equal((await origin.json()).error, 'ORIGIN');
  const login = await fetch(f.observer + '/api/login', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: f.lab.observerKey }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie');
  assert.ok(cookie.includes('HttpOnly')); assert.ok(cookie.includes('SameSite=Strict'));
  assert.equal((await fetch(f.observer + '/api/catalog', { headers: { Cookie: cookie.split(';')[0] } })).status, 200);
  const forbiddenDispatch = await fetch(f.source + '/api/actor/action', { method: 'POST', headers: f.actorHeaders('org0'),
    body: JSON.stringify({ type: 'dispatch', params: {}, idempotencyKey: 'agent-cannot-dispatch' }) });
  assert.equal(forbiddenDispatch.status, 403);
  await f.advance(600000);
  const feed = await (await fetch(f.source + '/api/feed')).json();
  for (const field of ['truthCategory', 'causeEvent', 'private', 'preset'])
    assert.equal(JSON.stringify(feed).includes(`"${field}"`), false, field);
  const html = await (await fetch(f.source + '/feed')).text();
  assert.ok(html.includes('data-post-id'));
  assert.equal(html.includes('"truthCategory"'), false);
  const viewer = await (await fetch(f.observer + '/api/viewer/bootstrap', { headers: f.observerHeaders })).json();
  assert.ok(viewer.map.nodes.length > 0); assert.equal(viewer.frame.sourceUrl, f.source);
  assert.equal((await fetch(f.observer + '/api/viewer/frame?org=org0&perspective=org1', { headers: f.observerHeaders })).status, 400);
});

test('cached public feeds retain exact default and explicit pagination, totals and raw post schema', async t => {
  const f = await fixture(t, { postsPerHour: 300 });
  await f.advance(3600000);
  await f.until(() => f.lab.runtime.timeline.now >= 3600000);
  const full = await f.lab.runtime.request('feed', { cursor: 0, limit: 100 });
  assert.ok(full.total > 100, `test scenario produced ${full.total} posts`);
  for (const limit of [undefined, 0, 7, 30, 50, 100]) {
    const endpoint = '/api/feed' + (limit === undefined ? '' : `?cursor=0&limit=${limit}`);
    const actual = await (await fetch(f.source + endpoint)).json();
    const expected = await f.lab.runtime.request('feed', limit === undefined ? {} : { cursor: 0, limit });
    assert.deepEqual(actual, wire(expected), endpoint);
    assert.ok(actual.posts.every(post => Object.hasOwn(post, 'locationName')),
      'the native public post location name is retained');
    if (actual.nextCursor) {
      const next = await (await fetch(f.source + `/api/feed?cursor=${actual.nextCursor}&limit=${limit ?? 30}`)).json();
      assert.equal(new Set([...actual.posts, ...next.posts].map(post => post.id)).size, actual.posts.length + next.posts.length);
      assert.equal(next.posts[0].id, full.posts[limit ?? 30]?.id ?? next.posts[0].id);
    }
  }
  const timeline = await (await fetch(f.source + '/api/timeline')).json();
  assert.equal(timeline.posts.length, 30); assert.equal(timeline.nextCursor, 30); assert.equal(timeline.total, full.total);
  assert.ok(timeline.posts.every(post => Object.hasOwn(post, 'locationName')));
  const html = await (await fetch(f.source + '/feed')).text();
  const nextLink=html.match(/rel="next" href="([^"]+)"/)?.[1]?.replaceAll('&amp;','&');
  assert.ok(nextLink,'HTML exposes the actual next page');
  const nextURL=new URL(nextLink,f.source);
  assert.equal(nextURL.pathname,'/feed');assert.equal(nextURL.searchParams.get('cursor'),'30');
  assert.equal(nextURL.searchParams.get('limit'),'30');
  const nextHTML=await (await fetch(nextURL)).text();
  const visibleIDs=[...nextHTML.matchAll(/data-post-id="([^"]+)"/g)].map(match=>match[1]);
  const expectedPage=await f.lab.runtime.request('feed',{cursor:30,limit:30});
  assert.deepEqual(visibleIDs,expectedPage.posts.map(post=>post.id),'HTML navigation preserves the native page size and source order');
  for (const pagination of ['cursor=-1', 'limit=1.5', 'since=no'])
    assert.equal((await fetch(f.source + '/api/feed?' + pagination)).status, 400);
});

test('compact source result documents reconstruct exact actor snapshots and remain organization scoped', async t => {
  const f = await fixture(t), client = new SourceClient({ baseUrl: f.source, actorKey: f.key('org0') });
  const issued = await client.action('query', { target: 'map' }, 'isolated-map-query');
  await f.advance(60000);
  await f.until(async () => (await f.lab.runtime.actor('org0')).queries.some(q => q.id === issued.id && q.state === 'ready'));
  const legacy = await client.state();
  const compact = await (await fetch(f.source + '/api/actor/state?compact=1', { headers: f.actorHeaders('org0') })).json();
  assert.equal(compact.compact.version, 1);
  const { compact: metadata, ...hydrated } = compact;
  assert.equal(Object.hasOwn(compact.known, 'map'), false);
  for (const query of hydrated.queries) {
    if (!query.resultRef) continue;
    const { id, version } = query.resultRef;
    const endpoint = '/api/actor/query-result?' + new URLSearchParams({ id, version });
    const response = await fetch(f.source + endpoint, { headers: f.actorHeaders('org0') });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.id, id); assert.equal(result.version, version);
    query.result = result.result; delete query.resultRef;
    assert.equal((await fetch(f.source + endpoint, { headers: f.actorHeaders('org1') })).status, 404);
    assert.equal((await fetch(f.source + endpoint.replace(version, 'incorrect-revision'), { headers: f.actorHeaders('org0') })).status, 409);
  }
  if (metadata.mapQueryId) hydrated.known.map = hydrated.queries.find(q => q.id === metadata.mapQueryId).result;
  assert.deepEqual(hydrated, legacy);
  const queries = await client.queries();
  assert.deepEqual(queries.queries, legacy.queries);
  const other = await (await fetch(f.source + '/api/actor/state?compact=1', { headers: f.actorHeaders('org1') })).json();
  assert.equal(other.queries.some(q => q.id === issued.id), false);
  assert.equal(Object.hasOwn(other.known, 'map'), false);
});

test('source receipts remain idempotent and private team input never becomes public feed data', async t => {
  const f = await fixture(t);
  await f.advance(600000);
  const feed = await f.lab.runtime.request('feed'), post = feed.posts[0];
  assert.ok(post);
  const send = async input => {
    const response = await fetch(f.source + '/api/actor/ingestion', { method: 'POST', headers: f.actorHeaders('org0'), body: JSON.stringify(input) });
    return { status: response.status, data: await response.json() };
  };
  assert.equal((await send({ id: post.id, stage: 'accepted' })).status, 400);
  const download = await send({ id: post.id, version: post.version, stage: 'downloaded' });
  assert.equal(download.status, 200);
  const duplicate = await send({ id: post.id, version: post.version, stage: 'downloaded' });
  assert.deepEqual(duplicate.data, { ...download.data, duplicate: true });
  assert.equal((await send({ id: post.id, version: post.version, stage: 'accepted' })).status, 200);
  const batch = await fetch(f.source + '/api/actor/ingestion/batch', { method: 'POST', headers: f.actorHeaders('org0'),
    body: JSON.stringify({ items: [{ id: post.id, version: post.version, stage: 'accepted' }, { id: 'missing-post', stage: 'downloaded' }] }) });
  assert.equal(batch.status, 200);
  assert.deepEqual((await batch.json()).map(row => row.ok), [true, false]);
  await f.mutate('/api/inject', { type: 'lab_intervention', data: { kind: 'team_note', org: 'org1', text: 'Private radio note for Relief East only.' } });
  await f.advance(1200000);
  const own = await (await fetch(f.source + '/api/actor/inbox', { headers: f.actorHeaders('org1') })).json();
  const foreign = await (await fetch(f.source + '/api/actor/inbox', { headers: f.actorHeaders('org0') })).json();
  assert.ok(own.posts.some(post => post.text.includes('Private radio note')));
  assert.equal(foreign.posts.some(post => post.text.includes('Private radio note')), false);
  const publiclyVisible = await (await fetch(f.source + '/api/feed?limit=100')).json();
  assert.equal(publiclyVisible.posts.some(post => post.text.includes('Private radio note')), false);
});

test('credential and organization revocation apply immediately and source outages keep actor authorization separate', async t => {
  const f = await fixture(t);
  const provisioned = await f.mutate('/api/actors/provision', { org: 'org0', role: 'commander', ttlMs: 1000 }, 201);
  const headers = { Authorization: `Bearer ${provisioned.key}` };
  assert.equal((await fetch(f.source + '/api/actor/state?compact=1', { headers })).status, 200);
  await f.mutate('/api/actors/revoke', { key: provisioned.key });
  assert.equal((await fetch(f.source + '/api/actor/state?compact=1', { headers })).status, 401);
  await f.mutate('/api/inject', { type: 'lab_intervention', data: { kind: 'integration', available: false } });
  assert.equal((await fetch(f.source + '/api/feed')).status, 503);
  assert.equal((await fetch(f.source + '/api/timeline')).status, 503);
  assert.equal((await fetch(f.source + '/api/actor/state', { headers: f.actorHeaders('org0') })).status, 200);
  await f.mutate('/api/inject', { type: 'lab_intervention', data: { kind: 'integration', available: true, revokeOrg: 'org0' } });
  assert.equal((await fetch(f.source + '/api/actor/state', { headers: f.actorHeaders('org0') })).status, 403);
  assert.equal((await fetch(f.source + '/api/actor/query-result?id=unknown&version=unknown', { headers: f.actorHeaders('org0') })).status, 403);
  assert.equal((await fetch(f.source + '/api/actor/state', { headers: f.actorHeaders('org1') })).status, 200);
  assert.equal((await fetch(f.source + '/api/feed')).status, 200);
});
