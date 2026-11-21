'use strict';
const assert=require('node:assert/strict');
const F=require('../field.js');
let count=0;function test(name,fn){fn();count++;console.log('PASS '+name);}
const player=(id,home='kiyosu',more={})=>({playerId:id,name:'領主'+id,clan:'織田家',homeCastleId:home,homeCastleName:'清洲城',level:3,defenseTroops:1200,defensePower:4200,attackable:true,relationship:'neutral',...more});
const ready=()=>({identity:{id:'me'},access:{writable:true},state:{troops:5000,command:3,resources:{rice:9000}},player:player('other'),me:{attack:{ready:true,availableTroops:5000,minTroops:300,maxTroops:100000,command:3,rice:9000},relationships:[]},troops:1000,tactic:'balanced'});
const modernRules={targetCastles:true,specialBaseBattles:true};
const target=(id,home,castle,more={})=>player(id,home,{targetCastleId:castle,targetCastleName:{edo:'江戸城',sunpu:'駿府城',nijo:'二条城',osaka:'大坂城',nagoya:'名古屋城',kiyosu:'清洲城'}[castle],isHome:home===castle,battleMode:['edo','sunpu'].includes(castle)?'reward':['nijo','osaka','nagoya'].includes(castle)?'capture':'raid',capturable:['nijo','osaka','nagoya'].includes(castle),...more});
test('public bases contain only real valid accounts and never fabricate empty records',()=>{
  assert.deepEqual(F.normalizePlayers({players:[]}),[]);const result=F.normalizePlayers({players:[player('a'),player('a'),{name:'no id'},player('b','edo',{isAdmin:true,attackable:false})]});assert.equal(result.length,2);assert.equal(result[1].playerId,'b');assert.equal(result[1].attackable,false);
});
test('co-located players share one exact marker while remaining individually selectable',()=>{
  const people=F.normalizePlayers([player('a'),player('b'),player('op','edo',{isAdmin:true,attackable:false})]),coords={kiyosu:{lon:136.8432,lat:35.2162},edo:{lon:139.7528,lat:35.6852}};
  const groups=F.groupBases(people,coords,[],{id:'a'});assert.equal(groups.length,2);assert.deepEqual(groups[0].players.map(p=>p.playerId),['a','b']);assert.deepEqual(groups[0].geo,coords.kiyosu);assert.equal(groups[0].owner,'あなたの領地');assert.equal(groups[1].reachable,false);assert.equal(F.groupBases(people,{},[]).length,0);
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
  const staff=F.normalizePlayers([player('staff','sunpu',{isStaff:true})])[0];assert.equal(staff.isStaff,true);assert.equal(staff.isAdmin,false);assert(!F.publicRow(staff).includes('スタッフ'));assert(F.publicRow(staff).includes('領主'));
  const context=ready();context.player=staff;assert.equal(F.attackValidation(context).ok,false);assert.match(F.attackValidation(context).message,/駿府城/);
  context.player=player('staff','kiyosu',{isStaff:true});assert.equal(F.attackValidation(context).ok,false,'A stale location must not expose an appointed staff base to attack');
  context.player=player('legacy','sunpu');assert.equal(F.attackValidation(context).ok,false,'The reserved castle stays protected while a legacy player snapshot is migrating');
  const operator=F.normalizePlayers([player('operator','edo',{isStaff:true,isAdmin:true})])[0];assert.equal(operator.isStaff,false);assert(!F.publicRow(operator).includes('運営'));assert(F.publicRow(operator).includes('領主'));
});
test('Edo and Sunpu cap at 64, the three capturable cities at 48, and ordinary castles at 32',()=>{
  for(const [id,limit]of [['edo',64],['sunpu',64],['nijo',48],['osaka',48],['nagoya',48]]){const [p]=F.normalizePlayers([player(id,id,{level:999})]);assert.equal(p.level,limit);assert(F.publicRow(p).includes('城郭 Lv.'+limit));}
  assert.equal(F.normalizePlayers([player('a','kiyosu',{level:64})])[0].level,32);
  assert.equal(F.normalizePlayers([player('a','sunpu',{level:999})])[0].level,64);
  const shared=F.groupBases(F.normalizePlayers([player('a','sunpu',{level:64,isStaff:true,attackable:false}),player('b','sunpu',{level:64,isStaff:true,attackable:false})]),{sunpu:{lon:138.3828,lat:34.9798}});
  assert.equal(shared.length,1);assert.equal(shared[0].level,64);assert.equal(shared[0].players.length,2);assert.equal(shared[0].reachable,false);
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
test('Edo and Sunpu require both modern capabilities and an explicit non-capturable reward battle',()=>{
  for(const castle of ['edo','sunpu']){
    const p=target('other',castle,castle,{isAdmin:castle==='edo',isStaff:castle==='sunpu'}),context={...ready(),rules:modernRules,player:p};
    const valid=F.attackValidation(context);assert.equal(valid.ok,true);assert.equal(valid.battleMode,'reward');assert.equal(valid.payload.targetCastleId,castle);assert.equal(valid.payload.targetPlayerId,'other');
    for(const alter of [c=>c.rules={},c=>c.rules={targetCastles:true},c=>c.player={...p,battleMode:undefined},c=>c.player={...p,capturable:true},c=>c.player={...p,capturable:undefined},c=>c.player={...p,attackable:false}]){
      const denied={...context};alter(denied);assert.equal(F.attackValidation(denied).ok,false);
      denied.player=F.normalizePlayers([denied.player])[0];assert.equal(F.attackValidation(denied).ok,false,'Normalization must not create permission from a missing field');
    }
  }
});
test('the three cities are capturable under ordinary, operator and staff defenders with all common guards intact',()=>{
  for(const castle of ['nijo','osaka','nagoya'])for(const role of [{},{isAdmin:true},{isStaff:true}]){
    const p=target('other',role.isAdmin?'edo':role.isStaff?'sunpu':'kiyosu',castle,role),context={...ready(),rules:modernRules,player:p};
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
  const battle={id:'reward',attackerPlayerId:'me',defenderPlayerId:'staff',attackerName:'<script>bad</script>',defenderName:'スタッフ',castleId:'sunpu',castleName:'駿府城',won:true,battleMode:'reward',troops:1000,attackerLost:80,defenderLost:{troops:0,garrison:0},loot:{gold:0,rice:0,wood:0,stone:0},rewards:{gold:499,rice:500,wood:0,stone:37},capture:{captured:false}};
  const attack=F.battleReportHtml(battle,'me');assert(attack.includes('報酬戦に勝利'));assert(attack.includes('報酬戦・占領不可'));assert(attack.includes('499'));assert(attack.includes('37'));assert(attack.includes('data-field-reward-kind="reward"'));assert(!attack.includes('data-field-reward-kind="loot"'));assert(!attack.includes('<script>'));
  const defense=F.battleReportHtml(battle,'staff');assert(defense.includes('攻撃側の勝利報酬'));assert(defense.includes('資源は維持'));assert(!defense.includes('失った資源'));
  const loss={...battle,won:false,rewards:{gold:0,rice:0,wood:0,stone:0}};assert.equal(F.battleSummary(loss,'me').title,'報酬戦から撤退');assert(F.battleReportHtml(loss,'me').includes('勝利報酬はありません'));assert.equal(F.battleSummary(loss,'staff').title,'報酬戦を防衛');
});
test('all 32 keep levels select different cells from the existing per-castle atlas',()=>{
  const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{SENGOKU_DATA}=require('../engine.js');
  const scope={SENGOKU_DATA,document:{readyState:'loading',addEventListener(){}}};scope.window=scope;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../artwork.js'),'utf8'),scope);
  const old=global.SengokuArt;global.SengokuArt=scope.SengokuArt;
  try{
    for(const homeCastleId of ['kiyosu','edo','sunpu']){
      const cells=new Set();
      for(let keepLevel=1;keepLevel<=32;keepLevel++){
        const p=F.normalizePlayers([player('a',homeCastleId,{level:64,keepLevel})])[0],html=F.castleAppearance(p),tile=scope.SengokuArt.tileInfo('castle',homeCastleId,keepLevel);
        assert(html.includes(`data-art-url="assets/castles/${homeCastleId}.webp"`));assert(html.includes(`data-field-keep-level="${keepLevel}"`));
        assert(html.includes(`data-art-x="${tile.x}"`));assert(html.includes(`data-art-y="${tile.y}"`));cells.add(tile.x+':'+tile.y);
      }
      assert.equal(cells.size,32,'Each keep level has its own existing artwork cell');
    }
    const missing=F.castleAppearance(player('a','edo',{level:64}));assert(missing.includes('data-field-keep-level="1"'));assert(missing.includes('天守 未取得'));
    const capturedCity=F.castleAppearance(F.normalizePlayers([target('a','kiyosu','nijo',{level:48,keepLevel:32})])[0],{marker:true}),lastCell=scope.SengokuArt.tileInfo('castle','nijo',32);
    assert(capturedCity.includes('Lv.48'));assert(capturedCity.includes('data-field-keep-level="32"'));assert(capturedCity.includes(`data-art-x="${lastCell.x}"`));assert(capturedCity.includes(`data-art-y="${lastCell.y}"`));
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
  }finally{controller.destroy();}
  count++;console.log('PASS a shared-information refresh updates selected self/other castle artwork without losing selection');
}
async function pvpUiTest(){
  const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),nodes=new Map(),listeners=new Map(),requests=[],messages=[];
  const node=()=>({innerHTML:'',textContent:'',value:'',hidden:false,disabled:false,querySelector:()=>null,setAttribute(){}});
  const doc={hidden:false,activeElement:null,addEventListener(){},removeEventListener(){}};
  const host={ownerDocument:doc,innerHTML:'',contains:()=>true,querySelector(selector){if(!nodes.has(selector))nodes.set(selector,node());return nodes.get(selector);},querySelectorAll:()=>[],addEventListener(type,fn){listeners.set(type,fn);},removeEventListener(){}};
  const local={troops:5000,command:3,resources:{gold:500,rice:9000,wood:300,stone:200},army:['third','first'],governors:{farm:'second'}},before=JSON.stringify(local);
  let targets=[target('me','kiyosu','kiyosu'),target('enemy','odawara','odawara'),target('enemy','odawara','nijo'),target('enemy','odawara','osaka'),target('operator','edo','edo',{isAdmin:true}),target('staff','sunpu','sunpu',{isStaff:true})],rules={...modernRules},nextReply=null;
  const scope={document:doc,setTimeout:()=>1,clearTimeout(){},SengokuWorldMap:{mount(){return{update(){},destroy(){}};}}};scope.window=scope;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../field.js'),'utf8'),scope);
  const controller=scope.SengokuField.mount(host,{stateKey:'target-battle-ui-test',identity:{id:'me'},getSyncStatus:()=>({writable:true}),getState:()=>local,onMessage:(message,error)=>messages.push({message,error}),request:async(route,options)=>{
    if(options.method==='POST'){requests.push({route,data:JSON.parse(JSON.stringify(options.data))});return typeof nextReply==='function'?nextReply():nextReply;}
    if(route.startsWith('/field/me'))return{rules,relationships:[],battles:[],attack:{ready:true,availableTroops:5000,minTroops:300,maxTroops:100000,command:3,rice:9000}};
    return{players:targets.filter(t=>t.isHome),targets,total:5,rules};
  }});
  const detail=()=>nodes.get('[data-field-detail]').innerHTML;
  const send=(action,more={})=>listeners.get('click')({target:{closest:()=>({dataset:{fieldAction:action,...more}})},stopPropagation(){}});
  const select=key=>send('select-player',{targetId:key});
  const receipt=(castle,mode,won=true)=>({ok:true,battle:{id:'battle-'+castle,attackerPlayerId:'me',defenderPlayerId:mode==='reward'?'operator':'enemy',attackerName:'あなた',defenderName:'相手',castleId:castle,castleName:{edo:'江戸城',sunpu:'駿府城',nijo:'二条城',osaka:'大坂城'}[castle],battleMode:mode,won,troops:1000,attackerLost:100,defenderLost:{troops:0,garrison:0},loot:{gold:mode==='capture'?70:0,rice:0,wood:0,stone:0},rewards:{gold:mode==='reward'&&won?500:0,rice:0,wood:0,stone:0},capture:{captured:mode==='capture'&&won,castleId:castle,newlyOwned:true,defenderHomeCastleId:'odawara',defenderHomeCastleName:'小田原城'}}});
  try{
    await controller.refresh();await select('enemy:nijo');assert(detail().includes('二条城'));assert(detail().includes('所領'));assert(detail().includes('城郭上限 Lv.48'));
    await send('attack');assert.equal(requests.length,0,'An attack always needs a confirmation for this exact target');
    await send('confirm-attack');assert(detail().includes('二条城へ出陣しますか'));assert(detail().replace(/<[^>]*>/g,'').includes('守備する領主：領主enemy · 占領戦'));
    await select('enemy:osaka');await send('attack');assert.equal(requests.length,0,'A confirmation for one city cannot authorize another city of the same lord');
    await send('confirm-attack');let resolve;nextReply=()=>new Promise(done=>{resolve=done;});const pending=send('attack');
    await Promise.resolve();await send('attack');assert.equal(requests.length,1,'Double activation during the pending request cannot send another battle');
    assert.equal(requests[0].data.targetPlayerId,'enemy');assert.equal(requests[0].data.targetCastleId,'osaka');assert.equal(JSON.stringify(local),before);
    resolve(receipt('osaka','capture'));await pending;assert(detail().includes('城を占領'));assert(detail().includes('大坂城'));assert(detail().includes('data-field-reward-kind="loot"'));
    await select('operator:edo');assert(detail().includes('報酬戦・占領不可'));assert(detail().includes('城郭上限 Lv.64'));await send('confirm-attack');assert(detail().includes('江戸城へ出陣しますか'));
    nextReply=receipt('edo','reward',false);await send('attack');assert.equal(requests.at(-1).data.targetCastleId,'edo');assert(detail().includes('報酬戦から撤退'));assert(detail().includes('勝利報酬はありません'));
    await select('staff:sunpu');nextReply={ok:false,error:{message:'戦後の保護期間です。'}};await send('confirm-attack');await send('attack');assert.equal(messages.at(-1).error,true);assert(!detail().includes('field-battle-report'));
    nextReply={ok:true};await send('confirm-attack');await send('attack');assert.equal(messages.at(-1).error,true);assert(messages.at(-1).message.includes('合戦結果を確認できません'));assert(!detail().includes('報酬戦に勝利'));
    await send('confirm-attack');const posted=requests.length;rules={...modernRules,specialBaseBattles:false};await controller.refresh();await send('attack');assert.equal(requests.length,posted,'Losing the capability invalidates the confirmation before a request');
    rules={...modernRules};await controller.refresh();await select('enemy:nijo');await send('confirm-attack');targets=targets.filter(t=>F.targetKey(t)!=='enemy:nijo');await controller.refresh();await send('attack');assert.equal(requests.length,posted,'A target that disappeared cannot reuse an old confirmation');
    await select('enemy:osaka');await send('confirm-attack');const remaining=targets;targets=[];await controller.refresh();targets=remaining;await controller.refresh();await send('attack');assert.equal(requests.length,posted,'An empty refresh cannot preserve a confirmation for a target that later returns');
    assert.equal(JSON.stringify(local),before,'The field UI must never optimistically alter resources, army or governors');
  }finally{controller.destroy();}
  count++;console.log('PASS exact-city confirmation, reward/capture receipts, safe failures and duplicate-click protection preserve local formations');
}
liveRefreshTest().then(pvpUiTest).then(()=>console.log(count+' shared-field presentation and action-guard checks passed.')).catch(error=>{console.error(error);process.exitCode=1;});
