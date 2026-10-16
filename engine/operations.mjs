import {
  SimError,
  requireCondition as check,
  requireRole,
  requireOwner,
} from '../contracts/actions.mjs';
import { acceptsVehicleReceipt } from './received-vehicle.mjs';
import {
  available,
  reserve,
  release,
  load,
  transition,
  COMMITMENT_STATES,
  createResource,
} from './ledger.mjs';
import { clone } from './determinism.mjs';
import { staffSnapshot, receiveStaff, consumeStaff, staffReservation, checkStaffSelection, sameStaffSelection } from './staff.mjs';
import { CARGO_PROFILES, checkVehicleCargo } from '../contracts/cargo.mjs';
import { supplyMetadata } from './supplies.mjs';
import { route } from '../generators/map.mjs';

const positive = (q) =>
  check(Number.isSafeInteger(q) && q > 0, 'QUANTITY', 'Quantity must be a positive integer');
const commandRoles = ['commander', 'dispatcher'];
const writable = (w, a, id) => {
  const r = w.resource(id);
  check(r, 'NOT_FOUND', 'Resource not found', 404);
  requireOwner(a, r.owner);
  return r;
};
export function installActions(w) {
  const known = (a) => w.state.observations[a.org];
  const accessiblePost = (id, org) => w.sourceVisible(w.post(id), org);
  w.onAction('record_claim', (a, p) => {
    check(typeof p.text === 'string' && p.text.length < 20000, 'TEXT', 'Provide text');
    for (const id of p.references ?? [])
      check(accessiblePost(id, a.org), 'SOURCE', 'Source not accessible');
    const record = {
      id: w.nextId('claim'),
      org: a.org,
      text: p.text,
      references: p.references ?? [],
      state: 'observed',
      at: w.now,
      version: 1,
    };
    w.state.claims.push(record);
    return clone(record);
  });
  w.onAction('relate_reports', (a, p) => {
    const claim = w.state.claims.find((x) => x.id === p.claim && x.org === a.org);
    check(claim, 'NOT_FOUND', 'Claim not found');
    check(Array.isArray(p.references), 'REFERENCES', 'References required');
    for (const id of p.references)
      check(accessiblePost(id, a.org), 'SOURCE', 'Source not accessible');
    const relation = p.relation ?? 'same_incident';
    check(
      ['same_incident', 'independent', 'contradiction', 'separate'].includes(relation),
      'RELATION',
      'Unknown report relationship',
    );
    claim.references = [...new Set([...claim.references, ...p.references])];
    claim.relation = relation;
    claim.version++;
    return clone(claim);
  });
  w.onAction('flag_report', (a, p) => {
    check(accessiblePost(p.post, a.org), 'SOURCE', 'Source not accessible');
    check(
      ['suspected', 'old', 'contradicted', 'unverified', 'confirmed'].includes(p.state),
      'STATE',
      'Invalid evidence state',
    );
    const claim = {
      id: w.nextId('claim'),
      org: a.org,
      text: p.reason ?? '',
      references: [p.post],
      state: p.state,
      at: w.now,
      version: 1,
    };
    w.state.claims.push(claim);
    return clone(claim);
  });
  w.onAction('query', (a, p) => {
    check(!w.state.toolFault, 'TOOL_UNAVAILABLE', 'Tool dependency is unavailable', 503);
    const minute = Math.floor(w.now / 60000),
      key = `${a.org}-${minute}`,
      count = w.state.toolQuota[key] ?? 0;
    check(count < w.config.toolQuota, 'RATE_LIMIT', 'Tool quota exhausted', 429);
    w.state.toolQuota[key] = count + 1;
    w.state.queryCount++;
    w.state.toolCost += 1;
    check(
      [
        'inventory',
        'vehicles',
        'roads',
        'documents',
        'facility',
        'policy',
        'sources',
        'capabilities',
        'map',
        'finance',
      ].includes(p.target),
      'TARGET',
      'Unknown query target',
    );
    let result;
    if (p.target === 'inventory')
      result = w.state.resources
        .filter(
          (r) => r.owner === a.org || (r.public && w.organization(r.owner)?.sharing === 'public'),
        )
        .map((r) => ({
          ...w.resourceView(r),
          id: r.id,
          owner: r.owner,
          node: r.node,
          type: r.type,
          quantity: r.quantity,
          reserved: r.reserved,
          floor: r.floor,
          compatibility: r.compatibility,
          ...staffSnapshot(r),
          version: r.version,
          observedAt: w.now,
        }));
    if (p.target === 'vehicles')
      result = w.state.vehicles
        .filter(
          (v) =>
            !v.background && (v.owner === a.org || w.organization(v.owner)?.sharing === 'public'),
        )
        .map((v) => clone(w.state.observations[v.owner].vehicles[v.id]));
    if (p.target === 'roads') result = clone(known(a).edges);
    if (p.target === 'facility') result = clone(known(a).buildings[p.id] ?? null);
    if (p.target === 'policy') result = {
      ...clone(w.organization(a.org).policy),
      version: w.organization(a.org).version,
      observedAt: w.now,
      execution: {
        cargo:{version:1,types:clone(CARGO_PROFILES)},
        reservation: { defaultTtlMs: 900000, maxTtlMs: 86400000 },
        fieldAssessment:{inspectionMs:w.config.inspectionMs,commandNominalLatencyMs:w.config.networkLatencyMs+Math.ceil(1000/w.config.bandwidthBytesPerSecond*1000)},
        service:{setupMs:w.config.setupMs},
        repair:{workMs:2*w.config.setupMs},
        delivery: {
          loadMs: w.config.loadMs,
          unloadMs: w.config.unloadMs,
          // Nominal command transport is a received contract, not a promise
          // that outages or congestion cannot delay the real order.
          commandNominalLatencyMs: w.config.networkLatencyMs +
            Math.ceil(1000 / w.config.bandwidthBytesPerSecond * 1000),
        },
      },
    };
    if (p.target === 'sources') result = w.publicFeed(p).posts;
    if (p.target === 'finance') {
      check(p.org === undefined || p.org === a.org, 'FORBIDDEN', 'Finance is private to its owner', 403);
      result = w.financeView(a.org);
    }
    if (p.target === 'documents')
      result = [
        {
          id: 'operations-catalogue',
          version: 1,
          format: 'text',
          text: 'Water is measured in litres. A venue needs assessment, permission, water, sanitation, staff and energy before opening.',
        },
        {
          id: 'power-catalogue',
          version: 1,
          format: 'csv',
          text: 'equipment,voltage,connector,power_kW\npump,230,A,10\ngenerator,230,A,12\nlegacy_generator,120,B,8',
        },
        {
          id: 'place-aliases',
          version: 1,
          format: 'table',
          text: 'Location names may repeat. Confirm the road node and organization jurisdiction before converting drum counts into litres.',
        },
      ];
    if (p.target === 'capabilities') {
      const org = w.organization(p.org);
      check(org, 'NOT_FOUND', 'Unknown partner');
      result = {
        org: org.id,
        name: org.name,
        sharing: org.sharing,
        capabilities: w.state.resources
          .filter((r) => r.owner === org.id && r.public)
          .map((r) => ({
            id: r.id,
            type: r.type,
            ...(org.sharing === 'public' || org.id === a.org
              ? { available: available(r), node: r.node, compatibility: r.compatibility,
                ...supplyMetadata(r) }
              : { availability: 'requires_owner_confirmation' }),
          })),
      };
    }
    if (p.target === 'map')
      result = {
        nodes: w.state.map.nodes.map((n) => ({ ...n })),
        roads: w.state.map.edges.map((e) => ({
          id: e.id,
          ...(typeof e.name === 'string' ? { name: e.name } : {}),
          ...(Array.isArray(e.aliases) ? { aliases: e.aliases.filter(x => typeof x === 'string') } : {}),
          from: e.from,
          to: e.to,
          lengthM: e.lengthM,
          speedMps: e.speedMps,
          maxWeight: e.maxWeight,
        })),
        places: w.state.map.buildings.map((b) => ({
          id: b.id,
          ...(typeof b.name === 'string' ? { name: b.name } : {}),
          node: b.node,
          x: b.x,
          z: b.z,
          use: b.use,
          sector: b.sector,
        })),
        sectors: w.state.map.sectors.map(s=>({id:s.id,node:s.node,...(typeof s.name==='string'?{name:s.name}:{}),...(s.jurisdiction?{jurisdiction:s.jurisdiction}:{})})),
      };
    const id = w.nextId('query');
    w.state.queries ??= [];
    const q = {
      id,
      org: a.org,
      target: p.target,
      state: 'pending',
      createdAt: w.now,
      readyAt: w.now + w.config.queryLatencyMs,
    };
    w.state.queries.push(q);
    w.schedule(q.readyAt, 'query_result', { id, result }, 2, `query-${id}`);
    return clone(q);
  });
  w.on('query_result', ({ id, result }) => {
    const q = w.state.queries.find((x) => x.id === id);
    if (!q) return;
    w.send({ kind: 'query_result', id, result, observedAt: q.createdAt }, q.org, {
      sector: w.sectorForNode(w.organization(q.org).node),
    });
  });
  w.completeQuery = ({ id, result, observedAt }) => {
    const q = w.state.queries.find((x) => x.id === id);
    if (!q) return;
    q.state = 'ready';
    q.result = result;
    q.completedAt = w.now;
    if (q.target === 'inventory')
      for (const r of result) {
        const old = w.state.observations[q.org].resources[r.id];
        if (!old || r.version >= old.version)
          w.state.observations[q.org].resources[r.id] = { ...r, at: observedAt };
      }
    if (q.target === 'vehicles')
      for (const v of result) {
        const old = w.state.observations[q.org].vehicles[v.id];
        if (acceptsVehicleReceipt(old,v)) w.state.observations[q.org].vehicles[v.id] = v;
      }
    if (q.target === 'finance') w.receiveFinance(q.org, result);
    w.record('query_completed', { id, org: q.org, target: q.target });
  };
  w.onAction('capabilities', (a, p) => {
    return w.actionHandlers.get('query')(a, { target: 'capabilities', org: p.org });
  });
  w.onAction('verify', (a, p) => {
    check(
      ['building', 'need', 'road', 'resource'].includes(p.target),
      'TARGET',
      'Invalid verification',
    );
    const id = w.nextId('inspection'),
      org = w.organization(a.org);
    const start = Math.max(w.now, org.inspectionAvailableAt ?? 0);
    org.inspectionAvailableAt = start + w.config.inspectionMs;
    const inspect = {
      id,
      org: a.org,
      target: p.target,
      entity: p.id,
      state: 'pending',
      createdAt: w.now,
      scheduledAt: start,
      method: p.method ?? 'field',
    };
    w.state.inspections.push(inspect);
    w.schedule(start + w.config.inspectionMs, 'inspect', { id }, 2, `inspect-${id}`);
    return clone(inspect);
  });
  w.on('inspect', ({ id }) => {
    const i = w.state.inspections.find((x) => x.id === id);
    if (!i) return;
    let result = null,
      sector = null;
    if (i.target === 'building') {
      const b = w.building(i.entity);
      if (b) {
        sector = b.sector;
        result = {
          id: b.id,
          node: b.node,
          use: b.use,
          safe: b.damage < 2,
          state: b.state,
          capacity: b.capacity,
          dependencies: clone(b.dependencies),
          provisioned: clone(b.provisioned),
          damage: b.damage,
        };
      }
    }
    if (i.target === 'need') {
      const n = w.need(i.entity);
      if (n) {
        sector = w.building(n.building).sector;
        result = {
          id: n.id,
          building: n.building,
          type: n.type,
          quantity: n.quantity,
          served: n.served,
          deadline: n.deadline,
          population: n.population,
          unit: n.unit,
        };
      }
    }
    if (i.target === 'road') {
      const e = w.edge(i.entity);
      if (e) {
        sector = w.sectorForNode(e.from);
        result = { id: e.id, open: e.open, waterDepth: e.waterDepth, version: e.version };
      }
    }
    if (i.target === 'resource') {
      const r = w.resource(i.entity);
      if (r && (r.owner === i.org || r.public)) {
        sector = w.sectorForNode(r.node);
        result = {
          id: r.id,
          type: r.type,
          quantity: r.quantity,
          reserved: r.reserved,
          available: available(r),
          compatibility: r.compatibility,
          version: r.version,
        };
      }
    }
    i.state = 'report_pending';
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
    if (p.result && i.target === 'building') {
      const b = w.building(i.entity);
      b.assessed = true;
      b.assessedAt = p.observedAt;
      w.state.observations[i.org].buildings[b.id] = { ...p.result, at: p.observedAt };
    }
    if (p.result && i.target === 'need')
      w.state.observations[i.org].needs[i.entity] = { ...p.result, at: p.observedAt };
    if (p.result && i.target === 'road')
      w.state.observations[i.org].edges[i.entity] = { ...p.result, at: p.observedAt };
    if (p.result && i.target === 'resource')
      w.state.observations[i.org].resources[i.entity] = { ...p.result, at: p.observedAt };
    w.record('verification_completed', {
      inspection: i.id,
      org: i.org,
      target: i.target,
      entity: i.entity,
      inconclusive: !p.result,
    });
  };
  w.onAction('propose', (a, p) => {
    check(typeof p.title === 'string', 'TITLE', 'Proposal title required');
    const proposal = {
      id: w.nextId('proposal'),
      org: a.org,
      title: p.title,
      plan: clone(p.plan ?? {}),
      conditions: clone(p.conditions ?? []),
      references: clone(p.references ?? []),
      state: 'awaiting_approval',
      createdAt: w.now,
      version: 1,
    };
    w.state.proposals.push(proposal);
    return clone(proposal);
  });
  w.onAction('review', (a, p) => {
    requireRole(a, commandRoles);
    const proposal = w.state.proposals.find((x) => x.id === p.id);
    check(proposal, 'NOT_FOUND', 'Proposal not found');
    requireOwner(a, proposal.org);
    check(
      ['approve', 'reject', 'clarify', 'modify'].includes(p.decision),
      'DECISION',
      'Invalid review decision',
    );
    const org = w.organization(a.org),
      slot = org.reviewSlots.indexOf(Math.min(...org.reviewSlots)),
      start = Math.max(w.now, org.reviewSlots[slot]);
    org.reviewSlots[slot] = start + w.config.reviewMs;
    w.schedule(
      org.reviewSlots[slot],
      'review_completed',
      {
        id: proposal.id,
        decision: p.decision,
        modifiedPlan: p.plan ?? null,
        actor: a.id,
        org: a.org,
      },
      4,
      `review-${proposal.id}`,
    );
    return { state: 'queued', readyAt: org.reviewSlots[slot], id: proposal.id };
  });
  w.on('review_completed', (p) => {
    const proposal = w.state.proposals.find((x) => x.id === p.id);
    if (!proposal) return;
    proposal.state =
      p.decision === 'approve' || p.decision === 'modify'
        ? 'authorized'
        : p.decision === 'reject'
          ? 'rejected'
          : 'needs_clarification';
    if (p.modifiedPlan) proposal.plan = p.modifiedPlan;
    proposal.authorizedBy = p.actor;
    proposal.reviewedAt = w.now;
    proposal.version++;
    w.record('review_completed', {
      org: p.org,
      proposal: p.id,
      decision: p.decision,
      reviewMs: w.config.reviewMs,
    });
  });
  w.onAction('commitment', (a, p, request) => {
    requireRole(a, commandRoles);
    if (p.action === 'offer' || (p.action === 'reserve' && !p.id)) {
      const r = writable(w, a, p.resource);
      positive(p.quantity);
      if (request.expectedVersion !== undefined)
        check(r.version === request.expectedVersion, 'VERSION_CONFLICT', 'Resource changed', 409);
      const c = {
        id: w.nextId('commitment'),
        owner: r.owner,
        requester: p.requester ?? a.org,
        resource: r.id,
        quantity: p.quantity,
        state: p.action === 'offer' ? 'offered' : 'reserved',
        expiresAt: w.now + (p.ttlMs ?? 900000),
        conditions: clone(p.conditions ?? []),
        createdAt: w.now,
        version: 1,
        authorizedBy: a.id,
      };
      check(w.organization(c.requester), 'REQUESTER', 'Unknown requester');
      check(c.expiresAt > w.now && c.expiresAt <= w.now + 86400000, 'EXPIRY', 'Invalid expiry');
      if (c.state === 'reserved') {
        try {
          c.staffReservation = reserve(r, c.quantity);
        } catch (e) {
          w.record('reservation_conflict', { resource: r.id, quantity: c.quantity });
          throw e;
        }
      }
      w.state.commitments.push(c);
      w.schedule(c.expiresAt, 'expire_commitment', { id: c.id }, 1, `expiry-${c.id}`);
      return clone(c);
    }
    const c = w.state.commitments.find((x) => x.id === p.id);
    check(c, 'NOT_FOUND', 'Commitment not found');
    requireOwner(a, c.owner);
    const r = w.resource(c.resource);
    if (p.action === 'reserve') {
      c.staffReservation = reserve(r, c.quantity);
      transition(c, 'reserved', COMMITMENT_STATES);
    } else if (p.action === 'confirm') {
      check(c.expiresAt > w.now, 'EXPIRED', 'Offer expired');
      for (const condition of c.conditions)
        check(condition.confirmed === true, 'CONDITION', 'Unconfirmed condition');
      transition(c, 'confirmed', COMMITMENT_STATES);
    } else if (['release', 'withdraw'].includes(p.action)) {
      const previous = c.state;
      transition(c, p.action === 'release' ? 'released' : 'withdrawn', COMMITMENT_STATES);
      if (['reserved', 'confirmed'].includes(previous)) release(r, c.quantity, c.staffReservation);
      w.record('commitment_withdrawn', { id: c.id, resource: r.id });
      for (const op of w.state.operations.filter(
        (x) => x.commitment === c.id && !['completed', 'cancelled', 'failed'].includes(x.state),
      )) {
        op.requiresRepair = true;
      }
    } else throw new SimError('COMMITMENT_ACTION', 'Invalid commitment action');
    return clone(c);
  });
  w.on('expire_commitment', ({ id }) => {
    const c = w.state.commitments.find((x) => x.id === id);
    if (!c || !['offered', 'reserved', 'confirmed'].includes(c.state)) return;
    const previous = c.state;
    c.state = 'expired';
    c.version++;
    if (['reserved', 'confirmed'].includes(previous)) release(w.resource(c.resource), c.quantity, c.staffReservation);
    w.observeResource(c.owner,w.resource(c.resource));
    w.record('commitment_expired', { id });
  });
  w.onAction('dispatch', (a, p) => {
    requireRole(a, commandRoles);
    if (p.ttlMs !== undefined)
      check(Number.isSafeInteger(p.ttlMs) && p.ttlMs > 0 && p.ttlMs <= 86400000,
        'EXPIRY', 'Dispatch reservation validity must be positive and at most 24 hours');
    const v = w.vehicle(p.vehicle),
      n = w.need(p.need),
      r = w.resource(p.resource);
    check(v && r, 'NOT_FOUND', 'Vehicle or resource not found');
    requireOwner(a, v.owner);
    requireOwner(a, r.owner);
    check(['idle', 'arrived'].includes(v.state) && !v.load, 'VEHICLE_BUSY', 'Vehicle unavailable');
    positive(p.quantity);
    checkVehicleCargo(v,r.type,p.quantity);
    const destination = p.destination ?? (n ? w.building(n.building).node : null);
    check(w.node(destination), 'DESTINATION', 'Destination required');
    check(
      route(w.state.map, v.node, r.node, v, known(a).edges),
      'LOCATION',
      'No known route to pickup',
    );
    check(route(w.state.map, r.node, destination,
      { ...v, load: p.quantity, resourceType: r.type }, known(a).edges),
      'ROUTE', 'No known route supports the actual loaded cargo');
    check(
      r.type === (n?.type ?? p.type ?? r.type),
      'RESOURCE_TYPE',
      'Resource does not meet this need',
    );
    let c;
    if (p.commitment) {
      c = w.state.commitments.find((x) => x.id === p.commitment);
      check(
        c && c.resource === r.id && c.state === 'confirmed' && c.quantity >= p.quantity,
        'COMMITMENT',
        'Confirmed commitment required',
      );
      check(
        c.owner === a.org && c.requester === a.org,
        'AUTHORIZATION',
        'Commitment owner/requester must authorize dispatch',
      );
      check(
        c.quantity === p.quantity,
        'PARTIAL_RESERVATION',
        'Split the commitment before partial dispatch',
      );
      check(p.staffSkills === undefined || r.type === 'staff' && sameStaffSelection(p.staffSkills, c.staffSkills),
        'STAFF_SCOPE', 'Dispatch cannot replace an existing owner-approved staff selection');
      const selected = staffReservation(r, c.staffReservation);
      check(!c.staffSkills?.length || selected && c.staffSkills.every(s => selected.qualifications.includes(s)),
        'STAFF_QUALIFICATIONS', 'The exact reserved people must still carry every approved qualification');
    } else {
      checkStaffSelection(r, p.quantity, p.staffSkills);
      const staffReservation = reserve(r, p.quantity, p.staffSkills);
      c = {
        id: w.nextId('commitment'),
        owner: a.org,
        requester: a.org,
        resource: r.id,
        quantity: p.quantity,
        state: 'confirmed',
        expiresAt: w.now + (p.ttlMs ?? 900000),
        conditions: [],
        createdAt: w.now,
        version: 1,
        authorizedBy: a.id,
        staffReservation,
        ...(p.staffSkills === undefined ? {} : { staffSkills: [...p.staffSkills].sort() }),
      };
      w.state.commitments.push(c);
      w.schedule(c.expiresAt, 'expire_commitment', { id: c.id }, 1, c.id);
    }
    const op = {
      id: w.nextId('operation'),
      org: a.org,
      type: 'delivery',
      need: n?.id ?? null,
      building: p.building ?? n?.building ?? null,
      resource: r.id,
      resourceType: r.type,
      quantity: p.quantity,
      ...(c.staffSkills === undefined ? {} : { staffSkills: [...c.staffSkills] }),
      vehicle: v.id,
      destination,
      commitment: c.id,
      state: 'reserved',
      createdAt: w.now,
      version: 1,
      times: { authorized: w.now, reserved: w.now },
      received: 0,
    };
    w.state.operations.push(op);
    v.state = 'preparing';
    v.operation = op.id;
    w.send({ kind: 'command', operation: op.id }, a.org, {
      sector: w.sectorForNode(v.node),
      target: v.id,
    });
    return clone(op);
  });
  w.on('load', ({ operation: id }) => {
    const op = w.state.operations.find((o) => o.id === id);
    if (!op || ['cancelled', 'failed'].includes(op.state)) return;
    const c = w.state.commitments.find((x) => x.id === op.commitment),
      r = w.resource(op.resource),
      v = w.vehicle(op.vehicle);
    if (v.node !== r.node || v.edge) {
      if (['reserved','confirmed'].includes(c.state)) {
        release(r,c.quantity,c.staffReservation);c.state='released';c.version++;
      }
      op.state='failed';op.failure='pickup_wrong_location';op.times.failed=w.now;
      v.operation=null;
      if(v.edge)v.pendingCancel=true;else v.state='idle';
      const t=w.state.transfers?.find(t=>t.id===op.transfer);
      if(t){t.state='failed';t.failure=op.failure;}
      w.reportVehicle(v);w.reportOperation(op);
      return;
    }
    if (c.state !== 'confirmed') {
      op.state = 'failed';
      op.failure = 'commitment_invalid';
      op.times.failed = w.now;
      v.state = 'idle';
      v.operation = null;
      w.reportVehicle(v);
      w.reportOperation(op);
      return;
    }
    const staffCargo = load(r, op.quantity, c.staffReservation);
    transition(c, 'dispatched', COMMITMENT_STATES);
    v.load = op.quantity;
    v.resourceType = r.type;
    if (staffCargo) v.staffCargo = staffCargo;
    op.times.prepared = w.now;
    w.startTrip(v, op.destination, op);
  });
  w.on('unload', ({ operation: id }) => {
    const op = w.state.operations.find((o) => o.id === id);
    if (!op || op.state !== 'arrived') return;
    const v = w.vehicle(op.vehicle),
      b = op.building ? w.building(op.building) : null;
    if (b?.damage >= 3) {
      op.state = 'waiting_to_unload';
      w.record('unloading_blocked', { reason: 'unsafe_destination' }, op.id);
      w.reportOperation(op);
      return;
    }
    const owner = op.recipientOrg ?? (b && !op.need ? (b.ownerOrg ?? 'org0') : op.org);
    let stockId = `stock-${op.destination}-${op.resourceType}`;
    if (w.resource(stockId)?.owner && w.resource(stockId).owner !== owner) stockId += `-${owner}`;
    stockId = w.supplyStockId?.(stockId, op) ?? stockId;
    let destination = w.resource(stockId);
    if (!destination) {
      destination = createResource(stockId, owner, op.destination, op.resourceType, 0);
      w.state.resources.push(destination);
    }
    receiveStaff(destination, v.load, v.staffCargo);
    if(op.resourceType==='staff'&&op.staffCalendar)destination.staffCalendar=clone(op.staffCalendar);
    destination.quantity += v.load;
    destination.received += v.load;
    destination.version++;
    destination.compatibility = clone(w.resource(op.resource).compatibility);
    op.destinationStock = destination.id;
    op.received = v.load;
    if (v.staffCargo) op.receivedStaff = clone(v.staffCargo);
    op.times.received = w.now;
    op.state = 'received';
    v.load = 0;
    delete v.staffCargo;
    v.state = 'idle';
    v.operation = null;
    w.reportVehicle(v);
    const c = w.state.commitments.find((x) => x.id === op.commitment);
    transition(c, 'completed', COMMITMENT_STATES);
    if (b && !op.need) {
      b.provisioned[op.resourceType] = (b.provisioned[op.resourceType] ?? 0) + op.received;
    }
    w.record(
      'delivery_received',
      { quantity: op.received, type: op.resourceType, building: op.building },
      op.id,
    );
    w.generateSignal('P21', {
      building: op.building ?? w.state.map.shelterId,
      text: `The receiving team confirms ${op.received} ${destination.unit} of ${op.resourceType}.`,
      false: false,
      causeEvent: `receipt-${op.id}`,
    });
    if (op.need) {
      consumeStaff(destination, op.received);
      destination.quantity -= op.received;
      destination.consumed += op.received;
      w.serveNeed(op.need, op.received);
      op.state = 'completed';
      op.times.service = w.now;
      w.send(
        { kind: 'need_observation', need: clone(w.need(op.need)), observedAt: w.now },
        op.org,
        { sector: b?.sector },
      );
    } else op.state = 'completed';
    w.observeResource(op.org, w.resource(op.resource));
    if (destination.type === 'staff') w.reportResource(destination, owner);
    w.reportOperation(op);
  });
  w.onAction('transfer', (a, p) => {
    requireRole(a, commandRoles);
    const r = writable(w, a, p.resource);
    positive(p.quantity);
    check(p.quantity <= available(r), 'INSUFFICIENT_RESOURCE', 'Not available');
    check(w.organization(p.to), 'NOT_FOUND', 'Recipient not found');
    const transfer = {
      id: w.nextId('transfer'),
      from: a.org,
      to: p.to,
      resource: r.id,
      quantity: p.quantity,
      state: 'offered',
      createdAt: w.now,
    };
    w.state.transfers ??= [];
    w.state.transfers.push(transfer);
    return clone(transfer);
  });
  w.onAction('reroute', (a, p) => {
    requireRole(a, commandRoles);
    const v = w.vehicle(p.vehicle);
    check(v, 'NOT_FOUND', 'Vehicle not found');
    requireOwner(a, v.owner);
    check(w.node(p.destination), 'DESTINATION', 'Unknown destination');
    w.send({ kind: 'reroute', vehicle: v.id, destination: p.destination }, a.org, {
      sector: w.sectorForNode(v.node),
      target: v.id,
    });
    return { state: 'instruction_pending', vehicle: v.id };
  });
  w.onAction('repair', (a, p) => {
    requireRole(a, commandRoles);
    const e = w.edge(p.edge);
    check(e, 'NOT_FOUND', 'Road not found');
    const staff = w.resource(`r-${a.org}-staff`);
    check(available(staff) >= 2, 'STAFF', 'Repair team unavailable');
    const task = {
      id: w.nextId('repair'),
      org: a.org,
      edge: e.id,
      createdAt: w.now,
      state: 'working',
    };
    w.state.repairs ??= [];
    w.state.repairs.push(task);
    w.schedule(w.now + w.config.setupMs * 2, 'repair_completed', { id: task.id }, 0, task.id);
    return clone(task);
  });
  w.on('repair_completed', ({ id }) => {
    const task = w.state.repairs.find((x) => x.id === id);
    if (!task) return;
    task.state = 'completed';
    const e = w.edge(task.edge);
    e.open = true;
    e.waterDepth = 0;
    e.version++;
    w.record('repair_completed', { edge: e.id }, id);
    w.reportRoad(e, task.org);
  });
  w.onAction('activate', (a, p) => {
    requireRole(a, commandRoles);
    const b = w.building(p.building);
    check(b, 'NOT_FOUND', 'Facility not found');
    check(b.assessed && b.damage < 2, 'ASSESSMENT', 'Safe field assessment required');
    check(p.permit === true, 'PERMIT', 'Explicit permission required');
    for (const [type, amount] of Object.entries(b.dependencies))
      check((b.provisioned[type] ?? 0) >= amount, 'DEPENDENCY', `Missing ${type}`);
    check(
      !['operating', 'provisioning'].includes(b.state),
      'STATE',
      'Already operating or being provisioned',
    );
    b.state = 'provisioning';
    b.permission = { org: a.org, actor: a.id, at: w.now };
    w.schedule(
      w.now + w.config.setupMs,
      'facility_open',
      { building: b.id, org: a.org },
      4,
      `open-${b.id}`,
    );
    return { building: b.id, state: b.state, readyAt: w.now + w.config.setupMs };
  });
  w.on('facility_open', ({ building: id, org }) => {
    const b = w.building(id);
    if (!b || b.damage >= 2) {
      w.record('facility_activation_failed', { building: id });
      return;
    }
    b.state = 'operating';
    b.openAt = w.now;
    b.version++;
    w.record('facility_operating', { building: id, capacity: b.capacity });
    if (b.use === 'plant')
      w.schedule(w.now + 60000, 'produce', { building: id, org }, 4, `produce-${id}`);
  });
  w.on('produce', ({ building: id, org }) => {
    const b = w.building(id);
    if (b?.state !== 'operating' || b.damage >= 2) return;
    let r = w.resource(`production-${id}`);
    if (!r) {
      r = createResource(`production-${id}`, org, b.node, 'water', 0);
      w.state.resources.push(r);
    }
    const amount = Math.floor(b.capacity / 60);
    r.quantity += amount;
    r.produced += amount;
    r.version++;
    w.record('water_produced', { building: id, quantity: amount });
    if (w.withinHorizon(w.now + 60000))
      w.schedule(w.now + 60000, 'produce', { building: id, org }, 4, `produce-${id}-${w.now}`);
  });
  w.onAction('evacuate', (a, p) => {
    requireRole(a, commandRoles);
    const from = w.building(p.from),
      to = w.building(p.to),
      v = w.vehicle(p.vehicle);
    positive(p.quantity);
    check(from && to && v, 'NOT_FOUND', 'Evacuation entities not found');
    requireOwner(a, v.owner);
    check(
      v.state === 'idle' && to.state === 'operating',
      'STATE',
      'Vehicle and destination must be ready',
    );
    check(
      p.quantity <= to.capacity - to.occupancy && p.quantity <= v.capacity,
      'CAPACITY',
      'Insufficient shelter or transport capacity',
    );
    const trip = route(w.state.map, from.node, to.node, v, known(a).edges);
    check(trip, 'ROUTE', 'No known route');
    const id = w.nextId('evacuation');
    w.state.evacuations ??= [];
    const task = {
      id,
      org: a.org,
      from: from.id,
      to: to.id,
      quantity: p.quantity,
      state: 'authorized',
      createdAt: w.now,
    };
    w.state.evacuations.push(task);
    w.schedule(
      w.now + trip.freeTimeMs + w.config.loadMs + w.config.unloadMs,
      'evacuation_complete',
      { id },
      4,
      id,
    );
    return clone(task);
  });
  w.on('evacuation_complete', ({ id }) => {
    const t = w.state.evacuations.find((x) => x.id === id);
    const to = w.building(t.to);
    if (to.state !== 'operating' || to.damage >= 2 || to.occupancy + t.quantity > to.capacity) {
      t.state = 'failed';
      return;
    }
    t.state = 'completed';
    to.occupancy += t.quantity;
    const n = w.state.needs.find((n) => n.building === t.from && n.type === 'shelter');
    if (n) w.serveNeed(n.id, t.quantity);
    w.record('evacuation_completed', { quantity: t.quantity, to: t.to }, id);
  });
  w.onAction('purchase', (a, p) => {
    requireRole(a, commandRoles);
    positive(p.quantity);
    positive(p.price);
    check(
      ['water', 'food', 'blankets', 'energy', 'sanitation', 'staff'].includes(p.type),
      'TYPE',
      'Invalid supply',
    );
    const org = w.organization(a.org);
    check(org.funds >= p.quantity * p.price, 'FUNDS', 'Insufficient funds');
    w.state.vendorStock ??= {
      water: 10000,
      food: 1000,
      blankets: 1000,
      energy: 10,
      sanitation: 10,
      staff: 10,
    };
    check(w.state.vendorStock[p.type] >= p.quantity, 'SUPPLIER', 'Supplier stock unavailable');
    org.funds -= p.quantity * p.price;
    w.state.vendorStock[p.type] -= p.quantity;
    const purchase = {
      id: w.nextId('purchase'),
      org: a.org,
      type: p.type,
      quantity: p.quantity,
      cost: p.quantity * p.price,
      state: 'ordered',
      createdAt: w.now,
    };
    w.state.purchases.push(purchase);
    w.state.fundEntries.push({
      type: 'spent',
      org: a.org,
      amount: purchase.cost,
      at: w.now,
      reference: purchase.id,
    });
    w.schedule(
      w.now + Math.max(60000, p.leadMs ?? 1800000),
      'purchase_receive',
      { id: purchase.id },
      4,
      purchase.id,
    );
    return clone(purchase);
  });
  w.on('purchase_receive', ({ id }) => {
    const p = w.state.purchases.find((x) => x.id === id);
    if (!p) return;
    const r = w.resource(`r-${p.org}-${p.type}`);
    receiveStaff(r, p.quantity);
    r.quantity += p.quantity;
    r.received += p.quantity;
    r.version++;
    p.state = 'received';
    p.receivedAt = w.now;
    w.record('purchase_received', { id, quantity: p.quantity });
    w.observeResource(p.org, r);
  });
  w.onAction('share', (a, p) => {
    check(w.organization(p.to), 'NOT_FOUND', 'Recipient not found');
    check(['claim', 'resource', 'commitment'].includes(p.kind), 'TYPE', 'Invalid sharing type');
    let entity =
      p.kind === 'claim'
        ? w.state.claims.find((x) => x.id === p.id && x.org === a.org)
        : p.kind === 'resource'
          ? w.state.observations[a.org].resources[p.id]
          : w.state.commitments.find((x) => x.id === p.id && x.owner === a.org);
    check(entity, 'NOT_FOUND', 'Entity not accessible');
    w.send({ kind: 'share', entityKind: p.kind, entity: clone(entity), from: a.org }, p.to, {
      sector: w.sectorForNode(w.organization(a.org).node),
    });
    return { state: 'queued' };
  });
  w.receiveShare = (org, p) => {
    if (p.entityKind === 'resource') {
      const old = w.state.observations[org].resources[p.entity.id];
      if (!old || p.entity.version >= old.version)
        w.state.observations[org].resources[p.entity.id] = p.entity;
    } else if (p.entityKind === 'claim') w.state.observations[org].claims.push(p.entity);
    else {
      w.state.sharedCommitments ??= {};
      (w.state.sharedCommitments[org] ??= []).push(p.entity);
    }
    w.record('sharing_received', { from: p.from, to: org, kind: p.entityKind });
  };
  w.onAction('correct', (a, p) => {
    const c = w.state.claims.find((x) => x.id === p.id && x.org === a.org);
    check(c, 'NOT_FOUND', 'Claim not found');
    c.history ??= [];
    c.history.push({ text: c.text, state: c.state, at: w.now });
    c.text = p.text ?? c.text;
    c.state = 'corrected';
    c.version++;
    return clone(c);
  });
  w.onAction('cancel', (a, p) => {
    requireRole(a, commandRoles);
    const op = w.state.operations.find((o) => o.id === p.id);
    check(op, 'NOT_FOUND', 'Operation not found');
    requireOwner(a, op.org);
    check(!['completed', 'cancelled', 'failed'].includes(op.state), 'STATE', 'Operation has ended');
    const c = w.state.commitments.find((x) => x.id === op.commitment),
      r = w.resource(op.resource);
    if (c.state === 'confirmed') {
      release(r, c.quantity, c.staffReservation);
      transition(c, 'released', COMMITMENT_STATES);
      const v = w.vehicle(op.vehicle);
      v.state = 'idle';
      v.operation = null;
    } else
      w.send({ kind: 'cancel', vehicle: op.vehicle }, a.org, {
        sector: w.sectorForNode(w.vehicle(op.vehicle).node),
        target: op.vehicle,
      });
    op.state = 'cancelled';
    op.cancelledAt = w.now;
    w.record('operation_cancelled', { id: op.id });
    return clone(op);
  });
  w.onAction('publish', (a, p) => {
    requireRole(a, ['commander', 'publicist']);
    check(typeof p.text === 'string' && p.text.length <= 2000, 'TEXT', 'Public summary required');
    check(
      !/password|secret|private recipient/i.test(p.text),
      'PRIVACY',
      'Sensitive information rejected',
    );
    const update = {
      id: w.publicId('update', w.nextId('update')),
      organization: a.org,
      text: p.text,
      stage: p.stage ?? 'update',
      at: w.now,
    };
    w.state.publicUpdates.push(update);
    w.record('public_update_published', { id: update.id, org: a.org, stage: update.stage });
    return clone(update);
  });
  w.onAction('coverage', (a) => ({
    lastContact: clone(known(a).lastContact),
    knownBuildings: Object.keys(known(a).buildings).length,
    scope: 'known observations only',
    unknownSectors: 'not inferred as safe',
  }));
  w.onAction('abstain', (a, p) => {
    const record = {
      id: w.nextId('abstention'),
      org: a.org,
      reason: p.reason ?? 'Insufficient evidence',
      at: w.now,
    };
    w.state.abstentions ??= [];
    w.state.abstentions.push(record);
    return clone(record);
  });
  w.onAction('record_outcome', (a, p) => {
    check(typeof p.summary === 'string', 'SUMMARY', 'Summary required');
    const record = {
      id: w.nextId('pattern'),
      org: a.org,
      summary: p.summary,
      conditions: clone(p.conditions ?? []),
      references: clone(p.references ?? []),
      at: w.now,
    };
    w.state.patterns.push(record);
    return clone(record);
  });
}
