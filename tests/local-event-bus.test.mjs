import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createLocalEventBus } from '../sources/local-event-bus.mjs';

const event = (id, audience = 'org0', payload = { message: `Report ${id}` }) => ({
  eventId: `event-${id}`,
  runId: 'run-1',
  orderingKey: `run-1/${audience}`,
  audience,
  type: 'observation',
  simTimeMs: Number(id) * 1000 || 0,
  payload,
});
const tokens = (batch) => batch.messages.map((message) => message.deliveryId);
async function fixture(t, options = {}) {
  const storageDir = await mkdtemp(path.join(os.tmpdir(), 'aidscaler-bus-'));
  let bus = await createLocalEventBus({ storageDir, ...options });
  t.after(async () => {
    await bus.close();
    await rm(storageDir, { recursive: true, force: true });
  });
  return {
    get bus() {
      return bus;
    },
    async restart() {
      await bus.close();
      bus = await createLocalEventBus({ storageDir, ...options });
      return bus;
    },
  };
}

test('local event bus persists publish, cursor and idempotent event IDs across restart', async (t) => {
  const f = await fixture(t);
  await f.bus.subscribe({ subscriptionId: 'platform', audience: 'org0' });
  const first = await f.bus.publish(event(1));
  assert.equal(first.duplicate, false);
  const batch = await f.bus.pull({ subscriptionId: 'platform' });
  await f.bus.ack({ subscriptionId: 'platform', deliveryIds: tokens(batch) });
  await f.restart();
  assert.deepEqual(await f.bus.publish(event(1)), { ...first, duplicate: true });
  assert.equal((await f.bus.pull({ subscriptionId: 'platform' })).messages.length, 0);
  await f.bus.publish(event(2));
  const next = await f.bus.pull({ subscriptionId: 'platform' });
  assert.equal(next.messages[0].envelope.eventId, 'event-2');
  assert.equal((await f.bus.stats()).subscriptions[0].cursor, first.sequence);
});

test('local event bus isolates audiences and independent subscriptions', async (t) => {
  const { bus } = await fixture(t);
  await bus.subscribe({ subscriptionId: 'slow', audience: 'org0' });
  await bus.subscribe({ subscriptionId: 'other', audience: 'org1' });
  await bus.publish([event(1), event(2, 'org1'), event(3)]);
  const slow = await bus.pull({ subscriptionId: 'slow', limit: 1 });
  assert.equal(slow.messages[0].envelope.audience, 'org0');
  const other = await bus.pull({ subscriptionId: 'other' });
  assert.equal(other.messages.length, 1);
  assert.equal(other.messages[0].envelope.audience, 'org1');
  await bus.ack({ subscriptionId: 'other', deliveryIds: tokens(other) });
  assert.equal((await bus.pull({ subscriptionId: 'slow' })).messages.length, 0);
  await assert.rejects(bus.subscribe({ subscriptionId: 'slow', audience: 'org1' }), {
    code: 'AUDIENCE_MISMATCH',
  });
  await assert.rejects(bus.ack({ subscriptionId: 'slow', deliveryIds: tokens(other) }), {
    code: 'UNKNOWN_DELIVERY',
  });
});

test('local event bus is bounded, leased, ordered and supports partial prefix acknowledgment', async (t) => {
  const { bus } = await fixture(t, { maxPullMessages: 3 });
  await bus.subscribe({ subscriptionId: 'platform', audience: 'org0' });
  await bus.publish([event(1), event(2), event(3), event(4)]);
  await assert.rejects(bus.pull({ subscriptionId: 'platform', limit: 4 }), {
    code: 'INVALID_ARGUMENT',
  });
  const batch = await bus.pull({ subscriptionId: 'platform', limit: 3 });
  assert.equal(batch.messages.length, 3);
  assert.equal(batch.pending, 4);
  await assert.rejects(
    bus.ack({ subscriptionId: 'platform', deliveryIds: [batch.messages[1].deliveryId] }),
    { code: 'ACK_ORDER' },
  );
  await bus.ack({ subscriptionId: 'platform', deliveryIds: [batch.messages[0].deliveryId] });
  assert.equal((await bus.pull({ subscriptionId: 'platform' })).messages.length, 0);
  await bus.ack({ subscriptionId: 'platform', deliveryIds: tokens(batch).slice(1) });
  // A duplicate ack is harmless while that delivery remains retained.
  assert.equal(
    (await bus.ack({ subscriptionId: 'platform', deliveryIds: tokens(batch) })).acknowledged,
    0,
  );
  const next = await bus.pull({ subscriptionId: 'platform' });
  assert.equal(next.messages[0].envelope.eventId, 'event-4');
});

