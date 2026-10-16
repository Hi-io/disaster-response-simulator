import test from 'node:test';
import assert from 'node:assert/strict';
import { roadCorridors, corridorTrafficLevel, routeOverlayKey, visibleRoutePlans, fixedTopologyProfile } from '../viewer/map-layout.js';
import { mapVisualKey } from '../viewer/display.js';

const edge = (id, from, to, extras = {}) => ({ id, from, to, open: true, capacity: 1, occupants: [], waiting: [], ...extras });

test('one-way roads survive either ID orientation and opposite directions share one drawing', () => {
  const edges = [edge('west', 'n9', 'n1'), edge('north', 'n2', 'n3'), edge('south', 'n3', 'n2')];
  const groups = roadCorridors(edges);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].edge.id, 'west', 'a lone descending one-way edge must not disappear');
  assert.deepEqual(groups[0].edges.map(e => e.id), ['west']);
  assert.deepEqual(groups[1].edges.map(e => e.id), ['north', 'south']);
  assert.equal(edges.length, 3, 'drawing deduplication must preserve the directed routing graph');
});

test('explicit parallel corridors retain separate geometry while one OSM way keeps all segments', () => {
  const edges = [
    edge('a', 'n9', 'n1', { corridor: 'main' }), edge('ar', 'n1', 'n9', { corridor: 'main' }),
    edge('b', 'n9', 'n1', { corridor: 'parallel' }),
    edge('c', 'n1', 'n2', { corridor: 'main' }),
  ];
  const groups = roadCorridors(edges);
  assert.equal(groups.length, 3);
  assert.deepEqual(groups.map(g => g.edges.map(e => e.id)), [['a', 'ar'], ['b'], ['c']]);
});

test('traffic reflects every direction of its own corridor without leaking hidden closures', () => {
  const edges = [edge('forward', 'a', 'b'), edge('reverse', 'b', 'a', { open: false }), edge('parallel', 'a', 'b')];
  const index = new Map(edges.map(e => [e.id, e]));
  assert.equal(corridorTrafficLevel(['forward', 'reverse'], index), 'closed');
  assert.equal(corridorTrafficLevel(['parallel'], index), 'clear');
  assert.equal(corridorTrafficLevel(['forward', 'reverse'], index, {}, false), 'unknown');
  assert.equal(corridorTrafficLevel(['forward', 'reverse'], index, { reverse: { open: false } }, false), 'closed');
  index.get('reverse').open = true;
  index.get('reverse').waiting.push('traffic-0');
  assert.equal(corridorTrafficLevel(['forward', 'reverse'], index), 'heavy');
});

const scene = () => ({ runId: 'same', state: {
  map: { hash: 'graph', buildings: [{ id: 'b', state: 'intact', damage: 0 }], edges: [edge('a', 'n0', 'n1'), edge('b', 'n1', 'n2')], sectors: [], organizations: [] },
  vehicles: [{ id: 'truck', state: 'en_route', route: ['a', 'b'], routeIndex: 0 }],
  needs: [], hazards: [], cohorts: [], sharingEvents: [],
  observations: { org0: { needs: {}, buildings: {}, edges: {}, vehicles: { truck: { at: 0, node: 'n0' } } } },
} });

test('crossing an edge updates only route overlay; real map changes still invalidate geometry', () => {
  const snapshot = scene();
  const staticKey = mapVisualKey(snapshot, 'truth', { includeRoutes: false });
  const routeKey = routeOverlayKey(snapshot);
  const legacyKey = mapVisualKey(snapshot);
  snapshot.state.vehicles[0].routeIndex = 1;
  assert.equal(mapVisualKey(snapshot, 'truth', { includeRoutes: false }), staticKey);
  assert.notEqual(routeOverlayKey(snapshot), routeKey);
  assert.notEqual(mapVisualKey(snapshot), legacyKey, 'legacy mapVisualKey callers retain their contract');
  assert.deepEqual(visibleRoutePlans(snapshot), [{ id: 'truck', edges: ['b'] }]);
  snapshot.state.map.buildings[0].damage = 2;
  assert.notEqual(mapVisualKey(snapshot, 'truth', { includeRoutes: false }), staticKey);
});

test('reroutes and terminal status replace overlays while actor scope does not reveal them', () => {
  const snapshot = scene();
  const hidden = routeOverlayKey(snapshot, 'org0');
  const previous = routeOverlayKey(snapshot);
  snapshot.state.vehicles[0].route = ['new-private-road'];
  assert.notEqual(routeOverlayKey(snapshot), previous);
  assert.equal(routeOverlayKey(snapshot, 'org0'), hidden);
  assert.deepEqual(visibleRoutePlans(snapshot, 'org0'), []);
  snapshot.state.vehicles[0].state = 'completed';
  assert.deepEqual(visibleRoutePlans(snapshot), []);
});

test('geographic controls use fixed supported dimensions and procedural maps stay adjustable', () => {
  assert.deepEqual([fixedTopologyProfile('honmura').grid, fixedTopologyProfile('honmura').extentKm], [7, 1]);
  assert.deepEqual([fixedTopologyProfile('takamatsu').grid, fixedTopologyProfile('takamatsu').extentKm], [66, 10]);
  assert.equal(fixedTopologyProfile('grid'), null);
  assert.equal(fixedTopologyProfile('regional'), null);
});
