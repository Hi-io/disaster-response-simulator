import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createService } from '../service.mjs';
import { createLabServers } from '../sources/server.mjs';

const options = {
  observerPort: 0,
  sourcePort: 0,
  persistCredentials: false,
  config: {
    grid: 3,
    extentKm: 2,
    hazard: 'none',
    backgroundTraffic: 0,
    postsPerHour: 3600,
    policy: 'none',
    seed: 'service-without-viewer',
  },
};

test('API-only service advances without a browser, source consumer or observer polling', async (t) => {
  const lab = await createService({ ...options, autoPlay: true });
  t.after(() => lab.close());
  const base = `http://127.0.0.1:${lab.observerPort}`;
  const headers = {
    Authorization: `Bearer ${lab.observerKey}`,
    'Content-Type': 'application/json',
  };
  assert.equal(
    (
      await fetch(base + '/api/control', {
        method: 'POST',
        headers,
        body: JSON.stringify({ rate: 1000 }),
      })
    ).status,
    200,
  );
  const before = lab.world.now;
  const eventsBefore = lab.world.eventCount;
  // No request, rendering callback or external client runs during this interval.
  await delay(400);
  assert.ok(lab.world.now > before);
  assert.ok(lab.world.eventCount > eventsBefore);
  assert.deepEqual(lab.world.invariants(), []);
  assert.equal((await fetch(base + '/api/state')).status, 401);
  for (const file of ['/', '/app.js', '/vendor/build/three.module.js']) {
    const response = await fetch(base + file);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error, 'VIEWER_DISABLED');
  }
  const state = await (await fetch(base + '/api/state', { headers })).json();
  assert.ok(state.now > 0 && state.playing);
  const control = await fetch(base + '/api/control', {
    method: 'POST',
    headers,
    body: JSON.stringify({ play: false }),
  });
  assert.equal(control.status, 200);
  const pausedAt = lab.world.now;
  await delay(180);
  assert.equal(lab.world.now, pausedAt);
  const source = `http://127.0.0.1:${lab.sourcePort}`;
  assert.equal((await fetch(source + '/api/feed')).status, 200);
  assert.equal((await fetch(source + '/api/actor/state')).status, 401);
  const key = Object.keys(lab.actorKeys)[0];
  const actor = await (
    await fetch(source + '/api/actor/state', {
      headers: { Authorization: `Bearer ${key}` },
    })
  ).json();
  assert.equal(actor.organization.id, lab.actorKeys[key].org);
  assert.ok(!Object.hasOwn(actor, 'state'));
});

test('enabling the optional 3D viewer does not change a seeded world or its results', async (t) => {
  const headless = await createService(options);
  const visual = await createLabServers(options);
  t.after(() => Promise.all([headless.close(), visual.close()]));
  assert.equal(headless.world.stateHash(), visual.world.stateHash());
  const origin = `http://127.0.0.1:${visual.observerPort}`;
  assert.equal((await fetch(origin + '/')).status, 200);
  assert.equal(
    headless.world.stateHash(),
    visual.world.stateHash(),
    'loading HTML does not step the clock',
  );
  headless.world.advance(600000);
  visual.world.advance(600000);
  assert.equal(headless.world.stateHash(), visual.world.stateHash());
  assert.deepEqual(headless.world.observer().metrics, visual.world.observer().metrics);
});
