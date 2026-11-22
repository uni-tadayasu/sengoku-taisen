/* 戦国VS — player castle residency, ordered retainers and succession. */
(function(global){
'use strict';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const integer=value=>Number.isSafeInteger(Number(value))&&Number(value)>=0?Number(value):0;
const castleId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,90}$/.test(value)?value:'';
const copy=value=>value==null?null:JSON.parse(JSON.stringify(value));
function cleanPerson(value){if(!value||typeof value.playerId!=='string'||typeof value.name!=='string')return null;return{playerId:value.playerId,name:value.name,evaluation:value.evaluation||null,appearance:value.appearance||null,avatarVersion:value.avatarVersion||null,joinedAt:typeof value.joinedAt==='string'?value.joinedAt:null,successionPosition:value.successionPosition===null?null:integer(value.successionPosition),eligible:value.eligible!==false};}
function cleanMembership(value){if(!value||!['lord','retainer'].includes(value.role)||!castleId(value.castleId))return null;const lord=cleanPerson(value.lord);return{role:value.role,castleId:value.castleId,castleName:String(value.castleName||value.castleId),joinedAt:typeof value.joinedAt==='string'?value.joinedAt:null,successionPosition:value.role==='lord'?0:value.successionPosition===null?null:integer(value.successionPosition),eligible:value.eligible!==false,lord,lordPlayerId:String(value.lordPlayerId||lord?.playerId||''),lordEpoch:integer(value.lordEpoch),revision:integer(value.revision)};}
function cleanDirectory(value){if(!value||!Array.isArray(value.castles)||!Number.isSafeInteger(value.revision)||value.revision<0)throw Error('城の入城状況を確認できませんでした。');const seen=new Set(),castles=value.castles.flatMap(row=>{const id=castleId(row?.castleId);if(!id||seen.has(id))return[];seen.add(id);return[{castleId:id,castleName:String(row.castleName||id),region:String(row.region||''),province:String(row.province||''),available:row.available===true,lord:cleanPerson(row.lord),retainerCount:integer(row.retainerCount),lordEpoch:integer(row.lordEpoch),revision:integer(row.revision)}];});return{revision:value.revision,capacity:integer(value.capacity)||castles.length,occupied:integer(value.occupied),full:value.full===true,castles,self:cleanMembership(value.self)};}
function createStore(){
 let owner='',revision=-1,self=null,directory=null;
 return{reset(playerId=''){owner=String(playerId||'');revision=-1;self=null;directory=null;},owner:()=>owner,snapshot:()=>({owner,revision,self:copy(self),directory:copy(directory)}),observe(value,meta={}){
  if(String(meta.playerId||'')!==owner)return{ok:false,ignored:true};
  const incoming=Number.isSafeInteger(meta.revision)?meta.revision:Number.isSafeInteger(value?.residencyRevision)?value.residencyRevision:Number.isSafeInteger(value?.revision)&&Array.isArray(value?.castles)?value.revision:integer(value?.residency?.revision);
  if(incoming<revision)return{ok:false,ignored:true};
  let nextDirectory=null;if(Array.isArray(value?.castles))nextDirectory=cleanDirectory(value);
  const hasSelf=Object.hasOwn(value||{},'residency')||Object.hasOwn(value||{},'self'),nextSelf=hasSelf?cleanMembership(Object.hasOwn(value,'residency')?value.residency:value.self):self;
  const before=self,changed=hasSelf&&JSON.stringify(self)!==JSON.stringify(nextSelf);
  if(nextDirectory)directory=nextDirectory;revision=Math.max(revision,incoming);if(hasSelf)self=nextSelf;
  return{ok:true,changed,before:copy(before),self:copy(self),revision};
 }};
}
function choices(directory,mode){return(directory?.castles||[]).filter(row=>mode==='retainer'?!row.available&&!!row.lord:row.available);}
function choiceMode(directory,preferred='lord'){if(directory?.full)return'retainer';return['lord','retainer'].includes(preferred)?preferred:'lord';}
function roleText(member){return member?.role==='lord'?'領主':member?.successionPosition===null||member?.eligible===false?'家臣 · 継承対象外':`家臣 · 継承順 ${member?.successionPosition||'確認中'}${member?.successionPosition?'番目':''}`;}
function membershipText(member){return member?`${member.castleName} · ${roleText(member)}`:'';}
function createAdmission(options){
 const storage=options.storage,key='sengoku-residency-admission-v1:'+encodeURIComponent(String(options.playerId));
 const valid=record=>record&&record.playerId===String(options.playerId)&&typeof record.requestId==='string'&&record.requestId.length>5&&castleId(record.choice?.castleId)&&['lord','retainer'].includes(record.choice?.mode)&&typeof record.choice?.clan==='string'&&['easy','normal','hard'].includes(record.choice?.difficulty);
 function pending(){try{const record=JSON.parse(storage.getItem(key)||'null');return valid(record)?record:null;}catch(_){return null;}}
 function clear(record){try{const old=pending();if(old?.requestId===record.requestId)storage.removeItem(key);}catch(_){}}
 return{pending,async run(choice){
  let record=pending();if(!record){record={playerId:String(options.playerId),requestId:options.uuid(),choice:{castleId:choice.castleId,mode:choice.mode,clan:choice.clan,difficulty:choice.difficulty}};if(!valid(record))throw Error('入城する城と参加方法を確認してください。');storage.setItem(key,JSON.stringify(record));}
  // Resolve any uncertain earlier admission before accepting another choice.
  options.onPending?.(copy(record));
  let received=false;
  try{
   const result=await options.send({...record.choice,...options.writer(),requestId:record.requestId});received=true;
   if(result?.admission?.requestId!==record.requestId||result.admission.castleId!==record.choice.castleId||result.admission.mode!==record.choice.mode||!Number.isSafeInteger(result.revision)||!result.save?.state)throw Error('入城の受付内容を確認しています。同じ内容で再確認してください。');
   const accepted=await options.accept(result);if(!accepted?.ok)throw Error('入城は受け付けました。最新の進行を同期してから、同じ内容で再確認してください。');
   clear(record);return{...result,effectiveChoice:copy(record.choice)};
  }catch(error){
   if(!received&&Number(error.status)>=400&&Number(error.status)<500&&!['STALE_IDENTITY','ACCOUNT_ACCESS_CHANGED'].includes(error.code)&&![401,403,408,429].includes(Number(error.status)))clear(record);
   throw error;
  }
 }};
}
// Keep the destination, request ID and original revision through reloads.
// Receipt lookup uses the current device and never performs a move.
function createRelocation(options){
 const owner=String(options.playerId),key='sengoku-residency-relocation-v1:'+encodeURIComponent(owner),storage=options.storage;
 function pending(){
  const raw=storage.getItem(key);if(!raw)return null;
  const record=JSON.parse(raw);
  if(record?.owner!==owner||!castleId(record.castleId)||typeof record.requestId!=='string'||typeof record.deviceId!=='string'||!Number.isSafeInteger(record.revision)||record.revision<0)throw Error('前回の移転記録を確認できません。端末同期で最新の本拠を確認してください。');
  return record;
 }
 function clear(record){if(pending()?.requestId===record.requestId)storage.removeItem(key);}
 async function run(id,expectedRequestId=null,{resend=false}={}){
  if(!castleId(id))throw Error('移転先の城を選んでください。');
  let record=pending();
  if((record?.requestId||null)!==expectedRequestId||record&&record.castleId!==id)throw Error('移転記録が更新されました。画面を閉じて受付結果を確認してください。');
  const device=options.writer(),lookup=Boolean(record)&&!resend;
  if(!record){
   record={owner,castleId:id,requestId:options.uuid(),deviceId:device.deviceId,revision:device.revision};
   storage.setItem(key,JSON.stringify(record));
  }
  const {castleId:target,requestId,revision}=record;let received=false;
  try{
   const result=await options.send({castleId:target,requestId,deviceId:device.deviceId,revision},lookup);received=true;
   if(result?.admission?.requestId!==requestId||result.admission.castleId!==target||!['lord','retainer'].includes(result.admission.mode)||!result.save?.state||!Number.isSafeInteger(result.revision))throw Error('移転の受付結果を確認できませんでした。同じ移転先で再確認してください。');
   const accepted=await options.accept(result);if(!accepted?.ok)throw Error('最新の本拠を端末に反映できませんでした。移転結果を再確認してください。');
   clear(record);return{result,superseded:accepted.superseded===true};
  }catch(error){
   // Only a definite rejection of a write releases the chosen destination.
   // A missing receipt may still be racing the original transaction.
   if(!lookup&&!received&&[400,404,409,422].includes(error.status)&&!['STALE_IDENTITY','ACCOUNT_ACCESS_CHANGED','LOCAL_WRITER_CHANGED'].includes(error.code))clear(record);
   throw error;
  }
 }
 return{pending,run};
}
const store=createStore();let opts={},generation=0,directoryPromise=null,dialog=null,dialogCastle='',roster=null,rosterError='',rosterLoading=false,rosterGeneration=0,returnFocus=null;
function context(){const value=opts.getContext?.()||{playerId:'',user:null};return value.pending||value.banned?{...value,playerId:'',user:null}:value;}
function identity(){const c=context(),id=String(c.playerId||c.user?.id||'');if(store.owner()!==id){store.reset(id);generation++;directoryPromise=null;roster=null;rosterGeneration++;renderSelf();}return id;}
function observe(value,meta={}){const owner=identity();if(meta.playerId!==undefined&&String(meta.playerId)!==owner)return{ok:false,ignored:true};const result=store.observe(value,{...meta,playerId:owner});if(result.ok&&result.changed){renderSelf();opts.onChange?.(result);if(result.before?.role==='retainer'&&result.self?.role==='lord'&&result.before.castleId===result.self.castleId)opts.onMessage?.(`${result.self.castleName}の領主を引き継ぎました。城の領主と家臣で確認できます。`);}if(result.ok&&dialog?.open&&roster&&roster.revision<result.revision&&!rosterLoading)void loadRoster();return result;}
async function loadDirectory({force=false}={}){
 const owner=identity(),epoch=generation;if(directoryPromise&&!force)return directoryPromise;
 const task=(async()=>{if(!opts.request)throw Error('城の入城状況に接続できません。');const result=await opts.request('/castles/residency',{method:'GET'});if(epoch!==generation||owner!==identity())throw Object.assign(Error('接続するプレイヤーが変わりました。'),{code:'STALE_IDENTITY'});observe(result,{playerId:owner,revision:result.revision});return store.snapshot().directory;})();directoryPromise=task;
 try{return await task;}finally{if(directoryPromise===task)directoryPromise=null;}
}
function personHtml(person){if(!person)return'<span>領主未入城</span>';const id=esc(person.playerId),photo=global.SengokuAvatar?.markup?.({id:person.playerId,name:person.name,avatarVersion:person.avatarVersion},'inline')||'',name=global.SengokuPremiumRuntime?.nameMarkup?.(person.name,person.appearance)||esc(person.name),badge=global.SengokuEvaluationUI?.badge?.(person.evaluation)||'',office=global.SengokuPublicCourt?.slot?.(person.playerId)||'';const markup=`<span class="residency-person">${photo}<span class="player-evaluation-name" data-premium-player="${id}" data-premium-player-name="${esc(person.name)}">${name}</span>${badge}${office}</span>`;return global.SengokuLordProfile?.linkedName?.(person.playerId,person.name,markup)||markup;}
function selfHtml(){const c=context(),member=store.snapshot().self;if(c.user?.isAdmin||c.user?.isStaff)return'';const move=global.SengokuBridge?.canShowRelocation?.()?'<button type="button" class="button small" data-action="relocate-open" aria-haspopup="dialog">本拠を移す</button>':'';if(member)return`<div class="residency-self-copy"><span>城の所属</span><strong>${esc(member.castleName)}</strong><p>${esc(roleText(member))}</p>${member.role==='retainer'&&(member.successionPosition===null||member.eligible===false)?'<small>本拠の戦役を再開すると継承対象になります。</small>':''}</div><button type="button" class="button small" data-residency-open="${esc(member.castleId)}">城の領主と家臣</button>${move}`;return`<div class="residency-self-copy"><span>城の所属</span><p>${c.user?'入城状況を確認できます。':'未登録の進行は、この端末の個人の戦役です。'}</p></div><button type="button" class="button small" ${c.user?'data-residency-choose':'data-residency-register'}>${c.user?'入城する城を選ぶ':'領主登録・ログイン'}</button>${move}`;}
function compact(){identity();return`<section class="residency-self-panel" data-residency-self aria-label="城の所属">${selfHtml()}</section>`;}
function renderSelf(){for(const host of global.document?.querySelectorAll?.('[data-residency-self]')||[]){const html=selfHtml();host.hidden=!html;if(global.SengokuStableDOM)global.SengokuStableDOM.patch(host,html);else if(host.innerHTML!==html)host.innerHTML=html;}}
function rosterHtml(){const directory=store.snapshot().directory,castle=directory?.castles.find(row=>row.castleId===dialogCastle),name=castle?.castleName||global.SENGOKU_DATA?.castles?.find(row=>row.id===dialogCastle)?.name||dialogCastle;
 return`<div class="residency-dialog-heading"><div><span>城の領主と家臣</span><h2 id="residency-title">${esc(name||'城を選ぶ')}</h2></div><button type="button" class="button small" data-residency-close aria-label="城の領主と家臣を閉じる">閉じる</button></div><p class="residency-explanation">ここに並ぶ家臣はプレイヤーです。登用した武将とは別に、仕えた順番で領主を引き継ぎます。本拠を失っている家臣は継承対象外となり、本拠の戦役を再開すると対象に戻ります。</p><div class="residency-roster-status" role="status">${esc(rosterError|| (rosterLoading?'名簿を確認しています。':''))}</div>${roster?`<section class="residency-lord"><h3>現在の領主</h3>${personHtml(roster.lord)}</section><section class="residency-retainers"><h3>家臣と継承順 <small>${integer(roster.total)}人</small></h3>${roster.retainers.length?`<ol class="residency-roster-list">${roster.retainers.map(person=>`<li data-stable-key="resident-${esc(person.playerId)}"><span class="residency-position">${person.successionPosition===null?'—':integer(person.successionPosition)}<small>${person.successionPosition===null?'対象外':'番目'}</small></span><div>${personHtml(person)}${person.playerId===store.owner()?'<small class="residency-you">あなた</small>':''}</div></li>`).join('')}</ol>`:'<p>この城に仕えているプレイヤー家臣はまだいません。</p>'}${roster.nextCursor?`<button type="button" class="button full" data-residency-more ${rosterLoading?'disabled':''}>続きを表示</button>`:''}</section>`:''}<p class="residency-explanation">本拠の防衛戦で敗れると、先に仕えた家臣から順に領主になります。前の領主は家臣の最後尾へ移ります。武将・資源・個人の進行は、それぞれが保持します。</p><div class="residency-dialog-footer"><button type="button" class="button" data-residency-refresh ${rosterLoading?'disabled':''}>名簿を更新</button><button type="button" class="button primary" data-residency-close>閉じる</button></div>`;
}
function renderRoster(){if(!dialog?.open)return;const content=dialog.querySelector('[data-residency-content]'),html=rosterHtml();if(global.SengokuStableDOM)global.SengokuStableDOM.patch(content,html);else if(content.innerHTML!==html)content.innerHTML=html;}
async function loadRoster(more=false){
 if(rosterLoading||!dialogCastle)return;const token=++rosterGeneration,owner=identity(),epoch=generation,chosen=dialogCastle,cursor=more?roster?.nextCursor:null;let restart=false;rosterLoading=true;rosterError='';renderRoster();
 try{const result=await opts.request('/castles/residency?castleId='+encodeURIComponent(chosen)+(cursor?'&cursor='+encodeURIComponent(cursor):'')+'&limit=50',{method:'GET'});if(token!==rosterGeneration||owner!==identity()||epoch!==generation||chosen!==dialogCastle)return;const accepted=observe(result,{playerId:owner,revision:result.revision});if(!accepted.ok){rosterError='名簿が更新されました。更新ボタンで最新の順番を確認してください。';return;}const incoming=result.roster;if(!incoming||incoming.castleId!==chosen||!Array.isArray(incoming.retainers))throw Error('家臣の名簿を確認できませんでした。');if(more&&roster?.revision!==result.revision){restart=true;rosterError='家臣の名簿が更新されました。最新の順番を確認しています。';return;}const rows=incoming.retainers.map(cleanPerson).filter(Boolean);roster={castleId:chosen,lord:cleanPerson(incoming.lord),revision:result.revision,retainers:more&&roster?.revision===result.revision?[...new Map([...(roster?.retainers||[]),...rows].map(row=>[row.playerId,row])).values()]:rows,total:integer(incoming.total),nextCursor:typeof incoming.nextCursor==='string'?incoming.nextCursor:null};}
 catch(error){if(token===rosterGeneration)rosterError=error.message||'名簿を読み込めませんでした。';}
 finally{if(token===rosterGeneration){rosterLoading=false;renderRoster();if(restart)await loadRoster();}}
}
function close(){if(!dialog?.open)return;dialog.close();rosterGeneration++;rosterLoading=false;returnFocus?.isConnected&&returnFocus.focus?.({preventScroll:true});}
function open(id){const chosen=castleId(id||store.snapshot().self?.castleId||opts.homeCastleId?.());if(!chosen)return;identity();dialogCastle=chosen;roster=null;rosterError='';rosterLoading=false;rosterGeneration++;returnFocus=global.document?.activeElement;
 if(!dialog){dialog=global.document.createElement('dialog');dialog.className='residency-dialog';dialog.setAttribute('aria-labelledby','residency-title');dialog.innerHTML='<div data-residency-content></div>';global.document.body.appendChild(dialog);dialog.addEventListener('cancel',event=>{event.preventDefault();close();});}
 if(!dialog.open)dialog.showModal();renderRoster();loadRoster();
}
function refreshIdentity(){const before=store.owner();identity();renderSelf();if(before!==store.owner()&&dialog?.open)close();}
function configure(value){opts={...opts,...value};identity();renderSelf();return api;}
function click(event){const button=event.target?.closest?.('[data-residency-open],[data-residency-close],[data-residency-refresh],[data-residency-more],[data-residency-register],[data-residency-choose]');if(!button||button.disabled)return;event.preventDefault();if(button.hasAttribute('data-residency-open'))open(button.dataset.residencyOpen);else if(button.hasAttribute('data-residency-close'))close();else if(button.hasAttribute('data-residency-refresh'))loadRoster();else if(button.hasAttribute('data-residency-more'))loadRoster(true);else if(button.hasAttribute('data-residency-register'))global.SengokuSocial?.open?.('profile');else opts.onChoose?.();}
const api={configure,observe,loadDirectory,open,close,compact,refreshIdentity,renderSelf,self:()=>store.snapshot().self,directory:()=>store.snapshot().directory,revision:()=>store.snapshot().revision,createStore,cleanMembership,cleanDirectory,choices,choiceMode,roleText,membershipText,createAdmission,createRelocation,personHtml};
global.SengokuResidency=api;global.document?.addEventListener?.('click',click);
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
