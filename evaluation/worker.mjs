import { parentPort, workerData } from 'node:worker_threads';
import { World } from '../engine/world.mjs';
import { evaluate } from './metrics.mjs';
import { saveRun } from './runs.mjs';
import { readFile } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';

let cancelled = false;
parentPort.on('message', (m) => {
  if (m === 'cancel') cancelled = true;
});
const start = performance.now();
let w;
try {
  w = new World(workerData.config);
  let nextProgress = 0;
  while (!cancelled && w.now < w.config.durationMs) {
    const progress = w.advance(w.config.durationMs, { maxEvents: 10000 });
    if (progress.blocked)
      throw new Error('Batch run cannot continue without the external computation result');
    if (performance.now() - start > workerData.maxWallMs) {
      cancelled = true;
      break;
    }
    if (performance.now() > nextProgress) {
      parentPort.postMessage({ type: 'progress', simulatedMs: w.now, events: w.eventCount });
      nextProgress = performance.now() + 1000;
    }
    await setImmediate();
  }
  const result = {
    world: w,
    metrics: evaluate(w),
    wallMs: performance.now() - start,
    hash: w.stateHash(),
  };
  const saved = await saveRun(result, workerData.directory);
  parentPort.postMessage({
    type: 'completed',
    result: { ...saved, cancelled, config: w.config, manifest: w.manifest },
  });
} catch (error) {
  parentPort.postMessage({ type: 'failed', error: error.message, code: error.code });
} finally {
  w?.close();
  parentPort.close();
}