test('local event bus retries expired leases after restart without losing order', async (t) => {
  let time = 1000;
  const f = await fixture(t, { now: () => time });
  await f.bus.subscribe({ subscriptionId: 'platform', audience: 'org0' });
  await f.bus.publish([event(1), event(2)]);
  const first = await f.bus.pull({ subscriptionId: 'platform', leaseMs: 20 });
  await f.restart();
  assert.equal((await f.bus.pull({ subscriptionId: 'platform' })).messages.length, 0);
  time = 1021;
  await assert.rejects(f.bus.ack({ subscriptionId: 'platform', deliveryIds: tokens(first) }), {
    code: 'LEASE_EXPIRED',
  });
  const retry = await f.bus.pull({ subscriptionId: 'platform' });
  assert.deepEqual(
    retry.messages.map((item) => item.sequence),
    first.messages.map((item) => item.sequence),
  );
  assert.ok(retry.messages.every((item) => item.attempt === 2));
  await assert.rejects(f.bus.ack({ subscriptionId: 'platform', deliveryIds: tokens(first) }), {
    code: 'UNKNOWN_DELIVERY',
  });
  await f.bus.ack({ subscriptionId: 'platform', deliveryIds: tokens(retry) });
});

test('local event bus nack retries the failed suffix and retains immutable JSON', async (t) => {
  const { bus } = await fixture(t);
  await bus.subscribe({ subscriptionId: 'platform', audience: 'org0' });
  const input = event(1, 'org0', { quantity: 20 });
  await bus.publish([input, event(2), event(3)]);
  input.payload.quantity = 900;
  const first = await bus.pull({ subscriptionId: 'platform' });
  assert.equal(first.messages[0].envelope.payload.quantity, 20);
  await bus.ack({ subscriptionId: 'platform', deliveryIds: [first.messages[0].deliveryId] });
  assert.equal(
    (await bus.nack({ subscriptionId: 'platform', deliveryIds: [first.messages[1].deliveryId] }))
      .released,
    2,
  );
  const retry = await bus.pull({ subscriptionId: 'platform' });
  assert.deepEqual(
    retry.messages.map((item) => item.envelope.eventId),
    ['event-2', 'event-3'],
  );
  assert.ok(retry.messages.every((item) => item.attempt === 2));
});

test('local event bus replay works from retained cursors and protects unacknowledged retention', async (t) => {
  const { bus } = await fixture(t);
  await bus.subscribe({ subscriptionId: 'fast', audience: 'org0' });
  await bus.subscribe({ subscriptionId: 'slow', audience: 'org0' });
  await bus.publish([event(1), event(2)]);
  const fast = await bus.pull({ subscriptionId: 'fast' });
  await bus.ack({ subscriptionId: 'fast', deliveryIds: tokens(fast) });
  assert.equal((await bus.prune({ throughSequence: 100 })).pruned, 0);
  await bus.replay({ subscriptionId: 'fast', afterSequence: 0 });
  const replayed = await bus.pull({ subscriptionId: 'fast' });
  assert.deepEqual(
    replayed.messages.map((item) => item.envelope.eventId),
    ['event-1', 'event-2'],
  );
  const slow = await bus.pull({ subscriptionId: 'slow' });
  await bus.ack({ subscriptionId: 'slow', deliveryIds: tokens(slow) });
  await bus.ack({ subscriptionId: 'fast', deliveryIds: tokens(replayed) });
  assert.equal((await bus.prune({ throughSequence: 100 })).pruned, 2);
  assert.equal((await bus.stats()).retained, 0);
  assert.equal((await bus.publish(event(1))).duplicate, true);
  await assert.rejects(bus.replay({ subscriptionId: 'fast', afterSequence: 0 }), {
    code: 'RETENTION_GAP',
  });
});

test('local event bus rejects oversized, invalid or conflicting events without partial validation writes', async (t) => {
  const { bus } = await fixture(t, { maxPayloadBytes: 512 });
  await assert.rejects(bus.publish(event(1, 'org0', { text: 'x'.repeat(1000) })), {
    code: 'PAYLOAD_TOO_LARGE',
  });
  await assert.rejects(bus.publish([event(1), event(2, 'org0', { text: undefined })]), {
    code: 'INVALID_ENVELOPE',
  });
  assert.equal((await bus.stats()).published, 0);
  await bus.publish(event(1, 'org0', { a: 1, b: 2 }));
  assert.equal((await bus.publish(event(1, 'org0', { b: 2, a: 1 }))).duplicate, true);
  await assert.rejects(bus.publish(event(1, 'org0', { a: 99 })), { code: 'EVENT_ID_CONFLICT' });
});

