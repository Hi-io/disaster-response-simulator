import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { TAKAMATSU_SOURCE, takamatsuRoads } from '../generators/takamatsu.mjs';
import { route } from '../generators/map.mjs';

const vehicle = { weightKg: 1200, speedMps: 18, maxWaterDepth: 0.3 };
const distance = points => points.slice(1).reduce((sum, p, index) =>
  sum + Math.hypot(p.x - points[index].x, p.z - points[index].z), 0);

function reached(graph, start, backwards = false) {
  const adjacency = new Map(graph.nodes.map(node => [node.id, []]));
  for (const edge of graph.edges) adjacency.get(backwards ? edge.to : edge.from).push(backwards ? edge.from : edge.to);
  const seen = new Set([start]), pending = [start];
  while (pending.length) {
    for (const next of adjacency.get(pending.pop()))
      if (!seen.has(next)) { seen.add(next); pending.push(next); }
  }
  return seen;
}

test('Takamatsu has a fixed 100 km2 real strategic road network, not an enlarged town template', () => {
  const map = takamatsuRoads();
  assert.equal(map.source.extentM, 10000);
  assert.equal(map.nodes.length, 5054);
  assert.equal(map.edges.length, 12716);
  assert.equal(map.crossings.length, 297);
  assert.equal(map.river, null);
  assert.equal(new Set(map.nodes.map(node => node.id)).size, map.nodes.length);
  assert.equal(new Set(map.edges.map(edge => edge.id)).size, map.edges.length);
  for (let i = 0; i < map.nodes.length; i++) {
    const node = map.nodes[i];
    assert.equal(node.id, `n${i}`);
    assert.ok(node.x >= 0 && node.x <= 10000 && node.z >= 0 && node.z <= 10000);
    assert.ok(node.osmNode || node.sourceBoundary || node.sourceWaypoint);
    assert.ok(node.lon >= TAKAMATSU_SOURCE.bounds.west && node.lon <= TAKAMATSU_SOURCE.bounds.east + 1e-8);
    assert.ok(node.lat <= TAKAMATSU_SOURCE.bounds.north && node.lat >= TAKAMATSU_SOURCE.bounds.south - 1e-8);
    assert.ok(node.name && !/\ufffd|undefined|NaN/.test(node.name));
  }
  assert.ok(Math.max(...map.nodes.map(node => node.x)) - Math.min(...map.nodes.map(node => node.x)) > 9900);
  assert.ok(Math.max(...map.nodes.map(node => node.z)) - Math.min(...map.nodes.map(node => node.z)) > 9900);
  assert.ok(map.edges.some(edge => edge.name.startsWith('Route ')));
  assert.ok(map.edges.some(edge => edge.highway === 'unclassified'));
  assert.ok(map.edges.some(edge => edge.highway.endsWith('_link')));
  assert.ok(map.edges.every(edge => !['residential', 'service', 'track'].includes(edge.highway)));
  assert.match(map.source.scope, /Not every residential lane/);
  assert.match(map.source.scope, /synthetic/);
  assert.match(map.source.scope, /not a navigation/i);
});

test('all geographic junctions are strongly connected while original one-way corridors stay directed', () => {
  const map = takamatsuRoads();
  assert.equal(reached(map, 'n0').size, map.nodes.length);
  assert.equal(reached(map, 'n0', true).size, map.nodes.length);
  const corridors = Map.groupBy(map.edges, edge => edge.corridor);
  assert.equal(corridors.size, 7158);
  let oneWay = 0;
  for (const edges of corridors.values()) {
    assert.ok(edges.length === 1 || edges.length === 2);
    if (edges.length === 1) {
      oneWay++;
      assert.equal(edges[0].oneWay, true);
    } else {
      assert.equal(edges[0].oneWay, false);
      assert.equal(edges[0].from, edges[1].to);
      assert.equal(edges[0].to, edges[1].from);
      assert.equal(edges[0].lengthM, edges[1].lengthM);
      assert.deepEqual(edges[0].points, [...edges[1].points].reverse());
    }
  }
  assert.equal(oneWay, 1600);
  const edge = map.edges.find(edge => edge.oneWay);
  const reverse = route(map, edge.to, edge.from, vehicle);
  assert.ok(reverse && reverse.edges.length > 1, 'reverse travel uses other real streets, not an invented reverse edge');
  assert.ok(!reverse.edges.includes(`${edge.to}:${edge.from}`));
});

