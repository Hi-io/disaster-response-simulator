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
      else if (input.kind === 'model_start') w.startModelCall(input.actor, input.request);
      else if (input.kind === 'model_finish') w.finishModelCall(input.actor, input.request);
      else if (input.kind === 'ingestion') w.acknowledge(input.actor, input.request);
      else w.act(input.actor, input.request);
    } catch (error) {
      if (!input.allowFailure) throw error;
    }
  }
  while (!w.advance(w.config.durationMs, { maxEvents: 100000 }).reached) {
    if (w.modelBarrier())
      throw new Error(
        'An external model result is pending; submit its recorded receipt before headless continuation',
      );
  }
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
      else if (input.kind === 'model_start') w.startModelCall(input.actor, input.request);
      else if (input.kind === 'model_finish') w.finishModelCall(input.actor, input.request);
      else if (input.kind === 'ingestion') w.acknowledge(input.actor, input.request);
      else w.act(input.actor, input.request);
    } catch {}
  }
  while (!w.advance(checkpoint.now, { maxEvents: 100000 }).reached) {
    if (w.modelBarrier()) {
      if (w.now === checkpoint.now) break;
      throw new Error('Replay has unresolved model barrier');
    }
  }
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
  if (b.size !== rowsB.length || new Set(rowsA.map(key)).size !== rowsA.length)
    throw new Error('Ambiguous paired rows: compare one policy per seed/scenario/variant');
  const pairs = rowsA.filter((r) => b.has(key(r))).map((a) => ({ a, b: b.get(key(a)) }));
  if (!pairs.length) throw new Error('No paired seeds/scenarios');
  const comparable = (c) => {
    const { policy, mode, logMode, ...rest } = c;
    return digest(rest);
  };
  for (const { a, b } of pairs)
    if (a.config && b.config && comparable(a.config) !== comparable(b.config))
      throw new Error('Paired worlds have different initial parameters, resources or budgets');
  const measures = ['served', 'pending', 'overprovided', 'uncoveredUnitMs', 'onTime'];
  const summarize = (differences) => {
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
    return {
      differenceBminusA: mean,
      interval95: [resamples[25], resamples[974]],
      pairedSeeds: differences.length,
    };
  };
  const types = [
    ...new Set(
      pairs.flatMap(({ a, b }) => [
        ...Object.keys(a.metrics.services),
        ...Object.keys(b.metrics.services),
      ]),
    ),
  ];
  const services = Object.fromEntries(
    types.map((type) => [
      type,
      Object.fromEntries(
        measures.map((name) => [
          name,
          summarize(
            pairs.map(
              ({ a, b }) =>
                (b.metrics.services[type]?.[name] ?? 0) - (a.metrics.services[type]?.[name] ?? 0),
            ),
          ),
        ]),
      ),
    ]),
  );
  const population = Object.fromEntries(
    [
      'deceased',
      'alive',
      'injured',
      'waterDeficitPersonHours',
      'foodDeficitPersonHours',
      'exposurePersonHours',
      'untreatedInjuryPersonHours',
    ].map((name) => [
      name,
      summarize(
        pairs.map(
          ({ a, b }) => (b.metrics.population?.[name] ?? 0) - (a.metrics.population?.[name] ?? 0),
        ),
      ),
    ]),
  );
  return {
    pairedEpisodes: pairs.length,
    unpairedA: rowsA.length - pairs.length,
    unpairedB: rowsB.length - pairs.length,
    water: services.water ?? {},
    services,
    population,
    comparability: pairs.every(({ a, b }) => a.config && b.config)
      ? 'matched manifest parameters'
      : 'unverified: configuration missing from legacy rows',
    note: 'Units are preserved. Positive values are not uniformly beneficial. This is a simulated paired bootstrap, not evidence of lives saved.',
  };
}
