import { observerCredential, observerSessionCookie } from './observer-session.mjs';
import http from 'node:http';
import path from 'node:path';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createIsolatedRuntime } from './isolated-runtime.mjs';
import { sourceHTML } from './social-view.mjs';
import { SimError, ACTION_SCHEMA } from '../contracts/actions.mjs';
import { INPUT_TYPES, OBSERVATION_SCHEMA } from '../contracts/inputs.mjs';
import { CONFIG_SCHEMA } from '../contracts/config.mjs';
import { SCENARIOS } from '../scenarios/catalog.mjs';
import { PRESETS } from '../content/presets.mjs';
import { SOURCE_INSTANCE_HEADER } from './source-instance.mjs';
import { demoMap, demoFrame } from './demo-projection.mjs';
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const json = (res, status, value) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(value));
};
const equal = (a, b) =>
  typeof a === 'string' &&
  typeof b === 'string' &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
async function body(req, limit = 2000000) {
  const chunks = [];
  let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > limit) throw new SimError('BODY_LIMIT', 'Request too large', 413);
    chunks.push(part);
  }
  try {
    return JSON.parse(Buffer.concat(chunks, size).toString('utf8') || '{}');
  } catch {
    throw new SimError('JSON', 'Invalid JSON');
  }
}

export async function createIsolatedLabServers({
  config = {},
  checkpoint,
  observerPort = 4318,
  sourcePort = 4319,
  observerKey = randomBytes(24).toString('hex'),
  actorKeys = null,
  persistCredentials = true,
  storageDir,
  bus,
  documents,
  tickMs,
  workBudgetMs,
  projectionMs,
} = {}) {
  const runtime = await createIsolatedRuntime({
    config,
    checkpoint,
    storageDir,
    bus,
    documents,
    tickMs,
    workBudgetMs,
    projectionMs,
  });
  actorKeys ??= Object.fromEntries(
    runtime.meta.organizations.map((org) => [
      randomBytes(24).toString('hex'),
      { id: `external-${org.id}`, org: org.id, role: 'agent' },
    ]),
  );
  let actualObserver = observerPort,
    actualSource = sourcePort,
    closing = false;
  const sourceURL = () => `http://127.0.0.1:${actualSource}`;
  const observerAuth = (req) => {
    if (
      !equal(
        observerCredential(req, actualObserver),
        observerKey,
      )
    )
      throw new SimError('OBSERVER_AUTH', 'Observer authentication required', 401);
  };
  const sameOrigin = (req) => {
    if (
      req.headers.origin &&
      !['http://127.0.0.1:' + actualObserver, 'http://localhost:' + actualObserver].includes(
        req.headers.origin,
      )
    )
      throw new SimError('ORIGIN', 'Cross-origin mutation denied', 403);
  };
  const actorAuth = (req) => {
    const key = req.headers.authorization?.replace(/^Bearer /, ''),
      actor = Object.hasOwn(actorKeys, key) ? actorKeys[key] : null;
    if (!actor || (actor.expiresAt && actor.expiresAt <= Date.now()))
      throw new SimError('AUTHENTICATION', 'Actor key required', 401);
    if (
      !runtime.meta.organizations.some((org) => org.id === actor.org) ||
      runtime.meta.integrations.revokedOrgs.includes(actor.org)
    )
      throw new SimError('ACCESS_REVOKED', 'Actor access has been revoked', 403);
    return actor;
  };
  const ensureActors = () => {
    for (const org of runtime.meta.organizations)
      if (!Object.values(actorKeys).some((actor) => actor.org === org.id))
        actorKeys[randomBytes(24).toString('hex')] = {
          id: `external-${org.id}`,
          org: org.id,
          role: 'agent',
        };
  };
  async function mutation(method, ...args) {
    const result = await runtime.request(method, ...args);
    await runtime.refresh();
    return result;
  }
  async function staticFile(res, file) {
    const resolved = path.resolve(root, file);
    if (!resolved.startsWith(root + path.sep) || file.includes('..'))
      throw new SimError('PATH', 'Invalid path', 403);
    const bytes = await readFile(resolved);
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript',
      '.mjs': 'text/javascript',
      '.css': 'text/css',
      '.svg': 'image/svg+xml',
    };
    res.writeHead(200, {
      'Content-Type': types[path.extname(resolved)] ?? 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(bytes);
  }
  const observer = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api/login' && req.method === 'POST') {
        sameOrigin(req);
        const input = await body(req);
        if (!equal(input.key, observerKey))
          throw new SimError('LOGIN', 'Invalid observer key', 401);
        res.setHeader('Set-Cookie', observerSessionCookie(observerKey, actualObserver));
        return json(res, 200, { authenticated: true });
      }
      if (!url.pathname.startsWith('/api/'))
        return await staticFile(
          res,
          url.pathname === '/'
            ? 'viewer/index.html'
            : url.pathname === '/content/social.mjs'
              ? 'content/social.mjs'
              : url.pathname.startsWith('/vendor/')
                ? 'node_modules/three/' + url.pathname.slice(8)
                : 'viewer/' + url.pathname.slice(1),
        );
      observerAuth(req);
      const reads = [
        '/api/state',
        '/api/activity',
        '/api/catalog',
        '/api/checkpoint',
        '/api/metrics',
        '/api/credentials',
        '/api/events',
        '/api/compare',
        '/api/viewer/bootstrap',
        '/api/viewer/frame',
        '/api/runtime',
        '/api/demo/bootstrap',
        '/api/demo/frame',
      ];
      if (req.method !== (reads.includes(url.pathname) ? 'GET' : 'POST'))
        throw new SimError('METHOD', 'Method not allowed', 405);
      if (req.method === 'POST') sameOrigin(req);
      if (url.pathname === '/api/demo/bootstrap' || url.pathname === '/api/demo/frame') {
        const value = await runtime.bootstrap('org0', 'truth');
        const frame = demoFrame(value.frame, { sourceInstance: runtime.meta.sourceInstance,
          feed: runtime.feed, maxActive: runtime.meta.demo?.maxActive,
          director: runtime.meta.demo?.director });
        return json(res, 200, url.pathname.endsWith('/bootstrap')
          ? { mapId: value.mapId, map: demoMap(value.map), frame } : frame);
      }
      const scope = {
        org: url.searchParams.get('org') ?? 'org0',
        perspective: url.searchParams.get('perspective') ?? 'truth',
      };
      if (
        !runtime.meta.organizations.some((org) => org.id === scope.org) ||
        !['truth', scope.org].includes(scope.perspective)
      )
        throw new SimError('ACTIVITY_SCOPE', 'Choose truth or the requested organization');
      if (url.pathname === '/api/viewer/bootstrap') {
        const value = await runtime.bootstrap(scope.org, scope.perspective);
        return json(res, 200, { ...value, frame: { ...value.frame, sourceUrl: sourceURL() } });
      }
      if (url.pathname === '/api/viewer/frame')
        return json(res, 200, {
          ...(await runtime.frame(scope.org, scope.perspective)),
          sourceUrl: sourceURL(),
        });
      if (url.pathname === '/api/state')
        return json(res, 200, {
          ...(await runtime.observer()),
          ...runtime.meta,
          sourceUrl: sourceURL(),
        });
      if (url.pathname === '/api/activity') return json(res, 200, await runtime.activity(scope));
      if (url.pathname === '/api/catalog')
        return json(res, 200, { scenarios: SCENARIOS, presetCount: PRESETS.length });
      if (url.pathname === '/api/runtime') {
        const meta = await runtime.refresh();
        return json(res, 200, {
          ...meta,
          transport: await runtime.bus.stats(),
          transportError: runtime.error?.message ?? null,
        });
      }
      if (url.pathname === '/api/checkpoint')
        return json(res, 200, await runtime.request('checkpoint'));
      if (url.pathname === '/api/metrics') return json(res, 200, await runtime.evaluate());
      if (url.pathname === '/api/events')
        return json(
          res,
          200,
          await runtime.request('events', {
            offset: Number(url.searchParams.get('offset') ?? 0),
            entity: url.searchParams.get('entity') ?? undefined,
          }),
        );
      if (url.pathname === '/api/compare')
        return json(
          res,
          200,
          await runtime.request('compare', { pair: url.searchParams.get('pair') === '1' }),
        );
      if (url.pathname === '/api/credentials')
        return json(res, 200, { actors: actorKeys, sourceUrl: sourceURL(), sourceInstance: runtime.meta.sourceInstance });
      const input = await body(req, url.pathname === '/api/restore' ? 128000000 : 2000000);
      if (url.pathname === '/api/demo/organizations')
        return json(res, 201, await mutation('demoCreateOrganization', input));
      if (url.pathname === '/api/demo/organizations/release')
        return json(res, 200, await mutation('demoReleaseOrganization', input));
      if (url.pathname === '/api/demo/director')
        return json(res, 200, await mutation('demoConfigureDirector', input));
      if (url.pathname === '/api/control') return json(res, 200, await mutation('control', input));
      if (url.pathname === '/api/inject') return json(res, 200, await mutation('inject', input));
      if (url.pathname === '/api/action')
        return json(
          res,
          200,
          await mutation(
            'actorAction',
            { id: `human-${input.org ?? 'org0'}`, org: input.org ?? 'org0', role: 'commander' },
            input.action,
          ),
        );
      if (url.pathname === '/api/config') {
        const result = await mutation('reset', input);
        ensureActors();
        return json(res, 200, result);
      }
      if (url.pathname === '/api/restore') {
        const result = await mutation('restore', input);
        ensureActors();
        return json(res, 200, result);
      }
      if (url.pathname === '/api/comparison')
        return json(res, 200, await mutation('compare', { ...input, create: true }));
      if (url.pathname === '/api/actors/provision') {
        if (
          !runtime.meta.organizations.some((org) => org.id === input.org) ||
          !['agent', 'commander', 'dispatcher', 'field'].includes(input.role)
        )
          throw new SimError('ACTOR', 'A valid organization and scoped role are required');
        const ttl = input.ttlMs ?? 86400000;
        if (!Number.isSafeInteger(ttl) || ttl < 1000 || ttl > 604800000)
          throw new SimError(
            'ACTOR_TTL',
            'Actor credentials last between one second and seven days',
          );
        const key = randomBytes(24).toString('hex');
        actorKeys[key] = {
          id: input.id ?? `operator-${input.org}-${randomBytes(4).toString('hex')}`,
          org: input.org,
          role: input.role,
          expiresAt: Date.now() + ttl,
        };
        return json(res, 201, { key, actor: actorKeys[key] });
      }
      if (url.pathname === '/api/actors/revoke') {
        if (!Object.hasOwn(actorKeys, input.key))
          throw new SimError('ACTOR', 'Credential not found', 404);
        delete actorKeys[input.key];
        return json(res, 200, { revoked: true });
      }
      throw new SimError('NOT_FOUND', 'Endpoint not found', 404);
    } catch (error) {
      if (!res.headersSent)
        json(res, error.status ?? (error.code === 'ENOENT' ? 404 : 500), {
          error: error.code ?? 'ERROR',
          message: error.status ? error.message : 'Observer request failed',
        });
      else res.destroy();
    }
  });
  const sourceRequests = new Map();
  const sources = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/assets/')) {
        if (req.method !== 'GET') throw new SimError('METHOD', 'Method not allowed', 405);
        const name = url.pathname.slice(8);
        if (!['social.css', 'social-feed.mjs', 'social-view.mjs'].includes(name))
          throw new SimError('NOT_FOUND', 'Not found', 404);
        return await staticFile(res, 'sources/' + name);
      }
      const mutations = [
        '/api/actor/action',
        '/api/actor/ingestion',
        '/api/actor/ingestion/batch',
        '/api/actor/model/start',
        '/api/actor/model/finish',
      ];
      if (req.method !== (mutations.includes(url.pathname) ? 'POST' : 'GET'))
        throw new SimError('METHOD', 'Method not allowed', 405);
      const bucket =
          (req.headers.authorization ?? req.socket.remoteAddress) +
          '-' +
          Math.floor(Date.now() / 60000),
        count = (sourceRequests.get(bucket) ?? 0) + 1;
      sourceRequests.set(bucket, count);
      if (sourceRequests.size > 10000) sourceRequests.clear();
      if (count > runtime.meta.config.sourceRequestLimit) {
        res.setHeader('Retry-After', '60');
        throw new SimError('RATE_LIMIT', 'Source request limit exceeded', 429);
      }
      const params = Object.fromEntries(
        [...url.searchParams].filter(([key]) =>
          ['q', 'cursor', 'limit', 'since', 'author', 'location'].includes(key),
        ),
      );
      for (const key of ['cursor', 'limit', 'since'])
        if (key in params) {
          params[key] = Number(params[key]);
          if (!Number.isSafeInteger(params[key]) || params[key] < 0)
            throw new SimError('PAGINATION', 'Invalid pagination');
        }
      if (url.pathname.startsWith('/api/actor')) {
        const actor = actorAuth(req);
        res.setHeader(SOURCE_INSTANCE_HEADER, runtime.meta.sourceInstance);
        const actorRead = async (read) => {
          for (;;) {
            const instance = runtime.meta.sourceInstance;
            const value = await read();
            if (instance !== runtime.meta.sourceInstance) continue;
            res.setHeader(SOURCE_INSTANCE_HEADER, instance);
            return value;
          }
        };
        const actorMutation = async (method, ...args) => {
          const result = await runtime.request('boundActorMutation',
            req.headers[SOURCE_INSTANCE_HEADER.toLowerCase()], method, args);
          res.setHeader(SOURCE_INSTANCE_HEADER, result.sourceInstance);
          await runtime.refresh();
          return result.value;
        };
        if (url.pathname === '/api/actor/state')
          return json(
            res,
            200,
            await actorRead(async () => url.searchParams.get('compact') === '1'
              ? await runtime.actor(actor.org)
              : await runtime.legacyActor(actor.org)),
          );
        if (url.pathname === '/api/actor/query-result')
          return json(
            res,
            200,
            await actorRead(() => runtime.queryResult(
              actor.org,
              url.searchParams.get('id'),
              url.searchParams.get('version'),
            )),
          );
        if (url.pathname === '/api/actor/inbox')
          return json(
            res,
            200,
            await actorRead(() => runtime.request('feed', { ...params, org: actor.org, audience: 'team' })),
          );
        if (url.pathname === '/api/actor/queries')
          return json(res, 200, { queries: await actorRead(() => runtime.request('actorQueries', actor.org)) });
        const input = mutations.includes(url.pathname) ? await body(req) : null;
        if (url.pathname === '/api/actor/action')
          return json(res, 200, await actorMutation('actorAction', actor, input));
        if (url.pathname === '/api/actor/ingestion')
          return json(res, 200, await actorMutation('acknowledge', actor, input));
        if (url.pathname === '/api/actor/ingestion/batch') {
          if (!Array.isArray(input.items) || input.items.length > 100)
            throw new SimError('BATCH', 'One to one hundred ingestion receipts required', 400);
          return json(res, 200, await actorMutation('acknowledgeBatch', actor, input.items));
        }
        if (url.pathname === '/api/actor/model/start')
          return json(res, 200, await actorMutation('startModelCall', actor, input));
        if (url.pathname === '/api/actor/model/finish')
          return json(res, 200, await actorMutation('finishModelCall', actor, input));
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
      if (!runtime.meta.integrations.sourceAvailable)
        throw new SimError('SOURCE_UNAVAILABLE', 'Source is temporarily unavailable', 503);
      const cached =
        !params.cursor &&
        !params.q &&
        !params.since &&
        !params.author &&
        !params.location &&
        (params.limit ?? 100) <= 100;
      const getFeed = async () => {
        if (cached && runtime.timeline) {
          const value = runtime.timeline,
            limit = params.limit ?? 30;
          return {
            ...value,
            posts: value.posts.slice(0, limit),
            nextCursor: limit < value.total ? limit : null,
          };
        }
        return runtime.request('timeline', params);
      };
      if (url.pathname === '/api/feed') {
        const limit = params.limit ?? 30;
        const raw =
          cached && runtime.feed
            ? {
                ...runtime.feed,
                posts: runtime.feed.posts.slice(0, limit),
                nextCursor: limit < runtime.feed.total ? limit : null,
              }
            : await runtime.request('feed', params);
        if (runtime.meta.integrations.schemaVersion !== 1)
          return json(res, 200, {
            schemaVersion: runtime.meta.integrations.schemaVersion,
            items: raw.posts,
          });
        return json(res, 200, raw);
      }
      if (url.pathname === '/api/timeline') return json(res, 200, await getFeed());
      if (['/', '/feed', '/search'].includes(url.pathname)) {
        const feed = await getFeed();
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(
          sourceHTML(
            url.pathname === '/search' ? 'Search results' : 'Community signals',
            feed.posts,
            feed.nextCursor,
            { ...feed, query: params, live: !params.cursor },
          ),
        );
      }
      if (url.pathname === '/public') {
        const state = await runtime.actor('org0');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(
          sourceHTML(
            'Relief updates',
            state.publicUpdates.map((update) => ({
              id: update.id,
              authorId: update.organization,
              authorName: update.organization,
              text: update.text,
              format: 'text',
              publishedAt: update.at,
              location: null,
              likes: 0,
              version: 1,
              attachments: [],
              references: [],
            })),
          ),
        );
      }
      if (url.pathname.startsWith('/posts/')) {
        const post = await runtime.request('post', url.pathname.slice(7));
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(
          sourceHTML('Community report', [post], null, {
            now: runtime.meta.now,
            runId: runtime.meta.runId,
          }),
        );
      }
      if (url.pathname.startsWith('/users/')) {
        const feed = await runtime.request('timeline', {
          ...params,
          author: url.pathname.slice(7),
        });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(
          sourceHTML('Resident reports', feed.posts, feed.nextCursor, {
            ...feed,
            query: params,
            live: !params.cursor,
          }),
        );
      }
      throw new SimError('NOT_FOUND', 'Not found', 404);
    } catch (error) {
      if (!res.headersSent)
        json(res, error.status ?? 500, {
          error: error.code ?? 'ERROR',
          message: error.status ? error.message : 'Source request failed',
        });
      else res.destroy();
    }
  });
  try {
    await Promise.all([
      new Promise((resolve, reject) => {
        observer.once('error', reject);
        observer.listen(observerPort, '127.0.0.1', resolve);
      }),
      new Promise((resolve, reject) => {
        sources.once('error', reject);
        sources.listen(sourcePort, '127.0.0.1', resolve);
      }),
    ]);
  } catch (error) {
    await runtime.close();
    observer.close();
    sources.close();
    throw error;
  }
  actualObserver = observer.address().port;
  actualSource = sources.address().port;
  if (persistCredentials) {
    await mkdir(path.join(root, '.local'), { recursive: true });
    await writeFile(
      path.join(root, '.local/session.json'),
      JSON.stringify(
        {
          observerKey,
          actors: actorKeys,
          sourceInstance: runtime.meta.sourceInstance,
          observerUrl: `http://127.0.0.1:${actualObserver}`,
          sourceUrl: sourceURL(),
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
  }
  return {
    observer,
    sources,
    observerKey,
    actorKeys,
    observerPort: actualObserver,
    sourcePort: actualSource,
    runtime,
    advance: (target) => runtime.request('advance', target),
    checkpoint: () => runtime.request('checkpoint'),
    async close() {
      if (closing) return;
      closing = true;
      await runtime.close();
      observer.closeAllConnections();
      sources.closeAllConnections();
      await Promise.all([
        new Promise((resolve) => observer.close(resolve)),
        new Promise((resolve) => sources.close(resolve)),
      ]);
    },
  };
}
