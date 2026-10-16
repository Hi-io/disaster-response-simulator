import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createLocalEventBus } from '../sources/local-event-bus.mjs';
import { createQueuedDocuments } from '../sources/queued-documents.mjs';

const envelope = (payload, eventId = 'snapshot-1') => ({
  eventId,
  runId: 'run1',
  orderingKey: 'run1/org0',
  audience: 'org0',
  type: 'view',
  simTimeMs: 1000,
  payload,
});
async function fixture(t, options = {}) {
  const storageDir = await mkdtemp(path.join(os.tmpdir(), 'aidscaler-documents-'));
  let bus, documents;
  const init = async () => {
    bus = await createLocalEventBus({ storageDir: path.join(storageDir, 'queue') });
    documents = await createQueuedDocuments({
      bus,
      storageDir: path.join(storageDir, 'documents'),
      ...options,
    });
    await bus.subscribe({ subscriptionId: 'consumer', audience: 'org0' });
  };
  await init();
  t.after(async () => {
    await bus.close();
    await rm(storageDir, { recursive: true, force: true });
  });
  return {
    storageDir,
    get bus() {
      return bus;
    },
    get documents() {
      return documents;
    },
    async restart() {
      await bus.close();
      await init();
    },
  };
}

test('queued documents wrap inline JSON and detach publication and resolution objects', async (t) => {
  const f = await fixture(t);
  const original = { place: 'Takamatsu', quantities: [1, 2] };
  await f.documents.publish(envelope(original));
  original.quantities[0] = 999;
  const { messages } = await f.bus.pull({ subscriptionId: 'consumer' });
  assert.deepEqual(messages[0].envelope.payload, {
    document: { place: 'Takamatsu', quantities: [1, 2] },
  });
  const resolved = await f.documents.resolve(messages[0].envelope);
  resolved.quantities[0] = -1;
  assert.equal((await f.documents.resolve(messages[0].envelope)).quantities[0], 1);
  assert.equal((await readdir(path.join(f.storageDir, 'documents'))).length, 0);
});

test('queued documents roundtrip large Unicode payloads through small durable reference events', async (t) => {
  const f = await fixture(t);
  const original = {
    description: '高松市・救援が必要です 🌊'.repeat(12000),
    sites: [{ name: 'Sakura Shelter' }],
  };
  await f.documents.publish(envelope(original));
  const { messages } = await f.bus.pull({ subscriptionId: 'consumer' });
  const payload = messages[0].envelope.payload;
  assert.deepEqual(Object.keys(payload), ['documentRef']);
  assert.ok(payload.documentRef.bytes > 262144);
  assert.ok(Buffer.byteLength(JSON.stringify(messages[0].envelope)) < 1000);
  assert.deepEqual(await f.documents.resolve(messages[0].envelope), original);
  const files = await readdir(path.join(f.storageDir, 'documents'));
  assert.deepEqual(files, [`${payload.documentRef.sha256}.json`]);
});

test('queued documents remain resolvable on restart with stable publication deduplication', async (t) => {
  const f = await fixture(t, { maxInlineBytes: 20 });
  const original = { b: 'x'.repeat(10000), a: { district: 'Kagawa' } };
  const receipt = await f.documents.publish(envelope(original));
  await f.restart();
  const retry = await f.documents.publish(envelope({ a: original.a, b: original.b }));
  assert.deepEqual(retry, { ...receipt, duplicate: true });
  const { messages } = await f.bus.pull({ subscriptionId: 'consumer' });
  assert.deepEqual(await f.documents.resolve(messages[0].envelope), original);
  assert.equal((await readdir(path.join(f.storageDir, 'documents'))).length, 1);
});

