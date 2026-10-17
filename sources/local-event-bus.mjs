import { DatabaseSync } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { setImmediate as yieldTurn } from 'node:timers/promises';

/**
 * Transport boundary for a future Pub/Sub adapter. A producer publishes immutable
 * envelopes; consumers pull bounded, leased batches and acknowledge only after
 * durable processing. A slow or disconnected consumer is never called by publish.
 *
 * This local adapter delivers one ordered batch per subscription at a time. That
 * is a stronger guarantee than orderingKey order and deliberately keeps recovery
 * understandable. Different subscriptions (normally one per organization) do not
 * share leases. At-least-once delivery still requires eventId deduplication at the
 * consumer's durable side-effect boundary.
 */
export const EVENT_BUS_CONTRACT = Object.freeze({
  version: 1,
  delivery: 'at-least-once',
  ordering: 'per-subscription; implies per-orderingKey',
  methods: ['publish', 'subscribe', 'pull', 'ack', 'nack', 'replay', 'stats', 'prune', 'close'],
});

export class EventBusError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'EventBusError';
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new EventBusError(code, message);
};
const identifier = (value, label) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 512)
    fail('INVALID_ENVELOPE', `${label} must be a nonempty string of at most 512 characters`);
  return value;
};
const integer = (value, label, min, max) => {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    fail('INVALID_ARGUMENT', `${label} must be an integer between ${min} and ${max}`);
  return value;
};
// Canonical encoding makes an idempotent retry independent of object key order.
function canonical(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || seen.has(value))
    fail('INVALID_ENVELOPE', 'Event payload must contain finite, acyclic JSON data');
  seen.add(value);
  let result;
  if (Array.isArray(value)) result = value.map((item) => canonical(item, seen));
  else {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value)))
      fail('INVALID_ENVELOPE', 'Event payload must contain plain JSON objects');
    result = Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key], seen)]),
    );
  }
  seen.delete(value);
  return result;
}

/**
 * @param {object} options
 * @param {string} [options.storageDir] Persistent queue directory, normally .local/transport.
 * @param {string} [options.databasePath] Explicit SQLite path; ':memory:' is useful in tests.
 * @param {number} [options.maxPayloadBytes=262144] Complete envelope byte budget; oversized events fail explicitly.
 * @param {number} [options.maxPullMessages=200] Maximum leased messages, never an unbounded history response.
 * @param {number} [options.maxPublishBatch=1000] Bound work and validation allocated by a single call.
 * @param {number} [options.maxPublishBytes=4194304] Total encoded bytes accepted by one publish call.
 * @param {number} [options.maxPendingOperations=128] Explicit caller backpressure rather than an unbounded promise queue.
 * @param {Function} [options.now=Date.now] Wall-clock lease source, unrelated to simulation time.
 */
