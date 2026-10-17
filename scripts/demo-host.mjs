import path from 'node:path';
import { mkdir, readFile, unlink, rmdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createLabServers } from '../sources/server.mjs';
import { writeAtomicJson } from '../sources/atomic-json.mjs';
import { manifest } from '../contracts/config.mjs';
import { digest } from '../engine/determinism.mjs';
import { capturePreviousDemoArchives, cleanPreviousDemoArchives, compactDemoAudit } from './demo-storage.mjs';

const read = async filename => { try { return JSON.parse(await readFile(filename, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
const archiveFiles = snapshot => [snapshot?.log, snapshot?.state?.posts, snapshot?.state?.messages]
  .filter(value => value?.archive).map(value => value.file);
const operationalDemoConfig = { recurringNeeds: false, healthReports: false, waterFatalityBpPerHour: 0,
  foodFatalityBpPerHour: 0, injuryFatalityBpPerHour: 0, exposureFatalityBpPerHour: 0 };

export async function startDemoHost({ dataDir, observerPort = 4318, sourcePort = 4319,
  config = {}, checkpointEveryMs = 60000, allowDemoBuildUpgrade = false,
  allowOperationalDemoUpgrade = false,
  storageMaintenance = true, projectionMs = 1500,
  director = { enabled: true, intervalMs: 300000, maxOpen: 8, maxActive: 4 },
  autostart = true, rate = 10, checkpointWhilePaused = true } = {}) {
  if (!dataDir || !Number.isSafeInteger(checkpointEveryMs) || checkpointEveryMs < 1000)
    throw Error('A persistent data directory and a bounded checkpoint interval are required.');
  const directory = path.resolve(dataDir); await mkdir(directory, { recursive: true });
  const sourceFile = path.join(directory, 'source.json'), checkpointFile = path.join(directory, 'checkpoint.json');
  const previous = await read(sourceFile), original = await read(checkpointFile);
  if (!!previous !== !!original) throw Error('Incomplete simulator recovery bundle. Preserve both source.json and checkpoint.json.');
  if (previous && (previous.format !== 'aidscaler-demo-source-v1' || typeof previous.observerKey !== 'string' ||
    previous.observerKey.length < 32 || !previous.actors || typeof previous.actors !== 'object' ||
    previous.runId !== original.runId || typeof previous.sourceInstance !== 'string'))
    throw Error('Simulator credentials do not match the saved world. No new world was created.');
  let checkpoint = original;
  if (checkpoint) {
    const current = manifest(checkpoint.manifest.config, { contentVersion: checkpoint.manifest.contentVersion });
    if (!checkpoint.manifest.config.continuousDemo || checkpoint.manifest.config.mode !== 'interactive' ||
      ['engineVersion', 'schemaVersion', 'randomVersion', 'runtimeMajor', 'contentVersion'].some(k => checkpoint.manifest[k] !== current[k]) ||
      digest(current.config) !== digest(checkpoint.manifest.config))
      throw Error('This checkpoint is not a compatible continuous-demo contract.');
    if (checkpoint.manifest.engineBuild !== current.engineBuild) {
      if (!allowDemoBuildUpgrade) throw Error('Demo build changed. Explicit allowDemoBuildUpgrade is required; no new world was created.');
      checkpoint = structuredClone(checkpoint);
      const before = digest({ ...checkpoint, manifest: null });
      const upgrade = { at: Date.now(), from: checkpoint.manifest.engineBuild, to: current.engineBuild,
        runId: checkpoint.runId, now: checkpoint.now, physicalStateHash: before, benchmarkEligible: false };
      checkpoint.manifest.engineBuild = current.engineBuild;
      if (digest({ ...checkpoint, manifest: null }) !== before) throw Error('Demo migration changed physical state.');
      const history = await read(path.join(directory, 'build-upgrades.json')) ?? [];
      await writeAtomicJson(path.join(directory, 'build-upgrades.json'), [...history.slice(-49), upgrade]);
    }
    if (allowOperationalDemoUpgrade && Object.entries(operationalDemoConfig).some(([k, v]) => checkpoint.manifest.config[k] !== v)) {
      const before = digest({ ...checkpoint, manifest: null });
      checkpoint = structuredClone(checkpoint);
      const previousConfig = Object.fromEntries(Object.keys(operationalDemoConfig).map(k => [k, checkpoint.manifest.config[k]]));
      checkpoint.manifest.config = { ...checkpoint.manifest.config, ...operationalDemoConfig };
      if (digest({ ...checkpoint, manifest: null }) !== before) throw Error('Operational demo migration changed past physical state.');
      const history = await read(path.join(directory, 'operational-upgrades.json')) ?? [];
      await writeAtomicJson(path.join(directory, 'operational-upgrades.json'), [...history.slice(-49), {
        at: Date.now(), kind: 'explicit-operational-demo-config-upgrade', previous: previousConfig,
        next: operationalDemoConfig, runId: checkpoint.runId, now: checkpoint.now,
        physicalStateHash: before, benchmarkEligible: false,
      }]);
    }
  }
  // Archives are authoritative SQLite files and live on the same persistent
  // volume as the checkpoints, never in the immutable container filesystem.
  process.env.AIDSCALER_ARCHIVE_DIR = path.join(directory, 'archives');
  const previousArchives = storageMaintenance ? await capturePreviousDemoArchives(process.env.AIDSCALER_ARCHIVE_DIR) : [];
  const defaults = { topology: 'takamatsu', grid: 66, extentKm: 10, seed: 'aidscaler-shared-demo-v1',
    scenario: 'S01', hazard: 'none', organizations: 4, policy: 'none', mode: 'interactive',
    clockLatency: 'wall', continuousDemo: true, durationMs: 21600000, postsPerHour: 240,
    backgroundTraffic: 30, packetLoss: 0, observationRate: 1, sourceRequestLimit: 5000,
    ...operationalDemoConfig,
    maxEvents: 100000000, maxPosts: 2000000, modelCallLimit: 100000 };
  const lab = await createLabServers({ isolated: true, config: checkpoint?.manifest.config ?? { ...defaults, ...config },
    checkpoint: checkpoint ?? undefined, observerPort, sourcePort, observerKey: previous?.observerKey ?? randomBytes(24).toString('hex'),
    actorKeys: previous?.actors ?? null, persistCredentials: false, storageDir: path.join(directory, 'transport'), projectionMs });
  let saving = null, closing = false, paused = !autostart, timer, savedSnapshot = original, collectedPreviousArchives = false;
  const credentials = () => ({ format: 'aidscaler-demo-source-v1', observerKey: lab.observerKey,
    actors: lab.actorKeys, observerUrl: `http://127.0.0.1:${lab.observerPort}`,
    sourceUrl: `http://127.0.0.1:${lab.sourcePort}`, observerPort: lab.observerPort,
    sourcePort: lab.sourcePort, sourceInstance: lab.runtime.meta.sourceInstance,
    runId: lab.runtime.meta.runId, savedAt: Date.now() });
  async function persist() {
    if (saving) return saving;
    saving = (async () => {
      await lab.runtime.flush();
      const snapshot = await lab.checkpoint();
      await writeAtomicJson(checkpointFile, snapshot);
      await writeAtomicJson(sourceFile, credentials());
      if (storageMaintenance) {
        let audit;
        try {
          audit = await compactDemoAudit({ bus: lab.runtime.bus, checkpoint: snapshot,
            producer: await read(path.join(directory, 'transport', 'producer.json')) });
        } catch {
          // The physical checkpoint and credentials are already durable. An
          // unverifiable legacy transport row must remain untouched, but must
          // never stop this world or prevent recovery of its physical state.
          // Use a fixed diagnostic: raw queue payloads may contain private data.
          audit = { deferred: true, warning: 'AUDIT_COMPACTION_DEFERRED',
            physicalHistoryPreserved: true, deduplicationTombstonesPreserved: true };
        }
        const oldArchives = collectedPreviousArchives ? { deleted: 0, bytes: 0 } :
          await cleanPreviousDemoArchives(process.env.AIDSCALER_ARCHIVE_DIR, previousArchives, archiveFiles(snapshot));
        collectedPreviousArchives = true;
        await writeAtomicJson(path.join(directory, 'storage-maintenance.json'), { at: Date.now(), runId: snapshot.runId,
          checkpointNow: snapshot.now, presentationIntervalMs: projectionMs, audit, oldArchives });
      }
      const retiredFiles = archiveFiles(savedSnapshot), activeFiles = new Set(archiveFiles(snapshot));
      savedSnapshot = snapshot;
      const archiveRoot = path.join(directory, 'archives') + path.sep;
      for (const oldFile of retiredFiles) {
        const absolute = path.resolve(oldFile), parent = path.dirname(absolute);
        // Delete only the exact obsolete snapshots made by RecordArchive,
        // after both replacement journals commit. Never recursive-delete an
        // archive root or a currently running engine's records directory.
        if (!activeFiles.has(oldFile) && absolute.startsWith(archiveRoot) &&
          path.basename(absolute) === 'records.sqlite' && path.basename(parent).startsWith('snapshot-')) {
          await unlink(absolute).catch(e => { if (e.code !== 'ENOENT') throw e; });
          await rmdir(parent).catch(e => { if (!['ENOENT', 'ENOTEMPTY'].includes(e.code)) throw e; });
        }
      }
      return { runId: snapshot.runId, now: snapshot.now };
    })().finally(() => { saving = null; });
    return saving;
  }
  try {
    await lab.runtime.request('demoConfigureDirector', { ...director, baseOperations: director.baseOperations ?? true });
    await lab.runtime.refresh();
    await persist();
    await lab.runtime.request('control', { play: autostart, rate });
    timer = setInterval(() => { if (!closing && (!paused || checkpointWhilePaused)) persist().catch(e => {
      // A storage failure is visible to health checks, never a silent reset.
      host.persistenceError = e; lab.runtime.request('control', { play: false }).catch(() => {});
    }); }, checkpointEveryMs); timer.unref();
  } catch (e) { await lab.close(); throw e; }
  const host = { lab, credentials: credentials(), dataDir: directory, persist, persistenceError: null,
    async pause() { await lab.runtime.request('control', { play: false }); paused = true; },
    async resume() { await lab.runtime.request('control', { play: true, rate }); paused = false; },
    async close() {
      if (closing) return; closing = true; clearInterval(timer);
      await lab.quiesce();
      await lab.runtime.request('control', { play: false });
      await saving; await persist(); await lab.close();
    } };
  return host;
}
