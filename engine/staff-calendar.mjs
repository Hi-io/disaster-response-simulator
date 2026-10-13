import { clone,digest } from './determinism.mjs';
import { requireCondition as check } from '../contracts/actions.mjs';
import { route } from '../generators/map.mjs';

const material=c=>c&&{shiftMs:c.shiftMs,restMs:c.restMs,epochAt:c.epochAt};
export function validateStaffCalendar(input){
  check(input&&typeof input==='object'&&!Array.isArray(input)&&
    Object.keys(input).every(k=>['shiftMs','restMs','epochAt'].includes(k))&&
    Number.isSafeInteger(input.shiftMs)&&input.shiftMs>0&&
    Number.isSafeInteger(input.restMs)&&input.restMs>=0&&
    Number.isSafeInteger(input.epochAt)&&input.epochAt>=0,
    'STAFF_CALENDAR','Staff schedules require positive shift and nonnegative rest/epoch in source milliseconds');
  return clone(input);
}
export function staffWindow(r,now,useAt=now){
  const c=r?.staffCalendar;
  if(!c)return {usable:true,known:false};
  if(now<c.epochAt)return {usable:false,known:true,nextShiftAt:c.epochAt,reason:'before_shift'};
  const cycle=c.shiftMs+c.restMs,phase=(now-c.epochAt)%cycle,start=now-phase,
    end=c.restMs===0?Infinity:start+c.shiftMs,next=start+cycle;
  return {usable:phase<c.shiftMs&&useAt<=end,known:true,shiftEnd:end,
    nextShiftAt:phase<c.shiftMs?start:next,reason:phase>=c.shiftMs?'staff_rest':useAt>end?'work_exceeds_shift':null};
}
export function installStaffCalendar(w){
  w.staffWindow=(r,useAt=w.now)=>staffWindow(r,w.now,useAt);
  const view=w.resourceView.bind(w);
  w.resourceView=r=>({...view(r),...(r.staffCalendar?{staffCalendar:clone(r.staffCalendar)}:{})});
  w.setStaffCalendar=(r,input,{publish=true}={})=>{
    check(r?.type==='staff','STAFF_CALENDAR','Only staff stock can declare a work schedule');
    const c=validateStaffCalendar(input),sig=digest(c);
    if(r._staffCalendarMaterial===sig||digest(material(r.staffCalendar)??null)===sig)return;
    r._staffCalendarMaterial=sig;r.staffCalendar={...c,version:(r.staffCalendar?.version??0)+1,observedAt:w.now};r.version++;
    if(publish)w.reportResource(r,r.owner);
    const end=staffWindow(r,w.now).shiftEnd;
    if(Number.isFinite(end)&&end>=w.now)w.schedule(end,'staff_shift_end',{resource:r.id,version:r.staffCalendar.version},0,
      `staff-shift-${r.id}-${r.staffCalendar.version}-${end}`);
    for(const b of w.state.map.buildings)if(b.node===r.node&&['operating','provisioning'].includes(b.state))
      if(!facilityWorking(b))w.closeFacility(b,'staff_unavailable');
  };
  const facilityWorking=b=>(b.activeReservations??[]).every(id=>{
    const c=w.state.commitments.find(c=>c.id===id),r=w.resource(c?.resource);
    return !r||r.type!=='staff'||staffWindow(r,w.now).usable;
  });
  w.facilityStaffWorking=facilityWorking;
  w.on('staff_shift_end',p=>{
    const r=w.resource(p.resource);if(!r||r.staffCalendar?.version!==p.version)return;
    for(const b of w.state.map.buildings)if(['operating','provisioning'].includes(b.state)&&
      b.activeReservations?.some(id=>w.state.commitments.find(c=>c.id===id)?.resource===r.id)&&!facilityWorking(b))
      w.closeFacility(b,'staff_unavailable');
  });
  const allocate=w.allocateStaff;
  w.allocateStaff=(org,q,task,resourceId=`r-${org}-staff`,skills=[],workAt=w.now,useAt=workAt)=>{
    check(staffWindow(w.resource(resourceId),workAt,useAt).usable,'STAFF_CALENDAR','The crew work must fit its declared shift');
    return allocate(org,q,task,resourceId,skills);
  };
  const node=i=>i.target==='building'?w.building(i.entity)?.node:i.target==='need'?w.building(w.need(i.entity)?.building)?.node:
    i.target==='road'?w.edge(i.entity)?.from:w.resource(i.entity)?.node;
  const failInspection=i=>{
    if(!i||['completed','inconclusive','timeout'].includes(i.state))return;
    w.releaseStaff(i.staff);i.state='report_pending';i.failure='staff_unavailable';i.observedAt=w.now;
    const op=w.state.operations.find(o=>o.id===i.operation),v=w.vehicle(op?.vehicle);
    if(op){op.state='failed';op.failure=i.failure;op.times.failed=w.now;
      v.operation=null;if(v.edge)v.pendingCancel=true;else v.state='idle';w.reportOperation(op);w.reportVehicle(v);}
    w.send({kind:'verification',inspection:i.id,result:null,observedAt:w.now},i.org,{sector:w.sectorForNode(node(i))});
    if(i.reportTo!==i.org)w.send({kind:'verification',inspection:i.id,result:null,observedAt:w.now,recipient:i.reportTo},i.reportTo,
      {sector:w.sectorForNode(node(i)),ttlMs:i.validForMs});
    w.record('verification_inconclusive',{inspection:i.id,reason:i.failure});
  };
  const prepare=w.handlers.get('field_prepare');
  w.on('field_prepare',p=>{
    const i=w.state.inspections.find(i=>i.id===p.inspection);
    if(i?.state==='queued'&&i.method!=='clarification'){
      const r=w.resource(i.staffResource),v=i.requestedVehicle?w.vehicle(i.requestedVehicle):w.state.vehicles.find(v=>
        v.owner===i.org&&!v.background&&v.state==='idle'&&w.vehicleDriverAvailable(v));
      const path=v?route(w.state.map,v.node,node(i),v,w.state.observations[i.org].edges):null,
        workAt=w.now+(path?.freeTimeMs??0),useAt=workAt+w.config.inspectionMs;
      if(!staffWindow(r,workAt,useAt).usable){failInspection(i);return;}
    }
    prepare(p);
  });
  const observe=w.handlers.get('field_observe');
  w.on('field_observe',p=>{
    const i=w.state.inspections.find(i=>i.id===p.inspection);
    if(i&&i.method!=='clarification'&&!staffWindow(w.resource(i.staffResource),i.arrivedAt??w.now,w.now).usable){failInspection(i);return;}
    observe(p);
  });
  const repair=w.actionHandlers.get('repair');
  w.onAction('repair',(a,p,request)=>{
    const r=w.resource(`r-${a.org}-staff`),v=w.state.vehicles.find(v=>v.owner===a.org&&!v.background&&v.state==='idle'&&w.vehicleDriverAvailable(v)),
      target=w.edge(p.edge)?.from,path=v&&target?route(w.state.map,v.node,target,v,w.state.observations[a.org].edges):null;
    const workAt=w.now+(path?.freeTimeMs??0);
    check(staffWindow(r,workAt,workAt+2*w.config.setupMs).usable,'STAFF_CALENDAR','Repair work must fit the available crew shift');
    return repair(a,p,request);
  });
  const failRepair=t=>{
    w.releaseStaff(t.staff);t.state='failed';t.failure='staff_unavailable';
    const op=w.state.operations.find(o=>o.id===t.operation),v=w.vehicle(op.vehicle);
    op.state='failed';op.failure=t.failure;op.times.failed=w.now;v.state='idle';v.operation=null;
    w.reportVehicle(v);w.reportOperation(op);
  };
  const arrival=w.handlers.get('task_arrival');
  w.on('task_arrival',p=>{
    const op=w.state.operations.find(o=>o.id===p.operation),i=w.state.inspections.find(i=>i.operation===op?.id),
      t=w.state.repairs?.find(t=>t.operation===op?.id);
    if(i&&!staffWindow(w.resource(i.staffResource),w.now,w.now+w.config.inspectionMs).usable){failInspection(i);return;}
    if(t){const c=w.state.commitments.find(c=>c.id===t.staff);
      if(!staffWindow(w.resource(c?.resource),w.now,w.now+2*w.config.setupMs).usable){failRepair(t);return;}}
    arrival(p);
  });
  const repairEnd=w.handlers.get('repair_finish');
  w.on('repair_finish',p=>{
    const t=w.state.repairs?.find(t=>t.id===p.id),c=w.state.commitments.find(c=>c.id===t?.staff),r=w.resource(c?.resource);
    if(t?.state==='working'&&!staffWindow(r,t.startedAt,w.now).usable){failRepair(t);return;}
    repairEnd(p);
  });
  const stockId=w.supplyStockId;
  w.supplyStockId=(base,op)=>{
    const id=stockId(base,op);if(op.resourceType!=='staff')return id;
    const old=w.resource(id),schedule=material(op.staffCalendar);
    if(!old||digest(material(old.staffCalendar)??null)===digest(schedule??null))return id;
    return `${id}-staff-${digest(schedule??null).slice(0,16)}`;
  };
  const load=w.handlers.get('load');
  w.on('load',p=>{load(p);const op=w.state.operations.find(o=>o.id===p.operation),v=w.vehicle(op?.vehicle),r=w.resource(op?.resource);
    if(v?.load&&r?.type==='staff'){op.staffCalendar=clone(r.staffCalendar);v.staffCalendar=clone(r.staffCalendar);}});
  const unload=w.handlers.get('unload');
  w.on('unload',p=>{
    const op=w.state.operations.find(o=>o.id===p.operation),priorReceived=op?.received??0;unload(p);
    if(op?.resourceType==='staff'&&op.destinationStock&&op.received>priorReceived){
      const r=w.resource(op.destinationStock);if(op.staffCalendar){r.staffCalendar=clone(op.staffCalendar);
        const end=staffWindow(r,w.now).shiftEnd;
        if(Number.isFinite(end)&&end>=w.now)w.schedule(end,'staff_shift_end',{resource:r.id,version:r.staffCalendar.version},0,
          `staff-shift-${r.id}-${r.staffCalendar.version}-${end}`);}
      const v=w.vehicle(op.vehicle);if(v&&!v.load)delete v.staffCalendar;
    }
  });
  for(const name of ['facility_open','produce','shelter_service']){
    const handler=w.handlers.get(name);
    w.on(name,p=>{const b=w.building(p.building);
      if(b&&['operating','provisioning'].includes(b.state)&&!facilityWorking(b)){w.closeFacility(b,'staff_unavailable');return;}
      handler(p);
    });
  }
  const intervention=w.handlers.get('lab_intervention');
  w.on('lab_intervention',p=>p.kind==='staff_calendar'?w.setStaffCalendar(w.resource(p.resource),p.calendar):intervention(p));
}
