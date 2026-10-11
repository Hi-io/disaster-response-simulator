import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../engine/world.mjs';
import { route } from '../generators/map.mjs';
import { replay } from '../evaluation/runs.mjs';
import { pointAlong } from '../viewer/geometry.js';

const quiet = {
  hazard: 'none',
  policy: 'none',
  postsPerHour: 0,
  backgroundTraffic: 0,
  packetLoss: 0,
};
const small = { ...quiet, topology: 'grid', grid: 5, extentKm: 1, populationPerSector: 100 };
let actionKey = 0;
const act = (w, type, params, org = 'org0') =>
  w.act(
    { id: 'owner-' + org, org, role: 'commander' },
    {
      type,
      params,
      idempotencyKey: `${type}-${++actionKey}`,
    },
  );

test('the default region has irregular roads, exactly three river crossings and hours-long detours', () => {
  const w = new World(quiet),
    map = w.state.map,
    v = { weightKg: 3500, speedMps: 12 };
  assert.ok(map.extentM >= 100000);
  assert.equal(map.crossings.length, 3);
  assert.ok(new Set(map.edges.map((e) => e.speedMps)).size >= 4);
  assert.ok(new Set(map.edges.map((e) => e.capacity)).size >= 4);
  assert.ok(map.edges.some((e) => e.points && e.points.length === 3));
  const middle = map.crossings[1],
    before = route(map, middle.from, middle.to, v);
  w.inject('road_change', { edge: middle.edges[0], open: false, reason: 'bridge_damage' });
  assert.ok(middle.edges.every((id) => !w.edge(id).open));
  const after = route(map, middle.from, middle.to, v);
  assert.ok(after.freeTimeMs - before.freeTimeMs > 4 * 3600000);
  for (const crossing of map.crossings)
    w.inject('road_change', { edge: crossing.edges[0], open: false });
  assert.equal(route(map, middle.from, middle.to, v), null);
  assert.deepEqual(w.invariants(), []);
});
test('procedural banks are connected, while a dead-end community can really be cut off', () => {
  for (const seed of ['a', 'b', 'c', 'd', 'e']) {
    const w = new World({ ...quiet, seed, grid: 12, extentKm: 100 }),
      m = w.state.map;
    const adjacency = new Map(m.nodes.map((n) => [n.id, []]));
    for (const e of m.edges) adjacency.get(e.from).push(e.to);
    const reached = new Set([m.nodes[0].id]),
      queue = [m.nodes[0].id];
    while (queue.length) {
      const id = queue.pop();
      for (const next of adjacency.get(id))
        if (!reached.has(next)) {
          reached.add(next);
          queue.push(next);
        }
    }
    assert.equal(reached.size, m.nodes.length);
    const leaf = m.nodes.find((n) => adjacency.get(n.id).length === 1);
    assert.ok(leaf);
    const e = m.edges.find((e) => e.from === leaf.id);
    e.open = false;
    assert.equal(route(m, leaf.id, e.to, { weightKg: 1000, speedMps: 12 }), null);
  }
});
test('100 heterogeneous concurrent needs are generated even on a small map', () => {
  const w = new World({ ...small, scenario: 'S09' }),
    cases = w.state.needs.filter((n) => n.id.startsWith('need-case-'));
  assert.equal(cases.length, 100);
  assert.equal(new Set(cases.map((n) => n.id)).size, 100);
  assert.equal(new Set(cases.map((n) => n.type)).size, 5);
  assert.deepEqual(w.invariants(), []);
});
test('the fifth independent partner has a distinct base and does not use the platform', () => {
  const w = new World({ ...quiet, scenario: 'S19' }),
    orgs = w.state.map.organizations;
  assert.equal(orgs.length, 5);
  assert.equal(new Set(orgs.map((o) => o.node)).size, 5);
  assert.equal(orgs[4].usesPlatform, false);
});
test('health deterioration is dynamic and deaths preserve total people', () => {
  const w = new World({
    ...small,
    initialWaterHours: 0,
    waterCriticalHours: 1,
    waterFatalityBpPerHour: 5000,
  });
  w.advance(3600000);
  assert.equal(w.populationMetrics().deceased, 0);
  w.advance(4 * 3600000);
  const m = w.populationMetrics();
  assert.ok(m.deceased > 0);
  assert.ok(m.waterDeficitPersonHours > 0);
  assert.equal(m.alive + m.deceased, 2500);
  assert.equal(m.clinicallyValidated, false);
  assert.deepEqual(w.invariants(), []);
});
test('physical water receipt improves survival; a proposal or deadline does not', () => {
  const config = {
    ...small,
    initialWaterHours: 0,
    waterCriticalHours: 1,
    waterFatalityBpPerHour: 5000,
  };
  const untreated = new World(config),
    treated = new World(config),
    deadlineOnly = new World(config);
  const need = treated.need('need-water-main');
  treated.serveNeed(need.id, 600);
  deadlineOnly.updateNeed(need.id, { deadline: 1 });
  for (const w of [untreated, treated, deadlineOnly]) w.advance(4 * 3600000);
  assert.ok(treated.populationMetrics().deceased < untreated.populationMetrics().deceased);
  assert.equal(deadlineOnly.populationMetrics().deceased, untreated.populationMetrics().deceased);
  for (const w of [untreated, treated, deadlineOnly]) assert.deepEqual(w.invariants(), []);
});
test('a real dispatched shipment, rather than planned cargo, changes community intake', () => {
  const w = new World({
    ...small,
    initialWaterHours: 0,
    waterCriticalHours: 1,
    waterFatalityBpPerHour: 5000,
  });
  const op = act(w, 'dispatch', {
    resource: 'r-org0-water',
    vehicle: 'v-org0-0',
    need: 'need-water-main',
    quantity: 300,
  });
  const c = w.healthForSector(w.building(w.need('need-water-main').building).sector)[0];
  assert.equal(c.health.receivedWaterMl, 0);
  w.advance(1800000);
  assert.equal(w.state.operations.find((x) => x.id === op.id).state, 'completed');
  assert.equal(c.health.receivedWaterMl, 300000);
  assert.deepEqual(w.invariants(), []);
});
test('food shortages, exposure and urgent injuries have separate outcome measures', () => {
  const w = new World({
    ...small,
    initialFoodHours: 0,
    foodCriticalHours: 1,
    foodFatalityBpPerHour: 5000,
    temperatureC: 0,
    exposureCriticalHours: 1,
    injuryCriticalHours: 1,
  });
  w.inject('damage', { building: 'b12', severity: 3, cause: 'earthquake' });
  w.advance(4 * 3600000);
  const m = w.populationMetrics();
  assert.ok(m.foodDeficitPersonHours > 0);
  assert.ok(m.communities.some((c) => c.exposureHours > 0));
  const affected = m.communities.find((c) => c.sector === 's12');
  assert.ok(affected.deceased > 0);
  assert.ok(
    affected.deathsByCause.food + affected.deathsByCause.injury + affected.deathsByCause.exposure >
      0,
  );
  assert.deepEqual(w.invariants(), []);
});
test('community health stays private until a delayed authorized observation arrives', () => {
  const w = new World({ ...small, initialWaterHours: 0, waterCriticalHours: 1 });
  w.advance(2 * 3600000);
  const sector = w.building(w.need('need-water-main').building).sector;
  assert.deepEqual(w.actorView('org0').known.population, {});
  assert.equal(JSON.stringify(w.publicFeed()).includes('deathsByCause'), false);
  act(w, 'verify', { target: 'need', id: 'need-water-main', method: 'radio' });
  w.advance(3 * 3600000);
  assert.ok(w.actorView('org0').known.population[sector]);
  assert.deepEqual(w.actorView('org1').known.population, {});
});
test('health, geography, interventions and checkpoint continuation reproduce exactly', () => {
  const w = new World({
    ...quiet,
    grid: 12,
    extentKm: 120,
    initialWaterHours: 0,
    waterCriticalHours: 1,
    waterFatalityBpPerHour: 5000,
  });
  w.inject('damage', { building: 'b70', severity: 2, cause: 'earthquake' });
  w.advance(2 * 3600000);
  const restored = new World(w.config, w.checkpoint());
  w.advance(4 * 3600000);
  restored.advance(4 * 3600000);
  assert.equal(w.stateHash(), restored.stateHash());
  const result = replay(w.checkpoint());
  assert.equal(result.matches, true);
  assert.deepEqual(w.invariants(), []);
});

