import { clone } from './determinism.mjs';
import {
  available,
  reserve,
  release,
  createResource,
  transition,
  COMMITMENT_STATES,
} from './ledger.mjs';
import { requireCondition as check, requireRole, requireOwner } from '../contracts/actions.mjs';
import { route } from '../generators/map.mjs';

const command = (actor) => requireRole(actor, ['commander', 'dispatcher']);
const positive = (n) =>
  check(Number.isSafeInteger(n) && n > 0, 'QUANTITY', 'Positive integer required');
const operation = (w, id) => w.state.operations.find((o) => o.id === id);
const terminal = (o) => ['completed', 'cancelled', 'failed'].includes(o.state);

export function installTasks(w) {
  // Personnel assignments use the same reservation ledger as deliveries.
  w.allocateStaff = (org, quantity, task) => {
    const r = w.resource(`r-${org}-staff`);
    check(available(r) >= quantity, 'STAFF', 'No staff available');
    reserve(r, quantity);
    const c = {
      id: w.nextId('commitment'),
      owner: org,
      requester: org,
      resource: r.id,
      quantity,
      state: 'confirmed',
      expiresAt: w.config.durationMs + 86400000,
      conditions: [],
      task,
      createdAt: w.now,
      version: 1,
      authorizedBy: `task-${org}`,
    };
    w.state.commitments.push(c);
    return c.id;
  };
  w.releaseStaff = (id) => {
    const c = w.state.commitments.find((c) => c.id === id);
    if (c && c.state === 'confirmed') {
      release(w.resource(c.resource), c.quantity);
      transition(c, 'released', COMMITMENT_STATES);
    }
  };
  const idleVehicle = (org) =>
    w.state.vehicles.find(
      (v) => v.owner === org && !v.background && v.state === 'idle' && !v.load && !v.passengers,
    );
  const targetNode = (i) =>
    i.target === 'building'
      ? w.building(i.entity)?.node
      : i.target === 'need'
        ? w.building(w.need(i.entity)?.building)?.node
        : i.target === 'road'
          ? w.edge(i.entity)?.from
          : w.resource(i.entity)?.node;
  w.onAction('verify', (a, p) => {
    check(
      ['building', 'need', 'road', 'resource'].includes(p.target),
      'TARGET',
      'Invalid verification target',
    );
    check(
      ['field', 'radio', 'clarification'].includes(p.method ?? 'field'),
      'METHOD',
      'Unknown inspection method',
    );
    if (p.target === 'resource') {
      const r = w.resource(p.id);
      check(
        r && (r.owner === a.org || (r.public && w.organization(r.owner)?.sharing === 'public')),
        'ACCESS',
        'Owner confirmation is required',
        403,
      );
    }
    const i = {
      id: w.nextId('inspection'),
      org: a.org,
      target: p.target,
      entity: p.id,
      method: p.method ?? 'field',
      state: 'queued',
      createdAt: w.now,
    };
    check(targetNode(i), 'NOT_FOUND', 'Target location is not available');
    w.state.inspections.push(i);
    w.schedule(w.now, 'field_prepare', { inspection: i.id }, 4, i.id);
    return clone(i);
  });
  w.on('field_prepare', ({ inspection: id }) => {
    const i = w.state.inspections.find((x) => x.id === id);
    if (!i || i.state !== 'queued') return;
    const org = w.organization(i.org),
      v = idleVehicle(i.org),
      r = w.resource(`r-${i.org}-staff`);
    if (w.now >= w.config.durationMs) {
      i.state = 'timeout';
      return;
    }
    if (!v || available(r) < 1) {
      w.schedule(
        w.now + 30000,
        'field_prepare',
        { inspection: id },
        4,
        `field-wait-${id}-${w.now}`,
      );
      return;
    }
    if (i.method === 'clarification') {
      const start = Math.max(w.now, org.inspectionAvailableAt ?? 0);
      org.inspectionAvailableAt = start + w.config.inspectionMs;
      i.state = 'clarification_pending';
      w.schedule(org.inspectionAvailableAt, 'field_observe', { inspection: id }, 4, id);
      return;
    }
    const path = route(w.state.map, v.node, targetNode(i), v, w.state.observations[i.org].edges);
    if (!path) {
      i.state = 'inconclusive';
      i.failure = 'no_known_access';
      w.record('verification_inconclusive', { inspection: id, reason: i.failure });
      return;
    }
    i.staff = w.allocateStaff(i.org, 1, id);
    i.state = 'traveling';
    i.vehicle = v.id;
    i.startedAt = w.now;
    const op = {
      id: w.nextId('operation'),
      type: 'inspection',
      org: i.org,
      inspection: i.id,
      vehicle: v.id,
      destination: targetNode(i),
      state: 'authorized',
      createdAt: w.now,
      times: { authorized: w.now },
    };
    w.state.operations.push(op);
    i.operation = op.id;
    w.startTrip(v, op.destination, op);
  });
  w.on('field_observe', ({ inspection: id }) => {
    const i = w.state.inspections.find((x) => x.id === id);
    if (!i || ['completed', 'inconclusive', 'timeout'].includes(i.state)) return;
    let result = null;
    const node = targetNode(i),
      sector = w.sectorForNode(node);
    // Clarification may be inconclusive; it is not a free ground-truth oracle.
    const observed =
      i.method !== 'clarification' ||
      w.random('verification', id, 'reply') < w.config.observationRate;
    if (observed && i.target === 'building') {
      const b = w.building(i.entity);
      result = {
        id: b.id,
        node: b.node,
        use: b.use,
        safe: b.damage < 2,
        state: b.state,
        damage: b.damage,
        capacity: b.capacity,
        dependencies: clone(b.dependencies),
        provisioned: clone(b.provisioned),
        requiredPower: clone(b.requiredPower),
        version: b.version,
      };
      for (const n of w.state.needs.filter((n) => n.building === b.id))
        w.send({ kind: 'need_observation', need: clone(n), observedAt: w.now }, i.org, {
          sector,
          channel: i.method === 'radio' ? 'radio' : 'internet',
        });
    }
    if (observed && i.target === 'need') {
      const n = w.need(i.entity);
      result = {
        id: n.id,
        building: n.building,
        type: n.type,
        quantity: n.quantity,
        served: n.served,
        deadline: n.deadline,
        population: n.population,
        unit: n.unit,
        version: n.version,
      };
    }
    if (observed && i.target === 'road') {
      const e = w.edge(i.entity);
      result = { id: e.id, open: e.open, waterDepth: e.waterDepth, version: e.version };
    }
    if (observed && i.target === 'resource') {
      const r = w.resource(i.entity);
      result = {
        id: r.id,
        owner: r.owner,
        node: r.node,
        type: r.type,
        quantity: r.quantity,
        reserved: r.reserved,
        floor: r.floor,
        available: available(r),
        compatibility: clone(r.compatibility),
        version: r.version,
      };
    }
    i.state = 'report_pending';
    i.observedAt = w.now;
    w.releaseStaff(i.staff);
    const op = operation(w, i.operation);
    if (op) {
      op.state = 'completed';
      op.times.service = w.now;
      const v = w.vehicle(op.vehicle);
      v.state = 'idle';
      v.operation = null;
    }
    w.send({ kind: 'verification', inspection: id, result, observedAt: w.now }, i.org, {
      sector,
      channel: i.method === 'radio' ? 'radio' : 'internet',
    });
  });
  w.completeVerification = (p) => {
    const i = w.state.inspections.find((x) => x.id === p.inspection);
    if (!i) return;
    i.state = p.result ? 'completed' : 'inconclusive';
    i.result = clone(p.result);
    i.completedAt = w.now;
    const result = p.result;
    if (result) {
      const key = { building: 'buildings', need: 'needs', road: 'edges', resource: 'resources' }[
          i.target
        ],
        old = w.state.observations[i.org][key][i.entity];
      if (!old || p.observedAt >= old.at)
        w.state.observations[i.org][key][i.entity] = { ...result, at: p.observedAt };
      if (i.target === 'building') {
        const b = w.building(i.entity);
        if (result.safe && result.version === b.version) {
          b.assessed = true;
          b.assessedAt = p.observedAt;
          b.assessedVersion = b.version;
        }
      }
    }
    w.record('verification_completed', {
      inspection: i.id,
      org: i.org,
      target: i.target,
      entity: i.entity,
      inconclusive: !result,
    });
  };

  w.onAction('repair', (a, p) => {
    command(a);
    const edge = w.edge(p.edge);
    check(edge, 'NOT_FOUND', 'Road not found');
    check(edge.waterDepth <= 0.2, 'FLOOD', 'Floodwater cannot be repaired as debris');
    check(
      !edge.bridge || p.engineering === true,
      'ENGINEERING',
      'Bridge repair requires an engineering authorization',
    );
    const v = idleVehicle(a.org);
    check(v, 'VEHICLE_BUSY', 'A crew vehicle is required');
    const path = route(w.state.map, v.node, edge.from, v, w.state.observations[a.org].edges);
    check(path, 'ROUTE', 'Crew has no known route to worksite');
    const task = {
      id: w.nextId('repair'),
      org: a.org,
      edge: edge.id,
      state: 'traveling',
      createdAt: w.now,
      staff: null,
    };
    task.staff = w.allocateStaff(a.org, 2, task.id);
    w.state.repairs ??= [];
    w.state.repairs.push(task);
    const op = {
      id: w.nextId('operation'),
      type: 'repair',
      org: a.org,
      repair: task.id,
      vehicle: v.id,
      destination: edge.from,
      state: 'authorized',
      createdAt: w.now,
      times: { authorized: w.now },
    };
    w.state.operations.push(op);
    task.operation = op.id;
    w.startTrip(v, edge.from, op);
    return clone(task);
  });
  w.on('repair_finish', ({ id }) => {
    const t = w.state.repairs.find((x) => x.id === id);
    if (!t || t.state !== 'working') return;
    const e = w.edge(t.edge);
    if (e.waterDepth > 0.2) {
      t.state = 'failed';
      t.failure = 'hazard_still_active';
    } else {
      t.state = 'completed';
      e.open = true;
      e.version++;
      w.reportRoad(e, t.org);
      w.record('repair_completed', { edge: e.id }, id);
    }
    w.releaseStaff(t.staff);
    const op = operation(w, t.operation);
    op.state = t.state;
    const v = w.vehicle(op.vehicle);
    v.state = 'idle';
    v.operation = null;
  });

  w.onAction('evacuate', (a, p) => {
    command(a);
    positive(p.quantity);
    const from = w.building(p.from),
      to = w.building(p.to),
      v = w.vehicle(p.vehicle);
    check(from && to && v, 'NOT_FOUND', 'Evacuation entities not found');
    requireOwner(a, v.owner);
    check(v.state === 'idle' && !v.load && !v.passengers, 'VEHICLE_BUSY', 'Vehicle unavailable');
    check(
      to.state === 'operating' && to.damage < 2,
      'SHELTER',
      'Receiving shelter must be operating',
    );
    check(
      p.quantity <= v.seats && p.quantity <= to.capacity - to.occupancy - to.reservedPlaces,
      'CAPACITY',
      'Not enough seats or shelter places',
    );
    const n = w.state.needs.find((n) => n.building === from.id && n.type === 'shelter');
    check(
      n && p.quantity <= n.quantity - n.served - (n.inTransit ?? 0),
      'POPULATION',
      'No unassigned group of that size',
    );
    check(
      route(w.state.map, v.node, from.node, v, w.state.observations[a.org].edges) &&
        route(w.state.map, from.node, to.node, v, w.state.observations[a.org].edges),
      'ROUTE',
      'No known pickup or evacuation route',
    );
    const task = {
      id: w.nextId('evacuation'),
      org: a.org,
      from: from.id,
      to: to.id,
      vehicle: v.id,
      need: n.id,
      quantity: p.quantity,
      state: 'pickup_pending',
      createdAt: w.now,
    };
    w.state.evacuations ??= [];
    w.state.evacuations.push(task);
    n.inTransit = (n.inTransit ?? 0) + p.quantity;
    to.reservedPlaces += p.quantity;
    const op = {
      id: w.nextId('operation'),
      type: 'evacuation',
      org: a.org,
      evacuation: task.id,
      vehicle: v.id,
      destination: from.node,
      state: 'authorized',
      createdAt: w.now,
      times: { authorized: w.now },
      phase: 'pickup',
    };
    w.state.operations.push(op);
    task.operation = op.id;
    w.send({ kind: 'task_command', operation: op.id }, a.org, {
      sector: w.sectorForNode(v.node),
      target: v.id,
    });
    v.state = 'preparing';
    return clone(task);
  });
  w.on('evacuation_load', ({ operation: id }) => {
    const op = operation(w, id),
      task = w.state.evacuations.find((t) => t.id === op?.evacuation);
    if (!op || terminal(op)) return;
    const v = w.vehicle(op.vehicle),
      cohort = w.state.cohorts.find((c) => c.sector === w.building(task.from).sector);
    if (!cohort || cohort.population < task.quantity) {
      op.state = 'failed';
      task.state = 'failed';
      w.need(task.need).inTransit -= task.quantity;
      w.building(task.to).reservedPlaces -= task.quantity;
      v.state = 'idle';
      return;
    }
    cohort.population -= task.quantity;
    cohort.inTransit += task.quantity;
    task.cohort = cohort.id;
    v.passengers = task.quantity;
    task.state = 'traveling';
    op.phase = 'shelter';
    op.destination = w.building(task.to).node;
    op.times.prepared = w.now;
    w.startTrip(v, op.destination, op);
  });
  w.on('evacuation_receive', ({ operation: id }) => {
    const op = operation(w, id),
      t = w.state.evacuations.find((x) => x.id === op?.evacuation);
    if (!op || terminal(op)) return;
    const v = w.vehicle(op.vehicle),
      to = w.building(t.to),
      n = w.need(t.need);
    if (to.state !== 'operating' || to.damage >= 2 || to.occupancy + v.passengers > to.capacity) {
      t.state = 'waiting_for_safe_destination';
      op.state = 'waiting_for_safe_destination';
      w.record('evacuation_blocked', { to: to.id, quantity: v.passengers }, t.id);
      return;
    }
    to.reservedPlaces -= t.quantity;
    to.occupancy += v.passengers;
    n.inTransit -= t.quantity;
    const original = w.state.cohorts.find((c) => c.id === t.cohort);
    original.inTransit -= t.quantity;
    original.moved += t.quantity;
    w.state.cohorts.push({
      id: `relocated-${t.id}`,
      node: to.node,
      sector: to.sector,
      population: t.quantity,
      inTransit: 0,
      moved: 0,
      mobility: original.mobility,
      language: original.language,
      reportProbability: original.reportProbability,
    });
    w.serveNeed(n.id, v.passengers);
    op.times.received = w.now;
    op.times.service = w.now;
    op.state = 'completed';
    t.state = 'completed';
    t.completedAt = w.now;
    v.passengers = 0;
    v.state = 'idle';
    v.operation = null;
    w.reportOperation(op);
    w.record('evacuation_completed', { quantity: t.quantity, to: to.id }, t.id);
  });
  w.on('task_arrival', ({ operation: id }) => {
    const op = operation(w, id);
    if (!op || terminal(op)) return;
    const v = w.vehicle(op.vehicle);
    if (op.type === 'inspection') {
      const i = w.state.inspections.find((i) => i.id === op.inspection);
      i.state = 'inspecting';
      i.arrivedAt = w.now;
      w.schedule(w.now + w.config.inspectionMs, 'field_observe', { inspection: i.id }, 4, i.id);
    }
    if (op.type === 'repair') {
      const t = w.state.repairs.find((t) => t.id === op.repair);
      t.state = 'working';
      t.startedAt = w.now;
      w.schedule(w.now + w.config.setupMs * 2, 'repair_finish', { id: t.id }, 4, t.id);
    }
    if (op.type === 'evacuation')
      w.schedule(
        w.now + (op.phase === 'pickup' ? w.config.loadMs : w.config.unloadMs),
        op.phase === 'pickup' ? 'evacuation_load' : 'evacuation_receive',
        { operation: op.id },
        4,
        `evac-${op.id}-${op.phase}`,
      );
    if (op.type === 'recovery') {
      const r = w.resource(op.resource);
      r.quantity += v.load;
      r.received += v.load;
      r.version++;
      v.load = 0;
      v.state = 'idle';
      v.operation = null;
      op.state = 'cancelled';
      op.times.returned = w.now;
      w.observeResource(op.org, r);
      w.record('cargo_returned', { quantity: op.quantity, resource: r.id }, op.id);
    }
  });
  w.onAction('reroute', (a, p) => {
    command(a);
    const v = w.vehicle(p.vehicle);
    check(v, 'NOT_FOUND', 'Vehicle not found');
    requireOwner(a, v.owner);
    const op = operation(w, v.operation);
    check(op && !terminal(op), 'STATE', 'No active operation');
    check(w.node(p.destination), 'DESTINATION', 'Unknown destination');
    const n = p.need ? w.need(p.need) : null,
      b = p.building ? w.building(p.building) : null;
    if (op.type === 'delivery')
      check(
        (n && w.building(n.building).node === p.destination && n.type === op.resourceType) ||
          (b && b.node === p.destination) ||
          p.destination === op.destination,
        'DESTINATION',
        'A new delivery destination needs a corresponding need or facility',
      );
    if (op.type === 'evacuation') {
      check(
        b?.state === 'operating' && b.capacity - b.occupancy - b.reservedPlaces >= v.passengers,
        'SHELTER',
        'A safe destination with capacity is required',
      );
    }
    const orderVersion = (v.nextOrderVersion ?? 0) + 1;
    v.nextOrderVersion = orderVersion;
    w.send(
      {
        kind: 'reroute',
        vehicle: v.id,
        destination: p.destination,
        need: n?.id,
        building: b?.id,
        orderVersion,
        createdAt: w.now,
      },
      a.org,
      { sector: w.sectorForNode(v.node), target: v.id },
    );
    w.record(
      'reroute_authorized',
      { vehicle: v.id, destination: p.destination, orderVersion },
      op.id,
    );
    return { state: 'instruction_pending', vehicle: v.id, orderVersion };
  });
  w.applyReroute = (v, p) => {
    const op = operation(w, v.operation);
    if (!op || terminal(op) || (p.orderVersion ?? 0) < (v.receivedOrderVersion ?? 0)) return;
    v.receivedOrderVersion = p.orderVersion ?? 0;
    if (op.type === 'evacuation' && p.building) {
      const task = w.state.evacuations.find((t) => t.id === op.evacuation);
      w.building(task.to).reservedPlaces -= task.quantity;
      w.building(p.building).reservedPlaces += task.quantity;
      task.to = p.building;
      op.phase = 'shelter';
    }
    op.destination = p.destination;
    if (p.need) {
      op.need = p.need;
      op.building = w.need(p.need).building;
    } else if (p.building) {
      op.need = null;
      op.building = p.building;
    }
    v.pendingDestination = p.destination;
    v.order = { type: 'reroute', receivedAt: w.now, acceptedAt: w.now, version: p.orderVersion };
    w.record('reroute_received', { destination: p.destination, accepted: true }, v.id);
    if (!v.edge) {
      v.state = 'en_route';
      w.schedule(w.now, 'vehicle_enter', { vehicle: v.id }, 3, `reroute-${v.id}-${w.now}`);
    }
  };
  w.onAction('cancel', (a, p) => {
    command(a);
    const op = operation(w, p.id);
    check(op, 'NOT_FOUND', 'Operation not found');
    requireOwner(a, op.org);
    check(!terminal(op), 'STATE', 'Operation ended');
    op.state = 'cancel_requested';
    op.cancelRequestedAt = w.now;
    w.send({ kind: 'cancel', vehicle: op.vehicle, operation: op.id }, a.org, {
      sector: w.sectorForNode(w.vehicle(op.vehicle).node),
      target: op.vehicle,
    });
    w.record('cancellation_requested', { id: op.id });
    return clone(op);
  });
  w.cancelVehicle = (v, p) => {
    const op = operation(w, p.operation ?? v.operation);
    if (!op || terminal(op)) return;
    if (op.type === 'evacuation') {
      check(!v.passengers, 'PASSENGERS', 'Occupied evacuation requires a safe reroute');
      const t = w.state.evacuations.find((t) => t.id === op.evacuation);
      w.building(t.to).reservedPlaces -= t.quantity;
      w.need(t.need).inTransit -= t.quantity;
      t.state = 'cancelled';
    }
    if (op.type === 'inspection') {
      const i = w.state.inspections.find((i) => i.operation === op.id);
      i.state = 'timeout';
      w.releaseStaff(i.staff);
    }
    if (op.type === 'repair') {
      const t = w.state.repairs.find((t) => t.operation === op.id);
      t.state = 'cancelled';
      w.releaseStaff(t.staff);
    }
    const c = w.state.commitments.find((c) => c.id === op.commitment);
    if (c && ['reserved', 'confirmed'].includes(c.state)) {
      release(w.resource(c.resource), c.quantity);
      c.state = 'released';
    }
    if (v.load) {
      op.type = 'recovery';
      op.destination = w.resource(op.resource).node;
      op.need = null;
      op.building = null;
      op.state = 'returning';
      v.pendingDestination = op.destination;
      v.state = 'en_route';
      if (!v.edge)
        w.schedule(w.now, 'vehicle_enter', { vehicle: v.id }, 3, `return-${v.id}-${w.now}`);
    } else {
      op.state = 'cancelled';
      op.cancelledAt = w.now;
      v.pendingCancel = !!v.edge;
      if (!v.edge) {
        v.state = 'idle';
        v.operation = null;
      }
    }
    w.record('cancel_received', { operation: op.id, cargo: v.load }, v.id);
  };
}
