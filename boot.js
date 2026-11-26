/* 起動画面と、実際の読込を待つ共通ローディング表示。 */
(function(global){
'use strict';
const byId=id=>document.getElementById(id);
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
 const status=byId('art-load-status');
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
 const link=byId('game-skip-link');
 if(!link)return;
 link.setAttribute('href',atTitle?'#launch-enter':'#main');
 link.textContent=atTitle?'開始ボタンへ移動':'ゲーム本文へ移動';
}
function enter(){
 if(started)return;
 screenEpoch++;
 started=true;enterButton.disabled=true;
 const app=byId('app');
 app.hidden=false;app.inert=false;app.removeAttribute('aria-hidden');
 document.body.classList.remove('at-title');
 title.hidden=true;global.SENGOKU_AT_TITLE=false;
 setSkipTarget(false);
 global.SengokuBridge?.syncMusic?.();
 global.SengokuBridge?.renderGameplay?.();
 byId('main')?.focus({preventScroll:true});
 global.SengokuBridge?.openStartSelection?.();
 void ready();
}
function updateTitleAction(){
 const hasSave=global.SengokuBridge?.hasStarted?.()===true;
 enterButton.querySelector('[data-enter-label]').textContent=hasSave?'物語の続きをひらく':'城を選んで始める';
 title.querySelector('[data-title-status]').textContent=hasSave?'':'開始する城を選んで、物語を始めます';
 const resume=byId('title-resume');
 const state=hasSave?global.SengokuBridge?.getState?.():null;
 if(resume){
  resume.hidden=!state;
  if(state){
   const home=global.SENGOKU_DATA?.castles?.find(castle=>castle.id===state.home);
   const name=byId('title-resume-name'),detail=byId('title-resume-detail');
   if(name)name.textContent=[state.clan,home?.name].filter(Boolean).join(' · ');
   const officers=Array.isArray(state.officers)?state.officers.length:0;
   if(detail)detail.textContent=state.gameOver?'戦役の記録を確認して、再起へ。':`家臣 ${officers}名 · 前回の進行から再開`;
  }
 }
 enterButton.disabled=false;
}
function home(){screenEpoch++;artworkGeneration++;const status=byId('art-load-status');if(status)status.hidden=true;setSkipTarget(true);global.SENGOKU_AT_TITLE=true;started=false;document.body.classList.add('at-title');byId('app').inert=true;byId('app').setAttribute('aria-hidden','true');title.hidden=false;updateTitleAction();global.SengokuBridge?.syncMusic?.();enterButton.focus({preventScroll:true});}
function init(){title=byId('launch-screen');enterButton=byId('launch-enter');overlay=byId('game-loading');overlay.addEventListener('cancel',e=>e.preventDefault());
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
const offlineEntrySupported=!!global.navigator?.serviceWorker&&!global.SENGOKU_OFFLINE&&global.location?.protocol!=='file:';
const updateSupported=offlineEntrySupported&&!!global.MessageChannel;
let updateController=null;
let registrationMessage=updateSupported?'更新機能を準備しています…':'この環境ではゲーム内の更新を確認できません。';
function currentRelease(){
 const href=document.querySelector('link[rel="manifest"]')?.href;
 return href?new URL(href).searchParams.get('v'):'';
}
function renderUpdateSettings(){
 const panel=byId('settings-release-update');
 if(!panel)return;
 const current=currentRelease()?.split('-')[0];
 panel.querySelector('#settings-release-version').textContent=current?'現在のバージョン '+current:'';
 if(updateController){updateController.render(panel);return;}
 panel.querySelector('#settings-release-status').textContent=registrationMessage;
}
global.SengokuUpdates={renderSettings:renderUpdateSettings};
async function registerOfflineEntry(){
 const registration=await global.navigator.serviceWorker.register('./sw.js');
 const action=byId('game-update-action'),button=byId('game-update-open'),status=byId('game-update-status');
 if(!action||!button||!status||!global.MessageChannel)return;
 const release=currentRelease();
 const interval=60000,manualCooldown=10000,checkButtons=[];
 function element(tag,id,text=''){
  const node=document.createElement(tag);node.id=id;
  if(text)node.textContent=text;
  if(tag==='button')node.type='button';
  if(tag==='span')node.setAttribute('role','status');
  return node;
 }
 const checkRow=element('div','game-update-check');
 const checkButton=element('button','game-update-check-button','更新を確認');checkButton.className='edition-profile-link';
 const checkStatus=element('span','game-update-check-status');
 checkRow.append(checkButton,checkStatus);action.parentNode.insertBefore(checkRow,action);checkButtons.push(checkButton);
 const help=document.createElement('p');help.className='game-update-help';help.textContent='新版を開くと画面を再読み込みします。入力や通話を終えてからお進みください。';action.appendChild(help);
 const menu=document.querySelector('#app .sidebar-bottom');
 if(menu){
  const menuButton=element('button','game-update-menu-check','更新を確認');menuButton.className='nav-item';menuButton.setAttribute('data-action','check-update');
  menu.insertBefore(menuButton,menu.querySelector('.version-label'));checkButtons.push(menuButton);
 }
 const notice=element('aside','game-update-notice');notice.hidden=true;notice.setAttribute('aria-label','ゲームの更新');
 const noticeLabel=element('span','game-update-notice-label');
 const returnButton=element('button','game-update-return','保存してタイトルへ');returnButton.setAttribute('aria-describedby',noticeLabel.id);
 const noticeStatus=element('span','game-update-notice-status');
 notice.append(noticeLabel,returnButton,noticeStatus);document.querySelector('#app .topbar')?.appendChild(notice);
 let target=null,targetWorker=null,checking=0,inspecting=null,inspectedWorker=null,switching=false;
 let timer=null,inFlight=null,lastRequest=-Infinity,nextCheck=Date.now()+interval,pageActive=true,lastOutcome='current';
 const canCheck=()=>pageActive&&document.visibilityState==='visible'&&global.navigator.onLine!==false;
 function stopTimer(){clearTimeout(timer);timer=null;}
 function schedule(){
  stopTimer();
  if(canCheck()&&!inFlight)timer=setTimeout(()=>{timer=null;void checkForUpdates();},Math.max(1,nextCheck-Date.now()));
 }
 let settingsMessage='';
 function setChecking(value){for(const control of checkButtons){control.disabled=value;control.setAttribute('aria-busy',String(value));}renderUpdateSettings();}

 function showCheckResult(result){
  const message=target?'新版の準備ができています。区切りのよいときに開けます。':
   result==='offline'?'オフラインです。通信が戻ると自動で確認します。':
   result==='error'?'更新を確認できませんでした。通信状況を確認して、もう一度お試しください。':
   registration.installing?'新版を準備中です。準備ができるとお知らせします。':
   result==='recent'?'直前に確認しました。約1分ごとに自動で確認します。':'現在、新しい更新はありません。';
  checkStatus.textContent=message;settingsMessage=message;renderUpdateSettings();
  if(global.SENGOKU_AT_TITLE===false&&!byId('settings-release-update')?.closest('dialog')?.open)global.SengokuBridge?.toast?.(message);
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
   if(previous!==target){noticeLabel.textContent=target?'新版あり':'';noticeStatus.textContent='';settingsMessage='';renderUpdateSettings();}
  });
  inspecting=task;
  try{await task;}finally{if(inspecting===task)inspecting=null;}
 }
 async function checkForUpdates(manual=false){
  if(!canCheck()){
   stopTimer();if(manual)showCheckResult(global.navigator.onLine===false?'offline':'recent');return;
  }
  if(manual){checkStatus.textContent='更新を確認しています…';settingsMessage=checkStatus.textContent;renderUpdateSettings();}
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
 function setSwitching(value){switching=value;button.disabled=value;returnButton.disabled=value;renderUpdateSettings();}
 async function saveBeforeSwitch(selected){
  const name='sengoku-taisen-v'+selected;
  if(!await global.caches.has(name)||!await (await global.caches.open(name)).match(new URL('index.html',registration.scope).href)){
   return '新版の準備を確認できませんでした。通信状況をご確認ください。';
  }
  const ready=await global.SengokuBridge?.prepareReleaseSwitch?.();
  return ready?.ok?'':ready?.message||'保存状態を確認できませんでした。';
 }
 // The header keeps the two-step title flow. Update discovery never reloads
 // gameplay, and the settings shortcut requires an explicit save-and-open.
 async function openRelease(panel=null,returnToTitle=false){
  const dialog=panel?.closest('dialog');
  const inGame=!!panel||returnToTitle;
  if(switching||!target||inGame!==(global.SENGOKU_AT_TITLE===false)||(panel&&!dialog?.open))return;
  let cancelled=false;
  const cancel=()=>{cancelled=true;};
  const stillHere=()=>!cancelled&&(!panel||dialog.open&&panel===byId('settings-release-update'));
  const report=message=>{
   if(panel){settingsMessage=message;renderUpdateSettings();}
   else (returnToTitle?noticeStatus:status).textContent=message;
  };
  dialog?.addEventListener('close',cancel);
  setSwitching(true);report('保存を確認しています…');
  try{
   const selected=target,worker=targetWorker,fromScreen=screenEpoch;
   const failure=await saveBeforeSwitch(selected);
   if(fromScreen!==screenEpoch||!stillHere()){report('');return;}
   if(failure){report(failure);return;}
   if(registration.waiting!==worker||selected!==target){report('');await inspect();return;}
   if(returnToTitle){
    global.SengokuTitle.home();report('');status.textContent='保存を確認しました。新版を開く準備ができています。';
    setSwitching(false);button.focus({preventScroll:true});return;
   }
   const url=new URL(global.location.href);url.searchParams.set('sengoku-version',selected);
   global.location.replace(url.href);
  }catch{if(stillHere())report(returnToTitle?'保存状態を確認できませんでした。もう一度お試しください。':'新版を開けませんでした。もう一度お試しください。');}
  finally{dialog?.removeEventListener('close',cancel);setSwitching(false);}
 }
 returnButton.addEventListener('click',()=>openRelease(null,true));
 button.addEventListener('click',()=>openRelease());
 updateController={render(panel){
  const check=panel.querySelector('#settings-release-check'),open=panel.querySelector('#settings-release-open');
  check.disabled=checkButton.disabled||switching;
  check.setAttribute('aria-busy',String(checkButton.disabled));
  check.onclick=()=>checkForUpdates(true);
  open.hidden=!target;open.disabled=switching;open.onclick=()=>openRelease(panel);
  panel.querySelector('#settings-release-status').textContent=settingsMessage||(target?'新版 '+target.split('-')[0]+' を利用できます。進行を保存して画面を再読み込みします。':'');
 }};
 renderUpdateSettings();
}
// Let the browser finish the visible entry before preparing offline play.
if(offlineEntrySupported){
 const register=()=>registerOfflineEntry().catch(()=>{registrationMessage='更新機能を起動できませんでした。接続を確認してゲームを開き直してください。';renderUpdateSettings();});
 if(document.readyState==='complete')register();
 else global.addEventListener('load',register,{once:true});
}
global.SengokuLoading={begin,progress,end,ready};global.SengokuTitle={enter,home};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})(window);