test('a crew repairs both directions of a scarce crossing after physical work', () => {
  const w = new World({ ...quiet, grid: 12, extentKm: 100, setupMs: 1000 });
  const crossing = w.state.map.crossings[1];
  w.inject('road_change', { edge: crossing.edges[0], open: false, reason: 'bridge_damage' });
  const v = w.vehicle('v-org0-0');
  v.node = crossing.from;
  const t = act(w, 'repair', { edge: crossing.edges[0], engineering: true });
  assert.ok(crossing.edges.every((id) => !w.edge(id).open));
  w.advance(10000);
  assert.equal(w.state.repairs.find((r) => r.id === t.id).state, 'completed');
  assert.ok(crossing.edges.every((id) => w.edge(id).open));
  assert.deepEqual(w.invariants(), []);
});

test('the engine and both observers use the curved road instead of cutting across terrain', () => {
  const w = new World({ ...quiet, grid: 12, extentKm: 100 });
  const e = w.state.map.edges.find((e) => !e.bridge && e.points?.length === 3);
  const v = w.vehicle('v-org0-0');
  Object.assign(v, { node: e.from, edge: e.id, edgeStart: 0, edgeEnd: 1000 });
  w.now = 500;
  const point = w.vehiclePosition(v);
  assert.deepEqual(point, pointAlong(e.points, 0.5));
  const a = w.node(e.from),
    b = w.node(e.to);
  assert.ok(Math.hypot(point.x - (a.x + b.x) / 2, point.z - (a.z + b.z) / 2) > 1);
});

