import { requireCondition as check } from './actions.mjs';
export const INPUT_TYPES = Object.fromEntries(
  [
    'social_post',
    'social_revision',
    'media',
    'team_message',
    'news',
    'bulletin',
    'field_assessment',
    'declared_need',
    'inventory',
    'facility',
    'vehicle_plan',
    'road_report',
    'telemetry',
    'communication',
    'personnel',
    'partner_offer',
    'commitment',
    'document',
    'procedure',
    'verification',
    'receipt',
    'funds',
    'tool_status',
    'hazard_notice',
    'human_decision',
    'precedent',
  ].map((name, i) => [`I${String(i + 1).padStart(2, '0')}`, name]),
);
export const UNITS = {
  water: 'L',
  food: 'unit',
  blankets: 'unit',
  energy: 'unit',
  staff: 'person',
  shelter: 'place',
  distance: 'm',
  time: 'ms',
  power: 'kW',
  weight: 'kg',
  volume: 'm3',
  funds: 'sandbox_credit',
};
export const OBSERVATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'id',
    'source',
    'observedAt',
    'availableAt',
    'version',
    'kind',
    'payload',
  ],
  properties: {
    schemaVersion: { const: 1 },
    id: { type: 'string' },
    source: { type: 'string' },
    observedAt: { type: 'integer', minimum: 0 },
    availableAt: { type: 'integer', minimum: 0 },
    version: { type: 'integer', minimum: 1 },
    kind: { enum: Object.values(INPUT_TYPES) },
    payload: { type: 'object' },
    references: { type: 'array', items: { type: 'string' } },
  },
};
export function validateObservation(o) {
  check(o && o.schemaVersion === 1, 'SCHEMA', 'Observation schema version required');
  check(
    Object.keys(o).every((k) => k in OBSERVATION_SCHEMA.properties),
    'SCHEMA',
    'Unknown observation field',
  );
  check(Object.values(INPUT_TYPES).includes(o.kind), 'KIND', 'Unknown input kind');
  for (const key of ['id', 'source'])
    check(typeof o[key] === 'string' && o[key].length > 0, 'SCHEMA', `${key} required`);
  for (const key of ['observedAt', 'availableAt', 'version'])
    check(
      Number.isSafeInteger(o[key]) && o[key] >= (key === 'version' ? 1 : 0),
      'TIME',
      `Invalid ${key}`,
    );
  check(
    o.availableAt >= o.observedAt,
    'TIME',
    'An observation cannot be available before it exists',
  );
  check(
    o.payload && typeof o.payload === 'object' && !Array.isArray(o.payload),
    'PAYLOAD',
    'Object payload required',
  );
  return o;
}
