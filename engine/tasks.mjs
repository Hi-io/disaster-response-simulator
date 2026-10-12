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
  w.allocateStaff = (org, quantity, task, resourceId = `r-${org}-staff`) => {
    const r = w.resource(resourceId);
    check(r?.owner === org && r.type === 'staff', 'STAFF', 'Only owned staff may be assigned');
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
  // Local work queues are FIFO for requests at the same physical timestamp.
  // Generic event keys are lexically ordered: inspection-10 must not jump
  // ahead of inspection-8 merely because its decimal ID has another digit.
  // Retries retain the original request order; exogenous event ordering stays
  // unchanged. The fallback keeps earlier checkpoints' inspection IDs usable.
  const fieldPrepareKey = (i) =>
    `field-prepare-${String(i.queueSequence ?? Number(i.id.slice('inspection-'.length))).padStart(16, '0')}`;
  const delegationCurrent = (i) => !i.requestProposal || w.state.proposals.some(p =>
    p.id === i.requestProposal && p.org === i.reportTo && p.state === 'authorized' && !p.requiresReview &&
    p.plan?.actions?.[i.requestStep]?.type === 'verify' && p.plan.actions[i.requestStep].owner === i.org &&
    p.plan.actions[i.requestStep].params?.id === i.entity &&
    p.plan.actions[i.requestStep].params.targetVersion === i.targetVersion);
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
    const method = p.method ?? 'field';
    const purpose = p.purpose ?? (p.target === 'building' && method === 'field' ? 'facility_safety' : 'observation');
    check(['facility_safety', 'observation'].includes(purpose), 'PURPOSE', 'Unknown assessment purpose');
    check(purpose !== 'facility_safety' || p.target === 'building' && method === 'field',
      'ASSESSMENT_METHOD', 'A facility safety assessment requires a physical field visit');
    const validForMs = p.validForMs ?? 6 * 3600000;
    check(Number.isSafeInteger(validForMs) && validForMs >= 1000 && validForMs <= 86400000,
      'ASSESSMENT_TTL', 'Assessment validity must be between one second and one day');
    if (p.targetVersion !== undefined)
      check(Number.isSafeInteger(p.targetVersion) && p.targetVersion >= 0, 'VERSION', 'Invalid target version');
    if (p.staff) check(w.resource(p.staff)?.owner === a.org && w.resource(p.staff).type === 'staff',
      'ASSESSMENT_OWNER', 'The assessor must own its assigned staff', 403);
    if (p.vehicle) check(w.vehicle(p.vehicle)?.owner === a.org, 'ASSESSMENT_OWNER',
      'The assessor must own its crew vehicle', 403);
    if (p.reportTo && p.reportTo !== a.org) {
      command(a);
      check(purpose === 'facility_safety', 'ASSESSMENT_METHOD', 'Delegated safety requires a field assessment');
      const request = w.state.proposals.find(x => x.id === p.requestProposal),
        assigned = request?.plan?.actions?.[p.requestStep],
        approval = w.state.proposals.find(x => x.id === p.proposal),
        own = approval?.plan?.actions?.[p.step];
      const matches = (step) => step?.type === 'verify' && step.owner === a.org &&
        step.params?.target === p.target && step.params.id === p.id && step.params.method === method &&
        step.params.purpose === purpose && step.params.reportTo === p.reportTo &&
        step.params.targetVersion === p.targetVersion && step.params.validForMs === p.validForMs &&
        step.params.staff === p.staff && step.params.vehicle === p.vehicle;
      check(w.organization(p.reportTo) && request?.org === p.reportTo && request.state === 'authorized' &&
        !request.requiresReview && matches(assigned) && approval?.org === a.org &&
        approval.state === 'authorized' && !approval.requiresReview && matches(own),
        'ASSESSMENT_APPROVAL', 'Both owners must approve the exact delegated field assessment', 403);
      const prior = w.state.inspections.find(x => x.requestProposal === p.requestProposal && x.requestStep === p.requestStep);
      if (prior) return clone(prior); // Retries cannot assign a second crew to the same approved request.
    }
    const i = {
      id: w.nextId('inspection'),
      queueSequence: w.state.counters.inspection,
      org: a.org,
      target: p.target,
      entity: p.id,
      method,
      purpose,
      validForMs,
      targetVersion: p.targetVersion,
      reportTo: p.reportTo ?? a.org,
      requestProposal: p.requestProposal,
      requestStep: p.requestStep,
      authorizedBy: a.id,
      staffResource: p.staff ?? `r-${a.org}-staff`,
      requestedVehicle: p.vehicle,
      state: 'queued',
      createdAt: w.now,
    };
    check(targetNode(i), 'NOT_FOUND', 'Target location is not available');
    w.state.inspections.push(i);
    w.schedule(w.now, 'field_prepare', { inspection: i.id }, 4, fieldPrepareKey(i));
    return clone(i);
  });
  w.on('field_prepare', ({ inspection: id }) => {
    const i = w.state.inspections.find((x) => x.id === id);
    if (!i || i.state !== 'queued') return;
    if (!delegationCurrent(i)) {
      i.state = 'inconclusive'; i.failure = 'requester_authorization_changed';
      w.record('verification_inconclusive', { inspection: id, reason: i.failure }); return;
    }
    const org = w.organization(i.org),
      v = i.requestedVehicle ? w.state.vehicles.find(v => v.id === i.requestedVehicle && v.owner === i.org &&
        !v.background && v.state === 'idle' && !v.load && !v.passengers) : idleVehicle(i.org),
      r = w.resource(i.staffResource);
    if (w.now >= w.config.durationMs) {
      i.state = 'timeout';
      return;
    }
    if (i.purpose === 'facility_safety' && !r?.qualifications?.includes('field_assessment')) {
      i.state = 'inconclusive';
      i.failure = 'qualified_field_assessor_unavailable';
      w.record('verification_inconclusive', { inspection: id, reason: i.failure });
      return;
    }
    if (i.method !== 'clarification' && (!v || available(r) < 1)) {
      w.schedule(
        w.now + 30000,
        'field_prepare',
        { inspection: id },
        4,
        fieldPrepareKey(i),
      );
      return;
    }
    if (i.method === 'clarification') {
      const workers = Math.max(1, Math.floor(w.config.clarificationWorkers ?? 1));
      org.clarificationAvailableAt ??= Array(workers).fill(0);
      const slot = org.clarificationAvailableAt.indexOf(Math.min(...org.clarificationAvailableAt));
      const start = Math.max(w.now, org.clarificationAvailableAt[slot]);
      org.clarificationAvailableAt[slot] = start + w.config.inspectionMs;
      i.state = 'clarification_pending';
      w.schedule(org.clarificationAvailableAt[slot], 'field_observe', { inspection: id }, 4, id);
      return;
    }
    const path = route(w.state.map, v.node, targetNode(i), v, w.state.observations[i.org].edges);
    if (!path) {
      i.state = 'inconclusive';
      i.failure = 'no_known_access';
      w.record('verification_inconclusive', { inspection: id, reason: i.failure });
      return;
    }
    i.staff = w.allocateStaff(i.org, 1, id, i.staffResource);
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
    const observed = delegationCurrent(i) && (
      i.method !== 'clarification' ||
      w.random('verification', id, 'reply') < w.config.observationRate);
    if (observed && i.target === 'building') {
      const b = w.building(i.entity);
      result = {
        id: b.id,
        node: b.node,
        use: b.use,
        ...(i.purpose === 'facility_safety' ? { safe: b.damage < 2 } : {}),
        state: b.state,
        damage: b.damage,
        capacity: b.capacity,
        dependencies: clone(b.dependencies),
        provisioned: clone(b.provisioned),
        requiredPower: clone(b.requiredPower),
        requiredStaffSkills: clone(b.requiredStaffSkills ?? []),
        version: b.version,
      };
      if (i.purpose === 'facility_safety') result.assessment = {
        purpose: 'facility_safety', method: 'field', competent: true,
        inspectorOrg: i.org, staffResource: i.staffResource, qualifications: clone(w.resource(i.staffResource).qualifications),
        vehicle: i.vehicle, operation: i.operation, observedAt: w.now,
        targetVersion: b.version, validUntil: w.now + i.validForMs,
      };
      for (const n of w.state.needs.filter((n) => n.building === b.id))
        w.send({ kind: 'need_observation', need: clone(n), observedAt: w.now }, i.org, {
          sector,
          channel: i.method === 'radio' ? 'radio' : 'internet',
        });
      for (const c of w.healthForSector(sector)) w.advancePopulation(c, w.now);
      w.send({ kind: 'population_observation', snapshot: w.populationSnapshot(sector) }, i.org, {
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
      for (const c of w.healthForSector(sector)) w.advancePopulation(c, w.now);
      w.send({ kind: 'population_observation', snapshot: w.populationSnapshot(sector) }, i.org, {
        sector,
        channel: i.method === 'radio' ? 'radio' : 'internet',
      });
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
        qualifications: clone(r.qualifications ?? []),
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
      w.reportVehicle(v);
    }
    w.send({ kind: 'verification', inspection: id, result, observedAt: w.now }, i.org, {
      sector,
      channel: i.method === 'radio' ? 'radio' : 'internet',
    });
    if (i.reportTo !== i.org)
      w.send({ kind: 'verification', inspection: id, result, observedAt: w.now, recipient: i.reportTo }, i.reportTo, {
        sector, ttlMs: i.validForMs,
      });
  });
  w.completeVerification = (p) => {
    const source = w.state.inspections.find((x) => x.id === p.inspection);
    if (!source) return;
    let i = source;
    if (p.recipient && p.recipient !== source.org) {
      if (p.recipient !== source.reportTo || !w.state.observations[p.recipient]) return;
      const id = `received:${p.recipient}:${source.id}`;
      i = w.state.inspections.find(x => x.id === id);
      if (!i) {
        i = { ...clone(source), id, org: p.recipient, sourceOwner: source.org, sourceId: source.id };
        w.state.inspections.push(i);
      }
    }
    i.state = p.result ? 'completed' : 'inconclusive';
    i.result = clone(p.result);
    i.completedAt = w.now;
    i.confirmedBySource = true;
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
        const assessment = result.assessment;
        if (result.safe && result.version === b.version && i.method === 'field' &&
          i.purpose === 'facility_safety' && assessment?.competent === true &&
          assessment.qualifications?.includes('field_assessment') && assessment.validUntil > w.now &&
          (i.targetVersion === undefined || i.targetVersion === result.version)) {
          b.assessed = true;
          b.assessedAt = p.observedAt;
          b.assessedVersion = b.version;
          b.assessedValidUntil = assessment.validUntil;
          b.assessedBy = assessment.inspectorOrg;
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
      const repaired = e.crossing
        ? w.state.map.edges.filter((other) => other.crossing === e.crossing)
        : [e];
      for (const other of repaired) {
        other.open = true;
        other.version++;
        w.reportRoad(other, t.org);
      }
      w.record('repair_completed', { edge: e.id }, id);
    }
    w.releaseStaff(t.staff);
    const op = operation(w, t.operation);
    op.state = t.state;
    const v = w.vehicle(op.vehicle);
    v.state = 'idle';
    v.operation = null;
    w.reportVehicle(v);
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
      quantity: task.quantity,
      need: task.need,
      building: task.to,
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
      v.operation = null;
      w.reportVehicle(v);
      return;
    }
    task.health = w.takePopulationGroup(cohort, task.quantity);
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
    w.integrateFacility?.(to);
    to.occupancy += v.passengers;
    n.inTransit -= t.quantity;
    const original = w.state.cohorts.find((c) => c.id === t.cohort);
    original.inTransit -= v.passengers;
    original.moved += v.passengers;
    w.state.cohorts.push({
      id: `relocated-${t.id}`,
      node: to.node,
      sector: to.sector,
      population: v.passengers,
      deceased: 0,
      health: { ...clone(t.health), unsheltered: false, integratedAt: w.now },
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
    w.reportVehicle(v);
    w.reportOperation(op);
    w.record('evacuation_completed', { quantity: t.quantity, to: to.id }, t.id);
    w.reportFacility?.(to);
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
      w.reportVehicle(v);
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
    if (op.type === 'evacuation' && op.phase === 'pickup') {
      check(!b && !n && p.destination === op.destination, 'DESTINATION', 'A pickup reroute must preserve the assigned pickup and shelter');
    } else if (op.type === 'evacuation') {
      const task = w.state.evacuations.find(t => t.id === op.evacuation), ownReservation = task?.to === b?.id ? task.quantity : 0;
      check(
        b?.state === 'operating' && b.capacity - b.occupancy - b.reservedPlaces + ownReservation >= v.passengers,
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
    return { id: op.id, operation: op.id, state: 'instruction_pending', vehicle: v.id, orderVersion };
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
      if (v.passengers) {
        op.state = 'dispatched';
        op.cancelRejectedAt = w.now;
        w.record(
          'cancellation_rejected',
          { reason: 'occupied_evacuation_requires_safe_reroute' },
          op.id,
        );
        w.reportOperation(op);
        return;
      }
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
    if (op.unloadingSlot) {
      w.building(op.building).unloading--;
      op.unloadingSlot = false;
    }
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
        w.reportVehicle(v);
      }
    }
    w.record('cancel_received', { operation: op.id, cargo: v.load }, v.id);
  };
}
