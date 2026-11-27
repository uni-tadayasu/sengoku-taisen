import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {harness} from './test-support.mjs';
import {fixture,post,row,save,appoint,count,nominateSuccessor,certifySuccessor} from './test-court-support.mjs';
import {listCourtEventTemplates} from './court-event-planner.js';

const {cleanEvent}=createRequire(import.meta.url)('../events.js');
const roomUI=createRequire(import.meta.url)('../court-event-room.js');
const DAY=86400000,templates=listCourtEventTemplates(),preset=templates[0];
const selected=templates.find(t=>!globalThis.SengokuBattleCatalog.get(t.battleId)?.unificationEligible&&!globalThis.SengokuBattleCatalog.targetCastleId({battleId:t.battleId,battle:globalThis.SengokuBattleCatalog.get(t.battleId)}))||preset;
let checks=0,calls=0;
async function scope(name,run){const h=harness();try{await run(h);checks++;console.log('PASS '+name);}finally{calls+=h.calls;h.close();}}
function validateEvent(event){assert(cleanEvent(event,true),'Actual event UI must accept the canonical room plan');assert.doesNotThrow(()=>roomUI.cleanEvent(event),'Actual room UI must accept the private event DTO');assert(Number.isSafeInteger(event.revision)&&event.revision>=0);assert(event.creator.id&&event.creator.name);assert.equal(event.source.generator,'game-ai-v1');assert(['ai','template'].includes(event.source.mode));return event;}
function validateDirectory(data){assert.doesNotThrow(()=>roomUI.cleanDirectory(data),'Actual room UI must accept the directory');assert.equal(data.canManage,true);assert(Number.isFinite(Date.parse(data.serverNow)));assert.equal(data.templates.length,20);assert.equal(new Set(data.templates.map(t=>t.id)).size,20);data.events.forEach(validateEvent);assert.equal(data.draftLimit,30);assert(Number.isInteger(data.draftCount));assert.equal(typeof data.hasMore,'boolean');return data;}
const directory=async(h,actor)=>validateDirectory((await h.api('/court/events',{token:actor.token})).data);
const body=(extra={})=>({requestId:crypto.randomUUID(),generationMode:'template',templateId:selected.id,durationDays:1,...extra});
async function draft(h,actor,input=body(),expected=200){const r=await h.api('/court/events/generate',post(actor,input,expected));if(r.response.status===200){validateEvent(r.data.event);assert.doesNotThrow(()=>roomUI.cleanMutation(r.data,{action:'generate',eventId:'',data:input}));}return r;}
async function change(h,actor,event,action,extra={},expected=200){const input={requestId:crypto.randomUUID(),expectedRevision:event.revision,...extra},r=await h.api('/court/events/'+event.id+'/'+action,post(actor,input,expected));if(r.response.status===200){validateEvent(r.data.event);assert.doesNotThrow(()=>roomUI.cleanMutation(r.data,{action,eventId:event.id,data:input}));}return{...r,body:input};}
async function regent(h,admin,target){const d=(await h.api('/admin/court/regent',{token:admin.token})).data;await h.api('/admin/court/regent',post(admin,{action:'appoint',targetPlayerId:target.user.id,expectedRevision:d.revision,requestId:crypto.randomUUID()}));}
async function setup(h){const admin=await fixture(h,'作成室の太政大臣',{admin:true}),staff=await fixture(h,'作成室の御所担当',{staff:true}),deputy=await fixture(h,'一般拠点の摂政',{startCastle:'inuyama'});await regent(h,admin,deputy);return{admin,staff,deputy};}
const state=h=>Object.fromEntries(['timed_events','court_event_room_events','court_event_room_requests'].map(table=>[table,h.sql.prepare('SELECT * FROM '+table+' ORDER BY 1,2').all()]));
function seedDrafts(h,creator,from,total){const plan=JSON.stringify(from.plan);for(let i=0;i<total;i++)h.sql.prepare("INSERT INTO timed_events(id,creator_id,name,duration_days,status,plan_json,created_at) VALUES(?,?,?,?,'draft',?,?)").run('ev_'+crypto.randomUUID().replaceAll('-',''),creator.user.id,from.name,from.durationDays,plan,h.now+i);}
async function victory(run){const original=crypto.getRandomValues;crypto.getRandomValues=function(value){return value instanceof Uint32Array&&value.length===1?value.fill(0):original.call(crypto,value);};try{return await run();}finally{crypto.getRandomValues=original;}}
const network=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Court event room tests must stay local');};
try{
 await scope('the shared room is exclusive to current court duties and never expands the admin event routes',async h=>{
  const{admin,staff,deputy}=await setup(h),ordinary=await fixture(h,'作成室外の領主');
  await h.api('/court/events',{expected:401});await h.api('/court/events',{token:ordinary.token,expected:403});await draft(h,ordinary,body({isStaff:true}),403);
  for(const actor of [admin,staff,deputy]){const d=await directory(h,actor);assert.deepEqual(d.events,[]);assert.equal(d.generator.id,'game-ai-v1');assert.equal(d.activeEvent,null);assert.equal(d.draftCount,0);assert.equal((await h.api('/court',{token:actor.token})).data.features.eventRoom,true);}
  for(const actor of [staff,deputy]){await h.api('/admin/events',{token:actor.token,expected:403});await h.api('/admin/events/generate',post(actor,{battleId:selected.battleId,durationDays:1,requestId:crypto.randomUUID()},403));}
  assert.equal((await h.api('/court',{token:ordinary.token})).data.features.eventRoom,false);
 });
 await scope('a retired Emperor at an ordinary castle cannot use the room through their former crown or title',async h=>{
  const{admin,staff}=await setup(h),successor=await fixture(h,'譲位後の天皇',{staff:true});await appoint(h,staff);const nomination=(await nominateSuccessor(h,staff,successor)).nomination;
  assert.equal(nomination.status,'pending');await directory(h,staff);assert.equal(h.sql.prepare('SELECT 1 FROM court_retired_emperors WHERE user_id=?').get(staff.user.id),undefined);
  await certifySuccessor(h,admin,nomination);
  assert(h.sql.prepare('SELECT 1 FROM court_retired_emperors WHERE user_id=?').get(staff.user.id));const restored=(await h.api('/sync?deviceId='+staff.deviceId,{token:staff.token})).data;assert.equal(restored.user.isStaff,false);assert.notEqual(restored.save.state.home,'kyoto_gosho');
  await h.api('/court/events',{token:staff.token,expected:403});await draft(h,staff,body(),403);assert.equal((await h.api('/court',{token:staff.token})).data.features.eventRoom,false);
 });
 await scope('strict HTTP validation cannot set public status, plans, resources, clocks or permissions',async h=>{
  const{staff}=await setup(h);
  for(const durationDays of [0,8,1.5,'2',null])await draft(h,staff,body({durationDays}),400);
  for(const generationMode of ['other','',null,1])await draft(h,staff,body({generationMode}),400);
  for(const templateId of [null,'unknown','__proto__',{},12])await draft(h,staff,body({templateId}),400);
  await draft(h,staff,{requestId:crypto.randomUUID(),generationMode:'template',durationDays:1},400);await draft(h,staff,{requestId:crypto.randomUUID(),generationMode:'ai',durationDays:1},400);
  for(const prompt of [null,5,{},'文'.repeat(601),'本陣\u0000の戦い','<script>bad</script>'])await draft(h,staff,body({prompt}),400);
  for(const extra of [{plan:{}},{status:'active'},{rewards:{gold:999999}},{now:0},{isAdmin:true},{expectedRevision:0},{seed:'client-seed'}])await draft(h,staff,body(extra),400);
  await h.api('/court/events?limit=50',{token:staff.token,expected:400});await h.api('/court/events/generate',post(staff,[],400));
  assert.equal(count(h,'timed_events'),0);assert.equal(count(h,'court_event_room_requests'),0);
 });
 await scope('template and AI generation produce immutable shared private drafts with canonical plans',async h=>{
  const{admin,staff,deputy}=await setup(h),saves=h.sql.prepare('SELECT * FROM player_saves ORDER BY user_id').all(),roles=h.sql.prepare('SELECT * FROM staff_members ORDER BY user_id').all(),input=body(),first=(await draft(h,staff,input)).data;
  assert.equal(first.event.status,'draft');assert.equal(first.event.revision,0);assert.equal(first.event.startsAt,null);assert.equal(first.event.endsAt,null);assert.equal(first.event.source.templateId,selected.id);assert.equal(first.event.creator.id,staff.user.id);assert.deepEqual(first.receipt,{action:'generate',eventId:first.event.id,revision:0});
  const same=(await draft(h,staff,input)).data;assert.equal(same.idempotent,true);assert.deepEqual(same.event,first.event);assert.deepEqual(same.receipt,first.receipt);await draft(h,staff,{...input,durationDays:2},409);
  const prompt='初心者向けの\n 川沿いの戦い\tを計画',ai=(await draft(h,deputy,body({generationMode:'ai',templateId:undefined,prompt}))).data;assert.equal(ai.event.source.mode,'ai');assert.equal(ai.event.source.prompt,'初心者向けの 川沿いの戦い を計画');assert(ai.event.source.reasons.length>0);assert(ai.event.source.matchedKeywords.length>0);assert.equal(ai.event.plan.commandCost,1);assert.equal(ai.event.plan.stages.length,3);assert.equal(ai.event.plan.tactics.length,5);
  const d=await directory(h,admin);assert.deepEqual(new Set(d.events.map(e=>e.id)),new Set([first.event.id,ai.event.id]));assert.equal(d.draftCount,2);assert.equal(d.activeEvent,null);assert.equal((await h.api('/events')).data.events.length,0);
  for(const e of d.events){await h.api('/events/'+e.id,{expected:404});const shared=(await h.api('/court/events/'+e.id,{token:deputy.token})).data;assert.deepEqual(shared.event,e);}
  assert.deepEqual(h.sql.prepare('SELECT * FROM player_saves ORDER BY user_id').all(),saves);assert.deepEqual(h.sql.prepare('SELECT * FROM staff_members ORDER BY user_id').all(),roles);assert.equal(count(h,'timed_event_participants'),0);assert.equal(count(h,'mail_campaigns'),0);
 });
 await scope('the natural brief accepts 600 Unicode codepoints and whitespace-normalized retries share one receipt',async h=>{
  const{staff}=await setup(h),input=body({generationMode:'ai',prompt:'🐎'.repeat(600)}),generated=(await draft(h,staff,input)).data;assert.equal(Array.from(generated.event.source.prompt).length,600);await draft(h,staff,body({generationMode:'ai',prompt:'🐎'.repeat(601)}),400);
  const multiline=body({generationMode:'ai',prompt:'  夜戦\n初心者\t 奇襲  '}),first=(await draft(h,staff,multiline)).data,again=(await draft(h,staff,{...multiline,prompt:'夜戦 初心者 奇襲'})).data;assert.equal(again.idempotent,true);assert.deepEqual(again.receipt,first.receipt);assert.deepEqual(again.event,first.event);assert.equal(count(h,'timed_events'),2);
 });
 await scope('all duties members can explicitly publish and end another member draft with stable replay receipts',async h=>{
  const{admin,staff,deputy}=await setup(h),input=body({durationDays:3}),generated=(await draft(h,staff,input)).data,saves=h.sql.prepare('SELECT * FROM player_saves ORDER BY user_id').all();h.now+=1000;
  const published=await change(h,deputy,generated.event,'publish');assert.equal(published.data.event.status,'active');assert.equal(published.data.event.revision,1);assert.equal(published.data.event.startsAt,new Date(h.now).toISOString());assert.equal(Date.parse(published.data.event.endsAt)-h.now,3*DAY);assert.deepEqual(published.data.receipt,{action:'publish',eventId:generated.event.id,revision:1});
  const publicEvent=(await h.api('/events/'+generated.event.id)).data.event;assert.equal(publicEvent.status,'active');assert.equal(publicEvent.source,undefined);assert.equal(publicEvent.creator,undefined);assert.deepEqual(publicEvent.plan,generated.event.plan);
  await change(h,staff,generated.event,'discard',{},409);const generatedAgain=(await draft(h,staff,input)).data;assert.deepEqual(generatedAgain.receipt,generated.receipt);assert.equal(generatedAgain.event.status,'active');assert.equal(generatedAgain.idempotent,true);
  h.now+=500;const ended=await change(h,admin,published.data.event,'end');assert.equal(ended.data.event.status,'ended');assert.equal(ended.data.event.revision,2);assert.equal(ended.data.event.endedAt,new Date(h.now).toISOString());
  const again=await change(h,deputy,generated.event,'publish',published.body);assert.equal(again.data.idempotent,true);assert.deepEqual(again.data.receipt,published.data.receipt);assert.equal(again.data.event.status,'ended');assert.equal(again.data.event.revision,2);
  const endAgain=await change(h,admin,published.data.event,'end',ended.body);assert.equal(endAgain.data.idempotent,true);assert.deepEqual(endAgain.data.receipt,ended.data.receipt);assert.equal(count(h,'court_event_room_requests'),3);assert.deepEqual(h.sql.prepare('SELECT * FROM player_saves ORDER BY user_id').all(),saves);
 });
 await scope('discard is explicit, durable, idempotent and never makes a plan public',async h=>{
  const{staff,deputy}=await setup(h),generated=(await draft(h,staff)).data,discarded=await change(h,deputy,generated.event,'discard');assert.equal(discarded.data.event.status,'discarded');assert.equal(discarded.data.event.revision,1);assert.equal(discarded.data.event.startsAt,null);
  const again=await change(h,deputy,generated.event,'discard',discarded.body);assert.equal(again.data.idempotent,true);assert.deepEqual(again.data.receipt,discarded.data.receipt);await h.api('/events/'+generated.event.id,{expected:404});assert.equal((await h.api('/events')).data.events.length,0);assert.equal((await directory(h,staff)).draftCount,0);
  await change(h,staff,discarded.data.event,'publish',{},409);await change(h,staff,discarded.data.event,'end',{},409);assert.equal(count(h,'timed_event_participants'),0);assert.equal(count(h,'timed_event_rewards'),0);
 });
 await scope('room APIs never read or mutate drafts created through the independent admin interface',async h=>{
  const{admin,staff}=await setup(h),created=(await h.api('/admin/events/generate',post(admin,{battleId:selected.battleId,durationDays:1,requestId:crypto.randomUUID()}))).data.event;
  assert.deepEqual((await directory(h,staff)).events,[]);assert.equal((await directory(h,staff)).draftCount,1);
  for(const actor of [staff,admin]){await h.api('/court/events/'+created.id,{token:actor.token,expected:404});for(const action of ['publish','end','discard'])await change(h,actor,{...created,revision:0},action,{},404);}
  const active=(await h.api('/admin/events/'+created.id+'/publish',post(admin,{requestId:crypto.randomUUID()}))).data.event,d=await directory(h,staff);assert.equal(d.activeEvent.id,active.id);assert.equal(d.events.length,0);assert.equal(count(h,'court_event_room_requests'),0);
 });
 await scope('room and admin publication share the single active event transaction constraint',async h=>{
  const{admin,staff}=await setup(h),room=(await draft(h,staff)).data.event,adminEvent=(await h.api('/admin/events/generate',post(admin,{battleId:selected.battleId,durationDays:1,requestId:crypto.randomUUID()}))).data.event;
  const outcomes=await Promise.all([change(h,staff,room,'publish',{},null),h.api('/admin/events/'+adminEvent.id+'/publish',post(admin,{requestId:crypto.randomUUID()},null))]);assert.deepEqual(outcomes.map(r=>r.response.status).sort(),[200,409]);assert.equal(h.sql.prepare("SELECT COUNT(*) n FROM timed_events WHERE status='active'").get().n,1);
  const active=outcomes.find(r=>r.response.status===200).data.event;assert.equal((await directory(h,staff)).activeEvent.id,active.id);assert.equal((await h.api('/events')).data.events.length,1);
 });
 await scope('concurrent draft actions use event revisions and same-request generation creates one event',async h=>{
  const{staff,deputy}=await setup(h),input=body(),generated=await Promise.all([draft(h,staff,input),draft(h,staff,input)]);assert.equal(count(h,'timed_events'),1);assert.equal(count(h,'court_event_room_requests'),1);assert.deepEqual(generated[0].data.receipt,generated[1].data.receipt);assert.equal(generated.filter(r=>r.data.idempotent).length,1);
  const e=generated[0].data.event,changed=await Promise.all([change(h,staff,e,'publish',{},null),change(h,deputy,e,'discard',{},null)]);assert.deepEqual(changed.map(r=>r.response.status).sort(),[200,409]);assert.equal(h.sql.prepare('SELECT revision FROM timed_events WHERE id=?').get(e.id).revision,1);assert.equal(count(h,'court_event_room_requests'),2);
  const won=changed.find(r=>r.response.status===200),actor=won===changed[0]?staff:deputy,action=won===changed[0]?'publish':'discard';await change(h,actor,e,action,{...won.body,expectedRevision:1},409);
 });
 await scope('the 30-draft cap is shared, atomic at its last slot, and has a discard escape',async h=>{
  const{admin,staff,deputy}=await setup(h),first=(await draft(h,staff)).data.event;seedDrafts(h,admin,first,28);const a=body(),b=body(),last=await Promise.all([draft(h,staff,a,null),draft(h,deputy,b,null)]);assert.deepEqual(last.map(r=>r.response.status).sort(),[200,409]);assert.equal(h.sql.prepare("SELECT COUNT(*) n FROM timed_events WHERE status='draft'").get().n,30);assert.equal(last.find(r=>r.response.status===409).data.error.code,'EVENT_DRAFT_LIMIT');
  const blocked=body();await draft(h,staff,blocked,409);await h.api('/admin/events/generate',post(admin,{battleId:selected.battleId,durationDays:1,requestId:crypto.randomUUID()},409));await change(h,deputy,first,'discard');assert.equal((await draft(h,staff,blocked)).data.event.status,'draft');assert.equal((await directory(h,staff)).draftCount,30);
 });
 await scope('history stays bounded while current and every room draft remain visible',async h=>{
  const{staff}=await setup(h),event=(await draft(h,staff)).data.event,record=h.sql.prepare('SELECT * FROM court_event_room_events WHERE event_id=?').get(event.id);
  for(let i=0;i<55;i++){const id='ev_'+crypto.randomUUID().replaceAll('-','');h.sql.prepare("INSERT INTO timed_events(id,creator_id,name,duration_days,status,plan_json,revision,created_at) VALUES(?,?,?,?,'discarded',?,1,?)").run(id,staff.user.id,event.name,event.durationDays,JSON.stringify(event.plan),h.now+i+1);h.sql.prepare('INSERT INTO court_event_room_events(event_id,generation_mode,template_id,source_json,created_by,created_at) VALUES(?,?,?,?,?,?)').run(id,record.generation_mode,record.template_id,record.source_json,record.created_by,h.now+i+1);}
  const d=await directory(h,staff);assert.equal(d.events.length,50);assert.equal(d.hasMore,true);assert.equal(d.events[0].id,event.id);assert.equal(d.draftCount,1);
 });
 await scope('event expiration uses real server time and releases the shared active slot at the exact boundary',async h=>{
  const{staff}=await setup(h),first=(await draft(h,staff)).data.event,active=(await change(h,staff,first,'publish')).data.event,next=(await draft(h,staff)).data.event;
  h.now=Date.parse(active.endsAt)-1;await change(h,staff,next,'publish',{},409);assert.equal((await directory(h,staff)).activeEvent.id,first.id);
  h.now++;let d=await directory(h,staff);assert.equal(d.activeEvent,null);assert.equal(d.events.find(e=>e.id===first.id).status,'ended');assert.equal(d.events.find(e=>e.id===first.id).endedAt,active.endsAt);await change(h,staff,active,'end',{},409);assert.equal((await change(h,staff,next,'publish')).data.event.status,'active');
 });
 await scope('a staff term or current Regent token invalidated during generation cannot commit any draft or receipt',async h=>{
  const{staff,deputy}=await setup(h),before=state(h);
  h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO court_event_room_requests')))return;h.beforeBatch=null;h.sql.prepare('UPDATE staff_members SET term_id=? WHERE user_id=?').run(crypto.randomUUID(),staff.user.id);};
  const staffResult=await draft(h,staff,body({generationMode:'ai',prompt:'山の初心者向け合戦'}),409);assert.equal(staffResult.data.error.code,'COURT_EVENT_ACCESS_CHANGED');assert.deepEqual(state(h),before);
  h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO court_event_room_requests')))return;h.beforeBatch=null;h.sql.prepare('UPDATE court_regent SET appointment_token=? WHERE id=1').run(crypto.randomUUID());};
  const regentResult=await draft(h,deputy,body({generationMode:'ai',prompt:'海辺の上級者向け合戦'}),409);assert.equal(regentResult.data.error.code,'COURT_EVENT_ACCESS_CHANGED');assert.deepEqual(state(h),before);
 });
 await scope('operator handover, staff removal and ban before publication each fence out the pending writer',async h=>{
  const{admin,staff,deputy}=await setup(h),event=(await draft(h,staff)).data.event,before=state(h);
  h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO court_event_room_requests')))return;h.beforeBatch=null;h.sql.prepare("UPDATE settings SET value=? WHERE key='adminUserId'").run(staff.user.id);};await change(h,admin,event,'publish',{},409);assert.deepEqual(state(h),before);h.sql.prepare("UPDATE settings SET value=? WHERE key='adminUserId'").run(admin.user.id);
  h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO court_event_room_requests')))return;h.beforeBatch=null;h.sql.prepare('DELETE FROM staff_members WHERE user_id=?').run(staff.user.id);};await change(h,staff,event,'publish',{},409);assert.deepEqual(state(h),before);
  h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO court_event_room_requests')))return;h.beforeBatch=null;h.sql.prepare('INSERT INTO player_bans(user_id,active,revision,banned_by,updated_at) VALUES(?,1,1,?,?)').run(deputy.user.id,admin.user.id,h.now);};await change(h,deputy,event,'publish',{},403);assert.deepEqual(state(h),before);assert.equal(count(h,'timed_event_participants'),0);
 });
 await scope('revoked Regent or staff access cannot return a private room response after public decoration',async h=>{
  const{staff,deputy}=await setup(h);await draft(h,staff,body({prompt:'秘匿された企画依頼'}));let changed=false;
  h.beforeBatch=statements=>{if(changed||!statements.some(s=>s.sql.includes('public-court-office')))return;changed=true;h.sql.exec('DELETE FROM court_regent');};const response=await h.api('/court/events',{token:deputy.token,expected:409});assert(changed);assert.equal(response.data.events,undefined);assert.equal(response.data.error.code,'COURT_EVENT_ACCESS_CHANGED');h.beforeBatch=null;
  const e=(await directory(h,staff)).events[0];changed=false;h.beforeBatch=statements=>{if(changed||!statements.some(s=>s.sql.includes('public-court-office')))return;changed=true;h.sql.prepare('DELETE FROM staff_members WHERE user_id=?').run(staff.user.id);};const detail=await h.api('/court/events/'+e.id,{token:staff.token,expected:409});assert(changed);assert.equal(detail.data.event,undefined);h.beforeBatch=null;
 });
 await scope('the final activity observer cannot leak private room data after a Regent is revoked',async h=>{
  const{staff,deputy}=await setup(h),secret='応答直前まで御所内に限る企画';await draft(h,staff,body({prompt:secret}));h.now+=DAY;let changed=false;
  h.beforeBatch=statements=>{if(changed||!statements.some(s=>s.sql.includes('INSERT INTO player_activity_program')))return;changed=true;h.sql.exec('DELETE FROM court_regent');};
  const response=await h.api('/court/events',{token:deputy.token,expected:409});assert(changed,'The first observation of the new day must run after the public decorations');assert.equal(response.data.error.code,'COURT_EVENT_ACCESS_CHANGED');assert.equal(response.data.events,undefined);assert(!JSON.stringify(response.data).includes(secret));assert.equal(count(h,'court_regent'),0);h.beforeBatch=null;
 });
 await scope('an injected transaction failure rolls back canonical event, private metadata and receipt together',async h=>{
  const{staff}=await setup(h),before=state(h),input=body();h.sql.exec("CREATE TRIGGER fixture_room_failure BEFORE INSERT ON court_event_room_events BEGIN SELECT RAISE(ABORT,'fixture room failure'); END");await draft(h,staff,input,500);assert.deepEqual(state(h),before);h.sql.exec('DROP TRIGGER fixture_room_failure');
  const e=(await draft(h,staff,input)).data.event,publishBefore=state(h);h.beforeBatch=statements=>{if(statements.some(s=>s.sql.includes('INSERT INTO court_event_room_requests')))statements.push(h.db.prepare('UPDATE fixture_missing_table SET value=1'));};await change(h,staff,e,'publish',{},500);h.beforeBatch=null;assert.deepEqual(state(h),publishBefore);
 });
 await scope('a committed draft with a withheld response stays private and a later authorized replay cannot duplicate it',async h=>{
  const{admin,deputy,staff}=await setup(h),input=body({generationMode:'ai',prompt:'夜戦の企画'});let changed=false;
  h.afterBatch=statements=>{if(changed||!statements.some(s=>s.sql.includes('INSERT INTO court_event_room_requests')))return;changed=true;h.sql.exec('DELETE FROM court_regent');};const lost=await draft(h,deputy,input,409);assert(changed);assert.equal(lost.data.event,undefined);assert.equal(count(h,'timed_events'),1);assert.equal(count(h,'court_event_room_requests'),1);h.afterBatch=null;
  await draft(h,deputy,input,403);assert.equal((await directory(h,staff)).events.length,1);assert.equal((await h.api('/events')).data.events.length,0);await regent(h,admin,deputy);
  const recovered=(await draft(h,deputy,input)).data;assert.equal(recovered.idempotent,true);assert.equal(recovered.event.status,'draft');assert.equal(count(h,'timed_events'),1);assert.equal(count(h,'court_event_room_requests'),1);
 });
 await scope('published room events use the original battle, command and once-only reward machinery without leaking briefs',async h=>victory(async()=>{
  const{staff}=await setup(h),p=await fixture(h,'作成室イベントの参加者'),secret='公開しない企画の内部連絡',e=(await draft(h,staff,body({prompt:secret}))).data.event,event=(await change(h,staff,e,'publish')).data.event,before=save(h,p),request={stageId:event.plan.stages[2].id,tactic:event.plan.stages[2].recommendedTactic,requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:row(h,p).revision};
  const outcome=(await h.api('/events/'+event.id+'/battle',post(p,request))).data;assert.equal(outcome.battle.won,true);assert.equal(outcome.battle.commandCost,1);assert.equal(outcome.save.state.command,before.state.command-1);assert.deepEqual(outcome.battle.offeredRewards,event.plan.battleRewards.victory[2]);assert.deepEqual(outcome.save.state.castles,before.state.castles);assert.equal(outcome.save.state.troops,before.state.troops);assert(outcome.rewardMailIds.length>0);
  const committed=row(h,p),replay=(await h.api('/events/'+event.id+'/battle',post(p,request))).data;assert.equal(replay.idempotent,true);assert.deepEqual(row(h,p),committed);assert.deepEqual(replay.rewardMailIds,outcome.rewardMailIds);assert.equal(h.sql.prepare("SELECT COUNT(*) n FROM timed_event_requests WHERE action='battle'").get().n,1);
  for(const data of [outcome,replay,(await h.api('/events')).data,(await h.api('/events/'+event.id,{token:p.token})).data]){assert(!JSON.stringify(data).includes(secret));assert.equal(data.event?.source,undefined);assert.equal(data.event?.creator,undefined);}
 }));
}finally{globalThis.fetch=network;}
console.log(`${checks} court event room scenarios / ${calls} API calls passed.`);
