'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {SengokuEngine:Engine,SENGOKU_DATA:catalog}=require('../engine.js');
const {setup}=require('./helpers/dom-model.cjs');
const source=fs.readFileSync(require.resolve('../command-center.js'),'utf8');
const PLAN_KEY='sengoku-resource-plans-v1',SAVE_KEY='sengoku-tento-save-v2';
const resources=['gold','rice','wood','stone'];
const game=()=>new Engine({seed:38,clan:'織田家'});
const reloadGame=current=>Engine.fromSave(current.exportSave());
const owner=(id,epochs={})=>({playerId:id,user:{id,isAdmin:false,isStaff:false,isBanned:false},epoch:3,accountEpoch:4,privilegeEpoch:5,...epochs});
function store(){
 const values=new Map([[SAVE_KEY,'original campaign save']]),writes=[];
 return{values,writes,readDenied:false,writeDenied:false,
  getItem(key){if(this.readDenied)throw Error('storage blocked');return values.get(key)??null;},
  setItem(key,value){if(this.writeDenied)throw Error('QuotaExceededError');values.set(key,String(value));writes.push([key,String(value)]);},
  raw(){return values.get(PLAN_KEY)??null;},parsed(){return JSON.parse(this.raw());}};
}
function mount({storage=store(),current=game(),access={},role={epoch:2,pending:false},started=true,storageDenied=false,time=200000}={}){
 const {doc,host}=setup(),timers=new Map(),events=new Map(),documentEvents=new Map(),subscribers=new Set();let timerId=0;
 const create=doc.createElement.bind(doc);doc.createElement=name=>{const node=create(name);Object.defineProperty(node,'className',{get:()=>node.getAttribute('class')||'',set:value=>node.setAttribute('class',value)});return node;};
 doc.hidden=false;doc.addEventListener=(type,fn)=>{if(!documentEvents.has(type))documentEvents.set(type,new Set());documentEvents.get(type).add(fn);};
 const win={document:doc,SENGOKU_DATA:catalog,SengokuSocial:{getExpansionContext:()=>access},
  SengokuBridge:{getRoleAccess:()=>role,hasStarted:()=>started},
  SengokuTravelUI:{subscribe(fn){subscribers.add(fn);fn({active:[]},{elapsedMs:0,realNowMs:time,running:true,speed:1});return()=>subscribers.delete(fn);}},
  setTimeout(fn,delay){const id=++timerId;timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id),
  setInterval(){throw Error('Persistence must not add polling');},fetch(){throw Error('Local plans must not make requests');},
  addEventListener(type,fn){if(!events.has(type))events.set(type,new Set());events.get(type).add(fn);}};
 Object.defineProperty(win,'localStorage',{get(){if(storageDenied)throw Error('SecurityError');return storage;}});
 class TestDate extends Date{static now(){return time;}}
 vm.runInNewContext(source,{window:win,Date:TestDate});host.innerHTML='<button id="plan-launcher">資源計画</button>';host.querySelector('button').focus();
 const q=selector=>doc.querySelector('.resource-plan-dialog')?.querySelector(selector);
 const api={storage,doc,win,timers,q,get game(){return current;},get dialog(){return doc.querySelector('.resource-plan-dialog');},
  get ui(){return win.SengokuCommandCenter;},get subscribed(){return subscribers.size;},
  setGame:value=>{current=value;},setAccess:value=>{access=value;},setRole:value=>{role=value;},setStarted:value=>{started=value;},allowStorage:()=>{storageDenied=false;},
  open:extra=>win.SengokuCommandCenter.openPlanner({getGame:()=>current,catalog,staffReady:()=>true,...extra}),
  close:()=>win.SengokuCommandCenter.closePlanner(),
  edit(kind,key,value){const input=q('[data-budget-'+kind+'="'+key+'"]');input.value=value;input.dispatchEvent({type:'input'});},
  choose(value){const input=q('[data-budget-choice]');input.value=value;input.dispatchEvent({type:'change'});},
  click:selector=>q(selector).dispatchEvent({type:'click'}),
  tick(){for(const fn of [...subscribers])fn({active:[]},{elapsedMs:0,realNowMs:time,running:true,speed:1});},
  flush(){time+=1000;for(const [id,timer]of [...timers]){if(timers.delete(id))timer.fn();}},
  hide(){doc.hidden=true;for(const fn of documentEvents.get('visibilitychange')||[])fn({type:'visibilitychange'});},
  pagehide(){for(const fn of events.get('pagehide')||[])fn({type:'pagehide'});},
  note:()=>q('[data-budget-storage-note]').textContent,
  rows:()=>q('[data-budget-plan-list]').querySelectorAll('[data-budget-plan-item]').length};
 return api;
}
function add(h,id='farm'){h.choose('building:'+id);h.click('[data-budget-add]');}
function seeded(){const h=mount({access:owner('u_one')});h.open({kind:'custom'});h.edit('target','gold','123');add(h);h.edit('reserve','wood','0077');h.close();return h;}
let checks=0;function test(name,run){run();checks++;console.log('PASS '+name);}

