'use strict';
// Real engine + deterministic DOM model. Native top-layer layout is checked in browser QA.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {setup}=require('./helpers/dom-model.cjs');
const stable=require('../stable-dom.js');
const {SengokuEngine:Engine}=require('../engine.js');
const rosterScope={window:{}};
vm.runInNewContext(fs.readFileSync(require.resolve('../officers-data.js'),'utf8'),rosterScope);
const roster=rosterScope.window.SENGOKU_OFFICERS;
const source=fs.readFileSync(require.resolve('../progress.js'),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const settle=async()=>{for(let n=0;n<8;n++)await Promise.resolve();};
const progressData=marker=>({marker,dailyClaimed:0,dailyLimit:3,claimedCount:0,calendar:{nextDay:'2026-11-28T00:00:00Z',nextWeek:'2026-11-30T00:00:00Z'},missions:{daily:[],weekly:[]},history:[]});
function fixture(){
 const {doc,host}=setup(),create=doc.createElement.bind(doc),requests=[],listeners=[];
 doc.createElement=name=>{const node=create(name);Object.defineProperty(node,'className',{get(){return this.getAttribute('class')||'';},set(v){this.setAttribute('class',v);}});return node;};
 doc.addEventListener=(name,listener)=>listeners.push({name,listener});
 doc.removeEventListener=()=>{};
 const trigger=doc.createElement('button');trigger.textContent='成長手帳';host.appendChild(trigger);trigger.focus();
 const game=new Engine({officers:roster,clan:'織田家',seed:82});
 let owner='first';
 const store=new Map();
 const win={document:doc,SengokuStableDOM:stable,crypto:{randomUUID:()=>String(requests.length)+'-test-id'},localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)}};
 class FormData {constructor(form){this.rows=form.querySelectorAll('[name]').map(n=>[n.getAttribute('name'),n.value]);}[Symbol.iterator](){return this.rows[Symbol.iterator]();}}
 vm.runInNewContext(source,{window:win,FormData,console});
 const api=win.SengokuProgress;
 api.configure({getGame:()=>game,getContext:()=>({playerId:owner,writable:true,user:{id:owner}}),mutate:fn=>fn(game),api:(route,args)=>{const wait=deferred();requests.push({route,args,...wait});return wait.promise;}});
 const $=selector=>doc.querySelector(selector);
 const click=node=>{assert(node,'fixture click target exists');node.dispatchEvent({type:'click',target:node});};
 const finish=()=>api.destroy();
 return{doc,game,win,api,requests,$,click,trigger,finish,listeners,setOwner:value=>{owner=value;api.configure({});}};
}
let count=0;
async function test(name,run){await run();console.log('PASS '+name);count++;}
(async()=>{
 await test('a delayed mission read preserves the real preset name field, caret, focus and scroll',async()=>{
  const h=fixture(),before=JSON.stringify(h.game.state);h.api.open('army');
  const dialog=h.$('.progress-overlay');assert.equal(dialog.localName,'dialog');assert.equal(dialog.open,true);assert.equal(dialog.getAttribute('aria-labelledby'),'progress-title');
  const input=h.$('[data-preset-name="0"]'),pane=h.$('.progress-content');
  input.value='城攻め用の編成';input.focus();input.setSelectionRange(2,5,'backward');pane.scrollTop=243;
  h.requests[0].resolve({ok:true,progress:progressData('first')});await settle();
  assert.strictEqual(h.$('[data-preset-name="0"]'),input);assert.equal(input.value,'城攻め用の編成');assert.strictEqual(h.doc.activeElement,input);assert.equal(input.selectionStart,2);assert.equal(input.selectionEnd,5);assert.equal(pane.scrollTop,243);
  assert.equal(JSON.stringify(h.game.state),before);h.finish();
 });
 await test('tab switching preserves drafts and per-tab position without issuing game commands',async()=>{
  const h=fixture();h.api.open('army');const before=JSON.stringify(h.game.state);
  h.$('[data-preset-name="2"]').value='守りの三将';h.$('.progress-content').scrollTop=219;
  h.click(h.$('#progress-tab-analysis'));assert.equal(h.$('.progress-content').scrollTop,0,h.$('.progress-status').textContent+' / '+h.api.getState().tab);
  const troops=h.$('input[name="troops"]');troops.value='777';h.$('.progress-content').scrollTop=117;
  h.click(h.$('#progress-tab-army'));assert.equal(h.$('[data-preset-name="2"]').value,'守りの三将');assert.equal(h.$('.progress-content').scrollTop,219);
  h.click(h.$('#progress-tab-analysis'));assert.equal(h.$('input[name="troops"]').value,'777');assert.equal(h.$('.progress-content').scrollTop,117);
  assert.equal(JSON.stringify(h.game.state),before);h.finish();
 });
 await test('late reads from a closed view cannot overwrite a newer opening',async()=>{
  const h=fixture();h.api.open('army');const old=h.requests[0];h.api.close();assert.strictEqual(h.doc.activeElement,h.trigger);assert.equal(h.$('.progress-overlay'),null);
  h.api.open('army');const recent=h.requests[1];recent.resolve({ok:true,progress:progressData('new')});await settle();
  old.resolve({ok:true,progress:progressData('old')});await settle();assert.equal(h.api.getState().data.marker,'new');h.finish();
 });
 await test('identity replacement clears private drafts and ignores old successes and failures',async()=>{
  const h=fixture();h.api.open('army');h.$('[data-preset-name="0"]').value='first owner draft';const old=h.requests[0];
  h.setOwner('second');assert.equal(h.$('.progress-overlay'),null);h.api.open('army');assert.equal(h.$('[data-preset-name="0"]').value,'');
  h.requests[1].resolve({ok:true,progress:progressData('second')});await settle();old.reject(Error('private first failure'));await settle();
  assert.equal(h.api.getState().data.marker,'second');assert.equal(h.$('.progress-status').textContent,'');h.finish();
 });
 await test('tab controls expose one tab stop and arrow/Home/End navigation stays local',async()=>{
  const h=fixture();h.api.open('army');
  assert.equal(h.$('#progress-tab-army').getAttribute('tabindex'),'0');assert.equal(h.$('#progress-tab-analysis').getAttribute('tabindex'),'-1');
  let event={type:'keydown',key:'ArrowRight'};h.$('#progress-tab-army').dispatchEvent(event);assert(event.defaultPrevented);assert.equal(h.api.getState().tab,'analysis');assert.strictEqual(h.doc.activeElement,h.$('#progress-tab-analysis'));
  h.$('#progress-tab-analysis').dispatchEvent({type:'keydown',key:'End'});assert.equal(h.api.getState().tab,'guide');
  h.$('#progress-tab-guide').dispatchEvent({type:'keydown',key:'Home'});assert.equal(h.api.getState().tab,'missions');
  assert.equal(h.$('#progress-panel').getAttribute('aria-labelledby'),'progress-tab-missions');assert.equal(h.listeners.some(x=>x.name==='keydown'),false);h.finish();
 });
 await test('only native cancellation or a backdrop pointer click closes the modal',async()=>{
  const h=fixture();h.api.open('army');const dialog=h.$('.progress-overlay');
  h.$('[data-preset-name="0"]').dispatchEvent({type:'keydown',key:'Escape'});assert.equal(dialog.open,true,'production delegates Escape to the native topmost modal');
  dialog.dispatchEvent({type:'pointerdown',target:h.$('[data-preset-name="0"]')});dialog.dispatchEvent({type:'click',target:dialog});assert.equal(dialog.open,true,'dragging from a form onto backdrop does not close');
  dialog.dispatchEvent({type:'cancel',bubbles:false});assert.equal(h.$('.progress-overlay'),null);
  h.api.open('army');const next=h.$('.progress-overlay');next.dispatchEvent({type:'pointerdown'});next.dispatchEvent({type:'click'});assert.equal(h.$('.progress-overlay'),null);h.finish();
 });
 await test('saving and deleting a preset use the engine and refresh its name without erasing another draft',async()=>{
  const h=fixture();h.api.open('army');h.$('[data-preset-name="0"]').value='攻城用';h.$('[data-preset-name="1"]').value='未保存の控え';
  h.click(h.$('[data-progress-action="save-preset"][data-slot="0"]'));await settle();assert.equal(h.game.state.progress.presets[0].name,'攻城用');assert.equal(h.$('[data-preset-name="1"]').value,'未保存の控え');
  h.click(h.$('[data-progress-action="delete-preset"][data-slot="0"]'));await settle();assert.equal(h.game.state.progress.presets.length,0);assert.equal(h.$('[data-preset-name="0"]').value,'');assert.equal(h.$('[data-preset-name="1"]').value,'未保存の控え');h.finish();
 });
 await test('submitted reward receipt remains recoverable after closing the view',async()=>{
  const h=fixture();h.api.open('army');h.requests[0].resolve({ok:true,progress:progressData('read')});await settle();
  const claim=h.api.claimMission('d:test');assert.equal(h.api.getState().hasPending,true);h.api.close();
  h.requests[1].resolve({ok:true,receipt:{name:'達成'},progress:progressData('claimed')});await claim;
  assert.equal(h.api.getState().hasPending,false);assert.equal(h.api.getState().data.marker,'claimed');assert.equal(h.$('.progress-overlay'),null);h.finish();
 });
 await test('a response from an earlier session cannot finish a newer retry of the same owner',async()=>{
  const h=fixture();h.api.open('army');h.requests[0].resolve({ok:true,progress:progressData('read')});await settle();
  const old=h.api.claimMission('d:same-owner');h.setOwner('second');h.setOwner('first');
  const retry=h.api.retry();assert.equal(h.api.getState().busy,true);assert.equal(h.api.getState().hasPending,true);
  h.requests[1].resolve({ok:false,error:{code:'MISSION_EXPIRED',message:'old session'}});await old;
  assert.equal(h.api.getState().busy,true);assert.equal(h.api.getState().hasPending,true);
  h.requests[2].resolve({ok:true,progress:progressData('retried')});await retry;
  assert.equal(h.api.getState().busy,false);assert.equal(h.api.getState().hasPending,false);assert.equal(h.api.getState().data.marker,'retried');h.finish();
 });

 await test('preset adoption rechecks a synchronized replacement and requires review of the new exact army',async()=>{
  const h=fixture(),current=[...h.game.state.army],reserve=h.game.state.officers.find(id=>!current.includes(id)),first=[reserve,current[0],current[1]],next=[reserve,current[1],current[2]];
  assert(h.game.saveArmyPreset(0,'攻城用',first).ok);h.api.open('army');h.click(h.$('[data-progress-action="preview-preset"][data-slot="0"]'));
  assert(h.game.saveArmyPreset(0,'守備用',next).ok);const before=JSON.stringify(h.game.state);
  h.click(h.$('[data-progress-action="apply-preset"]'));await settle();assert.deepEqual([...h.game.state.army],current);assert.equal(JSON.stringify(h.game.state),before);
  assert.match(h.$('.progress-status').textContent,/変わ|更新|確認/);assert.match(h.$('.progress-preset-confirm').textContent,/守備用/);
  assert.equal(h.doc.activeElement,h.$('.progress-preset-confirm h3'));
  h.click(h.$('[data-progress-action="apply-preset"]'));await settle();assert.deepEqual([...h.game.state.army],next);assert.equal(h.$('.progress-preset-confirm'),null);h.finish();
 });
 await test('new governor removals are reviewed before a preset can leave a facility unstaffed',async()=>{
  const h=fixture(),current=[...h.game.state.army],reserve=h.game.state.officers.find(id=>!current.includes(id)),ids=[reserve,...current.slice(0,2)];
  h.game.saveArmyPreset(0,'出陣',ids);h.api.open('army');h.click(h.$('[data-progress-action="preview-preset"][data-slot="0"]'));
  assert(h.game.assignGovernor('farm',reserve).ok);const before=JSON.stringify(h.game.state);h.click(h.$('[data-progress-action="apply-preset"]'));await settle();
  assert.equal(JSON.stringify(h.game.state),before);assert.equal(h.game.state.governors.farm,reserve);assert.match(h.$('.progress-preset-confirm').textContent,/田畑/);
  h.click(h.$('[data-progress-action="apply-preset"]'));await settle();assert.deepEqual([...h.game.state.army],ids);assert.equal(h.game.state.governors.farm,undefined);h.finish();
 });
 await test('changed ranks or materially changed health refresh the comparison before applying it',async()=>{
  for(const kind of ['rank','health']){
   const h=fixture(),current=[...h.game.state.army],reserve=h.game.state.officers.find(id=>!current.includes(id)),ids=[reserve,...current.slice(0,2)];
   h.game.saveArmyPreset(0,'出陣',ids);h.api.open('army');h.click(h.$('[data-progress-action="preview-preset"][data-slot="0"]'));
   if(kind==='rank')h.game._grantOfficerVariant(reserve,'U');else h.game.state.officerHealth.values[reserve]=0;
   const before=JSON.stringify(h.game.state);h.click(h.$('[data-progress-action="apply-preset"]'));await settle();assert.equal(JSON.stringify(h.game.state),before,kind);assert.match(h.$('.progress-status').textContent,/変わ|更新|確認/);
   const cells=h.$('.progress-preset-confirm tbody tr').querySelectorAll('td');assert.equal(Number(cells[2].textContent),h.game.armyStats(ids).lead);h.finish();
  }
 });
 await test('the final mutation callback rechecks the reviewed preset instead of relying on an earlier read',async()=>{
  const h=fixture(),current=[...h.game.state.army],reserve=h.game.state.officers.find(id=>!current.includes(id)),ids=[reserve,...current.slice(0,2)],next=[reserve,...current.slice(1)];
  h.game.saveArmyPreset(0,'出陣',ids);h.api.open('army');h.click(h.$('[data-progress-action="preview-preset"][data-slot="0"]'));
  h.api.configure({mutate:fn=>{h.game.saveArmyPreset(0,'同期された編成',next);return fn(h.game);}});
  h.click(h.$('[data-progress-action="apply-preset"]'));await settle();assert.deepEqual([...h.game.state.army],current);assert.match(h.$('.progress-preset-confirm').textContent,/同期された編成/);h.finish();
 });
 await test('deleted presets never render a broken confirmation or apply a different slot',async()=>{
  for(const phase of ['before-preview','before-apply']){
   const h=fixture();h.game.saveArmyPreset(0,'消えた編成');h.api.open('army');h.$('[data-preset-name="1"]').value='未保存の控え';
   if(phase==='before-apply')h.click(h.$('[data-progress-action="preview-preset"][data-slot="0"]'));
   h.game.deleteArmyPreset(0);const before=JSON.stringify(h.game.state);h.click(h.$('[data-progress-action="'+(phase==='before-apply'?'apply-preset':'preview-preset')+'"]'));await settle();
   assert.equal(JSON.stringify(h.game.state),before);assert.equal(h.$('.progress-preset-confirm'),null);assert.match(h.$('.progress-status').textContent,/編成セット|編成/);assert(!/undefined|Cannot read/.test(h.$('.progress-status').textContent));assert.equal(h.$('[data-preset-name="1"]').value,'未保存の控え');h.finish();
  }
 });
 await test('a stationed officer makes the comparison unavailable without clearing their branch duty',async()=>{
  const h=fixture(),reserve=h.game.state.officers.find(id=>!h.game.state.army.includes(id)),ids=[reserve,...h.game.state.army.slice(0,2)];
  h.game.saveArmyPreset(0,'待機予定',ids);h.game.state.branches=[{id:'nijo_north',parentCastleId:'nijo',direction:'north',level:1,commanders:[reserve]}];
  const before=JSON.stringify(h.game.state);h.api.open('army');h.click(h.$('[data-progress-action="preview-preset"][data-slot="0"]'));await settle();
  assert(h.$('[data-progress-action="apply-preset"]').disabled);assert.match(h.$('.progress-preset-confirm').textContent,/支拠点|配置/);assert.equal(JSON.stringify(h.game.state),before);h.finish();
 });
 await test('an unchanged reviewed preset adopts exactly its members without changing assets or commands',async()=>{
  const h=fixture(),current=[...h.game.state.army],reserve=h.game.state.officers.find(id=>!current.includes(id)),ids=[reserve,...current.slice(0,2)];
  h.game.saveArmyPreset(0,'確認済み',ids);h.api.open('army');h.click(h.$('[data-progress-action="preview-preset"][data-slot="0"]'));const before=JSON.parse(JSON.stringify(h.game.state));
  assert.match(h.$('.progress-preset-confirm').textContent,new RegExp(h.game.officer(reserve).name));h.click(h.$('[data-progress-action="apply-preset"]'));await settle();
  assert.deepEqual([...h.game.state.army],ids);assert.deepEqual(h.game.state.resources,before.resources);assert.equal(h.game.state.command,before.command);assert.deepEqual(h.game.state.progress.presets,before.progress.presets);h.finish();
 });
 console.log(count+' progression dialog lifecycle and interaction scenarios passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
