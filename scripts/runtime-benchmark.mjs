import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createLabServers } from '../sources/server.mjs';
import { mergeViewerFrame } from '../viewer/projection.js';

export const TAKAMATSU_LOAD_CONFIG = Object.freeze({
  seed: 'takamatsu-isolated-load-v1', topology: 'takamatsu', hazard: 'none',
  policy: 'none', organizations: 5, backgroundTraffic: 30, postsPerHour: 240,
});
const summarize = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return { count: sorted.length, p50: sorted[Math.floor(sorted.length * .5)] ?? null,
    p95: sorted[Math.floor(sorted.length * .95)] ?? null, max: sorted.at(-1) ?? null };
};
function blockConsumer(ms) {
  const until = performance.now() + ms;
  let checksum = 0;
  while (performance.now() < until) for (let i = 1; i < 1000; i++) checksum += Math.sqrt(i);
  return checksum;
}

/** No model provider or network other than ephemeral localhost servers is used. */
export async function runRuntimeBenchmark({ durationMs = 15000, blockParentMs = 250,
  config = TAKAMATSU_LOAD_CONFIG, storageDir, primeMapQueries = false } = {}) {
  const temporary = !storageDir;
  const directory = storageDir ?? await mkdtemp(path.join(os.tmpdir(), 'aidscaler-load-'));
  const startup = performance.now();
  const lab = await createLabServers({ isolated: true, persistCredentials: false, config,
    observerPort: 0, sourcePort: 0, storageDir: directory });
  try {
    const observer = `http://127.0.0.1:${lab.observerPort}`;
    const source = `http://127.0.0.1:${lab.sourcePort}`;
    const headers = { Authorization: `Bearer ${lab.observerKey}` };
    const actors = Object.entries(lab.actorKeys).map(([key, actor]) => ({
      org: actor.org, headers: { Authorization: `Bearer ${key}` },
    }));
    if (primeMapQueries) {
      // Reproduce the expensive received-map case once. Subsequent actor reads
      // must carry references, never another copy of this completed result.
      for (const actor of actors) {
        const key = Object.keys(lab.actorKeys).find(k => lab.actorKeys[k].org === actor.org);
        await lab.runtime.request('actorAction', lab.actorKeys[key], {
          type: 'query', params: { target: 'map' }, idempotencyKey: `load-map-${actor.org}`,
        });
      }
      await lab.advance(60000);
      await lab.runtime.flush();
      const deadline = performance.now() + 15000;
      for (;;) {
        const current = await Promise.all(actors.map(actor => lab.runtime.actor(actor.org)));
        if (current.every(state => state.queries.some(query => query.target === 'map' && query.resultRef))) break;
        if (performance.now() > deadline) throw Error('Completed map queries were not materialized during warmup');
        await delay(100);
        await lab.runtime.flush();
      }
    }
    const bootstrapResponse = await fetch(observer + '/api/viewer/bootstrap', { headers });
    if (!bootstrapResponse.ok) throw Error('Viewer bootstrap failed');
    const bootstrapBytes = await bootstrapResponse.arrayBuffer();
    const bootstrap = JSON.parse(Buffer.from(bootstrapBytes).toString('utf8'));
    const joined = mergeViewerFrame(bootstrap.map, bootstrap.frame);
    const initializationMs = performance.now() - startup;
    const subscriptionId = 'deliberately-slow-audit-consumer';
    await lab.runtime.bus.subscribe({ subscriptionId, audience: 'audit', from: 'latest' });
    const samples = new Map(), failures = [];
    const collect = async (family, url, auth) => {
      const began = performance.now();
      try {
        const response = await fetch(url, { headers: auth, signal: AbortSignal.timeout(15000) });
        const buffer = await response.arrayBuffer(), milliseconds = performance.now() - began;
        const result = JSON.parse(Buffer.from(buffer).toString('utf8'));
        if (!response.ok) throw Error(`${response.status}: ${result.error ?? 'HTTP error'}`);
        if (family === 'viewer') {
          if (result.state.map || result.mapState.nodes) throw Error('Geometry repeated in live frame');
          if (result.mapId !== bootstrap.mapId) throw Error('A stable world changed map reference');
        }
        if (family === 'actor' && primeMapQueries && result.known.map) throw Error('Known map repeated in compact actor state');
        const rows = samples.get(family) ?? [];
        rows.push({ milliseconds, bytes: buffer.byteLength }); samples.set(family, rows);
      } catch (error) { failures.push({ family, message: error.message }); }
    };
    // Initial geometry and one-time completed query materialization are setup,
    // reported separately. Tick distributions below measure running load only.
    await lab.runtime.request('resetPerformance');
    await lab.runtime.request('control', { play: true, rate: 10 });
    const start = await lab.runtime.refresh(), began = performance.now();
    let rounds = 0, blockProof;
    while (performance.now() - began < durationMs) {
      await Promise.all([
        collect('viewer', observer + '/api/viewer/frame', headers),
        collect('viewer', observer + '/api/viewer/frame', headers),
        collect('activity', observer + '/api/activity', headers),
        collect('social', source + '/api/timeline?limit=30'),
        ...actors.map(actor => collect('actor', source + '/api/actor/state?compact=1', actor.headers)),
      ]);
      rounds++;
      if (!blockProof) {
        const before = await lab.runtime.refresh();
        const blockStart = performance.now();
        blockConsumer(blockParentMs);
        const blockedWallMs = performance.now() - blockStart;
        const after = await lab.runtime.refresh();
        blockProof = { blockedWallMs, simulatedAdvanceMs: after.now - before.now,
          ticksDuringBlock: after.performance.tickCount - before.performance.tickCount };
      }
      // Lease a batch and deliberately never acknowledge it. Other consumers
      // and the physics clock must continue independently of this subscriber.
      if (rounds === 2) await lab.runtime.bus.pull({ subscriptionId, limit: 5, leaseMs: 30000 });
      await delay(150);
    }
    const end = await lab.runtime.refresh(), elapsedWallMs = performance.now() - began;
    await lab.runtime.request('control', { play: false });
    const transport = await lab.runtime.bus.stats();
    const completedMapQueryReferences = (await Promise.all(actors.map(actor => lab.runtime.actor(actor.org))))
      .reduce((sum, state) => sum + state.queries.filter(query => query.target === 'map' && query.resultRef).length, 0);
    return {
      profile: config, primeMapQueries, completedMapQueryReferences,
      initializationMs, durationRequestedMs: durationMs, elapsedWallMs,
      roundCount: rounds, requestCount: [...samples.values()].reduce((sum, rows) => sum + rows.length, 0),
      bootstrapBytes: bootstrapBytes.byteLength,
      map: { nodes: joined.state.map.nodes.length, buildings: joined.state.map.buildings.length,
        directedEdges: joined.state.map.edges.length },
      simulatedAdvanceMs: end.now - start.now,
      achievedSimulationRate: (end.now - start.now) / elapsedWallMs,
      requestedSimulationRate: 10, parentBlock: blockProof,
      requests: Object.fromEntries([...samples].map(([family, rows]) => [family,
        { latencyMs: summarize(rows.map(row => row.milliseconds)), payloadBytes: summarize(rows.map(row => row.bytes)) }])),
      engine: end.performance,
      slowConsumer: transport.subscriptions.find(s => s.subscriptionId === subscriptionId),
      transport: { published: transport.published, retained: transport.retained },
      failures,
      note: 'HTTP viewers, five compact organization consumers and public social reads share the parent process. Physics uses a separate worker; slow audit deliveries are intentionally unacknowledged. Tick statistics reset after paused geometry/query warmup. No external AI calls.',
    };
  } finally {
    await lab.close();
    if (temporary) {
      const resolved = path.resolve(directory), base = path.resolve(os.tmpdir());
      if (!resolved.startsWith(base + path.sep) || !path.basename(resolved).startsWith('aidscaler-load-'))
        throw Error('Refusing to remove an unexpected benchmark directory');
      await rm(resolved, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
  const report = await runRuntimeBenchmark({ durationMs: Number(process.env.LOAD_DURATION_MS ?? 15000),
    primeMapQueries: process.env.LOAD_MAP_QUERIES === '1',
    config: { ...TAKAMATSU_LOAD_CONFIG, hazard: process.env.LOAD_HAZARD ?? TAKAMATSU_LOAD_CONFIG.hazard } });
  await mkdir(path.join(root, '.local'), { recursive: true });
  const file = path.join(root, '.local', 'runtime-benchmark.json');
  await writeFile(file, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ report: file, ...report }, null, 2));
  if (report.failures.length || report.achievedSimulationRate < 7 || report.parentBlock.simulatedAdvanceMs < 500)
    process.exitCode = 1;
}
