import os from 'node:os';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { runWorld } from '../evaluation/runs.mjs';
import { World } from '../engine/world.mjs';
const full = process.argv.includes('--full');
const profiles = [
  ['unit', JSON.parse(await readFile('manifests/unit.json', 'utf8'))],
  ['city', JSON.parse(await readFile('manifests/city.json', 'utf8'))],
  ['region', JSON.parse(await readFile('manifests/region.json', 'utf8'))],
];
const results = [];
for (const [name, config] of profiles) {
  console.error(`Benchmark: ${name}`);
  const result = runWorld(config);
  results.push({
    name,
    config,
    wallMs: result.wallMs,
    effectiveRate: result.world.now / result.wallMs,
    events: result.world.eventCount,
    posts: result.world.state.posts.length,
    rssMiB: process.memoryUsage().rss / 1048576,
    heapMiB: process.memoryUsage().heapUsed / 1048576,
    ledgerValid: result.metrics.ledgerValid,
    hash: result.hash,
  });
  result.world.close();
}
for (const count of full ? [10000, 100000, 1000000] : [10000]) {
  console.error(`Disk-backed source generation: ${count} target publications`);
  const config = {
    scenario: 'S23',
    hazard: 'none',
    grid: 3,
    extentKm: 2,
    postsPerHour: count,
    backgroundTraffic: 0,
    durationMs: 3600000,
    logMode: 'compact',
    maxPosts: count,
    maxEvents: 10000000,
    networkCapacity: 100000,
    packetLoss: 0,
    authorshipMs: 0,
  };
  const started = performance.now(),
    w = new World(config);
  let lastProgress = 0;
  while (!w.advance(config.durationMs, { maxEvents: 50000 }).reached) {
    if (performance.now() - lastProgress > 10000) {
      console.error(`${w.state.posts.length}/${count} records · ${w.eventCount} events`);
      lastProgress = performance.now();
    }
    await new Promise((r) => setImmediate(r));
  }
  const wallMs = performance.now() - started,
    hash = w.stateHash();
  results.push({
    name: `information-${count}`,
    config,
    wallMs,
    effectiveRate: w.now / wallMs,
    events: w.eventCount,
    posts: w.state.posts.length,
    published: w.state.statistics.counts.post_published ?? 0,
    rssMiB: process.memoryUsage().rss / 1048576,
    heapMiB: process.memoryUsage().heapUsed / 1048576,
    ledgerValid: w.invariants().length === 0,
    hash,
  });
  w.close();
}
const report = {
  recordedAt: new Date().toISOString(),
  machine: {
    os: os.platform(),
    release: os.release(),
    cpu: os.cpus()[0]?.model,
    logicalCpus: os.availableParallelism(),
    memoryGiB: os.totalmem() / 1073741824,
    node: process.version,
  },
  notes: [
    'Synthetic load, not a measured disaster frequency.',
    'Wall time measures generation/execution; state hashing and artifact compression are extra costs.',
    'Requested ×1000 is not promised for every profile.',
    'RSS includes previous in-process profiles; use isolated workers for clean per-profile measurements.',
  ],
  results,
};
await mkdir('runs/benchmarks', { recursive: true });
await writeFile('runs/benchmarks/latest.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
