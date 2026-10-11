import { clone, digest } from '../engine/determinism.mjs';
export const VERSION = '0.1.0';
export const DEFAULT_CONFIG = {
  seed: 'response-lab-2026',
  scenario: 'S01',
  hazard: 'earthquake',
  variant: 'standard',
  grid: 9,
  extentKm: 8,
  organizations: 4,
  durationMs: 6 * 3600_000,
  populationPerSector: 60,
  backgroundTraffic: 24,
  postsPerHour: 180,
  falseRate: 0.12,
  observationRate: 0.8,
  operatorCount: 2,
  reviewMs: 90_000,
  inspectionMs: 180_000,
  loadMs: 120_000,
  unloadMs: 90_000,
  setupMs: 300_000,
  networkLatencyMs: 3_000,
  packetLoss: 0.02,
  networkCapacity: 30,
  sourceIndexMs: 10_000,
  queryLatencyMs: 5_000,
  bandwidthBytesPerSecond: 1000000,
  toolQuota: 60,
  funds: 5000,
  stockWater: 2400,
  reservedWater: 100,
  policy: 'none',
  mode: 'interactive',
  clockLatency: 'modeled',
  split: 'development',
  language: 'mixed',
  logMode: 'full',
  maxEvents: 2_000_000,
  maxPosts: 1_000_000,
  topology: 'grid',
  authorshipMs: 1000,
  staffShiftMs: 28800000,
  staffRestMs: 3600000,
  vehicleFuelMl: 80000,
  fuelMlPerKm: 180,
  sourceRequestLimit: 1200,
  subsystemSeeds: {},
};
const enums = {
  topology: ['grid', 'regional'],
  hazard: ['earthquake', 'wildfire', 'flood', 'compound', 'none'],
  variant: ['standard', 'adverse', 'infeasible'],
  policy: ['none', 'conventional', 'rules', 'extraction', 'general', 'investigation', 'federated'],
  mode: ['interactive', 'headless', 'live', 'modeled', 'replay'],
  clockLatency: ['modeled', 'wall'],
  split: ['development', 'validation', 'heldout'],
  language: ['en', 'es', 'mixed'],
  logMode: ['full', 'compact'],
};
const ranges = {
  authorshipMs: [0, 3600000],
  staffShiftMs: [1000, 604800000],
  staffRestMs: [0, 86400000],
  vehicleFuelMl: [0, 1000000],
  fuelMlPerKm: [1, 5000],
  sourceRequestLimit: [1, 1000000],
  grid: [3, 100],
  extentKm: [1, 200],
  organizations: [1, 12],
  durationMs: [1000, 604800000],
  populationPerSector: [1, 10000],
  backgroundTraffic: [0, 10000],
  postsPerHour: [0, 1000000],
  falseRate: [0, 1],
  observationRate: [0, 1],
  operatorCount: [1, 50],
  reviewMs: [1000, 3600000],
  inspectionMs: [1000, 3600000],
  loadMs: [1000, 3600000],
  unloadMs: [1000, 3600000],
  setupMs: [1000, 3600000],
  networkLatencyMs: [0, 3600000],
  packetLoss: [0, 1],
  networkCapacity: [1, 100000],
  sourceIndexMs: [0, 3600000],
  bandwidthBytesPerSecond: [100, 100000000],
  queryLatencyMs: [0, 3600000],
  toolQuota: [1, 1000000],
  funds: [0, 100000000],
  stockWater: [0, 100000000],
  reservedWater: [0, 100000000],
  maxEvents: [100, 100000000],
  maxPosts: [10, 10000000],
};
export function validateConfig(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Configuration must be an object');
  for (const key of Object.keys(input))
    if (!(key in DEFAULT_CONFIG)) throw new Error(`Unknown configuration field: ${key}`);
  const c = { ...clone(DEFAULT_CONFIG), ...input };
  if (!['string', 'number'].includes(typeof c.seed) || String(c.seed).length > 128)
    throw new Error('Invalid seed');
  c.seed = String(c.seed);
  if (!c.subsystemSeeds || typeof c.subsystemSeeds !== 'object' || Array.isArray(c.subsystemSeeds))
    throw new Error('Subsystem seeds must be an object');
  for (const [stream, seed] of Object.entries(c.subsystemSeeds)) {
    if (
      !/^[a-z_]{1,40}$/.test(stream) ||
      !['string', 'number'].includes(typeof seed) ||
      String(seed).length > 128
    )
      throw new Error('Invalid subsystem seed');
  }
  if (!/^S(0[1-9]|1[0-9]|2[0-4])$/.test(c.scenario)) throw new Error('Unknown scenario');
  for (const [k, allowed] of Object.entries(enums))
    if (!allowed.includes(c[k])) throw new Error(`Invalid ${k}`);
  for (const [k, [min, max]] of Object.entries(ranges))
    if (!Number.isFinite(c[k]) || c[k] < min || c[k] > max)
      throw new Error(`Invalid ${k}: expected ${min}..${max}`);
  for (const k of Object.keys(ranges))
    if (
      !['falseRate', 'observationRate', 'packetLoss', 'extentKm'].includes(k) &&
      !Number.isSafeInteger(c[k])
    )
      throw new Error(`Invalid integer ${k}`);
  if (c.reservedWater > c.stockWater) throw new Error('Reserved stock exceeds physical stock');
  return c;
}
export function manifest(config, extra = {}) {
  return {
    schemaVersion: 1,
    engineVersion: VERSION,
    randomVersion: 'fnv-avalanche-v1',
    runtimeMajor: 24,
    config: validateConfig(config),
    ...extra,
  };
}
export const manifestHash = (config) => digest(manifest(config));
export const CONFIG_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: Object.fromEntries(
    Object.entries(DEFAULT_CONFIG).map(([key, value]) => [
      key,
      enums[key]
        ? { enum: enums[key] }
        : ranges[key]
          ? {
              type: ['falseRate', 'observationRate', 'packetLoss', 'extentKm'].includes(key)
                ? 'number'
                : 'integer',
              minimum: ranges[key][0],
              maximum: ranges[key][1],
            }
          : { type: key === 'subsystemSeeds' ? 'object' : typeof value },
    ]),
  ),
};
