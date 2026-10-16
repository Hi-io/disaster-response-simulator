// Shared, dependency-free rendering for the crawler-readable page and its live view.
// This module receives public posts only. It cannot classify a report as true/false.
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const FEED_LIMIT = 30;
export const icon = (name, size = 20) => {
  const paths = {
    home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',
    search: '<circle cx="10.5" cy="10.5" r="7.5"/><path d="m16 16 5 5"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18"/>',
    comment: '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2v-10A9.5 9.5 0 0 1 21 11.5Z"/>',
    repeat: '<path d="m17 2 4 4-4 4M3 11V8a2 2 0 0 1 2-2h16M7 22l-4-4 4-4M21 13v3a2 2 0 0 1-2 2H3"/>',
    heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
    share: '<path d="M12 16V3m-5 5 5-5 5 5M5 13v7h14v-7"/>',
    pin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
    play: '<path d="m9 5 11 7-11 7Z"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1"/><path d="m3 17 5-5 4 4 3-3 6 6"/>',
    audio: '<path d="M4 10v4m4-7v10m4-14v18m4-15v12m4-8v4"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.globe}</svg>`;
};
export function initials(name) {
  return String(name ?? 'Community').trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join('').toUpperCase();
}
export function avatarTone(id) {
  let hash = 0;
  for (const char of String(id ?? '')) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 8;
}
export const simTime = (ms = 0) => `${Math.floor(ms / 3600000)}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
const stamp = (ms) => new Date(Date.UTC(2026, 0, 1) + Math.max(0, ms ?? 0)).toISOString();
export function renderMedia(media) {
  const visual = ['video', 'photo', 'image'].includes(media.kind);
  return `<figure class="post-media ${visual ? 'visual-media' : 'audio-media'}" data-media-kind="${esc(media.kind)}" aria-label="${esc(media.kind)}: ${esc(media.description)}">${visual ? `<div class="media-scene" aria-hidden="true"><span class="scene-ground"></span><span class="scene-building one"></span><span class="scene-building two"></span><span class="scene-building three"></span><span class="scene-road"></span>${media.kind === 'video' ? `<span class="media-play">${icon('play', 24)}</span>` : `<span class="media-type">${icon('image', 16)} Image</span>`}<span class="media-duration">${media.duration ? `0:${String(media.duration).padStart(2, '0')}` : 'Photo'}</span></div>` : `<div class="audio-wave">${icon('play', 24)}<span>${Array.from({ length: 34 }, (_, i) => `<i style="--height:${20 + ((i * 17 + 11) % 66)}%"></i>`).join('')}</span><small>${media.duration ? `0:${String(media.duration).padStart(2, '0')}` : 'Audio'}</small></div>`}<figcaption>${esc(media.description)}<span class="synthetic-label">Simulated media</span></figcaption></figure>`;
}
export function renderPost(p) {
  const permalink = `/posts/${encodeURIComponent(p.id)}`;
  return `<article class="social-post" data-post-id="${esc(p.id)}" data-version="${esc(p.version)}">${p.repostOf ? `<div class="repost-label">${icon('repeat', 14)} Shared a post</div>` : ''}<div class="post-row"><a class="avatar tone-${avatarTone(p.authorId)}" href="/users/${encodeURIComponent(p.authorId)}" aria-label="${esc(p.authorName)}">${esc(initials(p.authorName))}</a><div class="post-content"><header class="post-author"><a href="/users/${encodeURIComponent(p.authorId)}" class="display-name">${esc(p.authorName)}</a><span class="handle">@${esc(String(p.authorName ?? 'community').toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, ''))}</span><span aria-hidden="true">·</span><a href="${permalink}" class="post-time"><time datetime="${stamp(p.publishedAt)}" title="Simulation time">${simTime(p.publishedAt)}</time></a><span class="post-more" aria-hidden="true">${icon('more', 18)}</span></header><p class="post-text">${esc(p.text)}</p>${(p.attachments ?? []).map(renderMedia).join('')}${(p.references ?? []).length ? `<div class="post-references">${p.references.map((id) => `<a href="/posts/${encodeURIComponent(id)}">${icon('repeat', 13)} Referenced post</a>`).join('')}</div>` : ''}${p.location ? `<div class="post-location">${icon('pin', 13)} ${esc(p.locationName ?? p.location)}</div>` : ''}<footer class="post-actions"><span>${icon('comment', 17)}<span class="sr-only">Replies unavailable in this simulated source</span></span><span>${icon('repeat', 17)}</span><span>${icon('heart', 17)} ${esc(p.likes ?? 0)}</span><a href="${permalink}" aria-label="Open post">${icon('share', 17)}</a></footer></div></div></article>`;
}

// A snapshot replaces pending work. There is no per-post animation queue, and
// skipped historical rows remain available through the paginated source APIs.
export function reconcileSnapshot(previous, incoming, limit = FEED_LIMIT) {
  const bound = Math.max(1, Math.min(FEED_LIMIT, Number(limit) || FEED_LIMIT));
  const unique = new Map();
  for (const post of incoming.posts ?? []) if (post?.id && !unique.has(post.id)) unique.set(post.id, post);
  const posts = [...unique.values()].slice(0, bound);
  const reset = !!previous && (previous.runId !== incoming.runId || incoming.now < previous.now);
  const existing = new Map((reset ? [] : previous?.posts ?? []).map((p) => [p.id, p]));
  return {
    ...incoming, posts, reset,
    added: posts.filter((p) => !existing.has(p.id)).map((p) => p.id),
    updated: posts.filter((p) => existing.has(p.id) && existing.get(p.id).version !== p.version).map((p) => p.id),
    omitted: Math.max(0, (incoming.total ?? posts.length) - posts.length),
  };
}

export function sourceHTML(title, posts, next = null, options = {}) {
  const data = { runId: options.runId ?? '', now: options.now ?? 0, total: options.total ?? posts.length, playing: options.playing ?? false, rate: options.rate ?? 1, posts, query: options.query ?? {}, live: options.live ?? false };
  const nav = (href, glyph, label, active) => `<a href="${href}" class="nav-item ${active ? 'active' : ''}">${icon(glyph, 25)}<span>${label}</span></a>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>${esc(title)} · Signal</title><link rel="stylesheet" href="/assets/social.css"></head><body><div class="social-shell"><aside class="left-rail"><a href="/feed" class="brand" aria-label="Signal home"><span class="brand-symbol">${icon('globe', 30)}</span><strong>Signal</strong></a><nav aria-label="Main navigation">${nav('/feed', 'home', 'Home', !options.query?.q)}${nav('/search', 'search', 'Explore', !!options.query?.q)}${nav('/public', 'bell', 'Relief updates', title === 'Relief updates')}</nav><div class="rail-note"><span class="live-dot"></span> A simulated public network<p>Real-time reports from the disaster-response world.</p></div><footer class="rail-footer">Signal · Simulation environment</footer></aside><main class="timeline"><div class="timeline-header"><h1>${esc(title)}</h1><div class="live-status" id="live-status"><span class="live-dot ${data.playing ? '' : 'paused'}"></span><span>${data.playing ? 'Live' : 'Simulation paused'}</span></div></div><div class="timeline-tabs"><span class="selected">Latest</span><span class="timeline-clock" id="timeline-clock">World time ${simTime(data.now)}</span></div><div class="composer"><div class="avatar tone-3">${icon('globe', 24)}</div><div><p>What’s happening in the region?</p><span>Community reports, local updates and voices from the ground.</span></div></div><div id="timeline-notice" class="timeline-notice" role="status" aria-live="polite"></div><div id="timeline-posts">${posts.map(renderPost).join('') || '<div class="timeline-empty">No public reports yet.<span>New posts appear here as the simulation advances.</span></div>'}</div><div class="older-posts" id="older-posts">${next !== null ? `<a rel="next" href="/feed?cursor=${next}">View older posts ${icon('chevron', 16)}</a>` : ''}</div></main><aside class="right-rail"><form action="/search" class="search-form" role="search">${icon('search', 19)}<input name="q" value="${esc(options.query?.q ?? '')}" placeholder="Search Signal" aria-label="Search reports"><button type="submit" class="sr-only">Search</button></form><section class="context-card"><span class="context-eyebrow">THE CONVERSATION</span><h2>From across<br>the region.</h2><p>Follow updates shared by residents, local teams and news desks.</p><a href="/feed">#CommunityResponse</a><a href="/public">#ReliefUpdates</a></section><section class="simulation-note"><h2>About this source</h2><p>People, posts and media are fictional. Reports can be incomplete, outdated or inaccurate.</p><p>The timeline follows the simulator’s clock.</p></section></aside></div><script type="application/json" id="timeline-data">${JSON.stringify(data).replaceAll('<', '\\u003c')}</script><script type="module" src="/assets/social-feed.mjs"></script></body></html>`;
}
