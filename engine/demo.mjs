import { SimError } from '../contracts/actions.mjs';
import { clone, digest } from './determinism.mjs';
import { createResource } from './ledger.mjs';

// An explicit demonstration director. These methods are inert in ordinary
// worlds; benchmark initialization, schedules and physical rules are unchanged.
const terminal = new Set(['completed', 'cancelled', 'failed', 'rejected', 'expired', 'withdrawn', 'released']);
const requireDemo = w => {
  if (!w.config.continuousDemo || w.config.mode !== 'interactive')
    throw new SimError('DEMO_ONLY', 'This operation requires an interactive continuous demonstration.', 409);
};
const own = (o, fields) => Object.fromEntries(fields.filter(k => o[k] !== undefined).map(k => [k, o[k]]));
const profile = o => own(o, ['id', 'name', 'color', 'node', 'demoVisitor', 'demoRetired', 'joinedAt', 'resupply']);
const supplyDefaults = { enabled: true, intervalMs: 1800000, water: 300, food: 60 };
const supplyCaps = { water: 1200, food: 300 };
const supplyConfig = input => {
  const value = input === undefined ? { ...supplyDefaults } : { ...supplyDefaults, ...input };
  if (input !== undefined && (!input || Array.isArray(input) || typeof input !== 'object' ||
      Object.keys(input).some(k => !Object.hasOwn(supplyDefaults, k))) || typeof value.enabled !== 'boolean' ||
      !Number.isSafeInteger(value.intervalMs) || value.intervalMs < 300000 || value.intervalMs > 21600000 ||
      !Number.isSafeInteger(value.water) || value.water < 0 || value.water > 600 ||
      !Number.isSafeInteger(value.food) || value.food < 0 || value.food > 120)
    throw new SimError('DEMO_RESUPPLY', 'Use 5–360 simulated minutes, 0–600 litres and 0–120 food portions.');
  return value;
};
const record = w => w.state.demo ??= { schemaVersion: 1, nextOrganization: 1, maxActive: 4,
  maxLifetime: 2000, requests: {}, releases: {}, director: { enabled: false, generation: 0, tick: 0 } };
const publicResult = (w, o) => ({ runId: w.runId, organization: profile(o),
  kit: { vehicles: 3, water: { quantity: 600, unit: 'L' }, food: { quantity: 120, unit: 'portion' } } });

