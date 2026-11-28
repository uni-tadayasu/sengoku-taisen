import assert from 'node:assert/strict';
import {assertSentoUpgradeTransition} from './sento-upgrades.js';
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';
import {harness} from './test-support.mjs';
import {fixture,post,row,appoint,nominateSuccessor,certifySuccessor} from './test-court-support.mjs';

const clone=structuredClone,user={is_sento:true},fail=(status,code,message)=>{throw Object.assign(Error(message),{status,code});};
const reject=(before,after)=>assert.throws(()=>assertSentoUpgradeTransition(before,after,user,fail),{code:'SENTO_UPGRADE_LIMIT'});
let checks=0;
function test(name,run){run();checks++;console.log('PASS '+name);}
const game=new GameEngine({officers:GAME_OFFICERS,isSento:true,seed:9}),base=JSON.parse(game.exportSave()),rules=globalThis.SENGOKU_DATA.sentoRules;
test('each of the12 current facilities accepts20 but rejects21 for new growth',()=>{
 assert.equal(rules.facilityIds.length,12);assert.equal(rules.limit,20);
 for(const id of rules.facilityIds){const next=clone(base);next.state.buildings[id]=20;assertSentoUpgradeTransition(base,next,user,fail);next.state.buildings[id]=21;reject(base,next);}
});
test('other facilities cannot start or gain a new level',()=>{
 for(const building of globalThis.SENGOKU_DATA.buildings.filter(b=>!rules.facilityIds.includes(b.id))){
  const next=clone(base);next.state.buildings[building.id]++;reject(base,next);
  next.state.buildings[building.id]--;next.state.jobs.push({kind:'building',id:building.id,targetLevel:1});reject(base,next);
 }
});
test('legacy high completed levels remain loadable but cannot start another over-cap job',()=>{
 const old=clone(base);old.state.buildings.farm=30;old.state.buildings.dojo=12;
 assertSentoUpgradeTransition(old,clone(old),user,fail);
 for(const id of ['farm','dojo']){const next=clone(old);next.state.jobs.push({kind:'building',id,targetLevel:next.state.buildings[id]+1});reject(old,next);}
});
test('paid legacy queues may remain and complete, without authorizing further queued levels',()=>{
 const old=clone(base);old.state.buildings.farm=20;old.state.buildings.dojo=7;old.state.jobs=[{kind:'building',id:'farm',targetLevel:21},{kind:'building',id:'dojo',targetLevel:8}];
 assertSentoUpgradeTransition(old,clone(old),user,fail);
 const complete=clone(old);complete.state.jobs=[];complete.state.buildings.farm=21;complete.state.buildings.dojo=8;assertSentoUpgradeTransition(old,complete,user,fail);
 const extra=clone(complete);extra.state.jobs.push({kind:'building',id:'dojo',targetLevel:9});reject(old,extra);
 const replay=clone(old);replay.state.walking.campaignId+='-new';reject(old,replay);
});
test('ordinary and Kyoto players keep their existing32-level building rules',()=>{
 const next=clone(base);for(const id in next.state.buildings)next.state.buildings[id]=32;
 for(const actor of [{},{is_staff:true},{is_admin:true,is_sento:true}])assertSentoUpgradeTransition(base,next,actor,fail);
});

const h=harness(),realFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Sento upgrade tests must stay local');};
try{
 const admin=await fixture(h,'仙洞普請の太政大臣',{admin:true}),retired=await fixture(h,'仙洞普請の天皇',{staff:true}),successor=await fixture(h,'仙洞普請の後継',{staff:true});
 await appoint(h,retired);const nomination=await nominateSuccessor(h,retired,successor);await certifySuccessor(h,admin,nomination.nomination);
 const snap=(await h.api('/sync/lease',post(retired,{deviceId:retired.deviceId}))).data;
 assert.equal(snap.entitlements.sentoGosho,true);
 const send=save=>h.api('/sync',{method:'PUT',token:retired.token,expected:409,body:{deviceId:retired.deviceId,revision:snap.revision,save,maintenanceRevision:snap.maintenanceAuthority.revision,courtEstateProof:snap.courtEstateProjection?.proof}});
 for(const [id,level] of [['farm',21],['dojo',1]]){const forged=clone(snap.save);forged.state.buildings[id]=level;const response=await send(forged);assert.equal(response.data.error.code,'SENTO_UPGRADE_LIMIT');assert.equal(row(h,retired).revision,snap.revision);}
 checks++;console.log('PASS real sync route rejects forbidden Sento upgrades without writing the save');
}finally{globalThis.fetch=realFetch;h.close();}
console.log(checks+' Sento server upgrade scenarios passed.');
