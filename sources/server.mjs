import http from 'node:http';
import path from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { World } from '../engine/world.mjs';
import { SCENARIOS } from '../scenarios/catalog.mjs';
import { PRESETS } from '../content/presets.mjs';
import { SimError, ACTION_SCHEMA } from '../contracts/actions.mjs';
import { INPUT_TYPES, OBSERVATION_SCHEMA } from '../contracts/inputs.mjs';
import { CONFIG_SCHEMA } from '../contracts/config.mjs';
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const json = (res, status, data) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(data));
};
const equal = (a, b) =>
  typeof a === 'string' &&
  typeof b === 'string' &&
  a.length === b.length &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
async function body(req, limit = 2000000) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > limit) throw new SimError('BODY_LIMIT', 'Request too large', 413);
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new SimError('JSON', 'Invalid JSON');
  }
}
function sourceHTML(title, posts, next = null) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(title)} · Signal</title><style>body{font:16px system-ui;background:#f2f4f8;color:#172332;max-width:760px;margin:40px auto;padding:0 24px}a{color:#405cda}article{background:white;border:1px solid #dde2ea;border-radius:16px;padding:22px;margin:16px 0}header{display:flex;justify-content:space-between}small{color:#6b7484}.media{background:#e6e9ef;border-radius:10px;padding:20px;margin-top:15px}input{padding:12px;border:1px solid #ccd2dc;border-radius:8px}nav{display:flex;gap:20px}</style></head><body><nav><strong>◉ Signal</strong><a href="/feed">Timeline</a><a href="/search">Search</a><a href="/public">Relief updates</a></nav><h1>${esc(title)}</h1><p><small>Fictional disaster information source. Posts may be inaccurate.</small></p><form action="/search"><input name="q" placeholder="Search reports"><button>Search</button></form>${posts.map((p) => `<article data-post-id="${esc(p.id)}" data-version="${p.version}"><header><a href="/users/${esc(p.authorId)}">${esc(p.authorName)}</a><small>${new Date(Date.UTC(2026, 0, 1) + p.publishedAt).toISOString()}</small></header><p>${esc(p.text)}</p>${p.attachments.map((m) => `<div class="media" data-media-kind="${esc(m.kind)}">${m.kind === 'video' ? '▶' : m.kind === 'audio' ? '◖' : '▧'} ${esc(m.kind)} ${m.duration ? `· ${m.duration}s` : ''}<p>${esc(m.description)}</p></div>`).join('')}<small>${esc(p.location)} · ${p.likes} reactions · <a href="/posts/${esc(p.id)}">Permalink</a></small>${p.references.map((id) => ` <a href="/posts/${esc(id)}">Referenced post</a>`).join('')}</article>`).join('')}${next !== null ? `<a rel="next" href="/feed?cursor=${next}">Older posts →</a>` : ''}</body></html>`;
}

