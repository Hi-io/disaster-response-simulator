import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../engine/world.mjs';

const world = (clarificationWorkers) => new World({
  seed: 'source-inquiry-fifo', scenario: 'S23', hazard: 'none', policy: 'none',
  topology: 'grid', grid: 5, extentKm: 2, postsPerHour: 0, backgroundTraffic: 0,
  healthReports: false, recurringNeeds: false, observationRate: 1, packetLoss: 0,
  networkLatencyMs: 0, inspectionMs: 60000, clarificationWorkers, logMode: 'full',
});
const submit = (w, building, index) => w.act({ id: 'reader', org: 'org0', role: 'agent' }, {
  type: 'verify', params: { target: 'building', id: building.id, method: 'clarification' },
  idempotencyKey: 'inquiry-' + index,
});

for (const workers of [1, 2]) test(`${workers} finite clarification workers assign at least twelve same-time requests in received FIFO order`, () => {
  const w = world(workers), targets = w.state.map.buildings.slice(0, 12);
  const requests = targets.map((b, index) => submit(w, b, index));
  w.advance(800000);
  const observations = requests.map(request => w.state.inspections.find(i => i.id === request.id));
  assert.deepEqual(observations.map(i => i.queueSequence), Array.from({ length: 12 }, (_, i) => i + 1));
  assert.deepEqual(observations.map(i => i.observedAt),
    Array.from({ length: 12 }, (_, index) => (Math.floor(index / workers) + 1) * 60000));
  assert.ok(observations.every(i => i.state === 'completed' && i.completedAt > i.observedAt));
  assert.deepEqual(w.invariants(), []);
});

test('a later batch crossing inspection-9 to inspection-10 preserves receipt order behind previously queued work', () => {
  const w = world(1), targets = w.state.map.buildings.slice(0, 12);
  const first = targets.slice(0, 7).map((b, i) => submit(w, b, i));
  w.advance(15000);
  const second = targets.slice(7).map((b, i) => submit(w, b, i + 7));
  w.advance(800000);
  assert.deepEqual([...first, ...second].map(r => w.state.inspections.find(i => i.id === r.id).observedAt),
    Array.from({ length: 12 }, (_, i) => (i + 1) * 60000));
});

test('field retries keep the original queue priority rather than overtaking by decimal request ID', () => {
  const w = world(1), target = w.state.map.buildings[0];
  // Every request must initially wait for an owned vehicle. Inspect the actual
  // scheduled retry order before a crew becomes free; no truth-based priority.
  for (const v of w.state.vehicles.filter(v => v.owner === 'org0')) v.state = 'busy';
  for (let index = 0; index < 12; index++) w.act({ id: 'reader', org: 'org0', role: 'agent' }, {
    type: 'verify', params: { target: 'building', id: target.id, method: 'field', purpose: 'observation' },
    idempotencyKey: 'waiting-field-' + index,
  });
  w.advance(1);
  const waiting = w.queue.toJSON().filter(e => e.type === 'field_prepare' && e.at === 30000);
  assert.deepEqual(waiting.map(e => e.data.inspection), Array.from({ length: 12 }, (_, i) => 'inspection-' + (i + 1)));
  assert.equal(new Set(waiting.map(e => e.key)).size, 12);
});
