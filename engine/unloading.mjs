import { clone, digest } from './determinism.mjs';
import { requireCondition as check, requireRole, requireOwner } from '../contracts/actions.mjs';
import { reserve, release } from './ledger.mjs';
import { qualifiedStaffAvailable, staffReservation } from './staff.mjs';
import { staffWindow } from './staff-calendar.mjs';

const terminal=new Set(['completed','cancelled']);
const exactFields=['operation','staff','quantity','targetVersion','requestVersion','sourceVersion','deliveryQuantity'];
export function installUnloading(w){
  const requests=()=>w.state.unloadingRequests??=[];
  const requestFor=op=>requests().find(r=>r.operation===op.id);
  const actualOperation=r=>w.state.operations.find(o=>o.id===r.operation);
  const received=(org,id)=>w.state.observations[org]?.unloadingRequests?.[id];
  const publicRequest=r=>Object.fromEntries(['id','operation','org','receiverOrg','building','node','state','version','operationVersion',
    'targetVersion','deliveryQuantity','received','staffQuantity','requiredSkills','workMs','observedAt','times','failure','staff','quantity']
    .filter(k=>r[k]!==undefined).map(k=>[k,clone(r[k])]));
  const publish=r=>{
    const op=actualOperation(r);if(op)r.operationVersion=op.version??0;
    const value=publicRequest(r);delete value.version;delete value.observedAt;
    const signature=digest(value);if(r._signature===signature)return;
    r.version=(r.version??0)+1;r.observedAt=w.now;r._signature=signature;
    for(const org of new Set([r.org,r.receiverOrg]))w.send({kind:'unloading_request',request:publicRequest(r)},org,{sector:w.sectorForNode(r.node)});
    w.record('unloading_request_reported',{request:r.id,operation:r.operation,state:r.state,version:r.version},r.id);
  };
  const releaseCrew=r=>{
    if(!r.hold)return;
    const staff=w.resource(r.staff);release(staff,r.quantity,r.hold);delete r.hold;
    w.reportResource(staff,staff.owner);
  };
  const stop=(r,reason,state='inconclusive')=>{
    releaseCrew(r);r.state=state;r.failure=reason;
    const op=actualOperation(r),b=w.building(r.building);
    if(op&&op.unloadingSlot){b.unloadingCount--;op.unloadingSlot=false;}
    if(op&&!['completed','cancelled','failed','returning'].includes(op.state)){
      op.state='waiting_to_unload';op.waitingReason=reason;w.reportOperation(op);
    }
    publish(r);
  };
  const approvalCurrent=r=>{
    const proposal=w.state.proposals.find(p=>p.id===r.proposal),action=proposal?.plan?.actions?.[r.step];
    return proposal?.org===r.receiverOrg&&proposal.state==='authorized'&&!proposal.requiresReview&&
      action?.type==='unload'&&(action.owner===undefined||action.owner===r.receiverOrg)&&
      exactFields.every(k=>action.params?.[k]===r.approvedParams?.[k]);
  };
  const crewValid=(r,start=w.now,end=start+r.workMs)=>{
    const b=w.building(r.building),staff=w.resource(r.staff),hold=staffReservation(staff,r.hold),op=actualOperation(r),v=w.vehicle(op?.vehicle);
    const originalApproval=op?.proposal?w.state.proposals.find(p=>p.id===op.proposal):null;
    return (!op?.proposal||originalApproval?.state==='authorized'&&!originalApproval.requiresReview)&&b?.version===r.targetVersion&&b.damage<3&&b.receiverAvailable&&staff?.owner===r.receiverOrg&&
      staff.type==='staff'&&!['expired','damaged','quarantined'].includes(staff.condition)&&staff.node===r.node&&hold?.quantity===r.quantity&&
      r.requiredSkills.every(skill=>(hold.qualificationCounts[skill]??0)>=r.quantity)&&
      staffWindow(staff,start,end).usable&&approvalCurrent(r)&&op?.building===r.building&&
      !['completed','cancelled','failed','returning'].includes(op.state)&&v?.node===r.node&&v.load===r.deliveryQuantity;
  };
  const send=w.send;
  w.send=(payload,to,options)=>{
    let p=payload;
    if(payload.kind==='verification'&&payload.result){
      const i=w.state.inspections.find(i=>i.id===payload.inspection),b=i?.target==='building'?w.building(i.entity):null;
      if(b?.unloading)p={...payload,result:{...payload.result,unloading:clone(b.unloading)}};
    }else if(payload.kind==='facility_status'){
      const b=w.building(payload.building.id);if(b?.unloading)p={...payload,building:{...payload.building,unloading:clone(b.unloading)}};
    }
    return send(p,to,options);
  };
  const deliver=w.handlers.get('message_deliver');
  w.on('message_deliver',p=>{
    const m=w.lookup('messages',w.state.messages,p.id),already=m?.state==='delivered';deliver(p);
    if(already||m?.state!=='delivered')return;
    if(m.payload.kind==='unloading_request'){
      const r=m.payload.request;if(![r.org,r.receiverOrg].includes(m.to))return;
      const known=w.state.observations[m.to];known.unloadingRequests??={};const old=known.unloadingRequests[r.id];
      if(!old||r.version>old.version)known.unloadingRequests[r.id]=clone(r);
    }else if(m.payload.kind==='unloading_command'){
      const r=requests().find(r=>r.id===m.payload.request);
      if(!r||r.state!=='queued'||r.authorizationVersion!==m.payload.authorizationVersion)return;
      if(!crewValid(r)){stop(r,'unloading_crew_or_authority_changed');return;}
      r.times.orderReceived=w.now;publish(r);
      w.schedule(w.now,'request_unload',{operation:r.operation},4,`crew-unload-${r.id}-${r.authorizationVersion}`);
    }
  });
  w.on('unloading_command_timeout',p=>{
    const r=requests().find(r=>r.id===p.request),m=w.lookup('messages',w.state.messages,p.message);
    if(r?.state==='queued'&&r.authorizationVersion===p.authorizationVersion&&m?.state!=='delivered')stop(r,'unloading_order_not_received');
  });
  const actorView=w.actorView.bind(w);
  w.actorView=(org,options)=>({...actorView(org,options),unloadingRequests:clone(Object.values(w.state.observations[org].unloadingRequests??{}))});
  const report=w.reportOperation;
  w.reportOperation=op=>{
    const result=report(op),r=requestFor(op);
    if(r){
      if(['cancelled','failed','returning'].includes(op.state)&&!terminal.has(r.state))stop(r,op.failure??'original_delivery_cancelled','cancelled');
      else publish(r);
    }
    return result;
  };
  const requestUnload=w.handlers.get('request_unload');
  w.on('request_unload',p=>{
    const op=w.state.operations.find(o=>o.id===p.operation),b=w.building(op?.building),requirement=b?.unloading;
    if(!op||!['arrived','waiting_to_unload'].includes(op.state)||!requirement?.staffQuantity||op.resourceType==='staff')return requestUnload(p);
    let r=requestFor(op);
    if(!r){
      check(Number.isSafeInteger(requirement.staffQuantity)&&requirement.staffQuantity>0&&requirement.staffQuantity<=1000&&
        Array.isArray(requirement.requiredSkills)&&requirement.requiredSkills.length<=32&&requirement.requiredSkills.every(s=>typeof s==='string'&&/^[a-z][a-z0-9_]{0,79}$/.test(s))&&
        Number.isSafeInteger(requirement.workMs)&&requirement.workMs>=0&&requirement.workMs<=86400000,'UNLOADING_REQUIREMENT','Declared local unloading requirements must be typed and bounded');
      r={id:w.nextId('unloading'),operation:op.id,org:op.org,receiverOrg:b.ownerOrg??'org0',building:b.id,node:b.node,
        state:'waiting_for_crew',targetVersion:b.version,deliveryQuantity:w.vehicle(op.vehicle).load,received:0,
        staffQuantity:requirement.staffQuantity,requiredSkills:clone(requirement.requiredSkills??[]),
        workMs:Math.max(w.config.unloadMs,requirement.workMs??w.config.unloadMs),times:{arrived:w.now}};
      requests().push(r);op.state='waiting_to_unload';op.waitingReason='unloading_staff_unavailable';w.reportOperation(op);publish(r);return;
    }
    if(r.state==='queued'&&!r.times.orderReceived)return;
    if(!r.hold||!crewValid(r)){if(r.hold)stop(r,'unloading_crew_or_authority_changed');return;}
    requestUnload(p);
    if(op.state==='unloading'){
      r.state='working';r.times.workStarted=w.now;r.times.workEnds=w.now+r.workMs;publish(r);
    }
  });
  const unload=w.handlers.get('unload');
  w.on('unload',p=>{
    const op=w.state.operations.find(o=>o.id===p.operation),r=op&&requestFor(op);
    if(!r)return unload(p);
    if(r.state!=='working'||op.state!=='unloading')return;
    if(!crewValid(r,r.times.workStarted,w.now)){stop(r,'unloading_crew_or_authority_changed');return;}
    if(w.now<r.times.workEnds){w.schedule(r.times.workEnds,'unload',p,4,`crew-work-${r.id}-${r.authorizationVersion}`);return;}
    unload(p);
    if(op.state==='completed'&&op.received>0){releaseCrew(r);r.state='completed';r.received=op.received;r.times.received=op.times.received;
      r.times.service=op.times.service??op.times.received;delete r.failure;publish(r);
    }else stop(r,op.waitingReason??'physical_unloading_incomplete');
  });
  w.onAction('unload',(a,p)=>{
    requireRole(a,['commander','dispatcher']);
    const r=requests().find(r=>r.operation===p.operation),seen=r&&received(a.org,r.id),b=w.building(r?.building),staff=w.resource(p.staff),op=r&&actualOperation(r);
    check(r&&seen,'UNLOADING_RECEIPT','A received unloading request is required');requireOwner(a,r.receiverOrg);
    check(['waiting_for_crew','inconclusive'].includes(r.state),'UNLOADING_STATE','The original delivery already has an assigned crew or is terminal');
    check(p.requestVersion===r.version&&seen.version===r.version&&p.sourceVersion===r.operationVersion&&
      p.targetVersion===r.targetVersion&&b.version===r.targetVersion,'VERSION_CONFLICT','Received delivery or destination changed',409);
    check(p.quantity===r.staffQuantity&&p.deliveryQuantity===r.deliveryQuantity,'QUANTITY','Exact declared crew and original delivery quantity required');
    check(staff?.type==='staff'&&staff.owner===a.org&&staff.node===r.node&&!['expired','damaged','quarantined'].includes(staff.condition),'UNLOADING_STAFF','Owned qualified crew must physically be onsite');
    check(qualifiedStaffAvailable(staff,r.requiredSkills)>=p.quantity,'STAFF_QUALIFICATIONS','Exact qualified crew is not available');
    const workAt=w.now+w.config.networkLatencyMs+Math.ceil(1000/w.config.bandwidthBytesPerSecond*1000);
    check(staffWindow(staff,workAt,workAt+r.workMs).usable,'STAFF_CALENDAR','Unloading work must fit the declared crew shift');
    const approved={...Object.fromEntries(exactFields.map(k=>[k,p[k]]))};
    const candidate={...r,proposal:p.proposal,step:p.step,approvedParams:approved};
    check(approvalCurrent(candidate),'UNLOADING_APPROVAL','The receiver must independently approve these exact unloading terms');
    check(b.damage<3&&b.receiverAvailable&&op.building===r.building&&w.vehicle(op.vehicle).load===r.deliveryQuantity,
      'UNLOADING_DESTINATION','The original physical cargo or destination is unavailable');
    const hold=reserve(staff,p.quantity,r.requiredSkills);
    r.proposal=p.proposal;r.step=p.step;r.approvedParams=approved;
    r.staff=staff.id;r.quantity=p.quantity;r.hold=hold;w.reportResource(staff,staff.owner);
    r.state='queued';r.authorizationVersion=(r.authorizationVersion??0)+1;delete r.failure;
    r.times={arrived:r.times.arrived,authorized:w.now};publish(r);
    const message=w.send({kind:'unloading_command',request:r.id,authorizationVersion:r.authorizationVersion},a.org,{sector:w.sectorForNode(r.node)});
    w.schedule(message.expiresAt+1,'unloading_command_timeout',{request:r.id,message:message.id,authorizationVersion:r.authorizationVersion},4,`unload-timeout-${r.id}-${r.authorizationVersion}`);
    return publicRequest(r);
  });
}
