import path from 'node:path';
import { readdir, realpath, stat, unlink, rmdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { digest } from '../engine/determinism.mjs';

const archiveDirectory = /^(?:posts|messages|events|snapshot)-[a-zA-Z0-9_-]{6}$/;
export async function capturePreviousDemoArchives(root) {
  const entries = await readdir(root, { withFileTypes: true }).catch(e => { if (e.code === 'ENOENT') return []; throw e; });
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !archiveDirectory.test(entry.name)) continue;
    const directory = path.resolve(root, entry.name);
    if (await realpath(directory) !== directory) continue;
    const files = await readdir(directory, { withFileTypes: true });
    if (files.length !== 1 || files[0].name !== 'records.sqlite' || !files[0].isFile() || files[0].isSymbolicLink()) continue;
    const file = path.join(directory, 'records.sqlite');
    const info = await stat(file);
    candidates.push({ directory, file, bytes: info.size, device: info.dev, inode: info.ino });
  }
  return candidates;
}

// Candidates must be captured before the replacement engine starts. Its active
// SQLite files and the replacement checkpoint's snapshots are newly created
// paths, never members of this list. No recursive deletion is used.
export async function cleanPreviousDemoArchives(root, candidates, retainedFiles = []) {
  const prefix = path.resolve(root) + path.sep, retained = new Set(retainedFiles.map(f => path.resolve(f)));
  let deleted = 0, bytes = 0;
  for (const item of candidates) {
    if (!item.file.startsWith(prefix) || retained.has(item.file) || !archiveDirectory.test(path.basename(item.directory)) ||
      path.dirname(item.file) !== item.directory || path.basename(item.file) !== 'records.sqlite') continue;
    const info = await stat(item.file).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
    if (!info || info.dev !== item.device || info.ino !== item.inode || await realpath(item.directory) !== item.directory) continue;
    const files = await readdir(item.directory);
    if (files.length !== 1 || files[0] !== 'records.sqlite') continue;
    await unlink(item.file); await rmdir(item.directory); deleted++; bytes += info.size;
  }
  return { deleted, bytes };
}

// This is a checkpoint consumer of the existing bus, not a new transport
// protocol. Only exact duplicate audit payloads already saved in a DURABLE
// physical checkpoint are acknowledged. Normal replay/deduplication tombstones
// remain intact. Any other audit consumer still protects its unacked messages.
export async function compactDemoAudit({ bus, checkpoint, producer, maxMessages = 20000, workMs = 500 } = {}) {
  if (!checkpoint?.manifest?.config?.continuousDemo || checkpoint.manifest.config.mode !== 'interactive')
    throw Error('Checkpoint audit compaction is restricted to a continuous interactive demonstration.');
  if (!producer || producer.runId !== checkpoint.runId || !Number.isSafeInteger(producer.generation) ||
    typeof producer.epoch !== 'string' || !Number.isSafeInteger(producer.eventCursor))
    throw Error('Audit compaction requires the matching durable producer cursor.');
  const length = checkpoint.log?.length;
  if (!Number.isSafeInteger(length) || length < 0 || !Number.isSafeInteger(maxMessages) || maxMessages < 1 ||
    maxMessages > 100000 || !Number.isSafeInteger(workMs) || workMs < 1 || workMs > 5000)
    throw Error('Checkpoint compaction limits must be bounded.');
  let database;
  if (!Array.isArray(checkpoint.log)) {
    if (!checkpoint.log?.archive || typeof checkpoint.log.file !== 'string') throw Error('The physical event archive is unavailable.');
    database = new DatabaseSync(checkpoint.log.file, { readOnly: true });
  }
  const row = database?.prepare('SELECT value FROM records WHERE idx=?');
  const subscriptionId = 'demo-durable-checkpoint-v1';
  const subscription = await bus.subscribe({ subscriptionId, audience: 'audit', from: 'beginning' });
  let acknowledged = 0, pruned = 0, cursor = subscription.cursor, throughOffset = -1;
  const started = performance.now();
  try {
    while (acknowledged < maxMessages && performance.now() - started < workMs) {
      const batch = await bus.pull({ subscriptionId, limit: Math.min(200, maxMessages - acknowledged), leaseMs: 30000 });
      if (!batch.messages.length) break;
      const accepted = [];
      for (const message of batch.messages) {
        const e = message.envelope, offset = e.payload?.offset;
        const parts = e.eventId.split(':');
        // Earlier transport producers may have published the same physical
        // checkpoint history before a process recovery rotated their epoch.
        // Epoch equality is not a proof of durability; exact run/offset/payload
        // equality below is. Accept historical producer IDs only in the known
        // schema, never unrelated worlds or events beyond this checkpoint.
        if (e.runId !== checkpoint.runId || parts.length !== 6 || !/^[\w-]{1,120}$/.test(parts[0]) ||
          parts[1] !== checkpoint.runId || parts[2] !== 'generation' || !/^\d+$/.test(parts[3]) || parts[4] !== 'event' ||
          parts[5] !== String(offset) || e.type !== 'simulation.event' || !Number.isSafeInteger(offset) ||
          offset < 0 || offset >= length) break;
        const saved = database ? row.get(offset)?.value : checkpoint.log[offset];
        const event = database && saved ? JSON.parse(saved) : saved;
        if (!event || digest(event) !== digest(e.payload.event)) {
          // Release only the lease; acknowledge or remove none of this
          // unverified batch. A later maintenance attempt can recheck it.
          await bus.nack({ subscriptionId, deliveryIds: batch.messages.map(m => m.deliveryId) });
          throw Error('Queued audit event differs from the durable physical checkpoint.');
        }
        accepted.push(message.deliveryId); throughOffset = offset; cursor = message.sequence;
      }
      if (accepted.length) {
        await bus.ack({ subscriptionId, deliveryIds: accepted }); acknowledged += accepted.length;
      }
      const pending = batch.messages.slice(accepted.length);
      if (pending.length) {
        await bus.nack({ subscriptionId, deliveryIds: pending.map(m => m.deliveryId) });
        break;
      }
      await yieldTurn();
    }
    if (cursor) {
      let removed;
      do {
        removed = (await bus.prune({ throughSequence: cursor, audiences: ['audit'], limit: 1000 })).pruned;
        pruned += removed;
        // Historical cleanup must yield to HTTP/Pub/Sub and share the same
        // time budget as verification. Deferred rows remain durable.
        await yieldTurn();
      } while (removed === 1000 && performance.now() - started < workMs);
    }
    return { acknowledged, pruned, cursor, throughOffset, physicalHistoryPreserved: true, deduplicationTombstonesPreserved: true };
  } finally { database?.close(); }
}
