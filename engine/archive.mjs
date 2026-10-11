import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { stableJSON } from './determinism.mjs';

// Disk-backed authoritative records. Only a bounded cache is kept in RAM.
// This is local experiment storage, not a network-accessible database.
export class RecordArchive {
  constructor(kind, source = null) {
    this.kind = kind;
    const root = path.resolve('.local/archives');
    mkdirSync(root, { recursive: true });
    this.directory = mkdtempSync(path.join(root, kind + '-'));
    this.file = path.join(this.directory, 'records.sqlite');
    if (source) copyFileSync(source.file, this.file);
    this.db = new DatabaseSync(this.file);
    this.db.exec(
      'PRAGMA journal_mode=MEMORY; PRAGMA synchronous=OFF; CREATE TABLE IF NOT EXISTS records (idx INTEGER PRIMARY KEY, id TEXT UNIQUE NOT NULL, value TEXT NOT NULL, published INTEGER, indexed INTEGER, audience TEXT, deleted INTEGER DEFAULT 0); CREATE INDEX IF NOT EXISTS published_order ON records(published DESC, id);',
    );
    this.length = this.db.prepare('SELECT COUNT(*) AS count FROM records').get().count;
    this.cache = new Map();
    this.batch = 0;
    this.insert = this.db.prepare(
      'INSERT INTO records(idx,id,value,published,indexed,audience,deleted) VALUES(?,?,?,?,?,?,?)',
    );
    this.update = this.db.prepare(
      'UPDATE records SET value=?, published=?, indexed=?, audience=?, deleted=? WHERE id=?',
    );
    this.byId = this.db.prepare('SELECT value FROM records WHERE id=?');
    this.byIndex = this.db.prepare('SELECT value FROM records WHERE idx=?');
    this.db.exec('BEGIN');
  }
  metadata(value) {
    return [
      value.public?.publishedAt ?? null,
      value.indexAt ?? null,
      JSON.stringify(value.private?.audience ?? 'public'),
      value.deleted ? 1 : 0,
    ];
  }
  key(value, index) {
    return String(value.id ?? value.public?.id ?? index);
  }
  remember(id, value) {
    if (this.cache.has(id)) this.cache.delete(id);
    this.cache.set(id, value);
    if (this.cache.size > 256) {
      const [key, row] = this.cache.entries().next().value;
      this.persist(row, key);
      this.cache.delete(key);
    }
    return value;
  }
  transaction() {
    if (++this.batch >= 1000) {
      this.db.exec('COMMIT; BEGIN');
      this.batch = 0;
    }
  }
  push(value) {
    const key = this.key(value, this.length);
    this.insert.run(this.length, key, JSON.stringify(value), ...this.metadata(value));
    this.length++;
    this.remember(key, value);
    this.transaction();
    return this.length;
  }
  persist(value, key = this.key(value, -1)) {
    this.update.run(JSON.stringify(value), ...this.metadata(value), key);
  }
  get(id) {
    const key = String(id);
    if (this.cache.has(key)) return this.cache.get(key);
    const row = this.byId.get(key);
    return row ? this.remember(key, JSON.parse(row.value)) : undefined;
  }
  at(index) {
    if (index < 0) index += this.length;
    if (index < 0 || index >= this.length) return undefined;
    const row = this.byIndex.get(index);
    if (!row) return undefined;
    const parsed = JSON.parse(row.value);
    return this.get(this.key(parsed, index));
  }
  flush() {
    for (const [key, row] of this.cache) this.persist(row, key);
    this.db.exec('COMMIT; BEGIN');
    this.batch = 0;
  }
  *[Symbol.iterator]() {
    this.flush();
    for (const row of this.db.prepare('SELECT idx,id,value FROM records ORDER BY idx').iterate())
      yield this.cache.get(row.id) ?? JSON.parse(row.value);
  }
  slice(start = 0, end = this.length) {
    this.flush();
    if (start < 0) start = Math.max(0, this.length + start);
    if (end < 0) end = this.length + end;
    return this.db
      .prepare('SELECT value FROM records WHERE idx>=? AND idx<? ORDER BY idx')
      .all(start, end)
      .map((r) => JSON.parse(r.value));
  }
  find(fn) {
    let index = 0;
    for (const row of this) {
      if (fn(row, index++)) return row;
    }
    return undefined;
  }
  some(fn) {
    let index = 0;
    for (const row of this) if (fn(row, index++)) return true;
    return false;
  }
  every(fn) {
    let index = 0;
    for (const row of this) if (!fn(row, index++)) return false;
    return true;
  }
  reduce(fn, initial) {
    let result = initial,
      index = 0;
    for (const row of this) result = fn(result, row, index++);
    return result;
  }
  filter(fn) {
    const result = [];
    let index = 0;
    for (const row of this) if (fn(row, index++)) result.push(row);
    return result;
  }
  map(fn) {
    const result = [];
    let index = 0;
    for (const row of this) result.push(fn(row, index++));
    return result;
  }
  publicPage({
    now,
    cursor = 0,
    limit = 30,
    q = '',
    author = null,
    location = null,
    since = 0,
    org = null,
    audience = 'public',
  }) {
    this.flush();
    const scope =
      audience === 'team'
        ? 'audience != ? AND EXISTS (SELECT 1 FROM json_each(records.audience) WHERE value=?)'
        : 'audience = ?';
    const where = `published IS NOT NULL AND indexed<=? AND deleted=0 AND published>=? AND ${scope} AND (?='' OR lower(json_extract(value,'$.public.text')) LIKE '%' || lower(?) || '%') AND (? IS NULL OR json_extract(value,'$.public.authorId')=?) AND (? IS NULL OR json_extract(value,'$.public.location')=?)`;
    const params = [
      now,
      since,
      '"public"',
      ...(audience === 'team' ? [org] : []),
      q,
      q,
      author,
      author,
      location,
      location,
    ];
    const total = this.db
      .prepare(`SELECT count(*) AS count FROM records WHERE ${where}`)
      .get(...params).count;
    const rows = this.db
      .prepare(
        `SELECT json_extract(value,'$.public') AS value FROM records WHERE ${where} ORDER BY published DESC,id LIMIT ? OFFSET ?`,
      )
      .all(...params, Math.min(100, limit), cursor);
    return {
      posts: rows.map((r) => JSON.parse(r.value)),
      total,
      nextCursor: cursor + limit < total ? cursor + limit : null,
      now,
    };
  }
  descriptor() {
    this.flush();
    const directory = mkdtempSync(path.join(path.dirname(this.directory), 'snapshot-'));
    const file = path.join(directory, 'records.sqlite');
    copyFileSync(this.file, file);
    return { archive: true, kind: this.kind, file, length: this.length };
  }
  close() {
    this.flush();
    this.db.exec('COMMIT');
    this.db.close();
  }
}
export function recordsDigest(records) {
  const hash = createHash('sha256');
  for (const row of records) hash.update(stableJSON(row) + '\n');
  return { count: records.length, hash: hash.digest('hex') };
}
export const recordSnapshot = (value) =>
  value instanceof RecordArchive ? value.descriptor() : value;
