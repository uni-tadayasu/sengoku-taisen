/* Optional browser Push: opt-in from a user gesture, with server-side preferences. */
(function(global){
 'use strict';
 const LABELS={letter:'書状・システム便',chat:'フレンド・同盟・運営の会話、申請・招待・交易、自分への呼びかけ・返信、御所の談話・拝謁',worldChat:'世界チャットの投稿',announcement:'御触書・全体のお知らせ',battle:'襲撃・合戦の結果',operation:'同盟の集合・作戦',construction:'普請・研究の完成',event:'イベントの開始・終了'};
 const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const ownerKey='sengoku-push-owner-v1';
 let opts={},dialog=null,record=null,device=null,busy=false,message='',stamp='',sequence=0,view=0,previousFocus=null;
 const context=()=>opts.getContext?.()||global.SengokuSocial?.getExpansionContext?.()||{};
 const owner=()=>String(context().playerId||'');
 const request=(route,options)=>opts.request?opts.request(route,options):global.SengokuSocial.expansionRequest(route,options);
 const supported=()=>global.isSecureContext&&'serviceWorker'in navigator&&'PushManager'in global&&'Notification'in global;
 const permission=()=>global.Notification?.permission||'default';
 const appleMobile=()=>/iPad|iPhone|iPod/.test(navigator.userAgent||'')||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 const standalone=()=>navigator.standalone===true||global.matchMedia?.('(display-mode: standalone)')?.matches===true;
 const needsInstall=()=>appleMobile()&&!standalone();
 const usable=()=>supported()&&!needsInstall();
 const savedOwner=()=>{try{return localStorage.getItem(ownerKey);}catch(_){return null;}};
 function rememberOwner(id){try{localStorage.setItem(ownerKey,id);}catch(_){}}
 function forgetOwner(){try{localStorage.removeItem(ownerKey);}catch(_){}}
 function live(mark,session=view){const c=context();if(!dialog||session!==view||mark!==stamp||stamp!==owner()||!c.user||c.pending||c.banned)throw Error('接続中の領主が変わりました。通知画面を開き直してください。');}
 function formValues(){const f=new FormData(dialog.querySelector('form')),p=record.preferences;return{enabled:p.enabled,...Object.fromEntries(Object.keys(LABELS).map(k=>[k,f.has(k)])),quietStart:Number(f.get('quietStart')),quietEnd:Number(f.get('quietEnd')),digestMinutes:Number(f.get('digestMinutes'))};}
 function deviceState(){
  if(needsInstall())return'ホーム画面への追加が必要';
  if(!supported())return'このブラウザは通知に未対応';
  if(permission()==='denied')return'端末で通知がブロックされています';
  if(!device||device.checking)return'登録を確認しています';
  if(device.error)return'端末の登録を確認できませんでした';
  if(device.registered)return record?.preferences.enabled?(permission()==='granted'?'通知オン':'通知の許可が必要'):'全端末の通知が停止中';
  return'通知オフ（この端末は未登録）';
 }
 function render(){
  if(!dialog)return;
  const p=record?.preferences,canTest=usable()&&record?.configured&&p?.enabled&&device?.registered&&permission()==='granted';
  const help=needsInstall()?'<section class="notification-help" aria-label="iPhone・iPadの通知設定"><h3>iPhone・iPadで受け取るには</h3><p>iOS・iPadOS 16.4以降が必要です。Safariの共有メニューから「ホーム画面に追加」し、追加した戦国VSのアイコンを開いて、この画面で通知をオンにしてください。</p></section>':!supported()?'<p class="notice">このブラウザではプッシュ通知を利用できません。対応するブラウザ、またはホーム画面へ追加したアプリから設定してください。ゲーム内の郵便と報告は利用できます。</p>':'';
  const html=`<form><header><div><small>お知らせ</small><h2 id="notification-title">端末への通知</h2></div><button type="button" class="button" data-notification="close" aria-label="閉じる">×</button></header>
   <p>新しいメッセージや出来事を、許可した端末へお知らせします。ゲームを閉じていても受け取れます。メッセージの本文や送信者名は通知に表示しません。</p><p class="notification-note">ゲーム内の未読表示と交流の「通知」は、端末への通知をオフにしていても利用できます。</p>
   <div class="notification-status" role="status" aria-live="polite">${escape(message)}</div>${help}
   ${permission()==='denied'?'<p class="notice">通知がブロックされています。この端末のブラウザ設定で戦国VSの通知を許可してください。ホーム画面アプリの場合は、端末の「設定」→「通知」も確認してください。変更後に「端末を再確認」を押してください。</p>':''}
   ${p?`<div class="notification-device"><p class="notification-state">この端末：<strong>${escape(deviceState())}</strong></p><p>全端末共通の配信：<strong>${p.enabled?'オン':'オフ'}</strong> · 登録端末 ${Number(record.devices)||0} / 5</p><p class="notification-note">通知の許可と端末の登録は、それぞれの端末で行ってください。</p></div>
    <div class="notification-actions"><button type="button" class="button gold" data-notification="enable" ${busy||!usable()||!record.configured||permission()==='denied'?'disabled':''}>${device?.registered?'この端末の通知を有効にする':'この端末の通知をオン'}</button><button type="button" class="button" data-notification="test" ${busy||!canTest?'disabled':''}>この端末にテスト通知</button><button type="button" class="button" data-notification="disable" ${busy||!device?.subscription?'disabled':''}>この端末だけオフ</button><button type="button" class="button" data-notification="refresh" ${busy?'disabled':''}>端末を再確認</button></div>
    ${device?.error?`<p class="notice">${escape(device.error)} 通信を確認して、端末を再確認してください。</p>`:''}
    <fieldset><legend>通知するメッセージ・出来事</legend>${Object.entries(LABELS).map(([k,label])=>`<label class="notification-option"><input type="checkbox" name="${k}" ${p[k]?'checked':''}>${label}</label>`).join('')}<p class="notification-note">世界チャットは投稿数が多いため、必要な場合にオンにできます。この種類と以下の時間設定は、同じ領主の全端末で共有します。</p></fieldset>
    <fieldset><legend>静かな時間帯（日本時間）</legend><p>この時間帯のお知らせは、終了後にまとめます。開始と終了を同じ時刻にすると、休止しません。</p><div class="notification-hours">${[['quietStart','開始',p.quietStart],['quietEnd','終了',p.quietEnd]].map(([k,label,value])=>`<label>${label}<select name="${k}">${Array.from({length:24},(_,n)=>`<option value="${n}" ${n===value?'selected':''}>${n}:00</option>`).join('')}</select></label>`).join('')}</div></fieldset>
    <label class="notification-option">通知をまとめる最短間隔<select name="digestMinutes">${[[0,'届き次第'],[5,'5分'],[15,'15分'],[60,'1時間']].map(([value,label])=>`<option value="${value}" ${value===p.digestMinutes?'selected':''}>${label}</option>`).join('')}</select></label>
    <p class="notification-note">端末・通信状態や集中モードによって、通知の表示や到着時刻が変わることがあります。</p>
    <div class="notification-actions"><button type="button" class="button" data-notification="save" ${busy?'disabled':''}>設定を保存</button><button type="button" class="button" data-notification="disable-all" ${busy||!p.enabled&&!record.devices?'disabled':''}>すべての端末の通知をオフ</button></div>
    ${!record.configured?'<p class="notice">通知配信の準備中です。設定は保存できます。</p>':''}`:'<p>通知設定を確認しています。</p><button type="button" class="button" data-notification="refresh">再確認</button>'}
   <details class="notification-help"><summary>端末ごとの設定方法</summary><p>PC・Android：この画面で「この端末の通知をオン」を押し、ブラウザの確認で許可します。</p><p>iPhone・iPad：iOS・iPadOS 16.4以降で、Safariの共有メニューからホーム画面に追加し、そのアイコンから起動して通知を許可します。</p><p>許可後は「この端末にテスト通知」で確認できます。通知が届かない場合は、OSとブラウザの通知設定・集中モード・省電力設定を確認してください。</p></details>
   </form>`;
  if(global.SengokuStableDOM)global.SengokuStableDOM.patch(dialog,html,{key:stamp});else dialog.innerHTML=html;
 }
 async function inspectDevice(mark,session){
  live(mark,session);
  if(!usable())return{checking:false,registered:false,subscription:null};
  const reg=await navigator.serviceWorker.getRegistration();live(mark,session);
  const sub=await reg?.pushManager.getSubscription();live(mark,session);
  if(!sub)return{checking:false,registered:false,subscription:null};
  const result=await request('/notifications/device',{method:'POST',data:{endpoint:sub.endpoint}});live(mark,session);
  return{checking:false,registered:result.subscribed===true,subscription:sub};
 }
 async function load(){
  const mark=stamp,session=view,serial=++sequence;busy=true;device={checking:true};render();
  try{const r=await request('/notifications');live(mark,session);if(serial!==sequence)return;record=r;message='';render();
   try{const current=await inspectDevice(mark,session);if(serial!==sequence)return;device=current;}catch(e){live(mark,session);if(serial!==sequence)return;device={checking:false,registered:false,error:e.message};}
   render();
  }catch(e){if(dialog&&session===view&&serial===sequence){message=e.message;device={checking:false,registered:false,error:e.message};}}
  finally{if(dialog&&session===view&&serial===sequence){busy=false;render();}}
 }
 const bytes=value=>Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
 async function registration(){await navigator.serviceWorker.register('./sw.js');return navigator.serviceWorker.ready;}
 async function currentSubscription(mark,session){const reg=await navigator.serviceWorker.getRegistration();live(mark,session);const sub=await reg?.pushManager.getSubscription();live(mark,session);return sub;}
 async function run(kind){
  if(busy)return;
  if(kind==='refresh'){load();return;}
  const mark=stamp,session=view;busy=true;
  try{
   live(mark,session);if(!record?.preferences)throw Error('通知設定の確認後にお試しください。');const preferences=formValues();
   if(kind==='enable'){
    if(!usable())throw Error(needsInstall()?'ホーム画面に追加した戦国VSから通知を設定してください。':'このブラウザはプッシュ通知に対応していません。');
    if(!record.configured)throw Error('通知配信の準備中です。');
    if(permission()==='denied')throw Error('端末・ブラウザの設定で戦国VSの通知を許可してください。');
    // Start the permission request synchronously in the original button gesture.
    const permissionResult=permission()==='granted'?'granted':Notification.requestPermission();render();
    const allowed=await permissionResult;live(mark,session);if(allowed!=='granted')throw Error('ブラウザで通知が許可されませんでした。端末・ブラウザの通知設定から許可して、再度お試しください。');
    const reg=await registration();live(mark,session);let sub=await reg.pushManager.getSubscription();live(mark,session);
    const stored=savedOwner();if(sub&&stored&&stored!==mark){await sub.unsubscribe();live(mark,session);sub=null;}
    if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes(record.publicKey)});live(mark,session);
    // Record the local owner before the network write, so an account switch can
    // unsubscribe this browser even when the registration response is pending.
    rememberOwner(mark);await request('/notifications/subscribe',{method:'POST',data:{subscription:sub.toJSON()}});live(mark,session);
    device={checking:false,registered:true,subscription:sub};
    preferences.enabled=true;await request('/notifications/preferences',{method:'POST',data:preferences});live(mark,session);record.preferences=preferences;message='この端末の通知を有効にしました。テスト通知で受信を確認できます。';
   }else if(kind==='disable'||kind==='disable-all'){
    render();
    if(kind==='disable-all'){
     preferences.enabled=false;await request('/notifications/preferences',{method:'POST',data:preferences});live(mark,session);record.preferences=preferences;
     await request('/notifications/unsubscribe',{method:'POST',data:{all:true}});live(mark,session);record.devices=0;
    }
    const sub=supported()?await currentSubscription(mark,session):null;live(mark,session);
    if(sub){
     if(kind==='disable'){await request('/notifications/unsubscribe',{method:'POST',data:{endpoint:sub.endpoint}});live(mark,session);}
     device={checking:false,registered:false,subscription:sub};await sub.unsubscribe();live(mark,session);
    }
    forgetOwner();device={checking:false,registered:false,subscription:null};message=kind==='disable-all'?'すべての端末の通知を停止しました。再開する端末で通知をオンにしてください。':'この端末の通知を停止しました。';
   }else if(kind==='test'){
    if(!usable()||permission()!=='granted'||!record.preferences.enabled||!device?.registered)throw Error('この端末の通知をオンにしてからお試しください。');
    render();const sub=await currentSubscription(mark,session);if(!sub)throw Error('この端末の通知を登録し直してください。');
    const result=await request('/notifications/test',{method:'POST',data:{endpoint:sub.endpoint}});live(mark,session);
    if(result.sent!==1)throw Error('テスト通知を送信できませんでした。端末の登録を確認して再度お試しください。');
    message='テスト通知を配信サービスに送信しました。届かない場合は、端末・ブラウザの通知設定や集中モードを確認してください。';
   }else if(kind==='save'){
    render();await request('/notifications/preferences',{method:'POST',data:preferences});live(mark,session);record.preferences=preferences;message='通知の設定を保存しました。';
   }else return;
   const r=await request('/notifications');live(mark,session);record=r;
   try{device=await inspectDevice(mark,session);}catch(e){live(mark,session);device={checking:false,registered:false,error:e.message};}
  }catch(e){if(dialog&&session===view)message=e.message||'通知設定を更新できませんでした。';}
  finally{if(session===view){busy=false;render();}}
 }
 function close(){sequence++;view++;busy=false;dialog?.close();dialog?.remove();dialog=null;previousFocus?.focus?.();}
 async function refreshAccess(){
  const c=context(),id=String(c.playerId||'');if(dialog&&(id!==stamp||c.banned||!c.user&&!c.pending))close();
  if(c.pending||!supported())return;
  try{const old=savedOwner();if(old&&(old!==id||c.banned||!c.user)){
   const reg=await navigator.serviceWorker.getRegistration();if(owner()!==id||context().pending||savedOwner()!==old)return;
   const sub=await reg?.pushManager.getSubscription();if(owner()!==id||context().pending||savedOwner()!==old)return;
   await sub?.unsubscribe();if(owner()===id&&savedOwner()===old)forgetOwner();
  }}catch(_){}
 }
 function open(options={}){
  opts={...opts,...options};const c=context();if(!c.user||c.pending||c.banned){opts.notify?.('交流で領主登録・接続を確認してください。',true);return;}
  if(dialog)close();view++;stamp=owner();previousFocus=document.activeElement;dialog=document.createElement('dialog');dialog.className='notification-dialog';dialog.setAttribute('aria-labelledby','notification-title');
  dialog.addEventListener('submit',e=>e.preventDefault());dialog.addEventListener('cancel',e=>{e.preventDefault();close();});dialog.addEventListener('click',e=>{const b=e.target.closest('[data-notification]');if(!b||b.disabled)return;b.dataset.notification==='close'?close():run(b.dataset.notification);});
  document.body.appendChild(dialog);record=null;device=null;message='';render();dialog.showModal();load();
 }
 global.SengokuNotifications={open,close,refreshAccess};
})(window);
