import { createHash } from 'node:crypto';

export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical(value[k])]),
    );
  return value;
}
export const stableJSON = (value) => JSON.stringify(canonical(value));
export const digest = (value) => createHash('sha256').update(stableJSON(value)).digest('hex');
// FNV-1a followed by a versioned 32-bit avalanche. Draws never share a mutable stream.
export function keyedRandom(seed, subsystem, entity, event, index = 0) {
  const text = stableJSON(['fnv-avalanche-v1', String(seed), subsystem, entity, event, index]);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export const integerDraw = (seed, stream, entity, event, min, max, i = 0) =>
  min + Math.floor(keyedRandom(seed, stream, entity, event, i) * (max - min + 1));
export const opaqueId = (seed, kind, key) =>
  digest(['opaque-v1', String(seed), kind, key]).slice(0, 24);
export const clone = (value) => structuredClone(value);

export class EventQueue {
  constructor(events = []) {
    this.heap = [];
    for (const e of events) this.push(e);
  }
  compare(a, b) {
    return a.at - b.at || a.phase - b.phase || a.key.localeCompare(b.key, 'en') || a.seq - b.seq;
  }
  push(event) {
    if (!Number.isSafeInteger(event.at) || event.at < 0)
      throw new Error('Event time must be a nonnegative safe integer');
    this.heap.push(event);
    let i = this.heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >>> 1;
      if (this.compare(this.heap[p], event) <= 0) break;
      this.heap[i] = this.heap[p];
      i = p;
    }
    this.heap[i] = event;
  }
  peek() {
    return this.heap[0];
  }
  pop() {
    if (!this.heap.length) return null;
    const head = this.heap[0],
      tail = this.heap.pop();
    if (this.heap.length) {
      let i = 0;
      while (true) {
        let c = 2 * i + 1;
        if (c >= this.heap.length) break;
        if (c + 1 < this.heap.length && this.compare(this.heap[c + 1], this.heap[c]) < 0) c++;
        if (this.compare(tail, this.heap[c]) <= 0) break;
        this.heap[i] = this.heap[c];
        i = c;
      }
      this.heap[i] = tail;
    }
    return head;
  }
  get size() {
    return this.heap.length;
  }
  toJSON() {
    return [...this.heap].sort((a, b) => this.compare(a, b));
  }
}
