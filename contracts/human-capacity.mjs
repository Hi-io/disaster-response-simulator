// These are explicit experimental assumptions, not empirical measurements of
// emergency workers. The zero profile preserves the legacy review mechanism.
export const HUMAN_CAPACITY_PROFILES = Object.freeze({
  zero: { readMs: 0, decisionMs: 0, relayMs: 0, readErrorBp: 0, decisionErrorBp: 0, relayErrorBp: 0,
    backgroundReadPerHour: 0, backgroundDecisionPerHour: 0, backgroundRelayPerHour: 0 },
  moderate: { readMs: 30000, decisionMs: 60000, relayMs: 90000, readErrorBp: 0, decisionErrorBp: 0, relayErrorBp: 0,
    backgroundReadPerHour: 0, backgroundDecisionPerHour: 0, backgroundRelayPerHour: 0 },
  burst: { readMs: 30000, decisionMs: 60000, relayMs: 90000, readErrorBp: 0, decisionErrorBp: 0, relayErrorBp: 0,
    backgroundReadPerHour: 360, backgroundDecisionPerHour: 120, backgroundRelayPerHour: 60 },
});
const ranges = { readers: [1, 50], deciders: [1, 50], relayers: [1, 50], readMs: [0, 3600000],
  decisionMs: [0, 3600000], relayMs: [0, 3600000], readErrorBp: [0, 10000], decisionErrorBp: [0, 10000],
  relayErrorBp: [0, 10000], backgroundReadPerHour: [0, 100000], backgroundDecisionPerHour: [0, 100000],
  backgroundRelayPerHour: [0, 100000], queueLimit: [1, 100000] };
export function normalizeHumanCapacity(input, operators = 2) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
    Object.keys(input).some(k => k !== 'profile' && !Object.hasOwn(ranges, k))) throw Error('Invalid human capacity configuration');
  const profile = input.profile ?? 'zero';
  if (!Object.hasOwn(HUMAN_CAPACITY_PROFILES, profile)) throw Error('Unknown human capacity profile');
  const result = { profile, readers: operators, deciders: operators, relayers: 1, queueLimit: 10000,
    ...HUMAN_CAPACITY_PROFILES[profile], ...input };
  for (const [key, [low, high]] of Object.entries(ranges)) if (!Number.isSafeInteger(result[key]) || result[key] < low || result[key] > high)
    throw Error('Invalid human capacity ' + key);
  return result;
}
export const humanCapacityEnabled = p => p.profile !== 'zero' || Object.entries(p).some(([key, value]) =>
  /Ms$|ErrorBp$|PerHour$/.test(key) && value > 0);
export const HUMAN_CAPACITY_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  profile: { enum: Object.keys(HUMAN_CAPACITY_PROFILES) },
  ...Object.fromEntries(Object.entries(ranges).map(([key, [minimum, maximum]]) => [key, { type: 'integer', minimum, maximum }])) } };
