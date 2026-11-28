'use strict';
const assert=require('node:assert/strict');
const F=require('../field.js');
let count=0;function test(name,fn){fn();count++;console.log('PASS '+name);}
const player=(id,home='kiyosu',more={})=>({playerId:id,name:'領主'+id,clan:'織田家',homeCastleId:home,homeCastleName:'清洲城',level:3,defenseTroops:1200,defensePower:4200,attackable:true,relationship:'neutral',...more});
const ready=()=>({identity:{id:'me'},access:{writable:true},state:{troops:5000,command:3,resources:{rice:9000}},player:player('other'),me:{attack:{ready:true,availableTroops:5000,minTroops:300,maxTroops:100000,command:3,rice:9000},relationships:[]},troops:1000,tactic:'balanced'});
const modernRules={targetCastles:true,specialBaseBattles:true};
const target=(id,home,castle,more={})=>player(id,home,{targetCastleId:castle,targetCastleName:{edo:'江戸城',kyoto_gosho:'京都御所',sento_gosho:'仙洞御所',kagoshima:'鹿児島城',nijo:'二条城',osaka:'大坂城',nagoya:'名古屋城',kiyosu:'清洲城'}[castle],isHome:home===castle,battleMode:['edo','kyoto_gosho','sento_gosho','kagoshima'].includes(castle)?'reward':['nijo','osaka','nagoya'].includes(castle)?'capture':'raid',capturable:['nijo','osaka','nagoya'].includes(castle),...more});
test('public bases contain only real valid accounts and never fabricate empty records',()=>{
  assert.deepEqual(F.normalizePlayers({players:[]}),[]);const result=F.normalizePlayers({players:[player('a'),player('a'),{name:'no id'},player('b','edo',{isAdmin:true,attackable:false})]});assert.equal(result.length,2);assert.equal(result[1].playerId,'b');assert.equal(result[1].attackable,false);
});
test('co-located players share one exact marker while remaining individually selectable',()=>{
  const people=F.normalizePlayers([player('a'),player('b'),player('op','edo',{isAdmin:true,attackable:false})]),coords={kiyosu:{lon:136.8432,lat:35.2162},edo:{lon:139.7528,lat:35.6852}};
  const groups=F.groupBases(people,coords,[],{id:'a'});assert.equal(groups.length,2);assert.deepEqual(groups[0].players.map(p=>p.playerId),['a','b']);assert.deepEqual(groups[0].geo,coords.kiyosu);assert.equal(groups[0].owner,'あなたの領地');assert.equal(groups[1].reachable,false);assert.equal(F.groupBases(people,{},[]).length,0);
});
test('ownership labels use verified player identity rather than the shared clan name',()=>{
  const coords={kiyosu:{lon:136.8432,lat:35.2162}},make=(p,identity)=>F.groupBases(F.normalizePlayers([p]),coords,[],identity)[0];
  const other=make(player('other','kiyosu',{name:'葛西',clan:'織田家'}),{id:'me',clan:'織田家'});
  assert.equal(other.ownerLabel,'領主 葛西');assert.equal(other.ownerRelation,'other');
  assert.equal(make(player('me'),{id:'me'}).ownerRelation,'self');
  assert.equal(make(player('ally','kiyosu',{relationship:'allied'}),{id:'me'}).ownerRelation,'ally');
  assert.equal(F.ownershipFor(player('other'),{identity:{id:'me'}}).badge,'他領');
});
test('a co-located map label identifies the displayed lord without claiming exclusive ownership',()=>{
  const coords={kiyosu:{lon:136.8432,lat:35.2162}},people=F.normalizePlayers([player('a','kiyosu',{name:'甲'}),player('b','kiyosu',{name:'乙'})]);
  const first=F.groupBases(people,coords,[],{id:'a'})[0],selected=F.groupBases(people,coords,[],{id:'a'},'b:kiyosu')[0];
  assert.equal(first.ownerLabel,'領主 甲 ほか1名');assert.equal(first.ownerRelation,'shared');
  assert.equal(selected.ownerLabel,'領主 乙 ほか1名');assert.equal(selected.ownerRelation,'shared');
  assert(F.markerAppearance(selected).label.includes('領主 乙 ほか1名'));
});
test('Kyoto ownership stays shared and distinguishes its government from a stationed lord',()=>{
  const coords={kyoto_gosho:{lon:135.7621,lat:35.0254}},member=target('member','kyoto_gosho','kyoto_gosho',{name:'駐在者'});
  const shared=F.groupBases(F.normalizePlayers([member]),coords,[],{id:'member'})[0];
  assert.equal(shared.ownerLabel,'朝廷の共同領地');assert.equal(shared.ownerRelation,'shared');
  assert.equal(F.ownershipFor(member,{identity:{id:'member'}}).title,'朝廷の共同領地');
  const control={castleId:'kyoto_gosho',controller:{id:'ruler',name:'<支配者>'},governmentName:'<幕府>',controlledAt:12345},controlled={...member,palaceControl:control};
  const group=F.groupBases(F.normalizePlayers([controlled]),coords,[],{id:'member'})[0];
  assert.equal(group.ownerLabel,'支配者 <支配者>');assert.equal(group.ownerRelation,'shared');
  const banner=F.ownershipBanner(controlled,{identity:{id:'member'}});assert(banner.includes('&lt;幕府&gt;の支配下'));assert(banner.includes('支配者 &lt;支配者&gt;'));assert(!banner.includes('駐在者の領地'));assert(!banner.includes('<支配者>'));
});
test('public ownership cards and banners keep names escaped and never expose internal roles',()=>{
  const lord=player('deputy','kagoshima',{name:'<img src=x onerror=alert(1)>',isDeputy:true,isAdmin:true}),row=F.publicRow(lord,{identity:{id:'me'}}),banner=F.ownershipBanner(lord,{identity:{id:'me'}});
  assert(row.includes('field-owner-caption">領主'));assert(row.includes('field-owner-relation is-other">他領'));
  assert(banner.includes('&lt;img src=x onerror=alert(1)&gt;の領地'));assert(!banner.includes('<img src=x'));assert(!/運営|サブ運営|占領不可/.test(row+banner));
});
test('retired sovereign independence overrides stale palace control without freeing ordinary members',()=>{
  const control={castleId:'kyoto_gosho',controller:{id:'ruler',name:'支配領主'},governmentName:'試験幕府',controlledAt:12345};
  const ordinary=target('member','kyoto_gosho','kyoto_gosho',{palaceControl:control});
  const independent={...ordinary,playerId:'retired',shogunateIndependent:true};
  const banner=F.ownershipBanner(independent,{identity:{id:'me'}}),row=F.publicRow(independent);
  assert(!banner.includes('試験幕府'));assert(!row.includes('試験幕府'));
  const group=F.groupBases(F.normalizePlayers([independent]),{kyoto_gosho:{lon:135.7621,lat:35.0254}},[],{id:'me'})[0];
  assert.equal(group.ownerLabel,'朝廷の共同領地');
  assert(F.ownershipBanner(ordinary,{identity:{id:'me'}}).includes('試験幕府の支配下'));
  assert(F.publicRow({...independent,shogunateIndependent:false}).includes('試験幕府の支配下'));
});
test('raid food costs follow the authoritative four tactic formulas',()=>{
  assert.equal(F.foodCost(1000,'balanced'),450);assert.equal(F.foodCost(1000,'assault'),525);assert.equal(F.foodCost(1000,'siege'),645);assert.equal(F.foodCost(1000,'ambush'),480);assert.equal(F.foodCost(1000,'unknown'),null);
});
test('valid attack produces only semantic fields for the guarded application facade',()=>{
  const result=F.attackValidation(ready());assert.equal(result.ok,true);assert.deepEqual(result.payload,{targetPlayerId:'other',troops:1000,tactic:'balanced'});assert.equal(result.foodCost,450);assert.equal('token'in result.payload,false);assert.equal('deviceId'in result.payload,false);
});
test('guest, follower, pending transaction, own base, admin and allies cannot raid',()=>{
  for(const mutate of [v=>v.identity=null,v=>v.access.writable=false,v=>v.access.fieldPending=true,v=>v.player.playerId='me',v=>v.player.isAdmin=true,v=>v.player.homeCastleId='edo',v=>v.me.relationships=[{targetPlayerId:'other',status:'allied'}],v=>v.player.attackable=false,v=>v.me.attack.ready=false,v=>v.clock={ready:false},v=>v.clock={ready:true,clock:{running:false}}]){const context=ready();mutate(context);assert.equal(F.attackValidation(context).ok,false);}
});
test('troop bounds, commands, rice and tactics are validated before confirmation',()=>{
  for(const mutate of [v=>v.troops=299,v=>v.troops=5001,v=>v.troops=1000.5,v=>v.troops=NaN,v=>v.state.command=0,v=>v.state.resources.rice=449,v=>v.tactic='unknown']){const context=ready();mutate(context);assert.equal(F.attackValidation(context).ok,false);}
});
test('incoming, outgoing and accepted relationships stay distinguishable',()=>{
  for(const status of ['incoming','outgoing','allied'])assert.equal(F.relationshipFor(player('a'),{relationships:[{targetPlayerId:'a',status}]},{id:'me'}),status);
  assert.equal(F.relationshipFor(player('me'),{}, {id:'me'}),'self');assert.equal(F.remainingLabel(360000),'6か月');assert.equal(F.remainingLabel(59999),'60秒');
});
test('public names and identifiers are escaped before entering clickable UI',()=>{
  const html=F.publicRow(player('a" onclick="steal()','kiyosu',{name:'<script>alert(1)</script>',clan:'<img src=x>'}));assert(!html.includes('<script>'));assert(!html.includes('<img src=x>'));assert(html.includes('&lt;script&gt;'));assert(html.includes('a&quot; onclick=&quot;steal()'));
});
test('protected bases keep their action restrictions without disclosing operator or staff roles',()=>{
  const staff=F.normalizePlayers([player('staff','kyoto_gosho',{isStaff:true})])[0];assert.equal(staff.isStaff,true);assert.equal(staff.isAdmin,false);assert(!F.publicRow(staff).includes('スタッフ'));assert(F.publicRow(staff).includes('領主'));
  const context=ready();context.player=staff;assert.equal(F.attackValidation(context).ok,false);assert.match(F.attackValidation(context).message,/京都御所/);
  context.player=player('staff','kiyosu',{isStaff:true});assert.equal(F.attackValidation(context).ok,false,'A stale location must not expose an appointed staff base to attack');
  context.player=player('legacy','kyoto_gosho');assert.equal(F.attackValidation(context).ok,false,'The reserved castle stays protected while a legacy player snapshot is migrating');
  const operator=F.normalizePlayers([player('operator','edo',{isStaff:true,isAdmin:true})])[0];assert.equal(operator.isStaff,false);assert(!F.publicRow(operator).includes('運営'));assert(F.publicRow(operator).includes('領主'));
});
test('Edo caps at 64, Kyoto Gosho and Sento Gosho at 128, the three capturable cities at 48, and ordinary castles at 32',()=>{
  for(const [id,limit]of [['edo',64],['kyoto_gosho',128],['sento_gosho',128],['nijo',48],['osaka',48],['nagoya',48]]){const [p]=F.normalizePlayers([player(id,id,{level:999})]);assert.equal(p.level,limit);assert(F.publicRow(p).includes('城郭 Lv.'+limit));}
  assert.equal(F.normalizePlayers([player('a','kiyosu',{level:64})])[0].level,32);assert.equal(F.normalizePlayers([player('sunpu','sunpu',{level:999})])[0].level,32);
  assert.equal(F.normalizePlayers([player('a','kyoto_gosho',{level:999})])[0].level,128);
  const shared=F.groupBases(F.normalizePlayers([player('a','kyoto_gosho',{level:128,isStaff:true,attackable:false}),player('b','kyoto_gosho',{level:128,isStaff:true,attackable:false})]),{kyoto_gosho:{lon:135.7621,lat:35.0254}});
  assert.equal(shared.length,1);assert.equal(shared[0].level,128);assert.equal(shared[0].players.length,2);assert.equal(shared[0].reachable,false);
});
test('keep levels are distinct from castle levels and old or malformed data uses the first artwork safely',()=>{
  for(const [keepLevel,expected]of [[1,1],[8,8],[16,16],[32,32],[64,32],['24',24]]){
    const p=F.normalizePlayers([player('a','edo',{level:64,keepLevel})])[0];assert.equal(p.level,64);assert.equal(p.keepLevel,expected);assert.equal(p.keepLevelKnown,true);
    assert(F.publicRow(p).includes(`天守 Lv.${expected} · 城郭 Lv.64`));
  }
  for(const keepLevel of [undefined,null,0,-4,NaN,Infinity,'bad',{},true,2.5]){
    const p=F.normalizePlayers([player('a','edo',{level:64,keepLevel})])[0];assert.equal(p.keepLevel,1);assert.equal(p.keepLevelKnown,false);
    assert(F.publicRow(p).includes('天守 未取得'));assert.equal(F.normalizePlayers([p])[0].keepLevelKnown,false);
  }
});
test('co-located marker artwork follows selection, then the owner, then the strongest keep with stable ties',()=>{
  const people=F.normalizePlayers([player('b','kiyosu',{keepLevel:24,level:2}),player('a','kiyosu',{keepLevel:4,level:32}),player('c','kiyosu',{keepLevel:24,level:8})]);
  const coords={kiyosu:{lon:136.8432,lat:35.2162}},group=(who,selected='',list=people)=>F.groupBases(list,coords,[],who,selected)[0];
  assert.equal(group({id:'a'}).keepLevel,4);assert.equal(group({id:'a'}).displayPlayerId,'a');
  assert.equal(group({id:'a'},'b').keepLevel,24);assert.equal(group({id:'a'},'b').displayPlayerId,'b');
  assert.equal(group(null).displayPlayerId,'b');assert.equal(group(null,'',[...people].reverse()).displayPlayerId,'b');
  assert.equal(group(null).level,32,'The aggregate castle level remains separate from the keep artwork');
});
test('a lord and castle jointly identify targets while old home-only responses remain readable',()=>{
  const home=target('a','kiyosu','kiyosu'),nijo=target('a','kiyosu','nijo',{level:64}),osaka=target('a','kiyosu','osaka'),other=target('b','kiyosu','nijo');
  const people=F.normalizePlayers({players:[home],targets:[home,nijo,nijo,osaka,other]});
  assert.equal(people.length,4);assert.equal(new Set(people.map(F.targetKey)).size,4);assert.equal(people[1].level,48);
  assert.deepEqual(F.normalizePlayers({players:[home]}).map(F.targetKey),['a:kiyosu']);
  const row=F.publicRow(people[1],{selectedId:'a:nijo',rules:modernRules});assert(row.includes('aria-pressed="true"'));assert(row.includes('data-target-id="a:nijo"'));assert(row.includes('二条城 · 所領'));assert(row.includes('占領戦'));assert(!row.includes('天守'));
  assert(!F.publicRow(people[2],{selectedId:'a:nijo'}).includes('aria-pressed="true"'));
  assert.notEqual(F.targetCastleName({...nijo,targetCastleName:undefined}),nijo.homeCastleName,'An unnamed outpost must never be mislabeled as the home castle');
  const coords={kiyosu:{lon:136.8432,lat:35.2162},nijo:{lon:135.748,lat:35.014},osaka:{lon:135.5259,lat:34.6873}};
  const groups=F.groupBases(people,coords,[],{id:'a'},'a:osaka',modernRules);assert.equal(groups.length,3);
  const city=groups.find(g=>g.id==='nijo');assert.deepEqual(city.players.map(p=>p.playerId),['a','b']);assert.equal(city.isHome,false);assert.equal(city.homeCastleId,'kiyosu');
  const selected=F.groupBases(people,coords,[],{id:'a'},'b:nijo',modernRules).find(g=>g.id==='nijo');assert.equal(selected.level,48);assert.equal(selected.displayLevelLabel,'城郭 Lv.3','The selected lord keeps their own level in a shared-city tooltip');
});
test('Edo, Kyoto Gosho, Sento Gosho and Kagoshima require both modern capabilities and an explicit non-capturable reward battle',()=>{
  for(const castle of ['edo','kyoto_gosho','sento_gosho','kagoshima']){
    const p=target('other',castle,castle,{isAdmin:castle==='edo',isStaff:castle==='kyoto_gosho'}),context={...ready(),rules:modernRules,player:p};
    const valid=F.attackValidation(context);assert.equal(valid.ok,true);assert.equal(valid.battleMode,'reward');assert.equal(valid.payload.targetCastleId,castle);assert.equal(valid.payload.targetPlayerId,'other');
    const copy=JSON.stringify(p),policy=F.battlePolicy(p,modernRules),row=F.publicRow(p,{rules:modernRules});assert.equal(policy.label,'合戦');assert.doesNotMatch(policy.tag+policy.description+row,/占領|報酬戦|領有.{0,12}維持/);assert.equal(JSON.stringify(p),copy);
    for(const alter of [c=>c.rules={},c=>c.rules={targetCastles:true},c=>c.player={...p,battleMode:undefined},c=>c.player={...p,capturable:true},c=>c.player={...p,capturable:undefined},c=>c.player={...p,attackable:false}]){
      const denied={...context};alter(denied);assert.equal(F.attackValidation(denied).ok,false);
      denied.player=F.normalizePlayers([denied.player])[0];assert.equal(F.attackValidation(denied).ok,false,'Normalization must not create permission from a missing field');
    }
  }
});
test('Kyoto-origin Edo attacks require the private current Emperor or Regent capability, never a client title or score',()=>{
  const context={...ready(),rules:modernRules,player:target('operator','edo','edo',{isAdmin:true})};context.me.self={homeCastleId:'kyoto_gosho'};context.state.home='kyoto_gosho';context.state.title='天皇';context.state.evaluation={score:999999};
  for(const flag of [undefined,false,'true',1]){context.me.attack.canAttackEdoFromKyoto=flag;const denied=F.attackValidation(context);assert.equal(denied.ok,false);assert.match(denied.message,/在任中の天皇または摂政/);}
  context.me.attack.canAttackEdoFromKyoto=true;assert.equal(F.attackValidation(context).ok,true);context.player.attackable=false;context.player.attackReason='任期が終了しました。';assert.equal(F.attackValidation(context).ok,false);assert.equal(F.attackValidation(context).message,'任期が終了しました。');
  context.player.attackable=true;context.me.self.homeCastleId='sunpu';context.me.attack.canAttackEdoFromKyoto=false;assert.equal(F.attackValidation(context).ok,true,'Other source castles retain their normal rules');
  context.me.self.homeCastleId='kyoto_gosho';context.player=target('ordinary','sunpu','sunpu');assert.equal(F.attackValidation(context).ok,true,'Sunpu remains an ordinary raid destination');
});
test('political Kyoto control displays escaped names without changing battle protection',()=>{
 const control={castleId:'kyoto_gosho',rightId:'sg_control',controller:{id:'government-owner',name:'支配者'},governmentName:'<script>幕府</script>',controlledAt:12345};
 const palace=target('palace-staff','kyoto_gosho','kyoto_gosho',{palaceControl:control});
 const html=F.publicRow(palace,{rules:modernRules});assert.match(html,/&lt;script&gt;幕府&lt;\/script&gt;の支配下/);assert(!html.includes('<script>'));
 const result=F.attackValidation({...ready(),player:palace,rules:modernRules});assert.equal(result.ok,true);assert.equal(result.battleMode,'reward');assert.equal(palace.capturable,false);
 for(const value of [{...control,controlledAt:-1},{...control,governmentName:''}])assert(!F.publicRow({...palace,palaceControl:value},{rules:modernRules}).includes('の支配下'));
 assert(!F.publicRow(target('ordinary','kiyosu','kiyosu',{palaceControl:control}),{rules:modernRules}).includes('の支配下'));
});
test('the three cities are capturable under ordinary, operator and staff defenders with all common guards intact',()=>{
  for(const castle of ['nijo','osaka','nagoya'])for(const role of [{},{isAdmin:true},{isStaff:true}]){
    const p=target('other',role.isAdmin?'edo':role.isStaff?'kyoto_gosho':'kiyosu',castle,role),context={...ready(),rules:modernRules,player:p};
    const valid=F.attackValidation(context);assert.equal(valid.ok,true);assert.equal(valid.battleMode,'capture');assert.equal(valid.payload.targetCastleId,castle);
    for(const alter of [c=>c.player={...p,playerId:'me'},c=>c.access={writable:false},c=>c.access={writable:true,fieldPending:true},c=>c.me={...c.me,relationships:[{targetPlayerId:'other',status:'allied'}]},c=>c.player={...p,attackable:false,attackReason:'戦後の保護'},c=>c.rules={}]){
      const denied={...context};alter(denied);assert.equal(F.attackValidation(denied).ok,false);
    }
  }
  for(const castle of ['nijo','osaka','nagoya'])for(const missing of [{battleMode:undefined},{capturable:undefined},{battleMode:'raid',capturable:false}]){
    const context={...ready(),rules:modernRules,player:target('other',castle,castle,missing)};
    assert.equal(F.attackValidation(context).ok,false,'A modern capture-city home cannot silently fall back to a raid when its contract is incomplete');
  }
});
test('regional protection permits only an explicit authoritative reward battle and explains that occupation cannot change',()=>{
  for(const castle of ['kiyosu','odawara','nijo','osaka','nagoya']){
    const p=target('other','kiyosu',castle,{regionProtected:true,protectedRegion:'東海',battleMode:'reward',capturable:false}),context={...ready(),rules:modernRules,player:p},policy=F.battlePolicy(p,modernRules);
    assert.equal(policy.mode,'reward');assert.match(policy.tag,/地域保護/);assert.match(policy.description,/占領は移りません/);assert.equal(F.attackValidation(context).ok,true);assert.equal(F.attackValidation(context).battleMode,'reward');assert.equal(F.attackValidation(context).payload.targetCastleId,castle);assert.match(F.publicRow(p,{rules:modernRules}),/東海の地域保護/);
    for(const change of [{rules:{}},{rules:{targetCastles:true}},{player:{...p,regionProtected:undefined}},{player:{...p,regionProtected:'true'}},{player:{...p,regionProtected:false}},{player:{...p,battleMode:undefined}},{player:{...p,battleMode:'capture',capturable:true}},{player:{...p,battleMode:'raid'}},{player:{...p,capturable:undefined}},{player:{...p,capturable:true}}])assert.equal(F.attackValidation({...context,...change}).ok,false,castle+' '+JSON.stringify(change));
    for(const change of [{player:{...p,attackable:false}},{player:{...p,playerId:'me'}},{access:{writable:false}},{access:{writable:true,fieldPending:true}},{me:{...context.me,relationships:[{targetPlayerId:'other',status:'allied'}]}}])assert.equal(F.attackValidation({...context,...change}).ok,false);
  }
});
test('regional protection normalization is strict, labels are escaped, and branch battles retain their separate outcome',()=>{
  const base=target('other','kiyosu','kiyosu',{battleMode:'reward',capturable:false,protectedRegion:'東海'});
  for(const flag of [undefined,null,false,0,1,'true']){const p=F.normalizePlayers([{...base,regionProtected:flag}])[0];assert.equal(p.regionProtected,false);assert.equal(p.protectedRegion,null);assert.equal(F.battlePolicy(p,modernRules).mode,'protected');}
  const p=F.normalizePlayers([{...base,regionProtected:true,protectedRegion:' 東海 '}])[0];assert.equal(p.regionProtected,true);assert.equal(p.protectedRegion,'東海');assert.equal(F.battlePolicy(p,modernRules).mode,'reward');
  const escaped=F.publicRow({...p,protectedRegion:'<script>東海</script>'},{rules:modernRules});assert.match(escaped,/&lt;script&gt;東海&lt;\/script&gt;/);assert(!escaped.includes('<script>'));
  const branch={...p,targetCastleId:'nagoya',targetBranchId:'nagoya_north',targetBranchName:'北支拠点',battleMode:'branch'};const branchPolicy=F.battlePolicy(branch,{...modernRules,branchBattles:true});assert.equal(branchPolicy.mode,'branch');assert.match(branchPolicy.description,/支拠点が陥落/);assert.doesNotMatch(branchPolicy.description,/占領は移りません/);
  assert.equal(F.battlePolicy({...p,displayOnly:true},modernRules).mode,'protected');
});
test('report outcome follows the committed victory and capture fields instead of implying every victory captures a city',()=>{
  const base={id:'battle',attackerPlayerId:'me',defenderPlayerId:'other',attackerName:'攻撃',defenderName:'守備',castleId:'nijo',castleName:'二条城',won:true,battleMode:'capture',troops:1000,attackerLost:80,defenderLost:{troops:50,garrison:20},loot:{gold:91,rice:82,wood:73,stone:64},rewards:{gold:0,rice:0,wood:0,stone:0},capture:{captured:true,castleId:'nijo',newlyOwned:true,garrison:138,defenderHomeCastleId:'kiyosu',defenderHomeCastleName:'清洲城'}};
  const original=JSON.stringify(base),won=F.battleSummary(base,'me');assert.equal(won.captured,true);assert.equal(won.title,'城を占領');assert.equal(won.positive,true);
  assert.equal(F.battleSummary(base,'other').title,'城を奪われました');assert.equal(F.battleSummary({...base,won:false,capture:{captured:false}},'me').title,'占領できず撤退');assert.equal(F.battleSummary({...base,won:false},'other').title,'城を守り抜きました');
  for(const capture of [undefined,{captured:false},{captured:true,castleId:'osaka'}]){const result=F.battleSummary({...base,capture},'me');assert.equal(result.captured,false);assert(!result.title.includes('占領'));}
  assert.equal(F.battleSummary({...base,castleId:'edo',capture:{captured:true,castleId:'edo'}},'me').captured,false);
  assert.equal(F.battleSummary({...base,won:undefined},'me').positive,false);assert.equal(F.battleSummary({...base,won:undefined},'me').title,'合戦結果を確認中');
  const html=F.battleReportHtml(base,'me');assert(html.includes('城を占領'));assert(html.includes('二条城'));assert(html.includes('守備側の本拠：清洲城'));assert(html.includes('data-field-reward-kind="loot"'));assert(!html.includes('data-field-reward-kind="reward"'));assert.equal(JSON.stringify(base),original);
  assert(html.includes('帰還兵から138人を、この城の守備兵として配置しました'));assert(!F.battleReportHtml({...base,capture:{...base.capture,newlyOwned:false,garrison:0}},'me').includes('守備兵として配置しました'));
});
test('reward battle receipts show actual additional rewards without implying loot, occupation or defender resource loss',()=>{
  const battle={id:'reward',attackerPlayerId:'me',defenderPlayerId:'staff',attackerName:'<script>bad</script>',defenderName:'スタッフ',castleId:'kyoto_gosho',castleName:'京都御所',won:true,battleMode:'reward',troops:1000,attackerLost:80,defenderLost:{troops:0,garrison:0},loot:{gold:0,rice:0,wood:0,stone:0},rewards:{gold:499,rice:500,wood:0,stone:37},capture:{captured:false}};
  const attack=F.battleReportHtml(battle,'me');assert(attack.includes('合戦に勝利'));assert(!/占領|報酬戦|領有.{0,12}維持/.test(attack));assert(attack.includes('499'));assert(attack.includes('37'));assert(attack.includes('data-field-reward-kind="reward"'));assert(!attack.includes('data-field-reward-kind="loot"'));assert(!attack.includes('<script>'));
  const defense=F.battleReportHtml(battle,'staff');assert(defense.includes('攻撃側の勝利報酬'));assert(defense.includes('合戦で敗北'));assert(!/占領|報酬戦|資源は維持/.test(defense));assert(!defense.includes('失った資源'));
  const loss={...battle,won:false,rewards:{gold:0,rice:0,wood:0,stone:0}};assert.equal(F.battleSummary(loss,'me').title,'合戦から撤退');assert(F.battleReportHtml(loss,'me').includes('勝利報酬はありません'));assert.equal(F.battleSummary(loss,'staff').title,'城を守り抜きました');
});
test('half-resource victory rules cover ordinary, special, capture and branch bases when the server advertises the policy',()=>{
  const rules={...modernRules,branchBattles:true,lootPolicy:'half-resources-v1',lootFraction:.5};
  const targets=[target('ordinary','kiyosu','kiyosu'),target('admin','edo','edo',{isAdmin:true}),target('staff','kyoto_gosho','kyoto_gosho',{isStaff:true}),target('deputy','kagoshima','kagoshima'),target('city','kiyosu','nijo'),target('admin','edo','edo',{targetBranchId:'edo_north',battleMode:'branch',capturable:false})];
  for(const p of targets){
    const policy=F.battlePolicy(p,rules);assert.notEqual(policy.mode,'protected');
    assert.match(policy.description,/決着時点.*金銭・兵糧・木材・石材.*50%/);
    assert.match(policy.description,/端数切り捨て/);assert.match(policy.description,/所持上限1億/);assert.match(policy.description,/入らない分は相手に残/);
    assert.doesNotMatch(policy.description,/勾玉|占領不可|報酬戦/);
  }
  assert.doesNotMatch(F.battlePolicy(target('old','kiyosu','kiyosu'),modernRules).description,/50%/,'A stale server must not be advertised as already using the new policy');
});
test('new battle receipts show actual transferred resources to attacker, defender and observers in every base mode',()=>{
  const base={id:'half-loot',attackerPlayerId:'me',defenderPlayerId:'other',attackerName:'攻撃',defenderName:'守備',castleId:'kagoshima',castleName:'鹿児島城',won:true,troops:1000,attackerLost:80,defenderLost:{troops:0,garrison:0},lootPolicy:'half-resources-v1',lootFraction:.5,lootCapacityLimited:false,loot:{gold:501,rice:302,wood:203,stone:104},rewards:{gold:0,rice:0,wood:0,stone:0},capture:{captured:false},analysis:{attackPower:9000,defensePower:1200,winChance:90,morale:100,tactic:'正攻法',reinforcementTroops:0,lootScale:1,explanation:'勝利'}};
  for(const battleMode of ['raid','capture','reward','branch']){
    const battle={...base,battleMode,...(battleMode==='branch'?{branchFallen:true,branchName:'江戸城 北支拠点'}:{})},before=JSON.stringify(battle);
    for(const [viewer,heading] of [['me','勝利報酬・奪った資源'],['other','失った資源'],[undefined,'移動した資源']]){
      const html=F.battleReportHtml(battle,viewer);
      assert(html.includes(heading));assert(html.includes('data-field-reward-kind="loot"'));assert(!html.includes('data-field-reward-kind="reward"'));
      for(const [label,amount] of [['金銭',501],['兵糧',302],['木材',203],['石材',104]])assert(html.includes(`<small>${label}<b>${amount}</b></small>`));
      assert.match(html,/決着時点.*各50%/);assert.match(html,/勝利時の資源移転率/);assert(!html.includes('戦力差による戦利品係数'));assert(!html.includes('勾玉'));
      assert(!html.includes('占領不可'));assert(!html.includes('受取上限に達した資源'));
    }
    assert.equal(JSON.stringify(battle),before,'Reports must never recompute or mutate the committed resource transfer');
  }
  const cap=F.battleReportHtml({...base,battleMode:'reward',lootCapacityLimited:true,loot:{gold:0,rice:0,wood:0,stone:0}},'me');
  assert.match(cap,/残りは守備側に残っています/);assert(cap.includes('<small>金銭<b>0</b></small>'));assert(!cap.includes('<small>金銭<b>500</b></small>'));
  const lost={...base,battleMode:'branch',won:false,loot:{gold:0,rice:0,wood:0,stone:0}};
  assert.match(F.battleReportHtml(lost,'me'),/資源の移転はありません/);assert.equal(F.battleSummary(lost,'other').positive,true);
  assert(!F.battleReportHtml({...base,battleMode:'raid',lootPolicy:undefined,lootFraction:undefined},'me').includes('data-field-loot-policy'));
});
test('Kagoshima artwork is identified for every viewer without requiring the deputy role',()=>{
  const previous=global.SengokuArt;global.SengokuArt={castle:(id,className)=>`<span class="${className}" data-test-castle="${id}"></span>`};
  try{
    for(const identity of [{},{isDeputy:false},{isDeputy:true},{self:true},{isAdmin:true}]){
      const p=target('lord','kagoshima','kagoshima',{...identity,keepLevel:8});
      const detail=F.castleAppearance(p),marker=F.castleAppearance(p,{marker:true});
      assert(detail.includes('data-test-castle="kagoshima"'));assert(detail.includes('鹿児島城<br>特別絵巻'));assert(detail.includes('鶴丸城・特別絵巻'));
      assert(marker.includes('>鶴丸城</span>'));assert(marker.includes('is-kagoshima'));
    }
    assert(!F.castleAppearance(target('lord','kiyosu','kiyosu',{keepLevel:8})).includes('鶴丸城'));
  }finally{if(previous===undefined)delete global.SengokuArt;else global.SengokuArt=previous;}
});
test('ordinary keeps retain 32 growth cells while cities keep their dedicated scene and actual level labels',()=>{
  const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{SENGOKU_DATA}=require('../engine.js');
  const scope={SENGOKU_DATA,document:{readyState:'loading',addEventListener(){}}};scope.window=scope;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../artwork.js'),'utf8'),scope);
  const old=global.SengokuArt;global.SengokuArt=scope.SengokuArt;
  try{
    for(const homeCastleId of ['kiyosu','edo','kyoto_gosho']){
      const cells=new Set();
      for(let keepLevel=1;keepLevel<=32;keepLevel++){
        const p=F.normalizePlayers([player('a',homeCastleId,{level:1,keepLevel})])[0],html=F.castleAppearance(p),tile=scope.SengokuArt.tileInfo('castle',homeCastleId,keepLevel);
        assert(html.includes(`data-art-url="${tile.url}"`));assert(html.includes(`data-field-keep-level="${keepLevel}"`));
        assert(html.includes(`data-art-x="${tile.x}"`));assert(html.includes(`data-art-y="${tile.y}"`));cells.add(tile.x+':'+tile.y);
      }
      assert.equal(cells.size,homeCastleId==='kiyosu'?32:1,'City identity stays constant while completed strength continues to grow');
    }
    for(const [id,castleLevel]of [['kiyosu',32],['edo',64],['kyoto_gosho',128]]){
      const p=F.normalizePlayers([player('a',id,{level:castleLevel,keepLevel:1})])[0],before=JSON.stringify(p),html=F.castleAppearance(p,{marker:true}),last=scope.SengokuArt.tileInfo('castle',id,32);
      assert(html.includes(`data-appearance-level="${castleLevel}"`));assert(html.includes(`>城郭${castleLevel}</span>`));assert(html.includes('天守 Lv.1 · 城郭 Lv.'+castleLevel));
      assert(html.includes(`data-art-x="${last.x}"`));assert(html.includes(`data-art-y="${last.y}"`));assert.equal(JSON.stringify(p),before);
    }
    const branch=F.castleAppearance(F.branchTarget(target('a','edo','edo',{level:64,keepLevel:32,branches:[{id:'edo_north',level:3}]}),'edo_north'),{marker:true});
    assert(branch.includes('data-appearance-level="3"'));assert(branch.includes('>Lv.3</span>'));assert(branch.includes('支拠点 Lv.3'));
    const missing=F.castleAppearance(player('a','edo',{level:64}));assert(missing.includes('data-field-keep-level="1"'));assert(missing.includes('天守 未取得'));
    const capturedCity=F.castleAppearance(F.normalizePlayers([target('a','kiyosu','nijo',{level:48,keepLevel:32})])[0],{marker:true}),lastCell=scope.SengokuArt.tileInfo('castle','nijo',32);
    assert(capturedCity.includes('城郭48'));assert(capturedCity.includes('data-field-keep-level="32"'));assert(capturedCity.includes(`data-art-x="${lastCell.x}"`));assert(capturedCity.includes(`data-art-y="${lastCell.y}"`));
    const unsafe=F.castleAppearance(player('a','missing" onclick="alert(1)',{name:'<script>',keepLevel:3}));assert(!unsafe.includes('onclick="alert'));assert(unsafe.includes('field-castle-fallback'));
  }finally{if(old===undefined)delete global.SengokuArt;else global.SengokuArt=old;}
});

