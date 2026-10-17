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
const profile = o => own(o, ['id', 'name', 'color', 'node', 'demoVisitor', 'demoRetired', 'joinedAt']);
const record = w => w.state.demo ??= { schemaVersion: 1, nextOrganization: 1, maxActive: 4,
  maxLifetime: 2000, requests: {}, releases: {}, director: { enabled: false, generation: 0, tick: 0 } };
const publicResult = (w, o) => ({ runId: w.runId, organization: profile(o),
  kit: { vehicles: 3, water: { quantity: 600, unit: 'L' }, food: { quantity: 120, unit: 'portion' } } });

export function installDemo(w) {
  w.demoCreateOrganization = input => {
    requireDemo(w);
    if (!input || typeof input.idempotencyKey !== 'string' || !/^[\w:-]{8,120}$/.test(input.idempotencyKey))
      throw new SimError('DEMO_IDEMPOTENCY', 'A bounded idempotency key is required.');
    const name = typeof input.name === 'string' ? input.name.trim().replace(/\s+/g, ' ') : '';
    if (name.length < 2 || name.length > 64 || /[<>\x00-\x1f]/.test(name))
      throw new SimError('DEMO_NAME', 'Choose a team name between 2 and 64 characters.');
    const color = input.color ?? '#7261d8';
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new SimError('DEMO_COLOR', 'A six-digit team color is required.');
    const demo = record(w), material = digest({ name, color });
    const previous = demo.requests[input.idempotencyKey];
    if (previous) {
      if (previous.material !== material) throw new SimError('IDEMPOTENCY_CONFLICT', 'This registration key already belongs to another request.', 409);
      return clone(previous.result);
    }
    const active = w.state.map.organizations.filter(o => o.demoVisitor && !o.demoRetired);
    if (active.length >= demo.maxActive) throw new SimError('DEMO_CAPACITY', 'All demonstration team spaces are in use. You can continue observing.', 429);
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
  w.demoConfigureDirector = ({ enabled = true, intervalMs = 600000, maxOpen = 8, maxActive = 4, baseOperations = false } = {}) => {
    requireDemo(w);
    if (typeof enabled !== 'boolean' || typeof baseOperations !== 'boolean' || !Number.isSafeInteger(intervalMs) || intervalMs < 60000 || intervalMs > 86400000 ||
      !Number.isSafeInteger(maxOpen) || maxOpen < 1 || maxOpen > 30 || !Number.isSafeInteger(maxActive) || maxActive < 1 || maxActive > 8)
      throw new SimError('DEMO_DIRECTOR', 'Director pacing and quotas must be bounded.');
    const demo = record(w), d = demo.director;
    if (d.enabled === enabled && d.intervalMs === intervalMs && d.maxOpen === maxOpen && demo.maxActive === maxActive && d.baseOperations === baseOperations)
      return clone(d);
    demo.maxActive = maxActive; d.enabled = enabled; d.intervalMs = intervalMs; d.maxOpen = maxOpen; d.baseOperations = baseOperations; d.generation++;
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
        ['water', 'food'].includes(n.type) && n.quantity > n.served).find(n =>
        !w.state.operations.some(op => op.need === n.id && !['failed', 'cancelled'].includes(op.state)));
      if (!need) continue;
      const r = w.state.resources.find(r => r.owner === o.id && r.type === need.type && r.node === o.node && r.quantity - r.reserved - r.floor > 0);
      const v = w.state.vehicles.find(v => v.owner === o.id && !v.background && ['idle', 'arrived'].includes(v.state) && !v.load && !v.operation);
      if (!r || !v) continue;
      const quantity = Math.floor(Math.min(need.type === 'water' ? 100 : 40, (need.quantity - need.served) / 2, r.quantity - r.reserved - r.floor));
      if (quantity < 1) continue;
      try {
        const result = w.act({ id: 'demo-scripted-base-commander', org: o.id, role: 'commander' }, {
          type: 'dispatch', params: { need: need.id, resource: r.id, vehicle: v.id, quantity },
          idempotencyKey: `demo-base-${need.id}` });
        const op = w.state.operations.find(op => op.id === result.id); op.demoBaseContribution = true;
        w.record('demo_base_response_authorized', { org: o.id, operation: op.id, need: need.id, quantity,
          controller: 'scripted-owned-commander', modelInference: false, demoOnly: true }, op.id);
        break; // Leave the majority of each request for visitor contributions.
      } catch (e) {
        w.record('demo_base_response_deferred', { org: o.id, need: need.id, reason: e.code ?? 'ACTION', demoOnly: true });
      }
    }
  });
  w.on('demo_director_tick', ({ generation }) => {
    if (!w.config.continuousDemo || w.config.mode !== 'interactive') return;
    const demo = w.state.demo, d = demo?.director;
    if (!d?.enabled || generation !== d.generation) return;
    d.tick++;
    if (d.baseOperations) w.schedule(w.now + 60000, 'demo_base_response', { generation, tick: d.tick }, 5, `demo-base-response-${d.tick}`);
    const open = w.state.needs.filter(n => n.quantity > n.served && n.id.startsWith('demo-need-'));
    if (open.length < d.maxOpen) {
      const sites = w.state.map.buildings.filter(b => b.damage < 2 && b.use !== 'plant');
      const b = sites[Math.floor(w.random('demo', `${d.tick}`, 'incident') * sites.length)];
      if (b) {
        const type = d.tick % 3 === 0 ? 'food' : 'water', quantity = type === 'water' ? 300 : 120;
        const n = w.addNeed({ id: `demo-need-${d.tick}`, building: b.id, type, quantity,
          unit: type === 'water' ? 'L' : 'portion', population: 60, deadline: w.now + 14400000, priority: 6 });
        w.generateSignal('P01', { building: b.id, need: n.id, quantity, text: `${b.name ?? b.id}: a local response team reports ${quantity} ${n.unit} of ${type} needed for 60 people. Please coordinate before sending supplies.`,
          type: d.tick % 2 ? 'text' : 'image', false: false, causeEvent: `demo-incident-${d.tick}`, language: 'en' });
        for (const o of w.state.map.organizations.filter(o => !o.demoRetired))
          w.send({ kind: 'need_observation', need: clone(n), observedAt: w.now }, o.id, { sector: b.sector });
        w.record('demo_incident_created', { need: n.id, building: b.id, demoOnly: true }, n.id);
      }
    }
    // Explicit incoming demo supply, accounted in the same stock ledger. No
    // reserved/loaded cargo is replaced, no operation is completed by fiat.
    for (const o of w.state.map.organizations.filter(o => !o.demoRetired)) {
      if ((o.demoLastResupplyAt ?? o.joinedAt ?? 0) + 21600000 > w.now) continue;
      o.demoLastResupplyAt = w.now;
      for (const [type, target] of [['water', 600], ['food', 120], ['fuel', 200]]) {
        const r = w.state.resources.find(r => r.owner === o.id && r.type === type && r.node === o.node && !r.useByAt);
        if (!r || r.reserved || r.quantity >= target || ['expired', 'damaged', 'quarantined'].includes(r.condition)) continue;
        const quantity = target - r.quantity; r.quantity += quantity; r.produced += quantity; r.version++;
        w.reportResource(r, o.id); w.record('demo_supply_replenished', { org: o.id, resource: r.id, type, quantity, demoOnly: true }, r.id);
      }
      for (const v of w.state.vehicles.filter(v => v.owner === o.id && v.state === 'idle' && !v.load && !v.edge)) {
        if (v.fuel < w.config.vehicleFuelMl) {
          const quantityMl = w.config.vehicleFuelMl - v.fuel; v.fuel += quantityMl; v.version++;
          w.reportVehicle(v); w.record('demo_vehicle_refueled', { org: o.id, vehicle: v.id, quantityMl, demoOnly: true }, v.id);
        }
      }
    }
    w.schedule(w.now + d.intervalMs, 'demo_director_tick', { generation }, 4, `demo-director-${generation}-${d.tick}`);
  });
}
