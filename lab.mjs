import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { createLabServers } from './sources/server.mjs';

// Presentation transport is separate from the versioned causal engine. The
// full observer state and all source/action APIs remain available unchanged.
export function activityView(world, organizations = ['org0'], limit = 200) {
  return {
    runId: world.runId,
    now: world.now,
    totals: {
      posts: world.state.posts.length,
      messages: world.state.messages.length,
      ingestion: world.state.ingestion.length,
    },
    state: {
      posts: world.state.posts.slice(-limit),
      ingestion: world.state.ingestion.slice(-limit),
      observations: Object.fromEntries(
        [...new Set(organizations)].map((org) => {
          const known = world.state.observations[org] ?? {};
          return [
            org,
            Object.fromEntries(
              ['resources', 'needs', 'vehicles', 'buildings', 'operations'].map((key) => [
                key,
                known[key] ?? {},
              ]),
            ),
          ];
        }),
      ),
    },
    events: world.log.slice(-limit),
  };
}

export async function createLab({ config = {}, ...options } = {}) {
  const lab = await createLabServers({ ...options, config: { language: 'en', ...config } });
  const [original] = lab.observer.listeners('request');
  lab.observer.removeListener('request', original);
  lab.observer.on('request', (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/api/activity') return original(req, res);
    const respond = (status, data) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(JSON.stringify(data));
    };
    const provided = Buffer.from(
      req.headers.authorization?.replace(/^Bearer /, '') ??
        req.headers.cookie?.match(/(?:^|; )observer=([^;]+)/)?.[1] ??
        '',
    );
    const expected = Buffer.from(lab.observerKey);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected))
      return respond(401, { error: 'OBSERVER_AUTH', message: 'Observer authentication required' });
    if (req.method !== 'GET')
      return respond(405, { error: 'METHOD', message: 'Method not allowed' });
    const organizations = [url.searchParams.get('org') ?? 'org0'];
    const perspective = url.searchParams.get('perspective');
    if (perspective && perspective !== 'truth') organizations.push(perspective);
    if (organizations.some((org) => !lab.world.organization(org)))
      return respond(400, { error: 'ORGANIZATION', message: 'Unknown organization' });
    // Reading a recent window never steps the world or acknowledges a receipt.
    return respond(200, activityView(lab.world, organizations));
  });
  return lab;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const lab = await createLab();
  console.log(
    `Observer: http://127.0.0.1:${lab.observerPort}\nSources: http://127.0.0.1:${lab.sourcePort}\nObserver access and actor keys are saved in ignored .local/session.json.`,
  );
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, async () => {
      await lab.close();
      process.exit(0);
    });
}
