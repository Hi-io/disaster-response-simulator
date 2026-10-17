#!/usr/bin/env node
// Simulator capacity experiment. Never connects to an existing simulator,
// platform, model provider or Kubernetes API. Admission-limit overrides exist
// only in disposable, explicitly labelled benchmark checkpoint fixtures.
import { fork } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const filename = fileURLToPath(import.meta.url), MiB = 1024 * 1024;
const number = (value, fallback) => value === undefined ? fallback : Number(value);
const summary = values => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const at = q => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] : null;
  return { samples: sorted.length, min: sorted[0] ?? null, p50: at(.5), p95: at(.95), max: sorted.at(-1) ?? null };
};
const send = value => process.connected && process.send(value);
const cleanError = error => ({ code: error?.code ?? error?.name ?? 'ERROR', message: String(error?.message ?? error).slice(0, 240) });

async function prepare(input) {
  process.env.AIDSCALER_ARCHIVE_DIR = path.join(input.directory, 'archives');
  const { World } = await import('../engine/world.mjs');
  const w = new World(input.config);
  try {
    w.demoConfigureDirector({ enabled: true, intervalMs: 300000, maxOpen: 8, maxActive: 8,
      baseOperations: true });
    // BENCHMARK ONLY: public admission and production source are untouched.
    w.state.demo.maxActive = Math.max(8, input.visitors);
    for (let i = 0; i < input.visitors; i++) {
      w.demoCreateOrganization({ name: `Capacity Team ${i + 1}`, color: '#7261d8',
        idempotencyKey: `capacity-only-team-${i + 1}` });
      if (i % 2 === 0) await sleep(0); // Let the memory watchdog inspect setup.
    }
    const checkpoint = w.checkpoint();
    await writeFile(input.checkpointPath, JSON.stringify(checkpoint), { mode: 0o600 });
    return { checkpointBytes: (await import('node:fs/promises')).stat(input.checkpointPath).then(s => s.size),
      cardinality: { bases: 4, visitors: input.visitors, organizations: w.state.map.organizations.length,
        nodes: w.state.map.nodes.length, edges: w.state.map.edges.length, buildings: w.state.map.buildings.length,
        vehicles: w.state.vehicles.length, resources: w.state.resources.length },
      testOnlyAdmissionOverride: input.visitors > 8 };
  } finally { w.close(); }
}

async function childMain(mode) {
  let lab, started = performance.now(), timer;
  const report = () => send({ type: 'sample', at: performance.now(), memory: process.memoryUsage(),
    cpu: process.cpuUsage(), uptimeMs: performance.now() - started,
    ...(lab ? { meta: { now: lab.runtime.meta.now, performance: lab.runtime.meta.performance,
      effectiveRate: lab.runtime.meta.effectiveRate }, cache: lab.runtime.cacheStats } : {}) });
  timer = setInterval(report, 250); timer.unref(); report();
  const close = async () => {
    clearInterval(timer);
    await lab?.close().catch(() => {});
  };
  process.once('SIGTERM', () => close().finally(() => process.exit(0)));
  process.on('message', async message => {
    try {
      if (message.type === 'start') {
        if (mode === 'prepare') {
          const value = await prepare(message.input);
          value.checkpointBytes = await value.checkpointBytes;
          report(); send({ type: 'prepared', value }); await close(); process.exit(0);
        } else {
          const { createIsolatedLabServers } = await import('../sources/isolated-server.mjs');
          let checkpoint = JSON.parse(await readFile(message.input.checkpointPath, 'utf8'));
          process.env.AIDSCALER_ARCHIVE_DIR = path.join(message.input.directory, 'archives');
          lab = await createIsolatedLabServers({ checkpoint, config: checkpoint.manifest.config,
            observerPort: 0, sourcePort: 0, persistCredentials: false,
            storageDir: path.join(message.input.directory, 'transport'), projectionMs: 1500 });
          checkpoint = null;
          await lab.runtime.request('control', { play: true, rate: 10 });
          report();
          // These credentials cross only private parent/child IPC, never stdout or files.
          send({ type: 'ready', access: { observerPort: lab.observerPort, sourcePort: lab.sourcePort,
            observerKey: lab.observerKey, actors: lab.actorKeys, sourceInstance: lab.runtime.meta.sourceInstance } });
        }
      } else if (message.type === 'reset') {
        await lab.runtime.request('resetPerformance');
        report(); send({ type: 'reset', id: message.id });
      } else if (message.type === 'snapshot') {
        await lab.runtime.refresh(); report(); send({ type: 'snapshot' });
      } else if (message.type === 'close') { await close(); process.exit(0); }
    } catch (error) { send({ type: 'fatal', error: cleanError(error) }); await close(); process.exit(1); }
  });
}

