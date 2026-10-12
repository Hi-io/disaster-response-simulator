import { requireCondition as check, requireRole, requireOwner } from '../contracts/actions.mjs';
import { available, reserve, release, createResource } from './ledger.mjs';
import { clone } from './determinism.mjs';
export function installFacilities(w) {
  w.reportFacility=(b)=>w.send({kind:'facility_status',observedAt:w.now,building:{id:b.id,node:b.node,use:b.use,state:b.state,openAt:b.openAt??null,capacity:b.capacity,occupancy:b.occupancy,provisioned:clone(b.provisioned),dependencies:clone(b.dependencies),requiredPower:clone(b.requiredPower),version:b.version,...(b.state==='closed'?{safe:false}:{}),ownerOrg:b.ownerOrg??'org0'}},b.ownerOrg??'org0',{sector:b.sector});
  w.onAction('activate', (a, p) => {
    requireRole(a, ['commander', 'dispatcher']);
    const b = w.building(p.building);
    check(b, 'NOT_FOUND', 'Facility not found');
    requireOwner(a, b.ownerOrg ?? 'org0');
    check(
      w.state.observations[a.org].buildings[b.id]?.safe &&
        b.assessed &&
        b.damage < 2 &&
        b.assessedVersion === b.version,
      'ASSESSMENT',
      'A current safe assessment must have reached the responsible organization',
    );
    check(p.permit === true, 'PERMIT', 'Explicit owner permission required');
    check(!['operating', 'provisioning'].includes(b.state), 'STATE', 'Already active');
    for (const [type, amount] of Object.entries(b.dependencies)) {
      check((b.provisioned[type] ?? 0) >= amount, 'DEPENDENCY', `Missing ${type}`);
      const stock = w.resource(`stock-${b.node}-${type}`);
      check(stock && available(stock) >= amount, 'DEPENDENCY', `Physical ${type} is unavailable`);
    }
    const power = w.resource(`stock-${b.node}-energy`);
    if (power)
      check(
        power.compatibility?.connector === b.requiredPower.connector &&
          power.compatibility.powerKw >= b.requiredPower.powerKw,
        'COMPATIBILITY',
        'Power source is incompatible',
      );
    b.state = 'provisioning';
    b.permission = { org: a.org, actor: a.id, at: w.now };
    b.activeReservations = [];
    for (const [type, quantity] of Object.entries(b.dependencies).filter(
      ([type]) => type !== 'water',
    )) {
      const r = w.resource(`stock-${b.node}-${type}`);
      reserve(r, quantity);
      const c = {
        id: w.nextId('commitment'),
        owner: r.owner,
        requester: a.org,
        resource: r.id,
        quantity,
        state: 'confirmed',
        expiresAt: w.config.durationMs + 86400000,
        conditions: [],
        createdAt: w.now,
        version: 1,
        task: `facility-${b.id}`,
        authorizedBy: a.id,
      };
      w.state.commitments.push(c);
      b.activeReservations.push(c.id);
    }
    w.schedule(
      w.now + w.config.setupMs,
      'facility_open',
      { building: b.id, org: a.org },
      4,
      `open-${b.id}`,
    );
    w.record('facility_permission_granted', { building: b.id, owner: a.org });
    return { building: b.id, state: b.state, readyAt: w.now + w.config.setupMs };
  });
  w.closeFacility = (b, reason) => {
    b.state = 'closed';
    b.assessed = false;
    for (const id of b.activeReservations ?? []) {
      const c = w.state.commitments.find((c) => c.id === id);
      if (c?.state === 'confirmed') {
        release(w.resource(c.resource), c.quantity);
        c.state = 'released';
      }
    }
    b.activeReservations = [];
    w.record('facility_closed', { building: b.id, reason });
    w.reportFacility(b);
  };
  w.on('facility_open', ({ building: id, org }) => {
    const b = w.building(id);
    if (!b || b.state !== 'provisioning' || b.damage >= 2 || !b.assessed) {
      if (b) w.closeFacility(b, 'conditions_changed_before_opening');
      return;
    }
    b.state = 'operating';
    b.openAt = w.now;
    b.generatorFuel ??= 120;
    b.generatorFuelUnit = 'runtime_minute';
    b.productionRemainder = 0;
    w.record('facility_operating', { building: id, capacity: b.capacity });
    w.reportFacility(b);
    if (b.use === 'plant') {
      if (!w.resource(`raw-${id}`))
        w.state.resources.push(createResource(`raw-${id}`, org, b.node, 'raw_water', 10000));
      w.schedule(w.now + 60000, 'produce', { building: id, org }, 4, `produce-${id}`);
    }
    if (b.use === 'shelter')
      w.schedule(w.now + 60000, 'shelter_service', { building: id, org }, 4, `service-${id}`);
  });
  w.on('produce', ({ building: id, org }) => {
    const b = w.building(id);
    if (b?.state !== 'operating' || b.damage >= 2) return;
    const raw = w.resource(`raw-${id}`),
      quantity = Math.floor((b.capacity + (b.productionRemainder ?? 0)) / 60);
    b.productionRemainder = (b.capacity + (b.productionRemainder ?? 0)) % 60;
    if (raw.quantity < quantity || b.generatorFuel <= 0) {
      w.closeFacility(b, 'feedstock_or_generator_fuel_exhausted');
      return;
    }
    raw.quantity -= quantity;
    raw.consumed += quantity;
    raw.version++;
    b.generatorFuel--;
    let r = w.resource(`production-${id}`);
    if (!r) {
      r = createResource(`production-${id}`, org, b.node, 'water', 0);
      w.state.resources.push(r);
    }
    r.quantity += quantity;
    r.produced += quantity;
    r.version++;
    w.observeResource(org, r);
    w.record('water_produced', { building: id, quantity });
    if (w.now + 60000 <= w.config.durationMs)
      w.schedule(w.now + 60000, 'produce', { building: id, org }, 4, `produce-${id}-${w.now}`);
  });
  w.on('shelter_service', ({ building: id, org }) => {
    const b = w.building(id);
    if (b?.state !== 'operating') return;
    const water = w.resource(`stock-${b.node}-water`),
      amount = b.occupancy ? Math.max(1, Math.ceil((b.occupancy * 2) / 1440)) : 0;
    if (b.damage >= 2 || !water || water.quantity < amount) {
      w.closeFacility(b, 'unsafe_or_water_exhausted');
      return;
    }
    water.quantity -= amount;
    water.consumed += amount;
    water.version++;
    b.provisioned.water = water.quantity;
    if (w.now + 60000 <= w.config.durationMs)
      w.schedule(
        w.now + 60000,
        'shelter_service',
        { building: id, org },
        4,
        `service-${id}-${w.now}`,
      );
  });
  const previousDamage = w.handlers.get('damage');
  w.on('damage', (p) => {
    previousDamage(p);
    const b = w.building(p.building);
    if (b && p.severity >= 2 && b.activeReservations?.length)
      w.closeFacility(b, 'new_hazard_invalidates_assessment');
  });
  const previousUnload = w.handlers.get('unload');
  w.on('unload', (p) => {
    previousUnload(p);
    const op = w.state.operations.find((o) => o.id === p.operation);
    if (op?.state === 'completed' && op.building && !op.need) {
      const b = w.building(op.building),
        source = w.resource(op.resource),
        dest = w.resource(op.destinationStock);
      if (source?.compatibility) dest.compatibility = clone(source.compatibility);
      if (op.resourceType === 'fuel') b.generatorFuel = (b.generatorFuel ?? 0) + op.received * 5;
    }
  });
}
