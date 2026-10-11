import test from 'node:test';
import assert from 'node:assert/strict';
import {
  streamModels,
  receiptCard,
  eventCard,
  NotificationQueue,
  trafficLevel,
} from '../viewer/presentation.js';
import { confirmedPath, MotionBuffer } from '../viewer/motion.js';
import {
  feedTiming,
  packNotices,
  serviceRows,
  selectionPoint,
  trackingStep,
} from '../viewer/display.js';
import { FlowLane } from '../viewer/flow.js';

const post = (id, audience, options = {}) => ({
  public: {
    id,
    version: 1,
    publishedAt: 10,
    format: 'text',
    text: `Report ${id}`,
    location: 'b0',
    authorName: 'Resident',
  },
  private: { audience, false: true, actualLocation: 'hidden-location' },
  indexAt: 20,
  deleted: false,
  ...options,
});
const state = () => ({
  map: {
    buildings: [{ id: 'b0', use: 'shelter' }],
    organizations: [
      { id: 'org0', name: 'Team A' },
      { id: 'org1', name: 'Team B' },
    ],
  },
  posts: [],
  ingestion: [],
});
test('available data is scoped, indexed, published and distinct from consumed receipts', () => {
  const s = state();
  s.posts = [
    post('public', 'public'),
    post('own', ['org0']),
    post('private', ['org1']),
    post('unindexed', 'public', { indexAt: 80 }),
    post('future', 'public', { public: { id: 'future', publishedAt: 100 }, indexAt: 120 }),
    post('deleted', 'public', { deleted: true }),
  ];
  const snapshot = {
    now: 50,
    state: s,
    events: [
      { index: 1, at: 30, type: 'message_delivered', data: { to: 'org1', kind: 'road' } },
      { index: 2, at: 40, type: 'message_delivered', data: { to: 'org0', kind: 'road' } },
    ],
  };
  const view = streamModels(snapshot, 'org0', false);
  assert.equal(view.reality.length, 0);
  assert.deepEqual(
    view.available.filter((c) => c.entity?.kind === 'post').map((c) => c.entity.id),
    ['public', 'own'],
  );
  assert.equal(view.available.filter((c) => c.tag === 'Received by this organization').length, 1);
  assert.ok(
    view.communication.every((c) => c.tone !== 'urgent' && c.location !== 'hidden-location'),
  );
  assert.equal(s.ingestion.length, 0, 'displaying accessibility must not record a download');
});
test('old receipts retain their own versioned content and the reference skip is explained', () => {
  const s = state();
  s.posts = [
    post('p', 'public', { public: { id: 'p', version: 2, text: 'NEW claim', publishedAt: 10 } }),
  ];
  const c = receiptCard(
    {
      id: 'p',
      version: 1,
      org: 'org0',
      stage: 'downloaded',
      at: 5,
      content: { text: 'OLD claim' },
    },
    s,
  );
  assert.equal(c.body, 'OLD claim');
  const withoutContent = receiptCard(
    { id: 'p', version: 1, org: 'org0', stage: 'downloaded', at: 5 },
    s,
  );
  assert.ok(!withoutContent.body.includes('NEW claim'));
  const skipped = receiptCard(
    {
      id: 'p',
      org: 'org0',
      stage: 'discarded',
      reason: 'No supported operational statement in this reference',
    },
    s,
  );
  assert.match(skipped.body, /reference controller did not recognize/);
});
test('initial organization inventory is available without fabricating a download', () => {
  const s = state();
  s.observations = {
    org0: {
      resources: {
        r0: { id: 'r0', type: 'water', quantity: 2400, reserved: 100, node: 'n0', at: 0 },
      },
    },
    org1: { resources: { secret: { id: 'secret', type: 'water', quantity: 99999 } } },
  };
  const view = streamModels({ now: 0, state: s, events: [] }, 'org0', false);
  assert.equal(view.available.length, 1);
  assert.match(view.available[0].body, /2,400 L of water/);
  assert.ok(!JSON.stringify(view).includes('99999'));
  assert.equal(s.ingestion.length, 0);
});
test('presentation queues deduplicate updates and remain bounded during bursts', () => {
  const q = new NotificationQueue({ capacity: 30 });
  const items = Array.from({ length: 200 }, (_, i) => ({ key: `event-${i}`, at: i }));
  assert.equal(q.accept(items).length, 200);
  assert.equal(q.pending.length, 30);
  assert.equal(q.skipped, 170);
  assert.equal(q.accept(items).length, 0);
  assert.equal(q.shift().key, 'event-170');
  assert.equal(
    q.accept([{ key: 'one' }, { key: 'one' }]).length,
    1,
    'duplicates within a single chunk also collapse',
  );
  q.reset(items);
  assert.equal(q.pending.length, 0);
  assert.equal(q.accept(items).length, 0);
});
test('traffic colors reflect occupancy, queued demand and observer scope', () => {
  const e = { open: true, occupants: [], capacity: 10, waiting: [] };
  assert.equal(trafficLevel(e), 'clear');
  assert.equal(trafficLevel({ ...e, occupants: Array(8) }), 'slow');
  assert.equal(trafficLevel({ ...e, waiting: ['v1'] }), 'heavy');
  assert.equal(trafficLevel({ ...e, open: false }), 'closed');
  assert.equal(trafficLevel({ ...e, open: false }, { open: true }, false), 'unknown');
  assert.equal(trafficLevel(e, { open: false }, false), 'closed');
});
const nodes = new Map([
  ['a', { x: 0, z: 0 }],
  ['b', { x: 10, z: 10 }],
  ['c', { x: 20, z: 10 }],
]);
const edges = new Map([
  [
    'ab',
    {
      id: 'ab',
      from: 'a',
      to: 'b',
      points: [
        { x: 0, z: 0 },
        { x: 10, z: 0 },
        { x: 10, z: 10 },
      ],
    },
  ],
  [
    'bc',
    {
      id: 'bc',
      from: 'b',
      to: 'c',
      points: [
        { x: 10, z: 10 },
        { x: 20, z: 10 },
      ],
    },
  ],
]);
const v1 = {
  id: 'v1',
  node: 'a',
  edge: 'ab',
  edgeStart: 0,
  edgeEnd: 200,
  route: ['ab', 'bc'],
  routeIndex: 0,
};
test('visual interpolation follows confirmed road bends across a snapshot boundary', () => {
  const v2 = { ...v1, node: 'b', edge: 'bc', edgeStart: 200, edgeEnd: 300, routeIndex: 1 };
  const path = confirmedPath(v1, v2, 50, 250, nodes, edges);
  assert.deepEqual(path, [
    { x: 5, z: 0 },
    { x: 10, z: 0 },
    { x: 10, z: 10 },
    { x: 15, z: 10 },
  ]);
  assert.equal(
    confirmedPath(v1, { ...v2, route: ['different-road'] }, 50, 250, nodes, edges),
    null,
    'an unknown reroute must not become a straight-line shortcut',
  );
});
test('buffered motion never runs ahead of the world or invents GPS-only movement', () => {
  const s = {
    map: { nodes: [...nodes].map(([id, n]) => ({ id, ...n })), edges: [...edges.values()] },
    vehicles: [v1],
    observations: { org0: { vehicles: { v1: { id: 'v1', node: 'a' } } } },
  };
  const b = new MotionBuffer();
  b.accept({ now: 50, state: s }, 1000);
  b.accept({ now: 150, state: s }, 2000);
  assert.deepEqual(b.point('v1', 10000), { x: 10, z: 5 }, 'clamps to the last confirmed snapshot');
  assert.deepEqual(b.point('v1', 2000, { paused: true }), { x: 10, z: 5 });
  b.reset();
  b.accept({ now: 50, state: s }, 1000, 'org0');
  const later = structuredClone(s);
  later.observations.org0.vehicles.v1.node = 'b';
  b.accept({ now: 100, state: later }, 2000, 'org0');
  assert.deepEqual(b.point('v1', 2010), { x: 10, z: 10 });
});
test('the first confirmed trip animates from its actual departure node', () => {
  const before = { id: 'v1', node: 'a', edge: null, route: [], routeIndex: 0, state: 'idle' };
  assert.deepEqual(confirmedPath(before, v1, 0, 150, nodes, edges), [
    { x: 0, z: 0 },
    { x: 10, z: 0 },
    { x: 10, z: 5 },
  ]);
});
test('plain-language world events distinguish arrival from service and simulated mortality', () => {
  const s = state();
  assert.equal(
    eventCard({ index: 1, at: 10, type: 'vehicle_arrived', entity: 'v1', data: {} }, s).title,
    'A vehicle has arrived',
  );
  assert.equal(
    eventCard(
      {
        index: 2,
        at: 10,
        type: 'service_delivered',
        entity: 'need-1',
        data: { quantity: 100, type: 'water', building: 'b0' },
      },
      s,
    ).body,
    '100 L of water · Shelter b0',
  );
  assert.match(
    eventCard(
      { index: 3, at: 20, type: 'simulated_fatalities', data: { deaths: 3, cause: 'injury' } },
      s,
    ).body,
    /experimental model/,
  );
});

