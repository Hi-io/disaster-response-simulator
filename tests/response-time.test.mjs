import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../engine/world.mjs';
import { evaluate } from '../evaluation/metrics.mjs';

const config = {
  policy: 'none',
  hazard: 'none',
  scenario: 'S23',
  grid: 5,
  extentKm: 2,
  topology: 'grid',
  postsPerHour: 0,
  backgroundTraffic: 0,
  healthReports: false,
  recurringNeeds: false,
  durationMs: 3600000,
};

test('first useful physical aid and sufficient service have distinct timestamps and censoring', () => {
  const w = new World(config),
    n = w.need('need-water-main');
  w.advance(60000);
  w.serveNeed(n.id, 0);
  assert.equal(n.firstServiceAt, null);
  w.advance(120000);
  // Arithmetic measurement fixture: serveNeed is the actual physical service
  // callback. This fixture is not reported as an operational truck episode.
  w.serveNeed(n.id, 100);
  let result = evaluate(w);
  assert.equal(n.firstServiceAt, 120000);
  assert.equal(n.completedAt, null);
  assert.equal(result.response.firstUsefulServiceMs.p50, 120000);
  assert.equal(result.response.firstUsefulCompleted, 1);
  assert.equal(result.response.firstUsefulRightCensored, 0);
  assert.equal(result.response.completed, 0);
  assert.equal(result.response.rightCensored, 1);
  assert.equal(result.response.sufficientServiceMs.p50, null);
  assert.equal(result.perCommunity[0].firstServiceAt, 120000);
  assert.equal(result.perCommunity[0].sufficientServiceAt, null);
  w.advance(300000);
  w.serveNeed(n.id, 500);
  result = evaluate(w);
  assert.equal(n.firstServiceAt, 120000);
  assert.equal(n.completedAt, 300000);
  assert.equal(result.response.sufficientServiceMs.p50, 300000);
  assert.equal(result.response.needToServiceMs.p50, 300000);
  assert.equal(result.response.rightCensored, 0);
  assert.equal(result.response.completed, 1);
});

test('retired zero demand is neither instant useful service nor a successful cohort', () => {
  const w = new World(config),
    retired = w.need('need-water-main'),
    building = w.state.map.buildings.find((b) => b.use === 'residential');
  w.updateNeed(retired.id, { quantity: 0 });
  retired.completedAt = 0;
  w.serveNeed(retired.id, 10);
  const active = w.addNeed({
    id: 'unfinished-positive',
    building: building.id,
    type: 'food',
    unit: 'portions',
    quantity: 30,
    deadline: 900000,
    silent: true,
  });
  w.advance(60000);
  const result = evaluate(w);
  assert.equal(retired.firstServiceAt, null);
  assert.equal(result.response.eligibleNeeds, 1);
  assert.equal(result.response.excludedNonpositiveNeeds, 1);
  assert.equal(result.response.completed, 0);
  assert.equal(result.response.firstUsefulCompleted, 0);
  assert.equal(result.response.firstUsefulRightCensored, 1);
  assert.equal(result.response.rightCensored, 1);
  assert.equal(result.response.firstUsefulServiceMs.p50, null);
  assert.equal(result.response.sufficientServiceMs.p50, null);
  assert.equal(result.services.water.onTime, 0);
  assert.equal(result.subgroups.silent.true.food.needs, 1);
  assert.equal(result.perCommunity.find((n) => n.id === active.id).firstServiceAt, null);
});

test('first physical service survives checkpoint continuation without resetting on the next receipt', () => {
  const a = new World(config),
    n = a.need('need-water-main');
  a.advance(60000);
  a.serveNeed(n.id, 200);
  const b = new World(config, a.checkpoint());
  assert.equal(b.need(n.id).firstServiceAt, 60000);
  for (const w of [a, b]) {
    w.advance(180000);
    w.serveNeed(n.id, 400);
  }
  assert.equal(a.stateHash(), b.stateHash());
  assert.equal(evaluate(b).response.firstUsefulServiceMs.p50, 60000);
  assert.equal(evaluate(b).response.sufficientServiceMs.p50, 180000);
});
