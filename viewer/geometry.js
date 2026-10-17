// Pure geometry shared by the causal transport engine and both observer views.
export function roadCorridors(edges) {
  const groups = new Map();
  for (const edge of edges) {
    const endpoints = [String(edge.from), String(edge.to)].sort();
    const key = JSON.stringify([edge.corridor ?? null, ...endpoints]);
    let group = groups.get(key);
    if (!group) { group = { key, edge, edges: [] }; groups.set(key, group); }
    group.edges.push(edge);
  }
  return [...groups.values()];
}
export function pointAlong(points, fraction) {
  const f = Math.max(0, Math.min(1, fraction));
  if (points.length < 2) return { ...points[0] };
  const lengths = points.slice(1).map((b, i) => Math.hypot(b.x - points[i].x, b.z - points[i].z));
  let remaining = lengths.reduce((a, b) => a + b, 0) * f;
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i] || i === lengths.length - 1) {
      const t = lengths[i] ? remaining / lengths[i] : 0,
        a = points[i],
        b = points[i + 1];
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    }
    remaining -= lengths[i];
  }
}
