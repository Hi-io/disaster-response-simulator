import { Worker } from 'node:worker_threads';
import path from 'node:path';
import os from 'node:os';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { createLocalEventBus } from './local-event-bus.mjs';
import { createQueuedDocuments } from './queued-documents.mjs';
import { mergeViewerFrame } from '../viewer/projection.js';
import { applyActorDelta } from './actor-delta.mjs';
import { evaluateOutsideSimulation } from './evaluation-snapshot.mjs';
import { writeAtomicJson } from './atomic-json.mjs';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function actorPatch(previous, state) {
  if (!previous || previous.runId !== state.runId) return { replace: state };
  const known = {},
    removed = {};
  for (const [kind, rows] of Object.entries(state.known)) {
    if (!rows || Array.isArray(rows) || typeof rows !== 'object') {
      known[kind] = rows;
      continue;
    }
    const old = previous.known[kind] ?? {};
    known[kind] = Object.fromEntries(
      Object.entries(rows).filter(([id, value]) => !same(old[id], value)),
    );
    removed[kind] = Object.keys(old).filter((id) => !Object.hasOwn(rows, id));
  }
  const header = Object.fromEntries(
    Object.entries(state).filter(([key, value]) => key !== 'known' && !same(previous[key], value)),
  );
  return {
    header,
    removedHeader: Object.keys(previous).filter(
      (key) => key !== 'known' && !Object.hasOwn(state, key),
    ),
    known,
    removed,
    removedKinds: Object.keys(previous.known).filter((kind) => !Object.hasOwn(state.known, kind)),
  };
}
const applyActor = applyActorDelta;
const eventDigest = (event) => createHash('sha256').update(JSON.stringify(event)).digest('hex');