export async function createLabServers({
  config = {},
  observerPort = 4318,
  sourcePort = 4319,
  observerKey = randomBytes(24).toString('hex'),
  actorKeys = null,
  persistCredentials = true,
} = {}) {
  let world = new World(config),
    comparison = null,
    playing = false,
    rate = world.config.mode === 'live' ? 1 : 10,
    previous = performance.now(),
    effective = 0;
  actorKeys ??= Object.fromEntries(
    world.state.map.organizations.map((o) => [
      randomBytes(24).toString('hex'),
      { id: `external-${o.id}`, org: o.id, role: 'agent' },
    ]),
  );
  const ensureActorKeys = () => {
    for (const o of world.state.map.organizations)
      if (!Object.values(actorKeys).some((a) => a.org === o.id))
        actorKeys[randomBytes(24).toString('hex')] = {
          id: `external-${o.id}`,
          org: o.id,
          role: 'agent',
        };
  };
  const sourceRequests = new Map();
  const tick = setInterval(() => {
    const now = performance.now(),
      wall = now - previous;
    previous = now;
    if (!playing) return;
    const before = world.now;
    try {
      world.advance(Math.min(world.config.durationMs, Math.round(world.now + wall * rate)), {
        maxEvents: 2500,
      });
      effective = wall ? (world.now - before) / wall : 0;
      if (comparison) {
        let progress;
        do {
          progress = comparison.advance(world.now, { maxEvents: 100000 });
        } while (!progress.reached && !progress.blocked);
      }
      if (world.now >= world.config.durationMs) playing = false;
    } catch (e) {
      playing = false;
      world.record('runtime_error', { message: e.message });
    }
  }, 80);
  tick.unref();
  const authorizeObserver = (req) => {
    const bearer = req.headers.authorization?.replace(/^Bearer /, '');
    const cookie = req.headers.cookie?.match(/(?:^|; )observer=([^;]+)/)?.[1];
    if (!equal(bearer ?? cookie, observerKey))
      throw new SimError('OBSERVER_AUTH', 'Observer authentication required', 401);
  };
  const requireSameOrigin = (req) => {
    if (
      req.headers.origin &&
      !['http://127.0.0.1:' + observerPort, 'http://localhost:' + observerPort].includes(
        req.headers.origin,
      )
    )
      throw new SimError('ORIGIN', 'Cross-origin mutation denied', 403);
  };
  const observer = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api/login' && req.method === 'POST') {
        requireSameOrigin(req);
        const b = await body(req);
        if (!equal(b.key, observerKey)) throw new SimError('LOGIN', 'Invalid observer key', 401);
        res.setHeader('Set-Cookie', `observer=${observerKey}; HttpOnly; SameSite=Strict; Path=/`);
        return json(res, 200, { authenticated: true });
      }
      if (url.pathname.startsWith('/api/')) {
        authorizeObserver(req);
        const reads = [
          '/api/state',
          '/api/catalog',
          '/api/checkpoint',
          '/api/metrics',
          '/api/credentials',
          '/api/events',
          '/api/compare',
        ];
        if (req.method !== (reads.includes(url.pathname) ? 'GET' : 'POST'))
          throw new SimError('METHOD', 'Method not allowed', 405);
        if (req.method === 'POST') requireSameOrigin(req);
        if (url.pathname === '/api/state')
          return json(res, 200, {
            ...world.observer(),
            playing,
            rate,
            effectiveRate: effective,
            comparison: comparison
              ? {
                  policyA: world.config.policy,
                  policyB: comparison.config.policy,
                  now: comparison.now,
                }
              : null,
            sourceUrl: `http://127.0.0.1:${sources.address().port}`,
          });
        if (url.pathname === '/api/catalog')
          return json(res, 200, { scenarios: SCENARIOS, presetCount: PRESETS.length });
        const b =
          req.method === 'POST'
            ? await body(req, url.pathname === '/api/restore' ? 128000000 : 2000000)
            : {};
        if (url.pathname === '/api/actors/provision') {
          if (!world.organization(b.org) || !['agent', 'commander', 'dispatcher', 'field'].includes(b.role))
            throw new SimError('ACTOR', 'A valid organization and scoped role are required');
          if (!Number.isSafeInteger(b.ttlMs ?? 86400000) || (b.ttlMs ?? 86400000) < 1000 || (b.ttlMs ?? 86400000) > 604800000)
            throw new SimError('ACTOR_TTL', 'Actor credentials last between one second and seven days');
          const key = randomBytes(24).toString('hex');
          actorKeys[key] = { id: b.id ?? `operator-${b.org}-${randomBytes(4).toString('hex')}`, org: b.org, role: b.role, expiresAt: Date.now() + (b.ttlMs ?? 86400000) };
          return json(res, 201, { key, actor: actorKeys[key] });
        }
        if (url.pathname === '/api/actors/revoke') {
          if (!Object.hasOwn(actorKeys, b.key)) throw new SimError('ACTOR', 'Credential not found', 404);
          delete actorKeys[b.key];
          return json(res, 200, { revoked: true });
        }
        if (url.pathname === '/api/config') {
          const replacement = new World(b);
          world.close();
          comparison?.close();
          comparison = null;
          world = replacement;
          ensureActorKeys();
          rate = world.config.mode === 'live' ? 1 : 10;
          playing = false;
          return json(res, 200, { runId: world.runId });
        }
        if (url.pathname === '/api/control') {
          if (b.rate !== undefined) {
            if (![1, 10, 100, 1000].includes(b.rate)) throw new SimError('RATE', 'Invalid speed');
            if (world.config.mode === 'live' && b.rate !== 1)
              throw new SimError(
                'LIVE_RATE',
                'Live external-platform evaluation uses wall time at ×1',
              );
            rate = b.rate;
          }
          if (b.play !== undefined) playing = !!b.play;
          if (b.step) {
            playing = false;
            world.step();
          }
          if (b.advanceTo !== undefined) {
            playing = false;
            world.advance(b.advanceTo);
          }
          if (b.nextRelevant) {
            const next = world.queue
              .toJSON()
              .find((e) => JSON.stringify(e.data).includes(String(b.nextRelevant)));
            if (next) world.advance(next.at);
            else throw new SimError('EVENT', 'No queued event for this entity');
          }
          if (comparison) {
            let progress;
            do {
              progress = comparison.advance(world.now, { maxEvents: 100000 });
            } while (!progress.reached && !progress.blocked);
          }
          return json(res, 200, { playing, rate, now: world.now });
        }
        if (url.pathname === '/api/action') {
          const org = b.org ?? 'org0';
          return json(
            res,
            200,
            world.act({ id: `human-${org}`, org, role: 'commander' }, b.action),
          );
        }
        if (url.pathname === '/api/inject') {
          if (
            ![
              'damage',
              'road_change',
              'intervention',
              'scenario_signal',
              'fire_front',
              'flood_level',
              'lab_intervention',
            ].includes(b.type)
          )
            throw new SimError('EVENT', 'Event type not allowed');
          world.inject(b.type, b.data ?? {});
          return json(res, 200, { injected: true });
        }
        if (url.pathname === '/api/checkpoint') return json(res, 200, world.checkpoint());
        if (url.pathname === '/api/comparison') {
          const base = { ...world.config, policy: b.policyA ?? 'conventional' };
          const a = new World(base),
            other = new World({ ...base, policy: b.policyB ?? 'federated' });
          if (a.state.map.hash !== other.state.map.hash)
            throw new SimError('PAIR', 'Initial worlds differ');
          world.close();
          comparison?.close();
          world = a;
          comparison = other;
          playing = false;
          ensureActorKeys();
          return json(res, 200, { paired: true, initialMapHash: a.state.map.hash });
        }
        if (url.pathname === '/api/compare') {
          if (!comparison) return json(res, 200, null);
          // Capture both worlds in one event-loop turn. Separate reads can straddle a tick.
          if (url.searchParams.get('pair') === '1')
            return json(res, 200, {
              a: world.observer({ limit: 100 }),
              b: comparison.observer({ limit: 100 }),
            });
          return json(res, 200, comparison.observer({ limit: 100 }));
        }
        if (url.pathname === '/api/restore') {
          const replacement = new World(b.manifest.config, b);
          world.close();
          comparison?.close();
          comparison = null;
          world = replacement;
          ensureActorKeys();
          rate = world.config.mode === 'live' ? 1 : 10;
          playing = false;
          return json(res, 200, { restored: true, runId: world.runId });
        }
        if (url.pathname === '/api/metrics') return json(res, 200, world.observer().metrics);
        if (url.pathname === '/api/events') {
          const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0));
          const entity = url.searchParams.get('entity');
          const rows = entity
            ? world.log.filter(
                (e) => e.entity === entity || Object.values(e.data ?? {}).includes(entity),
              )
            : world.log;
          return json(res, 200, {
            events: rows.slice(offset, offset + 200),
            total: rows.length,
            next: offset + 200 < rows.length ? offset + 200 : null,
          });
        }
        if (url.pathname === '/api/credentials')
          return json(res, 200, {
            actors: actorKeys,
            sourceUrl: `http://127.0.0.1:${sources.address().port}`,
          });
        throw new SimError('NOT_FOUND', 'Endpoint not found', 404);
      }
      let file =
        url.pathname === '/'
          ? 'viewer/index.html'
          : url.pathname === '/content/social.mjs'
            ? 'content/social.mjs'
            : url.pathname.startsWith('/vendor/')
              ? 'node_modules/three/' + url.pathname.slice(8)
              : 'viewer/' + url.pathname.slice(1);
      const resolved = path.resolve(root, file);
      if (!resolved.startsWith(root + path.sep) || file.includes('..'))
        throw new SimError('PATH', 'Invalid path', 403);
      const data = await readFile(resolved);
      const mime = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript',
        '.mjs': 'text/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
      };
      res.writeHead(200, {
        'Content-Type': mime[path.extname(resolved)] ?? 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(data);
    } catch (e) {
      json(res, e.status ?? (e.code === 'ENOENT' ? 404 : 500), {
        error: e.code ?? 'ERROR',
        message: e.status ? e.message : 'Observer request failed',
      });
    }
  });
  const sources = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const actorMutation = [
        '/api/actor/action',
        '/api/actor/ingestion',
        '/api/actor/ingestion/batch',
        '/api/actor/model/start',
        '/api/actor/model/finish',
      ];
      if (req.method !== (actorMutation.includes(url.pathname) ? 'POST' : 'GET'))
        throw new SimError('METHOD', 'Method not allowed', 405);
      const requestKey =
        (req.headers.authorization ?? req.socket.remoteAddress) +
        '-' +
        Math.floor(Date.now() / 60000);
      const count = (sourceRequests.get(requestKey) ?? 0) + 1;
      sourceRequests.set(requestKey, count);
      if (sourceRequests.size > 10000) sourceRequests.clear();
      if (count > world.config.sourceRequestLimit) {
        res.setHeader('Retry-After', '60');
        throw new SimError('RATE_LIMIT', 'Source request limit exceeded', 429);
      }
      let params = Object.fromEntries(
        [...url.searchParams].filter(([k]) =>
          ['q', 'cursor', 'limit', 'since', 'author', 'location'].includes(k),
        ),
      );
      for (const k of ['cursor', 'limit', 'since'])
        if (k in params) {
          params[k] = Number(params[k]);
          if (!Number.isSafeInteger(params[k]) || params[k] < 0)
            throw new SimError('PAGINATION', 'Invalid pagination');
        }
      if (url.pathname.startsWith('/api/actor')) {
        const key = req.headers.authorization?.replace(/^Bearer /, ''),
          actor = Object.hasOwn(actorKeys, key) ? actorKeys[key] : null;
        if (!actor) throw new SimError('AUTHENTICATION', 'Actor key required', 401);
        if (actor.expiresAt && actor.expiresAt <= Date.now()) throw new SimError('AUTHENTICATION', 'Actor key expired', 401);
        if (
          !world.organization(actor.org) ||
          world.state.integrations.revokedOrgs.includes(actor.org)
        )
          throw new SimError('ACCESS_REVOKED', 'Actor access has been revoked', 403);
        if (url.pathname === '/api/actor/inbox')
          return json(res, 200, world.publicFeed({ ...params, org: actor.org, audience: 'team' }));
        if (url.pathname === '/api/actor/state') return json(res, 200, world.actorView(actor.org));
        if (url.pathname === '/api/actor/action')
          return json(res, 200, world.act(actor, await body(req)));
        if (url.pathname === '/api/actor/model/start')
          return json(res, 200, world.startModelCall(actor, await body(req)));
        if (url.pathname === '/api/actor/model/finish') {
          const result = world.finishModelCall(actor, await body(req));
          if (world.config.clockLatency === 'modeled' && !world.modelBarrier())
            world.advance(result.availableAt, { maxEvents: 100000 });
          return json(res, 200, { ...result, now: world.now });
        }
        if (url.pathname === '/api/actor/queries')
          return json(res, 200, {
            queries: (world.state.queries ?? []).filter((q) => q.org === actor.org).slice(-200),
          });
        if (url.pathname === '/api/actor/ingestion')
          return json(res, 200, world.acknowledge(actor, await body(req)));
        if (url.pathname === '/api/actor/ingestion/batch') {
          const input=await body(req);
          if(!Array.isArray(input.items)||input.items.length>100)throw new SimError('BATCH','One to one hundred ingestion receipts required',400);
          return json(res,200,input.items.map(p=>{try{return {id:p.id,ok:true,receipt:world.acknowledge(actor,p)};}catch(e){return {id:p.id,ok:false,error:e.code??'RECEIPT',message:e.message};}}));
        }
        throw new SimError('NOT_FOUND', 'Actor endpoint not found', 404);
      }
      if (url.pathname.startsWith('/api/observer') || url.pathname.startsWith('/api/state'))
        throw new SimError('NOT_FOUND', 'Not found', 404);
      if (url.pathname === '/api/contracts')
        return json(res, 200, {
          action: ACTION_SCHEMA,
          observation: OBSERVATION_SCHEMA,
          inputs: INPUT_TYPES,
          config: CONFIG_SCHEMA,
        });
      if (!world.state.integrations.sourceAvailable)
        throw new SimError('SOURCE_UNAVAILABLE', 'Source is temporarily unavailable', 503);
      if (url.pathname === '/api/feed' && world.state.integrations.schemaVersion !== 1)
        return json(res, 200, {
          schemaVersion: world.state.integrations.schemaVersion,
          items: world.publicFeed(params).posts,
        });
      if (url.pathname === '/api/feed') return json(res, 200, world.publicFeed(params));
      if (url.pathname === '/public') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(
          sourceHTML(
            'Relief updates',
            world.state.publicUpdates.map((u) => ({
              id: u.id,
              authorId: u.organization,
              authorName: u.organization,
              text: u.text,
              format: 'text',
              publishedAt: u.at,
              location: null,
              likes: 0,
              version: 1,
              attachments: [],
              references: [],
            })),
          ),
        );
      }
      if (['/', '/feed', '/search'].includes(url.pathname)) {
        const feed = world.publicFeed(params);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(
          sourceHTML(
            url.pathname === '/search' ? 'Search results' : 'Community signals',
            feed.posts,
            feed.nextCursor,
          ),
        );
      }
      if (url.pathname.startsWith('/posts/')) {
        const id = url.pathname.slice(7),
          post = world.post(id);
        if (!world.sourceVisible(post)) throw new SimError('NOT_FOUND', 'Post not found', 404);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(sourceHTML('Community report', [post.public]));
      }
      if (url.pathname.startsWith('/users/')) {
        const feed = world.publicFeed({ ...params, author: url.pathname.slice(7) });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(sourceHTML('Resident reports', feed.posts));
      }
      throw new SimError('NOT_FOUND', 'Not found', 404);
    } catch (e) {
      json(res, e.status ?? 500, {
        error: e.code ?? 'ERROR',
        message: e.status ? e.message : 'Source request failed',
      });
    }
  });
  await Promise.all([
    new Promise((resolve) => observer.listen(observerPort, '127.0.0.1', resolve)),
    new Promise((resolve) => sources.listen(sourcePort, '127.0.0.1', resolve)),
  ]);
  const actualObserver = observer.address().port,
    actualSource = sources.address().port;
  if (persistCredentials) {
    await mkdir(path.join(root, '.local'), { recursive: true });
    await writeFile(
      path.join(root, '.local', 'session.json'),
      JSON.stringify(
        {
          observerKey,
          actors: actorKeys,
          observerUrl: `http://127.0.0.1:${actualObserver}`,
          sourceUrl: `http://127.0.0.1:${actualSource}`,
        },
        null,
        2,
      ),
    );
  }
  return {
    observer,
    sources,
    observerKey,
    actorKeys,
    get world() {
      return world;
    },
    observerPort: actualObserver,
    sourcePort: actualSource,
    async close() {
      clearInterval(tick);
      world.close();
      comparison?.close();
      await Promise.all([
        new Promise((r) => observer.close(r)),
        new Promise((r) => sources.close(r)),
      ]);
    },
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const lab = await createLabServers();
  console.log(
    `Observer: http://127.0.0.1:${lab.observerPort}\nSources: http://127.0.0.1:${lab.sourcePort}\nObserver access and actor keys are saved in ignored .local/session.json.`,
  );
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, async () => {
      await lab.close();
      process.exit(0);
    });
}
