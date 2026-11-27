/* Operator-only account moderation. Destructive actions require reviewed terms. */
(function(global){
'use strict';
const ID=/^[A-Za-z0-9_-]{1,90}$/,STORE='sengoku-moderation-pending-v1:';
const clone=value=>JSON.parse(JSON.stringify(value));
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const number=value=>Math.max(0,Math.floor(Number(value)||0)).toLocaleString('ja-JP');
const validCount=value=>Number.isSafeInteger(value)&&value>=0;
const validName=value=>typeof value==='string'&&Array.from(value.trim()).length>=1&&Array.from(value.trim()).length<=24&&!/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value);
function player(value){const id=String(value?.id??value?.playerId??'');return ID.test(id)&&typeof value?.name==='string'?{id,name:value.name.slice(0,80),clan:String(value.clan||'').slice(0,60),isAdmin:value.isAdmin===true,isStaff:value.isStaff===true,isDeputy:value.isDeputy===true,banned:value.banned===true,avatarVersion:typeof value.avatarVersion==='string'&&/^[a-f0-9]{64}$/.test(value.avatarVersion)?value.avatarVersion:null,evaluation:global.SengokuEvaluationUI?.key?.(value.evaluation)?{version:value.evaluation.version,score:value.evaluation.score,maxScore:value.evaluation.maxScore,rankId:value.evaluation.rankId,rankName:value.evaluation.rankName,rankIndex:value.evaluation.rankIndex}:null,appearance:global.SengokuPremiumRuntime?.cleanAppearance?.(value.appearance)||null}:null;}
function ban(value){return value&&typeof value.active==='boolean'&&validCount(value.revision)?{active:value.active,revision:value.revision,reason:String(value.reason||'').slice(0,300),bannedAt:value.bannedAt||null,bannedBy:value.bannedBy||null,updatedAt:value.updatedAt||null}:null;}
function expulsion(value){if(!value||!validCount(value.revision)||typeof value.pending!=='boolean')return null;return{revision:value.revision,pending:value.pending,castleId:ID.test(String(value.castleId||''))?value.castleId:null,castleName:String(value.castleName||'').slice(0,100),role:['lord','retainer'].includes(value.role)?value.role:null,lordEpoch:validCount(value.lordEpoch)?value.lordEpoch:null,expelledAt:value.expelledAt||null,reason:String(value.reason||'').slice(0,300),blockedReason:String(value.blockedReason||'').slice(0,300)};}
function target(value){const who=player(value?.player),state=ban(value?.ban),counts=value?.counts,expelled=expulsion(value?.expulsion);if(!who||!state||!counts||!['chatMessages','letterMessages','pendingTrades'].every(key=>validCount(counts[key])))return null;return{player:who,ban:state,expulsion:expelled,counts:{chatMessages:counts.chatMessages,letterMessages:counts.letterMessages,pendingTrades:counts.pendingTrades},canBan:value.canBan===true,canUnban:value.canUnban===true,canExpel:value.canExpel===true&&!!expelled?.castleId&&!!expelled.role&&validCount(expelled.lordEpoch)&&!expelled.pending&&!who.isAdmin&&!who.isStaff&&!who.isDeputy,contentRevision:validCount(value.contentRevision)?value.contentRevision:null};}
const actionName=action=>action==='expel'?'拠点から追放':action==='ban'?'BANと投稿削除':'BAN解除';
const date=value=>{const when=new Date(value);return value&&Number.isFinite(when.getTime())?when.toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'—';};
function createController(options={}){
  const request=options.request||((route,options)=>global.SengokuSocial.moderationRequest(route,options));
  const getUser=options.getUser||(()=>global.SengokuSocial?.getUser?.());
  const getContext=options.getContext||(()=>global.SengokuSocial?.getModerationContext?.()||null);
  const uuid=options.uuid||(()=>global.crypto.randomUUID()),notify=options.onChange||(()=>{});
  let storage=options.storage;try{if(!storage)storage=global.localStorage;}catch{}
  let stamp='',epoch=0,viewEpoch=0,disposed=false,writePromise=null;
  const s={ownerId:null,authorized:false,open:false,view:'search',query:'',results:[],bans:[],nextCursor:null,target:null,reason:'',confirm:null,pending:null,loading:false,loadingMore:false,sending:false,loaded:false,error:'',status:'',change:'init'};
  const key=owner=>STORE+encodeURIComponent(owner);
  const context=()=>{const user=getUser(),more=getContext();return{ownerId:user?.id?String(user.id):null,allowed:(user?.isAdmin===true||user?.isDeputy===true)&&user.canOperate!==false&&user.isBanned!==true,stamp:JSON.stringify([user?.id||null,user?.isAdmin===true,user?.isDeputy===true,user?.canOperate,user?.isBanned===true,more?.epoch??null,more?.privilegeEpoch??null])};};
  const snapshot=()=>clone(s);
  function emit(change='status'){if(disposed)return;s.change=change;notify(snapshot());}
  function validRecord(value,owner){
    const data=value?.data,chosen=target(value?.target);
    if(value?.ownerId!==owner||!chosen||!ID.test(String(data?.requestId||''))||!ID.test(String(data?.targetPlayerId||''))||data.targetPlayerId===owner||data.targetPlayerId!==chosen.player.id||!['ban','unban','expel'].includes(data.action)||!validCount(data.expectedRevision)||typeof data.reason!=='string'||data.reason.length>300||chosen.player.isAdmin)return null;
    if(data.action==='expel'&&(!chosen.canExpel||data.expectedRevision!==chosen.expulsion.revision||data.expectedCastleId!==chosen.expulsion.castleId||data.expectedLordEpoch!==chosen.expulsion.lordEpoch))return null;
    if(Object.hasOwn(data,'name')&&(data.action!=='unban'||!validName(data.name)||data.name!==data.name.trim()))return null;
    return{ownerId:owner,target:chosen,data:{targetPlayerId:data.targetPlayerId,action:data.action,reason:data.reason,requestId:data.requestId,expectedRevision:data.expectedRevision,...(data.action==='expel'?{expectedCastleId:data.expectedCastleId,expectedLordEpoch:data.expectedLordEpoch}:{}),...(Object.hasOwn(data,'name')?{name:data.name}:{})},createdAt:String(value.createdAt||'')};
  }
  function readPending(owner){try{return validRecord(JSON.parse(storage.getItem(key(owner))||'null'),owner);}catch{return null;}}
  function persist(record){try{const value=JSON.stringify(record);storage.setItem(key(record.ownerId),value);return storage.getItem(key(record.ownerId))===value;}catch{return false;}}
  function clearPending(record){try{if(readPending(record.ownerId)?.data.requestId===record.data.requestId)storage.removeItem(key(record.ownerId));}catch{}}
  function identity(){
    const c=context();if(c.stamp===stamp)return c;
    stamp=c.stamp;epoch++;viewEpoch++;writePromise=null;
    Object.assign(s,{ownerId:c.ownerId,authorized:c.allowed,open:s.open&&c.allowed,view:'search',query:'',results:[],bans:[],nextCursor:null,target:null,reason:'',confirm:null,pending:c.allowed?readPending(c.ownerId):null,loading:false,loadingMore:false,sending:false,loaded:false,error:'',status:''});
    emit('identity');return c;
  }
  const current=(e,owner)=>!disposed&&epoch===e&&s.ownerId===owner&&context().stamp===stamp&&context().allowed;
  function requireAdmin({retry=false}={}){identity();if(!s.authorized)throw Error('この操作には運営権限が必要です。');if(s.sending)throw Error('前の操作の結果を確認しています。');if(s.pending&&!retry)throw Error('先の操作の結果を確認してから、次の操作を行ってください。');}
  async function call(route,options={method:'GET'}){
    const e=epoch,owner=s.ownerId;if(!current(e,owner))throw Error('運営権限を確認してください。');
    const result=await request(route,options);if(!current(e,owner)){const error=Error('領主または運営権限が変わりました。');error.code='STALE_IDENTITY';throw error;}return result;
  }
  async function open(view='search'){
    identity();if(!s.authorized)return false;s.open=true;if(s.sending){emit();return true;}viewEpoch++;s.view=view==='bans'?'bans':'search';s.confirm=null;s.target=null;s.results=[];s.bans=[];s.nextCursor=null;s.loading=s.loadingMore=false;s.loaded=false;s.error='';s.status='';emit('navigation');if(s.view==='bans')await loadBans();return true;
  }
  function close(){s.open=false;emit('close');}
  function setQuery(value){if(s.confirm||s.sending)return;s.query=String(value||'').slice(0,90);}
  function setReason(value){if(s.confirm||s.sending||s.pending)return;s.reason=String(value||'').slice(0,300);}
  function setRestoreName(value){if(s.confirm?.data.action!=='unban'||s.confirm.target.expulsion?.pending||s.sending||s.pending)return;s.confirm.data.name=String(value??'');}
  async function search(){
    identity();if(!s.authorized||s.sending||s.confirm)return;const query=s.query.trim();
    if(query.length<2||query.length>90){s.error='領主名を2文字以上、または完全な公開IDを入力してください。';emit();return;}
    const e=epoch,v=++viewEpoch;s.loading=true;s.results=[];s.target=null;s.error='';emit();
    try{const result=await call('/admin/moderation/players?q='+encodeURIComponent(query));if(e!==epoch||v!==viewEpoch)return;if(!Array.isArray(result.players))throw Error('検索結果を確認できませんでした。');s.results=result.players.map(player).filter(Boolean);s.status=s.results.length?'対象の名前と公開IDを確認し、詳細を開いてください。':'該当する領主はいません。';emit('results');}
    catch(error){if(e===epoch&&v===viewEpoch&&error.code!=='STALE_IDENTITY'){s.error=error.message;emit();}}
    finally{if(e===epoch&&v===viewEpoch){s.loading=false;emit();}}
  }
  function openCandidates(trigger){
    identity();
    const owner=s.ownerId,e=epoch,view=viewEpoch;
    const valid=()=>current(e,owner)&&view===viewEpoch&&s.open&&s.view==='search'&&!s.loading&&!s.sending&&!s.confirm;
    if(!valid()||!global.SengokuInputList)return;
    function choices(people){
      const unique=new Map();
      for(const person of people){
        if(person?.id!==owner&&ID.test(String(person?.id||''))&&typeof person.name==='string'&&person.name)
          unique.set(person.id,{value:person.id,label:person.name,detail:person.id});
      }
      return [...unique.values()];
    }
    return global.SengokuInputList.open({trigger,title:'管理する領主の一覧',
      hint:'交流で確認した領主と接続中の領主を表示します。ほかの領主は名前を2文字以上、または公開IDで検索できます。',
      options:choices([...(global.SengokuSocial?.getKnownPlayers?.()||[]),...s.results]),valid,
      async load(value,signal){
        const query=value.trim();
        if(!valid()||signal?.aborted||query.length===1||query.length>90)return [];
        const people=query?(await call('/admin/moderation/players?q='+encodeURIComponent(query))).players
          :await global.SengokuSocial?.getOnlineCandidates?.();
        return valid()&&!signal?.aborted&&Array.isArray(people)?choices(people):[];
      },
      onSelect(option){if(valid()){setQuery(option.value);return select(option.value);}}
    });
  }
  async function loadBans({more=false}={}){
    identity();if(!s.authorized||!s.open||s.view!=='bans'||s.sending||s.confirm||s.loading||s.loadingMore||more&&!s.nextCursor)return;
    const e=epoch,v=viewEpoch,cursor=more?s.nextCursor:null;s.loading=!more;s.loadingMore=more;s.error='';emit();
    try{const result=await call('/admin/moderation/bans?limit=20'+(cursor?'&cursor='+encodeURIComponent(cursor):''));if(e!==epoch||v!==viewEpoch)return;if(!Array.isArray(result.bans))throw Error('BAN中の一覧を確認できませんでした。');const rows=result.bans.map(row=>({player:player(row.player),ban:ban(row.ban)})).filter(row=>row.player&&row.ban&&row.ban.active);s.bans=[...new Map((more?[...s.bans,...rows]:rows).map(row=>[row.player.id,row])).values()];s.nextCursor=typeof result.nextCursor==='string'?result.nextCursor:null;s.loaded=true;emit('list');}
    catch(error){if(e===epoch&&v===viewEpoch&&error.code!=='STALE_IDENTITY'){s.error=error.message;emit();}}
    finally{if(e===epoch&&v===viewEpoch){s.loading=s.loadingMore=false;emit();}}
  }
  async function select(id){
    identity();if(!s.authorized||s.sending||s.confirm||!ID.test(String(id||'')))return;
    const e=epoch,v=++viewEpoch;s.loading=true;s.target=null;s.reason='';s.error='';emit();
    try{const result=target(await call('/admin/moderation/target?playerId='+encodeURIComponent(id)));if(e!==epoch||v!==viewEpoch)return;if(!result||result.player.id!==id)throw Error('対象の領主を確認できませんでした。');s.target=result;s.status='';emit('target');}
    catch(error){if(e===epoch&&v===viewEpoch&&error.code!=='STALE_IDENTITY'){s.error=error.message;emit();}}
    finally{if(e===epoch&&v===viewEpoch){s.loading=false;emit();}}
  }
  async function prepare(action){
    const e=epoch,v=viewEpoch;
    try{
      requireAdmin();if(!s.target||!['ban','unban','expel'].includes(action))return;s.loading=true;s.error='';emit();
      const checked=target(await call('/admin/moderation/target?playerId='+encodeURIComponent(s.target.player.id)));if(e!==epoch||v!==viewEpoch)return;requireAdmin();
      if(checked)s.target=checked;
      if(!checked||checked.player.id===s.ownerId||checked.player.isAdmin||!checked[action==='ban'?'canBan':action==='expel'?'canExpel':'canUnban'])throw Error('この領主に対して、その操作は現在実行できません。対象の状態を確認してください。');
      s.target=checked;s.confirm={ownerId:s.ownerId,target:clone(checked),data:{targetPlayerId:checked.player.id,action,reason:s.reason.trim(),requestId:uuid(),expectedRevision:action==='expel'?checked.expulsion.revision:checked.ban.revision,...(action==='expel'?{expectedCastleId:checked.expulsion.castleId,expectedLordEpoch:checked.expulsion.lordEpoch}:{}),...(action==='unban'&&!checked.expulsion?.pending?{name:checked.player.name}:{})},createdAt:new Date().toISOString()};s.status='';emit('confirm');
    }catch(error){if(e===epoch&&v===viewEpoch&&error.code!=='STALE_IDENTITY'){s.error=error.message;emit();}}
    finally{if(e===epoch&&v===viewEpoch){s.loading=false;emit();}}
  }
  function cancelConfirm(){if(!s.sending){s.confirm=null;s.error='';emit('confirm-close');}}
  function matches(record,result){const receipt=result?.receipt,chosen=target(result);return result?.ok!==false&&chosen?.player.id===record.data.targetPlayerId&&receipt&&receipt.requestId===record.data.requestId&&receipt.actorPlayerId===record.ownerId&&receipt.targetPlayerId===record.data.targetPlayerId&&receipt.action===record.data.action&&(record.data.action==='expel'?receipt.castleId===record.data.expectedCastleId&&typeof receipt.released==='boolean':validCount(receipt.deleted?.chatMessages)&&validCount(receipt.deleted?.letterMessages)&&validCount(receipt.cancelledTrades));}
  function send(record){
    if(writePromise)return writePromise;
    try{requireAdmin({retry:true});}catch(error){s.error=error.message;emit();return Promise.resolve(false);}
    record=validRecord(record,s.ownerId);if(!record)return Promise.resolve(false);
    if(!persist(record)){s.error='送信番号を端末に保存できません。この操作は送信していません。ブラウザの保存設定を確認してください。';emit();return Promise.resolve(false);}
    const e=epoch,owner=s.ownerId;s.pending=clone(record);s.sending=true;s.error='';emit('sending');
    writePromise=Promise.resolve().then(async()=>{
      try{
        if(!current(e,owner))return false;
        const data=clone(record.data);if(data.action==='expel')delete data.action;
        const result=await call(record.data.action==='expel'?'/admin/moderation/expel':'/admin/moderation',{method:'POST',data});if(!current(e,owner))return false;
        if(!matches(record,result))throw Error('操作の結果を確認できませんでした。同じ送信番号で結果を確認してください。');
        clearPending(record);s.pending=null;s.confirm=null;s.target=null;s.reason='';s.error='';
        if(record.data.action==='expel'){
          s.status='追放の完了を確認しました。'+(result.receipt.castleName||record.target.expulsion.castleName||record.data.expectedCastleId)+(result.receipt.released?'の領主枠を空け、他のプレイヤーが選べるようになりました。':'から対象の家臣を除籍しました。現在の領主と他の家臣はそのままです。')+' 対象の領主は拠点を選び直せます。';
          if(result.ban.active)s.status+=' 既存のBANは継続しています。';
          s.view='search';s.results=[];
        }else{
          const deleted=result.receipt.deleted;s.status=record.data.action==='ban'?'BAN処理の完了を確認しました。チャット '+number(deleted.chatMessages)+'件・書状 '+number(deleted.letterMessages)+'件を削除し、交易 '+number(result.receipt.cancelledTrades)+'件を取り消しました。':'BAN解除の完了を確認しました。削除済みの本文は復元されません。';
          s.status+=' 現在の状態：'+(result.ban.active?'BAN中です。':'同じ領主で利用を再開できます。');s.view='bans';
        }
        s.bans=[];s.nextCursor=null;s.loaded=false;viewEpoch++;emit('settled');return true;
      }catch(error){
        if(!current(e,owner)||error.code==='STALE_IDENTITY')return false;
        if(error.status>=400&&error.status<500){clearPending(record);s.pending=null;s.confirm=error.code==='NAME_TAKEN'&&record.data.action==='unban'?{...clone(record),data:{...record.data,requestId:uuid()}}:null;}
        s.error=error.message||'通信結果が不明です。同じ送信番号で結果を確認してください。';emit('error');return false;
      }finally{if(current(e,owner)){s.sending=false;writePromise=null;emit();if(!s.pending&&s.view==='bans')await loadBans();}}
    });return writePromise;
  }
  function confirm(){identity();if(!s.confirm||s.pending||s.sending)return Promise.resolve(false);if(Object.hasOwn(s.confirm.data,'name')){if(!validName(s.confirm.data.name)){s.error='復帰後の領主名は1〜24文字で入力してください。異体字の指定・結合文字も文字数に含まれます。';emit();return Promise.resolve(false);}s.confirm.data.name=s.confirm.data.name.trim();}return send(clone(s.confirm));}
  function retry(){identity();return s.pending?send(clone(s.pending)):Promise.resolve(false);}
  function refreshIdentity(){identity();}
  function dispose(){disposed=true;epoch++;viewEpoch++;Object.assign(s,{results:[],bans:[],target:null,confirm:null,pending:null,open:false});}
  return{getState(){identity();return snapshot();},open,close,setQuery,setReason,setRestoreName,search,openCandidates,select,prepare,cancelConfirm,confirm,retry,loadBans,loadMore:()=>loadBans({more:true}),refreshIdentity,dispose};
}
const who=value=>'<strong class="player-evaluation-person">'+(global.SengokuAvatar?.markup?.(value,'inline')||'')+(global.SengokuCityHonors?.slot?.(value.id)||'')+'<span class="player-evaluation-name" data-premium-player="'+esc(value.id)+'" data-premium-player-name="'+esc(value.name)+'">'+(global.SengokuPremiumRuntime?.nameMarkup?.(value.name,value.appearance)||esc(value.name))+'</span>'+(global.SengokuEvaluationUI?.badge?.(value.evaluation)||'')+(global.SengokuPublicCourt?.slot?.(value.id)||'')+'</strong><code>'+esc(value.id)+'</code>';
function targetMarkup(value){
  const p=value.player,b=value.ban,counts=value.counts,ex=value.expulsion;
  const residence=ex?'<section class="moderation-residence"><span class="moderation-eyebrow">現在の拠点・所属</span><strong>'+esc(ex.castleName||'所属する通常拠点なし')+(ex.role?' · '+(ex.role==='lord'?'領主':'家臣'):'')+'</strong>'+(ex.pending?'<p>追放済み・再入城待ちです。</p>':ex.blockedReason?'<p>'+esc(ex.blockedReason)+'</p>':ex.role?'<p>'+(ex.role==='lord'?'追放すると領主枠が空き、他のプレイヤーがこの城を選べます。':'追放すると対象の家臣だけが除籍されます。領主枠は変わりません。')+'</p>':'')+'</section>':'';
  return '<header><span class="moderation-eyebrow">操作する領主</span>'+who(p)+'<span class="moderation-status">'+(b.active?'BAN中':p.isAdmin?'運営・操作対象外':ex?.pending?'再入城待ち':'利用中')+'</span></header>'+residence+'<dl class="moderation-counts"><div><dt>チャットの本文</dt><dd>'+number(counts.chatMessages)+'件</dd></div><div><dt>書状の本文</dt><dd>'+number(counts.letterMessages)+'件</dd></div><div><dt>未成立の交易</dt><dd>'+number(counts.pendingTrades)+'件</dd></div></dl>'+(b.active?'<p class="moderation-note">BAN日時：'+esc(date(b.bannedAt))+' JST'+(b.reason?'<br>理由：'+esc(b.reason):'')+'</p>':'');
}
function confirmationMarkup(record){
  const banning=record.data.action==='ban',expelling=record.data.action==='expel',p=record.target.player,c=record.target.counts,ex=record.target.expulsion;
  const title=expelling?'この領主を拠点から追放しますか？':banning?'この領主をBANして投稿を削除しますか？':'この領主のBANを解除しますか？';
  const effect=expelling?'<section class="moderation-residence"><span class="moderation-eyebrow">追放する拠点</span><strong>'+esc(ex?.castleName||record.data.expectedCastleId)+' · '+(ex?.role==='lord'?'領主':'家臣')+'</strong></section><p class="moderation-warning"><strong>'+(ex?.role==='lord'?'領主枠を空け、他のプレイヤーがこの城を選べるようにします。':'この家臣を拠点から除籍します。')+'</strong>'+(ex?.role==='lord'?'所属する他の家臣は残り、今回の追放では自動繰上げしません。':'現在の領主と他の家臣はそのままです。')+'対象は拠点の選び直しになり、以前の保存からこの所属を復元することはできません。</p><p class="moderation-note">アカウント・チャット・書状は保持され、利用停止にはなりません。再入城時は本拠移転と同じく、資産は現在残高と開始時の額の少ない方になり、施設・研究・戦役は初期化されます。武将の所持・育成と購入済み特典は引き継ぎます。</p>':banning?'<dl class="moderation-counts"><div><dt>チャット本文を削除</dt><dd>'+number(c.chatMessages)+'件</dd></div><div><dt>書状本文を削除</dt><dd>'+number(c.letterMessages)+'件</dd></div><div><dt>未成立の交易を取消</dt><dd>'+number(c.pendingTrades)+'件</dd></div></dl><p class="moderation-warning"><strong>本文の削除は取り消せません。</strong>対象本人が送った世界・同盟・フレンド・運営チャットと書状の本文を削除し、利用を停止します。ほかの人が送った本文は保持されます。BANを解除しても削除済みの本文は戻りません。</p><p class="moderation-note">件数は確認時点の値です。実行までに増えた対象の投稿も削除されます。未成立の交易は取り消され、預り資産は返還待ちになります。</p>':'<p class="moderation-warning"><strong>同じ公開IDの領主が利用を再開できます。</strong>BAN時に削除したチャット・書状の本文は復元されません。</p>';
  const nameEffect=banning||expelling?'<p class="moderation-note">これまでの領主名は他のプレイヤーが使えるようになります。処分履歴と公開IDは残り、同じ名前を使う別のプレイヤーへ進行・購入済み特典・権限が移ることはありません。</p>':ex?.pending?'<p class="moderation-note">追放後の再入城待ちのため、名前は確保しません。本人が再入城する際に、空いている領主名を選びます。</p>':'<div class="moderation-section"><label for="moderation-restore-name">復帰後の領主名（1〜24文字）</label><input id="moderation-restore-name" type="text" autocomplete="nickname" minlength="1" aria-describedby="moderation-restore-name-help" value="'+esc(record.data.name??p.name)+'" required><p id="moderation-restore-name-help" class="moderation-note">以前の名前が他のプレイヤーに使われている場合は、新しい名前を入力してください。異体字の指定・結合文字も文字数に含まれます。公開ID・進行・購入済み特典は元の領主のままです。</p></div>';
  return '<span class="moderation-eyebrow">実行する内容の確認</span><h2 id="moderation-confirm-title" tabindex="-1">'+title+'</h2><div class="moderation-person">'+who(p)+'</div>'+effect+nameEffect+(record.data.reason?'<p class="moderation-note">記録する理由：'+esc(record.data.reason)+'</p>':'')+'<div class="moderation-actions"><button type="button" class="moderation-button" data-moderation="back">戻って確認する</button><button type="button" class="moderation-button '+(expelling?'is-expel':banning?'is-danger':'is-primary')+'" data-moderation="confirm">'+(expelling?'この拠点から追放する':banning?'BANして投稿を削除':'BANを解除する')+'</button></div>';
}
let instance=null;
function ensure(){
  if(instance)return instance;const operator=global.SengokuSocial?.getUser?.();if(!global.document?.body||!(operator?.isAdmin===true||operator?.isDeputy===true)||operator.canOperate===false||operator.isBanned===true)return null;
  const doc=global.document,dialog=doc.createElement('dialog');dialog.id='moderation-modal';dialog.className='moderation-dialog';dialog.setAttribute('aria-labelledby','moderation-title');
  dialog.innerHTML='<header class="moderation-header"><div><span class="moderation-eyebrow">運営専用</span><h1 id="moderation-title">プレイヤー管理</h1></div><button type="button" class="moderation-button" data-moderation="close">閉じる</button></header><nav class="moderation-tabs" aria-label="管理画面"><button type="button" data-moderation="search-tab">領主を探す</button><button type="button" data-moderation="bans-tab">BAN中の一覧・解除</button></nav><div class="moderation-main"><p class="moderation-feedback" data-moderation-feedback role="status" aria-live="polite" hidden></p><div class="moderation-pending" data-moderation-pending hidden></div><div data-moderation-content></div><section class="moderation-confirm" data-moderation-confirm aria-labelledby="moderation-confirm-title" hidden></section></div><footer class="moderation-footer">運営本人だけが利用できます · 日時は日本標準時（JST）</footer>';
  doc.body.append(dialog);const $=selector=>dialog.querySelector(selector),content=$('[data-moderation-content]'),confirmHost=$('[data-moderation-confirm]');let controller,viewKey='',confirmKey='',returnFocus=null,confirmationFocus=null;
  const html=(node,value)=>{if(node.innerHTML!==value)node.innerHTML=value;};
  function render(s){
    if(!s.authorized||s.change==='identity'){viewKey=confirmKey='';html(content,'');html(confirmHost,'');html($('[data-moderation-pending]'),'');$('[data-moderation-feedback]').textContent='';}
    if(!s.open||!s.authorized){if(dialog.open)dialog.close();return;}
    if(!dialog.open){dialog.showModal();global.SengokuSocialViewport?.refresh?.();}
    const locked=s.sending||!!s.confirm,key=s.ownerId+':'+s.view;
    for(const tab of dialog.querySelectorAll('.moderation-tabs button')){tab.disabled=locked;tab.setAttribute('aria-pressed',String((tab.dataset.moderation==='bans-tab')===(s.view==='bans')));}
    const feedback=$('[data-moderation-feedback]'),message=s.error||s.status;feedback.hidden=!message;feedback.classList.toggle('is-error',!!s.error);feedback.setAttribute('role',s.error?'alert':'status');if(feedback.textContent!==message)feedback.textContent=message;
    const pending=$('[data-moderation-pending]');pending.hidden=!s.pending;if(s.pending)html(pending,'<div><strong>'+(s.sending?'操作の結果を確認しています…':'通信結果が未確認です')+'</strong><p>'+who(s.pending.target.player)+' · '+actionName(s.pending.data.action)+'</p><p>同じ送信番号で、すでに完了しているかを確認します。</p></div><button type="button" class="moderation-button" data-moderation="retry"'+(s.sending?' disabled':'')+'>結果を確認・再試行</button>');
    content.hidden=!!s.confirm;confirmHost.hidden=!s.confirm;
    if(viewKey!==key){viewKey=key;html(content,s.view==='search'?'<section class="moderation-section"><h2>対象の領主を探す</h2><p>領主名または完全な公開IDで検索してください。対象を選ぶと、所属拠点・追放の可否・BAN状態と削除対象の件数を確認できます。</p><form data-moderation-form><label for="moderation-query">領主名・公開ID</label><div class="moderation-search"><input id="moderation-query" type="search" maxlength="90" autocomplete="off" spellcheck="false" placeholder="領主名、または u_…"><button type="button" class="moderation-button" data-moderation="candidates" aria-label="管理する領主の一覧">一覧</button><button type="submit" class="moderation-button">検索する</button></div></form><div class="moderation-results" data-moderation-results></div></section>':'<section class="moderation-section"><div class="moderation-section-heading"><h2>BAN中の領主</h2><button type="button" class="moderation-button" data-moderation="refresh">更新</button></div><p>領主の詳細を開いてBANを解除できます。削除済みの本文は復元されません。</p><div class="moderation-results" data-moderation-results></div><div class="moderation-more" data-moderation-more></div></section>');content.insertAdjacentHTML('beforeend','<section class="moderation-target" data-moderation-target hidden></section>');}
    const results=$('[data-moderation-results]');
    if(s.view==='search'){
      const input=$('#moderation-query');if(doc.activeElement!==input&&input.value!==s.query)input.value=s.query;input.disabled=s.loading||locked;for(const button of dialog.querySelectorAll('[data-moderation-form] button'))button.disabled=s.loading||locked;
      html(results,s.results.map(p=>'<button type="button" class="moderation-player" data-moderation="target" data-id="'+esc(p.id)+'"'+(s.loading||locked?' disabled':'')+'>'+who(p)+'<span>'+(p.banned?'BAN中':p.isAdmin?'運営':'利用中')+' · 詳細を確認</span></button>').join(''));
    }else{
      $('[data-moderation="refresh"]').disabled=s.loading||s.loadingMore||locked;
      html(results,s.bans.length?s.bans.map(row=>'<button type="button" class="moderation-player" data-moderation="target" data-id="'+esc(row.player.id)+'"'+(s.loading||locked?' disabled':'')+'>'+who(row.player)+'<span>BAN：'+esc(date(row.ban.bannedAt))+' JST</span>'+(row.ban.reason?'<span>'+esc(row.ban.reason)+'</span>':'')+'<b>詳細・解除を確認</b></button>').join(''):'<p class="moderation-empty">'+(s.loaded?'BAN中の領主はいません。':'一覧を確認しています…')+'</p>');
      html($('[data-moderation-more]'),s.nextCursor?'<button type="button" class="moderation-button" data-moderation="more"'+(s.loading||s.loadingMore||locked?' disabled':'')+'>'+(s.loadingMore?'読み込み中…':'続きを表示')+'</button>':'');
    }
    const targetNode=$('[data-moderation-target]');targetNode.hidden=!s.target;
    if(s.target){
      const chosen=s.target,targetKey=chosen.player.id+':'+chosen.ban.revision+':'+JSON.stringify([chosen.counts,chosen.expulsion,chosen.canExpel,chosen.canBan,chosen.canUnban]);
      if(targetNode.dataset.targetKey!==targetKey){targetNode.dataset.targetKey=targetKey;html(targetNode,targetMarkup(chosen)+(chosen.canBan||chosen.canUnban||chosen.canExpel?'<label for="moderation-reason">記録する理由（任意・300文字まで）</label><textarea id="moderation-reason" maxlength="300" rows="3" placeholder="判断の理由を記録できます"></textarea><div class="moderation-actions">'+(chosen.canExpel?'<button type="button" class="moderation-button is-expel" data-moderation="prepare-expel">追放の内容を確認</button>':'')+(chosen.canBan?'<button type="button" class="moderation-button is-danger" data-moderation="prepare-ban">BANと削除の内容を確認</button>':'')+(chosen.canUnban?'<button type="button" class="moderation-button is-primary" data-moderation="prepare-unban">解除の内容を確認</button>':'')+'</div>':'<p class="moderation-note">運営本人や操作できない対象のため、管理操作はできません。</p>'));}
      const reason=$('#moderation-reason');if(reason){if(doc.activeElement!==reason&&reason.value!==s.reason)reason.value=s.reason;reason.disabled=locked||!!s.pending;}
      for(const control of targetNode.querySelectorAll('button'))control.disabled=locked||s.loading||!!s.pending;
      if(s.change==='target')targetNode.scrollIntoView({block:'nearest'});
    }
    if(s.confirm){if(confirmKey!==s.confirm.data.requestId){confirmKey=s.confirm.data.requestId;confirmationFocus=doc.activeElement;html(confirmHost,confirmationMarkup(s.confirm));$('.moderation-main').scrollTop=0;$('#moderation-confirm-title').focus({preventScroll:true});}for(const button of confirmHost.querySelectorAll('button'))button.disabled=s.sending||button.dataset.moderation==='confirm'&&!!s.pending;for(const input of confirmHost.querySelectorAll('input'))input.disabled=s.sending||!!s.pending;}
    else if(confirmKey){confirmKey='';html(confirmHost,'');if(confirmationFocus?.isConnected)confirmationFocus.focus({preventScroll:true});confirmationFocus=null;}
  }
  controller=createController({onChange:render});
  const run=value=>Promise.resolve(value).catch(()=>{});
  dialog.addEventListener('click',event=>{const node=event.target.closest('[data-moderation]');if(!node||node.disabled)return;const action=node.dataset.moderation;if(action==='close')controller.close();else if(action==='search-tab')run(controller.open('search'));else if(action==='bans-tab')run(controller.open('bans'));else if(action==='candidates')run(controller.openCandidates(node));else if(action==='target')run(controller.select(node.dataset.id));else if(action==='refresh')run(controller.loadBans());else if(action==='more')run(controller.loadMore());else if(action==='prepare-ban'||action==='prepare-unban'||action==='prepare-expel')run(controller.prepare(action.slice(8)));else if(action==='confirm')run(controller.confirm());else if(action==='back')controller.cancelConfirm();else if(action==='retry')run(controller.retry());});
  dialog.addEventListener('input',event=>{if(event.target.id==='moderation-query')controller.setQuery(event.target.value);else if(event.target.id==='moderation-reason')controller.setReason(event.target.value);else if(event.target.id==='moderation-restore-name')controller.setRestoreName(event.target.value);});
  dialog.addEventListener('submit',event=>{if(event.target.matches('[data-moderation-form]')){event.preventDefault();controller.setQuery($('#moderation-query').value);run(controller.search());}});
  dialog.addEventListener('cancel',event=>{const state=controller.getState();if(state.confirm&&!state.sending){event.preventDefault();controller.cancelConfirm();}});
  dialog.addEventListener('close',()=>{controller.close();if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});returnFocus=null;});
  instance={controller,open(view){returnFocus=doc.activeElement?.closest?.('.social-dialog')?doc.querySelector('.social-launcher'):doc.activeElement;global.SengokuSocial?.close?.();global.SengokuLetters?.close?.();global.SengokuTrade?.close?.();return controller.open(view);},dispose(){controller.dispose();dialog.remove();instance=null;}};
  return instance;
}
const api={createController,cleanTarget:target,confirmationMarkup,escape:esc,open:view=>ensure()?.open(view),refreshIdentity:()=>instance?.controller.refreshIdentity(),close:()=>instance?.controller.close(),getState:()=>instance?.controller.getState(),dispose:()=>instance?.dispose()};
global.SengokuModeration=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
