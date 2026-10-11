import test from 'node:test';
import assert from 'node:assert/strict';
import { GeminiController } from '../adapters/gemini.mjs';
import { SourceClient } from '../adapters/client.mjs';
import { createLabServers } from '../sources/server.mjs';
test('a real source client scrapes HTML, downloads public data and records scoped receipts', async (t) => {
  const lab = await createLabServers({
    observerPort: 0,
    sourcePort: 0,
    persistCredentials: false,
    config: { hazard: 'none', postsPerHour: 0, backgroundTraffic: 0, packetLoss: 0 },
  });
  t.after(() => lab.close());
  lab.world.advance(600000);
  const client = new SourceClient({
    baseUrl: `http://127.0.0.1:${lab.sourcePort}`,
    actorKey: Object.keys(lab.actorKeys)[0],
  });
  const page = await client.scrape();
  assert.ok(page.ids.length > 0);
  const feed = await client.feed();
  assert.ok(feed.posts.length > 0);
  assert.equal(lab.world.state.ingestion[0].stage, 'downloaded');
  assert.ok(!JSON.stringify(feed).includes('truthCategory'));
  await client.ingest(feed.posts[0], 'interpreted');
  assert.equal(lab.world.state.ingestion.at(-1).stage, 'interpreted');
});
test('Gemini transport preserves tool calls but cannot execute operational commands or expose credentials', async () => {
  const actions = [],
    requests = [],
    latencies = [];
  let round = 0;
  const client = {
    state: async () => ({ organization: { id: 'org0' }, known: { needs: {} } }),
    feed: async () => ({ posts: [] }),
    ingest: async () => {},
    action: async (type, params, key) => {
      actions.push({ type, params, key });
      return { id: 'proposal-1' };
    },
  };
  const fetcher = async (url, options) => {
    requests.push(JSON.parse(options.body));
    assert.ok(url.startsWith('https://generativelanguage.googleapis.com/'));
    round++;
    return {
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              role: 'model',
              parts:
                round === 1
                  ? [
                      {
                        functionCall: {
                          name: 'use_response_tool',
                          args: { type: 'dispatch', paramsJson: '{}', idempotencyKey: 'bad' },
                        },
                      },
                      {
                        functionCall: {
                          name: 'use_response_tool',
                          args: {
                            type: 'propose',
                            paramsJson: '{"title":"Conditional water response"}',
                            idempotencyKey: 'good',
                          },
                        },
                      },
                    ]
                  : [{ text: 'A responsible person must approve the proposal.' }],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
      }),
    };
  };
  const result = await new GeminiController({
    apiKey: 'test-only-secret',
    client,
    fetcher,
    onLatency: async (l) => latencies.push(l),
  }).run();
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, 'propose');
  assert.equal(result.usage.calls, 2);
  assert.equal(latencies.length, 2);
  assert.ok(!JSON.stringify(result).includes('test-only-secret'));
  assert.ok(requests[1].contents.some((c) => c.parts.some((p) => p.functionResponse)));
  assert.equal(result.status, 'proposal_only');
});
test('missing model credentials fail clearly rather than silently using a scripted model', () =>
  assert.throws(() => new GeminiController({ apiKey: '' }), /not configured/));