// Bus and document store are injected ports. A cloud transport can replace them
// without importing the simulation engine or changing its commands/results.
export async function createIsolatedRuntime({
  config = {},
  checkpoint,
  storageDir,
  bus: providedBus,
  documents: providedDocuments,
  tickMs = 80,
  workBudgetMs = 8,
  projectionMs = 500,
  viewRetentionMessages = 256,
  pruneEveryProjections = 16,
} = {}) {
  if (
    !Number.isSafeInteger(viewRetentionMessages) ||
    viewRetentionMessages < 1 ||
    !Number.isSafeInteger(pruneEveryProjections) ||
    pruneEveryProjections < 1
  )
    throw Error('Presentation retention limits must be positive integers.');
  const directory = storageDir ?? (await mkdtemp(path.join(os.tmpdir(), 'aidscaler-runtime-')));
  await mkdir(directory, { recursive: true });
  const bus =
    providedBus ?? (await createLocalEventBus({ storageDir: path.join(directory, 'queue') }));
  let documents, producer;
  const cursorFile = path.join(directory, 'producer.json');
  try {
    documents =
      providedDocuments ??
      (await createQueuedDocuments({ bus, storageDir: path.join(directory, 'documents') }));
    try {
      producer = JSON.parse(await readFile(cursorFile, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    // A fresh world is a new episode even if its deterministic runId equals a
    // previous run. A checkpoint may resume only its own persisted producer.
    if (!checkpoint || producer?.runId !== checkpoint.runId) producer = null;
    if (
      producer &&
      (producer.eventCursor > (checkpoint.log?.length ?? 0) ||
        (Array.isArray(checkpoint.log) &&
          producer.eventCursor > 0 &&
          producer.lastEventHash &&
          eventDigest(checkpoint.log[producer.eventCursor - 1]) !== producer.lastEventHash))
    )
      producer = null;
    producer ??= { epoch: randomUUID(), eventCursor: 0, generation: 0 };
    if (
      typeof producer.epoch !== 'string' ||
      !Number.isSafeInteger(producer.eventCursor) ||
      producer.eventCursor < 0 ||
      !Number.isSafeInteger(producer.generation ?? 0) ||
      (producer.generation ?? 0) < 0
    )
      throw Error('Invalid persisted event producer cursor.');
  } catch (error) {
    if (!providedBus) await bus.close();
    throw error;
  }
  const generationBase = producer.generation ?? 0;
  const publicationId = randomUUID();
  let meta,
    fatal,
    engineFailure = false,
    closed = false,
    closing = false,
    closePromise,
    version = 0,
    active = 0,
    transportTail = Promise.resolve();
  const recentViewSequences = [],
    viewAudiences = new Set(['observer']);
  let resolveReady, rejectReady, resolveInitial, rejectInitial;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const initial = new Promise((resolve, reject) => {
    resolveInitial = resolve;
    rejectInitial = reject;
  });
  initial.catch(() => {});
  const requests = new Map(),
    actors = new Map(),
    producedActors = new Map(),
    results = new Map(),
    maps = new Map(),
    frames = new Map(),
    subscriptions = new Map();
  let activityCache, timelineCache, feedCache, evaluationPending;
  const evaluations = new Set();
  let worker;
  try {
    worker = new Worker(new URL('./runtime-worker.mjs', import.meta.url), {
      ...(process.execArgv.some((argument) => argument.startsWith('--input-type'))
        ? { execArgv: [] }
        : {}),
      workerData: {
        config,
        checkpoint,
        tickMs,
        workBudgetMs,
        projectionMs,
        eventCursor: producer.eventCursor,
        producerRunId: producer.runId,
        producerEpoch: producer.epoch,
        sourceGenerationBase: generationBase,
      },
    });
  } catch (error) {
    if (!providedBus) await bus.close();
    throw error;
  }
  const scope = (org = 'org0', perspective = 'truth') => `${org}:${perspective}`;
  const fail = (error) => {
    fatal ??= error;
    rejectReady(fatal);
    rejectInitial(fatal);
    for (const item of requests.values()) {
      clearTimeout(item.timer);
      item.reject(fatal);
    }
    requests.clear();
  };
  const updateMeta = (value) => {
    if (meta && (value.generation ?? 0) < (meta.generation ?? 0)) return;
    if (
      meta &&
      (value.generation ?? 0) === (meta.generation ?? 0) &&
      (value.revision ?? 0) < (meta.revision ?? 0)
    )
      return;
    if (meta && (value.generation ?? 0) !== (meta.generation ?? 0)) {
      actors.clear();
      producedActors.clear();
      results.clear();
      maps.clear();
      frames.clear();
      activityCache = timelineCache = feedCache = undefined;
    }
    meta = value;
    for (const org of meta.integrations?.revokedOrgs ?? []) {
      actors.delete(org); producedActors.delete(org);
      for (const key of results.keys()) if (key.startsWith(`${org}:`)) results.delete(key);
    }
  };
  function pruneOrgResults(org, state) {
    const retained = new Set(
      (state.queries ?? []).flatMap((query) => (query.resultRef ? [query.resultRef.version] : [])),
    );
    const prefix = `${org}:`;
    for (const key of results.keys())
      if (key.startsWith(prefix) && !retained.has(key.slice(prefix.length))) results.delete(key);
  }
  function pruneMaps() {
    const retained = new Set([...frames.values()].map((frame) => frame.mapId));
    for (const id of maps.keys()) if (!retained.has(id)) maps.delete(id);
  }
  worker.on('error', (error) => {
    engineFailure = true;
    fail(error);
  });
  worker.on('exit', (code) => {
    if (!closed && !closing) {
      engineFailure = true;
      fail(Error(`Simulation worker exited unexpectedly (${code}).`));
    }
  });
  function command(method, ...args) {
    if (
      fatal &&
      (engineFailure || !['meta', 'control', 'checkpoint', 'close', 'events'].includes(method))
    )
      return Promise.reject(fatal);
    if (closed) return Promise.reject(Error('Simulation runtime is closed.'));
    const id = ++active;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        requests.delete(id);
        reject(Error(`Simulation command timed out: ${method}`));
      }, 180000);
      requests.set(id, { resolve, reject, timer });
      try {
        worker.postMessage({ type: 'request', id, method, args });
      } catch (error) {
        clearTimeout(timer);
        requests.delete(id);
        reject(error);
      }
    });
  }
  function request(method, ...args) {
    return closing
      ? Promise.reject(Error('Simulation runtime is closing.'))
      : command(method, ...args);
  }
  async function subscription(audience) {
    if (subscriptions.has(audience)) return subscriptions.get(audience);
    const subscriptionId = `materializer-v1:${audience}`;
    const saved = await bus.subscribe({ subscriptionId, audience, from: 'beginning' });
    await bus.replay({ subscriptionId, afterSequence: saved.cursor });
    subscriptions.set(audience, subscriptionId);
    return subscriptionId;
  }
  async function consume(audience) {
    const subscriptionId = await subscription(audience);
    for (;;) {
      const batch = await bus.pull({ subscriptionId, limit: 100, leaseMs: 30000 });
      if (!batch.messages.length) break;
      for (const delivery of batch.messages) {
        const { transport, ...data } = await documents.resolve(delivery.envelope);
        // Earlier processes may have crashed after publication but before ACK.
        // Their sparse patches have no baseline in this process. Drain them, then
        // materialize this process's self-contained bootstrap and actor snapshots.
        const current =
          transport?.publicationId === publicationId &&
          transport?.generation === (meta.generation ?? 0);
        if (current)
          switch (delivery.envelope.type) {
            case 'viewer.bootstrap':
              maps.set(data.mapId, data.map);
              break;
            case 'viewer.frame':
              frames.set(scope(data.org, data.perspective), data);
              pruneMaps();
              break;
            case 'actor.patch':
              actors.set(data.org, applyActor(actors.get(data.org), data.patch));
              pruneOrgResults(data.org, actors.get(data.org));
              break;
            case 'query.result':
              results.set(`${data.org}:${data.version}`, data.result);
              break;
            case 'runtime.activity':
              activityCache = data;
              break;
            case 'runtime.timeline':
              timelineCache = data;
              break;
            case 'runtime.feed':
              feedCache = data;
              break;
          }
        await bus.ack({ subscriptionId, deliveryIds: [delivery.deliveryId] });
      }
    }
  }
  async function publish(type, audience, payload, key, packetMeta = meta) {
    const receipt = await documents.publish({
      eventId: `${producer.epoch}:${key}`,
      runId: packetMeta.runId,
      orderingKey: `${packetMeta.runId}:${audience}`,
      audience,
      type,
      simTimeMs: packetMeta.now,
      payload: JSON.parse(
        JSON.stringify({
          ...payload,
          transport: { publicationId, generation: packetMeta.generation ?? 0 },
        }),
      ),
    });
    viewAudiences.add(audience);
    recentViewSequences.push(receipt.sequence);
    if (recentViewSequences.length > viewRetentionMessages) recentViewSequences.shift();
  }
  async function pruneViews() {
    if (
      typeof bus.prune !== 'function' ||
      typeof bus.retainedDocumentRefs !== 'function' ||
      typeof documents.pruneUnreferenced !== 'function' ||
      recentViewSequences.length < viewRetentionMessages
    )
      return;
    const audiences = [...viewAudiences],
      throughSequence = recentViewSequences[0] - 1;
    let count;
    do {
      count = (await bus.prune({ throughSequence, audiences, limit: 1000 })).pruned;
    } while (count === 1000);
    const retainedSha256 = await bus.retainedDocumentRefs({ audiences });
    await documents.pruneUnreferenced({ retainedSha256 });
  }
  async function projection(message) {
    updateMeta(message.meta);
    const packetMeta = message.meta;
    const acknowledge = () =>
      worker.postMessage({
        type: 'projectionAck',
        version: message.version,
        generation: message.generation,
        runId: message.runId ?? message.meta.runId,
      });
    if ((packetMeta.generation ?? 0) < (meta.generation ?? 0)) {
      acknowledge();
      return;
    }
    const audiences = new Set(['observer']);
    if (message.bootstrap)
      await publish(
        'viewer.bootstrap',
        'observer',
        message.bootstrap,
        `map:${publicationId}:${packetMeta.generation ?? 0}:${message.bootstrap.mapId}`,
        packetMeta,
      );
    for (const actor of message.actors) {
      const audience = `org:${actor.org}`;
      audiences.add(audience);
      for (const result of actor.results ?? [])
        await publish(
          'query.result',
          audience,
          { org: actor.org, ...result },
          `result:${publicationId}:${packetMeta.generation ?? 0}:${actor.org}:${result.id}:${result.version}`,
          packetMeta,
        );
      const patch = actor.statePatch ?? actorPatch(producedActors.get(actor.org), actor.state);
      await publish(
        'actor.patch',
        audience,
        { org: actor.org, patch },
        `actor:${publicationId}:${actor.org}:${version}:${message.version}`,
        packetMeta,
      );
      producedActors.set(
        actor.org,
        actor.state ?? applyActor(producedActors.get(actor.org), patch),
      );
    }
    await publish(
      'viewer.frame',
      'observer',
      message.frame,
      `frame:${publicationId}:${version}:${message.version}`,
      packetMeta,
    );
    await publish(
      'runtime.activity',
      'observer',
      message.activity,
      `activity:${publicationId}:${version}:${message.version}`,
      packetMeta,
    );
    await publish(
      'runtime.timeline',
      'observer',
      message.timeline,
      `timeline:${publicationId}:${version}:${message.version}`,
      packetMeta,
    );
    if (message.feed)
      await publish(
        'runtime.feed',
        'observer',
        message.feed,
        `feed:${publicationId}:${version}:${message.version}`,
        packetMeta,
      );
    for (const audience of audiences) await consume(audience);
    version++;
    if (version % pruneEveryProjections === 0) await pruneViews();
    acknowledge();
    resolveInitial();
  }
  worker.on('message', (message) => {
    if (message.type === 'ready') {
      updateMeta(message.meta);
      resolveReady(meta);
      return;
    }
    if (message.type === 'reply') {
      const item = requests.get(message.id);
      if (!item) return;
      requests.delete(message.id);
      clearTimeout(item.timer);
      if (message.error) {
        const error = Error(message.error.message);
        Object.assign(error, message.error);
        item.reject(error);
      } else item.resolve(message.result);
      return;
    }
    if (message.type === 'projection') {
      transportTail = transportTail.then(() => projection(message)).catch(fail);
      return;
    }
    if (message.type === 'events') {
      transportTail = transportTail
        .then(async () => {
          if (!message.events.length) return;
          await bus.publish(
            message.events.map((event, index) => ({
              eventId: `${producer.epoch}:${message.runId}:generation:${generationBase + (message.generation ?? 0)}:event:${message.fromOffset + index}`,
              runId: message.runId,
              orderingKey: message.runId,
              audience: 'audit',
              type: 'simulation.event',
              simTimeMs: event.at,
              payload: JSON.parse(JSON.stringify({ offset: message.fromOffset + index, event })),
            })),
          );
          const nextProducer = {
            ...producer,
            eventCursor: message.throughOffset,
            runId: message.runId,
            generation: generationBase + (message.generation ?? 0),
            lastEventHash: eventDigest(message.events.at(-1)),
          };
          await writeAtomicJson(cursorFile, nextProducer);
          // The producer cursor and engine ACK advance only after its durable
          // replacement succeeds. A persistent disk error leaves the old cursor
          // intact, so restart retries the already deduplicated queue batch.
          Object.assign(producer, nextProducer);
          worker.postMessage({
            type: 'eventsAck',
            throughOffset: message.throughOffset,
            runId: message.runId,
            generation: message.generation,
          });
        })
        .catch(fail);
      return;
    }
    if (message.type === 'runtimeError')
      fail(Object.assign(Error(message.error.message), message.error));
    if (message.type === 'projectionError')
      fail(Object.assign(Error(message.error.message), message.error));
  });
  try {
    await ready;
    await initial;
  } catch (error) {
    closed = true;
    await worker.terminate();
    await transportTail;
    if (!providedBus) await bus.close();
    throw error;
  }
  return {
    directory,
    bus,
    documents,
    request,
    get meta() {
      return meta;
    },
    get error() {
      return fatal;
    },
    get cacheStats() {
      return {
        maps: maps.size,
        frames: frames.size,
        resultBodies: results.size,
        organizations: actors.size,
        evaluations: evaluations.size,
      };
    },
    async refresh() {
      updateMeta(await request('meta'));
      return meta;
    },
    evaluate() {
      if (closing || closed)
        return Promise.reject(Error('Simulation runtime is closing or closed.'));
      const generation = meta.generation ?? 0;
      if (evaluationPending?.generation === generation) return evaluationPending.promise;
      const pending = { generation, controller: new AbortController() };
      pending.promise = (async () =>
        evaluateOutsideSimulation(await request('evaluationInput'), {
          signal: pending.controller.signal,
        }))().finally(() => {
        evaluations.delete(pending);
        if (evaluationPending === pending) evaluationPending = undefined;
      });
      pending.promise.catch(() => {});
      evaluations.add(pending);
      evaluationPending = pending;
      return pending.promise;
    },
    async bootstrap(org = 'org0', perspective = 'truth') {
      const key = scope(org, perspective);
      let frame = frames.get(key);
      if (!frame || !maps.has(frame.mapId)) {
        const data = await request('viewerBootstrap', { org, perspective });
        maps.set(data.mapId, data.map);
        frames.set(key, data.frame);
        frame = data.frame;
        pruneMaps();
      }
      return { mapId: frame.mapId, map: maps.get(frame.mapId), frame };
    },
    async frame(org = 'org0', perspective = 'truth') {
      if (org === 'org0' && perspective === 'truth') return frames.get(scope(org, perspective));
      const value = await request('viewerFrame', { org, perspective });
      frames.set(scope(org, perspective), value);
      pruneMaps();
      return value;
    },
    async observer() {
      const data = await this.bootstrap();
      return mergeViewerFrame(data.map, data.frame);
    },
    async actor(org) {
      while (!actors.has(org)) {
        const instance = meta.sourceInstance;
        const value = await request('actorCompact', org);
        if (meta.sourceInstance !== instance) continue;
        actors.set(org, value.state);
        for (const r of value.results) results.set(`${org}:${r.version}`, r.result);
        pruneOrgResults(org, value.state);
      }
      return actors.get(org);
    },
    async queryResult(org, id, revision) {
      const state = await this.actor(org),
        query = state.queries.find((q) => q.id === id);
      if (!query?.resultRef) {
        const error = Error('Query result not found.');
        error.status = 404;
        error.code = 'NOT_FOUND';
        throw error;
      }
      if (query.resultRef.version !== revision) {
        const error = Error('Query result changed.');
        error.status = 409;
        error.code = 'VERSION_CONFLICT';
        throw error;
      }
      const key = `${org}:${revision}`;
      let result = results.get(key);
      if (!results.has(key)) {
        const value = await request('queryResult', org, id, revision);
        result = value.result;
        // The actor window may have moved while the RPC was in flight. Return
        // this requested revision without retaining an already retired body.
        if (actors.get(org)?.queries.some((query) => query.resultRef?.version === revision))
          results.set(key, result);
      }
      return { id, version: revision, result };
    },
    async legacyActor(org) {
      const state = structuredClone(await this.actor(org));
      for (const query of state.queries)
        if (query.resultRef) {
          query.result = (await this.queryResult(org, query.id, query.resultRef.version)).result;
          delete query.resultRef;
        }
      const id = state.compact.mapQueryId;
      if (id) state.known.map = state.queries.find((q) => q.id === id)?.result;
      delete state.compact;
      return state;
    },
    async activity(options = {}) {
      return !options.org ||
        (options.org === 'org0' && (!options.perspective || options.perspective === 'truth'))
        ? activityCache
        : request('activity', options);
    },
    get timeline() {
      return timelineCache;
    },
    get feed() {
      return feedCache;
    },
    async flush() {
      const target = await command('meta');
      for (;;) {
        await transportTail;
        if (fatal) throw fatal;
        if (
          !target.logLength ||
          (producer.runId === target.runId &&
            producer.generation === generationBase + (target.generation ?? 0) &&
            producer.eventCursor >= target.logLength)
        )
          break;
        await new Promise((resolve) => setImmediate(resolve));
      }
      // Even a reset with no emitted events must survive a checkpoint resume.
      transportTail = transportTail.then(async () => {
        const targetGeneration = generationBase + (target.generation ?? 0);
        if ((producer.generation ?? 0) > targetGeneration) return;
        const nextProducer = { ...producer, runId: target.runId, generation: targetGeneration,
          ...(!target.logLength ? { eventCursor: 0, lastEventHash: null } : {}) };
        await writeAtomicJson(cursorFile, nextProducer);
        Object.assign(producer, nextProducer);
      });
      await transportTail;
    },
    close() {
      if (closePromise) return closePromise;
      closing = true;
      for (const pending of evaluations) pending.controller.abort();
      closePromise = (async () => {
        let error;
        try {
          if (!engineFailure) {
            await command('control', { play: false });
            if (!fatal) await this.flush();
            await command('close');
          }
        } catch (value) {
          error = value;
        } finally {
          closed = true;
          for (const item of requests.values()) {
            clearTimeout(item.timer);
            item.reject(Error('Simulation runtime closed.'));
          }
          requests.clear();
          await worker.terminate();
          await transportTail;
          await Promise.allSettled([...evaluations].map((pending) => pending.promise));
          evaluations.clear();
          evaluationPending = undefined;
          actors.clear();
          producedActors.clear();
          results.clear();
          maps.clear();
          frames.clear();
          activityCache = timelineCache = feedCache = undefined;
          if (!providedBus) await bus.close();
        }
        if (error) throw error;
      })();
      return closePromise;
    },
  };
}
