// Public presentation statistic. This never schedules work, acknowledges input,
// or changes the physical simulation. Removed public posts still happened;
// private messages, edits and re-indexing are not new publications.
export const POSTING_WINDOW_MS = 30 * 60000;
const caches = new WeakMap();
const upperBound = (rows, value) => {
  let low = 0,
    high = rows.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (rows[mid] <= value) low = mid + 1;
    else high = mid;
  }
  return low;
};

export function publicPostingRate(world, windowMs = POSTING_WINDOW_MS) {
  if (!Number.isSafeInteger(windowMs) || windowMs <= 0)
    throw new TypeError('A positive posting window is required');
  const rows = world.state.posts,
    now = world.now;
  const fromMs = Math.max(0, now - windowMs),
    elapsedMs = Math.min(now, windowMs);
  let cache = caches.get(rows);
  if (!cache || cache.now > now || cache.index > rows.length || cache.windowMs !== windowMs) {
    cache = { now, index: 0, pending: new Map(), times: [], counter: -1, windowMs };
    caches.set(rows, cache);
  }
  let posts;
  if (rows.db?.prepare && typeof rows.flush === 'function') {
    // Compact archives already index publication time. Count the small time
    // range without reading JSON bodies or repeatedly scanning the event log.
    const counter = world.state.statistics.publicPostsPublished;
    if (cache.counter !== counter) {
      rows.flush();
      cache.counter = counter;
    }
    cache.statement ??= rows.db.prepare(
      'SELECT COUNT(*) AS count FROM records WHERE published>=? AND published<=? AND audience=?',
    );
    posts = cache.statement.get(fromMs === 0 ? 0 : fromMs + 1, now, '"public"').count;
  } else {
    for (; cache.index < rows.length; cache.index++) {
      const post = rows[cache.index];
      // Audience is fixed at creation. Private messages never need publication
      // tracking, including those whose network connection never recovers.
      if (post.private?.audience === 'public') cache.pending.set(cache.index, post);
    }
    for (const [index, post] of cache.pending) {
      if (post.public?.publishedAt == null || post.public.publishedAt > now) continue;
      if (post.private?.audience === 'public' && post.public.publishedAt <= now) {
        if (post.public.publishedAt < (cache.times.at(-1) ?? -1)) cache.unsorted = true;
        cache.times.push(post.public.publishedAt);
      }
      cache.pending.delete(index);
    }
    if (cache.unsorted) {
      cache.times.sort((a, b) => a - b);
      cache.unsorted = false;
    }
    const start = fromMs === 0 ? 0 : upperBound(cache.times, fromMs);
    posts = upperBound(cache.times, now) - start;
    if (start > 1024 && start > cache.times.length / 2) cache.times = cache.times.slice(start);
  }
  cache.now = now;
  return {
    windowMs,
    fromMs,
    toMs: now,
    elapsedMs,
    posts,
    perMinute: elapsedMs > 0 ? (posts * 60000) / elapsedMs : null,
    complete: elapsedMs === windowMs,
  };
}