test('measurements include food and other resource units without leaking another team’s needs', () => {
  const snapshot = {
    metrics: {
      services: {
        water: { unit: 'L', demand: 800, served: 500, pending: 300, overprovided: 0 },
        food: { unit: 'portion', demand: 90, served: 90, pending: 0, overprovided: 20 },
        medicine: { unit: 'kit', demand: 4, served: 1, pending: 3, overprovided: 0 },
      },
    },
    state: {
      observations: {
        org0: {
          needs: {
            n0: { type: 'food', unit: 'portion', quantity: 10, served: 4 },
            n1: { type: 'food', unit: 'portion', quantity: 3, served: 5 },
          },
        },
        org1: { needs: { secret: { type: 'medicine', unit: 'kit', quantity: 99999, served: 0 } } },
      },
    },
  };
  const truth = serviceRows(snapshot);
  assert.equal(truth.find((r) => r.type === 'food').unit, 'portion');
  assert.equal(truth.find((r) => r.type === 'medicine').pending, 3);
  const known = serviceRows(snapshot, 'org0');
  assert.equal(known.find((r) => r.type === 'food').pending, 6);
  assert.equal(known.find((r) => r.type === 'food').served, 7);
  assert.equal(known.find((r) => r.type === 'food').overprovided, 2);
  assert.equal(
    known.find((r) => r.type === 'water').reported,
    false,
    'no observation is not zero demand',
  );
  assert.ok(!JSON.stringify(known).includes('99999'));
  assert.ok(!known.some((r) => r.type === 'medicine'));
});

