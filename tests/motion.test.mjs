import assert from 'node:assert/strict';
import test from 'node:test';
import { MotionBuffer } from '../viewer/motion.js';

const map = {
  hash: 'motion-fixture',
  nodes: [
    { id: 'a', x: 0, z: 0 },
    { id: 'b', x: 1000, z: 0 },
  ],
  edges: [
    {
      id: 'ab',
      from: 'a',
      to: 'b',
      points: [
        { x: 0, z: 0 },
        { x: 1000, z: 0 },
      ],
    },
  ],
};
function snapshot(now, { playing = true, runId = 'run-a', vehicles } = {}) {
  return {
    runId,
    now,
    playing,
    state: {
      map,
      vehicles: vehicles ?? [
        {
          id: 'truck',
          node: 'a',
          edge: 'ab',
          edgeStart: 0,
          edgeEnd: 100000,
          route: ['ab'],
          routeIndex: 0,
        },
      ],
      observations: {
        org0: { vehicles: { truck: { id: 'truck', node: now < 50000 ? 'a' : 'b' } } },
      },
    },
  };
}
const close = (a, b) => {
  assert.ok(Math.abs(a.x - b.x) < 1e-7, `${a.x} should equal ${b.x}`);
  assert.ok(Math.abs(a.z - b.z) < 1e-7, `${a.z} should equal ${b.z}`);
};

test('irregular snapshots retarget from the displayed point without chunk-boundary jumps', () => {
  const buffer = new MotionBuffer();
  buffer.accept(snapshot(0), 0);
  const arrivals = [780, 1470, 2350, 3020, 3880, 4570, 5370, 6130];
  let lastX = 0;
  for (const [index, wall] of arrivals.entries()) {
    const before = buffer.point('truck', wall);
    buffer.accept(snapshot((index + 1) * 1000), wall);
    close(buffer.point('truck', wall), before);
    const nextArrival = arrivals[index + 1] ?? wall + 700;
    for (let frame = wall; frame < nextArrival; frame += 16) {
      const point = buffer.point('truck', frame);
      assert.ok(point.x + 1e-7 >= lastX, 'a fresh chunk must not move the truck backwards');
      assert.ok(point.x <= (index + 1) * 10, 'only confirmed travel may be drawn');
      lastX = point.x;
    }
    assert.equal(buffer.tracks.size, 1);
    assert.ok(buffer.tracks.get('truck').duration <= 1400);
  }
  close(buffer.point('truck', 30000), { x: 80, z: 0 });
});

test('predictable chunks remain in motion until the next chunk and never extrapolate', () => {
  const buffer = new MotionBuffer();
  buffer.accept(snapshot(0), 0);
  for (let index = 1; index <= 20; index++) {
    const wall = index * 750;
    buffer.accept(snapshot(index * 1000), wall);
    assert.ok(buffer.point('truck', wall + 749).x > buffer.point('truck', wall + 700).x);
  }
  const target = { x: 200, z: 0 };
  close(buffer.point('truck', 20000), target);
  close(buffer.point('truck', 200000), target);
});

test('duplicate cached frames preserve the current interpolation and cadence', () => {
  const buffer = new MotionBuffer();
  buffer.accept(snapshot(0), 0);
  buffer.accept(snapshot(1000), 750);
  const before = buffer.point('truck', 1050),
    interval = buffer.interval;
  buffer.accept(snapshot(1000), 1050);
  close(buffer.point('truck', 1050), before);
  assert.equal(buffer.interval, interval);
  assert.equal(buffer.tracks.get('truck').receivedAt, 750);
  buffer.accept(snapshot(2000), 1500);
  assert.equal(buffer.interval, interval, 'cached polling time is not a new motion sample');
});

test('pause and reduced motion snap to the latest fact without replaying stale motion', () => {
  for (const preference of [{ paused: true }, { reducedMotion: true }]) {
    const buffer = new MotionBuffer();
    buffer.accept(snapshot(0), 0);
    buffer.accept(snapshot(1000), 750);
    close(buffer.point('truck', 800, preference), { x: 10, z: 0 });
    close(buffer.point('truck', 810), { x: 10, z: 0 });
    assert.equal(buffer.tracks.get('truck').path, null);
  }
  const buffer = new MotionBuffer();
  buffer.accept(snapshot(0), 0);
  buffer.accept(snapshot(1000), 750);
  buffer.accept(snapshot(1000, { playing: false }), 800);
  close(buffer.point('truck', 810), { x: 10, z: 0 });
  buffer.accept(snapshot(1000), 900);
  close(buffer.point('truck', 910), { x: 10, z: 0 });
});

