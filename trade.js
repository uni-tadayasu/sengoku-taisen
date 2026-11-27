/* Player-to-player trade. The server settles assets; this UI only submits terms. */
(function(global){
'use strict';
const ASSETS={gold:'金銭',rice:'兵糧',wood:'木材',stone:'石材',magatama:'勾玉',troops:'兵士（輸出入）'};
const PLAYER=/^[A-Za-z0-9_-]{1,90}$/,TRADE=/^tr_[a-f0-9]{32}$/,REQUEST=/^[A-Za-z0-9_-]{1,90}$/;
const STORE='sengoku-trade-ui-pending-v1:',MAX_AMOUNT=1000000,BALANCE_LIMIT=999999999,TROOP_BALANCE_LIMIT=100000000;
const clone=value=>JSON.parse(JSON.stringify(value));
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const num=value=>Math.max(0,Math.floor(Number(value)||0)).toLocaleString('ja-JP');
// Omit zero troops so persisted five-asset proposals keep the same identity.
const blankAssets=()=>Object.fromEntries(Object.keys(ASSETS).filter(key=>key!=='troops').map(key=>[key,0]));
function assets(value,max=MAX_AMOUNT){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!Object.hasOwn(ASSETS,key)))return null;
  const result=blankAssets();
  for(const key of Object.keys(ASSETS)){const n=value[key]??0;if(!Number.isSafeInteger(n)||n<0||n>Math.min(max,key==='troops'?TROOP_BALANCE_LIMIT:max)||Object.hasOwn(value,key)&&value[key]===null)return null;if(key!=='troops'||n>0)result[key]=n;}
  return result;
}
const nonempty=value=>value&&Object.values(value).some(n=>n>0);
const assetText=value=>Object.entries(ASSETS).filter(([key])=>Number(value?.[key])>0).map(([key,label])=>label+' '+num(value[key])+(key==='troops'?'人':'')).join('・')||'なし（無償）';
function overflowAsset(state,incoming,outgoing=blankAssets()){
  return Object.keys(ASSETS).find(key=>{
    const added=incoming[key]??0,spent=outgoing[key]??0;
    if(key==='troops'&&added<=spent)return false;
    const limit=key==='troops'?state.troopTransportCapacity:state.rules.balanceLimit;
    return limit===null||limit===undefined||(state.balances[key]??0)-spent+added>limit;
  });
}
const troopCapacityText=state=>'兵士：所持 '+num(state.balances.troops)+'人 · 輸入・返還の受入枠 '+(state.troopTransportCapacity===null?'確認中':'あと'+num(Math.max(0,state.troopTransportCapacity-(state.balances.troops??0)))+'人')+'（拠点容量とは別枠）';
const overflowText=(key,claim=false,state=null)=>key==='troops'?(state?.troopTransportCapacity===null?'輸送の受入枠を確認できません。最新の保存を同期してからお試しください。':'受取後の兵数が、出陣中の兵を含めた保有上限を超えます。兵を派遣・輸出してからお試しください。')+(claim?'未受取の資産は全量保管されます。':''):'受取後の所持数が上限を超えます。資産を使用してから受け取ってください。'+(claim?'未受取の資産は保管されます。':'');
function publicEvaluation(value){
  if(!value||value.version!==1||!Number.isSafeInteger(value.score)||value.score<0||value.score>100000||value.maxScore!==100000||!Number.isSafeInteger(value.rankIndex)||value.rankIndex<0||value.rankIndex>=17||typeof value.rankId!=='string'||!value.rankId||value.rankId.length>64||typeof value.rankName!=='string'||!value.rankName.trim()||value.rankName.length>32)return null;
  return{version:1,score:value.score,maxScore:100000,rankIndex:value.rankIndex,rankId:value.rankId,rankName:value.rankName};
}
function person(value){
  const id=String(value?.playerId??value?.id??'');
  return PLAYER.test(id)&&typeof value?.name==='string'?{playerId:id,name:value.name.slice(0,80),clan:String(value.clan||'').slice(0,60),avatarVersion:typeof value.avatarVersion==='string'&&/^[a-f0-9]{64}$/.test(value.avatarVersion)?value.avatarVersion:null,evaluation:publicEvaluation(value.evaluation),appearance:global.SengokuPremiumRuntime?.cleanAppearance?.(value.appearance)||null}:null;
}
function cleanTrade(value){
  const sender=person(value?.sender),recipient=person(value?.recipient),offer=assets(value?.offer),want=assets(value?.want);
  if(!TRADE.test(String(value?.id||''))||!sender||!recipient||!nonempty(offer)||!want||!['pending','accepted','cancelled','rejected'].includes(value.status))return null;
  let delivery=null;
  if(value.delivery){const contents=assets(value.delivery.assets);if(!contents||!['proceeds','refund'].includes(value.delivery.kind)||!PLAYER.test(String(value.delivery.recipientPlayerId||'')))return null;delivery={kind:value.delivery.kind,recipientPlayerId:String(value.delivery.recipientPlayerId),assets:contents,claimedAt:value.delivery.claimedAt||null};}
  return{id:value.id,revision:Number(value.revision)||0,status:value.status,sender,recipient,offer,want,createdAt:String(value.createdAt||''),updatedAt:String(value.updatedAt||''),delivery,...Object.fromEntries(['canAccept','canReject','canCancel','canClaim'].map(key=>[key,value[key]===true]))};
}
function defaultAccess(){
  const sync=global.SengokuCloudSync?.getStatus?.(),bridge=global.SengokuBridge;
  const linked=sync?.linked===true,started=bridge?.hasStarted?.()!==false;
  return{writable:Boolean(linked&&sync.ready&&sync.writable&&started&&bridge?.canReceiveGifts?.()),message:!linked?'領主登録と端末同期をすると交易できます。':!started?'はじめに本拠を選んでください。':sync.message||'操作端末と共通時刻を確認しています。'};
}
function createController(options={}){
  const read=options.request||((route,value)=>global.SengokuSocial.tradeRequest(route,value));
  const mutate=options.mutate||((route,value)=>global.SengokuBridge.tradeRequest(route,value));
  const getUser=options.getUser||(()=>global.SengokuSocial?.getUser?.());
  const getAccess=options.getAccess||defaultAccess,getAssets=options.getAssets||(()=>global.SengokuBridge?.spendableAssets?.()||blankAssets()),getTroopTransportCapacity=options.getTroopTransportCapacity||(()=>global.SengokuBridge?.troopTransportCapacity?.());
  const notify=options.onChange||(()=>{}),uuid=options.uuid||(()=>global.crypto.randomUUID());
  const later=options.setTimeout||global.setTimeout.bind(global),cancel=options.clearTimeout||global.clearTimeout.bind(global),visible=options.isVisible||(()=>!global.document?.hidden);
  let storage=options.storage;try{if(!storage)storage=global.localStorage;}catch{}
  let epoch=0,viewEpoch=0,searchEpoch=0,disposed=false,timer=null,writePromise=null;
  const draftDefaults=()=>({offerAsset:'gold',offerAmount:'100',wantAsset:'rice',wantAmount:'100'});
  const s={ownerId:null,open:false,view:'incoming',trades:[],nextCursor:null,summary:{incomingPending:0,outgoingPending:0,claimable:0},rules:{maxAmount:MAX_AMOUNT,balanceLimit:BALANCE_LIMIT,maxPending:20},loaded:false,loading:false,loadingMore:false,searchBusy:false,sending:false,query:'',searchResults:[],target:null,draft:draftDefaults(),confirm:null,pending:null,error:'',status:'',change:'init'};
  const storageKey=owner=>STORE+encodeURIComponent(owner);
  function snapshot(){
    const balances=assets(getAssets(),BALANCE_LIMIT)||blankAssets(),access=getAccess()||{},capacity=getTroopTransportCapacity(),troopTransportCapacity=Number.isSafeInteger(capacity)&&capacity>=0?Math.min(capacity,TROOP_BALANCE_LIMIT):null;
    return clone({...s,balances,troopTransportCapacity,access:{writable:access.writable===true,message:String(access.message||'操作端末と共通時刻を確認してください。')}});
  }
  function emit(change='status'){if(disposed)return;s.change=change;notify(snapshot());}
  function validPending(record,owner){
    if(!record||record.ownerId!==owner||!REQUEST.test(String(record.data?.requestId||''))||!['propose','accept','reject','cancel','claim'].includes(record.action))return null;
    if(record.route==='/trades'){
      if(record.action!=='propose'||!PLAYER.test(String(record.data.targetPlayerId||''))||record.data.targetPlayerId===owner||!nonempty(assets(record.data.offer))||!assets(record.data.want))return null;
    }else if(!/^\/trades\/tr_[a-f0-9]{32}\/(?:accept|cancel|reject|claim)$/.test(record.route)||!record.route.endsWith('/'+record.action))return null;
    const cleaned=clone(record);
    cleaned.data=record.action==='propose'?{requestId:record.data.requestId,targetPlayerId:record.data.targetPlayerId,offer:assets(record.data.offer),want:assets(record.data.want)}:{requestId:record.data.requestId};
    return cleaned;
  }
  function storedPending(owner){try{return validPending(JSON.parse(storage?.getItem(storageKey(owner))||'null'),owner);}catch{return null;}}
  function persist(record){try{const raw=JSON.stringify(record);storage.setItem(storageKey(record.ownerId),raw);return storage.getItem(storageKey(record.ownerId))===raw;}catch{return false;}}
  function clearStored(record){try{const previous=storedPending(record.ownerId);if(previous?.data.requestId===record.data.requestId)storage.removeItem(storageKey(record.ownerId));}catch{}}
  function identity(){
    const raw=getUser()?.id,id=raw===undefined||raw===null?null:String(raw);
    if(id===s.ownerId)return id;
    epoch++;viewEpoch++;searchEpoch++;cancel(timer);timer=null;writePromise=null;
    Object.assign(s,{ownerId:id,view:'incoming',trades:[],nextCursor:null,summary:{incomingPending:0,outgoingPending:0,claimable:0},loaded:false,loading:false,loadingMore:false,searchBusy:false,sending:false,query:'',searchResults:[],target:null,draft:draftDefaults(),confirm:null,pending:id?storedPending(id):null,error:'',status:''});
    emit('identity');return id;
  }
  const current=(e,owner)=>!disposed&&epoch===e&&s.ownerId===owner&&String(getUser()?.id??'')===String(owner??'');
  function requireAccess({retry=false}={}){
    identity();if(!s.ownerId)throw Error('領主登録・ログイン後に交易を利用できます。');
    if(s.sending)throw Error('前の交易の結果を確認しています。');
    if(s.pending&&!retry)throw Error('先の交易の結果を確認してから、新しい操作を行ってください。');
    const access=getAccess();if(!access?.writable)throw Error(access?.message||'操作端末と保存・同期の状態を確認してください。');
  }
  function sufficient(value){const own=assets(getAssets(),BALANCE_LIMIT)||blankAssets();return Object.keys(ASSETS).every(key=>(own[key]??0)>=(value[key]??0));}
  async function request(route){
    const e=epoch,owner=s.ownerId,result=await read(route,{method:'GET'});
    if(!current(e,owner)){const error=Error('接続する領主が変わりました。');error.code='STALE_IDENTITY';throw error;}
    if(result?.ok===false)throw Error(result.error?.message||'交易を読み込めませんでした。');
    return result;
  }
  function schedule(){cancel(timer);timer=null;if(!disposed&&s.open&&s.ownerId&&visible())timer=later(()=>{timer=null;refresh();},15000);}
  function acceptSummary(result){
    for(const key of Object.keys(s.summary))if(Number.isSafeInteger(result.summary?.[key])&&result.summary[key]>=0)s.summary[key]=result.summary[key];
    for(const key of ['maxAmount','balanceLimit','maxPending'])if(Number.isSafeInteger(result.rules?.[key])&&result.rules[key]>0)s.rules[key]=Math.min(result.rules[key],key==='balanceLimit'?BALANCE_LIMIT:key==='maxAmount'?MAX_AMOUNT:1000);
  }
  async function loadList({more=false}={}){
    identity();if(!s.ownerId||!s.open||s.view==='compose'||s.loading||s.loadingMore||s.sending||s.confirm||more&&!s.nextCursor)return;
    const v=viewEpoch,box=s.view,cursor=more?s.nextCursor:null,wasLoaded=s.loaded;
    s.loading=!more;s.loadingMore=more;s.error='';emit();
    try{
      const result=await request('/trades?box='+box+'&limit=20'+(cursor?'&cursor='+encodeURIComponent(cursor):''));
      if(v!==viewEpoch||s.view!==box)return;
      if(!Array.isArray(result.trades))throw Error('交易一覧の応答を確認できませんでした。');
      const rows=result.trades.map(cleanTrade).filter(Boolean).filter(trade=>[trade.sender.playerId,trade.recipient.playerId].includes(s.ownerId));
      const merged=more?[...s.trades,...rows]:wasLoaded&&box!=='claimable'?[...rows,...s.trades.filter(old=>!rows.some(row=>row.id===old.id))]:rows;
      s.trades=[...new Map(merged.map(row=>[row.id,row])).values()];
      if(more||box==='claimable'||!wasLoaded||s.trades.length<=20)s.nextCursor=typeof result.nextCursor==='string'?result.nextCursor:null;
      s.loaded=true;acceptSummary(result);emit(more?'more':'list');
    }catch(error){if(v===viewEpoch&&error.code!=='STALE_IDENTITY'){s.error=error.message;emit();}}
    finally{if(v===viewEpoch){s.loading=s.loadingMore=false;emit();schedule();}}
  }
  async function openBox(box='incoming'){
    identity();s.open=true;if(s.sending){emit();return;}s.view=['incoming','outgoing','claimable','history'].includes(box)?box:'incoming';
    viewEpoch++;searchEpoch++;s.loading=s.loadingMore=s.searchBusy=false;s.trades=[];s.nextCursor=null;s.loaded=false;s.confirm=null;s.error='';s.status='';emit('navigation');await loadList();schedule();
  }
  async function openCompose({playerId,asset}={}){
    identity();s.open=true;if(s.sending){emit();return;}s.view='compose';viewEpoch++;searchEpoch++;s.loading=s.loadingMore=s.searchBusy=false;s.confirm=null;s.target=null;s.query='';s.searchResults=[];s.error='';s.status='';s.draft=asset==='troops'?{offerAsset:'troops',offerAmount:'100',wantAsset:'gold',wantAmount:'100'}:draftDefaults();emit('navigation');
    if(s.ownerId&&playerId)await selectRecipient(playerId);schedule();
  }
  function setQuery(value){s.query=String(value||'').slice(0,90);}
  function setDraft(key,value){if(!Object.hasOwn(s.draft,key)||s.confirm||s.sending)return;s.draft[key]=String(value).slice(0,24);s.error='';emit('draft');}
  async function selectRecipient(playerId){
    identity();const id=String(playerId||'');
    if(!s.ownerId||s.view!=='compose'||s.sending||s.confirm)return;
    if(!PLAYER.test(id)||id===s.ownerId){s.error='自分以外の領主の公開IDを選んでください。';emit();return;}
    const generation=++searchEpoch,v=viewEpoch;s.searchBusy=true;s.target=null;s.error='';emit();
    try{
      const result=await request('/trades/recipient?playerId='+encodeURIComponent(id));
      if(generation!==searchEpoch||v!==viewEpoch)return;
      const selected=person(result.player);if(!selected||selected.playerId!==id)throw Error('交易先の領主を確認できませんでした。');
      s.target=selected;s.searchResults=[];s.status='交易先を確認しました。提供する資産と希望する資産を入力してください。';emit('recipient');
    }catch(error){if(generation===searchEpoch&&v===viewEpoch&&error.code!=='STALE_IDENTITY'){s.error=error.message;emit();}}
    finally{if(generation===searchEpoch&&v===viewEpoch){s.searchBusy=false;emit();}}
  }
  async function searchRecipients(){
    identity();if(!s.ownerId||s.sending||s.confirm||s.view!=='compose')return;
    const query=s.query.trim();if(/^u_[A-Za-z0-9_-]+$/.test(query)){await selectRecipient(query);return;}
    if(query.length<2||query.length>24){s.error='領主名は2〜24文字、または公開IDを入力してください。';emit();return;}
    const generation=++searchEpoch,v=viewEpoch;s.searchBusy=true;s.error='';s.target=null;s.searchResults=[];emit();
    try{
      const result=await request('/players?q='+encodeURIComponent(query));if(generation!==searchEpoch||v!==viewEpoch)return;
      if(!Array.isArray(result.players))throw Error('領主の検索結果を確認できませんでした。');
      s.searchResults=result.players.map(person).filter(player=>player&&player.playerId!==s.ownerId);
      s.status=s.searchResults.length?'名前と公開IDを確認し、交易先を選んでください。':'該当する領主が見つかりませんでした。';emit('search');
    }catch(error){if(generation===searchEpoch&&v===viewEpoch&&error.code!=='STALE_IDENTITY'){s.error=error.message;emit();}}
    finally{if(generation===searchEpoch&&v===viewEpoch){s.searchBusy=false;emit();}}
  }
  function prepareCreate(){
    try{
      requireAccess();if(s.view!=='compose'||!s.target||s.target.playerId===s.ownerId)throw Error('交易先の領主を選んでください。');
      const offer=blankAssets(),want=blankAssets(),d=s.draft,amount=Number(d.offerAmount),price=Number(d.wantAmount);
      if(!Object.hasOwn(ASSETS,d.offerAsset)||!Number.isSafeInteger(amount)||amount<1||amount>s.rules.maxAmount)throw Error('提供する資産の数量は1〜'+num(s.rules.maxAmount)+'の整数です。');
      offer[d.offerAsset]=amount;
      if(d.wantAsset!=='none'){if(!Object.hasOwn(ASSETS,d.wantAsset)||!Number.isSafeInteger(price)||price<1||price>s.rules.maxAmount)throw Error('希望する資産の数量は1〜'+num(s.rules.maxAmount)+'の整数です。');want[d.wantAsset]=price;}
      if(!sufficient(offer))throw Error('提供する資産の所持数が不足しています。');
      s.confirm={ownerId:s.ownerId,action:'propose',route:'/trades',data:{requestId:uuid(),targetPlayerId:s.target.playerId,offer,want},target:clone(s.target),give:offer,receive:want};
      s.error='';s.status='';emit('confirm');
    }catch(error){s.error=error.message;emit();}
  }
  function actionAvailable(trade,action){
    if(action==='accept'||action==='reject')return trade.recipient.playerId===s.ownerId&&trade.status==='pending'&&trade[action==='accept'?'canAccept':'canReject'];
    if(action==='cancel')return trade.sender.playerId===s.ownerId&&trade.status==='pending'&&trade.canCancel;
    return action==='claim'&&trade.canClaim&&trade.delivery?.recipientPlayerId===s.ownerId&&!trade.delivery.claimedAt&&nonempty(trade.delivery.assets);
  }
  async function prepareAction(id,action){
    const v=viewEpoch;
    try{
      requireAccess();if(!TRADE.test(String(id))||!['accept','reject','cancel','claim'].includes(action))return;
      s.loading=true;s.error='';emit();
      const result=await request('/trades/'+id);if(v!==viewEpoch)return;const trade=cleanTrade(result.trade);
      if(!trade||trade.id!==id||!actionAvailable(trade,action))throw Error('この申出は更新されています。一覧を更新して現在の状態を確認してください。');
      requireAccess();
      const give=action==='accept'?trade.want:blankAssets(),receive=action==='accept'?trade.offer:action==='claim'?trade.delivery.assets:blankAssets();
      if(action==='accept'&&!sufficient(give))throw Error('相手に渡す資産の所持数が不足しています。');
      const state=snapshot(),overflow=overflowAsset(state,receive,give);
      if((action==='accept'||action==='claim')&&overflow)throw Error(overflowText(overflow,action==='claim',state));
      s.confirm={ownerId:s.ownerId,action,route:'/trades/'+id+'/'+action,data:{requestId:uuid()},trade,target:trade.sender.playerId===s.ownerId?trade.recipient:trade.sender,give,receive};s.status='';emit('confirm');
    }catch(error){if(v===viewEpoch&&error.code!=='STALE_IDENTITY'){s.error=error.message;emit();}}
    finally{if(v===viewEpoch){s.loading=false;emit();}}
  }
  function cancelConfirm(){if(s.sending)return;s.confirm=null;s.error='';emit('confirm-close');}
  function matchesResult(record,result){
    const trade=cleanTrade(result?.trade),receipt=result?.receipt;
    if(result?.ok===false||!trade||!receipt||String(receipt.playerId)!==record.ownerId||receipt.action!==record.action||receipt.tradeId!==trade.id)return false;
    // The bridge may recover an older request ID for the same terms after the
    // UI record was lost. Validate the actual operation instead of that ID.
    if(record.action!=='propose')return record.route==='/trades/'+trade.id+'/'+record.action;
    return trade.sender.playerId===record.ownerId&&trade.recipient.playerId===record.data.targetPlayerId&&Object.keys(ASSETS).every(key=>(trade.offer[key]??0)===(record.data.offer[key]??0)&&(trade.want[key]??0)===(record.data.want[key]??0));
  }
  function sendRecord(record){
    if(writePromise)return writePromise;
    const e=epoch,owner=s.ownerId;record=validPending(record,owner);if(!record)return Promise.resolve(false);
    try{requireAccess({retry:true});}catch(error){s.error=error.message;emit();return Promise.resolve(false);}
    if(!persist(record)){s.error='送信番号を端末に保存できません。空き容量とブラウザの保存設定を確認してください。この送信処理は行っていません。';emit();return Promise.resolve(false);}
    s.pending=clone(record);s.sending=true;s.error='';emit('sending');
    const promise=Promise.resolve().then(async()=>{
      try{
        if(!current(e,owner))return false;
        const result=await mutate(record.route,{method:'POST',data:clone(record.data)});
        if(!current(e,owner))return false;
        if(!matchesResult(record,result))throw Error('交易の結果を確認できませんでした。同じ送信番号で結果を確認してください。');
        clearStored(record);s.pending=null;s.confirm=null;s.error='';
        s.status=({propose:'申出を送り、提供資産を預けました。相手の承認をお待ちください。',accept:'交易が成立しました。輸入した資産を所持数へ反映しました。',cancel:'申出を取り消しました。返還資産は「受取待ち」から受け取ってください。',reject:'申出を辞退しました。相手への返還資産は受取待ちになっています。',claim:'資産を受け取り、所持数へ反映しました。'})[record.action];
        if(record.action==='propose'){s.view='outgoing';s.target=null;s.draft=draftDefaults();}else if(record.action==='cancel'||record.action==='claim')s.view='claimable';
        viewEpoch++;s.trades=[];s.loaded=false;s.nextCursor=null;emit('settled');if(!result.idempotent)global.SengokuBridge?.playInterfaceSound?.(record.action==='claim'?'reward':'trade');return true;
      }catch(error){
        if(!current(e,owner))return false;
        if(error.status>=400&&error.status<500&&error.code!=='TRADE_RECONCILE_PENDING'){clearStored(record);s.pending=null;s.confirm=null;}
        global.SengokuBridge?.playInterfaceSound?.('error');s.error=error.message||'通信が戻ってから、同じ送信番号で結果を確認してください。';emit('error');return false;
      }finally{if(current(e,owner)){s.sending=false;writePromise=null;emit();if(!s.pending)await loadList();schedule();}}
    });
    writePromise=promise;return promise;
  }
  function confirm(){
    identity();if(!s.confirm||s.confirm.ownerId!==s.ownerId||s.pending||s.sending)return Promise.resolve(false);
    return sendRecord({...clone(s.confirm),createdAt:new Date().toISOString()});
  }
  function retry(){identity();return s.pending?sendRecord(clone(s.pending)):Promise.resolve(false);}
  function close(){s.open=false;cancel(timer);timer=null;emit('close');}
  async function refresh(){identity();emit('access');if(s.open&&s.view!=='compose'&&!s.confirm&&!s.sending)await loadList();schedule();}
  function refreshIdentity(){identity();if(s.open)refresh();}
  function dispose(){disposed=true;epoch++;viewEpoch++;searchEpoch++;cancel(timer);timer=null;}
  return{getState:snapshot,openBox,openCompose,setQuery,setDraft,searchRecipients,selectRecipient,prepareCreate,prepareAction,cancelConfirm,confirm,retry,close,refresh,refreshIdentity,loadMore:()=>loadList({more:true}),dispose};
}

