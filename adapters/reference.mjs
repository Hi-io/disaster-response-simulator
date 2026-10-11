// Deterministic reference controllers, not a Gemini implementation. Decisions
// use the same whitelisted observations and authorized commands as a connector.
import { clone } from '../engine/determinism.mjs';

export function installReference(w) {
  w.on('reference_tick', () => {
    if (w.config.policy === 'none') return;
    w.state.reference ??= {};
    for (const org of Array.from({ length: w.config.organizations }, (_, i) => `org${i}`)) {
      const memory = (w.state.reference[org] ??= {
        seen: {},
        investigations: {},
        plans: [],
        counter: 0,
        nextQuery: 0,
      });
      const actor = { id: `reference-${org}`, org, role: 'agent' },
        commander = { id: `responsible-${org}`, org, role: 'commander' };
      const call = (type, params, authorized = false) => {
        try {
          return w.act(authorized ? commander : actor, {
            type,
            params,
            idempotencyKey: `ref-${org}-${++memory.counter}`,
          });
        } catch (error) {
          w.record('reference_action_failed', { org, type, code: error.code });
          return null;
        }
      };
      // The publicFeed projection contains neither observer labels nor future posts.
      const feed = w.publicFeed({ limit: 100 }).posts,
        view = w.actorView(org, { includeQueries: false, includeEdges: false });
      const sample =
        w.config.policy === 'conventional' ? feed.slice(0, w.config.operatorCount * 3) : feed;
      for (const post of sample) {
        if (memory.seen[post.id] === post.version) continue;
        memory.seen[post.id] = post.version;
        w.state.ingestion.push({
          id: post.id,
          version: post.version,
          org,
          stage: 'downloaded',
          connector: `reference:${w.config.policy}`,
          at: w.now,
          content: clone(post),
        });
        if (post.claimedAt !== null && post.claimedAt < 0) {
          call('flag_report', {
            post: post.id,
            state: 'old',
            reason: 'Visible capture timestamp predates this episode',
          });
          w.state.ingestion.push({
            id: post.id,
            version: post.version,
            org,
            stage: 'discarded',
            reason: 'Older material needs contextual verification',
            at: w.now,
          });
          continue;
        }
        if (post.references.some((id) => memory.seen[id])) continue;
        const operational =
          /water|agua|litre|litro|shelter|refugio|generator|generador|power|energía/i.test(
            post.text,
          );
        if (!operational) {
          w.state.ingestion.push({
            id: post.id,
            version: post.version,
            org,
            stage: 'discarded',
            reason: 'No supported operational statement in this reference',
            at: w.now,
          });
          continue;
        }
        const claim = call('record_claim', { text: post.text, references: [post.id] });
        if (!claim) continue;
        w.state.ingestion.push({
          id: post.id,
          version: post.version,
          org,
          stage: 'interpreted',
          connector: `reference:${w.config.policy}`,
          at: w.now,
          reason: 'Public text parsed; facts still require confirmation',
        });
        if (
          ['general', 'investigation', 'federated'].includes(w.config.policy) &&
          post.location &&
          !memory.investigations[post.location] &&
          Object.keys(memory.investigations).length < 20
        ) {
          const i = call('verify', { target: 'building', id: post.location, method: 'field' });
          if (i) memory.investigations[post.location] = i.id;
        }
      }
      if (w.now >= memory.nextQuery) {
        call('query', { target: 'inventory' });
        call('query', { target: 'vehicles' });
        memory.nextQuery = w.now + 120000;
      }
      if (w.config.policy === 'federated' && w.now % 120000 === 0) {
        for (const target of Array.from(
          { length: w.config.organizations },
          (_, i) => `org${i}`,
        ).filter((o) => o !== org))
          for (const r of Object.values(view.known.resources).filter((r) => r.owner === org))
            call('share', { to: target, kind: 'resource', id: r.id });
      }
      // Pending shipments count against demand. No independent copy of stock is
      // allocated per incident, and each plan waits in a real review queue.
      const needs = Object.values(view.known.needs)
        .filter((n) => n.type === 'water')
        .sort((a, b) => a.deadline - b.deadline || a.id.localeCompare(b.id));
      const active = view.operations.filter(
        (o) => !['completed', 'cancelled', 'failed'].includes(o.state),
      );
      for (const n of needs) {
        const pending =
          active.filter((o) => o.need === n.id).reduce((sum, o) => sum + o.quantity, 0) +
          memory.plans
            .filter((p) => p.need === n.id && !p.dispatched && !p.ended)
            .reduce((sum, p) => sum + p.quantity, 0);
        const required = Math.max(0, n.quantity - n.served - pending);
        if (!required) continue;
        const r = Object.values(view.known.resources).find(
          (r) => r.owner === org && r.type === 'water' && r.quantity - r.reserved - r.floor > 0,
        );
        const used = new Set([
          ...active.map((o) => o.vehicle),
          ...memory.plans.filter((p) => !p.dispatched && !p.ended).map((p) => p.vehicle),
        ]);
        const v = Object.values(view.known.vehicles).find(
          (v) => v.owner === org && !used.has(v.id) && ['idle', 'arrived'].includes(v.state),
        );
        if (!r || !v) continue;
        const quantity = Math.min(required, v.capacity, r.quantity - r.reserved - r.floor);
        if (quantity <= 0) continue;
        const proposal = call('propose', {
          title: `Deliver ${quantity} L to ${n.building}`,
          plan: { need: n.id, resource: r.id, vehicle: v.id, quantity },
          conditions: [],
        });
        if (proposal) {
          call('review', { id: proposal.id, decision: 'approve' }, true);
          memory.plans.push({
            id: proposal.id,
            need: n.id,
            resource: r.id,
            vehicle: v.id,
            quantity,
          });
        }
      }
      const updated = w.actorView(org, { includeQueries: false, includeEdges: false });
      for (const plan of memory.plans.filter((p) => !p.dispatched && !p.ended)) {
        const proposal = updated.proposals.find((p) => p.id === plan.id);
        if (proposal?.state === 'authorized') {
          const op = call(
            'dispatch',
            {
              need: plan.need,
              resource: plan.resource,
              vehicle: plan.vehicle,
              quantity: plan.quantity,
              proposal: plan.id,
            },
            true,
          );
          if (op) {
            plan.dispatched = true;
            plan.operation = op.id;
          } else {
            plan.ended = true;
          }
        }
        if (proposal?.state === 'rejected') plan.ended = true;
      }
      // Repair a blocked route only after its observation arrives; do not peek
      // at actual road closures to make the controller appear more capable.
      for (const op of updated.operations.filter((o) => o.state === 'blocked')) {
        const blocked = Object.entries(updated.known.edges).find(([id, e]) => e.open === false);
        if (blocked && !memory.investigations[blocked[0]]) {
          const task = call('verify', { target: 'road', id: blocked[0], method: 'radio' });
          if (task) memory.investigations[blocked[0]] = task.id;
        }
      }
    }
    const delay = w.config.policy === 'conventional' ? 120000 : 30000;
    if (w.now + delay <= w.config.durationMs)
      w.schedule(w.now + delay, 'reference_tick', {}, 5, `reference-${w.now + delay}`);
  });
}
