import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../engine/world.mjs';
import { createCompactActorProjector } from '../sources/compact-actor.mjs';
import { createLabServers } from '../sources/server.mjs';

const config = {
  seed: 'compact-actor-received-equality',
  scenario: 'S23',
  hazard: 'none',
  policy: 'none',
  topology: 'grid',
  grid: 5,
  extentKm: 3,
  backgroundTraffic: 0,
  postsPerHour: 0,
  packetLoss: 0,
  healthReports: false,
  recurringNeeds: false,
  humanCapacity: { profile: 'moderate' },
  queryLatencyMs: 1000,
  logMode: 'full',
};
const wire = (x) => JSON.parse(JSON.stringify(x));
function hydrate(packet) {
  const { compact, ...state } = wire(packet.state),
    results = new Map(packet.results.map((r) => [r.version, wire(r.result)]));
  state.queries = state.queries.map(({ resultRef, ...q }) =>
    resultRef ? { ...q, result: results.get(resultRef.version) } : q,
  );
  if (compact.mapQueryId)
    state.known.map = structuredClone(
      state.queries.find((q) => q.id === compact.mapQueryId).result,
    );
  return state;
}
function query(w, org, target, id) {
  return w.act(
    { id: 'read-' + org, org, role: 'agent' },
    { type: 'query', params: { target }, idempotencyKey: id },
  );
}
test('shared compact projection is exactly the received actor JSON, including restored detached maps and human queues', (t) => {
  let w = new World(config);
  t.after(() => w.close());
  const p = createCompactActorProjector(() => w);
  for (const org of ['org0', 'org1'])
    for (const target of ['map', 'inventory', 'vehicles', 'policy'])
      query(w, org, target, org + target);
  w.advance(10000);
  for (const org of ['org0', 'org1'])
    assert.deepEqual(hydrate(p.project(org)), wire(w.actorView(org)));
  const checkpoint = w.checkpoint();
  w.close();
  w = new World(config, checkpoint);
  for (const org of ['org0', 'org1'])
    assert.deepEqual(hydrate(p.project(org)), wire(w.actorView(org)));
  const before = w.checkpoint();
  p.project('org0');
  p.project('org1');
  assert.deepEqual(w.checkpoint(), before, 'read projection changes no physical state');
});
test('query documents require their owner and exact revision; projection publication caches reset with the world', (t) => {
  let w = new World(config);
  t.after(() => w.close());
  const p = createCompactActorProjector(() => w);
  query(w, 'org0', 'map', 'own-map');
  w.advance(10000);
  const first = p.project('org0', { onlyNewResults: true });
  assert(first.results.length > 0);
  assert.equal(p.project('org0', { onlyNewResults: true }).results.length, 0);
  const ref = first.state.queries.find((q) => q.resultRef).resultRef;
  assert.deepEqual(
    wire(p.queryResult('org0', ref.id, ref.version).result),
    wire(first.results[0].result),
  );
  assert.throws(
    () => p.queryResult('org1', ref.id, ref.version),
    (e) => e.status === 404,
  );
  assert.throws(
    () => p.queryResult('org0', ref.id, 'stale'),
    (e) => e.status === 409,
  );
  w.state.integrations.revokedOrgs.push('org0');
  assert.throws(
    () => p.project('org0'),
    (e) => e.status === 403,
  );
  w.state.integrations.revokedOrgs.length = 0;
  const cp = w.checkpoint();
  w.close();
  w = new World(config, cp);
  assert(p.project('org0', { onlyNewResults: true }).results.length > 0);
});
test('inline source implements compact result references with the same authenticated scope and legacy hydration', async (t) => {
  const lab = await createLabServers({
    config,
    observerPort: 0,
    sourcePort: 0,
    persistCredentials: false,
  });
  t.after(() => lab.close());
  const source = `http://127.0.0.1:${lab.sourcePort}`;
  const headers = (org) => ({
    Authorization: 'Bearer ' + Object.entries(lab.actorKeys).find(([, a]) => a.org === org)[0],
  });
  query(lab.world, 'org0', 'map', 'inline-map');
  lab.world.advance(10000);
  const get = async (path, org) => fetch(source + path, { headers: headers(org) });
  const compact = await (await get('/api/actor/state?compact=1', 'org0')).json(),
    results = [];
  assert.equal(compact.compact.version, 1);
  assert.equal(Object.hasOwn(compact.known, 'map'), false);
  for (const q of compact.queries.filter((q) => q.resultRef)) {
    const params = new URLSearchParams(q.resultRef);
    results.push(await (await get('/api/actor/query-result?' + params, 'org0')).json());
    assert.equal((await get('/api/actor/query-result?' + params, 'org1')).status, 404);
    assert.equal(
      (
        await get(
          '/api/actor/query-result?' + new URLSearchParams({ id: q.id, version: 'old' }),
          'org0',
        )
      ).status,
      409,
    );
  }
  assert.deepEqual(
    hydrate({ state: compact, results }),
    await (await get('/api/actor/state', 'org0')).json(),
  );
  assert.equal(
    (await fetch(source + '/api/actor/query-result?id=anything&version=anything')).status,
    401,
  );
});

test('110 real queries retire result publication keys by owner and republish a later identical map after eviction', (t) => {
  let w = new World({
    ...config,
    grid: 3,
    extentKm: 2,
    queryLatencyMs: 0,
    networkLatencyMs: 0,
    toolQuota: 10000,
  });
  t.after(() => w.close());
  const projector = createCompactActorProjector(() => w);
  query(w, 'org0', 'map', 'retention-map-org0');
  query(w, 'org1', 'map', 'retention-map-org1');
  w.advance(10000);
  const first = projector.project('org0', { onlyNewResults: true });
  const firstMap = first.results.find((result) =>
    first.state.queries.some((q) => q.id === result.id && q.target === 'map'),
  );
  assert.ok(firstMap, 'the original map document was published');
  assert.ok(projector.project('org1', { onlyNewResults: true }).results.length);
  for (let i = 0; i < 110; i++) {
    query(w, 'org0', 'policy', 'retention-policy-' + i);
    w.advance(w.now + 1000);
    projector.project('org0', { onlyNewResults: true });
  }
  const retired = projector.project('org0', { onlyNewResults: true });
  assert.equal(retired.state.queries.length, 100);
  assert.ok(
    !retired.state.queries.some((q) => q.id === firstMap.id),
    'the old query really left the actor read window',
  );
  assert.equal(
    projector.project('org1', { onlyNewResults: true }).results.length,
    0,
    "one organization cannot evict another organization's still-live publication keys",
  );
  const later = query(w, 'org0', 'map', 'retention-map-again');
  w.advance(w.now + 1000);
  const current = projector.project('org0', { onlyNewResults: true });
  assert.ok(
    current.results.some((result) => result.id === later.id && result.version === firstMap.version),
    'a previously evicted content SHA is queued again for a new live reference',
  );
  assert.equal(
    projector.project('org0', { onlyNewResults: true }).results.length,
    0,
    'unchanged live documents are still deduplicated',
  );
  const before = w.checkpoint();
  assert.deepEqual(hydrate(projector.project('org0')), wire(w.actorView('org0')));
  assert.deepEqual(w.checkpoint(), before, 'retention and hydration never mutate physical state');
  w.close();
  w = new World(before.manifest.config, before);
  assert.ok(
    projector.project('org0', { onlyNewResults: true }).results.length,
    'world replacement resets the publication cache',
  );
  assert.deepEqual(hydrate(projector.project('org1')), wire(w.actorView('org1')));
});
