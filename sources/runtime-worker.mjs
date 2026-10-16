import { parentPort, workerData } from 'node:worker_threads';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { World } from '../engine/world.mjs';
import { SimError } from '../contracts/actions.mjs';
import { evaluate } from '../evaluation/metrics.mjs';
import { createViewerBootstrap, createViewerFrame, getViewerMap } from './projections.mjs';
import { mergeViewerFrame } from '../viewer/projection.js';
import { createEvaluationInput } from './evaluation-snapshot.mjs';
import { createActorDeltaProjector } from './actor-delta.mjs';
import { publicPostingRate } from './posting-rate.mjs';
import { createCompactActorProjector } from './compact-actor.mjs';

// This thread is the sole owner of physical state. Projection and event
// consumers acknowledge their own delivery; neither ACK controls World.step.
let world = new World(workerData.config ?? {}, workerData.checkpoint ?? null);
let comparison = null, playing = false, rate = world.config.mode === 'live' ? 1 : 10;
let anchorWall = performance.now(), anchorSim = world.now, barrierActive = false;
let projectionPending = null, projectionVersion = 0, bootstrapId = null;
let eventPending = null;
let eventCursor = workerData.eventCursor ?? (workerData.checkpoint ? world.log.length : 0);
if (!Number.isSafeInteger(eventCursor) || eventCursor < 0 || eventCursor > world.log.length ||
    workerData.producerRunId !== undefined && workerData.producerRunId !== world.runId) eventCursor = 0;
let generation = Number.isSafeInteger(workerData.producerGeneration) && workerData.producerGeneration >= 0
  ? workerData.producerGeneration : 0;
let closed = false, running = false, scheduled = false, autoRequested = false;
let runtimeRevision = 0;
let lastTickWall = performance.now(), effectiveWall = lastTickWall, effectiveSim = world.now, effectiveRate = 0;
const tickMs = Math.max(1, workerData.tickMs ?? 80);
const workBudgetMs = Math.max(1, workerData.workBudgetMs ?? 8);
const projectionMs = Math.max(20, workerData.projectionMs ?? 500);
const requests = [], tickIntervals = [], workSamples = [], projectionSamples = [];
let tickCount = 0, workCount = 0;
const compactActors = createCompactActorProjector(() => world);
const compactActor = (org, options) => compactActors.project(org, options);
const actorProjector = createActorDeltaProjector();
const keep = (rows, value) => { rows.push(value); if (rows.length > 256) rows.shift(); };
const summary = rows => {
  const ordered = [...rows].sort((a, b) => a - b);
  return { count: rows.length, p50: ordered[Math.floor(ordered.length * .5)] ?? 0,
    p95: ordered[Math.floor(ordered.length * .95)] ?? 0, max: ordered.at(-1) ?? 0 };
};
const send = value => { if (!closed) parentPort.postMessage(value); };
function reanchor() { anchorWall = performance.now(); anchorSim = world.now; }
function desiredTime() {
  const target = Math.max(world.now, Math.round(anchorSim + (performance.now() - anchorWall) * rate));
  return world.config.continuousDemo ? target : Math.min(world.config.durationMs, target);
}
function runtime() {
  return { playing, rate, effectiveRate, continuousDemo: world.config.continuousDemo,
    benchmarkEligible: !world.config.continuousDemo,
    comparison: comparison ? { policyA: world.config.policy, policyB: comparison.config.policy, now: comparison.now } : null };
}
function meta() {
  return { runId: world.runId, generation, revision: runtimeRevision, logLength: world.log.length, manifest: world.manifest, config: world.config, now: world.now,
    organizations: world.state.map.organizations.map(o => ({ id: o.id, name: o.name })),
    integrations: { ...world.state.integrations }, ...runtime(),
    performance: { tickCount, workCount, tickIntervalMs: summary(tickIntervals), workMs: summary(workSamples),
      projectionMs: summary(projectionSamples), lagSimMs: playing ? Math.max(0, desiredTime() - world.now) : 0,
      modelBlocked: world.modelBarrier(), eventBacklog: world.log.length - eventCursor } };
}


