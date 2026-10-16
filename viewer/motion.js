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
  constructor({ expectedInterval = 750, maxDuration = 1400, maxPathPoints = 512 } = {}) {
    this.tracks = new Map();
    this.previous = null;
    this.receivedAt = 0;
    this.expectedInterval = expectedInterval;
    this.interval = expectedInterval;
    this.maxDuration = maxDuration;
    this.maxPathPoints = maxPathPoints;
    this.cadence = [];
  }
  reset() {
    this.tracks.clear();
    this.previous = null;
    this.receivedAt = 0;
    this.interval = this.expectedInterval;
    this.cadence = [];
  }
  accept(snapshot, receivedAt, perspective = 'truth') {
    const nodes = new Map(snapshot.state.map.nodes.map((n) => [n.id, n]));
    const edges = new Map(snapshot.state.map.edges.map((e) => [e.id, e]));
    const truth = perspective === 'truth';
    const vehicles = truth
      ? snapshot.state.vehicles
      : Object.values(snapshot.state.observations[perspective]?.vehicles ?? {});
    let older = this.previous;
    const gap = older ? receivedAt - older.receivedAt : 0;
    const discontinuity =
      older &&
      (snapshot.runId !== older.runId ||
        snapshot.now < older.now ||
        perspective !== older.perspective ||
        snapshot.state.map.hash !== older.mapHash ||
        gap < 0 ||
        gap > 3000);
    if (discontinuity) {
      this.reset();
      older = null;
    }
    // Cached frames may repeat the same simulation instant. They do not restart
    // an animation or distort the measured cadence of genuinely new samples.
    const advanced = older && snapshot.now > older.now;
    if (advanced && gap > 0) {
      this.cadence.push(gap);
      if (this.cadence.length > 8) this.cadence.shift();
      const sorted = this.cadence.slice().sort((a, b) => a - b);
      const expected = sorted[Math.floor((sorted.length - 1) * 0.75)];
      this.interval += (expected - this.interval) * 0.35;
    }
    const duration = Math.max(100, Math.min(this.maxDuration, this.interval * 1.08));
    const nextTracks = new Map();
    for (const v of vehicles) {
      const target = truth ? currentPoint(v, snapshot.now, nodes, edges) : nodes.get(v.node);
      if (!target) continue;
      const prior = older?.vehicles.get(v.id);
      const existing = this.tracks.get(v.id);
      if (
        older &&
        !advanced &&
        snapshot.playing !== false &&
        existing &&
        samePoint(existing.target, target)
      ) {
        nextTracks.set(v.id, existing);
        continue;
      }
      // GPS-only organization views do not invent movement between reports.
      let path =
        truth && advanced && prior && snapshot.playing !== false
          ? confirmedPath(prior, v, older.now, snapshot.now, nodes, edges)
          : null;
      if (path && existing?.path && samePoint(existing.target, path[0])) {
        // Retarget from the position already on screen, following the remaining
        // confirmed road bends. Never jump forward to the previous chunk's end.
        const remainder = remainingPath(existing, receivedAt);
        path = remainder.concat(path.slice(1));
      }
      // There is one replaceable target per vehicle, not a queue of snapshots.
      // A huge skipped interval snaps to the latest fact rather than playing an
      // arbitrarily long journey or simplifying it into an off-road shortcut.
      if (path?.length > this.maxPathPoints) path = null;
      const geometry = path ? measurePath(path) : null;
      nextTracks.set(v.id, {
        path: geometry?.length ? geometry.points : null,
        distances: geometry?.distances,
        length: geometry?.length,
        target: { x: target.x, z: target.z },
        receivedAt,
        duration,
      });
    }
    this.tracks = nextTracks;
    this.receivedAt = receivedAt;
    this.previous = {
      perspective,
      runId: snapshot.runId,
      mapHash: snapshot.state.map.hash,
      now: snapshot.now,
      // Keep only the motion fields, detached from subsequent snapshot merges.
      vehicles: new Map(
        vehicles.map((v) => [
          v.id,
          {
            node: v.node,
            edge: v.edge,
            edgeStart: v.edgeStart,
            edgeEnd: v.edgeEnd,
            route: v.route?.slice(),
            routeIndex: v.routeIndex,
          },
        ]),
      ),
      receivedAt: advanced || !older ? receivedAt : older.receivedAt,
    };
  }
  point(id, wallTime, { paused = false, reducedMotion = false } = {}) {
    const track = this.tracks.get(id);
    if (!track) return null;
    if (paused || reducedMotion) {
      track.path = null;
      return track.target;
    }
    if (!track.path) return track.target;
    return sampleTrack(track, wallTime).point;
  }
}

const samePoint = (a, b) => !!a && !!b && Math.abs(a.x - b.x) + Math.abs(a.z - b.z) < 1e-7;

function measurePath(path) {
  const points = [path[0]],
    distances = [0];
  let length = 0;
  for (const point of path.slice(1)) {
    const previous = points.at(-1);
    const distance = Math.hypot(point.x - previous.x, point.z - previous.z);
    if (!distance) continue;
    length += distance;
    points.push(point);
    distances.push(length);
  }
  return { points, distances, length };
}

function sampleTrack(track, wallTime) {
  const distance = clamp((wallTime - track.receivedAt) / track.duration) * track.length;
  let low = 1,
    high = track.distances.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (track.distances[middle] < distance) low = middle + 1;
    else high = middle;
  }
  const a = track.path[low - 1],
    b = track.path[low];
  const fraction =
    (distance - track.distances[low - 1]) / (track.distances[low] - track.distances[low - 1]);
  return {
    index: low,
    point: { x: a.x + (b.x - a.x) * fraction, z: a.z + (b.z - a.z) * fraction },
  };
}

function remainingPath(track, wallTime) {
  const current = sampleTrack(track, wallTime);
  return [current.point, ...track.path.slice(current.index)];
}
