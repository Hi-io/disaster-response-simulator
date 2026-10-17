import path from 'node:path';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PubSub } from '@google-cloud/pubsub';
import { startDemoHost } from './demo-host.mjs';
import { WIRE_VERSION, decodeWire, encodeWire, validateCommand, DemoPresence } from '../sources/cloud-wire.mjs';

export async function executeBridgeCommand(command, { world, presence, fetcher = fetch, now = Date.now }) {
  validateCommand(command, now());
  if (command.scope === 'presence') return { status: 200, headers: {}, body: JSON.stringify(await presence.touch(command.body.client)) };
  const observer = command.scope === 'observer';
  const url = (observer ? world.credentials.observerUrl : world.credentials.sourceUrl) + command.path;
  const headers = observer ? { authorization: 'Bearer ' + world.credentials.observerKey,
    ...(command.body ? { 'content-type': 'application/json' } : {}) } :
    Object.fromEntries(Object.entries(command.headers ?? {}).filter(([k]) =>
      ['authorization', 'content-type', 'x-aidscaler-source-instance'].includes(k.toLowerCase())));
  const response = await fetcher(url, { method: command.method, headers, body: command.body,
    redirect: 'error', signal: AbortSignal.timeout(25000) });
  const bytes = await response.text();
  if (Buffer.byteLength(bytes) > 32 * 1024 * 1024) throw Error('BRIDGE_BODY_LIMIT');
  return { status: response.status, body: bytes, headers: Object.fromEntries(
    [...response.headers].filter(([key]) => ['content-type', 'x-aidscaler-source-instance'].includes(key))) };
}

export async function runBridge(env = process.env) {
  const directory = path.resolve(env.DATA_DIR ?? '.local/gcp-simulator');
  await mkdir(directory, { recursive: true });
  if (!env.GOOGLE_CLOUD_PROJECT || !env.BRIDGE_COMMAND_SUBSCRIPTION || !env.BRIDGE_REPLY_TOPIC)
    throw Error('Set the project, command subscription and reply topic before starting the bridge.');
  console.log('[AidScaler bridge] Recovering retained world.');
  const world = await startDemoHost({ dataDir: env.DEMO_WORLD_DIR ?? path.join(directory, 'world'), autostart: false, checkpointWhilePaused: false,
    observerPort: Number(env.DEMO_OBSERVER_PORT ?? 4318), sourcePort: Number(env.DEMO_SOURCE_PORT ?? 4319),
    rate: Number(env.DEMO_RATE ?? 10), director: { enabled: true, intervalMs: 300000, maxOpen: 8, maxActive: 5 },
    allowDemoBuildUpgrade: env.DEMO_ALLOW_BUILD_UPGRADE === 'true',
    allowOperationalDemoUpgrade: env.DEMO_MIGRATE_OPERATIONAL_CONFIG === 'true' });
  console.log('[AidScaler bridge] Retained world recovered; waiting for visible visitors.');
  const presence = new DemoPresence({ pause: () => world.pause(), resume: () => world.resume(),
    persist: () => world.persist(), idleMs: 600000 });
  const db = new DatabaseSync(path.join(directory, 'bridge.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS replies(id TEXT PRIMARY KEY, payload BLOB NOT NULL, at INTEGER NOT NULL)');
  const get = db.prepare('SELECT payload FROM replies WHERE id=?'), put = db.prepare('INSERT OR REPLACE INTO replies VALUES(?,?,?)');
  const client = new PubSub({ projectId: env.GOOGLE_CLOUD_PROJECT });
  const topic = client.topic(env.BRIDGE_REPLY_TOPIC);
  const subscription = client.subscription(env.BRIDGE_COMMAND_SUBSCRIPTION, { flowControl: { maxMessages: 12 } });
  const pending = new Map();
  subscription.on('message', async message => {
    try {
      const command = decodeWire(message.data), cached = get.get(command.id);
      if (!cached && command.deadline < Date.now()) { message.ack(); return; }
      let response = cached?.payload;
      if (!response) {
        if (!pending.has(command.id)) {
          const work = (async () => {
            let result;
            try { result = await executeBridgeCommand(command, { world, presence }); }
            catch { result = { status: 503, headers: {}, body: JSON.stringify({ error: 'BRIDGE_SOURCE', message: 'The simulator is reconnecting.' }) }; }
            const payload = encodeWire({ version: WIRE_VERSION, id: command.id, ...result });
            put.run(command.id, payload, Date.now()); return payload;
          })().finally(() => pending.delete(command.id));
          pending.set(command.id, work);
        }
        response = await pending.get(command.id);
      }
      await topic.publishMessage({ data: Buffer.from(response) }); message.ack();
    } catch { message.nack(); }
  });
  subscription.on('error', () => console.error('[AidScaler bridge] Subscription unavailable; retaining the world.'));
  const timer = setInterval(() => {
    presence.sweep().catch(() => {});
    db.prepare('DELETE FROM replies WHERE at<?').run(Date.now() - 86400000);
  }, 5000); timer.unref();
  const health = http.createServer((req, res) => {
    res.writeHead(world.persistenceError ? 503 : 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ready: !world.persistenceError, ...presence.status() }));
  });
  await new Promise(resolve => health.listen(Number(env.PORT ?? 8081), '0.0.0.0', resolve));
  const close = async () => {
    clearInterval(timer); await subscription.close(); await Promise.allSettled([...pending.values()]);
    await new Promise(resolve => health.close(resolve)); await world.close(); db.close(); await client.close();
  };
  return { world, presence, close };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const bridge = await runBridge();
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => bridge.close().then(() => process.exit(0)));
}
