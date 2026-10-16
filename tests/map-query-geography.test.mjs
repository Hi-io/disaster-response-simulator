import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../engine/world.mjs';
import { TAKAMATSU_SOURCE } from '../generators/takamatsu.mjs';

const quiet = { scenario: 'S23', seed: 'received-map-geography', hazard: 'none', policy: 'none',
  mode: 'headless', postsPerHour: 0, backgroundTraffic: 0, packetLoss: 0,
  healthReports: false, recurringNeeds: false };
const actor = { id: 'map-reader', org: 'org0', role: 'agent' };

function queryMap(w) {
  const issued = w.act(actor, { type: 'query', params: { target: 'map' }, idempotencyKey: 'public-map' });
  assert.equal(w.actorView(actor.org).queries.find(q => q.id === issued.id).result, undefined,
    'public geography must still arrive through the scoped query response');
  let steps = 0;
  while (w.actorView(actor.org).queries.find(q => q.id === issued.id).state !== 'ready' && steps++ < 10000)
    assert.ok(w.step());
  const received = w.actorView(actor.org).queries.find(q => q.id === issued.id);
  assert.equal(received.state, 'ready');
  assert.ok(received.completedAt > issued.createdAt);
  return received.result;
}

test('Takamatsu map queries retain public identity, attribution and curved roads without revealing incident truth', () => {
  const w = new World({ ...quiet, topology: 'takamatsu' });
  try {
    const road = w.state.map.edges.find(e => e.points.length > 2),
      building = w.state.map.buildings[0], need = w.state.needs[0];
    road.open = false; road.waterDepth = 1; road.waiting.push('hidden-traffic');
    building.safe = false; building.damage = 0.9; building.occupancy = 123;
    need.privateMarker = 'hidden-demand-state';
    const map = queryMap(w), receivedRoad = map.roads.find(e => e.id === road.id),
      receivedBuilding = map.places.find(p => p.id === building.id);
    assert.equal(map.topology, 'takamatsu'); assert.equal(map.extentM, 10000);
    assert.equal(map.geography.name, TAKAMATSU_SOURCE.name);
    assert.equal(map.geography.attribution, TAKAMATSU_SOURCE.attribution);
    assert.equal(map.geography.source, TAKAMATSU_SOURCE.source);
    assert.deepEqual(map.geography.projection, TAKAMATSU_SOURCE.projection);
    assert.deepEqual(receivedRoad.points, road.points.map(({ x, z }) => ({ x, z })));
    for (const key of ['open', 'waterDepth', 'waiting', 'occupants', 'nextEntryAt', 'version'])
      assert.equal(Object.hasOwn(receivedRoad, key), false, key);
    for (const key of ['safe', 'damage', 'occupancy', 'needs', 'provisioned'])
      assert.equal(Object.hasOwn(receivedBuilding, key), false, key);
    assert.equal(Object.hasOwn(map, 'needs'), false);
    assert.equal(JSON.stringify(map).includes('hidden-demand-state'), false);
    assert.equal(JSON.stringify(map).includes('hidden-traffic'), false);
    assert.equal(w.actorView('org1').queries.some(q => q.id === w.state.queries[0].id), false);
    receivedRoad.points[0].x += 1;
    map.geography.name = 'Changed by client';
    assert.notEqual(receivedRoad.points[0].x, road.points[0].x);
    assert.equal(w.state.map.geography.name, TAKAMATSU_SOURCE.name);
  } finally { w.close(); }
});

test('procedural map queries expose their actual extent without inventing geographic provenance', () => {
  const w = new World({ ...quiet, topology: 'regional', grid: 3, extentKm: 6 });
  try {
    const map = queryMap(w);
    assert.equal(map.topology, 'regional'); assert.equal(map.extentM, 6000);
    assert.equal(Object.hasOwn(map, 'geography'), false);
    assert.equal(map.nodes.length, w.state.map.nodes.length);
    assert.equal(map.roads.length, w.state.map.edges.length);
  } finally { w.close(); }
});
