import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../engine/world.mjs';
import { createActorDeltaProjector, applyActorDelta } from '../sources/actor-delta.mjs';

test('actor deltas preserve exact scoped engine views through timed actions and advancement', t => {
  const world = new World({ seed: 'actor-delta-equivalence', topology: 'grid', grid: 5,
    extentKm: 3, policy: 'none', hazard: 'earthquake', postsPerHour: 180,
    backgroundTraffic: 12, logMode: 'full' });
  t.after(() => world.close());
  const projector = createActorDeltaProjector(), current = new Map();
  for (const at of [0, 60000, 120000, 600000]) {
    world.advance(at);
    if (at === 60000) world.act({ id: 'agent', org: 'org0', role: 'agent' }, {
      type: 'query', params: { target: 'inventory' }, idempotencyKey: 'stock-once',
    });
    const unchangedWorld = world.stateHash();
    for (const org of ['org0', 'org1']) {
      const view = world.actorView(org);
      const actual = applyActorDelta(current.get(org), projector.project(org, view));
      current.set(org, actual);
      assert.deepEqual(actual, view);
    }
    assert.equal(world.stateHash(), unchangedWorld);
  }
});

test('changed, removed and added received rows reconstruct correctly with detached output', () => {
  const p = createActorDeltaProjector();
  const state = { runId: 'r1', now: 0, label: 'Before', known: {
    edges: { road: { open: true, version: 1, at: 0 } },
    resources: { water: { quantity: 100, reserved: 0, at: 0 } },
    metadata: { region: 'North', confidence: .8 },
    inbox: ['initial'], temporary: { x: { value: 'remove me' } },
  } };
  const firstPatch = p.project('org0', state);
  let received = applyActorDelta(undefined, firstPatch);
  assert.notStrictEqual(received, state);
  state.known.resources.water.quantity = 80;
  state.known.edges.road = { open: false, version: 2, at: 2000 };
  state.known.edges.newRoad = { open: true, version: 1, at: 2000 };
  state.known.metadata.region = 'South';
  delete state.known.metadata.confidence;
  state.known.inbox.push('new receipt');
  delete state.known.temporary;
  delete state.label;
  state.now = 2000;
  const patch = p.project('org0', state);
  assert.deepEqual(patch.removedHeader, ['label']);
  assert.deepEqual(patch.removedKinds, ['temporary']);
  assert.deepEqual(patch.removed.metadata, ['confidence']);
  assert.deepEqual(patch.known.resources.water, { quantity: 80, reserved: 0, at: 0 });
  assert.equal(firstPatch.replace.known.resources.water.quantity, 100);
  received = applyActorDelta(received, patch);
  assert.deepEqual(received, state);
  state.known.resources.water.quantity = 40;
  assert.equal(patch.known.resources.water.quantity, 80);
  delete state.known.edges.road;
  const finalPatch = p.project('org0', state);
  assert.deepEqual(finalPatch.removed.edges, ['road']);
  assert.deepEqual(applyActorDelta(received, finalPatch), state);
});

test('road fast paths preserve repeated records, replacements and stamped in-place updates', () => {
  const p = createActorDeltaProjector();
  const state = { runId: 'r', now: 0, known: { edges: {
    road: { open: true, version: 1, at: 0 },
  } } };
  let current = applyActorDelta(undefined, p.project('org0', state));
  assert.deepEqual(p.project('org0', state).known, {});
  state.known.edges.road = { open: true, version: 1, at: 0 };
  assert.deepEqual(p.project('org0', state).known, {});
  state.known.edges.road.open = false;
  state.known.edges.road.version++;
  const update = p.project('org0', state);
  assert.equal(update.known.edges.road.open, false);
  current = applyActorDelta(current, update);
  assert.deepEqual(current, state);
});

test('each organization starts independently and changed runs or reset require a replacement', () => {
  const p = createActorDeltaProjector();
  const state = { runId: 'r1', now: 0, known: { resources: {} } };
  assert.ok(p.project('org0', state).replace);
  assert.equal(p.project('org0', state).replace, undefined);
  assert.ok(p.project('org1', state).replace);
  state.runId = 'r2';
  assert.ok(p.project('org0', state).replace);
  p.reset();
  assert.ok(p.project('org0', state).replace);
  assert.throws(() => applyActorDelta(undefined, { header: {} }));
});

test('unchanged Takamatsu road observations produce a tiny IPC delta while resource edits remain visible', t => {
  const world = new World({ topology: 'takamatsu', hazard: 'none', policy: 'none',
    organizations: 5, backgroundTraffic: 30, postsPerHour: 240 });
  t.after(() => world.close());
  const p = createActorDeltaProjector();
  // This is the same read ownership as compactActor: each header is new, while
  // received edge records retain engine identity between observations.
  const view = () => ({ runId: world.runId, now: world.now,
    known: world.state.observations.org0, queries: [] });
  const first = p.project('org0', view());
  assert.ok(Buffer.byteLength(JSON.stringify(first)) > 750000);
  const unchanged = p.project('org0', view());
  assert.ok(Buffer.byteLength(JSON.stringify(unchanged)) < 200);
  const water = world.state.observations.org0.resources['r-org0-water'];
  water.quantity--;
  const update = p.project('org0', view());
  assert.equal(Object.keys(update.known.resources).length, 1);
  assert.equal(update.known.edges, undefined);
  assert.deepEqual(applyActorDelta(first.replace, update), view());
});
