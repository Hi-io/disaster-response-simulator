import { clone, digest } from './determinism.mjs';
import { createResource } from './ledger.mjs';
import { receiveStaff } from './staff.mjs';
import { UNITS } from '../contracts/inputs.mjs';
import { requireCondition as check, requireRole } from '../contracts/actions.mjs';

const CURRENCY = 'sandbox_credit';
const PURCHASE_FIELDS = ['id', 'org', 'type', 'quantity', 'unit', 'price', 'cost', 'currency',
  'state', 'receivedQuantity', 'expectedArrivalAt', 'nextArrivalAt', 'version', 'receipts',
  'createdAt', 'receivedAt', 'failure'];
const purchaseView = p => clone(Object.fromEntries(PURCHASE_FIELDS.filter(k => p[k] !== undefined)
  .map(k => [k, p[k]])));

export function installProcurement(w) {
  w.financeView = orgId => {
    const org = w.organization(orgId);
    check(org, 'NOT_FOUND', 'Unknown finance owner');
    const view = { id: `finance-${orgId}`, org: orgId, currency: CURRENCY,
      sandbox:true, balance: org.funds, available:org.funds,
      entries: clone(w.state.fundEntries.filter(e => e.org === orgId)
        .map(e => ({ ...e, currency: CURRENCY }))),
      purchases: w.state.purchases.filter(p => p.org === orgId).map(purchaseView),
      observedAt: w.now };
    const material = digest({ balance:view.balance, entries:view.entries, purchases:view.purchases });
    // A poll does not create a new balance or purchase version.
    if (org.financeSignature !== material) {
      org.financeSignature = material; org.financeVersion = (org.financeVersion ?? 0) + 1;
    }
    return { ...view, version: org.financeVersion };
  };
  w.receiveFinance = (org, snapshot) => {
    if (!snapshot || snapshot.org !== org || snapshot.currency !== CURRENCY) return;
    const old = w.state.observations[org].finance;
    if (!old || snapshot.version > old.version || snapshot.version === old.version &&
      snapshot.observedAt >= old.observedAt) w.state.observations[org].finance = clone(snapshot);
  };
  w.reportFinance = org => w.send({ kind:'finance_status', snapshot:w.financeView(org) }, org,
    { sector:w.sectorForNode(w.organization(org).node) });

  const invariants = w.invariants.bind(w);
  w.invariants = () => {
    const errors = invariants();
    for (const p of w.state.purchases) {
      if (!Number.isSafeInteger(p.receivedQuantity) || p.receivedQuantity < 0 || p.receivedQuantity > p.quantity ||
        p.receipts.reduce((n,r) => n + r.quantity, 0) !== p.receivedQuantity ||
        new Set(p.receipts.map(r => r.id)).size !== p.receipts.length || p.cost !== p.quantity * p.price ||
        p.receipts.some(r => !Number.isSafeInteger(r.quantity) || r.quantity <= 0) ||
        w.state.fundEntries.filter(e => e.type === 'spent' && e.reference === p.id && e.org === p.org)
          .reduce((n,e) => n + e.amount, 0) !== p.cost) errors.push(`purchase_conservation:${p.id}`);
    }
    return errors;
  };

  w.onAction('purchase', (a, p) => {
    requireRole(a, ['commander', 'dispatcher']);
    check(Object.keys(p).every(k => ['type','quantity','price','leadMs','currency'].includes(k)),
      'PURCHASE_SCHEMA', 'Supplier receipt schedules cannot be supplied by the purchaser');
    check(p.currency === undefined || p.currency === CURRENCY, 'CURRENCY', 'Purchase prices use sandbox credits, not dollars');
    check(Number.isSafeInteger(p.quantity) && p.quantity > 0 && Number.isSafeInteger(p.price) &&
      p.price > 0 && Number.isSafeInteger(p.quantity * p.price), 'QUANTITY', 'Positive exact purchase quantity and price required');
    check(p.leadMs === undefined || Number.isSafeInteger(p.leadMs) && p.leadMs >= 0 &&
      p.leadMs <= 604800000, 'LEAD_TIME', 'Purchase lead time must be within the supported seven-day window');
    check(['water','food','blankets','energy','sanitation','staff'].includes(p.type), 'TYPE', 'Invalid supply');
    const org = w.organization(a.org), cost = p.quantity * p.price;
    check(org.funds >= cost, 'FUNDS', 'Insufficient funds');
    w.state.vendorStock ??= { water:10000, food:1000, blankets:1000, energy:10, sanitation:10, staff:10 };
    check(w.state.vendorStock[p.type] >= p.quantity, 'SUPPLIER', 'Supplier stock unavailable');
    const profile = w.config.supply.purchaseTranches ?? [{ fraction:1, delayMs:Math.max(60000, p.leadMs ?? 1800000) }],
      id = w.nextId('purchase');
    // Cumulative flooring preserves exact native units for small orders, while
    // identical configuration/seed/actions keep the same physical tranches.
    let fraction = 0, assigned = 0;
    const tranches = profile.map((part, index) => {
      fraction += part.fraction;
      const cumulative = Math.abs(1 - fraction) <= 1e-12 ? p.quantity
        : Math.min(p.quantity, Math.floor(p.quantity * fraction + 1e-9)),
        quantity = cumulative - assigned;
      assigned = cumulative;
      return { id:`${id}-tranche-${index}`, quantity, at:w.now + part.delayMs };
    });
    check(tranches.every(part => Number.isSafeInteger(part.at)), 'LEAD_TIME',
      'Purchase receipt times must be exactly representable');
    org.funds -= cost; w.state.vendorStock[p.type] -= p.quantity;
    const purchase = { id, org:a.org, type:p.type, quantity:p.quantity, unit:UNITS[p.type] ?? 'unit',
      price:p.price, cost, currency:CURRENCY, state:'ordered', receivedQuantity:0,
      expectedArrivalAt:tranches.at(-1).at, nextArrivalAt:tranches[0].at, version:1,
      receipts:[], createdAt:w.now, _tranches:tranches,
      _terminalState:w.config.supply.purchaseTerminalState };
    w.state.purchases.push(purchase);
    w.state.fundEntries.push({ id:`spent-${id}`, type:'spent', org:a.org, amount:cost,
      currency:CURRENCY, at:w.now, reference:id });
    for (const part of tranches) w.schedule(part.at, 'purchase_receive', { id, tranche:part.id },
      4, part.id);
    w.record('purchase_ordered', { id, org:a.org, quantity:p.quantity, cost, currency:CURRENCY });
    w.reportFinance(a.org);
    return purchaseView(purchase);
  });
  w.on('purchase_receive', ({ id, tranche }) => {
    const p = w.state.purchases.find(x => x.id === id), part = p?._tranches.find(x => x.id === tranche);
    if (!part || part.done || ['received','failed'].includes(p.state) || part.at > w.now) return;
    check(part.quantity >= 0 && p.receivedQuantity + part.quantity <= p.quantity,
      'SUPPLIER_RECEIPT', 'A supplier receipt cannot exceed outstanding purchased quantity');
    part.done = true;
    if (part.quantity) {
      let r = w.resource(`r-${p.org}-${p.type}`);
      // A fresh purchase has unknown shelf life; do not add it to an older
      // dated/damaged lot and thereby invent its date or resurrect old stock.
      if (!r || r.lotId !== undefined || r.useByAt !== undefined || (p.type==='staff'&&r.staffCalendar) ||
        ['expired','damaged','quarantined'].includes(r.condition)) {
        const resourceId = `purchase-stock-${part.id}`;
        r = w.resource(resourceId);
        if (!r) { r = createResource(resourceId, p.org, w.organization(p.org).node, p.type, 0);
          w.state.resources.push(r); }
      }
      receiveStaff(r, part.quantity); r.quantity += part.quantity; r.received += part.quantity; r.version++;
      p.receivedQuantity += part.quantity;
      p.receipts.push({ id:part.id, purchase:p.id, quantity:part.quantity,
        receivedAt:w.now, resource:r.id, version:p.version + 1 });
      w.reportResource(r, p.org);
      w.record('purchase_received', { id, receipt:part.id, quantity:part.quantity, resource:r.id });
    }
    const next = p._tranches.find(t => !t.done);
    p.nextArrivalAt = next?.at ?? null;
    p.state = p.receivedQuantity === p.quantity ? 'received' : next
      ? p.receivedQuantity > 0 ? 'partial' : 'ordered' : p._terminalState;
    if (p.state === 'received') p.receivedAt = w.now;
    if (p.state === 'failed') p.failure = 'supplier_incomplete';
    p.version++;
    w.reportFinance(p.org);
  });
}
