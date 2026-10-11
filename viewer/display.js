// Presentation rules only. These never advance time or change the simulated world.
export function feedTiming(backlog, rate = 1) {
  if (rate >= 1000) return { interval: backlog > 6 ? 24 : 45, transition: 130 };
  if (rate >= 100) return { interval: backlog > 6 ? 55 : 100, transition: 240 };
  return {
    interval: backlog > 12 ? 100 : backlog > 4 ? 150 : 280,
    transition: 520,
  };
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
