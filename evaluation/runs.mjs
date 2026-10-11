import { World } from '../engine/world.mjs';
import { evaluate } from './metrics.mjs';
import { clone, digest, keyedRandom } from '../engine/determinism.mjs';
import { mkdir, writeFile, readFile, copyFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { gzipSync, gunzipSync, createGzip } from 'node:zlib';

export function runWorld(config = {}, inputs = [], checkpoint = null) {
  const start = performance.now(),
    w = new World(config, checkpoint);
  for (const input of inputs) {
    w.advance(input.at);
    try {
      if (input.kind === 'intervention') w.inject(input.type, input.data);
      else if (input.kind === 'ingestion') w.acknowledge(input.actor, input.request);
      else w.act(input.actor, input.request);
    } catch (error) {
      if (!input.allowFailure) throw error;
    }
  }
  while (!w.advance(w.config.durationMs, { maxEvents: 100000 }).reached) {}
  return { world: w, metrics: evaluate(w), wallMs: performance.now() - start, hash: w.stateHash() };
}
export function replay(checkpoint) {
  const w = new World(checkpoint.manifest.config);
  for (const input of checkpoint.inputs ?? []) {
    while (w.eventCount < input.afterEventCount) {
      const next = w.step();
      if (!next || next.at > input.at)
        throw new Error('Input boundary does not match recorded world');
    }
    if (w.now > input.at) throw new Error('Replay input is in the past');
    w.now = input.at;
    try {
      if (input.kind === 'intervention') w.inject(input.type, input.data);
      else if (input.kind === 'ingestion') w.acknowledge(input.actor, input.request);
      else w.act(input.actor, input.request);
    } catch {}
  }
  while (!w.advance(checkpoint.now, { maxEvents: 100000 }).reached) {}
  const original = new World(checkpoint.manifest.config, checkpoint);
  const expected = original.stateHash();
  original.close();
  return { world: w, expected, actual: w.stateHash(), matches: w.stateHash() === expected };
}
export async function saveRun(result, directory) {
  await mkdir(directory, { recursive: true });
  const w = result.world;
  const artifacts = {
    manifest: w.manifest,
    metrics: {
      ...result.metrics,
      wallMs: result.wallMs,
      effectiveRate: w.now / result.wallMs,
      hash: result.hash,
    },
    inputs: w.inputs,
  };
  for (const [name, data] of Object.entries(artifacts))
    await writeFile(path.join(directory, `${name}.json`), JSON.stringify(data, null, 2));
  const cp = w.checkpoint();
  for (const [name, record] of [
    ['posts', cp.state.posts],
    ['messages', cp.state.messages],
    ['events', cp.log],
  ])
    if (record.archive) {
      const file = `${name}.sqlite`;
      await copyFile(record.file, path.join(directory, file));
      record.file = file;
    }
  await writeFile(
    path.join(directory, 'checkpoint.json.gz'),
    gzipSync(JSON.stringify(cp), { level: 3 }),
  );
  await pipeline(
    Readable.from(
      (function* () {
        for (const event of w.log) yield JSON.stringify(event) + '\n';
      })(),
    ),
    createGzip({ level: 3 }),
    createWriteStream(path.join(directory, 'events.ndjson.gz')),
  );
  return {
    directory,
    runId: w.runId,
    hash: result.hash,
    wallMs: result.wallMs,
    effectiveRate: w.now / result.wallMs,
    metrics: result.metrics,
  };
}
export async function readJSON(file) {
  const bytes = await readFile(file);
  const result = JSON.parse(file.endsWith('.gz') ? gunzipSync(bytes).toString() : bytes.toString());
  for (const record of [result.state?.posts, result.state?.messages, result.log])
    if (record?.archive && !path.isAbsolute(record.file))
      record.file = path.resolve(path.dirname(file), record.file);
  return result;
}
export function pairedComparison(rowsA, rowsB) {
  const key = (r) => JSON.stringify([r.seed, r.scenario, r.variant]);
  const b = new Map(rowsB.map((r) => [key(r), r]));
  const pairs = rowsA.filter((r) => b.has(key(r))).map((a) => ({ a, b: b.get(key(a)) }));
  if (!pairs.length) throw new Error('No paired seeds/scenarios');
  const measures = ['served', 'pending', 'overprovided', 'uncoveredUnitMs', 'onTime'];
  const water = {};
  for (const name of measures) {
    const differences = pairs.map(
      ({ a, b }) =>
        (b.metrics.services.water?.[name] ?? 0) - (a.metrics.services.water?.[name] ?? 0),
    );
    const mean = differences.reduce((s, x) => s + x, 0) / differences.length;
    const resamples = Array.from(
      { length: 1000 },
      (_, iteration) =>
        differences.reduce(
          (sum, _, i) =>
            sum +
            differences[
              Math.floor(
                keyedRandom('comparison', 'bootstrap', String(iteration), 'index', i) *
                  differences.length,
              )
            ],
          0,
        ) / differences.length,
    ).sort((a, b) => a - b);
    water[name] = {
      differenceBminusA: mean,
      interval95: [resamples[25], resamples[974]],
      pairedSeeds: differences.length,
    };
  }
  return {
    pairedEpisodes: pairs.length,
    unpairedA: rowsA.length - pairs.length,
    unpairedB: rowsB.length - pairs.length,
    water,
    note: 'Units are preserved. Positive values are not uniformly beneficial. This is a simulated paired bootstrap, not evidence of lives saved.',
  };
}
