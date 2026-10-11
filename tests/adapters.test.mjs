import test from 'node:test';
import assert from 'node:assert/strict';
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
