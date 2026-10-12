import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../engine/world.mjs';

const fixture = (extra = {}) => new World({ policy: 'none', hazard: 'none', topology: 'grid',
  grid: 5, extentKm: 2, durationMs: 7200000, organizations: 2, postsPerHour: 0,
  backgroundTraffic: 0, packetLoss: 0, observationRate: 1, networkLatencyMs: 1000,
  inspectionMs: 1000, reviewMs: 1000, setupMs: 1000, ...extra });
let serial = 0;
const act = (w, org, type, params, role = 'commander') => w.act({ id: `${role}-${org}`, org, role },
  { type, params, idempotencyKey: `assessment-test-${++serial}` });
function delegation(w, { validForMs = 21600000 } = {}) {
  const b = w.building(w.state.map.shelterId),
    params = { target: 'building', id: b.id, method: 'field', purpose: 'facility_safety',
      reportTo: 'org0', targetVersion: b.version, validForMs, staff: 'r-org1-staff', vehicle: 'v-org1-1' },
    action = { type: 'verify', owner: 'org1', params, dependsOn: [] },
    request = act(w, 'org0', 'propose', { title: 'Request a qualified field crew', plan: { actions: [action] } }),
    approval = act(w, 'org1', 'propose', { title: 'Provide an owned qualified field crew', plan: { actions: [action] } });
  act(w, 'org0', 'review', { id: request.id, decision: 'approve' });
  act(w, 'org1', 'review', { id: approval.id, decision: 'approve' });
  w.advance(w.now + 1000);
  return { b, request, approval, params: { ...params, requestProposal: request.id, requestStep: 0, proposal: approval.id, step: 0 } };
}

test('clarification and radio can report metadata and needs but cannot certify a safe facility', () => {
  for (const method of ['clarification', 'radio']) {
    const w = fixture(), b = w.building(w.state.map.shelterId);
    act(w, 'org0', 'verify', { target: 'building', id: b.id, method });
    w.advance(600000);
    const i = w.state.inspections[0];
    assert.equal(i.state, 'completed'); assert.equal(i.result.safe, undefined);
    assert.equal(i.result.assessment, undefined); assert.equal(b.assessed, false);
    assert.throws(() => act(w, 'org0', 'activate', { building: b.id, permit: true }), e => e.code === 'ASSESSMENT');
  }
});

test('delegated assessment requires both exact approvals before using another owner crew', () => {
  const w = fixture(), d = delegation(w);
  w.state.proposals.find(p => p.id === d.request.id).state = 'awaiting_approval';
  assert.throws(() => act(w, 'org1', 'verify', d.params), e => e.code === 'ASSESSMENT_APPROVAL');
  w.state.proposals.find(p => p.id === d.request.id).state = 'authorized';
  w.state.proposals.find(p => p.id === d.approval.id).state = 'rejected';
  assert.throws(() => act(w, 'org1', 'verify', d.params), e => e.code === 'ASSESSMENT_APPROVAL');
  assert.equal(w.state.inspections.length, 0); assert.equal(w.resource('r-org1-staff').reserved, 0);
});

test('staffless site owner receives a versioned competent assessment only after peer travel, work and report delivery', () => {
  const w = fixture(), d = delegation(w);
  const ownStaff = w.resource('r-org0-staff'); ownStaff.lost += ownStaff.quantity; ownStaff.quantity = 0;
  const i = act(w, 'org1', 'verify', d.params);
  w.advance(w.now + 1);
  assert.equal(w.resource('r-org1-staff').reserved, 1);
  assert.equal(w.state.inspections.find(x => x.id === i.id).state, 'traveling');
  assert.equal(w.actorView('org0').inspections.length, 0);
  w.advance(600000);
  const received = w.actorView('org0').inspections.find(x => x.sourceId === i.id);
  assert.equal(received.state, 'completed'); assert.equal(received.confirmedBySource, true);
  assert.equal(received.sourceOwner, 'org1'); assert.equal(received.result.assessment.method, 'field');
  assert.equal(received.result.assessment.competent, true);
  assert.equal(received.result.version, d.b.version); assert.equal(w.resource('r-org1-staff').reserved, 0);
  const op = w.state.operations.find(o => o.id === received.operation);
  assert.ok(op.times.service > op.times.authorized, 'Field work must consume simulated travel and work time');
  assert.deepEqual(w.invariants(), []);
  act(w, 'org1', 'verify', d.params); assert.equal(w.state.inspections.filter(x => x.org === 'org1').length, 1,
    'A replay of the exact delegated request cannot schedule a second crew');
});

