import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../engine/world.mjs';
import { replay } from '../evaluation/runs.mjs';
import { validateConfig } from '../contracts/config.mjs';
import { createLabServers } from '../sources/server.mjs';

const config = { scenario:'S23', seed:'supplier-partials', policy:'none', hazard:'none',
  topology:'grid', grid:5, extentKm:2, durationMs:3600000, postsPerHour:0,
  backgroundTraffic:0, packetLoss:0, recurringNeeds:false, healthReports:false,
  queryLatencyMs:1000, networkLatencyMs:1000,
  supply:{ purchaseTranches:[{ fraction:0.6, delayMs:10000 }, { fraction:0.4, delayMs:20000 }] } };
let serial = 0;
const act = (w, type, params, org='org0', role='commander', key=`procurement-${++serial}`) =>
  w.act({ id:`buyer-${org}`, org, role }, { type, params, idempotencyKey:key });
const buy = w => act(w, 'purchase', { type:'water', quantity:10, price:2, currency:'sandbox_credit' });
const purchase = (w,id) => w.state.purchases.find(p => p.id===id);
function query(w, org='org0') { const q=act(w,'query',{target:'finance'},org,'agent');
  let n=0; while(w.state.queries.find(x=>x.id===q.id).state!=='ready' && n++<1000) assert.ok(w.step());
  const result=w.state.queries.find(x=>x.id===q.id).result; assert.ok(result); return result; }
function clean(w) { w.advance(w.now); assert.deepEqual(w.invariants(),[]);
  const r=replay(w.checkpoint()); assert.equal(r.matches,true); r.world.close(); w.close(); }

test('supplier-authored six then four native-unit receipts create only physically received stock and scoped finance', () => {
  const w=new World(config), r=w.resource('r-org0-water'), stock=r.quantity, balance=w.organization('org0').funds;
  const p=buy(w);
  assert.equal(p.currency,'sandbox_credit'); assert.equal(p.unit,'L'); assert.equal(p.receivedQuantity,0);
  assert.equal(p.nextArrivalAt,10000); assert.equal(p.expectedArrivalAt,20000); assert.equal(p._tranches,undefined);
  assert.equal(r.quantity,stock); assert.equal(w.organization('org0').funds,balance-20);
  w.advance(10000);
  assert.equal(r.quantity,stock+6); assert.equal(purchase(w,p.id).receivedQuantity,6);
  assert.equal(purchase(w,p.id).state,'partial'); assert.equal(w.need('need-water-main').served,0);
  const partial=query(w);
  assert.equal(partial.currency,'sandbox_credit'); assert.equal(partial.balance,balance-20);
  assert.equal(partial.purchases[0].nextArrivalAt,20000); assert.equal(partial.purchases[0].receivedQuantity,6);
  assert.equal(partial.purchases[0]._tranches,undefined); assert.equal(partial.purchases[0]._terminalState,undefined);
  assert.ok(partial.entries.every(e=>e.org==='org0')); assert.equal(w.actorView('org0').known.finance.purchases[0].receivedQuantity,6);
  const other=query(w,'org1'); assert.deepEqual(other.purchases,[]); assert.deepEqual(other.entries,[]);
  assert.throws(()=>act(w,'query',{target:'finance',org:'org0'},'org1','agent'),{code:'FORBIDDEN'});
  w.advance(20000); const complete=query(w);
  assert.equal(r.quantity,stock+10); assert.equal(complete.purchases[0].receivedQuantity,10);
  assert.equal(complete.purchases[0].state,'received'); assert.equal(complete.purchases[0].nextArrivalAt,null);
  assert.deepEqual(complete.purchases[0].receipts.map(x=>x.quantity),[6,4]);
  const materialVersion=complete.version; assert.equal(query(w).version,materialVersion,'Polling does not mint a material finance version');
  clean(w);
});

test('a disconnected buyer receives a partial/full snapshot only after delivery and stale equal-clock versions cannot regress it', () => {
  const w=new World(config), p=buy(w), initial=query(w), sector=w.sectorForNode(w.organization('org0').node);
  w.inject('intervention',{type:'cut',sector,duration:40000}); w.advance(25000);
  assert.equal(purchase(w,p.id).receivedQuantity,10);
  assert.equal(w.actorView('org0').known.finance.purchases[0].receivedQuantity,0);
  assert.equal(w.actorView('org0').known.finance.version,initial.version);
  w.advance(60000);
  const current=w.actorView('org0').known.finance;
  assert.equal(current.purchases[0].receivedQuantity,10);
  w.receiveFinance('org0',{...initial,observedAt:current.observedAt});
  assert.equal(w.actorView('org0').known.finance.purchases[0].receivedQuantity,10);
  clean(w);
});

