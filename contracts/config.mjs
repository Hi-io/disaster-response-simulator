import { clone, digest } from '../engine/determinism.mjs';
export const VERSION = '0.2.0';
export const DEFAULT_CONFIG = {
  seed: 'response-lab-2026',
  scenario: 'S01',
  hazard: 'earthquake',
  variant: 'standard',
  grid: 25,
  extentKm: 160,
  organizations: 4,
  durationMs: 48 * 3600_000,
  populationPerSector: 60,
  backgroundTraffic: 160,
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
  policy: 'conventional',
  mode: 'interactive',
  clockLatency: 'modeled',
  split: 'development',
  language: 'mixed',
  logMode: 'full',
  maxEvents: 2_000_000,
  maxPosts: 1_000_000,
  topology: 'regional',
  bridgeCount: 3,
  healthTickMs: 600000,
  waterMlPerPersonDay: 3000,
  foodKcalPerPersonDay: 2100,
  initialWaterHours: 6,
  initialFoodHours: 12,
  waterCriticalHours: 30,
  foodCriticalHours: 72,
  injuryCriticalHours: 2,
  exposureCriticalHours: 4,
  waterFatalityBpPerHour: 150,
  foodFatalityBpPerHour: 25,
  injuryFatalityBpPerHour: 1000,
  exposureFatalityBpPerHour: 600,
  injuryFractionBp: 1500,
  temperatureC: 24,
  healthReports: true,
  authorshipMs: 1000,
  staffShiftMs: 28800000,
  staffRestMs: 3600000,
  vehicleFuelMl: 80000,
  fuelMlPerKm: 180,
  sourceRequestLimit: 1200,
  modelLatencyMs: 5000,
  modelCallLimit: 1000,
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
  modelLatencyMs: [0, 3600000],
  modelCallLimit: [1, 100000],
  bridgeCount: [1, 8],
  healthTickMs: [60000, 3600000],
  waterMlPerPersonDay: [1, 100000],
  foodKcalPerPersonDay: [1, 10000],
  initialWaterHours: [0, 168],
  initialFoodHours: [0, 168],
  waterCriticalHours: [0, 168],
  foodCriticalHours: [0, 168],
  injuryCriticalHours: [0, 168],
  exposureCriticalHours: [0, 168],
  waterFatalityBpPerHour: [0, 10000],
  foodFatalityBpPerHour: [0, 10000],
  injuryFatalityBpPerHour: [0, 10000],
  exposureFatalityBpPerHour: [0, 10000],
  injuryFractionBp: [0, 10000],
  temperatureC: [-40, 55],
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
  if (c.mode === 'live' && input.clockLatency === undefined) c.clockLatency = 'wall';
  if (c.mode === 'live' && c.clockLatency !== 'wall')
    throw new Error('Live integration requires a wall-clock latency policy');
  if (input.scenario === 'S19' && input.organizations === undefined) c.organizations = 5;
  if (typeof c.healthReports !== 'boolean') throw new Error('healthReports must be boolean');
  if (c.organizations > c.grid * c.grid)
    throw new Error('Not enough distinct sites for organizations');
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