const LABELS={incoming:'届いた申出',outgoing:'送った申出',claimable:'受取待ち',history:'履歴'};
const ACTIONS={propose:'この条件で申出を送る',accept:'この条件で承認する',reject:'申出を辞退する',cancel:'申出を取り消す',claim:'資産を受け取る'};
const STATUS={pending:'承認待ち',accepted:'成立',cancelled:'取消済み',rejected:'辞退済み'};
const date=value=>{const time=new Date(value);return Number.isFinite(time.getTime())?time.toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'';};
const button=(label,action,extra='',primary=false)=>'<button type="button" class="trade-button'+(primary?' is-primary':'')+'" data-trade="'+action+'" '+extra+'>'+label+'</button>';
const disabled=value=>value?' disabled':'';
const peerMarkup=player=>'<strong class="player-evaluation-person">'+(player?.playerId?global.SengokuAvatar?.markup?.({id:player.playerId,name:player.name,avatarVersion:player.avatarVersion},'inline')||'':'')+(global.SengokuCityHonors?.slot?.(player?.playerId)||'')+'<span class="player-evaluation-name" data-premium-player="'+esc(player?.playerId||'')+'" data-premium-player-name="'+esc(player?.name||'交易先の領主')+'">'+(global.SengokuPremiumRuntime?.nameMarkup?.(player?.name||'交易先の領主',player?.appearance)||esc(player?.name||'交易先の領主'))+'</span>'+(global.SengokuEvaluationUI?.badge?.(player?.evaluation)||'')+(global.SengokuPublicCourt?.slot?.(player?.playerId)||'')+'</strong><code>'+esc(player?.playerId||'')+'</code>';
function tradeCard(trade,state){
  const sent=trade.sender.playerId===state.ownerId,peer=sent?trade.recipient:trade.sender;
  const blocked=!state.access.writable||state.sending||!!state.pending||state.loading,controls=[];
  const acceptOverflow=trade.canAccept&&!sent?overflowAsset(state,trade.offer,trade.want):null;
  const insufficient=trade.canAccept&&!sent&&Object.keys(ASSETS).some(key=>(state.balances[key]??0)<(trade.want[key]??0));
  if(trade.canAccept&&!sent)controls.push(button('条件を確認して承認','action','data-id="'+trade.id+'" data-kind="accept"'+disabled(blocked||acceptOverflow||insufficient),true));
  if(trade.canReject&&!sent)controls.push(button('辞退する','action','data-id="'+trade.id+'" data-kind="reject"'+disabled(blocked)));
  if(trade.canCancel&&sent)controls.push(button('申出を取り消す','action','data-id="'+trade.id+'" data-kind="cancel"'+disabled(blocked)));
  const delivery=trade.delivery?.recipientPlayerId===state.ownerId?trade.delivery:null;
  const overflow=delivery&&overflowAsset(state,delivery.assets);
  if(trade.canClaim&&delivery&&!delivery.claimedAt)controls.push(button('受け取る','action','data-id="'+trade.id+'" data-kind="claim"'+disabled(blocked||overflow),true));
  const deliveryHTML=delivery?'<div class="trade-delivery'+(!delivery.claimedAt?' is-unclaimed':'')+'"><strong>'+(delivery.kind==='refund'?'返還資産':'交易の対価')+' · '+(delivery.claimedAt?'受取済み':'受取待ち')+'</strong><span>'+esc(assetText(delivery.assets))+'</span>'+(!delivery.claimedAt?'<p>'+(overflow?overflowText(overflow,true,state):'「受け取る」で所持数に加わります。')+'</p>':'')+'</div>':'';
  const troopHTML=trade.offer.troops||trade.want.troops||delivery?.assets.troops?'<p class="trade-troop-capacity">'+esc(troopCapacityText(state))+'</p>':'';
  const acceptNote=insufficient?'相手に渡す資産の所持数が不足しています。':acceptOverflow?overflowText(acceptOverflow,false,state):'';
  return '<article class="trade-card" data-trade-row="'+trade.id+'" data-stable-key="trade-'+trade.id+'"><header><div class="trade-peer"><span class="trade-eyebrow">'+(sent?'輸出の申出先':'輸入の申出元')+'</span>'+peerMarkup(peer)+'</div><div class="trade-card-meta"><span class="trade-status is-'+trade.status+'">'+STATUS[trade.status]+'</span><time datetime="'+esc(trade.createdAt)+'">'+esc(date(trade.createdAt))+'</time></div></header><dl class="trade-terms"><div><dt>あなたが渡す'+(sent&&trade.status==='pending'?'（預り中）':'')+'</dt><dd>'+esc(assetText(sent?trade.offer:trade.want))+'</dd></div><div><dt>あなたが受け取る</dt><dd>'+esc(assetText(sent?trade.want:trade.offer))+'</dd></div></dl>'+troopHTML+deliveryHTML+(acceptNote?'<p class="trade-capacity-note">'+esc(acceptNote)+'</p>':'')+(controls.length?'<div class="trade-card-actions">'+controls.join('')+'</div>':'')+'</article>';
}
function confirmationMarkup(record){
  if(!record)return'';
  const give=record.give||blankAssets(),receive=record.receive||blankAssets();
  const note=({
    propose:'送ると、提供する資産を一時的に預けます。相手の承認後、対価を「受取待ち」から受け取れます。取消・辞退時も返還資産の受取操作が必要です。',
    accept:'承認すると、渡す資産が所持数から引かれ、輸入する資産が加わります。成立した交易は取り消せません。',
    reject:'この申出を辞退します。相手が預けた資産は、相手の受取待ちになります。',
    cancel:'この申出を取り消します。預けた資産は、この後「受取待ち」から受け取ってください。',
    claim:'保管されている資産・兵士を所持数へ加えます。兵士は拠点の空き容量に関係なく受け入れます。資産の所持上限や兵の保有上限を超える場合は、受取待ちのまま全量が保管されます。'
  })[record.action]||'内容を確認してください。';
  let terms='<dl class="trade-terms"><div><dt>今回あなたが渡す</dt><dd>'+esc(assetText(give))+'</dd></div><div><dt>'+(record.action==='propose'?'相手の承認後に受け取る':'今回あなたが受け取る')+'</dt><dd>'+esc(assetText(receive))+'</dd></div></dl>';
  if(record.action==='cancel'||record.action==='reject')terms='<dl class="trade-terms"><div><dt>申出の提供資産</dt><dd>'+esc(assetText(record.trade?.offer))+'</dd></div><div><dt>申出の希望資産</dt><dd>'+esc(assetText(record.trade?.want))+'</dd></div></dl>';
  return '<div class="trade-confirm-copy"><span class="trade-eyebrow">実行する内容の確認</span><h2 id="trade-confirm-title" tabindex="-1">'+({propose:'この条件で申出を送りますか？',accept:'この交易を承認しますか？',reject:'この申出を辞退しますか？',cancel:'この申出を取り消しますか？',claim:'この資産を受け取りますか？'})[record.action]+'</h2><p class="trade-peer">相手の領主'+peerMarkup(record.target)+'</p>'+terms+'<p class="trade-confirm-note">'+note+'</p></div><div class="trade-confirm-actions">'+button('戻って確認する','confirm-back')+button(ACTIONS[record.action],'confirm','',true)+'</div>';
}
function composeMarkup(state){
  const options=Object.entries(ASSETS).map(([key,label])=>'<option value="'+key+'">'+label+'</option>').join('');
  return '<section class="trade-compose"><div class="trade-section-heading"><h2>新しい交易の申出</h2><p>金銭・兵糧・木材・石材・勾玉に加え、兵士（輸出入）も交易できます。希望する資産を「なし」にすると、無償で提供できます。</p></div><form data-trade-form="search" class="trade-search"><label for="trade-recipient-query">相手の領主名、または公開ID</label><div><input id="trade-recipient-query" type="search" maxlength="90" autocomplete="off" spellcheck="false" placeholder="領主名で検索、または u_… を入力"><button type="submit" class="trade-button" data-trade-search>探す</button><button type="button" class="trade-button" data-trade="recipient-list" aria-label="交易先の領主一覧" aria-haspopup="dialog">一覧</button></div></form><div class="trade-search-results" data-trade-results></div><div class="trade-target" data-trade-target></div><form data-trade-form="compose"><div class="trade-asset-columns"><fieldset><legend>あなたが提供する資産</legend><label for="trade-offer-asset">資産</label><select id="trade-offer-asset" data-trade-draft="offerAsset">'+options+'</select><label for="trade-offer-amount">数量</label><input id="trade-offer-amount" data-trade-draft="offerAmount" type="number" inputmode="numeric" min="1" max="'+state.rules.maxAmount+'" step="1" required><p data-trade-available></p></fieldset><fieldset><legend>相手に希望する資産</legend><label for="trade-want-asset">資産</label><select id="trade-want-asset" data-trade-draft="wantAsset"><option value="none">なし（無償で提供）</option>'+options+'</select><label for="trade-want-amount">数量</label><input id="trade-want-amount" data-trade-draft="wantAmount" type="number" inputmode="numeric" min="1" max="'+state.rules.maxAmount+'" step="1" required><p>各資産1〜'+num(state.rules.maxAmount)+'。兵士の単位は人です。交換条件はあなたが決められます。</p></fieldset></div><p class="trade-troop-capacity" data-trade-troop-capacity hidden></p><p class="trade-compose-note">提供する資産・兵士は送信時に所持数から引かれ、一時預りになります。相手の承認後、対価を「受取待ち」から受領してください。兵士の輸入・返還は拠点の空き容量に関係なく受け入れ、本隊の兵数に加わります。保有上限を超える兵は受取待ちのまま保管されます。相手の承認前なら取り消せます。</p><button type="submit" class="trade-button is-primary" data-trade-prepare>申出を確認</button></form></section>';
}

