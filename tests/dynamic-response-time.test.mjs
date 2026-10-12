import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../engine/world.mjs';
import { evaluate } from '../evaluation/metrics.mjs';
import { replay } from '../evaluation/runs.mjs';

const config = {
  policy: 'none', hazard: 'none', scenario: 'S23', grid: 5, extentKm: 2,
  topology: 'grid', postsPerHour: 0, backgroundTraffic: 0,
  healthReports: false, recurringNeeds: false, durationMs: 3600000,
};
const current = (w) => w.need('need-water-main');

test('constructor-time scenario demand defines the initial episode before time starts', () => {
  const w = new World({ ...config, scenario: 'S15' }), n = current(w);
  assert.equal(n.quantity, 100);
  assert.equal(n.demandEpisodes[0].quantity, 100);
  assert.equal(n.demandEpisodes[0].peakQuantity, 100);
});

// Arithmetic measurement fixtures exercise the physical service callback. They
// do not assert that a truck episode or any candidate controller delivered aid.
test('growth after coverage starts a new response clock without rewriting successful history', () => {
  const w = new World(config), n = current(w);
  w.advance(60000);
  w.serveNeed(n.id, 600);
  assert.equal(n.completedAt, 60000);
  w.advance(120000);
  w.updateNeed(n.id, { quantity: 800 });
  assert.equal(n.createdAt, 0);
  assert.equal(n.responseCreatedAt, 120000);
  assert.equal(n.firstServiceAt, null);
  assert.equal(n.completedAt, null);
  let result = evaluate(w);
  assert.equal(result.services.water.pending, 200);
  assert.equal(result.services.water.onTime, 0);
  assert.equal(result.response.completed, 0);
  assert.equal(result.response.firstUsefulRightCensored, 1);
  assert.equal(result.response.episodes.completed, 1);
  assert.equal(result.response.episodes.rightCensored, 1);
  assert.equal(result.response.episodes.perEpisode[0].sufficientServiceAt, 60000);
  assert.equal(result.response.episodes.perEpisode[0].quantity, 600);
  assert.equal(result.response.episodes.perEpisode[1].quantity, 200);
  assert.equal(result.response.episodes.perEpisode[1].unit, 'L');
  w.advance(180000);
  w.serveNeed(n.id, 80);
  result = evaluate(w);
  assert.equal(result.response.firstUsefulServiceMs.p50, 60000);
  assert.equal(result.response.sufficientServiceMs.p50, null);
  w.advance(240000);
  w.serveNeed(n.id, 120);
  result = evaluate(w);
  assert.equal(result.response.sufficientServiceMs.p50, 120000);
  assert.equal(result.response.firstUsefulServiceMs.p50, 60000);
  assert.equal(result.response.episodes.completed, 2);
  assert.equal(result.response.episodes.perEpisode[0].firstServiceAt, 60000);
  assert.equal(result.response.episodes.perEpisode[1].firstServiceAt, 180000);
  assert.equal(result.response.episodes.perEpisode[1].uncoveredUnitMs, 19200000);
});

test('growth while still outstanding enlarges the same episode and keeps partial service history', () => {
  const w = new World(config), n = current(w);
  w.advance(60000);
  w.serveNeed(n.id, 100);
  w.advance(120000);
  w.updateNeed(n.id, { quantity: 800 });
  assert.equal(n.demandEpisodes.length, 1);
  assert.equal(n.responseCreatedAt, 0);
  assert.equal(n.firstServiceAt, 60000);
  assert.equal(n.completedAt, null);
  assert.equal(n.demandEpisodes[0].quantity, 800);
  w.advance(180000);
  w.serveNeed(n.id, 700);
  const result = evaluate(w);
  assert.equal(result.response.sufficientServiceMs.p50, 180000);
  assert.equal(result.response.episodes.eligible, 1);
  assert.equal(result.services.water.served, 800);
});

test('retiring an unfinished request is censored at withdrawal, never successful physical service', () => {
  const w = new World(config), n = current(w);
  w.advance(60000);
  w.serveNeed(n.id, 100);
  w.advance(120000);
  w.updateNeed(n.id, { quantity: 0 });
  w.advance(180000);
  w.serveNeed(n.id, 0);
  const result = evaluate(w), history = result.response.episodes.perEpisode[0];
  assert.equal(n.completedAt, null);
  assert.equal(result.response.eligibleNeeds, 0);
  assert.equal(result.response.excludedNonpositiveNeeds, 1);
  assert.equal(result.response.episodes.completed, 0);
  assert.equal(result.response.episodes.retired, 1);
  assert.equal(result.response.episodes.rightCensored, 1);
  assert.equal(history.peakQuantity, 600);
  assert.equal(history.sufficientCensored, true);
  assert.equal(history.censoredAt, 120000);
  assert.equal(history.timeToSufficientServiceMs, 120000);
  assert.equal(history.firstServiceAt, 60000);
  assert.equal(history.uncoveredUnitMs, 66000000);
});