test('local event bus a stalled consumer does not prevent publisher progress or grow a memory backlog', async (t) => {
  const { bus } = await fixture(t, { maxPullMessages: 10 });
  await bus.subscribe({ subscriptionId: 'stalled', audience: 'org0' });
  await bus.publish(event(0));
  await bus.pull({ subscriptionId: 'stalled' });
  let turns = 0;
  const heartbeat = setInterval(() => turns++, 1);
  try {
    await bus.publish(Array.from({ length: 600 }, (_, i) => event(i + 1)));
  } finally {
    clearInterval(heartbeat);
  }
  const stats = await bus.stats();
  assert.equal(stats.published, 601);
  assert.equal(stats.subscriptions[0].pending, 601);
  assert.equal((await bus.pull({ subscriptionId: 'stalled' })).messages.length, 0);
  assert.ok(turns > 0, 'large publication yields between bounded SQLite transactions');
});

test('local event bus latest subscriptions and close preserve clear lifecycle semantics', async (t) => {
  const { bus } = await fixture(t);
  await bus.publish(event(1));
  await bus.subscribe({ subscriptionId: 'new', audience: 'org0', from: 'latest' });
  assert.equal((await bus.pull({ subscriptionId: 'new' })).messages.length, 0);
  const publishing = bus.publish(event(2));
  await bus.close();
  assert.equal((await publishing).duplicate, false);
  await assert.rejects(bus.publish(event(3)), { code: 'CLOSED' });
  await bus.close();
});

test('local event bus rejects oversized batches and excess queued operations explicitly', async (t) => {
  const { bus } = await fixture(t, { maxPublishBytes: 512, maxPendingOperations: 1 });
  await assert.rejects(
    bus.publish([
      event(1, 'org0', { text: 'x'.repeat(150) }),
      event(2, 'org0', { text: 'y'.repeat(150) }),
    ]),
    { code: 'BATCH_TOO_LARGE' },
  );
  assert.equal((await bus.stats()).published, 0);
  const first = bus.publish(event(1));
  await assert.rejects(bus.publish(event(2)), { code: 'BACKPRESSURE' });
  await first;
  assert.equal((await bus.publish(event(2))).duplicate, false);
});

test('local event bus recovers committed publications after a producer exits without closing', async (t) => {
  const f = await fixture(t);
  const storageDir = path.dirname(f.bus.databasePath);
  await f.bus.close();
  const script = `
    import { createLocalEventBus } from ${JSON.stringify(new URL('../sources/local-event-bus.mjs', import.meta.url).href)};
    const bus = await createLocalEventBus({storageDir: process.argv[1]});
    await bus.subscribe({subscriptionId:'platform',audience:'org0'});
    await bus.publish(${JSON.stringify(event(1))});
    process.exit(0);
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script, storageDir], {
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(child.status, 0, child.stderr);
  await f.restart();
  const recovered = await f.bus.pull({ subscriptionId: 'platform' });
  assert.equal(recovered.messages.length, 1);
  assert.equal(recovered.messages[0].envelope.eventId, 'event-1');
});

test('local event bus presentation-only pruning leaves audit records and unacknowledged blob references intact', async (t) => {
  const { bus } = await fixture(t);
  const ref = (sha) => ({
    documentRef: { sha256: sha.repeat(64), bytes: 100, contentType: 'application/json' },
  });
  await bus.subscribe({ subscriptionId: 'views', audience: 'observer' });
  await bus.subscribe({ subscriptionId: 'archive', audience: 'audit' });
  await bus.publish([
    event(1, 'observer', ref('a')),
    event(2, 'audit', ref('c')),
    event(3, 'observer', ref('b')),
  ]);
  const views = await bus.pull({ subscriptionId: 'views' });
  await bus.ack({ subscriptionId: 'views', deliveryIds: [views.messages[0].deliveryId] });
  const archive = await bus.pull({ subscriptionId: 'archive' });
  await bus.ack({ subscriptionId: 'archive', deliveryIds: tokens(archive) });
  assert.equal((await bus.prune({ throughSequence: 100, audiences: ['observer'] })).pruned, 1);
  assert.deepEqual(await bus.retainedDocumentRefs({ audiences: ['observer'] }), ['b'.repeat(64)]);
  assert.deepEqual(
    new Set(await bus.retainedDocumentRefs()),
    new Set(['b'.repeat(64), 'c'.repeat(64)]),
  );
  assert.equal((await bus.stats()).retained, 2);
});
