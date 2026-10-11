import os from 'node:os';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';

const full = process.argv.includes('--full'),
  profiles = [];
for (const name of ['unit', 'city', 'region'])
  profiles.push({ name, config: JSON.parse(await readFile(`manifests/${name}.json`, 'utf8')) });
profiles.push({ name: 'default-48h', config: { logMode: 'compact' } });
for (const count of full ? [10000, 100000, 1000000] : [10000])
  profiles.push({
    name: `information-${count}`,
    config: {
      scenario: 'S23',
      hazard: 'none',
      policy: 'none',
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
      recurringNeeds: false,
      healthReports: false,
    },
  });
const results = [];
for (const profile of profiles) {
  console.error(`Benchmark: ${profile.name} (isolated worker)`);
  const result = await new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./benchmark-worker.mjs', import.meta.url), {
      workerData: profile,
    });
    worker.on('message', (m) => {
      if (m.type === 'progress')
        console.error(`${profile.name}: ${m.posts} posts, ${m.events} events`);
      if (m.type === 'completed') resolve(m.result);
      if (m.type === 'failed') reject(new Error(m.error));
    });
    worker.on('error', reject);
    worker.on('exit', (code) => {
      if (code) reject(new Error(`Worker exited ${code}`));
    });
  });
  results.push(result);
}
const report = {
  recordedAt: new Date().toISOString(),
  engineVersion: '0.2.0',
  machine: {
    os: os.platform(),
    release: os.release(),
    cpu: os.cpus()[0]?.model,
    logicalCpus: os.availableParallelism(),
    memoryGiB: os.totalmem() / 1073741824,
    node: process.version,
  },
  notes: [
    'Every profile runs in a fresh worker. RSS is process-wide; heap belongs to the worker.',
    'Peak memory is sampled after event chunks and hashing; short-lived allocation peaks can be missed.',
    'Execution wall time excludes final state hashing, exporting, rendering and external-platform inference.',
    'Information profiles measure source generation only. This is synthetic load, not a disaster frequency.',
    'Requested ×1000 is not guaranteed for all workloads.',
  ],
  results,
};
await mkdir('runs/benchmarks', { recursive: true });
await writeFile('runs/benchmarks/latest.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