export async function createLocalEventBus({
  storageDir,
  databasePath,
  maxPayloadBytes = 262144,
  maxPullMessages = 200,
  maxPublishBatch = 1000,
  maxPublishBytes = 4194304,
  maxPendingOperations = 128,
  now = Date.now,
} = {}) {
  integer(maxPayloadBytes, 'maxPayloadBytes', 256, 16 * 1024 * 1024);
  integer(maxPullMessages, 'maxPullMessages', 1, 10000);
  integer(maxPublishBatch, 'maxPublishBatch', 1, 10000);
  integer(maxPublishBytes, 'maxPublishBytes', 256, 64 * 1024 * 1024);
  integer(maxPendingOperations, 'maxPendingOperations', 1, 10000);
  if (typeof now !== 'function') fail('INVALID_ARGUMENT', 'now must be a function');
  if (!databasePath && !storageDir)
    fail('INVALID_ARGUMENT', 'storageDir or databasePath is required');
  const filename = databasePath ?? path.join(storageDir, 'events.sqlite');
  if (filename !== ':memory:') await mkdir(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA synchronous=FULL;
    PRAGMA foreign_keys=ON;
    PRAGMA busy_timeout=1000;
    CREATE TABLE IF NOT EXISTS messages (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      audience TEXT NOT NULL,
      envelope TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS messages_audience_sequence ON messages(audience, sequence);
    CREATE TABLE IF NOT EXISTS event_ids (
      event_id TEXT PRIMARY KEY,
      hash TEXT NOT NULL,
      sequence INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS subscriptions (
      subscription_id TEXT PRIMARY KEY,
      audience TEXT NOT NULL,
      cursor INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS subscriptions_audience_cursor ON subscriptions(audience, cursor);
    CREATE TABLE IF NOT EXISTS deliveries (
      subscription_id TEXT NOT NULL REFERENCES subscriptions(subscription_id),
      sequence INTEGER NOT NULL REFERENCES messages(sequence) ON DELETE CASCADE,
      delivery_id TEXT NOT NULL UNIQUE,
      attempt INTEGER NOT NULL,
      lease_until INTEGER NOT NULL,
      acknowledged INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(subscription_id, sequence)
    );
    CREATE INDEX IF NOT EXISTS deliveries_pending ON deliveries(subscription_id, acknowledged, sequence);
    CREATE INDEX IF NOT EXISTS deliveries_sequence ON deliveries(sequence);
    CREATE TABLE IF NOT EXISTS retention (
      audience TEXT PRIMARY KEY,
      after_sequence INTEGER NOT NULL
    );
  `);
  const sql = Object.fromEntries(
    Object.entries({
      duplicate: 'SELECT hash, sequence FROM event_ids WHERE event_id = ?',
      insert: 'INSERT INTO messages(event_id,audience,envelope,created_at) VALUES (?,?,?,?)',
      remember: 'INSERT INTO event_ids(event_id,hash,sequence) VALUES (?,?,?)',
      subscription:
        'SELECT subscription_id AS subscriptionId, audience, cursor FROM subscriptions WHERE subscription_id = ?',
      addSubscription: 'INSERT INTO subscriptions(subscription_id,audience,cursor) VALUES (?,?,?)',
      maxSequence: 'SELECT COALESCE(MAX(sequence),0) AS sequence FROM event_ids',
      floor: 'SELECT after_sequence AS sequence FROM retention WHERE audience = ?',
      pending:
        'SELECT sequence, delivery_id AS deliveryId, attempt, lease_until AS leaseUntil FROM deliveries WHERE subscription_id = ? AND acknowledged = 0 ORDER BY sequence',
      next: 'SELECT sequence, envelope FROM messages WHERE audience = ? AND sequence > ? ORDER BY sequence LIMIT ?',
      deliver: `INSERT INTO deliveries(subscription_id,sequence,delivery_id,attempt,lease_until,acknowledged) VALUES (?,?,?,1,?,0)
      ON CONFLICT(subscription_id,sequence) DO UPDATE SET delivery_id=excluded.delivery_id, attempt=deliveries.attempt+1, lease_until=excluded.lease_until, acknowledged=0`,
      delivery:
        'SELECT sequence, delivery_id AS deliveryId, attempt, lease_until AS leaseUntil, acknowledged FROM deliveries WHERE subscription_id = ? AND delivery_id = ?',
      acknowledge:
        'UPDATE deliveries SET acknowledged=1, lease_until=0 WHERE subscription_id = ? AND delivery_id = ?',
      advance: 'UPDATE subscriptions SET cursor = ? WHERE subscription_id = ?',
      release:
        'UPDATE deliveries SET lease_until=0 WHERE subscription_id = ? AND acknowledged=0 AND sequence >= ?',
      pendingCount: 'SELECT COUNT(*) AS count FROM messages WHERE audience = ? AND sequence > ?',
      retainedCount: 'SELECT COUNT(*) AS count FROM messages',
      publishedCount: 'SELECT COUNT(*) AS count FROM event_ids',
      subscriptions:
        'SELECT subscription_id AS subscriptionId, audience, cursor FROM subscriptions ORDER BY subscription_id',
      clearDeliveries: 'DELETE FROM deliveries WHERE subscription_id = ?',
      pruneAudiences: 'SELECT DISTINCT audience FROM subscriptions',
      pruneCursor: 'SELECT MIN(cursor) AS cursor FROM subscriptions WHERE audience = ?',
      pruneCandidates: `SELECT sequence,audience FROM messages
      WHERE audience = ? AND sequence <= ? ORDER BY sequence LIMIT ?`,
      pruneMessage: 'DELETE FROM messages WHERE sequence = ?',
      retainFloor:
        'INSERT INTO retention(audience,after_sequence) VALUES (?,?) ON CONFLICT(audience) DO UPDATE SET after_sequence=MAX(after_sequence,excluded.after_sequence)',
      documentRefs: `SELECT DISTINCT json_extract(envelope,'$.payload.documentRef.sha256') AS sha256
      FROM messages WHERE (? IS NULL OR audience IN (SELECT value FROM json_each(?)))
      AND json_extract(envelope,'$.payload.documentRef.sha256') IS NOT NULL`,
      audienceDocumentRefs: `SELECT DISTINCT json_extract(envelope,'$.payload.documentRef.sha256') AS sha256
      FROM messages WHERE audience = ?
      AND json_extract(envelope,'$.payload.documentRef.sha256') IS NOT NULL`,
    }).map(([key, value]) => [key, db.prepare(value)]),
  );
  let tail = Promise.resolve(),
    closing = false,
    closed = false,
    pendingOperations = 0;
  const operation = (fn) => {
    if (closing || closed)
      return Promise.reject(new EventBusError('CLOSED', 'Event bus is closed'));
    if (pendingOperations >= maxPendingOperations)
      return Promise.reject(
        new EventBusError(
          'BACKPRESSURE',
          'Event bus operation queue is full; retry after the outstanding operation completes',
        ),
      );
    pendingOperations++;
    const result = tail.then(fn).finally(() => {
      pendingOperations--;
    });
    tail = result.catch(() => {});
    return result;
  };
  const transaction = (fn) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };
  const subscription = (subscriptionId) => {
    identifier(subscriptionId, 'subscriptionId');
    const row = sql.subscription.get(subscriptionId);
    if (!row) fail('SUBSCRIPTION_NOT_FOUND', 'Subscription does not exist');
    return row;
  };
  const countPending = (sub) => sql.pendingCount.get(sub.audience, sub.cursor).count;
  const encode = (event) => {
    if (!event || typeof event !== 'object') fail('INVALID_ENVELOPE', 'Event envelope is required');
    const envelope = {
      version: 1,
      eventId: identifier(event.eventId, 'eventId'),
      runId: identifier(event.runId, 'runId'),
      orderingKey: identifier(event.orderingKey, 'orderingKey'),
      audience: identifier(event.audience, 'audience'),
      type: identifier(event.type, 'type'),
      simTimeMs: integer(event.simTimeMs, 'simTimeMs', 0, Number.MAX_SAFE_INTEGER),
      payload: canonical(event.payload),
    };
    const encoded = JSON.stringify(envelope);
    if (Buffer.byteLength(encoded) > maxPayloadBytes)
      fail(
        'PAYLOAD_TOO_LARGE',
        `Envelope exceeds the ${maxPayloadBytes}-byte event budget; split it into smaller events`,
      );
    return { envelope, encoded, hash: createHash('sha256').update(encoded).digest('hex') };
  };
  return {
    contract: EVENT_BUS_CONTRACT,
    databasePath: filename,
    publish(events) {
      return operation(async () => {
        const items = Array.isArray(events) ? events : [events];
        integer(items.length, 'publish batch length', 1, maxPublishBatch);
        // Validate the entire bounded batch before writing, including conflicting retries.
        const encoded = [],
          seen = new Map();
        let totalBytes = 0;
        for (const event of items) {
          const item = encode(event);
          totalBytes += Buffer.byteLength(item.encoded);
          if (totalBytes > maxPublishBytes)
            fail(
              'BATCH_TOO_LARGE',
              `Publication exceeds the ${maxPublishBytes}-byte batch budget; use smaller batches`,
            );
          encoded.push(item);
        }
        for (const item of encoded) {
          const previous =
            seen.get(item.envelope.eventId) ?? sql.duplicate.get(item.envelope.eventId)?.hash;
          if (previous && previous !== item.hash)
            fail(
              'EVENT_ID_CONFLICT',
              `eventId ${item.envelope.eventId} already identifies different data`,
            );
          seen.set(item.envelope.eventId, item.hash);
        }
        const receipts = [];
        for (let offset = 0; offset < encoded.length; offset += 100) {
          transaction(() => {
            for (const item of encoded.slice(offset, offset + 100)) {
              const previous = sql.duplicate.get(item.envelope.eventId);
              if (previous) {
                receipts.push({
                  eventId: item.envelope.eventId,
                  sequence: previous.sequence,
                  duplicate: true,
                });
                continue;
              }
              const sequence = Number(
                sql.insert.run(item.envelope.eventId, item.envelope.audience, item.encoded, now())
                  .lastInsertRowid,
              );
              sql.remember.run(item.envelope.eventId, item.hash, sequence);
              receipts.push({ eventId: item.envelope.eventId, sequence, duplicate: false });
            }
          });
          if (offset + 100 < encoded.length) await yieldTurn();
        }
        return Array.isArray(events) ? receipts : receipts[0];
      });
    },
    subscribe({ subscriptionId, audience, from = 'beginning' }) {
      return operation(() => {
        identifier(subscriptionId, 'subscriptionId');
        identifier(audience, 'audience');
        if (!['beginning', 'latest'].includes(from))
          fail('INVALID_ARGUMENT', 'from must be beginning or latest');
        const existing = sql.subscription.get(subscriptionId);
        if (existing) {
          if (existing.audience !== audience)
            fail('AUDIENCE_MISMATCH', 'A subscription cannot change audience');
          return existing;
        }
        const cursor =
          from === 'latest'
            ? sql.maxSequence.get().sequence
            : (sql.floor.get(audience)?.sequence ?? 0);
        sql.addSubscription.run(subscriptionId, audience, cursor);
        return subscription(subscriptionId);
      });
    },
    pull({ subscriptionId, limit = Math.min(100, maxPullMessages), leaseMs = 30000 }) {
      return operation(() => {
        integer(limit, 'limit', 1, maxPullMessages);
        integer(leaseMs, 'leaseMs', 1, 300000);
        const sub = subscription(subscriptionId),
          time = now();
        const existing = sql.pending.all(subscriptionId);
        if (existing.some((item) => item.leaseUntil > time))
          return {
            messages: [],
            pending: countPending(sub),
            leaseUntil: Math.max(...existing.map((item) => item.leaseUntil)),
          };
        const rows = sql.next.all(sub.audience, sub.cursor, limit),
          leaseUntil = time + leaseMs;
        const messages = transaction(() =>
          rows.map((row) => {
            const deliveryId = randomUUID();
            sql.deliver.run(subscriptionId, row.sequence, deliveryId, leaseUntil);
            const delivery = sql.delivery.get(subscriptionId, deliveryId);
            return {
              deliveryId,
              sequence: row.sequence,
              envelope: JSON.parse(row.envelope),
              attempt: delivery.attempt,
            };
          }),
        );
        return {
          messages,
          pending: countPending(sub),
          leaseUntil: messages.length ? leaseUntil : null,
        };
      });
    },
    ack({ subscriptionId, deliveryIds }) {
      return operation(() => {
        const sub = subscription(subscriptionId);
        if (!Array.isArray(deliveryIds) || deliveryIds.length > maxPullMessages)
          fail('INVALID_ARGUMENT', 'deliveryIds must be a bounded array');
        const time = now(),
          wanted = new Set(deliveryIds),
          pending = sql.pending.all(subscriptionId);
        const requested = [...wanted]
          .map((id) => {
            const item = sql.delivery.get(subscriptionId, id);
            if (!item)
              fail(
                'UNKNOWN_DELIVERY',
                'Delivery token does not belong to this subscription or was superseded',
              );
            if (!item.acknowledged && item.leaseUntil <= time)
              fail('LEASE_EXPIRED', 'Delivery lease has expired; pull again before acknowledging');
            return item;
          })
          .filter((item) => !item.acknowledged);
        const selected = new Set(requested.map((item) => item.deliveryId));
        const prefix = pending.slice(0, requested.length);
        if (prefix.some((item) => !selected.has(item.deliveryId)))
          fail('ACK_ORDER', 'Acknowledge a contiguous prefix of the ordered batch');
        const cursor = prefix.at(-1)?.sequence ?? sub.cursor;
        transaction(() => {
          for (const item of prefix) sql.acknowledge.run(subscriptionId, item.deliveryId);
          sql.advance.run(cursor, subscriptionId);
        });
        return { cursor, acknowledged: requested.length };
      });
    },
    nack({ subscriptionId, deliveryIds }) {
      return operation(() => {
        subscription(subscriptionId);
        if (
          !Array.isArray(deliveryIds) ||
          !deliveryIds.length ||
          deliveryIds.length > maxPullMessages
        )
          fail('INVALID_ARGUMENT', 'deliveryIds must be a nonempty bounded array');
        const items = deliveryIds.map((id) => {
          const item = sql.delivery.get(subscriptionId, id);
          if (!item || item.acknowledged)
            fail('UNKNOWN_DELIVERY', 'Only outstanding deliveries can be released');
          return item;
        });
        // Later messages must also retry, so a failed message can never be overtaken.
        const fromSequence = Math.min(...items.map((item) => item.sequence));
        const released = sql.release.run(subscriptionId, fromSequence).changes;
        return { released: Number(released) };
      });
    },
    replay({ subscriptionId, afterSequence = 0 }) {
      return operation(() => {
        const sub = subscription(subscriptionId);
        integer(afterSequence, 'afterSequence', 0, sql.maxSequence.get().sequence);
        const floor = sql.floor.get(sub.audience)?.sequence ?? 0;
        if (afterSequence < floor)
          fail(
            'RETENTION_GAP',
            `Replay begins before retained history; earliest cursor is ${floor}`,
          );
        transaction(() => {
          sql.clearDeliveries.run(subscriptionId);
          sql.advance.run(afterSequence, subscriptionId);
        });
        return { subscriptionId, cursor: afterSequence };
      });
    },
    stats() {
      return operation(() => ({
        published: sql.publishedCount.get().count,
        retained: sql.retainedCount.get().count,
        subscriptions: sql.subscriptions
          .all()
          .map((sub) => ({ ...sub, pending: countPending(sub) })),
      }));
    },
    retainedDocumentRefs({ audiences } = {}) {
      return operation(() => {
        if (
          audiences !== undefined &&
          (!Array.isArray(audiences) || audiences.some((value) => typeof value !== 'string'))
        )
          fail('INVALID_ARGUMENT', 'audiences must be an array of strings');
        if (audiences === undefined) return sql.documentRefs.all(null, null).map(row => row.sha256);
        return [...new Set([...new Set(audiences)].flatMap(audience =>
          sql.audienceDocumentRefs.all(audience).map(row => row.sha256)))];
      });
    },
    prune({ throughSequence, limit = 1000, audiences }) {
      return operation(() => {
        integer(throughSequence, 'throughSequence', 0, Number.MAX_SAFE_INTEGER);
        integer(limit, 'limit', 1, 10000);
        // Never remove a message until every subscription for its audience has
        // acknowledged it. event_ids tombstones remain to deduplicate old retries.
        if (
          audiences !== undefined &&
          (!Array.isArray(audiences) || audiences.some((value) => typeof value !== 'string'))
        )
          fail('INVALID_ARGUMENT', 'audiences must be an array of strings');
        // Seek the existing audience/sequence index instead of scanning a
        // potentially huge unrelated audit backlog. MIN(cursor) is exactly
        // the prefix acknowledged by EVERY subscriber for this audience.
        // Taking up to limit candidates per audience, then merging by sequence,
        // preserves the original global ordering and limit across audiences.
        const selected = audiences === undefined ? sql.pruneAudiences.all().map(row => row.audience) : [...new Set(audiences)];
        const rows = selected.flatMap(audience => {
          const cursor = sql.pruneCursor.get(audience).cursor;
          return cursor === null ? [] : sql.pruneCandidates.all(audience, Math.min(throughSequence, cursor), limit);
        }).sort((a, b) => a.sequence - b.sequence).slice(0, limit);
        transaction(() => {
          for (const row of rows) {
            sql.pruneMessage.run(row.sequence);
            sql.retainFloor.run(row.audience, row.sequence);
          }
        });
        return { pruned: rows.length };
      });
    },
    close() {
      if (closed) return Promise.resolve();
      if (closing) return tail;
      closing = true;
      const result = tail.then(() => {
        db.close();
        closed = true;
      });
      tail = result;
      return result;
    },
  };
}
