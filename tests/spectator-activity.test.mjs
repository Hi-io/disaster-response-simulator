import test from 'node:test';
import assert from 'node:assert/strict';
import { ReportActivity, authorInitials, screenWorldScale, spectatorFraming, vehicleMarkerPixels } from '../viewer/spectator-activity.mjs';

const locations = new Map(Array.from({ length: 20 }, (_, i) => [`site-${i}`, { x: i * 100, z: i * 150 }]));
const post = (id, site, publishedAt = 1000) => ({ id, authorName: 'Mika Sato', location: `site-${site}`, publishedAt });
const snapshot = posts => ({ episodeId: 'physical-source-1', now: 1000, posts });

test('the initial map fills wide and tall viewports while Full map retains the complete geographic bounds', () => {
  const projectedWidth = 20000 / Math.SQRT2;
  const projectedHeight = projectedWidth * 1.12 / Math.sqrt(2 + 1.12 ** 2);
  for (const [width, height] of [[1600, 900], [1400, 650], [400, 750]]) {
    const cover = spectatorFraming({ spanX: 10000, spanZ: 10000, width, height });
    const full = spectatorFraming({ spanX: 10000, spanZ: 10000, width, height, mode: 'full' });
    assert.ok(cover.top < full.top);
    assert.ok(cover.right - cover.left <= projectedWidth);
    assert.ok(cover.top - cover.bottom <= projectedHeight);
    assert.ok(full.right - full.left >= projectedWidth);
    assert.ok(full.top - full.bottom >= projectedHeight);
    assert.equal(cover.right / cover.top, width / height);
  }
});

test('vehicle points keep their pixel size while zooming and preserve the difference between traffic and aid', () => {
  const aid = { id: 'actual-truck', owner: 'team-1' }, traffic = { id: 'actual-car', background: true };
  const normal = vehicleMarkerPixels(aid), ambient = vehicleMarkerPixels(traffic);
  assert.ok(normal > ambient);
  assert.ok(vehicleMarkerPixels(aid, { selected: 'team-1' }) > normal);
  assert.ok(vehicleMarkerPixels(aid, { following: aid.id }) > normal);
  for (const zoom of [.75, 1, 3, 8]) {
    const scale = screenWorldScale({ top: 4000, bottom: -4000, zoom, height: 900 });
    const projectedPixels = (normal * scale) / (8000 / zoom) * 900;
    assert.ok(Math.abs(projectedPixels - normal) < 1e-9);
  }
});

test('real located public posts produce bounded avatars; invalid, future and unlocated reports never invent positions', () => {
  const activity = new ReportActivity();
  const posts = [post('real', 2), post('future', 3, 1001), post('unlocated', 99), post('old', 1, -1000000)];
  const output = activity.update(snapshot(posts), 100, locations);
  assert.equal(output.length, 1); assert.equal(output[0].id, 'real');
  assert.deepEqual(output[0].point, locations.get('site-2'));
  assert.equal(output[0].record, posts[0]);
  assert.equal(authorInitials('Mika Sato'), 'MS'); assert.equal(authorInitials(''), '?');
  assert.equal(activity.update(snapshot(posts), 200, locations).length, 1);
  assert.equal(activity.entries(9200).length, 0);
  assert.equal(activity.update(snapshot(posts), 9300, locations).length, 0, 'expired repeated frames never replay a report');
});

test('fast report bursts have no animation backlog, preserve the newest report at each location and reset per source', () => {
  const activity = new ReportActivity({ maxVisible: 4, maxNew: 3, seenLimit: 16 });
  const posts = Array.from({ length: 12 }, (_, i) => post(`burst-${i}`, i, 1000 - i));
  assert.equal(activity.update(snapshot(posts), 0, locations).length, 3);
  assert.equal(activity.seen.size, 12);
  assert.equal(activity.update(snapshot(posts), 20000, locations).length, 0, 'overflow was discarded instead of queued');
  const sameSite = [post('newer', 2, 1000), post('older', 2, 999)];
  const visible = activity.update(snapshot(sameSite), 21000, locations);
  assert.equal(visible.length, 1); assert.equal(visible[0].id, 'newer');
  activity.update(snapshot(Array.from({ length: 12 }, (_, i) => post(`more-${i}`, i))), 22000, locations);
  assert.ok(activity.seen.size <= 16); assert.ok(activity.entries(22000).length <= 4);
  const reset = activity.update({ ...snapshot([posts[0]]), episodeId: 'new-real-source' }, 23000, locations);
  assert.equal(reset.length, 1); assert.equal(reset[0].id, posts[0].id);
});
