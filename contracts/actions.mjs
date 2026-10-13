export const ACTION_TYPES = {
  O01: 'record_claim',
  O02: 'relate_reports',
  O03: 'flag_report',
  O04: 'query',
  O05: 'verify',
  O06: 'propose',
  O07: 'review',
  O08: 'capabilities',
  O09: 'commitment',
  O10: 'transfer',
  O11: 'dispatch',
  O12: 'reroute',
  O13: 'repair',
  O14: 'activate',
  O15: 'evacuate',
  O16: 'purchase',
  O17: 'share',
  O18: 'correct',
  O19: 'cancel',
  O20: 'publish',
  O21: 'coverage',
  O22: 'abstain',
  O23: 'record_outcome',
  O24: 'unload',
  O25: 'human_work',
};
export class SimError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
export function requireCondition(condition, code, message, status = 400) {
  if (!condition) throw new SimError(code, message, status);
}
export function validateAction(request) {
  requireCondition(
    request && typeof request === 'object' && !Array.isArray(request),
    'INVALID_ACTION',
    'Action must be an object',
  );
  requireCondition(
    Object.values(ACTION_TYPES).includes(request.type),
    'UNKNOWN_ACTION',
    'Unknown action type',
  );
  requireCondition(
    typeof request.idempotencyKey === 'string' &&
      request.idempotencyKey.length >= 3 &&
      request.idempotencyKey.length <= 180,
    'IDEMPOTENCY_REQUIRED',
    'Provide an idempotencyKey',
  );
  requireCondition(
    request.params && typeof request.params === 'object' && !Array.isArray(request.params),
    'INVALID_PARAMS',
    'Provide params',
  );
  requireCondition(
    !('actor' in request) && !('role' in request),
    'IDENTITY_SPOOF',
    'Identity is provided by the authenticated session',
    403,
  );
  requireCondition(
    Object.keys(request).every((k) =>
      ['type', 'params', 'idempotencyKey', 'expectedVersion'].includes(k),
    ),
    'ACTION_SCHEMA',
    'Unexpected action envelope field',
  );
  requireCondition(
    request.expectedVersion === undefined ||
      (Number.isSafeInteger(request.expectedVersion) && request.expectedVersion >= 0),
    'VERSION',
    'Version must be a nonnegative integer',
  );
  return request;
}
export function requireRole(actor, roles) {
  requireCondition(actor && roles.includes(actor.role), 'FORBIDDEN', 'Insufficient authority', 403);
}
export function requireOwner(actor, owner) {
  requireCondition(
    actor.org === owner,
    'FORBIDDEN',
    'Resource is owned by another organization',
    403,
  );
}
export const ACTION_SCHEMA = {
  type: 'object',
  required: ['type', 'params', 'idempotencyKey'],
  additionalProperties: false,
  properties: {
    type: { enum: Object.values(ACTION_TYPES) },
    params: { type: 'object' },
    idempotencyKey: { type: 'string', minLength: 3, maxLength: 180 },
    expectedVersion: { type: 'integer', minimum: 0 },
  },
};
