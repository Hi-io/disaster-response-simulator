import { requireCondition } from '../contracts/actions.mjs';
import { reserveStaff, releaseStaffHold, loadStaff, checkStaff } from './staff.mjs';

export function available(resource) {
  if (['expired', 'damaged', 'quarantined'].includes(resource.condition)) return 0;
  return resource.quantity - resource.reserved - resource.floor;
}
export function reserve(resource, quantity, skills = []) {
  requireCondition(
    Number.isSafeInteger(quantity) && quantity > 0,
    'QUANTITY',
    'Quantity must be a positive integer',
  );
  requireCondition(
    quantity <= available(resource),
    'INSUFFICIENT_RESOURCE',
    'Insufficient unreserved stock',
  );
  const staffReservation = reserveStaff(resource, quantity, skills);
  resource.reserved += quantity;
  resource.version++;
  return staffReservation;
}
export function release(resource, quantity, staffReservation) {
  requireCondition(quantity <= resource.reserved, 'RESERVATION', 'Invalid release');
  releaseStaffHold(resource, quantity, staffReservation);
  resource.reserved -= quantity;
  resource.version++;
}
export function load(resource, quantity, staffReservation) {
  requireCondition(quantity <= resource.reserved, 'RESERVATION', 'Stock was not reserved');
  const staffCargo = loadStaff(resource, quantity, staffReservation);
  resource.reserved -= quantity;
  resource.quantity -= quantity;
  resource.transferred += quantity;
  resource.version++;
  return staffCargo;
}
export function checkResource(resource) {
  return (
    Number.isSafeInteger(resource.quantity) &&
    resource.quantity >= 0 &&
    resource.reserved >= 0 &&
    resource.reserved <= resource.quantity &&
    checkStaff(resource) && resource.initial + resource.produced + resource.received ===
      resource.quantity + resource.consumed + resource.lost + resource.transferred
  );
}

export function createResource(id, owner, node, type, quantity, floor = 0, extra = {}) {
  return {
    id,
    owner,
    node,
    type,
    quantity,
    reserved: 0,
    floor,
    initial: quantity,
    produced: 0,
    received: 0,
    consumed: 0,
    lost: 0,
    transferred: 0,
    unit: ['water', 'fuel', 'raw_water'].includes(type)
      ? 'L'
      : type === 'staff'
        ? 'person'
        : type === 'food'
          ? 'portion'
          : 'unit',
    version: 1,
    public: true,
    ...extra,
  };
}

export function transition(record, next, allowed) {
  requireCondition(
    (allowed[record.state] ?? []).includes(next),
    'STATE_TRANSITION',
    `Cannot transition ${record.state} to ${next}`,
  );
  record.state = next;
  record.version = (record.version ?? 0) + 1;
}
export const COMMITMENT_STATES = {
  offered: ['reserved', 'rejected', 'expired', 'withdrawn'],
  reserved: ['confirmed', 'expired', 'withdrawn', 'released'],
  confirmed: ['dispatched', 'expired', 'withdrawn', 'released'],
  dispatched: ['completed', 'failed'],
  completed: [],
  expired: [],
  withdrawn: [],
  rejected: [],
  released: [],
  failed: [],
};
