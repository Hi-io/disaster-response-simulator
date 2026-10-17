// Presentation-only calculations. All locations and vehicle samples come from
// the spectator projection; this module cannot advance or mutate the world.
export function spectatorFraming({ spanX, spanZ, width, height, mode = 'cover' }) {
  const aspect = Math.max(.25, width / Math.max(1, height));
  const extent = Math.max(spanX, spanZ, 1);
  const projectedWidth = Math.max(1, (spanX + spanZ) / Math.SQRT2);
  const projectedHeight = projectedWidth * 1.12 / Math.sqrt(2 + 1.12 ** 2);
  const halfHeight = mode === 'full'
    ? Math.max(projectedHeight / 2, projectedWidth / (2 * aspect)) * 1.1
    : Math.min(projectedHeight / 2, projectedWidth / (2 * aspect)) * .86;
  return { extent, left: -halfHeight * aspect, right: halfHeight * aspect,
    top: halfHeight, bottom: -halfHeight };
}

export function screenWorldScale({ top, bottom, zoom, height }) {
  return (top - bottom) / Math.max(.001, zoom) / Math.max(1, height);
}

export function vehicleMarkerPixels(vehicle, { selected = null, following = null } = {}) {
  if (vehicle.background) return 6;
  return following === vehicle.id ? 15 : selected === vehicle.owner ? 12 : 10;
}

export function authorInitials(name) {
  const words = String(name ?? '').trim().split(/\s+/u).filter(Boolean);
  return words.slice(0, 2).map(word => Array.from(word)[0]).join('').toUpperCase() || '?';
}

export class ReportActivity {
  constructor({ maxVisible = 6, maxNew = 3, lifetimeMs = 9000, seenLimit = 2048, maxAgeMs = 900000 } = {}) {
    Object.assign(this, { maxVisible, maxNew, lifetimeMs, seenLimit, maxAgeMs });
    this.reset();
  }
  reset() { this.episode = null; this.seen = new Map(); this.active = new Map(); }
  update({ episodeId, now, posts = [] }, wallTime, locations) {
    if (this.episode !== episodeId) { this.reset(); this.episode = episodeId; }
    this.entries(wallTime);
    let added = 0;
    const placed = new Set();
    const sorted = posts.slice().sort((a, b) => b.publishedAt - a.publishedAt);
    for (const post of sorted) {
      if (typeof post.id !== 'string' || this.seen.has(post.id)) continue;
      // Even overflow is marked seen. A fast stream replaces presentation
      // targets rather than building a queue of animations to play later.
      this.seen.set(post.id, true);
      if (this.seen.size > this.seenLimit) this.seen.delete(this.seen.keys().next().value);
      const point = locations.get(post.location);
      if (added >= this.maxNew || !point || !Number.isFinite(point.x) || !Number.isFinite(point.z) ||
        !Number.isFinite(post.publishedAt) || post.publishedAt > now || now - post.publishedAt > this.maxAgeMs) continue;
      const place = `${point.x}:${point.z}`;
      if (placed.has(place)) continue;
      placed.add(place);
      // Reports at the same place replace their earlier avatar, without
      // inventing jittered locations or covering the site with stacked faces.
      for (const [id, value] of this.active)
        if (value.point.x === point.x && value.point.z === point.z) this.active.delete(id);
      this.active.set(post.id, { id: post.id, record: post, point: { x: point.x, z: point.z },
        startedAt: wallTime, expiresAt: wallTime + this.lifetimeMs });
      while (this.active.size > this.maxVisible) this.active.delete(this.active.keys().next().value);
      added++;
    }
    return this.entries(wallTime);
  }
  entries(wallTime) {
    for (const [id, entry] of this.active) if (entry.expiresAt <= wallTime) this.active.delete(id);
    return [...this.active.values()];
  }
}
