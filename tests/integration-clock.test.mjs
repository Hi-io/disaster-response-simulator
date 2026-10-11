import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../engine/world.mjs';
import { replay, pairedComparison } from '../evaluation/runs.mjs';
import { SourceClient } from '../adapters/client.mjs';
import { createLabServers } from '../sources/server.mjs';
const config = {
  topology: 'grid',
  grid: 3,
  extentKm: 1,
  hazard: 'none',
  policy: 'none',
  postsPerHour: 0,
  backgroundTraffic: 0,
  packetLoss: 0,
};
const actor = { id: 'integration', org: 'org0', role: 'agent' };
test('an external computation creates a barrier and becomes available after declared modeled latency', () => {
  const w = new World({ ...config, mode: 'modeled', modelLatencyMs: 30000 });
  w.advance(1000);
  const job = w.startModelCall(actor, { model: 'external-platform' }),
    blocked = w.advance(100000);
  assert.equal(blocked.blocked, 'model_result');
  assert.equal(w.now, 1000);
  const receipt = w.finishModelCall(actor, {
    id: job.id,
    wallMs: 2500,
    promptTokens: 20,
    outputTokens: 10,
  });
  assert.equal(receipt.availableAt, 31000);
  w.advance(31000);
  assert.equal(w.actorView('org0').modelRequests[0].state, 'available');
  assert.equal(w.state.modelCalls, 1);
  assert.equal(w.state.modelWallMs, 2500);
  assert.deepEqual(w.actorView('org1').modelRequests, []);
  assert.equal(replay(w.checkpoint()).matches, true);
});
test('live external computation lets the world advance and cannot insert a response in the past', () => {
  const w = new World({ ...config, mode: 'live' }),
    job = w.startModelCall(actor, { model: 'external-platform' });
  assert.equal(w.config.clockLatency, 'wall');
  w.advance(20000);
  const result = w.finishModelCall(actor, { id: job.id, wallMs: 10000 });
  assert.equal(result.availableAt, 20000);
  w.advance(20000);
  assert.equal(replay(w.checkpoint()).matches, true);
});
test('computation receipts are scoped, finite and cannot be replayed as another new call', () => {
  const w = new World({ ...config, modelCallLimit: 1 }),
    job = w.startModelCall(actor, { model: 'external-platform' });
  assert.throws(
    () => w.finishModelCall({ ...actor, org: 'org1' }, { id: job.id, wallMs: 2 }),
    /does not belong/,
  );
  assert.throws(() => w.finishModelCall(actor, { id: job.id, wallMs: NaN }), /Invalid usage/);
  w.finishModelCall(actor, { id: job.id, wallMs: 20, failed: true });
  w.advance(5000);
  assert.throws(() => w.finishModelCall(actor, { id: job.id, wallMs: 20 }), /already submitted/);
  assert.throws(() => w.startModelCall(actor, { model: 'external-platform' }), /budget/);
});
test('source client records outside computation timing through the real scoped HTTP gateway', async (t) => {
  const lab = await createLabServers({
    config: { ...config, mode: 'modeled' },
    observerPort: 0,
    sourcePort: 0,
    persistCredentials: false,
  });
  t.after(() => lab.close());
  const client = new SourceClient({
    baseUrl: `http://127.0.0.1:${lab.sourcePort}`,
    actorKey: Object.keys(lab.actorKeys)[0],
  });
  const job = await client.startModelCall('external-platform'),
    done = await client.finishModelCall(job.id, { wallMs: 15, promptTokens: 10, outputTokens: 5 });
  assert.equal(done.state, 'available');
  assert.equal(lab.world.state.modelCalls, 1);
});
test('comparisons reject different resources and ambiguous duplicate seeds', () => {
  const a = {
      seed: 'a',
      scenario: 'S01',
      variant: 'standard',
      config: { seed: 'a', stockWater: 100, policy: 'rules' },
      metrics: { services: {}, population: { deceased: 10 } },
    },
    b = {
      ...a,
      config: { ...a.config, stockWater: 200 },
      metrics: { services: {}, population: { deceased: 5 } },
    };
  assert.throws(() => pairedComparison([a], [b]), /different initial/);
  assert.throws(() => pairedComparison([a], [a, a]), /Ambiguous/);
  b.config.stockWater = 100;
  const pair = pairedComparison([a], [b]);
  assert.equal(pair.population.deceased.differenceBminusA, -5);
});
test('malformed interventions cannot partially mutate the world', () => {
  const w = new World(config),
    before = w.stateHash();
  for (const [type, data] of [
    ['damage', { building: 'b0', severity: -2 }],
    ['intervention', { type: 'cut', sector: 'no' }],
    ['fire_front', { x: NaN, z: 0, generation: 0 }],
    ['lab_intervention', { kind: 'donation', org: 'org0', amount: -1 }],
    ['vehicle_exit', {}],
  ])
    assert.throws(() => w.inject(type, data));
  assert.equal(w.stateHash(), before);
});
