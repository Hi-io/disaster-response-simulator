import { requireCondition as check } from './actions.mjs';
const stringFields = [
  'text',
  'title',
  'claim',
  'post',
  'reason',
  'target',
  'id',
  'org',
  'resource',
  'requester',
  'vehicle',
  'need',
  'destination',
  'building',
  'edge',
  'from',
  'to',
  'type',
  'stage',
  'summary',
  'kind',
  'decision',
  'method',
  'proposal',
  'transfer',
];
const integerFields = ['quantity', 'price', 'ttlMs', 'leadMs', 'returnBy'];
export function validateParameters(type, p) {
  for (const k of stringFields)
    if (p[k] !== undefined)
      check(
        typeof p[k] === 'string' && p[k].length <= 20000,
        'PARAMETER',
        `${k} must be a bounded string`,
      );
  for (const k of integerFields)
    if (p[k] !== undefined)
      check(
        Number.isSafeInteger(p[k]) && p[k] >= 0,
        'PARAMETER',
        `${k} must be a nonnegative integer`,
      );
  for (const k of ['permit', 'engineering', 'loan'])
    if (p[k] !== undefined) check(typeof p[k] === 'boolean', 'PARAMETER', `${k} must be boolean`);
  for (const k of ['conditions', 'references'])
    if (p[k] !== undefined)
      check(Array.isArray(p[k]) && p[k].length <= 500, 'PARAMETER', `${k} must be a bounded array`);
  if (p.references)
    check(
      p.references.every((id) => typeof id === 'string' && id.length <= 200),
      'PARAMETER',
      'References must be IDs',
    );
  if (p.plan !== undefined)
    check(
      p.plan && typeof p.plan === 'object' && !Array.isArray(p.plan),
      'PARAMETER',
      'Plan must be an object',
    );
  if (type === 'purchase') {
    check(
      Number.isSafeInteger(p.quantity) &&
        p.quantity > 0 &&
        Number.isSafeInteger(p.price) &&
        p.price > 0,
      'PARAMETER',
      'Purchase requires positive quantity and unit price',
    );
    check(
      Number.isSafeInteger(p.quantity * p.price),
      'PARAMETER',
      'Purchase exceeds numeric precision',
    );
  }
  check(
    !('actor' in p) && !('role' in p) && !('authorizedBy' in p),
    'IDENTITY_SPOOF',
    'Authority comes from the authenticated session',
    403,
  );
  return p;
}
