import { keyedRandom, integerDraw, digest } from '../engine/determinism.mjs';
import { regionalRoads, riverX } from './region.mjs';
import { honmuraRoads } from './honmura.mjs';
import { takamatsuRoads } from './takamatsu.mjs';

export function generateMap(c) {
  if (c.topology === 'honmura') return generateHonmuraMap(c);
  if (c.topology === 'takamatsu') return generateTakamatsuMap(c);
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
                ? (r('map', id, 'jitter_x') - 0.5) * 1.7
                : 0)) *
              step,
          ),
          z: Math.round(
            (z +
              (c.topology === 'regional' && z > 0 && z < c.grid - 1
                ? (r('map', id, 'jitter_z') - 0.5) * 1.7
                : 0)) *
              step,
          ),
        };
      if (c.topology === 'regional') {
        const river = riverX(c.extentKm * 1000, position.z),
          setback = c.extentKm * 1000 * 0.015;
        if (Math.abs(position.x - river) < setback)
          position.x = river + (position.x < river ? -setback : setback);
        position.x = Math.round(position.x);
      }
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
        width: Math.max(12, Math.min(350, step * 0.12)),
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
        unloadingCount: 0,
        storageCapacity: 10000,
        receiverAvailable: true,
        requiredPower: { powerKw: 10, connector: 'A' },
      });
    }
  if (c.topology === 'grid')
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
  const geography =
    c.topology === 'regional'
      ? regionalRoads(nodes, c, r)
      : { edges: [], crossings: [], river: null };
  edges.push(...geography.edges);
  const corner = [0, c.grid - 1, c.grid * (c.grid - 1), c.grid * c.grid - 1];
  const orgNodes = new Set();
  const orgNode = (i) => {
    if (i < 4) {
      orgNodes.add(`n${corner[i]}`);
      return `n${corner[i]}`;
    }
    const x = (0.2 + (i % 3) * 0.3) * c.extentKm * 1000,
      z = (0.22 + (Math.floor(i / 3) % 3) * 0.26) * c.extentKm * 1000;
    const n = [...nodes]
      .filter((n) => !orgNodes.has(n.id))
      .sort(
        (a, b) =>
          Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z) ||
          a.id.localeCompare(b.id, 'en'),
      )[0];
    orgNodes.add(n.id);
    return n.id;
  };
  const organizations = Array.from({ length: c.organizations }, (_, i) => ({
    id: `org${i}`,
    name:
      ['Relief North', 'Community East', 'Rescue South', 'Medical West', 'Independent Contractor'][i] ?? `Response Partner ${i + 1}`,
    node: orgNode(i),
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
  shelter.requiredStaffSkills = ['shelter_support'];
  shelter.state = 'candidate';
  shelter.damage = 0;
  const plant = buildings[Math.max(0, central - c.grid)];
  plant.use = 'plant';
  plant.capacity = 1000;
  plant.requiredStaffSkills = ['water_operations'];
  plant.state = 'offline';
  plant.dependencies = { energy: 1, staff: 1 };
  plant.provisioned = { energy: 0, staff: 0 };
  const placeCounts = new Map(),
    sectorsById = new Map(sectors.map((sector) => [sector.id, sector])),
    nodesById = new Map(nodes.map((node) => [node.id, node]));
  for (const building of buildings) {
    const sector = sectorsById.get(building.sector);
    const type = { residential: 'Community', school: 'School', clinic: 'Clinic', warehouse: 'Warehouse', shelter: 'Shelter', plant: 'Water Plant', depot: 'Depot' }[building.use] ?? 'Facility';
    const base = `${sector.name} ${type}`;
    const ordinal = (placeCounts.get(base) ?? 0) + 1;
    placeCounts.set(base, ordinal);
    building.name = ordinal > 1 ? `${base} ${ordinal}` : base;
    nodesById.get(building.node).name = `${building.name} Junction`;
  }
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
    topology: c.topology,
    crossings: geography.crossings,
    river: geography.river,
    hash: digest({ nodes, edges, buildings, organizations, river: geography.river }),
  };
}

// Reuse the same synthetic facility/resource parameters as the procedural world,
// but replace the road geometry and connectivity with the fixed geographic graph.
// This does not turn real homes or landmarks into real response facilities.
function generateHonmuraMap(c) {
  const geography = honmuraRoads();
  const map = generateMap({ ...c, topology: 'grid', grid: 7, extentKm: 1 });
  map.nodes = geography.nodes;
  map.edges = geography.edges;
  map.buildings = map.buildings.slice(0, map.nodes.length);
  map.sectors = map.sectors.slice(0, map.nodes.length);
  for (let index = 0; index < map.nodes.length; index++) {
    const node = map.nodes[index], building = map.buildings[index], sector = map.sectors[index];
    Object.assign(sector, { x: node.x, z: node.z, name: `Honmura District ${String(index + 1).padStart(2, '0')}`,
      locality: 'honmura-demo', jurisdiction: `org${Math.min(c.organizations - 1, (node.x < 300 ? 0 : 1) + (node.z < 400 ? 0 : 2))}`,
      terrain: 'urban' });
    const use = { residential: 'Community', school: 'School', clinic: 'Clinic', warehouse: 'Warehouse', shelter: 'Shelter', plant: 'Water Plant' }[building.use] ?? 'Facility';
    Object.assign(building, { x: node.x + 8, z: node.z + 8,
      width: 10, height: 6 + (index % 4) * 3,
      name: `Honmura Demo ${use}${['shelter', 'plant'].includes(building.use) ? '' : ` ${String(index + 1).padStart(2, '0')}`}`,
      synthetic: true });
  }
  const occupied = new Set();
  for (let i = 0; i < map.organizations.length; i++) {
    const target = [
      [130,450], [440,290], [400,680], [290,420],
    ][i] ?? [100 + (i % 3) * 150, 300 + Math.floor(i / 3) * 70];
    const node = map.nodes.filter(n=>!occupied.has(n.id)).sort((a,b)=>
      Math.hypot(a.x-target[0],a.z-target[1])-Math.hypot(b.x-target[0],b.z-target[1]) || a.id.localeCompare(b.id))[0];
    occupied.add(node.id);
    map.organizations[i].node = node.id;
  }
  Object.assign(map, { topology: 'honmura', extentM: 1000, grid: 7, river: null, crossings: [],
    geography: geography.source,
    hazardProfile: { kind: 'synthetic_coastal', center: { x: geography.nodes.find(n => n.name === 'Honmura Port approach').x, z: geography.nodes.find(n => n.name === 'Honmura Port approach').z }, radiusM: 95 } });
  map.hash = digest({ nodes: map.nodes, edges: map.edges, buildings: map.buildings,
    organizations: map.organizations, geography: map.geography });
  return map;
}

// A city-sized street graph and community sites are separate layers. Each site
// represents a synthetic group of residents/facilities, not an actual OSM home.
// Keeping 4,300 sites makes the operational workload 100x Honmura's 43 sites
// without requiring an individual simulation object for every real resident.
function generateTakamatsuMap(c) {
  const geography = takamatsuRoads(), siteCount = 4300;
  const map = generateMap({ ...c, topology: 'grid', grid: 66, extentKm: 10 });
  map.nodes = geography.nodes;
  map.edges = geography.edges;
  map.buildings = map.buildings.slice(0, siteCount);
  map.sectors = map.sectors.slice(0, siteCount);
  const draw = (id, field) => keyedRandom(c.subsystemSeeds?.map ?? c.seed, 'map', id, field);
  for (let index = 0; index < siteCount; index++) {
    const building = map.buildings[index], sector = map.sectors[index];
    const node = map.nodes[Math.floor(index * map.nodes.length / siteCount)];
    const column = Math.min(9, Math.floor(node.x / 1000)), row = Math.min(9, Math.floor(node.z / 1000));
    const district = `${row < 3 ? 'North' : row > 6 ? 'South' : 'Central'} ${column < 3 ? 'West' : column > 6 ? 'East' : 'City'}`;
    Object.assign(sector, { node: node.id, x: node.x, z: node.z,
      name: `Takamatsu ${district}`, locality: `takamatsu-demo-${column}-${row}`,
      jurisdiction: `org${Math.min(c.organizations - 1, (column < 5 ? 0 : 1) + (row < 5 ? 0 : 2))}` });
    const use = { residential: 'Community', school: 'School', clinic: 'Clinic', warehouse: 'Warehouse', shelter: 'Shelter', plant: 'Water Plant' }[building.use] ?? 'Facility';
    const angle = draw(building.id, 'site_bearing') * Math.PI * 2;
    const setback = 15 + draw(building.id, 'site_setback') * 20;
    Object.assign(building, { node: node.id,
      x: Math.max(5, Math.min(9995, node.x + Math.cos(angle) * setback)),
      z: Math.max(5, Math.min(9995, node.z + Math.sin(angle) * setback)),
      width: 10 + Math.floor(draw(building.id, 'site_width') * 8),
      height: 8 + Math.floor(draw(building.id, 'site_height') * 24),
      name: `Takamatsu ${district} ${use} ${index + 1} (Demo)`, synthetic: true });
  }
  // Routing-only junctions still belong to a synthetic communication zone.
  // Otherwise a truck at one of these junctions would silently bypass outages.
  const coverageByNode = new Map(map.sectors.map(sector=>[sector.node,sector.id]));
  for (const node of map.nodes) {
    if (coverageByNode.has(node.id)) { node.coverageSectorId=coverageByNode.get(node.id); continue; }
    let nearest=null, distance=Infinity;
    for (const sector of map.sectors) {
      const next=(sector.x-node.x)**2+(sector.z-node.z)**2;
      if(next<distance) { nearest=sector;distance=next; }
    }
    node.coverageSectorId=nearest.id;
  }
  const occupied = new Set();
  for (let index = 0; index < map.organizations.length; index++) {
    const column = index % 4, row = Math.floor(index / 4);
    const target = [[2000,2000],[8000,2000],[2000,8000],[8000,8000]][index];
    const x = target?.[0] ?? (0.15 + column * 0.23) * 10000;
    const z = target?.[1] ?? (0.2 + row * 0.3) * 10000;
    let nearest = null, distance = Infinity;
    for (const node of map.nodes) {
      if (occupied.has(node.id)) continue;
      const next = Math.hypot(node.x - x, node.z - z);
      if (next < distance) { nearest = node; distance = next; }
    }
    occupied.add(nearest.id); map.organizations[index].node = nearest.id;
  }
  Object.assign(map, { topology: 'takamatsu', extentM: 10000, grid: 66,
    river: geography.river, crossings: geography.crossings, geography: geography.source,
    hazardProfile: { kind: 'synthetic_coastal', center: { x: 5000, z: 500 }, radiusM: 1100 } });
  map.hash = digest({ nodes: map.nodes, edges: map.edges, buildings: map.buildings,
    organizations: map.organizations, geography: map.geography });
  return map;
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
        grossVehicleWeight(vehicle) > edge.maxWeight ||
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
import { grossVehicleWeight } from '../contracts/cargo.mjs';
