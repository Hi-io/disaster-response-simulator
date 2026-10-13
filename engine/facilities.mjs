import { requireCondition as check, requireRole, requireOwner } from '../contracts/actions.mjs';
import { available, reserve, release, createResource } from './ledger.mjs';
import { clone } from './determinism.mjs';
import { qualifiedStaffAvailable } from './staff.mjs';
import { supplyUsable } from './supplies.mjs';
export function installFacilities(w) {
  // Unloading keeps stocks separate when two organizations receive goods at
  // the same node. A service site may use only stock owned by its owner; a
  // public or previously consumed foreign stock is never a dependency.
  const facilityStock = (b, type) => {
    const owner = b.ownerOrg ?? 'org0';
    for (const id of [`stock-${b.node}-${type}`, `stock-${b.node}-${type}-${owner}`]) {
      const stock = w.resource(id);
      if (stock?.owner === owner && stock.node === b.node && stock.type === type&&
        (type!=='staff'||w.staffWindow?.(stock).usable!==false)) return stock;
    }
    if(type==='staff')return w.state.resources.filter(r=>r.node===b.node&&r.owner===owner&&r.type===type&&
      w.staffWindow?.(r).usable!==false&&qualifiedStaffAvailable(r,b.requiredStaffSkills??[])>=(b.dependencies.staff??0))
      .sort((a,z)=>a.id.localeCompare(z.id))[0]??null;
    return null;
  };
  const waterStocks = b => w.state.resources.filter(r => r.node === b.node &&
    r.owner === (b.ownerOrg ?? 'org0') && r.type === 'water' && supplyUsable(r, w.now))
    .sort((a, z) => (a.useByAt ?? Infinity) - (z.useByAt ?? Infinity) || a.id.localeCompare(z.id));
  const usableWater = b => waterStocks(b).reduce((sum, r) => sum + Math.max(0, available(r)), 0);
  w.integrateFacility=(b)=>{const elapsed=Math.max(0,w.now-(b.serviceIntegratedAt??w.now));if(b.state==='operating'){b.operatingMs=(b.operatingMs??0)+elapsed;if(b.use==='shelter')b.servedPlaceMs=(b.servedPlaceMs??0)+(b.occupancy??0)*elapsed;}b.serviceIntegratedAt=w.now;};
  w.reportFacility=(b)=>w.send({kind:'facility_status',observedAt:w.now,building:{id:b.id,node:b.node,use:b.use,state:b.state,openAt:b.openAt??null,capacity:b.capacity,occupancy:b.occupancy,provisioned:clone(b.provisioned),dependencies:clone(b.dependencies),requiredPower:clone(b.requiredPower),requiredStaffSkills:clone(b.requiredStaffSkills??[]),version:b.version,...(b.state==='closed'?{safe:false}:{}),ownerOrg:b.ownerOrg??'org0'}},b.ownerOrg??'org0',{sector:b.sector});
  w.onAction('activate', (a, p) => {
    requireRole(a, ['commander', 'dispatcher']);
    const b = w.building(p.building);
    check(b, 'NOT_FOUND', 'Facility not found');
    requireOwner(a, b.ownerOrg ?? 'org0');
    check(['shelter', 'plant'].includes(b.use) && b.capacity > 0,
      'FACILITY_PURPOSE', 'Activation requires an eligible service site with useful capacity');
    check(
      w.state.observations[a.org].buildings[b.id]?.safe &&
        b.assessed &&
        b.damage < 2 &&
        b.assessedVersion === b.version &&
        b.assessedValidUntil > w.now &&
        w.state.inspections.some(i => i.org === a.org && i.entity === b.id && i.target === 'building' &&
          i.state === 'completed' && i.confirmedBySource === true && i.method === 'field' &&
          i.purpose === 'facility_safety' && i.result?.safe === true && i.result.version === b.version &&
          i.result.assessment?.competent === true && i.result.assessment.qualifications?.includes('field_assessment') &&
          i.result.assessment.validUntil > w.now &&
          (i.targetVersion === undefined || i.targetVersion === b.version)),
      'ASSESSMENT',
      'A current safe assessment must have reached the responsible organization',
    );
    check(p.permit === true, 'PERMIT', 'Explicit owner permission required');
    check(!['operating', 'provisioning'].includes(b.state), 'STATE', 'Already active');
    for (const [type, amount] of Object.entries(b.dependencies)) {
      check((b.provisioned[type] ?? 0) >= amount, 'DEPENDENCY', `Missing ${type}`);
      const stock = facilityStock(b, type);
      check(type === 'water' ? usableWater(b) >= amount : stock && available(stock) >= amount,
        'DEPENDENCY', `Physical usable ${type} is unavailable`);
    }
    const power = facilityStock(b, 'energy');
    const staff = facilityStock(b, 'staff');
    check(qualifiedStaffAvailable(staff, b.requiredStaffSkills ?? []) >= (b.dependencies.staff ?? 0),
      'QUALIFICATION', 'Enough staff with all required skills must be physically available');
    if((b.dependencies.staff??0)>0)check(w.staffWindow?.(staff,w.now+w.config.setupMs).usable!==false,
      'STAFF_CALENDAR','Staff must be on shift throughout facility setup');
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
      const r = facilityStock(b, type);
      const staffReservation = reserve(r, quantity, type === 'staff' ? (b.requiredStaffSkills ?? []) : []);
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
        staffReservation,
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
    for(const c of w.state.cohorts.filter(c=>c.node===b.node&&c.population>0)){
      w.advancePopulation?.(c,w.now);
      if(c.health)c.health.unsheltered=true;
    }
    w.integrateFacility(b);
    b.state = 'closed';
    b.assessed = false;
    for (const id of b.activeReservations ?? []) {
      const c = w.state.commitments.find((c) => c.id === id);
      if (c?.state === 'confirmed') {
        release(w.resource(c.resource), c.quantity, c.staffReservation);
        c.state = 'released';
      }
    }
    b.activeReservations = [];
    w.record('facility_closed', { building: b.id, reason });
    w.reportFacility(b);
  };
  w.on('facility_open', ({ building: id, org }) => {
    const b = w.building(id);
    if (!b || b.state !== 'provisioning' || b.damage >= 2 || !b.assessed ||
      (b.dependencies.water > 0 && usableWater(b) < b.dependencies.water) ||
      b.assessedVersion !== b.version || b.assessedValidUntil <= w.now) {
      if (b) w.closeFacility(b, 'conditions_changed_before_opening');
      return;
    }
    b.state = 'operating';
    b.serviceIntegratedAt=w.now;
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
    w.integrateFacility(b);
    b.waterConsumptionRemainder=(b.waterConsumptionRemainder??0)+(b.occupancy??0)*w.config.waterMlPerPersonDay;
    const amount = Math.floor(b.waterConsumptionRemainder/1440000);
    b.waterConsumptionRemainder%=1440000;
    if (b.damage >= 2 || usableWater(b) < amount) {
      w.closeFacility(b, 'unsafe_or_water_exhausted');
      return;
    }
    let remaining = amount;
    for (const water of waterStocks(b)) {
      const used = Math.min(remaining, Math.max(0, available(water)));
      if (used) { water.quantity -= used; water.consumed += used; water.version++; remaining -= used; }
      if (!remaining) break;
    }
    b.provisioned.water = usableWater(b);
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
