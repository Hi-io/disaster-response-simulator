export function quantile(values, q) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * q) - 1))];
}
export function evaluate(world) {
  const events = world.log,
    needs = world.state.needs;
  const services = {};
  for (const n of needs) {
    const row = (services[n.type] ??= {
      unit: n.unit,
      demand: 0,
      served: 0,
      pending: 0,
      overprovided: 0,
      uncoveredUnitMs: 0,
      onTime: 0,
    });
    row.demand += n.quantity;
    row.served += Math.min(n.quantity, n.served);
    row.pending += Math.max(0, n.quantity - n.served);
    row.overprovided += Math.max(0, n.served - n.quantity);
    row.uncoveredUnitMs +=
      n.pendingIntegral + (world.now - n.integratedAt) * Math.max(0, n.quantity - n.served);
    if (n.completedAt !== null && n.completedAt <= n.deadline) row.onTime++;
  }
  const stages = {};
  for (const op of world.state.operations)
    for (const [stage, at] of Object.entries(op.times ?? {})) {
      if (!stages[stage]) stages[stage] = [];
      stages[stage].push(at - op.createdAt);
    }
  const latency = {};
  for (const [stage, values] of Object.entries(stages))
    latency[stage] = {
      p50: quantile(values, 0.5),
      p95: quantile(values, 0.95),
      samples: values.length,
    };
  const perCommunity = needs.map((n) => ({
    id: n.id,
    building: n.building,
    type: n.type,
    quantity: n.quantity,
    served: Math.min(n.quantity, n.served),
    completedAt: n.completedAt,
    deadline: n.deadline,
    silent: n.silent,
    firstSignalAt: world.state.statistics.firstSignalAt[n.id] ?? null,
    remote: world.sector(world.building(n.building).sector)?.terrain !== 'urban',
    knownBy: Object.entries(world.state.observations)
      .filter(([, o]) => o.needs[n.id])
      .map(([id]) => id),
  }));
  return {
    simulatedMs: world.now,
    services,
    population: world.populationMetrics(),
    perCommunity,
    latency,
    posts: world.state.posts.length,
    ingested: world.state.ingestion.length,
    operations: world.state.operations.length,
    operatorReviewMs: world.state.statistics.reviewMs,
    conflicts: world.state.statistics.counts.reservation_conflict ?? 0,
    failedTrips: world.state.operations.filter((o) => o.state === 'failed').length,
    staleOrders: world.state.statistics.counts.message_expired ?? 0,
    queries: world.state.queryCount,
    cost: world.state.toolCost,
    events: world.eventCount,
    modelCalls: world.state.modelCalls ?? 0,
    modelWallMs: world.state.modelWallMs ?? 0,
    modelUsage: {
      promptTokens: (world.state.modelRequests ?? []).reduce(
        (n, r) => n + (r.promptTokens ?? 0),
        0,
      ),
      outputTokens: (world.state.modelRequests ?? []).reduce(
        (n, r) => n + (r.outputTokens ?? 0),
        0,
      ),
      pending: (world.state.modelRequests ?? []).filter((r) => r.state === 'waiting').length,
      failed: (world.state.modelRequests ?? []).filter((r) => r.failed).length,
      providerCost: null,
    },
    invalidActions: world.state.invalidActions,
    ledgerValid: world.invariants().length === 0,
    source: {
      created: world.state.posts.length,
      published: world.state.statistics.counts.post_published ?? 0,
      falseSignals: world.state.statistics.falseSignals ?? 0,
      deleted: world.state.statistics.counts.post_deleted ?? 0,
      capped: !!world.state.postBudgetReached,
    },
    information: evaluateInformation(world),
    coordination: {
      expired: world.state.commitments.filter((c) => c.state === 'expired').length,
      withdrawn: world.state.commitments.filter((c) => c.state === 'withdrawn').length,
      orphanReservations: world.state.commitments.filter(
        (c) => ['confirmed', 'reserved'].includes(c.state) && c.expiresAt <= world.now,
      ).length,
      clarifications: world.state.proposals.filter((p) => p.state === 'needs_clarification').length,
      reviewQueued: world.state.proposals.filter((p) => p.reviewPending).length,
      loansOverdue: world.state.transfers?.filter((t) => t.state === 'overdue').length ?? 0,
    },
    physical: {
      closedCrossings: (world.state.map.crossings ?? []).filter((b) =>
        b.edges.some((id) => !world.edge(id).open),
      ).length,
      trafficQueue: world.state.map.edges.reduce((n, e) => n + e.waiting.length, 0),
      overprovidedByType: Object.fromEntries(
        Object.entries(services).map(([type, row]) => [
          type,
          { quantity: row.overprovided, unit: row.unit },
        ]),
      ),
      distanceM: world.state.vehicles.reduce((s, v) => s + (v.distanceM ?? 0), 0),
      fuelMl: world.state.vehicles.reduce((s, v) => s + v.fuelUsed, 0),
      arrivedNotReceived: world.state.operations.filter(
        (o) => o.times?.arrived !== undefined && o.times.received === undefined,
      ).length,
      facilitiesOperating: world.state.map.buildings.filter((b) => b.state === 'operating').length,
      blocked: world.state.operations.filter((o) => o.state === 'blocked').length,
    },
    finance: {
      sandbox: true,
      available: world.state.map.organizations.reduce((s, o) => s + o.funds, 0),
      spent: world.state.fundEntries
        .filter((e) => e.type === 'spent')
        .reduce((s, e) => s + e.amount, 0),
      received: world.state.fundEntries
        .filter((e) => e.type === 'received')
        .reduce((s, e) => s + e.amount, 0),
    },
    subgroups: subgroups(perCommunity),
    eventCounts: { ...world.state.statistics.counts },
  };
}
function evaluateInformation(w) {
  const downloaded = new Set(),
    accepted = new Set(),
    interpreted = new Set(),
    discarded = new Set();
  const latency = [];
  for (const r of w.state.ingestion) {
    const key = `${r.org}:${r.id}:${r.version}`;
    ({ downloaded, accepted, interpreted, discarded })[r.stage]?.add(key);
    if (r.stage === 'downloaded') {
      const p = w.post(r.id);
      if (p?.public.publishedAt != null) latency.push(r.at - p.public.publishedAt);
    }
  }
  let confirmedFalse = 0,
    rejectedTrue = 0,
    falseMerges = 0;
  for (const c of w.state.claims) {
    const posts = c.references.map((id) => w.post(id)).filter(Boolean);
    if (c.state === 'confirmed' && posts.some((p) => p.private.false)) confirmedFalse++;
    if (
      ['old', 'contradicted'].includes(c.state) &&
      posts.some((p) => p.private.truthCategory === 'observed' && !p.private.false)
    )
      rejectedTrue++;
    const needs = new Set(posts.map((p) => p.private.need).filter(Boolean));
    if (c.relation === 'same_incident' && needs.size > 1) falseMerges++;
  }
  return {
    downloaded: downloaded.size,
    accepted: accepted.size,
    interpreted: interpreted.size,
    discarded: discarded.size,
    downloadLatencyMs: { p50: quantile(latency, 0.5), p95: quantile(latency, 0.95) },
    confirmedFalse,
    rejectedObservedTrue: rejectedTrue,
    falseMerges,
    unobservedNeeds: w.state.needs.filter(
      (n) => !Object.values(w.state.observations).some((o) => o.needs[n.id]),
    ).length,
    note: 'Error counts use private evaluator labels. Unverified content is not classified as true. No inferred accuracy score.',
  };
}
function subgroups(rows) {
  return Object.fromEntries(
    ['silent', 'remote'].map((group) => [
      group,
      Object.fromEntries(
        [true, false].map((value) => {
          const byType = {};
          for (const n of rows.filter((n) => n[group] === value)) {
            const r = (byType[n.type] ??= { needs: 0, demand: 0, served: 0, missedDeadline: 0 });
            r.needs++;
            r.demand += n.quantity;
            r.served += n.served;
            if (n.completedAt === null || n.completedAt > n.deadline) r.missedDeadline++;
          }
          return [String(value), byType];
        }),
      ),
    ]),
  );
}
export const METRIC_RULES = {
  pendingWater: 'Sum max(0, demand − served) for water needs, in litres.',
  servedWater:
    'Sum min(demand, delivered service) for water needs. Arrivals and proposals are excluded.',
  signals: 'Publications and distinct versioned download receipts are separate counts.',
  operations: 'Authorized physical operations not in a terminal state.',
  integrity:
    'Per-resource conservation, reservations, vehicle capacity, population and stage ordering.',
};