async function liveRefreshTest(){
  const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{SENGOKU_DATA}=require('../engine.js'),nodes=new Map(),listeners=new Map(),maps=[];
  const node=()=>{let markup='';return{htmlWrites:0,get innerHTML(){return markup;},set innerHTML(value){markup=value;this.htmlWrites++;},textContent:'',value:'',hidden:false,disabled:false,querySelector:()=>null,setAttribute(){}};};
  const doc={hidden:false,activeElement:null,readyState:'loading',addEventListener(){},removeEventListener(){}};
  const host={ownerDocument:doc,innerHTML:'',contains:()=>true,querySelector(selector){if(!nodes.has(selector))nodes.set(selector,node());return nodes.get(selector);},querySelectorAll:()=>[],addEventListener(type,handler){listeners.set(type,handler);},removeEventListener(){}};
  let people=[player('me','kiyosu',{keepLevel:4,level:32}),player('other','kiyosu',{keepLevel:24,level:2})];
  const scope={SENGOKU_DATA,document:doc,setTimeout:()=>1,clearTimeout(){},SENGOKU_GEOGRAPHY:{castles:{kiyosu:{lon:136.8432,lat:35.2162}}},SengokuWorldMap:{mount(container,options){maps.push(options);return{update(next){maps.push(next);},destroy(){}};}}};scope.window=scope;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../artwork.js'),'utf8'),scope);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../field.js'),'utf8'),scope);
  const controller=scope.SengokuField.mount(host,{stateKey:'keep-refresh-test',identity:{id:'me'},getSyncStatus:()=>({writable:true}),request:async route=>route.startsWith('/field/me')?{relationships:[],attack:{ready:false}}:{players:people,total:people.length}});
  try{
    await controller.refresh();assert.equal(maps.at(-1).castles[0].keepLevel,4);assert(nodes.get('[data-field-detail]').innerHTML.includes('data-field-keep-level="4"'));
    const button={dataset:{fieldAction:'select-player',playerId:'other'}};await listeners.get('click')({target:{closest:()=>button},stopPropagation(){}});
    assert.equal(maps.at(-1).castles[0].keepLevel,24);assert(nodes.get('[data-field-detail]').innerHTML.includes('data-field-keep-level="24"'));
    const detail=nodes.get('[data-field-detail]');detail.innerHTML=detail.innerHTML.replace('aria-busy="true"','aria-busy="false" data-art-ready="1"');
    let focusCalls=0,selection=null;const input={dataset:{fieldInput:'troops'},selectionStart:1,selectionEnd:3,focus(){focusCalls++;},setSelectionRange(...range){selection=range;}};
    doc.activeElement=input;detail.querySelector=selector=>selector==='[data-field-input="troops"]'?input:null;
    const unchangedWrites=detail.htmlWrites;await controller.refresh();
    assert.equal(detail.htmlWrites,unchangedWrites,'An unchanged shared refresh must preserve the loaded artwork DOM');
    assert(detail.innerHTML.includes('data-art-ready="1"'));assert.equal(focusCalls,0,'The existing focused input is retained without refocusing');
    people=[people[0],{...people[1],keepLevel:32}];await controller.refresh();
    const current=maps.at(-1),marker=current.castles[0];assert.equal(marker.displayPlayerId,'other');assert.equal(marker.keepLevel,32);
    assert(current.markerAppearance(marker).html.includes('data-field-keep-level="32"'));assert(current.markerTooltip(marker).description.includes('天守 Lv.32'));
    assert(nodes.get('[data-field-detail]').innerHTML.includes('data-field-keep-level="32"'));assert(nodes.get('[data-field-players]').innerHTML.includes('天守 Lv.32 · 城郭 Lv.2'));
    assert.equal(detail.htmlWrites,unchangedWrites+1,'A changed keep level must replace the detail once');assert.equal(focusCalls,1);assert.deepEqual(selection,[1,3]);
    people=[people[0],{...people[1],keepLevel:undefined}];await controller.refresh();assert.equal(maps.at(-1).castles[0].keepLevel,1);
    assert(nodes.get('[data-field-detail]').innerHTML.includes('天守 未取得'));
    people=[people[0],{...people[1],name:'改名した領主'}];await controller.refresh();
    assert.equal(maps.at(-1).castles[0].ownerLabel,'領主 改名した領主 ほか1名');
    assert(nodes.get('[data-field-detail]').innerHTML.includes('改名した領主の領地'));assert(nodes.get('[data-field-players]').innerHTML.includes('改名した領主'));
    people=[player('successor','kiyosu',{name:'後継者',keepLevel:8})];await controller.refresh();
    assert.equal(maps.at(-1).castles[0].ownerLabel,'領主 後継者');assert.equal(maps.at(-1).castles[0].ownerRelation,'other');
    assert(nodes.get('[data-field-detail]').innerHTML.includes('後継者の領地'));assert(!nodes.get('[data-field-detail]').innerHTML.includes('改名した領主'));
    assert(!nodes.get('[data-field-players]').innerHTML.includes('改名した領主'));
  }finally{controller.destroy();}
  count++;console.log('PASS a shared-information refresh updates selected self/other castle artwork without losing selection');
}
async function pvpUiTest(){
  const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),nodes=new Map(),listeners=new Map(),requests=[],messages=[];
  const node=()=>({innerHTML:'',textContent:'',value:'',hidden:false,disabled:false,querySelector:()=>null,setAttribute(){}});
  const doc={hidden:false,activeElement:null,addEventListener(){},removeEventListener(){}};
  const host={ownerDocument:doc,innerHTML:'',contains:()=>true,querySelector(selector){if(!nodes.has(selector))nodes.set(selector,node());return nodes.get(selector);},querySelectorAll:()=>[],addEventListener(type,fn){listeners.set(type,fn);},removeEventListener(){}};
  const local={troops:5000,command:3,resources:{gold:500,rice:9000,wood:300,stone:200},army:['third','first'],governors:{farm:'second'}},before=JSON.stringify(local);
  let targets=[target('me','kiyosu','kiyosu'),target('enemy','odawara','odawara'),target('enemy','odawara','nijo'),target('enemy','odawara','osaka'),target('operator','edo','edo',{isAdmin:true}),target('staff','kyoto_gosho','kyoto_gosho',{isStaff:true})],rules={...modernRules},nextReply=null;
  const scope={document:doc,setTimeout:()=>1,clearTimeout(){},SengokuWorldMap:{mount(){return{update(){},destroy(){}};}}};scope.window=scope;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../field.js'),'utf8'),scope);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../travel-ui.js'),'utf8'),scope);
  const controller=scope.SengokuField.mount(host,{stateKey:'target-battle-ui-test',identity:{id:'me'},getSyncStatus:()=>({writable:true}),getState:()=>local,onMessage:(message,error)=>messages.push({message,error}),request:async(route,options)=>{
    if(options.method==='POST'){requests.push({route,data:JSON.parse(JSON.stringify(options.data))});return typeof nextReply==='function'?nextReply():nextReply;}
    if(route.startsWith('/field/me'))return{rules,relationships:[],battles:[],attack:{ready:true,availableTroops:5000,minTroops:300,maxTroops:100000,command:3,rice:9000}};
    return{players:targets.filter(t=>t.isHome),targets,total:5,rules};
  }});
  const detail=()=>nodes.get('[data-field-detail]').innerHTML;
  const send=(action,more={})=>listeners.get('click')({target:{closest:()=>({dataset:{fieldAction:action,...more}})},stopPropagation(){}});
  const select=key=>send('select-player',{targetId:key});
  const receipt=(castle,mode,won=true)=>({ok:true,battle:{id:'battle-'+castle,attackerPlayerId:'me',defenderPlayerId:mode==='reward'?'operator':'enemy',attackerName:'あなた',defenderName:'相手',castleId:castle,castleName:{edo:'江戸城',kyoto_gosho:'京都御所',sento_gosho:'仙洞御所',kagoshima:'鹿児島城',nijo:'二条城',osaka:'大坂城'}[castle],battleMode:mode,won,troops:1000,attackerLost:100,defenderLost:{troops:0,garrison:0},loot:{gold:mode==='capture'?70:0,rice:0,wood:0,stone:0},rewards:{gold:mode==='reward'&&won?500:0,rice:0,wood:0,stone:0},capture:{captured:mode==='capture'&&won,castleId:castle,newlyOwned:true,defenderHomeCastleId:'odawara',defenderHomeCastleName:'小田原城'}}});
  try{
    await controller.refresh();await select('enemy:nijo');assert(detail().includes('二条城'));assert(detail().includes('所領'));assert(detail().includes('城郭上限 Lv.48'));
    await send('attack');assert.equal(requests.length,0,'An attack always needs a confirmation for this exact target');
    await send('confirm-attack');assert(detail().includes('二条城へ出陣しますか'));assert(detail().replace(/<[^>]*>/g,'').includes('守備する領主：領主enemy · 占領戦'));
    await select('enemy:osaka');await send('attack');assert.equal(requests.length,0,'A confirmation for one city cannot authorize another city of the same lord');
    await send('confirm-attack');let resolve;nextReply=()=>new Promise(done=>{resolve=done;});const pending=send('attack');
    await Promise.resolve();await send('attack');assert.equal(requests.length,1,'Double activation during the pending request cannot send another battle');
    assert.equal(requests[0].data.targetPlayerId,'enemy');assert.equal(requests[0].data.targetCastleId,'osaka');assert.equal(JSON.stringify(local),before);
    resolve(receipt('osaka','capture'));await pending;assert(detail().includes('城を占領'));assert(detail().includes('大坂城'));assert(detail().includes('data-field-reward-kind="loot"'));
    await select('operator:edo');assert(!/占領不可|報酬戦/.test(detail()));assert(detail().includes('勝利すると報酬を獲得')); assert(detail().includes('城郭上限 Lv.64'));await send('confirm-attack');assert(detail().includes('江戸城へ出陣しますか'));
    nextReply=receipt('edo','reward',false);await send('attack');assert.equal(requests.at(-1).data.targetCastleId,'edo');assert(detail().includes('合戦から撤退'));assert(detail().includes('勝利報酬はありません'));
    await select('staff:kyoto_gosho');nextReply={ok:false,error:{message:'戦後の保護期間です。'}};await send('confirm-attack');await send('attack');assert.equal(messages.at(-1).error,true);assert(!detail().includes('field-battle-report'));
    nextReply={ok:true,accepted:true,marching:true,march:{id:'field-trip',kind:'field',status:'marching',sourceCastleId:'kiyosu',targetCastleId:'kyoto_gosho',distanceKm:120,durationMs:60000,departedAtMs:0,arrivesAtMs:60000}};
    await send('confirm-attack');await send('attack');
    assert.equal(messages.at(-1).error,false);
    assert(messages.at(-1).message.includes('到着までの時間'));
    assert.equal(scope.SengokuTravelUI.snapshot().active[0].id,'field-trip');
    assert(!detail().includes('field-battle-report'),'Departure cannot display a victory before arrival');
    nextReply={ok:true};await send('confirm-attack');await send('attack');assert.equal(messages.at(-1).error,true);assert(messages.at(-1).message.includes('出陣の受付を確認できません'));assert(!detail().includes('合戦に勝利'));
    await send('confirm-attack');const posted=requests.length;rules={...modernRules,specialBaseBattles:false};await controller.refresh();await send('attack');assert.equal(requests.length,posted,'Losing the capability invalidates the confirmation before a request');
    rules={...modernRules};await controller.refresh();await select('enemy:nijo');await send('confirm-attack');targets=targets.filter(t=>F.targetKey(t)!=='enemy:nijo');await controller.refresh();await send('attack');assert.equal(requests.length,posted,'A target that disappeared cannot reuse an old confirmation');
    await select('enemy:osaka');await send('confirm-attack');const remaining=targets;targets=[];await controller.refresh();targets=remaining;await controller.refresh();await send('attack');assert.equal(requests.length,posted,'An empty refresh cannot preserve a confirmation for a target that later returns');
    rules={...modernRules,branchBattles:true};const edo=targets.find(row=>row.playerId==='operator');edo.attackable=false;edo.attackReason='支拠点を先に攻略してください。';edo.branches=Object.entries({north:'北',east:'東',south:'南',west:'西'}).map(([direction,name])=>({id:'edo_'+direction,parentCastleId:'edo',direction,name:'江戸城 '+name+'支拠点',level:8,fallen:false,building:false,attackable:true,defenseTroops:500,defensePower:1200}));await controller.refresh();await select('operator:edo');assert(detail().includes('本城と支拠点'));assert(detail().includes('支拠点を先に攻略'));for(const branch of edo.branches)assert(detail().includes(branch.name));await send('confirm-attack');assert.equal(requests.length,posted);
    await send('select-branch',{branchId:'edo_east'});await send('confirm-attack');assert(detail().includes('江戸城 東支拠点へ出陣しますか'));await send('select-branch',{branchId:''});await send('attack');assert.equal(requests.length,posted,'Branch confirmation cannot authorize a parent attack');
    for(const [index,branch]of edo.branches.entries()){
      await send('select-branch',{branchId:branch.id});await send('confirm-attack');nextReply=()=>{branch.fallen=true;branch.attackable=false;edo.attackable=edo.branches.every(row=>row.fallen);edo.attackReason=edo.attackable?'':'支拠点を先に攻略してください。';const result=receipt('edo','branch');result.battle.branchId=branch.id;result.battle.branchName=branch.name;result.battle.branchFallen=true;return result;};await send('attack');assert.equal(requests.length,posted+index+1);assert.equal(requests.at(-1).data.targetCastleId,'edo');assert.equal(requests.at(-1).data.targetBranchId,branch.id);assert(detail().includes('支拠点が陥落'));assert(!detail().includes('data-field-reward-kind'));await select('operator:edo');await send('confirm-attack');
      if(index<3){assert(detail().includes('支拠点を先に攻略'));assert(!detail().includes('江戸城へ出陣しますか'));await send('attack');assert.equal(requests.length,posted+index+1,'A remaining Edo branch prevents even a confirmed main attack');}else assert(detail().includes('江戸城へ出陣しますか'));
    }
    assert.equal(JSON.stringify(local),before,'The field UI must never optimistically alter resources, army or governors');
  }finally{controller.destroy();}
  count++;console.log('PASS exact-city confirmation, reward/capture receipts, safe failures and duplicate-click protection preserve local formations');
}
async function sustainedFieldPolling(){
  const {doc,host}=require('./helpers/dom-model.cjs').setup();
  doc.hidden=false;doc.addEventListener=doc.removeEventListener=()=>{};
  const scope={document:doc,setTimeout:()=>1,clearTimeout(){},SengokuStableDOM:require('../stable-dom.js')};scope.window=scope;
  require('node:vm').runInNewContext(require('node:fs').readFileSync(require.resolve('../field.js'),'utf8'),scope);
  let people=[player('first'),player('second')];
  const controller=scope.SengokuField.mount(host,{stateKey:'sustained-poll',request:async()=>({players:people,total:people.length})});
  try{
    await controller.refresh();
    const rows=()=>host.querySelectorAll('[data-field-action="select-player"]'),original=rows();
    assert.equal(original.length,2);original[1].focus();host.scrollTop=108;
    const search=host.querySelector('[data-field-input="search"]');
    const image=doc.createElement('img');original[1].appendChild(image);
    for(let i=0;i<40;i++)await controller.refresh({background:true});
    assert.strictEqual(rows()[0],original[0]);assert.strictEqual(rows()[1],original[1]);
    assert.strictEqual(doc.activeElement,original[1]);assert.equal(host.scrollTop,108);assert(original[1].contains(image));
    people=[{...people[1],name:'帰還した領主'},people[0],player('third')];
    await controller.refresh({background:true});assert.equal(rows().length,3);
    assert.strictEqual(rows()[0],original[1]);assert.strictEqual(rows()[1],original[0]);assert.match(rows()[0].textContent,/帰還した領主/);
    assert.strictEqual(doc.activeElement,original[1]);assert.strictEqual(search,host.querySelector('[data-field-input="search"]'));assert.equal(host.scrollTop,108);
  }finally{controller.destroy();}
  count++;console.log('PASS forty field polls retain focused player rows and artwork, then update a reordered roster in place');
}
liveRefreshTest().then(pvpUiTest).then(sustainedFieldPolling).then(()=>console.log(count+' shared-field presentation and action-guard checks passed.')).catch(error=>{console.error(error);process.exitCode=1;});

