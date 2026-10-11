import { NotificationQueue, formatTime } from './presentation.js';
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
    this.emptyText = 'No reports yet.';
  }
  reset(items, emptyText = this.emptyText) {
    this.queue.reset(items);
    this.cards = [];
    this.nextAt = 0;
    this.emptyText = emptyText;
    this.element.replaceChildren();
    if (!items.length) this.element.innerHTML = `<p class="empty">${escape(emptyText)}</p>`;
    for (const item of items.slice(-4)) this.add(item, false);
  }
  accept(items) {
    this.queue.accept(items);
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
    const width = card.getBoundingClientRect().width || 254;
    const keep = Math.min(8, Math.max(2, Math.ceil(this.element.clientWidth / (width + 8)) + 1));
    while (this.cards.length > keep) this.cards.pop().remove();
    const place = () =>
      this.cards.forEach((el, i) => {
        el.style.opacity = String(Math.max(0.35, 1 - i * 0.08));
        el.style.transform = `translate(${i * (width + 8)}px, ${Math.min(2, i)}px) scale(${1 - Math.min(3, i) * 0.012})`;
      });
    if (animate) requestAnimationFrame(place);
    else place();
  }
  tick(now, frozen = false, reduced = false) {
    if (frozen || now < this.nextAt || !this.queue.pending.length) return;
    const item = this.queue.shift();
    this.add(item, !reduced);
    this.nextAt =
      now + (this.queue.pending.length > 12 ? 100 : this.queue.pending.length > 4 ? 150 : 280);
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
  }
  reset(items = []) {
    this.queue.reset(items);
    this.cards = [];
    this.element.replaceChildren();
  }
  accept(items) {
    this.queue.accept(items);
  }
  tick(now, enabled = true, reduced = false) {
    if (!enabled) {
      for (const c of this.cards) c.element.remove();
      this.cards = [];
      this.queue.pending = [];
      return;
    }
    if (now >= this.nextAt && this.queue.pending.length) {
      const item = this.queue.shift(),
        point = this.locate(item);
      this.nextAt = now + (this.queue.pending.length > 10 ? 110 : 250);
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
        this.cards.push({ element: el, point, born: now, slot: this.cards.length % 4 });
      }
    }
    // Brief notifications at high speed; no animated backlog can grow without bound.
    const lifespan = reduced ? 2200 : this.queue.pending.length > 8 ? 1400 : 2400;
    while (this.cards.length > 9) this.cards.shift().element.remove();
    this.cards = this.cards.filter((c) => {
      const age = now - c.born;
      if (age > lifespan) {
        c.element.remove();
        return false;
      }
      const p = this.project(c.point);
      c.element.hidden = !p.visible;
      c.element.style.left = `${p.x + (c.slot % 2 ? 20 : -20)}px`;
      c.element.style.top = `${p.y - (c.slot % 3) * 10 - (reduced ? 0 : Math.min(12, age / 150))}px`;
      c.element.style.opacity = String(Math.min(1, age / 140, (lifespan - age) / 350));
      return true;
    });
  }
}
