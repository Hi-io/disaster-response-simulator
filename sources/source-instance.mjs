import { createHash } from 'node:crypto';
import { SimError } from '../contracts/actions.mjs';

export const SOURCE_INSTANCE_HEADER = 'X-AidScaler-Source-Instance';
// An episode identity is transport metadata, not part of deterministic World.
export const sourceInstanceId = (epoch, generation) =>
  createHash('sha256').update(JSON.stringify([epoch, generation])).digest('hex');
export function requireSourceInstance(expected, actual) {
  if (expected !== undefined && expected !== actual)
    throw new SimError('SOURCE_RESPONSE_CHANGED',
      'The simulator response has changed. Connect a new response before issuing commands.', 409);
}
