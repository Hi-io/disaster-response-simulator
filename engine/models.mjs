import { clone } from './determinism.mjs';
import { requireCondition as check } from '../contracts/actions.mjs';
export function installModels(w) {
  w.modelBarrier = () =>
    w.config.clockLatency === 'modeled'
      ? (w.state.modelRequests ?? []).some((r) => r.state === 'waiting')
      : false;
  w.startModelCall = (actor, p) => {
    check(w.organization(actor.org), 'AUTHENTICATION', 'Unknown organization', 401);
    check(
      typeof p.model === 'string' && /^[a-zA-Z0-9._-]{1,120}$/.test(p.model),
      'MODEL',
      'Model name required',
    );
    check(
      (w.state.modelRequests ?? []).length < w.config.modelCallLimit,
      'MODEL_BUDGET',
      'Model call budget exhausted',
      429,
    );
    if (!w.currentEvent)
      w.inputs.push({
        kind: 'model_start',
        at: w.now,
        afterEventCount: w.eventCount,
        actor: clone(actor),
        request: clone(p),
      });
    w.state.modelRequests ??= [];
    const r = {
      id: w.nextId('model-request'),
      org: actor.org,
      actor: actor.id,
      model: p.model,
      requestedAt: w.now,
      state: 'waiting',
      policy: w.config.clockLatency,
    };
    w.state.modelRequests.push(r);
    w.record(
      'model_requested',
      { id: r.id, org: actor.org, model: p.model, clockPolicy: r.policy },
      r.id,
    );
    return clone(r);
  };
  w.finishModelCall = (actor, p) => {
    const r = w.state.modelRequests?.find((r) => r.id === p.id);
    check(
      r && r.org === actor.org && r.actor === actor.id,
      'ACCESS',
      'Model call does not belong to this session',
      403,
    );
    check(r.state === 'waiting', 'MODEL_STATE', 'Model result already submitted', 409);
    for (const field of ['wallMs', 'promptTokens', 'outputTokens'])
      check(
        Number.isFinite(p[field] ?? 0) && (p[field] ?? 0) >= 0 && (p[field] ?? 0) <= 1e9,
        'MODEL_USAGE',
        'Invalid usage',
      );
    if (!w.currentEvent)
      w.inputs.push({
        kind: 'model_finish',
        at: w.now,
        afterEventCount: w.eventCount,
        actor: clone(actor),
        request: clone(p),
      });
    r.availableAt =
      w.config.clockLatency === 'wall'
        ? w.now
        : Math.max(w.now, r.requestedAt + w.config.modelLatencyMs);
    r.wallMs = p.wallMs;
    r.promptTokens = p.promptTokens ?? 0;
    r.outputTokens = p.outputTokens ?? 0;
    r.failed = !!p.failed;
    r.state = 'scheduled';
    w.state.modelCalls++;
    w.state.modelWallMs += p.wallMs;
    w.schedule(r.availableAt, 'model_result', { id: r.id }, 2, r.id);
    return clone(r);
  };
  w.on('model_result', ({ id }) => {
    const r = w.state.modelRequests.find((r) => r.id === id);
    r.state = r.failed ? 'failed' : 'available';
    w.record(
      'model_available',
      {
        id,
        org: r.org,
        model: r.model,
        wallMs: r.wallMs,
        promptTokens: r.promptTokens,
        outputTokens: r.outputTokens,
        failed: r.failed,
      },
      id,
    );
  });
}
