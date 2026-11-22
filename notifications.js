/* Optional browser Push: opt-in from a user gesture, with server-side preferences. */
(function(global){
 'use strict';
 const LABELS={battle:'襲撃・合戦の結果',letter:'書状・システム便',operation:'同盟の集合・作戦',construction:'普請・研究の完成',event:'イベントの開始・終了'};
 const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const ownerKey='sengoku-push-owner-v1';let opts={},dialog=null,record=null,busy=false,message='',stamp='',sequence=0,previousFocus=null;
 const context=()=>opts.getContext?.()||global.SengokuSocial?.getExpansionContext?.()||{};
 const owner=()=>String(context().playerId||'');
 const request=(route,options)=>opts.request?opts.request(route,options):global.SengokuSocial.expansionRequest(route,options);
 const supported=()=>global.isSecureContext&&'serviceWorker'in navigator&&'PushManager'in global&&'Notification'in global;
 function live(mark){if(mark!==stamp||stamp!==owner()||!context().user)throw Error('接続中の領主が変わりました。通知画面を開き直してください。');}
 function formValues(){const f=new FormData(dialog.querySelector('form')),p=record.preferences;return{enabled:p.enabled,...Object.fromEntries(Object.keys(LABELS).map(k=>[k,f.has(k)])),quietStart:Number(f.get('quietStart')),quietEnd:Number(f.get('quietEnd')),digestMinutes:Number(f.get('digestMinutes'))};}
 function render(){if(!dialog)return;const p=record?.preferences;dialog.innerHTML=`<form><header><div><small>お知らせ</small><h2 id="notification-title">通知設定</h2></div><button type="button" class="button" data-notification="close" aria-label="閉じる">×</button></header><p>ゲームを閉じている間の出来事を、許可した端末へお知らせします。通知本文には書状や作戦の内容を表示しません。</p><div class="notification-status" role="status">${escape(message)}</div>${!supported()?'<p class="notice">このブラウザではプッシュ通知を利用できません。対応するブラウザ、またはホーム画面へ追加したアプリから設定してください。ゲーム内の郵便と報告は利用できます。</p>':''}${p?`<p class="notification-state">現在：<strong>${p.enabled?'通知オン':'通知オフ'}</strong> · 登録端末 ${record.devices} / 5</p><fieldset><legend>通知する出来事</legend>${Object.entries(LABELS).map(([k,label])=>`<label class="notification-option"><input type="checkbox" name="${k}" ${p[k]?'checked':''}>${label}</label>`).join('')}</fieldset><fieldset><legend>静かな時間帯（日本時間）</legend><p>この時間帯のお知らせは、終了後にまとめます。開始と終了を同じ時刻にすると、休止しません。</p><div class="notification-hours">${[['quietStart','開始',p.quietStart],['quietEnd','終了',p.quietEnd]].map(([k,label,value])=>`<label>${label}<select name="${k}">${Array.from({length:24},(_,n)=>`<option value="${n}" ${n===value?'selected':''}>${n}:00</option>`).join('')}</select></label>`).join('')}</div></fieldset><label class="notification-option">通知をまとめる最短間隔<select name="digestMinutes">${[[0,'届き次第'],[5,'5分'],[15,'15分'],[60,'1時間']].map(([value,label])=>`<option value="${value}" ${value===p.digestMinutes?'selected':''}>${label}</option>`).join('')}</select></label><p class="notification-note">配信処理は定期的に行います。端末や通信状態によって到着まで時間がかかる場合があります。</p><div class="expansion-actions"><button type="button" class="button" data-notification="save" ${busy?'disabled':''}>設定を保存</button><button type="button" class="button gold" data-notification="enable" ${busy||!supported()||!record.configured?'disabled':''}>この端末の通知を有効にする</button><button type="button" class="button" data-notification="disable" ${busy?'disabled':''}>通知を止める</button></div>${!record.configured?'<p class="notice">通知配信の準備中です。設定は保存できます。</p>':''}`:'<p>通知設定を確認しています。</p>'}</form>`;dialog.querySelector('form').addEventListener('submit',e=>e.preventDefault());}
 async function load(){const mark=stamp,serial=++sequence;try{const r=await request('/notifications');live(mark);if(serial!==sequence)return;record=r;message='';render();}catch(e){if(dialog&&serial===sequence){message=e.message;render();}}}
 const bytes=value=>Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
 async function registration(){await navigator.serviceWorker.register('./sw.js');return navigator.serviceWorker.ready;}
 async function run(kind){if(busy)return;const mark=stamp;busy=true;try{
   live(mark);const preferences=formValues();
   if(kind==='enable'){
    if(!supported())throw Error('このブラウザはプッシュ通知に対応していません。');
    const permission=await Notification.requestPermission();live(mark);if(permission!=='granted')throw Error('ブラウザで通知が許可されませんでした。通知設定から許可して再度お試しください。');
    const reg=await registration();live(mark);let sub=await reg.pushManager.getSubscription();live(mark);
    const stored=localStorage.getItem(ownerKey);if(sub&&stored&&stored!==mark){await sub.unsubscribe();live(mark);sub=null;}
    if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes(record.publicKey)});live(mark);
    await request('/notifications/subscribe',{method:'POST',data:{subscription:sub.toJSON()}});live(mark);
    preferences.enabled=true;await request('/notifications/preferences',{method:'POST',data:preferences});live(mark);localStorage.setItem(ownerKey,mark);message='この端末の通知を有効にしました。';
   }else if(kind==='disable'){
    preferences.enabled=false;await request('/notifications/preferences',{method:'POST',data:preferences});live(mark);
    if(supported()){const reg=await navigator.serviceWorker.getRegistration();live(mark);const sub=await reg?.pushManager.getSubscription();live(mark);if(sub){await request('/notifications/unsubscribe',{method:'POST',data:{endpoint:sub.endpoint}});live(mark);await sub.unsubscribe();live(mark);}}
    localStorage.removeItem(ownerKey);message='通知を停止しました。';
   }else{await request('/notifications/preferences',{method:'POST',data:preferences});live(mark);message='通知の設定を保存しました。';}
   const r=await request('/notifications');live(mark);record=r;
  }catch(e){message=e.message||'通知設定を更新できませんでした。';}finally{busy=false;render();}}
 function close(){sequence++;dialog?.close();dialog?.remove();dialog=null;previousFocus?.focus?.();}
 async function refreshAccess(){
   const c=context(),id=String(c.playerId||'');if(dialog&&(id!==stamp||c.banned))close();
   if(c.pending||!supported())return;
   try{const old=localStorage.getItem(ownerKey);if(old&&old!==id){const reg=await navigator.serviceWorker.getRegistration();if(owner()!==id||context().pending||localStorage.getItem(ownerKey)!==old)return;const sub=await reg?.pushManager.getSubscription();if(owner()!==id||context().pending||localStorage.getItem(ownerKey)!==old)return;await sub?.unsubscribe();if(owner()===id&&localStorage.getItem(ownerKey)===old)localStorage.removeItem(ownerKey);}}catch(_){}
 }
 function open(options={}){opts={...opts,...options};if(!context().user){opts.notify?.('交流で領主登録・接続を確認してください。',true);return;}if(dialog)close();stamp=owner();previousFocus=document.activeElement;dialog=document.createElement('dialog');dialog.className='notification-dialog';dialog.setAttribute('aria-labelledby','notification-title');dialog.addEventListener('cancel',e=>{e.preventDefault();close();});dialog.addEventListener('click',e=>{const b=e.target.closest('[data-notification]');if(!b||b.disabled)return;b.dataset.notification==='close'?close():run(b.dataset.notification);});document.body.appendChild(dialog);record=null;message='';render();dialog.showModal();load();}
 global.SengokuNotifications={open,close,refreshAccess};
})(window);