export function installDemo(w) {
  const refuelAtDepot = v => {
    if (!w.config.continuousDemo || w.config.mode !== 'interactive' || !w.state.demo?.director?.enabled || !v || v.background) return;
    const o = w.organization(v.owner), r = w.resource(`r-${v.owner}-fuel`);
    if (!o || o.demoRetired || v.node !== o.node || !r || r.node !== v.node || v.load || v.edge ||
        ['expired', 'damaged', 'quarantined'].includes(r.condition)) return;
    const litres = Math.min(Math.floor((w.config.vehicleFuelMl - v.fuel) / 1000), Math.max(0, r.quantity - r.reserved - r.floor));
    if (litres < 1) return;
    r.quantity -= litres; r.consumed += litres; r.version++; v.fuel += litres * 1000;
    w.observeResource(o.id, r); w.reportResource(r, o.id); w.reportVehicle(v);
    w.record('demo_vehicle_refueled', { org: o.id, vehicle: v.id, resource: r.id, quantity: litres, unit: 'L', demoOnly: true }, v.id);
  };
  const nativeLoad = w.handlers.get('load');
  w.on('load', input => {
    const op = w.state.operations.find(o => o.id === input.operation);
    if (op && !terminal.has(op.state)) refuelAtDepot(w.vehicle(op.vehicle));
    nativeLoad(input);
  });
  const configureSupply = (org, config) => {
    const previous = org.resupply;
    org.resupply = { ...config, waterCap: supplyCaps.water, foodCap: supplyCaps.food,
      generation: (previous?.generation ?? 0) + 1, nextAt: config.enabled ? w.now + config.intervalMs : null,
      receiptsCount: previous?.receiptsCount ?? 0, lastReceivedAt: previous?.lastReceivedAt ?? null,
      receivedWater: previous?.receivedWater ?? 0, receivedFood: previous?.receivedFood ?? 0 };
    if (config.enabled) w.schedule(org.resupply.nextAt, 'demo_resupply', { org: org.id, generation: org.resupply.generation }, 4,
      `demo-resupply-${org.id}-${org.resupply.generation}-${org.resupply.nextAt}`);
    org.version++; w.record('demo_resupply_configured', { org: org.id, ...config, nextAt: org.resupply.nextAt, demoOnly: true }, org.id);
  };
  const receive = (org, resource, quantity, { reference, manual = false, note = null } = {}) => {
    resource.quantity += quantity; if (manual) resource.received += quantity; else resource.produced += quantity; resource.version++;
    const receipt = { id: w.nextId('inventory-receipt'), org: org.id, resource: resource.id, type: resource.type,
      quantity, unit: resource.unit, at: w.now, reference, manual, ...(note ? { note } : {}) };
    if (org.resupply) {
      org.resupply.receiptsCount++; org.resupply.lastReceivedAt = w.now;
      if (resource.type === 'water') org.resupply.receivedWater += quantity;
      if (resource.type === 'food') org.resupply.receivedFood += quantity;
    }
    w.observeResource(org.id, resource); w.reportResource(resource, org.id);
    w.record(w.config.continuousDemo ? 'demo_supply_received' : 'inventory_receipt',
      { ...receipt, demoOnly: w.config.continuousDemo }, receipt.id);
    return receipt;
  };
  w.demoConfigureResupply = ({ org: id, idempotencyKey, resupply } = {}) => {
    requireDemo(w);
    const org = w.organization(id), demo = record(w), config = supplyConfig(resupply);
    if (!org || org.demoRetired) throw new SimError('DEMO_ORGANIZATION', 'An active organization is required.');
    if (typeof idempotencyKey !== 'string' || !/^[\w:-]{8,120}$/.test(idempotencyKey)) throw new SimError('DEMO_IDEMPOTENCY', 'A bounded idempotency key is required.');
    demo.supplyRequests ??= {};
    const key = `${id}:${idempotencyKey}`, material = digest(config), previous = demo.supplyRequests[key];
    if (previous) {
      if (previous.material !== material) throw new SimError('IDEMPOTENCY_CONFLICT', 'This supply change already identifies different settings.', 409);
      return clone(previous.result);
    }
    if (Object.keys(demo.supplyRequests).length >= 20000) throw new SimError('DEMO_LIFETIME_QUOTA', 'The configuration quota has been reached.', 429);
    configureSupply(org, config);
    const result = { org: id, resupply: clone(org.resupply) }; demo.supplyRequests[key] = { material, result };
    return clone(result);
  };
  w.receiveInventory = (actor, input = {}) => {
    if (w.config.mode !== 'interactive') throw new SimError('INTERACTIVE_ONLY', 'A human inventory receipt requires an interactive world.', 409);
    const isDemo = w.config.continuousDemo;
    const org = w.organization(actor?.org), r = w.resource(input.resource);
    if (!org || org.demoRetired || !['commander', 'dispatcher'].includes(actor.role) || r?.owner !== org.id)
      throw new SimError('AUTHORIZATION', 'Only the owning commander or dispatcher may confirm incoming supplies.', 403);
    if (r.type === 'staff' || isDemo && (!['water', 'food'].includes(r.type) || r.node !== org.node) || ['expired', 'damaged', 'quarantined'].includes(r.condition))
      throw new SimError('RECEIPT_RESOURCE', 'Receive usable supplies at an existing depot owned by your organization.');
    if (!Number.isSafeInteger(input.quantity) || input.quantity < 1 || !Number.isSafeInteger(r.quantity + input.quantity) ||
      isDemo && input.quantity > (r.type === 'water' ? 600 : 120) ||
      typeof input.receiptReference !== 'string' || input.receiptReference.trim().length < 3 || input.receiptReference.length > 80 ||
      /[<>\x00-\x1f]/.test(input.receiptReference) || typeof input.idempotencyKey !== 'string' || !/^[\w:-]{8,120}$/.test(input.idempotencyKey) ||
      input.note !== undefined && (typeof input.note !== 'string' || input.note.length > 240 || /[<>\x00-\x1f]/.test(input.note)))
      throw new SimError('DEMO_RECEIPT', 'Confirm a bounded quantity and a readable delivery reference.');
    if (!w.currentEvent) w.inputs.push({ kind: 'inventory_receipt', at: w.now, afterEventCount: w.eventCount,
      actor: clone(actor), request: clone(input) });
    const reference = input.receiptReference.trim(), material = digest({ resource: r.id, quantity: input.quantity, reference, note: input.note ?? '' });
    const journal = w.state.inventoryReceiptRequests ??= { references: {}, keys: {} };
    const referenceKey = digest({ org: org.id, reference }), key = `${org.id}:${input.idempotencyKey}`;
    const priorReference = journal.references[referenceKey], priorKey = journal.keys[key];
    if ([priorReference, priorKey].some(old => old && old.material !== material))
      throw new SimError('IDEMPOTENCY_CONFLICT', 'The receipt reference or key already identifies different supplies.', 409);
    const old = priorReference ?? priorKey;
    if (old) {
      journal.references[referenceKey] = journal.keys[key] = old;
      return clone(old.result);
    }
    if (isDemo && org.demoLastManualReceiptAt !== undefined && w.now - org.demoLastManualReceiptAt < 1800000)
      throw new SimError('DEMO_RECEIPT_COOLDOWN', 'One manual supply receipt per team is available every 30 simulated minutes.', 429);
    if (isDemo && Object.keys(journal.references).length >= 20000) throw new SimError('DEMO_LIFETIME_QUOTA', 'The receipt quota has been reached.', 429);
    if (isDemo && r.quantity + input.quantity > supplyCaps[r.type]) throw new SimError('DEMO_STOCK_CAP', 'These supplies exceed the demonstration depot limit.', 409);
    if (isDemo && !org.resupply) configureSupply(org, supplyConfig());
    const receipt = receive(org, r, input.quantity, { reference, manual: true, note: input.note });
    if (isDemo) org.demoLastManualReceiptAt = w.now;
    const result = { receipt, resource: own(r, ['id', 'quantity', 'reserved', 'version', 'unit']) };
    journal.references[referenceKey] = journal.keys[key] = { material, result };
    return clone(result);
  };
  w.demoCreateOrganization = input => {
    requireDemo(w);
    if (!input || typeof input.idempotencyKey !== 'string' || !/^[\w:-]{8,120}$/.test(input.idempotencyKey))
      throw new SimError('DEMO_IDEMPOTENCY', 'A bounded idempotency key is required.');
    const name = typeof input.name === 'string' ? input.name.trim().replace(/\s+/g, ' ') : '';
    if (name.length < 2 || name.length > 64 || /[<>\x00-\x1f]/.test(name))
      throw new SimError('DEMO_NAME', 'Choose a team name between 2 and 64 characters.');
    const color = input.color ?? '#7261d8';
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new SimError('DEMO_COLOR', 'A six-digit team color is required.');
    const resupply = supplyConfig(input.resupply);
    const demo = record(w), material = digest({ name, color, ...(input.resupply === undefined ? {} : { resupply }) });
    const previous = demo.requests[input.idempotencyKey];
    if (previous) {
      if (previous.material !== material) throw new SimError('IDEMPOTENCY_CONFLICT', 'This registration key already belongs to another request.', 409);
      return clone(previous.result);
    }
    const active = w.state.map.organizations.filter(o => o.demoVisitor && !o.demoRetired);
    // A host's durable directory can be ahead of a recovered physical
    // checkpoint. Never reuse one of those earlier visitor identities.
    if (input.minimumOrganization !== undefined &&
        (!Number.isSafeInteger(input.minimumOrganization) || input.minimumOrganization < 1 || input.minimumOrganization > demo.maxLifetime))
      throw new SimError('DEMO_IDENTITY_FLOOR', 'Use a bounded organization identity floor.');
    if (active.length >= demo.maxActive) throw new SimError('DEMO_CAPACITY', 'All demonstration team spaces are in use. You can continue observing.', 429);
    if (demo.nextOrganization > demo.maxLifetime) throw new SimError('DEMO_LIFETIME_QUOTA', 'This demonstration has reached its registration quota.', 429);
    demo.nextOrganization = Math.max(demo.nextOrganization, input.minimumOrganization ?? 1);
    if (demo.nextOrganization > demo.maxLifetime) throw new SimError('DEMO_LIFETIME_QUOTA', 'This demonstration has reached its registration quota.', 429);
    const id = `demo-org-${demo.nextOrganization++}`;
    // A new identity never inherits a previous visitor's records or authority.
    const openNodes = new Set(w.state.map.edges.filter(e => e.open).map(e => e.from));
    const nodes = w.state.map.nodes.filter(n => openNodes.has(n.id));
    const index = Math.floor(w.random('demo', id, 'origin') * nodes.length);
    const node = nodes[index]?.id ?? w.state.map.organizations[0].node;
    const org = { id, name, color, node, operators: 2, reviewSlots: [w.now, w.now], sharing: 'public',
      usesPlatform: true, version: 1, funds: 1000, policy: { reserveWater: 0, priority: 'urgency_then_age' },
      connected: true, demoVisitor: true, joinedAt: w.now };
    w.state.map.organizations.push(org);
    configureSupply(org, resupply);
    w.state.observations[id] = { buildings: {}, needs: {}, resources: {}, vehicles: {}, edges: {},
      operations: {}, population: {}, claims: [], lastContact: {} };
    for (const e of w.state.map.edges) w.state.observations[id].edges[e.id] = { open: true, waterDepth: 0, version: 1, at: w.now };
    for (const [type, quantity] of [['water', 600], ['food', 120], ['staff', 6], ['fuel', 200]]) {
      const r = createResource(`r-${id}-${type}`, id, node, type, quantity);
      if (type === 'staff') {
        r.qualifications = ['field_assessment', 'shelter_support', 'water_operations'];
        w.setStaffCalendar(r, { shiftMs: w.config.staffShiftMs, restMs: w.config.staffRestMs, epochAt: w.now }, { publish: false });
      }
      w.state.resources.push(r); w.observeResource(id, r);
    }
    const template = w.state.vehicles.find(v => !v.background);
    for (let i = 0; i < 3; i++) {
      const vehicle = { ...own(template, ['capacity', 'volumeM3', 'maxCargoKg', 'seats', 'weightKg', 'speedMps', 'maxWaterDepth', 'fuelMlPerKm']),
        id: `v-${id}-${i}`, name: `${name} · Vehicle ${i + 1}`, owner: id, node, fuel: w.config.vehicleFuelMl,
        fuelUnit: 'mL', fuelUsed: 0, driver: `driver-${id}-${i}`, driverAvailable: true,
        shiftEnd: Number.MAX_SAFE_INTEGER, public: true, state: 'idle', route: [], routeIndex: 0,
        edge: null, edgeStart: null, edgeEnd: null, load: 0, passengers: 0, resourceType: null,
        operation: null, order: null, lastGPS: { node, at: w.now }, version: 1 };
      w.state.vehicles.push(vehicle); w.state.observations[id].vehicles[vehicle.id] = w.vehicleView(vehicle);
      w.state.personnel.push({ id: vehicle.driver, name: `Driver ${i + 1} · ${name}`, org: id,
        role: 'driver', competence: ['transport'], node, shiftEnd: Number.MAX_SAFE_INTEGER, restMs: w.config.staffRestMs });
    }
    w.state.personnel.push({ id: `operator-${id}`, name: `${name} response lead`, org: id, role: 'operator',
      competence: ['review'], node, shiftEnd: Number.MAX_SAFE_INTEGER, restMs: w.config.staffRestMs });
    const result = publicResult(w, org);
    // The local response desk sends current incident reports through ordinary
    // delayed communications. This is a logged onboarding interaction, not
    // spectator state copied into the agent's received view.
    for (const n of w.state.needs.filter(n => n.id.startsWith('demo-need-') && n.quantity > n.served).slice(-8))
      w.send({ kind: 'need_observation', need: clone(n), observedAt: w.now }, id,
        { sector: w.building(n.building).sector });
    demo.requests[input.idempotencyKey] = { material, result };
    w.record('demo_organization_provisioned', { org: id, name, color, node, kit: result.kit, demoOnly: true }, id);
    return clone(result);
  };
  w.demoReleaseOrganization = ({ org: id, idempotencyKey } = {}) => {
    requireDemo(w); const demo = record(w), org = w.organization(id);
    if (!org?.demoVisitor) throw new SimError('DEMO_ORGANIZATION', 'Only visitor teams can be retired.');
    if (typeof idempotencyKey !== 'string' || !/^[\w:-]{8,120}$/.test(idempotencyKey))
      throw new SimError('DEMO_IDEMPOTENCY', 'A bounded idempotency key is required.');
    if (demo.releases[idempotencyKey] && demo.releases[idempotencyKey].org !== id)
      throw new SimError('IDEMPOTENCY_CONFLICT', 'Release key already belongs to another team.', 409);
    if (org.demoRetired) return { org: id, retired: true };
    if (w.state.operations.some(o => (o.org === id || o.owner === id) && !terminal.has(o.state)) ||
      w.state.vehicles.some(v => v.owner === id && (v.edge || v.load || v.passengers || !['idle', 'available'].includes(v.state))) ||
      w.state.commitments.some(c => c.owner === id && !terminal.has(c.state)) ||
      w.state.resources.some(r => r.owner === id && r.reserved > 0))
      throw new SimError('DEMO_DRAINING', 'This team still has work or reservations in progress.', 409);
    org.demoRetired = true; org.retiredAt = w.now; org.connected = false; org.sharing = 'private'; org.version++;
    for (const r of w.state.resources.filter(r => r.owner === id)) r.public = false;
    for (const v of w.state.vehicles.filter(v => v.owner === id)) v.public = false;
    // Revoked actors cannot read again. Keep immutable operation/resource
    // history, but retire their potentially large, now useless map cache.
    w.state.observations[id] = { buildings: {}, needs: {}, resources: {}, vehicles: {},
      edges: {}, operations: {}, population: {}, claims: [], lastContact: {} };
    if (!w.state.integrations.revokedOrgs.includes(id)) w.state.integrations.revokedOrgs.push(id);
    demo.releases[idempotencyKey] = { org: id, at: w.now };
    w.record('demo_organization_retired', { org: id, demoOnly: true, preserveHistory: true }, id);
    return { org: id, retired: true };
  };
  w.demoConfigureDirector = ({ enabled = true, intervalMs = 600000, maxOpen = 8, maxActive = 4, baseOperations = false,
    resolvedThreshold = 3, waveSize = 3, quietWatchdogMs = 600000, visitorWindowMs = 1800000 } = {}) => {
    requireDemo(w);
    if (typeof enabled !== 'boolean' || typeof baseOperations !== 'boolean' || !Number.isSafeInteger(intervalMs) || intervalMs < 60000 || intervalMs > 86400000 ||
      !Number.isSafeInteger(maxOpen) || maxOpen < 1 || maxOpen > 30 || !Number.isSafeInteger(maxActive) || maxActive < 1 || maxActive > 8 ||
      !Number.isSafeInteger(resolvedThreshold) || resolvedThreshold < 1 || resolvedThreshold > 10 ||
      !Number.isSafeInteger(waveSize) || waveSize < 1 || waveSize > 8 ||
      !Number.isSafeInteger(quietWatchdogMs) || quietWatchdogMs < 300000 || quietWatchdogMs > 21600000 ||
      !Number.isSafeInteger(visitorWindowMs) || visitorWindowMs < 600000 || visitorWindowMs > 21600000)
      throw new SimError('DEMO_DIRECTOR', 'Director pacing and quotas must be bounded.');
    const demo = record(w), d = demo.director;
    if (d.enabled === enabled && d.intervalMs === intervalMs && d.maxOpen === maxOpen && demo.maxActive === maxActive && d.baseOperations === baseOperations &&
      d.resolvedThreshold === resolvedThreshold && d.waveSize === waveSize && d.quietWatchdogMs === quietWatchdogMs && d.visitorWindowMs === visitorWindowMs)
      return clone(d);
    demo.maxActive = maxActive; Object.assign(d, { enabled, intervalMs, maxOpen, baseOperations,
      resolvedThreshold, waveSize, quietWatchdogMs, visitorWindowMs }); d.generation++;
    d.wave ??= 0; d.resolvedAtLastWave ??= 0; d.lastActivityAt ??= w.now;
    demo.nextIncident ??= w.state.needs.reduce((last, n) => /^demo-need-\d+$/.test(n.id) ? Math.max(last, Number(n.id.slice(10))) : last, 0) + 1;
    for (const o of w.state.map.organizations.filter(o => !o.demoRetired)) if (!o.resupply) configureSupply(o, supplyConfig());
    if (baseOperations) for (const o of w.state.map.organizations.filter(o => !o.demoVisitor && !o.demoContinuousRoster)) {
      o.demoContinuousRoster = true;
      for (const v of w.state.vehicles.filter(v => v.owner === o.id && !v.background)) v.shiftEnd = Number.MAX_SAFE_INTEGER;
      w.record('demo_continuous_driver_roster', { org: o.id, demoOnly: true }, o.id);
    }
    if (enabled) w.schedule(w.now, 'demo_director_tick', { generation: d.generation }, 4, `demo-director-${d.generation}`);
    w.record('demo_director_configured', { ...d, maxActive, demoOnly: true });
    return clone(d);
  };
  w.on('demo_base_response', ({ generation, tick }) => {
    const d = w.state.demo?.director;
    if (!d?.enabled || !d.baseOperations || generation !== d.generation || !w.config.continuousDemo) return;
    const bases = w.state.map.organizations.filter(o => !o.demoVisitor && o.connected);
    for (let offset = 0; offset < bases.length; offset++) {
      const o = bases[(tick + offset) % bases.length], known = w.state.observations[o.id];
      const need = Object.values(known.needs).filter(n => n.id.startsWith('demo-need-') &&
        ['water', 'food'].includes(n.type)).find(n => {
          const truth = w.need(n.id);
          const debt = w.state.operations.filter(op => op.need === n.id && !terminal.has(op.state))
            .reduce((sum, op) => sum + Math.max(0, (op.quantity ?? 0) - (op.received ?? 0)), 0);
          return truth && truth.quantity - truth.served - debt > 0 &&
            (w.now - truth.createdAt >= d.visitorWindowMs ||
              !w.state.operations.some(op => op.need === n.id && !['failed', 'cancelled'].includes(op.state)));
        });
      if (!need) continue;
      const r = w.state.resources.find(r => r.owner === o.id && r.type === need.type && r.node === o.node && r.quantity - r.reserved - r.floor > 0);
      const fleet = w.state.vehicles.filter(v => v.owner === o.id && !v.background && ['idle', 'arrived'].includes(v.state) && !v.load && !v.operation && w.vehicleDriverAvailable(v));
      const v = fleet[tick % Math.max(1, fleet.length)];
      if (!r || !v) continue;
      const truth = w.need(need.id), cleanup = w.now - truth.createdAt >= d.visitorWindowMs;
      const debt = w.state.operations.filter(op => op.need === need.id && !terminal.has(op.state))
        .reduce((sum, op) => sum + Math.max(0, (op.quantity ?? 0) - (op.received ?? 0)), 0);
      const pending = Math.max(0, truth.quantity - truth.served - debt);
      const quantity = Math.floor(Math.min(need.type === 'water' ? 100 : 40, cleanup ? pending : pending / 2, r.quantity - r.reserved - r.floor));
      if (quantity < 1) continue;
      try {
        const result = w.act({ id: 'demo-scripted-base-commander', org: o.id, role: 'commander' }, {
          type: 'dispatch', params: { need: need.id, resource: r.id, vehicle: v.id, quantity },
          idempotencyKey: cleanup ? `demo-cleanup-${need.id}-${tick}` : `demo-base-${need.id}` });
        const op = w.state.operations.find(op => op.id === result.id); op.demoBaseContribution = true;
        w.record('demo_base_response_authorized', { org: o.id, operation: op.id, need: need.id, quantity,
          controller: 'scripted-owned-commander', modelInference: false, unattendedCleanup: cleanup, demoOnly: true }, op.id);
        break; // Leave the majority of each request for visitor contributions.
      } catch (e) {
        w.record('demo_base_response_deferred', { org: o.id, need: need.id, reason: e.code ?? 'ACTION', demoOnly: true });
      }
    }
  });
  w.on('demo_resupply', ({ org: id, generation }) => {
    if (!w.config.continuousDemo || w.config.mode !== 'interactive') return;
    const org = w.organization(id), config = org?.resupply;
    if (!org || org.demoRetired || !config?.enabled || config.generation !== generation) return;
    for (const type of ['water', 'food']) {
      const r = w.state.resources.find(r => r.owner === id && r.node === org.node && r.type === type && !r.useByAt);
      if (!r || ['expired', 'damaged', 'quarantined'].includes(r.condition)) continue;
      const quantity = Math.min(config[type], supplyCaps[type] - r.quantity);
      if (quantity <= 0) continue;
      const receipt = receive(org, r, quantity, { reference: `scheduled-${id}-${generation}-${w.now}-${type}` });
      w.record('demo_supply_replenished', { org: id, resource: r.id, type, quantity, receipt: receipt.id, demoOnly: true }, r.id);
    }
    // A separate explicit incoming fuel delivery replenishes the depot. Vehicle
    // tanks are filled later only at this physical depot from its fuel ledger.
    const fuel = w.resource(`r-${id}-fuel`);
    if (fuel && fuel.node === org.node && fuel.quantity < 200 && !['expired', 'damaged', 'quarantined'].includes(fuel.condition)) {
      const quantity = 200 - fuel.quantity; fuel.quantity += quantity; fuel.produced += quantity; fuel.version++;
      w.observeResource(id, fuel); w.reportResource(fuel, id);
      w.record('demo_depot_fuel_received', { org: id, resource: fuel.id, quantity, unit: 'L', demoOnly: true }, fuel.id);
    }
    config.nextAt = w.now + config.intervalMs;
    w.schedule(config.nextAt, 'demo_resupply', { org: id, generation }, 4, `demo-resupply-${id}-${generation}-${config.nextAt}`);
  });
  w.on('demo_director_tick', ({ generation }) => {
    if (!w.config.continuousDemo || w.config.mode !== 'interactive') return;
    const demo = w.state.demo, d = demo?.director;
    if (!d?.enabled || generation !== d.generation) return;
    d.tick++;
    if (d.baseOperations) w.schedule(w.now + 60000, 'demo_base_response', { generation, tick: d.tick }, 5, `demo-base-response-${d.tick}`);
    const open = w.state.needs.filter(n => n.quantity > n.served && n.id.startsWith('demo-need-'));
    const completed = w.state.needs.filter(n => n.id.startsWith('demo-need-') && n.quantity > 0 && n.served >= n.quantity && n.completedAt !== null).length;
    const lastPhysical = w.state.operations.reduce((at, op) => op.need?.startsWith('demo-need-')
      ? Math.max(at, op.times?.dispatched ?? 0, op.times?.received ?? 0, op.times?.service ?? 0) : at, d.lastActivityAt ?? w.now);
    d.lastActivityAt = lastPhysical; d.resolvedSinceWave = completed - d.resolvedAtLastWave;
    const quiet = w.now - d.lastActivityAt >= d.quietWatchdogMs;
    const reason = open.length >= d.maxOpen ? quiet ? 'quiet' : null :
      !d.wave && !open.length ? 'initial' : d.resolvedSinceWave >= d.resolvedThreshold ? 'resolved' : quiet ? 'quiet' : null;
    if (reason && open.length < d.maxOpen) {
      const used = new Set(open.map(n => n.building)), created = [];
      for (let i = 0; i < Math.min(d.waveSize, d.maxOpen - open.length); i++) {
        const sites = w.state.map.buildings.filter(b => b.damage < 2 && b.use !== 'plant' && !used.has(b.id));
        if (!sites.length) break;
        const index = demo.nextIncident++, b = sites[Math.floor(w.random('demo', `${index}`, 'incident') * sites.length)]; used.add(b.id);
        const type = index % 3 === 0 ? 'food' : 'water', quantity = type === 'water' ? 300 : 120;
        const n = w.addNeed({ id: `demo-need-${index}`, building: b.id, type, quantity,
          unit: type === 'water' ? 'L' : 'portion', population: 60, deadline: w.now + 14400000, priority: 6, demoWave: d.wave + 1 });
        w.generateSignal('P01', { building: b.id, need: n.id, quantity, text: `${b.name ?? b.id}: a local response team reports ${quantity} ${n.unit} of ${type} needed for 60 people. Please coordinate before sending supplies.`,
          type: index % 2 ? 'text' : 'image', false: false, causeEvent: `demo-incident-${index}`, language: 'en' });
        for (const o of w.state.map.organizations.filter(o => !o.demoRetired))
          w.send({ kind: 'need_observation', need: clone(n), observedAt: w.now }, o.id, { sector: b.sector });
        w.record('demo_incident_created', { need: n.id, building: b.id, wave: d.wave + 1, demoOnly: true }, n.id); created.push(n.id);
      }
      if (created.length) {
        d.wave++; d.lastWaveAt = w.now; d.lastWaveReason = reason; d.resolvedAtLastWave = completed; d.resolvedSinceWave = 0; d.lastActivityAt = w.now;
        w.record('demo_wave_created', { wave: d.wave, reason, needs: created, resolved: completed, demoOnly: true });
      }
    } else if (reason === 'quiet' && open.length >= d.maxOpen) {
      // At capacity, report an existing real shortfall instead of deleting it
      // or spawning an unbounded backlog. A missed original target stays in
      // the receipt/history; the field desk requests a new delivery window.
      const n = open.slice().sort((a, b) => (a.reconfirmedAt ?? a.createdAt) - (b.reconfirmedAt ?? b.createdAt))[0];
      const b = n && w.building(n.building);
      if (b) {
        const oldDeadline = n.deadline, missed = oldDeadline <= w.now;
        w.updateNeed(n.id, { originalDeadline: n.originalDeadline ?? oldDeadline,
          deadline: missed ? w.now + 14400000 : oldDeadline, reconfirmedAt: w.now,
          reconfirmationCount: (n.reconfirmationCount ?? 0) + 1 });
        w.generateSignal('P01', { building: b.id, need: n.id, quantity: n.quantity - n.served,
          text: `${b.name ?? b.id}: the demo field desk reconfirms ${n.quantity - n.served} ${n.unit} of ${n.type} still needed.${missed ? ' The earlier delivery target was missed; delivery is now requested within four hours.' : ' The current delivery request remains open.'}`,
          type: 'text', false: false, causeEvent: `demo-reconfirmed-${d.tick}`, language: 'en' });
        for (const o of w.state.map.organizations.filter(o => !o.demoRetired))
          w.send({ kind: 'need_observation', need: clone(n), observedAt: w.now }, o.id, { sector: b.sector });
        w.record('demo_need_reconfirmed', { need: n.id, previousDeadline: oldDeadline, originalDeadline: n.originalDeadline,
          deadline: n.deadline, remaining: n.quantity - n.served, physicalService: false, demoOnly: true }, n.id);
        d.lastActivityAt = w.now;
      }
    }
    for (const v of w.state.vehicles.filter(v => ['idle', 'arrived'].includes(v.state) && !v.operation)) refuelAtDepot(v);
    w.schedule(w.now + d.intervalMs, 'demo_director_tick', { generation }, 4, `demo-director-${generation}-${d.tick}`);
  });
}
