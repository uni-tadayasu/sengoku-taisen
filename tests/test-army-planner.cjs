'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {SengokuEngine:E,SENGOKU_DATA:D}=require('../engine.js'),Planner=require('../army-planner.js');
const officer=(id,lead=70,valor=70,intellect=70,skill='merchant',politics=60)=>({id,name:'武将 '+id,clan:'織田家',region:'東海',lead,valor,intellect,politics,rank:'D',rarity:'D',skill,description:'編成検証'});
const roster=[officer('lead',96,75,60,'commander'),officer('cavalry',80,96,60,'cavalry'),officer('ranged',85,75,68,'ranged'),officer('intellect',72,60,98,'strategist'),officer('infantry',85,80,70,'infantry'),officer('medic',80,72,78,'medic'),officer('reserve',74,71,90,'merchant'),officer('governor',94,95,88,'administrator',100)];
function fixture(list=roster){const g=new E({officers:list,clan:'織田家',seed:17});g.state.officers=list.map(o=>o.id);g.state.officerVariants=list.map(o=>o.id+':D');g.state.army=list.slice(0,3).map(o=>o.id);g.state.governors={};g.state.officerHealth.values=Object.fromEntries(list.map(o=>[o.id,100]));return g;}
const clone=value=>JSON.parse(JSON.stringify(value));
function copied(g){const c=new E({officers:g.roster,clan:'織田家',seed:17});c.state=clone(g.state);return c;}
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function attack(g,ids,tactic){const c=copied(g);assert(c.assignArmy(ids).ok);return c.previewBattle('inuyama',tactic,100000).attackPower;}
function oracle(g,tactic,{locked=[],includeGovernors=false}={}){
 const blocked=new Set(g.state.branches.flatMap(b=>b.commanders||[])),governors=new Set(Object.values(g.state.governors)),ids=g.state.officers.filter(id=>!blocked.has(id)&&(includeGovernors||!governors.has(id))),count=Math.min(3,ids.length);let best=-1;
 function visit(start,selected){if(selected.length===count){if(locked.every(id=>selected.includes(id)))best=Math.max(best,attack(g,selected,tactic));return;}for(let i=start;i<ids.length;i++)visit(i+1,[...selected,ids[i]]);}
 visit(0,[]);return best;
}
let checks=0;function test(name,run){run();checks++;console.log('PASS '+name);}
test('planning is deterministic and read only even with frozen state and no RNG access',()=>{
 const g=fixture(),before=JSON.stringify(g.state);g.random=()=>{throw Error('Planner must not consume RNG');};freeze(g.state);
 for(const tactic of Planner.TACTICS){const a=Planner.build(g,{tactic}),b=Planner.build(g,{tactic});assert(a.ok);assert.deepEqual(a.ids,b.ids);assert.equal(a.strength,b.strength);assert.equal(new Set(a.ids).size,a.ids.length);assert.deepEqual(a.stats,g.armyStats(a.ids));}
 assert.equal(JSON.stringify(g.state),before);
});
test('all four tactics choose a three-person army matching the actual combat-preview oracle',()=>{
 const g=fixture();g.state.officerHealth.values.lead=30;g.state.officerHealth.values.cavalry=65;g.state.officerVariants.push('reserve:S');
 for(const tactic of Planner.TACTICS){const p=Planner.build(g,{tactic});assert(p.ok);assert.equal(attack(g,p.ids,tactic),oracle(g,tactic),tactic+' selected army must match maximum real engine attack');assert.deepEqual(p.stats,g.armyStats(p.ids));}
});
test('fixed officers remain selected and one, two, or three locks still respect the actual combat optimum',()=>{
 const g=fixture();for(const locked of [['reserve'],['reserve','ranged'],['reserve','ranged','medic']]){const p=Planner.build(g,{tactic:'ambush',locked});assert(p.ok);for(const id of locked)assert(p.ids.includes(id));assert.equal(attack(g,p.ids,'ambush'),oracle(g,'ambush',{locked}));assert.equal(new Set(p.ids).size,3);}
});
test('military governor reassignment includes its lost facility attack bonus in the chosen formation',()=>{
 const g=fixture(),b=D.buildings.find(b=>!b.core&&b.category==='military');assert(b);g.state.buildings[b.id]=32;g.state.governors[b.id]='governor';
 const before=JSON.stringify(g.state);for(const tactic of Planner.TACTICS){const p=Planner.build(g,{tactic,includeGovernors:true});assert.equal(attack(g,p.ids,tactic),oracle(g,tactic,{includeGovernors:true}));const expected=(attack(g,p.ids,tactic)/attack(g,g.state.army,tactic)-1)*100;assert(Math.abs(p.delta-expected)<.002,'displayed gain includes removed governor effect');}
 assert.equal(JSON.stringify(g.state),before);const fixed=Planner.build(g,{includeGovernors:true,locked:['governor']});assert(fixed.displaced.some(row=>row.building===b.id));assert(!Planner.build(g).ids.includes('governor'));
});
test('stationed and unauthorized governor candidates stay excluded, and validity rejects stale ownership',()=>{
 const g=fixture();g.state.branches=[{id:'nijo_north',parentCastleId:'nijo',level:1,commanders:['lead']}];g.state.governors.market='governor';
 const p=Planner.build(g);assert(p.ok);assert(!p.ids.includes('lead'));assert(!p.ids.includes('governor'));assert.equal(Planner.validity(g,['lead']).ok,false);assert.equal(Planner.validity(g,['governor']).ok,false);assert(Planner.validity(g,['governor'],{includeGovernors:true}).ok);
 for(const ids of [[],['reserve','reserve'],['not_owned'],roster.slice(0,4).map(o=>o.id)])assert.equal(Planner.validity(g,ids).ok,false);
 assert.equal(Planner.build(g,{locked:['lead']}).ok,false);assert.equal(Planner.build(g,{locked:['unknown']}).ok,false);
 const selected=p.ids[0];g.state.officers=g.state.officers.filter(id=>id!==selected);assert.equal(Planner.validity(g,p.ids).ok,false);
});
test('empty and small rosters remain usable; ties favor a medic then retained officers and preserve slots',()=>{
 assert.equal(Planner.build(fixture([])).ok,false);for(const count of [1,2]){const g=fixture(roster.slice(0,count)),p=Planner.build(g);assert(p.ok);assert.equal(p.ids.length,count);assert.equal(p.unchanged,true);}
 const list=['a','b','c','d'].map(id=>officer(id,70,70,70));list.push(officer('medic',70,70,70,'medic'));const g=fixture(list),p=Planner.build(g);
 assert(p.medic);assert.equal(p.ids.filter(id=>g.state.army.includes(id)).length,2);assert.equal(p.ids[0],'a');assert.equal(p.ids[1],'b');assert.equal(p.ids[2],'medic');
 assert.equal(Planner.build(g,{tactic:'invalid',locked:'bad'}).tactic,'balanced');
});
function appFixture(game=fixture(),config={}){
 const source=fs.readFileSync(require.resolve('../app.js'),'utf8'),start=source.indexOf('  function armyPlanScope()'),end=source.indexOf('  function officerChoiceResults()',start);assert(start>=0&&end>start);
 let writes=0,performed=null,writable=true;const notices=[];
 const ctx={game,roleEpoch:1,startPending:false,activeModal:'',activeModalContext:null,saveEnabled:true,state:()=>game.state,data:D,skillNames:{},window:{SengokuArmyPlanner:Planner,SengokuSocial:{getUser:()=>({id:'lord-one'})}},esc:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),icon:()=>'',portrait:()=>'',officerDuty:()=>({label:'待機'}),toast:(message,error)=>notices.push({message,error}),requireWritable:()=>writable,
 modal(title,subtitle,body,footer,id,context){ctx.activeModal=id;ctx.activeModalContext=context;ctx.html=body+footer;},perform(result){writes++;performed=result;}};
 vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);ctx.armyPlannerModal(config);
 return{ctx,notices,get writes(){return writes;},get result(){return performed;},writable:v=>{writable=v;},apply:()=>ctx.applyArmyPlan()};
}
test('the real app handler changes assignments only after adoption and spends no resources or command',()=>{
 const g=fixture();g.state.army=['reserve','medic','infantry'];const before=clone(g.state),f=appFixture(g);assert.equal(f.writes,0);assert.deepEqual(g.state,before);const expected=[...f.ctx.activeModalContext.plan.ids];f.apply();assert.equal(f.writes,1);assert(f.result.ok);assert.deepEqual(g.state.army,expected);assert.deepEqual(g.state.resources,before.resources);assert.equal(g.state.command,before.command);assert.equal(g.state.seed,before.seed);
});
test('the real app handler rejects scope changes and read-only or disabled saving without mutations',()=>{
 for(const reason of ['scope','role','writable','save']){const g=fixture(),f=appFixture(g);if(reason==='scope')g.state.walking.campaignId='changed';if(reason==='role')f.ctx.roleEpoch++;if(reason==='writable')f.writable(false);if(reason==='save')f.ctx.saveEnabled=false;const before=JSON.stringify(g.state);f.apply();assert.equal(f.writes,0,reason);assert.equal(JSON.stringify(g.state),before);}
});
test('the real app handler detects newly assigned duty, removed ownership, and rank changes',()=>{
 for(const reason of ['branch','governor','owned','rank']){const g=fixture(),f=appFixture(g),id=f.ctx.activeModalContext.plan.ids[0];if(reason==='branch')g.state.branches=[{id:'nijo_north',parentCastleId:'nijo',level:1,commanders:[id]}];if(reason==='governor')g.state.governors.market=id;if(reason==='owned'){g.state.officers=g.state.officers.filter(v=>v!==id);g.state.officerVariants=g.state.officerVariants.filter(v=>!v.startsWith(id+':'));g.state.army=g.state.army.filter(v=>v!==id);delete g.state.officerHealth.values[id];}if(reason==='rank')g.state.officerVariants.push(id+':S');const before=JSON.stringify(g.state);f.apply();assert.equal(f.writes,0,reason);assert.equal(JSON.stringify(g.state),before);assert(f.notices.length);}
});
test('the real app handler reopens materially changed health estimates instead of adopting a stale review',()=>{
 const g=fixture(),f=appFixture(g),id=f.ctx.activeModalContext.plan.ids[0];g.state.officerHealth.values[id]=0;const before=JSON.stringify(g.state);f.apply();assert.equal(f.writes,0);assert.equal(JSON.stringify(g.state),before);assert(f.notices.some(n=>/更新|確認/.test(n.message)));
});
test('adopting an explicitly reviewed governor transfer clears only that appointment and spends nothing',()=>{
 const g=fixture();g.state.governors.market='governor';g.state.governors.farm='reserve';const f=appFixture(g,{includeGovernors:true,locked:['governor']}),plan=f.ctx.activeModalContext.plan,before=clone(g.state);
 assert(plan.displaced.some(row=>row.id==='governor'&&row.building==='market'));assert.match(f.ctx.html,/奉行未任命/);f.apply();assert.equal(f.writes,1);assert(f.result.ok);assert.equal(g.state.governors.market,undefined);
 if(!plan.ids.includes('reserve'))assert.equal(g.state.governors.farm,'reserve');assert.deepEqual(g.state.resources,before.resources);assert.equal(g.state.command,before.command);assert.deepEqual(g.state.army,[...plan.ids]);
});
console.log(`${checks} army planner and real adoption-handler checks passed.`);