test('a positive-demand correction below prior deliveries is not counted as a new physical success', () => {
  const w = new World(config), n = current(w);
  w.advance(60000);
  w.serveNeed(n.id, 100);
  w.advance(120000);
  w.updateNeed(n.id, { quantity: 50 });
  const result = evaluate(w);
  assert.equal(n.completedAt, null);
  assert.equal(result.services.water.pending, 0);
  assert.equal(result.services.water.onTime, 0);
  assert.equal(result.response.eligibleNeeds, 0);
  assert.equal(result.response.excludedRetiredPositiveNeeds, 1);
  assert.equal(result.response.episodes.retired, 1);
});

test('retired demand can reopen and only new outstanding demand needs a new arrival', () => {
  const w = new World(config), n = current(w);
  w.updateNeed(n.id, { quantity: 0 });
  w.advance(60000);
  w.serveNeed(n.id, 50);
  assert.equal(n.firstServiceAt, null);
  w.advance(120000);
  w.updateNeed(n.id, { quantity: 80 });
  assert.equal(n.responseCreatedAt, 120000);
  assert.equal(n.demandEpisodes[1].quantity, 30);
  assert.equal(n.completedAt, null);
  w.advance(180000);
  w.serveNeed(n.id, 30);
  const result = evaluate(w);
  assert.equal(result.response.firstUsefulServiceMs.p50, 60000);
  assert.equal(result.response.sufficientServiceMs.p50, 60000);
  assert.equal(result.response.episodes.eligible, 2);
  assert.equal(result.response.episodes.retired, 1);
  assert.equal(result.response.episodes.completed, 1);
});

test('existing oversupply covers a smaller increase; a later genuine shortfall reopens', () => {
  const w = new World(config), n = current(w);
  w.advance(60000);
  w.serveNeed(n.id, 800);
  w.advance(120000);
  w.updateNeed(n.id, { quantity: 700 });
  assert.equal(n.demandEpisodes.length, 1);
  assert.equal(n.completedAt, 60000);
  assert.equal(evaluate(w).services.water.pending, 0);
  w.updateNeed(n.id, { quantity: 900 });
  assert.equal(n.demandEpisodes.length, 2);
  assert.equal(n.demandEpisodes[1].quantity, 100);
  assert.equal(n.firstServiceAt, null);
  assert.equal(n.completedAt, null);
});

test('dynamic clocks, censored episodes and history reproduce through checkpoint continuation', () => {
  const a = new World(config), n = current(a);
  a.advance(60000);
  a.serveNeed(n.id, 600);
  a.advance(120000);
  a.updateNeed(n.id, { quantity: 850 });
  a.advance(180000);
  a.serveNeed(n.id, 50);
  a.advance(a.now);
  const b = new World(config, a.checkpoint());
  for (const w of [a, b]) {
    w.advance(240000);
    w.updateNeed(n.id, { quantity: 0 });
    w.advance(300000);
    w.updateNeed(n.id, { quantity: 950 });
    w.advance(360000);
    w.serveNeed(n.id, 300);
  }
  assert.equal(a.stateHash(), b.stateHash());
  assert.deepEqual(evaluate(a), evaluate(b));
  assert.equal(evaluate(b).response.episodes.eligible, 3);
  assert.equal(evaluate(b).response.episodes.completed, 2);
  assert.equal(evaluate(b).response.episodes.retired, 1);
});

test('recorded demand growth after real truck deliveries replays exact physical episode clocks', () => {
  const w = new World({ ...config, packetLoss: 0, loadMs: 1000, unloadMs: 1000 }),
    actor = { id: 'response-clock-fixture', org: 'org0', role: 'commander' },
    n = current(w);
  for (const org of ['org0', 'org1'])
    w.act({ ...actor, org }, { type: 'dispatch', params: {
      vehicle: 'v-' + org + '-0', resource: 'r-' + org + '-water', need: n.id, quantity: 300,
    }, idempotencyKey: 'original-' + org });
  w.advance(600000);
  assert.equal(n.served, 600);
  assert.equal(n.demandEpisodes[0].state, 'covered');
  const previousFirst = n.firstServiceAt, previousComplete = n.completedAt;
  w.inject('intervention', { type: 'need_change' });
  w.advance(w.now);
  assert.equal(n.quantity, 800);
  assert.equal(n.firstServiceAt, null);
  assert.equal(n.completedAt, null);
  w.act(actor, { type: 'dispatch', params: {
    vehicle: 'v-org0-0', resource: 'r-org0-water', need: n.id, quantity: 200,
  }, idempotencyKey: 'new-shortfall' });
  w.advance(1200000);
  assert.equal(n.served, 800);
  assert.ok(n.firstServiceAt > 600000);
  assert.ok(n.completedAt >= n.firstServiceAt);
  assert.equal(n.demandEpisodes[0].firstServiceAt, previousFirst);
  assert.equal(n.demandEpisodes[0].completedAt, previousComplete);
  assert.deepEqual(w.invariants(), []);
  const replayed = replay(w.checkpoint());
  assert.equal(replayed.matches, true);
  assert.deepEqual(evaluate(replayed.world).response, evaluate(w).response);
  assert.equal(evaluate(w).response.episodes.completed, 2);
});
