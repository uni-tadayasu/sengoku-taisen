'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createController,createUI,cleanReport,reportMarkup}=require('../promotion-admin.js');
const {setup:domSetup}=require('./helpers/dom-model.cjs');
const clone=value=>JSON.parse(JSON.stringify(value));
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
const admin=()=>({epoch:1,privilegeEpoch:1,accountEpoch:1,playerId:'operator',user:{id:'operator',isAdmin:true,isBanned:false},isAdmin:true,pending:false,banned:false});
const report=()=>({ok:true,timezone:'Asia/Tokyo',range:{from:'2026-11-13',to:'2026-11-26',days:14},events:[{day:'2026-11-26',source:'x',event:'landing',count:5},{day:'2026-11-26',source:'x',event:'play_click',count:2}],totals:{landing:5,play_click:2},accounts:{total:8,createdInRange:3},serverNow:'2026-11-26T03:00:00Z'});
function fixture(){let context=admin(),handler=async()=>report();const calls=[];const options={getContext:()=>clone(context),request:async(route,settings)=>{calls.push({route,settings});return handler();}};return{options,calls,setContext:c=>context=c,setHandler:h=>handler=h};}

async function run(){
  let parsed=cleanReport(report());assert(parsed);assert.equal(parsed.daily.length,14);assert.equal(parsed.daily[0].landing,0);assert.equal(parsed.daily[13].landing,5);assert.equal(parsed.sources.find(x=>x.source==='x').play_click,2);
  for(const change of [r=>r.totals.landing++,r=>r.events[0].count=-1,r=>r.events[0].count=1.5,r=>r.events[0].source='<script>',r=>r.events.push(r.events[0]),r=>r.events[0].day='2026-12-01',r=>r.range.days=13,r=>r.range.from='2026-02-31',r=>r.accounts.createdInRange=9,r=>r.timezone='UTC']){const value=report();change(value);assert.equal(cleanReport(value),null);}
  let empty=report();empty.events=[];empty.totals={landing:0,play_click:0};assert(cleanReport(empty));assert.match(reportMarkup(cleanReport(empty)),/記録はまだありません/);
  const markup=reportMarkup(parsed);assert.match(markup,/実人数・ユニーク利用者数・プレイ完了数ではありません/);assert.match(markup,/宣伝経由で登録した人数を示すものではありません/);assert.match(markup,/運営・スタッフ・利用停止中/);assert.match(markup,/アカウント/);

  for(const context of [null,{...admin(),isAdmin:false,user:{id:'staff',isAdmin:false}},{...admin(),banned:true},{...admin(),pending:true},{...admin(),user:{id:'operator',isAdmin:true,isBanned:true}}]){const f=fixture();f.setContext(context);const c=createController(f.options);assert.equal(await c.open(),false);assert.equal(f.calls.length,0);c.dispose();}
  let f=fixture(),c=createController(f.options);assert.equal(await c.open(),true);assert.deepEqual(f.calls[0],{route:'/admin/promotion?days=14',settings:{method:'GET'}});assert(c.getState().report);c.close();assert.equal(c.getState().report,null);assert.equal(c.getState().open,false);c.dispose();

  for(const update of [ctx=>ctx.epoch++,ctx=>ctx.privilegeEpoch++,ctx=>ctx.accountEpoch++,ctx=>ctx.playerId='another',ctx=>ctx.user.id='another',ctx=>ctx.isAdmin=false,ctx=>ctx.banned=true]){f=fixture();const late=deferred();f.setHandler(()=>late.promise);c=createController(f.options);const loading=c.open();const changed=admin();update(changed);f.setContext(changed);late.resolve(report());assert.equal(await loading,false);assert.equal(c.getState().report,null);assert.equal(c.getState().open,false);c.dispose();}
  f=fixture();let late=deferred();f.setHandler(()=>late.promise);c=createController(f.options);const older=c.open();c.close();f.setHandler(async()=>{const r=report();r.accounts.total=20;return r;});await c.open();late.resolve(report());await older;assert.equal(c.getState().report.accounts.total,20);c.dispose();
  f=fixture();f.setHandler(async()=>{throw Error('一時的に取得できません。');});c=createController(f.options);assert.equal(await c.open(),false);assert.match(c.getState().error,/一時的/);assert.equal(c.getState().loading,false);f.setHandler(async()=>report());assert.equal(await c.refresh(),true);c.dispose();

  // Closing or revoking access clears both the report model and its visible DOM.
  f=fixture();const {doc}=domSetup(),button=doc.createElement('button');doc.body.append(button);button.focus();let ui=createUI({...f.options,document:doc});await ui.open();let dialog=doc.querySelector('#promotion-admin-modal');assert(dialog.open);assert.match(dialog.textContent,/紹介元別/);ui.close();assert.equal(dialog.open,false);assert.equal(dialog.querySelector('[data-promotion-report]').textContent,'');assert.equal(doc.activeElement,button);ui.dispose();
  f=fixture();late=deferred();f.setHandler(()=>late.promise);ui=createUI({...f.options,document:doc});const pending=ui.open();ui.close();late.resolve(report());await pending;assert.equal(ui.getState().report,null);assert.equal(doc.querySelector('#promotion-admin-modal').querySelector('[data-promotion-report]').textContent,'');ui.dispose();

  // Exercise the actual Social transport: its route restriction cannot be used
  // to invoke administrative writes or substitute authentication.
  const calls=[],context={URL,URLSearchParams,AbortController,setTimeout,clearTimeout,document:{readyState:'loading',addEventListener(){},removeEventListener(){}},localStorage:{getItem(){return null;}},SENGOKU_API_BASE:'https://api.example.invalid',fetch:async(url,options)=>{calls.push({url,options});return{ok:true,status:200,json:async()=>report()};},SengokuBridge:{setRoleAccess(){},setSyncAccess(){}}};context.window=context;
  let social=fs.readFileSync(path.join(__dirname,'../social.js'),'utf8').replace('global.SengokuSocial={open','global.__promotionTest={s,adminView,bumpPrivilege:()=>privilegeEpoch++};global.SengokuSocial={open');vm.runInNewContext(social,context);
  const state=context.__promotionTest.s;state.identity={id:'operator',token:'real-session'};state.user={id:'operator',isAdmin:true,isStaff:false};
  assert.match(context.__promotionTest.adminView(),/宣伝の反応/);
  for(const route of ['/admin/promotion','/admin/promotion?days=1','/admin/promotion?days=14&days=7','/admin/promotion?days=14#private','/admin/mail'])await assert.rejects(context.SengokuSocial.promotionRequest(route),/集計期間/);
  await assert.rejects(context.SengokuSocial.promotionRequest('/admin/promotion?days=14',{method:'POST'}),/集計期間/);
  await assert.rejects(context.SengokuSocial.promotionRequest('/admin/promotion?days=14',{data:{}}),/集計期間/);
  for(const days of [7,14,30])await context.SengokuSocial.promotionRequest('/admin/promotion?days='+days,{token:'attempted-override',auth:false});
  assert.equal(calls.length,3);assert.equal(calls[0].options.headers.Authorization,'Bearer real-session');assert.equal(calls[0].url,'https://api.example.invalid/api/v1/admin/promotion?days=7');
  state.user.isAdmin=false;state.user.isStaff=true;assert(!context.__promotionTest.adminView().includes('宣伝の反応'));await assert.rejects(context.SengokuSocial.promotionRequest('/admin/promotion?days=14'),/運営権限/);assert.equal(calls.length,3);
  state.user.isAdmin=true;state.user.isBanned=true;await assert.rejects(context.SengokuSocial.promotionRequest('/admin/promotion?days=14'),/運営権限/);state.user.isBanned=false;
  late=deferred();context.fetch=async()=>({ok:true,status:200,json:()=>late.promise});const privateRead=context.SengokuSocial.promotionRequest('/admin/promotion?days=14');context.__promotionTest.bumpPrivilege();late.resolve(report());await assert.rejects(privateRead,error=>error.code==='STALE_IDENTITY');
  console.log('PASS promotion report: validated totals, honest labels, operator-only read routes, identity/role races, closed-dialog data removal and network recovery.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
