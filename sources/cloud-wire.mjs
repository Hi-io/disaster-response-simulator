import { gzipSync, gunzipSync } from 'node:zlib';
export const WIRE_VERSION = 'aidscaler-bridge-v1';
const MAX = 8 * 1024 * 1024;
export function encodeWire(value) {
  const json = Buffer.from(JSON.stringify(value));
  if (json.length > 32 * 1024 * 1024) throw Error('BRIDGE_BODY_LIMIT');
  const data = gzipSync(json);
  if (data.length > MAX) throw Error('BRIDGE_BODY_LIMIT');
  return data;
}
export function decodeWire(data) {
  if (data.length > MAX) throw Error('BRIDGE_BODY_LIMIT');
  const value = JSON.parse(gunzipSync(data, { maxOutputLength: 32 * 1024 * 1024 }));
  if (value.version !== WIRE_VERSION) throw Error('BRIDGE_VERSION');
  return value;
}
export function validateCommand(command, now = Date.now()) {
  if (command.version !== WIRE_VERSION || !/^[a-zA-Z0-9_-]{8,100}$/.test(command.id ?? '') ||
      !Number.isSafeInteger(command.deadline) || command.deadline < now || command.deadline > now + 120000)
    throw Error('BRIDGE_COMMAND_EXPIRED');
  if (command.scope === 'presence') {
    if (!/^[a-f0-9]{64}$/.test(command.body?.client ?? '') || command.body?.visible !== true)
      throw Error('BRIDGE_PRESENCE');
    return;
  }
  const url = new URL(command.path, 'http://source.local');
  if (url.origin !== 'http://source.local' || !['GET', 'POST'].includes(command.method)) throw Error('BRIDGE_SCOPE');
  if (command.scope === 'observer') {
    if (!['/api/demo/bootstrap', '/api/demo/frame', '/api/demo/organizations', '/api/demo/organizations/release',
      '/api/demo/organizations/resupply', '/api/actors/provision'].includes(url.pathname)) throw Error('BRIDGE_SCOPE');
  } else if (command.scope === 'actor') {
    if (!(url.pathname.startsWith('/api/actor/') || ['/api/feed', '/api/contracts', '/feed'].includes(url.pathname)) ||
        typeof command.headers?.authorization !== 'string') throw Error('BRIDGE_SCOPE');
  } else throw Error('BRIDGE_SCOPE');
}

// A real-time lease; the simulated clock is deliberately not used here.
export class DemoPresence {
  constructor({ pause, resume, persist = async () => {}, idleMs = 600000, now = Date.now }) {
    Object.assign(this, { pause, resume, persist, idleMs, now });
    this.leases = new Map(); this.sleeping = true; this.tail = Promise.resolve();
  }
  run(fn) { const work = this.tail.then(fn); this.tail = work.catch(() => {}); return work; }
  touch(client) {
    return this.run(async () => {
      this.leases.set(client, this.now() + this.idleMs);
      if (this.sleeping) { await this.resume(); this.sleeping = false; }
      return this.status();
    });
  }
  sweep() {
    return this.run(async () => {
      for (const [key, expiry] of this.leases) if (expiry <= this.now()) this.leases.delete(key);
      if (!this.leases.size && !this.sleeping) {
        await this.pause(); await this.persist(); this.sleeping = true;
      }
      return this.status();
    });
  }
  status() { return { sleeping: this.sleeping, viewers: this.leases.size }; }
}
