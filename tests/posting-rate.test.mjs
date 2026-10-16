import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../engine/world.mjs';
import { publicPostingRate, POSTING_WINDOW_MS } from '../sources/posting-rate.mjs';
import {
  postingRateView,
  sourceHTML,
  feedMotionDuration,
  emptyFeed,
} from '../sources/social-view.mjs';

const config = {
  grid: 3,
  extentKm: 2,
  topology: 'grid',
  hazard: 'none',
  policy: 'none',
  postsPerHour: 0,
  backgroundTraffic: 0,
};
for (const logMode of ['full', 'compact'])
  test(`rolling public rate counts the real 30-minute window in ${logMode} storage`, () => {
    const world = new World({ ...config, logMode });
    try {
      const publish = (at, audience = 'public') => {
        world.now = at;
        const row = world.generateSignal('P01', {
          text: 'Publication rate fixture',
          causeEvent: `rate-${at}-${audience}`,
          audience,
        });
        world.publishPost(row.public.id);
        return row;
      };
      publish(0);
      publish(60000);
      publish(60000, ['org0']);
      publish(900000);
      const last = publish(1800000);
      const rate = publicPostingRate(world);
      assert.equal(rate.posts, 4);
      assert.equal(rate.perMinute, 4 / 30);
      assert.equal(rate.complete, true);
      assert.equal(rate.windowMs, POSTING_WINDOW_MS);
      world.now = 1860000;
      assert.equal(
        publicPostingRate(world).posts,
        2,
        'the expired publication at the left boundary is excluded',
      );
      last.deleted = true;
      last.public.text = 'Corrected and removed';
      world.state.posts.persist?.(last);
      assert.equal(
        publicPostingRate(world).posts,
        2,
        'deletions and edits do not rewrite publication volume',
      );
      world.now = 1000;
      assert.equal(
        publicPostingRate(world).posts,
        1,
        'rewinding rebuilds the presentation statistic',
      );
      world.now = 1800000;
      assert.equal(publicPostingRate(world).posts, 4);
    } finally {
      world.close();
    }
  });

test('posting statistics are read-only and stable through a burst, a pause and an idle window', () => {
  const world = new World({ ...config, logMode: 'full' });
  try {
    for (let i = 0; i < 30; i++) {
      const p = world.generateSignal('P01', { text: `Public ${i}`, causeEvent: `rate-${i}` });
      world.publishPost(p.public.id);
    }
    world.now = 1800000;
    const before = world.checkpoint(),
      sample = publicPostingRate(world);
    assert.equal(sample.perMinute, 1);
    assert.deepEqual(
      publicPostingRate(world),
      sample,
      'a paused clock retains the measured rolling average',
    );
    assert.deepEqual(
      world.checkpoint(),
      before,
      'presentation does not change any physical record',
    );
    world.now = 1800001;
    assert.equal(publicPostingRate(world).posts, 0);
    assert.equal(publicPostingRate(world).perMinute, 0);
  } finally {
    world.close();
  }
});

test('array history is indexed once and a window change rebuilds its baseline', () => {
  let reads = 0;
  const source = Array.from({ length: 5000 }, (_, i) => ({
    public: { publishedAt: i * 1000 },
    private: { audience: 'public' },
  }));
  const posts = new Proxy(source, {
    get(target, key) {
      if (/^\d+$/.test(String(key))) reads++;
      return Reflect.get(target, key);
    },
  });
  const world = { now: 5000000, state: { posts, statistics: { publicPostsPublished: 5000 } } };
  assert.equal(publicPostingRate(world).posts, 1799);
  const first = reads;
  world.now += 500;
  publicPostingRate(world);
  assert.equal(reads, first, 'polling must not walk the full archive again');
  assert.equal(publicPostingRate(world, 600000).posts, 599);
  assert.equal(
    publicPostingRate(world).posts,
    1799,
    'returning to a larger window retains accurate history',
  );
});

test('ten thousand unpublished private messages never enter the rolling public pending cache', () => {
  let reads = 0,
    privatePublicationReads = 0;
  const source = Array.from({ length: 10000 }, () => ({
    private: { audience: ['org0'] },
    get public() {
      privatePublicationReads++;
      return { publishedAt: null };
    },
  }));
  const posts = new Proxy(source, {
    get(target, key) {
      if (/^\d+$/.test(String(key))) reads++;
      return Reflect.get(target, key);
    },
  });
  const world = { now: 60000, state: { posts, statistics: { publicPostsPublished: 0 } } };
  assert.equal(publicPostingRate(world).posts, 0);
  assert.equal(
    privatePublicationReads,
    0,
    'private publication metadata is irrelevant even while its connection stays offline',
  );
  assert.equal(reads, 10000);
  for (let i = 0; i < 20; i++) {
    world.now += 1000;
    assert.equal(publicPostingRate(world).posts, 0);
  }
  assert.equal(reads, 10000, 'subsequent polls must not revisit historical private rows');
  assert.equal(
    privatePublicationReads,
    0,
    'unpublished private records must not be rescanned as pending',
  );
  const publicPost = { private: { audience: 'public' }, public: { publishedAt: null } };
  source.push(publicPost);
  assert.equal(publicPostingRate(world).posts, 0);
  publicPost.public.publishedAt = world.now;
  assert.equal(
    publicPostingRate(world).posts,
    1,
    'an actually pending public post is still followed until publication',
  );
});

test('the social display labels real simulation minutes and does not fabricate startup history', () => {
  assert.equal(postingRateView({ elapsedMs: 15000, perMinute: 200 }).value, '\u2014');
  assert.match(
    postingRateView({ elapsedMs: 120000, perMinute: 3, complete: false }).caption,
    /2 simulated minutes.*warming up/,
  );
  const rate = { elapsedMs: 1800000, perMinute: 8.5, posts: 255, complete: true };
  assert.deepEqual(postingRateView(rate), {
    value: '8.5',
    caption: 'Across the last 30 simulated minutes',
  });
  const html = sourceHTML('Community signals', [], null, { postingRate: rate });
  assert.match(html, /id="posting-rate">8.5/);
  assert.match(html, /30-minute average/);
  assert.equal(postingRateView({ elapsedMs: 1800000, perMinute: Infinity }).value, '\u2014');
});

test('feed motion stays bounded when updates are late or arrive faster than animation', () => {
  assert.equal(feedMotionDuration(0), 260);
  assert.equal(feedMotionDuration(900), 738);
  assert.equal(feedMotionDuration(100000), 900);
  assert.equal(feedMotionDuration(NaN), 738);
  const html = sourceHTML('Search results', [], null, { query: { q: 'water' } });
  assert.match(html, /class="search-form timeline-search"/);
  assert.match(html, /<button type="submit" aria-label="Search">/);
  assert.match(html, /timeline-header" tabindex="-1"/);
});

test('empty search does not suggest the entire public network is empty', () => {
  assert.match(emptyFeed({ q: 'water' }), /No matching reports/);
  assert.match(emptyFeed(), /No public reports yet/);
  assert.match(
    sourceHTML('Search results', [], null, { query: { q: 'no-such-post' } }),
    /No matching reports/,
  );
});
