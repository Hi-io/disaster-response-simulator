import { clone } from './determinism.mjs';
import { requireCondition as check, requireRole, requireOwner } from '../contracts/actions.mjs';
import { release, available } from './ledger.mjs';
import { consumeStaff } from './staff.mjs';

// Experimental facilities, source access and operator shifts are world rules.
// None of these methods exposes observer truth to a platform session.
export function installLaboratory(w) {
  w.initializeLaboratory = () => {
    w.state.personnel = w.state.map.organizations.flatMap((o) => [
      ...Array.from({ length: o.operators }, (_, i) => ({
        id: `operator-${o.id}-${i}`,
        name: `${['Aiko', 'Kai', 'Mei', 'Hana', 'Rin', 'Leo'][Math.floor(w.random('personnel', `${o.id}-operator-${i}`, 'first') * 6)]} ${['Mori', 'Sato', 'Tan', 'Lin', 'Park', 'Lee'][Math.floor(w.random('personnel', `${o.id}-operator-${i}`, 'last') * 6)]}`,
        org: o.id,
        role: 'operator',
        competence: ['review'],
        node: o.node,
        shiftEnd: w.config.staffShiftMs,
        restMs: w.config.staffRestMs,
      })),
      ...w.state.vehicles
        .filter((v) => v.owner === o.id)
        .map((v) => ({
          id: v.driver,
          name: `${['Yuna', 'Ren', 'Mika', 'Noah', 'Niko', 'Emi'][Math.floor(w.random('personnel', v.driver, 'first') * 6)]} ${['Mori', 'Sato', 'Tan', 'Lin', 'Park', 'Lee'][Math.floor(w.random('personnel', v.driver, 'last') * 6)]}`,
          org: o.id,
          role: 'driver',
          competence: ['transport'],
          node: v.node,
          shiftEnd: v.shiftEnd,
          restMs: w.config.staffRestMs,
        })),
      {
        id: `crew-${o.id}`,
        name: `${o.name} Field Team`,
        org: o.id,
        role: 'crew',
        competence: ['inspection', 'debris_clearance'],
        node: o.node,
        shiftEnd: w.config.staffShiftMs,
        restMs: w.config.staffRestMs,
      },
    ]);
    w.state.sharingEvents = [];
    w.state.bulletins = [];
    w.state.integrations = { schemaVersion: 1, sourceAvailable: true, revokedOrgs: [] };
    w.state.initialPopulation = w.state.cohorts.reduce((n, c) => n + c.population, 0);
  };
  w.sourceVisible = (post, org = null) =>
    post &&
    post.public.publishedAt !== null &&
    post.indexAt <= w.now &&
    !post.deleted &&
    (!post.private.audience ||
      post.private.audience === 'public' ||
      post.private.audience.includes(org));

  const previousQuery = w.actionHandlers.get('query');
  const targets = [
    'personnel',
    'communication',
    'bulletins',
    'finance',
    'memory',
    'team',
    'integrations',
    'forecasts',
    'population',
  ];
  w.onAction('query', (a, p, request) => {
    if (p.target === 'sources') return previousQuery(a, { ...p, org: a.org }, request);
    if (!targets.includes(p.target)) return previousQuery(a, p, request);
    check(!w.state.toolFault, 'TOOL_UNAVAILABLE', 'Tool dependency is unavailable', 503);
    const key = `${a.org}-${Math.floor(w.now / 60000)}`;
    check(
      (w.state.toolQuota[key] ?? 0) < w.config.toolQuota,
      'RATE_LIMIT',
      'Tool quota exhausted',
      429,
    );
    w.state.toolQuota[key] = (w.state.toolQuota[key] ?? 0) + 1;
    w.state.queryCount++;
    w.state.toolCost++;
    let result;
    if (p.target === 'population') result = clone(w.state.observations[a.org].population);
    if (p.target === 'personnel')
      result = w.state.personnel
        .filter((x) => x.org === a.org)
        .map((x) => ({
          ...x,
          onShift: w.now % (w.config.staffShiftMs + w.config.staffRestMs) < w.config.staffShiftMs,
        }));
    if (p.target === 'communication')
      result = {
        lastContact: clone(w.state.observations[a.org].lastContact),
        organizationConnected: w.organization(a.org).connected,
        queuedOrders: w.state.messages
          .filter((m) => m.to === a.org && !['delivered', 'expired', 'dropped'].includes(m.state))
          .map((m) => ({ id: m.id, channel: m.channel, state: m.state, createdAt: m.createdAt })),
      };
    if (p.target === 'bulletins' || p.target === 'forecasts')
      result = w.state.bulletins.filter((b) => b.availableAt <= w.now).map((b) => clone(b));
    if (p.target === 'finance') {
      check(p.org === undefined || p.org === a.org, 'FORBIDDEN', 'Finance is private to its owner', 403);
      result = w.financeView(a.org);
    }
    if (p.target === 'memory') result = clone(w.state.patterns.filter((x) => x.org === a.org));
    if (p.target === 'team') result = w.publicFeed({ ...p, org: a.org, audience: 'team' }).posts;
    if (p.target === 'integrations')
      result = {
        schemaVersion: w.state.integrations.schemaVersion,
        toolAvailable: !w.state.toolFault,
        quota: w.config.toolQuota,
        sourceAvailable: w.state.integrations.sourceAvailable,
      };
    const q = {
      id: w.nextId('query'),
      org: a.org,
      target: p.target,
      state: 'pending',
      createdAt: w.now,
      readyAt: w.now + w.config.queryLatencyMs,
    };
    (w.state.queries ??= []).push(q);
    w.schedule(q.readyAt, 'query_result', { id: q.id, result }, 2, q.id);
    return clone(q);
  });

  const previousShare = w.actionHandlers.get('share');
  w.onAction('share', (a, p, request) => {
    if (p.revoke) {
      requireRole(a, ['commander', 'dispatcher']);
      check(w.organization(p.to), 'NOT_FOUND', 'Recipient not found');
      const r = w.resource(p.id);
      check(r, 'NOT_FOUND', 'Resource not found');
      requireOwner(a, r.owner);
      w.organization(a.org).version++;
      w.send(
        {
          kind: 'share',
          entityKind: 'revoke',
          entity: { id: p.id },
          from: a.org,
          permissionVersion: w.organization(a.org).version,
        },
        p.to,
        { sector: w.sectorForNode(w.organization(a.org).node) },
      );
      w.record('sharing_revocation_requested', { from: a.org, to: p.to, id: p.id });
      return { state: 'queued' };
    }
    if (p.kind === 'resource') {
      const r = w.resource(p.id);
      check(r, 'NOT_FOUND', 'Resource not found');
      requireOwner(a, r.owner);
    }
    const result = previousShare(a, p, request);
    const m = w.state.messages.at(-1);
    m.payload.permissionVersion = w.organization(a.org).version;
    w.state.sharingEvents.push({ from: a.org, to: p.to, id: p.id, kind: p.kind, at: w.now });
    return result;
  });
  const previousReceive = w.receiveShare;
  w.receiveShare = (org, p) => {
    if (p.permissionVersion && p.permissionVersion !== w.organization(p.from).version) {
      w.record('sharing_stale_permission', { from: p.from, to: org });
      return;
    }
    if (p.entityKind === 'revoke') {
      delete w.state.observations[org].resources[p.entity.id];
      w.invalidateDependency(p.entity.id);
      w.record('sharing_revoked', { from: p.from, to: org, id: p.entity.id });
      return;
    }
    previousReceive(org, p);
  };

  const previousReview = w.actionHandlers.get('review');
  w.onAction('review', (a, p, request) => {
    requireRole(a, ['commander', 'dispatcher']);
    const org = w.organization(a.org),
      cycle = w.config.staffShiftMs + w.config.staffRestMs;
    const remaining = w.now % cycle;
    if (remaining >= w.config.staffShiftMs)
      org.reviewSlots = org.reviewSlots.map((t) => Math.max(t, w.now + cycle - remaining));
    const proposal = w.state.proposals.find((x) => x.id === p.id);
    check(proposal, 'NOT_FOUND', 'Proposal not found');
    requireOwner(a, proposal.org);
    check(!proposal.reviewPending, 'REVIEW_PENDING', 'A review is already queued', 409);
    const result = previousReview(a, p, request);
    proposal.reviewPending = true;
    proposal.reviewQueuedAt = w.now;
    return result;
  });
  const previousReviewCompleted = w.handlers.get('review_completed');
  w.on('review_completed', (p) => {
    previousReviewCompleted(p);
    const proposal = w.state.proposals.find((x) => x.id === p.id);
    if (proposal) proposal.reviewPending = false;
  });

  const previousTransfer = w.actionHandlers.get('transfer');
  w.onAction('transfer', (a, p, request) => {
    if (p.action !== 'return') {
      if (p.loan && p.returnBy !== undefined)
        check(
          Number.isSafeInteger(p.returnBy) && p.returnBy > w.now,
          'RETURN_WINDOW',
          'Return deadline must be in the future',
        );
      const result = previousTransfer(a, p, request);
      if (result.loan && result.returnBy && result.state === 'offered') {
        w.schedule(result.returnBy, 'loan_due', { id: result.id }, 1, result.id);
      }
      return result;
    }
    requireRole(a, ['commander', 'dispatcher']);
    const t = w.state.transfers?.find((x) => x.id === p.id);
    check(t?.loan && ['received', 'overdue'].includes(t.state), 'LOAN', 'Received loan required');
    requireOwner(a, t.to);
    const receipt = w.state.operations.find((o) => o.id === t.operation);
    const r = w.resource(receipt.destinationStock);
    check(
      r && available(r) >= t.quantity,
      'LOAN_IN_USE',
      'Release the loaned equipment before returning it',
    );
    const op = w.act(a, {
      type: 'dispatch',
      params: {
        resource: r.id,
        quantity: t.quantity,
        vehicle: p.vehicle,
        destination: w.organization(t.from).node,
      },
      idempotencyKey: `loan-return-${t.id}`,
    });
    const stored = w.state.operations.find((o) => o.id === op.id);
    stored.returnTransfer = t.id;
    stored.recipientOrg = t.from;
    t.state = 'returning';
    t.returnOperation = op.id;
    return clone(t);
  });
  w.on('loan_due', ({ id }) => {
    const t = w.state.transfers?.find((x) => x.id === id);
    if (t && ['received', 'in_transit'].includes(t.state)) {
      t.overdueAt = w.now;
      if (t.state === 'received') t.state = 'overdue';
      w.record('loan_overdue', { id, from: t.from, to: t.to });
    }
  });
  const previousUnload = w.handlers.get('unload');
  w.on('unload', (p) => {
    previousUnload(p);
    const op = w.state.operations.find((o) => o.id === p.operation);
    if (op?.returnTransfer && op.state === 'completed') {
      const t = w.state.transfers.find((x) => x.id === op.returnTransfer);
      t.state = 'returned';
      t.returnedAt = w.now;
      w.record('loan_returned', { id: t.id, quantity: op.received }, t.id);
    }
  });

  w.on('lab_intervention', (p) => {
    if (p.kind === 'bulletin') {
      const b = {
        id: w.publicId('bulletin', w.nextId('bulletin')),
        text: p.text ?? 'Official update pending confirmation',
        format: 'bulletin',
        observedAt: p.observedAt ?? w.now,
        availableAt: w.now,
        version: 1,
        location: p.location ?? null,
      };
      w.state.bulletins.push(b);
      w.generateSignal('P27', {
        text: b.text,
        authorName: 'Regional Operations Bulletin',
        type: 'news',
        causeEvent: b.id,
        claimedAt: b.observedAt,
      });
    } else if (p.kind === 'team_note') {
      check(w.organization(p.org), 'ORGANIZATION', 'Unknown recipient');
      w.generateSignal('P03', {
        text: p.text ?? 'Field note pending clarification',
        type: p.format ?? 'audio',
        audience: [p.org],
        building: p.building ?? w.state.map.shelterId,
        channel: p.channel ?? 'radio',
        causeEvent: w.nextId('team-note'),
      });
    } else if (p.kind === 'facility_receiver') {
      const b = w.building(p.id);
      check(b, 'NOT_FOUND', 'Building not found');
      b.receiverAvailable = !!p.available;
      b.version++;
    } else if (p.kind === 'integration') {
      if (p.schemaVersion !== undefined) w.state.integrations.schemaVersion = p.schemaVersion;
      if (p.available !== undefined) w.state.integrations.sourceAvailable = !!p.available;
      if (p.revokeOrg) w.state.integrations.revokedOrgs.push(p.revokeOrg);
    } else if (p.kind === 'resource_condition') {
      const r = w.resource(p.id);
      check(r, 'NOT_FOUND', 'Resource not found');
      if (p.expired || p.damaged) {
        for (const c of w.state.commitments.filter(
          (c) => c.resource === r.id && ['confirmed', 'reserved'].includes(c.state),
        )) {
          release(r, c.quantity, c.staffReservation);
          c.state = 'withdrawn';
          w.invalidateDependency(c.id);
        }
        consumeStaff(r, r.quantity);
        r.lost += r.quantity;
        r.quantity = 0;
        r.condition = p.expired ? 'expired' : 'damaged';
        r.version++;
        w.record('resource_lost', { id: r.id, condition: r.condition });
      }
    } else if (p.kind === 'refuel') {
      const v = w.vehicle(p.vehicle),
        r = w.resource(`r-${v?.owner}-fuel`);
      check(v && r, 'NOT_FOUND', 'Vehicle and fuel stock required');
      check(
        v.node === r.node && !v.edge && !v.load,
        'LOCATION',
        'Refuel at base with unloaded vehicle',
      );
      check(available(r) >= p.litres, 'FUEL', 'Insufficient unreserved fuel');
      r.quantity -= p.litres;
      r.consumed += p.litres;
      r.version++;
      v.fuel += p.litres * 1000;
      v.version++;
      if (v.state === 'failed' && !v.operation) v.state = 'idle';
      w.observeResource(v.owner, r);
      w.record('vehicle_refuelled', { litres: p.litres }, v.id);
    } else if (p.kind === 'driver_relay') {
      const v = w.vehicle(p.vehicle);
      check(v, 'NOT_FOUND', 'Vehicle not found');
      check(
        v.node === w.organization(v.owner).node && !v.edge,
        'LOCATION',
        'Driver relay requires returning to base',
      );
      v.shiftEnd = w.now + w.config.staffShiftMs;
      w.record('driver_relay', { vehicle: v.id });
    } else if (p.kind === 'donation') {
      const o = w.organization(p.org);
      check(
        o && Number.isSafeInteger(p.amount) && p.amount > 0,
        'DONATION',
        'Valid sandbox donation required',
      );
      w.state.fundEntries.push({ type: 'pledged', org: o.id, amount: p.amount, at: w.now });
      w.schedule(
        w.now + (p.delayMs ?? 60000),
        'donation_settle',
        { org: o.id, amount: p.amount, fail: !!p.fail },
        2,
        w.nextId('donation'),
      );
    } else check(false, 'INTERVENTION', 'Unknown laboratory intervention');
    w.record('laboratory_intervention', clone(p));
  });
  w.on('donation_settle', (p) => {
    const o = w.organization(p.org);
    w.state.fundEntries.push({
      type: p.fail ? 'failed' : 'received',
      org: o.id,
      amount: p.amount,
      at: w.now,
    });
    if (!p.fail) o.funds += p.amount;
    w.record('donation_settled', { ...p, sandbox: true });
  });

  // Memory is evidence with applicability conditions, never a shortcut to truth.
  w.onAction('record_outcome', (a, p) => {
    requireRole(a, ['commander', 'dispatcher']);
    check(typeof p.summary === 'string' && p.summary.length <= 2000, 'SUMMARY', 'Summary required');
    const evidence = (p.references ?? []).map((id) => w.state.observations[a.org].operations[id]);
    check(
      evidence.length > 0 && evidence.every((o) => o && o.times?.received !== undefined),
      'EVIDENCE',
      'Received operational evidence is required',
    );
    const record = {
      id: w.nextId('pattern'),
      org: a.org,
      summary: p.summary,
      conditions: clone(p.conditions ?? []),
      references: clone(p.references),
      recordedAt: w.now,
      applicability: 'must_revalidate',
      evidence: clone(evidence),
    };
    w.state.patterns.push(record);
    w.record('outcome_recorded', { id: record.id, org: a.org });
    return clone(record);
  });
}