let instance=null;
function ensureView(){
  if(instance)return instance;
  const doc=global.document;if(!doc?.body)return null;
  const dialog=doc.createElement('dialog');dialog.id='trade-modal';dialog.className='trade-dialog';dialog.setAttribute('aria-labelledby','trade-dialog-title');
  dialog.innerHTML='<header class="trade-header"><div class="trade-emblem" aria-hidden="true">交</div><div><p>領主どうしの資産交換・兵士の輸出入</p><h1 id="trade-dialog-title">交易の間</h1></div>'+button('更新','refresh','aria-label="交易一覧を更新"')+button('閉じる','close','aria-label="交易の間を閉じる"')+'</header><div class="trade-navigation"><nav class="trade-tabs" aria-label="交易の一覧" role="tablist">'+Object.entries(LABELS).map(([key,label])=>'<button type="button" role="tab" id="trade-tab-'+key+'" aria-controls="trade-content" aria-selected="false" data-trade="tab" data-box="'+key+'">'+label+'<span data-trade-count="'+key+'" hidden></span></button>').join('')+'</nav>'+button('新しい申出','new','',true)+button('空城へ兵を派遣','garrisons')+'</div><div class="trade-main"><div class="trade-feedback" data-trade-feedback role="status" aria-live="polite" hidden></div><div class="trade-access" data-trade-access hidden></div><div class="trade-pending" data-trade-pending hidden></div><div id="trade-content" data-trade-content></div><section class="trade-confirm" data-trade-confirm aria-labelledby="trade-confirm-title" hidden></section></div><footer class="trade-footer">資産は一時預り · 対価・返還資産は受取操作 · 日時は日本標準時（JST）</footer>';
  doc.body.append(dialog);
  const content=dialog.querySelector('[data-trade-content]'),feedback=dialog.querySelector('[data-trade-feedback]'),pending=dialog.querySelector('[data-trade-pending]'),access=dialog.querySelector('[data-trade-access]'),confirmHost=dialog.querySelector('[data-trade-confirm]'),main=dialog.querySelector('.trade-main');
  let controller,viewKey='',returnFocus=null,confirmFocus=null,lastConfirmation='',unsubscribe=null;
  const html=(node,value,key=viewKey)=>{if(global.SengokuStableDOM?.patch)global.SengokuStableDOM.patch(node,value,{key:['trade',key],preserveInputs:false});else if(node.innerHTML!==value)node.innerHTML=value;};
  function render(state){
    if(state.change==='identity'){viewKey='';lastConfirmation='';confirmFocus=null;html(content,'');html(confirmHost,'');html(pending,'');pending.hidden=confirmHost.hidden=true;feedback.textContent='';feedback.hidden=true;access.textContent='';access.hidden=true;for(const count of dialog.querySelectorAll('[data-trade-count]')){count.textContent='';count.hidden=true;}}
    if(!state.open){if(dialog.open)dialog.close();return;}
    if(!dialog.open){dialog.showModal();global.SengokuSocialViewport?.refresh?.();}
    const key=(state.ownerId||'guest')+':'+state.view,changed=key!==viewKey;
    const showingConfirm=Boolean(state.confirm),locked=state.sending||showingConfirm;
    for(const tab of dialog.querySelectorAll('[data-trade="tab"]')){const selected=tab.dataset.box===state.view;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;tab.disabled=locked;}
    if(state.view==='compose')dialog.querySelector('[data-trade="tab"]').tabIndex=0;
    for(const control of dialog.querySelectorAll('[data-trade="new"],[data-trade="refresh"],[data-trade="garrisons"]'))control.disabled=locked||state.loading||state.loadingMore;
    for(const [key,value] of Object.entries({incoming:state.summary.incomingPending,outgoing:state.summary.outgoingPending,claimable:state.summary.claimable,history:0})){const count=dialog.querySelector('[data-trade-count="'+key+'"]');count.textContent=value>99?'99+':String(value);count.hidden=!value;}
    const message=state.error||state.status;feedback.hidden=!message;feedback.classList.toggle('is-error',Boolean(state.error));feedback.setAttribute('role',state.error?'alert':'status');if(feedback.textContent!==message)feedback.textContent=message;
    access.hidden=!state.ownerId||state.access.writable;access.textContent=state.access.message;
    pending.hidden=!state.pending;
    if(state.pending){const record=state.pending,summary=record.action==='propose'?'提供 '+assetText(record.data.offer)+' ／ 希望 '+assetText(record.data.want):ACTIONS[record.action];html(pending,'<div><strong>'+(state.sending?'交易の結果を確認しています…':'通信結果が未確認の操作があります')+'</strong><p>'+(global.SengokuCityHonors?.slot?.(record.target?.playerId)||'')+esc(record.target?.name||'交易先')+(global.SengokuPublicCourt?.slot?.(record.target?.playerId)||'')+' · '+esc(summary)+'</p><p>新しい操作の前に、同じ送信番号で結果を確認してください。</p></div>'+button('結果を確認・再試行','retry',disabled(state.sending||!state.access.writable)),(state.ownerId||'guest')+':pending:'+record.data.requestId); }
    content.hidden=showingConfirm;
    if(state.view==='compose'){content.removeAttribute('role');content.removeAttribute('aria-labelledby');}else{content.setAttribute('role','tabpanel');content.setAttribute('aria-labelledby','trade-tab-'+state.view);}
    if(changed){viewKey=key;main.scrollTop=0;if(!state.ownerId)html(content,'<section class="trade-empty"><h2>領主登録をして交易を始める</h2><p>同じ世界の領主に資産の交換を申し出られます。領主登録と端末同期を済ませてください。</p>'+button('領主登録・ログインへ','register','',true)+'</section>');else if(state.view==='compose')html(content,composeMarkup(state));else html(content,'<section class="trade-section-heading"><h2>'+LABELS[state.view]+'</h2><p>'+({incoming:'相手が提示した交換条件を確認し、承認または辞退できます。',outgoing:'提供した資産は承認待ちの間、お預りしています。不要になった申出は取り消せます。',claimable:'成立した交易の対価と、取消・辞退された申出の返還資産を受け取れます。過去の申出も、未受取の資産だけを表示します。',history:'送った申出と届いた申出の履歴です。日時は日本標準時（JST）で表示します。'})[state.view]+'</p></section><div class="trade-list" data-trade-list></div><div class="trade-pagination" data-trade-pagination></div>');}
    if(state.ownerId&&state.view==='compose'){
      const query=content.querySelector('#trade-recipient-query');if(doc.activeElement!==query&&query.value!==state.query)query.value=state.query;
      query.disabled=locked||state.searchBusy;content.querySelector('[data-trade-search]').disabled=locked||state.searchBusy;content.querySelector('[data-trade="recipient-list"]').disabled=locked||state.searchBusy;
      html(content.querySelector('[data-trade-results]'),state.searchResults.map(player=>'<button type="button" class="trade-recipient" data-trade="recipient" data-player-id="'+esc(player.playerId)+'"'+disabled(locked||state.searchBusy)+'>'+peerMarkup(player)+(player.clan?'<span>'+esc(player.clan)+'</span>':'')+'</button>').join(''));
      html(content.querySelector('[data-trade-target]'),state.target?'<span class="trade-eyebrow">選択した交易先</span>'+peerMarkup(state.target):'<p>'+(state.searchBusy?'交易先を確認しています…':'交易先を検索して選んでください。')+'</p>');
      for(const input of content.querySelectorAll('[data-trade-draft]')){const field=input.dataset.tradeDraft;if(doc.activeElement!==input&&input.value!==state.draft[field])input.value=state.draft[field];input.disabled=locked||!!state.pending||field==='wantAmount'&&state.draft.wantAsset==='none';}
      content.querySelector('[data-trade-available]').textContent='現在の所持数：'+(ASSETS[state.draft.offerAsset]||'資産')+' '+num(state.balances[state.draft.offerAsset])+(state.draft.offerAsset==='troops'?'人':'');
      for(const side of ['offer','want'])content.querySelector('label[for="trade-'+side+'-amount"]').textContent=state.draft[side+'Asset']==='troops'?'人数（人）':'数量';
      const troopNote=content.querySelector('[data-trade-troop-capacity]');troopNote.hidden=state.draft.offerAsset!=='troops'&&state.draft.wantAsset!=='troops';troopNote.textContent=troopCapacityText(state);
      content.querySelector('[data-trade-prepare]').disabled=locked||state.searchBusy||!!state.pending||!state.target||!state.access.writable;
    }else if(state.ownerId){
      const list=content.querySelector('[data-trade-list]'),focused=doc.activeElement,focusId=focused?.dataset?.id,focusKind=focused?.dataset?.kind;
      html(list,state.trades.length?state.trades.map(trade=>tradeCard(trade,state)).join(''):'<section class="trade-empty"><h3>'+(!state.loaded?'交易を確認しています…':'申出はまだありません')+'</h3><p>'+(!state.loaded?'接続状態を確認して読み込んでいます。':'「新しい申出」から、相手の領主に交易を持ちかけられます。')+'</p></section>');
      if(focusId&&focusKind&&!doc.contains(focused))list.querySelector('[data-id="'+focusId+'"][data-kind="'+focusKind+'"]')?.focus({preventScroll:true});
      html(content.querySelector('[data-trade-pagination]'),state.nextCursor?button(state.loadingMore?'読み込み中…':'続きを表示','more',disabled(state.loading||state.loadingMore||state.sending||showingConfirm)):'');
    }
    confirmHost.hidden=!showingConfirm;
    if(showingConfirm){
      const fingerprint=state.confirm.data.requestId;
      if(lastConfirmation!==fingerprint){confirmFocus=doc.activeElement;html(confirmHost,confirmationMarkup(state.confirm),viewKey+':confirm:'+fingerprint);lastConfirmation=fingerprint;main.scrollTop=0;confirmHost.querySelector('h2')?.focus({preventScroll:true});}
      confirmHost.querySelector('[data-trade="confirm"]').disabled=state.sending||!!state.pending||!state.access.writable;
      confirmHost.querySelector('[data-trade="confirm"]').textContent=state.sending?'結果を確認しています…':ACTIONS[state.confirm.action];
      confirmHost.querySelector('[data-trade="confirm-back"]').disabled=state.sending;
    }else if(lastConfirmation){lastConfirmation='';html(confirmHost,'');if(confirmFocus?.isConnected&&!changed)confirmFocus.focus({preventScroll:true});confirmFocus=null;}
    if(changed&&!showingConfirm)content.querySelector('h2')?.setAttribute('tabindex','-1');
  }
  controller=createController({onChange:render});
  const run=promise=>Promise.resolve(promise).catch(()=>{});
  function open(action){
    const active=doc.activeElement;returnFocus=active?.closest?.('.social-dialog')?doc.querySelector('.social-launcher'):active;
    global.SengokuSocial?.close?.();global.SengokuLetters?.close?.();
    return action();
  }
  function openRecipientList(trigger){
    const owner=controller.getState().ownerId, social=global.SengokuSocial;
    const valid=()=>trigger.isConnected&&!trigger.disabled&&dialog.open&&social.getUser()?.id===owner;
    const rows=players=>(players||[]).map(person).filter(p=>p&&p.playerId!==owner)
      .map(p=>({value:p.playerId,label:p.name,detail:p.playerId}));
    global.SengokuInputList.open({
      trigger,title:'交易先の領主一覧',options:rows(social.getKnownPlayers()),valid,
      hint:'交流中・オンラインの領主を表示します。ほかの領主は名前を2文字以上、または公開IDで検索できます。',
      load:async(query,signal)=>{
        if(signal.aborted||!valid())return [];
        const text=query.trim(),length=Array.from(text).length;
        if(text&&(length<2||length>24&&!/^u_[A-Za-z0-9_]{1,88}$/.test(text)))return [];
        const players=text?(await social.tradeRequest('/players?q='+encodeURIComponent(text))).players:await social.getOnlineCandidates();
        return signal.aborted||!valid()?[]:rows(players);
      },
      onSelect:option=>{if(valid())run(controller.selectRecipient(option.value));}
    });
  }
  function click(event){
    const target=event.target.closest('[data-trade]');if(!target||target.disabled||!dialog.contains(target))return;
    const action=target.dataset.trade;
    if(action==='close')controller.close();
    else if(action==='tab')run(controller.openBox(target.dataset.box));
    else if(action==='new')run(controller.openCompose());
    else if(action==='garrisons'){controller.close();global.SengokuTroopGarrisons?.open?.();}
    else if(action==='refresh')run(controller.refresh());
    else if(action==='more')run(controller.loadMore());
    else if(action==='recipient-list')openRecipientList(target);
    else if(action==='recipient')run(controller.selectRecipient(target.dataset.playerId));
    else if(action==='action')run(controller.prepareAction(target.dataset.id,target.dataset.kind));
    else if(action==='confirm')run(controller.confirm());
    else if(action==='confirm-back')controller.cancelConfirm();
    else if(action==='retry')run(controller.retry());
    else if(action==='register'){controller.close();global.SengokuSocial?.open?.('profile');}
  }
  function input(event){const target=event.target;if(target.id==='trade-recipient-query')controller.setQuery(target.value);else if(target.dataset.tradeDraft)controller.setDraft(target.dataset.tradeDraft,target.value);}
  function submit(event){const form=event.target.closest('[data-trade-form]');if(!form)return;event.preventDefault();if(form.dataset.tradeForm==='search'){controller.setQuery(form.querySelector('input').value);run(controller.searchRecipients());}else controller.prepareCreate();}
  function keydown(event){
    if(event.target.matches('[role="tab"]')&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){
      const tabs=[...dialog.querySelectorAll('[role="tab"]')],position=tabs.indexOf(event.target),next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(position+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
      if(!tabs[next].disabled){event.preventDefault();tabs[next].focus();run(controller.openBox(tabs[next].dataset.box));}
    }
  }
  function onClose(){controller.close();if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});returnFocus=null;}
  function onCancel(event){if(controller.getState().confirm&&!controller.getState().sending){event.preventDefault();controller.cancelConfirm();}}
  function onVisibility(){if(!doc.hidden&&controller.getState().open)run(controller.refresh());}
  dialog.addEventListener('click',click);dialog.addEventListener('input',input);dialog.addEventListener('change',input);dialog.addEventListener('submit',submit);dialog.addEventListener('keydown',keydown);dialog.addEventListener('close',onClose);dialog.addEventListener('cancel',onCancel);
  doc.addEventListener('visibilitychange',onVisibility);
  unsubscribe=global.SengokuCloudSync?.subscribe?.(()=>{if(controller.getState().open)run(controller.refresh());});
  instance={controller,openBox:box=>open(()=>controller.openBox(box)),openCompose:target=>open(()=>controller.openCompose(target)),dispose(){unsubscribe?.();doc.removeEventListener('visibilitychange',onVisibility);controller.dispose();dialog.remove();instance=null;}};
  return instance;
}
const api={createController,cleanTrade,assetText,escape:esc,tradeCard,confirmationMarkup,openBox:box=>ensureView()?.openBox(box),openCompose:target=>ensureView()?.openCompose(target),openTroops:target=>ensureView()?.openCompose({...target,asset:'troops'}),close:()=>instance?.controller.close(),refreshIdentity:()=>instance?.controller.refreshIdentity(),getState:()=>instance?.controller.getState(),dispose:()=>instance?.dispose()};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
global.SengokuTrade=api;
})(typeof window!=='undefined'?window:globalThis);
