/* 起動画面と、実際の読込を待つ共通ローディング表示。 */
(function(global){
'use strict';
const jobs=new Map();let sequence=0,overlay,title,enterButton,started=false;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function refresh(){if(!overlay)return;const values=[...jobs.values()],latest=values.at(-1);overlay.hidden=!latest;if(latest&&!overlay.open)requestAnimationFrame(()=>{if(jobs.size&&!overlay.open)overlay.showModal();});if(!latest&&overlay.open)overlay.close();document.body.classList.toggle('is-loading',Boolean(latest));if(!latest)return;overlay.querySelector('[data-loading-label]').textContent=latest.label;const progress=overlay.querySelector('[data-loading-progress]');progress.hidden=!latest.total;if(latest.total){progress.max=latest.total;progress.value=latest.done;}overlay.querySelector('[data-loading-detail]').textContent=latest.total?`${latest.done} / ${latest.total} 点`:'画面を整えています';}
function begin(label='読み込み中…'){const id=++sequence;jobs.set(id,{label,start:performance.now(),done:0,total:0});refresh();return id;}
function progress(id,done,total){const job=jobs.get(id);if(job){job.done=done;job.total=total;refresh();}}
async function end(id){const job=jobs.get(id);if(job)await wait(Math.max(0,240-(performance.now()-job.start)));jobs.delete(id);refresh();}
// Texture downloads may finish after a view change. Keep the active controls
// usable, and let only the most recent view own the footer's loading message.
let artworkGeneration=0;
async function ready(){
 const generation=++artworkGeneration;
 const status=document.getElementById('art-load-status');
 if(status)status.hidden=true;
 await new Promise(resolve=>requestAnimationFrame(resolve));
 if(generation!==artworkGeneration||global.SENGOKU_AT_TITLE)return;
 let timer,deadline;
 try{
  timer=setTimeout(()=>{if(status&&generation===artworkGeneration)status.hidden=false;},400);
  await Promise.race([
   global.SengokuArt?.readyCurrent()||Promise.resolve(),
   new Promise(resolve=>{deadline=setTimeout(resolve,12000);})
  ]);
 }finally{
  clearTimeout(timer);clearTimeout(deadline);
  if(status&&generation===artworkGeneration)status.hidden=true;
 }
}
function setSkipTarget(atTitle){
 const link=document.getElementById('game-skip-link');
 if(!link)return;
 link.setAttribute('href',atTitle?'#launch-enter':'#main');
 link.textContent=atTitle?'開始ボタンへ移動':'ゲーム本文へ移動';
}
function enter(){
 if(started)return;
 started=true;enterButton.disabled=true;
 const app=document.getElementById('app');
 app.hidden=false;app.inert=false;app.removeAttribute('aria-hidden');
 document.body.classList.remove('at-title');
 title.hidden=true;global.SENGOKU_AT_TITLE=false;
 setSkipTarget(false);
 document.getElementById('main')?.focus({preventScroll:true});
 global.SengokuBridge?.openStartSelection?.();
 void ready();
}
function updateTitleAction(){
 const hasSave=global.SengokuBridge?.hasStarted?.()===true;
 enterButton.querySelector('[data-enter-label]').textContent=hasSave?'物語の続きをひらく':'城を選んで始める';
 title.querySelector('[data-title-status]').textContent=hasSave?'進行状況は自動保存されています':'開始する城を選んで、物語を始めます';
 enterButton.disabled=false;
}
function home(){artworkGeneration++;const status=document.getElementById('art-load-status');if(status)status.hidden=true;setSkipTarget(true);global.SENGOKU_AT_TITLE=true;started=false;document.body.classList.add('at-title');document.getElementById('app').inert=true;document.getElementById('app').setAttribute('aria-hidden','true');title.hidden=false;updateTitleAction();enterButton.focus({preventScroll:true});}
function init(){title=document.getElementById('launch-screen');enterButton=document.getElementById('launch-enter');overlay=document.getElementById('game-loading');overlay.addEventListener('cancel',e=>e.preventDefault());
 enterButton.addEventListener('click',enter);title.addEventListener('click',e=>{if(!e.target.closest('button,a,input,select'))enter();});
 document.addEventListener('click',e=>{const back=e.target.closest('[data-action="title-screen"]');if(back){e.preventDefault();home();return;}const target=e.target.closest('[data-view]:not(#main),[data-action="officer"],[data-action="building"],[data-action="select-castle"],[data-action="draw-officers"],[data-action="officer-rank-detail"],[data-action="preview-art"],[data-action="art-level-step"],[data-action="music"],[data-action="settings"],[data-action="help"],[data-action="about"],[data-action="new-game"],[data-action="officer-page"],[data-action="officer-section"],[data-action="open-gacha"],[data-action="gacha-odds"],[data-action="officer-filter"],[data-action="pick-army"],[data-action="pick-governor"],[data-action="prepare-battle"],[data-action="diplomacy-info"],[data-action="council"],[data-action="start-new"],[data-action="confirm-import"],[data-action="attack"]');if(target&&!target.disabled&&!global.SENGOKU_AT_TITLE)void ready();},true);
 document.addEventListener('change',e=>{if(e.target.matches('#officer-rank,#officer-clan,#officer-sort,#facility-category,#map-region,#art-preview-level')&&!global.SENGOKU_AT_TITLE)void ready();},true);
 // The artwork loads independently. A slow illustration must never delay entry.
 updateTitleAction();
 global.SengokuArt?.decorate();refresh();
}
global.SengokuLoading={begin,progress,end,ready};global.SengokuTitle={enter,home};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})(window);
