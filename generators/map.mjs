import { keyedRandom, integerDraw, digest } from '../engine/determinism.mjs';

export function generateMap(c) {
  const nodes = [],
    edges = [],
    buildings = [],
    sectors = [],
    step = (c.extentKm * 1000) / (c.grid - 1);
  const r = (stream, id, event) =>
    keyedRandom(c.subsystemSeeds?.[stream] ?? c.seed, stream, id, event);
  for (let z = 0; z < c.grid; z++)
    for (let x = 0; x < c.grid; x++) {
      const id = `n${z * c.grid + x}`,
        position = {
          x: Math.round(
            (x +
              (c.topology === 'regional' && x > 0 && x < c.grid - 1
                ? (r('map', id, 'jitter_x') - 0.5) * 0.55
                : 0)) *
              step,
          ),
          z: Math.round(
            (z +
              (c.topology === 'regional' && z > 0 && z < c.grid - 1
                ? (r('map', id, 'jitter_z') - 0.5) * 0.55
                : 0)) *
              step,
          ),
        };
      nodes.push({ id, ...position });
      sectors.push({
        id: `s${z * c.grid + x}`,
        node: id,
        ...position,
        name: `${['North', 'East', 'South', 'West'][Math.floor(r('map', id, 'name') * 4)]} ${['Ridge', 'Valley', 'Crossing', 'Hill'][Math.floor(r('map', id, 'alias') * 4)]}`,
        locality: `district-${Math.floor(z / Math.max(1, Math.floor(c.grid / 4)))}-${Math.floor(x / Math.max(1, Math.floor(c.grid / 4)))}`,
        jurisdiction: `org${Math.min(c.organizations - 1, (x < c.grid / 2 ? 0 : 1) + (z < c.grid / 2 ? 0 : 2))}`,
        terrain:
          r('map', id, 'terrain') < 0.2
            ? 'forest'
            : r('map', id, 'terrain') < 0.5
              ? 'rural'
              : 'urban',
        population: c.populationPerSector,
        coverage: 1,
        energy: true,
        channels: { internet: true, cellular: true, landline: true, radio: true },
        battery: 100,
      });
      const usage = r('map', id, 'usage');
      buildings.push({
        id: `b${z * c.grid + x}`,
        node: id,
        sector: `s${z * c.grid + x}`,
        x: position.x + step * 0.15,
        z: position.z + step * 0.14,
        height: integerDraw(c.seed, 'map', id, 'height', 8, 40),
        width: Math.max(12, step * 0.12),
        use:
          usage < 0.1
            ? 'school'
            : usage < 0.17
              ? 'clinic'
              : usage < 0.24
                ? 'warehouse'
                : 'residential',
        damage: 0,
        version: 1,
        assessed: false,
        capacity: usage < 0.1 ? 120 : 0,
        state: 'intact',
        dependencies: { water: 60, sanitation: 1, staff: 2, energy: 1 },
        provisioned: { water: 0, sanitation: 0, staff: 0, energy: 0 },
        occupancy: 0,
        reservedPlaces: 0,
        unloadCapacity: 2,
        unloading: 0,
        storageCapacity: 10000,
        receiverAvailable: true,
        requiredPower: { powerKw: 10, connector: 'A' },
      });
    }
  for (let z = 0; z < c.grid; z++)
    for (let x = 0; x < c.grid; x++)
      for (const [dx, dz] of [
        [1, 0],
        [0, 1],
      ]) {
        if (x + dx >= c.grid || z + dz >= c.grid) continue;
        const from = `n${z * c.grid + x}`,
          to = `n${(z + dz) * c.grid + x + dx}`,
          key = `${from}-${to}`;
        const arterial = x === Math.floor(c.grid / 2) || z === Math.floor(c.grid / 2);
        for (const [a, b] of [
          [from, to],
          [to, from],
        ])
          edges.push({
            id: `${a}:${b}`,
            from: a,
            to: b,
            lengthM: Math.round(
              Math.hypot(
                nodes[Number(a.slice(1))].x - nodes[Number(b.slice(1))].x,
                nodes[Number(a.slice(1))].z - nodes[Number(b.slice(1))].z,
              ),
            ),
            speedMps: arterial ? 16 : 10,
            capacity: arterial ? 8 : 3,
            storage: arterial ? 14 : 6,
            headwayMs: arterial ? 2500 : 7000,
            maxWeight: arterial
              ? 20000
              : c.topology === 'regional' && r('map', key, 'narrow') < 0.15
                ? 3700
                : 5000,
            slope: c.topology === 'regional' ? Math.round(r('map', key, 'slope') * 12) : 0,
            roadClass: arterial ? 'arterial' : 'local',
            open: true,
            waterDepth: 0,
            nextEntryAt: 0,
            occupants: [],
            waiting: [],
            version: 1,
            bridge: r('map', key, 'bridge') < 0.04,
          });
      }
  const corner = [0, c.grid - 1, c.grid * (c.grid - 1), c.grid * c.grid - 1];
  const organizations = Array.from({ length: c.organizations }, (_, i) => ({
    id: `org${i}`,
    name:
      ['Local Response', 'Relief Team', 'Medical Team', 'Regional NGO'][i] ?? `Partner ${i + 1}`,
    node: `n${corner[i % 4]}`,
    operators: c.operatorCount,
    reviewSlots: Array(c.operatorCount).fill(0),
    sharing: i === c.organizations - 1 ? 'partial' : 'public',
    usesPlatform: i !== 4,
    version: 1,
    funds: c.funds,
    policy: { reserveWater: c.reservedWater, priority: 'urgency_then_age' },
    connected: true,
  }));
  const central = Math.floor(nodes.length / 2),
    shelter = buildings[Math.min(nodes.length - 1, central + 1)];
  shelter.use = 'shelter';
  shelter.capacity = 300;
  shelter.state = 'candidate';
  shelter.damage = 0;
  const plant = buildings[Math.max(0, central - c.grid)];
  plant.use = 'plant';
  plant.capacity = 1000;
  plant.state = 'offline';
  plant.dependencies = { energy: 1, staff: 1 };
  plant.provisioned = { energy: 0, staff: 0 };
  return {
    nodes,
    edges,
    buildings,
    sectors,
    organizations,
    shelterId: shelter.id,
    plantId: plant.id,
    extentM: c.extentKm * 1000,
    grid: c.grid,
    hash: digest({ nodes, edges, buildings, organizations }),
  };
}

