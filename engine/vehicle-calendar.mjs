import { clone, digest } from './determinism.mjs';
import { route } from '../generators/map.mjs';
import { release } from './ledger.mjs';
import { requireCondition as check } from '../contracts/actions.mjs';

export function validateVehicleCalendar(w, calendar) {
  check(calendar && typeof calendar === 'object' && !Array.isArray(calendar) &&
    Object.keys(calendar).every(k => ['availableAfter','availableUntil','nextCommitment','plannedReturn'].includes(k)),
  'VEHICLE_CALENDAR', 'Only declared operational calendar fields are accepted');
  for (const k of ['availableAfter','availableUntil']) if(calendar[k]!==undefined)
    check(Number.isSafeInteger(calendar[k]) && calendar[k]>=0,'VEHICLE_CALENDAR','Calendar times use source-world milliseconds');
  check(calendar.availableUntil===undefined || calendar.availableAfter===undefined ||
    calendar.availableUntil>calendar.availableAfter,'VEHICLE_CALENDAR','Availability window must have positive duration');
  if(calendar.nextCommitment){ const c=calendar.nextCommitment;
    check(Object.keys(c).every(k=>['id','startsAt','node'].includes(k)) && typeof c.id==='string' &&
      c.id.length>0 && c.id.length<=120 && Number.isSafeInteger(c.startsAt) && c.startsAt>=0 &&
      w.node(c.node),'VEHICLE_CALENDAR','A next commitment needs an identifier, declared start and real node'); }
  if(calendar.plannedReturn){const p=calendar.plannedReturn;
    check(Object.keys(p).every(k=>['departureAt','destination','cargo'].includes(k)) &&
      Number.isSafeInteger(p.departureAt) && p.departureAt>=0 && w.node(p.destination) && p.cargo===0,
    'VEHICLE_CALENDAR','The supported existing return is a declared empty trip');}
  return clone(calendar);
}

