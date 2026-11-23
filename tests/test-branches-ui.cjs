/* Real engine quotes, stable rendered controls, schematic map layout and combat DTOs. */
'use strict';
const assert=require('node:assert/strict'),{SengokuEngine:E}=require('../engine.js'),B=require('../branches.js'),M=require('../world-map.js'),F=require('../field.js'),stable=require('../stable-dom.js'),{setup}=require('./helpers/dom-model.cjs');
const tests=[],test=(name,run)=>tests.push([name,run]),copy=value=>JSON.parse(JSON.stringify(value));
function game(admin=false){const g=new E({isAdmin:admin,seed:29});g.state.command=30;g.state.resources={gold:1000000,rice:1000000,wood:1000000,stone:1000000};g.state.buildings.keep=10;return g;}
function fullCommanderGame(){
 const scope={window:{}};require('node:vm').runInNewContext(require('node:fs').readFileSync(require.resolve('../officers-data.js'),'utf8'),scope);
 const g=new E({isAdmin:true,officers:copy(scope.window.SENGOKU_OFFICERS),seed:4919});
 for(const officer of g.roster.slice(0,24))g._grantOfficerVariant(officer.id,'S');
 g.state.castles.nijo.owner=g.state.clan;g.state.command=0;
 const available=g.officerViews(g.state.officers.filter(id=>!g.state.army.includes(id))).sort((a,b)=>b.lead-a.lead||b.intellect-a.intellect||b.valor-a.valor),weak=available.slice(-3).map(o=>o.id),strong=available.slice(0,3).map(o=>o.id);
 g.state.governors={farm:strong[0],market:strong[1],barracks:strong[2]};
 g.state.branches=[{id:'edo_north',parentCastleId:'edo',direction:'north',level:2,fallen:false,commanders:[weak[0]]},{id:'nijo_north',parentCastleId:'nijo',direction:'north',level:2,fallen:false,commanders:weak.slice(1)}];
 return{g,weak,strong};
}
const helpers={writable:true,costHtml:cost=>`<div class="cost">金銭 ${cost.gold} 木材 ${cost.wood} 石材 ${cost.stone} 工期 ${cost.seconds}秒</div>`,jobClockText:job=>`あと ${Math.ceil(job.remainingSeconds)}秒`,jobKey:job=>`${job.kind}:${job.id}:personal:${job.targetLevel}`};