test('unqualified headcount and inaccessible routes cannot produce a field safety receipt', () => {
  for (const mode of ['unqualified', 'blocked']) {
    const w = fixture(), d = delegation(w);
    if (mode === 'unqualified') w.resource('r-org1-staff').qualifications = [];
    else for (const e of w.state.map.edges) {
      e.open = false; w.state.observations.org1.edges[e.id] = { open: false, version: e.version, at: w.now };
    }
    act(w, 'org1', 'verify', d.params); w.advance(600000);
    assert.equal(w.state.inspections[0].state, 'inconclusive');
    assert.equal(d.b.assessed, false); assert.equal(w.resource('r-org1-staff').reserved, 0);
    assert.equal(w.actorView('org0').inspections.length, 0);
  }
});

test('an offline requester cannot activate from an assessment that only the peer has received', () => {
  const w = fixture(), d = delegation(w);
  w.organization('org0').connected = false;
  const i = act(w, 'org1', 'verify', d.params); w.advance(600000);
  assert.equal(w.state.inspections.find(x => x.id === i.id).state, 'completed');
  assert.equal(w.actorView('org0').inspections.length, 0);
  assert.throws(() => act(w, 'org0', 'activate', { building: d.b.id, permit: true }), e => e.code === 'ASSESSMENT');
  w.organization('org0').connected = true; w.advance(w.now + 31000);
  assert.equal(w.actorView('org0').inspections[0].state, 'completed');
});

test('a new site version and assessment expiry each invalidate activation', () => {
  for (const mode of ['version', 'expiry']) {
    const w = fixture(), d = delegation(w, { validForMs: mode === 'expiry' ? 5000 : 21600000 });
    d.b.dependencies = {};
    act(w, 'org1', 'verify', d.params);
    if (mode === 'version') d.b.version++;
    w.advance(600000);
    assert.throws(() => act(w, 'org0', 'activate', { building: d.b.id, permit: true }), e => e.code === 'ASSESSMENT');
    assert.equal(d.b.state, 'candidate');
  }
});

test('requester approval withdrawn during travel cannot yield a positive assessment', () => {
  const w = fixture(), d = delegation(w);
  act(w, 'org1', 'verify', d.params); w.advance(w.now + 1);
  w.state.proposals.find(p => p.id === d.request.id).requiresReview = true;
  w.advance(600000);
  assert.equal(w.state.inspections[0].state, 'inconclusive'); assert.equal(d.b.assessed, false);
  assert.equal(w.resource('r-org1-staff').reserved, 0);
});

test('finite clarification workers reduce only queue wait, preserving per-job work and network delay', () => {
  const finishes = [];
  for (const workers of [1, 2]) {
    const w = fixture({ clarificationWorkers: workers, inspectionMs: 60000 });
    for (const b of [w.building('b0'), w.building('b1')])
      act(w, 'org0', 'verify', { target: 'building', id: b.id, method: 'clarification' });
    w.advance(200000);
    const rows = w.state.inspections;
    assert.ok(rows.every(i => i.state === 'completed' && i.observedAt >= 60000 && i.completedAt > i.observedAt));
    assert.ok(rows.every(i => !i.result.assessment && i.result.safe === undefined));
    finishes.push(rows.map(i => i.observedAt));
  }
  assert.deepEqual(finishes[0], [60000, 120000]); assert.deepEqual(finishes[1], [60000, 60000]);
});
