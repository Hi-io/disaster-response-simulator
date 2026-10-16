import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createLabServers } from '../sources/server.mjs';
import { observerCookieName } from '../sources/observer-session.mjs';
const config={seed:'observer-browser-origin',scenario:'S16',topology:'grid',grid:3,extentKm:2,
  hazard:'none',policy:'none',backgroundTraffic:0,postsPerHour:0,packetLoss:0,logMode:'full',healthReports:false,recurringNeeds:false};
for(const isolated of [false,true])test(`${isolated?'isolated':'inline'} observers accept their real ephemeral origin and preserve independent browser sessions`,async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'aidscaler-observer-session-'));
  const labs=[];
  try {
    for(let i=0;i<2;i++)labs.push(await createLabServers({isolated,config,observerPort:0,sourcePort:0,
      persistCredentials:false,storageDir:path.join(root,String(i))}));
    const base=labs.map(l=>`http://127.0.0.1:${l.observerPort}`),cookies=[];
    for(let i=0;i<2;i++){
      const r=await fetch(base[i]+'/api/login',{method:'POST',headers:{Origin:base[i],'Content-Type':'application/json'},body:JSON.stringify({key:labs[i].observerKey})});
      assert.equal(r.status,200,await r.text());
      const c=r.headers.get('set-cookie');assert.match(c,/HttpOnly; SameSite=Strict/);
      assert(c.startsWith(observerCookieName(labs[i].observerPort)+'='));cookies.push(c.split(';')[0]);
    }
    assert.notEqual(cookies[0].split('=')[0],cookies[1].split('=')[0]);
    for(let i=0;i<2;i++){
      assert.equal((await fetch(base[i]+'/api/catalog',{headers:{Cookie:cookies.join('; ')}})).status,200);
      assert.equal((await fetch(base[i]+'/api/catalog',{headers:{Cookie:`observer=${labs[i].observerKey}`}})).status,200,'existing own legacy session remains valid');
      assert.equal((await fetch(base[i]+'/api/catalog',{headers:{Cookie:`${observerCookieName(labs[i].observerPort)}=wrong; observer=${labs[i].observerKey}`}})).status,401,'invalid scoped credential cannot fall back');
      assert.equal((await fetch(base[i]+'/api/login',{method:'POST',headers:{Origin:base[1-i],'Content-Type':'application/json'},body:JSON.stringify({key:labs[i].observerKey})})).status,403,'another local origin is still forbidden');
    }
  }finally{
    await Promise.all(labs.map(l=>l.close()));
    const resolved=path.resolve(root);
    assert(resolved.startsWith(path.resolve(os.tmpdir())+path.sep));
    await rm(resolved,{recursive:true,force:true});
  }
});
