import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, rename, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { writeAtomicJson } from '../sources/atomic-json.mjs';

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'aidscaler-atomic-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'producer.json');
  await writeAtomicJson(filename, { eventCursor: 100 });
  return { directory, filename };
}

test('atomic JSON retries transient Windows rename locks without exposing partial or missing cursor data', async (t) => {
  const { directory, filename } = await fixture(t);
  let attempts = 0,
    turns = 0;
  const heartbeat = setInterval(() => turns++, 1);
  try {
    await writeAtomicJson(
      filename,
      { eventCursor: 200, place: '高松 🌊' },
      {
        retryDelaysMs: [10, 10, 10],
        async renameFile(from, to) {
          assert.equal(to, filename);
          assert.deepEqual(JSON.parse(await readFile(to, 'utf8')), { eventCursor: 100 });
          assert.deepEqual(JSON.parse(await readFile(from, 'utf8')), {
            eventCursor: 200,
            place: '高松 🌊',
          });
          const code = ['EPERM', 'EACCES', 'EBUSY'][attempts++];
          if (code) throw Object.assign(new Error('Transient directory lock'), { code });
          return rename(from, to);
        },
      },
    );
  } finally {
    clearInterval(heartbeat);
  }
  assert.equal(attempts, 4);
  assert.ok(turns > 0, 'retry backoff yields instead of blocking the service thread');
  assert.deepEqual(JSON.parse(await readFile(filename, 'utf8')), {
    eventCursor: 200,
    place: '高松 🌊',
  });
  assert.deepEqual(await readdir(directory), ['producer.json']);
});

test('atomic JSON persistent permission failures remain explicit and preserve the last committed cursor', async (t) => {
  const { directory, filename } = await fixture(t);
  let attempts = 0;
  await assert.rejects(
    writeAtomicJson(
      filename,
      { eventCursor: 999 },
      {
        retryDelaysMs: [0, 0],
        async renameFile() {
          attempts++;
          throw Object.assign(new Error('Still locked'), { code: 'EPERM' });
        },
      },
    ),
    { code: 'EPERM', message: 'Still locked' },
  );
  assert.equal(attempts, 3);
  assert.deepEqual(JSON.parse(await readFile(filename, 'utf8')), { eventCursor: 100 });
  assert.deepEqual(await readdir(directory), ['producer.json']);
});

test('atomic JSON does not retry unrelated filesystem errors and uses a unique temporary file for each write', async (t) => {
  const { directory, filename } = await fixture(t);
  const temporary = [];
  for (let index = 0; index < 2; index++) {
    await assert.rejects(
      writeAtomicJson(
        filename,
        { eventCursor: index },
        {
          retryDelaysMs: [0, 0, 0],
          async renameFile(from) {
            temporary.push(from);
            throw Object.assign(new Error('Not a transient lock'), { code: 'ENOSPC' });
          },
        },
      ),
      { code: 'ENOSPC' },
    );
  }
  assert.equal(temporary.length, 2);
  assert.notEqual(temporary[0], temporary[1]);
  assert.deepEqual(JSON.parse(await readFile(filename, 'utf8')), { eventCursor: 100 });
  assert.deepEqual(await readdir(directory), ['producer.json']);
});
