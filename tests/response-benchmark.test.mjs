import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../engine/world.mjs';
import { installResponseBenchmark } from '../generators/response-benchmark.mjs';

const config = {
  seed: 'response-information-gap-test',
  grid: 7,
  extentKm: 4,
  topology: 'grid',
  scenario: 'S23',
  hazard: 'none',
  policy: 'none',
  backgroundTraffic: 0,
  postsPerHour: 0,
  packetLoss: 0,
  networkLatencyMs: 0,
  sourceIndexMs: 0,
  authorshipMs: 0,
  observationRate: 1,
  healthReports: false,
  recurringNeeds: false,
  durationMs: 7200000,
  logMode: 'full',
};

test('public social need reports precede formal observations, without giving either arm ground truth', () => {
  const w = new World(config),
    cohort = installResponseBenchmark(w, { count: 12, noise: 48, explicitFraction: 0 });
  assert.equal(w.need('need-water-main').quantity, 0);
  assert.equal(cohort.gold.length, 12);
  assert.ok(cohort.gold.every((n) => w.need(n.needId).createdAt === 0));
  w.advance(120000);
  const publicFeed = { posts: [] };
  for (let cursor = 0; cursor !== null;) {
    const page = w.publicFeed({ limit: 100, cursor });
    publicFeed.posts.push(...page.posts);
    cursor = page.nextCursor;
  }
  assert.ok(publicFeed.posts.length >= 84);
  for (const org of w.state.map.organizations) {
    const actor = w.actorView(org.id);
    assert.equal(Object.values(actor.known.needs).filter((n) => n.quantity > 0).length, 0);
    assert.ok(!JSON.stringify(actor).includes('corpusHash'));
    assert.ok(!JSON.stringify(actor).includes('sourceKey'));
  }
  assert.ok(!JSON.stringify(publicFeed).includes('truthCategory'));
  assert.ok(!JSON.stringify(publicFeed).includes('benchmark-need'));
  assert.ok(!JSON.stringify(publicFeed).includes('needId'));
  for (const row of cohort.gold) {
    const post = publicFeed.posts.find((p) => p.id === row.sourceId);
    assert.ok(
      post,
      'the publicly indexed source is available without an evaluator-provided source id',
    );
    assert.equal(post.location, null);
    assert.ok(post.text.includes(row.building));
    const copies = publicFeed.posts.filter((p) => p.repostOf === row.sourceId);
    assert.ok(copies.length >= 2);
    assert.ok(copies.every((p) => p.references.includes(row.sourceId)));
    const declaredCopyIds = new Set(Array.from({length:cohort.config.reposts}, (_, j) =>
      w.publicId('post', row.sourceKey + '-repost-' + j + '-P17')));
    const declaredCopies = copies.filter(p => declaredCopyIds.has(p.id));
    assert.equal(declaredCopies.length, cohort.config.reposts);
    // The ordinary social engine can also create forwarded posts with added
    // metadata. Only this cohort's declared identical copies must match here.
    for (const copy of declaredCopies) {
      assert.equal(copy.location, post.location, 'An identical repost must not invent a geotag');
      assert.equal(copy.format, post.format);
      assert.equal(copy.text, post.text);
      // Each publication has scoped attachment IDs; content descriptors remain
      // identical. A different attachment ID is not a different witness.
      const content = (attachments) => attachments.map(({ id, ...descriptor }) => descriptor);
      assert.deepEqual(content(copy.attachments), content(post.attachments));
    }
  }
  w.advance(2100000);
  for (const org of w.state.map.organizations)
    assert.deepEqual(
      Object.values(w.actorView(org.id).known.needs)
        .filter((n) => n.quantity > 0)
        .map((n) => n.id)
        .sort(),
      cohort.gold.map((g) => g.needId).sort(),
    );
  assert.deepEqual(w.invariants(), []);
});

test('the same public building clarification can discover a hidden need before the formal channel', () => {
  const w = new World(config),
    cohort = installResponseBenchmark(w, { count: 3, noise: 0, reposts: 0 });
  w.advance(60000);
  const row = cohort.gold[0];
  assert.equal(w.actorView('org0').known.needs[row.needId], undefined);
  w.act(
    { id: 'reference-reader', org: 'org0', role: 'agent' },
    {
      type: 'verify',
      params: { target: 'building', id: row.building, method: 'clarification' },
      idempotencyKey: 'public-location-clarification',
    },
  );
  w.advance(300000);
  assert.equal(w.actorView('org0').known.needs[row.needId].quantity, row.quantity);
  assert.equal(w.actorView('org1').known.needs[row.needId], undefined);
  assert.deepEqual(w.invariants(), []);
});

test('seeded corpus and events replay exactly, including checkpoint continuation', () => {
  const a = new World(config),
    b = new World(config),
    first = installResponseBenchmark(a),
    second = installResponseBenchmark(b);
  assert.deepEqual(first, second);
  a.advance(45000);
  b.advance(45000);
  assert.equal(a.stateHash(), b.stateHash());
  // Register the extra declared evaluator cohort before validating its queued
  // event types, then restore the frozen world. No events are rerun.
  const resumed = new World(config);
  assert.deepEqual(installResponseBenchmark(resumed), first);
  resumed.restore(a.checkpoint());
  a.advance(2100000);
  b.advance(2100000);
  resumed.advance(2100000);
  assert.equal(a.stateHash(), b.stateHash());
  assert.equal(a.stateHash(), resumed.stateHash());
  const varied = new World({ ...config, seed: 'different-response-information-gap' });
  assert.notEqual(installResponseBenchmark(varied).manifest.corpusHash, first.manifest.corpusHash);
});

test('quiet communities stay in the physical denominator and receive the common formal fallback', () => {
  const w = new World(config),
    cohort = installResponseBenchmark(w, { count: 6, noise: 0, silentFraction: 1 });
  w.advance(120000);
  assert.equal(w.publicFeed({ limit: 100 }).posts.length, 0);
  assert.equal(w.state.needs.filter((n) => n.quantity > 0).length, 6);
  assert.ok(cohort.gold.every((n) => n.silent && n.sourceId === null));
  w.advance(2100000);
  assert.equal(
    Object.values(w.actorView('org0').known.needs).filter((n) => n.quantity > 0).length,
    6,
  );
});

test('benchmark rejects impossible sizes and invalid parameters before physical demand is mutated', () => {
  const w = new World(config),
    before = w.state.needs.length;
  assert.throws(() => installResponseBenchmark(w, { count: 2000 }), /distinct residential/);
  assert.equal(w.state.needs.length, before);
  assert.throws(() => installResponseBenchmark(w, { formalDelayMs: 7200000 }), /declared horizon/);
  assert.equal(w.state.needs.length, before);
  assert.throws(() => installResponseBenchmark(w, { secretLabels: true }), /Unknown response/);
  assert.throws(() => installResponseBenchmark(w, { silentFraction: 2 }), /fraction/);
  w.advance(1000);
  assert.throws(() => installResponseBenchmark(w), /before time advances/);
});
