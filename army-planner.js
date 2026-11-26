/* Read-only formation planning. Assignment still uses the engine's normal gate. */
(function(global){
  'use strict';
  const TACTICS=['balanced','assault','siege','ambush'];
  const SKILL_BITS={commander:1,cavalry:2,infantry:4,ranged:8,strategist:16,medic:32};
  const STAT_KEYS=['lead','valor','intellect','politics'];
  function strength(stats,mask,tactic){
    let value=.55+stats.lead*.005+stats.valor*.0025;
    if(mask&1)value*=1.04;
    if(tactic==='assault'&&mask&2)value*=1.06;
    if(tactic==='balanced'&&mask&4)value*=1.05;
    if(mask&8)value*=1.04;
    if(tactic==='ambush'&&mask&16)value*=1.08;
    if(tactic==='ambush')value*=.7+stats.intellect*.005;
    return value*(stats.count?1:.75);
  }
  function context(game,includeGovernors=false){
    const s=game.state,owned=[...new Set(s.officers||[])],governors=new Map(),stationed=new Set((s.branches||[]).flatMap(row=>row.commanders||[]));
    for(const [building,id] of Object.entries(s.governors||{})){
      if(!governors.has(id))governors.set(id,[]);
      governors.get(id).push(building);
    }
    const health=new Map((game.armyHealth(owned)?.officers||[]).map(row=>[row.id,row])),military=1+(game._facilityEffect?.('military')||0);
    const rows=(game.officerViews?game.officerViews(owned):owned.map(id=>game.officer(id))).filter(Boolean).map(officer=>{
      const condition=health.get(officer.id)||{current:100,factor:1,marching:false},factor=Number.isFinite(condition.factor)?condition.factor:1;
      const assigned=governors.get(officer.id)||[];
      let militaryLoss=0;
      if(includeGovernors&&assigned.length&&game._facilityEffect){const after={...s.governors};for(const id of assigned)delete after[id];militaryLoss=military-1-game._facilityEffect('military',undefined,after);}
      return {...officer,health:condition,governors:assigned,militaryLoss,mask:SKILL_BITS[officer.skill]||0,effective:Object.fromEntries(STAT_KEYS.map(key=>[key,officer[key]*factor]))};
    });
    return {rows,military,byId:new Map(rows.map(row=>[row.id,row])),eligible:rows.filter(row=>!stationed.has(row.id)&&(includeGovernors||!governors.has(row.id))),stationed,governors};
  }
  function stats(rows){
    if(!rows.length)return {lead:35,valor:35,intellect:35,politics:35,count:0};
    return {...Object.fromEntries(STAT_KEYS.map(key=>[key,Math.round(rows.reduce((sum,row)=>sum+row.effective[key],0)/rows.length)])),count:rows.length};
  }
  function validity(game,ids,{includeGovernors=false}={}){
    if(!Array.isArray(ids)||!ids.length||ids.length>3||new Set(ids).size!==ids.length)return {ok:false,message:'家臣から重複なく1〜3名を選び直してください。'};
    const s=game.state,owned=new Set(s.officers),stationed=new Set((s.branches||[]).flatMap(row=>row.commanders||[]));
    if(ids.some(id=>!owned.has(id)))return {ok:false,message:'所持武将が変わりました。提案を更新してください。'};
    if(ids.some(id=>stationed.has(id)))return {ok:false,message:'提案の武将が支拠点へ配置されています。提案を更新してください。'};
    if(!includeGovernors&&Object.values(s.governors||{}).some(id=>ids.includes(id)))return {ok:false,message:'提案の武将が奉行へ異動しています。提案を更新してください。'};
    return {ok:true};
  }
  function pruneCandidates(pool,fixed,need,tactic){
    if(need<1||pool.length<16)return pool;
    const keys=tactic==='ambush'?['lead','valor','intellect']:['lead','valor'];
    // Values on this binary grid sum exactly at the game's 0..100 scale. With
    // fractional recovery values, require a real advantage in every inexact
    // dimension so an addition-order rounding edge cannot reverse dominance.
    const exact=keys.map(key=>[...fixed,...pool].every(row=>Number.isSafeInteger(row.effective[key]*1024)));
    const groups=new Map(),kept=[];
    for(const row of pool){
      const earlier=groups.get(row.mask)||[];let dominators=0;
      if(row.militaryLoss===0)for(const candidate of earlier){
        if(candidate.militaryLoss!==0||candidate.retained<row.retained)continue;
        if(!keys.every((key,index)=>exact[index]?candidate.effective[key]>=row.effective[key]:candidate.effective[key]>row.effective[key]+1e-9))continue;
        if(++dominators>=need)break;
      }
      // At most `need` pool officers can be selected. If that many earlier
      // officers of the same skill are at least as strong, any group containing
      // this row has an unused no-worse replacement. Earlier order also keeps
      // the exhaustive search's medic/retention/first-result tie breaks. Only
      // zero-loss rows are pruned; military-governor alternatives stay explicit.
      if(dominators>=need)continue;
      kept.push(row);earlier.push(row);groups.set(row.mask,earlier);
    }
    return kept;
  }
  function build(game,{tactic='balanced',locked=[],includeGovernors=false}={}){
    if(!TACTICS.includes(tactic))tactic='balanced';
    const ctx=context(game,includeGovernors),currentIds=[...game.state.army],currentRows=currentIds.map(id=>ctx.byId.get(id)).filter(Boolean),currentStats=stats(currentRows),currentMask=currentRows.reduce((mask,row)=>mask|row.mask,0);
    const base={tactic,includeGovernors,locked:[...new Set(Array.isArray(locked)?locked:[])].slice(0,3),candidateCount:ctx.eligible.length,current:{ids:currentIds,rows:currentRows,stats:currentStats,strength:strength(currentStats,currentMask,tactic)*ctx.military}};
    if(!ctx.eligible.length)return {...base,ok:false,message:'候補になる家臣がいません。奉行や支拠点の任命状況を確認してください。'};
    const byId=new Map(ctx.eligible.map(row=>[row.id,row]));
    if(base.locked.some(id=>!byId.has(id)))return {...base,ok:false,message:'固定した武将の任命状況が変わりました。固定を解除して、もう一度提案してください。'};
    const fixed=base.locked.map(id=>byId.get(id)),candidates=ctx.eligible.filter(row=>!base.locked.includes(row.id)),size=Math.min(3,ctx.eligible.length),need=size-fixed.length,currentSet=new Set(currentIds);
    for(const row of candidates)row.retained=currentSet.has(row.id)?1:0;
    const pool=pruneCandidates(candidates,fixed,need,tactic);
    let best=null,bestValue=-1,bestRetained=-1,bestMedic=-1,examined=0;
    const fixedStats=fixed.reduce((sum,row)=>({lead:sum.lead+row.effective.lead,valor:sum.valor+row.effective.valor,intellect:sum.intellect+row.effective.intellect,loss:sum.loss+row.militaryLoss,mask:sum.mask|row.mask,retained:sum.retained+(currentSet.has(row.id)?1:0)}),{lead:0,valor:0,intellect:0,loss:0,mask:0,retained:0});
    function consider(a,b,c){
      const lead=fixedStats.lead+(a?.effective.lead||0)+(b?.effective.lead||0)+(c?.effective.lead||0),valor=fixedStats.valor+(a?.effective.valor||0)+(b?.effective.valor||0)+(c?.effective.valor||0),intellect=fixedStats.intellect+(a?.effective.intellect||0)+(b?.effective.intellect||0)+(c?.effective.intellect||0),mask=fixedStats.mask|(a?.mask||0)|(b?.mask||0)|(c?.mask||0),retained=fixedStats.retained+(a?.retained||0)+(b?.retained||0)+(c?.retained||0),loss=fixedStats.loss+(a?.militaryLoss||0)+(b?.militaryLoss||0)+(c?.militaryLoss||0);
      const value=strength({lead:Math.round(lead/size),valor:Math.round(valor/size),intellect:Math.round(intellect/size),count:size},mask,tactic)*(ctx.military-loss),medic=mask&32?1:0;
      examined++;
      if(value>bestValue+1e-12||Math.abs(value-bestValue)<=1e-12&&(medic>bestMedic||medic===bestMedic&&retained>bestRetained)){best=fixed.concat(a?[a]:[],b?[b]:[],c?[c]:[]);bestValue=value;bestMedic=medic;bestRetained=retained;}
    }
    if(need===0)consider();
    else if(need===1)for(let i=0;i<pool.length;i++)consider(pool[i]);
    else if(need===2)for(let i=0;i<pool.length-1;i++)for(let j=i+1;j<pool.length;j++)consider(pool[i],pool[j]);
    else for(let i=0;i<pool.length-2;i++)for(let j=i+1;j<pool.length-1;j++)for(let k=j+1;k<pool.length;k++)consider(pool[i],pool[j],pool[k]);
    const chosen=new Map(best.map(row=>[row.id,row])),extras=best.filter(row=>!currentSet.has(row.id)),ordered=[];
    for(let slot=0;slot<size;slot++){const retained=chosen.get(currentIds[slot]);ordered.push(retained||extras.shift()||best.find(row=>!ordered.includes(row)&&!currentIds.slice(slot+1).includes(row.id)));}
    const rows=ordered.filter(Boolean),ids=rows.map(row=>row.id),mask=rows.reduce((value,row)=>value|row.mask,0),chosenStats=stats(rows),value=strength(chosenStats,mask,tactic)*(ctx.military-rows.reduce((sum,row)=>sum+row.militaryLoss,0));
    return {...base,ok:true,ids,rows,stats:chosenStats,strength:value,delta:base.current.strength>0?(value/base.current.strength-1)*100:0,examined,prunedCandidates:candidates.length-pool.length,medic:Boolean(mask&32),changes:ids.filter(id=>!currentSet.has(id)).length,unchanged:ids.length===currentIds.length&&ids.every((id,index)=>id===currentIds[index]),displaced:rows.flatMap(row=>row.governors.map(building=>({id:row.id,name:row.name,building}))),skillCount:new Set(rows.map(row=>row.skill)).size};
  }
  const api={build,validity,strength,TACTICS};
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(global)global.SengokuArmyPlanner=api;
})(typeof window==='object'?window:globalThis);
