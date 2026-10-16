import { Worker } from 'node:worker_threads';
import { rm } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { RecordArchive, recordSnapshot } from '../engine/archive.mjs';
import { evaluate } from '../evaluation/metrics.mjs';

const pick = (row, fields) =>
  Object.fromEntries(fields.filter((key) => row[key] !== undefined).map((key) => [key, row[key]]));
const buildingFields = [
  'id',
  'sector',
  'use',
  'servedPlaceMs',
  'state',
  'serviceIntegratedAt',
  'occupancy',
  'operatingMs',
];
const vehicleFields = [
  'id',
  'background',
  'operation',
  'state',
  'load',
  'passengers',
  'edge',
  'resourceType',
  'distanceM',
  'fuelUsed',
];
const humanFields = [
  'id',
  'org',
  'stage',
  'state',
  'startedAt',
  'readyAt',
  'createdAt',
  'completedAt',
  'queueMs',
];

// Capture one physical boundary. No evaluator walks the live archives: compact
// stores are flushed and copied synchronously by descriptor(), before World can
// execute another event. Geometry, received map copies and query result bodies
// are not inputs to evaluation/metrics.mjs or utilizationMetrics.
export function createEvaluationInput(world, { detach = true } = {}) {
  const s = world.state;
  const input = {
    now: world.now,
    eventCount: world.eventCount,
    config: { humanCapacity: world.config.humanCapacity },
    log: recordSnapshot(world.log),
    posts: recordSnapshot(s.posts),
    population: world.populationMetrics(),
    invariantErrors: world.invariants(),
    state: {
      needs: s.needs,
      operations: s.operations,
      statistics: s.statistics,
      resources: s.resources.map((row) => pick(row, ['id', 'type', 'reserved', 'produced'])),
      posts: { length: s.posts.length },
      ingestion: s.ingestion.map((row) => pick(row, ['org', 'id', 'version', 'stage', 'at'])),
      commitments: s.commitments.map((row) =>
        pick(row, ['id', 'resource', 'state', 'expiresAt', 'quantity']),
      ),
      proposals: s.proposals.map((row) => pick(row, ['state', 'reviewPending'])),
      transfers: s.transfers?.map((row) => pick(row, ['state'])),
      claims: s.claims.map((row) => pick(row, ['references', 'state', 'relation'])),
      modelRequests: s.modelRequests,
      queryCount: s.queryCount,
      toolCost: s.toolCost,
      invalidActions: s.invalidActions,
      modelCalls: s.modelCalls,
      modelWallMs: s.modelWallMs,
      postBudgetReached: s.postBudgetReached,
      vehicles: s.vehicles.map((row) => pick(row, vehicleFields)),
      fundEntries: s.fundEntries,
      humanWork: (s.humanWork ?? []).map((row) => pick(row, humanFields)),
      humanCapacity: s.humanCapacity,
      repairs: (s.repairs ?? []).map((row) => pick(row, ['state', 'staff'])),
      inspections: s.inspections.map((row) => pick(row, ['state', 'staff'])),
      observations: Object.fromEntries(
        Object.entries(s.observations).map(([org, known]) => [
          org,
          { needs: Object.fromEntries(Object.keys(known.needs).map((id) => [id, true])) },
        ]),
      ),
      map: {
        buildings: s.map.buildings.map((row) => pick(row, buildingFields)),
        sectors: s.map.sectors.map((row) => pick(row, ['id', 'terrain'])),
        edges: s.map.edges.map((row) => ({
          id: row.id,
          open: row.open,
          waiting: { length: row.waiting.length },
        })),
        crossings: s.map.crossings,
        organizations: s.map.organizations.map((row) => ({ funds: row.funds })),
      },
    },
  };
  // The runtime RPC calls this with detach:false and immediately postMessage's
  // return value before another physical command/event can run. That IPC is
  // already the atomic structured clone; a second copy on the physics thread
  // provides no extra isolation. Ordinary callers keep detached snapshots.
  return detach ? structuredClone(input) : input;
}

// The facade deliberately has no scheduling or mutation methods. This uses the
// exact production evaluator, with the two captured World read methods and
// immutable lookup records from the same simulation boundary.
export function evaluateSnapshot(input) {
  const opened = [];
  const open = (value, kind) => {
    if (!value?.archive) return value;
    const archive = new RecordArchive(kind, value);
    opened.push(archive);
    return archive;
  };
  try {
    const log = open(input.log, 'events'),
      posts = open(input.posts, 'posts');
    const index = (rows) => new Map(rows.map((row) => [row.id, row]));
    const buildings = index(input.state.map.buildings),
      sectors = index(input.state.map.sectors),
      edges = index(input.state.map.edges);
    const postIndex =
      posts instanceof RecordArchive ? null : new Map(posts.map((row) => [row.public.id, row]));
    return evaluate({
      now: input.now,
      eventCount: input.eventCount,
      config: input.config,
      state: input.state,
      log,
      building: (id) => buildings.get(id),
      sector: (id) => sectors.get(id),
      edge: (id) => edges.get(id),
      post: (id) => (postIndex ? postIndex.get(id) : posts.get(id)),
      populationMetrics: () => structuredClone(input.population),
      invariants: () => [...input.invariantErrors],
    });
  } finally {
    for (const archive of opened) {
      archive.close();
      rmSync(archive.directory, { recursive: true, force: true });
    }
  }
}

export async function evaluateOutsideSimulation(input, { signal } = {}) {
  let worker, timer, onAbort;
  const abortError = () =>
    Object.assign(new Error('Evaluation cancelled.'), { name: 'AbortError', code: 'ABORT_ERR' });
  try {
    if (signal?.aborted) throw abortError();
    worker = new Worker(new URL('./evaluation-worker.mjs', import.meta.url), {
      workerData: input,
      ...(process.execArgv.some((arg) => arg.startsWith('--input-type')) ? { execArgv: [] } : {}),
    });
    return await new Promise((resolve, reject) => {
      let delivered = false;
      const fail = (error) => {
        if (!delivered) {
          delivered = true;
          reject(error);
        }
      };
      timer = setTimeout(() => fail(new Error('Evaluation worker timed out.')), 180000);
      timer.unref();
      worker.once('message', (message) => {
        if (delivered) return;
        if (message.error) fail(Object.assign(new Error(message.error.message), message.error));
        else {
          delivered = true;
          resolve(message.result);
        }
      });
      worker.once('error', fail);
      worker.once('exit', (code) =>
        fail(new Error(`Evaluation worker exited without a result (${code}).`)),
      );
      onAbort = () => fail(abortError());
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
  } finally {
    if (onAbort) signal?.removeEventListener('abort', onAbort);
    clearTimeout(timer);
    await worker?.terminate();
    for (const source of [input.log, input.posts])
      if (
        source?.archive &&
        path.basename(source.file) === 'records.sqlite' &&
        path.basename(path.dirname(source.file)).startsWith('snapshot-')
      )
        await rm(path.dirname(source.file), { recursive: true, force: true });
  }
}
