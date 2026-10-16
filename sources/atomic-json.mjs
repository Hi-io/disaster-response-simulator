import path from 'node:path';
import { open, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const transientRenameErrors = new Set(['EACCES', 'EPERM', 'EBUSY']);

/**
 * Replace a small local journal without exposing partial JSON or deleting its
 * previous committed value. Windows sync clients and antivirus may temporarily
 * lock either directory entry; bounded asynchronous retry handles those locks.
 * The unique sibling file is flushed and closed before any rename is attempted.
 */
export async function writeAtomicJson(
  filename,
  value,
  { renameFile = rename, retryDelaysMs = [25, 50, 100, 200, 400, 800, 1600, 3200] } = {},
) {
  if (
    typeof filename !== 'string' ||
    !filename ||
    typeof renameFile !== 'function' ||
    !Array.isArray(retryDelaysMs) ||
    retryDelaysMs.length > 20 ||
    retryDelaysMs.some(
      (milliseconds) =>
        !Number.isSafeInteger(milliseconds) || milliseconds < 0 || milliseconds > 10000,
    )
  )
    throw new TypeError(
      'A filename, rename function and bounded integer retry delays are required.',
    );
  const json = JSON.stringify(value);
  if (json === undefined) throw new TypeError('A JSON value is required.');
  const temporary = path.join(
    path.dirname(filename),
    `.${path.basename(filename)}.${randomUUID()}.tmp`,
  );
  let file, failure;
  try {
    file = await open(temporary, 'wx', 0o600);
    await file.writeFile(json, 'utf8');
    await file.sync();
    await file.close();
    file = null;
    for (let attempt = 0; ; attempt++) {
      try {
        await renameFile(temporary, filename);
        return;
      } catch (error) {
        if (!transientRenameErrors.has(error.code) || attempt >= retryDelaysMs.length) throw error;
        await delay(retryDelaysMs[attempt]);
      }
    }
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await file?.close();
    await unlink(temporary).catch((error) => {
      if (error.code !== 'ENOENT' && !failure) throw error;
    });
  }
}
