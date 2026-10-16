import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../engine/world.mjs';
import { createResource } from '../engine/ledger.mjs';

const config = { seed: 'population-event-local-lookups', topology: 'grid', grid: 3,
  extentKm: 1, hazard: 'none', policy: 'none', postsPerHour: 0, backgroundTraffic: 0,
  packetLoss: 0, observationRate: 1, healthTickMs: 60000, healthReports: false,
  recurringNeeds: false, durationMs: 3 * 3600000, temperatureC: 0,
  waterFatalityBpPerHour: 0, foodFatalityBpPerHour: 0,
  exposureFatalityBpPerHour: 0, injuryFatalityBpPerHour: 0 };

function fixture(overrides = {}) {
  const w = new World({ ...config, ...overrides });
  const community = w.state.cohorts[0], building = w.building('b0');
  // Declared initial unit-test state. Public observations are not used to write
  // a controller's answer, and no aid or admission is credited by this fixture.
  Object.assign(building, { use: 'shelter', state: 'operating', capacity: 100 });
  Object.assign(community.health, { affected: true, unsheltered: true, injured: 3 });
  const crew = createResource('population-care-extra', 'org0', community.node, 'staff', 9);
  w.state.resources.push(crew);
  return { w, community, building, crew };
}

test('each health tick reads current co-located crews, reservations and shelter state', t => {
  const { w, community: c, building, crew } = fixture(); t.after(() => w.close());
  w.advance(60000);
  assert.equal(c.health.injured, 2, '15 available staff provide one unit of care per minute');
  assert.equal(c.health.exposureMs, 0);
  crew.node = 'n1'; building.state = 'candidate';
  w.advance(120000);
  assert.equal(c.health.injured, 2, 'a moved crew cannot keep providing care at its old node');
  assert.equal(c.health.careCarry, 0.4);
  assert.equal(c.health.exposureMs, 60000, 'an earlier shelter lookup cannot remain operating');
  crew.node = c.node; crew.reserved = 9;
  w.advance(180000);
  assert.equal(c.health.injured, 2, 'reserved personnel are not counted as free care');
  assert.equal(c.health.careCarry, 0.8);
  assert.equal(c.health.exposureMs, 120000);
  crew.reserved = 0; building.state = 'operating';
  w.advance(240000);
  assert.equal(c.health.injured, 1);
  assert.equal(c.health.exposureMs, 60000, 'current shelter availability reduces elapsed exposure');
  assert.deepEqual(w.invariants(), []);
});

test('indexed resupply retains sector ordering, excludes dead cohorts and does not duplicate open requests', t => {
  const w = new World({ ...config, recurringNeeds: true, resupplyReviewHours: 1,
    resupplyHorizonHours: 2, initialWaterHours: 0, initialFoodHours: 0 });
  t.after(() => w.close());
  for (const c of w.state.cohorts) Object.assign(c.health,
    { affected: true, waterDisrupted: true, foodDisrupted: true });
  const dead = w.state.cohorts[0]; dead.deceased = dead.population; dead.population = 0;
  w.advance(3600000);
  const needs = w.state.needs.map(n => ({ id: n.id, sector: w.building(n.building).sector, type: n.type }));
  assert.equal(needs.length, 16, 'eight live sectors retain exactly one open water and food request each');
  assert.ok(needs.every(n => n.sector !== dead.sector));
  assert.equal(new Set(needs.map(n => n.sector + ':' + n.type)).size, 16);
  const expected = w.state.map.sectors.slice(1).flatMap(s => ['water', 'food']
    .filter(type => !(s.id === w.building(w.need('need-water-main').building).sector && type === 'water'))
    .map(type => s.id + ':' + type));
  assert.deepEqual(needs.slice(1).map(n => n.sector + ':' + n.type), expected);
  w.advance(7200000);
  assert.deepEqual(w.state.needs.map(n => n.id), needs.map(n => n.id));
  assert.equal(w.populationSnapshot(dead.sector).communities[0].alive, 0,
    'a dead community remains observable rather than disappearing from its sector');
  for (const n of w.state.needs.filter(n => n.recurring))
    assert.equal(w.actorView('org0').known.needs[n.id], undefined, 'generated requests are not instant actor knowledge');
  assert.deepEqual(w.invariants(), []);
});

test('restoring into a previously advanced world rebuilds all population lookup context exactly', t => {
  const { w, crew, building } = fixture({ recurringNeeds: true, resupplyReviewHours: 1 });
  t.after(() => w.close());
  w.advance(60000);
  crew.node = 'n1'; building.state = 'candidate';
  const checkpoint = w.checkpoint(), restored = new World(w.config, checkpoint);
  t.after(() => restored.close());
  w.advance(240000);
  w.restore(checkpoint);
  w.advance(7200000); restored.advance(7200000);
  assert.equal(w.stateHash(), restored.stateHash());
  assert.deepEqual(w.populationMetrics(), restored.populationMetrics());
  assert.deepEqual(w.invariants(), []);
});

test('a failed population handler releases transient indexes before an external population update', t => {
  const { w, community: c, building, crew } = fixture(); t.after(() => w.close());
  w.logSink = event => { if (event.type === 'community_health') throw Error('test sink unavailable'); };
  assert.throws(() => w.advance(60000), /test sink unavailable/);
  w.logSink = null;
  crew.node = 'n1'; w.resource('r-org0-staff').reserved = 6; building.state = 'candidate';
  w.advancePopulation(c, 120000);
  assert.equal(c.health.injured, 2, 'an earlier event cache must not keep treating people after its failure');
  assert.equal(c.health.exposureMs, 60000);
});
