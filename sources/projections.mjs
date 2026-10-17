import { clone } from '../engine/determinism.mjs';

// Read models for the observer UI. They never call advance/evaluate or mutate
// World. Geometry travels once; frames contain current presentation fields and
// finite activity samples, not query results, received maps or event archives.
const geometry = new WeakMap();
const baselines = new WeakMap();
const counters = new WeakMap();
const humanCounters = new WeakMap();
const pick = (value, fields) => Object.fromEntries(fields
  .filter(key => value[key] !== undefined).map(key => [key, value[key]]));
const buildingFields = ['state', 'damage', 'version', 'assessed', 'capacity', 'occupancy',
  'reservedPlaces', 'unloadingCount', 'receiverAvailable', 'provisioned'];
const cohortFields = ['sector', 'node', 'population', 'inTransit', 'deceased', 'health'];
const tuple = (value, fields) => [value.id, ...fields.map(key => value[key] ?? null)];
const cohortTuple = c => [c.id, c.sector, c.node, c.population, c.inTransit ?? 0, c.deceased ?? 0,
  c.health && (c.health.injured || c.health.waterDeficitPersonMs || c.health.foodDeficitPersonMs)
    ? pick(c.health, ['injured', 'waterDeficitPersonMs', 'foodDeficitPersonMs']) : null];
