import { pointAlong } from './geometry.js';

const clamp = (x) => Math.max(0, Math.min(1, x));
function currentPoint(vehicle, now, nodes, edges) {
  const node = nodes.get(vehicle.node);
  const edge = edges.get(vehicle.edge);
  if (!edge || !node) return node ? { x: node.x, z: node.z } : null;
  return pointAlong(
    edge.points ?? [nodes.get(edge.from), nodes.get(edge.to)],
    clamp((now - vehicle.edgeStart) / Math.max(1, vehicle.edgeEnd - vehicle.edgeStart)),
  );
}
export function confirmedPath(previous, next, before, after, nodes, edges) {
  const a = currentPoint(previous, before, nodes, edges),
    b = currentPoint(next, after, nodes, edges);
  if (!a || !b) return null;
  if (a.x === b.x && a.z === b.z) return [a, b];
  const startingTrip = !previous.edge && edges.get(next.route?.[0])?.from === previous.node;
  const oldIndex = startingTrip ? 0 : (previous.routeIndex ?? 0),
    newIndex = next.routeIndex ?? 0;
  if (
    (!previous.edge && !startingTrip) ||
    newIndex < oldIndex ||
    (!startingTrip && JSON.stringify(previous.route) !== JSON.stringify(next.route))
  )
    return null;
  const path = [a];
  for (let i = oldIndex; i <= newIndex; i++) {
    const edge = edges.get((startingTrip ? next.route : previous.route)?.[i]);
    if (!edge) {
      if (i === newIndex && !next.edge) break;
      return null;
    }
    const points = edge.points ?? [nodes.get(edge.from), nodes.get(edge.to)];
    const start =
      i === oldIndex && !startingTrip
        ? clamp((before - previous.edgeStart) / Math.max(1, previous.edgeEnd - previous.edgeStart))
        : 0;
    const end =
      i === newIndex && next.edge
        ? clamp((after - next.edgeStart) / Math.max(1, next.edgeEnd - next.edgeStart))
        : 1;
    // Keep only the portion between the two confirmed snapshot positions.
    let length = 0;
    const distances = [0];
    for (let j = 1; j < points.length; j++) {
      length += Math.hypot(points[j].x - points[j - 1].x, points[j].z - points[j - 1].z);
      distances.push(length);
    }
    for (let j = 1; j < points.length; j++)
      if (distances[j] / length > start && distances[j] / length < end) path.push(points[j]);
    path.push(i === newIndex ? b : points.at(-1));
  }
  return path;
}
export class MotionBuffer {
  constructor() {
    this.tracks = new Map();
    this.previous = null;
    this.receivedAt = 0;
    this.interval = 1000;
  }
  reset() {
    this.tracks.clear();
    this.previous = null;
  }
  accept(snapshot, receivedAt, perspective = 'truth') {
    const nodes = new Map(snapshot.state.map.nodes.map((n) => [n.id, n]));
    const edges = new Map(snapshot.state.map.edges.map((e) => [e.id, e]));
    const truth = perspective === 'truth';
    const vehicles = truth
      ? snapshot.state.vehicles
      : Object.values(snapshot.state.observations[perspective]?.vehicles ?? {});
    this.interval = Math.max(150, Math.min(1600, receivedAt - this.receivedAt || 1000));
    this.receivedAt = receivedAt;
    const older = this.previous;
    this.tracks.clear();
    for (const v of vehicles) {
      const target = truth ? currentPoint(v, snapshot.now, nodes, edges) : nodes.get(v.node);
      if (!target) continue;
      const prior = older?.vehicles.get(v.id);
      // GPS-only organization views do not invent movement between reports.
      const path =
        truth && older?.perspective === perspective && prior && snapshot.now >= older.now
          ? confirmedPath(prior, v, older.now, snapshot.now, nodes, edges)
          : null;
      this.tracks.set(v.id, { path, target: { x: target.x, z: target.z } });
    }
    this.previous = {
      perspective,
      now: snapshot.now,
      vehicles: new Map(vehicles.map((v) => [v.id, v])),
    };
  }
  point(id, wallTime, { paused = false, reducedMotion = false } = {}) {
    const track = this.tracks.get(id);
    if (!track) return null;
    if (!track.path || paused || reducedMotion) return track.target;
    return pointAlong(track.path, clamp((wallTime - this.receivedAt) / this.interval));
  }
}
