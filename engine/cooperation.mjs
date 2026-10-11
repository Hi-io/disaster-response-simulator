import { clone } from './determinism.mjs';
import { requireCondition as check, requireRole, requireOwner } from '../contracts/actions.mjs';
import { reserve, release, available, transition, COMMITMENT_STATES } from './ledger.mjs';

const roles = ['commander', 'dispatcher'];
const positive = (n) =>
  check(Number.isSafeInteger(n) && n > 0, 'QUANTITY', 'Positive integer required');
export function installCooperation(w) {
  const previousDispatch = w.actionHandlers.get('dispatch');
  w.conditionSatisfied = (condition, org) => {
    if (condition.type === 'inspection') {
      const i = w.state.inspections.find((i) => i.id === condition.id && i.org === org);
      return (
        i?.state === 'completed' &&
        i.result?.[condition.field ?? 'safe'] === (condition.equals ?? true) &&
        (!condition.version || i.result.version === condition.version)
      );
    }
    if (condition.type === 'commitment') {
      const c = w.state.commitments.find((c) => c.id === condition.id);
      return (
        c &&
        (c.owner === org || c.requester === org) &&
        c.state === (condition.state ?? 'confirmed') &&
        c.expiresAt > w.now
      );
    }
    if (condition.type === 'approval') {
      const p = w.state.proposals.find((p) => p.id === condition.id && p.org === org);
      return p?.state === 'authorized';
    }
    if (condition.type === 'time')
      return w.now >= (condition.after ?? 0) && w.now < (condition.before ?? Infinity);
    return false;
  };
  w.onAction('commitment', (a, p, request) => {
    requireRole(a, roles);
    if (['offer', 'reserve'].includes(p.action) && !p.id) {
      const r = w.resource(p.resource);
      check(r, 'NOT_FOUND', 'Resource not found');
      requireOwner(a, r.owner);
      positive(p.quantity);
      check(p.quantity <= available(r), 'INSUFFICIENT_RESOURCE', 'Insufficient stock');
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
      check(w.organization(c.requester), 'REQUESTER', 'Unknown partner');
      check(
        Number.isSafeInteger(c.expiresAt) && c.expiresAt > w.now && c.expiresAt <= w.now + 86400000,
        'EXPIRY',
        'Invalid validity window',
      );
      if (c.state === 'reserved') reserve(r, c.quantity);
      w.state.commitments.push(c);
      w.schedule(c.expiresAt, 'expire_commitment', { id: c.id }, 1, c.id);
      return clone(c);
    }
    const c = w.state.commitments.find((c) => c.id === p.id);
    check(c, 'NOT_FOUND', 'Commitment not found');
    requireOwner(a, c.owner);
    const r = w.resource(c.resource);
    if (p.action === 'reserve') {
      check(c.state === 'offered' && c.expiresAt > w.now, 'STATE', 'Offer is not reservable');
      reserve(r, c.quantity);
      transition(c, 'reserved', COMMITMENT_STATES);
    } else if (p.action === 'confirm') {
      check(c.expiresAt > w.now && c.state === 'reserved', 'STATE', 'Reservation required');
      check(
        c.conditions.every((c) => w.conditionSatisfied(c, a.org)),
        'CONDITION',
        'Evidence-backed conditions have not been fulfilled',
      );
      transition(c, 'confirmed', COMMITMENT_STATES);
    } else if (['release', 'withdraw'].includes(p.action)) {
      const previous = c.state;
      transition(c, p.action === 'release' ? 'released' : 'withdrawn', COMMITMENT_STATES);
      if (['reserved', 'confirmed'].includes(previous)) release(r, c.quantity);
      w.invalidateDependency(c.id);
      w.record('commitment_withdrawn', { id: c.id, resource: r.id });
    } else if (p.action === 'reject') {
      transition(c, 'rejected', COMMITMENT_STATES);
    } else check(false, 'COMMITMENT_ACTION', 'Unknown commitment action');
    w.observeResource(a.org, r);
    return clone(c);
  });
  w.invalidateDependency = (id) => {
    for (const p of w.state.proposals)
      if ((p.conditions ?? []).some((c) => c.id === id) || (p.references ?? []).includes(id)) {
        p.requiresReview = true;
        p.invalidatedAt = w.now;
      }
    for (const o of w.state.operations)
      if (o.commitment === id || (o.references ?? []).includes(id)) {
        o.requiresRepair = true;
        w.record('plan_dependency_invalidated', { dependency: id, operation: o.id });
      }
  };
  w.onAction('transfer', (a, p) => {
    requireRole(a, roles);
    w.state.transfers ??= [];
    if (!p.action || p.action === 'offer') {
      const r = w.resource(p.resource);
      check(r, 'NOT_FOUND', 'Resource not found');
      requireOwner(a, r.owner);
      positive(p.quantity);
      check(p.quantity <= available(r), 'INSUFFICIENT_RESOURCE', 'Not available');
      check(w.organization(p.to) && p.to !== a.org, 'RECIPIENT', 'Choose a different partner');
      const c = w.act(a, {
        type: 'commitment',
        params: {
          action: 'reserve',
          resource: r.id,
          quantity: p.quantity,
          requester: p.to,
          ttlMs: p.ttlMs ?? 900000,
        },
        idempotencyKey: `transfer-stock-${w.nextId('transfer-request')}`,
      });
      const t = {
        id: w.nextId('transfer'),
        from: a.org,
        to: p.to,
        resource: r.id,
        quantity: p.quantity,
        state: 'offered',
        commitment: c.id,
        loan: p.loan === true,
        returnBy: p.returnBy ?? null,
        createdAt: w.now,
        authorizedBy: a.id,
      };
      w.state.transfers.push(t);
      w.send({ kind: 'transfer_offer', transfer: clone(t) }, p.to, {
        sector: w.sectorForNode(w.organization(a.org).node),
      });
      return clone(t);
    }
    const t = w.state.transfers.find((t) => t.id === p.id);
    check(t, 'NOT_FOUND', 'Transfer not found');
    requireOwner(a, t.to);
    check(t.state === 'offered', 'STATE', 'Transfer already decided');
    const c = w.state.commitments.find((c) => c.id === t.commitment);
    check(c.state === 'reserved' && c.expiresAt > w.now, 'EXPIRED', 'Owner reservation expired');
    if (p.action === 'accept') {
      t.state = 'accepted';
      t.acceptedBy = a.id;
      t.acceptedAt = w.now;
      transition(c, 'confirmed', COMMITMENT_STATES);
    } else if (p.action === 'reject') {
      t.state = 'rejected';
      release(w.resource(t.resource), t.quantity);
      c.state = 'released';
    } else check(false, 'TRANSFER_ACTION', 'Unknown transfer action');
    return clone(t);
  });
  w.onAction('dispatch', (a, p, request) => {
    if (p.transfer) {
      const t = w.state.transfers?.find((t) => t.id === p.transfer);
      check(
        t?.state === 'accepted' && t.from === a.org,
        'TRANSFER',
        'Both owners must authorize this transfer',
      );
      const c = w.state.commitments.find((c) => c.id === t.commitment);
      check(c.state === 'confirmed', 'COMMITMENT', 'Transfer commitment is invalid');
      // The dispatch validator remains authoritative. Its requester scope is temporarily
      // local only during validation; the accepted bilateral record is kept intact.
      const requester = c.requester;
      c.requester = a.org;
      let op;
      try {
        op = previousDispatch(
          a,
          {
            ...p,
            commitment: c.id,
            quantity: t.quantity,
            resource: t.resource,
            destination: w.organization(t.to).node,
            need: undefined,
            building: undefined,
          },
          request,
        );
      } finally {
        c.requester = requester;
      }
      const stored = w.state.operations.find((o) => o.id === op.id);
      stored.type = 'transfer';
      stored.transfer = t.id;
      stored.recipientOrg = t.to;
      t.state = 'in_transit';
      t.operation = op.id;
      return clone(stored);
    }
    if (p.proposal) {
      const proposal = w.state.proposals.find((x) => x.id === p.proposal);
      check(
        proposal?.org === a.org && proposal.state === 'authorized' && !proposal.requiresReview,
        'APPROVAL',
        'Current approval required',
      );
    }
    const op = previousDispatch(a, p, request);
    const stored = w.state.operations.find((o) => o.id === op.id);
    stored.proposal = p.proposal ?? null;
    stored.references = clone(p.references ?? []);
    return clone(stored);
  });
  const previousUnload = w.handlers.get('unload');
  w.on('request_unload', (p) => {
    const op = w.state.operations.find((o) => o.id === p.operation);
    if (!op || !['arrived', 'waiting_to_unload'].includes(op.state)) return;
    const b = op.building ? w.building(op.building) : null;
    if (b && (b.unloading >= b.unloadCapacity || !b.receiverAvailable || b.damage >= 3)) {
      op.state = 'waiting_to_unload';
      w.record('unloading_queued', { building: b.id }, op.id);
      if (w.now + 30000 <= w.config.durationMs)
        w.schedule(w.now + 30000, 'request_unload', p, 4, `unload-queue-${op.id}-${w.now}`);
      return;
    }
    if (b) b.unloading++;
    op.unloadingSlot = !!b;
    op.state = 'unloading';
    op.times.unloadingStarted = w.now;
    w.schedule(w.now + w.config.unloadMs, 'unload', p, 4, `unload-${op.id}-${w.now}`);
  });
  w.on('unload', (p) => {
    const op = w.state.operations.find((o) => o.id === p.operation);
    if (!op || op.state !== 'unloading') return;
    const b = op.building ? w.building(op.building) : null,
      v = w.vehicle(op.vehicle);
    if (op.unloadingSlot) {
      b.unloading--;
      op.unloadingSlot = false;
    }
    op.state = 'arrived';
    if (
      b &&
      (b.damage >= 3 ||
        !b.receiverAvailable ||
        (b.provisioned[op.resourceType] ?? 0) + v.load > b.storageCapacity)
    ) {
      op.state = 'waiting_to_unload';
      op.waitingReason =
        b.damage >= 3
          ? 'unsafe_destination'
          : !b.receiverAvailable
            ? 'no_receiver'
            : 'storage_or_unloading_capacity';
      w.record('unloading_blocked', { reason: op.waitingReason }, op.id);
      if (w.now + 30000 <= w.config.durationMs)
        w.schedule(w.now + 30000, 'request_unload', p, 4, `unload-wait-${op.id}-${w.now}`);
      return;
    }
    if (b && op.resourceType === 'energy' && !op.need) {
      const r = w.resource(op.resource);
      if (
        r.compatibility?.connector !== b.requiredPower.connector ||
        r.compatibility.powerKw < b.requiredPower.powerKw
      ) {
        op.state = 'waiting_for_compatible_equipment';
        w.record('equipment_incompatible', { resource: r.id, building: b.id }, op.id);
        return;
      }
    }
    previousUnload(p);
    if (op.transfer && op.state === 'completed') {
      const t = w.state.transfers.find((t) => t.id === op.transfer),
        r = w.resource(`stock-${op.destination}-${op.resourceType}`);
      r.owner = t.to;
      r.loanOf = t.loan ? t.id : null;
      w.observeResource(t.to, r);
      t.state = 'received';
      t.receivedAt = w.now;
      w.record(
        'transfer_received',
        { transfer: t.id, recipient: t.to, quantity: op.received },
        t.id,
      );
    }
  });
  const previousCorrect = w.actionHandlers.get('correct');
  w.onAction('correct', (a, p) => {
    const result = previousCorrect(a, p);
    w.invalidateDependency(p.id);
    return result;
  });
  const previousPublish = w.actionHandlers.get('publish');
  w.onAction('publish', (a, p) => {
    check(
      [
        'need',
        'fundraising',
        'funded',
        'preparing',
        'en_route',
        'received',
        'service',
        'update',
      ].includes(p.stage ?? 'update'),
      'STAGE',
      'Unknown public status',
    );
    if (p.operation) {
      const op = w.state.operations.find((o) => o.id === p.operation && o.org === a.org);
      check(op, 'NOT_FOUND', 'Operation not owned');
      const stageTime = { en_route: 'dispatched', received: 'received', service: 'service' }[
        p.stage
      ];
      if (stageTime)
        check(
          op.times[stageTime] !== undefined,
          'PUBLIC_EVIDENCE',
          'Physical stage has not occurred',
        );
    }
    check(
      !p.recipient && !p.phone && !p.privateAddress,
      'PRIVACY',
      'Public reports must be aggregated',
    );
    const update = previousPublish(a, p);
    const stored = w.state.publicUpdates.find((u) => u.id === update.id);
    stored.operation = p.operation ?? null;
    stored.aggregate = p.aggregate ?? null;
    return clone(stored);
  });
}
