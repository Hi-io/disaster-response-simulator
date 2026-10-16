import path from 'node:path';
import { mkdir, open, rename, unlink, readdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { EventBusError } from './local-event-bus.mjs';

const fail = (code, message) => {
  throw new EventBusError(code, message);
};
const hash = (data) => createHash('sha256').update(data).digest('hex');
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
function limits(maxDocumentBytes) {
  if (
    !Number.isSafeInteger(maxDocumentBytes) ||
    maxDocumentBytes < 1 ||
    maxDocumentBytes > 1024 * 1024 * 1024
  )
    fail('INVALID_ARGUMENT', 'maxDocumentBytes must be a positive integer no larger than 1 GiB');
}
function reference(ref, maxDocumentBytes) {
  if (
    !isObject(ref) ||
    !/^[a-f0-9]{64}$/.test(ref.sha256 ?? '') ||
    ref.contentType !== 'application/json' ||
    !Number.isSafeInteger(ref.bytes) ||
    ref.bytes < 1 ||
    ref.bytes > maxDocumentBytes
  )
    fail(
      'DOCUMENT_REF',
      'Document reference must contain a SHA-256 digest, bounded byte count and application/json content type',
    );
  return ref;
}
// Sorted plain JSON makes retries stable even when callers reconstruct object
// properties in a different order. No reference to a mutable simulation object is
// kept after this synchronous detachment at the publication boundary.
function canonical(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || ancestors.has(value))
    fail('DOCUMENT_JSON', 'Documents must contain finite, acyclic JSON data');
  ancestors.add(value);
  let result;
  if (Array.isArray(value)) result = value.map((item) => canonical(item, ancestors));
  else {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value)))
      fail('DOCUMENT_JSON', 'Documents must contain plain JSON objects');
    result = Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key], ancestors)]),
    );
  }
  ancestors.delete(value);
  return result;
}
function encode(payload, maxDocumentBytes) {
  const data = Buffer.from(JSON.stringify(canonical(payload)), 'utf8');
  if (data.length > maxDocumentBytes)
    fail('DOCUMENT_TOO_LARGE', `Document exceeds the ${maxDocumentBytes}-byte budget`);
  return data;
}
function verify(data, ref) {
  if (!Buffer.isBuffer(data) || data.length !== ref.bytes || hash(data) !== ref.sha256)
    fail(
      'DOCUMENT_INTEGRITY',
      'Stored document does not match its immutable byte count and SHA-256 digest',
    );
}

/** Local blob adapter. A future object-storage adapter implements the same put/get methods. */
export async function createLocalDocumentStore({ storageDir, maxDocumentBytes = 128000000 } = {}) {
  limits(maxDocumentBytes);
  if (typeof storageDir !== 'string' || !storageDir)
    fail('INVALID_ARGUMENT', 'Document storageDir is required');
  await mkdir(storageDir, { recursive: true });
  const filename = (ref) =>
    path.join(storageDir, `${reference(ref, maxDocumentBytes).sha256}.json`);
  const get = async (ref) => {
    const file = await open(filename(ref), 'r').catch((error) => {
      if (error.code === 'ENOENT') fail('DOCUMENT_NOT_FOUND', 'Referenced document is unavailable');
      throw error;
    });
    try {
      if ((await file.stat()).size !== ref.bytes)
        fail('DOCUMENT_INTEGRITY', 'Stored document byte count differs from its reference');
      const data = Buffer.alloc(ref.bytes);
      let offset = 0;
      while (offset < data.length) {
        const { bytesRead } = await file.read(data, offset, data.length - offset, offset);
        if (!bytesRead)
          fail('DOCUMENT_INTEGRITY', 'Stored document ended before its declared byte count');
        offset += bytesRead;
      }
      if ((await file.stat()).size !== ref.bytes)
        fail('DOCUMENT_INTEGRITY', 'Stored document changed while being read');
      verify(data, ref);
      return data;
    } finally {
      await file.close();
    }
  };
  return {
    get,
    async prune({ retainedSha256 }) {
      if (
        !Array.isArray(retainedSha256) ||
        retainedSha256.some((value) => !/^[a-f0-9]{64}$/.test(value))
      )
        fail('DOCUMENT_REF', 'Retained document digests must be SHA-256 strings');
      const retained = new Set(retainedSha256);
      let pruned = 0;
      for (const entry of await readdir(storageDir, { withFileTypes: true })) {
        if (
          !entry.isFile() ||
          !/^[a-f0-9]{64}\.json$/.test(entry.name) ||
          retained.has(entry.name.slice(0, -5))
        )
          continue;
        await unlink(path.join(storageDir, entry.name));
        pruned++;
      }
      return { pruned };
    },
    async put({ sha256, bytes, data }) {
      const ref = reference({ sha256, bytes, contentType: 'application/json' }, maxDocumentBytes);
      verify(data, ref);
      try {
        await get(ref);
        return ref;
      } catch (error) {
        if (error.code !== 'DOCUMENT_NOT_FOUND') throw error;
      }
      const target = filename(ref),
        temporary = path.join(storageDir, `.${sha256}.${randomUUID()}.tmp`);
      let file;
      try {
        file = await open(temporary, 'wx', 0o600);
        await file.writeFile(data);
        await file.sync();
        await file.close();
        file = null;
        try {
          await rename(temporary, target);
        } catch (error) {
          // Another publisher of identical content may have won the rename.
          if (!['EEXIST', 'EPERM', 'EACCES'].includes(error.code)) throw error;
          await get(ref);
        }
        // Flush directory entries where supported. Windows does not allow opening
        // a directory this way; the file itself was already flushed before rename.
        let directory;
        try {
          directory = await open(storageDir, 'r');
          await directory.sync();
        } catch (error) {
          if (!['EISDIR', 'EINVAL', 'ENOTSUP', 'EPERM', 'EACCES', 'EBADF'].includes(error.code))
            throw error;
        } finally {
          await directory?.close();
        }
        return ref;
      } finally {
        await file?.close();
        await unlink(temporary).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
        });
      }
    },
  };
}

