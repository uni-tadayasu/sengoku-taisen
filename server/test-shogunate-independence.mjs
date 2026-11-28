import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';
import {fixture,post} from './test-court-support.mjs';
import {readPalaceControl,settleShogunateApprovals} from './shogunate.js';
import {readShogunateIndependence,applyPalaceControl} from './shogunate-independence.js';

let checks=0,calls=0;
async function scope(name,run){const h=harness();try{await run(h);checks++;console.log('PASS '+name);}finally{calls+=h.calls;h.close();}}
function retirement(h,person,successor){
 const commit='retirement-'+crypto.randomUUID(),request='retirement-request-'+crypto.randomUUID();
 h.sql.prepare('INSERT INTO court_succession_requests(actor_id,request_id,target_id,request_hash,commit_token,source_appointment_token,result_json,created_at) VALUES(?,?,?,?,?,?,?,?)')
  .run(person.user.id,request,successor.user.id,'fixture-hash',commit,'source-'+crypto.randomUUID(),'{}',h.now);
 h.sql.prepare('INSERT INTO court_retired_emperors(user_id,succession_id,successor_id,retired_at) VALUES(?,?,?,?)').run(person.user.id,commit,successor.user.id,h.now);
 return commit;
}
function control(h,person,name='試験幕府'){
 const id='sg_'+crypto.randomUUID().replaceAll('-','');
 h.sql.prepare("INSERT INTO shogunate_rights(id,user_id,source_type,source_id,title,earned_at,opened_at,government_name) VALUES(?,?,'event',?,'天下統一',?,?,?)").run(id,person.user.id,id,h.now,h.now,name);
 h.sql.prepare("INSERT INTO shogunate_palace_control(castle_id,right_id,controller_id,government_name,controlled_at) VALUES('kyoto_gosho',?,?,?,?) ON CONFLICT(castle_id) DO UPDATE SET right_id=excluded.right_id,controller_id=excluded.controller_id,government_name=excluded.government_name,controlled_at=excluded.controlled_at").run(id,person.user.id,name,h.now);
 return id;
}
function noble(h,person){h.sql.prepare("INSERT INTO court_lineages(user_id,house_id,revision,created_at,updated_at) VALUES(?,'konoe',1,?,?)").run(person.user.id,h.now,h.now);}

