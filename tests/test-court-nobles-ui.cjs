'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {webcrypto}=require('node:crypto'),{test}=require('node:test');
const {SengokuEngine:Engine}=require('../engine.js'),Court=require('../court.js');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8'),raw={window:{}};
vm.runInNewContext(fs.readFileSync(require.resolve('../officers-data.js'),'utf8'),raw);
const clone=x=>JSON.parse(JSON.stringify(x)),roster=clone(raw.window.SENGOKU_OFFICERS),catalog=roster.filter(x=>x.courtNoble),first=catalog[0],second=catalog[1];
const uiSource=source.slice(source.indexOf('  function formalCourtMember('),source.indexOf('  function renderCovert('));
const bridgeSource=source.slice(source.indexOf('  async function requestField('),source.indexOf('  async function departCampaign('));
const drain=async()=>{for(let i=0;i<25;i++)await Promise.resolve();};
function harness(){
 const game=new Engine({clan:'織田家',officers:roster,seed:17});game.state.magatama=20000;
 const storage=new Map(),calls=[],receipts=new Map();let who={id:'u_fixture',courtMember:true},remote=clone(game.state),revision=4,remoteRevision=4,eligible=true,writeHook=null,readHook=null,refreshable=true,adoptable=true;
 const ctx={console,Date,Math,JSON,URLSearchParams,crypto:webcrypto,game,roster:clone(roster),data:{courtNobles:clone(catalog)},startPending:false,saveEnabled:true,roleEpoch:1,fieldActionPending:false,courtNoblesView:null,courtNoblesSerial:0,activeModal:'',writable:true,syncAccess:{linked:true,ready:true,rolePending:false,banned:false},skillNames:{},skillDescriptions:{},skillIcons:{},state:()=>game.state,icon:name=>'<svg aria-hidden="true" data-test-icon="'+name+'"></svg>',num:v=>Math.floor(Number(v)||0).toLocaleString('ja-JP'),esc:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),$:()=>null,toast:(...args)=>calls.push({type:'toast',args}),renderHeader(){},playNote:type=>calls.push({type:'sound',value:type}),refreshLiveControls(){},queueWorldProgress(){},processWorldClock(){},save:()=>{calls.push({type:'save'});return true;},canMutate:()=>ctx.writable,requireWritable:()=>ctx.writable,getExpansionAccess:()=>({writable:ctx.writable}),modal:(_title,_subtitle,body,footer,_kind)=>{ctx.html=body+footer;ctx.activeModal='court-nobles';},localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key),key:index=>[...storage.keys()][index]??null,get length(){return storage.size;}}};
 const snapshot=()=>({catalog:catalog.map(row=>({...row,owned:remote.officers.includes(row.id)})),balance:remote.magatama,eligible,reason:eligible?'':'参内には従五位以上が必要です。',total:24,ownedCount:catalog.filter(row=>remote.officers.includes(row.id)).length});
 const base=async(route,options={})=>{
  if(options.method!=='POST')return snapshot();
  const body=options.data,old=receipts.get(body.requestId),row=catalog.find(x=>x.id===body.officerId);assert(row);
  if(!old){remote.magatama-=row.cost;remote.officers.push(row.id);remote.officerVariants.push(row.id+':'+row.rank);remoteRevision++;receipts.set(body.requestId,{officerId:row.id,name:row.name,rank:row.rank,cost:row.cost,balance:remote.magatama,kind:'court_noble'});}
  return{ok:true,revision:remoteRevision,user:clone(who),save:{state:clone(remote)},nobles:snapshot(),receipt:clone(receipts.get(body.requestId)),idempotent:!!old};
 };
 const api=async(route,options={})=>{calls.push({type:'send',route,options:clone(options)});return options.method==='POST'&&writeHook?writeHook(route,options,base):options.method!=='POST'&&readHook?readHook(route,options,base):base(route,options);};
 ctx.window={SengokuSocial:{getUser:()=>who,courtNobleRequest:api},SengokuPublicCourt:{lineage:()=>({houseName:'近衛家'})},SengokuWorldClock:{refresh:async()=>{},accept(){}},SengokuCloudSync:{getStatus:()=>({linked:true,ready:true,writable:ctx.writable,revision}),getDevice:()=>({id:'device-fixture'}),flush:async()=>{calls.push({type:'flush'});return{ok:true};},acceptSnapshot:async result=>{calls.push({type:'adopt'});if(!adoptable)return{ok:false};if(result.revision>=revision){revision=result.revision;game.state=clone(result.save.state);}return{ok:true};},refresh:async()=>{calls.push({type:'refresh'});if(!refreshable)return{ok:false};revision=remoteRevision;game.state=clone(remote);return{ok:true};}}};
 vm.createContext(ctx);vm.runInContext(uiSource+'\n'+bridgeSource,ctx);
 return{ctx,game,calls,storage,snapshot,base,posts:()=>calls.filter(x=>x.type==='send'&&x.options.method==='POST'),commits:()=>receipts.size,remote:()=>remote,setUser:value=>{who=value;},setEligible:value=>{eligible=value;},setWrite:fn=>{writeHook=fn;},setRead:fn=>{readHook=fn;},setRefreshable:value=>{refreshable=value;},setAdoptable:value=>{adoptable=value;},setBalance:value=>{remote.magatama=value;game.state.magatama=value;}};
}
test('current formal membership enables direct town entry for every retained home, lineage alone never does',()=>{
 const h=harness();for(const home of ['edo','kagoshima','osaka','nagoya','kiyosu','kyoto_gosho']){h.game.state.home=home;assert(h.ctx.formalCourtMember());assert.match(h.ctx.townCourtShortcut(),/data-action="town-court"/);}
 h.setUser({id:'u_fixture',courtMember:false,courtLineage:{class:'kuge',houseId:'konoe'}});assert.equal(h.ctx.townCourtShortcut(),'');
 for(const flag of ['rolePending','banned']){h.setUser({id:'u_fixture',courtMember:true});h.ctx.syncAccess[flag]=true;assert.equal(h.ctx.townCourtShortcut(),'');h.ctx.syncAccess[flag]=false;}
 h.ctx.syncAccess.ready=false;assert.equal(h.ctx.townCourtShortcut(),'');
});
test('catalog reads expose all 24 distinct fixed-rank portraits and actual granted abilities without spending',async()=>{
 const h=harness();assert(await h.ctx.openCourtNobles());assert.equal(h.posts().length,0);assert.equal((h.ctx.html.match(/<article class="court-noble-card/g)||[]).length,24);assert.equal((h.ctx.html.match(/loading="lazy"/g)||[]).length,24);assert.match(h.ctx.html,/SSS/);assert.match(h.ctx.html,/4,800/);assert.match(h.ctx.html,/>100<\/dd>/);assert(!h.ctx.html.includes('role="dialog"'));assert.equal(h.game.state.magatama,20000);
});
test('eligible visitors can exchange while read-only and ineligible visitors can inspect but cannot review',async()=>{
 const visitor=harness();visitor.setUser({id:'u_fixture',courtMember:false});await visitor.ctx.openCourtNobles();assert(visitor.ctx.reviewCourtNoble(first.id));
 for(const mode of ['readonly','ineligible','shortage']){const h=harness();if(mode==='readonly')h.ctx.writable=false;if(mode==='ineligible')h.setEligible(false);if(mode==='shortage')h.setBalance(first.cost-1);await h.ctx.openCourtNobles();assert.equal(h.ctx.reviewCourtNoble(first.id),false);assert.equal(await h.ctx.exchangeCourtNoble(),false);assert.equal(h.posts().length,0);}
});
test('review shows exact price and post-balance; cancel costs nothing; confirmed exchange preserves home',async()=>{
 const h=harness(),home=h.game.state.home;await h.ctx.openCourtNobles();assert(h.ctx.reviewCourtNoble(first.id));assert.match(h.ctx.html,/交換後の勾玉/);assert.match(h.ctx.html,/15,200/);assert.equal(h.posts().length,0);
 h.ctx.courtNoblesView.confirmation=null;assert.equal(await h.ctx.exchangeCourtNoble(),false);assert.equal(h.posts().length,0);
 h.ctx.reviewCourtNoble(first.id);assert(await h.ctx.exchangeCourtNoble());assert.equal(h.game.state.magatama,15200);assert.equal(h.game.state.home,home);assert(h.game.state.officers.includes(first.id));assert.match(h.ctx.html,/を迎えました/);assert.equal(h.commits(),1);assert.equal(h.storage.size,0);assert.deepEqual(Object.keys(h.posts()[0].options.data).sort(),['deviceId','expectedRevision','officerId','requestId']);assert(h.calls.some(x=>x.type==='adopt'));assert.equal(h.ctx.reviewCourtNoble(first.id),false);
});
test('double confirmation sends one operation and an uncertain committed result reuses its receipt after reopen',async()=>{
 const h=harness();let release;await h.ctx.openCourtNobles();h.ctx.reviewCourtNoble(first.id);h.setWrite(async(_r,_o,base)=>{await new Promise(resolve=>release=resolve);return base(_r,_o);});const firstWrite=h.ctx.exchangeCourtNoble();await drain();assert.equal(await h.ctx.exchangeCourtNoble(),false);assert.equal(h.posts().length,1);release();assert(await firstWrite);
 const lost=harness();await lost.ctx.openCourtNobles();lost.ctx.reviewCourtNoble(first.id);let once=true;lost.setWrite(async(route,options,base)=>{const result=await base(route,options);if(once){once=false;throw Error('response lost');}return result;});assert.equal(await lost.ctx.exchangeCourtNoble(),false);assert.equal(lost.commits(),1);assert(lost.ctx.courtNoblesView.pending);const requestId=lost.posts()[0].options.data.requestId;assert(await lost.ctx.openCourtNobles());assert.match(lost.ctx.html,/前の交換結果を確認/);assert.equal(lost.ctx.reviewCourtNoble(second.id),false);assert(await lost.ctx.exchangeCourtNoble(true));assert.equal(lost.posts()[1].options.data.requestId,requestId);assert.equal(lost.commits(),1);assert.equal(lost.game.state.magatama,15200);
});
test('malformed catalog and price cannot replace verified metadata or erase a committed retry',async()=>{
 const h=harness();const bad=h.snapshot();bad.catalog[0].cost=1;assert.equal(h.ctx.cleanCourtNobles(bad),null);bad.catalog[0].cost=first.cost;bad.catalog[1].id=first.id;assert.equal(h.ctx.cleanCourtNobles(bad),null);
 await h.ctx.openCourtNobles();h.ctx.reviewCourtNoble(first.id);h.setWrite(async(route,options,base)=>{const result=await base(route,options);result.receipt.cost=1;return result;});assert.equal(await h.ctx.exchangeCourtNoble(),false);assert(h.ctx.courtNoblesView.pending);assert.equal(h.storage.size,1);assert(!h.ctx.courtNoblesView.reward);h.setWrite(null);assert(await h.ctx.exchangeCourtNoble(true));assert.equal(h.commits(),1);
});
test('save adoption and reconciliation must finish before the success presentation',async()=>{
 for(const stage of ['adopt','refresh']){const h=harness();await h.ctx.openCourtNobles();h.ctx.reviewCourtNoble(first.id);if(stage==='adopt')h.setAdoptable(false);else h.setRefreshable(false);assert.equal(await h.ctx.exchangeCourtNoble(),false);assert(!h.ctx.courtNoblesView.reward);assert(h.ctx.courtNoblesView.pending);h.setAdoptable(true);h.setRefreshable(true);assert(await h.ctx.exchangeCourtNoble(true));assert.equal(h.commits(),1);}
});
test('storage failure blocks expenditure, definitive access denial clears pending and does not report success',async()=>{
 const h=harness();await h.ctx.openCourtNobles();h.ctx.reviewCourtNoble(first.id);h.ctx.localStorage.setItem=()=>{};assert.equal(await h.ctx.exchangeCourtNoble(),false);assert.equal(h.posts().length,0);
 for(const [status,code] of [[403,'COURT_NOBLE_ACCESS_REQUIRED'],[409,'COURT_NOBLE_OWNED'],[400,'COURT_NOBLE_SHORTAGE']]){const t=harness();await t.ctx.openCourtNobles();t.ctx.reviewCourtNoble(first.id);t.setWrite(()=>{throw Object.assign(Error('access changed'),{status,code});});assert.equal(await t.ctx.exchangeCourtNoble(),false);assert.equal(t.storage.size,0);assert(!t.ctx.courtNoblesView.pending);assert(!t.ctx.courtNoblesView.reward);assert.equal(t.commits(),0);}
});
test('account or campaign changes discard late catalog and exchange completions',async()=>{
 const h=harness();let release;h.setRead(()=>new Promise(resolve=>release=resolve));const opening=h.ctx.openCourtNobles();await drain();h.setUser({id:'u_other',courtMember:true});release(h.snapshot());assert.equal(await opening,false);assert.equal(h.ctx.courtNoblesView.catalog.length,0);
 for(const stage of ['account','campaign','privilege']){const t=harness();await t.ctx.openCourtNobles();t.ctx.reviewCourtNoble(first.id);t.setWrite(async(route,options,base)=>{const result=await base(route,options);if(stage==='account')t.setUser({id:'u_other',courtMember:true});else if(stage==='privilege')t.ctx.roleEpoch++;else t.game.state.walking.campaignId='other-campaign';return result;});assert.equal(await t.ctx.exchangeCourtNoble(),false);assert(!t.ctx.courtNoblesView.reward);assert.equal(t.storage.size,1);}
});
test('court entry is available in the actual overview and does not imply formal membership is required for exchange',()=>{
 const state={context:{authenticated:true},section:'overview',drafts:{},info:{eligible:true,requirement:{rankName:'従五位',minScore:35000},self:{id:'u_fixture'},palace:{level:1,jobCount:0},features:{},thresholds:[]},sending:false,pending:null,loading:false};
 const html=Court.markup(state);assert.match(html,/data-court-action="nobles"/);assert.match(html,/24人/);assert.match(html,/1,200勾玉/);
});
module.exports={harness,catalog,drain};