/**
 * Large documents remain outside the small-message queue. Publish writes a
 * content-addressed immutable blob before publishing its reference, so a consumer
 * can never receive a successfully published reference to an unwritten document.
 * Consumers acknowledge the queue delivery only after resolve + durable handling.
 *
 * Replacing bus with Pub/Sub and store with GCS requires no simulation changes.
 * Blobs are not automatically pruned: queue acknowledgment does not mean every
 * retained/replayed reference may be deleted.
 */
export async function createQueuedDocuments({
  bus,
  storageDir,
  store,
  maxInlineBytes = 64000,
  maxDocumentBytes = 128000000,
} = {}) {
  limits(maxDocumentBytes);
  if (
    !Number.isSafeInteger(maxInlineBytes) ||
    maxInlineBytes < 0 ||
    maxInlineBytes > 64000 ||
    maxInlineBytes > maxDocumentBytes
  )
    fail(
      'INVALID_ARGUMENT',
      'maxInlineBytes must be between 0 and the smaller of 64000 and maxDocumentBytes',
    );
  if (typeof bus?.publish !== 'function')
    fail('INVALID_ARGUMENT', 'A publish-capable event bus is required');
  store ??= await createLocalDocumentStore({ storageDir, maxDocumentBytes });
  if (typeof store.put !== 'function' || typeof store.get !== 'function')
    fail('INVALID_ARGUMENT', 'Document store must implement put and get');
  return {
    // The owner must first prune acknowledged queue records, then supply every
    // digest still referenced by retained records. Consumers holding a lease are
    // therefore protected, while coalescible presentation history stays bounded.
    async pruneUnreferenced({ retainedSha256 }) {
      return typeof store.prune === 'function'
        ? store.prune({ retainedSha256 })
        : { pruned: 0, supported: false };
    },
    async publish(envelope) {
      const data = encode(envelope?.payload, maxDocumentBytes);
      let payload;
      if (data.length <= maxInlineBytes) payload = { document: JSON.parse(data.toString('utf8')) };
      else {
        const ref = { sha256: hash(data), bytes: data.length, contentType: 'application/json' };
        await store.put({ ...ref, data });
        payload = { documentRef: ref };
      }
      return bus.publish({ ...envelope, payload });
    },
    async resolve(envelope) {
      const payload = envelope?.payload;
      if (!isObject(payload) || Object.keys(payload).length !== 1)
        fail(
          'DOCUMENT_REF',
          'Queued document must contain exactly one document or documentRef field',
        );
      if (Object.hasOwn(payload, 'document'))
        return JSON.parse(
          encode(payload.document, Math.min(maxInlineBytes, maxDocumentBytes)).toString('utf8'),
        );
      if (!Object.hasOwn(payload, 'documentRef'))
        fail('DOCUMENT_REF', 'Queued document does not contain a recognized document field');
      const ref = reference(payload.documentRef, maxDocumentBytes);
      const data = await store.get(ref);
      verify(data, ref);
      try {
        return JSON.parse(data.toString('utf8'));
      } catch {
        fail('DOCUMENT_JSON', 'Referenced document is not valid JSON');
      }
    },
  };
}
