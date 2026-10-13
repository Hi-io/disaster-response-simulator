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
  if (type === 'human_work') {
    check(Object.keys(p).every(k => ['stage','reference','dependsOn','recipient','channel','ttlMs'].includes(k)),
      'HUMAN_SCHEMA', 'Human work only accepts an evidence reference and its explicit workflow');
    check(['read','decide','relay'].includes(p.stage), 'HUMAN_STAGE', 'Unknown human work stage');
    check(p.reference && typeof p.reference === 'object' && !Array.isArray(p.reference) &&
      Object.keys(p.reference).every(k => ['kind','id','version'].includes(k)) &&
      ['post','need','proposal','query','operation','work'].includes(p.reference.kind) &&
      typeof p.reference.id === 'string' && p.reference.id.length > 0 && p.reference.id.length <= 200 &&
      (p.reference.version === undefined || Number.isSafeInteger(p.reference.version) && p.reference.version >= 0),
      'HUMAN_REFERENCE', 'Provide a typed received evidence reference');
    check(p.dependsOn === undefined || Array.isArray(p.dependsOn) && p.dependsOn.length <= 32 &&
      new Set(p.dependsOn).size === p.dependsOn.length && p.dependsOn.every(id => typeof id === 'string' && id.length > 0 && id.length <= 200),
      'HUMAN_DEPENDENCIES', 'Human prerequisites must be bounded unique existing task identifiers');
    check(p.stage === 'relay' || p.recipient === undefined && p.channel === undefined && p.ttlMs === undefined,
      'HUMAN_SCHEMA', 'Only relay has a destination and transport parameters');
    if(p.stage==='relay')check(typeof p.recipient==='string' && p.recipient.length>0 && p.recipient.length<=200 &&
      (p.channel===undefined || ['internet','radio','landline'].includes(p.channel)) &&
      (p.ttlMs===undefined || Number.isSafeInteger(p.ttlMs)&&p.ttlMs>=1&&p.ttlMs<=86400000),
      'HUMAN_RELAY','Relay requires a bounded recipient, channel and validity window');
  }
  if (p.staffSkills !== undefined) check(['dispatch', 'commitment', 'transfer'].includes(type) &&
    Array.isArray(p.staffSkills) && p.staffSkills.length <= 32 &&
    p.staffSkills.every(s => typeof s === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(s)) &&
    new Set(p.staffSkills).size === p.staffSkills.length,
    'STAFF_SELECTOR', 'Staff skills must be unique bounded qualification names on a staff allocation action');
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
  if (type === 'unload') {
    check(Object.keys(p).every(k => ['operation','staff','quantity','targetVersion','requestVersion','sourceVersion','deliveryQuantity','proposal','step'].includes(k)),
      'PARAMETER','Unloading requires explicit approved operation, crew and received material versions');
    for (const key of ['operation','staff','proposal']) check(typeof p[key]==='string' && p[key].length>0 && p[key].length<=200,'PARAMETER',`${key} must be a bounded identifier`);
    for (const key of ['quantity','targetVersion','requestVersion','sourceVersion','deliveryQuantity']) check(Number.isSafeInteger(p[key])&&p[key]>0,'PARAMETER',`${key} must be a positive integer`);
    check(Number.isSafeInteger(p.step)&&p.step>=0,'PARAMETER','Unloading approval step is required');
  }
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
