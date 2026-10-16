// Presentation rules only. These never advance time or change the simulated world.
export function feedTiming(backlog) {
  const queued = Math.max(0, backlog);
  if (queued <= 1) return { interval: 160, transition: 300, fade: 100 };
  return {
    interval: Math.max(10, Math.round(85 / (queued - 1))),
    transition: Math.max(65, Math.round(260 / Math.sqrt(queued))),
    fade: queued > 3 ? 0 : 40,
  };
}

// Changes that alter geometry, visibility or color. Timestamps, stock counts,
// GPS and messages update separately and must not rebuild the entire 3D map.
export function mapVisualKey(snapshot, perspective = 'truth', { includeRoutes = true } = {}) {
  const s = snapshot.state,
    obs = perspective === 'truth' ? null : s.observations[perspective];
  const needs = obs ? Object.values(obs.needs ?? {}) : s.needs;
  return JSON.stringify([
    snapshot.runId,
    s.map.hash,
    perspective,
    s.map.buildings.map((b) => {
      const known = obs ? obs.buildings?.[b.id] : b;
      return [b.id, !!known, known?.state, known?.damage];
    }),
    s.map.edges.filter((e) => (obs ? obs.edges?.[e.id]?.open === false : !e.open)).map((e) => e.id),
    needs.filter((n) => n.served < n.quantity).map((n) => [n.id, n.building, n.type]),
    s.vehicles.filter((v) => !obs || obs.vehicles?.[v.id]).map((v) => v.id),
    obs || !includeRoutes
      ? []
      : s.vehicles
          .filter(
            (v) =>
              !v.background &&
              v.route?.length &&
              ['en_route', 'dispatched', 'queued', 'spillback', 'blocked'].includes(v.state),
          )
          .map((v) => [v.id, v.route.slice(v.routeIndex ?? 0)]),
    obs ? [] : s.hazards,
    obs ? [] : s.map.sectors.map((sector) => [sector.id, sector.coverage === 0]),
    obs
      ? []
      : s.cohorts
          .filter((c) => c.population > 0)
          .slice(0, 500)
          .map((c) => [c.id, c.node]),
    s.sharingEvents,
    s.map.organizations.map((o) => [o.id, o.node, o.name, o.usesPlatform]),
  ]);
}

// Newest notices keep their anchor. Older neighbours move upward, never onto each other.
export function packNotices(notices, width, height, gap = 7) {
  const placed = [];
  const margin = 12;
  return notices.map((notice) => {
    const x = Math.max(
      margin,
      Math.min(width - notice.width - margin, notice.x - notice.width / 2),
    );
    let y = Math.max(
      margin,
      Math.min(height - notice.height - margin, notice.y - notice.height - 18),
    );
    let collision;
    do {
      collision = placed.find(
        (p) =>
          x < p.x + p.width + gap &&
          x + notice.width + gap > p.x &&
          y < p.y + p.height + gap &&
          y + notice.height + gap > p.y,
      );
      if (collision) y = collision.y - notice.height - gap;
    } while (collision);
    const result = { ...notice, x, y, visible: notice.visible !== false && y >= margin };
    if (result.visible) placed.push(result);
    return result;
  });
}

export function serviceRows(snapshot, perspective = 'truth') {
  if (perspective === 'truth') {
    const services = snapshot.metrics.services ?? {};
    const types = [...new Set(['water', 'food', ...Object.keys(services)])];
    return types.map((type) => ({
      type,
      unit: services[type]?.unit ?? (type === 'water' ? 'L' : 'portion'),
      reported: true,
      demand: 0,
      served: 0,
      pending: 0,
      overprovided: 0,
      ...services[type],
    }));
  }
  const needs = Object.values(snapshot.state.observations?.[perspective]?.needs ?? {});
  const rows = new Map();
  for (const n of needs) {
    const key = `${n.type}:${n.unit}`;
    if (!rows.has(key))
      rows.set(key, {
        type: n.type,
        unit: n.unit,
        reported: true,
        demand: 0,
        served: 0,
        pending: 0,
        overprovided: 0,
      });
    const row = rows.get(key);
    row.demand += n.quantity;
    row.served += Math.min(n.quantity, n.served ?? 0);
    row.pending += Math.max(0, n.quantity - (n.served ?? 0));
    row.overprovided += Math.max(0, (n.served ?? 0) - n.quantity);
  }
  for (const type of ['food', 'water'])
    if (!needs.some((n) => n.type === type)) rows.set(type, { type, reported: false });
  return [...rows.values()];
}

