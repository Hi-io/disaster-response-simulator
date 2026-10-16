// Geographic fixture: an adapted OpenStreetMap database, copyright OpenStreetMap
// contributors, ODbL 1.0: https://opendatacommons.org/licenses/odbl/1-0/
// The compressed, pinned dataset is local. No request or external routing service
// is used at runtime. See TAKAMATSU_SOURCE for selection, date and provenance.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const DATA_SHA256 = '88e20bad4567e13fa19c0e7b26b1d443dfd0390bb623300b0415765f70651075';
const bytes = gunzipSync(readFileSync(new URL('./data/takamatsu-roads-v1.json.gz', import.meta.url)));
if (createHash('sha256').update(bytes).digest('hex') !== DATA_SHA256)
  throw new Error('Takamatsu geographic fixture fingerprint mismatch');
const fixture = JSON.parse(bytes.toString('utf8'));
const deepFreeze = value => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};
// These finite traffic/load defaults are simulation parameters, not legal road
// limits or measured traffic capacity. Explicit OSM speed/weight tags cap them.
const PROFILES = {
  motorway: [25, 8, 18, 2000, 32000],
  trunk: [19, 6, 14, 3000, 30000],
  primary: [14, 5, 12, 4000, 25000],
  secondary: [11, 4, 9, 5000, 20000],
  tertiary: [8, 3, 7, 6500, 14000],
  unclassified: [6, 2, 5, 9000, 10000],
};
export const TAKAMATSU_SOURCE = deepFreeze({
  ...fixture.source,
  fixtureSha256: DATA_SHA256,
  modelAssumptions: {
    profiles: PROFILES,
    profileColumns: ['speedMps', 'capacity', 'storage', 'headwayMs', 'maxWeightKg'],
    interpretation: 'Finite synthetic traffic and load defaults; mapped maxspeed/maxweight tags cap them. hgv=no caps gross weight at 3500 kg. Height and width tags are exposed for vehicle-compatibility checks. Untagged roads are not certified safe or legally accessible.',
    omitted: 'No live closures, turn-restriction relations, conditional access calendar, surveyed elevation, traffic measurements, detailed hydrography or real response facilities.',
  },
});
const positive = value => {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const weightKg = value => {
  if (!value) return null;
  const n = positive(value);
  return n === null ? null : n * (/kg/i.test(value) ? 1 : 1000);
};
const speedMps = value => {
  if (!value) return null;
  const n = positive(value);
  return n === null ? null : n * (/mph/i.test(value) ? 0.44704 : 1 / 3.6);
};
const isStructure = value => value != null && !['no', 'false', '0'].includes(value);
const roadName = tags => tags['name:en'] ?? (tags.ref ? `Route ${tags.ref.replaceAll(';', ' / ')}` :
  tags.highway.endsWith('_link') ? 'Takamatsu connecting road' :
    tags.highway === 'unclassified' ? 'Takamatsu local road' : `Takamatsu ${tags.highway} road`);

export function takamatsuRoads() {
  const nodes = fixture.nodes.map(([osmNode, x, z, lon, lat, flags], index) => ({
    id: `n${index}`, osmNode, x, z, lon, lat,
    name: flags.nameEn ?? `Takamatsu Junction ${String(index + 1).padStart(4, '0')}`,
    ...(flags.osmName ? { osmName: flags.osmName } : {}),
    ...(flags.boundary ? { sourceBoundary: true } : {}),
    ...(flags.generatedWaypoint ? { sourceWaypoint: true } : {}),
  }));
  const edges = [], crossings = [];
  for (let index = 0; index < fixture.corridors.length; index++) {
    const [a, b, ways, forward, backward, tags, coordinates, distance] = fixture.corridors[index];
    const type = tags.highway.replace(/_link$/, ''), profile = PROFILES[type];
    const corridor = `takamatsu-road-${String(index + 1).padStart(5, '0')}`;
    const bridge = isStructure(tags.bridge), crossing = bridge ? `takamatsu-bridge-${index + 1}` : null;
    const taggedWeight = weightKg(tags.maxweight), taggedSpeed = speedMps(tags.maxspeed);
    const maxWeight = Math.min(profile[4], taggedWeight ?? Infinity, tags.hgv === 'no' ? 3500 : Infinity);
    const points = coordinates.map(([x, z]) => ({ x, z }));
    const corridorEdges = [];
    for (const reverse of [false, true]) {
      if (reverse ? !backward : !forward) continue;
      const from = `n${reverse ? b : a}`, to = `n${reverse ? a : b}`;
      const directionalLanes = positive(tags[reverse ? 'lanes:backward' : 'lanes:forward']) ??
        Math.max(1, Math.floor((positive(tags.lanes) ?? 2) / (forward && backward ? 2 : 1)));
      const edge = {
        id: `${from}:${to}`, from, to, points: reverse ? [...points].reverse() : points,
        name: roadName(tags), osmWay: ways[0], osmWays: [...ways], highway: tags.highway,
        ...(tags.name ? { osmName: tags.name } : {}),
        lengthM: distance, speedMps: Math.min(profile[0], taggedSpeed ?? Infinity),
        capacity: Math.max(1, Math.floor(profile[1] * directionalLanes)),
        storage: Math.max(1, Math.floor(profile[2] * directionalLanes)), headwayMs: profile[3],
        maxWeight, maxHeightM: positive(tags.maxheight), maxWidthM: positive(tags.maxwidth),
        roadClass: ['motorway', 'trunk'].includes(type) ? 'highway' : type === 'primary' ? 'arterial' : type === 'secondary' ? 'secondary' : 'local',
        slope: 0, bridge, tunnel: isStructure(tags.tunnel), layer: Number.parseInt(tags.layer ?? '0', 10) || 0,
        crossing, corridor, oneWay: !(forward && backward),
        permanentRestrictions: { ...tags, modeledDirection: reverse ? 'reverse geometry' : 'forward geometry' },
        open: true, waterDepth: 0, nextEntryAt: 0, occupants: [], waiting: [], version: 1,
        trafficDemand: 35,
      };
      edges.push(edge); corridorEdges.push(edge.id);
    }
    if (bridge) crossings.push({ id: crossing, from: `n${a}`, to: `n${b}`, edges: corridorEdges,
      name: `Takamatsu mapped bridge ${crossings.length + 1}`, osmWays: [...ways] });
  }
  return { nodes, edges, crossings, river: null, source: structuredClone(TAKAMATSU_SOURCE) };
}
