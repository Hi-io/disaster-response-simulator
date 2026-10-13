import { clone, digest } from './determinism.mjs';
import { createResource, release, available } from './ledger.mjs';
import { consumeStaff } from './staff.mjs';
import { requireCondition as check } from '../contracts/actions.mjs';

// A resource is one homogeneous lot. Dates are source-world milliseconds,
// never a model-invented expiry, and travel keeps the original lot identity.
export function supplyMetadata(r) {
  return Object.fromEntries(Object.entries({ lotId: r?.lotId,
    lotOrigin: r?.lotOrigin, useByAt: r?.useByAt, condition: r?.condition }).filter(([, v]) => v !== undefined));
}
export function supplyUsable(r, now) {
  return !!r && !['expired', 'damaged', 'quarantined'].includes(r.condition) &&
    (r.useByAt === undefined || Number.isSafeInteger(r.useByAt) && r.useByAt > now);
}
export function installSupplies(w) {
  const resourceView = w.resourceView.bind(w);
  w.resourceView = r => ({ ...resourceView(r), ...supplyMetadata(r),
    usableQuantity: supplyUsable(r, w.now) ? Math.max(0, available(r)) : 0 });
  w.supplyStockId = (base, op) => {
    const metadata = op.supply ?? {};
    if (metadata.lotId === undefined && metadata.useByAt === undefined &&
      w.resource(base)?.lotId === undefined && w.resource(base)?.useByAt === undefined) return base;
    return `${base}-lot-${digest({ lotId: metadata.lotId ?? null,
      origin: metadata.lotOrigin ?? null, useByAt: metadata.useByAt ?? null }).slice(0, 16)}`;
  };
  w.expireCargo = (v) => {
    if (!v.supplyCargo || supplyUsable(v.supplyCargo, w.now) || !v.load) return false;
    const quantity = v.load, op = w.state.operations.find(o => o.id === v.operation),
      loss = createResource(`expired-cargo-${v.id}-${w.nextId('lot-loss')}`, v.owner, v.node,
        v.resourceType, 0, 0, { ...clone(v.supplyCargo), condition: 'expired', received: quantity, lost: quantity });
    w.state.resources.push(loss);
    delete v.staffCargo;
    delete v.supplyCargo;
    v.load = 0;
    if (op) {
      op.state = 'failed'; op.failure = 'supply_expired'; op.expiredQuantity = quantity;
      op.times.failed = w.now; op.version = (op.version ?? 0) + 1;
      const c = w.state.commitments.find(c => c.id === op.commitment);
      if (c?.state === 'dispatched') { c.state = 'failed'; c.version++; }
      const t = w.state.transfers?.find(t => t.id === op.transfer);
      if (t) { t.state = 'failed'; t.failure = 'supply_expired'; }
      if (op.unloadingSlot) { w.building(op.building).unloadingCount--; op.unloadingSlot = false; }
      w.reportOperation(op);
    }
    // Expiry does not teleport a moving vehicle or undo spent fuel. It keeps
    // the current safe route; only the unusable cargo and service claim end.
    v.operation = null;
    if (!v.edge) v.state = 'idle';
    w.reportVehicle(v);
    w.record('supply_cargo_expired', { vehicle: v.id, quantity, lotId: loss.lotId ?? null }, op?.id ?? loss.id);
    return true;
  };
  w.expireSupply = (r) => {
    if (!r || r.condition === 'expired' || r.useByAt === undefined || r.useByAt > w.now) return;
    for (const c of w.state.commitments.filter(c => c.resource === r.id &&
      ['reserved', 'confirmed'].includes(c.state))) {
      release(r, c.quantity, c.staffReservation);
      c.state = 'withdrawn'; c.version++; c.failure = 'supply_expired';
      w.invalidateDependency(c.id);
    }
    consumeStaff(r, r.quantity);
    r.lost += r.quantity; r.quantity = 0; r.condition = 'expired'; r.version++;
    w.record('supply_lot_expired', { resource: r.id, lotId: r.lotId ?? null, useByAt: r.useByAt }, r.id);
    w.reportResource(r, r.owner);
    for (const v of w.state.vehicles) if (v.supplyCargo?.useByAt <= w.now) w.expireCargo(v);
    for (const b of w.state.map.buildings) if (b.node === r.node && (b.ownerOrg ?? 'org0') === r.owner &&
      ['shelter', 'plant'].includes(b.use)) {
      b.provisioned[r.type] = w.state.resources.filter(s => s.node === b.node && s.owner === r.owner &&
        s.type === r.type && supplyUsable(s, w.now)).reduce((n, s) => n + s.quantity, 0);
      w.reportFacility(b);
    }
  };
  w.setSupplyLife = (r, metadata) => {
    if (metadata.lotOrigin !== undefined) r.lotOrigin = clone(metadata.lotOrigin);
    else if (!r.lotOrigin) r.lotOrigin = { owner: r.owner, resource: r.id };
    if (metadata.lotId !== undefined) {
      check(typeof metadata.lotId === 'string' && metadata.lotId.length > 0 && metadata.lotId.length <= 120,
        'LOT', 'A lot identifier must be a bounded string');
      r.lotId = metadata.lotId;
    }
    if (metadata.useByAt !== undefined) {
      check(Number.isSafeInteger(metadata.useByAt) && metadata.useByAt >= 0,
        'SUPPLY_EXPIRY', 'Use-by time must be a nonnegative source-world millisecond');
      check(r.useByAt === undefined || metadata.useByAt <= r.useByAt,
        'SUPPLY_EXPIRY', 'A recorded expiry cannot silently be extended');
      r.useByAt = metadata.useByAt;
      // A received correction may shorten the original lot's life after pickup.
      // Its already-loaded cargo keeps that provenance and expires at the new
      // date, rather than silently retaining the obsolete longer date.
      for (const op of w.state.operations.filter(o => o.resource === r.id)) {
        const v = w.vehicle(op.vehicle);
        if (v?.operation === op.id && v.load && v.supplyCargo) {
          op.supply.useByAt = r.useByAt;
          v.supplyCargo.useByAt = r.useByAt;
        }
      }
      if (r.useByAt > w.now) w.schedule(r.useByAt, 'expire_supply', { resource: r.id, useByAt: r.useByAt },
        0, `expire-supply-${r.id}-${r.useByAt}`);
    }
    r.version++;
    w.expireSupply(r);
    w.reportResource(r, r.owner);
  };
  w.on('expire_supply', ({ resource, useByAt }) => {
    const r = w.resource(resource);
    if (r?.useByAt === useByAt) w.expireSupply(r);
  });
  for (const type of ['commitment', 'dispatch', 'transfer']) {
    const handler = w.actionHandlers.get(type);
    w.onAction(type, (actor, params, request) => {
      if (params.resource && (!params.action || ['reserve', 'offer'].includes(params.action))) {
        const r = w.resource(params.resource);
        if (r && !supplyUsable(r, w.now)) {
          w.expireSupply(r);
          check(false, 'SUPPLY_EXPIRED', 'This physical lot is expired, damaged or quarantined');
        }
      }
      return handler(actor, params, request);
    });
  }
  const intervention = w.handlers.get('lab_intervention');
  w.on('lab_intervention', p => {
    intervention(p);
    if (p.kind === 'resource_condition' && (p.lotId !== undefined || p.useByAt !== undefined))
      w.setSupplyLife(w.resource(p.id), p);
  });
  const load = w.handlers.get('load');
  w.on('load', p => {
    const op = w.state.operations.find(o => o.id === p.operation), r = w.resource(op?.resource);
    if (r && !supplyUsable(r, w.now)) w.expireSupply(r);
    load(p);
    const v = w.vehicle(op?.vehicle);
    if (v?.load && r && !['failed', 'cancelled'].includes(op.state)) {
      op.supply = supplyMetadata(r);
      v.supplyCargo = clone(op.supply);
    }
  });
  const unload = w.handlers.get('unload');
  w.on('unload', p => {
    const op = w.state.operations.find(o => o.id === p.operation), v = w.vehicle(op?.vehicle);
    if (v && w.expireCargo(v)) return;
    unload(p);
    if (op?.destinationStock && op.received > 0) {
      const dest = w.resource(op.destinationStock);
      if (op.supply?.lotId !== undefined || op.supply?.useByAt !== undefined) w.setSupplyLife(dest, op.supply);
      if (v && !v.load) delete v.supplyCargo;
    }
  });
}
