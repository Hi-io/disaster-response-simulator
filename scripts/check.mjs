import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { PRESETS } from '../content/presets.mjs';
import { INPUT_TYPES } from '../contracts/inputs.mjs';
import { ACTION_TYPES } from '../contracts/actions.mjs';
import path from 'node:path';
const exclude = new Set(['node_modules', 'runs', '.git', '.local', 'private', 'qa', 'coverage']);
const files = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (exclude.has(entry.name)) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(file);
    else if (/\.(mjs|js)$/.test(file)) files.push(file);
  }
}
await walk('.');
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
}
if (
  PRESETS.length < 360 ||
  Object.keys(INPUT_TYPES).length !== 26 ||
  Object.keys(ACTION_TYPES).length !== 23
)
  throw new Error('Contract or content coverage mismatch');
const tracked = spawnSync('git', ['ls-files'], { encoding: 'utf8' });
if (
  tracked.status === 0 &&
  /(?:^|\/)(?:\.codex|\.agents|\.claude|AGENTS\.md|CLAUDE\.md|GEMINI\.md|\.env|node_modules|runs)(?:\/|$)/m.test(
    tracked.stdout.replaceAll('\\', '/'),
  )
)
  throw new Error('Private development files are tracked');
console.log(
  `${files.length} JavaScript modules checked; 26 inputs, 23 actions, ${PRESETS.length} presets; repository hygiene passed.`,
);
