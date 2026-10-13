// Observer/scorer instrumentation only. These integrals measure occupied
// operational capacity, not wages, productive clinical work or lives saved.
const terminal = new Set(['completed', 'received', 'failed', 'cancelled']);
const fields = ['vehicleCommittedMs', 'vehicleMovingMs', 'vehicleWaitingMs', 'vehicleBlockedMs', 'staffCommittedPersonMs', 'staffTransitPersonMs', 'staffFieldWorkPersonMs'];
function occupancy(w) {
  const x = Object.fromEntries(fields.map(k => [k, 0]));
  for (const v of w.state.vehicles ?? []) {
    if (v.background) continue;
    const active = v.operation && (w.state.operations ?? []).some(o => o.id === v.operation && !terminal.has(o.state));
    if (active || !['idle', 'arrived', 'failed', 'cancelled'].includes(v.state) || (v.load ?? 0) > 0 || (v.passengers ?? 0) > 0) x.vehicleCommittedMs++;
    if (v.edge && v.state === 'en_route') x.vehicleMovingMs++;
    if (v.state === 'waiting') x.vehicleWaitingMs++;
    if (v.state === 'blocked') x.vehicleBlockedMs++;
    if (v.resourceType === 'staff' && (v.load ?? 0) > 0) x.staffTransitPersonMs += v.load;
  }
  for (const r of w.state.resources ?? []) if (r.type === 'staff') x.staffCommittedPersonMs += Math.max(0, r.reserved ?? 0);
  x.staffCommittedPersonMs += x.staffTransitPersonMs;
  const working = [ ...(w.state.inspections ?? []).filter(i => i.state === 'inspecting'), ...(w.state.repairs ?? []).filter(t => t.state === 'working') ];
  for (const task of working) {
    const c = (w.state.commitments ?? []).find(c => c.id === task.staff && c.state === 'confirmed');
    if (c) x.staffFieldWorkPersonMs += c.quantity;
  }
  return x;
}
export function integrateUtilization(w, at) {
  if (!Number.isSafeInteger(at) || at < w.now) throw Error('Utilization time must be a current or next source clock');
  const u = w.state.statistics.utilization ??= { lastAt: w.now, ...Object.fromEntries(fields.map(k => [k, 0])) };
  if (at < u.lastAt) throw Error('Utilization clock cannot regress');
  const elapsed = at - u.lastAt;
  if (elapsed) {
    const count = occupancy(w);
    for (const key of fields) u[key] += count[key] * elapsed;
    u.lastAt = at;
  }
}
export function utilizationMetrics(w) {
  const u = w.state.statistics.utilization;
  if (!u) return { available: false, reason: 'Checkpoint predates utilization instrumentation', definition: 'Unknown is not zero.' };
  const elapsed = Math.max(0, w.now - u.lastAt), count = elapsed ? occupancy(w) : null;
  const measured = Object.fromEntries(fields.map(k => [k, u[k] + (count ? count[k] * elapsed : 0)]));
  return { available: true, ...measured,
    vehicleCommittedHours: measured.vehicleCommittedMs / 3600000,
    vehicleMovingHours: measured.vehicleMovingMs / 3600000,
    staffCommittedPersonHours: measured.staffCommittedPersonMs / 3600000,
    staffTransitPersonHours: measured.staffTransitPersonMs / 3600000,
    staffFieldWorkPersonHours: measured.staffFieldWorkPersonMs / 3600000,
    definition: 'Piecewise source-clock integrals. Vehicle commitment includes preparation, handling, queue, blockage, cargo and actual return; idle/empty arrived capacity and background traffic are excluded. Staff commitment counts reserved people plus physical staff cargo once. Field work counts only assigned inspections/repairs in working phase. These are separate scopes, not sums of independent productive labor, wages or all responder work.' };
}
