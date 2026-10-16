import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createLabServers } from '../sources/server.mjs';
import { digest } from '../engine/determinism.mjs';

function fragmentedPost(url, key, payload, splitAt) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method: 'POST', headers: {
      Authorization: `Bearer ${key}`, 'Content-Type': 'application/json',
      'Transfer-Encoding': 'chunked',
    } }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode,
        data: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    request.on('error', reject);
    request.setTimeout(10000, () => request.destroy(new Error('Fragmented restore timed out')));
    // HTTP chunk boundaries deliberately bisect one Japanese character. Each
    // fragment is valid binary transport, but not independently decodable UTF-8.
    request.write(payload.subarray(0, splitAt));
    request.end(payload.subarray(splitAt));
  });
}

test('a Takamatsu checkpoint survives HTTP restore when a body chunk splits a Japanese road name', async t => {
  const lab = await createLabServers({ observerPort: 0, sourcePort: 0, persistCredentials: false,
    config: { topology: 'takamatsu', seed: 'city-utf8-restore', scenario: 'S23',
      logMode: 'full', mode: 'headless', policy: 'none', hazard: 'none',
      postsPerHour: 0, backgroundTraffic: 0, packetLoss: 0, healthReports: false, recurringNeeds: false } });
  t.after(() => lab.close());
  lab.world.advance(60000);
  const checkpoint = JSON.parse(JSON.stringify(lab.world.checkpoint())),
    road = checkpoint.state.map.edges.find(edge => /[^\x00-\x7f]/.test(edge.osmName ?? '')),
    payload = Buffer.from(JSON.stringify(checkpoint));
  assert.ok(road, 'the real geographic fixture must include an original Japanese name');
  const encodedName = Buffer.from(road.osmName), nameStart = payload.indexOf(encodedName),
    characterStart = encodedName.findIndex(byte => byte >= 0xc0), splitAt = nameStart + characterStart + 1;
  assert.ok(nameStart > 0 && characterStart >= 0);
  assert.notEqual(payload.subarray(0, splitAt).toString('utf8') + payload.subarray(splitAt).toString('utf8'), payload.toString('utf8'),
    'decoding each transport chunk separately demonstrably corrupts this fixture');
  const response = await fragmentedPost(`http://127.0.0.1:${lab.observerPort}/api/restore`, lab.observerKey, payload, splitAt);
  assert.equal(response.status, 200); assert.equal(response.data.runId, checkpoint.runId);
  const restored = JSON.parse(JSON.stringify(lab.world.checkpoint()));
  assert.equal(restored.state.map.edges.find(edge => edge.id === road.id).osmName, road.osmName);
  assert.equal(digest(restored), digest(checkpoint), 'all physical state, observations, queue, counters and run identity remain exact');
  assert.deepEqual(lab.world.invariants(), []);
});

test('JSON body limits apply to UTF-8 bytes rather than JavaScript character count', async t => {
  const lab = await createLabServers({ observerPort: 0, sourcePort: 0, persistCredentials: false,
    config: { topology: 'grid', grid: 3, extentKm: 1, policy: 'none', hazard: 'none', postsPerHour: 0, backgroundTraffic: 0 } });
  t.after(() => lab.close());
  const payload = Buffer.from(JSON.stringify({ seed: '水'.repeat(700000) }));
  assert.ok(payload.length > 2000000);
  const response = await fragmentedPost(`http://127.0.0.1:${lab.observerPort}/api/config`, lab.observerKey, payload, 1024);
  assert.equal(response.status, 413); assert.equal(response.data.error, 'BODY_LIMIT');
});
