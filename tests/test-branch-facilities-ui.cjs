/* Real facility quotes and source-aware branch disclosures; no live services. */
'use strict';
const assert=require('node:assert/strict');
const {SengokuEngine:E,SENGOKU_DATA:D}=require('../engine.js');
const B=require('../branches.js'),stable=require('../stable-dom.js'),{setup}=require('./helpers/dom-model.cjs');
const tests=[],test=(name,run)=>tests.push([name,run]);
const helpers={writable:true,costHtml:cost=>`<div class="cost">金銭 ${cost.gold} 木材 ${cost.wood} 石材 ${cost.stone} 工期 ${cost.seconds}秒</div>`,jobClockText:job=>job.queued?`着工まで ${Math.ceil(job.startsInSeconds)}秒 · 工期 ${job.totalSeconds}秒`:`あと ${Math.ceil(job.remainingSeconds)}秒`,jobKey:job=>`${job.kind}:${job.id}:personal:${job.targetLevel}${job.facilityId?':'+job.facilityId:''}`};
function game(parent='nijo',level=3){
 const g=new E({isAdmin:parent==='edo',seed:29});g.state.command=g.commandMax();g.state.resources={gold:1000000,rice:1000000,wood:1000000,stone:1000000};g.state.buildings.keep=10;g.state.castles[parent].owner=g.state.clan;
 g.state.branches=[{id:parent+'_north',parentCastleId:parent,direction:'north',level,fallen:false}];g._cpuTurn=()=>[];return g;
}
function render(g,parent,options=helpers){const dom=setup();stable.patch(dom.host,B.render(g,parent,options),{key:'branch-facilities'});return dom;}

