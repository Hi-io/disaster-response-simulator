import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../engine/world.mjs';
import {
  SOCIAL_VARIANTS,
  renderWording,
  socialEnglishText,
  supplyText,
} from '../content/social.mjs';

const config = {
  seed: 'authentic-social-network',
  grid: 5,
  extentKm: 10,
  topology: 'grid',
  scenario: 'S23',
  hazard: 'none',
  policy: 'none',
  backgroundTraffic: 0,
  postsPerHour: 3600,
  falseRate: 0,
  packetLoss: 0,
  language: 'en',
  logMode: 'full',
};

test('102 contextual wordings are distinct, split-aware and correctly localized without changing quantities', () => {
  assert.equal(SOCIAL_VARIANTS.length, 102);
  assert.equal(SOCIAL_VARIANTS.filter((v) => v.kind === 'support').length, 36);
  assert.equal(new Set(SOCIAL_VARIANTS.map((v) => v.en)).size, 102);
  assert.equal(new Set(SOCIAL_VARIANTS.map((v) => v.es)).size, 102);
  for (const kind of new Set(SOCIAL_VARIANTS.map((v) => v.kind)))
    for (const split of ['development', 'validation', 'heldout'])
      assert.ok(SOCIAL_VARIANTS.some((v) => v.kind === kind && v.split === split));
  for (const variant of SOCIAL_VARIANTS) {
    const en = renderWording(variant.en, {
      place: 'East Ridge school',
      supply: '120 litres of drinking water',
    });
    const es = renderWording(variant.es, {
      place: 'East Ridge school',
      supply: '120 litros de agua potable',
    });
    assert.equal(socialEnglishText(es), en);
    assert.ok(!en.includes('{'));
    if (variant.kind === 'request') assert.match(en, /120 litres of drinking water/);
  }
  assert.equal(
    supplyText({ type: 'food', unit: 'kcal' }, 600),
    '600 kcal of food',
    'custom units are never silently converted into meal portions',
  );
});

test('ambient posts use diverse wording and stable identities and retain exact seeded continuation', () => {
  const a = new World(config),
    b = new World(config);
  a.advance(600000);
  b.advance(600000);
  assert.equal(a.stateHash(), b.stateHash());
  const resumed = new World(config, a.checkpoint());
  a.advance(900000);
  resumed.advance(900000);
  assert.equal(a.stateHash(), resumed.stateHash());
  const support = a.state.posts.filter((p) => p.private.wording?.startsWith('support-'));
  assert.ok(support.length > 100);
  assert.ok(
    new Set(support.map((p) => p.private.wording)).size >= 20,
    'the generator must use the bank rather than override it with a fixed sentence',
  );
  assert.ok(
    !support.some((p) => p.public.text.startsWith('Thinking of teams and families affected near')),
  );
  const authors = new Map();
  for (const p of a.state.posts) {
    if (authors.has(p.public.authorId))
      assert.equal(p.public.authorName, authors.get(p.public.authorId));
    authors.set(p.public.authorId, p.public.authorName);
    assert.ok(!p.public.authorName.startsWith('Resident '));
  }
  assert.deepEqual(a.invariants(), []);
  assert.ok(
    !JSON.stringify(a.publicFeed({ limit: 100 })).includes('"wording":'),
    'private content classifications must not reach a source consumer',
  );
});

test('personal solidarity is social content and news has a publisher without a duplicate fake attachment', () => {
  const w = new World(config);
  w.advance(300000);
  const support = w.state.posts.filter((p) => p.private.wording?.startsWith('support-'));
  assert.ok(support.length > 10);
  assert.ok(support.every((p) => p.public.format !== 'news'));
  for (const p of support)
    for (const media of p.public.attachments) {
      assert.notEqual(media.description, p.public.text);
      assert.match(
        media.description,
        /personal|solidarity|thank-you|community|spoken|voice|support/i,
      );
    }
  const news = w.generateSignal('P12', {
    building: w.state.map.shelterId,
    causeEvent: 'test-news',
    text: 'A visible damage report pending assessment.',
    type: 'news',
  });
  assert.ok(/Desk|Bulletin|Update|Wire|News|Report/.test(news.public.authorName));
  assert.deepEqual(news.public.attachments, []);
});

test('an intentional repost retains source content and media while exposing its public lineage', () => {
  const w = new World({ ...config, postsPerHour: 0 });
  const original = w.generateSignal('P25', {
    causeEvent: 'original-photo',
    text: 'Sending encouragement from afar.',
    type: 'photo',
    truthCategory: 'non_operational',
  });
  w.advance(20000);
  w.schedule(w.now, 'repost', { id: original.public.id }, 2, 'test-repost');
  w.advance(40000);
  const repost = w.state.posts.find((p) => p.public.repostOf === original.public.id);
  assert.ok(repost);
  assert.equal(repost.public.text, original.public.text);
  assert.equal(repost.public.format, original.public.format);
  assert.equal(
    repost.public.attachments[0].description,
    original.public.attachments[0].description,
  );
  assert.notEqual(repost.public.authorId, original.public.authorId);
  assert.deepEqual(repost.public.references, [original.public.id]);
  assert.equal(repost.private.original, original.private.original);
  assert.equal(repost.private.truthCategory, 'non_operational');
});

test('misleading ambient variants contradict real unmet demand or building damage, not invented relief actions', () => {
  const w = new World({ ...config, grid: 3, postsPerHour: 7200, falseRate: 1 });
  for (const b of w.state.map.buildings.filter((b) => b.id !== w.state.map.shelterId).slice(0, 3))
    b.damage = 0.3;
  w.advance(300000);
  const kinds = new Set();
  for (const p of w.state.posts.filter((p) => p.private.wording)) {
    const kind = p.private.wording.split('-')[0];
    kinds.add(kind);
    assert.equal(p.private.false, true);
    if (kind === 'complete') {
      const need = w.need(p.private.need);
      assert.ok(need && need.served < need.quantity);
    } else if (kind === 'intact') assert.ok(w.building(p.private.actualLocation).damage > 0);
    else if (kind === 'collapse') assert.equal(w.building(p.private.actualLocation).damage, 0);
    else assert.fail(`Unexpected false-content kind: ${kind}`);
  }
  assert.deepEqual([...kinds].sort(), ['collapse', 'complete', 'intact']);
  assert.equal(
    w.state.operations.length,
    0,
    'a claim that aid arrived must never create a physical delivery',
  );
  assert.deepEqual(w.invariants(), []);
});
