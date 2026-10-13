import { clone, digest, opaqueId } from './determinism.mjs';
import { requireCondition as check, requireRole, requireOwner } from '../contracts/actions.mjs';
import { humanCapacityEnabled } from '../contracts/human-capacity.mjs';

const terminal = new Set(['completed','inconclusive','failed']);
const stageFields = { read: ['readers','readMs','readErrorBp','backgroundReadPerHour'],
  decide: ['deciders','decisionMs','decisionErrorBp','backgroundDecisionPerHour'],
  relay: ['relayers','relayMs','relayErrorBp','backgroundRelayPerHour'] };
const viewFields = ['id','org','stage','reference','dependsOn','recipient','channel','state','version','createdAt','startedAt',
  'completedAt','readyAt','workMs','queueMs','outcome','reason','receivedAt','message','sourceEventKey','ordinal'];
function taskView(t) {
  const row = Object.fromEntries(viewFields.filter(k => t[k] !== undefined).map(k => [k,clone(t[k])]));
  if(t.state==='completed'&&t.result)row.result=clone(t.result);
  return row;
}
// All latency, availability and permission here is causal source state. No
// observer demand, semantic oracle or automatically generated approval exists.
export function installHumanCapacity(w) {
  const profile=w.config.humanCapacity,enabled=humanCapacityEnabled(profile);
  const state=()=>w.state.humanCapacity??={version:1,orgs:{},ordinals:{},backgroundDropped:0};
  const tasks=()=>w.state.humanWork??=[];
  const task=id=>tasks().find(t=>t.id===id);
  const orgState=org=>{
    const s=state();return s.orgs[org]??={version:1,observedAt:w.now,
      slots:Object.fromEntries(Object.entries(stageFields).map(([stage,[capacity]])=>[stage,Array(profile[capacity]).fill(null)])),
      maximumBacklog:0,completed:0,inconclusive:0,failed:0};
  };
  const changed=(org)=>{const s=orgState(org);s.version++;s.observedAt=w.now;state().version++;};
  const sourcePayload=(org,reference,{pendingWork=false}={})=>{
    let snapshot,sourceObservedAt;
    const known=w.state.observations[org];
    if(reference.kind==='work'){
      const prior=task(reference.id);check(prior&&prior.org===org,'HUMAN_REFERENCE','Work reference is not owned',403);
      check(reference.version===undefined || prior.version===reference.version,'VERSION_CONFLICT','Human work version changed',409);
      if(pendingWork&&!terminal.has(prior.state))return null;
      check(prior.state==='completed'&&prior.result,'HUMAN_PREREQUISITE','Referenced work is not confirmed',409);
      return clone(prior.result);
    }
    if(reference.kind==='post'){
      const post=w.post(reference.id);check(w.sourceVisible(post,org),'SOURCE','Source is not accessible',403);
      snapshot=clone(post.public);sourceObservedAt=snapshot.publishedAt;
    }
    if(reference.kind==='need'){snapshot=clone(known.needs[reference.id]);sourceObservedAt=snapshot?.at;}
    if(reference.kind==='operation'){snapshot=clone(known.operations[reference.id]);sourceObservedAt=snapshot?.observedAt??snapshot?.createdAt;}
    if(reference.kind==='proposal'){
      snapshot=clone(w.state.proposals.find(p=>p.id===reference.id&&p.org===org));sourceObservedAt=snapshot?.reviewedAt??snapshot?.createdAt;
    }
    if(reference.kind==='query'){
      snapshot=clone((w.state.queries??[]).find(q=>q.id===reference.id&&q.org===org&&q.state==='ready'));sourceObservedAt=snapshot?.completedAt;
    }
    check(snapshot,'HUMAN_REFERENCE','Referenced received evidence is not available',403);
    const version=snapshot.version??0;
    check(reference.version===undefined || reference.version===version,'VERSION_CONFLICT','Evidence version changed',409);
    check(Number.isSafeInteger(sourceObservedAt)&&sourceObservedAt>=0&&sourceObservedAt<=w.now,'HUMAN_REFERENCE','Evidence clock is unavailable');
    return {source:{kind:reference.kind,id:reference.id,version},snapshot,sourceObservedAt};
  };
  const relayPermission=(t,payload)=>{
    if(payload.source.kind==='post')check(w.sourceVisible(w.post(payload.source.id),t.recipient),'HUMAN_SHARE_SCOPE','Recipient cannot access the source',403);
    else {
      check(['need','operation','proposal'].includes(payload.source.kind),'HUMAN_SHARE_SCOPE','Manual relay cannot share private inventory, queries or arbitrary plans',403);
      check(['commander','dispatcher'].includes(t.requestedBy.role),'FORBIDDEN','An owner must explicitly authorize sharing received operational information',403);
      if(payload.source.kind!=='need')check(payload.snapshot.org===t.org,'HUMAN_SHARE_SCOPE','Only the actual owner can share its operation or intent',403);
    }
  };
  const sharePayload=(t,payload)=>{
    relayPermission(t,payload);const result=clone(payload),s=payload.snapshot;
    if(payload.source.kind==='operation'){
      const fields=['id','org','type','need','building','destination','resourceType','quantity','received','state',
        'createdAt','observedAt','version','times','failure'];
      result.snapshot=Object.fromEntries(fields.filter(k=>s[k]!==undefined).map(k=>[k,clone(s[k])]));
      result.snapshot.shareScope='owner_operation';
    }else if(payload.source.kind==='proposal'){
      // An explicitly shared intent is a coordination notice, never a peer's
      // full private plan, inventory, authorization or reusable command.
      const fields=['id','org','state','version','createdAt','reviewedAt'];
      result.snapshot=Object.fromEntries(fields.filter(k=>s[k]!==undefined).map(k=>[k,clone(s[k])]));
      result.snapshot.actions=(Array.isArray(s.plan?.actions)?s.plan.actions:[]).filter(a=>['dispatch','evacuate'].includes(a.type)).map(a=>{
        const fields=['need','building','destination','from','to','quantity'];
        const row={type:a.type,params:Object.fromEntries(fields.filter(k=>a.params?.[k]!==undefined).map(k=>[k,clone(a.params[k])]))};
        const resource=w.state.observations[t.org].resources[a.params?.resource];
        if(resource?.owner===t.org)row.resourceType=resource.type;
        return row;
      });
      result.snapshot.shareScope='owner_intent';
    }
    return result;
  };
  const fail=(t,reason)=>{
    t.state='inconclusive';t.outcome='unconfirmed';t.reason=reason;t.completedAt=w.now;t.version++;
    orgState(t.org).inconclusive++;changed(t.org);w.record('human_work_inconclusive',{org:t.org,stage:t.stage,reason},t.id);
  };
  const finishReview=w.handlers.get('review_completed'),legacyReview=w.actionHandlers.get('review');
  const pump=org=>{
    const s=orgState(org),all=tasks();
    let progressed;
    do {
    progressed=false;
    for(const stage of Object.keys(stageFields)){
      const available=s.slots[stage];
      for(let slot=0;slot<available.length;slot++){
        if(available[slot]!==null)continue;
        let selected;
        for(const t of all){
          if(t.org!==org||t.stage!==stage||t.state!=='queued')continue;
          const deps=t.dependsOn.map(task);
          if(deps.some(d=>terminal.has(d.state)&&d.state!=='completed')){fail(t,'prerequisite_unconfirmed');progressed=true;continue;}
          if(deps.every(d=>d.state==='completed')){selected=t;break;}
        }
        if(!selected)break;
        const t=selected;
        try {
          if(t.reference.kind==='work')t.privatePayload=sourcePayload(org,t.reference);
          if(t.stage==='relay'&&!t.background)t.privatePayload=sharePayload(t,t.privatePayload);
        } catch { fail(t,'source_or_permission_changed');progressed=true;slot--;continue; }
        t.state='working';t.startedAt=w.now;t.readyAt=w.now+t.workMs;t.queueMs=w.now-t.createdAt;t.version++;
        progressed=true;
        available[slot]=t.id;t.slot=slot;changed(org);
        w.record('human_work_started',{org,stage,queueMs:t.queueMs,workMs:t.workMs},t.id);
        w.schedule(t.readyAt,'human_work_finish',{id:t.id},4,'human-finish-'+t.id);
      }
    }
    } while(progressed);
  };
  const enqueue=(org,stage,reference,payload,extras={})=>{
    check(tasks().filter(t=>t.org===org&&!terminal.has(t.state)).length<profile.queueLimit,'HUMAN_BACKLOG','Finite human attention queue is full',429);
    const source=payload?.source??reference,rootKey=digest([org,stage,source.kind,source.id,source.version??0,
      stage==='relay'?(extras.channel??'internet'):null]),s=state();
    const ordinal=s.ordinals[rootKey]??0;s.ordinals[rootKey]=ordinal+1;
    const id='human-'+opaqueId(w.config.seed,'human_work',[rootKey,ordinal]),t={id,org,stage,reference:clone(reference),
      dependsOn:[],state:'queued',version:1,createdAt:w.now,readyAt:null,workMs:profile[stageFields[stage][1]],
      privatePayload:payload?clone(payload):null,sourceEventKey:rootKey,ordinal,...extras};
    tasks().push(t);const o=orgState(org);
    o.maximumBacklog=Math.max(o.maximumBacklog,tasks().filter(x=>x.org===org&&x.state==='queued').length);changed(org);
    w.record('human_work_received',{org,stage,reference:clone(reference)},id);pump(org);return t;
  };
  w.initializeHumanCapacity=()=>{
    if(!enabled)return;
    for(const org of w.state.map.organizations)orgState(org.id);
    if(Object.values(stageFields).some(([, , ,rate])=>profile[rate]>0))
      w.schedule(0,'human_background',{minute:0},3,'human-background-0');
  };
  w.onAction('human_work',(a,p)=>{
    requireRole(a,['agent','commander','dispatcher','field']);
    const deps=(p.dependsOn??[]).map(id=>{const t=task(id);check(t&&t.org===a.org,'HUMAN_DEPENDENCIES','Prerequisites are private to their owner',403);return t;});
    const payload=sourcePayload(a.org,p.reference,{pendingWork:true});
    if(!payload)check(deps.some(t=>t.id===p.reference.id),'HUMAN_PREREQUISITE','Pending work reference requires an explicit prerequisite');
    if(p.stage==='relay'){
      check(w.organization(p.recipient),'HUMAN_RELAY','Unknown recipient');
      check(p.recipient!==a.org,'HUMAN_RELAY','Local work does not need a network relay');
      if(payload)relayPermission({...p,org:a.org,requestedBy:a},payload);
    }
    const t=enqueue(a.org,p.stage,p.reference,payload,{dependsOn:deps.map(t=>t.id),requestedBy:clone(a),
      ...(p.stage==='relay'?{recipient:p.recipient,channel:p.channel??'internet',ttlMs:p.ttlMs??3600000}:{})});
    return taskView(t);
  });
  w.onAction('review',(a,p,request)=>{
    if(!enabled)return legacyReview(a,p,request);
    requireRole(a,['commander','dispatcher']);const proposal=w.state.proposals.find(x=>x.id===p.id);
    check(proposal,'NOT_FOUND','Proposal not found');requireOwner(a,proposal.org);
    check(['approve','reject','clarify','modify'].includes(p.decision),'DECISION','Invalid review decision');
    check(request.expectedVersion===undefined||request.expectedVersion===proposal.version,'VERSION_CONFLICT','Proposal changed',409);
    check(!tasks().some(t=>t.review?.id===proposal.id&&!terminal.has(t.state)),'REVIEW_PENDING','This proposal version already has a human review in progress',409);
    const payload=sourcePayload(a.org,{kind:'proposal',id:proposal.id,version:proposal.version});
    // Native approval remains a separate command from a mere decide task.
    const stableReviewKey=digest({references:[...proposal.references].sort(),plan:proposal.plan,decision:p.decision});
    payload.source={kind:'review_scope',id:stableReviewKey,version:proposal.version};
    const t=enqueue(a.org,'decide',{kind:'proposal',id:proposal.id,version:proposal.version},payload,
      {requestedBy:clone(a),workMs:w.config.reviewMs,review:{id:proposal.id,version:proposal.version,signature:digest(proposal.plan),
        decision:p.decision,modifiedPlan:p.plan??null,actor:a.id,org:a.org}});
    return {state:'queued',id:proposal.id,task:t.id,readyAt:t.readyAt,humanCapacity:true};
  });
  w.on('human_work_finish',({id})=>{
    const t=task(id);if(!t||t.state!=='working')return;
    const s=orgState(t.org);if(s.slots[t.stage][t.slot]===t.id)s.slots[t.stage][t.slot]=null;
    const rate=profile[stageFields[t.stage][2]],lapse=w.random('human_capacity',t.sourceEventKey,'attention_lapse',t.ordinal)*10000<rate;
    if(lapse){
      fail(t,'attention_unconfirmed');
      if(t.review){const p=w.state.proposals.find(p=>p.id===t.review.id&&p.org===t.org);
        if(p&&p.version===t.review.version){p.state='needs_clarification';p.version++;w.record('human_review_unconfirmed',{org:t.org,proposal:p.id},t.id);}}
      pump(t.org);return;
    }
    if(t.review){
      const p=w.state.proposals.find(p=>p.id===t.review.id&&p.org===t.org);
      if(!p||p.version!==t.review.version||digest(p.plan)!==t.review.signature){fail(t,'review_scope_changed');pump(t.org);return;}
      finishReview(t.review);
    }
    if(t.stage==='relay'&&!t.background){
      try{relayPermission(t,t.privatePayload);}catch{fail(t,'source_or_permission_changed');pump(t.org);return;}
      const destination=w.organization(t.recipient),origin=w.organization(t.org),message=w.send({kind:'human_relay',work:t.id,from:t.org,to:t.recipient,payload:clone(t.privatePayload)},t.recipient,
        {channel:t.channel,sector:w.sectorForNode(destination.node),ttlMs:t.ttlMs,originOrg:t.org,
          originSector:w.sectorForNode(origin.node),randomKey:'human-relay-'+t.sourceEventKey+'-'+t.ordinal});
      t.message=message.id;t.state=message.state==='dropped'?'failed':'awaiting_delivery';t.outcome=message.state==='dropped'?'transport_unconfirmed':'awaiting_delivery';t.version++;
      if(t.state==='failed'){t.completedAt=w.now;s.failed++;}
      else w.schedule(message.expiresAt+1,'human_relay_expired',{id:t.id},4,'human-relay-expiry-'+t.id);
    }else{
      t.state='completed';t.outcome='attended';t.result=clone(t.privatePayload);t.completedAt=w.now;t.version++;s.completed++;
      w.record('human_work_completed',{org:t.org,stage:t.stage,workMs:t.workMs},t.id);
    }
    changed(t.org);pump(t.org);
  });
  const delivered=w.handlers.get('message_deliver');
  w.on('message_deliver',p=>{
    const m=w.lookup('messages',w.state.messages,p.id),was=m?.state==='delivered';delivered(p);
    if(was||m?.state!=='delivered'||m.payload.kind!=='human_relay')return;
    const t=task(m.payload.work);if(!t||t.state!=='awaiting_delivery'||t.message!==m.id||t.recipient!==m.to)return;
    try{relayPermission(t,t.privatePayload);}catch{fail(t,'source_or_permission_changed');pump(t.org);return;}
    const payload=clone(t.privatePayload),inbox={id:t.id,from:t.org,to:t.recipient,...payload,receivedAt:w.now,version:1};
    w.state.observations[t.recipient].humanInbox??=[];w.state.observations[t.recipient].humanInbox.push(inbox);
    if(payload.source.kind==='need'){
      const n=payload.snapshot,prior=w.state.observations[t.recipient].needs[n.id];
      if(!prior||n.version>prior.version||n.version===prior.version&&n.at>prior.at)w.state.observations[t.recipient].needs[n.id]=clone(n);
    }else if(['operation','proposal'].includes(payload.source.kind)){
      const field=payload.source.kind==='operation'?'peerOperations':'peerIntents',known=w.state.observations[t.recipient];
      known[field]??={};const key=t.org+':'+payload.source.id,prior=known[field][key];
      if(!prior || payload.source.version>prior.source.version || payload.source.version===prior.source.version &&
        payload.sourceObservedAt>=prior.sourceObservedAt)known[field][key]=clone(inbox);
    }
    t.state='completed';t.outcome='delivered';t.completedAt=w.now;t.receivedAt=w.now;t.result=payload;t.version++;
    orgState(t.org).completed++;changed(t.org);w.record('human_relay_received',{from:t.org,to:t.recipient,source:payload.source},t.id);pump(t.org);
  });
  w.on('human_relay_expired',({id})=>{
    const t=task(id);if(!t||t.state!=='awaiting_delivery')return;
    t.state='failed';t.outcome='transport_unconfirmed';t.reason='delivery_expired';t.completedAt=w.now;t.version++;orgState(t.org).failed++;
    changed(t.org);w.record('human_relay_failed',{org:t.org,to:t.recipient,reason:t.reason},t.id);pump(t.org);
  });
  w.on('human_background',({minute})=>{
    for(const org of w.state.map.organizations)for(const [stage,[,,,rate]]of Object.entries(stageFields)){
      const expected=profile[rate]/60,count=Math.floor(expected)+(w.random('human_capacity',org.id+'-'+stage,'background-count',minute)<expected%1?1:0);
      for(let ordinal=0;ordinal<count;ordinal++){
        const id=`routine:${org.id}:${stage}:${minute}:${ordinal}`,payload={source:{kind:'routine',id,version:1},
          snapshot:{text:'Declared unrelated operational workload',stage},sourceObservedAt:w.now};
        // Routine communication preparation occupies the same relay pool,
        // but does not manufacture a report or message for another owner.
        try{enqueue(org.id,stage,{kind:'routine',id,version:1},payload,{background:true});}
        catch(e){if(e.code!=='HUMAN_BACKLOG')throw e;state().backgroundDropped++;w.record('human_background_dropped',{org:org.id,stage,minute,ordinal});}
      }
    }
    if((minute+1)*60000<=w.config.durationMs)w.schedule((minute+1)*60000,'human_background',{minute:minute+1},3,'human-background-'+(minute+1));
  });
  const query=w.actionHandlers.get('query');
  w.onAction('query',(a,p,request)=>{
    if(p.target!=='human_work')return query(a,p,request);
    check(p.org===undefined||p.org===a.org,'FORBIDDEN','Human work is private to its owner',403);
    check(!w.state.toolFault,'TOOL_UNAVAILABLE','Tool dependency is unavailable',503);
    const key=`${a.org}-${Math.floor(w.now/60000)}`;check((w.state.toolQuota[key]??0)<w.config.toolQuota,'RATE_LIMIT','Tool quota exhausted',429);
    w.state.toolQuota[key]=(w.state.toolQuota[key]??0)+1;w.state.queryCount++;w.state.toolCost++;
    const q={id:w.nextId('query'),org:a.org,target:p.target,state:'pending',createdAt:w.now,readyAt:w.now+w.config.queryLatencyMs};
    (w.state.queries??=[]).push(q);w.schedule(q.readyAt,'query_result',{id:q.id,result:w.humanCapacityView(a.org)},2,'human-query-'+q.id);return clone(q);
  });
  w.humanCapacityView=org=>{
    const s=w.state.humanCapacity?.orgs[org],own=(w.state.humanWork??[]).filter(t=>t.org===org);
    return {scope:'own_received_human_work',enabled,profile:clone(profile),version:s?.version??1,observedAt:s?.observedAt??0,
      backlog:own.filter(t=>t.state==='queued').length,working:own.filter(t=>t.state==='working').length,
      awaitingDelivery:own.filter(t=>t.state==='awaiting_delivery').length,maximumBacklog:s?.maximumBacklog??0,
      tasks:own.map(taskView),inbox:clone(w.state.observations[org].humanInbox??[])};
  };
  const view=w.actorView.bind(w);w.actorView=(org,opts)=>({...view(org,opts),humanCapacity:w.humanCapacityView(org),
    humanWork:(w.state.humanWork??[]).filter(t=>t.org===org).map(taskView),humanInbox:clone(w.state.observations[org].humanInbox??[])});
}