test('a fulfilled water request can recur as supplies are consumed, without becoming instant actor knowledge', () => {
  const w = new World({
    ...small,
    initialWaterHours: 0,
    waterMlPerPersonDay: 30000,
    waterFatalityBpPerHour: 0,
    injuryFatalityBpPerHour: 0,
  });
  const n = w.need('need-water-main');
  for (const org of ['org0', 'org2'])
    act(
      w,
      'dispatch',
      {
        resource: `r-${org}-water`,
        vehicle: `v-${org}-0`,
        need: n.id,
        quantity: 300,
      },
      org,
    );
  w.advance(1800000);
  assert.equal(n.served, n.quantity);
  w.advance(6 * 3600000);
  const recurring = w.state.needs.find((need) => need.recurring && need.type === 'water');
  assert.ok(recurring);
  assert.ok(recurring.quantity > 0);
  assert.equal(w.actorView('org0').known.needs[recurring.id], undefined);
  assert.equal(replay(w.checkpoint()).matches, true);
  assert.deepEqual(w.invariants(), []);
});

test('a community with no survivors remains represented in received population observations', () => {
  const w = new World({
    ...small,
    initialWaterHours: 0,
    waterCriticalHours: 0,
    waterFatalityBpPerHour: 10000,
  });
  w.advance(48 * 3600000);
  const sector = w.building(w.need('need-water-main').building).sector;
  const records = w.populationSnapshot(sector).communities;
  assert.equal(records.length, 1);
  assert.equal(records[0].alive, 0);
  assert.equal(records[0].deceased, 100);
  assert.deepEqual(w.invariants(), []);
});
