import { trafficLevel } from './presentation.js';

// Presentation-only indexes. They neither infer road permissions nor change routing.
export function roadCorridors(edges) {
  const groups = new Map();
  for (const edge of edges) {
    const endpoints = [String(edge.from), String(edge.to)].sort();
    // Explicit corridor IDs keep parallel mapped streets distinct. Endpoints
    // also prevent an OSM way spanning several junctions from being collapsed.
    const key = JSON.stringify([edge.corridor ?? null, ...endpoints]);
    let group = groups.get(key);
    if (!group) {
      group = { key, edge, edges: [] };
      groups.set(key, group);
    }
    group.edges.push(edge);
  }
  return [...groups.values()];
}

export function corridorTrafficLevel(ids, edgeIndex, observations = null, truth = true) {
  const levels = ['unknown', 'clear', 'slow', 'heavy', 'closed'];
  let severity = 0;
  for (const id of ids) {
    const edge = edgeIndex.get(id);
    if (edge) severity = Math.max(severity, levels.indexOf(trafficLevel(edge, observations?.[id], truth)));
  }
  return levels[severity];
}

export function visibleRoutePlans(snapshot, perspective = 'truth') {
  // Preserve the existing privacy boundary: route overlays belong to the
  // observer. Actor vehicle positions continue to use received telemetry.
  if (perspective !== 'truth') return [];
  return snapshot.state.vehicles
    .filter(v => !v.background && v.route?.length &&
      ['en_route', 'dispatched', 'queued', 'spillback', 'blocked'].includes(v.state))
    .map(v => ({ id: v.id, edges: v.route.slice(v.routeIndex ?? 0) }));
}

export function routeOverlayKey(snapshot, perspective = 'truth') {
  return JSON.stringify([snapshot.runId, perspective, visibleRoutePlans(snapshot, perspective)]);
}

export function fixedTopologyProfile(topology) {
  if (topology === 'honmura') return {
    grid: 7, extentKm: 1,
    hint: 'Fixed Honmura town core · 43 mapped junctions. Buildings, facilities and emergencies are synthetic.',
  };
  if (topology === 'takamatsu') return {
    grid: 66, extentKm: 10,
    hint: 'Takamatsu · 100 km² · 4,300 synthetic community sites on a real strategic road network. Sites, facilities and emergencies are modelled, not actual buildings.',
  };
  return null;
}
