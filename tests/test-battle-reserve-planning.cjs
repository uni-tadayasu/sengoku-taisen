'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {setup}=require('./helpers/dom-model.cjs'),{SengokuEngine:Engine}=require('../engine.js');
const advisor=require('../battle-advisor.js'),stable=require('../stable-dom.js');
const source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
const fragment=source.slice(source.indexOf("  let battleAdviceStyle='balanced'"),source.indexOf('  function battlePreview('));
const roster={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../officers-data.js'),'utf8'),roster);
const previous=global.SengokuStableDOM;
global.SengokuStableDOM=stable;

function openBattle(mode){
 const g=new Engine({officers:roster.window.SENGOKU_OFFICERS,seed:17,startCastle:mode==='branch'?'sakamoto':'kiyosu'});
 if(mode==='branch')g.state.branches=[{id:'nijo_north',parentCastleId:'nijo',direction:'north',level:2,fallen:false}];
 const {host,$,doc}=setup(),notes=[];
 const context={
  game:g,data:g.data,state:()=>g.state,battleTactic:'',battleTroops:0,battleTarget:'',battleBranchTarget:'',activeModal:'',
  $,num:n=>String(n),esc:n=>String(n),icon:()=>'',durabilityMarkup:()=>'',battlePreview:()=>'',syncMusic(){},
  window:{SengokuBattleAdvisor:advisor},updateBattlePreview(){context.applied++;},applied:0,
  toast:text=>notes.push(text),modal(_title,_subtitle,body,footer,kind){host.innerHTML=body+footer;context.activeModal=kind;}
 };
 vm.createContext(context);vm.runInContext(fragment,context);
 function open(){context.battleModal(mode==='branch'?'nijo':'inuyama',false,mode==='branch'?'nijo_north':'');}
 open();
 const input=key=>$(`[data-battle-reserve="${key}"]`),proposal=()=>$('[data-battle-advisor-action="battle-apply"]');
 function enter(troops,rice){input('troops').value=String(troops);input('rice').value=String(rice);}
 function submit(){const form=$('[data-battle-reserves]');assert.equal(form.dispatchEvent({type:'submit'}),false);}
 return {g,host,$,doc,context,input,proposal,enter,submit,open,notes};
}

try{
 for(const mode of ['castle','branch']){
  const {g,context,$,enter,submit,proposal,open,notes}=openBattle(mode),before=JSON.stringify(g.state);
  assert.equal(context.currentBattleAdvice().ok,true);
  enter('１２００','８００');submit();
  const constrained=context.currentBattleAdvice();
  assert(constrained.ok,constrained.message);
  for(const row of [constrained,...constrained.alternatives]){
   assert(row.reserveAfter.troops>=1200);assert(row.reserveAfter.rice>=800);
  }
  assert.equal(context.applied,0);assert.match($('.battle-advisor-reserves summary').textContent,/1,200人.*800/);
  proposal().dispatchEvent({type:'click'});
  assert.equal(context.applied,1);assert.equal(context.battleTactic,constrained.tactic);assert.equal(context.battleTroops,constrained.troops);
  assert.equal(JSON.stringify(g.state),before);
  enter(g.state.troops-299,0);submit();assert.equal(context.currentBattleAdvice().code,'BATTLE_TROOPS');assert(proposal().disabled);
  assert.match($('.battle-advisor-reasons').textContent,/300/);
  enter(0,g.state.resources.rice+1);submit();assert.equal(context.currentBattleAdvice().code,'BATTLE_RICE');
  enter(0,0);submit();assert(!proposal().disabled);assert(notes.length>=4);assert.equal(JSON.stringify(g.state),before);
  enter(200,250);submit();open();assert.equal(context.currentBattleAdvice().policy.reserveTroops,0);assert.equal(context.currentBattleAdvice().policy.reserveRice,0);
  console.log('PASS '+mode+' opens, plans and adopts against actual battle previews, handles shortages and resets at next opening');
 }

 const {g,context,$,doc,input,enter,submit,proposal}=openBattle('castle');
 enter(700,90);proposal().dispatchEvent({type:'click'});
 assert.equal(context.applied,0);assert.equal(context.currentBattleAdvice().policy.reserveTroops,700);
 proposal().dispatchEvent({type:'click'});assert.equal(context.applied,1);
 g.state.resources.rice=89;
 proposal().dispatchEvent({type:'click'});assert.equal(context.applied,1);assert(proposal().disabled);
 console.log('PASS an edited proposal requires review, and changed resources cannot adopt an unavailable proposal');

 const initialPolicy=JSON.stringify(context.currentBattleAdvice().policy);
 for(const raw of ['','-4','1.5','2e3',String(g.data.assetCap+1),'abc']){
  enter(raw,0);submit();assert.equal(context.applied,1);assert.equal(doc.activeElement,input('troops'));assert.equal(input('troops').getAttribute('aria-invalid'),'true');
  assert.match($('[data-battle-reserve-error]').textContent,/整数/);
  assert.equal(JSON.stringify(context.currentBattleAdvice().policy),initialPolicy);
 }
 enter(1,'0.3');submit();assert.equal(doc.activeElement,input('rice'));
 enter(0,0);submit();assert.equal(input('rice').hasAttribute('aria-invalid'),false);assert.equal($('[data-battle-reserve-error]').textContent,'');
 console.log('PASS invalid, fractional and over-limit input preserves the previous plan and focuses the field');

 g.state.resources.rice=6000;context.renderBattleAdvisor();assert(!proposal().disabled);
 const details=$('.battle-advisor-reserves');
 enter('',0);details.open=false;proposal().focus();proposal().dispatchEvent({type:'click'});
 assert(details.open);assert.equal(doc.activeElement,input('troops'));assert.match($('[data-battle-reserve-error]').textContent,/残す兵数/);
 assert.equal(context.applied,1);
 console.log('PASS applying with an invalid hidden draft reopens the reserve inputs and exposes the error');
 enter(0,0);submit();const draft=input('troops');draft.focus();draft.value='３００';
 context.renderBattleAdvisor();assert.equal(input('troops'),draft);assert.equal(draft.value,'３００');assert(details.open);assert.equal(doc.activeElement,draft);
 context.activeModal='';submit();assert.equal(context.currentBattleAdvice().policy.reserveTroops,0);
 assert.equal(advisor.markup({ok:false}).includes('data-battle-reserves'),false);
 console.log('PASS background updates preserve a draft and disclosure, closed dialogs and unrelated battle modes have no editable policy');
}finally{global.SengokuStableDOM=previous;}
