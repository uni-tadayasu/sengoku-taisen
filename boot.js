/* 起動画面と、実際の読込を待つ共通ローディング表示。 */
(function(global){
'use strict';
const jobs=new Map();let sequence=0,overlay,title,enterButton,started=false;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function refresh(){if(!overlay)return;const values=[...jobs.values()],latest=values.at(-1);overlay.hidden=!latest;if(latest&&!overlay.open)requestAnimationFrame(()=>{if(jobs.size&&!overlay.open)overlay.showModal();});if(!latest&&overlay.open)overlay.close();document.body.classList.toggle('is-loading',Boolean(latest));if(!latest)return;overlay.querySelector('[data-loading-label]').textContent=latest.label;const progress=overlay.querySelector('[data-loading-progress]');progress.hidden=!latest.total;if(latest.total){progress.max=latest.total;progress.value=latest.done;}overlay.querySelector('[data-loading-detail]').textContent=latest.total?`${latest.done} / ${latest.total} 点`:'画面を整えています';}
function begin(label='読み込み中…'){const id=++sequence;jobs.set(id,{label,start:performance.now(),done:0,total:0});refresh();return id;}
function progress(id,done,total){const job=jobs.get(id);if(job){job.done=done;job.total=total;refresh();}}
async function end(id){const job=jobs.get(id);if(job)await wait(Math.max(0,240-(performance.now()-job.start)));jobs.delete(id);refresh();}
async function ready(label){const id=begin(label);try{await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));await Promise.race([global.SengokuArt?.readyCurrent((d,t)=>progress(id,d,t))||Promise.resolve(),wait(12000)]);}finally{await end(id);}}
async function enter(){if(started)return;started=true;enterButton.disabled=true;const id=begin('天下への道をひらいています…');try{const app=document.getElementById('app');app.hidden=false;app.inert=false;app.removeAttribute('aria-hidden');document.body.classList.remove('at-title');title.hidden=true;global.SENGOKU_AT_TITLE=false;await new Promise(resolve=>requestAnimationFrame(resolve));await Promise.race([global.SengokuArt?.readyCurrent((d,t)=>progress(id,d,t))||Promise.resolve(),wait(12000)]);}finally{await end(id);}document.getElementById('main')?.focus({preventScroll:true});global.SengokuBridge?.openStartSelection?.();}
function updateTitleAction(){
 const hasSave=global.SengokuBridge?.hasStarted?.()===true;
 enterButton.querySelector('[data-enter-label]').textContent=hasSave?'物語の続きをひらく':'城を選んで始める';
 title.querySelector('[data-title-status]').textContent=hasSave?'進行状況は自動保存されています':'開始する城を選んで、物語を始めます';
 enterButton.disabled=false;
}
function home(){global.SENGOKU_AT_TITLE=true;started=false;document.body.classList.add('at-title');document.getElementById('app').inert=true;document.getElementById('app').setAttribute('aria-hidden','true');title.hidden=false;updateTitleAction();enterButton.focus({preventScroll:true});}
function labelFor(button){const view=button.dataset.view;return({town:'城下町をひらいています…',map:'天下の地図を広げています…',officers:'武将絵巻をひらいています…',army:'軍団を集めています…',research:'技術の書をひらいています…',council:'軍議の支度をしています…',facilities:'普請帳をひらいています…',gacha:'招聘の間へご案内します…'})[view]||'絵巻を読み込んでいます…';}
function init(){title=document.getElementById('launch-screen');enterButton=document.getElementById('launch-enter');overlay=document.getElementById('game-loading');overlay.addEventListener('cancel',e=>e.preventDefault());
 enterButton.addEventListener('click',enter);title.addEventListener('click',e=>{if(!e.target.closest('button,a,input,select'))enter();});
 document.addEventListener('click',e=>{const back=e.target.closest('[data-action="title-screen"]');if(back){e.preventDefault();home();return;}const target=e.target.closest('[data-view]:not(#main),[data-action="officer"],[data-action="building"],[data-action="select-castle"],[data-action="draw-officers"],[data-action="officer-rank-detail"],[data-action="preview-art"],[data-action="art-level-step"],[data-action="music"],[data-action="settings"],[data-action="help"],[data-action="about"],[data-action="new-game"],[data-action="officer-page"],[data-action="officer-section"],[data-action="open-gacha"],[data-action="gacha-odds"],[data-action="officer-filter"],[data-action="pick-army"],[data-action="pick-governor"],[data-action="prepare-battle"],[data-action="diplomacy-info"],[data-action="council"],[data-action="start-new"],[data-action="confirm-import"],[data-action="attack"]');if(target&&!target.disabled&&!global.SENGOKU_AT_TITLE)ready(labelFor(target));},true);
 document.addEventListener('change',e=>{if(e.target.matches('#officer-rank,#officer-clan,#officer-sort,#facility-category,#map-region,#art-preview-level')&&!global.SENGOKU_AT_TITLE)ready('絵巻のページをめくっています…');},true);
 // The artwork loads independently. A slow illustration must never delay entry.
 updateTitleAction();
 global.SengokuArt?.decorate();refresh();
}
global.SengokuLoading={begin,progress,end,ready};global.SengokuTitle={enter,home};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})(window);
