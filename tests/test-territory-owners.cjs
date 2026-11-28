'use strict';
const assert=require('node:assert/strict');
const {createController}=require('../territory-owners.js');
const person=(playerId,name=playerId)=>({playerId,name,avatarVersion:null});
const seat=(castleId,lord=null)=>({castleId,available:lord===null,lord});
const directory=(castles=[],revision=1)=>({revision,castles});
const target=(castleId,id,name=id,extra={})=>({...person(id,name),homeCastleId:castleId,targetCastleId:castleId,...extra});
const page=(targets=[],nextCursor=null,extra={})=>({ok:true,targets,nextCursor,ownersIncludeTerritories:true,...extra});
const occupied=(castleId,id,name=id,extra={})=>target(castleId,id,name,{homeCastleId:'home_'+id,holdingKind:'territory',...extra});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
let tests=0;
async function test(name,run){await run();tests++;console.log('PASS '+name);}
(async()=>{
  await test('ordinary public seats never infer ownership from campaign factions, retainers, or field duplicates',async()=>{
    const view=createController({getContext:()=>({playerId:'retainer',user:{id:'retainer'},epoch:1}),loadDirectory:async()=>({...directory([seat('kiyosu',person('lord','現在の城主')),seat('inuyama')]),self:{role:'retainer',castleId:'kiyosu'}}),requestField:async()=>page([target('kiyosu','retainer','家臣'),target('inuyama','retainer','個人戦役では自領')])});
    await view.ensure();assert.equal(view.describe('kiyosu').label,'領主 現在の城主');assert.equal(view.describe('kiyosu').relation,'other');assert.equal(view.describe('inuyama').status,'vacant');assert.equal(view.describe('unfetched').status,'unknown');
  });
  await test('an empty home seat shows its published field occupier and combines distinct lords by player id',async()=>{
    const view=createController({getContext:()=>({playerId:'occupier'}),loadDirectory:async()=>directory([seat('inuyama'),seat('kiyosu',person('home_lord','本拠の城主'))]),requestField:async()=>page([occupied('inuyama','occupier','占領した領主'),occupied('inuyama','occupier','占領した領主'),occupied('kiyosu','occupier','占領した領主'),occupied('kiyosu','home_lord','古い表示名')])});
    assert((await view.ensure()).ok);
    const one=view.describe('inuyama');assert.equal(one.status,'known');assert.equal(one.label,'領主 占領した領主');assert.equal(one.relation,'self');assert.equal(one.owners.length,1);assert.match(one.detail,/占領領主：占領した領主/);
    const combined=view.describe('kiyosu');assert.equal(combined.status,'shared');assert.deepEqual(combined.owners.map(owner=>owner.playerId),['home_lord','occupier']);assert.equal(combined.owners[0].name,'本拠の城主');
  });
  await test('ordinary vacancies require both complete current sources, including every field page capability',async()=>{
    for(const mode of ['offline','legacy','legacy-later-page','directory-offline']){
      let reads=0;const view=createController({loadDirectory:async()=>{if(mode==='directory-offline')throw Error('offline');return directory([seat('inuyama')]);},requestField:async()=>{reads++;if(mode==='offline')throw Error('offline');return page([],mode==='legacy-later-page'&&reads===1?'next':null,{ownersIncludeTerritories:mode!=='legacy'&&!(mode==='legacy-later-page'&&reads===2)});}});
      await view.ensure();assert.equal(view.describe('inuyama').status,'unknown',mode);
    }
    const ready=createController({loadDirectory:async()=>directory([seat('inuyama')]),requestField:async()=>page()});await ready.ensure();assert.equal(ready.describe('inuyama').status,'vacant');
  });
  await test('a failed field refresh retains an occupied castle and only a complete refresh makes it vacant',async()=>{
    let mode='occupied';const view=createController({loadDirectory:async()=>directory([seat('inuyama')]),requestField:async()=>{if(mode==='offline')throw Error('offline');return page(mode==='occupied'?[occupied('inuyama','u_lord','占領領主')]:[]);}});
    await view.ensure();mode='offline';await view.ensure({force:true});assert.equal(view.describe('inuyama').label,'領主 占領領主');assert.equal(view.describe('inuyama').stale,true);
    mode='vacant';await view.ensure({force:true});assert.equal(view.describe('inuyama').status,'vacant');assert.equal(view.describe('inuyama').stale,false);
  });
  await test('a current occupied holding remains visible while the home seat reader is unavailable',async()=>{
    const view=createController({loadDirectory:async()=>{throw Error('offline');},requestField:async()=>page([occupied('inuyama','u_lord','公開領主',{relationship:'allied'})])});await view.ensure();const info=view.describe('inuyama');assert.equal(info.status,'known');assert.equal(info.relation,'ally');assert.equal(info.stale,false);assert.match(info.detail,/本拠の最新情報は未確認/);
  });
  await test('a hundred-player page can contain over a thousand holdings while oversized pages stay unknown',async()=>{
    const targets=[];for(let player=0;player<100;player++)for(let castle=0;castle<11;castle++)targets.push(occupied('castle_'+castle,'u_'+player));
    const view=createController({loadDirectory:async()=>directory([seat('castle_10')]),requestField:async()=>page(targets)});assert((await view.ensure()).ok);assert.equal(view.describe('castle_10').owners.length,100);
    const bounded=createController({loadDirectory:async()=>directory([seat('inuyama')]),requestField:async()=>page(Array(12801).fill(occupied('inuyama','u_lord')))});assert.equal((await bounded.ensure()).ok,false);assert.equal(bounded.describe('inuyama').status,'unknown');
  });
  await test('major-city pagination includes all owners, deduplicates players, and reports alliances',async()=>{
    const routes=[];const view=createController({getContext:()=>({playerId:'u_self'}),loadDirectory:async()=>directory(),requestField:async(route,options)=>{routes.push(route);assert.equal(options.method,'GET');return routes.length===1?page([target('osaka','u_self','自分'),target('nagoya','u_ally','同盟領主',{relationship:'allied'})],'u_cursor'):page([target('osaka','u_other','別の領主'),target('osaka','u_self','自分')]);}});
    assert((await view.ensure()).ok);const shared=view.describe('osaka');assert.equal(shared.status,'shared');assert.equal(shared.relation,'shared');assert.equal(shared.owners.length,2);assert.match(shared.label,/^領主 .*ほか1名/);assert.match(shared.detail,/自分/);assert.match(shared.detail,/別の領主/);assert.equal(view.describe('nagoya').relation,'ally');assert.equal(view.describe('edo').status,'vacant');assert.deepEqual(routes,['/field?view=owners&limit=100','/field?view=owners&limit=100&cursor=u_cursor']);
  });
  await test('a single owner compares stable player ids rather than self flags or matching names',async()=>{
    const view=createController({getContext:()=>({playerId:'same',user:{id:'same'}}),loadDirectory:async()=>directory([seat('kiyosu',person('same','家名')),seat('inuyama',person('other','家名'))]),requestField:async()=>page([target('edo','other','家名',{self:true})])});await view.ensure();assert.equal(view.describe('kiyosu').relation,'self');assert.equal(view.describe('inuyama').relation,'other');assert.equal(view.describe('edo').relation,'other');
  });
  await test('ordinary castles use diplomacy only for the exact incumbent player id, including later pages',async()=>{
    let calls=0;const view=createController({getContext:()=>({playerId:'u_self'}),loadDirectory:async()=>directory([seat('kiyosu',person('u_lord','同じ名前')),seat('inuyama',person('u_not_allied','同じ名前')),seat('himeji',person('u_unseen','未取得の領主'))]),requestField:async()=>++calls===1?page([target('kiyosu','u_retainer','家臣',{relationship:'allied',clan:'織田家'}),target('inuyama','u_not_allied','同じ名前',{clan:'織田家'})],'cursor_more'):page([target('kiyosu','u_lord','同じ名前',{relationship:'allied',clan:'武田家'})])});
    await view.ensure();assert.equal(view.describe('kiyosu').relation,'ally');assert.equal(view.describe('kiyosu').owners[0].playerId,'u_lord');assert.equal(view.describe('inuyama').relation,'other');assert.equal(view.describe('himeji').relation,'other');
  });
  await test('failed or incomplete field refresh removes old alliance certainty without discarding a freshly read lord',async()=>{
    let mode='ready',calls=0,changes=0;const view=createController({maxPages:1,onChange:()=>changes++,loadDirectory:async()=>directory([seat('kiyosu',person('u_lord'))]),requestField:async()=>{calls++;if(mode==='failed')throw Error('offline');return page([target('kiyosu','u_lord','u_lord',{relationship:'allied'})],mode==='partial'?'more':null);}});
    await view.ensure();assert.equal(view.describe('kiyosu').relation,'ally');for(const failure of ['failed','partial']){mode=failure;await view.ensure({force:true});const record=view.describe('kiyosu');assert.equal(record.status,'known');assert.equal(record.label,'領主 u_lord');assert.equal(record.stale,false);assert.equal(record.relation,'other');assert.match(record.detail,/同盟関係は未確認/);}
    assert.equal(changes,2);mode='ready';await view.ensure({force:true});assert.equal(view.describe('kiyosu').relation,'ally');assert.doesNotMatch(view.describe('kiyosu').detail,/未確認/);assert.equal(changes,3);
  });
  await test('conflicting diplomatic snapshots cannot promote a player into an alliance',async()=>{
    const view=createController({loadDirectory:async()=>directory([seat('kiyosu',person('u_lord'))]),requestField:async()=>page([target('kiyosu','u_lord','u_lord',{relationship:'allied'}),target('osaka','u_lord','u_lord',{relationship:'neutral'}),target('nagoya','u_lord','u_lord',{relationship:'allied'})])});
    await view.ensure();assert.equal(view.describe('kiyosu').relation,'other');assert.equal(view.describe('osaka').relation,'other');assert.equal(view.describe('nagoya').relation,'other');
  });
  await test('Kyoto always remains shared and only verified public government metadata supplies its controller',async()=>{
    const view=createController({getContext:()=>({playerId:'u_emperor'}),loadDirectory:async()=>directory(),requestField:async()=>page([target('kyoto_gosho','u_emperor','天皇の名')],null,{palaceControl:{castleId:'kyoto_gosho',governmentName:'山城幕府',controller:{id:'u_shogun',name:'将軍の名'}}})});
    assert.equal(view.describe('kyoto_gosho').status,'shared');await view.ensure();const palace=view.describe('kyoto_gosho');assert.equal(palace.label,'朝廷の共同領地');assert.equal(palace.relation,'shared');assert.match(palace.detail,/山城幕府.*将軍の名/);assert.doesNotMatch(palace.detail,/運営|サブ運営/);
  });
  await test('unknown, malformed, failed, partial, and over-limit responses never assert vacancies',async()=>{
    for(const mode of ['failed','malformed','partial','loop','bounded']){
      let calls=0;const view=createController({maxPages:2,loadDirectory:async()=>{throw Error('offline');},requestField:async()=>{calls++;if(mode==='failed')throw Error('offline');if(mode==='malformed')return{players:[]};if(mode==='partial'&&calls===2)throw Error('later page lost');return page([target('osaka','u_seen')],mode==='loop'?'same_cursor':'cursor_'+calls);}});
      assert.equal(view.describe('edo').status,'unknown');assert.equal((await view.ensure()).ok,false);assert.equal(view.describe('kiyosu').status,'unknown');assert.equal(view.describe('edo').status,'unknown');assert.equal(view.describe('osaka').status,'unknown');assert.equal(view.describe('kyoto_gosho').status,'shared');assert(calls<=2);
    }
    const conflict=createController({loadDirectory:async()=>directory([{castleId:'kiyosu',available:true,lord:person('u_still_here')}]),requestField:async()=>page()});await conflict.ensure();assert.equal(conflict.describe('kiyosu').status,'unknown');
  });
  await test('failed refresh retains last confirmed names visibly marked stale and success removes the warning',async()=>{
    let fail=false,name='前の領主';const view=createController({loadDirectory:async()=>{if(fail)throw Error('offline');return directory([seat('kiyosu',person('u_lord',name))]);},requestField:async()=>{if(fail)throw Error('offline');return page([target('osaka','u_lord',name)]);}});
    await view.ensure();fail=true;await view.ensure({force:true});for(const id of ['kiyosu','osaka']){assert.equal(view.describe(id).label,'領主 前の領主');assert.equal(view.describe(id).stale,true);assert.match(view.describe(id).detail,/前回確認.*最新の領主は未確認/);}
    fail=false;name='継承後の領主';await view.ensure({force:true});for(const id of ['kiyosu','osaka']){assert.equal(view.describe(id).label,'領主 '+name);assert.equal(view.describe(id).stale,false);assert.doesNotMatch(view.describe(id).detail,/未確認/);}
  });
  await test('each source refreshes independently and an older residency revision cannot undo succession',async()=>{
    let revision=3,failField=false;const view=createController({loadDirectory:async()=>directory([seat('kiyosu',person(revision===3?'new':'old'))],revision),requestField:async()=>{if(failField)throw Error();return page([target('edo','edo_lord')]);}});await view.ensure();revision=2;await view.ensure({force:true});assert.equal(view.describe('kiyosu').label,'領主 new');assert.equal(view.describe('kiyosu').stale,true);assert.equal(view.describe('edo').stale,false);revision=4;failField=true;await view.ensure({force:true});assert.equal(view.describe('kiyosu').stale,false);assert.equal(view.describe('edo').stale,true);
  });
  await test('concurrent reads coalesce and the TTL suppresses duplicate requests and unchanged notifications',async()=>{
    const wait=deferred();let time=0,reads=0,changes=0,forceFlag=false;
    const view=createController({now:()=>time,onChange:()=>changes++,loadDirectory:async options=>{reads++;forceFlag=options.force;await wait.promise;return directory([seat('kiyosu',person('u_owner'))]);},requestField:async()=>page()});
    const first=view.ensure(),second=view.ensure({force:true});assert.equal(first,second);await tick();assert.equal(reads,1);wait.resolve();await first;assert.equal(forceFlag,true);assert.equal(changes,1);await view.ensure();assert.equal(reads,1);time=30001;await view.ensure();assert.equal(reads,2);assert.equal(changes,1);
  });
  await test('identity and privilege changes discard pending reads and old completions cannot clear the new request',async()=>{
    let current={playerId:'old',user:{id:'old'},epoch:1,accountEpoch:1,privilegeEpoch:1};const old=deferred(),fresh=deferred();let reads=0;
    const view=createController({getContext:()=>current,loadDirectory:()=>++reads===1?old.promise:fresh.promise,requestField:async()=>page()});
    const before=view.ensure();await tick();current={...current,playerId:'new',user:{id:'new'},epoch:2};assert.equal(view.describe('kiyosu').status,'unknown');const after=view.ensure();await tick();old.resolve(directory([seat('kiyosu',person('old'))]));assert.equal((await before).ignored,true);assert.equal(view.ensure(),after);fresh.resolve(directory([seat('kiyosu',person('new'))]));await after;assert.equal(view.describe('kiyosu').relation,'self');current={...current,privilegeEpoch:2};assert.equal(view.describe('kiyosu').status,'unknown');
  });
  await test('pending, banned, mismatched identities and explicit reset never retain another account display',async()=>{
    let context={playerId:'u_self',user:{id:'u_self'}},reads=0;const view=createController({getContext:()=>context,loadDirectory:async()=>{reads++;return directory([seat('kiyosu',person('u_self'))]);},requestField:async()=>page()});
    await view.ensure();view.reset();assert.equal(view.describe('kiyosu').status,'unknown');await view.ensure();for(const patch of [{pending:true},{banned:true},{user:{id:'someone_else'}}]){context={playerId:'u_self',user:{id:'u_self'},...patch};const prior=reads;assert.equal((await view.ensure()).blocked,true);assert.equal(reads,prior);assert.equal(view.describe('kiyosu').status,'unknown');}
  });
  await test('names remain exact plain strings and returned records cannot mutate the cache',async()=>{
    const name='<img src=x onerror=bad>葛\u{E0100}西 & "領主"',appearance={frame:'gold'};
    const view=createController({loadDirectory:async()=>directory([seat('kiyosu',{...person('u_name',name),appearance})]),requestField:async()=>page()});await view.ensure();const first=view.describe('kiyosu');assert.equal(first.label,'領主 '+name);assert.equal(first.owners[0].name,name);assert(!Object.hasOwn(first,'html'));first.owners[0].name='changed';first.owners[0].appearance.frame='changed';assert.equal(view.describe('kiyosu').label,'領主 '+name);assert.equal(view.describe('kiyosu').owners[0].appearance.frame,'gold');assert.equal(appearance.frame,'gold');
  });
  console.log(`Territory owners: ${tests} scenarios passed; no production requests.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