function activity({ org = 'org0', perspective = 'truth' } = {}) {
  const truth = perspective === 'truth', limit = 200;
  if (!world.organization(org) || (!truth && perspective !== org))
    throw new SimError('ACTIVITY_SCOPE', 'Choose truth or the requested organization');
  const posts = world.state.posts.slice(-limit).filter(p => truth ||
    (!p.deleted && p.public.publishedAt !== null && p.public.publishedAt <= world.now &&
      (p.private?.audience === 'public' || p.private?.audience?.includes(org))));
  const observations = world.state.observations[org];
  const known = Object.fromEntries(Object.entries(observations).filter(([key]) =>
    ['buildings', 'needs', 'resources', 'vehicles', 'operations', 'population', 'edges'].includes(key)).map(([key, value]) =>
    [key, Array.isArray(value) ? value.slice(-limit) : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).filter(([, edge]) => key !== 'edges' || edge.open === false).slice(-limit)) : value]));
  return { runId: world.runId, now: world.now, org, perspective, sampleLimit: limit,
    state: { posts: truth ? posts : posts.map(p => ({ public: p.public, indexAt: p.indexAt, deleted: p.deleted,
      private: { audience: p.private.audience } })),
    ingestion: world.state.ingestion.filter(r => truth || r.org === org).slice(-limit), observations: { [org]: known } },
    events: world.log.slice(-limit).filter(e => truth || (e.type === 'message_delivered' && e.data?.to === org) ||
      (e.type === 'sharing_received' && e.data?.to === org) || (e.type === 'query_completed' && e.data?.org === org)),
    totals: { posts: world.state.posts.length, ingestion: world.state.ingestion.length } };
}
function timeline(params = {}, feed = world.publicFeed(params)) {
  return { ...feed, posts: feed.posts.map(p => ({ ...p, locationName: world.building(p.location)?.name ?? p.location })),
    runId: world.runId, playing, rate, continuousDemo: world.config.continuousDemo,
    publicPostsPublished: world.state.statistics.publicPostsPublished ?? 0,
    postingRate: publicPostingRate(world) };
}
function publicSource() {
  if (!world.state.integrations.sourceAvailable) throw new SimError('SOURCE_UNAVAILABLE', 'Source is temporarily unavailable', 503);
}
function emitEvents() {
  if (eventPending || closed || eventCursor >= world.log.length) return;
  const events = world.log.slice(eventCursor, eventCursor + 100);
  eventPending = { fromOffset: eventCursor, throughOffset: eventCursor + events.length, generation };
  send({ type: 'events', runId: world.runId, generation, ...eventPending, events });
}
function emitProjection() {
  if (projectionPending || closed) return;
  const began = performance.now(), map = getViewerMap(world);
  const bootstrap = bootstrapId !== map.projectionId ? { mapId: map.projectionId, map } : undefined;
  const actors = world.state.map.organizations.filter(o => !world.state.integrations.revokedOrgs.includes(o.id))
    .map(o => { const { state, results } = compactActor(o.id, { onlyNewResults: true });
      return { org: o.id, statePatch: actorProjector.project(o.id, state), results }; });
  const frame = createViewerFrame(world, { org: 'org0', perspective: 'truth', runtime: runtime(), detach: false });
  const feed = world.publicFeed({ limit: 100 });
  projectionPending = ++projectionVersion;
  send({ type: 'projection', version: projectionPending, generation, runId: world.runId, meta: meta(), bootstrap, frame, actors,
    activity: activity(), feed, timeline: timeline({ limit: 100 }, feed) });
  bootstrapId = map.projectionId;
  keep(projectionSamples, performance.now() - began);
}
function advanceSlice(target, current = world) {
  if (!Number.isSafeInteger(target) || target < current.now) throw new Error('Invalid advance target');
  const began = performance.now(); let processed = 0;
  while (!current.modelBarrier() && current.queue.peek()?.at <= target && performance.now() - began < workBudgetMs) {
    current.step(); processed++;
  }
  const result = current.advance(target, { maxEvents: 0 });
  keep(workSamples, performance.now() - began); workCount++;
  return { ...result, processed };
}
async function advanceTo(target, current = world) {
  let result, processed = 0;
  do {
    result = advanceSlice(target, current); processed += result.processed;
    if (!result.reached && !result.blocked) await yieldTurn();
  } while (!result.reached && !result.blocked && !closed);
  return { ...result, processed };
}
async function advanceComparison() {
  if (comparison && comparison.now <= world.now) await advanceTo(world.now, comparison);
}
function replaceWorld(next, { resume = false } = {}) {
  playing = false; world.close(); comparison?.close(); comparison = null; world = next;
  rate = world.config.mode === 'live' ? 1 : 10; effectiveRate = 0; barrierActive = false;
  generation++; eventCursor = resume ? world.log.length : 0; eventPending = null;
  bootstrapId = null; projectionPending = null; compactActors.reset();
  actorProjector.reset();
  reanchor();
}
const methods = {
  meta,
  resetPerformance() {
    tickIntervals.length = 0; workSamples.length = 0; projectionSamples.length = 0;
    tickCount = 0; workCount = 0; lastTickWall = performance.now();
    effectiveWall = lastTickWall; effectiveSim = world.now; effectiveRate = 0;
    return { reset: true };
  },
  actorState: org => world.actorView(org),
  actorCompact: org => compactActor(org),
  actorQueries: org => {
    if (!world.organization(org) || world.state.integrations.revokedOrgs.includes(org))
      throw new SimError('ACCESS_REVOKED', 'Actor access has been revoked', 403);
    return (world.state.queries ?? []).filter(q => q.org === org).slice(-200);
  },
  queryResult: (org, id, version) => compactActors.queryResult(org, id, version),
  actorAction: (actor, input) => world.act(actor, input),
  checkpoint: () => world.checkpoint(),
  metrics: () => evaluate(world),
  evaluationInput: () => createEvaluationInput(world, { detach: false }),
  observer: options => ({ ...world.observer(options), ...runtime() }),
  viewerBootstrap: (options = {}) => createViewerBootstrap(world, { ...options, runtime: runtime(), detach: false }),
  viewerFrame: (options = {}) => createViewerFrame(world, { ...options, runtime: runtime(), detach: false }),
  activity,
  feed(params) { publicSource(); return world.publicFeed(params); },
  timeline(params) { publicSource(); return timeline(params); },
  post(id) { publicSource(); const post = world.post(id); if (!world.sourceVisible(post)) throw new SimError('NOT_FOUND', 'Post not found', 404);
    return { ...post.public, locationName: world.building(post.public.location)?.name ?? post.public.location }; },
  acknowledge: (actor, input) => world.acknowledge(actor, input),
  acknowledgeBatch(actor, items) {
    if (!Array.isArray(items) || items.length > 100) throw new SimError('BATCH', 'One to one hundred ingestion receipts required', 400);
    return items.map(p => { try { return { id: p.id, ok: true, receipt: world.acknowledge(actor, p) }; }
      catch (e) { return { id: p.id, ok: false, error: e.code ?? 'RECEIPT', message: e.message }; } });
  },
  startModelCall(actor, input) {
    const result = world.startModelCall(actor, input);
    if (world.modelBarrier()) { barrierActive = true; reanchor(); }
    return result;
  },
  async finishModelCall(actor, input) {
    const result = world.finishModelCall(actor, input);
    if (world.config.clockLatency === 'modeled' && !world.modelBarrier()) await advanceTo(result.availableAt);
    if (!world.modelBarrier()) { barrierActive = false; reanchor(); }
    return { ...result, now: world.now };
  },
  async control(input = {}) {
    if (input.rate !== undefined) {
      if (![1, 10, 100, 1000].includes(input.rate)) throw new SimError('RATE', 'Invalid speed');
      if (world.config.mode === 'live' && input.rate !== 1) throw new SimError('LIVE_RATE', 'Live external-platform evaluation uses wall time at ×1');
      rate = input.rate; reanchor();
    }
    if (input.play !== undefined) { playing = !!input.play; reanchor(); }
    if (input.step) { playing = false; world.step(); reanchor(); }
    if (input.advanceTo !== undefined) { playing = false; await advanceTo(input.advanceTo); reanchor(); }
    if (input.nextRelevant) {
      const next = world.queue.toJSON().find(e => JSON.stringify(e.data).includes(String(input.nextRelevant)));
      if (!next) throw new SimError('EVENT', 'No queued event for this entity');
      await advanceTo(next.at); reanchor();
    }
    await advanceComparison();
    return { playing, rate, now: world.now };
  },
  async advance(target) { const result = await advanceTo(target); await advanceComparison(); reanchor(); return result; },
  inject({ type, data = {} }) {
    if (!['damage', 'road_change', 'intervention', 'scenario_signal', 'fire_front', 'flood_level', 'lab_intervention'].includes(type))
      throw new SimError('EVENT', 'Event type not allowed');
    world.inject(type, data); return { injected: true };
  },
  reset(config) { replaceWorld(new World(config)); return { runId: world.runId }; },
  restore(checkpoint) { replaceWorld(new World(checkpoint.manifest.config, checkpoint), { resume: true }); return { restored: true, runId: world.runId }; },
  events({ offset = 0, entity } = {}) {
    const start = Math.max(0, Number(offset));
    const rows = entity ? world.log.filter(e => e.entity === entity || Object.values(e.data ?? {}).includes(entity)) : world.log;
    return { events: rows.slice(start, start + 200), total: rows.length, next: start + 200 < rows.length ? start + 200 : null };
  },
  compare(options = {}) {
    if (options.create || options.policyA || options.policyB) {
      if (world.config.continuousDemo) throw new SimError('DEMO_COMPARISON', 'Create a finite modeled or live world before starting a benchmark comparison', 409);
      const config = { ...world.config, policy: options.policyA ?? 'conventional' };
      const a = new World(config), other = new World({ ...config, policy: options.policyB ?? 'federated' });
      if (a.state.map.hash !== other.state.map.hash) { a.close(); other.close(); throw new SimError('PAIR', 'Initial worlds differ'); }
      replaceWorld(a); comparison = other;
      return { paired: true, initialMapHash: a.state.map.hash };
    }
    if (!comparison) return null;
    const presentation = current => {
      const view = createViewerBootstrap(current, { runtime: runtime(), detach: false });
      return mergeViewerFrame(view.map, view.frame);
    };
    return options.pair ? { a: presentation(world), b: presentation(comparison) }
      : presentation(comparison);
  },
  close() { playing = false; world.close(); comparison?.close(); return { closed: true }; },
};

