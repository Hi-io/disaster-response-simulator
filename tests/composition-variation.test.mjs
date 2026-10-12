import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../engine/world.mjs';
import { createResource } from '../engine/ledger.mjs';
const config = { scenario: 'S19', seed: 'structural-composition', policy: 'none', hazard: 'none', topology: 'grid', grid: 5, postsPerHour: 0, backgroundTraffic: 0 };
test('structural composition variants repeat exactly and preserve total stock while changing complementary owners and requirements', () => {
 const standard = new World(config);
 for (const variant of ['distributed', 'incompatible', 'unsafe', 'insufficient_staff', 'occupied', 'delayed']) {
  const a = new World({ ...config, compositionVariant: variant }), b = new World({ ...config, compositionVariant: variant });
  assert.deepEqual(a.state.resources, b.state.resources); assert.deepEqual(a.state.map.buildings, b.state.map.buildings);
  for (const type of ['energy', 'sanitation', 'staff']) assert.equal(a.state.resources.filter(r => r.type === type).reduce((s, r) => s + r.quantity, 0), standard.state.resources.filter(r => r.type === type).reduce((s, r) => s + r.quantity, 0));
  const shelter = a.building(a.state.map.shelterId);
  assert.deepEqual(shelter.requiredStaffSkills, ['shelter_support']);
  if (variant === 'unsafe') assert.equal(shelter.damage, 3);
  if (variant === 'incompatible') assert.equal(shelter.requiredPower.connector, 'B');
  if (variant === 'insufficient_staff') assert.ok(a.state.resources.filter(r => r.type === 'staff').every(r => !r.qualifications.includes('shelter_support')));
  assert.deepEqual(a.invariants(), []);
 }
});
test('headcount alone cannot substitute for qualified staff at an assessed service site', () => {
 const w = new World({ ...config, compositionVariant: 'insufficient_staff' }), b = w.building(w.state.map.shelterId);
 b.assessed = true; b.assessedVersion = b.version; b.damage = 0; w.state.observations.org0.buildings[b.id] = { safe: true, version: b.version };
 for (const [type, quantity] of Object.entries(b.dependencies)) {
  b.provisioned[type] = quantity; const r = createResource('stock-' + b.node + '-' + type, 'org0', b.node, type, quantity); if (type === 'energy') r.compatibility = b.requiredPower; w.state.resources.push(r);
 }
 assert.throws(() => w.act({ id: 'owner', org: 'org0', role: 'commander' }, { type: 'activate', params: { building: b.id, permit: true }, idempotencyKey: 'unqualified-activation' }), e => e.code === 'QUALIFICATION');
 assert.equal(b.state, 'candidate'); assert.deepEqual(w.invariants(), []);
});
