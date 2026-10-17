// A separately allowlisted spectator contract. This is never an actor read
// model and must not be connected to an agent's source credentials.
const pick = (value, fields) => Object.fromEntries(fields.filter(k => value?.[k] !== undefined).map(k => [k, value[k]]));
const geometry = new WeakMap();
export function demoMap(map) {
  let value = geometry.get(map);
  if (value) return value;
  value = { ...pick(map, ['projectionId', 'hash', 'extentM', 'grid', 'topology']),
    geography: map.geography ? pick(map.geography, ['name', 'attribution', 'sourceUrl', 'license', 'bounds']) : null,
    nodes: map.nodes.map(n => pick(n, ['id', 'x', 'z'])),
    edges: map.edges.map(e => pick(e, ['id', 'from', 'to', 'points', 'corridor', 'name', 'roadClass', 'bridge'])),
    buildings: map.buildings.map(b => pick(b, ['id', 'name', 'node', 'x', 'z', 'height', 'width', 'use'])),
  };
  geometry.set(map, value);
  return value;
}
export function demoFrame(frame, { sourceInstance, feed, director, maxActive = 4 } = {}) {
  const teams = frame.mapState.organizations.filter(o => !o.demoRetired);
  const activeTeams = new Set(teams.map(o => o.id));
  const sourcePosts = (feed?.posts ?? []).slice(0, 12).map(p => pick(p, ['id', 'authorName', 'text',
    'format', 'publishedAt', 'location', 'locationName', 'claimedAt', 'media', 'references']));
  const publicIds = new Set(sourcePosts.map(p => p.id));
  const recentNeeds = new Set(frame.state.needs.slice(-100).map(n => n.id));
  return {
    schemaVersion: 1, mapId: frame.mapId, runId: frame.runId, episodeId: sourceInstance ?? frame.runId,
    now: frame.now, playing: frame.playing, rate: frame.rate, continuousDemo: frame.continuousDemo,
    simulated: true, spectatorOnly: true,
    organizations: teams.map(o => ({ ...pick(o, ['id', 'name', 'color', 'node', 'demoVisitor', 'joinedAt']),
      automated: !o.demoVisitor })),
    capacity: { active: teams.filter(o => o.demoVisitor).length, limit: maxActive },
    director: director ? pick(director, ['enabled', 'tick', 'intervalMs']) : undefined,
    mapState: { buildingFields: frame.mapState.buildingFields,
      buildings: frame.mapState.buildings, edges: frame.mapState.edges },
    vehicles: frame.state.vehicles.filter(v => v.background === true || activeTeams.has(v.owner)).map(v => pick(v,
      ['id', 'name', 'owner', 'node', 'background', 'edge', 'edgeStart', 'edgeEnd', 'route', 'routeIndex', 'state',
        'load', 'passengers', 'resourceType', 'eta', 'version', 'operation', 'destination'])),
    needs: frame.state.needs.filter(n => n.quantity > n.served || recentNeeds.has(n.id)).map(n => pick(n, ['id', 'building', 'type', 'quantity', 'served', 'unit',
      'version', 'deadline', 'priority', 'createdAt'])),
    totals: { services: frame.metrics?.services ?? {}, publishedPosts: feed?.total ?? 0 },
    operations: frame.state.operations.filter(o => activeTeams.has(o.org ?? o.owner)).map(o => pick(o,
      ['id', 'org', 'owner', 'vehicle', 'need', 'building', 'destination', 'resourceType', 'quantity', 'received', 'state', 'times', 'version'])),
    posts: sourcePosts,
    processing: frame.state.ingestion.filter(r => publicIds.has(r.id)).map(r => pick(r,
      ['id', 'org', 'stage', 'at', 'version'])).slice(-60),
  };
}
