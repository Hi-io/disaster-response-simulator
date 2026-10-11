import {choosePreset,FAMILY_IDS} from '../content/presets.mjs';

export function installInformation(w){
  w.generateSignal=(family,ctx={})=>{
    if(w.state.posts.length>=w.config.maxPosts)return null;
    const key=ctx.causeEvent??`ambient-${w.nextId('signal')}`;
    const preset=choosePreset(family,w.config.split,w.random('publication',key,'preset'));
    if(preset.requires&&!ctx.causeEvent&&!ctx.false)return null;
    const id=w.publicId('post',`${key}-${family}-${w.nextId('post')}`);
    const isFalse=ctx.false??(w.random('publication',key,'false')<w.config.falseRate);
    const building=ctx.building??w.state.map.shelterId;const b=w.building(building);
    const text=ctx.text??preset.text.replaceAll('{place}',b?.id??'the neighbourhood').replaceAll('{quantity}',String(ctx.quantity??300));
    const format=ctx.type??preset.format;
    const post={public:{id,authorId:w.publicId('author',ctx.author??building),authorName:ctx.authorName??`Resident ${id.slice(0,4)}`,text,format,publishedAt:null,claimedAt:ctx.claimedAt??null,location:ctx.location??b?.id??null,language:ctx.language??(w.config.language==='es'?'es':'en'),references:ctx.references??[],likes:Math.floor(w.random('diffusion',id,'likes')*30),version:1,attachments:format==='text'?[]:[{id:w.publicId('media',id),kind:format,duration:format==='video'?18:format==='audio'?24:null,description:ctx.mediaDescription??text,caption:ctx.caption??'',bytesSimulated:format==='video'?10000000:format==='audio'?600000:300000}]},private:{family,preset:preset.id,false:isFalse,truthCategory:ctx.truthCategory??(isFalse?'incorrect':'unverified'),causeEvent:ctx.causeEvent??null,actualLocation:building,createdAt:w.now,original:ctx.original??id},indexAt:null,deleted:false,history:[]};
    w.state.posts.push(post);w.record('signal_created',{id,family,false:isFalse,format},building);
    w.send({kind:'post',post:id},'public',{sector:ctx.sector??b?.sector,bytes:format==='video'?10000000:format==='audio'?600000:1000});return post;
  };
  w.publishPost=id=>{const p=w.state.posts.find(p=>p.public.id===id);if(!p||p.public.publishedAt!==null)return;p.public.publishedAt=w.now;p.indexAt=w.now+w.config.sourceIndexMs;p.history.push(structuredClone(p.public));w.record('post_published',{id,format:p.public.format},p.private.actualLocation);
    if(w.random('diffusion',id,'repost')<.25)w.schedule(w.now+60000,'repost',{id},2,`repost-${id}`);
  };
  w.on('initial_report',({need:id})=>{const n=w.need(id);if(!n||n.silent)return;for(const org of w.state.map.organizations)if(org.id==='org0')w.observeNeed(org.id,n);w.generateSignal('P01',{building:n.building,quantity:n.quantity,text:`At ${n.building}, ${n.population} people need ${n.quantity} ${n.unit} of ${n.type}.`,false:false,causeEvent:`need-${id}-${w.now}`});});
  w.on('ambient_posts',({batch})=>{
    const interval=30000,count=Math.max(1,Math.round(w.config.postsPerHour*interval/3600000));
    for(let i=0;i<count;i++){
      const key=`${batch}-${i}`, building=w.state.map.buildings[Math.floor(w.random('publication',key,'building')*w.state.map.buildings.length)];
      const suitable=FAMILY_IDS.filter(f=>!['P12','P19','P21'].includes(f));const family=suitable[Math.floor(w.random('publication',key,'family')*suitable.length)];
      w.generateSignal(family,{building:building.id,causeEvent:`ambient-${key}`});
    }
    if(w.now+interval<=w.config.durationMs&&w.state.posts.length<w.config.maxPosts)w.schedule(w.now+interval,'ambient_posts',{batch:batch+1},2,`ambient-${batch+1}`);
  });
  w.on('repost',({id})=>{const p=w.state.posts.find(p=>p.public.id===id);if(!p)return;w.generateSignal('P17',{building:p.private.actualLocation,text:p.public.text,references:[id],original:p.private.original,false:p.private.false,truthCategory:p.private.truthCategory,causeEvent:`repost-${id}`});});
  w.on('post_update',({id,text,deleted=false})=>{const p=w.state.posts.find(p=>p.public.id===id);if(!p)return;p.history.push(structuredClone(p.public));p.public.version++;p.public.text=text??p.public.text;p.deleted=deleted;p.indexAt=w.now+w.config.sourceIndexMs;w.record('post_updated',{id,version:p.public.version,deleted});});
  w.publicFeed=({q='',cursor=0,limit=30,author=null,location=null,since=0}={})=>{
    const filtered=w.state.posts.filter(p=>p.public.publishedAt!==null&&p.indexAt<=w.now&&!p.deleted&&p.public.publishedAt>=since&&(!q||p.public.text.toLowerCase().includes(q.toLowerCase()))&&(!author||p.public.authorId===author)&&(!location||p.public.location===location));
    filtered.sort((a,b)=>b.public.publishedAt-a.public.publishedAt||a.public.id.localeCompare(b.public.id));
    return {posts:filtered.slice(cursor,cursor+Math.min(100,limit)).map(p=>structuredClone(p.public)),nextCursor:cursor+limit<filtered.length?cursor+limit:null,total:filtered.length,now:w.now};
  };
}
