// Qualifications travel with physical people, rather than being copied from
// a depot's historic label. Profiles preserve the intersection of skills;
// legacy marginal counts alone never establish an unobserved intersection.
import { requireCondition as check } from '../contracts/actions.mjs';
const copy = (x) => structuredClone(x);
const skillsKey = (skills) => [...new Set(skills)].sort().join('|');
function profiles(groups) {
  const merged = new Map();
  for (const g of groups ?? []) {
    if (!g.quantity) continue;
    const key = skillsKey(g.qualifications ?? []);
    const p = merged.get(key) ?? { quantity: 0, qualifications: key ? key.split('|') : [] };
    p.quantity += g.quantity; merged.set(key, p);
  }
  return [...merged.values()].sort((a, b) => skillsKey(a.qualifications).localeCompare(skillsKey(b.qualifications)));
}
function summary(quantity, counts, groups) {
  return { quantity, qualificationCounts: Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0)),
    qualifications: quantity ? Object.keys(counts).filter(s => counts[s] === quantity).sort() : [],
    ...(groups ? { qualificationProfiles: profiles(groups) } : {}) };
}
function fromProfiles(groups) {
  groups = profiles(groups); const counts = {};
  for (const g of groups) for (const s of g.qualifications) counts[s] = (counts[s] ?? 0) + g.quantity;
  return summary(groups.reduce((n, g) => n + g.quantity, 0), counts, groups);
}
export function staffSnapshot(r) {
  if (r?.type !== 'staff') return { qualifications: [], qualificationCounts: {} };
  if (r.qualificationProfiles) return fromProfiles(r.qualificationProfiles);
  const counts = r.qualificationCounts ?? Object.fromEntries((r.qualifications ?? []).map(s => [s, r.quantity]));
  // All-or-none native declarations describe an exact homogeneous group.
  const exact = Object.values(counts).every(n => n === 0 || n === r.quantity);
  return summary(r.quantity, counts, exact ? [{ quantity: r.quantity,
    qualifications: Object.keys(counts).filter(s => counts[s] === r.quantity && nPositive(r.quantity)) }] : undefined);
}
const nPositive = (n) => n > 0;
function apply(r, s) {
  r.qualificationCounts = copy(s.qualificationCounts); r.qualifications = [...s.qualifications];
  if (s.qualificationProfiles) r.qualificationProfiles = copy(s.qualificationProfiles);
  else delete r.qualificationProfiles;
}
function subtract(a, b) {
  if (a.qualificationProfiles && b.qualificationProfiles) {
    const groups = copy(a.qualificationProfiles);
    for (const g of b.qualificationProfiles) {
      const p = groups.find(p => skillsKey(p.qualifications) === skillsKey(g.qualifications));
      if (!p || p.quantity < g.quantity) throw new Error('Staff profile was not available');
      p.quantity -= g.quantity;
    }
    return fromProfiles(groups);
  }
  const counts = { ...a.qualificationCounts };
  for (const [s, n] of Object.entries(b.qualificationCounts)) counts[s] = (counts[s] ?? 0) - n;
  return summary(a.quantity - b.quantity, counts);
}
function free(r) {
  let s = staffSnapshot(r);
  for (const hold of r.staffReservations ?? []) s = subtract(s, hold);
  return s;
}
function joint(s, skills) {
  if (!skills.length) return s.quantity;
  if (s.qualificationProfiles) return s.qualificationProfiles.filter(g => skills.every(x => g.qualifications.includes(x)))
    .reduce((n, g) => n + g.quantity, 0);
  return Math.max(0, skills.reduce((n, x) => n + (s.qualificationCounts[x] ?? 0), 0) - (skills.length - 1) * s.quantity);
}
function take(s, quantity, skills = []) {
  if (quantity > joint(s, skills)) throw new Error('Qualified staff are unavailable');
  if (s.qualificationProfiles) {
    const selected = []; let left = quantity;
    for (const g of s.qualificationProfiles) if (skills.every(x => g.qualifications.includes(x)) && left) {
      const n = Math.min(left, g.quantity); selected.push({ ...g, quantity: n }); left -= n;
    }
    return fromProfiles(selected);
  }
  // Only guaranteed marginal counts are carried when native profile overlap
  // is unspecified. The remainder keeps the other actual credentials.
  const counts = Object.fromEntries(Object.entries(s.qualificationCounts)
    .map(([skill, n]) => [skill, Math.max(0, n - (s.quantity - quantity))]));
  for (const skill of skills) counts[skill] = quantity;
  return summary(quantity, counts);
}
export function qualifiedStaffAvailable(r, skills = []) {
  if (r?.type !== 'staff') return 0;
  return Math.max(0, Math.min(r.quantity - r.reserved - r.floor, joint(free(r), skills)));
}
export function checkStaffSelection(r, quantity, skills) {
  if (skills === undefined) return;
  check(r?.type === 'staff', 'STAFF_SELECTOR', 'Qualification selectors require physical staff cargo');
  check(quantity <= qualifiedStaffAvailable(r, skills), 'STAFF_QUALIFICATIONS',
    'The selected qualified staff are reserved, protected or unavailable');
}
export function sameStaffSelection(a, b) { return skillsKey(a ?? []) === skillsKey(b ?? []); }
export function reserveStaff(r, quantity, skills = []) {
  if (r.type !== 'staff') return undefined;
  const selected = take(free(r), quantity, skills);
  apply(r, staffSnapshot(r));
  r.staffReservationSequence = (r.staffReservationSequence ?? 0) + 1;
  const key = `staff-${r.staffReservationSequence}`;
  r.staffReservations ??= []; r.staffReservations.push({ key, ...selected }); return key;
}
function removeHold(r, quantity, key) {
  const index = (r.staffReservations ?? []).findIndex(h => key ? h.key === key : h.quantity === quantity);
  const hold = r.staffReservations?.[index];
  if (!hold || hold.quantity !== quantity) throw new Error('Staff reservation does not match the assigned people');
  r.staffReservations.splice(index, 1); return hold;
}
export function releaseStaffHold(r, quantity, key) {
  if (r.type === 'staff') removeHold(r, quantity, key);
}
export function loadStaff(r, quantity, key) {
  if (r.type !== 'staff') return undefined;
  const hold = removeHold(r, quantity, key), selected = { ...hold }; delete selected.key;
  apply(r, subtract(staffSnapshot(r), selected)); return selected;
}
export function receiveStaff(r, quantity, cargo) {
  if (r.type !== 'staff') return;
  const before = staffSnapshot(r), received = cargo ?? fromProfiles([{ quantity, qualifications: [] }]);
  if (received.quantity !== quantity) throw new Error('Staff cargo quantity mismatch');
  if (before.qualificationProfiles && received.qualificationProfiles)
    apply(r, fromProfiles([...before.qualificationProfiles, ...received.qualificationProfiles]));
  else {
    const counts = { ...before.qualificationCounts };
    for (const [s, n] of Object.entries(received.qualificationCounts)) counts[s] = (counts[s] ?? 0) + n;
    apply(r, summary(before.quantity + quantity, counts));
  }
}
export function consumeStaff(r, quantity) {
  if (r.type === 'staff') apply(r, subtract(staffSnapshot(r), take(free(r), quantity)));
}
export function staffReservation(r, key) {
  return copy(r?.staffReservations?.find(h => h.key === key) ?? null);
}
export function checkStaff(r) {
  if (r.type !== 'staff') return true;
  const s = staffSnapshot(r), holds = r.staffReservations ?? [];
  const validCounts = x => Object.values(x.qualificationCounts).every(n => Number.isSafeInteger(n) && n >= 0 && n <= x.quantity);
  try { return s.quantity === r.quantity && validCounts(s) && validCounts(free(r)) &&
    holds.every(validCounts) && holds.reduce((n, h) => n + h.quantity, 0) === r.reserved; }
  catch { return false; }
}