test('curved road distances and bridge geometry are preserved without proximity joins', () => {
  const map = takamatsuRoads(), nodes = new Map(map.nodes.map(node => [node.id, node]));
  const corridorIds = new Set();
  let curved = 0;
  for (const edge of map.edges) {
    assert.ok(edge.osmWays.length > 0 && edge.osmWays.every(id => /^\d+$/.test(id)));
    assert.equal(edge.id, `${edge.from}:${edge.to}`);
    const from = nodes.get(edge.from), to = nodes.get(edge.to);
    assert.deepEqual(edge.points[0], { x: from.x, z: from.z });
    assert.deepEqual(edge.points.at(-1), { x: to.x, z: to.z });
    assert.ok(Math.abs(edge.lengthM - distance(edge.points)) <= 0.006);
    assert.ok(edge.lengthM >= Math.hypot(from.x - to.x, from.z - to.z) - 0.006);
    assert.ok(edge.speedMps > 0 && edge.capacity >= 1 && edge.storage >= 1 && edge.maxWeight > 0);
    if (edge.points.length > 3 && edge.lengthM > Math.hypot(from.x - to.x, from.z - to.z) + 1) curved++;
    corridorIds.add(edge.corridor);
  }
  assert.ok(curved > 1000, 'route length includes mapped bends, not straightened endpoint distances');
  for (const crossing of map.crossings) {
    assert.ok(crossing.edges.length > 0 && crossing.edges.length <= 2);
    for (const id of crossing.edges) {
      const edge = map.edges.find(edge => edge.id === id);
      assert.equal(edge.crossing, crossing.id);
      assert.equal(edge.bridge, true);
    }
  }
  // Same longitude/latitude never creates an edge unless OSM nodes share an
  // actual graph connection. Separate bridge/tunnel layers remain tagged.
  assert.ok(map.edges.some(edge => edge.tunnel));
  assert.ok(map.edges.some(edge => edge.layer !== 0));
});

test('explicit mapped speed, weight and basic vehicle restrictions cap simulation defaults', () => {
  const map = takamatsuRoads();
  const weighted = map.edges.filter(edge => edge.permanentRestrictions.maxweight);
  const heightRestricted = map.edges.filter(edge => edge.permanentRestrictions.maxheight);
  assert.ok(weighted.length > 0 && heightRestricted.length > 0);
  for (const edge of weighted) assert.ok(edge.maxWeight <= Number.parseFloat(edge.permanentRestrictions.maxweight) * 1000);
  for (const edge of map.edges) {
    const tags = edge.permanentRestrictions;
    if (tags.maxspeed) assert.ok(edge.speedMps <= Number.parseFloat(tags.maxspeed) / 3.6 + 1e-9);
    if (tags.hgv === 'no') assert.ok(edge.maxWeight <= 3500);
    assert.ok(!['no', 'private'].includes(tags.access));
    assert.ok(!['no', 'private'].includes(tags.motorcar));
  }
  for (const edge of heightRestricted) assert.equal(edge.maxHeightM, Number.parseFloat(edge.permanentRestrictions.maxheight));
});

test('sampled routes use directed, continuous real polylines and stable distances', () => {
  const map = takamatsuRoads(), byId = new Map(map.edges.map(edge => [edge.id, edge]));
  for (let i = 0; i < 20; i++) {
    const from = `n${(i * 173) % map.nodes.length}`, to = `n${(i * 293 + 1000) % map.nodes.length}`;
    const result = route(map, from, to, vehicle);
    assert.ok(result && result.freeTimeMs > 0);
    let at = from, sum = 0;
    for (const id of result.edges) {
      const edge = byId.get(id);
      assert.equal(edge.from, at); at = edge.to; sum += edge.lengthM;
    }
    assert.equal(at, to);
    assert.ok(Math.abs(result.distanceM - sum) < 1e-8);
  }
});

test('fixture bytes and source provenance are pinned, compact and independent between worlds', () => {
  const compressed = readFileSync(new URL('../generators/data/takamatsu-roads-v1.json.gz', import.meta.url));
  const decoded = gunzipSync(compressed);
  assert.ok(compressed.length < 600000);
  assert.ok(decoded.length < 2000000);
  assert.equal(createHash('sha256').update(decoded).digest('hex'), TAKAMATSU_SOURCE.fixtureSha256);
  assert.match(TAKAMATSU_SOURCE.sourceSha256, /^[a-f0-9]{64}$/);
  assert.match(TAKAMATSU_SOURCE.sourceTimestamp, /^2026-10-16T/);
  assert.match(TAKAMATSU_SOURCE.sourceApi, /^https:\/\/overpass-api.de/);
  assert.equal(TAKAMATSU_SOURCE.license, 'ODbL-1.0');
  assert.match(TAKAMATSU_SOURCE.attribution, /OpenStreetMap contributors/);
  assert.equal(TAKAMATSU_SOURCE.selection.component, 'largest strongly connected directed motor-road component inside fixed canvas');
  const a = takamatsuRoads(), b = takamatsuRoads();
  assert.deepEqual(a, b);
  a.nodes[0].name = 'changed'; a.edges[0].open = false; a.edges[0].points[0].x = -1;
  assert.notEqual(b.nodes[0].name, 'changed'); assert.equal(b.edges[0].open, true);
  assert.ok(b.edges[0].points[0].x >= 0);
});

test('a changed geographic dataset fails closed rather than silently changing the engine geography', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'aidscaler-takamatsu-fixture-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(path.join(directory, 'data'));
  writeFileSync(path.join(directory, 'takamatsu.mjs'), readFileSync(new URL('../generators/takamatsu.mjs', import.meta.url)));
  const bytes = gunzipSync(readFileSync(new URL('../generators/data/takamatsu-roads-v1.json.gz', import.meta.url)));
  const fixture = JSON.parse(bytes.toString('utf8'));
  fixture.nodes[0][1] += 1;
  writeFileSync(path.join(directory, 'data/takamatsu-roads-v1.json.gz'), gzipSync(JSON.stringify(fixture)));
  await assert.rejects(import(pathToFileURL(path.join(directory, 'takamatsu.mjs')).href), /fingerprint mismatch/);
});