function options(argv) {
  const values = {};
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    if (!raw.startsWith('--')) throw Error(`Unexpected argument: ${raw}`);
    const split = raw.indexOf('=');
    if (split > 0) values[raw.slice(2, split)] = raw.slice(split + 1);
    else values[raw.slice(2)] = argv[++i];
  }
  const opts = {
    counts: (values.counts ?? '0,1,2,3,4,6,8,10,12,20,50,100').split(',').map(Number),
    duration: number(values.duration, 20000), topology: values.topology ?? 'takamatsu',
    grid: number(values.grid, values.topology === 'grid' ? 8 : 66),
    maxRssMiB: number(values['max-rss-mib'], 1536), maxCgroupMiB: number(values['max-cgroup-mib'], 1792),
    minNodeAvailableMiB: number(values['min-node-available-mib'], 2560),
    output: path.resolve(values.output ?? '.local/organization-capacity/report.json'),
    pollMs: number(values['poll-ms'], 10000), viewerMs: number(values['viewer-ms'], 1500),
    warmConcurrency: number(values['warm-concurrency'], 2),
    startupTimeoutMs: number(values['startup-timeout-ms'], 120000),
  };
  if (opts.counts.some(n => !Number.isSafeInteger(n) || n < 0 || n > 1000) ||
    !opts.counts.length || opts.duration < 1000 || opts.pollMs < 100 || opts.viewerMs < 100 ||
    !['grid', 'takamatsu'].includes(opts.topology) || opts.warmConcurrency < 1 ||
    opts.maxRssMiB < 64 || opts.maxCgroupMiB < 64 || opts.minNodeAvailableMiB < 0)
    throw Error('Invalid bounded capacity experiment options.');
  return opts;
}

async function machineMemory(pid) {
  const read = async name => readFile(name, 'utf8').catch(() => null);
  const [status, info, current, peak, stat] = await Promise.all([
    read(`/proc/${pid}/status`), read('/proc/meminfo'), read('/sys/fs/cgroup/memory.current'),
    read('/sys/fs/cgroup/memory.peak'), read('/sys/fs/cgroup/memory.stat'),
  ]);
  const kb = (text, name) => { const match = text?.match(new RegExp(`^${name}:\\s+(\\d+)`, 'm')); return match ? Number(match[1]) / 1024 : null; };
  const inactive = stat?.match(/^inactive_file\s+(\d+)/m);
  return { rssMiB: kb(status, 'VmRSS'), highWaterMiB: kb(status, 'VmHWM'),
    nodeAvailableMiB: kb(info, 'MemAvailable'), cgroupMiB: current ? Number(current.trim()) / MiB : null,
    cgroupPeakMiB: peak ? Number(peak.trim()) / MiB : null,
    cgroupInactiveFileMiB: inactive ? Number(inactive[1]) / MiB : null };
}