const network=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Independence tests must not contact a real service');};
try{
 await scope('only a completed retirement exempts a player; a royal house alone does not',async h=>{
  const retired=await fixture(h,'退位を終えた領主'),royal=await fixture(h,'宮家を持つ領主'),shogun=await fixture(h,'既存の将軍');
  retirement(h,retired,royal);control(h,shogun);
  h.sql.prepare('INSERT INTO court_lineages(user_id,house_id,original_clan,imperial_house_name,imperial_house_key,revision,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)').run(royal.user.id,'konoe','織田家','試験宮家','試験宮家',h.now,h.now);
  assert.equal(await readShogunateIndependence(h.db,retired.user.id),true);
  assert.equal(await readShogunateIndependence(h.db,royal.user.id),false);
  assert.equal(await readPalaceControl(h.db,retired.user.id),null);
  assert.equal((await readPalaceControl(h.db,royal.user.id)).controller.id,shogun.user.id);
  assert.equal((await readPalaceControl(h.db)).controller.id,shogun.user.id);
  const before=h.sql.prepare('SELECT * FROM shogunate_palace_control').get();
  await readPalaceControl(h.db,retired.user.id);assert.deepEqual(h.sql.prepare('SELECT * FROM shogunate_palace_control').get(),before);
 });
 await scope('shared field projection clears existing control only for the retired sovereign',async h=>{
  const retired=await fixture(h,'上皇の投影'),ordinary=await fixture(h,'通常の御所担当'),shogun=await fixture(h,'投影の将軍');
  retirement(h,retired,ordinary);control(h,shogun);const palaceControl=await readPalaceControl(h.db);
  const values=[{playerId:retired.user.id,targetCastleId:'kyoto_gosho',palaceControl},{id:retired.user.id,homeCastleId:'kiyosu',palaceControl},{playerId:ordinary.user.id,targetCastleId:'kyoto_gosho'},{playerId:ordinary.user.id,targetCastleId:'kiyosu',shogunateIndependent:true}];
  await applyPalaceControl(h.db,values,palaceControl);
  for(const value of values.slice(0,2)){assert.equal(value.shogunateIndependent,true);assert.equal(value.palaceControl,null);}
  assert.equal(values[2].shogunateIndependent,false);assert.deepEqual(values[2].palaceControl,palaceControl);assert.equal(values[3].shogunateIndependent,false);
  // A later controller and a change of home cannot attach the retired player.
  h.now++;control(h,ordinary,'新しい幕府');values[1].homeCastleId='kyoto_gosho';await applyPalaceControl(h.db,values,await readPalaceControl(h.db));
  assert.equal(values[1].palaceControl,null);assert.equal(values[2].palaceControl.governmentName,'新しい幕府');
 });
 await scope('expired government approval never returns a retired sovereign to Kyoto control',async h=>{
  const retired=await fixture(h,'期限後も独立する上皇'),successor=await fixture(h,'独立の後継者'),shogun=await fixture(h,'期限到来の将軍');
  retirement(h,retired,successor);const id='sg_'+crypto.randomUUID().replaceAll('-','');
  h.sql.prepare("INSERT INTO shogunate_rights(id,user_id,source_type,source_id,title,earned_at,government_name) VALUES(?,?,'event',?,'天下統一',?,'期限到来幕府')").run(id,shogun.user.id,id,h.now);
  h.sql.prepare("INSERT INTO shogunate_approvals(right_id,status,requested_at,deadline_at,updated_at) VALUES(?,'pending',?,?,?)").run(id,h.now-259200000,h.now,h.now);
  assert.equal((await settleShogunateApprovals(h.db,h.now)).settled,1);
  assert.equal((await readPalaceControl(h.db)).controller.id,shogun.user.id);assert.equal(await readPalaceControl(h.db,retired.user.id),null);
  const data=(await h.api('/shogunate',{token:retired.token})).data.shogunate;assert.equal(data.shogunateIndependent,true);assert.equal(data.palaceControl,null);
  const ordinary=(await h.api('/shogunate',{token:successor.token})).data.shogunate;assert.equal(ordinary.shogunateIndependent,false);assert.equal(ordinary.palaceControl.controller.id,shogun.user.id);
 });
 await scope('a noble who is also shogun cannot negotiate a legacy retired sovereign into service',async h=>{
  const retired=await fixture(h,'交渉除外の上皇',{startCastle:'kiyosu'}),successor=await fixture(h,'交渉除外の後継',{startCastle:'ishikawa'}),shogun=await fixture(h,'公家を兼ねる将軍',{startCastle:'odawara'}),ordinary=await fixture(h,'交渉できる武家',{startCastle:'yonezawa'});
  noble(h,shogun);retirement(h,retired,successor);control(h,shogun);
  const path='/court/negotiations/recipient?playerId=';
  assert.equal((await h.api(path+retired.user.id,{token:shogun.token})).data.eligible,false);
  assert.equal((await h.api(path+ordinary.user.id,{token:shogun.token})).data.eligible,true);
  const request={requestId:crypto.randomUUID(),targetPlayerId:retired.user.id,offer:{gold:100},confirmed:true};
  const blocked=await h.api('/court/negotiations',post(shogun,request,409));assert.equal(blocked.data.error.code,'COURT_NEGOTIATION_INELIGIBLE');
  assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM court_negotiations').get().n,0);
 });
 await scope('opening a shogunate invalidates only its existing retired-subject relation without replaying payment',async h=>{
  const retired=await fixture(h,'旧従属の上皇',{startCastle:'kiyosu'}),successor=await fixture(h,'旧従属の後継',{startCastle:'ishikawa'}),lord=await fixture(h,'将軍になる公家',{startCastle:'odawara'});
  noble(h,lord);const id='cn_'+crypto.randomUUID().replaceAll('-',''),offer=JSON.stringify({gold:100,rice:0,wood:0,stone:0});
  h.sql.prepare("INSERT INTO court_negotiations(id,lord_id,warrior_id,offer_json,offered_by,status,revision,created_at,updated_at) VALUES(?,?,?,?,?,'accepted',2,?,?)").run(id,lord.user.id,retired.user.id,offer,lord.user.id,h.now,h.now);
  h.sql.prepare('INSERT INTO court_vassals(vassal_id,lord_id,negotiation_id,created_at) VALUES(?,?,?,?)').run(retired.user.id,lord.user.id,id,h.now);
  retirement(h,retired,successor);
  assert.equal((await h.api('/me',{token:retired.token})).data.user.courtRelations.suzerain.id,lord.user.id,'The rule is limited to a shogunate, not all noble households');
  const history=h.sql.prepare('SELECT * FROM court_negotiations WHERE id=?').get(id),saves=h.sql.prepare('SELECT user_id,save_json FROM player_saves ORDER BY user_id').all();
  control(h,lord);
  assert.equal((await h.api('/me',{token:retired.token})).data.user.courtRelations.suzerain,null);
  const relations=(await h.api('/me',{token:lord.token})).data.user.courtRelations;assert.deepEqual(relations.vassals,[]);assert.equal(relations.vassalCount,0);
  assert.deepEqual(h.sql.prepare('SELECT * FROM court_negotiations WHERE id=?').get(id),history);assert.deepEqual(h.sql.prepare('SELECT user_id,save_json FROM player_saves ORDER BY user_id').all(),saves);
 });
 await scope('a pending offer loses acceptance eligibility when its noble opens a shogunate',async h=>{
  const retired=await fixture(h,'交渉中の上皇',{startCastle:'kiyosu'}),successor=await fixture(h,'交渉中の後継',{startCastle:'ishikawa'}),lord=await fixture(h,'開府を控える公家',{startCastle:'odawara'});
  noble(h,lord);retirement(h,retired,successor);
  const submitted=(await h.api('/court/negotiations',post(lord,{requestId:crypto.randomUUID(),targetPlayerId:retired.user.id,offer:{gold:100},confirmed:true}))).data.negotiation;
  control(h,lord);const listed=(await h.api('/court/negotiations',{token:retired.token})).data.negotiations.find(n=>n.id===submitted.id);assert.equal(listed.canAccept,false);assert.equal(listed.canCounter,false);
  const saved=h.sql.prepare('SELECT revision FROM player_saves WHERE user_id=?').get(retired.user.id);
  const rejected=await h.api('/court/negotiations/'+submitted.id+'/accept',post(retired,{requestId:crypto.randomUUID(),proposalRevision:submitted.revision,confirmed:true,deviceId:retired.deviceId,expectedRevision:saved.revision},409));
  assert.equal(rejected.data.error.code,'COURT_NEGOTIATION_INELIGIBLE');assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM court_vassals').get().n,0);
 });
 await scope('negotiation admission rechecks a government opened after the initial eligibility read',async h=>{
  const retired=await fixture(h,'競合時の上皇',{startCastle:'kiyosu'}),successor=await fixture(h,'競合時の後継',{startCastle:'ishikawa'}),lord=await fixture(h,'競合開府の公家',{startCastle:'odawara'});
  noble(h,lord);retirement(h,retired,successor);
  h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO court_negotiation_requests')))return;h.beforeBatch=null;control(h,lord);};
  const blocked=await h.api('/court/negotiations',post(lord,{requestId:crypto.randomUUID(),targetPlayerId:retired.user.id,offer:{gold:100},confirmed:true},409));
  assert.equal(blocked.data.error.code,'COURT_NEGOTIATION_INELIGIBLE');assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM court_negotiations').get().n,0);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM court_negotiation_requests').get().n,0);
 });
 await scope('court and public field enforce independent status for shared and ordinary homes',async h=>{
  const admin=await fixture(h,'独立確認の太政大臣',{admin:true}),retired=await fixture(h,'御所にいる上皇',{staff:true}),official=await fixture(h,'支配対象の御所担当',{staff:true}),shogun=await fixture(h,'支配状態の将軍');
  retirement(h,retired,official);control(h,shogun);
  const court=(await h.api('/court',{token:retired.token})).data;assert.equal(court.self.shogunateIndependent,true);assert.equal(court.palace.control,null);
  assert.equal((await h.api('/court',{token:official.token})).data.palace.control.controller.id,shogun.user.id);
  for(const query of ['/field','/field?view=owners']){
   const data=(await h.api(query)).data;assert.equal(data.palaceControl.controller.id,shogun.user.id);
   const own=[...(data.players||[]),...(data.targets||[])].filter(p=>(p.playerId||p.id)===retired.user.id);assert(own.length>0);
   for(const value of own){assert.equal(value.shogunateIndependent,true);assert.equal(value.palaceControl,null);}
  }
  await h.api('/admin/staff',post(admin,{requestId:crypto.randomUUID(),targetPlayerId:retired.user.id,action:'dismiss'}));
  await h.api('/sync?deviceId='+retired.deviceId,{token:retired.token});
  assert.equal(await readShogunateIndependence(h.db,retired.user.id),true);assert.equal(await readPalaceControl(h.db,retired.user.id),null);
  const status=(await h.api('/court/retirement',{token:retired.token})).data.retirement;
  const ordained=(await h.api('/court/retirement/ordain',post(retired,{requestId:crypto.randomUUID(),expectedRevision:status.revision,successionId:status.successionId,confirmed:true}))).data.retirement;
  assert.equal(ordained.isCloisteredEmperor,true);assert.equal(ordained.shogunateIndependent,true);
  const cloistered=(await h.api('/court',{token:retired.token})).data;assert.equal(cloistered.self.title,'法皇');assert.equal(cloistered.self.shogunateIndependent,true);assert.equal(cloistered.palace.control,null);
  assert.equal((await h.api('/shogunate',{token:retired.token})).data.shogunate.palaceControl,null);
 });
}finally{globalThis.fetch=network;}
console.log(JSON.stringify({ok:true,checks,calls,productionRequests:0}));
