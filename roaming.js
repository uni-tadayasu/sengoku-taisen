/* Repeatable CPU encounters; campaign writes belong to the supplied bridge. */
(function(global){
 'use strict';
 const KEY='sengoku-roaming-pending-v1:',RESOURCES={gold:'金銭',rice:'兵糧',wood:'木材',stone:'石材',magatama:'勾玉'};
 const clone=v=>JSON.parse(JSON.stringify(v)),identifier=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,90}$/.test(v),integer=(v,min=0,max=999999999)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const number=v=>Number.isFinite(v)?Number(v).toLocaleString('ja-JP'):'—';
 const payloadOK=d=>d&&identifier(d.encounterId)&&identifier(d.tactic)&&identifier(d.requestId)&&identifier(d.campaignId)&&integer(d.sequence,0,10000000)&&integer(d.troops,300,1000000)&&(d.unitId===undefined||identifier(d.unitId)&&identifier(d.castleId)&&integer(d.deploymentRevision,1,1000000000));
 function cleanBattle(b,d){
  if(!b||!payloadOK(d)||b.requestId!==d.requestId||b.campaignId!==d.campaignId||b.sequence!==d.sequence||b.encounterId!==d.encounterId||b.tactic!==d.tactic||b.deployed!==d.troops||typeof b.won!=='boolean'||b.commandCost!==1||!integer(b.ourLost,0,b.deployed)||b.survivors!==b.deployed-b.ourLost||!integer(b.foodCost)||!integer(b.commandBefore,1,7)||b.commandAfter!==b.commandBefore-1||!b.rewards||Object.keys(RESOURCES).some(k=>!integer(b.rewards[k]))||!integer(b.prestigeGain,0,30))return null;
  if(!integer(b.attackPower,0,1e12)||!integer(b.enemyPower,0,1e12)||!integer(b.enemyTroops,1,1000000)||!integer(b.enemyLost,0,b.enemyTroops)||!integer(b.turn)||typeof b.encounterName!=='string'||b.encounterName.length>100||typeof b.tacticName!=='string'||b.tacticName.length>100)return null;
  if(d.unitId&&(b.unitId!==d.unitId||b.castleId!==d.castleId||b.deploymentRevision!==d.deploymentRevision))return null;
  if(b.respawnAt!=null&&!integer(b.respawnAt,0,Number.MAX_SAFE_INTEGER))return null;
  return Object.fromEntries(['requestId','campaignId','sequence','encounterId','encounterName','tactic','tacticName','won','deployed','ourLost','survivors','enemyTroops','enemyLost','attackPower','enemyPower','foodCost','commandCost','commandBefore','commandAfter','rewards','prestigeGain','turn','unitId','castleId','deploymentRevision','respawnAt'].filter(k=>b[k]!==undefined).map(k=>[k,clone(b[k])]));
 }
 function createController(options={}){
  const getGame=options.getGame||(()=>global.SengokuBridge?.getGame?.()),getStatus=options.getStatus||(()=>({writable:false,reason:'本拠を確認しています。'}));
  const localOnly=global.SENGOKU_OFFLINE===true,request=options.battle||(data=>global.SengokuBridge.roamingBattle(data)),read=localOnly?null:options.request||(global.SengokuSocial?.roamingRequest?(route=>global.SengokuSocial.roamingRequest(route)):null),uuid=options.uuid||(()=>global.crypto.randomUUID()),now=options.now||(()=>Date.now());
  let storage;try{storage=options.storage??global.localStorage;}catch(_){}
  let disposed=false,stamp='',generation=0,flight=null,loadSequence=0,loadFlight=null;
  const cooldowns=new Map();
  let state;
  function context(){const g=getGame(),s=getStatus()||{},campaignId=g?.state?.walking?.campaignId||'',ownerId=String(s.ownerId||'local'),linked=s.linked===true;return{...s,ownerId,campaignId,linked,writable:s.writable===true,online:s.online!==false,stamp:JSON.stringify([ownerId,campaignId,s.stamp??'',linked]),game:g};}
  const key=who=>KEY+encodeURIComponent(who.ownerId)+':'+encodeURIComponent(who.campaignId);
  function readPending(who){try{const r=JSON.parse(storage?.getItem(key(who))||'null');return r?.ownerId===who.ownerId&&r.campaignId===who.campaignId&&payloadOK(r.data)?r:null;}catch(_){return null;}}
  function persist(who,record){if(!storage?.setItem)throw Error('出陣の操作記録を保存できません。ブラウザの保存設定を確認してください。');const value=JSON.stringify(record);storage.setItem(key(who),value);if(storage.getItem(key(who))!==value)throw Error('出陣の操作記録を保存できませんでした。');}
  function clear(who,record){try{if(readPending(who)?.data.requestId===record.data.requestId)storage.removeItem(key(who));}catch(_){} }
  function identity(){
   const who=context();if(stamp!==who.stamp){stamp=who.stamp;generation++;loadSequence++;flight=null;loadFlight=null;cooldowns.clear();const max=who.game?Math.min(who.game.state.troops,who.game.troopCapacity()):0;
    state={selectedId:'',selectedUnitId:'',tactic:'balanced',adviceStyle:'balanced',troopsInput:String(Math.min(1000,Math.max(0,max))),confirmation:null,pending:readPending(who),sending:false,error:'',message:'',battle:null,march:null,castleId:who.game?.state?.home||'',castleQuery:'',deployment:null,castleSummaries:[],units:[],loading:false,loaded:false,loadError:'',local:false,serverOffset:0,expanded:false};
    if(state.pending){state.selectedId=state.pending.data.encounterId;state.selectedUnitId=state.pending.data.unitId||'';state.castleId=state.pending.data.castleId||state.castleId;state.tactic=state.pending.data.tactic;state.troopsInput=String(state.pending.data.troops);}
    if(!read&&(!who.linked||localOnly))applyLocal(who);
   }return who;
  }
  const current=(g,expected)=>!disposed&&g===generation&&context().stamp===expected;
  function applyLocal(who){const E=who.game?.constructor,config=E?.roamingDeploymentDefaults?.();if(!config)return;const summary=E.roamingDeploymentSummary(config);state.deployment={...config,totalSquads:summary.totalSquads};state.castleSummaries=summary.castles;state.units=E.roamingDeploymentUnits(config,state.castleId).map(u=>({...u,available:true,respawnAt:null}));state.loaded=true;state.local=true;}
  function selectedUnit(){return state.units.find(u=>u.unitId===state.selectedUnitId)||null;}
  function remainingCooldown(unit,who,wallNow=now()){
   const serverExpiry=Math.max(Number(unit.respawnAt)||0,cooldowns.get(unit.unitId)||0);
   const localWin=!who.linked&&who.game?.state?.roaming?.history?.find(b=>b.unitId===unit.unitId&&b.won&&b.respawnAt>wallNow);
   return Math.max(0,serverExpiry-wallNow-state.serverOffset,(localWin?.respawnAt||0)-wallNow);
  }
  function unitAvailable(unit,who){return Boolean(unit?.available)&&remainingCooldown(unit,who)===0;}
  function preview(who=context()){
   const unit=selectedUnit(),game=who.game;
   if(!state.loaded||state.loading||state.loadError)return{ok:false,message:state.loading?'配置を読み込んでいます。':state.loadError||'全国の配置を取得してください。'};
   if(!unit)return{ok:false,message:'拡大マップまたは周辺の部隊一覧から、戦う野良兵を選んでください。'};
   if(!unitAvailable(unit,who))return{ok:false,message:'この部隊は撃退されています。再出現後に配置を更新してください。'};
   return game?.previewRoamingBattle(unit.encounterId,state.tactic,state.troopsInput.trim()===''?NaN:Number(state.troopsInput),{deploymentUnit:unit})||{ok:false,message:'本拠を読み込んでから出陣できます。'};
  }
  function advice(who=context()){
   const unit=selectedUnit(),game=who.game,unavailable=message=>({ok:false,style:state.adviceStyle,message,reasons:[message],alternatives:[]});
   if(!state.loaded||state.loading||state.loadError)return unavailable(state.loading?'配置を読み込んでいます。':state.loadError||'全国の配置を取得してください。');
   if(!unit)return unavailable('地図または部隊一覧で相手を選ぶと、軍師が戦法と兵数を比較します。');
   if(!unitAvailable(unit,who))return unavailable('この部隊は再出現を待っています。最新の配置から相手を選び直してください。');
   if(!game?.adviseBattle)return unavailable('本拠を読み込むと、軍師の提案を確認できます。');
   return game.adviseBattle({mode:'roaming',targetId:unit.encounterId,style:state.adviceStyle,deploymentUnit:unit});
  }
  function snapshot(){
   const who=context(),game=who.game,p=preview(who),templates=game?.roamingEncounters?.()||[],castles=clone(game?.data?.castles||[]),wallNow=now();
   const units=state.units.map(u=>{const e=templates.find(e=>e.id===u.encounterId)||{},remaining=remainingCooldown(u,who,wallNow);return{...clone(e),...clone(u),id:u.unitId,enemyTroops:u.troops,available:u.available&&remaining===0,remainingSeconds:Math.ceil(remaining/1000)};});
   return{...clone(state),units,selectedUnit:units.find(u=>u.unitId===state.selectedUnitId)||null,status:{writable:who.writable,online:who.online,linked:who.linked,ownerId:who.ownerId,reason:who.reason||''},preview:clone(p),advice:clone(advice(who)),encounters:units,tactics:clone(game?.data?.roaming?.tactics||[]),castles,homeId:game?.state?.home||'',castle:castles.find(c=>c.id===state.castleId)||null,army:game?.armyStats?.()||{count:0,lead:0,valor:0,intellect:0},resources:{rice:game?.state?.resources?.rice||0,command:game?.state?.command||0,troops:game?.state?.troops||0,maxTroops:game?Math.min(game.state.troops,game.troopCapacity()):0},history:clone(game?.state?.roaming?.history||[]),wins:game?.state?.roaming?.wins||0,total:game?.state?.roaming?.sequence||0};
  }
  function emit(){if(!disposed)options.onChange?.(snapshot());}
  function validateDeployment(raw,game){const checked=game?.constructor?.validateRoamingDeployment?.(raw);if(!checked?.ok||!integer(raw?.revision,1,1000000000))throw Error('全国の配置データを確認できませんでした。最新情報を取得してください。');return{...checked.config,revision:raw.revision,totalSquads:Math.ceil(raw.totalTroops/raw.squadSize)};}
  function validateUnits(raw,config,castleId,game){
   if(!Array.isArray(raw)||raw.length>32)throw Error('周辺の部隊データを確認できませんでした。');
   const canonical=game.constructor.roamingDeploymentUnits(config,castleId),seen=new Set();
   if(raw.length!==canonical.length)throw Error('周辺の部隊数が更新されています。最新情報を取得してください。');
   return raw.map(unit=>{const expected=canonical.find(v=>v.unitId===unit?.unitId);if(!expected||seen.has(unit.unitId)||unit.castleId!==castleId||unit.encounterId!==expected.encounterId||unit.troops!==expected.troops||unit.slot!==expected.slot||typeof unit.available!=='boolean'||unit.respawnAt!=null&&!integer(unit.respawnAt,0,Number.MAX_SAFE_INTEGER))throw Error('周辺の部隊データを確認できませんでした。');seen.add(unit.unitId);return{...expected,available:unit.available,respawnAt:unit.respawnAt??null};});
  }
  async function loadDeployment({background=false}={}){
   const who=identity();if(disposed)return false;if(loadFlight)return loadFlight;
   if(!read){if(who.linked&&!localOnly){state.loadError='全国の配置を取得できません。画面を再読み込みしてください。';state.loaded=false;emit();return false;}applyLocal(who);state.loading=false;state.loadError='';emit();return true;}
   const g=generation,expected=stamp,ticket=++loadSequence,castleId=state.castleId;state.loading=!background;if(!background){state.loadError='';state.confirmation=null;}emit();
   const operation=(async()=>{try{
    const result=await Promise.resolve().then(()=>read('/roaming/deployment'));if(!current(g,expected)||ticket!==loadSequence)return false;if(result?.ok!==true)throw Error(result?.error?.message||'全国の配置を取得できませんでした。');
    const deployment=validateDeployment(result.deployment,who.game),summary=who.game.constructor.roamingDeploymentSummary(deployment);
    const around=await read('/roaming/map?castleId='+encodeURIComponent(castleId));if(!current(g,expected)||ticket!==loadSequence)return false;if(around?.ok!==true||around.castleId!==castleId)throw Error(around?.error?.message||'拠点周辺の配置を取得できませんでした。');
    const localConfig=validateDeployment(around.deployment,who.game);if(JSON.stringify(localConfig)!==JSON.stringify(deployment))throw Error('全国の配置が更新されました。最新情報を取得してください。');
    const units=validateUnits(around.units,deployment,castleId,who.game),serverNow=typeof around.serverNow==='number'?around.serverNow:Date.parse(around.serverNow);
    if(state.deployment?.revision!==deployment.revision)state.confirmation=null;state.deployment=deployment;state.castleSummaries=summary.castles;state.units=units;state.loaded=true;state.local=false;state.serverOffset=Number.isFinite(serverNow)?serverNow-now():0;
    if(!state.pending&&!units.some(u=>u.unitId===state.selectedUnitId)){state.selectedUnitId='';state.selectedId='';}
    state.loadError='';return true;
   }catch(error){if(current(g,expected)&&ticket===loadSequence){state.loadError=error.message||'配置を取得できませんでした。';state.confirmation=null;}return false;}
   finally{if(current(g,expected)&&ticket===loadSequence){state.loading=false;loadFlight=null;emit();}}
   })();loadFlight=operation;return operation;
  }
  async function chooseCastle(id){const who=identity();if(state.sending||state.pending||!who.game?.data?.castles.some(c=>c.id===id))return false;if(state.castleId===id&&state.loaded&&!state.loadError)return true;loadSequence++;loadFlight=null;state.castleId=id;state.selectedUnitId='';state.selectedId='';state.units=[];state.loaded=false;state.confirmation=null;state.error='';if(!read&&(!who.linked||localOnly))applyLocal(who);emit();return loadDeployment();}
  function searchCastles(value){identity();state.castleQuery=String(value).slice(0,70);emit();return true;}
  function select(id){
   const who=identity();if(state.sending||state.pending||state.loading||state.loadError)return false;
   const unit=state.units.find(u=>u.unitId===id);if(!unitAvailable(unit,who))return false;
   const game=who.game,lastBattle=game?.state?.roaming?.history?.[0],troops=Number(state.troopsInput);
   if(lastBattle&&lastBattle.deployed===troops&&!game.state.march){
    const available=Math.min(game.state.troops,game.troopCapacity());
    if(troops>available)state.troopsInput=String(available);
   }
   state.selectedUnitId=id;state.selectedId=unit.encounterId;state.confirmation=null;state.error='';emit();return true;
  }
  const fingerprint=(who,p)=>JSON.stringify([who.campaignId,who.game?.state?.roaming?.sequence,state.selectedUnitId,state.deployment?.revision,state.tactic,p.troops,p.attackPower,p.enemyPower,p.foodCost,p.expectedLoss,p.predictedWin]);
  function setTactic(id){const who=identity();if(state.sending||state.pending||!who.game?.data?.roaming?.tactics.some(t=>t.id===id))return false;state.tactic=id;state.confirmation=null;state.error='';emit();return true;}
  function setTroops(value){identity();if(state.sending||state.pending)return false;state.troopsInput=String(value).slice(0,12);state.confirmation=null;state.error='';emit();return true;}
  function setAdviceStyle(style){identity();if(state.sending||state.pending||!['conserve','balanced','rapid'].includes(style))return false;state.adviceStyle=style;state.confirmation=null;state.error='';emit();return true;}
  function applyAdvice(){const who=identity();if(state.sending||state.pending)return false;const currentAdvice=advice(who);if(!currentAdvice.ok){state.error=currentAdvice.message;state.confirmation=null;emit();return false;}state.tactic=currentAdvice.tactic;state.troopsInput=String(currentAdvice.troops);state.confirmation=null;state.error='';state.message='軍師の案を反映しました。戦力・消費・兵の損失を確認して出陣してください。';emit();return true;}
  function prepare(){const who=identity(),p=preview(who);state.error='';if(state.pending||state.sending)return false;if(!who.writable||who.linked&&!who.online||!p.ok){state.error=who.reason||(!who.online&&who.linked?'接続を確認してから出陣してください。':p.message);emit();return false;}state.confirmation={fingerprint:fingerprint(who,p)};emit();return true;}
  function cancel(){identity();if(!state.sending){state.confirmation=null;emit();}}
  async function submit(){
   const who=identity();if(disposed)return false;if(flight)return flight;
   if(!who.writable||who.linked&&!who.online){state.error=who.reason||'接続と本拠の保存状態を確認してから出陣してください。';emit();return false;}
   let record=state.pending;
   if(!record){const p=preview(who),unit=selectedUnit();if(!unit||!state.confirmation||!p.ok||state.confirmation.fingerprint!==fingerprint(who,p)){state.confirmation=null;state.error='配置・兵・軍団の状況が変わりました。戦力と費用を確認してください。';emit();return false;}record={ownerId:who.ownerId,campaignId:who.campaignId,data:{encounterId:unit.encounterId,unitId:unit.unitId,castleId:unit.castleId,deploymentRevision:state.deployment.revision,tactic:state.tactic,troops:p.troops,requestId:uuid(),campaignId:who.campaignId,sequence:who.game.state.roaming.sequence}};if(!payloadOK(record.data)){state.error='出陣の操作番号を作成できませんでした。';emit();return false;}try{persist(who,record);}catch(e){state.error=e.message;emit();return false;}state.pending=record;}
   const g=generation,expected=stamp;state.sending=true;state.error='';state.message='';state.confirmation=null;emit();
   const operation=(async()=>{try{
    const result=await request(clone(record.data));if(!current(g,expected))return false;
    if(result?.ok!==true)throw Object.assign(Error(result?.message||result?.error?.message||'出陣できませんでした。'),{status:result?.status||409,code:result?.code||result?.error?.code,retryable:result?.retryable===true||result?.error?.retryable===true});
    const effective=identifier(result.effectiveRequestId)?{...record.data,requestId:result.effectiveRequestId}:record.data,completed=global.SengokuTravelUI?.completedMarch(result,effective.requestId);if(completed?.status==='cancelled'){if(completed.kind!=='roaming'||completed.targetCastleId!==effective.castleId||completed.troops!==effective.troops)throw Error('出陣の取消結果を確認できませんでした。');clear(who,record);state.pending=null;state.battle=null;state.march=completed;state.message=completed.message||'出陣が取り消され、部隊と費用が戻りました。';global.SengokuTravelUI?.record(completed);options.onResult?.(result);emit();return true;}const march=global.SengokuTravelUI?.acceptedMarch(result,effective.requestId);if(march){if(march.kind!=='roaming'||march.targetCastleId!==effective.castleId||march.troops!==effective.troops||march.campaignId&&march.campaignId!==effective.campaignId)throw Error('出陣の受付内容を確認できませんでした。');clear(who,record);state.pending=null;state.battle=null;state.march=march;state.message='出陣しました。距離に応じて移動し、到着後に合戦を行います。';global.SengokuTravelUI?.accept(result,effective.requestId);options.onResult?.(result);emit();return true;}const b=cleanBattle(result.battle||completed?.battle,effective);if(!b)throw Error('戦果を確認できませんでした。同じ出陣の結果を再確認してください。');
    clear(who,record);state.pending=null;state.march=null;state.battle=b;if(completed)global.SengokuTravelUI?.record(completed);state.message=result.idempotent?'記録済みの戦果を確認しました。追加の消費や報酬はありません。':b.won?'敵部隊を撃退しました。戦果は本拠へ反映済みです。':'部隊は撤退しました。生存兵は本拠へ戻りました。';
    if(b.won&&b.unitId)cooldowns.set(b.unitId,Number(b.respawnAt)||now()+state.serverOffset+(state.deployment?.respawnSeconds||300)*1000);
    options.onResult?.(result);emit();if(read)void loadDeployment({background:true});return true;
   }catch(error){if(!current(g,expected))return false;global.SengokuBridge?.playInterfaceSound?.('error');state.error=error.message||'通信結果を確認できませんでした。';if(Number(error.status)>=400&&Number(error.status)<500&&![401,403,408,429].includes(Number(error.status))&&error.retryable!==true&&!['ROAMING_SYNC_REQUIRED','ROAMING_RECONCILE_PENDING','ROAMING_CAMPAIGN_REQUIRED'].includes(error.code)){clear(who,record);state.pending=null;}return false;}
   finally{if(current(g,expected)){state.sending=false;flight=null;emit();}}
   })();flight=operation;return operation;
  }
  function refresh(){const before=stamp;identity();emit();if(before!==stamp&&read)void loadDeployment();return snapshot();}
  identity();
  return{snapshot,refresh,loadDeployment,chooseCastle,searchCastles,select,selectUnit:select,setTactic,setTroops,setAdviceStyle,applyAdvice,advise:()=>advice(identity()),prepare,cancel,submit,toggleExpanded(){state.expanded=!state.expanded;emit();},dispose(){disposed=true;generation++;loadSequence++;flight=null;loadFlight=null;}};
 }
 function rewardsMarkup(rewards){return Object.entries(RESOURCES).filter(([k])=>rewards?.[k]>0).map(([k,name])=>`<span>${name} <b>+${number(rewards[k])}</b></span>`).join('')||'<span>獲得報酬なし</span>';}
 function reportMarkup(b){if(!b)return'';return `<section class="roaming-report ${b.won?'is-victory':'is-defeat'}" aria-label="野良兵戦の戦果"><div class="roaming-report-title"><span>${b.won?'勝利':'撤退'}</span><h2>${esc(b.encounterName)}</h2><small>${esc(b.tacticName)}</small></div><div class="roaming-result-grid"><div>出陣兵数<b>${number(b.deployed)}</b></div><div>失った兵<b>${number(b.ourLost)}</b></div><div>帰還兵<b>${number(b.survivors)}</b></div><div>消費兵糧<b>${number(b.foodCost)}</b></div></div><div class="roaming-rewards">${rewardsMarkup(b.rewards)}${b.prestigeGain?`<span>威信 <b>+${number(b.prestigeGain)}</b></span>`:''}</div><p>指令を${b.commandCost}消費。領地の占領・城郭への被害はありません。</p></section>`;}
 function mapMarkup(s){
  const deployment=s.deployment,query=(s.castleQuery||'').trim(),matches=(s.castles||[]).filter(c=>!query||[c.name,c.region,c.province].some(v=>String(v||'').includes(query))),current=(s.castles||[]).find(c=>c.id===s.castleId),choices=matches.some(c=>c.id===s.castleId)?matches:[...(current?[current]:[]),...matches],locked=s.sending||Boolean(s.pending);
  const summary=(s.castleSummaries||[]).find(c=>c.castleId===s.castleId),active=s.units.filter(u=>u.available).length;
  return `<section class="roaming-deployment-summary" aria-label="全国の野良兵配置"><div><span>全国の配置兵数</span><strong>${deployment?number(deployment.totalTroops):'—'}<small>人</small></strong></div><div><span>配置部隊</span><strong>${deployment?number(deployment.totalSquads):'—'}<small>部隊</small></strong></div><div><span>${esc(current?.name||'選択拠点')}周辺</span><strong>${summary?number(summary.squads):'—'}<small>部隊</small></strong></div><p>${s.local?'端末内の配置を表示しています。':deployment?`全国の配置 #${number(deployment.revision)} · 撃退後${number(deployment.respawnSeconds)}秒で再出現`:'全国の配置を確認しています。'}${s.loaded?` · 周辺で対戦可能 ${number(active)}部隊`:''}</p></section><section class="roaming-map-toolbar" aria-label="野良兵の地図を探す"><div><label for="roaming-castle-search">拠点を探す</label><input id="roaming-castle-search" class="input" type="search" value="${esc(s.castleQuery)}" placeholder="城名・地方・国名" autocomplete="off" ${locked?'disabled':''}></div><div><label for="roaming-castle-select">周辺を調べる拠点</label><select id="roaming-castle-select" class="select" ${locked?'disabled':''}>${choices.map(c=>`<option value="${esc(c.id)}"${c.id===s.castleId?' selected':''}>${esc(c.name)} · ${esc(c.province||c.region||'')}</option>`).join('')}</select><span class="roaming-search-count">${number(matches.length)}城が一致</span></div><div class="roaming-map-actions"><button type="button" class="button" data-roaming-action="home" ${locked?'disabled':''}>本拠の周辺</button><button type="button" class="button" data-roaming-action="nation">全国を見る</button><button type="button" class="button" data-roaming-action="expand" aria-pressed="${Boolean(s.expanded)}">${s.expanded?'地図を標準サイズに':'地図を大きく表示'}</button><button type="button" class="button" data-roaming-action="reload" ${s.loading?'disabled':''}>${s.loading?'配置を取得中…':'最新の配置を取得'}</button></div></section><section class="roaming-map-shell${s.expanded?' is-expanded':''}" aria-label="全国と拠点周辺の野良兵マップ"><div id="roaming-world-map" class="roaming-world-map"></div><p class="roaming-map-caption">城を選ぶと周辺へ拡大します。兵の旗を選んで戦闘を準備。ドラッグ・ピンチ・拡大ボタンで地図を操作できます。部隊の位置は拠点周辺のゲーム上の配置です。</p></section><div class="roaming-map-status" role="status" aria-live="polite">${s.loadError?`<p class="notice roaming-error">${esc(s.loadError)} 配置を再取得してください。</p>`:s.loading?'<p class="notice">全国と拠点周辺の配置を読み込んでいます。</p>':''}</div>`;
 }
 function nearbyMarkup(s){
  const locked=s.sending||Boolean(s.pending)||s.loading||Boolean(s.loadError),art=e=>global.SengokuArt?.facility?.(e.art,'roaming-illustration',Math.min(32,4+(e.tier||1)*4))||'';
  return `<section class="roaming-nearby"><div class="roaming-nearby-heading"><h2>${esc(s.castle?.name||'拠点')}周辺の野良兵</h2><span>${number(s.units.length)}部隊</span></div><div class="roaming-encounters" role="group" aria-label="拠点周辺の野良兵部隊">${s.units.map(e=>`<button type="button" class="roaming-enemy ${e.unitId===s.selectedUnitId?'is-selected':''}${e.available?'':' is-resting'}" data-roaming-action="select" data-roaming-id="${esc(e.unitId)}" aria-pressed="${e.unitId===s.selectedUnitId}" ${locked||!e.available?'disabled':''}>${art(e)}<span class="roaming-enemy-copy"><small>第${number(e.slot+1)}部隊 · ${esc(e.terrain)} · ${esc(e.units)}</small><strong>${esc(e.name)}</strong><span>敵兵 ${number(e.troops)}人</span><span class="roaming-availability">${e.available?'対戦可能':e.remainingSeconds>0?`再出現まで ${number(e.remainingSeconds)}秒`:'再出現を確認するには配置を更新'}</span></span></button>`).join('')||`<p class="roaming-no-units">${s.loading?'周辺の配置を読み込んでいます。':s.loaded?'この拠点の周辺には野良兵が配置されていません。全国地図から別の拠点を選べます。':'配置を取得すると、周辺の部隊を選べます。'}</p>`}</div></section>`;
 }
 function markup(s,game){
  const p=s.preview,chosen=s.selectedUnit,locked=s.sending||Boolean(s.pending),ready=s.status.writable&&(!s.status.linked||s.status.online)&&p.ok,canRetry=s.status.writable&&(!s.status.linked||s.status.online)&&!s.sending;
  const art=e=>global.SengokuArt?.facility?.(e.art,'roaming-illustration',Math.min(32,4+e.tier*4))||'';
  return `<section class="roaming-page" aria-label="野良兵戦"><header class="roaming-heading"><div><span class="eyebrow">FIELD ENCOUNTERS · CPU</span><h1>野良兵戦</h1><p>拠点周辺へ地図を広げ、街道や山野の部隊と戦う。</p></div><div class="roaming-record"><b>${number(s.wins)}</b>勝 <span>/ ${number(s.total)}戦</span></div></header><div class="roaming-supplies"><span>指令 <b>${number(s.resources.command)}</b></span><span>兵糧 <b>${number(s.resources.rice)}</b></span><span>本拠の兵 <b>${number(s.resources.troops)}</b></span><span>軍団 <b>${number(s.army.count)}名</b></span></div>${global.SengokuOfficerHealthUI?.armyMarkup(game,{deferred:true})||''}<details class="roaming-help"><summary>野良兵戦の遊び方・消費と報酬</summary><ol><li>拠点を選んで地図を拡大し、周辺の野良兵を選びます。地図の下の部隊一覧からも選べます。</li><li>出陣兵数と戦術を選び、軍団の統率・武勇・知略を含む戦力を確認します。軍団は「軍団編成」で変更できます。</li><li>1回につき指令1と表示された兵糧を消費し、勝敗に応じて兵を失います。勝利時は資源・勾玉・威信を獲得します。</li><li>戦力比較で勝敗が決まります。撃退された部隊は配置で定められた時間の後に再出現します。領地の占領や攻城戦の任務には加算されません。</li></ol><p>指令回復は通常の共通時間に従います。通信が途切れた場合は「同じ出陣の結果を確認」で安全に再確認できます。</p><button type="button" class="button" data-view="army">軍団編成を開く</button></details>${mapMarkup(s)}${nearbyMarkup(s)}<section class="roaming-preparation" aria-label="出陣準備"><div><span class="eyebrow">SELECTED ENCOUNTER</span><h2>${esc(chosen?.name||'地図から相手を選択')}</h2>${chosen?`<p class="roaming-target-location">${esc(s.castle?.name)}周辺 · 第${number(chosen.slot+1)}部隊 · 敵兵${number(chosen.troops)}人</p>`:''}<p>${esc(chosen?.description||'拠点の周辺にいる部隊を選ぶと、戦力と消費を確認できます。')}</p><div class="roaming-rewards" aria-label="勝利時の基本報酬">${p.encounter?rewardsMarkup(p.encounter.rewards):`<span>${chosen?(chosen.available?'最新の配置を確認後に表示します。':'部隊の再出現後に確認できます。'):'部隊を選ぶと報酬を確認できます。'}</span>`}</div><small>報酬は所持上限まで反映されます。</small></div><div class="roaming-controls"><label for="roaming-troops">出陣兵数 <span>300〜${number(s.resources.maxTroops)}人</span></label><input id="roaming-troops" class="input" type="number" inputmode="numeric" min="300" max="${s.resources.maxTroops}" step="1" value="${esc(s.troopsInput)}" ${locked?'disabled':''}><div class="roaming-troop-shortcuts"><button type="button" class="button" data-roaming-action="half" ${locked?'disabled':''}>半数</button><button type="button" class="button" data-roaming-action="all" ${locked?'disabled':''}>出陣可能な全兵</button></div><label for="roaming-tactic">戦術</label><select id="roaming-tactic" class="select" ${locked?'disabled':''}>${s.tactics.map(t=>`<option value="${esc(t.id)}"${t.id===s.tactic?' selected':''}>${esc(t.name)}</option>`).join('')}</select><p class="roaming-tactic-description">${esc(s.tactics.find(t=>t.id===s.tactic)?.description||'')}</p></div></section><div class="roaming-adviser">${global.SengokuBattleAdvisor?.markup(s.advice,{action:'roaming-apply',disabled:locked})||''}</div><section class="roaming-forecast" aria-label="戦力と消費"><div><span>自軍の戦力</span><b>${number(p.attackPower)}</b></div><div><span>敵軍の戦力</span><b>${number(p.enemyPower)}</b></div><div><span>指令 / 兵糧</span><b>1 / ${number(p.foodCost)}</b></div><div><span>予想損失</span><b>${number(p.expectedLoss)}人</b></div><p class="${p.predictedWin?'is-favored':'is-danger'}">${p.attackPower?`${p.predictedWin?'勝利見込み':'敗北見込み'} · 現在の軍団・兵数・戦術による判定`:'出陣兵数を指定してください。'}</p></section>${global.SengokuTravelUI?.preview(p.travel)||''}${s.march?`<p class="notice">出陣した部隊の移動と戦果は、進軍状況で確認できます。<button type="button" class="button small" data-roaming-action="marches">進軍状況・戦果を見る</button></p>`:''}${s.error?`<p class="notice roaming-error" role="alert">${esc(s.error)}</p>`:''}${s.message?`<p class="notice" role="status">${esc(s.message)}</p>`:''}${s.pending?`<div class="roaming-pending"><p>${s.sending?'出陣の結果を確認しています。':'結果が未確認の出陣があります。同じ操作番号で確認し、二重消費を防ぎます。'}</p><button type="button" class="button gold full" data-roaming-action="submit" ${!canRetry?'disabled':''}>${s.sending?'戦果を確認中…':'同じ出陣の結果を確認'}</button></div>`:s.confirmation?`<div class="roaming-confirm" aria-label="出陣の最終確認"><h3>${esc(chosen?.name)}へ出陣しますか？</h3><p>${number(p.troops)}人が${esc(p.tacticName)}で出陣。指令1・兵糧${number(p.foodCost)}を消費し、予想損失は${number(p.expectedLoss)}人です。</p><div><button type="button" class="button" data-roaming-action="cancel">準備に戻る</button><button type="button" class="button gold" data-roaming-action="submit" ${!ready?'disabled':''}>確定して出陣</button></div></div>`:`<div class="roaming-start"><p>${esc(s.status.reason||(!s.status.online&&s.status.linked?'オンライン接続を確認してください。':!p.ok?p.message:'戦力・消費・兵の損失を確認して出陣してください。'))}</p><button type="button" class="button gold full" data-roaming-action="prepare" ${!ready?'disabled':''}>出陣内容を確認</button></div>`}${reportMarkup(s.battle)}<section class="roaming-history"><h2>野良兵戦の記録 <small>最新20戦</small></h2>${s.history.length?`<ol>${s.history.map(b=>`<li><span class="roaming-history-outcome ${b.won?'is-favored':'is-danger'}">${b.won?'勝利':'撤退'}</span><div><b>${esc(b.encounterName)}</b><small>${esc(b.tacticName)} · 兵${number(b.deployed)}人 / 損失${number(b.ourLost)}人</small></div><span>金銭 +${number(b.rewards.gold)}<br>勾玉 +${number(b.rewards.magatama)}</span></li>`).join('')}</ol>`:'<p class="subtitle">まだ野良兵戦の記録はありません。</p>'}</section><div class="roaming-management-slot"></div></section>`;
 }
 const landIndexes=new WeakMap();
 function landPolygons(land){
  if(!land||typeof land!=='object')return[];if(landIndexes.has(land))return landIndexes.get(land);
  const polygons=[],walk=shape=>{if(!shape)return;if(shape.type==='FeatureCollection')shape.features.forEach(walk);else if(shape.type==='Feature')walk(shape.geometry);else if(shape.type==='GeometryCollection')shape.geometries.forEach(walk);else if(shape.type==='MultiPolygon')shape.coordinates.forEach(add);else if(shape.type==='Polygon')add(shape.coordinates);},add=rings=>{const outer=rings[0];if(!outer?.length)return;let west=Infinity,east=-Infinity,south=Infinity,north=-Infinity;for(const [lon,lat]of outer){west=Math.min(west,lon);east=Math.max(east,lon);south=Math.min(south,lat);north=Math.max(north,lat);}polygons.push({rings,west,east,south,north});};walk(land);landIndexes.set(land,polygons);return polygons;
 }
 function pointOnLand(lon,lat,land){
  const ringContains=ring=>{let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>lat)!==(b[1]>lat)&&lon<(b[0]-a[0])*(lat-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;};
  return landPolygons(land).some(p=>lon>=p.west&&lon<=p.east&&lat>=p.south&&lat<=p.north&&ringContains(p.rings[0])&&!p.rings.slice(1).some(ringContains));
 }
 function unitCoordinates(castleId,slot,coordinates,land){
  const source=Array.isArray(coordinates)?coordinates.find(c=>c.id===castleId):coordinates?.[castleId];if(!source)return null;
  const lon=Number(Array.isArray(source)?source[0]:source.lon??source.lng),lat=Number(Array.isArray(source)?source[1]:source.lat);if(!Number.isFinite(lon)||!Number.isFinite(lat))return null;
  const seed=[...castleId].reduce((n,c)=>n+c.charCodeAt(0)*17,0),angle=(seed+slot*137.507764)*Math.PI/180,radius=.045+Math.sqrt(slot)*.017,cos=Math.max(.5,Math.cos(lat*Math.PI/180));
  for(let attempt=0;attempt<72;attempt++){const a=angle+attempt*Math.PI/18,r=radius*(attempt<36?1:.5),candidate={lon:lon+Math.cos(a)*r/cos,lat:lat+Math.sin(a)*r};if(!land||pointOnLand(candidate.lon,candidate.lat,land))return candidate;}
  return{lon,lat};
 }
 function mount(host,options={}){
  if(!host)return{refresh(){},dispose(){}};
  let alive=true,lastMarkup='',regions=new Map(),focusIntent='',awaitingResultFocus=false,mapController=null,mapElement=null,mapSignature='',mapCastle='',mapOwner='',management=null,managementElement=null,timer=null;
  const regionKey=el=>el.classList.contains('roaming-error')?'error':el.classList.contains('roaming-map-status')?'map-status':el.getAttribute('role')==='status'?'message':/^roaming-(start|pending|confirm)$/.test(el.classList[0])?'action':el.classList[0];
  function focusKey(el){if(!el||!host.contains(el))return null;if(el.id)return{id:el.id};if(el.dataset?.mapMarker)return{mapMarker:el.dataset.mapMarker};if(el.dataset?.roamingAction)return{action:el.dataset.roamingAction,encounter:el.dataset.roamingId||''};if(el.hasAttribute?.('data-battle-advisor-style'))return{adviceStyle:true};if(el.dataset?.battleAdvisorAction)return{adviceAction:el.dataset.battleAdvisorAction};if(el.dataset?.view)return{view:el.dataset.view};if(el.matches?.('.roaming-help summary'))return{help:true};if(el.matches?.('.roaming-confirm,.roaming-pending,.roaming-report'))return{region:el.classList[0]};return null;}
  function findFocus(key){if(!key)return null;if(key.id)return host.querySelector('#'+key.id);if(key.adviceStyle)return host.querySelector('[data-battle-advisor-style]');if(key.adviceAction)return [...host.querySelectorAll('[data-battle-advisor-action]')].find(el=>el.dataset.battleAdvisorAction===key.adviceAction)||null;if(key.help)return host.querySelector('.roaming-help summary');if(key.region)return host.querySelector('.'+key.region);return [...host.querySelectorAll('button')].find(el=>key.mapMarker?el.dataset.mapMarker===key.mapMarker:key.view?el.dataset.view===key.view:el.dataset.roamingAction===key.action&&(el.dataset.roamingId||'')===key.encounter)||null;}
  function patchPreparation(live,fresh){
   if(live.firstElementChild.innerHTML!==fresh.firstElementChild.innerHTML)live.firstElementChild.innerHTML=fresh.firstElementChild.innerHTML;
   for(const id of ['roaming-troops','roaming-tactic']){const current=live.querySelector('#'+id),next=fresh.querySelector('#'+id);current.disabled=next.disabled;for(const name of ['min','max'])if(next.hasAttribute(name)&&current.getAttribute(name)!==next.getAttribute(name))current.setAttribute(name,next.getAttribute(name));if(current.value!==next.value)current.value=next.value;}
   for(const selector of ['label[for="roaming-troops"] span','.roaming-tactic-description']){const current=live.querySelector(selector),next=fresh.querySelector(selector);if(current.textContent!==next.textContent)current.textContent=next.textContent;}
   for(const action of ['half','all'])live.querySelector('[data-roaming-action="'+action+'"]').disabled=fresh.querySelector('[data-roaming-action="'+action+'"]').disabled;
  }
  function patchToolbar(live,fresh){
   for(const id of ['roaming-castle-search','roaming-castle-select']){const current=live.querySelector('#'+id),next=fresh.querySelector('#'+id);current.disabled=next.disabled;if(id==='roaming-castle-select'&&current.innerHTML!==next.innerHTML)current.innerHTML=next.innerHTML;if(current.value!==next.value)current.value=next.value;}
   const count=live.querySelector('.roaming-search-count'),nextCount=fresh.querySelector('.roaming-search-count');if(count.textContent!==nextCount.textContent)count.textContent=nextCount.textContent;
   for(const next of fresh.querySelectorAll('button')){const current=live.querySelector('[data-roaming-action="'+next.dataset.roamingAction+'"]');current.disabled=next.disabled;if(current.textContent!==next.textContent)current.textContent=next.textContent;if(next.hasAttribute('aria-pressed'))current.setAttribute('aria-pressed',next.getAttribute('aria-pressed'));}
  }
  function patchNearby(live,fresh){
   const before=[...live.querySelectorAll('[data-roaming-id]')],after=[...fresh.querySelectorAll('[data-roaming-id]')];
   if(before.length!==after.length||before.some((node,i)=>node.dataset.roamingId!==after[i]?.dataset.roamingId))return false;
   const title=live.querySelector('.roaming-nearby-heading'),nextTitle=fresh.querySelector('.roaming-nearby-heading');if(title.textContent!==nextTitle.textContent)title.innerHTML=nextTitle.innerHTML;
   for(let i=0;i<after.length;i++){const current=before[i],next=after[i];current.disabled=next.disabled;current.setAttribute('aria-pressed',next.getAttribute('aria-pressed'));for(const c of ['is-selected','is-resting'])current.classList.toggle(c,next.classList.contains(c));const oldCopy=current.querySelector('.roaming-enemy-copy'),newCopy=next.querySelector('.roaming-enemy-copy');for(let j=0;j<newCopy.children.length;j++)if(oldCopy.children[j].textContent!==newCopy.children[j].textContent)oldCopy.children[j].textContent=newCopy.children[j].textContent;}
   const empty=live.querySelector('.roaming-no-units'),nextEmpty=fresh.querySelector('.roaming-no-units');if(empty&&nextEmpty&&empty.textContent!==nextEmpty.textContent)empty.textContent=nextEmpty.textContent;return true;
  }
  function patchText(live,fresh){const old=[...live.querySelectorAll('b,strong,small,p')],next=[...fresh.querySelectorAll('b,strong,small,p')];if(old.length!==next.length)return false;for(let i=0;i<old.length;i++)if(!old[i].children.length&&old[i].textContent!==next[i].textContent)old[i].textContent=next[i].textContent;for(const node of live.querySelectorAll('p')){const index=[...live.querySelectorAll('p')].indexOf(node),freshP=[...fresh.querySelectorAll('p')][index];if(freshP)for(const c of ['is-favored','is-danger'])node.classList.toggle(c,freshP.classList.contains(c));}return true;}
  function patch(html){
   const template=host.ownerDocument?.createElement?.('template');if(!template){host.innerHTML=html;return;}
   template.innerHTML=html;const fresh=template.content.firstElementChild,page=host.querySelector('.roaming-page'),updated=new Map();
   if(!page){host.innerHTML=html;for(const child of fresh.children)updated.set(regionKey(child),child.outerHTML);regions=updated;return;}
   const existing=new Map([...page.children].map(el=>[regionKey(el),el]));
   for(const [index,next]of [...fresh.children].entries()){
    const key=regionKey(next),raw=next.outerHTML;let live=existing.get(key);updated.set(key,raw);
    if(!live||regions.get(key)!==raw){
     if(live&&key==='roaming-preparation')patchPreparation(live,next);
     else if(live&&key==='roaming-map-toolbar')patchToolbar(live,next);
     else if(live&&key==='roaming-map-shell')live.classList.toggle('is-expanded',next.classList.contains('is-expanded'));
     else if(live&&key==='roaming-management-slot'){}
     else if(live&&key==='roaming-adviser'&&global.SengokuStableDOM?.patch)global.SengokuStableDOM.patch(live,next.innerHTML);
     else if(live&&key==='roaming-nearby'&&patchNearby(live,next)){}
     else if(live&&['roaming-supplies','roaming-forecast'].includes(key)&&patchText(live,next)){}
     else{if(live)live.replaceWith(next);live=next;}
    }
    const at=page.children[index];if(at!==live)page.insertBefore(live,at||null);existing.delete(key);
   }
   for(const old of existing.values())old.remove();regions=updated;
  }
  const flag='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 22V3m0 1c5-5 9 5 15 0v10c-6 5-10-5-15 0M3 22h5"/></svg>',castleSymbol='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21h18M5 21V9l7-5 7 5v12M3 9h18M9 4l3-3 3 3M9 14h6M10 21v-4h4v4"/></svg>';
  function updateMap(s){
   const element=host.querySelector('#roaming-world-map');if(!element||!global.SengokuWorldMap?.mount)return;
   if(global.SengokuWorldMap.prepareGeography?.(element,()=>{if(alive)updateMap(controller.snapshot());})===false)return;
   const signature=JSON.stringify([s.castleId,s.selectedUnitId,s.homeId,s.deployment?.revision,s.sending,Boolean(s.pending),s.loading,s.loadError,s.units.map(u=>[u.unitId,u.available])]);if(mapElement===element&&mapOwner===s.status.ownerId&&signature===mapSignature)return;
   const coordinates=global.SENGOKU_CASTLE_COORDS||global.SENGOKU_GEOGRAPHY?.castles||{},index=Array.isArray(coordinates)?Object.fromEntries(coordinates.map(c=>[c.id,c])):{...coordinates},summaries=new Map(s.castleSummaries.map(c=>[c.castleId,c])),locked=s.sending||Boolean(s.pending)||s.loading||Boolean(s.loadError),castles=s.castles.map(c=>({...c,owner:c.id===s.homeId?'__home':'',roamingKind:'castle',squadCount:summaries.get(c.id)?.squads||0,disabled:s.sending||Boolean(s.pending)}));
   for(const unit of s.units){const position=unitCoordinates(unit.castleId,unit.slot,index,global.SENGOKU_GEOGRAPHY?.land);if(!position)continue;index[unit.unitId]=position;castles.push({...unit,id:unit.unitId,name:`第${unit.slot+1}部隊`,owner:'',roamingKind:'unit',region:s.castle?.region||'',reachable:unit.available,disabled:locked||!unit.available});}
   const mapOptions={stateKey:'roaming-map:'+s.status.ownerId,castles,coordinates:index,homeId:s.homeId,selectedId:s.selectedUnitId||s.castleId,clan:'__home',allowRestrictedSelection:true,initialView:'selected',focusZoom:64,markerSize:38,hideRoutes:true,countUnit:'地点',countLabel:`全国${s.castles.length}拠点 · ${s.castle?.name||''}周辺${s.units.length}部隊`,surfaceLabel:'野良兵の拡大マップ。城を選んで周辺を表示し、部隊の旗を選択。矢印キーで移動、プラス・マイナスで拡大縮小。',selectedLabel:'選択地点を中心に表示',labelsLabel:'拠点・部隊名を表示',eyebrow:'ROAMING FORCES · JAPAN',title:'拠点周辺の野良兵',legend:{own:'本拠',ally:'拠点',reachable:'対戦可能',other:'拠点・待機中'},markerAppearance(marker){return marker.roamingKind==='unit'?{html:`<span class="roaming-unit-marker${marker.available?'':' is-resting'}">${flag}<small>${number(marker.troops)}</small></span>`,label:`${s.castle?.name||''}周辺の第${marker.slot+1}部隊 ${marker.name==='第'+(marker.slot+1)+'部隊'?s.units.find(u=>u.unitId===marker.id)?.name||'野良兵':marker.name} ${number(marker.troops)}人 ${marker.available?'対戦可能':'再出現待ち'}`}:{html:`<span class="roaming-castle-marker">${castleSymbol}<small>${number(marker.squadCount||0)}</small></span>`,label:`${marker.name}周辺を拡大 野良兵${number(marker.squadCount||0)}部隊`};},markerTooltip(marker){return marker.roamingKind==='unit'?{title:s.units.find(u=>u.unitId===marker.id)?.name||'野良兵',description:`${number(marker.troops)}人 · ${marker.available?'対戦可能':'再出現待ち'}`,detail:'選択後に出陣兵数と戦術を確認します。'}:{title:marker.name,description:`周辺の配置 ${number(marker.squadCount||0)}部隊`,detail:'選ぶとこの拠点の周辺を拡大します。'};},onSelect(id){if(s.units.some(u=>u.unitId===id)){if(controller.select(id)){const region=host.querySelector('.roaming-preparation');if(region){region.setAttribute('tabindex','-1');region.focus?.({preventScroll:true});region.scrollIntoView?.({behavior:global.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});}}}else{const same=controller.snapshot().castleId===id;void controller.chooseCastle(id);if(same)mapController?.fit('selected',false);}}};
   if(mapElement!==element||mapOwner!==s.status.ownerId){mapController?.destroy();mapController=global.SengokuWorldMap.mount(element,mapOptions);mapElement=element;mapCastle=s.castleId;mapOwner=s.status.ownerId;}else{mapController?.update(mapOptions);if(mapCastle!==s.castleId){mapController?.fit('selected',false);mapCastle=s.castleId;}}
   mapSignature=signature;
  }
  function render(s){
   if(!alive)return;const game=options.getGame?.()||global.SengokuBridge?.getGame?.(),html=markup(s,game);if(lastMarkup===html){global.SengokuOfficerHealthUI?.refresh(host,game);return;}
   const active=host.ownerDocument?.activeElement,ownedFocus=host.contains(active),locator=focusKey(active),selection=locator?{start:active.selectionStart,end:active.selectionEnd}:null,top=host.scrollTop,helpOpen=host.querySelector('.roaming-help')?.open;
   patch(html);global.SengokuOfficerHealthUI?.refresh(host,game);lastMarkup=html;host.scrollTop=top;const help=host.querySelector('.roaming-help');if(help&&helpOpen)help.open=true;updateMap(s);
   const slot=host.querySelector('.roaming-management-slot');if(slot&&slot!==managementElement&&typeof options.mountManagement==='function'){management?.dispose?.();managementElement=slot;management=options.mountManagement(slot);}
   let next=findFocus(locator),scrollResult=false;
   if(focusIntent==='confirmation'&&s.confirmation){next=host.querySelector('.roaming-confirm');scrollResult=true;}
   else if(focusIntent==='prepare')next=host.querySelector('[data-roaming-action="prepare"]');
   else if(focusIntent==='advice')next=host.querySelector('#roaming-troops');
   else if(s.march)awaitingResultFocus=false;
   if(awaitingResultFocus&&s.battle&&!s.pending){if(ownedFocus||!active||active===host.ownerDocument?.body){next=host.querySelector('.roaming-report');scrollResult=true;}awaitingResultFocus=false;}
   if(s.sending&&(!next||next.disabled)&&locator?.action==='submit')next=host.querySelector('.roaming-pending');
   if(next&&!next.disabled){if(!next.matches?.('button,input,select,summary,[tabindex]'))next.setAttribute?.('tabindex','-1');if(host.ownerDocument?.activeElement!==next)next.focus?.({preventScroll:true});if(typeof selection?.start==='number'&&locator?.id===next.id)try{next.setSelectionRange(selection.start,selection.end);}catch(_){}if(scrollResult)next.scrollIntoView?.({behavior:global.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'center'});}
   focusIntent='';global.SengokuArt?.decorate?.();options.onChange?.(s);
  }
  const controller=createController({...options,onChange:render});
  const click=event=>{const adviceButton=event.target.closest?.('[data-battle-advisor-action="roaming-apply"]');if(adviceButton&&host.contains(adviceButton)&&!adviceButton.disabled){event.preventDefault();focusIntent='advice';controller.applyAdvice();return;}const button=event.target.closest?.('[data-roaming-action]');if(!button||!host.contains(button)||button.disabled)return;event.preventDefault();const action=button.dataset.roamingAction;if(action==='marches'){global.SengokuTravelUI?.open();}else if(action==='select'){controller.select(button.dataset.roamingId);}else if(action==='prepare'){focusIntent='confirmation';controller.prepare();}else if(action==='cancel'){focusIntent='prepare';controller.cancel();}else if(action==='submit'){awaitingResultFocus=true;void controller.submit();}else if(action==='reload'){void controller.loadDeployment();}else if(action==='home'){const snapshot=controller.snapshot();if(snapshot.castleId===snapshot.homeId)mapController?.fit('home',false);else void controller.chooseCastle(snapshot.homeId);}else if(action==='nation')mapController?.fit('nation');else if(action==='expand')controller.toggleExpanded();else if(action==='all'||action==='half'){const max=controller.snapshot().resources.maxTroops;controller.setTroops(Math.min(max,Math.max(300,action==='all'?max:Math.floor(max/2))));}};
  const input=event=>{if(event.target.id==='roaming-troops')controller.setTroops(event.target.value);if(event.target.id==='roaming-castle-search')controller.searchCastles(event.target.value);};
  const change=event=>{if(event.target.hasAttribute?.('data-battle-advisor-style'))controller.setAdviceStyle(event.target.value);if(event.target.id==='roaming-tactic')controller.setTactic(event.target.value);if(event.target.id==='roaming-castle-select')void controller.chooseCastle(event.target.value);};
  host.addEventListener('click',click);host.addEventListener('input',input);host.addEventListener('change',change);controller.refresh();void controller.loadDeployment();
  if(global.setInterval&&host.ownerDocument?.createElement)timer=global.setInterval(()=>{if(!alive||host.ownerDocument.visibilityState==='hidden')return;const s=controller.snapshot();if(!s.sending&&!s.pending&&!s.confirmation)void controller.loadDeployment({background:true});},60000);
  return{refresh:()=>{const s=controller.refresh();management?.refreshContext?.();return s;},controller,dispose(){alive=false;controller.dispose();mapController?.destroy();management?.dispose?.();if(timer)global.clearInterval(timer);host.removeEventListener('click',click);host.removeEventListener('input',input);host.removeEventListener('change',change);}};
 }
 const api={createController,mount,markup,reportMarkup,cleanBattle,unitCoordinates,pointOnLand};global.SengokuRoaming=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