test('receipt retries and checkpoints do not duplicate goods, spend or supplier quantities', () => {
  const w=new World(config), stock=w.resource('r-org0-water').quantity;
  const p=act(w,'purchase',{type:'water',quantity:10,price:2},'org0','commander','same-order');
  assert.deepEqual(act(w,'purchase',{type:'water',quantity:10,price:2},'org0','commander','same-order'),p);
  w.advance(10000); const checkpoint=w.checkpoint(), fork=new World(config,checkpoint);
  // The already consumed transport/event callback is retried with its original
  // identifier; its material result and physical ledger must stay unchanged.
  w.handlers.get('purchase_receive')({id:p.id,tranche:`${p.id}-tranche-0`});
  assert.equal(w.resource('r-org0-water').quantity,stock+6);
  assert.equal(purchase(w,p.id).receipts.length,1);
  w.advance(40000); fork.advance(40000); assert.equal(w.stateHash(),fork.stateHash());
  assert.equal(w.state.fundEntries.filter(e=>e.type==='spent'&&e.reference===p.id).length,1);
  fork.close(); clean(w);
});

test('incomplete/backordered or failed supply does not manufacture missing stock or refund prepaid funds', () => {
  for (const terminal of ['backordered','failed']) {
    const c={...config,supply:{purchaseTranches:[{fraction:0.6,delayMs:10000}],purchaseTerminalState:terminal}},
      w=new World(c), stock=w.resource('r-org0-water').quantity, balance=w.organization('org0').funds;
    const p=buy(w); w.advance(12000); const current=query(w);
    assert.equal(current.purchases[0].state,terminal); assert.equal(current.purchases[0].receivedQuantity,6);
    assert.equal(current.purchases[0].nextArrivalAt,null); assert.equal(w.resource('r-org0-water').quantity,stock+6);
    assert.equal(w.organization('org0').funds,balance-20); assert.equal(w.need('need-water-main').served,0);
    assert.deepEqual(w.invariants(),[]); clean(w);
  }
});

test('actors cannot choose receipts, currencies, tranche schedules or supplier outcomes and malformed source presets fail early', () => {
  const w=new World(config), funds=w.organization('org0').funds;
  for (const extra of [{receivedQuantity:10},{purchaseTranches:[{fraction:1,delayMs:1000}]},{state:'received'}])
    assert.throws(()=>act(w,'purchase',{type:'water',quantity:10,price:2,...extra}),{code:'PURCHASE_SCHEMA'});
  assert.throws(()=>act(w,'purchase',{type:'water',quantity:10,price:2,currency:'USD'}),{code:'CURRENCY'});
  for (const leadMs of [Number.MAX_SAFE_INTEGER,604800001])
    assert.throws(()=>act(w,'purchase',{type:'water',quantity:10,price:2,leadMs}),{code:'LEAD_TIME'});
  assert.throws(()=>act(w,'purchase',{type:'water',quantity:10,price:2,leadMs:-1}),{code:'PARAMETER'});
  assert.throws(()=>act(w,'purchase',{type:'water',quantity:10,price:2},'org0','agent'),{code:'FORBIDDEN'});
  assert.equal(w.organization('org0').funds,funds); assert.equal(w.state.purchases.length,0);
  for (const purchaseTranches of [[],[{fraction:2,delayMs:1000}], [{fraction:.7,delayMs:2000},{fraction:.7,delayMs:3000}],
    [{fraction:.6,delayMs:2000},{fraction:.4,delayMs:1000}], [{fraction:1,delayMs:.5}]])
    assert.throws(()=>validateConfig({...config,supply:{purchaseTranches}}));
  clean(w);
});

test('fractional supplier schedules preserve the full exact order despite floating-point accumulation', () => {
  const w=new World({...config,supply:{purchaseTranches:Array.from({length:10},(_,i)=>({fraction:.1,delayMs:(i+1)*1000}))}}),
    stock=w.resource('r-org0-water').quantity;
  const p=act(w,'purchase',{type:'water',quantity:10,price:2});
  w.advance(10000);
  assert.equal(purchase(w,p.id).receivedQuantity,10);
  assert.equal(purchase(w,p.id).state,'received');
  assert.equal(w.resource('r-org0-water').quantity,stock+10);
  assert.deepEqual(purchase(w,p.id).receipts.map(r=>r.quantity),Array(10).fill(1));
  clean(w);
});

test('own finance is delayed and scoped through the real HTTP actor query endpoint', async t => {
  const lab=await createLabServers({config,observerPort:0,sourcePort:0,persistCredentials:false});
  t.after(()=>lab.close());
  const key=Object.keys(lab.actorKeys).find(k=>lab.actorKeys[k].org==='org0'),
    url=`http://127.0.0.1:${lab.sourcePort}`, headers={Authorization:`Bearer ${key}`,'Content-Type':'application/json'};
  buy(lab.world); lab.world.advance(10000);
  const response=await fetch(url+'/api/actor/action',{method:'POST',headers,body:JSON.stringify({
    type:'query',params:{target:'finance'},idempotencyKey:'http-finance'})});
  assert.equal(response.status,200); const q=await response.json();
  assert.equal(q.state,'pending');
  lab.world.advance(15000);
  const state=await (await fetch(url+'/api/actor/state',{headers})).json(), ready=state.queries.find(x=>x.id===q.id);
  assert.equal(ready.state,'ready'); assert.equal(ready.result.org,'org0'); assert.equal(ready.result.purchases[0].receivedQuantity,6);
  assert.ok(ready.result.entries.every(e=>e.org==='org0'));
  for (const forbidden of ['_tranches','_terminalState','financeSignature']) assert.ok(!JSON.stringify(state).includes(forbidden));
});