test('map notifications push older neighbours upward and cull overflow instead of overlapping', () => {
  const notices = Array.from({ length: 12 }, (_, id) => ({
    id,
    x: 300 + (id % 2) * 30,
    y: 390,
    width: 196,
    height: 55,
    visible: true,
  }));
  const layout = packNotices(notices, 800, 450);
  assert.equal(layout[0].visible, true);
  assert.ok(layout[1].y < layout[0].y);
  assert.ok(layout.some((n) => !n.visible));
  const visible = layout.filter((n) => n.visible);
  for (let i = 0; i < visible.length; i++)
    for (let j = i + 1; j < visible.length; j++) {
      const a = visible[i],
        b = visible[j];
      assert.ok(
        a.x + a.width <= b.x ||
          b.x + b.width <= a.x ||
          a.y + a.height <= b.y ||
          b.y + b.height <= a.y,
      );
    }
  const separate = packNotices(
    [
      { x: 120, y: 300, width: 150, height: 50 },
      { x: 600, y: 300, width: 150, height: 50 },
    ],
    800,
    450,
  );
  assert.equal(separate[0].y, separate[1].y, 'unrelated locations keep their own anchors');
});

test('high-speed feed pacing drains bursts faster while preserving normal-speed timing', () => {
  assert.deepEqual(feedTiming(0, 1), feedTiming(0, 10));
  assert.equal(feedTiming(0, 1).interval, 280);
  assert.ok(
    feedTiming(30, 1000).interval * 36 < 1000,
    'a full presentation queue drains within the polling interval',
  );
  assert.ok(feedTiming(30, 1000).transition < feedTiming(30, 10).transition);
});

