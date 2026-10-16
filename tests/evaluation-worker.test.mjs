import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../engine/world.mjs';
import { evaluate } from '../evaluation/metrics.mjs';
import { createEvaluationInput, evaluateSnapshot, evaluateOutsideSimulation } from '../sources/evaluation-snapshot.mjs';

const config = { seed: 'evaluation-capture', topology: 'grid', grid: 5, extentKm: 3,
  hazard: 'earthquake', backgroundTraffic: 8, postsPerHour: 40, packetLoss: 0,
  humanCapacity: { profile: 'moderate', backgroundReadPerHour: 20, backgroundDecisionPerHour: 10, backgroundRelayPerHour: 10 } };

for (const [index, policy] of ['none', 'conventional', 'federated'].entries())
  test(`read-only evaluation capture exactly preserves ${policy} metrics at all tested boundaries`, async t => {
    const world = new World({ ...config, policy, scenario: ['S01', 'S16', 'S23'][index],
      seed: `evaluation-${policy}`, logMode: 'full' });
    t.after(() => world.close());
    for (const target of [0, 900000, 3600000]) {
      let progress;
      do { progress = world.advance(target); } while (!progress.reached && !progress.blocked);
      world.record('platform_peer_transport', { bytes: 120 + index, state: 'disconnected' });
      const expected = evaluate(world), captured = createEvaluationInput(world);
      assert.deepEqual(evaluateSnapshot(captured), expected, `same in-process evaluator at ${target}`);
      assert.deepEqual(await evaluateOutsideSimulation(captured), expected, `separate worker at ${target}`);
    }
  });

test('copied compact archives and captured mutable state stay exact while the physical world continues', async t => {
  const world = new World({ ...config, scenario: 'S16', policy: 'conventional', logMode: 'compact' });
  t.after(() => world.close());
  world.advance(3600000);
  const post = world.publicFeed({ limit: 1 }).posts[0], actor = { id: 'read-receipt', org: 'org0', role: 'agent' };
  if (post) world.acknowledge(actor, { id: post.id, version: post.version, stage: 'downloaded' });
  world.record('platform_peer_transport', { bytes: 501, state: 'disconnected' });
  const expected = evaluate(world), input = createEvaluationInput(world);
  assert.equal(input.log.archive, true); assert.equal(input.posts.archive, true);
  world.advance(7200000);
  world.record('platform_peer_transport', { bytes: 999999, state: 'connected' });
  assert.deepEqual(await evaluateOutsideSimulation(input), expected);
  assert.equal(world.now, 7200000);
  assert.notDeepEqual(evaluate(world), expected);
});

test('evaluation capture excludes query maps, observations and worker results without changing integrity or model usage', async t => {
  const world = new World({ ...config, policy: 'none', scenario: 'S23', logMode: 'full', modelLatencyMs: 5000 });
  t.after(() => world.close());
  const actor = { id: 'offline-model', org: 'org0', role: 'agent' };
  const request = world.startModelCall(actor, { model: 'test/no-network' });
  const result = world.finishModelCall(actor, { id: request.id, wallMs: 100, promptTokens: 20, outputTokens: 10, providerCost: 0.01 });
  world.advance(result.availableAt);
  const query = world.act(actor, { type: 'query', params: { target: 'map' }, idempotencyKey: 'evaluation-map' });
  world.advance(60000);
  assert.ok(world.actorView('org0').queries.find(q => q.id === query.id).result);
  const input = createEvaluationInput(world);
  assert.equal(Object.hasOwn(input.state, 'queries'), false);
  assert.equal(Object.hasOwn(input.state.observations.org0, 'map'), false);
  assert.equal(Object.hasOwn(input.state.map, 'nodes'), false);
  assert.deepEqual(await evaluateOutsideSimulation(input), evaluate(world));
  world.state.resources[0].reserved += 1;
  const damaged = createEvaluationInput(world), expected = evaluate(world);
  assert.equal(expected.ledgerValid, false);
  assert.deepEqual(await evaluateOutsideSimulation(damaged), expected);
});
