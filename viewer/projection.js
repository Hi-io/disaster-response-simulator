// Join immutable geometry and a self-contained current frame. Frames may be
// coalesced by transport; no intermediate frame is required for correctness.
export function mergeViewerFrame(map, frame) {
  if (map.projectionId !== frame.mapId) throw new Error('The viewer map changed; reload its geometry');
  const dynamic = frame.mapState;
  const buildings = new Map(dynamic.buildings.map(([id, ...values]) => [id,
    Object.fromEntries(dynamic.buildingFields.map((key, i) => [key, values[i]]))]));
  const roads = new Map(dynamic.edges.map(([id, open, occupants, waiting]) => [id,
    { open, occupants: { length: occupants }, waiting: { length: waiting } }]));
  const sectors = new Map(dynamic.sectors);
  const cohorts = new Map(frame.cohorts.map(row => [row[0], row]));
  return {
    ...frame,
    state: {
      ...frame.state,
      cohorts: frame.perspective === 'truth' ? map.cohorts.map(base => {
        const [id, ...values] = cohorts.get(base[0]) ?? base;
        return { id, ...Object.fromEntries(frame.cohortFields.map((key, i) => [key, values[i]])) };
      }) : [],
      map: {
        ...map,
        buildings: map.buildings.map(b => ({ ...b, ...buildings.get(b.id) })),
        edges: map.edges.map(e => ({ ...e, open: true, occupants: { length: 0 }, waiting: { length: 0 }, ...roads.get(e.id) })),
        sectors: map.sectors.map(s => ({ ...s, coverage: sectors.get(s.id) ?? 1 })),
        organizations: dynamic.organizations,
      },
    },
  };
}
