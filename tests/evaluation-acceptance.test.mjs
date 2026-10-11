import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../engine/world.mjs';
import { evaluate } from '../evaluation/metrics.mjs';
import { pairedComparison } from '../evaluation/runs.mjs';
import { createLabServers } from '../sources/server.mjs';
const config = { policy:'none', grid:3, extentKm:1, topology:'grid', hazard:'none', postsPerHour:0, backgroundTraffic:0, scenario:'S01', packetLoss:0 };
test('future deadlines are pending, not missed; overdue unfinished cases are censored', () => {
  const w = new World(config);
  const b = w.state.map.buildings[0];
  w.state.needs.push({id:'deadline-test',building:b.id,type:'water',unit:'L',quantity:600,served:0,pendingIntegral:0,integratedAt:0,createdAt:0,deadline:3000,completedAt:null,silent:true});
  let rows = evaluate(w).subgroups.silent.true.water;
  assert.equal(rows.missedDeadline,0); assert.equal(rows.pendingBeforeDeadline,1);
  w.now=3000; rows = evaluate(w).subgroups.silent.true.water;
  assert.equal(rows.missedDeadline,1); assert.equal(rows.rightCensored,1); w.close();
});
test('different measurement clocks cannot be paired', () => {
  const row={seed:'s',scenario:'S01',variant:'standard',config:{mode:'live',clockLatency:'wall'},metrics:{services:{}}};
  assert.throws(()=>pairedComparison([row],[{...row,config:{mode:'modeled',clockLatency:'modeled'}}]),/different initial/);
});
test('real provider receipt retains exact model identity and monetary cost', () => {
  const w=new World(config), a={id:'model',org:'org0',role:'agent'};
  const j=w.startModelCall(a,{model:'google/gemma-4-31b-it'});
  w.finishModelCall(a,{id:j.id,providerCost:0.001,providerRequestId:'provider-123',wallMs:100});
  w.advance(5000); assert.equal(evaluate(w).modelUsage.providerCost,0.001); w.close();
});
test('operators receive limited credentials, without observer privileges, and can be revoked', async t => {
  const lab=await createLabServers({config,observerPort:0,sourcePort:0,persistCredentials:false}); t.after(()=>lab.close());
  const base=`http://127.0.0.1:${lab.observerPort}`,source=`http://127.0.0.1:${lab.sourcePort}`;
  const request=await fetch(base+'/api/actors/provision',{method:'POST',headers:{Authorization:`Bearer ${lab.observerKey}`,'Content-Type':'application/json'},body:JSON.stringify({org:'org0',role:'commander'})});
  assert.equal(request.status,201); const {key}=await request.json();
  assert.equal((await fetch(base+'/api/state',{headers:{Authorization:`Bearer ${key}`}})).status,401);
  const state=await (await fetch(source+'/api/actor/state',{headers:{Authorization:`Bearer ${key}`}})).json();
  assert.equal(state.organization.id,'org0'); assert.equal(state.state,undefined);
  await fetch(base+'/api/actors/revoke',{method:'POST',headers:{Authorization:`Bearer ${lab.observerKey}`,'Content-Type':'application/json'},body:JSON.stringify({key})});
  assert.equal((await fetch(source+'/api/actor/state',{headers:{Authorization:`Bearer ${key}`}})).status,401);
});
