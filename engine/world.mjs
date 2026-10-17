import { EventQueue, clone, digest, keyedRandom, opaqueId } from './determinism.mjs';
import { validateConfig, manifest, VERSION } from '../contracts/config.mjs';
import { SimError, validateAction } from '../contracts/actions.mjs';
import { generateMap } from '../generators/map.mjs';
import { createResource, checkResource } from './ledger.mjs';
import { staffSnapshot } from './staff.mjs';
import { installTraffic } from './traffic.mjs';
import { installCommunications } from './communications.mjs';
import { installInformation } from '../generators/information.mjs';
import { installHazards } from '../generators/hazards.mjs';
import { installActions } from './operations.mjs';
import { installTasks } from './tasks.mjs';
import { installCooperation } from './cooperation.mjs';
import { installReference } from '../adapters/reference.mjs';
import { installIngestion } from './ingestion.mjs';
import { installFacilities } from './facilities.mjs';
import { installLaboratory } from './laboratory.mjs';
import { installPopulation } from './population.mjs';
import { installModels } from './models.mjs';
import { validateParameters } from '../contracts/parameters.mjs';
import { validateIntervention } from '../contracts/interventions.mjs';
import { configureScenario } from '../scenarios/catalog.mjs';
import { varyComposition } from '../generators/composition.mjs';
import { evaluate } from '../evaluation/metrics.mjs';
import { RecordArchive, recordsDigest, recordSnapshot } from './archive.mjs';
import { installSupplies } from './supplies.mjs';
import { installProcurement } from './procurement.mjs';
import { installVehicleCalendar } from './vehicle-calendar.mjs';
import { installVehicleDriver } from './vehicle-driver.mjs';
import { installStaffCalendar } from './staff-calendar.mjs';
import { integrateUtilization } from './utilization.mjs';
import { installCargo } from './cargo.mjs';
import { installUnloading } from './unloading.mjs';
import { installCoverage } from './coverage.mjs';
import { installHumanCapacity } from './human-capacity.mjs';
import { installDemo } from './demo.mjs';

