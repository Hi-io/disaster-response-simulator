import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../engine/world.mjs';

test('pending inspection receipts expose own request metadata without premature observations or foreign requests', () => {
  const w = new World({
    seed: 'pending-inspection-scope', scenario: 'S23', hazard: 'none', policy: 'none',
    grid: 5, extentKm: 2, topology: 'grid', backgroundTraffic: 0,
    postsPerHour: 0, healthReports: false, recurringNeeds: false,
    networkLatencyMs: 0, packetLoss: 0, observationRate: 1,
    inspectionMs: 60000, logMode: 'full',
  });
  const target = w.state.map.buildings.find(b => b.use === 'residential').id;
  w.addNeed({ id: 'not-observed-yet', building: target, type: 'water', unit: 'L', quantity: 40 });
  const submit = (org) => w.act({ id: org + '-reader', org, role: 'agent' }, {
    type: 'verify', params: { target: 'building', id: target, method: 'clarification' },
    idempotencyKey: 'requested-' + org,
  });
  const own = submit('org0'), foreign = submit('org1');
  const physical = w.state.inspections.find(i => i.id === own.id);
  // Internal fields, even if present, must not leak through a pending receipt.
  physical.result = { safe: true, privateResult: 'unreceived assessment' };
  physical.vehicle = 'not-requested-crew';
  physical.operation = 'not-received-operation';
  let actor = w.actorView('org0');
  const receipt = actor.inspections.find(i => i.id === own.id);
  assert.equal(receipt.state, 'queued');
  assert.equal(receipt.target, 'building');
  assert.equal(receipt.entity, target);
  assert.equal(receipt.method, 'clarification');
  assert.equal(receipt.createdAt, own.createdAt);
  assert.equal(actor.inspections.some(i => i.id === foreign.id), false);
  for (const field of ['result', 'vehicle', 'operation', 'completedAt', 'observedAt'])
    assert.equal(field in receipt, false, field + ' is not pending request metadata');
  assert.equal(actor.known.needs['not-observed-yet'], undefined);
  w.advance(1);
  actor = w.actorView('org0');
  assert.equal(actor.inspections.find(i => i.id === own.id).state, 'clarification_pending');
  assert.equal(actor.known.needs['not-observed-yet'], undefined);
  delete physical.result;
  delete physical.vehicle;
  delete physical.operation;
  w.advance(60001);
  actor = w.actorView('org0');
  const completed = actor.inspections.find(i => i.id === own.id);
  assert.equal(completed.state, 'completed');
  assert.deepEqual(completed, physical, 'terminal receipt retains its existing complete projection');
  assert.equal(actor.known.needs['not-observed-yet'].quantity, 40);
  assert.equal(actor.inspections.some(i => i.id === foreign.id), false);
});
