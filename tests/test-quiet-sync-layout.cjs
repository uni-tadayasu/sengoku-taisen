'use strict';
// Exercise the production presentation helpers; mutation guards are deliberately
// independent from their quiet labels. Real device layout is checked separately.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {SengokuEngine:E,SENGOKU_DATA:D}=require('../engine.js'),notices=require('../sync-notices.js');
const app=fs.readFileSync(require.resolve('../app.js'),'utf8'),social=fs.readFileSync(require.resolve('../social.js'),'utf8');
function fn(source,name,indent='  '){const start=source.indexOf(`${indent}function ${name}(`);assert(start>=0,name);const first=source.indexOf('\n',start);if(source.slice(start,first).endsWith('}'))return source.slice(start,first);const end=source.indexOf('\n'+indent+'}',start);assert(end>start,name);return source.slice(start,end+indent.length+2);}
const checks=[];function test(name,run){checks.push([name,run]);}
function gameUI(){
 const game=new E({seed:137}),flags={writable:true};game.state.buildings.academy=5;game.state.command=3;for(const key of Object.keys(game.state.resources))game.state.resources[key]=999999;
 const c={game,data:D,state:()=>game.state,syncAccess:{linked:true,ready:true,writable:true,reason:'writer'},saveEnabled:true,staffBaseId:D.staffBaseId||'kyoto_gosho',canMutate:()=>flags.writable,staffConstructionReady:()=>true,constructionCount:()=>0,hasResources:()=>true,resNames:{gold:'金銭',rice:'兵糧',wood:'木材',stone:'石材'},window:{SengokuSyncNotices:notices}};
 vm.createContext(c);vm.runInContext(['homeCastleUpgradeHint','researchAvailability'].map(name=>fn(app,name)).join('\n'),c);return{c,game,flags};
}
function socialUI(){
 const calls={garrisons:0,treasury:0,patches:0},host={html:''},c={s:{syncStatus:null},dialog:{querySelectorAll:()=>[host]},esc:String,Date,JSON,patchSocial(node,html){calls.patches++;node.html=html;},refreshGuildTreasuryView(){calls.treasury++;},global:{SengokuSyncNotices:notices,SengokuTroopGarrisons:{refreshIdentity(){calls.garrisons++;}}}};
 vm.createContext(c);vm.runInContext(['syncStatusCard','renderSyncStatus'].map(name=>fn(social,name,'')).join('\n'),c);return{c,calls,host};
}
test('castle guidance keeps its text through normal sync barriers while the action stays blocked',()=>{
 const {c,game,flags}=gameUI(),normal=c.homeCastleUpgradeHint(game.state.home);flags.writable=false;
 for(const reason of ['writer','applying','conflict','lease-expired']){c.syncAccess.reason=reason;c.syncAccess.writable=false;assert.equal(c.homeCastleUpgradeHint(game.state.home),normal,reason);assert.equal(c.canMutate(),false);}
 c.syncAccess.reason='offline';assert.notEqual(c.homeCastleUpgradeHint(game.state.home),normal);
 c.syncAccess.reason='applying';c.saveEnabled=false;assert.match(c.homeCastleUpgradeHint(game.state.home),/保存状態/);
});
test('research labels and state retain their size during sync but still disable the real action',()=>{
 const {c,flags}=gameUI(),id=D.techs[0].id,normal=c.researchAvailability(id);assert.equal(normal.ok,true);flags.writable=false;
 for(const reason of ['writer','applying','conflict','lease-expired']){c.syncAccess.reason=reason;const pending=c.researchAvailability(id);assert.equal(pending.ok,false);for(const key of ['state','label','reason'])assert.equal(pending[key],normal[key],reason+' '+key);}
 c.syncAccess.reason='follower';const follower=c.researchAvailability(id);assert.equal(follower.ok,false);assert.match(follower.label,/端末/);
 c.syncAccess.reason='applying';c.game.state.resources.gold=0;assert.match(c.researchAvailability(id).reason,/不足/,'real economic changes still replace the guidance');
});
test('routine save acknowledgements do not redraw open garrison or treasury dialogs',()=>{
 const {c,calls,host}=socialUI(),base={linked:true,ready:true,writable:true,reason:'writer',message:'',leaseExpiresAt:new Date(Date.now()+60000).toISOString()};c.renderSyncStatus(base);const initial={...calls};
 for(let revision=1;revision<=100;revision++)c.renderSyncStatus({...base,revision,updatedAt:String(revision),message:revision%2?'変更を自動保存しています…':'',leaseExpiresAt:new Date(Date.now()+60000+revision).toISOString()});
 assert.deepEqual(calls,initial);assert.equal(c.s.syncStatus.revision,100);assert.equal(host.html,'');
 c.renderSyncStatus({...base,writable:false,reason:'follower'});assert.equal(calls.garrisons,initial.garrisons+1);assert.equal(calls.treasury,initial.treasury+1);
});
test('follower device-switch guidance does not disappear while a new snapshot is applied',()=>{
 const {c,host}=socialUI(),base={linked:true,ready:true,writable:false,reason:'follower',message:'別の端末で進行中です。'};c.renderSyncStatus(base);const normal=host.html;assert.match(normal,/この端末で続ける/);
 c.renderSyncStatus({...base,reason:'applying',message:'最新の進行を反映しています…'});assert.equal(host.html.replace(/ disabled/g,''),normal);assert.match(host.html,/ disabled/,'takeover remains unavailable while applying');
 c.renderSyncStatus({...base,revision:2});assert.equal(host.html,normal);
 c.renderSyncStatus({...base,reason:'writer',writable:true});assert.equal(host.html,'','a successful takeover removes obsolete guidance');
});
test('actual personal treasury balances still refresh during an otherwise identical save acknowledgement',()=>{
 const {c,calls}=socialUI();let gold=100;c.s.open=true;c.s.tab='guild';c.s.guildSection='treasury';c.s.user={guildId:'one'};c.$=()=>({value:'gold'});c.personalGuildResource=()=>gold;
 const value={linked:true,ready:true,writable:true,reason:'writer'};c.renderSyncStatus(value);const before=calls.treasury;c.renderSyncStatus({...value,revision:2});assert.equal(calls.treasury,before);
 gold=150;c.renderSyncStatus({...value,revision:3});assert.equal(calls.treasury,before+1);
});
test('treasury controls keep normal sync silent while retaining real balance changes and errors',()=>{
 const {c}=socialUI(),status={textContent:'',classList:{toggle(){}}},submit={},personal={textContent:''},nodes={'#social-guild-treasury-status':status,'#social-guild-transfer-confirm':submit,'#social-guild-personal-balance':personal};
 let available=true,gold=100;c.s.tab='guild';c.s.guildSection='treasury';c.s.user={guildId:'one'};c.s.guildTreasury={loaded:true,balance:{gold:20},error:''};c.s.syncStatus={linked:true,ready:true,writable:true,reason:'writer'};
 Object.assign(c,{$:selector=>nodes[selector]||null,guildTransferAvailable:()=>available,personalGuildResource:()=>gold,treasuryBusy:false,RES:{gold:'金'},num:String});vm.runInContext(['setSocialText','refreshGuildTreasuryView'].map(name=>fn(social,name,'')).join('\n'),c);
 c.refreshGuildTreasuryView();assert.equal(status.textContent,'');assert.equal(submit.disabled,false);assert.match(personal.textContent,/100/);
 available=false;c.s.syncStatus={...c.s.syncStatus,writable:false,reason:'applying'};gold=150;c.refreshGuildTreasuryView();assert.equal(status.textContent,'');assert.equal(submit.disabled,true);assert.match(personal.textContent,/150/);
 c.s.syncStatus.reason='follower';c.refreshGuildTreasuryView();assert.match(status.textContent,/この端末/);
 c.s.guildTreasury.error='金庫を確認できません。';c.s.syncStatus.reason='applying';c.refreshGuildTreasuryView();assert.equal(status.textContent,'金庫を確認できません。');
});
test('action-required sync failures remain visible until a confirmed recovery',()=>{
 const {c,host}=socialUI(),base={linked:true,ready:true,writable:false,reason:'error',message:'接続先に問題があります。'};c.renderSyncStatus(base);assert.match(host.html,/接続先に問題/);
 c.renderSyncStatus({...base,reason:'applying',message:'最新の進行を反映しています…'});assert.match(host.html,/接続先に問題/);
 c.renderSyncStatus({...base,reason:'writer',writable:true,message:''});assert.equal(host.html,'');
 c.renderSyncStatus({...base,reason:'banned',banned:true,message:'利用停止中です。'});assert.match(host.html,/利用停止/);
 c.renderSyncStatus({linked:true,ready:false,writable:false,reason:'initializing'});assert.equal(host.html,'','old account notices must not follow a new session');
});
test('initialization, ordinary saves and sync progress remain silent; errors are not filtered',()=>{
 const {c,host}=socialUI();for(const reason of ['local','initializing','applying','writer']){c.renderSyncStatus({linked:reason!=='local',ready:reason!=='initializing',writable:reason==='writer',reason,message:'変更を自動保存しています…'});assert.equal(host.html,'');}
 assert.equal(notices.visibleText('変更を自動保存しています…'),'');assert.equal(notices.visibleText('セーブを保存できませんでした。'),'セーブを保存できませんでした。');
});
for(const[name,run]of checks){run();console.log('PASS '+name);}console.log(checks.length+' quiet sync presentation scenarios passed. No external requests.');
