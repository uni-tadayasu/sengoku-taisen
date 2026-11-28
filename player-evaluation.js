/* Shared presentation for current player evaluations. Titles never grant permissions. */
(function(root){
  'use strict';
  const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const number=value=>value.toLocaleString('ja-JP');
  // Match the small-size mark used by the current official favicon family.
  const emblem='assets/branding/sengoku-vs-favicon-32-20261127-jade.png';
  function known(value){
    return Boolean(value&&value.version===1&&Number.isSafeInteger(value.score)&&value.score>=0&&value.score<=100000&&value.maxScore===100000&&Number.isSafeInteger(value.rankIndex)&&value.rankIndex>=0&&value.rankIndex<17&&typeof value.rankId==='string'&&value.rankId.length>0&&value.rankId.length<=64&&typeof value.rankName==='string'&&value.rankName.trim().length>0&&value.rankName.length<=32);
  }
  function label(value){return known(value)?`${value.rankName} · ${number(value.score)}点`:'';}
  function key(value){return known(value)?JSON.stringify([value.version,value.rankId,value.rankName,value.rankIndex,value.score,value.maxScore]):'';}
  function badge(value){
    if(!known(value))return '';
    const description=`位階 ${value.rankName} · 総合評価 ${number(value.score)} / ${number(value.maxScore)}点`;
    return `<span class="player-evaluation-badge" data-evaluation-tier="${Math.floor(value.rankIndex/4)}" data-evaluation-rank="${escape(value.rankId)}" data-evaluation-index="${value.rankIndex}" title="${escape(description)}" role="img" aria-label="${escape(description)}"><span class="player-evaluation-emblem" aria-hidden="true"><img src="${emblem}" width="20" height="20" alt="" decoding="async" draggable="false"></span><span class="player-evaluation-title" aria-hidden="true">${escape(value.rankName)}</span></span>`;
  }
  const api=Object.freeze({badge,label,key});
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.SengokuEvaluationUI=api;
})(typeof window!=='undefined'?window:globalThis);
