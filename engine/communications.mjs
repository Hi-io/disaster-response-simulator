export function installCommunications(w){
  w.sectorForNode=node=>w.state.map.sectors.find(s=>s.node===node)?.id;
  w.connected=(sector,channel='internet')=>channel==='radio'||!sector||((w.sector(sector)?.coverage??1)>0&&w.sector(sector)?.energy!==false);
  w.send=(payload,to,{channel='internet',sector=null,target=null,ttlMs=3600000,bytes=1000}={})=>{
    const id=w.nextId('message');const m={id,payload:structuredClone(payload),to,channel,sector,target,bytes,createdAt:w.now,expiresAt:w.now+ttlMs,attempt:0,state:'queued',times:{created:w.now}};
    w.state.messages.push(m);w.schedule(w.now,'transmit',{id},2,`transmit-${id}`);return m;
  };
  w.on('transmit',({id})=>{
    const m=w.state.messages.find(x=>x.id===id);if(!m||['delivered','expired','failed'].includes(m.state))return;
    if(w.now>m.expiresAt){m.state='expired';m.expired=true;w.record('message_expired',{kind:m.payload.kind,target:m.target},id);return;}
    if(!w.connected(m.sector,m.channel)||(!w.organization(m.to)?.connected&&w.organization(m.to))){m.state='offline';w.schedule(w.now+30000,'transmit',{id},2,`retry-offline-${id}-${w.now}`);return;}
    m.attempt++;m.state='transmitting';m.times.transmitted=w.now;
    const active=w.state.messages.filter(x=>x.state==='transmitting').length;
    const congestion=Math.floor(active/w.config.networkCapacity)*5000;
    const latency=w.config.networkLatencyMs+(m.channel==='radio'?10000:0)+Math.ceil(m.bytes/10000)*1000+congestion;
    if(w.random('communications',id,'loss',m.attempt)<w.config.packetLoss){m.state='retrying';w.record('packet_lost',{attempt:m.attempt},id);w.schedule(w.now+latency+5000,'transmit',{id},2,`loss-retry-${id}-${m.attempt}`);return;}
    w.schedule(w.now+latency,'message_deliver',{id},2,`deliver-${id}-${m.attempt}`);
  });
  w.on('message_deliver',({id})=>{
    const m=w.state.messages.find(x=>x.id===id);if(!m||m.state==='delivered')return;
    if(!w.connected(m.sector,m.channel)){m.state='offline';w.schedule(w.now+30000,'transmit',{id},2,`retry-receive-${id}-${w.now}`);return;}
    if(w.now>m.expiresAt){m.state='expired';m.expired=true;return;}
    m.state='delivered';m.times.delivered=w.now;w.record('message_delivered',{kind:m.payload.kind,to:m.to,target:m.target},id);
    const p=m.payload;
    if(p.kind==='post')w.publishPost(p.post);
    else if(p.kind==='telemetry'){const v=w.vehicle(p.vehicle);if(v){v.lastGPS={node:p.node,at:p.observedAt};w.state.observations[m.to].vehicles[v.id]=w.vehicleView(v);}}
    else if(p.kind==='road'){const e=w.edge(p.edge);if(e)w.state.observations[m.to].edges[e.id]={open:p.open,waterDepth:p.waterDepth,version:p.version,at:p.observedAt};}
    else if(p.kind==='command'){const op=w.state.operations.find(o=>o.id===p.operation);if(op&&!['failed','cancelled'].includes(op.state)){op.times.orderReceived=w.now;w.schedule(w.now+w.config.loadMs,'load',{operation:op.id},4,`load-${op.id}`);}}
    else if(p.kind==='reroute'){const v=w.vehicle(p.vehicle);if(v){v.pendingDestination=p.destination;v.order={type:'reroute',receivedAt:w.now};if(!v.edge){v.state='en_route';w.schedule(w.now,'vehicle_enter',{vehicle:v.id},3,`reroute-enter-${v.id}-${w.now}`);}w.record('reroute_received',{destination:p.destination},v.id);}}
    else if(p.kind==='cancel'){const v=w.vehicle(p.vehicle);if(v){v.pendingCancel=true;if(!v.edge){v.state='cancelled';delete v.pendingCancel;}w.record('cancel_received',{},v.id);}}
    else if(p.kind==='share'){w.receiveShare(m.to,p);}
    else if(p.kind==='verification'){w.completeVerification(p);}
  });
  w.reportRoad=(edge,org)=>{if(edge)w.send({kind:'road',edge:edge.id,open:edge.open,waterDepth:edge.waterDepth,version:edge.version,observedAt:w.now},org,{sector:w.sectorForNode(edge.from)});};
}
