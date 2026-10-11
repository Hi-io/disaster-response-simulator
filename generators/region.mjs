// A connected road graph within each river bank, with deliberately scarce crossings.
// Geometric detail is independent of the causal graph; no grid edges are added here.
export const riverX = (extent, z) =>
  extent * (0.49 + 0.075 * Math.sin((z / extent) * Math.PI * 2.3));

export function regionalRoads(nodes, c, r) {
  const extent = c.extentKm * 1000,
    step = extent / (c.grid - 1),
    edges = [];
  const bank = (n) => (n.x < riverX(extent, n.z) ? 'west' : 'east');
  const candidates = new Map(),
    buckets = new Map();
  const cell = (n) => [Math.floor(n.x / step), Math.floor(n.z / step)];
  for (const n of nodes) {
    n.bank = bank(n);
    const [x, z] = cell(n),
      key = `${n.bank}:${x}:${z}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(n);
  }
  for (const n of nodes) {
    const [x, z] = cell(n),
      nearby = [];
    for (let dx = -3; dx <= 3; dx++)
      for (let dz = -3; dz <= 3; dz++)
        for (const other of buckets.get(`${n.bank}:${x + dx}:${z + dz}`) ?? [])
          if (other.id !== n.id)
            nearby.push({ a: n, b: other, d: Math.hypot(n.x - other.x, n.z - other.z) });
    nearby.sort((a, b) => a.d - b.d || a.b.id.localeCompare(b.b.id, 'en'));
    for (const candidate of nearby.slice(0, 8)) {
      const [a, b] = [n, candidate.b].sort((a, b) => a.id.localeCompare(b.id, 'en'));
      candidates.set(`${a.id}:${b.id}`, { a, b, d: candidate.d });
    }
  }
  const parent = new Map(nodes.map((n) => [n.id, n.id]));
  const find = (id) => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root);
    while (id !== root) {
      const next = parent.get(id);
      parent.set(id, root);
      id = next;
    }
    return root;
  };
  const selected = new Map();
  const sorted = [...candidates.entries()].sort(
    (a, b) => a[1].d - b[1].d || a[0].localeCompare(b[0], 'en'),
  );
  for (const [key, p] of sorted)
    if (find(p.a.id) !== find(p.b.id)) {
      parent.set(find(p.a.id), find(p.b.id));
      selected.set(key, p);
    }
  // Sparse redundancy preserves dead ends and single-access villages. It cannot cross water.
  for (const [key, p] of sorted)
    if (!selected.has(key) && r('map', key, 'redundancy') < 0.1) selected.set(key, p);
  // Rare disconnected point-cloud components are joined within their own bank.
  for (const side of ['west', 'east']) {
    const members = nodes.filter((n) => n.bank === side);
    const roots = [...new Set(members.map((n) => find(n.id)))];
    for (let i = 1; i < roots.length; i++) {
      const a = members.find((n) => find(n.id) === roots[i]),
        b = members.find((n) => find(n.id) === find(roots[0]));
      if (a && b) {
        selected.set(`${a.id}:${b.id}`, { a, b, d: Math.hypot(a.x - b.x, a.z - b.z) });
        parent.set(find(a.id), find(b.id));
      }
    }
  }
  const add = (a, b, d, bridge = false, crossing = null) => {
    const key = [a.id, b.id].sort().join(':'),
      draw = r('map', key, 'road_profile');
    const roadClass = bridge
      ? 'bridge'
      : draw < 0.12
        ? 'highway'
        : draw < 0.4
          ? 'secondary'
          : draw > 0.84
            ? 'mountain'
            : 'local';
    const profile = {
      highway: [23, 10, 20, 1800, 30000],
      secondary: [14, 5, 10, 4000, 15000],
      local: [8, 2, 5, 10000, 12000],
      mountain: [4.5, 1, 3, 18000, 5000],
      bridge: [10, 1, 4, 15000, 12000],
    }[roadClass];
    const mid = {
      x: Math.round((a.x + b.x) / 2 + (b.z - a.z) * (r('map', key, 'bend') - 0.5) * 0.18),
      z: Math.round((a.z + b.z) / 2 + (a.x - b.x) * (r('map', key, 'bend') - 0.5) * 0.18),
    };
    // Same-bank waypoints stay on land, including river bends.
    if (!bridge)
      mid.x =
        a.bank === 'west'
          ? Math.min(mid.x, riverX(extent, mid.z) - extent * 0.014)
          : Math.max(mid.x, riverX(extent, mid.z) + extent * 0.014);
    const lengthM = Math.round(
      (Math.hypot(a.x - mid.x, a.z - mid.z) + Math.hypot(b.x - mid.x, b.z - mid.z)) *
        (roadClass === 'mountain' ? 1.7 : 1.12),
    );
    for (const [from, to, points] of [
      [a, b, [{ x: a.x, z: a.z }, mid, { x: b.x, z: b.z }]],
      [b, a, [{ x: b.x, z: b.z }, mid, { x: a.x, z: a.z }]],
    ])
      edges.push({
        id: `${from.id}:${to.id}`,
        from: from.id,
        to: to.id,
        lengthM,
        speedMps: profile[0],
        capacity: profile[1],
        storage: profile[2],
        headwayMs: profile[3],
        maxWeight: roadClass === 'local' && r('map', key, 'narrow') < 0.15 ? 3700 : profile[4],
        slope:
          roadClass === 'mountain'
            ? 8 + Math.round(r('map', key, 'slope') * 8)
            : Math.round(r('map', key, 'slope') * 5),
        roadClass,
        bridge,
        crossing,
        corridor: key,
        points,
        open: true,
        waterDepth: 0,
        nextEntryAt: 0,
        occupants: [],
        waiting: [],
        version: 1,
        trafficDemand: Math.round(20 + r('traffic', key, 'demand') * 80),
      });
  };
  for (const p of selected.values()) add(p.a, p.b, p.d);
  const used = new Set(),
    crossings = [];
  const count = Math.min(c.bridgeCount, Math.floor(nodes.length / 2));
  for (let i = 0; i < count; i++) {
    const z = extent * (count === 1 ? 0.5 : 0.1 + (0.8 * i) / (count - 1)),
      x = riverX(extent, z);
    const nearest = (side) =>
      nodes
        .filter((n) => n.bank === side && !used.has(n.id))
        .sort(
          (a, b) =>
            Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z) ||
            a.id.localeCompare(b.id, 'en'),
        )[0];
    const a = nearest('west'),
      b = nearest('east');
    if (!a || !b) continue;
    used.add(a.id);
    used.add(b.id);
    const id = `bridge-${i + 1}`;
    add(a, b, Math.hypot(a.x - b.x, a.z - b.z), true, id);
    crossings.push({
      id,
      from: a.id,
      to: b.id,
      edges: [`${a.id}:${b.id}`, `${b.id}:${a.id}`],
      name: ['North crossing', 'Central crossing', 'South crossing'][i] ?? `Crossing ${i + 1}`,
    });
  }
  return {
    edges,
    crossings,
    river: {
      id: 'river-main',
      widthM: extent * 0.012,
      points: Array.from({ length: 65 }, (_, i) => ({
        x: riverX(extent, (extent * i) / 64),
        z: (extent * i) / 64,
      })),
    },
  };
}