test('pausing a feed immediately settles to recent items instead of replaying a stale backlog', () => {
  const vars = new Map(),
    seen = [];
  const lane = new FlowLane({ style: { setProperty: (k, v) => vars.set(k, v) } });
  lane.add = (item, animate) => seen.push({ key: item.key, animate });
  lane.accept(Array.from({ length: 36 }, (_, i) => ({ key: `p${i}` })));
  lane.tick(1000, false, false, false, 1000);
  assert.deepEqual(
    seen.map((i) => i.key),
    ['p32', 'p33', 'p34', 'p35'],
  );
  assert.ok(seen.every((i) => i.animate === false));
  assert.equal(lane.queue.pending.length, 0);
  assert.equal(lane.queue.skipped, 32);
  assert.equal(lane.queue.seen.size, 36, 'settling a visual queue keeps deduplication history');
  assert.equal(vars.get('--flow-duration'), '0ms');
  assert.equal(vars.get('--flow-fade'), '0ms');
  lane.accept([{ key: 'next' }]);
  lane.tick(1100, true, false, false, 1000);
  assert.equal(lane.queue.pending.length, 1, 'a frozen feed remains readable until resumed');
  lane.tick(1200, false, false, true, 1000);
  assert.equal(vars.get('--flow-fade'), '0ms', 'high-speed cards enter at full opacity');
  lane.tick(1300, false, false, true, 10);
  assert.equal(vars.get('--flow-fade'), '240ms', 'normal-speed fades remain available');
});

test('camera focus uses public report locations and known vehicle positions, never hidden truth', () => {
  const s = state();
  s.map.nodes = [
    { id: 'a', x: 100, z: 200 },
    { id: 'b', x: 999, z: 999 },
  ];
  s.map.buildings = [
    { id: 'b0', node: 'a', x: 110, z: 210 },
    { id: 'secret', node: 'b', x: 990, z: 990 },
  ];
  s.vehicles = [{ id: 'v1', node: 'b' }];
  s.needs = [{ id: 'need-secret', building: 'secret' }];
  s.operations = [];
  s.observations = {
    org0: { vehicles: { v1: { id: 'v1', node: 'a' } }, needs: {} },
    org1: { vehicles: {}, needs: {} },
  };
  s.posts = [
    post('public', 'public', { public: { id: 'public', publishedAt: 10, location: 'b0' } }),
    post('private', ['org1']),
  ];
  const snapshot = { now: 50, state: s };
  assert.deepEqual(selectionPoint(snapshot, { kind: 'vehicle', id: 'v1' }, 'org0'), {
    x: 100,
    z: 200,
  });
  assert.equal(selectionPoint(snapshot, { kind: 'vehicle', id: 'v1' }, 'org1'), null);
  assert.equal(selectionPoint(snapshot, { kind: 'need', id: 'need-secret' }, 'org0'), null);
  assert.equal(selectionPoint(snapshot, { kind: 'post', id: 'private' }, 'org0'), null);
  assert.deepEqual(selectionPoint(snapshot, { kind: 'post', id: 'public' }, 'org0'), {
    x: 110,
    z: 210,
  });
  assert.equal(selectionPoint(snapshot, { kind: 'vehicle', id: 'v1' }, 'missing'), null);
});

test('camera tracking converges smoothly at different frame rates without overshooting its target', () => {
  const goal = { x: 100, z: 200 };
  const advance = (step) => {
    let current = { x: 0, z: 0, zoom: 1 };
    for (let t = 0; t < 480; t += step)
      current = trackingStep(current, current.zoom, goal, 8, step);
    return current;
  };
  const fast = advance(16),
    slow = advance(32);
  assert.ok(Math.abs(fast.x - slow.x) < 1e-8);
  assert.ok(fast.x > 90 && fast.x < 100 && fast.zoom > 7 && fast.zoom < 8);
  assert.deepEqual(trackingStep({ x: 0, z: 0 }, 1, goal, 8, 16, true), { x: 100, z: 200, zoom: 8 });
});
