import http from 'node:http';import path from 'node:path';import {readFile,writeFile,mkdir} from 'node:fs/promises';import {randomBytes,timingSafeEqual} from 'node:crypto';import {fileURLToPath} from 'node:url';
import {World} from '../engine/world.mjs';import {SCENARIOS} from '../scenarios/catalog.mjs';import {PRESETS} from '../content/presets.mjs';import {SimError} from '../contracts/actions.mjs';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
async function body(req){let text='';for await(const chunk of req){text+=chunk;if(text.length>2_000_000)throw new SimError('BODY_LIMIT','Request too large',413);}try{return text?JSON.parse(text):{};}catch{throw new SimError('JSON','Invalid JSON');}}
function sourceHTML(title,posts,next=null){return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(title)} · Signal</title><style>body{font:16px system-ui;background:#f2f4f8;color:#172332;max-width:760px;margin:40px auto;padding:0 24px}a{color:#405cda}article{background:white;border:1px solid #dde2ea;border-radius:16px;padding:22px;margin:16px 0}header{display:flex;justify-content:space-between}small{color:#6b7484}.media{background:#e6e9ef;border-radius:10px;padding:20px;margin-top:15px}input{padding:12px;border:1px solid #ccd2dc;border-radius:8px}nav{display:flex;gap:20px}</style></head><body><nav><strong>◉ Signal</strong><a href="/feed">Timeline</a><a href="/search">Search</a><a href="/public">Relief updates</a></nav><h1>${esc(title)}</h1><p><small>Fictional disaster information source. Posts may be inaccurate.</small></p><form action="/search"><input name="q" placeholder="Search reports"><button>Search</button></form>${posts.map(p=>`<article data-post-id="${esc(p.id)}" data-version="${p.version}"><header><a href="/users/${esc(p.authorId)}">${esc(p.authorName)}</a><small>${new Date(Date.UTC(2026,0,1)+p.publishedAt).toISOString()}</small></header><p>${esc(p.text)}</p>${p.attachments.map(m=>`<div class="media" data-media-kind="${esc(m.kind)}">${m.kind==='video'?'▶':m.kind==='audio'?'◖':'▧'} ${esc(m.kind)} ${m.duration?`· ${m.duration}s`:''}<p>${esc(m.description)}</p></div>`).join('')}<small>${esc(p.location)} · ${p.likes} reactions · <a href="/posts/${esc(p.id)}">Permalink</a></small>${p.references.map(id=>` <a href="/posts/${esc(id)}">Referenced post</a>`).join('')}</article>`).join('')}${next!==null?`<a rel="next" href="/feed?cursor=${next}">Older posts →</a>`:''}</body></html>`;}

export async function createLabServers({config={},observerPort=4318,sourcePort=4319,observerKey=randomBytes(24).toString('hex'),actorKeys=null,persistCredentials=true}={}){
  let world=new World(config),playing=false,rate=10,previous=performance.now(),effective=0;
  actorKeys??=Object.fromEntries(world.state.map.organizations.map(o=>[randomBytes(24).toString('hex'),{id:`external-${o.id}`,org:o.id,role:'agent'}]));
  const tick=setInterval(()=>{const now=performance.now(),wall=now-previous;previous=now;if(!playing)return;const before=world.now;try{world.advance(Math.min(world.config.durationMs,Math.round(world.now+wall*rate)),{maxEvents:2500});effective=wall?(world.now-before)/wall:0;if(world.now>=world.config.durationMs)playing=false;}catch(e){playing=false;world.record('runtime_error',{message:e.message});}},80);
  tick.unref();
  const authorizeObserver=req=>{
    const bearer=req.headers.authorization?.replace(/^Bearer /,'');const cookie=req.headers.cookie?.match(/(?:^|; )observer=([^;]+)/)?.[1];
    if(!equal(bearer??cookie,observerKey))throw new SimError('OBSERVER_AUTH','Observer authentication required',401);
  };
  const requireSameOrigin=req=>{if(req.headers.origin&&!['http://127.0.0.1:'+observerPort,'http://localhost:'+observerPort].includes(req.headers.origin))throw new SimError('ORIGIN','Cross-origin mutation denied',403);};
  const observer=http.createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,'http://localhost');
      if(url.pathname==='/api/login'&&req.method==='POST'){requireSameOrigin(req);const b=await body(req);if(!equal(b.key,observerKey))throw new SimError('LOGIN','Invalid observer key',401);res.setHeader('Set-Cookie',`observer=${observerKey}; HttpOnly; SameSite=Strict; Path=/`);return json(res,200,{authenticated:true});}
      if(url.pathname.startsWith('/api/')){
        authorizeObserver(req);if(req.method==='POST')requireSameOrigin(req);
        if(url.pathname==='/api/state')return json(res,200,{...world.observer(),playing,rate,effectiveRate:effective,sourceUrl:`http://127.0.0.1:${sourcePort}`});
        if(url.pathname==='/api/catalog')return json(res,200,{scenarios:SCENARIOS,presetCount:PRESETS.length});
        const b=req.method==='POST'?await body(req):{};
        if(url.pathname==='/api/config'){world=new World(b);playing=false;return json(res,200,{runId:world.runId});}
        if(url.pathname==='/api/control'){if(b.rate!==undefined){if(![1,10,100,1000].includes(b.rate))throw new SimError('RATE','Invalid speed');rate=b.rate;}if(b.play!==undefined)playing=!!b.play;if(b.step){playing=false;world.step();}if(b.advanceTo!==undefined){playing=false;world.advance(b.advanceTo);}return json(res,200,{playing,rate,now:world.now});}
        if(url.pathname==='/api/action'){const org=b.org??'org0';return json(res,200,world.act({id:`human-${org}`,org,role:'commander'},b.action));}
        if(url.pathname==='/api/inject'){if(!['damage','road_change','intervention','scenario_signal','fire_front','flood_level'].includes(b.type))throw new SimError('EVENT','Event type not allowed');world.schedule(world.now,b.type,b.data??{},0,`manual-${world.nextId('intervention')}`);world.step();return json(res,200,{injected:true});}
        if(url.pathname==='/api/checkpoint')return json(res,200,world.checkpoint());
        if(url.pathname==='/api/restore'){world=new World(b.manifest.config,b);playing=false;return json(res,200,{restored:true,runId:world.runId});}
        if(url.pathname==='/api/metrics')return json(res,200,world.observer().metrics);
        if(url.pathname==='/api/credentials')return json(res,200,{actors:actorKeys,sourceUrl:`http://127.0.0.1:${sourcePort}`});
        throw new SimError('NOT_FOUND','Endpoint not found',404);
      }
      let file=url.pathname==='/'?'viewer/index.html':url.pathname.startsWith('/vendor/')?'node_modules/three/'+url.pathname.slice(8):'viewer/'+url.pathname.slice(1);
      const resolved=path.resolve(root,file);if(!resolved.startsWith(root+path.sep)||file.includes('..'))throw new SimError('PATH','Invalid path',403);
      const data=await readFile(resolved);const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};res.writeHead(200,{'Content-Type':mime[path.extname(resolved)]??'application/octet-stream','X-Content-Type-Options':'nosniff'});res.end(data);
    }catch(e){json(res,e.status??(e.code==='ENOENT'?404:500),{error:e.code??'ERROR',message:e.status?e.message:'Observer request failed'});}
  });
  const sources=http.createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,'http://localhost');let params=Object.fromEntries(url.searchParams);for(const k of ['cursor','limit','since'])if(k in params){params[k]=Number(params[k]);if(!Number.isSafeInteger(params[k])||params[k]<0)throw new SimError('PAGINATION','Invalid pagination');}
      if(url.pathname.startsWith('/api/actor')){
        const key=req.headers.authorization?.replace(/^Bearer /,''),actor=actorKeys[key];if(!actor)throw new SimError('AUTHENTICATION','Actor key required',401);
        if(url.pathname==='/api/actor/state')return json(res,200,world.actorView(actor.org));
        if(url.pathname==='/api/actor/action')return json(res,200,world.act(actor,await body(req)));
        if(url.pathname==='/api/actor/queries')return json(res,200,{queries:(world.state.queries??[]).filter(q=>q.org===actor.org)});
        if(url.pathname==='/api/actor/ingestion'){const b=await body(req),post=world.publicFeed({limit:100}).posts.find(p=>p.id===b.id)??world.state.posts.find(p=>p.public.id===b.id&&p.indexAt<=world.now&&!p.deleted)?.public;if(!post)throw new SimError('SOURCE','Post not accessible',404);if(!['downloaded','accepted','interpreted','discarded'].includes(b.stage))throw new SimError('STAGE','Invalid ingestion stage');const receipt={id:b.id,org:actor.org,stage:b.stage,reason:b.reason??null,at:world.now,version:post.version};world.state.ingestion.push(receipt);return json(res,200,receipt);}
        throw new SimError('NOT_FOUND','Actor endpoint not found',404);
      }
      if(url.pathname.startsWith('/api/observer')||url.pathname.startsWith('/api/state'))throw new SimError('NOT_FOUND','Not found',404);
      if(url.pathname==='/api/feed')return json(res,200,world.publicFeed(params));
      if(url.pathname==='/public') {res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(sourceHTML('Relief updates',world.state.publicUpdates.map(u=>({id:u.id,authorId:u.organization,authorName:u.organization,text:u.text,format:'text',publishedAt:u.at,location:null,likes:0,version:1,attachments:[],references:[]}))));}
      if(['/','/feed','/search'].includes(url.pathname)){const feed=world.publicFeed(params);res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(sourceHTML(url.pathname==='/search'?'Search results':'Community signals',feed.posts,feed.nextCursor));}
      if(url.pathname.startsWith('/posts/')){const id=url.pathname.slice(7),post=world.state.posts.find(p=>p.public.id===id&&p.public.publishedAt!==null&&p.indexAt<=world.now&&!p.deleted);if(!post)throw new SimError('NOT_FOUND','Post not found',404);res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(sourceHTML('Community report',[post.public]));}
      if(url.pathname.startsWith('/users/')){const feed=world.publicFeed({...params,author:url.pathname.slice(7)});res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(sourceHTML('Resident reports',feed.posts));}
      throw new SimError('NOT_FOUND','Not found',404);
    }catch(e){json(res,e.status??500,{error:e.code??'ERROR',message:e.status?e.message:'Source request failed'});}
  });
  await Promise.all([new Promise(resolve=>observer.listen(observerPort,'127.0.0.1',resolve)),new Promise(resolve=>sources.listen(sourcePort,'127.0.0.1',resolve))]);
  const actualObserver=observer.address().port,actualSource=sources.address().port;
  if(persistCredentials){await mkdir(path.join(root,'.local'),{recursive:true});await writeFile(path.join(root,'.local','session.json'),JSON.stringify({observerKey,actors:actorKeys,observerUrl:`http://127.0.0.1:${actualObserver}`,sourceUrl:`http://127.0.0.1:${actualSource}`},null,2));}
  return {observer,sources,observerKey,actorKeys,get world(){return world;},observerPort:actualObserver,sourcePort:actualSource,async close(){clearInterval(tick);await Promise.all([new Promise(r=>observer.close(r)),new Promise(r=>sources.close(r))]);}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const lab=await createLabServers();console.log(`Observer: http://127.0.0.1:${lab.observerPort}\nSources: http://127.0.0.1:${lab.sourcePort}\nObserver access and actor keys are saved in ignored .local/session.json.`);
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await lab.close();process.exit(0);});
}
