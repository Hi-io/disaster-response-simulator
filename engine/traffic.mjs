import {route} from '../generators/map.mjs';

export function installTraffic(w){
  w.startTrip=(v,destination,operation=null)=>{
    const known=operation?w.state.observations[operation.org]?.edges:null;
    const path=route(w.state.map,v.node,destination,v,known);
    if(!path){v.state='blocked';if(operation){operation.state='failed';operation.failure='no_known_route';}w.record('trip_failed',{vehicle:v.id,reason:'no_known_route'},operation?.id);return false;}
    v.route=path.edges;v.routeIndex=0;v.destination=destination;v.operation=operation?.id??null;v.state='en_route';v.version++;v.eta=w.now+path.freeTimeMs;
    if(operation){operation.state='dispatched';operation.times.dispatched=w.now;operation.eta=v.eta;}
    w.record('vehicle_dispatched',{destination,distanceM:path.distanceM,eta:v.eta},v.id);
    w.schedule(w.now,'vehicle_enter',{vehicle:v.id},3,`enter-${v.id}-${v.version}`);return true;
  };
  w.on('vehicle_enter',({vehicle:id})=>{
    const v=w.vehicle(id);if(!v||['idle','arrived','failed','cancelled'].includes(v.state))return;
    if(v.edge)return;
    if(v.pendingDestination){v.route=route(w.state.map,v.node,v.pendingDestination,v,w.state.observations[v.owner]?.edges)?.edges??[];v.routeIndex=0;v.destination=v.pendingDestination;delete v.pendingDestination;}
    if(v.routeIndex>=v.route.length){v.state='arrived';w.record('vehicle_arrived',{node:v.node},v.id);if(v.operation){const op=w.state.operations.find(o=>o.id===v.operation);if(op&&!['cancelled','failed'].includes(op.state)){op.state='arrived';op.times.arrived=w.now;w.schedule(w.now+w.config.unloadMs,'unload',{operation:op.id},4,`unload-${op.id}`);}}else if(v.background){v.state='idle';}return;}
    const e=w.edge(v.route[v.routeIndex]);
    if(!e?.open||e.waterDepth>v.maxWaterDepth||v.weightKg>e.maxWeight){v.state='blocked';w.record('vehicle_blocked',{edge:e?.id??null},v.id);w.reportRoad?.(e,v.owner);return;}
    if(w.now>=v.shiftEnd||v.fuel<Math.ceil(e.lengthM/500)){v.state='failed';const op=w.state.operations.find(o=>o.id===v.operation);if(op){op.state='failed';op.failure='fuel_or_shift';}w.record('trip_failed',{reason:'fuel_or_shift'},v.id);return;}
    if(e.occupants.length>=e.storage||w.now<e.nextEntryAt){v.state='queued';if(!e.waiting.includes(v.id))e.waiting.push(v.id);w.schedule(Math.max(w.now+5000,e.nextEntryAt),'vehicle_enter',{vehicle:id},3,`queue-${id}-${w.now}`);return;}
    e.waiting=e.waiting.filter(x=>x!==v.id);e.occupants.push(v.id);e.nextEntryAt=w.now+e.headwayMs;
    v.edge=e.id;v.edgeStart=w.now;v.edgeEnd=w.now+Math.ceil(e.lengthM/Math.min(v.speedMps,e.speedMps)*1000)*(1+Math.max(0,e.occupants.length-e.capacity)/e.capacity);v.edgeEnd=Math.ceil(v.edgeEnd);v.state='en_route';
    w.schedule(v.edgeEnd,'vehicle_exit',{vehicle:id,edge:e.id},3,`exit-${id}-${w.now}`);
  });
  w.on('vehicle_exit',({vehicle:id,edge:idEdge})=>{
    const v=w.vehicle(id),e=w.edge(idEdge);if(!v||v.edge!==idEdge)return;
    e.occupants=e.occupants.filter(x=>x!==id);v.node=e.to;v.routeIndex++;v.fuel-=Math.ceil(e.lengthM/500);v.fuelUsed+=Math.ceil(e.lengthM/500);v.edge=null;v.edgeStart=null;v.edgeEnd=null;
    w.send({kind:'telemetry',vehicle:id,node:v.node,observedAt:w.now},v.owner,{sector:w.sectorForNode(v.node),target:id});
    if(v.pendingCancel){v.state='cancelled';w.record('vehicle_stopped',{node:v.node},id);delete v.pendingCancel;return;}
    w.schedule(w.now,'vehicle_enter',{vehicle:id},3,`continue-${id}-${w.now}`);
  });
  w.on('background_trip',({index})=>{
    const id=`traffic-${index}`;let v=w.vehicle(id);const nodes=w.state.map.nodes;
    if(!v){v={id,owner:'org0',node:nodes[Math.floor(w.random('traffic',id,'origin')*nodes.length)].id,capacity:1,weightKg:1500,speedMps:10,maxWaterDepth:.15,fuel:100000,fuelUsed:0,shiftEnd:w.config.durationMs,load:0,state:'idle',edge:null,lastGPS:{node:'',at:0},version:1,background:true};w.state.vehicles.push(v);}
    if(['idle','arrived'].includes(v.state)){const target=nodes[Math.floor(w.random('traffic',id,`target-${w.now}`)*nodes.length)].id;w.startTrip(v,target);}
    if(w.now+120000<w.config.durationMs)w.schedule(w.now+120000,'background_trip',{index},3,`background-${index}-${w.now}`);
  });
  w.vehiclePosition=v=>{
    const n=w.node(v.node);if(!v.edge)return {x:n.x,z:n.z};const e=w.edge(v.edge),to=w.node(e.to),f=Math.max(0,Math.min(1,(w.now-v.edgeStart)/(v.edgeEnd-v.edgeStart)));return {x:n.x+(to.x-n.x)*f,z:n.z+(to.z-n.z)*f};
  };
}