function schedule() {
  if (closed || scheduled || running) return;
  scheduled = true; setImmediate(drive);
}
async function drive() {
  if (running || closed) return;
  scheduled = false; running = true;
  try {
    let handled = 0;
    while (requests.length && !closed && handled++ < 8) {
      const request = requests.shift();
      try {
        if (!Object.hasOwn(methods, request.method)) throw new SimError('METHOD', 'Unknown runtime method', 404);
        runtimeRevision++;
        const result = await methods[request.method](...(request.args ?? []));
        send({ type: 'reply', id: request.id, result });
        if (request.method === 'close') {
          closed = true; clearInterval(ticker); clearInterval(projector); parentPort.close();
        }
      } catch (error) {
        send({ type: 'reply', id: request.id, error: { code: error.code ?? 'ERROR', message: error.message, status: error.status ?? 500 } });
      }
    }
    if (autoRequested && playing && !closed) {
      autoRequested = false;
      if (world.modelBarrier()) { if (!barrierActive) reanchor(); barrierActive = true; }
      else {
        runtimeRevision++;
        if (barrierActive) { reanchor(); barrierActive = false; }
        const progress = advanceSlice(desiredTime());
        if (!progress.reached && !progress.blocked) autoRequested = true;
        if (comparison) await advanceComparison();
        if (!world.config.continuousDemo && world.now >= world.config.durationMs) playing = false;
        const wall = performance.now();
        if (wall - effectiveWall >= 100) {
          effectiveRate = (world.now - effectiveSim) / (wall - effectiveWall); effectiveWall = wall; effectiveSim = world.now;
        }
      }
    }
    if (!closed) emitEvents();
  } catch (error) {
    playing = false;
    world.record('runtime_error', { message: error.message });
    send({ type: 'runtimeError', error: { code: error.code ?? 'ERROR', message: error.message } });
  } finally {
    running = false;
    if (requests.length || autoRequested && playing) schedule();
  }
}
parentPort.on('message', message => {
  if (message.type === 'request') { requests.push(message); schedule(); }
  if (message.type === 'projectionAck' && message.version === projectionPending &&
      (message.generation === undefined || message.generation === generation) &&
      (message.runId === undefined || message.runId === world.runId)) projectionPending = null;
  if (message.type === 'eventsAck' && eventPending && message.throughOffset === eventPending.throughOffset &&
      (message.generation === undefined || message.generation === generation) &&
      (message.runId === undefined || message.runId === world.runId)) {
    eventCursor = eventPending.throughOffset; eventPending = null; emitEvents();
  }
});
const ticker = setInterval(() => {
  const wall = performance.now(); keep(tickIntervals, wall - lastTickWall); lastTickWall = wall; tickCount++;
  if (playing) { autoRequested = true; schedule(); }
}, tickMs);
const projector = setInterval(() => {
  if (running || closed || projectionPending) return;
  try { emitProjection(); } catch (error) {
    send({ type: 'projectionError', error: { code: error.code ?? 'ERROR', message: error.message } });
  }
}, projectionMs);
send({ type: 'ready', meta: meta() });
emitEvents();
emitProjection();