function sameValue(a, b) {
  if (a === b || (a == null && b == null)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const fields = Object.keys(a);
  return fields.length === Object.keys(b).length && fields.every(key => a[key] === b[key]);
}
const sampleLimit = 200;
function recentScoped(rows, org) {
  if (!org) return rows.slice(-sampleLimit);
  const recent = [];
  for (let index = rows.length - 1; index >= 0 && recent.length < sampleLimit; index--)
    if (rows[index].org === org) recent.push(rows[index]);
  return recent.reverse();
}

export function getViewerMap(world) {
  const map = world.state.map;
  let cached = geometry.get(map);
  if (cached) return cached;
  cached = clone({
    projectionId: `${world.runId}:${map.hash}:${world.now}:${world.eventCount}`,
    ...pick(map, ['hash', 'extentM', 'grid', 'topology', 'geography', 'river', 'crossings', 'shelterId', 'plantId']),
    nodes: map.nodes,
    buildings: map.buildings.map(b => pick(b, ['id', 'name', 'node', 'sector', 'x', 'z',
      'height', 'width', 'use', 'dependencies', 'requiredPower', 'storageCapacity', 'unloadCapacity', ...buildingFields])),
    edges: map.edges.map(e => pick(e, ['id', 'from', 'to', 'points', 'corridor', 'capacity', 'bridge',
      'lengthM', 'speedMps', 'roadClass', 'name', 'oneway', 'storage', 'headwayMs', 'maxWeight', 'slope'])),
    sectors: map.sectors.map(s => pick(s, ['id', 'name', 'node', 'x', 'z', 'locality',
      'jurisdiction', 'terrain', 'population'])),
    cohortFields,
    cohorts: world.state.cohorts.map(cohortTuple),
  });
  geometry.set(map, cached);
  baselines.set(map, {
    buildings: new Map(cached.buildings.map(b => [b.id, tuple(b, buildingFields)])),
    cohorts: new Map(cached.cohorts.map(row => [row[0], row])),
  });
  return cached;
}

function downloadCount(world) {
  const ingestion = world.state.ingestion;
  let cache = counters.get(world);
  if (!cache || cache.source !== ingestion || cache.index > ingestion.length) {
    cache = { source: ingestion, index: 0, downloaded: new Set() };
    counters.set(world, cache);
  }
  for (; cache.index < ingestion.length; cache.index++) {
    const r = ingestion[cache.index];
    if (r.stage === 'downloaded') cache.downloaded.add(`${r.org}:${r.id}:${r.version}`);
  }
  return cache.downloaded.size;
}

export function viewerMetrics(world) {
  const s = world.state, services = {};
  for (const n of s.needs) {
    const row = services[n.type] ??= { unit: n.unit, demand: 0, served: 0, pending: 0, overprovided: 0 };
    row.demand += n.quantity;
    row.served += Math.min(n.quantity, n.served);
    row.pending += Math.max(0, n.quantity - n.served);
    row.overprovided += Math.max(0, n.served - n.quantity);
  }
  const population = { deceased: 0, injured: 0, waterDeficitPersonHours: 0,
    foodDeficitPersonHours: 0, exposurePersonHours: 0, untreatedInjuryPersonHours: 0 };
  const health = h => {
    population.injured += h?.injured ?? 0;
    population.waterDeficitPersonHours += (h?.waterDeficitPersonMs ?? 0) / 3600000;
    population.foodDeficitPersonHours += (h?.foodDeficitPersonMs ?? 0) / 3600000;
    population.exposurePersonHours += (h?.exposurePersonMs ?? 0) / 3600000;
    population.untreatedInjuryPersonHours += (h?.injuryPersonMs ?? 0) / 3600000;
  };
  for (const c of s.cohorts) { population.deceased += c.deceased ?? 0; health(c.health); }
  const cohortIds = new Set(s.cohorts.map(c => c.id));
  for (const t of s.evacuations ?? [])
    if (t.health && !['completed', 'failed', 'cancelled'].includes(t.state) && cohortIds.has(t.cohort)) health(t.health);
  return {
    services, population, ledgerValid: null,
    source: { published: s.statistics.counts.post_published ?? 0 },
    information: { downloaded: downloadCount(world) },
    physical: {
      trafficQueue: s.map.edges.reduce((n, e) => n + e.waiting.length, 0),
      closedCrossings: (s.map.crossings ?? []).filter(b => b.edges.some(id => !world.edge(id).open)).length,
    },
    presentation: { at: world.now, kind: 'live-summary', fullEvaluation: '/api/metrics',
      note: 'Current physical counts. Full experimental evaluation and ledger checks are available on demand.' },
  };
}

function knownView(world, org) {
  const source = world.state.observations[org];
  if (!source) return {};
  const result = {};
  for (const key of ['buildings', 'needs', 'resources', 'vehicles', 'operations', 'population'])
    result[key] = source[key] ?? {};
  // Only closed received roads affect this reference map. Do not substitute
  // world closures: an owner continues to see its last received observation.
  result.edges = Object.fromEntries(Object.entries(source.edges ?? {}).filter(([, edge]) => edge.open === false));
  return result;
}

export function createViewerFrame(world, { org = 'org0', perspective = 'truth', runtime = {}, detach = true } = {}) {
  const s = world.state;
  const truth = perspective === 'truth';
  const currentOrg = world.organization(org);
  if (!currentOrg || (!truth && perspective !== org)) throw new Error('Choose truth or the requested organization');
  const posts = s.posts.slice(-sampleLimit).filter(p => truth ||
    (!p.deleted && p.public.publishedAt !== null && p.public.publishedAt <= world.now &&
      (p.private?.audience === 'public' || p.private?.audience?.includes(org))));
  const events = world.log.slice(-sampleLimit).filter(e => truth ||
    (e.type === 'message_delivered' && e.data?.to === org) ||
    (e.type === 'sharing_received' && e.data?.to === org) ||
    (e.type === 'query_completed' && e.data?.org === org));
  const map = getViewerMap(world), baseline = baselines.get(s.map);
  const changedBuildings = [];
  for (const b of s.map.buildings) {
    const base = baseline.buildings.get(b.id);
    if (!base || buildingFields.some((key, index) => !sameValue(b[key], base[index + 1])))
      changedBuildings.push(tuple(b, buildingFields));
  }
  const changedCohorts = [];
  if (truth) for (const c of s.cohorts) {
    const row = cohortTuple(c), base = baseline.cohorts.get(c.id);
    if (!base || row.some((value, index) => !sameValue(value, base[index]))) changedCohorts.push(row);
  }
  const frame = {
    mapId: map.projectionId, runId: world.runId, now: world.now, org, perspective,
    manifest: world.manifest, metrics: viewerMetrics(world),
    mapState: {
      buildingFields, buildings: changedBuildings,
      // A frame is an independent latest state, not a lossy chain of deltas.
      // Missing road entries reset to open/empty; dropped intermediate frames
      // cannot leave stale closures or traffic on the map.
      edges: s.map.edges.filter(e => !e.open || e.occupants.length || e.waiting.length)
        .map(e => [e.id, e.open, e.occupants.length, e.waiting.length]),
      sectors: s.map.sectors.filter(sector => sector.coverage !== 1).map(sector => [sector.id, sector.coverage]),
      organizations: s.map.organizations.map(o => pick(o, ['id', 'name', 'node', 'sharing', 'usesPlatform', 'funds', 'version', 'color', 'demoVisitor', 'demoRetired', 'joinedAt'])),
    },
    cohortFields,
    cohorts: changedCohorts,
    state: {
      vehicles: truth ? s.vehicles.map(v => pick(v, ['id', 'name', 'owner', 'node', 'background',
        'edge', 'edgeStart', 'edgeEnd', 'route', 'routeIndex', 'state', 'capacity', 'load', 'fuel',
        'fuelUnit', 'passengers', 'eta', 'version', 'operation', 'destination']))
        : Object.values(s.observations[org].vehicles ?? {}),
      needs: truth ? s.needs.map(n => pick(n, ['id', 'building', 'type', 'quantity', 'served', 'unit',
        'population', 'version', 'deadline', 'priority', 'createdAt'])) : [],
      operations: (truth ? s.operations : Object.values(s.observations[org].operations ?? {}))
        .filter((operation, index, rows) => index >= rows.length - sampleLimit || !['completed', 'failed', 'cancelled'].includes(operation.state)),
      hazards: truth ? s.hazards ?? [] : [],
      sharingEvents: (s.sharingEvents ?? []).filter(e => truth || e.to === org || e.from === org).slice(-sampleLimit),
      humanWork: [],
      humanQueue: humanQueue(world, truth ? null : org),
      posts: posts.map(p => ({ public: p.public, indexAt: p.indexAt, deleted: p.deleted,
        private: pick(p.private ?? {}, truth ? ['audience', 'false', 'truthCategory',
          'causeEvent', 'actualLocation', 'original'] : ['audience']) })),
      ingestion: recentScoped(s.ingestion, truth ? null : org),
      observations: { [org]: knownView(world, org) },
    },
    totals: { posts: s.posts.length, messages: s.messages.length, ingestion: s.ingestion.length },
    events, nextAt: world.queue.peek()?.at ?? null, queueSize: world.queue.size,
    ...runtime,
  };
  return detach ? clone(frame) : frame;
}

function humanQueue(world, org) {
  const tasks = world.state.humanWork ?? [], now = world.now;
  let cache = humanCounters.get(world);
  if (!cache || cache.source !== tasks || cache.index > tasks.length) {
    cache = { source: tasks, index: 0, pending: new Map(), finished: [] };
    humanCounters.set(world, cache);
  }
  for (; cache.index < tasks.length; cache.index++) cache.pending.set(tasks[cache.index].id, tasks[cache.index]);
  // Terminal work is immutable in the engine. Accumulate it once; scan only
  // finite pending attention queues on later frames, never their full history.
  for (const [id, task] of cache.pending)
    if (['completed', 'inconclusive', 'failed'].includes(task.state)) {
      const key = `${task.org}:${task.stage}:${task.state}`;
      cache.finished[key] = (cache.finished[key] ?? 0) + 1;
      cache.pending.delete(id);
    }
  const rows = Object.fromEntries(['read', 'decide', 'relay'].map(stage => [stage,
    { stage, queued: 0, working: 0, awaitingDelivery: 0, completed: 0, unconfirmed: 0, oldestQueuedMs: 0 }]));
  for (const [key, count] of Object.entries(cache.finished)) {
    const [owner, stage, state] = key.split(':');
    if (!org || owner === org) rows[stage][state === 'completed' ? 'completed' : 'unconfirmed'] += count;
  }
  for (const task of cache.pending.values()) {
    if (org && task.org !== org) continue;
    const row = rows[task.stage];
    if (!row) continue;
    const key = { queued: 'queued', working: 'working', awaiting_delivery: 'awaitingDelivery',
      completed: 'completed', failed: 'unconfirmed', inconclusive: 'unconfirmed' }[task.state];
    if (key) row[key]++;
    if (task.state === 'queued' && Number.isFinite(task.createdAt) && task.createdAt >= 0 && task.createdAt <= now)
      row.oldestQueuedMs = Math.max(row.oldestQueuedMs, now - task.createdAt);
  }
  return Object.values(rows);
}

export function createViewerBootstrap(world, options = {}) {
  const map = getViewerMap(world);
  return { mapId: map.projectionId, map, frame: createViewerFrame(world, options) };
}
