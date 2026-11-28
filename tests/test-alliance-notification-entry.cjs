'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {setup}=require('./helpers/dom-model.cjs');
const source=fs.readFileSync(require.resolve('../alliance.js'),'utf8');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
async function settle(){for(let i=0;i<50;i++)await Promise.resolve();}
function fixture(){
 const {doc}=setup(),timers=new Map(),requests=[];let timerId=0,handler;
 const payload={ok:true,serverNow:Date.parse('2026-11-28T00:00:00Z'),guild:null,policy:{joinMode:'approval',description:'',activity:'',withdrawRole:'owner',dailyLimit:10000,approvalThreshold:500,newcomerHours:0,revision:1},operations:[],members:[],units:[],directory:[],applications:[{playerId:'player-a',name:'自分',guildId:'guild-a',guildName:'招待同盟',status:'invited',message:'参加しませんか'}],withdrawals:[],contributions:[]};
 handler=async()=>payload;
 const user={id:'player-a',name:'領主',guildId:null},window={document:doc,SengokuStableDOM:require('../stable-dom.js'),setInterval:fn=>{timers.set(++timerId,fn);return timerId;},clearInterval:id=>timers.delete(id)};
 vm.runInNewContext(source,{window,Intl,Date,FormData});
 const options={getContext:()=>({playerId:user.id,user}),request:async route=>{requests.push(route);return handler();},storage:{getItem:()=>null,setItem(){},removeItem(){}}};
 const open=tab=>window.SengokuAlliance.open({...options,tab});
 const selected=()=>doc.querySelector('[data-alliance="tab"][aria-selected="true"]')?.dataset.id;
 return{doc,window,payload,user,open,selected,requests,timers,setHandler:fn=>handler=fn};
}
const tests=[],test=(name,run)=>tests.push([name,run]);
test('an invitation opens its actionable membership view as soon as the first response is ready',async()=>{
 const f=fixture(),pending=deferred();f.setHandler(()=>pending.promise);const view=f.open('members');assert.equal(f.doc.querySelector('dialog').open,true);assert.equal(f.selected(),'members');assert.equal(f.requests.length,1);
 pending.resolve(f.payload);await settle();assert.match(f.doc.body.textContent,/加入申請・招待/);assert.match(f.doc.body.textContent,/招待同盟/);assert(f.doc.querySelector('[data-alliance="join"]'));view.close();assert.equal(f.timers.size,0);
});
test('treasury notices open the relevant approval or claim controls directly',async()=>{
 const f=fixture();f.user.guildId='guild-a';f.payload.guild={id:'guild-a',name:'同盟',role:'member'};f.payload.withdrawals=[{id:'w1',playerId:'player-a',name:'領主',resource:'gold',amount:400,status:'approved',expiresAt:f.payload.serverNow+86400000}];const view=f.open('policy');await settle();assert.equal(f.selected(),'policy');assert(f.doc.querySelector('[data-alliance="withdraw-claim"]'));assert.match(f.doc.body.textContent,/承認済み資産を受取/);view.close();
});
test('a new notification can switch an already open dialog before its refresh completes',async()=>{
 const f=fixture();f.user.guildId='guild-a';f.payload.guild={id:'guild-a',name:'同盟',role:'officer'};const view=f.open('members');await settle();const input=f.doc.querySelector('[name="playerId"]');assert(input);input.focus();input.value='draft-player';
 const pending=deferred();f.setHandler(()=>pending.promise);const same=f.open('policy');assert.strictEqual(same,view);assert.equal(f.selected(),'policy');assert.match(f.doc.body.textContent,/現在の出金ルール/);assert.equal(f.doc.querySelectorAll('dialog').length,1);pending.resolve(f.payload);await settle();assert.equal(f.selected(),'policy');view.close();
});
test('ordinary reopen and background refresh preserve the current tab while unknown targets cannot select arbitrary views',async()=>{
 const f=fixture(),view=f.open('members');await settle();f.open();assert.equal(f.selected(),'members');await settle();assert.equal(f.selected(),'members');f.open('invalid');assert.equal(f.selected(),'members');await settle();view.close();
 const second=f.open('invalid');assert.equal(f.selected(),'operations');await settle();second.close();
});
(async()=>{for(const[name,run]of tests){await run();console.log('PASS '+name);}console.log(`${tests.length} alliance notification entry scenarios passed. No external requests.`);})().catch(error=>{console.error(error);process.exitCode=1;});
