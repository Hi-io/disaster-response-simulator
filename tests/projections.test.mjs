import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../engine/world.mjs';
import { evaluate } from '../evaluation/metrics.mjs';
import { createViewerBootstrap, createViewerFrame, getViewerMap } from '../sources/projections.mjs';
import { mergeViewerFrame } from '../viewer/projection.js';
import { serviceRows, humanQueueRows } from '../viewer/display.js';
import { streamModels, trafficLevel } from '../viewer/presentation.js';

const small = { topology: 'grid', grid: 9, extentKm: 8, policy: 'none',
  hazard: 'none', backgroundTraffic: 0, postsPerHour: 0 };

test('viewer frames do not advance the world or invoke full observer evaluation', t => {
  const world = new World(small);
  t.after(() => world.close());
  world.advance(600000);
  const before = world.stateHash();
  world.observer = () => { throw new Error('Full observer evaluation must stay off the live path'); };
  const bootstrap = createViewerBootstrap(world);
  const view = mergeViewerFrame(bootstrap.map, bootstrap.frame);
  assert.equal(world.stateHash(), before);
  assert.equal(view.now, world.now);
  const full = evaluate(world);
  for (const row of serviceRows(view)) for (const key of ['demand', 'served', 'pending', 'overprovided'])
    assert.equal(row[key], full.services[row.type]?.[key] ?? 0);
  for (const [key, value] of Object.entries(view.metrics.population))
    assert.ok(Math.abs(value - full.population[key]) < 1e-8, key);
  assert.equal(view.metrics.ledgerValid, null);
  assert.equal(view.metrics.presentation.kind, 'live-summary');
  assert.equal(bootstrap.frame.state.map, undefined);
  assert.equal(bootstrap.frame.state.queries, undefined);
});

test('frames can skip intermediate changes and reset to their geometry baseline', t => {
  const world = new World(small);
  t.after(() => world.close());
  const bootstrap = createViewerBootstrap(world);
  const b = world.state.map.buildings[2], edge = world.state.map.edges[0];
  b.damage = 1; b.state = 'damaged'; edge.open = false;
  let view = mergeViewerFrame(bootstrap.map, createViewerFrame(world));
  assert.equal(view.state.map.buildings[2].state, 'damaged');
  assert.equal(trafficLevel(view.state.map.edges[0]), 'closed');
  b.damage = 0; b.state = bootstrap.map.buildings[2].state; edge.open = true;
  edge.occupants.push('traffic-a');
  view = mergeViewerFrame(bootstrap.map, createViewerFrame(world));
  assert.equal(view.state.map.buildings[2].damage, 0);
  assert.equal(view.state.map.edges[0].open, true);
  assert.equal(view.state.map.edges[0].occupants.length, 1);
  edge.occupants.length = 0;
  view = mergeViewerFrame(bootstrap.map, createViewerFrame(world));
  assert.equal(view.state.map.edges[0].occupants.length, 0);
  assert.strictEqual(getViewerMap(world), bootstrap.map);
});

test('organization projections preserve received visibility and exclude query maps', t => {
  const world = new World(small);
  t.after(() => world.close());
  world.advance(600000);
  const edge = world.state.map.edges[0];
  edge.open = false;
  world.state.observations.org0.edges[edge.id].open = true;
  world.state.observations.org0.map = { secretMap: true, nodes: Array(1000).fill('unnecessary') };
  world.state.observations.org0.queries = [{ result: { unnecessaryMap: true } }];
  const bootstrap = createViewerBootstrap(world, { org: 'org0', perspective: 'org0' });
  const view = mergeViewerFrame(bootstrap.map, bootstrap.frame);
  assert.equal(view.state.observations.org0.edges[edge.id], undefined);
  assert.equal(trafficLevel(view.state.map.edges[0], view.state.observations.org0.edges[edge.id], false), 'unknown');
  assert.equal(view.state.observations.org0.map, undefined);
  assert.equal(view.state.observations.org0.queries, undefined);
  assert.equal(view.state.observations.org1, undefined);
  assert.deepEqual(view.state.cohorts, []);
  assert.deepEqual(view.state.needs, []);
  assert.deepEqual(view.state.hazards, []);
  const models = streamModels(view, 'org0', false);
  assert.ok(models.reality.length === 0);
  for (const post of view.state.posts) assert.equal(post.private.truthCategory, undefined);
  assert.throws(() => createViewerFrame(world, { org: 'org0', perspective: 'org1' }));
});

test('projection counters accumulate new receipts and finished work without duplicating them', t => {
  const world = new World(small);
  t.after(() => world.close());
  world.state.humanWork = [{ id: 'w1', org: 'org0', stage: 'read', state: 'queued', createdAt: 0 }];
  world.state.ingestion.push({ org: 'org0', id: 'p1', version: 1, stage: 'downloaded', at: 0 });
  const first = createViewerFrame(world);
  assert.equal(first.metrics.information.downloaded, 1);
  assert.equal(humanQueueRows(first)[0].queued, 1);
  world.state.ingestion.push({ org: 'org0', id: 'p1', version: 1, stage: 'downloaded', at: 0 });
  world.state.humanWork[0].state = 'completed';
  const finished = createViewerFrame(world);
  assert.equal(finished.metrics.information.downloaded, 1);
  assert.equal(humanQueueRows(finished)[0].queued, 0);
  assert.equal(humanQueueRows(finished)[0].completed, 1);
  assert.equal(humanQueueRows(createViewerFrame(world))[0].completed, 1);
});

test('Takamatsu live updates stay below one MB without downloading its road geometry', t => {
  const world = new World({ topology: 'takamatsu', policy: 'none', postsPerHour: 1000,
    backgroundTraffic: 160 });
  t.after(() => world.close());
  const bootstrap = createViewerBootstrap(world);
  world.advance(600000);
  const frame = createViewerFrame(world);
  const bytes = Buffer.byteLength(JSON.stringify(frame));
  assert.ok(bytes < 1000000, `Frame is ${bytes} bytes`);
  assert.equal(frame.state.map, undefined);
  assert.equal(frame.mapState.nodes, undefined);
  assert.equal(frame.mapState.edges.some(e => e.points), false);
  assert.ok(Buffer.byteLength(JSON.stringify(bootstrap.map)) > bytes * 5);
  const view = mergeViewerFrame(bootstrap.map, frame);
  assert.equal(view.state.map.buildings.length, world.state.map.buildings.length);
  assert.equal(view.state.map.nodes.length, world.state.map.nodes.length);
  assert.equal(view.state.cohorts.length, world.state.cohorts.length);
  assert.equal(view.state.map.buildings.filter(b => b.damage >= 1).length,
    world.state.map.buildings.filter(b => b.damage >= 1).length);
});
