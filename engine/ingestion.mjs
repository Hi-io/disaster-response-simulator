import { digest, clone } from './determinism.mjs';
import { requireCondition as check } from '../contracts/actions.mjs';
export function installIngestion(w) {
  w.acknowledge = (actor, p) => {
    if (!w.organization(actor?.org)) throw new Error('Unknown ingestion actor');
    if (!w.currentEvent)
      w.inputs.push({
        kind: 'ingestion',
        at: w.now,
        afterEventCount: w.eventCount,
        actor: clone(actor),
        request: clone(p),
      });
    const post = w.post(p.id);
    check(w.sourceVisible(post, actor.org), 'SOURCE', 'Post is not accessible', 404);
    const version = p.version ?? post.public.version;
    const content =
      version === post.public.version
        ? post.public
        : post.history.find((h) => h.version === version);
    check(content, 'VERSION', 'Unknown public version');
    check(
      ['downloaded', 'accepted', 'interpreted', 'discarded'].includes(p.stage),
      'STAGE',
      'Unknown ingestion stage',
    );
    const prior = w.state.ingestion.filter(
      (r) => r.id === p.id && r.org === actor.org && r.version === version,
    );
    const same=prior.find(r=>r.stage===p.stage);
    if(same)return {...clone(same),duplicate:true};
    check(
      p.stage === 'downloaded' || prior.some((r) => r.stage === 'downloaded'),
      'RECEIPT',
      'Download must be acknowledged first',
    );
    const receipt = {
      id: p.id,
      org: actor.org,
      actor: actor.id,
      version,
      stage: p.stage,
      reason: p.reason ?? null,
      at: w.now,
      contentHash: digest(content),
      content: p.stage === 'downloaded' ? clone(content) : undefined,
    };
    w.state.ingestion.push(receipt);
    w.record('ingestion_receipt', { id: p.id, org: actor.org, version, stage: p.stage });
    return clone(receipt);
  };
}
