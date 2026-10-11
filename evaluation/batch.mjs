import { Worker } from 'node:worker_threads';
import { mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { digest } from '../engine/determinism.mjs';
import { validateConfig, ENGINE_BUILD, VERSION } from '../contracts/config.mjs';

export async function batch(
  configs,
  {
    directory = 'runs/batch',
    workers = 2,
    memoryMb = 512,
    maxWallMs = 600000,
    resume = false,
    signal = null,
    onProgress = () => {},
  } = {},
) {
  if (!Number.isInteger(workers) || workers < 1 || workers > 8)
    throw new Error('Workers must be 1..8');
  if (!Number.isInteger(memoryMb) || memoryMb < 64 || memoryMb > 8192)
    throw new Error('Memory budget must be 64..8192 MiB per worker');
  if (!Number.isInteger(maxWallMs) || maxWallMs < 1 || maxWallMs > 86400000)
    throw new Error('Wall-time budget must be 1..86400000 ms per episode');
  await mkdir(directory, { recursive: true });
  const jobs = configs.map((input, index) => {
    const config = validateConfig(input);
    return {
      index,
      config,
      directory: path.resolve(
        directory,
        `${String(index).padStart(4, '0')}-${digest(config).slice(0, 12)}`,
      ),
    };
  });
  const results = Array(jobs.length),
    active = new Set();
  let next = 0,
    failure = null;
  const abort = () => {
    for (const worker of active) worker.postMessage('cancel');
  };
  signal?.addEventListener('abort', abort);
  async function consume() {
    while (next < jobs.length && !signal?.aborted && !failure) {
      const job = jobs[next++];
      if (resume) {
        try {
          const metrics = JSON.parse(
            await readFile(path.join(job.directory, 'metrics.json'), 'utf8'),
          );
          const manifest = JSON.parse(
            await readFile(path.join(job.directory, 'manifest.json'), 'utf8'),
          );
          await stat(path.join(job.directory, 'checkpoint.json.gz'));
          if (
            manifest.engineBuild === ENGINE_BUILD &&
            manifest.engineVersion === VERSION &&
            digest(manifest.config) === digest(job.config) &&
            metrics.completion?.state === 'completed' &&
            metrics.simulatedMs === job.config.durationMs
          ) {
            results[job.index] = {
              config: job.config,
              manifest,
              metrics,
              hash: metrics.hash,
              wallMs: metrics.wallMs,
              completion: metrics.completion,
              cancelled: false,
              resumed: true,
            };
            continue;
          }
        } catch {}
      }
      if (signal?.aborted || failure) break;
      results[job.index] = await new Promise((resolve, reject) => {
        const worker = new Worker(new URL('./worker.mjs', import.meta.url), {
          workerData: { ...job, maxWallMs },
          resourceLimits: { maxOldGenerationSizeMb: memoryMb },
        });
        active.add(worker);
        let completed = false;
        worker.on('message', (message) => {
          if (message.type === 'progress') {
            try {
              onProgress({ ...message, index: job.index });
            } catch (error) {
              reject(error);
            }
          } else if (message.type === 'completed') {
            completed = true;
            active.delete(worker);
            resolve(message.result);
          } else if (message.type === 'failed') {
            active.delete(worker);
            reject(new Error(message.error));
          }
        });
        worker.on('error', reject);
        worker.on('exit', (code) => {
          active.delete(worker);
          if (code !== 0) reject(new Error(`Worker exited ${code}; artifacts retained`));
          else if (!completed)
            reject(new Error('Worker exited without a completed result; artifacts retained'));
        });
      });
      onProgress({
        type: 'episode',
        index: job.index,
        total: jobs.length,
        result: results[job.index],
      });
    }
  }
  try {
    await Promise.all(
      Array.from({ length: Math.min(workers, jobs.length) }, async () => {
        try {
          await consume();
        } catch (error) {
          failure ??= error;
          abort();
        }
      }),
    );
    if (failure) throw failure;
  } finally {
    signal?.removeEventListener('abort', abort);
  }
  return results.filter(Boolean);
}