test('hidden-tab reset, long network gaps, rewinds and different runs discard stale paths', () => {
  for (const kind of ['hidden', 'gap', 'rewind', 'run']) {
    const buffer = new MotionBuffer();
    buffer.accept(snapshot(0), 0);
    buffer.accept(snapshot(1000), 750);
    if (kind === 'hidden') buffer.reset();
    const next =
      kind === 'rewind'
        ? snapshot(500)
        : snapshot(2000, { runId: kind === 'run' ? 'run-b' : 'run-a' });
    const wall = kind === 'gap' ? 8000 : 1000;
    buffer.accept(next, wall);
    close(buffer.point('truck', wall), { x: next.now / 100, z: 0 });
    assert.equal(buffer.tracks.get('truck').path, null, kind);
    assert.ok(buffer.cadence.length <= 8);
  }
});

test('a high-speed flood keeps one bounded target, and removed vehicles leave no tracks', () => {
  const buffer = new MotionBuffer({ maxPathPoints: 32 });
  buffer.accept(snapshot(0), 0);
  for (let index = 1; index <= 1000; index++) {
    buffer.accept(snapshot(index * 80), index * 8);
    assert.equal(buffer.tracks.size, 1);
    const track = buffer.tracks.get('truck');
    assert.ok(!track.path || track.path.length <= 32);
    assert.ok(track.duration <= 1400);
    assert.ok(buffer.cadence.length <= 8);
  }
  close(buffer.point('truck', 20000), { x: 800, z: 0 });
  buffer.accept(snapshot(81000, { vehicles: [] }), 8750);
  assert.equal(buffer.tracks.size, 0);
});

test('retargeting preserves confirmed bends instead of cutting across a block', () => {
  const buffer = new MotionBuffer();
  const bent = (now) => {
    const value = snapshot(now);
    value.state.map = {
      ...map,
      nodes: [map.nodes[0], { id: 'b', x: 20, z: 10 }],
      edges: [
        {
          ...map.edges[0],
          points: [
            { x: 0, z: 0 },
            { x: 10, z: 0 },
            { x: 10, z: 10 },
            { x: 20, z: 10 },
          ],
        },
      ],
    };
    value.state.vehicles[0].edgeEnd = 30000;
    return value;
  };
  buffer.accept(bent(0), 0);
  buffer.accept(bent(8000), 750);
  const displayed = buffer.point('truck', 1500);
  buffer.accept(bent(16000), 1500);
  close(buffer.point('truck', 1500), displayed);
  for (let wall = 1500; wall < 2500; wall += 16) {
    const p = buffer.point('truck', wall);
    assert.ok(
      Math.abs(p.z) < 1e-7 || Math.abs(p.x - 10) < 1e-7,
      'the truck remains on a confirmed street',
    );
    assert.ok(p.z <= 6 + 1e-7, 'the truck never drives past the newest confirmed position');
  }
});

test('a huge skipped road trace snaps rather than enqueueing it or drawing shortcuts', () => {
  const buffer = new MotionBuffer({ maxPathPoints: 16 });
  const long = (now) => {
    const value = snapshot(now);
    value.state.map = {
      ...map,
      edges: [
        {
          ...map.edges[0],
          points: Array.from({ length: 100 }, (_, i) => ({ x: i * 10, z: (i % 2) * 10 })),
        },
      ],
    };
    return value;
  };
  buffer.accept(long(0), 0);
  buffer.accept(long(100000), 750);
  assert.equal(buffer.tracks.get('truck').path, null);
  close(buffer.point('truck', 750), { x: 990, z: 10 });
});

test('received GPS stays literal, unknown reroutes snap, and presentation never mutates a snapshot', () => {
  const buffer = new MotionBuffer();
  const first = snapshot(0),
    before = structuredClone(first);
  buffer.accept(first, 0);
  buffer.accept(snapshot(1000), 750);
  assert.deepEqual(first, before);
  const rerouted = snapshot(2000);
  rerouted.state.vehicles[0].route = ['unconfirmed-road'];
  buffer.accept(rerouted, 1500);
  close(buffer.point('truck', 1500), { x: 20, z: 0 });
  buffer.accept(snapshot(60000), 2250, 'org0');
  close(buffer.point('truck', 2250), { x: 1000, z: 0 });
  buffer.accept(snapshot(1000), 3000, 'org0');
  close(buffer.point('truck', 3000), { x: 0, z: 0 });
});
