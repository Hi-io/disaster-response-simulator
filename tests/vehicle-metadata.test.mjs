import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../engine/world.mjs';

test('received vehicle metadata distinguishes civilian traffic from the response fleet', t => {
  const world = new World({ scenario: 'S01', policy: 'none', topology: 'grid',
    grid: 3, extentKm: 1, hazard: 'none', seed: 'vehicle-audience-metadata',
    postsPerHour: 0, backgroundTraffic: 2, packetLoss: 0, networkLatencyMs: 1000,
    healthReports: false, recurringNeeds: false });
  t.after(() => world.close());

  const own = world.vehicle('v-org0-0');
  assert.equal(world.vehicleView(own).background, false);
  assert.equal(world.actorView('org0').known.vehicles[own.id].background, false);

  world.advance(600000);
  const traffic = world.vehicle('traffic-0');
  assert.equal(traffic.owner, 'org0', 'source ownership conventions are preserved');
  assert.equal(world.vehicleView(traffic).background, true);
  assert.equal(world.actorView('org0').known.vehicles[traffic.id].background, true,
    'ordinary delayed telemetry carries the audience metadata');

  const before = structuredClone(traffic);
  world.vehicleView(traffic);
  assert.deepEqual(traffic, before, 'reading metadata does not mutate physical state');

  const query = world.act({ id: 'fleet-reviewer', org: 'org0', role: 'agent' }, {
    type: 'query', params: { target: 'vehicles' }, idempotencyKey: 'fleet-metadata' });
  world.advance(world.now + 60000);
  const result = world.actorView('org0').queries.find(item => item.id === query.id).result;
  assert.ok(result.some(vehicle => vehicle.id === own.id));
  assert.ok(result.every(vehicle => vehicle.background === false),
    'the existing operational vehicle query still excludes civilian traffic');
});