export function installVehicleCalendar(w){
  w.setVehicleCalendar=(v, input, {publish=true}={})=>{
    const calendar=validateVehicleCalendar(w,input), material=digest(calendar);
    if(v._calendarMaterial===material)return clone(v.calendar);
    const previous=v.calendar?.nextCommitment;
    v._calendarMaterial=material;
    v.calendar={...calendar,version:(v.calendar?.version??0)+1,observedAt:w.now};
    v.version++;
    if(calendar.plannedReturn)v.plannedReturn=clone(calendar.plannedReturn);
    else delete v.plannedReturn;
    if(publish)w.reportVehicle(v);
    const next=calendar.nextCommitment;
    if(next&&next.startsAt>=w.now&&digest(previous??null)!==digest(next))
      w.schedule(next.startsAt,'calendar_commitment_start',{vehicle:v.id,id:next.id,startsAt:next.startsAt},3,
        `calendar-${v.id}-${next.id}-${next.startsAt}`);
    return clone(v.calendar);
  };
  const view=w.vehicleView.bind(w);
  w.vehicleView=v=>({...view(v),...(v.calendar?{calendar:clone(v.calendar)}:{})});
  w.vehicleMissionCalendar=(v,{resource,quantity,destination,remaining=false,commandReceived=false,includeCommand=false}={})=>{
    const c=v?.calendar;
    if(!c)return {feasible:true};
    if(c.availableAfter!==undefined && w.now<c.availableAfter)return {feasible:false,reason:'before_availability'};
    const known=w.state.observations[v.owner].edges, empty={...v,load:0,passengers:0},
      pickup=remaining?{edges:[],freeTimeMs:0}:route(w.state.map,v.node,resource.node,empty,known),
      delivery=route(w.state.map,remaining?v.node:resource.node,destination,{...v,load:quantity,resourceType:resource.type,passengers:0},known),
      back=c.nextCommitment?route(w.state.map,destination,c.nextCommitment.node,empty,known):{edges:[],freeTimeMs:0};
    if(!pickup||!delivery||!back)return {feasible:false,reason:'calendar_route_unknown'};
    const nominalCommand=includeCommand||(!remaining&&!commandReceived)?w.config.networkLatencyMs+Math.ceil(1000/w.config.bandwidthBytesPerSecond*1000):0,
      serviceAt=w.now+nominalCommand+pickup.freeTimeMs+(remaining?0:w.config.loadMs)+delivery.freeTimeMs+w.config.unloadMs,
      returnAt=serviceAt+back.freeTimeMs,
      fuelNeeded=[...pickup.edges,...delivery.edges,...back.edges].reduce((n,id)=>n+Math.ceil(w.edge(id).lengthM*(v.fuelMlPerKm??180)/1000),0);
    const reason=c.availableUntil!==undefined&&returnAt>=c.availableUntil?'availability_window':
      c.nextCommitment&&returnAt>c.nextCommitment.startsAt?'next_commitment':
      fuelNeeded>v.fuel?'calendar_fuel':null;
    return {feasible:!reason,reason,serviceAt,returnAt,fuelNeeded,calendarVersion:c.version};
  };
  w.vehicleWorkCalendar=(v,{pickup,destination,workMs=0,passengers=0,includeCommand=false}={})=>{
    const c=v?.calendar;if(!c)return {feasible:true};
    if(c.availableAfter!==undefined&&w.now<c.availableAfter)return {feasible:false,reason:'before_availability'};
    const known=w.state.observations[v.owner].edges,empty={...v,load:0,passengers:0},
      first=route(w.state.map,v.node,pickup??destination,empty,known),
      second=pickup?route(w.state.map,pickup,destination,{...empty,passengers},known):{edges:[],freeTimeMs:0},
      back=c.nextCommitment?route(w.state.map,destination,c.nextCommitment.node,empty,known):{edges:[],freeTimeMs:0};
    if(!first||!second||!back)return {feasible:false,reason:'calendar_route_unknown'};
    const nominalCommand=includeCommand?w.config.networkLatencyMs+Math.ceil(1000/w.config.bandwidthBytesPerSecond*1000):0,
      serviceAt=w.now+nominalCommand+first.freeTimeMs+second.freeTimeMs+workMs,returnAt=serviceAt+back.freeTimeMs,
      fuelNeeded=[...first.edges,...second.edges,...back.edges].reduce((n,id)=>n+Math.ceil(w.edge(id).lengthM*(v.fuelMlPerKm??180)/1000),0),
      reason=c.availableUntil!==undefined&&returnAt>=c.availableUntil?'availability_window':
        c.nextCommitment&&returnAt>c.nextCommitment.startsAt?'next_commitment':fuelNeeded>v.fuel?'calendar_fuel':null;
    return {feasible:!reason,reason,serviceAt,returnAt,fuelNeeded,calendarVersion:c.version};
  };
  const idle=org=>w.state.vehicles.find(v=>v.owner===org&&!v.background&&v.state==='idle'&&!v.load&&!v.passengers&&w.vehicleDriverAvailable?.(v)!==false),
    target=i=>i.target==='building'?w.building(i.id??i.entity)?.node:i.target==='need'?w.building(w.need(i.id??i.entity)?.building)?.node:
      i.target==='road'?w.edge(i.id??i.entity)?.from:w.resource(i.id??i.entity)?.node;
  for(const kind of ['verify','repair','evacuate']){
    const action=w.actionHandlers.get(kind);
    w.onAction(kind,(a,p,request)=>{
      const v=p.vehicle?w.vehicle(p.vehicle):idle(a.org);
      if(v?.owner===a.org&&v.state==='idle'&&!(kind==='verify'&&p.method==='clarification')){
        const destination=kind==='verify'?target(p):kind==='repair'?w.edge(p.edge)?.from:w.building(p.to)?.node;
        if(destination){const result=w.vehicleWorkCalendar(v,{destination,
          pickup:kind==='evacuate'?w.building(p.from)?.node:undefined,
          passengers:kind==='evacuate'?p.quantity:0,
          workMs:kind==='verify'?w.config.inspectionMs:kind==='repair'?2*w.config.setupMs:w.config.loadMs+w.config.unloadMs});
          check(result.feasible,'VEHICLE_CALENDAR',`Declared calendar prevents this task: ${result.reason}`);}
      }
      return action(a,p,request);
    });
  }
  const dispatch=w.actionHandlers.get('dispatch');
  w.onAction('dispatch',(a,p,request)=>{
    const t=p.transfer?w.state.transfers?.find(t=>t.id===p.transfer):null,
      r=w.resource(t?.resource??p.resource),v=w.vehicle(p.vehicle), n=w.need(p.need),
      destination=t?w.organization(t.to)?.node:p.destination??(n?w.building(n.building).node:null);
    if(v?.owner===a.org&&r&&destination){const result=w.vehicleMissionCalendar(v,{resource:r,quantity:t?.quantity??p.quantity,destination});
      check(result.feasible,'VEHICLE_CALENDAR',`Declared calendar prevents this mission: ${result.reason}`);}
    return dispatch(a,p,request);
  });
  const rerouteCalendar=(v,p,received=false)=>{
    const op=w.state.operations.find(o=>o.id===v.operation);
    if(!op||!v.calendar)return {feasible:true};
    if(['delivery','transfer'].includes(op.type)){
      const pickup=op.phase==='pickup',r=w.resource(op.resource);
      return w.vehicleMissionCalendar(v,{resource:r,quantity:op.quantity,
        destination:pickup?op.destination:p.destination,remaining:!pickup,
        commandReceived:received,includeCommand:!received});
    }
    const e=op.type==='evacuation'?w.state.evacuations.find(e=>e.id===op.evacuation):null;
    return w.vehicleWorkCalendar(v,{destination:e&&op.phase==='pickup'?w.building(e.to).node:p.destination,
      pickup:e&&op.phase==='pickup'?w.building(e.from).node:undefined,
      passengers:e?e.quantity:0,includeCommand:!received,
      workMs:op.type==='inspection'?w.config.inspectionMs:op.type==='repair'?2*w.config.setupMs:
        op.phase==='pickup'?w.config.loadMs+w.config.unloadMs:w.config.unloadMs});
  };
  const reroute=w.actionHandlers.get('reroute');
  w.onAction('reroute',(a,p,request)=>{
    const v=w.vehicle(p.vehicle);
    if(v?.owner===a.org){const result=rerouteCalendar(v,p);
      check(result.feasible,'VEHICLE_CALENDAR',`Declared calendar prevents this reroute: ${result.reason}`);}
    return reroute(a,p,request);
  });
  const applyReroute=w.applyReroute;
  w.applyReroute=(v,p)=>{
    const op=w.state.operations.find(o=>o.id===v.operation);
    if(op&&!['failed','cancelled','completed'].includes(op.state)&&
      (p.orderVersion??0)>=(v.receivedOrderVersion??0)){
      const result=rerouteCalendar(v,p,true);
      if(!result.feasible){
        v.receivedOrderVersion=p.orderVersion??0;
        v.order={type:'reroute',receivedAt:w.now,version:p.orderVersion,rejectedAt:w.now,
          reason:`vehicle_calendar:${result.reason}`};
        w.record('reroute_rejected',{vehicle:v.id,reason:v.order.reason},op.id);
        w.reportVehicle(v);w.reportOperation(op);return;
      }
    }
    return applyReroute(v,p);
  };
  const fail=(op,result)=>{
    const v=w.vehicle(op.vehicle),c=w.state.commitments.find(c=>c.id===op.commitment);
    if(c&&['confirmed','reserved'].includes(c.state)){
      release(w.resource(c.resource),c.quantity,c.staffReservation);c.state='released';c.version++;
    }
    op.state='failed';op.failure=`vehicle_calendar:${result.reason}`;op.times.failed=w.now;
    const t=w.state.transfers?.find(t=>t.id===op.transfer);
    if(t){t.state='failed';t.failure=op.failure;}
    v.operation=null;if(v.edge)v.pendingCancel=true;else v.state='idle';
    w.reportOperation(op);w.reportVehicle(v);
  };
  const taskFailure=(op,result)=>{
    const v=w.vehicle(op.vehicle);op.failure=`vehicle_calendar:${result.reason}`;op.times.failed=w.now;
    if(op.type==='evacuation'&&v.passengers){op.state='blocked';v.state='blocked';w.reportOperation(op);w.reportVehicle(v);return;}
    op.state='failed';v.state='idle';v.operation=null;
    const i=w.state.inspections.find(i=>i.operation===op.id),r=w.state.repairs?.find(r=>r.operation===op.id),
      e=w.state.evacuations?.find(e=>e.operation===op.id);
    if(i){w.releaseStaff(i.staff);i.state='inconclusive';i.failure=op.failure;
      w.send({kind:'verification',inspection:i.id,result:null,observedAt:w.now},i.org,{sector:w.sectorForNode(v.node)});}
    if(r){w.releaseStaff(r.staff);r.state='failed';r.failure=op.failure;}
    if(e){e.state='failed';e.failure=op.failure;w.need(e.need).inTransit-=e.quantity;w.building(e.to).reservedPlaces-=e.quantity;}
    w.reportOperation(op);w.reportVehicle(v);
  };
  const trip=w.startTrip;
  w.startTrip=(v,destination,op=null)=>{
    if(v.calendar&&op&&['inspection','repair','evacuation'].includes(op.type)){
      const e=op.type==='evacuation'?w.state.evacuations.find(e=>e.id===op.evacuation):null,
        result=w.vehicleWorkCalendar(v,{destination:e?w.building(e.to).node:destination,
          pickup:e&&op.phase==='pickup'?w.building(e.from).node:undefined,
          passengers:e?e.quantity:0,
          workMs:op.type==='inspection'?w.config.inspectionMs:op.type==='repair'?2*w.config.setupMs:
            op.phase==='pickup'?w.config.loadMs+w.config.unloadMs:w.config.unloadMs});
      if(!result.feasible){taskFailure(op,result);return false;}
    }
    return trip(v,destination,op);
  };
  const delivered=w.handlers.get('message_deliver');
  w.on('message_deliver',data=>{
    const m=w.lookup('messages',w.state.messages,data.id), op=m?.payload.kind==='command'
      ?w.state.operations.find(o=>o.id===m.payload.operation):null;
    delivered(data);
    if(op&&m.state==='delivered'&&!['failed','cancelled','completed'].includes(op.state)){
      const result=w.vehicleMissionCalendar(w.vehicle(op.vehicle),{resource:w.resource(op.resource),quantity:op.quantity,destination:op.destination,commandReceived:true});
      if(!result.feasible)fail(op,result);
    }
  });
  const load=w.handlers.get('load');
  w.on('load',p=>{
    const op=w.state.operations.find(o=>o.id===p.operation);
    if(op&&!['failed','cancelled','completed'].includes(op.state)){
      const result=w.vehicleMissionCalendar(w.vehicle(op.vehicle),{resource:w.resource(op.resource),quantity:op.quantity,destination:op.destination,remaining:true});
      if(!result.feasible){fail(op,result);return;}
    }
    load(p);
  });
  const returnAfterTask=op=>{
    const v=w.vehicle(op?.vehicle),next=v?.calendar?.nextCommitment;
    if(op?.state==='completed'&&v?.state==='idle'&&next&&v.node!==next.node){
      v._calendarReturning=true;w.startTrip(v,next.node);w.reportVehicle(v);
    }
  };
  const unload=w.handlers.get('unload');
  w.on('unload',p=>{
    const op=w.state.operations.find(o=>o.id===p.operation);unload(p);
    returnAfterTask(op);
  });
  for(const name of ['field_observe','repair_finish','evacuation_receive']){
    const handler=w.handlers.get(name);
    w.on(name,p=>{handler(p);const op=name==='field_observe'?w.state.operations.find(op=>op.id===w.state.inspections.find(i=>i.id===p.inspection)?.operation):
      name==='repair_finish'?w.state.operations.find(op=>op.repair===p.id):w.state.operations.find(op=>op.id===p.operation);returnAfterTask(op);});
  }
  const enter=w.handlers.get('vehicle_enter');
  w.on('vehicle_enter',p=>{
    enter(p);const v=w.vehicle(p.vehicle);
    if(v?._calendarReturning&&v.state==='arrived'){
      delete v._calendarReturning;v.state='idle';
      w.setVehicleCalendar(v,{...Object.fromEntries(Object.entries(v.calendar).filter(([k])=>!['version','observedAt','plannedReturn'].includes(k))),availableAfter:w.now});
    }
  });
  const intervention=w.handlers.get('lab_intervention');
  w.on('lab_intervention',p=>{
    if(p.kind==='vehicle_calendar'){
      w.setVehicleCalendar(w.vehicle(p.vehicle),p.calendar);w.record('vehicle_calendar_changed',{vehicle:p.vehicle});return;
    }
    intervention(p);
  });
  w.on('calendar_commitment_start',p=>{
    const v=w.vehicle(p.vehicle),next=v?.calendar?.nextCommitment;
    if(!next||next.id!==p.id||next.startsAt!==p.startsAt||v._calendarStarted===`${p.id}:${p.startsAt}`)return;
    v._calendarStarted=`${p.id}:${p.startsAt}`;
    const met=v.node===next.node&&['idle','arrived'].includes(v.state)&&!v.load&&!v.passengers&&!v.edge;
    w.record(met?'calendar_commitment_started':'calendar_commitment_missed',{vehicle:v.id,commitment:next.id});
    if(met){v.state='working';w.reportVehicle(v);}
  });
}