export class World {
  constructor(input = {}, snapshot = null) {
    this.config = validateConfig(input);
    this.manifest = manifest(this.config, { contentVersion: 'presets-v1+social-v1' });
    this.runId = digest(this.manifest).slice(0, 20);
    this.now = 0;
    this.seq = 0;
    this.eventCount = 0;
    this.queue = new EventQueue();
    this.log = [];
    this.inputs = [];
    this.currentEvent = null;
    this.actionDepth = 0;
    this.handlers = new Map();
    this.actionHandlers = new Map();
    this.logSink = null;
    this.state = {
      map: generateMap(this.config),
      resources: [],
      vehicles: [],
      needs: [],
      operations: [],
      commitments: [],
      messages: [],
      posts: [],
      ingestion: [],
      claims: [],
      proposals: [],
      publicUpdates: [],
      inspections: [],
      purchases: [],
      fundEntries: [],
      patterns: [],
      observations: {},
      queryCount: 0,
      toolCost: 0,
      invalidActions: 0,
      modelCalls: 0,
      modelWallMs: 0,
      idempotency: {},
      counters: {},
      toolQuota: {},
      knownRouteVersion: 0,
      actorMoves: [],
      statistics: { counts: {}, reviewMs: 0, firstSignalAt: {}, publicPostsPublished: 0 },
    };
    this.state.cohorts = this.state.map.sectors.map((s) => ({
      id: `community-${s.id}`,
      sector: s.id,
      node: s.node,
      population: s.population,
      moved: 0,
      inTransit: 0,
      mobility: 'group',
      language: this.random('population', s.id, 'language') < 0.4 ? 'es' : 'en',
      reportProbability: this.config.observationRate,
    }));
    if (this.config.logMode === 'compact' && !snapshot) {
      this.log = new RecordArchive('events');
      this.state.posts = new RecordArchive('posts');
      this.state.messages = new RecordArchive('messages');
    }
    this.indices = new Map();
    this.install();
    if (snapshot) {
      this.restore(snapshot);
      return;
    }
    this.initialize();
    this.initializeHumanCapacity();
    integrateUtilization(this, 0);
  }
  install() {
    installTraffic(this);
    installCommunications(this);
    installInformation(this);
    installHazards(this);
    installActions(this);
    installTasks(this);
    installCooperation(this);
    installFacilities(this);
    installLaboratory(this);
    installPopulation(this);
    installModels(this);
    installReference(this);
    installIngestion(this);
    installSupplies(this);
    installProcurement(this);
    installVehicleCalendar(this);
    installVehicleDriver(this);
    installStaffCalendar(this);
    installCargo(this);
    installUnloading(this);
    installCoverage(this);
    installHumanCapacity(this);
    installDemo(this);
    configureScenario(this, { handlersOnly: true });
  }
  initialize() {
    for (const org of this.state.map.organizations) {
      this.state.observations[org.id] = {
        buildings: {},
        needs: {},
        resources: {},
        vehicles: {},
        edges: {},
        operations: {},
        population: {},
        claims: [],
        lastContact: {},
      };
      for (const [type, qty] of [
        ['water', Math.floor(this.config.stockWater / this.config.organizations)],
        ['staff', 6],
        ['sanitation', 2],
        ['energy', 2],
        ['blankets', 200],
        ['fuel', 300],
        ['food', 200],
        ['rescue', 2],
      ]) {
        const resource = createResource(
          `r-${org.id}-${type}`,
          org.id,
          org.node,
          type,
          qty,
          type === 'water' ? Math.min(this.config.reservedWater, qty) : 0,
          { compatibility: type === 'energy' ? { powerKw: 12, connector: 'A' } : null },
        );
        this.state.resources.push(resource);
        if (type === 'staff') {
          resource.qualifications = ['field_assessment', 'shelter_support', 'water_operations'];
          this.setStaffCalendar(resource,{shiftMs:this.config.staffShiftMs,restMs:this.config.staffRestMs,epochAt:0},{publish:false});
        }
        this.observeResource(org.id, resource);
      }
      for (let j = 0; j < 2; j++) {
        const v = {
          id: `v-${org.id}-${j}`,
          name: `${org.name} - Vehicle ${j + 1}`,
          owner: org.id,
          node: org.node,
          capacity: 300,
          volumeM3: 1,
          maxCargoKg: 1000,
          seats: 20,
          weightKg: 3500,
          speedMps: 12,
          maxWaterDepth: 0.3,
          fuel: this.config.vehicleFuelMl,
          fuelUnit: 'mL',
          fuelMlPerKm: this.config.fuelMlPerKm,
          fuelUsed: 0,
          driver: `driver-${org.id}-${j}`,
          shiftEnd: Math.min(this.config.durationMs, this.config.staffShiftMs),
          public: true,
          state: 'idle',
          route: [],
          routeIndex: 0,
          edge: null,
          edgeStart: null,
          edgeEnd: null,
          load: 0,
          passengers: 0,
          resourceType: null,
          operation: null,
          order: null,
          lastGPS: { node: org.node, at: 0 },
          version: 1,
        };
        this.state.vehicles.push(v);
        this.state.observations[org.id].vehicles[v.id] = this.vehicleView(v);
      }
    }
    const b = this.building(this.state.map.shelterId);
    this.addNeed({
      id: 'need-water-main',
      building: b.id,
      type: 'water',
      quantity: 600,
      unit: 'L',
      population: this.sector(b.sector).population,
      deadline: 3 * 3600000,
      priority: 10,
    });
    for (const org of this.state.map.organizations) {
      for (const edge of this.state.map.edges)
        this.state.observations[org.id].edges[edge.id] = {
          open: true,
          waterDepth: 0,
          version: 1,
          at: 0,
        };
    }
    configureScenario(this);
    varyComposition(this);
    // Scenario setup can specialize a demand before the clock begins. Those
    // constructor-time values define the initial episode, not a later change.
    for (const n of this.state.needs) {
      n.demandEpisodes = [];
      this.ensureDemandEpisode(n);
    }
    this.initializeLaboratory();
    this.initializePopulation();
    this.schedule(30_000, 'initial_report', { need: 'need-water-main' }, 1, 'initial-main');
    this.schedule(60_000, 'hazard_start', {}, 0, 'hazard-start');
    if (this.config.postsPerHour)
      this.schedule(5_000, 'ambient_posts', { batch: 0 }, 2, 'ambient-0');
    for (let i = 0; i < this.config.backgroundTraffic; i++)
      this.schedule(i * 1500, 'background_trip', { index: i }, 3, `background-${i}`);
    this.record('world_initialized', {
      scenario: this.config.scenario,
      mapHash: this.state.map.hash,
    });
    if (this.config.policy !== 'none')
      this.schedule(0, 'reference_tick', {}, 5, 'reference-initial');
  }
  on(type, fn) {
    this.handlers.set(type, fn);
  }
  onAction(type, fn) {
    this.actionHandlers.set(type, fn);
  }
  nextId(kind) {
    const n = (this.state.counters[kind] ?? 0) + 1;
    this.state.counters[kind] = n;
    return `${kind}-${n}`;
  }
  random(stream, entity, event, index = 0) {
    return keyedRandom(
      this.config.subsystemSeeds[stream] ?? this.config.seed,
      stream,
      entity,
      event,
      index,
    );
  }
  publicId(kind, key) {
    return opaqueId(this.config.seed, kind, key);
  }
  schedule(at, type, data = {}, phase = 2, key = '') {
    if (!Number.isFinite(at) || !Number.isSafeInteger(Math.round(at)) || at < this.now)
      throw new Error(`Invalid event time for ${type}`);
    const event = {
      at: Math.round(at),
      type,
      data: clone(data),
      phase,
      key: key || `${type}-${this.seq}`,
      seq: this.seq++,
    };
    this.queue.push(event);
    return event;
  }
  record(type, data = {}, entity = null) {
    const stats = this.state.statistics;
    stats.counts[type] = (stats.counts[type] ?? 0) + 1;
    if (type === 'review_completed') stats.reviewMs += data.reviewMs ?? 0;
    if (type === 'signal_created' && data.false) stats.falseSignals = (stats.falseSignals ?? 0) + 1;
    if (type === 'post_published') {
      const post = this.post(data.id);
      if (post?.private.need && stats.firstSignalAt[post.private.need] === undefined)
        stats.firstSignalAt[post.private.need] = this.now;
    }
    const e = { index: this.eventCount, at: this.now, type, entity, data: clone(data) };
    this.log.push(e);
    this.logSink?.(e);
    return e;
  }
  step() {
    if (this.modelBarrier()) return null;
    if (!this.queue.peek()) return null;
    if (this.eventCount >= this.config.maxEvents)
      throw new SimError('EVENT_BUDGET', 'Event budget exhausted');
    const next = this.queue.pop();
    integrateUtilization(this, next.at);
    this.now = next.at;
    this.eventCount++;
    const fn = this.handlers.get(next.type);
    if (!fn) throw new Error(`Missing handler: ${next.type}`);
    this.currentEvent = next;
    try {
      fn(next.data, next);
    } finally {
      this.currentEvent = null;
    }
    return next;
  }
  withinHorizon(at) { return this.config.continuousDemo || at <= this.config.durationMs; }
  advance(target = this.config.durationMs, { maxEvents = 100000 } = {}) {
    if (!Number.isSafeInteger(target) || target < this.now)
      throw new Error('Invalid advance target');
    let count = 0;
    if (this.modelBarrier())
      return {
        now: this.now,
        processed: 0,
        reached: false,
        blocked: 'model_result',
        nextAt: this.queue.peek()?.at ?? null,
      };
    while (this.queue.peek()?.at <= target && count < maxEvents) {
      this.step();
      count++;
    }
    const reached = !(this.queue.peek()?.at <= target);
    if (reached) { integrateUtilization(this, target); this.now = target; }
    return { now: this.now, processed: count, reached, nextAt: this.queue.peek()?.at ?? null };
  }
  lookup(key, list, id) {
    if (list instanceof RecordArchive) return list.get(id);
    let index = this.indices.get(key);
    if (!index || index.list !== list || index.length > list.length) {
      index = { list, length: 0, map: new Map() };
      this.indices.set(key, index);
    }
    for (let i = index.length; i < list.length; i++)
      index.map.set(list[i].id ?? list[i].public?.id, list[i]);
    index.length = list.length;
    return index.map.get(id);
  }
  post(id) {
    return this.lookup('posts', this.state.posts, id);
  }
  building(id) {
    return this.lookup('buildings', this.state.map.buildings, id);
  }
  organization(id) {
    return this.lookup('organizations', this.state.map.organizations, id);
  }
  resource(id) {
    return this.lookup('resources', this.state.resources, id);
  }
  vehicle(id) {
    return this.lookup('vehicles', this.state.vehicles, id);
  }
  edge(id) {
    return this.lookup('edges', this.state.map.edges, id);
  }
  node(id) {
    return this.lookup('nodes', this.state.map.nodes, id);
  }
  sector(id) {
    return this.lookup('sectors', this.state.map.sectors, id);
  }
  need(id) {
    return this.lookup('needs', this.state.needs, id);
  }
  addNeed(n) {
    if (this.need(n.id)) throw new Error('Duplicate need');
    const need = {
      served: 0,
      createdAt: this.now,
      firstServiceAt: null,
      completedAt: null,
      pendingIntegral: 0,
      integratedAt: this.now,
      silent: false,
      version: 1,
      priority: 1,
      population: 0,
      ...clone(n),
    };
    this.ensureDemandEpisode(need);
    this.state.needs.push(need);
    this.activatePopulationNeed?.(need);
    this.record(
      'need_created',
      { type: need.type, quantity: need.quantity, building: need.building },
      need.id,
    );
    return need;
  }
  ensureDemandEpisode(n) {
    n.responseCreatedAt ??= n.createdAt ?? this.now;
    if (n.demandEpisodes?.length) return n.demandEpisodes.at(-1);
    const covered = n.quantity > 0 && n.served >= n.quantity && n.completedAt != null;
    const episode = {
      index: 1,
      startedAt: n.responseCreatedAt,
      baselineServed: 0,
      targetQuantity: n.quantity,
      quantity: Math.max(0, n.quantity),
      peakQuantity: Math.max(0, n.quantity),
      type: n.type,
      unit: n.unit,
      firstServiceAt: n.firstServiceAt ?? null,
      completedAt: covered ? n.completedAt : null,
      endedAt: covered ? n.completedAt : n.quantity <= 0 ? this.now : null,
      state: covered ? 'covered' : n.quantity <= 0 ? 'retired' : 'open',
      closedReason: covered ? 'physical_service' : n.quantity <= 0 ? 'nonpositive_demand' : null,
      pendingIntegral: 0,
    };
    n.demandEpisodes = [episode];
    return episode;
  }
  updateNeed(id, change, { physicalService = false } = {}) {
    const n = this.need(id);
    if (!n) throw new Error('Unknown need');
    let episode = this.ensureDemandEpisode(n);
    const pendingBefore = Math.max(0, n.quantity - n.served);
    const integral = (this.now - n.integratedAt) * pendingBefore;
    n.pendingIntegral += integral;
    if (episode.state === 'open') episode.pendingIntegral += integral;
    n.integratedAt = this.now;
    Object.assign(n, change);
    const pending = Math.max(0, n.quantity - n.served);
    if (pending > 0) {
      if (episode.state !== 'open') {
        // A previously covered or withdrawn request is a new response episode.
        // Existing deliveries remain in the cumulative stock/accounting ledger,
        // but their timestamps cannot stand in for aid to this new shortfall.
        episode = {
          index: n.demandEpisodes.length + 1,
          startedAt: this.now,
          baselineServed: n.served,
          targetQuantity: n.quantity,
          quantity: pending,
          peakQuantity: pending,
          type: n.type,
          unit: n.unit,
          firstServiceAt: null,
          completedAt: null,
          endedAt: null,
          state: 'open',
          closedReason: null,
          pendingIntegral: 0,
        };
        n.demandEpisodes.push(episode);
        n.responseCreatedAt = this.now;
        n.firstServiceAt = null;
        n.completedAt = null;
      } else {
        episode.targetQuantity = n.quantity;
        episode.quantity = Math.max(0, n.quantity - episode.baselineServed);
        episode.peakQuantity = Math.max(episode.peakQuantity, episode.quantity);
      }
    } else if (episode.state === 'open') {
      episode.targetQuantity = n.quantity;
      episode.quantity = Math.max(0, n.quantity - episode.baselineServed);
      episode.endedAt = this.now;
      if (physicalService && pendingBefore > 0) {
        episode.state = 'covered';
        episode.closedReason = 'physical_service';
        episode.completedAt = this.now;
        n.completedAt = this.now;
      } else {
        // A correction or retirement is not a successful physical delivery.
        episode.state = 'retired';
        episode.closedReason = n.quantity <= 0 ? 'nonpositive_demand' : 'demand_reduced';
        episode.completedAt = null;
        n.completedAt = null;
      }
    }
    n.version++;
    this.record('need_changed', { ...change }, id);
  }
  serveNeed(id, quantity) {
    const n = this.need(id);
    if (!n) throw new Error('Unknown need');
    // First useful aid is a physical positive contribution to outstanding
    // demand. A zero receipt, an arrival, and oversupply of a retired demand do
    // not create an instant service timestamp.
    const useful = Math.min(quantity, Math.max(0, n.quantity - n.served));
    if (useful > 0 && n.firstServiceAt == null) {
      n.firstServiceAt = this.now;
      this.ensureDemandEpisode(n).firstServiceAt = this.now;
    }
    this.receivePopulationAid?.(n, quantity);
    this.updateNeed(id, { served: n.served + quantity }, { physicalService: useful > 0 });
    this.record('service_delivered', { quantity, type: n.type, building: n.building }, id);
  }
  resourceView(r) {
    return {
      id: r.id,
      owner: r.owner,
      node: r.node,
      type: r.type,
      quantity: r.quantity,
      reserved: r.reserved,
      floor: r.floor,
      unit: r.unit,
      compatibility: clone(r.compatibility),
      ...staffSnapshot(r),
      version: r.version,
    };
  }
  observeResource(org, r) {
    this.state.observations[org].resources[r.id] = { ...this.resourceView(r), at: this.now };
  }
  observeNeed(org, n) {
    this.state.observations[org].needs[n.id] = {
      id: n.id,
      building: n.building,
      type: n.type,
      quantity: n.quantity,
      served: n.served,
      unit: n.unit,
      deadline: n.deadline,
      ...(n.reconfirmedAt === undefined ? {} : { originalDeadline: n.originalDeadline,
        reconfirmedAt: n.reconfirmedAt, reconfirmationCount: n.reconfirmationCount }),
      population: n.population,
      version: n.version,
      at: this.now,
    };
    const b = this.building(n.building);
    this.state.observations[org].buildings[b.id] = {
      id: b.id,
      node: b.node,
      use: b.use,
      state: b.state,
      at: this.now,
    };
  }
  vehicleView(v) {
    return {
      id: v.id,
      name: v.name ?? `${this.organization(v.owner)?.name ?? "Response"} Vehicle`,
      owner: v.owner,
      background: v.background === true,
      node: v.lastGPS.node,
      at: v.lastGPS.at,
      capacity: v.capacity,
      weightKg: v.weightKg,
      speedMps: v.speedMps,
      maxWaterDepth: v.maxWaterDepth,
      maxCargoKg:v.maxCargoKg,
      volumeM3:v.volumeM3,
      seats:v.seats,
      fuelMlPerKm:v.fuelMlPerKm,
      fuel: v.fuel,
      shiftEnd: v.shiftEnd,
      state: v.state,
      version: v.version,
      operation: v.operation ?? null,
      destination: v.destination ?? null,
      receivedOrderVersion: v.receivedOrderVersion ?? 0,
      order: v.order ?? null,
    };
  }
  act(actor, request) {
    if (this.actionDepth === 0 && !this.currentEvent)
      this.inputs.push({
        at: this.now,
        afterEventCount: this.eventCount,
        actor: clone(actor),
        request: clone(request),
      });
    this.actionDepth++;
    try {
      return this.applyAction(actor, request);
    } finally {
      this.actionDepth--;
    }
  }
  applyAction(actor, request) {
    validateAction(request);
    validateParameters(request.type, request.params);
    if (!actor || !this.organization(actor.org))
      throw new SimError('AUTHENTICATION', 'Unknown actor', 401);
    const key = `${actor.org}:${actor.id}:${request.idempotencyKey}`;
    const signature = digest(request);
    const old = this.state.idempotency[key];
    if (old) {
      if (old.signature !== signature)
        throw new SimError('IDEMPOTENCY_CONFLICT', 'Key reused with different parameters', 409);
      return clone(old.result);
    }
    try {
      const fn = this.actionHandlers.get(request.type);
      if (!fn) throw new SimError('UNIMPLEMENTED', 'Action handler missing', 501);
      const result = fn(actor, clone(request.params), request);
      if (result?.id && result.vehicle && this.state.operations.some((o) => o.id === result.id))
        this.state.observations[actor.org].operations[result.id] = clone(result);
      this.state.idempotency[key] = { signature, result: clone(result) };
      this.record('action_accepted', {
        actor: actor.id,
        org: actor.org,
        type: request.type,
        key: request.idempotencyKey,
      });
      return result;
    } catch (error) {
      this.state.invalidActions++;
      this.record('action_rejected', {
        actor: actor.id,
        org: actor.org,
        type: request.type,
        code: error.code ?? 'ERROR',
      });
      throw error;
    }
  }
  checkpoint() {
    return clone({
      manifest: this.manifest,
      runId: this.runId,
      now: this.now,
      seq: this.seq,
      eventCount: this.eventCount,
      state: {
        ...this.state,
        posts: recordSnapshot(this.state.posts),
        messages: recordSnapshot(this.state.messages),
      },
      queue: this.queue.toJSON(),
      log: recordSnapshot(this.log),
      inputs: this.inputs,
    });
  }
  inject(type, data = {}) {
    validateIntervention(this, type, data);
    if (!this.handlers.has(type)) throw new SimError('EVENT', 'Unknown event');
    if (!this.currentEvent)
      this.inputs.push({
        kind: 'intervention',
        at: this.now,
        afterEventCount: this.eventCount,
        type,
        data: clone(data),
      });
    this.schedule(this.now, type, data, 0, `manual-${this.nextId('intervention')}`);
    this.advance(this.now);
  }
  restore(snapshot) {
    if (
      !snapshot ||
      !snapshot.manifest ||
      !snapshot.state ||
      !Array.isArray(snapshot.queue) ||
      !(Array.isArray(snapshot.log) || snapshot.log.archive) ||
      !Number.isSafeInteger(snapshot.now) ||
      snapshot.now < 0 ||
      !Number.isSafeInteger(snapshot.eventCount) ||
      snapshot.queue.some(
        (e) => !Number.isSafeInteger(e.at) || e.at < snapshot.now || !this.handlers.has(e.type),
      )
    )
      throw new Error('Invalid checkpoint structure or scheduled event');
    if (snapshot.manifest.engineVersion !== VERSION)
      throw new Error('Checkpoint engine version mismatch');
    if (snapshot.manifest.engineBuild !== this.manifest.engineBuild)
      throw new Error('Checkpoint implementation mismatch: restore with the same simulator code');
    if (digest(snapshot.manifest.config) !== digest(this.config))
      throw new Error('Checkpoint configuration mismatch');
    this.manifest = clone(snapshot.manifest);
    this.runId = snapshot.runId;
    this.now = snapshot.now;
    this.seq = snapshot.seq;
    this.eventCount = snapshot.eventCount;
    this.state = clone(snapshot.state);
    if (snapshot.state.posts.archive)
      this.state.posts = new RecordArchive('posts', snapshot.state.posts);
    if (snapshot.state.messages.archive)
      this.state.messages = new RecordArchive('messages', snapshot.state.messages);
    // Older demonstration checkpoints predate the public publication counter.
    // Rebuild it once from public published records, including removed rows;
    // private and not-yet-published posts must not contribute.
    if (!Number.isSafeInteger(this.state.statistics.publicPostsPublished))
      this.state.statistics.publicPostsPublished = this.state.posts.reduce((count, post) =>
        count + (post.public?.publishedAt != null && post.private?.audience === 'public' ? 1 : 0), 0);
    this.queue = new EventQueue(clone(snapshot.queue));
    this.log = snapshot.log.archive
      ? new RecordArchive('events', snapshot.log)
      : clone(snapshot.log);
    this.inputs = clone(snapshot.inputs ?? []);
    this.indices.clear();
    const errors = this.invariants();
    if (errors.length)
      throw new Error('Checkpoint violates world invariants: ' + errors.join(', '));
  }
  stateHash() {
    return digest({
      manifest: this.manifest,
      now: this.now,
      state: {
        ...this.state,
        posts: recordsDigest(this.state.posts),
        messages: recordsDigest(this.state.messages),
      },
      queue: this.queue.toJSON(),
      log: recordsDigest(this.log),
      inputs: this.inputs,
    });
  }
  invariants() {
    const errors = [];
    for (const r of this.state.resources) if (!checkResource(r)) errors.push(`ledger:${r.id}`);
    for (const v of this.state.vehicles) {
      if (v.load < 0 || v.load > v.capacity || v.fuel < 0) errors.push(`vehicle:${v.id}`);
      if (v.edge && !this.edge(v.edge)?.occupants.includes(v.id)) errors.push(`occupancy:${v.id}`);
    }
    const reserved = {};
    for (const c of this.state.commitments)
      if (['reserved', 'confirmed'].includes(c.state))
        reserved[c.resource] = (reserved[c.resource] ?? 0) + c.quantity;
    for (const r of this.state.resources)
      if (r.reserved !== (reserved[r.id] ?? 0)) errors.push(`reservation:${r.id}`);
    for (const n of this.state.needs)
      if (n.served < 0 || n.quantity < 0) errors.push(`need:${n.id}`);
    for (const b of this.state.map.buildings)
      if (
        b.occupancy < 0 ||
        b.reservedPlaces < 0 ||
        (b.occupancy + b.reservedPlaces > b.capacity && b.capacity > 0)
      )
        errors.push(`places:${b.id}`);
    for (const v of this.state.vehicles)
      if ((v.passengers ?? 0) < 0 || (v.passengers ?? 0) > (v.seats ?? Infinity))
        errors.push(`passengers:${v.id}`);
    const people = this.state.cohorts.reduce(
      (total, c) => total + c.population + c.inTransit + (c.deceased ?? 0),
      0,
    );
    if (people !== this.state.initialPopulation)
      errors.push('population_conservation');
    for (const c of this.state.cohorts)
      if (
        c.population < 0 ||
        c.inTransit < 0 ||
        (c.deceased ?? 0) < 0 ||
        !Number.isSafeInteger(c.population) ||
        c.health?.injured > c.population
      )
        errors.push(`cohort:${c.id}`);
    for (const op of this.state.operations) {
      if (op.times?.arrived != null && op.times.dispatched == null) errors.push(`arrival:${op.id}`);
      if (
        ['delivery', 'transfer', 'evacuation'].includes(op.type) &&
        op.times?.service != null &&
        op.times.received == null
      )
        errors.push(`service:${op.id}`);
    }
    return errors;
  }
  close() {
    for (const store of [this.log, this.state.posts, this.state.messages])
      if (store instanceof RecordArchive) store.close();
  }
  observer({ limit = 200, includeHash = false } = {}) {
    const view = {
      ...this.state,
      posts: this.state.posts.slice(-limit),
      messages: this.state.messages.slice(-limit),
      ingestion: this.state.ingestion.slice(-limit),
      queries: (this.state.queries ?? []).slice(-limit),
      idempotency: undefined,
      reference: undefined,
    };
    return {
      runId: this.runId,
      now: this.now,
      manifest: clone(this.manifest),
      state: clone(view),
      totals: {
        posts: this.state.posts.length,
        messages: this.state.messages.length,
        ingestion: this.state.ingestion.length,
      },
      metrics: evaluate(this),
      events: this.log.slice(-limit),
      nextAt: this.queue.peek()?.at ?? null,
      queueSize: this.queue.size,
      ...(includeHash ? { hash: this.stateHash() } : {}),
    };
  }
  actorView(org, { includeQueries = true, includeEdges = true, historyLimit = 100 } = {}) {
    const o = this.organization(org);
    if (!o) throw new SimError('AUTHENTICATION', 'Unknown organization', 401);
    return {
      runId: this.runId,
      now: this.now,
      organization: { id: o.id, name: o.name, sharing: o.sharing, funds: o.funds },
      known: clone({
        ...this.state.observations[org],
        edges: includeEdges
          ? this.state.observations[org].edges
          : Object.fromEntries(
              Object.entries(this.state.observations[org].edges).filter(([, e]) => !e.open),
            ),
      }),
      operations: clone(Object.values(this.state.observations[org].operations)),
      proposals: clone(this.state.proposals.filter((p) => p.org === org)),
      commitments: clone(this.state.commitments.filter((p) => p.owner === org)),
      offers: clone(this.state.partnerOffers?.[org] ?? []),
      transfers: clone((this.state.transfers??[]).filter(t=>t.from===org || this.state.partnerOffers?.[org]?.some(o=>o.id===t.id))),
      sharedCommitments: clone(this.state.sharedCommitments?.[org] ?? []),
      inspections: this.state.inspections.filter((p) => p.org === org).map((p) => {
        if (['completed', 'inconclusive', 'timeout'].includes(p.state)) return clone(p);
        // An actor knows the request it submitted and its workflow status.
        // Expose that receipt while queued/in progress so independent batches
        // can share one inquiry. Pending receipts cannot reveal an assessment,
        // source observation, assigned crew or another organization's requests.
        return clone(Object.fromEntries([
          'id', 'org', 'target', 'entity', 'method', 'purpose', 'validForMs',
          'targetVersion', 'reportTo', 'requestProposal', 'requestStep',
          'authorizedBy', 'staffResource', 'requestedVehicle', 'state', 'createdAt',
        ].filter((key) => p[key] !== undefined).map((key) => [key, p[key]])));
      }),
      queries: includeQueries
        ? clone((this.state.queries ?? []).filter((p) => p.org === org).slice(-historyLimit))
        : [],
      claims: clone(this.state.claims.filter((p) => p.org === org)),
      patterns: clone(this.state.patterns.filter((p) => p.org === org)),
      modelRequests: clone((this.state.modelRequests ?? []).filter((p) => p.org === org)),
      publicUpdates: clone(this.state.publicUpdates),
    };
  }
}
