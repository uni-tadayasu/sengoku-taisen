/* 起動画面と、実際の読込を待つ共通ローディング表示。 */
(function(global){
'use strict';
const jobs=new Map();let sequence=0,overlay,title,enterButton,started=false,screenEpoch=0;
function refresh(){if(!overlay)return;const values=[...jobs.values()],latest=values.at(-1);overlay.hidden=!latest;if(latest&&!overlay.open)requestAnimationFrame(()=>{if(jobs.size&&!overlay.open)overlay.showModal();});if(!latest&&overlay.open)overlay.close();document.body.classList.toggle('is-loading',Boolean(latest));if(!latest)return;overlay.querySelector('[data-loading-label]').textContent=latest.label;const progress=overlay.querySelector('[data-loading-progress]');progress.hidden=!latest.total;if(latest.total){progress.max=latest.total;progress.value=latest.done;}overlay.querySelector('[data-loading-detail]').textContent=latest.total?`${latest.done} / ${latest.total} 点`:'画面を整えています';}
function begin(label='読み込み中…'){const id=++sequence;jobs.set(id,{label,start:performance.now(),done:0,total:0});refresh();return id;}
function progress(id,done,total){const job=jobs.get(id);if(job){job.done=done;job.total=total;refresh();}}
async function end(id){jobs.delete(id);refresh();}
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
 screenEpoch++;
 started=true;enterButton.disabled=true;
 const app=document.getElementById('app');
 app.hidden=false;app.inert=false;app.removeAttribute('aria-hidden');
 document.body.classList.remove('at-title');
 title.hidden=true;global.SENGOKU_AT_TITLE=false;
 setSkipTarget(false);
 global.SengokuBridge?.syncMusic?.();
 global.SengokuBridge?.renderGameplay?.();
 document.getElementById('main')?.focus({preventScroll:true});
 global.SengokuBridge?.openStartSelection?.();
 void ready();
}
function updateTitleAction(){
 const hasSave=global.SengokuBridge?.hasStarted?.()===true;
 enterButton.querySelector('[data-enter-label]').textContent=hasSave?'物語の続きをひらく':'城を選んで始める';
 title.querySelector('[data-title-status]').textContent=hasSave?'':'開始する城を選んで、物語を始めます';
 const resume=document.getElementById('title-resume');
 const state=hasSave?global.SengokuBridge?.getState?.():null;
 if(resume){
  resume.hidden=!state;
  if(state){
   const home=global.SENGOKU_DATA?.castles?.find(castle=>castle.id===state.home);
   const name=document.getElementById('title-resume-name'),detail=document.getElementById('title-resume-detail');
   if(name)name.textContent=[state.clan,home?.name].filter(Boolean).join(' · ');
   const officers=Array.isArray(state.officers)?state.officers.length:0;
   if(detail)detail.textContent=state.gameOver?'戦役の記録を確認して、再起へ。':`家臣 ${officers}名 · 前回の進行から再開`;
  }
 }
 enterButton.disabled=false;
}
function home(){screenEpoch++;artworkGeneration++;const status=document.getElementById('art-load-status');if(status)status.hidden=true;setSkipTarget(true);global.SENGOKU_AT_TITLE=true;started=false;document.body.classList.add('at-title');document.getElementById('app').inert=true;document.getElementById('app').setAttribute('aria-hidden','true');title.hidden=false;updateTitleAction();global.SengokuBridge?.syncMusic?.();enterButton.focus({preventScroll:true});}
function init(){title=document.getElementById('launch-screen');enterButton=document.getElementById('launch-enter');overlay=document.getElementById('game-loading');overlay.addEventListener('cancel',e=>e.preventDefault());
 // Only the named start button enters the game. Touching artwork or the
 // continuation summary must not accidentally start a campaign.
 enterButton.addEventListener('click',enter);
 document.addEventListener('click',e=>{const back=e.target.closest('[data-action="title-screen"]');if(back){e.preventDefault();home();return;}const target=e.target.closest('[data-view]:not(#main),[data-action="officer"],[data-action="building"],[data-action="select-castle"],[data-action="draw-officers"],[data-action="officer-rank-detail"],[data-action="preview-art"],[data-action="art-level-step"],[data-action="music"],[data-action="settings"],[data-action="help"],[data-action="about"],[data-action="new-game"],[data-action="officer-page"],[data-action="officer-section"],[data-action="open-gacha"],[data-action="gacha-odds"],[data-action="officer-filter"],[data-action="pick-army"],[data-action="pick-governor"],[data-action="prepare-battle"],[data-action="diplomacy-info"],[data-action="council"],[data-action="start-new"],[data-action="confirm-import"],[data-action="attack"]');if(target&&!target.disabled&&!global.SENGOKU_AT_TITLE)void ready();},true);
 document.addEventListener('change',e=>{if(e.target.matches('#officer-rank,#officer-clan,#officer-sort,#facility-category,#map-region,#art-preview-level')&&!global.SENGOKU_AT_TITLE)void ready();},true);
 // The artwork loads independently. A slow illustration must never delay entry.
 updateTitleAction();
 global.SengokuArt?.decorate();refresh();
 void global.SengokuBridge?.startMusic?.();
}
function reportedRelease(worker){
 return new Promise(resolve=>{
  const channel=new global.MessageChannel();
  const finish=value=>{clearTimeout(timer);channel.port1.close();resolve(value);};
  const timer=setTimeout(()=>finish(null),3000);
  channel.port1.onmessage=event=>finish(event.data?.release||null);
  try{worker.postMessage({type:'sengoku-release'},[channel.port2]);}catch{finish(null);}
 });
}
async function registerOfflineEntry(){
 const registration=await global.navigator.serviceWorker.register('./sw.js');
 const action=document.getElementById('game-update-action'),button=document.getElementById('game-update-open'),status=document.getElementById('game-update-status');
 if(!action||!button||!status||!global.MessageChannel)return;
 const release=new URL(document.querySelector('link[rel="manifest"]').href).searchParams.get('v');
 const interval=60000,manualCooldown=10000,checkButtons=[];
 const checkRow=document.createElement('div');checkRow.id='game-update-check';
 const checkButton=document.createElement('button');checkButton.id='game-update-check-button';checkButton.type='button';checkButton.className='edition-profile-link';checkButton.textContent='更新を確認';
 const checkStatus=document.createElement('span');checkStatus.id='game-update-check-status';checkStatus.setAttribute('role','status');
 checkRow.append(checkButton,checkStatus);action.parentNode.insertBefore(checkRow,action);checkButtons.push(checkButton);
 const help=document.createElement('p');help.className='game-update-help';help.textContent='新版を開くと画面を再読み込みします。入力や通話を終えてからお進みください。';action.appendChild(help);
 const menu=document.querySelector('#app .sidebar-bottom');
 if(menu){
  const menuButton=document.createElement('button');menuButton.id='game-update-menu-check';menuButton.type='button';menuButton.className='nav-item';menuButton.setAttribute('data-action','check-update');menuButton.textContent='更新を確認';
  menu.insertBefore(menuButton,menu.querySelector('.version-label'));checkButtons.push(menuButton);
 }
 const notice=document.createElement('aside');notice.id='game-update-notice';notice.hidden=true;notice.setAttribute('aria-label','ゲームの更新');
 const noticeLabel=document.createElement('span');noticeLabel.id='game-update-notice-label';noticeLabel.setAttribute('role','status');
 const returnButton=document.createElement('button');returnButton.id='game-update-return';returnButton.type='button';returnButton.textContent='保存してタイトルへ';returnButton.setAttribute('aria-describedby','game-update-notice-label');
 const noticeStatus=document.createElement('span');noticeStatus.id='game-update-notice-status';noticeStatus.setAttribute('role','status');
 notice.append(noticeLabel,returnButton,noticeStatus);document.querySelector('#app .topbar')?.appendChild(notice);
 let target=null,targetWorker=null,checking=0,inspecting=null,inspectedWorker=null,switching=false;
 let timer=null,inFlight=null,lastRequest=-Infinity,nextCheck=Date.now()+interval,pageActive=true,lastOutcome='current';
 const canCheck=()=>pageActive&&document.visibilityState==='visible'&&global.navigator.onLine!==false;
 function stopTimer(){clearTimeout(timer);timer=null;}
 function schedule(){
  stopTimer();
  if(canCheck()&&!inFlight)timer=setTimeout(()=>{timer=null;void checkForUpdates();},Math.max(1,nextCheck-Date.now()));
 }
 function setChecking(value){for(const control of checkButtons){control.disabled=value;control.setAttribute('aria-busy',String(value));}}
 function showCheckResult(result){
  const message=target?'新版の準備ができています。区切りのよいときに開けます。':
   result==='offline'?'オフラインです。通信が戻ると自動で確認します。':
   result==='error'?'更新を確認できませんでした。通信状況を確認して、もう一度お試しください。':
   registration.installing?'新版を準備中です。準備ができるとお知らせします。':
   result==='recent'?'直前に確認しました。約1分ごとに自動で確認します。':'現在、新しい更新はありません。';
  checkStatus.textContent=message;
  if(global.SENGOKU_AT_TITLE===false)global.SengokuBridge?.toast?.(message);
 }
 async function inspect(){
  const worker=registration.waiting;
  if(inspecting&&inspectedWorker===worker)return inspecting;
  const turn=++checking;inspectedWorker=worker;
  const task=Promise.resolve().then(async()=>{
   const version=worker&&await reportedRelease(worker);
   if(turn!==checking)return;
   const previous=target;
   target=worker&&registration.waiting===worker&&version!==release&&/^\d+\.\d+\.\d+-\d{8}$/.test(version)?version:null;
   targetWorker=target?worker:null;action.hidden=!target;notice.hidden=!target;
   if(previous!==target){noticeLabel.textContent=target?'新版あり':'';noticeStatus.textContent='';}
  });
  inspecting=task;
  try{await task;}finally{if(inspecting===task)inspecting=null;}
 }
 async function checkForUpdates(manual=false){
  if(!canCheck()){
   stopTimer();if(manual)showCheckResult(global.navigator.onLine===false?'offline':'recent');return;
  }
  if(manual)checkStatus.textContent='更新を確認しています…';
  if(!inFlight){
   const now=Date.now();
   if(now<(manual?lastRequest+manualCooldown:nextCheck)){
    await inspect();schedule();if(manual)showCheckResult(lastOutcome==='error'?'error':'recent');return;
   }
   lastRequest=now;nextCheck=now+interval;stopTimer();setChecking(true);
   // A shared promise also coalesces a focus/visibility pair and rapid clicks.
   inFlight=Promise.resolve().then(async()=>{
    try{await registration.update();await inspect();lastOutcome='current';}
    catch{lastOutcome='error';}
    return lastOutcome;
   }).finally(()=>{inFlight=null;setChecking(false);schedule();});
  }
  const result=await inFlight;
  if(manual)showCheckResult(result);
 }
 function resume(online=false){
  if(!canCheck()){stopTimer();return;}
  if(online)nextCheck=Math.min(nextCheck,Math.max(Date.now(),lastRequest+manualCooldown));
  void inspect();void checkForUpdates();schedule();
 }
 const watch=worker=>worker?.addEventListener('statechange',inspect);
 registration.addEventListener('updatefound',()=>{watch(registration.installing);void inspect();});
 global.navigator.serviceWorker.addEventListener('controllerchange',inspect);
 watch(registration.installing);void inspect();schedule();
 document.addEventListener('visibilitychange',()=>resume());
 global.addEventListener('focus',()=>resume());
 global.addEventListener('online',()=>resume(true));
 global.addEventListener('offline',stopTimer);
 global.addEventListener('pagehide',()=>{pageActive=false;stopTimer();});
 global.addEventListener('pageshow',()=>{pageActive=true;resume();});
 for(const control of checkButtons)control.addEventListener('click',()=>checkForUpdates(true));
 function setSwitching(value){switching=value;button.disabled=value;returnButton.disabled=value;}
 async function saveBeforeSwitch(selected,output){
  const name='sengoku-taisen-v'+selected;
  if(!await global.caches.has(name)||!await (await global.caches.open(name)).match(new URL('index.html',registration.scope).href)){
   output.textContent='新版の準備を確認できませんでした。通信状況をご確認ください。';return false;
  }
  const ready=await global.SengokuBridge?.prepareReleaseSwitch?.();
  if(!ready?.ok){output.textContent=ready?.message||'保存状態を確認できませんでした。';return false;}
  return true;
 }
 // Gameplay never reloads itself: save first, then let the player choose the
 // existing title action. Calls and input remain untouched by update discovery.
 returnButton.addEventListener('click',async()=>{
  if(switching||!target||global.SENGOKU_AT_TITLE!==false)return;
  let returned=false;setSwitching(true);noticeStatus.textContent='保存を確認しています…';
  try{
   const selected=target,worker=targetWorker,fromScreen=screenEpoch;
   if(!await saveBeforeSwitch(selected,noticeStatus))return;
   if(fromScreen!==screenEpoch)return;
   if(registration.waiting!==worker||selected!==target){await inspect();return;}
   global.SengokuTitle.home();returned=true;status.textContent='保存を確認しました。新版を開く準備ができています。';
  }catch{noticeStatus.textContent='保存状態を確認できませんでした。もう一度お試しください。';}
  finally{setSwitching(false);if(noticeStatus.textContent==='保存を確認しています…')noticeStatus.textContent='';if(returned)button.focus({preventScroll:true});}
 });
 button.addEventListener('click',async()=>{
  if(switching||!target||global.SENGOKU_AT_TITLE===false)return;
  setSwitching(true);status.textContent='保存を確認しています…';
  try{
   const selected=target,worker=targetWorker,fromScreen=screenEpoch;
   if(!await saveBeforeSwitch(selected,status))return;
   // Leaving and returning to the title is a new visit, even if the boolean
   // is unchanged when a slow save finishes. Keep the player's newer choice.
   if(fromScreen!==screenEpoch||global.SENGOKU_AT_TITLE===false){status.textContent='';return;}
   if(registration.waiting!==worker||selected!==target){status.textContent='';await inspect();return;}
   const url=new URL(global.location.href);url.searchParams.set('sengoku-version',selected);
   global.location.replace(url.href);
  }catch{status.textContent='新版を開けませんでした。もう一度お試しください。';}
  finally{setSwitching(false);}
 });
}
// Let the browser finish the visible entry before preparing offline play.
if(global.navigator?.serviceWorker&&!global.SENGOKU_OFFLINE&&global.location?.protocol!=='file:'){
 const register=()=>registerOfflineEntry().catch(()=>{});
 if(document.readyState==='complete')register();
 else global.addEventListener('load',register,{once:true});
}
global.SengokuLoading={begin,progress,end,ready};global.SengokuTitle={enter,home};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})(window);