const routeIndexes = new WeakMap();
export function route(map, from, to, vehicle, knownEdges = null) {
  if (from === to) return { edges: [], distanceM: 0, freeTimeMs: 0 };
  let index = routeIndexes.get(map);
  if (!index || index.length !== map.edges.length) {
    const adjacency = new Map(),
      byId = new Map();
    for (const e of map.edges) {
      if (!adjacency.has(e.from)) adjacency.set(e.from, []);
      adjacency.get(e.from).push(e);
      byId.set(e.id, e);
    }
    index = { length: map.edges.length, adjacency, byId };
    routeIndexes.set(map, index);
  }
  const { adjacency, byId } = index;
  const dist = new Map([[from, 0]]),
    prev = new Map(),
    heap = [{ node: from, cost: 0 }];
  const push = (v) => {
    heap.push(v);
    let i = heap.length - 1;
    while (i) {
      const p = (i - 1) >> 1;
      if (heap[p].cost <= v.cost) break;
      heap[i] = heap[p];
      i = p;
    }
    heap[i] = v;
  };
  const pop = () => {
    const h = heap[0],
      tail = heap.pop();
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let child = i * 2 + 1;
        if (child + 1 < heap.length && heap[child + 1].cost < heap[child].cost) child++;
        if (tail.cost <= heap[child].cost) break;
        heap[i] = heap[child];
        i = child;
      }
      heap[i] = tail;
    }
    return h;
  };
  while (heap.length) {
    const item = pop();
    if (item.cost !== dist.get(item.node)) continue;
    if (item.node === to) break;
    for (const edge of adjacency.get(item.node) ?? []) {
      const view = knownEdges ? (knownEdges[edge.id] ?? { open: true, waterDepth: 0 }) : edge;
      if (
        !view.open ||
        vehicle.weightKg +
          (vehicle.load ?? 0) * (vehicle.resourceType === 'energy' ? 150 : 1) +
          (vehicle.passengers ?? 0) * 75 >
          edge.maxWeight ||
        view.waterDepth > (vehicle.maxWaterDepth ?? 0.3)
      )
        continue;
      const next =
        item.cost +
        Math.ceil((edge.lengthM / Math.min(edge.speedMps, vehicle.speedMps)) * 1000) +
        (view.congestionMs ?? 0);
      if (next < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, next);
        prev.set(edge.to, edge);
        push({ node: edge.to, cost: next });
      }
    }
  }
  if (!dist.has(to)) return null;
  const path = [];
  let at = to;
  while (at !== from) {
    const e = prev.get(at);
    if (!e) return null;
    path.unshift(e.id);
    at = e.from;
  }
  return {
    edges: path,
    distanceM: path.reduce((sum, id) => sum + byId.get(id).lengthM, 0),
    freeTimeMs: dist.get(to),
  };
}