test('real reload restores exact custom values, reserves and plans across renewed account epochs',()=>{
 const h=mount({access:owner('u_one')}),before=JSON.stringify(h.game.state);
 h.open({kind:'custom'});h.edit('target','gold','0012345');h.edit('target','rice','');h.edit('reserve','wood','00321');
 add(h);add(h,'market');h.choose('research:cultivation');h.click('[data-budget-add]');h.choose('custom');h.close();
 assert.equal(JSON.stringify(h.game.state),before);assert.equal(h.storage.values.get(SAVE_KEY),'original campaign save');
 assert(h.storage.writes.every(([key])=>key===PLAN_KEY));assert.equal(h.storage.parsed().records.length,1);
 const fresh=mount({storage:h.storage,current:reloadGame(h.game),access:owner('u_one',{epoch:0,accountEpoch:0,privilegeEpoch:0}),role:{epoch:0,pending:false}});
 fresh.open();assert.equal(fresh.rows(),3);assert.equal(fresh.q('[data-budget-choice]').value,'custom');
 assert.equal(fresh.q('[data-budget-target="gold"]').value,'0012345');assert.equal(fresh.q('[data-budget-target="rice"]').value,'');assert.equal(fresh.q('[data-budget-reserve="wood"]').value,'00321');
 assert.match(fresh.note(),/この端末/);fresh.close();
});
test('typing is coalesced; ordinary clock refreshes never rewrite unchanged storage',()=>{
 const h=mount();h.open({kind:'custom'});
 for(let i=1;i<=100;i++)h.edit('target','gold',String(i));
 assert.equal(h.timers.size,1);assert.equal(h.storage.writes.length,0);h.flush();assert.equal(h.storage.writes.length,1);
 const before=JSON.stringify(h.game.state);for(let i=0;i<30;i++)h.tick();
 assert.equal(h.timers.size,0);assert.equal(h.storage.writes.length,1);assert.equal(JSON.stringify(h.game.state),before);h.close();assert.equal(h.storage.writes.length,1);
});
test('closing, hiding and leaving flush the final edit before its debounce fires',()=>{
 for(const finish of ['close','hide','pagehide']){
  const h=mount();h.open({kind:'custom'});h.edit('target','stone','5678');h[finish]();
  assert.equal(h.timers.size,0);assert.equal(h.storage.parsed().records[0].data.draft.stone,'5678');
  const fresh=mount({storage:h.storage,current:reloadGame(h.game)});fresh.open();assert.equal(fresh.q('[data-budget-target="stone"]').value,'5678');fresh.close();h.close();
 }
});
test('another account, an offline owner and a new campaign get independent plans',()=>{
 const a=seeded(),raw=a.storage.raw();
 for(const access of [owner('u_two'),{}]){
  const other=mount({storage:a.storage,current:reloadGame(a.game),access});other.open();assert.equal(other.rows(),0);assert.equal(other.q('[data-budget-reserve="wood"]').value,'0');
  assert.match(other.q('[data-budget-restore-note]').textContent,/新しい計画/);other.edit('reserve','wood','999');other.close();
 }
 const next=mount({storage:a.storage,access:owner('u_one')});assert.notEqual(next.game.state.walking.campaignId,a.game.state.walking.campaignId);next.open();assert.equal(next.rows(),0);next.close();
 const back=mount({storage:a.storage,current:reloadGame(a.game),access:owner('u_one')});back.open();assert.equal(back.rows(),1);assert.equal(back.q('[data-budget-reserve="wood"]').value,'0077');back.close();
 assert.equal(a.storage.parsed().records.length,3);assert.equal(a.storage.values.get(SAVE_KEY),'original campaign save');assert.notEqual(a.storage.raw(),raw);
});
test('home and role changes do not restore the previous territory plan',()=>{
 const original=seeded();
 for(const mode of ['home','admin','staff']){
  const current=reloadGame(original.game),access=owner('u_one');
  if(mode==='home')current.state.home='sunpu';
  else{Object.defineProperty(current,mode==='admin'?'isAdmin':'isStaff',{value:true});access.user[mode==='admin'?'isAdmin':'isStaff']=true;}
  const changed=mount({storage:original.storage,current,access});changed.open();assert.equal(changed.rows(),0);assert.equal(changed.q('[data-budget-reserve="wood"]').value,'0');changed.close();
 }
 assert.equal(original.storage.parsed().records.length,1);
});
test('a delayed write is discarded after account, campaign, role or start-state transitions',()=>{
 for(const transition of ['account','campaign','role','pending','banned','not-started','title']){
  const h=seeded(),raw=h.storage.raw(),writes=h.storage.writes.length;h.open({kind:'custom'});h.edit('target','gold','99999');
  if(transition==='account')h.setAccess(owner('u_two'));
  if(transition==='campaign')h.setGame(game());
  if(transition==='role')h.setRole({epoch:99,pending:false});
  if(transition==='pending')h.setAccess({...owner('u_one'),pending:true});
  if(transition==='banned')h.setAccess({...owner('u_one'),banned:true});
  if(transition==='not-started')h.setStarted(false);
  if(transition==='title')h.win.SENGOKU_AT_TITLE=true;
  h.flush();assert.equal(h.storage.raw(),raw,transition);assert.equal(h.storage.writes.length,writes,transition);h.tick();assert.equal(h.dialog.open,false,transition);h.close();
 }
});
test('unknown or unconfirmed identities never read or save a durable plan',()=>{
 const original=seeded(),raw=original.storage.raw();
 const blocked=[{access:{...owner('u_one'),pending:true}},{access:{...owner('u_one'),banned:true}},
  {access:{playerId:'u_one',user:null}},{access:{...owner('u_one'),user:{id:'u_other'}}},
  {access:owner('u_one'),role:{pending:true,epoch:1}},{access:owner('u_one'),started:false}];
 for(const options of blocked){const h=mount({storage:original.storage,current:reloadGame(original.game),...options});h.open({kind:'custom'});assert.equal(h.rows(),0);h.edit('target','gold','4321');h.flush();assert.match(h.note(),/保存は現在利用できません/);h.close();assert.equal(h.storage.raw(),raw);}
});
test('legacy saves without a unique campaign identifier cannot share durable or in-memory plans',()=>{
 const storage=store(),first=game();first.state.walking.campaignId='legacy_v1';
 const h=mount({storage,current:first});h.open({kind:'custom'});add(h);h.edit('reserve','wood','3456');h.close();assert.equal(storage.raw(),null);
 h.open();assert.equal(h.rows(),1);h.close();
 const second=game();second.state.walking.campaignId='legacy_v1';h.setGame(second);h.open();assert.equal(h.rows(),0);assert.equal(h.q('[data-budget-reserve="wood"]').value,'0');h.close();
});
test('restoration normalizes duplicate goals and extra fields without changing the save',()=>{
 const original=seeded(),payload=original.storage.parsed(),data=payload.records[0].data;
 data.plan.push({...data.plan[0],cost:0});data.admin=true;data.reserve.extra='<img src=x>';data.selection.cost=0;data.draft.wood='1.5';
 original.storage.values.set(PLAN_KEY,JSON.stringify(payload));const h=mount({storage:original.storage,current:reloadGame(original.game),access:owner('u_one')});
 h.open();assert.equal(h.rows(),1);h.choose('custom');assert.equal(h.q('[data-budget-target="wood"]').value,'1.5');assert.equal(h.q('[data-budget-target="wood"]').getAttribute('aria-invalid'),'true');
 assert.match(h.q('[data-budget-restore-note]').textContent,/入力を確認/);assert.equal(h.dialog.querySelector('img,script'),null);
 h.edit('target','wood','15');h.flush();const saved=h.storage.parsed().records[0].data;
 assert.deepEqual(Object.keys(saved).sort(),['draft','plan','reserve','selection']);assert.deepEqual(Object.keys(saved.reserve),resources);assert.deepEqual(saved.plan,[{kind:'building',id:'farm'}]);assert.equal(saved.selection.cost,undefined);h.close();
});
test('retired goals stay visible and block a misleading affordable partial total',()=>{
 const original=seeded(),payload=original.storage.parsed();payload.records[0].data.plan.push({kind:'building',id:'retired_mill'});payload.records[0].data.selection={kind:'building',id:'retired_mill'};
 original.storage.values.set(PLAN_KEY,JSON.stringify(payload));const h=mount({storage:original.storage,current:reloadGame(original.game),access:owner('u_one')});
 h.open();assert.equal(h.rows(),2);assert.equal(h.q('[data-budget-choice]').value,'building:retired_mill');assert.match(h.q('[data-budget-restore-note]').textContent,/現在の一覧にない/);
 h.choose('plan');assert.equal(h.q('[data-budget-summary]').dataset.state,'unavailable');assert.equal(h.q('[data-budget-target="gold"]').disabled,true);
 h.click('[data-budget-remove="building:retired_mill"]');assert.equal(h.rows(),1);assert.notEqual(h.q('[data-budget-summary]').dataset.state,'unavailable');h.close();
});
test('corrupt, oversized and future schemas remain untouched while an editable local draft survives',()=>{
 const original=seeded(),valid=original.storage.parsed(),variants=['{broken','[]',JSON.stringify({...valid,version:2}),' '.repeat(9000)];
 for(const change of [p=>{p.records[0].data.reserve.gold='<img src=x onerror=1>';},p=>{p.records[0].data.draft.gold='1e99';},p=>{delete p.records[0].data.reserve.wood;},p=>{p.records.push(p.records[0]);},p=>{p.records[0].data.plan=Array(9).fill({kind:'building',id:'farm'});},p=>{p.records[0].scope='[]';}]){const p=JSON.parse(JSON.stringify(valid));change(p);variants.push(JSON.stringify(p));}
 for(const text of variants){const storage=store();storage.values.set(PLAN_KEY,text);const h=mount({storage,current:reloadGame(original.game),access:owner('u_one')});
  h.open({kind:'custom'});assert.equal(h.rows(),0);assert.match(h.note(),/この起動中/);assert.equal(h.dialog.querySelector('img,script'),null);h.edit('target','gold','7654');h.flush();assert.equal(storage.raw(),text);h.close();h.open();assert.equal(h.q('[data-budget-target="gold"]').value,'7654');assert.match(h.note(),/この起動中/);h.close();assert.equal(storage.raw(),text);
 }
});
test('quota failure stays visible after reopening and retries the retained draft when storage recovers',()=>{
 const h=seeded(),raw=h.storage.raw();h.storage.writeDenied=true;h.open({kind:'custom'});h.edit('target','gold','7654');h.flush();assert.equal(h.storage.raw(),raw);assert.match(h.note(),/保存できません/);
 h.close();h.open();assert.equal(h.q('[data-budget-target="gold"]').value,'7654');assert.match(h.note(),/保存できません/);
 h.storage.writeDenied=false;h.flush();assert.equal(h.storage.parsed().records[0].data.draft.gold,'7654');assert.doesNotMatch(h.note(),/保存できません/);h.close();
 const fresh=mount({storage:h.storage,current:reloadGame(h.game),access:owner('u_one')});fresh.open();fresh.choose('custom');assert.equal(fresh.q('[data-budget-target="gold"]').value,'7654');fresh.close();
});
test('denied storage access never interrupts planning or overwrites unreadable data',()=>{
 for(const denied of ['getter','read']){
  const original=seeded(),raw=original.storage.raw();if(denied==='read')original.storage.readDenied=true;
  const h=mount({storage:original.storage,current:reloadGame(original.game),access:owner('u_one'),storageDenied:denied==='getter'});
  assert.doesNotThrow(()=>h.open({kind:'custom'}));assert.match(h.note(),/この起動中/);h.edit('target','gold','9876');h.flush();h.close();assert.equal(h.storage.raw(),raw);
  h.open();assert.equal(h.q('[data-budget-target="gold"]').value,'9876');h.close();
  h.allowStorage();h.storage.readDenied=false;h.open();h.flush();assert.equal(h.storage.parsed().records[0].data.draft.gold,'9876');h.close();
 }
});
test('retention is bounded, names its device scope, and preserves other owners until eviction',()=>{
 const storage=store(),campaigns=[];
 for(let i=0;i<8;i++){const h=mount({storage,access:owner('u_'+i),time:1000+i*1000});campaigns.push(h.game);h.open({kind:'custom'});h.edit('target','gold',String(100+i));h.close();
  const text=storage.raw(),data=storage.parsed();assert(data.records.length<=6);assert(text.length*2<=16384);assert.equal(data.records[0].data.draft.gold,String(100+i));
 }
 assert.equal(storage.parsed().records.length,6);const latest=mount({storage,current:reloadGame(campaigns[7]),access:owner('u_7')});latest.open();assert.match(latest.note(),/この端末/);assert.match(latest.note(),/6/);latest.close();
 const kept=mount({storage,current:reloadGame(campaigns[2]),access:owner('u_2')});kept.open();assert.equal(kept.q('[data-budget-target="gold"]').value,'102');kept.close();
 const expired=mount({storage,current:reloadGame(campaigns[0]),access:owner('u_0')});expired.open();assert.notEqual(expired.q('[data-budget-choice]').value,'custom');expired.close();assert.equal(storage.values.get(SAVE_KEY),'original campaign save');
});
test('a clean reopened draft refreshes the same owner plan saved in another tab',()=>{
 const original=seeded(),a=mount({storage:original.storage,current:reloadGame(original.game),access:owner('u_one')}),b=mount({storage:original.storage,current:reloadGame(original.game),access:owner('u_one')});
 const beforeA=JSON.stringify(a.game.state),beforeB=JSON.stringify(b.game.state);
 a.open({kind:'custom'});assert.equal(a.q('[data-budget-target="gold"]').value,'123');a.close();
 b.open();b.edit('target','gold','9000');b.close();
 const writes=original.storage.writes.length;a.open();
 assert.equal(a.q('[data-budget-target="gold"]').value,'9000');assert.equal(a.rows(),1);assert.equal(a.q('[data-budget-reserve="wood"]').value,'0077');
 assert.equal(original.storage.writes.length,writes);assert.equal(a.timers.size,0);
 a.edit('reserve','stone','55');a.flush();
 const saved=original.storage.parsed().records[0].data;
 assert.equal(saved.draft.gold,'9000');assert.equal(saved.reserve.stone,'55');a.close();
 assert.equal(JSON.stringify(a.game.state),beforeA);assert.equal(JSON.stringify(b.game.state),beforeB);assert.equal(original.storage.values.get(SAVE_KEY),'original campaign save');
});
test('an open planner saves its edited fields without reverting another tab\'s newer values',()=>{
 const original=seeded(),a=mount({storage:original.storage,current:reloadGame(original.game),access:owner('u_one')}),b=mount({storage:original.storage,current:reloadGame(original.game),access:owner('u_one')});
 a.open({kind:'custom'});a.flush();b.open();b.edit('target','gold','9000');add(b,'market');b.close();
 const input=a.q('[data-budget-reserve="stone"]'),scroll=a.q('.resource-plan-scroll');input.focus();scroll.scrollTop=333;
 a.edit('reserve','stone','0055');a.flush();let saved=original.storage.parsed().records[0].data;
 assert.equal(saved.draft.gold,'9000');assert.equal(saved.reserve.stone,'0055');assert.equal(saved.plan.length,2);assert.equal(saved.selection.kind,'plan');
 assert.equal(a.doc.activeElement,input);assert.equal(input.value,'0055');assert.equal(scroll.scrollTop,333);assert.match(a.note(),/開き直す/);
 a.edit('target','gold','7777');a.flush();saved=original.storage.parsed().records[0].data;
 assert.equal(saved.draft.gold,'7777');assert.equal(saved.reserve.stone,'0055');assert.equal(saved.plan.length,2);
 a.close();a.open();assert.equal(a.rows(),2);a.choose('custom');assert.equal(a.q('[data-budget-target="gold"]').value,'7777');a.close();
 assert.equal(original.storage.values.get(SAVE_KEY),'original campaign save');
});
test('unsaved edits recovered after storage failures preserve other tabs\' later changes',()=>{
 for(const failure of ['quota','getter','read','corrupt']){
  const original=seeded(),valid=original.storage.raw();
  if(failure==='quota')original.storage.writeDenied=true;
  if(failure==='read')original.storage.readDenied=true;
  if(failure==='corrupt')original.storage.values.set(PLAN_KEY,'{broken');
  const a=mount({storage:original.storage,current:reloadGame(original.game),access:owner('u_one'),storageDenied:failure==='getter'});
  a.open({kind:'custom'});a.edit('target','gold','7654');a.flush();a.close();
  original.storage.writeDenied=false;original.storage.readDenied=false;a.allowStorage();
  if(failure==='corrupt')original.storage.values.set(PLAN_KEY,valid);
  const b=mount({storage:original.storage,current:reloadGame(original.game),access:owner('u_one')});
  b.open();b.edit('reserve','stone','9001');add(b,'market');b.close();
  a.open();assert.equal(a.q('[data-budget-target="gold"]').value,'7654',failure);a.flush();
  const saved=original.storage.parsed().records[0].data;
  assert.equal(saved.draft.gold,'7654',failure);assert.equal(saved.reserve.stone,'9001',failure);assert.equal(saved.plan.length,2,failure);
  a.close();a.open();assert.equal(a.rows(),2,failure);assert.equal(a.q('[data-budget-reserve="stone"]').value,'9001',failure);a.close();
  assert.equal(original.storage.values.get(SAVE_KEY),'original campaign save');
 }
});
test('saving a draft merges another tab\'s newer owner record instead of replacing the whole store',()=>{
 const original=seeded(),a=mount({storage:original.storage,current:reloadGame(original.game),access:owner('u_one')}),b=mount({storage:original.storage,current:reloadGame(original.game),access:owner('u_two')});
 a.open({kind:'custom'});a.edit('target','gold','2222');b.open({kind:'custom'});b.edit('target','gold','3333');b.close();
 const other=original.storage.parsed().records.find(record=>record.data.draft.gold==='3333');assert(other);a.close();
 assert.equal(original.storage.parsed().records.length,2);assert.deepEqual(original.storage.parsed().records.find(record=>record.scope===other.scope),other);
 const reload=mount({storage:original.storage,current:reloadGame(original.game),access:owner('u_one')});reload.open();assert.equal(reload.q('[data-budget-target="gold"]').value,'2222');reload.close();
});
console.log(checks+' resource planner persistence checks passed. Campaigns are unchanged; storage is simulated and no network is used.');
