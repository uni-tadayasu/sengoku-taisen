/* Verify the actual app clock-application path re-enables an idle strategy UI. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{SengokuEngine}=require('../engine.js'),{createController}=require('../strategy.js');
const source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
function method(name){const start=source.indexOf('  function '+name+'(');assert(start>=0,name);const line=source.indexOf('\n',start);if(source.slice(start,line).endsWith('}'))return source.slice(start,line);const end=source.indexOf('\n  }',start);assert(end>start,name);return source.slice(start,end+4);}
(async()=>{
 const game=new SengokuEngine({clan:'徳川家',seed:451}),clock={id:'clock-fixture',elapsedMs:0,confirmedElapsedMs:0,running:true,speed:1,revision:1,calendar:{elapsed:0,cycle:1}},shared={ready:true,clock,message:'全プレイヤー共通の時間で進行中'},frames=[],listeners=new Set();game.applyWorldClock(clock);
 const c={game,state:()=>game.state,document:{hidden:false,addEventListener(){},removeEventListener(){}},worldCatchupTimer:null,worldCatchingUp:false,worldClockStatusKey:'',syncAccess:{linked:false},activeModal:'',saveCounter:0,$:()=>null,clearTimeout(){},setTimeout:()=>1,renderHeader(){},refreshLiveControls(){},refreshJobTimers(){},preserveInteraction:(_host,draw)=>draw(),render(){},refreshActiveModal(){},syncMusic(){},save:()=>true,canMutate:()=>true,toast(){},settleWorldCycle(){throw Error('Unexpected cycle settlement');}};
 c.window={SengokuWorldClock:{snapshot:()=>shared},SengokuStrategy:null};vm.createContext(c);vm.runInContext(['confirmedWorldClock','processWorldClock'].map(method).join('\n'),c);
 let runId=null,starts=0,stepCalls=0;
 const access=()=>({scopeId:'player/campaign/role/cycle',canRun:clock.running,canAct:clock.running&&game.state.worldClock.elapsedMs>=clock.confirmedElapsedMs,runId,reason:!clock.running?'paused':game.state.worldClock.elapsedMs<clock.confirmedElapsedMs?'catchup':'ready',message:!clock.running?'共通時間が停止しています。':game.state.worldClock.elapsedMs<clock.confirmedElapsedMs?'共通時刻までの進行を反映しています。':'現在の戦況を評価して出陣できます。'});
 const bridge={getStrategyAccess:access,previewStrategy:()=>({ok:true,policy:{maxBattles:1},decision:{action:'attack',castleName:'引馬城',reason:'隣接城を攻めます。'}}),beginStrategy:text=>{starts++;runId='run-'+starts;return{ok:true,runId,scopeId:access().scopeId,policy:{text},decision:{action:'attack',castleName:'引馬城'}};},stopStrategy:id=>{if(runId===id)runId=null;},stepStrategy:()=>{stepCalls++;return{ok:true};}};
 const controller=createController({window:{addEventListener(){},removeEventListener(){}},document:c.document,bridge:()=>bridge,now:()=>0,setTimeout:()=>1,clearTimeout(){},subscribeClock:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},subscribeAccess:()=>()=>{},onChange:state=>frames.push(state)});c.window.SengokuStrategy=controller;
 controller.preview('兵を温存して弱い城から攻める。1回まで。兵1000を残す。');assert.equal(frames.at(-1).canStart,true);
 for(const elapsed of [5000,10000,15000]){
  clock.elapsedMs=elapsed;clock.confirmedElapsedMs=elapsed;clock.calendar.elapsed=elapsed/1000;for(const notify of listeners)notify();assert.equal(frames.at(-1).canStart,false);assert.match(frames.at(-1).startBlockedReason,/共通時刻/);
  c.processWorldClock();assert.equal(game.state.worldClock.elapsedMs,elapsed);assert.equal(frames.at(-1).canStart,true,'The rendered idle UI must receive the completed clock application');assert.equal(frames.at(-1).startBlockedReason,'');assert.equal(frames.at(-1).proposal.decision.castleName,'引馬城');assert.equal(stepCalls,0);
 }
 assert.equal((await controller.start('兵を温存して弱い城から攻める。1回まで。兵1000を残す。')).ok,true);assert.equal(starts,1);controller.stop();
 clock.running=false;for(const notify of listeners)notify();assert.equal(frames.at(-1).canStart,false);assert.match(frames.at(-1).startBlockedReason,/停止/);c.processWorldClock();assert.equal(frames.at(-1).canStart,false,'A genuinely paused world must remain blocked');controller.dispose();
 console.log('PASS three clock poll/apply cycles restore the evaluated Start button and explain temporary or paused access. No requests made.');
})().catch(error=>{console.error(error);process.exitCode=1;});
