import { parentPort, workerData } from 'node:worker_threads';
import { setImmediate } from 'node:timers/promises';
import { World } from '../engine/world.mjs';
let w;
try {
  const started = performance.now();
  w = new World(workerData.config);
  let nextProgress = 0,
    peakHeap = 0,
    peakRss = 0;
  const memory = () => {
    const m = process.memoryUsage();
    peakHeap = Math.max(peakHeap, m.heapUsed);
    peakRss = Math.max(peakRss, m.rss);
  };
  while (w.now < w.config.durationMs) {
    const p = w.advance(w.config.durationMs, { maxEvents: 50000 });
    if (p.blocked) throw new Error('Unresolved external computation');
    memory();
    if (performance.now() > nextProgress) {
      parentPort.postMessage({
        type: 'progress',
        posts: w.state.posts.length,
        events: w.eventCount,
      });
      nextProgress = performance.now() + 10000;
    }
    await setImmediate();
  }
  const wallMs = performance.now() - started,
    hashStarted = performance.now(),
    hash = w.stateHash();
  const hashWallMs = performance.now() - hashStarted;
  memory();
  parentPort.postMessage({
    type: 'completed',
    result: {
      name: workerData.name,
      config: w.config,
      wallMs,
      hashWallMs,
      effectiveRate: w.now / wallMs,
      events: w.eventCount,
      posts: w.state.posts.length,
      published: w.state.statistics.counts.post_published ?? 0,
      peakRssMiB: peakRss / 1048576,
      peakHeapMiB: peakHeap / 1048576,
      ledgerValid: w.invariants().length === 0,
      hash,
    },
  });
} catch (e) {
  parentPort.postMessage({ type: 'failed', error: e.message });
} finally {
  w?.close();
  parentPort.close();
}