test('queued documents detect modified or truncated blobs before returning data', async (t) => {
  const f = await fixture(t, { maxInlineBytes: 20 });
  await f.documents.publish(envelope({ text: 'water'.repeat(100) }));
  const { messages } = await f.bus.pull({ subscriptionId: 'consumer' });
  const published = messages[0].envelope;
  const filename = path.join(
    f.storageDir,
    'documents',
    `${published.payload.documentRef.sha256}.json`,
  );
  const data = await readFile(filename);
  data[5] = data[5] === 65 ? 66 : 65;
  await writeFile(filename, data);
  await assert.rejects(f.documents.resolve(published), { code: 'DOCUMENT_INTEGRITY' });
  await writeFile(filename, 'short');
  await assert.rejects(f.documents.resolve(published), { code: 'DOCUMENT_INTEGRITY' });
});

test('queued documents reject invalid references, path traversal, ambiguous wrappers and budgets', async (t) => {
  const f = await fixture(t, { maxInlineBytes: 20, maxDocumentBytes: 1000 });
  const ref = { sha256: '../private', bytes: 4, contentType: 'application/json' };
  await assert.rejects(f.documents.resolve(envelope({ documentRef: ref })), {
    code: 'DOCUMENT_REF',
  });
  await assert.rejects(
    f.documents.resolve(envelope({ documentRef: { ...ref, sha256: 'a'.repeat(64), bytes: 1001 } })),
    { code: 'DOCUMENT_REF' },
  );
  await assert.rejects(f.documents.resolve(envelope({ documentRef: ref, document: {} })), {
    code: 'DOCUMENT_REF',
  });
  await assert.rejects(f.documents.publish(envelope({ text: 'x'.repeat(1001) })), {
    code: 'DOCUMENT_TOO_LARGE',
  });
  await assert.rejects(f.documents.publish(envelope({ invalid: undefined })), {
    code: 'DOCUMENT_JSON',
  });
  assert.equal((await f.bus.stats()).published, 0);
});

test('queued documents publish references only after store succeeds and verify interchangeable stores', async () => {
  let ready = false,
    saved,
    published;
  const documents = await createQueuedDocuments({
    maxInlineBytes: 0,
    store: {
      async put(record) {
        saved = record;
        ready = true;
      },
      async get() {
        return saved.data;
      },
    },
    bus: {
      async publish(event) {
        assert.ok(ready);
        published = event;
        return { sequence: 1 };
      },
    },
  });
  assert.deepEqual(await documents.publish(envelope({ message: 'Ready' })), { sequence: 1 });
  assert.deepEqual(await documents.resolve(published), { message: 'Ready' });
  assert.equal(saved.sha256, createHash('sha256').update(saved.data).digest('hex'));
  saved.data[0] = 0;
  await assert.rejects(documents.resolve(published), { code: 'DOCUMENT_INTEGRITY' });
  let calls = 0;
  const failing = await createQueuedDocuments({
    maxInlineBytes: 0,
    store: {
      async put() {
        throw new Error('disk unavailable');
      },
      async get() {},
    },
    bus: {
      async publish() {
        calls++;
      },
    },
  });
  await assert.rejects(failing.publish(envelope({ message: 'Not ready' })), /disk unavailable/);
  assert.equal(calls, 0);
});

test('queued document garbage collection preserves leased references until queue acknowledgment', async (t) => {
  const f = await fixture(t, { maxInlineBytes: 0 });
  await f.documents.publish(envelope({ first: 'x'.repeat(1000) }, 'first'));
  await f.documents.publish(envelope({ second: 'y'.repeat(1000) }, 'second'));
  const { messages } = await f.bus.pull({ subscriptionId: 'consumer' });
  await f.bus.ack({ subscriptionId: 'consumer', deliveryIds: [messages[0].deliveryId] });
  assert.equal((await f.bus.prune({ throughSequence: 100 })).pruned, 1);
  const retainedSha256 = await f.bus.retainedDocumentRefs();
  assert.equal((await f.documents.pruneUnreferenced({ retainedSha256 })).pruned, 1);
  assert.deepEqual(await f.documents.resolve(messages[1].envelope), { second: 'y'.repeat(1000) });
  await assert.rejects(f.documents.resolve(messages[0].envelope), { code: 'DOCUMENT_NOT_FOUND' });
});
