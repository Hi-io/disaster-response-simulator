import { NotificationQueue, formatTime } from './presentation.js';
import { feedTiming, packNotices } from './display.js';
const escape = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export const iconHTML = (name) =>
  `<i class="icon" style="--icon-url:url('/icons/${escape(name)}.svg')" aria-hidden="true"></i>`;
export function applyIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]'))
    el.style.setProperty('--icon-url', `url('/icons/${el.dataset.icon}.svg')`);
}
function content(item, small = false) {
  return `<span class="avatar">${iconHTML(item.icon)}</span><span class="cardContent">${small ? `<strong>${escape(item.title)}</strong>` : `<span class="cardMeta"><strong>${escape(item.title)}</strong><time>${formatTime(item.at ?? 0)}</time></span>`}<p>${escape(item.body)}</p></span>${!small && item.media ? `<span class="mediaHint">${iconHTML(item.media === 'audio' ? 'mic' : item.media === 'video' ? 'play' : 'image')}${escape(item.media === 'audio' ? 'Voice note' : item.media)}</span>` : ''}`;
}
export class FlowLane {
  constructor(element) {
    this.element = element;
    this.queue = new NotificationQueue({ capacity: 36 });
    this.cards = [];
    this.nextAt = 0;
    this.lastShownAt = 0;
    this.emptyText = 'No reports yet.';
    this.laneWidth = element.clientWidth || 1024;
    this.cardWidth = null;
    if (typeof ResizeObserver !== 'undefined')
      new ResizeObserver(([entry]) => {
        this.laneWidth = entry.contentRect.width;
        this.cardWidth = null;
      }).observe(element);
  }
  reset(items, emptyText = this.emptyText) {
    this.queue.reset(items);
    this.cards = [];
    this.nextAt = 0;
    this.lastShownAt = 0;
    this.emptyText = emptyText;
    this.element.replaceChildren();
    if (!items.length) this.element.innerHTML = `<p class="empty">${escape(emptyText)}</p>`;
    for (const item of items.slice(-4)) this.add(item, false);
  }
  accept(items) {
    this.queue.accept(items);
  }
  settle() {
    for (const card of this.cards) for (const animation of card.getAnimations()) animation.finish();
    if (!this.queue.pending.length) return;
    const pending = this.queue.pending.splice(0);
    this.queue.skipped += Math.max(0, pending.length - 4);
    const latest = pending.slice(-4);
    for (const item of latest) this.add(item, false);
    this.nextAt = 0;
  }
  add(item, animate = true) {
    this.element.querySelector('.empty')?.remove();
    const card = document.createElement('button');
    card.className = `feedCard ${item.tone}`;
    card.title = `${item.tag} · ${item.body}`;
    card.innerHTML = content(item);
    card.setAttribute('aria-label', `${item.title}. ${item.body}. ${item.tag}`);
    if (item.entity?.id) {
      card.dataset.id = item.entity.id;
      card.dataset.kind = item.entity.kind;
    }
    card.style.opacity = animate ? '0' : '1';
    card.style.transform = animate ? 'translateX(-280px)' : 'translateX(0)';
    this.element.append(card);
    this.cards.unshift(card);
    // Unmount everything outside the visible strip; history stays in the archive.
    // Card width is fixed by CSS. Measure once per resize, not once per arrival.
    const width = (this.cardWidth ??= card.getBoundingClientRect().width || 254);
    const keep = Math.min(8, Math.max(2, Math.ceil(this.laneWidth / (width + 8)) + 1));
    while (this.cards.length > keep) this.cards.pop().remove();
    const place = () =>
      this.cards.forEach((el, i) => {
        el.style.opacity = String(Math.max(0.35, 1 - i * 0.08));
        el.style.transform = `translate(${i * (width + 8)}px, ${Math.min(2, i)}px) scale(${1 - Math.min(3, i) * 0.012})`;
      });
    if (animate) requestAnimationFrame(place);
    else place();
  }
  tick(now, frozen = false, reduced = false, playing = true, rate = 1) {
    const timing = feedTiming(this.queue.pending.length);
    this.element.style.setProperty(
      '--flow-duration',
      `${playing && !reduced ? timing.transition : 0}ms`,
    );
    this.element.style.setProperty(
      '--flow-fade',
      `${playing && !reduced && rate < 1000 ? timing.fade : 0}ms`,
    );
    if (!playing && !frozen) {
      this.settle();
      return;
    }
    let dueAt = this.lastShownAt
      ? Math.max(now - 50, Math.min(this.nextAt, this.lastShownAt + timing.interval))
      : now;
    if (frozen || now < dueAt || !this.queue.pending.length) return;
    // Catch up a few arrivals after a slow frame without an unbounded DOM task.
    for (let count = 0; count < 4 && this.queue.pending.length && now >= dueAt; count++) {
      const item = this.queue.shift();
      this.add(item, !reduced);
      this.lastShownAt = dueAt;
      this.nextAt = dueAt + feedTiming(this.queue.pending.length).interval;
      dueAt = this.nextAt;
    }
  }
}
export class MapNotices {
  constructor(element, locate, project) {
    this.element = element;
    this.locate = locate;
    this.project = project;
    this.queue = new NotificationQueue({ capacity: 30 });
    this.cards = [];
    this.nextAt = 0;
    this.lastTick = 0;
    this.lastShownAt = 0;
    this.burstUntil = 0;
  }
  reset(items = []) {
    this.queue.reset(items);
    this.cards = [];
    this.nextAt = 0;
    this.lastShownAt = 0;
    this.burstUntil = 0;
    this.element.replaceChildren();
  }
  accept(items) {
    // Unlocated records still belong to the lanes/archive. They should not
    // consume an on-map animation slot and delay a report with a real location.
    this.queue.accept(items.filter((item) => this.locate(item)));
  }
  tick(now, enabled = true, reduced = false, playing = true, rate = 1) {
    if (!enabled) {
      for (const c of this.cards) c.element.remove();
      this.cards = [];
      this.queue.pending = [];
      return;
    }
    if (!playing) {
      this.queue.pending = [];
      for (const c of this.cards) c.exitAt ??= now + 220;
    }
    const backlog = this.queue.pending.length;
    const timing = feedTiming(backlog);
    if (backlog > 3) this.burstUntil = now + 900;
    const burst = now < this.burstUntil;
    const dueAt = Math.min(this.nextAt, this.lastShownAt + timing.interval);
    if (playing && now >= dueAt && backlog) {
      const item = this.queue.shift(),
        point = this.locate(item);
      this.lastShownAt = now;
      this.nextAt = now + timing.interval;
      if (point) {
        const el = document.createElement('button');
        el.className = `mapNotice ${item.tone}`;
        el.innerHTML = content(item, true) + '<span class="noticeStem"></span>';
        el.setAttribute('aria-label', `${item.title}. ${item.body}`);
        el.title = item.tag;
        if (item.entity?.id) {
          el.dataset.id = item.entity.id;
          el.dataset.kind = item.entity.kind;
        }
        this.element.append(el);
        const rect = el.getBoundingClientRect();
        this.cards.push({
          element: el,
          point,
          born: now,
          width: rect.width,
          height: rect.height,
          screen: null,
          instantEntry: burst || rate >= 1000,
          lifespan: reduced ? 2200 : burst ? 900 : 2400,
        });
      }
    }
    // Brief notifications at high speed; no animated backlog can grow without bound.
    while (this.cards.length > (burst ? 12 : 9)) this.cards.shift().element.remove();
    this.cards = this.cards.filter((c) => {
      const age = now - c.born;
      if (age > c.lifespan || now >= c.exitAt) {
        c.element.remove();
        return false;
      }
      return true;
    });
    const newestFirst = this.cards.slice().reverse();
    const layout = packNotices(
      newestFirst.map((c) => ({ ...this.project(c.point), width: c.width, height: c.height })),
      this.element.clientWidth,
      this.element.clientHeight,
    );
    const dt = Math.min(100, now - (this.lastTick || now - 16));
    const ease = reduced ? 1 : 1 - Math.exp(-dt / 45);
    this.lastTick = now;
    const movingLayout = packNotices(
      newestFirst.map((c, i) => {
        const p = layout[i];
        c.screen ??= { x: p.x, y: p.y + (reduced ? 0 : 8) };
        c.screen.x += (p.x - c.screen.x) * ease;
        c.screen.y += (p.y - c.screen.y) * ease;
        return {
          x: c.screen.x + c.width / 2,
          y: c.screen.y + c.height + 18,
          width: c.width,
          height: c.height,
          visible: p.visible,
        };
      }),
      this.element.clientWidth,
      this.element.clientHeight,
    );
    newestFirst.forEach((c, i) => {
      const p = movingLayout[i],
        anchor = this.project(c.point);
      if (!p.visible) {
        c.element.remove();
        c.culled = true;
        return;
      }
      // Keep the moving rectangles apart as well as their destinations. A new
      // card must push an older neighbour up immediately, even during a burst.
      c.screen = { x: p.x, y: p.y };
      c.element.style.transform = `translate(${c.screen.x}px, ${c.screen.y}px)`;
      c.element.style.zIndex = String(newestFirst.length - i);
      const age = now - c.born;
      c.element.style.opacity = String(
        Math.max(
          0,
          Math.min(
            1,
            c.instantEntry ? 1 : age / 140,
            (c.lifespan - age) / 250,
            c.exitAt ? (c.exitAt - now) / 220 : 1,
          ),
        ),
      );
      const stem = c.element.querySelector('.noticeStem');
      const dx = anchor.x - (c.screen.x + c.width / 2),
        dy = anchor.y - (c.screen.y + c.height);
      stem.style.height = `${Math.hypot(dx, dy)}px`;
      stem.style.transform = `rotate(${-Math.atan2(dx, dy)}rad)`;
    });
    this.cards = this.cards.filter((c) => !c.culled);
  }
}