export function selectionPoint(
  snapshot,
  entity,
  perspective = 'truth',
  { vehiclePoint, events } = {},
) {
  if (!entity || !snapshot) return null;
  const s = snapshot.state;
  const obs = perspective === 'truth' ? null : s.observations?.[perspective];
  if (perspective !== 'truth' && !obs) return null;
  const nodes = s.map.nodes;
  const locate = (id) => {
    const b = s.map.buildings.find((b) => b.id === id);
    const node = nodes.find((n) => n.id === (b?.node ?? id));
    if (b) return { x: b.x, z: b.z };
    if (node) return { x: node.x, z: node.z };
    const org = s.map.organizations.find((o) => o.id === id);
    if (org) return locate(org.node);
    return null;
  };
  if (entity.kind === 'vehicle') {
    const known = obs ? obs.vehicles?.[entity.id] : s.vehicles.find((v) => v.id === entity.id);
    return known ? (vehiclePoint?.(entity.id) ?? locate(known.node)) : null;
  }
  if (['building', 'organization', 'node'].includes(entity.kind)) return locate(entity.id);
  if (entity.kind === 'post') {
    const p = s.posts.find((p) => p.public.id === entity.id);
    if (
      !p ||
      p.public.publishedAt == null ||
      p.public.publishedAt > snapshot.now ||
      p.deleted ||
      (obs && p.private.audience !== 'public' && !p.private.audience.includes(perspective))
    )
      return null;
    return locate(p.public.location);
  }
  if (entity.kind === 'need') {
    const n = obs ? obs.needs?.[entity.id] : s.needs.find((n) => n.id === entity.id);
    return n ? locate(n.building) : null;
  }
  if (entity.kind === 'operation') {
    const op = obs ? obs.operations?.[entity.id] : s.operations.find((o) => o.id === entity.id);
    if (!op) return null;
    if (op.vehicle && !['completed', 'failed', 'cancelled'].includes(op.state))
      return (
        selectionPoint(snapshot, { kind: 'vehicle', id: op.vehicle }, perspective, {
          vehiclePoint,
          events,
        }) ?? locate(op.destination)
      );
    return locate(op.destination);
  }
  if (entity.kind === 'event') {
    const e = events?.get(entity.id);
    if (!e || (obs && e.data?.to !== perspective && e.data?.org !== perspective)) return null;
    return locate(e.data?.building ?? e.data?.destination ?? e.data?.to ?? e.entity);
  }
  return null;
}

export function trackingStep(target, zoom, goal, desiredZoom, elapsed, reduced = false) {
  const blend = reduced ? 1 : 1 - Math.exp(-Math.max(0, Math.min(100, elapsed)) / 150);
  return {
    x: target.x + (goal.x - target.x) * blend,
    z: target.z + (goal.z - target.z) * blend,
    zoom: zoom + (desiredZoom - zoom) * blend,
  };
}

// This is an observer visualization of causal source work, not inferred human
// productivity. Actor perspectives may see counts only for that owner.
export function humanQueueRows(snapshot, perspective = 'truth') {
  const tasks = (snapshot?.state?.humanWork ?? []).filter(t => perspective === 'truth' || t.org === perspective);
  const now = snapshot?.now;
  return ['read', 'decide', 'relay'].map(stage => {
    const own = tasks.filter(t => t.stage === stage);
    const queued = own.filter(t => t.state === 'queued');
    return {
      stage,
      queued: queued.length,
      working: own.filter(t => t.state === 'working').length,
      awaitingDelivery: own.filter(t => t.state === 'awaiting_delivery').length,
      completed: own.filter(t => t.state === 'completed').length,
      unconfirmed: own.filter(t => ['failed', 'inconclusive'].includes(t.state)).length,
      oldestQueuedMs: Number.isFinite(now) && (!queued.length || queued.some(t => Number.isFinite(t.createdAt) && t.createdAt >= 0 && t.createdAt <= now)) ? queued.reduce((m,t) => Number.isFinite(t.createdAt) && t.createdAt >= 0 && t.createdAt <= now ? Math.max(m,now-t.createdAt) : m,0) : null,
    };
  });
}