test('only the four eligible parent cities show exact engine quotes and Kyoto has no build control',()=>{
 for(const parent of ['edo','nijo','osaka','nagoya']){const g=game(parent==='edo');g.state.castles[parent].owner=g.state.clan;const before=JSON.stringify(g.state),q=g.branchQuote(parent,'north'),html=B.render(g,parent,helpers);assert(q.ok);assert(html.includes('工期 '+q.cost.seconds+'秒'));assert(html.includes('金銭 '+q.cost.gold));assert.match(html,/data-action="build-branch"/);assert.match(html,new RegExp('各Lv\\.'+(parent==='edo'?8:24)));assert.equal(JSON.stringify(g.state),before);}
 const g=game();assert.match(B.render(g,'kyoto_gosho',helpers),/京都御所には支拠点を設けません/);assert.doesNotMatch(B.render(g,'kyoto_gosho',helpers),/data-action/);assert.equal(B.render(g,'sunpu',helpers),'');
});
test('Edo shows all four compass defenses at Lv8 and closes only the exhausted building and growth controls',()=>{
 const g=game(true),directions=['north','east','south','west'];g.state.branches=directions.map(direction=>({id:'edo_'+direction,parentCastleId:'edo',direction,level:8,fallen:false}));
 const {host,$}=setup();stable.patch(host,B.render(g,'edo',helpers),{key:'four-edo-branches'});assert.equal(host.querySelectorAll('.branch-card').length,4);assert.match(host.textContent,/4 \/ 4/);assert.match(host.textContent,/最大4か所/);assert.match(host.textContent,/各Lv\.8/);assert.match(host.textContent,/防衛中の支拠点 4か所/);assert.equal($('[data-action="build-branch"]'),null);assert.equal($('[data-action="upgrade-branch"]'),null);assert.equal(g.castleLevelLimit('edo'),64,'The main castle keeps its own Lv64 cap');
 g.state.branches[2].fallen=true;stable.patch(host,B.render(g,'edo',helpers),{key:'four-edo-branches'});assert.equal(host.querySelectorAll('.branch-card').length,4);assert.match(host.textContent,/防衛中の支拠点 3か所/);assert($('[data-action="repair-branch"]'));assert.equal($('[data-action="build-branch"]'),null,'A fallen defense still occupies its chosen direction');
});
test('direction selection is per engine and excludes occupied sites while jobs show real progress',()=>{
 const g=game();g.state.castles.nijo.owner=g.state.clan;assert.equal(B.selection(g,'nijo'),'north');assert(B.selectDirection(g,'nijo','east'));assert.equal(B.selection(g,'nijo'),'east');assert.equal(B.selectDirection(g,'nijo','center'),false);assert(g.buildBranch('nijo','east').ok);assert.equal(B.selection(g,'nijo'),'north');assert.equal(B.selectDirection(g,'nijo','east'),false);
 const html=B.render(g,'nijo',helpers),job=g.constructionJobs().find(job=>job.id==='nijo_east');assert(html.includes('branch:nijo_east:personal:1'));assert(html.includes('あと '+Math.ceil(job.remainingSeconds)+'秒'));assert.doesNotMatch(html,/<option value="east"/);assert.equal(B.selection(game(),'nijo'),'');
});
test('canonical save replacement keeps a valid chosen direction only within the same campaign and role',()=>{
 const g=game();g.state.command=3;g.state.castles.nijo.owner=g.state.clan;assert(B.selectDirection(g,'nijo','south'));const reloaded=E.fromSave(g.exportSave());assert(B.transferSelection(g,reloaded));assert.equal(B.selection(reloaded,'nijo'),'south');assert.match(B.render(reloaded,'nijo',helpers),/data-direction="south"/);
 const occupied=E.fromSave(g.exportSave());assert(occupied.buildBranch('nijo','south').ok);assert(B.transferSelection(g,occupied));assert.equal(B.selection(occupied,'nijo'),'north');
 const other=game();other.state.castles.nijo.owner=other.state.clan;assert.equal(B.transferSelection(g,other),false);assert.equal(B.selection(other,'nijo'),'north');
 const changedRole=E.fromSave(g.exportSave(),[],{isAdmin:true});assert.equal(B.transferSelection(g,changedRole),false);
});
test('fallen defenses retain their level and offer quoted timed repair without claiming land or income',()=>{
 const g=game(true);g.state.branches=[{id:'edo_south',parentCastleId:'edo',direction:'south',level:8,fallen:true}];const html=B.render(g,'edo',helpers),q=g.branchRepairQuote('edo_south');assert(q.ok);assert(html.includes('Lv.8 / 8'));assert(html.includes('data-action="repair-branch"'));assert(html.includes('同じレベルで修復する'));assert(html.includes('工期 '+q.cost.seconds+'秒'));assert(html.includes('防衛中の支拠点はありません'));assert(g.repairBranch('edo_south').ok);assert.match(B.render(g,'edo',helpers),/修復中/);assert.equal(g.state.branches[0].fallen,true);
});
test('resource-driven markup changes retain focused direction, painted art and scroll through the shared patcher',()=>{
 const g=game();g.state.castles.nijo.owner=g.state.clan;g.state.branches=[{id:'nijo_west',parentCastleId:'nijo',direction:'west',level:2,fallen:false}];const {host,$,doc}=setup();global.SengokuArt={castle:(parent,className)=>`<span class="${className}" data-art-kind="castle" data-art-id="${parent}"></span>`};
 stable.patch(host,B.render(g,'nijo',helpers),{key:'branches'});const select=$('#branch-direction-nijo'),art=$('.branch-art'),card=$('.branch-card');select.value='south';select.focus();art.classList.add('art-ready');host.scrollTop=244;g.state.resources.gold=0;stable.patch(host,B.render(g,'nijo',helpers),{key:'branches'});
 assert.strictEqual($('#branch-direction-nijo'),select);assert.strictEqual($('.branch-art'),art);assert.strictEqual($('.branch-card'),card);assert.strictEqual(doc.activeElement,select);assert.equal(select.value,'south');assert(art.classList.contains('art-ready'));assert.equal(host.scrollTop,244);delete global.SengokuArt;
});
test('full Edo and major-city branches keep automatic replacement enabled and preview the new formation',()=>{
 const {g,weak}=fullCommanderGame(),before=JSON.stringify(g.state),{host}=setup();
 for(const [parent,id,limit]of [['edo','edo_north',1],['nijo','nijo_north',2]]){
  const plan=g.branchCommanderAutoPlan(id);assert(plan.ok);assert.equal(plan.replacedCount,limit);assert.equal(plan.formations[0].commanders.length,limit);
  host.innerHTML=B.render(g,parent,helpers);const button=host.querySelector(`[data-action="auto-assign-branch-commanders"][data-id="${id}"]`),all=host.querySelector('[data-action="auto-assign-branch-commanders"][data-id="all"]');
  assert(button&&!button.disabled,'A full branch must still offer automatic replacement');assert(all&&!all.disabled);assert.equal(host.querySelectorAll(`[data-branch-commander-panel="${id}"] .branch-commander-slot`).length,limit);
  const preview=button.parentElement.querySelector('[data-branch-auto-preview]').textContent;
  for(const officerId of plan.formations[0].commanders)assert(preview.includes(g.officer(officerId).name));assert.match(button.parentElement.textContent,/入れ替え|見直/);
  assert(host.querySelector(`[data-branch-commander-panel="${id}"] .branch-commander-slots`).textContent.includes(g.officer(weak[parent==='edo'?0:1]).name),'Current occupants remain visible until the action commits');
 }
 assert.equal(JSON.stringify(g.state),before,'Rendering replacement previews never mutates appointments');
});
test('an already optimal full formation remains available with a readable no-change message and read-only gates still win',()=>{
 const {g}=fullCommanderGame(),{host}=setup();assert(g.autoAssignBranchCommanders('all').ok);const before=JSON.stringify(g.state),plan=g.branchCommanderAutoPlan('all');assert(plan.ok);assert.equal(plan.changed,false);assert.equal(plan.assignments.length,0);
 host.innerHTML=B.renderAutoCommanders(g,'all',helpers);assert(!host.querySelector('button').disabled);assert.match(host.querySelector('[data-branch-auto-preview]').textContent,/維持/);assert.equal(B.autoCommanderReason(g,'all',helpers),'');
 host.innerHTML=B.renderAutoCommanders(g,'edo_north',helpers);assert(!host.querySelector('button').disabled);assert.match(host.querySelector('[data-branch-auto-preview]').textContent,/維持/);assert.equal(JSON.stringify(g.state),before);
 host.innerHTML=B.renderAutoCommanders(g,'all',{...helpers,writable:false,writableReason:'別の端末で操作中です。'});assert(host.querySelector('button').disabled);assert.match(host.textContent,/別の端末で操作中/);assert.equal(JSON.stringify(g.state),before);
});
test('branch map markers use bounded screen offsets and never invent geographic coordinates or castle counts',()=>{
 const parent={id:'nijo',key:'nijo',sx:300,sy:250,priority:90,own:true},branches=['north','east','south','west'].map(direction=>({id:'nijo_'+direction,parentCastleId:'nijo',direction,level:2,name:direction})),before=copy(parent),markers=M.layoutBranches([parent],branches,{distance:84});
 assert.deepEqual(markers.map(m=>[m.sx,m.sy]),[[300,166],[384,250],[300,334],[216,250]]);assert(markers.every(m=>m.branch&&m.parentCastleId==='nijo'&&!Object.hasOwn(m,'lon')&&!Object.hasOwn(m,'lat')));assert.deepEqual(parent,before);assert.equal(M.layoutBranches([{...parent,cluster:true}],branches).length,0);assert.equal(M.layoutBranches([{...parent,id:'kyoto_gosho'}],[{id:'kyoto_gosho_east',parentCastleId:'kyoto_gosho',direction:'east'}]).length,0);
});
test('shared-field parent gates and explicit branch payloads preserve the Emperor and server capabilities',()=>{
 const [parent]=F.normalizePlayers([{playerId:'other',name:'相手',homeCastleId:'edo',targetCastleId:'edo',targetCastleName:'江戸城',battleMode:'reward',capturable:false,attackable:false,attackReason:'支拠点を先に攻略してください。',branches:[{id:'edo_north',parentCastleId:'edo',direction:'north',name:'北支拠点',level:7,fallen:false,attackable:true,defenseTroops:500,defensePower:1000},{id:'invented',parentCastleId:'edo',direction:'east',level:99,attackable:true}]}]);assert.equal(parent.branches.length,1);
 const context={player:parent,identity:{id:'me'},access:{writable:true},state:{troops:5000,command:3,resources:{rice:9000}},me:{self:{homeCastleId:'nijo'},attack:{ready:true,availableTroops:5000,minTroops:300,maxTroops:100000,command:3,rice:9000}},troops:1000,tactic:'balanced',rules:{targetCastles:true,specialBaseBattles:true,branchBattles:true}};
 assert.equal(F.attackValidation(context).ok,false);context.player=F.branchTarget(parent,'edo_north');const valid=F.attackValidation(context);assert(valid.ok);assert.equal(valid.battleMode,'branch');assert.equal(valid.payload.targetCastleId,'edo');assert.equal(valid.payload.targetBranchId,'edo_north');assert.equal(valid.payload.targetPlayerId,'other');
 context.me.self.homeCastleId='kyoto_gosho';assert.equal(F.attackValidation(context).ok,false);context.me.attack.canAttackEdoFromKyoto=true;assert(F.attackValidation(context).ok);context.rules.branchBattles=false;assert.equal(F.attackValidation(context).ok,false);
});
test('all four normalized Edo defenses must fall before the reward battle is offered',()=>{
 const directions=['north','east','south','west'],[parent]=F.normalizePlayers([{playerId:'other',name:'守備役',homeCastleId:'edo',targetCastleId:'edo',level:64,battleMode:'reward',capturable:false,attackable:true,branches:directions.map(direction=>({id:'edo_'+direction,parentCastleId:'edo',direction,level:99,fallen:false,attackable:true}))}]);assert.equal(parent.level,64);assert.equal(parent.branches.length,4);assert(parent.branches.every(row=>row.level===8));
 const context={player:parent,identity:{id:'me'},access:{writable:true},state:{troops:5000,command:3,resources:{rice:9000}},me:{self:{homeCastleId:'nijo'},attack:{ready:true,availableTroops:5000,minTroops:300,maxTroops:100000,command:3,rice:9000}},troops:1000,tactic:'balanced',rules:{targetCastles:true,specialBaseBattles:true,branchBattles:true}};
 for(const branch of parent.branches){assert.equal(F.attackValidation(context).ok,false,'Even the fourth remaining defense blocks its parent');const attack=F.attackValidation({...context,player:F.branchTarget(parent,branch.id)});assert(attack.ok);assert.equal(attack.payload.targetBranchId,branch.id);assert.equal(attack.payload.targetCastleId,'edo');branch.fallen=true;branch.attackable=false;}
 const opened=F.attackValidation(context);assert(opened.ok);assert.equal(opened.battleMode,'reward');assert.equal(opened.payload.targetCastleId,'edo');assert.equal(opened.payload.targetBranchId,undefined);
 context.me.self.homeCastleId='kyoto_gosho';assert.equal(F.attackValidation(context).ok,false,'Four victories never bypass the live Emperor capability');context.me.attack.canAttackEdoFromKyoto=true;assert(F.attackValidation(context).ok);
});
test('committed branch reports explain the fallen defense without displaying captured territory or rewards',()=>{
 const report={attackerPlayerId:'me',defenderPlayerId:'other',attackerName:'自分',defenderName:'相手',castleId:'edo',castleName:'江戸城',branchId:'edo_north',branchName:'北支拠点',battleMode:'branch',branchFallen:true,won:true,troops:1000,attackerLost:80,defenderLost:{troops:0,garrison:0},capture:{captured:false},loot:{},rewards:{}};
 const summary=F.battleSummary(report,'me'),html=F.battleReportHtml(report,'me');assert.equal(summary.mode,'branch');assert.equal(summary.captured,false);assert.match(html,/北支拠点/);assert.match(html,/支拠点が陥落/);assert.doesNotMatch(html,/この城はあなたの所領|data-field-reward-kind|城を占領/);
});

(async()=>{for(const[name,run]of tests){await run();console.log('PASS '+name);}console.log(tests.length+' branch UI, quotes, stable DOM, map and field checks passed. No live requests.');})().catch(error=>{console.error(error);process.exitCode=1;});
