import { SimError } from './actions.mjs';
export function validateIntervention(w, type, p) {
  const fail = (message) => {
    throw new SimError('INTERVENTION', message);
  };
  const integer = (key, min = 0, max = 604800000) => {
    if (p[key] !== undefined && (!Number.isSafeInteger(p[key]) || p[key] < min || p[key] > max))
      fail(`Invalid ${key}`);
  };
  const boolean = (key) => {
    if (p[key] !== undefined && typeof p[key] !== 'boolean') fail(`Invalid ${key}`);
  };
  const entity = (key, get) => {
    if (!p[key] || !get(p[key])) fail(`Unknown ${key}`);
  };
  if (!p || typeof p !== 'object' || Array.isArray(p)) fail('Parameters must be an object');
  for (const [key, value] of Object.entries(p))
    if (typeof value === 'string' && value.length > 5000) fail(`Oversized ${key}`);
  if (type === 'damage') {
    entity('building', (id) => w.building(id));
    integer('severity', 1, 3);
    if (p.severity === undefined) fail('severity required');
  } else if (type === 'road_change') {
    entity('edge', (id) => w.edge(id));
    boolean('open');
    if (p.depth !== undefined && (!Number.isFinite(p.depth) || p.depth < 0 || p.depth > 20))
      fail('Invalid water depth');
  } else if (type === 'fire_front') {
    integer('generation', 0, 100);
    for (const k of ['x', 'z'])
      if (!Number.isFinite(p[k]) || p[k] < 0 || p[k] > w.state.map.extentM * 2)
        fail(`Invalid ${k}`);
  } else if (type === 'flood_level') {
    integer('generation', 0, 100);
    if (!Number.isFinite(p.depth) || p.depth < 0 || p.depth > 20) fail('Invalid depth');
  } else if (type === 'intervention') {
    if (
      !['cut', 'withdraw', 'correct', 'need_change', 'tool_fault', 'delete_post'].includes(p.type)
    )
      fail('Unknown intervention type');
    if (p.type === 'cut') {
      entity('sector', (id) => w.sector(id));
      integer('duration');
    }
    boolean('enabled');
  } else if (type === 'scenario_signal') {
    if (!/^P(0[1-9]|[12][0-9]|30)$/.test(p.family)) fail('Unknown content family');
    if (p.building) entity('building', (id) => w.building(id));
    boolean('false');
    if (p.type && !['text', 'audio', 'video', 'image', 'news'].includes(p.type))
      fail('Unknown media type');
  } else if (type === 'post_update') entity('id', (id) => w.post(id));
  else if (type === 'lab_intervention') {
    if (
      ![
        'bulletin',
        'team_note',
        'facility_receiver',
        'integration',
        'resource_condition',
        'driver_relay',
        'donation',
        'refuel',
      ].includes(p.kind)
    )
      fail('Unknown laboratory intervention');
    if (p.org) entity('org', (id) => w.organization(id));
    if (['donation'].includes(p.kind)) {
      entity('org', (id) => w.organization(id));
      integer('amount', 1, 100000000);
      integer('delayMs');
      if (p.amount === undefined) fail('amount required');
    }
    if (p.kind === 'facility_receiver') entity('id', (id) => w.building(id));
    if (p.kind === 'resource_condition') entity('id', (id) => w.resource(id));
    if (['driver_relay', 'refuel'].includes(p.kind)) entity('vehicle', (id) => w.vehicle(id));
    if (p.kind === 'refuel') {
      integer('litres', 1, 1000);
      if (p.litres === undefined) fail('litres required');
    }
    integer('schemaVersion', 1, 2);
    boolean('available');
    boolean('fail');
    boolean('expired');
    boolean('damaged');
  } else fail('Only documented observer interventions may be injected');
}
