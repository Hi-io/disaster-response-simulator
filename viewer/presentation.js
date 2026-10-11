// View models only. These descriptions never change the simulated world.
export const humanize = (text) =>
  String(text ?? '')
    .replaceAll('_', ' ')
    .replace(/^./, (s) => s.toUpperCase());
const number = (n) => new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(n ?? 0);
export const formatTime = (ms) =>
  [Math.floor(ms / 3600000), Math.floor(ms / 60000) % 60, Math.floor(ms / 1000) % 60]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
export function entityKind(id = '') {
  if (/^(v-|traffic-)/.test(id)) return 'vehicle';
  if (id.startsWith('need-')) return 'need';
  if (id.startsWith('operation-')) return 'operation';
  if (id.startsWith('org')) return 'organization';
  return 'building';
}
export function placeName(state, id) {
  const b = state.map.buildings.find((b) => b.id === id);
  if (b) return b.name ?? `${humanize(b.use === 'residential' ? 'community' : b.use)} ${b.id}`;
  const o = state.map.organizations.find((o) => o.id === id);
  return o?.name ?? id ?? 'Regional response';
}
const eventTypes = {
  world_initialized: ['World ready', 'map', 'neutral'],
  need_created: ['Help is needed', 'circle-alert', 'urgent'],
  need_changed: ['A request has changed', 'droplets', 'urgent'],
  service_delivered: ['Aid delivered', 'package', 'success'],
  signal_created: ['Someone is preparing a report', 'user-round', 'neutral'],
  post_published: ['A report reaches the network', 'message-circle', 'social'],
  post_updated: ['A report was updated', 'message-circle', 'social'],
  post_deleted: ['A report was removed', 'message-circle', 'neutral'],
  message_delivered: ['Information received', 'radio', 'social'],
  message_dropped: ['Outbox is full', 'wifi-off', 'urgent'],
  message_expired: ['A message expired before arrival', 'wifi-off', 'urgent'],
  packet_lost: ['Connection lost a packet', 'wifi-off', 'urgent'],
  vehicle_dispatched: ['A vehicle starts its trip', 'truck', 'response'],
  vehicle_arrived: ['A vehicle has arrived', 'truck', 'success'],
  vehicle_blocked: ['A vehicle cannot pass', 'truck', 'urgent'],
  vehicle_stopped: ['A vehicle has stopped', 'truck', 'neutral'],
  traffic_spillback: ['Traffic is backing up', 'route', 'urgent'],
  trip_failed: ['A trip cannot continue', 'truck', 'urgent'],
  reroute_received: ['The driver receives a new route', 'route', 'response'],
  cancel_received: ['The driver receives a cancellation', 'truck', 'neutral'],
  building_damaged: ['A building is affected', 'building-2', 'urgent'],
  road_changed: ['Road conditions changed', 'route', 'urgent'],
  aftershock: ['An aftershock hits', 'activity', 'urgent'],
  fire_front_changed: ['The fire zone is changing', 'flame', 'urgent'],
  flood_level_changed: ['Floodwater is changing', 'droplets', 'urgent'],
  connectivity_restored: ['Connectivity is restored', 'radio', 'success'],
  query_completed: ['A tool returns information', 'file-text', 'response'],
  verification_completed: ['A field check is complete', 'shield-check', 'success'],
  verification_inconclusive: ['A check is inconclusive', 'circle-help', 'urgent'],
  review_completed: ['A responsible person reviews a plan', 'user-round', 'response'],
  ingestion_receipt: ['A connector records a receipt', 'download', 'response'],
  action_accepted: ['An action is authorized', 'circle-check', 'response'],
  action_rejected: ['An action was rejected', 'circle-alert', 'urgent'],
  reference_action_failed: ['The reference controller could not act', 'circle-alert', 'urgent'],
  facility_closed: ['A facility is closed', 'house', 'urgent'],
  facility_operating: ['A facility starts operating', 'house', 'success'],
  facility_activation_failed: ['A facility could not start', 'house', 'urgent'],
  facility_permission_granted: ['An owner grants permission', 'house', 'success'],
  water_produced: ['A plant produces water', 'droplets', 'success'],
  unloading_queued: ['A delivery waits to unload', 'package', 'neutral'],
  unloading_blocked: ['A delivery cannot unload yet', 'package', 'urgent'],
  equipment_incompatible: ['Equipment is incompatible', 'package', 'urgent'],
  repair_completed: ['A repair is complete', 'route', 'success'],
  evacuation_completed: ['People reach a safer location', 'users', 'success'],
  evacuation_blocked: ['An evacuation is blocked', 'users', 'urgent'],
  purchase_received: ['Purchased supplies arrive', 'package', 'success'],
  reservation_conflict: ['Two plans need the same stock', 'package', 'urgent'],
  commitment_withdrawn: ['A partner withdraws its commitment', 'package', 'urgent'],
  commitment_expired: ['A resource reservation expires', 'package', 'neutral'],
  sharing_received: ['Another team shares information', 'radio', 'response'],
  sharing_revoked: ['Shared access is withdrawn', 'shield-check', 'neutral'],
  sharing_revocation_requested: ['A team requests withdrawal of access', 'shield-check', 'neutral'],
  sharing_stale_permission: ['A shared permission is out of date', 'shield-check', 'urgent'],
  plan_dependency_invalidated: ['A plan needs a fresh check', 'circle-alert', 'urgent'],
  operation_cancelled: ['An operation is cancelled', 'truck', 'neutral'],
  cancellation_requested: ['A cancellation is sent', 'radio', 'neutral'],
  public_update_published: ['A relief update is published', 'newspaper', 'social'],
  transfer_offer_received: ['A partner offers supplies', 'package', 'response'],
  resource_lost: ['Supplies are lost or damaged', 'package', 'urgent'],
  vehicle_refuelled: ['A vehicle is refuelled', 'truck', 'success'],
  driver_relay: ['A new driver takes over', 'user-round', 'response'],
  donation_settled: ['A contribution is recorded', 'heart-pulse', 'success'],
  loan_overdue: ['Borrowed equipment is overdue', 'package', 'urgent'],
  loan_returned: ['Borrowed equipment is returned', 'package', 'success'],
  cargo_returned: ['Unused cargo returns to stock', 'package', 'success'],
  care_provided: ['Injured people receive care', 'heart-pulse', 'success'],
  simulated_fatalities: ['Simulated deaths are recorded', 'heart-pulse', 'urgent'],
  population_changed: ['A community health report changes', 'users', 'urgent'],
  outcome_recorded: ['An outcome is recorded', 'file-text', 'success'],
  laboratory_intervention: ['An observer changes the scenario', 'settings-2', 'neutral'],
  content_budget_reached: ['The publication budget is reached', 'file-text', 'neutral'],
  runtime_error: ['The simulation has stopped', 'circle-alert', 'urgent'],
};
export function eventCard(event, state) {
  const d = event.data ?? {};
  const [title, icon, tone] = eventTypes[event.type] ?? [
    humanize(event.type),
    'activity',
    'neutral',
  ];
  let body = '';
  if (d.quantity !== undefined)
    body = `${number(d.quantity)} ${d.type === 'water' ? 'L of water' : humanize(d.type ?? 'units').toLowerCase()}`;
  if (d.building) body += `${body ? ' · ' : ''}${placeName(state, d.building)}`;
  if (d.edge) body = `${d.edge}${d.downstream ? ' · downstream road is full' : ''}`;
  if (event.type === 'road_changed')
    body = `${event.entity} · ${d.open ? 'open again' : 'closed to traffic'}`;
  if (event.type === 'building_damaged')
    body = `${placeName(state, event.entity)} · ${humanize(d.cause ?? 'damage')}`;
  if (event.type === 'message_delivered') body = `${humanize(d.kind)} → ${placeName(state, d.to)}`;
  if (event.type === 'query_completed') body = `${humanize(d.target)} · ${placeName(state, d.org)}`;
  if (event.type === 'simulated_fatalities')
    body = `${number(d.deaths)} deaths · ${d.cause} exposure · experimental model`;
  if (event.type === 'care_provided') body = `${number(d.treated)} people treated`;
  if (event.type === 'vehicle_dispatched')
    body = `${event.entity} → ${d.destination} · ${number(d.distanceM / 1000)} km`;
  if (event.type === 'signal_created' || event.type === 'post_published') {
    const p = state.posts.find((p) => p.public.id === d.id);
    body = p?.public.text ?? `${humanize(d.format)} report · ${placeName(state, event.entity)}`;
  }
  if (!body)
    body = d.reason
      ? humanize(d.reason)
      : d.state
        ? humanize(d.state)
        : d.target
          ? humanize(d.target)
          : placeName(state, event.entity ?? d.org ?? d.to);
  const entity =
    event.type.includes('post') || event.type === 'signal_created'
      ? { kind: 'post', id: d.id }
      : event.entity
        ? { kind: entityKind(event.entity), id: event.entity }
        : null;
  return {
    key: `event:${event.index}:${event.at}:${event.type}:${event.entity ?? ''}:${JSON.stringify(d)}`,
    at: event.at,
    title,
    body,
    icon,
    tone,
    entity,
    location:
      event.type === 'query_completed' ? d.org : (d.building ?? d.target ?? event.entity ?? d.org),
    tag: 'World event',
    raw: event,
  };
}
export function postCard(post, { truth = false, available = false } = {}) {
  const p = post.public ?? post;
  const format = p.format ?? 'text';
  const icon =
    {
      video: 'video',
      audio: 'mic',
      image: 'image',
      news: 'newspaper',
      bulletin: 'file-text',
      text: 'user-round',
    }[format] ?? 'message-circle';
  return {
    key: `post:${p.id}:${p.version}`,
    at: p.publishedAt,
    title: p.authorName ?? 'Community report',
    body: p.text,
    icon,
    tone: truth && post.private?.false ? 'urgent' : 'social',
    tag:
      truth && post.private?.false
        ? 'Misleading · observer label'
        : available
          ? 'Public source · available to fetch'
          : ({
              audio: 'Voice note',
              video: 'Video post',
              image: 'Photo post',
              news: 'News report',
              bulletin: 'Bulletin',
              text: 'Social post',
            }[format] ?? humanize(format)),
    media: format !== 'text' ? format : null,
    entity: { kind: 'post', id: p.id },
    location: truth ? (post.private?.actualLocation ?? p.location) : p.location,
  };
}
export function receiptCard(receipt, state) {
  // Never substitute a newer post for the content of an older download receipt.
  const p =
    receipt.content ??
    state.posts.find((p) => p.public.id === receipt.id && p.public.version === receipt.version)
      ?.public;
  const labels = {
    downloaded: 'Downloaded',
    accepted: 'Accepted by connector',
    interpreted: 'Interpreted by connector',
    discarded: 'Skipped by reference / connector',
  };
  let reason = receipt.reason;
  if (reason === 'No supported operational statement in this reference')
    reason = 'The reference controller did not recognize an actionable request.';
  return {
    key: `receipt:${receipt.org}:${receipt.id}:${receipt.version}:${receipt.stage}:${receipt.at}`,
    at: receipt.at,
    title: labels[receipt.stage] ?? humanize(receipt.stage),
    body: reason ?? p?.text ?? `Report ${receipt.id.slice(0, 8)} · version ${receipt.version}`,
    icon: receipt.stage === 'discarded' ? 'circle-help' : 'download',
    tone: 'response',
    tag: receipt.connector?.startsWith('reference:')
      ? 'Scripted reference controller'
      : 'Actual connector receipt',
    entity: { kind: 'post', id: receipt.id },
    location: p?.location,
    raw: receipt,
  };
}
export function streamModels(snapshot, org, truth) {
  const s = snapshot.state;
  const accessible = (p) => p.private?.audience === 'public' || p.private?.audience?.includes(org);
  const published = s.posts.filter(
    (p) =>
      !p.deleted &&
      p.public.publishedAt !== null &&
      p.public.publishedAt <= snapshot.now &&
      (truth || accessible(p)),
  );
  const communication = published.map((p) => postCard(p, { truth }));
  // Public discovery is separate from an organization's received private observations.
  const available = s.posts
    .filter(
      (p) =>
        !p.deleted &&
        p.indexAt !== null &&
        p.indexAt <= snapshot.now &&
        p.public.publishedAt !== null &&
        accessible(p),
    )
    .map((p) => ({
      ...postCard(p, { available: true }),
      key: `available:${p.public.id}:${p.public.version}`,
      at: p.indexAt,
    }));
  const received = snapshot.events
    .filter(
      (e) =>
        (e.type === 'message_delivered' && e.data.to === org && e.data.kind !== 'post') ||
        (e.type === 'sharing_received' && e.data.to === org) ||
        (e.type === 'query_completed' && e.data.org === org),
    )
    .map((e) => ({
      ...eventCard(e, s),
      key: `received:${eventCard(e, s).key}`,
      tag: 'Received by this organization',
    }));
  const receipts = s.ingestion.filter((r) => r.org === org).map((r) => receiptCard(r, s));
  return {
    reality: truth ? snapshot.events.map((e) => eventCard(e, s)) : [],
    communication,
    available: [...available, ...received, ...receipts].sort((a, b) => a.at - b.at),
  };
}
// A finite presentation queue. Full history lives in the world archive, not the DOM.
export class NotificationQueue {
  constructor({ capacity = 48 } = {}) {
    this.capacity = capacity;
    this.pending = [];
    this.seen = new Set();
    this.skipped = 0;
  }
  accept(items) {
    const fresh = items.filter((item) => !this.seen.has(item.key));
    for (const item of fresh) this.seen.add(item.key);
    if (this.seen.size > 1600) this.seen = new Set([...this.seen].slice(-800));
    this.pending.push(...fresh);
    const excess = Math.max(0, this.pending.length - this.capacity);
    if (excess) {
      this.pending.splice(0, excess);
      this.skipped += excess;
    }
    return fresh;
  }
  shift() {
    return this.pending.shift();
  }
  reset(items = []) {
    this.pending = [];
    this.seen = new Set(items.map((item) => item.key));
    this.skipped = 0;
  }
}
export function trafficLevel(edge, observation = null, truth = true) {
  if (!truth) return observation?.open === false ? 'closed' : 'unknown';
  if (!edge.open) return 'closed';
  const ratio = (edge.occupants?.length ?? 0) / Math.max(1, edge.capacity ?? 1);
  if (edge.waiting?.length || ratio >= 1.5) return 'heavy';
  if (ratio >= 0.7) return 'slow';
  return 'clear';
}