async function coordinator(opts) {
  await mkdir(path.dirname(opts.output), { recursive: true });
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'aidscaler-capacity-'));
  const report = { format: 'aidscaler-simulator-capacity-v1', startedAt: new Date().toISOString(),
    status: 'running', options: opts, environment: { platform: process.platform, node: process.version,
      cpuCount: os.cpus().length, totalMemoryMiB: os.totalmem() / MiB },
    methodology: { bases: 4, countsRepresent: 'additional visitor organizations', simulatorProcess: 'HTTP source + isolated simulation worker; no platform or model',
      projectionMs: 1500, simulatedRate: 10, freshSimulatorProcessPerCount: true,
      phases: ['light: scoped compact state, public feed and inbox reads; no map query',
        'warm: real inventory/vehicles/policy/map source queries, immutable query result fetched once, then ordinary scoped reads'],
      guardsIncludeLoadCoordinator: 'cgroup memory includes simulator, coordinator and charged file cache; simulator RSS excludes coordinator',
      limitations: ['No LLM calls or actual platform deployments; those have separate resource cost.',
        'No sustained dispatch workload or long-duration history soak; this isolates connected-organization read/state capacity.',
        'RSS is counted once per process, not summed across worker threads.',
        'Main-thread JS heap samples exclude the isolated worker heap; simulator RSS includes both threads and native allocations.',
        'Checkpoint recovery startup peak is reported separately from steady windows.',
        'Public demo admission quotas are bypassed only inside disposable benchmark fixture state.'] }, rows: [] };
  const save = async () => {
    const next = opts.output + '.tmp'; await writeFile(next, JSON.stringify(report, null, 2), { mode: 0o600 }); await rename(next, opts.output);
  };
  await save();
  let activeChild, stopped = false, stoppingReason;
  async function stopChild(child) {
    if (!child || child.exitCode !== null || child.signalCode) return;
    if (child.connected) child.send({ type: 'close' }, () => {});
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), sleep(10000, undefined, { ref: false })]);
    if (child.exitCode === null && !child.signalCode) {
      child.kill('SIGTERM'); await Promise.race([new Promise(resolve => child.once('exit', resolve)), sleep(3000, undefined, { ref: false })]);
    }
    if (child.exitCode === null && !child.signalCode) child.kill('SIGKILL');
  }
  const onSignal = () => { stopped = true; stoppingReason = { code: 'INTERRUPTED' }; activeChild?.kill('SIGTERM'); };
  process.once('SIGTERM', onSignal); process.once('SIGINT', onSignal);
  async function launch(mode, input, row) {
    const child = fork(filename, [`--child=${mode}`], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      execArgv: ['--max-old-space-size=1280'], env: { ...process.env, NODE_OPTIONS: '' } });
    activeChild = child;
    const samples = [], waiters = new Map(); let access, latest, fatal, stderr = '';
    child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-2048); });
    child.on('message', message => {
      if (message.type === 'sample') { latest = message; samples.push({ ...message, wallAt: performance.now() }); }
      if (message.type === 'ready') access = message.access;
      if (message.type === 'fatal') fatal = message.error;
      if (waiters.has(message.type)) { waiters.get(message.type)(message); waiters.delete(message.type); }
    });
    const began = performance.now();
    let monitoring = false;
    const monitor = setInterval(async () => {
      if (monitoring || child.exitCode !== null || stopped) return;
      monitoring = true;
      try {
        const mem = await machineMemory(child.pid);
        const rss = mem.rssMiB ?? latest?.memory.rss / MiB;
        row.guardSamples.push({ atMs: Math.round(performance.now() - began), mode, ...mem, rssMiB: rss ?? null });
        if ((rss ?? 0) > opts.maxRssMiB || (mem.cgroupMiB ?? 0) > opts.maxCgroupMiB ||
          mem.nodeAvailableMiB !== null && mem.nodeAvailableMiB < opts.minNodeAvailableMiB) {
          stopped = true; stoppingReason = { code: 'MEMORY_GUARD', mode, visitors: input.visitors,
            ...mem, rssMiB: rss ?? null }; child.kill('SIGTERM');
        }
      } finally { monitoring = false; }
    }, 250);
    const wait = async (type, timeout = opts.startupTimeoutMs) => {
      const pending = new Promise(resolve => waiters.set(type, resolve));
      const until = performance.now() + timeout;
      for (;;) {
        const result = await Promise.race([pending, sleep(100).then(() => null)]);
        if (result) return result;
        if (fatal) throw Object.assign(Error(fatal.message), { code: fatal.code });
        if (stopped) throw Object.assign(Error('Capacity safety guard stopped escalation.'), { code: 'CAPACITY_STOP' });
        if (child.exitCode !== null || child.signalCode) throw Object.assign(Error('Isolated benchmark child exited before ready.'), { code: 'CHILD_EXIT', stderrTail: stderr });
        if (performance.now() > until) throw Object.assign(Error('Isolated benchmark child timed out.'), { code: 'CHILD_TIMEOUT' });
      }
    };
    child.send({ type: 'start', input });
    return { child, samples, wait, get latest() { return latest; }, get access() { return access; },
      async reset() { const pending = wait('reset', 30000); child.send({ type: 'reset', id: Date.now() }); await pending; },
      async snapshot() { const pending = wait('snapshot', 30000); child.send({ type: 'snapshot' }); await pending; },
      async close() { clearInterval(monitor); await stopChild(child); if (activeChild === child) activeChild = null; } };
  }
  try {
    for (const visitors of opts.counts) {
      if (stopped) break;
      const directory = path.join(temporaryRoot, `visitors-${visitors}`); await mkdir(directory);
      const checkpointPath = path.join(directory, 'fixture.json');
      const config = { seed: 'aidscaler-capacity-v1', topology: opts.topology, grid: opts.grid,
        extentKm: opts.topology === 'takamatsu' ? 10 : 3, scenario: 'S01', hazard: 'none', organizations: 4,
        policy: 'none', mode: 'interactive', clockLatency: 'wall', continuousDemo: true,
        durationMs: 21600000, postsPerHour: 240, backgroundTraffic: 30, packetLoss: 0, observationRate: 1,
        recurringNeeds: false, healthReports: false, waterFatalityBpPerHour: 0, foodFatalityBpPerHour: 0,
        injuryFatalityBpPerHour: 0, exposureFatalityBpPerHour: 0, sourceRequestLimit: 5000,
        maxEvents: 100000000, maxPosts: 2000000, modelCallLimit: 100000 };
      const row = { visitors, totalOrganizations: visitors + 4, status: 'running', guardSamples: [], phases: [] };
      report.rows.push(row); await save();
      let preparer, simulator;
      try {
        preparer = await launch('prepare', { visitors, directory, checkpointPath, config }, row);
        const prepared = await preparer.wait('prepared'); row.fixture = prepared.value;
        row.preparationMemory = summary(preparer.samples.map(s => s.memory.rss / MiB));
        await preparer.close(); preparer = null;
        simulator = await launch('server', { visitors, directory, checkpointPath }, row);
        await simulator.wait('ready');
        row.startupMemory = summary(simulator.samples.map(s => s.memory.rss / MiB));
        const access = simulator.access, source = `http://127.0.0.1:${access.sourcePort}`,
          observer = `http://127.0.0.1:${access.observerPort}`;
        const actors = Object.entries(access.actors).filter(([, a]) => a.org.startsWith('demo-org-'));
        let metrics;
        const request = async (base, url, key, body, parse = true) => {
          const began = performance.now();
          try {
            const response = await fetch(base + url, { headers: { Authorization: `Bearer ${key}`,
              ...(body ? { 'Content-Type': 'application/json', 'X-AidScaler-Source-Instance': access.sourceInstance } : {}) },
              ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
            const data = parse ? await response.json() : (await response.arrayBuffer(), null);
            metrics?.latencies.push(performance.now() - began); if (metrics) metrics.requests++;
            if (!response.ok) { if (metrics) metrics.errors[response.status] = (metrics.errors[response.status] ?? 0) + 1; throw Object.assign(Error(`Capacity source returned HTTP ${response.status}`), { code: `HTTP_${response.status}` }); }
            return data;
          } catch (error) { if (metrics && !String(error.code).startsWith('HTTP_')) metrics.errors[error.name ?? 'NETWORK'] = (metrics.errors[error.name ?? 'NETWORK'] ?? '0') * 1 + 1; throw error; }
        };
        async function runPhase(name) {
          await simulator.reset();
          const started = performance.now(), sampleIndex = simulator.samples.length;
          metrics = { latencies: [], requests: 0, errors: {} };
          const pollOrg = async ([key]) => {
            await request(source, '/api/actor/state?compact=1', key);
            await request(source, '/api/actor/inbox?limit=40', key);
            await request(source, '/api/feed?limit=40', key);
          };
          const nextOrg = actors.map((_, i) => started + i * opts.pollMs / Math.max(actors.length, 1));
          let nextViewer = started;
          while (performance.now() - started < opts.duration && !stopped) {
            const now = performance.now(), work = [];
            if (now >= nextViewer) { nextViewer = now + opts.viewerMs; work.push(request(observer, '/api/demo/frame', access.observerKey)); }
            for (let i = 0; i < actors.length; i++) if (now >= nextOrg[i]) {
              nextOrg[i] = now + opts.pollMs; work.push(pollOrg(actors[i]));
            }
            if (work.length) await Promise.allSettled(work);
            await sleep(25);
          }
          if (!stopped) await simulator.snapshot();
          const final = simulator.latest;
          const samples = simulator.samples.slice(sampleIndex);
          const first = samples[0], last = samples.at(-1);
          const cpuMs = first && last ? ((last.cpu.user + last.cpu.system) - (first.cpu.user + first.cpu.system)) / 1000 : null;
          const result = { name, measuredMs: Math.round(performance.now() - started),
            simulatorRssMiB: summary(samples.map(s => s.memory.rss / MiB)),
            sourceMainThreadHeapUsedMiB: summary(samples.map(s => s.memory.heapUsed / MiB)),
            simulatorCpu: { usedMs: cpuMs, averageCores: cpuMs !== null && last.wallAt > first.wallAt ? cpuMs / (last.wallAt - first.wallAt) : null },
            http: { requests: metrics.requests, latencyMs: summary(metrics.latencies), errors: metrics.errors },
            performance: final?.meta?.performance, effectiveRate: final?.meta?.effectiveRate,
            cacheCardinality: final?.cache, simulatedNow: final?.meta?.now };
          metrics = null; row.phases.push(result); await save();
          console.log(JSON.stringify({ progress: true, visitors, totalOrganizations: visitors + 4, phase: name,
            rssP95MiB: result.simulatorRssMiB.p95, httpP95Ms: result.http.latencyMs.p95,
            tickP95Ms: result.performance?.tickIntervalMs?.p95, effectiveRate: result.effectiveRate,
            errors: result.http.errors }));
        }
        await runPhase('light');
        if (stopped) throw Object.assign(Error('Guard stopped experiment.'), { code: 'CAPACITY_STOP' });
        const warmBegan = performance.now(), warmSamples = simulator.samples.length;
        let next = 0;
        await Promise.all(Array.from({ length: Math.min(opts.warmConcurrency, actors.length) }, async () => {
          while (next < actors.length && !stopped) {
            const [key, actor] = actors[next++];
            for (const target of ['inventory', 'vehicles', 'policy', 'map'])
              await request(source, '/api/actor/action', key, { type: 'query', params: { target }, idempotencyKey: `capacity-warm-${actor.org}-${target}` });
            const until = performance.now() + 60000; let state;
            do {
              await sleep(300); state = await request(source, '/api/actor/state?compact=1', key);
              if (stopped) return;
            } while (!state.queries.some(q => q.target === 'map' && q.resultRef) && performance.now() < until);
            const ready = state.queries.filter(q => q.resultRef);
            if (!ready.some(q => q.target === 'map')) throw Object.assign(Error('Map query did not complete during warmup.'), { code: 'WARMUP_TIMEOUT' });
            for (const query of ready) await request(source, `/api/actor/query-result?id=${encodeURIComponent(query.id)}&version=${encodeURIComponent(query.resultRef.version)}`, key, null, false);
          }
        }));
        row.warmup = { durationMs: Math.round(performance.now() - warmBegan),
          simulatorRssMiB: summary(simulator.samples.slice(warmSamples).map(s => s.memory.rss / MiB)) };
        if (stopped) throw Object.assign(Error('Guard stopped experiment.'), { code: 'CAPACITY_STOP' });
        // Allow the first map publication and temporary serialization buffers to settle.
        await sleep(2000); await runPhase('warm-map');
        row.status = stopped ? 'stopped' : 'complete';
      } catch (error) {
        row.status = stopped ? 'stopped' : 'failed'; row.error = cleanError(error);
        if (!stopped) { stopped = true; stoppingReason = { code: 'EXPERIMENT_FAILURE', visitors, error: cleanError(error) }; }
      } finally {
        await preparer?.close(); await simulator?.close();
        row.guardSummary = { rssMiB: summary(row.guardSamples.filter(s => s.mode === 'server').map(s => s.rssMiB)),
          cgroupMiB: summary(row.guardSamples.map(s => s.cgroupMiB)),
          nodeAvailableMiB: summary(row.guardSamples.map(s => s.nodeAvailableMiB)) };
        await save();
        const resolved = path.resolve(directory);
        if (!resolved.startsWith(path.resolve(temporaryRoot) + path.sep)) throw Error('Refusing unsafe benchmark cleanup.');
        await rm(resolved, { recursive: true, force: true });
      }
    }
    report.status = stopped ? 'stopped' : 'complete'; report.stopReason = stoppingReason ?? null;
    report.lastCompletedVisitors = report.rows.filter(r => r.status === 'complete').at(-1)?.visitors ?? null;
    report.finishedAt = new Date().toISOString(); await save();
    console.log('visitors\ttotal orgs\tphase\tRSS p95 MiB\tHTTP p95 ms\ttick p95 ms');
    for (const row of report.rows) for (const phase of row.phases)
      console.log([row.visitors, row.totalOrganizations, phase.name, phase.simulatorRssMiB.p95?.toFixed(1),
        phase.http.latencyMs.p95?.toFixed(1), phase.performance?.tickIntervalMs?.p95?.toFixed(1)].join('\t'));
    console.log(JSON.stringify({ status: report.status, lastCompletedVisitors: report.lastCompletedVisitors,
      stopReason: report.stopReason, output: opts.output }));
    return report;
  } finally {
    await stopChild(activeChild);
    process.removeListener('SIGTERM', onSignal); process.removeListener('SIGINT', onSignal);
    // This exact path came from mkdtemp in this process, never user input.
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

const child = process.argv.find(a => a.startsWith('--child='));
if (child) await childMain(child.split('=')[1]);
else {
  try { const report = await coordinator(options(process.argv.slice(2))); if (report.stopReason?.code === 'EXPERIMENT_FAILURE') process.exitCode = 1; }
  catch (error) { console.error(JSON.stringify({ fatal: cleanError(error) })); process.exitCode = 1; }
}
