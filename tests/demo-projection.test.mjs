import test from 'node:test';
import assert from 'node:assert/strict';
import { demoFrame } from '../sources/demo-projection.mjs';

test('spectator traffic keeps actual motion samples separate from aid without exposing private vehicle fields', () => {
  const frame = {
    mapId: 'map-one', runId: 'world-one', now: 12000, playing: true, rate: 10,
    mapState: { organizations: [{ id: 'org0', name: 'Relief North' }, { id: 'old-team', demoRetired: true }],
      buildingFields: ['damage'], buildings: [], edges: [] },
    state: { vehicles: [
      { id: 'aid-one', owner: 'org0', node: 'a', background: false, fuel: 999, driverName: 'Private roster' },
      { id: 'traffic-one', owner: 'org0', node: 'a', background: true, state: 'en_route', edge: 'a-b',
        route: ['a-b'], routeIndex: 0, edgeStart: 10000, edgeEnd: 20000, fuel: 999, capacity: 1 },
      { id: 'retired-aid', owner: 'old-team', node: 'b', background: false },
      { id: 'unshared-aid', owner: 'other-team', node: 'b' },
    ], needs: [], operations: [], ingestion: [] },
  };
  const before = JSON.stringify(frame);
  const result = demoFrame(frame, { sourceInstance: 'source-one', feed: { posts: [] } });
  assert.deepEqual(result.vehicles.map(v => v.id), ['aid-one', 'traffic-one']);
  assert.equal(result.vehicles[0].background, false);
  assert.equal(result.vehicles[1].background, true);
  assert.deepEqual(result.vehicles[1].route, ['a-b']);
  assert.equal(result.vehicles[1].edgeStart, 10000);
  assert.equal(result.vehicles[1].edgeEnd, 20000);
  for (const item of result.vehicles) for (const field of ['fuel', 'capacity', 'driverName'])
    assert.equal(field in item, false, field);
  assert.equal(result.spectatorOnly, true);
  assert.equal(JSON.stringify(frame), before, 'view projection cannot change the simulation');
});
