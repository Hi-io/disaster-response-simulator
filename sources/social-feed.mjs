import {
  FEED_LIMIT,
  reconcileSnapshot,
  renderPost,
  simTime,
  postingRateView,
  feedMotionDuration,
  emptyFeed,
  olderPostsURL,
  esc,
} from '/assets/social-view.mjs';

const container = document.querySelector('#timeline-posts');
const initial = JSON.parse(document.querySelector('#timeline-data').textContent);
let snapshot = initial;
let stopped = false;
let timer;
let polling = false;
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
let lastMotionAt = performance.now();

function reconcile(next) {
  const before = new Map(
    [...container.children]
      .filter((node) => node.dataset.postId)
      .map((node) => [node.dataset.postId, node.getBoundingClientRect().top]),
  );
  const focused = document.activeElement?.closest('[data-post-id]')?.dataset.postId;
  const pace = postingRateView(next.postingRate);
  const rateNode = document.querySelector('#posting-rate');
  const sampleNode = document.querySelector('#posting-rate-sample');
  if (rateNode && sampleNode) {
    rateNode.textContent = pace.value;
    sampleNode.textContent = pace.caption;
    rateNode.title =
      'Public posts per simulated minute, averaged over the last 30 simulated minutes. Edits and private messages are excluded. Pausing preserves this measured average.';
  }
  const result = reconcileSnapshot(snapshot, next);
  const changed = result.added.length || result.updated.length;
  const motionAt = performance.now();
  const duration = feedMotionDuration(motionAt - lastMotionAt);
  if (changed) lastMotionAt = motionAt;
  const nodes = new Map(
    [...container.children]
      .filter((node) => node.dataset.postId)
      .map((node) => [node.dataset.postId, node]),
  );
  if (!result.posts.length) container.innerHTML = emptyFeed(initial.query);
  else {
    container.querySelector('.timeline-empty')?.remove();
    for (let i = 0; i < result.posts.length; i++) {
      const post = result.posts[i];
      let node = nodes.get(post.id);
      if (!node || node.dataset.version !== String(post.version)) {
        const template = document.createElement('template');
        template.innerHTML = renderPost(post);
        const replacement = template.content.firstElementChild;
        if (node) node.replaceWith(replacement);
        node = replacement;
      }
      if (container.children[i] !== node)
        container.insertBefore(node, container.children[i] ?? null);
      node.dataset.current = 'true';
    }
    const ids = new Set(result.posts.map((post) => post.id));
    for (const node of [...container.children]) if (!ids.has(node.dataset.postId)) node.remove();
    // One FLIP per snapshot, not one queued animation per arriving post. A new
    // snapshot cancels unfinished animations and jumps directly to current data.
    for (const node of [...container.children]) {
      node.getAnimations().forEach((animation) => animation.cancel());
      if (reduced.matches || document.hidden || result.reset) continue;
      const top = node.getBoundingClientRect().top;
      if (top > innerHeight + 300 || top + node.offsetHeight < -300) continue;
      const from = before.get(node.dataset.postId);
      if (from !== undefined && Math.abs(from - top) > 1)
        node.animate(
          [
            { transform: `translateY(${Math.max(-450, Math.min(450, from - top))}px)` },
            { transform: 'translateY(0)' },
          ],
          { duration, easing: 'cubic-bezier(.2,.8,.2,1)' },
        );
      else if (result.added.includes(node.dataset.postId))
        node.animate(
          [
            { opacity: 0, transform: 'translateY(-14px)' },
            { opacity: 1, transform: 'translateY(0)' },
          ],
          { duration: Math.min(360, duration), easing: 'ease-out' },
        );
    }
  }
  const status = document.querySelector('#live-status');
  status.innerHTML = `<span class="live-dot ${result.playing ? '' : 'paused'}"></span><span>${result.playing ? 'Live' : 'Simulation paused'}</span>`;
  document.querySelector('#timeline-clock').textContent = `World time ${simTime(result.now)}`;
  document.querySelector('#timeline-notice').textContent = result.reset
    ? 'A new simulation has started. The timeline is up to date.'
    : '';
  const older = document.querySelector('#older-posts');
  older.innerHTML =
    result.omitted > 0
      ? `<a rel="next" href="${esc(olderPostsURL(initial.query, FEED_LIMIT, FEED_LIMIT))}">View older posts · ${result.omitted.toLocaleString('en')} more</a>`
      : '';
  if (focused && !container.querySelector(`[data-post-id="${CSS.escape(focused)}"]`))
    document.querySelector('.timeline-header').focus({ preventScroll: true });
  snapshot = result;
}

async function poll() {
  if (stopped || polling) return;
  polling = true;
  try {
    const query = new URLSearchParams({ ...initial.query, limit: FEED_LIMIT });
    const response = await fetch('/api/timeline?' + query, {
      cache: 'no-store',
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) throw new Error('Source unavailable');
    reconcile(await response.json());
  } catch {
    document.querySelector('#live-status').innerHTML =
      '<span class="live-dot paused"></span><span>Reconnecting…</span>';
  } finally {
    polling = false;
    // No overlapping fetches and no unbounded queue when generation is faster
    // than rendering. Background tabs use a slower observation cadence.
    if (!stopped) timer = setTimeout(poll, document.hidden ? 4000 : 900);
  }
}
if (initial.live) timer = setTimeout(poll, 500);
addEventListener('pagehide', () => {
  stopped = true;
  clearTimeout(timer);
});

document.addEventListener('visibilitychange', () => {
  container
    .querySelectorAll('[data-post-id]')
    .forEach((node) => node.getAnimations().forEach((animation) => animation.cancel()));
  if (!document.hidden && initial.live && !stopped) {
    clearTimeout(timer);
    timer = setTimeout(poll, 0);
  }
});

addEventListener('pageshow', (event) => {
  if (event.persisted && initial.live) {
    stopped = false;
    clearTimeout(timer);
    timer = setTimeout(poll, 0);
  }
});