test('each owned branch exposes precisely its city catalogue, level cap, costs and existing artwork without mutating the save',()=>{
 const art=[];global.SengokuArt={facility:(id,css,level)=>{art.push({id,level});return `<span class="${css}" data-art-id="${id}" data-art-level="${level}"></span>`;}};
 try{for(const parent of ['edo','nijo','osaka','nagoya']){
  art.length=0;const g=game(parent),before=JSON.stringify(g.state),q=g.branchFacilityQuote(parent+'_north','farm'),{host,$}=render(g,parent),slots=parent==='edo'?6:12;
  assert.equal(host.querySelectorAll('.branch-facility-card').length,slots);assert.equal(host.querySelectorAll('[data-action="build-branch-facility"]').length,slots);assert.equal(art.length,slots);assert.deepEqual(art.map(row=>row.id),D.branchFacilities.slice(0,slots).map(row=>row.artId));assert(art.every(row=>row.level===1));
  assert.match($('.branch-facility-summary-copy').textContent,new RegExp(`建設済み 0 / ${slots}`));assert.match($('.branch-facility-overview').textContent,/Lv\.3まで/);
  const farm=$('[data-branch-facility="farm"]');assert(farm.textContent.includes('工期 '+q.cost.seconds+'秒'));assert(farm.textContent.includes('金銭 '+q.cost.gold));assert.match(farm.textContent,/兵糧 \+0 \/月/);assert.match(farm.textContent,/兵糧 \+100 \/月/);assert.equal(JSON.stringify(g.state),before);
 }}finally{delete global.SengokuArt;}
});
test('completed effects aggregate accurately while fallen branches retain levels and explain suspended bonuses',()=>{
 const g=game('nijo',4);g.state.branches[0].facilities={farm:2,market:1,barracks:3,watchtower:2,moat:2};let dom=render(g,'nijo');
 assert.match(dom.$('.branch-facility-summary-copy').textContent,/建設済み 5 \/ 12 · 合計Lv\.10/);assert.match(dom.$('.branch-facility-bonuses').textContent,/金銭\+45\/月/);assert.match(dom.$('.branch-facility-bonuses').textContent,/兵糧\+200\/月/);assert.match(dom.$('.branch-facility-bonuses').textContent,/兵の収容\+450人/);assert.match(dom.$('.branch-facility-bonuses').textContent,/支城の防衛\+2%/);assert.match(dom.$('.branch-facility-bonuses').textContent,/堀の防衛\+1.5%/);
 const farm=dom.$('[data-branch-facility="farm"]');assert.match(farm.textContent,/兵糧 \+200 \/月/);assert.match(farm.textContent,/兵糧 \+300 \/月/);assert(farm.querySelector('[data-action="upgrade-branch-facility"]'));
 g.state.branches[0].fallen=true;dom=render(g,'nijo');assert.equal(dom.$('.branch-facility-bonuses'),null);assert.match(dom.host.textContent,/施設の生産・収容・防衛効果は休止中/);assert.match(dom.host.textContent,/修復すると、完成済み施設の効果が戻ります/);assert.match(dom.$('[data-branch-facility="farm"]').textContent,/現在の効果（休止中）/);assert(dom.host.querySelectorAll('.branch-facility-action').every(button=>button.disabled));assert(dom.$('[data-action="repair-branch"]'));
});
test('facility work preserves the defense level, shows the exact timer and never masquerades as branch expansion',()=>{
 const g=game('edo',5);assert(g.buildBranchFacility('edo_north','farm').ok);g._advanceRealtime(17);
 const {host,$}=render(g,'edo'),job=g.constructionJobs().find(row=>row.facilityId==='farm'),farm=$('[data-branch-facility="farm"]');
 assert.match($('.branch-card-heading').textContent,/Lv\.5 \/ 8/);assert.match($('.branch-card-heading').textContent,/施設普請中/);assert.equal(host.querySelectorAll('.branch-progress-label').length,0);assert.equal($('.branch-defense-order').querySelector('[data-job-clock]'),null);assert.match(farm.textContent,/Lv\.1へ普請/);assert.match(farm.textContent,/あと 43秒/);assert.equal(farm.querySelector('[data-job-progress]').getAttribute('data-job-progress'),helpers.jobKey(job));assert.equal(farm.querySelector('.branch-facility-action').disabled,false);assert.match(farm.querySelector('.branch-facility-action').textContent,/Lv\.2を予約/);assert.match(B.jobName(g,job),/田畑/);assert.equal(B.mapBranches(g)[0].facilityBuilding,true);assert.match(B.mapAppearance({...B.mapBranches(g)[0],branch:true}).label,/施設普請中/);
 g._advanceRealtime(43);const completed=render(g,'edo');assert.equal(g.branch('edo_north').level,5);assert.match(completed.$('.branch-facility-summary-copy').textContent,/建設済み 1 \/ 6/);assert.equal(completed.$('[data-branch-facility="farm"]').querySelector('[data-action="upgrade-branch-facility"]').disabled,false);
});
test('branch level, resources, paused time and unavailable persistence each give a concrete disabled reason',()=>{
 const g=game('nijo',1);g.state.branches[0].facilities={farm:1};let dom=render(g,'nijo');assert(dom.$('[data-branch-facility="farm"]').querySelector('button').disabled);assert.match(dom.$('[data-branch-facility="farm"]').textContent,/先に支拠点を増築/);
 g.state.resources.gold=0;dom=render(g,'nijo');assert(dom.$('[data-branch-facility="market"]').querySelector('button').disabled);assert.match(dom.$('[data-branch-facility="market"]').textContent,/資源が足りません/);
 g.state.resources.gold=10000;g.state.realtime.running=false;dom=render(g,'nijo');assert.match(dom.$('[data-branch-facility="market"]').textContent,/時間が停止中/);
 const readonly={...helpers,writable:false,writableReason:'別の端末で操作中です。'};dom=render(g,'nijo',readonly);assert(dom.host.querySelectorAll('.branch-facility-action').every(button=>button.disabled));assert(dom.host.querySelectorAll('.branch-facility-reason').every(reason=>reason.textContent==='別の端末で操作中です。'));
});
test('branches without construction plans cannot order facilities; final levels never offer a higher level',()=>{
 const g=game('edo',0);let dom=render(g,'edo');assert.equal(dom.host.querySelectorAll('.branch-facility-card').length,6);assert(dom.host.querySelectorAll('.branch-facility-action').every(button=>button.disabled));assert.match(dom.host.textContent,/支拠点の建設を先に予約/);
 g.state.branches[0].level=8;g.state.branches[0].facilities={farm:8};dom=render(g,'edo');const farm=dom.$('[data-branch-facility="farm"]');assert.match(farm.textContent,/最大Lv\.8/);assert.doesNotMatch(farm.textContent,/Lv\.9/);assert(farm.querySelector('button').disabled);
});
test('native disclosure state, focused facility action, artwork and scroll survive resource and canonical save redraws',()=>{
 const g=game('nijo',3),dom=render(g,'nijo');const details=dom.$('.branch-facilities'),farm=dom.$('[data-branch-facility="farm"]'),button=farm.querySelector('button');
 details.open=false;g.state.resources.gold=0;stable.patch(dom.host,B.render(g,'nijo',helpers),{key:'branch-facilities'});assert.strictEqual(dom.$('.branch-facilities'),details);assert.equal(details.open,false);
 details.open=true;g.state.resources.gold=10000;stable.patch(dom.host,B.render(g,'nijo',helpers),{key:'branch-facilities'});button.focus();dom.host.scrollTop=390;
 const replacement=E.fromSave(g.exportSave());stable.patch(dom.host,B.render(replacement,'nijo',helpers),{key:'branch-facilities'});assert.strictEqual(dom.$('.branch-facilities'),details);assert.equal(details.open,true);assert.strictEqual(dom.$('[data-branch-facility="farm"]'),farm);assert.strictEqual(farm.querySelector('button'),button);assert.strictEqual(dom.doc.activeElement,button);assert.equal(dom.host.scrollTop,390);
 assert(replacement.buildBranchFacility('nijo_north','farm').ok);stable.patch(dom.host,B.render(replacement,'nijo',helpers),{key:'branch-facilities'});assert.strictEqual(farm.querySelector('button'),button);assert.equal(details.open,true);assert.equal(button.disabled,false);assert.match(button.textContent,/Lv\.2を予約/);assert.strictEqual(dom.doc.activeElement,button);
});
test('each accepted reservation advances its offer and the shared branch queue in FIFO order',()=>{
 const parent='edo',id='edo_north',g=game(parent);
 g.state.branches=[];g.state.buildings.keep=16;g.state.command=g.commandMax();
 assert(g.buildBranch(parent,'north').ok);
 let dom=render(g,parent),farm=()=>dom.$('[data-branch-facility="farm"]'),button=()=>farm().querySelector('button');
 assert.match(dom.$('[data-action="upgrade-branch"]').textContent,/支拠点 Lv\.2を予約/);
 assert.equal(button().getAttribute('data-action'),'build-branch-facility');assert.equal(button().disabled,false);
 assert.match(button().textContent,/Lv\.1の建設を予約/);assert.match(farm().textContent,/予約順 2番目/);
 assert(g.upgradeBranch(id).ok);assert(g.buildBranchFacility(id,'farm').ok);
 dom=render(g,parent);assert.equal(button().getAttribute('data-action'),'upgrade-branch-facility');
 assert.match(button().textContent,/Lv\.2を予約/);assert.match(farm().textContent,/Lv\.2の効果/);
 assert.match(farm().textContent,new RegExp('金銭 '+g.branchFacilityQuote(id,'farm').cost.gold));
 assert(g.buildBranchFacility(id,'market').ok);assert(g.upgradeBranchFacility(id,'farm').ok);
 dom=render(g,parent);
 const waiting=dom.$('[data-branch-queue]').querySelectorAll('li');
 assert.deepEqual(waiting.map(row=>row.getAttribute('data-branch-queue-position')),['1','2','3','4','5']);
 ['支拠点 Lv.1着工中','支拠点 Lv.2着工待ち','田畑 Lv.1着工待ち','商家 Lv.1着工待ち','田畑 Lv.2着工待ち'].forEach((label,index)=>assert(waiting[index].textContent.includes(label),label));
 assert.equal(new Set(waiting.map(row=>row.querySelector('[data-job-clock]').getAttribute('data-job-clock'))).size,5);
 assert.match(waiting[4].textContent,/着工まで 240秒/);assert.match(farm().textContent,/Lv\.2まで予約済み/);
 assert.equal(dom.$('[data-branch-commands]').textContent,'0');
 assert.equal(dom.$('[data-action="upgrade-branch"]').disabled,true);
 assert.equal(dom.$('[data-branch-facility="barracks"]').querySelector('button').disabled,true);
 assert.equal(g.branch(id).level,0);assert.deepEqual(g.branch(id).facilities,{});
 g._advanceRealtime(60);dom=render(g,parent);assert.equal(dom.$('[data-branch-queue]').querySelectorAll('li').length,4);assert.match(dom.$('[data-branch-queue]').querySelector('li').textContent,/支拠点 Lv\.2着工中/);
});
test('foreign owners and Kyoto expose no facility orders, and the quote adapter uses the dedicated facility quote',()=>{
 const g=game('nijo');g.state.castles.nijo.owner='他家';assert.doesNotMatch(B.render(g,'nijo',helpers),/data-action="(?:build|upgrade)-branch-facility"/);assert.doesNotMatch(B.render(g,'kyoto_gosho',helpers),/branch-facility-action/);
 const own=game('edo');assert.deepEqual(B.quote(own,'build-facility',{branchId:'edo_north',facilityId:'farm'}),own.branchFacilityQuote('edo_north','farm'));assert.deepEqual(B.quote(own,'upgrade-facility',{branchId:'edo_north',facilityId:'moat'}),own.branchFacilityQuote('edo_north','moat'));
});

(async()=>{for(const[name,run]of tests){await run();console.log('PASS '+name);}console.log(tests.length+' branch facility UI checks passed. No live requests.');})().catch(error=>{console.error(error);process.exitCode=1;});
