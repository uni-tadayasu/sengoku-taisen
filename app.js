/* 戦国VS — browser interface, offline persistence and original procedural audio. */
(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num = v => Math.floor(Number(v)||0).toLocaleString('ja-JP');
  function patchHTML(host,html,options={}){if(!host)return;if(window.SengokuStableDOM){const result=window.SengokuStableDOM.patch(host,html,options);if(result.artwork)window.SengokuArt?.schedule?.();return result;}if(host.innerHTML!==html)host.innerHTML=html;}
  const paths = {
    castle:'M3 21h18M5 21V10l3-2 4-5 4 5 3 2v11M3 10h18M7 14h10M10 21v-5h4v5M9 7h6',
    map:'m3 5 6-2 6 3 6-2v16l-6 2-6-3-6 2V5Zm6-2v16M15 6v16',
    users:'M15 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M16 3a4 4 0 0 1 0 8M23 21v-2a4 4 0 0 0-3-3.9',
    swords:'m4 3 14 14M3 7l4-4M3 3l1 4 13 13 3-3L7 4 3 3Zm17 0-1 4-4 4M21 7l-4-4M7 15l-4 5 2 2 5-4M17 17l4 4M3 21l4-4',
    book:'M4 3h13a3 3 0 0 1 3 3v15H6a3 3 0 0 1 0-6h14M4 3v15M8 7h8M8 11h6',
    scroll:'M6 3h12v17H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Zm0 0v5H3m15 12h1a3 3 0 0 0 3-3v-2h-4M9 7h6M9 11h6M9 15h4',
    settings:'m12 3 2 3 3-1 1 3 3 2-1 3 1 3-3 1-1 3-3-1-2 2-2-2-3 1-1-3-3-1 1-3-1-3 3-1 1-3 3 1 2-3Zm0 6a4 4 0 1 0 0 8 4 4 0 0 0 0-8',
    help:'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M9 8a3 3 0 1 1 5 2c-2 1-2 1-2 4M12 18h.01',
    magatama:'M17.5 3.5C11-1 3 4 3 11c0 7 6 11 12 10-5-2-5-6-2-8 6 1 9-5 4.5-9.5ZM12.5 5.8a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6Z',
    coins:'M20 6c0 2-4 4-8 4S4 8 4 6s4-4 8-4 8 2 8 4ZM4 6v6c0 2 4 4 8 4s8-2 8-4V6M4 12v6c0 2 4 4 8 4s8-2 8-4v-6',
    wheat:'M12 22V3M12 7C5 7 5 3 5 2c6 0 7 5 7 5Zm0 5c-7 0-7-4-7-5 6 0 7 5 7 5Zm0 5c-7 0-7-4-7-5 6 0 7 5 7 5Zm0-7c7 0 7-4 7-5-6 0-7 5-7 5Zm0 5c7 0 7-4 7-5-6 0-7 5-7 5',
    tree:'M12 2 5 10h3l-5 7h7v5h4v-5h7l-5-7h3l-7-8Z',
    mountain:'m2 20 7-14 5 8 3-5 5 11H2Zm5-10 2 2 2-2M16 11l2 3',
    shield:'m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6l9-4ZM12 7v10M7 12h10',
    target:'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10M12 10v4M10 12h4',
    flag:'M4 22V3m0 1c6-5 10 5 16 0v10c-6 5-10-5-16 0',
    chevron:'m9 5 7 7-7 7',
    calendar:'M4 5h16v16H4V5ZM7 2v6M17 2v6M4 11h16M8 15h2M14 15h2',
    walking:'M14 5a2 2 0 1 0 0-4 2 2 0 0 0 0 4M8 21l3-6-2-5 3-4 3 5 5 1M5 11l4-1M11 15l5 2 1 5',
    close:'m6 6 12 12M6 18 18 6',
    check:'m4 12 5 5L20 6',
    download:'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
    upload:'M12 16V4m-5 5 5-5 5 5M4 17v4h16v-4',
    sound:'m11 4-6 4H2v8h3l6 4V4Zm4 3c3 3 3 7 0 10m3-13c5 5 5 11 0 16',
    mute:'m11 4-6 4H2v8h3l6 4V4Zm5 5 6 6m0-6-6 6',
    expand:'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5',
    search:'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14m5-2 6 6',
    eye:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
    handshake:'m2 8 5-4 5 2 5-2 5 4-6 10-4 2-4-2-6-10Zm5-4-2 8 5 5m2-11-3 5 3 2 4-4 4 4M8 18l2-3m2 5 2-4',
    crown:'m2 6 5 4 5-7 5 7 5-4-3 14H5L2 6Zm4 10h12',
    lightning:'m13 2-9 12h7l-1 8 10-13h-8l1-7',
    refresh:'M20 8a9 9 0 1 0 1 7M20 3v5h-5',
    leaf:'M20 3c-12-2-18 8-12 14 6 6 15 0 12-14ZM4 21l12-12',
    sun:'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8M12 1v3M12 20v3M1 12h3M20 12h3M4 4l2 2M18 18l2 2M20 4l-2 2M6 18l-2 2',
    plus:'M12 4v16M4 12h16',
    minus:'M4 12h16',
    pause:'M7 4v16M17 4v16',
    play:'m7 4 14 8-14 8V4Z',
    save:'M3 3h15l3 3v15H3V3ZM7 3v7h10V3M7 21v-7h10v7',
    bell:'M5 17h14l-2-4V8a5 5 0 0 0-10 0v5l-2 4Zm5 3a2 2 0 0 0 4 0',
    lock:'M5 10h14v12H5V10Zm3 0V6a4 4 0 0 1 8 0v4M12 15v3'
  };
  function icon(name,cls=''){return `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name]||paths.flag}"/></svg>`;}
  const resNames={gold:'金銭',rice:'兵糧',wood:'木材',stone:'石材'};
  const resIcons={gold:'coins',rice:'wheat',wood:'tree',stone:'mountain'};
  const skillNames={commander:'総大将',cavalry:'騎馬戦法',infantry:'槍働き',ranged:'弓鉄砲',strategist:'軍略',administrator:'内政手腕',farmer:'農政',merchant:'商才',engineer:'普請巧者',medic:'救護'};
  const skillDescriptions={commander:'軍団に編成すると攻撃力が4%上昇します。',cavalry:'総攻撃を選んだ合戦で、軍団の攻撃力が6%上昇します。',infantry:'正攻法を選んだ合戦で、軍団の攻撃力が5%上昇します。',ranged:'軍団に編成すると攻撃力が4%上昇します。',strategist:'伏兵を選んだ合戦で、軍団の攻撃力が8%上昇します。',administrator:'奉行に任命すると、政治力による施設補正に5%分を追加します。',farmer:'兵糧カテゴリの施設の奉行に任命すると、政治力による兵糧生産補正に10%分を追加します。',merchant:'商業カテゴリの施設の奉行に任命すると、政治力による金銭生産補正に10%分を追加します。',engineer:'木材・石材・防衛・研究カテゴリの施設の奉行に任命すると、政治力による施設補正に10%分を追加します。',medic:'軍団に編成すると、合戦で失う自軍の兵数を10%軽減します。'};
  const governorHelp={keep:'政治力に応じて武将の登用費用を軽減します。',farm:'政治力に応じて毎月の兵糧生産量を増やします。',market:'政治力に応じて毎月の金銭収入を増やします。',lumber:'政治力に応じて毎月の木材生産量を増やします。',quarry:'政治力に応じて毎月の石材生産量を増やします。',barracks:'政治力に応じて出陣兵の上限を増やし、募兵費用を軽減します。',wall:'政治力に応じて本拠の防衛力を高めます。',academy:'政治力に応じて研究に必要な金銭・木材・石材を軽減します。'};
  const skillIcons={commander:'flag',cavalry:'swords',infantry:'shield',ranged:'target',strategist:'book',administrator:'scroll',farmer:'wheat',merchant:'coins',engineer:'castle',medic:'plus'};
  const saveKey='sengoku-tento-save-v2', settingsKey='sengoku-tento-settings-v1', backupKey='sengoku-cloud-backups-v1';
  let linkedAtStart=false;try{linkedAtStart=!!JSON.parse(localStorage.getItem('sengoku-online-identity-v1')||'null')?.token;}catch(_){}
  let syncAccess={linked:linkedAtStart,ready:!linkedAtStart,writable:!linkedAtStart,rolePending:linkedAtStart,reason:linkedAtStart?'pending':'local',message:linkedAtStart?'クラウドの最新データを確認しています。':'この端末に保存しています。'};
  let pendingRoleSave=null;
  let evaluationOwnerId='';
  const mutationActions=new Set(['toggle-time','upgrade','upgrade-castle','build-branch','upgrade-branch','repair-branch','build-branch-facility','upgrade-branch-facility','attack-branch','claim-quest','draw-officers','recruit-officer','scout','diplomacy','attack','assign-army','remove-army','assign-governor','remove-governor','auto-governors','recruit-troops','train','research','confirm-import','restore-admin-assets']);
  const roster=window.SENGOKU_OFFICERS||[], data=window.SENGOKU_DATA;
  const staffBaseId=data.staffBaseId||'kyoto_gosho';
  let worldCatchingUp=false,worldCatchupTimer=null,worldClockStatusKey='',fieldActionPending=false,walkingActionPending=false,strategyActionPending=false,startPending=false,interactionEpoch=0,worldSettlementPending=false,worldSettlementRetryAt=0,renderedNavigation='',renderedSyncBanner='',staffBaseReady=false,roleEpoch=0,localWalkingContext=null,strategyEpoch=0,strategyRun=null;
  const interactionRestores=new WeakMap();
  for(const type of ['pointerdown','wheel','touchstart','touchmove','keydown'])document.addEventListener(type,()=>{interactionEpoch++;},{capture:true,passive:true});
  document.addEventListener('pointermove',event=>{if(event.buttons)interactionEpoch++;},{capture:true,passive:true});
  let newResidencyMode='lord',newResidencyDirectory=null,newResidencyLoading=false,newResidencyError='',residencyStartPending=false,newGameGeneration=0;
  let newStartCastle='',game,saveEnabled=true,saveWarning='',currentView='town',filter={q:'',clan:'all',ownership:'all',sort:'lead',direction:'desc',rank:'all',skill:'all',assignment:'all',page:1},selectedCastle='',toastTimer,activeModal='',activeModalContext=null,battleTarget='',battleBranchTarget='',battleTactic='balanced',battleTroops=0,newClan='織田家',mapZoom=1,mapRegion='all',mapQuery='',facilityCategory='all',facilityQuery='',officerSection='archive',gachaOddsRank='D',gachaOddsPage=1,facilityPage=1,territoryPage=1,questPage=1,logPage=1,gachaHistoryPage=1,choicePage=1,choiceMode='army',choiceTarget='',musicPage=1,crestPage=1,crestQuery='';
  const officerPreferencesKey='sengoku-officer-filters-v1';
  let choiceFilters={army:officerFilterDefaults('army'),governor:officerFilterDefaults('governor')},gachaPresentation=null,gachaDrawing=false;
  try{const saved=JSON.parse(localStorage.getItem(officerPreferencesKey)||'{}');filter=normalizeOfficerFilter(saved.archive,'archive');choiceFilters.army=normalizeOfficerFilter(saved.army,'army');choiceFilters.governor=normalizeOfficerFilter(saved.governor,'governor');}catch(_){}
  let settings={sound:false,volume:10,tips:true,townFacilitiesExpanded:false,townLegendExpanded:false,musicMode:'auto',track:''};
  try{settings={...settings,...JSON.parse(localStorage.getItem(settingsKey)||'{}')};}catch(_){}
  settings.sound=false;
  try{const raw=localStorage.getItem(saveKey);startPending=raw===null;if(linkedAtStart&&raw!==null)pendingRoleSave=raw;game=raw!==null?SengokuEngine.fromSave(raw,roster):new SengokuEngine({clan:'織田家',officers:roster});}catch(e){game=new SengokuEngine({clan:'織田家',officers:roster});saveWarning='保存を読み込めなかったため、自動保存を止めて仮プレイを開始しました。既存の保存データは上書きしていません。新しい物語やセーブ読込を確定すると置き換わります。';saveEnabled=false;}
  if(!game?.state){$('#main').innerHTML='<div class="loading-screen">ゲームの読み込みに失敗しました。再読み込みしてください。</div>';return;}
  const state=()=>game.state;
  function clanInfo(){return game.isAdmin?data.adminClan:game.isStaff?data.staffClan:data.clans.find(c=>c.name===state().clan)||data.clans[0];}
  function date(turn){if(turn===undefined)turn=window.SengokuWorldClock?.snapshot().clock?.calendar?.turn??state().turn;const calendar=game.calendar(turn);return {...calendar,season:['冬','春','春','春','夏','夏','夏','秋','秋','秋','冬','冬'][turn%12]};}
  function shortDate(turn=state().turn){const d=date(turn);return `${d.year}年${d.month}月`;}
  function constructionJobs(){return game.constructionJobs?.()||state().jobs;}
  function currentJob(kind,id,scope,targetLevel){const shared=scope?scope==='shared':game.isStaff&&(kind==='building'||kind==='castle'&&id===staffBaseId);return constructionJobs().filter(j=>j.kind===kind&&j.id===id&&Boolean(j.shared)===Boolean(shared)&&(!targetLevel||j.targetLevel===Number(targetLevel))).sort((a,b)=>a.targetLevel-b.targetLevel)[0];}
  function constructionCount(shared=false){return new Set(constructionJobs().filter(j=>j.kind!=='research'&&Boolean(j.shared)===shared).map(j=>`${j.kind}:${j.id}`)).size;}
  function buildingChain(id){return constructionJobs().filter(j=>j.kind==='building'&&j.id===id&&Boolean(j.shared)===Boolean(game.isStaff)).sort((a,b)=>a.targetLevel-b.targetLevel);}
  function buildingTailLevel(id){return Math.max(state().buildings[id]||0,...buildingChain(id).map(j=>j.targetLevel));}
  function jobKey(job){return `${job.kind}:${job.id}:${job.shared?'shared':'personal'}:${job.targetLevel}`;}
  function castleLevelLimit(id){return game.castleLevelLimit?.(id)||(id===staffBaseId?128:id==='edo'?64:['nijo','osaka','nagoya'].includes(id)?48:32);}
  function staffConstructionReady(){return game.isStaff&&staffBaseReady&&Boolean(game.getStaffBase?.());}
  function safeSettings(){try{localStorage.setItem(settingsKey,JSON.stringify(settings));}catch(_){}}
  function confirmedWorldClock(){const shared=window.SengokuWorldClock?.snapshot();return shared?.ready&&shared.clock?{...shared.clock,elapsedMs:shared.clock.confirmedElapsedMs??shared.clock.elapsedMs}:null;}
  function clockIsApplied(){if(!window.SengokuWorldClock)return true;const clock=confirmedWorldClock(),anchor=game?.state?.worldClock;return Boolean(clock&&anchor?.id===clock.id&&anchor.elapsedMs>=clock.elapsedMs&&anchor.elapsedMs<=clock.elapsedMs+5000);}
  function queueWorldProgress(){if(worldCatchupTimer===null)worldCatchupTimer=setTimeout(processWorldClock,0);}
  function canMutate(ignoreClock=false,allowSetup=false,allowStrategy=false){const lease=!syncAccess.linked||(syncAccess.ready&&syncAccess.writable&&(!syncAccess.leaseExpiresAt||Date.parse(syncAccess.leaseExpiresAt)>Date.now()+1000));return !syncAccess.banned&&lease&&!syncAccess.rolePending&&!fieldActionPending&&!walkingActionPending&&(!strategyActionPending||allowStrategy)&&!worldSettlementPending&&(allowSetup||!startPending)&&(ignoreClock||!worldCatchingUp&&clockIsApplied());}
  function canStartNew(){return canMutate(true,true)&&!worldCatchingUp&&(!game.isStaff||staffConstructionReady())&&(!window.SengokuWorldClock||Boolean(confirmedWorldClock()));}
  function syncMessage(){return syncAccess.banned?(syncAccess.message||'この領主は利用を停止されています。'):syncAccess.rolePending?'領主の権限を確認しています。確認が終わるまで操作と保存を待機しています。':worldSettlementPending?'占領した拠点の集計と報酬を同期しています。':syncAccess.message||(syncAccess.writable?'この端末で進行中 · 自動同期しています。':'他端末の進行を表示中です。「端末同期」から操作端末を切り替えられます。');}
  function requireWritable(){if(syncAccess.banned){toast(syncMessage(),true);return false;}if(canMutate())return true;toast(worldSettlementPending?'占領した拠点の集計と報酬を同期しています。':startPending?'はじめに本拠の城を一つ選んでください。以前の進行がある場合は、引き継ぎ・復元から再接続できます。':fieldActionPending?'共通フィールド・資産・共同普請の結果を同期しています。':worldCatchingUp||window.SengokuWorldClock?.snapshot().ready&&!clockIsApplied()?'共通時刻までの進行を反映しています。':window.SengokuWorldClock&&!window.SengokuWorldClock.snapshot().ready?window.SengokuWorldClock.snapshot().message:syncMessage(),true);return false;}
  function save({allowClockCatchup=false,allowStrategy=false}={}){const indicator=$('#save-indicator');if(startPending){if(indicator)indicator.textContent='開始する城を選択してください';return false;}if(!canMutate(allowClockCatchup,false,allowStrategy)){if(indicator)indicator.textContent=syncAccess.banned?'利用停止中':syncAccess.ready?'クラウドの進行を表示中':'クラウドを確認中';return false;}if(!saveEnabled){if(indicator)indicator.textContent='自動保存できません';return false;}try{localStorage.setItem(saveKey,game.exportSave());if(indicator)indicator.textContent=syncAccess.linked?'端末に保存 · 同期中':'端末に自動保存済み';window.dispatchEvent(new CustomEvent('sengoku:game-saved'));return true;}catch(e){saveEnabled=false;saveWarning='このブラウザでは保存領域を利用できません。「保存・設定」でセーブを書き出してください。';if(indicator)indicator.textContent='セーブ書き出しを推奨';toast(saveWarning,true);return false;}}
  function getGameSave(){if(startPending)return null;if(!saveEnabled)throw Error('元のセーブを読み込み・保存できないため、仮の進行は同期しません。');return JSON.parse(syncAccess.rolePending&&pendingRoleSave?pendingRoleSave:game.exportSave());}
  function getStoredSave(){const raw=localStorage.getItem(saveKey);return raw===null?null:JSON.parse(raw);}
  function syncBanner(){return syncAccess.linked?`<div id="sync-access-notice" class="sync-access-notice ${canMutate()?'sync-writable':'sync-readonly'}" role="status"><span>${icon(canMutate()?'check':'lock')}<span>${esc(syncMessage())}</span></span><button class="button small" data-action="open-sync">${syncAccess.banned?'利用状態を確認':'端末同期'}</button></div>`:'';}
  function getHints(){
    const unavailable={status:'blocked',title:'次の一手を確認しています',summary:'ヒントを読み込めない場合は、画面を再読み込みするか「遊び方」をご覧ください。',items:[]};
    if(!window.SengokuHints?.build||!game?.state)return unavailable;
    const shared=window.SengokuWorldClock?.snapshot(),busy=worldSettlementPending?'占領した拠点の集計と報酬を同期しています。':fieldActionPending||walkingActionPending||strategyActionPending?'実行中の操作の結果を確認しています。完了後にヒントを更新します。':'';
    const model=window.SengokuHints.build(game,{started:!startPending,writable:canMutate(),banned:syncAccess.banned===true,rolePending:syncAccess.rolePending===true,syncLinked:syncAccess.linked===true,syncReady:syncAccess.ready===true,syncReason:syncAccess.reason,syncMessage:busy||syncMessage(),staffReady:!game.isStaff||staffConstructionReady(),clockReady:!window.SengokuWorldClock||Boolean(shared?.ready&&clockIsApplied()&&!worldCatchingUp),saveEnabled});
    return {...model,scope:[window.SengokuSocial?.getUser?.()?.id||'local',roleEpoch,startPending?'start':'playing',state().home].join(':')};
  }
  function followHint(id){
    const item=getHints().items.find(item=>item.id===id),action=item?.action;
    if(!action)return{ok:false,message:'状況が変わりました。更新されたヒントをご確認ください。'};
    const views=['town','facilities','map','field','roaming','covert','court','officers','crests','army','research','council'];let open;
    switch(action.kind){
      case 'view':if(views.includes(action.view))open=()=>go(action.view);break;
      case 'building':if(data.buildings.some(building=>building.id===action.id))open=()=>buildingModal(action.id);break;
      case 'castle':{const castle=game.castle(action.id);if(castle&&game.canOwnCastle?.(castle.id)!==false)open=()=>{if(castle.owner===state().clan)castleUpgradeModal(castle.id);else{selectedCastle=castle.id;go('map');}};break;}
      case 'level-guide':open=()=>levelGuideModal(state().home);break;
      case 'sync':if(window.SengokuSocial?.open)open=()=>window.SengokuSocial.open('sync');break;
      case 'new':if(startPending||state().gameOver)open=newGameModal;break;
      case 'settings':open=settingsModal;break;
      case 'gacha':open=()=>{officerSection='gacha';go('officers');};break;
      case 'army-slot':{const slot=Number(action.id);if(Number.isInteger(slot)&&slot>=0&&slot<3)open=()=>pickOfficer('army',slot);break;}
    }
    if(!open)return{ok:false,message:'案内先を確認できませんでした。「遊び方」から手順をご確認ください。'};
    window.SengokuHintsUI?.close?.();closeModal();open();return{ok:true};
  }
  function openHintHelp(){window.SengokuHintsUI?.close?.();closeModal();helpModal();}
  function backupCurrentSave(reason='cloud',runtime=false){const raw=runtime&&!startPending?game.exportSave():localStorage.getItem(saveKey)||(startPending?null:game.exportSave());if(!raw)return;const entries=JSON.parse(localStorage.getItem(backupKey)||'[]');const list=Array.isArray(entries)?entries:[];if(list[0]?.save===raw)return;list.unshift({savedAt:new Date().toISOString(),reason,save:raw});localStorage.setItem(backupKey,JSON.stringify(list.slice(0,5)));}
  function exportSyncBackup(){try{const list=JSON.parse(localStorage.getItem(backupKey)||'[]');if(!list.length){toast('同期前のバックアップはまだありません。');return;}downloadBlob(new Blob([list[0].save],{type:'application/json'}),'sengoku-vs-before-sync.json');toast('直近の同期・読込前のセーブを書き出しました。「セーブデータを読み込む」から復元できます。');}catch(_){toast('バックアップを読み出せませんでした。',true);}}
  function toast(message,error=false){clearTimeout(toastTimer);const el=$('#toast');el.textContent=message;el.className=`toast show${error?' error':''}`;toastTimer=setTimeout(()=>el.classList.remove('show'),5200);}
  function closeModal(){clearGachaPresentation();const m=$('#modal');if(m.open)m.close();activeModal='';activeModalContext=null;syncMusic();}
  function modal(title,subtitle,body,footer='',kind='',context=null){if(kind!=='gacha-animation'&&kind!=='gacha-result')clearGachaPresentation();activeModal=kind;activeModalContext=context;$('#modal').classList.toggle('gacha-modal',kind==='gacha-result'||kind==='gacha-odds'||kind==='gacha-animation');$('#modal').classList.toggle('start-castle-modal',kind==='new');$('#modal').classList.toggle('level-guide-modal',kind==='level-guide');$('#modal').classList.toggle('player-evaluation-modal',kind==='player-evaluation');if(!$('#modal').open)window.SengokuStableDOM?.forget($('#modal-content'));patchHTML($('#modal-content'),`<header class="modal-header"><div><h2>${esc(title)}</h2>${subtitle?`<p>${esc(subtitle)}</p>`:''}</div><button class="icon-button" data-action="close" aria-label="閉じる">${icon('close')}</button></header><div class="modal-body">${body}</div>${footer?`<footer class="modal-footer">${footer}</footer>`:''}`,{key:[kind,context?.id,context?.mode,context?.target,context?.rank,context?.kind]});if(!$('#modal').open)$('#modal').showModal();refreshLiveControls();refreshJobTimers();}
  function perform(result,{close=true,quiet=false}={}){if(!result?.ok){toast(result?.message||'実行できませんでした。',true);return false;}if(close)closeModal();save();render();playNote(659,.075);if(!quiet)toast(result.message);return true;}
  function hasResources(cost){return Object.keys(resNames).every(k=>state().resources[k]>=(cost?.[k]||0));}
  function costHtml(cost){
    const budget=state(),amounts={...budget.resources,magatama:budget.magatama};
    const items=Object.entries({...resNames,magatama:'勾玉'}).filter(([key])=>cost?.[key]>0).map(([key,name])=>{
      const amount=cost[key],missing=Math.max(0,amount-amounts[key]);
      return `<span data-cost-resource="${key}" data-cost-amount="${amount}" class="${key==='magatama'?'magatama-cost ':''}${missing?'insufficient':''}">${icon(key==='magatama'?'magatama':resIcons[key])}${name} ${num(amount)}<small data-cost-shortage>${missing?`（あと${num(missing)}）`:''}</small></span>`;
    });
    if(cost?.turns)items.push(`<span>${icon('calendar')}${cost.seconds||cost.turns*60}秒（1倍速）</span>`);
    return `<div class="cost">${items.join('')}</div>`;
  }
  const navSections = [
    ['城と内政', [['town','castle','城下町'], ['facilities','castle','城下普請帳'], ['research','book','技術研究'], ['court','scroll','京都御所']]],
    ['合戦と天下', [['map','map','天下地図'], ['field','flag','共通フィールド'], ['roaming','swords','野良兵戦'], ['covert','eye','派遣部隊']]],
    ['武将と軍団', [['officers','users','武将名鑑'], ['army','swords','軍団編成'], ['crests','flag','家紋帳']]],
    ['軍議と記録', [['council','scroll','軍議'], ['progress','book','成長手帳','dialog'], ['shogunate','scroll','幕府の記録','dialog']]],
    ['同盟と合戦', [['events','calendar','期間限定合戦','dialog'], ['alliance-strategy','flag','同盟作戦','dialog'], ['conquest','castle','共有天下統一','dialog']]]
  ];
  function nav(){
    const markup=navSections.map(([title,items],index)=>{
      const links=items.map(([id,symbol,label,kind])=>{
        const target=kind==='dialog'?`data-action="${id}" aria-haspopup="dialog"`:`data-view="${id}"`;
        const active=kind!=='dialog' && currentView===id && !startPending;
        let count='';
        if(id==='officers')count=`<span class="nav-count">${state().officers.length}</span>`;
        if(id==='events')count='<span class="nav-count" data-events-status hidden></span>';
        return `<button class="nav-item${active?' active':''}" ${target}${active?' aria-current="page"':''}>${icon(symbol)}<span>${label}</span>${count}</button>`;
      }).join('');
      return `<section class="nav-chapter" aria-labelledby="nav-chapter-${index}"><h2 class="nav-section-name" id="nav-chapter-${index}">${title}</h2>${links}</section>`;
    }).join('');
    if(markup!==renderedNavigation){patchHTML($('#navigation'),markup);renderedNavigation=markup;}
  }
  function clanCrest(name,size=36){name=name==='德川家'?'徳川家':name;return window.SengokuKamon?.render(name,{size,className:'clan-kamon'})||`<span class="mon" title="${esc(name)}">${esc(name.slice(0,1))}</span>`;}
  function officerCrest(o){if(!o)return `<span class="avatar officer-kamon is-empty" role="img" aria-label="武将未任命">${icon('plus')}</span>`;const crest=window.SengokuKamon?.render(o.clan,{size:48,className:'officer-house-kamon'})||'<img src="assets/kamon/unaffiliated.svg" alt="" width="48" height="48">';return `<span class="avatar officer-kamon" role="img" aria-label="${esc(o.name==='德川家康'?'徳川家康':o.name)}・${esc(o.clan==='德川家'?'徳川家':o.clan)}の家紋" title="${esc(o.name==='德川家康'?'徳川家康':o.name)} · ${esc(o.clan==='德川家'?'徳川家':o.clan)} · ${esc(o.rank)}"><span aria-hidden="true">${crest}</span></span>`;}
  function pageControls(action,page,pages,label=''){return `<div class="pagination"><button class="button small" data-action="${action}" data-delta="-1" ${page<=1?'disabled':''}>前の頁</button><span>${label?`${esc(label)} · `:''}${page} / ${pages}</span><button class="button small" data-action="${action}" data-delta="1" ${page>=pages?'disabled':''}>次の頁</button></div>`;}
  function crestResults(){const all=window.SengokuKamon?.entries()||[],list=all.filter(c=>!crestQuery||[c.clan,c.name,c.motif,c.crestName].filter(Boolean).join(' ').includes(crestQuery)),pages=Math.max(1,Math.ceil(list.length/20));crestPage=Math.max(1,Math.min(crestPage,pages));return `<div class="section-heading"><small>${list.length}勢力の家紋・群章</small><small>代表的な意匠を描き起こし</small></div><div class="kamon-catalog">${list.slice((crestPage-1)*20,crestPage*20).map(c=>`<button class="kamon-entry" data-action="crest-detail" data-id="${esc(c.clan)}">${clanCrest(c.clan,62)}<b>${esc(c.clan)}</b><small>${esc(c.name||c.crestName||c.motif||'勢力の紋')}</small></button>`).join('')||'<div class="empty">条件に合う家紋はありません。</div>'}</div>${pageControls('crest-page',crestPage,pages)}`;}
  function renderCrests(){return heading('諸家の家紋帳','FAMILY CRESTS · 旗に宿る系譜','城と武将、それぞれの家を表す紋をたどる。')+`<div class="toolbar"><div class="search-box">${icon('search')}<input class="input" id="crest-search" type="search" value="${esc(crestQuery)}" placeholder="家名・紋の名前を検索" aria-label="家紋を検索"></div><button class="button" data-view="officers">${icon('users')}武将名鑑へ</button></div><div id="crest-results">${crestResults()}</div><p class="notice">家紋には時代・分家による異形があります。ここでは各家の代表的な意匠をゲーム用に整理しています。「諸家」「在地衆」などは集合勢力の群章です。各紋を押すと採用理由・出典を確認できます。</p>`;}
  function crestModal(clan){const c=(window.SengokuKamon?.entries()||[]).find(x=>x.clan===clan);if(!c)return;modal(`${clan}の紋`,c.name||c.crestName||c.motif||'勢力の意匠',`<div class="crest-detail-art">${clanCrest(clan,176)}</div><p>${esc(c.note||c.description||'同家の代表的な意匠を、画面上で識別しやすい形に描き起こしています。')}</p>${c.status?`<div class="notice">${esc(c.kind==='group'?'複数家を表す創作群章':({documented:'資料に基づく代表家紋',traditional:'伝承意匠を基にしたゲーム用の図案',unverified:'系統の同定が難しいため識別章を採用'})[c.status]||c.status)}</div>`:''}<p class="subtitle">家紋は時代や分家により細部が異なります。ゲームにおける家名と人物の所属も、複数年代を合わせた設定です。</p><ul class="about-links">${(window.SengokuKamon?.getSources?.()||[]).filter(source=>(c.sourceIds||[]).includes(source.id)).map(source=>`<li><a href="${esc(source.url)}" target="_blank" rel="noopener">${esc(source.title)}</a></li>`).join('')}</ul><p class="subtitle">詳しい出典と図案の整理は <a href="SOURCES-KAMON.md" target="_blank" rel="noopener">家紋の出典資料</a> に記載しています。</p>`,`<button class="button primary" data-action="close">家紋帳へ戻る</button>`,'crest');}
  function refreshTouchHeaderStatus(){
    const summary=$('#touch-header-status');if(!summary)return;
    if(summary.hidden!==startPending)summary.hidden=startPending;
    if(startPending)return;
    const s=state(),maximum=game.commandMax();
    const write=(selector,value)=>{const node=$(selector),text=String(value);if(node&&node.textContent!==text)node.textContent=text;};
    const label=(selector,value)=>{const node=$(selector);if(node&&node.getAttribute('aria-label')!==value)node.setAttribute('aria-label',value);};
    write('#touch-command-count',num(s.command));write('#touch-command-limit',num(maximum));
    write('#touch-magatama-balance',num(s.magatama));
    label('#touch-command-info',`指令 ${num(s.command)} / ${num(maximum)}。共通時間を確認`);
    label('#touch-magatama-info',`勾玉 ${num(s.magatama)}。武将招集を開く`);
  }
  function getEvaluation(){
    if(startPending||syncAccess.rolePending||!game.evaluation)return null;
    // A changed account name may arrive before its campaign. Only the ready
    // cloud session that confirmed this owner may label the current game.
    if(syncAccess.linked){const owner=String(window.SengokuSocial?.getUser?.()?.id||'');if(!syncAccess.ready||!owner||owner!==evaluationOwnerId)return null;}
    return game.evaluation();
  }
  function evaluationCourtPlayer(evaluation){const user=evaluation&&syncAccess.linked&&syncAccess.ready?window.SengokuSocial?.getUser?.():null;return user&&!user.isBanned&&String(user.id)===evaluationOwnerId?String(user.id):'';}
  function evaluationCourtSlot(evaluation){const id=evaluationCourtPlayer(evaluation);return id?window.SengokuPublicCourt?.selfSlot?.(id)||'':'';}
  function evaluationDescription(evaluation){const label=window.SengokuEvaluationUI?.label(evaluation),office=window.SengokuPublicCourt?.selfText?.(evaluationCourtPlayer(evaluation));return label?`総合評価を見る。${label}${office?`。役職 ${office}`:''}`:'総合評価を確認';}
  function evaluationEntryContent(evaluation){const rank=window.SengokuEvaluationUI?.badge(evaluation);return `<span class="player-evaluation-entry-label">総合評価</span>${rank?`<span class="player-evaluation-current">${rank}${evaluationCourtSlot(evaluation)}</span>`:'<span class="player-evaluation-entry-pending">確認中</span>'}`;}
  function evaluationEntry(){if(startPending)return '';const evaluation=getEvaluation();return `<button class="player-evaluation-entry" data-action="player-evaluation" data-player-evaluation-self aria-label="${esc(evaluationDescription(evaluation))}">${evaluationEntryContent(evaluation)}</button>`;}
  function evaluationModalKey(evaluation){const user=syncAccess.linked&&evaluation?window.SengokuSocial?.getUser?.():null;return JSON.stringify([evaluation,user?.id||'',user?.name||'',syncAccess.linked,startPending,window.SengokuPublicCourt?.selfText?.(evaluationCourtPlayer(evaluation))||'']);}
  function refreshEvaluationUI(){
    const evaluation=getEvaluation(),markup=evaluationEntryContent(evaluation),description=evaluationDescription(evaluation);
    document.querySelectorAll('[data-player-evaluation-self]').forEach(node=>{patchHTML(node,markup);if(node.getAttribute('aria-label')!==description)node.setAttribute('aria-label',description);node.hidden=startPending;});
    if(activeModal==='player-evaluation'&&$('#modal')?.open&&activeModalContext?.key!==evaluationModalKey(evaluation))preserveInteraction($('#modal-content'),showEvaluation);
  }
  function showEvaluation(){
    const evaluation=getEvaluation(),key=evaluationModalKey(evaluation),expanded=activeModal==='player-evaluation'&&Boolean($('#player-evaluation-ranks')?.open),user=syncAccess.linked&&evaluation?window.SengokuSocial?.getUser?.():null;
    let body,subtitle='現在の進行から、あなたの位階を評価します。';
    if(!evaluation){subtitle=startPending?'本拠を選ぶと評価が始まります。':'領主と最新の進行を確認しています。';body=`<div class="player-evaluation-body player-evaluation-pending"><p>${startPending?'物語を始めると、領国・内政・武将など7項目の成長に応じて位階が付きます。':'同期が完了すると、現在の領主の総合評価と位階を表示します。'}</p></div>`;}
    else{
      subtitle=`${user?.name?user.name+' · ':''}${state().clan}の現在の評価`;
      const percent=Math.max(0,Math.min(100,Number(evaluation.progressPercent)||0)),next=evaluation.nextRank;
      const rankBadge=`<span class="player-evaluation-current">${window.SengokuEvaluationUI?.badge(evaluation)||`<b>${esc(evaluation.rankName)}</b>`}${evaluationCourtSlot(evaluation)}</span>`,identityMarkup=user?`<span class="player-evaluation-person">${window.SengokuAvatar?.markup?.(user,'inline')||''}<span class="player-evaluation-name" data-premium-player="${esc(user.id)}" data-premium-player-name="${esc(user.name)}">${window.SengokuPremiumRuntime?.nameMarkup?.(user.name,user.appearance)||esc(user.name)}</span>${rankBadge}</span>`:rankBadge;
      body=`<div class="player-evaluation-body"><section class="player-evaluation-summary" aria-label="現在の位階と総合評価"><div class="player-evaluation-summary-top">${identityMarkup}<div class="player-evaluation-score">${num(evaluation.score)}<small> / ${num(evaluation.maxScore)} 点</small></div></div><p class="player-evaluation-next">${next?`次の位階 <strong>${esc(next.name)}</strong> まで、あと <strong>${num(evaluation.toNext)}点</strong>`:'最高位の正一位に到達しています。'}</p><div class="player-evaluation-meter" role="progressbar" aria-label="次の位階までの進捗" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}" aria-valuetext="${esc(next?`${next.name}まであと${num(evaluation.toNext)}点`:'最高位に到達')}"><i style="width:${percent}%"></i></div></section><p class="player-evaluation-notice">位階は、現在の領国・施設・武将・編成などを7項目で総合した称号です。領地や軍団・奉行が変わると評価も変わり、位階は上がることも下がることもあります。所持資源・残兵・消費額・発言数は点数に含めません。</p><div class="player-evaluation-breakdown">${evaluation.breakdown.map(item=>`<section class="player-evaluation-category" data-evaluation-category="${esc(item.id)}"><h3>${esc(item.name)}</h3><div class="player-evaluation-category-score"><b>${num(item.score)}</b><small> / ${num(item.maxScore)} 点</small></div><div class="player-evaluation-meter" aria-hidden="true"><i style="width:${Math.max(0,Math.min(100,item.score/Math.max(1,item.maxScore)*100))}%"></i></div><p>${esc(item.description)}</p></section>`).join('')}</div><details id="player-evaluation-ranks" class="player-evaluation-ranks"${expanded?' open':''}><summary>全17段階の位階と必要な総合評価</summary><ol class="player-evaluation-rank-list">${(data.evaluationRanks||[]).map(rank=>`<li${rank.id===evaluation.rankId?' aria-current="step"':''}><b>${esc(rank.name)}${rank.id===evaluation.rankId?' · 現在':''}</b><span>${num(rank.minScore)} 点〜</span></li>`).join('')}</ol></details>${syncAccess.linked?'<p class="player-evaluation-notice">他の領主に表示される位階は、最新の保存を同期した後に更新されます。</p>':''}</div>`;
    }
    modal('総合評価・位階',subtitle,body,'<button class="button" data-view="court">京都御所へ出向く</button><button class="button primary" data-action="close">ゲームへ戻る</button>','player-evaluation',{key});
  }
  function renderHeader(){refreshTouchHeaderStatus();refreshEvaluationUI();if(startPending){const d=date();patchHTML($('#calendar'),`<b>${d.year}年 ${d.month}月</b><span>全員共通の暦</span>`);patchHTML($('#resources'),'<span class="start-campaign-status">本拠を選んで、新たな物語へ</span>');patchHTML($('#clan-panel'),'<div class="clan-line">'+icon('flag')+'<div><b>出陣の準備</b><small>本拠はまだ確定していません</small></div></div>');patchHTML($('#sound-button'),icon(settings.sound?'sound':'mute'));return;}const s=state(),d=date(),inc=game.income(),owned=game.ownedCastles().length,shared=window.SengokuWorldClock?.snapshot(),clock=shared?.clock;patchHTML($('#calendar'),`<b>${d.year}年 ${d.month}月<span class="season-symbol">${d.season}</span></b><span>${shared?.mode==='offline'?'オフライン版':shared?.ready?(clock?.running?'共通時間':'共通時間は停止中'):'時刻を確認中'} · <i id="month-countdown" style="font-style:normal">${Math.ceil((60-(clock?.calendar?.elapsed??s.realtime?.elapsed??0))/(clock?.speed||1))}</i>秒</span>`);patchHTML($('#resources'),Object.keys(resNames).map(k=>`<div class="resource" title="${resNames[k]}：毎月 ${inc[k]>=0?'+':''}${num(inc[k])}"><span>${icon(resIcons[k],k)}</span><div><div class="resource-label">${resNames[k]}</div><div class="resource-amount">${num(s.resources[k])}<small class="resource-gain">${inc[k]>=0?'+':''}${num(inc[k])}</small></div></div></div>`).join(''));patchHTML($('#clan-panel'),`<div class="clan-line">${clanCrest(s.clan,42)}<div><b>${esc(s.clan==='德川家'?'徳川家':s.clan)}</b><small>${esc(clanInfo().leader==='德川家康'?'徳川家康':clanInfo().leader)} の治世</small></div></div><div class="clan-progress"><i style="width:${owned/(game.unificationTarget?.()||data.castles.length)*100}%"></i></div><div class="clan-progress-label"><span>天下統一</span><span>${owned} / ${game.unificationTarget?.()||data.castles.length} 城</span></div>${evaluationEntry()}`);patchHTML($('#sound-button'),icon(settings.sound?'sound':'mute'));$('#sound-button').setAttribute('aria-label',settings.sound?'BGMを停止':'BGMを再生');}
  function heading(title,en,subtitle,castleId=''){
    const s=state(),shared=window.SengokuWorldClock?.snapshot(),clock=shared?.clock;
    const rt=clock?{running:clock.running,speed:clock.speed,elapsed:clock.calendar.elapsed}:s.realtime;
    const view=typeof currentView==='string'?currentView:'town';
    const symbols={town:'castle',facilities:'castle',map:'map',field:'flag',officers:'users',crests:'flag',army:'swords',research:'book',council:'scroll'};
    const tools={army:['army','5編成の保存・比較'],officers:['officers','武将の熟練・確定交換'],council:['missions','日次・週次任務']}[view];
    const copy=`<div class="eyebrow"><span class="chapter-symbol" aria-hidden="true">${icon(symbols[view]||'castle')}</span>${en}</div><h1>${title}</h1><p class="subtitle">${subtitle}</p>`;
    const upgrade=castleId?homeCastleUpgrade(castleId):null;
    const chapterCopy=upgrade
      ? `<div class="town-castle-heading"><div class="town-castle-heading-row"><div class="town-castle-heading-copy">${copy}</div>${upgrade.action}</div>${upgrade.detail}</div>`
      : `<div class="chapter-copy">${copy}</div>`;
    const pips=Array.from({length:game.commandMax()},(_,i)=>`<i class="${i<s.command?'filled':''}"></i>`).join('');
    const status=esc(worldCatchingUp?'共通時刻までの進行を反映中':shared?.message||'共通時刻を確認しています。');
    const actions=`<div class="page-heading-actions">${evaluationEntry()}<div class="commands">指令 <span id="command-count">${s.command}</span><div class="command-pips" id="command-pips">${pips}</div></div><button class="button gold" data-action="world-clock-info">${icon('calendar')}${shared?.mode==='offline'?'オフライン時間':'共通時間'}${game.isAdmin?'・管理':''}</button></div>`;
    const chapter=`<header class="page-heading">${chapterCopy}${actions}${upgrade?'':'<div class="chapter-plate" aria-hidden="true"></div>'}</header>`;
    const ledger=`<div class="realtime-strip"><span id="shared-world-status" class="live-state ${shared?.ready&&rt.running?'running':''}">${status}</span><button class="currency-chip" data-action="open-gacha" aria-label="勾玉を確認して武将招集へ">${icon('magatama')}<span>勾玉</span><b data-magatama-balance>${num(s.magatama)}</b></button><div class="time-track"><i id="month-progress" style="width:${(rt.elapsed||0)/60*100}%"></i></div><span class="shared-time-speed">${rt.speed||1}倍 · 1560〜1615年を周回</span></div>`;
    const related=tools?`<div class="expansion-entry"><button class="button gold" data-action="progress" data-tab="${tools[0]}">${tools[1]}</button><button class="button" data-action="progress" data-tab="analysis">合戦の試算・分析</button></div>`:'';
    return chapter+ledger+related;
  }
  function worldClockModal(){const shared=window.SengokuWorldClock?.snapshot(),clock=shared?.clock,d=date();modal('全プレイヤー共通の時間',`${d.year}年${d.month}月`, `<div class="world-clock-summary"><span>${icon('calendar')}</span><strong>1560年1月 → 1615年12月 → 1560年1月</strong><p>全プレイヤーが同じ年月を共有します。1倍速では実時間60秒がゲーム内の1か月。暦が一周すると占領した拠点を集計し、本拠以外の領地は初期配置に戻ります。最初に選んだ本拠へ戻ります。固定本拠と共同拠点は、その城を維持します。武将・施設・資源、本拠の城郭レベルは引き継ぎます。</p><p>画面を閉じていても世界の時間は進み、再接続時に生産・普請・研究・月次処理が共通時刻へ追いつきます。区切りの時点で所有している本拠以外の城1つにつき、勾玉100・金銭1,000・兵糧1,000を一度だけ受け取れます。同盟・偵察と、本拠以外で進行中の城郭拡張はリセットされます。</p>${state().cycle?.latestReward?`<div class="notice cycle-reward-summary"><strong>前回の占領報酬</strong><p>対象 ${num(state().cycle.latestReward.captured)}城 · 勾玉 ${num(state().cycle.latestReward.magatama)} · 金銭 ${num(state().cycle.latestReward.gold)} · 兵糧 ${num(state().cycle.latestReward.rice)}</p></div>`:''}<div class="notice">${esc(shared?.message||'共通時刻を確認しています。')}${shared?.mode==='offline'?' このローカル環境では端末内の時間で進行します。':''}</div>${game.isAdmin&&shared?.mode!=='offline'?`<hr class="divider"><h3>共通時間の管理</h3><p>変更は全プレイヤーに反映されます。</p><div class="form-row"><label for="world-clock-speed">全体の速度</label><select id="world-clock-speed" class="select">${[1,2,4].map(speed=>`<option value="${speed}" ${clock?.speed===speed?'selected':''}>${speed}倍速</option>`).join('')}</select></div><div class="form-row"><label for="world-clock-running">全体の進行</label><select id="world-clock-running" class="select"><option value="true" ${clock?.running?'selected':''}>全員の時間を進める</option><option value="false" ${clock&&!clock.running?'selected':''}>全員の時間を停止する</option></select></div>`:''}</div>`,`<button class="button" data-action="close">戻る</button>${game.isAdmin&&shared?.mode!=='offline'?`<button class="button primary" data-action="world-clock-apply" ${!shared?.ready?'disabled':''}>全プレイヤーへ反映</button>`:''}`,'world-clock');}
  async function updateWorldClock(node){if(!game.isAdmin)return;const clock=window.SengokuWorldClock?.snapshot().clock;if(!clock)return;node.disabled=true;try{const result=await window.SengokuSocial?.setWorldClock?.({speed:Number($('#world-clock-speed').value),running:$('#world-clock-running').value==='true',revision:clock.revision});if(!result?.clock)throw Error('共通時刻を更新できませんでした。');window.SengokuWorldClock.accept(result.clock);closeModal();render();toast('全プレイヤー共通の時間設定を更新しました。');}catch(error){toast(error.message||'共通時刻の更新に失敗しました。',true);window.SengokuWorldClock?.refresh();node.disabled=false;}}


  function replaceMainContents(html){
    renderedSyncBanner=syncBanner();
    // The same scene, portrait nodes and mounted map stay attached while
    // resources and jobs change. The map owns its subtree and camera state.
    patchHTML($('#main'),html,{key:currentView,preserveSelectors:['#world-map']});
  }

  function render(){renderHeader();nav();Promise.resolve().then(()=>window.SengokuProgress?.refresh?.());
    if(startPending){if(courtController){courtController.dispose();courtController=null;}if(fieldController){fieldController.destroy();fieldController=null;}if(roamingController){roamingController.dispose();roamingController=null;}if(covertController){covertController.dispose();covertController=null;}$('#main').dataset.view='start';patchHTML($('#main'),renderStartSelection(),{key:'start'});refreshLiveControls();window.SengokuDesktopFit?.refresh();window.SengokuHintsUI?.refresh?.();return;}
    if(currentView==='field'&&fieldController&&$('#shared-field')){fieldController.update(fieldOptions());refreshLiveControls();refreshJobTimers();window.SengokuDesktopFit?.refresh();window.SengokuHintsUI?.refresh?.();return;}
    if(currentView==='roaming'&&roamingController&&$('#roaming-field')){refreshLiveControls();window.SengokuDesktopFit?.refresh();window.SengokuHintsUI?.refresh?.();return;}
    if(currentView==='covert'&&covertController&&$('#covert-field')){refreshLiveControls();window.SengokuDesktopFit?.refresh();window.SengokuHintsUI?.refresh?.();return;}
    if(currentView==='court'&&courtController&&$('#court-field')){refreshLiveControls();window.SengokuDesktopFit?.refresh();return;}
    if(courtController){courtController.dispose();courtController=null;}
    if(fieldController){fieldController.destroy();fieldController=null;}
    if(roamingController){roamingController.dispose();roamingController=null;}if(covertController){covertController.dispose();covertController=null;}
    const renderers={town:renderTown,facilities:renderFacilities,map:renderMap,field:renderField,roaming:renderRoaming,covert:renderCovert,court:renderCourt,officers:renderOfficers,army:renderArmy,research:renderResearch,council:renderCouncil,crests:renderCrests};$('#main').dataset.view=currentView;replaceMainContents((saveWarning?`<div class="notice">${esc(saveWarning)}</div>`:'')+(currentView==='town'?'':syncBanner())+(state().gameOver?`<div class="banner"><div><h2>落城 — 再起の時</h2><p>領国を失いました。新たな勢力と難易度で再び天下へ。</p></div><button class="button primary" data-action="new-game">新たに始める</button></div>`:state().won?`<div class="banner"><div><h2>天下統一</h2><p>統一対象の${game.unificationTarget?.()||data.castles.length}城が、あなたの旗の下に集いました。</p></div><button class="button gold" data-action="shogunate">幕府を開く</button><button class="button" data-action="export-save">戦記を保存</button></div>`:'')+renderers[currentView]());document.querySelectorAll('[data-icon]').forEach(el=>patchHTML(el,icon(el.dataset.icon)));refreshLiveControls();refreshJobTimers();syncWorldMap();if(currentView==='field'&&window.SengokuField)fieldController=window.SengokuField.mount($('#shared-field'),fieldOptions());if(currentView==='roaming'&&window.SengokuRoaming)roamingController=window.SengokuRoaming.mount($('#roaming-field'),roamingOptions());if(currentView==='covert'&&window.SengokuCovert)covertController=window.SengokuCovert.mount($('#covert-field'),covertOptions());if(currentView==='court'&&window.SengokuCourt){courtController=window.SengokuCourt.mount($('#court-field'),courtOptions());courtManagementRequested=false;}window.SengokuDesktopFit?.refresh();window.SengokuHintsUI?.refresh?.();}
  function renderField(){return heading('共通フィールド','SHARED WORLD · 領主たちの天下','同じ世界に拠点を構え、攻撃と外交で関係を築く。')+'<div id="shared-field" class="shared-field"><div class="notice">領主たちの拠点を読み込んでいます。</div></div>';}
  function fieldOptions(){return{stateKey:'shared-field',identity:window.SengokuSocial?.getUser?.()||null,request:requestField,getState:()=>state(),getSyncStatus:()=>({...window.SengokuCloudSync?.getStatus?.(),writable:canMutate(),fieldPending:fieldActionPending,deviceId:window.SengokuCloudSync?.getDevice?.().id}),onRegister:()=>window.SengokuSocial?.open('profile'),onSync:()=>window.SengokuSocial?.open('sync'),onMutation:async()=>{},onMessage:toast};}
  function renderRoaming(){return '<div id="roaming-field" class="roaming-field"><div class="notice">野良兵士の部隊を確認しています。</div></div>';}
  function getRoamingAccess(){
    const clock=window.SengokuWorldClock?.snapshot();
    const writable=Boolean(saveEnabled&&!startPending&&canMutate());
    const reason=startPending?'はじめに本拠を選んでください。':!saveEnabled?'端末に進行を保存できる状態を確認してください。':fieldActionPending?'出陣結果を確認しています。':!writable?(clock&&!clock.ready?'共通時刻を確認しています。':syncMessage()):'';
    const ownerId=String(window.SengokuSocial?.getUser?.()?.id||'local');
    return{writable,reason,ownerId,linked:syncAccess.linked===true,online:navigator.onLine!==false,stamp:[ownerId,roleEpoch,state().roaming?.campaignId||state().campaignId||state().home].join(':')};
  }
  function roamingOptions(){return{getGame:()=>game,getStatus:getRoamingAccess,request:(route,options)=>window.SengokuSocial.roamingRequest(route,options),mountManagement:host=>window.SengokuRoamingManagement?.mount(host,{getContext:()=>window.SengokuSocial?.getEventContext?.()||{},request:(route,options)=>window.SengokuSocial.roamingRequest(route,options),onDeploymentChanged:()=>roamingController?.controller?.loadDeployment?.()}),battle:requestRoamingBattle,onResult:()=>{renderHeader();refreshLiveControls();window.SengokuHintsUI?.refresh?.();playNote(659,.075);}};}
  async function requestRoamingBattle(payload){
    if(syncAccess.linked)return requestField('/roaming/battle',{method:'POST',data:payload});
    const access=getRoamingAccess();if(!access.writable)throw Error(access.reason||'出陣の準備を確認してください。');
    const options={requestId:payload.requestId,campaignId:payload.campaignId,sequence:payload.sequence,...(payload.unitId?{unitId:payload.unitId,castleId:payload.castleId,deploymentRevision:payload.deploymentRevision}:{})};
    // Recover a saved local result before consulting a deployment that may have
    // since been replaced. Re-reading a receipt never spends another command.
    if((state().march?.requestId||state().march?.options?.requestId)===payload.requestId||state().roaming.history.some(b=>b.requestId===payload.requestId)||state().marchHistory?.some(m=>m.kind==='roaming'&&(m.requestId||m.options?.requestId)===payload.requestId))return game.departRoamingBattle(payload.encounterId,payload.tactic,payload.troops,options);
    if(!payload.unitId||!data.castles.some(c=>c.id===payload.castleId)||!Number.isSafeInteger(payload.deploymentRevision))throw Object.assign(Error('地図で戦う野良兵を選んでください。'),{status:400,code:'ROAMING_MAP_REQUIRED'});
    const currentGame=game,epoch=roleEpoch,owner=access.ownerId;
    let map;
    if(window.SENGOKU_OFFLINE===true){const deployment=SengokuEngine.roamingDeploymentDefaults();map={ok:true,deployment,units:SengokuEngine.roamingDeploymentUnits(deployment,payload.castleId),serverNow:Date.now()};}
    else{if(!window.SengokuSocial?.roamingRequest)throw Error('全国の配置を確認できません。接続を確認してください。');map=await window.SengokuSocial.roamingRequest('/roaming/map?castleId='+encodeURIComponent(payload.castleId),{method:'GET'});}
    if(game!==currentGame||roleEpoch!==epoch||getRoamingAccess().ownerId!==owner||syncAccess.linked)throw Object.assign(Error('領主または物語が切り替わりました。画面を確認してください。'),{code:'STALE_IDENTITY',retryable:true});
    if(!getRoamingAccess().writable)throw Object.assign(Error(getRoamingAccess().reason||'本拠の保存状態を確認してください。'),{retryable:true});
    const unit=map?.units?.find(u=>u.unitId===payload.unitId&&u.castleId===payload.castleId&&u.encounterId===payload.encounterId);
    if(!unit||map.deployment?.revision!==payload.deploymentRevision)throw Object.assign(Error('全国の配置が変わりました。地図を更新して部隊を選び直してください。'),{status:409,code:'ROAMING_DEPLOYMENT_CHANGED'});
    const now=Date.now(),cooldown=state().roaming.history.some(b=>b.unitId===unit.unitId&&b.won&&b.respawnAt>now);
    if(unit.available===false||cooldown)throw Object.assign(Error('この部隊は再出現を待っています。別の部隊を選んでください。'),{status:409,code:'ROAMING_UNIT_UNAVAILABLE'});
    const before=JSON.parse(JSON.stringify(state())),result=game.departRoamingBattle(payload.encounterId,payload.tactic,payload.troops,{...options,deploymentUnit:unit,respawnSeconds:map.deployment.respawnSeconds});
    if(!result.ok)return result;
    if(!save()){game.state=before;throw Error('合戦結果を保存できなかったため、出陣前の状態に戻しました。');}
    return result;
  }
  function renderCourt(){return '<div id="court-field" class="court-field"><div class="notice" role="status">京都御所への参内資格を確認しています。</div></div>';}
  function courtOptions(){return{getContext:()=>window.SengokuSocial?.getCourtContext?.()||{},request:(route,options)=>window.SengokuSocial.courtRequest(route,options),initialSection:courtManagementRequested?'management':'overview',onRegister:()=>window.SengokuSocial?.open('profile')};}
  function openCourt({management=false}={}){courtManagementRequested=management;if(currentView==='court'&&courtController){courtController.controller.selectSection(management?'management':'overview');courtManagementRequested=false;closeModal();return;}go('court');}
  function renderCovert(){return '<div id="covert-field" class="covert-field"><div class="notice" role="status">大都市拠点と派遣部隊を確認しています。</div></div>';}
  function getCovertAccess(){
    const access=getRoamingAccess(),user=window.SengokuSocial?.getUser?.();
    return {...access,readable:!access.linked||Boolean(user&&syncAccess.ready&&!syncAccess.rolePending&&!syncAccess.banned),stamp:[access.ownerId,roleEpoch,state().walking?.campaignId||state().home,access.linked].join(':')};
  }
  function covertOptions(){return{getGame:()=>game,getStatus:getCovertAccess,load:cursor=>requestCovert('/covert'+(cursor?'?cursor='+encodeURIComponent(cursor)+'&limit=100':''),{method:'GET'}),mutate:(action,payload)=>requestCovert('/covert/'+action,{method:'POST',data:payload}),onResult:()=>{renderHeader();refreshLiveControls();window.SengokuHintsUI?.refresh?.();playNote(659,.075);}};}
  async function requestCovert(route,{method='GET',data:payload}={}){
    const action=route.slice('/covert/'.length);
    if(!(method==='GET'&&/^\/covert(?:\?cursor=[A-Za-z0-9_%-]+&limit=100)?$/.test(route)||method==='POST'&&['hire','dispatch','recall','retaliate'].includes(action)&&route==='/covert/'+action))throw Error('派遣部隊の操作を確認してください。');
    if(syncAccess.linked){
      if(method==='GET'){if(!window.SengokuSocial?.covertRequest)throw Error('派遣部隊に接続できません。');return window.SengokuSocial.covertRequest(route,{method});}
      return requestField(route,{method,data:payload});
    }
    if(method==='GET')return{ok:true,covert:game.covertStatus()};
    const access=getCovertAccess();if(!access.writable)throw Error(access.reason||'本拠の保存状態を確認してください。');
    const before=JSON.parse(JSON.stringify(state())),options={requestId:payload?.requestId,campaignId:payload?.campaignId,sequence:payload?.sequence};
    const result=action==='hire'?game.hireCovert(payload.sourceCastleId,payload.count,options):action==='dispatch'?game.departCovertDispatch(payload.sourceCastleId,payload.target,payload.count,payload.mode,options):action==='recall'?game.recallCovert(payload.stationId,options):game.retaliateCovert(payload.stationId,payload.incidentId,options);
    if(!result.ok)return result;
    if(!save()){game.state=before;throw Error('派遣の結果を保存できなかったため、操作前の状態に戻しました。');}
    return {...result,covert:game.covertStatus()};
  }
  async function requestBranches(route,{method='GET',data:payload}={}){
    const action=route.slice('/branches/'.length);if(!(method==='GET'&&route==='/branches'||method==='POST'&&['build','upgrade','repair','build-facility','upgrade-facility'].includes(action)&&route==='/branches/'+action))throw Error('支拠点の操作を確認してください。');
    if(syncAccess.linked){const api=window.SengokuSocial?.branchRequest;if(!api)throw Error('支拠点に接続できません。');if(method==='GET')return api(route,{method});const actor=String(window.SengokuSocial?.getUser?.()?.id||''),epoch=roleEpoch,campaign=state().walking?.campaignId;const current=await api('/branches',{method:'GET'});if(actor!==String(window.SengokuSocial?.getUser?.()?.id||'')||epoch!==roleEpoch||campaign!==state().walking?.campaignId)throw Object.assign(Error('領主の進行が変わったため支拠点の操作を取り消しました。'),{code:'STALE_IDENTITY'});if(typeof current.campaignId!=='string'||!Number.isSafeInteger(current.sequence))throw Error('支拠点の最新情報を確認できませんでした。');return requestField(route,{method,data:{...payload,campaignId:current.campaignId,sequence:current.sequence}});}
    if(method==='GET')return{ok:true,branchState:{branches:state().branches||[]}};
    if(!canMutate()||!saveEnabled)throw Error(syncMessage());const before=JSON.parse(JSON.stringify(state())),result=action==='build'?game.buildBranch(payload.parentCastleId,payload.direction):action==='upgrade'?game.upgradeBranch(payload.branchId):action==='build-facility'?game.buildBranchFacility(payload.branchId,payload.facilityId):action==='upgrade-facility'?game.upgradeBranchFacility(payload.branchId,payload.facilityId):game.repairBranch(payload.branchId);if(!result.ok)return result;
    if(!save()){game.state=before;renderHeader();refreshLiveControls();throw Error('保存できなかったため、支拠点の手配を取り消しました。資源と指令は元に戻しています。');}return result;
  }
  async function requestField(route,{method='GET',data:payload,allowStrategy=false}={}){
    const isCampaign=method==='POST'&&route==='/marches/campaign',isExpansion=method==='POST'&&/^\/(?:progress\/(?:claim|exchange)|alliance\/(?:rally\/(?:join|launch)|reinforcements\/send|units\/claim|treasury\/claim))$/.test(route),isBranch=method==='POST'&&/^\/branches\/(?:build|upgrade|repair|build-facility|upgrade-facility)$/.test(route),isGuild=route==='/guild/treasury/transfer'&&method==='POST',isStaff=route==='/staff/base/upgrade'&&method==='POST',isAttack=route==='/field/attack'&&method==='POST',isTrade=method==='POST'&&/^\/trades(?:\/tr_[a-f0-9]{32}\/(?:accept|cancel|reject|claim))?$/.test(route),isEvent=method==='POST'&&/^\/events\/ev_[a-f0-9]{32}\/battle$/.test(route),isRoaming=method==='POST'&&route==='/roaming/battle',isCovert=method==='POST'&&/^\/covert\/(?:hire|dispatch|recall|retaliate)$/.test(route);
    if(!isCampaign&&!isExpansion&&!isBranch&&!isGuild&&!isStaff&&!isTrade&&!isEvent&&!isRoaming&&!isCovert&&(!/^\/field(?:\/me|\/attack|\/diplomacy)?(?:\?[^#]*)?$/.test(route)||!['GET','POST'].includes(method)))throw Error('合戦・資産・交易・共同普請の操作を確認してください。');
    const social=window.SengokuSocial,sync=window.SengokuCloudSync,send=isCampaign?social?.marchRequest:isExpansion?social?.expansionRequest:isBranch?social?.branchRequest:isStaff?social?.staffRequest:isGuild?social?.guildRequest:isTrade?social?.tradeRequest:isEvent?social?.eventRequest:isRoaming?social?.roamingRequest:isCovert?social?.covertRequest:social?.fieldRequest;if(!send)throw Error('合戦・資産・交易・共同普請に接続できません。');
    if(method==='GET'){if(route.split('?')[0]==='/field/me'){const [path,query='']=route.split('?'),params=new URLSearchParams(query);params.set('deviceId',sync?.getDevice?.().id||'');route=path+'?'+params;}return social.fieldRequest(route,{method});}
    if(isAttack||isCovert&&route==='/covert/retaliate'||isExpansion&&route==='/alliance/rally/launch')await window.SengokuBridge?.confirmProtectionExit?.();
    const user=social.getUser?.();if(!user)throw Error('交流から領主を登録すると参加できます。');if(!sync?.getStatus?.().linked)throw Error('端末同期を確認してください。');if(fieldActionPending)throw Error('前の共通フィールド・資産・交易・共同普請の操作を確認しています。');
    const staffEpoch=isStaff?roleEpoch:null,covertEpoch=isCovert||isBranch||isCampaign?roleEpoch:null,branchCampaign=isBranch||isCampaign?state().walking?.campaignId:null;
    const verifyIdentity=()=>{if(String(social.getUser?.()?.id)!==String(user.id)||(isCovert||isBranch||isCampaign)&&covertEpoch!==roleEpoch||(isBranch||isCampaign)&&branchCampaign!==state().walking?.campaignId){const error=Error('接続中の領主が変わったため、以前の結果の反映を取り消しました。');error.code='STALE_IDENTITY';throw error;}};
    const verifyGuild=()=>{if(isGuild&&(!payload?.guildId||String(social.getUser?.()?.guildId)!==String(payload.guildId))){const error=Error('所属する同盟が変わりました。同盟画面を更新して確認してください。');error.code='STALE_GUILD';throw error;}};
    const verifyStaff=()=>{if(isStaff&&(staffEpoch!==roleEpoch||!game.isStaff||social.getUser?.()?.isStaff!==true||social.getUser?.()?.isAdmin===true||!staffConstructionReady())){const error=Error('スタッフ権限と共同拠点の接続を確認してください。');error.code='STALE_STAFF';throw error;}};
    verifyGuild();verifyStaff();await window.SengokuWorldClock?.refresh();verifyIdentity();verifyGuild();verifyStaff();processWorldClock(allowStrategy);if(!(allowStrategy?canMutate(false,false,true):requireWritable()))throw Error('共通時刻と端末同期が整ってから操作してください。');if(!save({allowStrategy}))throw Error('セーブを保存できなかったため、操作を見送りました。');
    fieldActionPending=true;refreshLiveControls();
    const fieldPayload=value=>Object.fromEntries(Object.entries(value||{}).filter(([key])=>!['requestId','deviceId','expectedRevision'].includes(key)).sort(([a],[b])=>a.localeCompare(b)));
    const tradePayload=value=>{const body=fieldPayload(value);for(const key of ['offer','want'])if(body[key]&&typeof body[key]==='object'&&!Array.isArray(body[key]))body[key]=Object.fromEntries(Object.entries(body[key]).filter(([name,amount])=>name!=='troops'||amount!==0).sort(([a],[b])=>a.localeCompare(b)));return body;};
    const operationFor=(path,value)=>({route:path,payload:path.startsWith('/branches/')?Object.fromEntries(Object.entries(value||{}).filter(([key])=>!['requestId','deviceId','expectedRevision','sequence'].includes(key)).sort(([a],[b])=>a.localeCompare(b))):path==='/guild/treasury/transfer'?{guildId:value.guildId,direction:value.direction,resource:value.resource,amount:value.amount}:path==='/staff/base/upgrade'?{kind:value.kind,id:value.id}:path.startsWith('/trades')?tradePayload(value):fieldPayload(value)});
    const operation=operationFor(route,payload),signature=JSON.stringify(operation),fieldPrefix=(isCampaign?'sengoku-campaign-march-pending-v1:':isBranch?'sengoku-branch-command-pending-v1:':'sengoku-field-pending-v1:')+encodeURIComponent(String(user.id))+':';
    const keyFor=value=>(value.route==='/marches/campaign'?'sengoku-campaign-march-pending-v1:':/^\/(?:progress|alliance)\//.test(value.route)?'sengoku-expansion-pending-v1:':value.route.startsWith('/branches/')?'sengoku-branch-command-pending-v1:':value.route==='/staff/base/upgrade'?'sengoku-staff-upgrade-pending-v1:':value.route==='/guild/treasury/transfer'?'sengoku-guild-transfer-pending-v1:':value.route.startsWith('/trades')?'sengoku-trade-pending-v1:':value.route.startsWith('/events/')?'sengoku-event-command-pending-v1:':value.route==='/roaming/battle'?'sengoku-roaming-command-pending-v1:':value.route.startsWith('/covert/')?'sengoku-covert-command-pending-v1:':'sengoku-field-pending-v1:')+encodeURIComponent(String(user.id))+':'+encodeURIComponent(JSON.stringify(value));
    const savedOperation=stored=>{if(stored?.playerId!==String(user.id)||typeof stored.requestId!=='string')return null;try{const old=JSON.parse(stored.signature);return operationFor(old.route,stored.payload??old.payload);}catch(_){return null;}};
    const readPending=key=>{try{return JSON.parse(localStorage.getItem(key)||'null');}catch(_){return null;}};
    async function performOperation(value,requestedId){
      const expectedSignature=JSON.stringify(value),pendingKey=keyFor(value),legacyKey=value.route.startsWith('/field')?'sengoku-field-pending-v1':null;
      const matchesPending=stored=>{const saved=savedOperation(stored);return saved&&JSON.stringify(saved)===expectedSignature;};
      let pendingRecord,sent=false,received=false;
      const clearPending=()=>{for(const key of [pendingKey,legacyKey].filter(Boolean))try{const stored=readPending(key);if(pendingRecord&&matchesPending(stored)&&stored.requestId===pendingRecord.requestId)localStorage.removeItem(key);}catch(_){}};
      try{
        verifyIdentity();verifyGuild();verifyStaff();
        for(const key of [pendingKey,legacyKey].filter(Boolean)){const old=readPending(key);if(matchesPending(old)){pendingRecord={...old,signature:expectedSignature,payload:savedOperation(old).payload};break;}}
        if(!pendingRecord)pendingRecord={playerId:String(user.id),signature:expectedSignature,payload:JSON.parse(JSON.stringify(value.payload)),requestId:requestedId||crypto.randomUUID(),createdAt:Date.now(),...(isStaff?{baseRevision:game.getStaffBase().revision}:{}),...(isBranch?{branchCampaignId:payload.campaignId,branchSequence:payload.sequence}:{})};
        localStorage.setItem(pendingKey,JSON.stringify(pendingRecord));
        if(legacyKey)try{const old=readPending(legacyKey);if(matchesPending(old)&&old.requestId===pendingRecord.requestId)localStorage.removeItem(legacyKey);}catch(_){}
        // Reuse the saved semantic body, including whether targetCastleId was
        // absent. Only this connection's writer revision/device are refreshed.
        const body={...pendingRecord.payload,requestId:pendingRecord.requestId,deviceId:sync.getDevice().id,expectedRevision:sync.getStatus().revision,...(isStaff?{baseRevision:pendingRecord.baseRevision}:{}),...(isBranch?{campaignId:pendingRecord.branchCampaignId,sequence:pendingRecord.branchSequence}:{})};sent=true;
        const result=await send(value.route,{method:'POST',data:body});received=true;
        verifyIdentity();verifyStaff();if((isCampaign||isAttack||isRoaming||isExpansion&&value.route==='/alliance/rally/launch')&&(result.accepted===true||result.march)&&!window.SengokuTravelUI?.commandMarch(result,pendingRecord.requestId))throw Error('出陣の受付内容を確認できませんでした。同じ操作を再確認してください。');if(result.clock)window.SengokuWorldClock?.accept(result.clock);
        if(isCampaign||isExpansion||isAttack||isTrade||isEvent||isRoaming||isCovert||isBranch){pendingRecord={...pendingRecord,committed:true,...(Number.isSafeInteger(result.revision)?{committedRevision:result.revision}:{})};localStorage.setItem(pendingKey,JSON.stringify(pendingRecord));}
        const needsReconcile=()=>(isCampaign||isExpansion||isAttack||isTrade||isEvent||isRoaming||isCovert||isBranch)&&!Number.isSafeInteger(result.revision)||Number.isSafeInteger(result.revision)&&(!Number.isSafeInteger(sync.getStatus().revision)||sync.getStatus().revision<result.revision)||isStaff&&(!Number.isSafeInteger(result.staffBase?.revision)||!staffConstructionReady()||game.getStaffBase().revision<result.staffBase.revision);
        let reconciled=await sync.refresh();verifyIdentity();verifyStaff();if((isGuild||isStaff||isCampaign||isExpansion||isAttack||isTrade||isEvent||isRoaming||isCovert||isBranch)&&needsReconcile()){reconciled=await sync.refresh();verifyIdentity();verifyStaff();}
        if((isGuild||isStaff||isCampaign||isExpansion||isAttack||isTrade||isEvent||isRoaming||isCovert||isBranch)&&(!reconciled?.ok||needsReconcile())){const error=Error(isBranch?'支拠点の結果を同期しています。同じ操作を再確認すると元の受付番号で確認します。':isCovert?'派遣部隊の結果を同期しています。通信回復後に同じ操作を再確認してください。兵と資源を二重には消費しません。':isStaff?'共同普請の結果を確認しています。通信回復後に同じ操作を再試行してください。二重には支払いません。':isTrade?'交易の結果を保存先に確認しています。通信回復後に同じ操作を再試行してください。資産を二重には移動しません。':isGuild?'資産の操作結果を保存先に確認しています。通信回復後に同じ操作を再試行してください。二重には移動しません。':(isEvent||isRoaming)?'合戦結果と指令の残数を同期しています。通信回復後に同じ出陣を再確認してください。指令を二重には消費しません。':'前の合戦の結果を保存先に確認しています。通信回復後に出陣を再試行してください。結果の反映を確認してから次の出陣へ進みます。');error.code=isBranch?'BRANCH_RECONCILE_PENDING':isStaff?'STAFF_RECONCILE_PENDING':isTrade?'TRADE_RECONCILE_PENDING':isGuild?'GUILD_RECONCILE_PENDING':isEvent?'EVENT_RECONCILE_PENDING':isRoaming?'ROAMING_RECONCILE_PENDING':isCovert?'COVERT_RECONCILE_PENDING':'FIELD_RECONCILE_PENDING';throw error;}
        clearPending();verifyGuild();verifyStaff();const march=window.SengokuTravelUI?.commandMarch(result,pendingRecord.requestId);if(march)window.SengokuTravelUI?.record(march);return isRoaming||isCovert?{...result,effectiveRequestId:pendingRecord.requestId}:result;
      }catch(error){if(!received&&!pendingRecord?.committed&&error.status&&error.status<500&&(!(isCovert||isRoaming||isBranch||isCampaign)||![401,403,408,429].includes(Number(error.status))&&error.retryable!==true&&!['MARCH_SYNC_REQUIRED','MARCH_IDENTITY_REQUIRED','MARCH_CAMPAIGN_REQUIRED','BRANCH_SYNC_REQUIRED','BRANCH_IDENTITY_REQUIRED','BRANCH_CAMPAIGN_REQUIRED','COVERT_SYNC_REQUIRED','COVERT_IDENTITY_REQUIRED','COVERT_CAMPAIGN_REQUIRED','ROAMING_SYNC_REQUIRED','ROAMING_IDENTITY_REQUIRED','ROAMING_CAMPAIGN_REQUIRED','STALE_IDENTITY'].includes(error.code)))clearPending();if(sent&&String(social.getUser?.()?.id)===String(user.id))try{await sync.refresh();}catch(_){}throw error;}
    }
    try{
      const flushed=await sync.flush();if(!flushed?.ok||!sync.getStatus().writable)throw Error('最新の進行を同期できませんでした。もう一度お試しください。');
      verifyIdentity();verifyGuild();verifyStaff();
      if(isAttack||isBranch||isCampaign){
        // Finish older, uncertain attacks before allowing a changed target or
        // force. A different player never replays this identity's operations.
        const keys=[];for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key?.startsWith(fieldPrefix))keys.push(key);}if(isAttack)keys.push('sengoku-field-pending-v1');
        const seen=new Set(),pending=keys.map(readPending).filter(record=>{const value=savedOperation(record);if((isCampaign?value?.route!=='/marches/campaign'||value?.payload?.campaignId!==payload?.campaignId:isBranch?!value?.route?.startsWith('/branches/')||value?.payload?.campaignId!==payload?.campaignId:value?.route!=='/field/attack')||JSON.stringify(value)===signature||seen.has(record.requestId))return false;seen.add(record.requestId);return true;}).sort((a,b)=>a.createdAt-b.createdAt);
        for(const record of pending){await performOperation(savedOperation(record),record.requestId);verifyIdentity();}
      }
      return await performOperation(operation,payload?.requestId);
    }finally{fieldActionPending=false;refreshLiveControls();window.SengokuTravelUI?.refresh();queueWorldProgress();}
  }
  async function departCampaign(kind,targetId,tactic,troops,{allowStrategy=false,requestId}={}){
    if(!['castle','branch'].includes(kind))return{ok:false,message:'出陣先を確認してください。'};
    if(syncAccess.linked)return requestField('/marches/campaign',{method:'POST',allowStrategy,data:{kind,targetId,tactic,troops,campaignId:state().walking?.campaignId,...(requestId?{requestId}:{})}});
    const before=JSON.parse(JSON.stringify(state()));
    const result=kind==='branch'?game.departBranchAttack(targetId,tactic,troops):game.departAttack(targetId,tactic,troops);
    if(!result.ok)return result;
    if(!save({allowStrategy})){game.state=before;return{ok:false,message:'出陣を保存できなかったため、出発前の状態に戻しました。'};}
    return result;
  }
  let marchStatusPending=false;
  function localMarches(){const covert=game.covertStatus?.();return[game.getMarchStatus?.(),...(state().marchHistory||[]),...(covert?.dispatches||[]),...(covert?.history||[]).filter(r=>r.march&&['resolved','cancelled'].includes(r.status)).map(r=>({...r.march,status:r.status,receipt:r,message:r.status==='cancelled'?'派遣を取りやめ、部隊と出陣費用を戻しました。':r.mode==='station'?'部隊が到着し、常駐を開始しました。':'調査が完了し、部隊は帰還しました。'}))].filter(Boolean);}
  async function requestMarchStatus(){
    if(fieldActionPending||walkingActionPending||strategyActionPending||marchStatusPending)return{ok:false};
    const sync=window.SengokuCloudSync,social=window.SengokuSocial,owner=String(social?.getUser?.()?.id||''),campaign=state().walking?.campaignId;
    if(!syncAccess.linked||!syncAccess.ready||!owner)return{ok:false};
    const result=await social.marchRequest('/marches?deviceId='+encodeURIComponent(sync?.getDevice?.().id||''));
    const current=()=>String(social?.getUser?.()?.id||'')===owner&&state().walking?.campaignId===campaign;
    if(!current())throw Object.assign(Error('領主の進行が切り替わりました。'),{code:'STALE_IDENTITY'});
    if(result.clock)window.SengokuWorldClock?.accept(result.clock);
    if(Number.isSafeInteger(result.revision)&&result.revision>(sync?.getStatus?.().revision??-1)){
      marchStatusPending=true;window.SengokuStrategy?.refreshAccess?.();
      try{const reflected=await sync.refresh();if(!reflected?.ok||!current()||sync.getStatus().revision<result.revision)throw Error('到着結果を同期しています。');}
      finally{marchStatusPending=false;window.SengokuStrategy?.refreshAccess?.();}
    }
    return result;
  }
  function configureTravel(){window.SengokuTravelUI?.configure({
    getContext:()=>({scope:[window.SengokuSocial?.getUser?.()?.id||'local',state().walking?.campaignId||'',roleEpoch].join(':'),started:!startPending,linked:syncAccess.linked,ready:syncAccess.ready&&!syncAccess.rolePending&&!syncAccess.banned}),
    getLocal:localMarches,getElapsedMs:()=>state().worldClock?.elapsedMs??(state().turn*60000+(state().realtime?.elapsed||0)*1000),request:requestMarchStatus,
    onArrival:march=>{toast(march.status==='cancelled'?march.message||'出陣を取り消しました。進軍状況から詳細を確認できます。':`${march.targetName}への部隊が到着しました。「戦果を確認」から結果を確認できます。`);renderHeader();refreshLiveControls();window.SengokuStrategy?.refreshAccess?.();},
    onReport:march=>{if(march.kind==='covert'){go('covert');return true;}if(!march.battle)return false;if(march.kind==='castle'){battleResult(march.battle);return true;}if(march.kind==='branch'){branchBattleResult(march.battle);return true;}if(march.kind==='roaming'&&window.SengokuRoaming?.reportMarkup){modal('野良兵戦の戦果',march.targetName,window.SengokuRoaming.reportMarkup(march.battle),`<button class="button primary" data-action="close">閉じる</button>`,'march-result');return true;}if(['field','rally'].includes(march.kind)&&window.SengokuField?.battleReportHtml){modal('到着後の合戦結果',march.targetName,window.SengokuField.battleReportHtml(march.battle,String(window.SengokuSocial?.getUser?.()?.id||'')),`<button class="button primary" data-action="close">閉じる</button>`,'march-result');return true;}return false;}
  });}
  function confirmDialog(title,text,confirmLabel){return new Promise(resolve=>{
    const dialog=document.createElement('dialog');dialog.className='expansion-confirm';dialog.innerHTML=`<form method="dialog"><h2>${esc(title)}</h2><p>${esc(text)}</p><div class="expansion-actions"><button class="button" value="cancel">戻る</button><button class="button gold" value="confirm">${esc(confirmLabel)}</button></div></form>`;document.body.appendChild(dialog);
    dialog.addEventListener('close',()=>{const accepted=dialog.returnValue==='confirm';dialog.remove();resolve(accepted);},{once:true});dialog.showModal();
  });}
  async function confirmProtectionExit(){
    const social=window.SengokuSocial,initial=social?.getExpansionContext?.();if(!initial?.user)return;
    const protection=await social.expansionRequest('/protection');if(!protection.beginnerActive)return;
    if(!await confirmDialog('初心者保護を解除して出陣しますか？','登録から24時間の初心者保護が終了し、ほかの領主からも攻撃を受けるようになります。解除は取り消せません。','保護を解除して出陣'))throw Error('出陣を見送りました。初心者保護は継続しています。');
    const current=social.getExpansionContext();if(current.playerId!==initial.playerId||current.epoch!==initial.epoch)throw Error('領主が変わりました。もう一度確認してください。');
    await social.expansionRequest('/protection/end',{method:'POST',data:{confirm:true}});
  }
  function getExpansionAccess(){return{...window.SengokuSocial?.getExpansionContext?.(),writable:!startPending&&saveEnabled&&canMutate(),gameWritable:!startPending&&saveEnabled&&canMutate(),reason:syncMessage()};}
  function requestExpansion(route,options={}){
    const mutation=(options.method||'GET')==='POST'&&/^\/(?:progress\/(?:claim|exchange)|alliance\/(?:rally\/(?:join|launch)|reinforcements\/send|units\/claim|treasury\/claim))$/.test(route);
    return mutation?requestField(route,options):window.SengokuSocial.expansionRequest(route,options);
  }
  function configureProgress(){window.SengokuProgress?.configure({getGame:()=>game,getContext:getExpansionAccess,api:requestExpansion,mutate:fn=>{if(!requireWritable())return{ok:false,message:syncMessage()};const result=fn(game);perform(result,{close:false,quiet:true});return result;},navigate:go,notify:toast,openMail:()=>window.SengokuSocial?.open('mail')});}
  let primedProgressOwner='',progressPrimePending=false,noticeRecapPending=false;
  try{noticeRecapPending=new URLSearchParams(window.location.search).get('notice')==='1';}catch(_){}
  function openPendingRecap(){
    if(!noticeRecapPending||startPending||!syncAccess.ready||syncAccess.rolePending||syncAccess.banned||!getExpansionAccess().user)return;
    noticeRecapPending=false;openExpansion('progress','recap');
    try{const url=new URL(window.location.href);url.searchParams.delete('notice');window.history.replaceState(window.history.state,'',url.pathname+url.search+url.hash);}catch(_){}
  }
  async function primeProgress(){
    openPendingRecap();
    const access=getExpansionAccess(),owner=String(access.playerId||'')+':'+(state().walking?.campaignId||'');
    if(!access.user||!access.writable||primedProgressOwner===owner||progressPrimePending)return;
    progressPrimePending=true;configureProgress();try{await window.SengokuProgress?.prime();if(window.SengokuProgress?.getState?.().loaded)primedProgressOwner=owner;}finally{progressPrimePending=false;}
  }
  function openExpansion(kind,tab){closeModal();configureProgress();if(startPending){toast('はじめに本拠を選んでください。',true);return;}
    if(kind==='progress')window.SengokuProgress?.open(tab||'missions');
    if(kind==='tutorial')window.SengokuProgress?.startTutorial();
    if(kind==='alliance')window.SengokuAlliance?.open({getContext:getExpansionAccess,request:(...args)=>window.SengokuSocial.expansionRequest(...args),mutate:(route,data)=>requestExpansion(route,{method:'POST',data}),readField:()=>window.SengokuSocial.fieldRequest('/field?limit=100'),getGame:()=>game,onMessage:toast});
    if(kind==='conquest')window.SengokuConquest?.open({getContext:getExpansionAccess,request:requestExpansion,notify:toast});
    if(kind==='notifications')window.SengokuNotifications?.open({getContext:getExpansionAccess,request:requestExpansion,notify:toast});
  }
  function spendableAssets(){const s=state();return {gold:s.resources.gold,rice:s.resources.rice,wood:s.resources.wood,stone:s.resources.stone,magatama:s.magatama||0,troops:s.troops||0};}
  function getEventAccess(){
    const ready=Boolean(!startPending&&saveEnabled&&syncAccess.linked&&syncAccess.ready&&!syncAccess.banned&&!syncAccess.rolePending),writable=ready&&canMutate();
    const message=startPending?'はじめに本拠を選んでください。':!saveEnabled?'端末に進行を保存できる状態を確認してください。':!syncAccess.linked?'交流から領主を登録し、端末同期を確認してください。':fieldActionPending?'合戦と指令の結果を同期しています。':!ready||!writable?syncMessage():state().command<1?'指令不足です。通常の指令回復をお待ちください。':'出陣に指令を1消費します。';
    return {current:state().command,max:game.commandMax(),cost:1,ready,writable,message};
  }
  async function requestEventBattle(route,{method='POST',data:payload}={}){
    if(method!=='POST'||!/^\/events\/ev_[a-f0-9]{32}\/battle$/.test(route))throw Error('期間限定合戦の出陣操作を確認してください。');
    return requestField(route,{method,data:payload});
  }
  async function requestTrade(route,{method='POST',data:payload}={}){
    if(method!=='POST'||!/^\/trades(?:\/tr_[a-f0-9]{32}\/(?:accept|cancel|reject|claim))?$/.test(route))throw Error('交易の操作を確認してください。');
    return requestField(route,{method,data:payload});
  }
  async function upgradeSharedBase(kind,id){
    try{const result=await requestField('/staff/base/upgrade',{method:'POST',data:{kind,id}});playNote(659,.075);toast(result.receipt?.queued?`Lv.${result.receipt.targetLevel}への共同増築を予約しました。先の工事から順番に進みます。`:'共同普請の結果を反映しました。共同拠点に自動で共有されます。');}
    catch(error){toast(error.message||'共同普請を確認できませんでした。',true);}
  }
  function go(view){if(!['town','facilities','map','field','roaming','covert','court','officers','crests','army','research','council'].includes(view))return;interactionEpoch++;closeModal();currentView=view;syncMusic();history.replaceState(null,'','#'+view);render();const main=$('#main');if(main){main.scrollTop=0;main.scrollLeft=0;}window.scrollTo({top:0,left:0,behavior:'instant'});}
  function buildingOutput(id){return game.buildingSummary?game.buildingSummary(id):'';}
  function buildingCard(b){const lv=state().buildings[b.id]||0,job=currentJob('building',b.id),max=game.buildingMax(b.id),unlock=game.buildingUnlock?.(b.id)||{ok:true};return `<button class="building-card ${!unlock.ok?'locked-building':''}" data-category="${esc(b.category)}" data-action="building" data-id="${b.id}">${window.SengokuArt?.facility(b.id,'building-art',lv||1)||''}${job?`<span class="job-label">${job.shared?'共同普請':'普請中'}</span>`:''}<div class="building-top"><span class="building-symbol">${icon(b.icon)}</span><span class="building-level">${lv?`Lv.${lv}/${max}`:'未建設'}</span></div><h3>${esc(b.name)}</h3><p>${!unlock.ok?`天守 Lv.${unlock.requiredLevel}で解放`:esc(buildingOutput(b.id))}</p>${facilityGovernorLabel(b.id)}<div class="building-track">${Array.from({length:16},(_,i)=>`<i class="${i<Math.ceil(lv/2)?'on':''}"></i>`).join('')}</div>${job?`<small class="building-job-clock" data-job-clock="${jobKey(job)}">${esc(jobClockText(job))}</small>`:''}</button>`;}
  const categoryNames={gold:'商業',rice:'農業・兵糧',wood:'林業・木材',stone:'鉱業・石材',military:'軍備',defense:'城郭・防衛',research:'学問・技術',diplomacy:'統治・外交'};
  function governorAssignmentStatus(){
    const s=state(),army=new Set(s.army),facilities=data.buildings.filter(b=>s.buildings[b.id]>0);
    return{facilityCount:facilities.length,candidateCount:new Set(s.officers.filter(id=>!army.has(id))).size,assignedCount:facilities.filter(b=>Boolean(s.governors[b.id])).length};
  }
  function governorAssignmentEntry(){
    const status=governorAssignmentStatus(),unavailable=!saveEnabled||!status.facilityCount||!status.candidateCount||game.isStaff&&!staffConstructionReady();
    const hint=!status.facilityCount?'施設を建設すると奉行を配置できます。':!status.candidateCount?'軍団に入っていない家臣を迎えると利用できます。':game.isStaff&&!staffConstructionReady()?'共同拠点の成長を確認しています。':'現在の奉行も見直します。軍団の武将は対象外です。';
    return `<section class="governor-assignment-panel" aria-label="奉行のお任せ配置"><div class="governor-assignment-copy"><h3>${icon('users')}奉行のお任せ配置</h3><p>政治と施設に合う特技で、建設済みの全施設へ配置します。</p><small>${esc(hint)}</small></div><div class="governor-assignment-actions"><span>奉行 <b>${status.assignedCount} / ${status.facilityCount}</b>施設 · 候補 ${status.candidateCount}名</span><button type="button" class="button gold" data-action="auto-governors" ${unavailable?'disabled':''}>${icon('users')}奉行をお任せ配置</button></div></section>`;
  }
  function facilityGovernorLabel(id){
    if(!(state().buildings[id]>0))return '';
    const officer=game.officer(state().governors[id]);
    return `<small class="facility-governor">${icon('users')}<span>奉行：${officer?`${esc(officer.name)} <b class="rank-${esc(officer.rank)}">${esc(officer.rank)}</b>`:'未任命'}</span></small>`;
  }
  function governorAssignmentResult(result){
    const percent=bonus=>Number(((Number(bonus||1)-1)*100).toFixed(2)).toLocaleString('ja-JP');
    const rows=result.assignments.map(item=>{
      const building=data.buildings.find(b=>b.id===item.buildingId),officer=game.officer(item.officerId),previous=game.officer(item.previousOfficerId),changed=item.officerId!==item.previousOfficerId;
      if(!building)return '';
      return `<li class="governor-result-row ${changed?'is-changed':''}"><div><b>${esc(building.name)}</b><small>Lv.${state().buildings[building.id]} · ${esc(categoryNames[building.category]||'城下町')}</small></div><div>${officer?`<strong><span class="rank-${esc(officer.rank)}">${esc(officer.rank)}</span> ${esc(officer.name)}</strong><small>政治 ${officer.politics} · 奉行補正 +${percent(item.bonus)}%</small>`:'<strong class="governor-vacant">未任命</strong>'}${changed&&previous?`<small>前の奉行：${esc(previous.name)}</small>`:''}</div></li>`;
    }).join('');
    modal(result.changedCount?'奉行をお任せ配置しました':'現在の配置を維持しました','軍団の編成を保ち、家臣の政治と特技で配置',`<div class="governor-result-summary"><div><span>配置</span><b>${result.assignedCount} / ${result.facilityCount}<small>施設</small></b></div><div><span>変更</span><b>${result.changedCount}<small>施設</small></b></div><div><span>未任命</span><b>${result.vacantCount}<small>施設</small></b></div></div><p class="subtitle">所持する最高ランクの能力で比較し、全施設の奉行補正の合計が高くなる組み合わせにしています。同じ効果なら現在の配置を優先します。指令や資源は消費しません。</p>${result.vacantCount?'<p class="notice">家臣が足りない施設は未任命です。登用・招集後に、もう一度お任せ配置できます。</p>':''}<ul class="governor-result-list">${rows}</ul>`,`<button class="button" data-view="facilities">全施設を確認</button><button class="button gold" data-action="close">閉じる</button>`,'governor-result');
  }
  function autoAssignGovernors(){
    if(!requireWritable())return;
    if(!saveEnabled){toast('保存できる状態を確認してから奉行を配置してください。',true);return;}
    if(game.isStaff&&!staffConstructionReady()){toast('共同拠点の最新の成長を確認してから配置してください。',true);return;}
    const before=state().governors,result=game.autoAssignGovernors();
    if(!result.ok){toast(result.message||'奉行を配置できませんでした。',true);return;}
    if(!save()){game.state.governors=before;renderHeader();refreshLiveControls();toast('保存できなかったため、奉行を元の配置に戻しました。',true);return;}
    preserveInteraction($('#main'),render);playNote(659,.075);governorAssignmentResult(result);
  }
  function facilitiesResults(){const list=data.buildings.filter(b=>(facilityCategory==='all'||b.category===facilityCategory)&&(!facilityQuery||b.name.includes(facilityQuery)||b.description.includes(facilityQuery))),pages=Math.max(1,Math.ceil(list.length/6));facilityPage=Math.max(1,Math.min(facilityPage,pages));return `<div class="section-heading"><small>${list.length}施設 · 建設済み ${data.buildings.filter(b=>state().buildings[b.id]>0).length}/${data.buildings.length}</small><small>全施設 Lv.32まで強化</small></div><div class="facility-catalog">${list.slice((facilityPage-1)*6,facilityPage*6).map(b=>{const level=state().buildings[b.id]||0,j=currentJob('building',b.id),u=game.buildingUnlock(b.id),cost=game.costs(b.id);return `<section class="facility-entry" data-category="${esc(b.category)}">${window.SengokuArt?.facility(b.id,'facility-art',level||1)||''}<div class="facility-entry-heading"><span class="building-symbol">${icon(b.icon)}</span><div><small>${categoryNames[b.category]||'城下町'}</small><h3>${esc(b.name)}</h3></div><span class="facility-seal">${level?`<b>${level}</b><small>/ 32</small>`:'<small>未建設</small>'}</span></div><p>${esc(b.description)}</p><div class="facility-effect">${esc(b.effectText||b.output)}</div>${facilityGovernorLabel(b.id)}${j?`<div class="notice">Lv.${j.targetLevel}へ${j.shared?'共同普請':'普請'}中 · <span data-job-clock="${jobKey(j)}">${esc(jobClockText(j))}</span>${sharedJobAttribution(j)}</div><div class="progress"><i data-job-progress="${jobKey(j)}" style="width:${j.queued?0:game.constructionProgress(j)}%"></i></div><button class="button gold full" data-action="building" data-id="${b.id}">${buildingTailLevel(b.id)<32?"次の増築を予約":"増築の予定を確認"}</button>`:level>=32?'<div class="notice">最高段階に到達</div>':`${costHtml(cost)}<button class="button ${u.ok?'gold':''} full" data-action="building" data-id="${b.id}">${u.ok?(level?'増築・奉行を管理':'建設する'):esc(u.reason||`天守Lv.${u.requiredLevel}で解放`)}</button>`}</section>`;}).join('')||'<div class="empty"><p>条件に合う施設はありません。</p></div>'}</div>${pageControls('facility-page',facilityPage,pages)}`;}
  function renderFacilities(){return heading('城下普請帳','CONSTRUCTION LEDGER · 六十四の礎',`${data.buildings.length}種類の施設を、各32段階まで育てる。`)+`${staffBaseNotice()}<div class="facility-banner"><div><span class="eyebrow">YOUR GROWING DOMAIN</span><h2>一つの普請が、国の力になる。</h2><p>生産、軍備、外交。領国の個性を、あなたの采配で。</p></div><div class="facility-banner-count"><b>${data.buildings.filter(b=>state().buildings[b.id]>0).length}</b><span> / 64 施設</span></div></div><div class="toolbar"><div class="search-box">${icon('search')}<input class="input" id="facility-search" type="search" placeholder="施設名・効果を検索" value="${esc(facilityQuery)}" aria-label="施設を検索"></div><select id="facility-category" class="select" aria-label="施設の分類"><option value="all">すべての施設</option>${Object.entries(categoryNames).map(([k,n])=>`<option value="${k}" ${facilityCategory===k?'selected':''}>${n}</option>`).join('')}</select><button type="button" class="button" data-action="level-guide" data-id="${state().home}">${icon('book')}レベル上げガイド</button><button class="button" data-view="town">${icon('castle')}城下町に戻る</button></div>${governorAssignmentEntry()}<div class="notice">施設と城郭を合わせて同時に${game.constructionSlots()}件まで普請できます。未建設の施設はLv.1から育成し、全施設の上限はLv.32です。奉行に任命した家臣の能力・特技も効果に影響します。</div><div id="facility-results">${facilitiesResults()}</div>`;}

  function logText(text){return String(text??'').replace(/第[0-9０-９]+周[\s·・]*/g,'');}
  function logItems(count=3){return state().log.slice(0,count).map(l=>`<div class="activity-item"><i class="dot ${l.kind==='battle'?'battle':l.kind==='build'?'building':''}"></i><div><p>${esc(logText(l.text))}</p><small>${shortDate(l.turn)}</small></div></div>`).join('');}
  function toggleTownFacilities(node,legend=false){
    const prefix=legend?'town-legend':'town-facilities',preference=legend?'townLegendExpanded':'townFacilitiesExpanded';
    const grid=$(legend?'#town-legend-grid':'#town-buildings-grid');if(currentView!=='town'||!grid||data.buildings.length<=8)return;
    interactionEpoch++;
    const expanded=settings[preference]!==true,collapsedCount=Math.min(8,data.buildings.length);
    settings[preference]=expanded;safeSettings();
    patchHTML(grid,(expanded?data.buildings:data.buildings.slice(0,collapsedCount)).map(legend?b=>`<button class="town-facility-button" data-action="building" data-id="${b.id}">${icon(b.icon)}<span>${esc(b.name)}</span><small>Lv.${state().buildings[b.id]||0}</small></button>`:buildingCard).join(''));
    const count=$(legend?'#town-legend-count':'#town-facility-count');if(count)count.textContent=`${expanded?data.buildings.length:collapsedCount} / ${data.buildings.length}施設を表示中`;
    for(const button of document.querySelectorAll(`[data-action="${legend?'toggle-town-legend':'toggle-town-facilities'}"]`)){
      button.setAttribute('aria-expanded',String(expanded));
      patchHTML(button,icon(expanded?'minus':'plus')+`<span>${expanded?`折りたたむ（${collapsedCount}施設表示）`:`すべて表示（全${data.buildings.length}施設）`}</span>`);
      button.hidden=button.id===prefix+'-toggle-bottom'&&!expanded;
    }
    refreshLiveControls();refreshJobTimers();window.SengokuDesktopFit?.refresh();
    if(!expanded&&node.id===prefix+'-toggle-bottom'){
      const top=$('#'+prefix+'-toggle');top?.focus({preventScroll:true});top?.scrollIntoView({block:'nearest',behavior:'instant'});
    }
  }
  function homeCastleUpgradeHint(id){
    const s=state(),c=game.castle(id),shared=game.isStaff&&id===staffBaseId;
    if(!c||c.owner!==s.clan||game.canOwnCastle?.(id)===false)return '自分の城郭を強化できます。';
    if(shared&&!staffConstructionReady())return '共同拠点の成長を確認中です。';
    if(!canMutate())return '同期・共通時刻の確認後に強化できます。';
    if(!saveEnabled)return 'セーブの保存状態を確認してください。';
    if(s.gameOver)return '新しい物語を始めてください。';
    if(s.command<1)return '指令が1回必要です。回復をお待ちください。';
    if(constructionCount(shared)>=game.constructionSlots())return '普請枠が満員です。完成をお待ちください。';
    if(!hasResources(game.castleUpgradeCost(id)))return '必要な資源が不足しています。';
    return '押すと普請を開始します。完成後にLv.が上がります。';
  }
  function homeCastleUpgrade(id){
    const c=game.castle(id);if(!c)return null;
    const limit=castleLevelLimit(id),shared=game.isStaff&&id===staffBaseId,ready=!shared||staffConstructionReady(),job=ready?currentJob('castle',id):null;
    if(!ready)return {action:'<span class="town-castle-upgrade-state"><b>確認中</b><small>共同拠点</small></span>',detail:'<p class="town-castle-upgrade-note">共同拠点の成長を確認中です。</p>'};
    if(job)return {action:`<span class="town-castle-upgrade-state is-building"><b>普請中</b><small>Lv.${job.targetLevel}へ</small></span>`,detail:`<div class="town-castle-upgrade-detail"><p class="town-castle-upgrade-note" data-job-clock="${jobKey(job)}">${esc(jobClockText(job))}</p><div class="progress"><i data-job-progress="${jobKey(job)}" style="width:${game.constructionProgress(job)}%"></i></div></div>`};
    if(c.level>=limit)return {action:`<span class="town-castle-upgrade-state is-max"><b>MAX</b><small>Lv.${limit}</small></span>`,detail:'<p class="town-castle-upgrade-note">城郭は最高レベルです。</p>'};
    const cost=game.castleUpgradeCost(id);
    return {action:`<button type="button" class="button gold town-castle-level-up" id="home-castle-level-up" data-action="upgrade-castle" data-id="${esc(id)}" data-home-upgrade="true" aria-label="${esc(c.name)}の城郭をLv.${c.level+1}へ強化する" aria-describedby="home-castle-upgrade-cost home-castle-upgrade-hint">${icon('plus')}<span>レベルUP<small>Lv.${c.level+1}へ</small></span></button>`,detail:`<div class="town-castle-upgrade-detail" id="home-castle-upgrade-cost"><small class="town-castle-upgrade-label">城郭の${shared?'共同普請':'強化'}費用 · 指令1回</small>${costHtml(cost)}<p class="town-castle-upgrade-note" id="home-castle-upgrade-hint">${esc(homeCastleUpgradeHint(id))}</p></div>`};
  }
  function premiumTownImage(){return window.SengokuPremiumRuntime?.getAppearance?.().town==='moonlit-castle'?'assets/premium/moonlit-castle-v1.webp':'assets/castle-town.webp?v=4.8.0-20261122';}
  function premiumTownBanner(){return window.SengokuPremiumRuntime?.getAppearance?.().nameplate==='gold-banner'?'<img src="assets/premium/gold-banner-v1.webp" alt="金彩の旗印" width="1024" height="1536" decoding="async" draggable="false">':'';}
  function premiumLord(){const user=window.SengokuSocial?.getUser?.();return user&&!user.isBanned?`<span class="town-lord-identity"><span class="town-lord-label">${window.SengokuResidency?.self?.()?.role==='retainer'?'家臣':'領主'}</span>${window.SengokuAvatar?.markup?.(user,'inline')||''}<span class="player-evaluation-name" data-premium-player="${esc(user.id)}" data-premium-player-name="${esc(user.name)}">${window.SengokuPremiumRuntime?.nameMarkup?.(user.name,window.SengokuPremiumRuntime.getAppearance())||esc(user.name)}</span>${window.SengokuEvaluationUI?.badge?.(user.evaluation)||''}</span>`:'<span class="town-lord-label">あなたの一城を彩る</span>';}
  function refreshPremiumAppearance(){
    const img=$('.town-scene-image'),src=premiumTownImage();if(img&&img.getAttribute('src')!==src){img.src=src;img.alt=src.includes('moonlit')?'月明かりと灯籠に照らされた城下町の全景':'山々と川、城郭、田畑や商家まで見渡せる城下町の全景';}
    const banner=$('[data-town-premium-banner]');if(banner){const html=premiumTownBanner();patchHTML(banner,html);}
    const lord=$('[data-town-premium-lord]');if(lord){const html=premiumLord();patchHTML(lord,html);}
    const user=window.SengokuSocial?.getUser?.(),appearance=window.SengokuPremiumRuntime?.getAppearance?.();
    if(user)for(const node of document.querySelectorAll('[data-premium-player]'))if(node.dataset.premiumPlayer===String(user.id))patchHTML(node,window.SengokuPremiumRuntime?.nameMarkup?.(node.dataset.premiumPlayerName,appearance)||esc(node.dataset.premiumPlayerName));
  }
  function renderTown(){const s=state(),home=game.castle(s.home),army=game.officer(s.army[0]),unclaimed=data.quests.find(q=>!s.claimedQuests.includes(q.id))||data.quests.at(-1),qs=game.questStatus(unclaimed.id);const points={keep:[39,27],farm:[24,76],market:[51,62],lumber:[87,41],quarry:[86,79],barracks:[17,44],wall:[68,43],academy:[57,27]};
    const expanded=settings.townFacilitiesExpanded===true,legendExpanded=settings.townLegendExpanded===true,collapsedCount=Math.min(8,data.buildings.length),visibleBuildings=expanded?data.buildings:data.buildings.slice(0,collapsedCount);
    const legendBuildings=legendExpanded?data.buildings:data.buildings.slice(0,collapsedCount);
    const facilityToggle=(position,legend=false)=>{
      const open=legend?legendExpanded:expanded,prefix=legend?'town-legend':'town-facilities';
      return data.buildings.length>collapsedCount?`<button type="button" id="${prefix}-toggle${position==='bottom'?'-bottom':''}" class="button gold full town-facilities-toggle" data-action="${legend?'toggle-town-legend':'toggle-town-facilities'}" aria-expanded="${open}" aria-controls="${legend?'town-legend-grid':'town-buildings-grid'}"${position==='bottom'&&!open?' hidden':''}>${icon(open?'minus':'plus')}<span>${open?`折りたたむ（${collapsedCount}施設表示）`:`すべて表示（全${data.buildings.length}施設）`}</span></button>`:'';
    };
    return `<div class="dashboard-grid town-workspace"><div class="left-column town-visual"><section class="town-panel" aria-label="城下町の施設。施設名を押すと増築できます"><div class="town-scene-heading"><div class="scene-label"><i></i><strong class="town-scene-name">${esc(home.name)}</strong><span>${game.isStaff?'共同拠点':'城下町'}</span></div><div class="scene-topright"><button class="icon-button" data-action="help" aria-label="遊び方">${icon('help')}</button><button class="icon-button" data-action="fullscreen" aria-label="全画面表示">${icon('expand')}</button></div></div><div class="town-scene"><div class="town-scene-board"><img class="town-scene-image" src="${premiumTownImage()}" alt="山々と川、城郭、田畑や商家まで見渡せる城下町の全景" width="1536" height="1024" decoding="async" draggable="false"><span class="town-premium-banner" data-town-premium-banner>${premiumTownBanner()}</span>${data.buildings.slice(0,8).map(b=>`<button class="hotspot ${currentJob('building',b.id)?'has-job':''}" style="--town-marker-x:${points[b.id][0]}%;--town-marker-y:${points[b.id][1]}%" data-town-x="${points[b.id][0]}" data-town-y="${points[b.id][1]}" data-action="building" data-id="${b.id}" aria-label="${esc(b.name)} レベル${s.buildings[b.id]}の詳細"><span class="pin">${icon(b.icon)}</span><span class="label">${esc(b.name)}<i>Lv.${s.buildings[b.id]}</i></span></button>`).join('')}</div></div><div class="town-scene-legend" role="group" aria-label="城下町の施設一覧"><div class="town-facility-controls"><small id="town-legend-count" class="town-facility-count" role="status" aria-live="polite">${legendBuildings.length} / ${data.buildings.length}施設を表示中</small>${facilityToggle('top',true)}</div><div class="town-legend-grid" id="town-legend-grid">${legendBuildings.map(b=>`<button class="town-facility-button" data-action="building" data-id="${b.id}">${icon(b.icon)}<span>${esc(b.name)}</span><small>Lv.${s.buildings[b.id]||0}</small></button>`).join('')}</div>${facilityToggle('bottom',true)}</div><div class="town-premium-lord"><span data-town-premium-lord>${premiumLord()}</span><button type="button" class="text-link" data-action="premium">外観を変更</button></div><div class="scene-caption"><div><strong>${game.isStaff?'京都御所 · 共同の城下':esc(s.clan==='德川家'?'徳川家':s.clan)+'の城下'}</strong><small>${game.isStaff?'共同普請が、この城下町を育てます。':'人を集め、地を耕し、次の一手を。'}</small></div><span class="weather">${icon('sun')} ${date().season}の風</span></div></section></div><aside class="right-column town-console" id="town-console"><div class="town-overview" id="town-overview">${heading(esc(home.name),'YOUR DOMAIN · 城下町',`${esc(home.province)}国 · ${game.isStaff?'共同拠点':esc(s.clan==='德川家'?'徳川家':s.clan)+'の本拠'} · 城郭 Lv.${home.level} / ${castleLevelLimit(home.id)}`,home.id)}${syncBanner()}${window.SengokuResidency?.compact?.()||''}<div class="expansion-entry"><button class="button gold" data-action="tutorial">${icon('flag')}初陣ガイド</button><button class="button" data-action="progress">${icon('book')}今日の任務</button><button class="button" data-action="progress" data-tab="recap">留守中の報告</button></div><section class="hint-entry" data-hint-entry aria-label="次の一手のヒント"><div class="hint-entry-copy"><span class="eyebrow">次の一手</span><strong data-hint-title>今の状況から、おすすめを確認</strong><p data-hint-reason>城・資産・兵力に合わせて、次にできることをご案内します。</p></div><button type="button" class="button gold" data-action="hints">${icon('help')}ヒントを見る</button></section><button type="button" class="button level-guide-entry full" data-action="level-guide" data-id="${s.home}">${icon('book')}レベル上げガイド</button></div><div class="town-facility-console"><div class="section-heading"><h2>${icon('castle')}施設の発展</h2><button class="text-link" data-view="facilities">全${data.buildings.length}施設を管理</button></div>${governorAssignmentEntry()}<div class="town-facility-controls"><small id="town-facility-count" class="town-facility-count" role="status" aria-live="polite">${visibleBuildings.length} / ${data.buildings.length}施設を表示中</small>${facilityToggle('top')}</div><div class="buildings-grid" id="town-buildings-grid">${visibleBuildings.map(buildingCard).join('')}</div>${facilityToggle('bottom')}${settings.tips?`<div class="tip-bar">${icon('help')}<span>田畑・商家を育てて国力を蓄えましょう。資源と普請は実時間で進み、指令は1倍速で20秒ごとに回復します。</span><button data-action="dismiss-tip" aria-label="ヒントを閉じる">${icon('close')}</button></div>`:''}</div><div class="town-status-panels">${walkingEntry()}${staffBaseNotice()}<section class="panel objective"><div class="eyebrow">NEXT OBJECTIVE</div><h3>${esc(unclaimed.name)}</h3><p>${esc(unclaimed.description)}</p><div class="progress-meta"><span>達成状況</span><span>${qs.progress} / ${qs.target}</span></div><div class="progress"><i style="width:${Math.min(100,qs.progress/qs.target*100)}%"></i></div><button class="button ${qs.complete&&!qs.claimed?'gold':'ghost'} full" data-action="${qs.complete&&!qs.claimed?'claim-quest':'council'}" ${qs.complete&&!qs.claimed?`data-id="${unclaimed.id}"`:''}>${qs.complete&&!qs.claimed?'達成報酬を受け取る':'任務を確認'}</button></section><section class="panel"><div class="panel-heading"><h2>領国の状況</h2>${icon('flag')}</div><div class="stat-row"><span>${icon('castle')}領有拠点</span><b>${game.ownedCastles().length}<small> / ${game.unificationTarget()} 城</small></b></div><div class="stat-row"><span>${icon('users')}所持武将</span><b>${s.officers.length}<small> 名</small></b></div><div class="stat-row"><span>${icon('swords')}兵数</span><b>${num(s.troops)}<small> 人</small></b></div><div class="stat-row"><span>${icon('flag')}士気</span><b>${s.morale}<small> / 100</small></b></div><div class="army-summary">${officerCrest(army)}<div><strong>${army?esc(army.name==='德川家康'?'徳川家康':army.name):'総大将未任命'}</strong><small>${army?esc(army.rank)+' · ':''}出陣軍団 · ${s.army.length}名</small></div><button class="icon-button" data-view="army" aria-label="軍団を編成">${icon('chevron')}</button></div></section><section class="panel"><div class="panel-heading"><h2>${constructionJobs().length?'進行中の普請・研究':'城下の便り'}</h2><small>${constructionJobs().length?'あと少し':'RECENT'}</small></div>${constructionJobs().length?jobsHtml():logItems(3)}</section></div></aside></div>`;
  }
  function sharedJobAttribution(job){if(!job?.shared)return '';const raw=job.startedBy||{},user={...raw,id:/^u_[A-Za-z0-9_]{1,96}$/.test(String(raw.id||''))?String(raw.id):''},name=window.SengokuPremiumRuntime?.nameMarkup?.(user.name||'領主',user.appearance)||esc(user.name||'領主'),badge=window.SengokuEvaluationUI?.badge(user.evaluation)||'',photo=user.id?window.SengokuAvatar?.markup?.(user,'inline')||'':'';return `<small class="staff-base-job-owner">共同普請 · <span class="player-evaluation-person">${photo}<span class="player-evaluation-name" data-premium-player="${esc(user.id||'')}" data-premium-player-name="${esc(user.name||'領主')}">${name}</span>${badge}</span>が${job.queued?'予約':'着手'}</small>`;}
  function strategyEntry(){return `<section class="panel strategy-entry"><div><span class="eyebrow">TACTICAL COUNCIL</span><h2>${icon('book')}軍師AIと作戦を練る</h2><p>作戦文と現在の戦況を評価し、天下地図の隣接城への攻め方を決めます。</p><span data-strategy-status>${strategyRun?.active?'自動進軍 実行中':'作戦を確かめてから、自動進軍を開始できます。'}</span></div><div class="strategy-entry-actions"><button class="button gold" data-action="strategy">軍師AIを開く</button><button class="button" data-action="strategy-stop" data-strategy-stop ${strategyRun?.active?'':'hidden'}>自動進軍を停止</button></div></section>`;}
  function walkingEntry(){return `<section class="panel walking-entry"><div><span class="eyebrow">WALKING</span><h2>${icon('walking')}ウォーキング</h2><p>1歩ごとに、金銭・兵糧・木材・石材・勾玉が各2増えます。</p><small data-walking-summary>端末を持って歩いて、領国を育てる</small></div><button class="button gold" data-action="walking">歩行画面を開く${icon('chevron')}</button></section>`;}
  function staffBaseNotice(){
    if(!game.isStaff)return '';
    const ready=staffConstructionReady(),home=game.castle(staffBaseId);
    return `<section class="panel staff-base-notice"><div class="panel-heading"><h2>${icon('users')}共同拠点</h2><span>占領不可</span></div><p>徳川家の共同本拠、京都御所の城郭・城下町を仲間と共に育てます。</p><div class="stat-row"><span>京都御所の城郭</span><b>Lv.${home.level} / ${castleLevelLimit(staffBaseId)}</b></div><div class="stat-row"><span>共同普請</span><b>${constructionCount(true)} / ${game.constructionSlots()} 件</b></div><p class="staff-base-note">着手した領主が自分の資源と指令1回を支払います。武将・研究・資源・奉行は個人ごとに保持します。</p>${ready?'':'<p class="notice" role="status">共同拠点の最新の成長を確認しています。確認後に共同普請できます。</p>'}<button class="button gold full staff-base-upgrade" data-action="staff-base-detail">${icon('castle')}京都御所の共同普請を開く</button></section>`;
  }
  function staffBaseModal(){modal('京都御所の共同普請','徳川家 · 共同本拠 · 仲間と成長を共有',game.isStaff?castleDetail(staffBaseId):'<div class="notice">スタッフ権限が変更されました。現在の役職を交流画面で確認してください。</div>',`<button class="button" data-action="close">閉じる</button>`,'staff-base',{id:staffBaseId});}
  function jobsHtml(){return `<div class="jobs-list${game.isStaff?' staff-base-jobs':''}">${constructionJobs().map(j=>{const info=j.kind==='branch'?{name:j.name||window.SengokuBranches?.jobName?.(game,j)||window.SengokuBranches?.name?.(game,j.id)||'支拠点'}:(j.kind==='building'?data.buildings:j.kind==='castle'?data.castles:data.techs).find(b=>b.id===j.id),key=jobKey(j);return `<div class="job-item${j.shared?' staff-base-job':''}"><div class="job-top"><span>${esc(info?.name)} Lv.${j.targetLevel}${j.queued?' · 予約':''}${game.isStaff&&!j.shared?' · 個人':''}</span><small data-job-clock="${key}">${esc(jobClockText(j))}</small></div>${sharedJobAttribution(j)}<div class="progress"><i data-job-progress="${key}" style="width:${j.queued?0:game.constructionProgress(j)}%"></i></div></div>`;}).join('')}</div>`;}

  function buildingQueueHtml(id){
    const chain=buildingChain(id);if(!chain.length)return '';
    return `<section class="construction-queue"><h3>${icon('castle')}連続増築 <small>Lv.${chain[chain.length-1].targetLevel}まで手配済み</small></h3><div class="jobs-list">${chain.map(job=>`<div class="job-item${job.shared?' staff-base-job':''}"><div class="job-top"><span>Lv.${job.targetLevel}へ · ${job.queued?'予約済み':'普請中'}</span><small data-job-clock="${jobKey(job)}">${esc(jobClockText(job))}</small></div>${sharedJobAttribution(job)}<div class="progress"><i data-job-progress="${jobKey(job)}" style="width:${job.queued?0:game.constructionProgress(job)}%"></i></div></div>`).join('')}</div><p class="subtitle">前の工事が終わると、次の段階へ順番に着工します。</p></section>`;
  }
  function buildingModal(id){
    const b=data.buildings.find(b=>b.id===id);if(!b)return;
    const s=state(),lv=s.buildings[id]||0,chain=buildingChain(id),tail=buildingTailLevel(id),max=game.buildingMax(id),cost=game.costs(id),unlock=game.buildingUnlock(id),governor=game.officer(s.governors[id]),canGov=lv>0,canQueue=tail<max;
    modal(`${b.name}　${lv?`Lv.${lv} / ${max}`:'未建設'}`,game.isStaff?'共同普請 · 京都御所':'城下町の発展',`${window.SengokuArt?.facility(id,'facility-modal-art',lv||1)||''}${game.isStaff?'<p class="notice staff-base-note">共同の城下町で成長を共有します。予約した領主が自分の資源と指令1回を支払います。奉行はあなた個人の任命です。</p>':''}${id==='keep'?`<button type="button" class="button small full level-guide-entry" data-action="level-guide" data-id="${s.home}">${icon('book')}レベル上げガイド</button>`:''}<p>${esc(b.description)}</p><div class="stat-row"><span>現在の効果 · Lv.${lv}</span><b>${buildingOutput(id)}</b></div><button class="button small full" style="margin:13px 0" data-action="preview-art" data-kind="facility" data-id="${id}">${icon('eye')}32段階の姿を見る</button>${buildingQueueHtml(id)}${canQueue?`<h3>${chain.length?`次の増築を予約 · Lv.${tail+1}へ`:lv?`Lv.${lv+1}へ増築`:'Lv.1を建設'}</h3>${!unlock.ok?`<div class="notice">${esc(unlock.reason)}</div>`:''}<p>1回の操作で1段階を手配し、その資源と指令1回を今支払います。同じ施設の予約はまとめて普請1枠を使います（同時${game.constructionSlots()}枠）。</p>${costHtml(cost)}<p class="subtitle">施設の効果と表示レベルは、各段階の完成時に上がります。予約の取り消しはできません。</p>`:`<div class="notice">${chain.length?`Lv.${max}まで予約済みです。完成をお待ちください。`:'最高レベルに達しています。'}</div>`}${canGov?`<hr class="divider"><div class="stat-row"><span>奉行</span><b>${governor?esc(governor.name):'未任命'}</b></div><p>${esc(game.governorDescription?.(id)||governorHelp[id]||b.description)}軍団との兼任はできません。任命には指示を使いません。</p><button class="button small gold" style="margin-top:14px" data-action="pick-governor" data-id="${id}">${icon('users')}奉行を選ぶ</button>`:''}`,`<button class="button" data-action="close">閉じる</button>${canQueue?`<button class="button primary" data-action="upgrade" data-id="${id}" ${!hasResources(cost)||!unlock.ok||s.command<1||s.gameOver?'disabled':''}>${icon('castle')}${chain.length?'次の増築を予約':game.isStaff?'共同普請する':lv?'増築する':'建設する'}</button>`:''}`,'building',{id});
  }

  let worldMapController=null,worldMapElement=null,fieldController=null,roamingController=null,covertController=null,courtController=null,courtManagementRequested=false;
  function campaignCastleAppearance(marker){
    if(!marker||marker.cluster)return null;
    if(marker.branch)return window.SengokuBranches?.mapAppearance?.(marker)||null;
    const tile=window.SengokuArt?.tileInfo?.('castle',marker.id,marker.level);if(!tile)return null;
    const art=window.SengokuArt?.castle?.(marker.id,'campaign-map-castle-art',marker.level);if(!art)return null;
    return{html:`<span class="campaign-map-castle" data-castle-level="${tile.level}" data-castle-expanded="${tile.finalStage===true}">${art}<span class="campaign-map-castle-level" aria-hidden="true">Lv.${tile.level}</span>${marker.home?'<span class="campaign-map-home-mark" aria-hidden="true">本拠</span>':''}</span>`,label:[marker.name||tile.name,`城郭 Lv.${tile.level}`,marker.owner,marker.home?'本拠':'',marker.restrictedLabel||(marker.disabled?'専用拠点':''),marker.reachable?'進軍可能':''].filter(Boolean).join(' ')};
  }
  function campaignCastleTooltip(marker){
    if(!marker||marker.cluster)return null;
    if(marker.branch)return{title:marker.name,description:`Lv.${marker.level} · ${marker.fallen?'陥落':marker.building?'普請中':'防衛中'}`,detail:'本城の方位を示す配置です。史実の所在地・距離ではありません。'};
    const level=window.SengokuArt?.tileInfo?.('castle',marker.id,marker.level)?.level||Number(marker.level)||1;
    const location=Number.isFinite(marker.lat)&&Number.isFinite(marker.lon)?`${marker.lat.toFixed(4)}°N ${marker.lon.toFixed(4)}°E`:'';
    return{title:marker.name,description:[marker.owner,`城郭 Lv.${level}`,marker.home?'本拠':'',marker.restrictedLabel||(marker.disabled?'専用拠点':''),marker.reachable?'進軍可能':''].filter(Boolean).join(' · '),detail:[`${Number(marker.troops||0).toLocaleString('ja-JP')}兵`,location].filter(Boolean).join(' · ')};
  }
  function syncWorldMap(){const container=$('#world-map');if(currentView!=='map'||!container){worldMapController?.destroy();worldMapController=null;worldMapElement=null;return;}if(!window.SengokuWorldMap){container.innerHTML='<p class="notice">地図を読み込めませんでした。再読み込みしてください。</p>';return;}const s=state(),reachable=new Set(game.adjacentTargets().map(c=>c.id)),options={stateKey:'campaign-map',castles:data.castles.map(c=>({...c,...s.castles[c.id],reachable:reachable.has(c.id)})),selectedId:selectedCastle,region:mapRegion,clan:s.clan,isAdmin:game.isAdmin,isStaff:game.isStaff,homeId:s.home,treaties:s.treaties,turn:s.turn,markerSize:56,branches:window.SengokuBranches?.mapBranches?.(game)||[],onBranchSelect:(parentId,branchId)=>{selectedCastle=parentId;const parent=game.castle(parentId),branch=state().branches?.find(row=>row.id===branchId);if(parent?.owner===state().clan||!branch?.level||branch.fallen)castleUpgradeModal(parentId);else battleModal(parentId,false,branchId);},markerAppearance:campaignCastleAppearance,markerTooltip:campaignCastleTooltip,crestFor:name=>window.SengokuKamon?.url(name),onSelect:id=>{if(id==='edo'&&!game.isAdmin||id===staffBaseId&&!game.isStaff)return;selectedCastle=id;preserveInteraction($('#main'),render);}};if(worldMapController&&worldMapElement===container)worldMapController.update(options);else{worldMapController?.destroy();worldMapElement=container;worldMapController=window.SengokuWorldMap.mount(container,options);}}
  function renderMap(){if(!selectedCastle||selectedCastle==='edo'&&!game.isAdmin)selectedCastle=game.adjacentTargets().sort((a,b)=>a.troops-b.troops)[0]?.id||state().home;const owned=game.ownedCastles(),reachable=new Set(game.adjacentTargets().map(c=>c.id));return heading('天下地図','JAPAN · 山河を越えて、天下へ','日本列島の地形と城跡の位置をたどり、領国を広げる。城の姿とLv.は城郭レベルに連動します。')+`<div class="toolbar map-toolbar"><div class="search-box">${icon('search')}<input id="castle-search" class="input" type="search" value="${esc(mapQuery)}" placeholder="城名・勢力・国名で探す" aria-label="城を検索"></div><select id="map-region" class="select" aria-label="地図の地方"><option value="all">全国${data.castles.length}城</option>${[...new Set(data.castles.map(c=>c.region))].map(r=>`<option ${mapRegion===r?'selected':''}>${r}</option>`).join('')}</select><button class="button small strategy-map-open" data-action="strategy">${icon('book')}軍師AI<span data-strategy-status>${strategyRun?.active?'実行中':'作戦を考える'}</span></button><button class="button small" data-action="strategy-stop" data-strategy-stop ${strategyRun?.active?'':'hidden'}>自動進軍を停止</button><button class="button small" data-view="covert">${icon('eye')}派遣部隊</button><button class="button small" data-view="court">${icon('scroll')}京都御所</button><button class="button small" data-action="map-home">${icon('castle')}本拠へ</button><button class="button small" data-action="map-fit">${icon('expand')}列島全景</button></div><div class="world-layout world-layout-real"><section class="geographic-map-panel" aria-label="日本列島の地理に基づく天下地図"><div id="world-map" class="geographic-map-host"></div></section><aside id="castle-detail" class="panel castle-detail">${castleDetail(selectedCastle)}</aside></div><div class="section-heading"><h2>${icon('flag')}拠点一覧</h2><small>自領 ${owned.length}城 · 進軍できる隣接拠点 ${reachable.size}城</small></div><div id="territory-results">${territoryResults()}</div><p class="notice map-data-note">海岸線は現代の地理データ、城は城跡・施設の代表地点に基づきます。戦国期の海岸線や国境を測量復元したものではありません。勢力配置・進軍経路はゲーム設定です。江戸城は保護された拠点です。</p>`;}
  function territoryResults(){const reachable=new Set(game.adjacentTargets().map(c=>c.id)),s=state();const list=data.castles.map(c=>game.castle(c.id)).filter(c=>(mapRegion==='all'||c.region===mapRegion)&&(!mapQuery||c.name.includes(mapQuery)||c.owner.includes(mapQuery)||c.province.includes(mapQuery))).sort((a,b)=>Number(reachable.has(b.id))-Number(reachable.has(a.id))||Number(b.owner===s.clan)-Number(a.owner===s.clan)),pages=Math.max(1,Math.ceil(list.length/4));territoryPage=Math.max(1,Math.min(territoryPage,pages));return `<div class="territory-list all-territories">${list.slice((territoryPage-1)*4,territoryPage*4).map(c=>`<button class="territory-row ${selectedCastle===c.id?'active':''}" data-action="select-castle" data-id="${c.id}" ${c.id==='edo'&&!game.isAdmin?'disabled title="選択不可"':c.id===staffBaseId&&!game.isStaff?'disabled title="選択不可"':''}>${window.SengokuArt?.castle(c.id,'territory-art',c.level)||''}<div class="territory-name">${clanCrest(c.owner,23)}${esc(c.name)}<br><small>${esc(c.owner==='德川家'?'徳川家':c.owner)} · ${esc(c.province)}</small></div><div class="territory-numbers"><small>${num(c.troops)}兵</small><br><span class="territory-label ${c.owner===s.clan?'own':reachable.has(c.id)?'reachable':''}">${c.id==='edo'&&!game.isAdmin?'選択不可':c.id===staffBaseId&&!game.isStaff?'選択不可':c.owner===s.clan?'自領':reachable.has(c.id)?'隣接':'遠方'}</span></div></button>`).join('')||'<div class="empty"><p>条件に合う拠点はありません。</p></div>'}</div>${pageControls('territory-page',territoryPage,pages,`${list.length}城`)}`;}

  function castleDetail(id){
    const c=game.castle(id);if(!c)return '';
    const s=state(),allowed=game.canOwnCastle?.(id)!==false,own=c.owner===s.clan&&allowed,shared=game.isStaff&&id===staffBaseId,adj=game.adjacentTargets().some(t=>t.id===id),ally=(s.treaties[c.owner]||0)>s.turn,scouted=(s.scouted[id]||0)>s.turn,job=currentJob('castle',id),benefit=game.castleBenefits(id),cost=game.castleUpgradeCost(id),limit=castleLevelLimit(id),branchesBlock=game.parentAttackPermission?.(id)?.ok===false;
    return `<div class="castle-banner">${window.SengokuArt?.castle(id,'castle-detail-art',c.level)||''}${icon('castle')}</div><div class="castle-info"><div class="eyebrow">${esc(c.region)} · ${esc(c.province)}国</div><h2>${esc(c.name)}</h2>${c.majorCity?`<span class="major-city-badge">${icon('castle')}大都市拠点${id==='edo'?' · 保護された拠点':id===staffBaseId?' · 共同拠点・占領不可':''}</span>`:''}<span class="castle-status ${own?'':'enemy'}">${clanCrest(c.owner,25)}${own?'自領':ally?'同盟勢力':'他勢力'} · ${esc(c.owner==='德川家'?'徳川家':c.owner)}</span><div class="stat-row"><span>城郭レベル</span><b>Lv.${c.level} / ${limit}</b></div><div class="stat-row"><span>守備兵</span><b>${num(c.troops)} 人</b></div><div class="stat-row"><span>城壁</span><b>Lv.${c.wall}</b></div><div class="stat-row"><span>街道</span><b>${c.neighbors.length} 城に接続</b></div>${scouted?'<div class="stat-row"><span>偵察効果</span><b>攻撃力 +10%</b></div>':''}</div><button type="button" class="button small full level-guide-entry" data-action="level-guide" data-id="${id}">${icon('book')}レベル上げガイド</button><button class="button small full" data-action="preview-art" data-kind="castle" data-id="${id}">${icon('eye')}32段階の城郭を見る</button>${c.level>32?'<p class="subtitle">城郭は最終形態の姿で、さらに強化されています。</p>':''}${own?`<div class="castle-expansion"><h3>${icon('castle')}${shared?'京都御所の共同普請':'城郭の拡張'}</h3>${shared?'<p class="notice staff-base-note">城郭の成長は共同です。普請を指示するあなたが資源と指令1回を支払います。</p>':''}<p>城郭による防衛補正 +${benefit.defensePercent}%<br>領地の基礎収入：金銭${num(benefit.gold)}・兵糧${num(benefit.rice)} /月</p>${job?`<div class="notice">Lv.${job.targetLevel}へ${shared?'共同普請':'拡張'}中 · <span data-job-clock="${jobKey(job)}">${esc(jobClockText(job))}</span>${sharedJobAttribution(job)}</div><div class="progress"><i data-job-progress="${jobKey(job)}" style="width:${game.constructionProgress(job)}%"></i></div>`:c.level>=limit?`<div class="notice">城郭は最高のLv.${limit}です。</div>`:`${costHtml(cost)}<button class="button gold full${shared?' staff-base-upgrade':''}" data-action="upgrade-castle" data-id="${id}" ${shared&&!staffConstructionReady()?'disabled':''}>Lv.${c.level+1}へ${shared?'共同普請する':'拡張する'}</button>`}<small>${shared?'共同の':'個人の'}施設・城郭の普請枠を使用します。城郭レベルは天守などの施設レベルとは別に育ちます。</small></div><div class="notice">${id===s.home?'あなたの本拠です。城下町から施設も増築できます。':'この城を拠点として、さらに隣接する城へ進軍できます。領地収入は時間経過に応じて自動で加算されます。'}</div><button class="button gold full" data-view="town">${icon('castle')}城下町へ</button>`:!allowed?`<div class="notice">${id===staffBaseId?'京都御所は共同で成長する保護された御所です。':'江戸城は保護された本拠です。'}占領はできません。共通フィールドで報酬戦に挑めます。</div>${id===staffBaseId?'<button class="button gold full" data-view="court">京都御所へ出向く</button>':''}`:`<div><button class="button primary full" data-action="prepare-battle" data-id="${id}" ${!adj||ally||s.gameOver||branchesBlock?'disabled':''}>${icon('swords')}${branchesBlock?'支拠点を先に攻略':ally?'同盟期間中':adj?'この城へ出陣':'自領から遠い拠点'}</button><button class="button full" data-action="scout" data-id="${id}" ${!adj||s.command<1||scouted||s.gameOver?'disabled':''}>${icon('eye')}${scouted?'偵察済み':`偵察　金銭${game.scoutCost().gold}`}</button><button class="button ghost full" data-action="diplomacy-info" data-id="${id}" ${ally||s.gameOver?'disabled':''}>${icon('handshake')}${ally?`同盟あと${s.treaties[c.owner]-s.turn}か月`:'この勢力と同盟'}</button></div>`}${window.SengokuBranches?.render?.(game,id,{writable:canMutate()&&saveEnabled,writableReason:!saveEnabled?'保存状態を確認してから普請してください。':syncMessage(),costHtml,jobKey,jobClockText})||''}`;
  }

  function levelGuideCastle(id){const s=state(),chosen=game.castle(id);return chosen&&chosen.owner===s.clan&&game.canOwnCastle?.(chosen.id)!==false?chosen:game.castle(s.home);}
  function castleUpgradeModal(id){
    const c=levelGuideCastle(id);if(!c)return;
    if(game.isStaff&&c.id===staffBaseId){staffBaseModal();return;}
    modal(`${c.name}の城郭`,'現在の城郭と、次の拡張に必要な費用を確認',castleDetail(c.id),`<button class="button" data-action="close">閉じる</button>`,'castle-upgrade',{id:c.id});
  }
  function levelGuideModal(id){
    const openSections=activeModal==='level-guide'?[...document.querySelectorAll('#modal-content [data-level-guide-section][open]')].map(node=>node.dataset.levelGuideSection):[];
    const s=state(),c=levelGuideCastle(id);if(!c)return;
    const staff=game.isStaff&&!game.isAdmin,sharedCastle=staff&&c.id===staffBaseId,ready=!staff||staffConstructionReady(),keep=s.buildings.keep,limit=castleLevelLimit(c.id),slots=ready?game.constructionSlots():null;
    const keepLevel=ready?`Lv.${keep} / 32`:'共同拠点を確認中',castleLevel=sharedCastle&&!ready?'共同拠点を確認中':`Lv.${c.level} / ${limit}`;
    const castleAction=c.level<limit?`Lv.${c.level+1}へ${sharedCastle?'共同普請する':'拡張する'}`:`Lv.○へ${sharedCastle?'共同普請する':'拡張する'}`;
    const roleText=staff?'共同拠点では、城郭と城下町の全施設を共有します。着手・予約した人が自分の資源と指令を払い、完成後は共同拠点へ反映されます。京都御所の城郭はLv.128まで成長します。京都御所以外の自領の城郭は個人で拡張します。':game.isAdmin?'あなたの本拠は江戸城です。江戸城の城郭はLv.64まで、天守を含む施設はLv.32まで。通常の資源・指令・工期で育てます。':'一般の領主は、自分が領有する城を拡張できます。最初は通常城から始め、二条・大坂・名古屋は領有後にLv.48まで育てられます。江戸・京都御所は保護された拠点のため、占領や本拠への変更はできません。';
    modal('本拠・城郭のレベル上げ',`${c.name}の城郭と、${staff?'京都御所の共同':'本拠の'}天守を案内`,
      `<div class="level-guide-body"><p class="level-guide-intro"><strong>本拠</strong>は、現在の拠点となる城です。育てる場所は<strong>天守（城下町の施設）</strong>と<strong>城郭（城そのもの）</strong>の2つ。それぞれ別のレベルを持ちます。</p>${staff&&!ready?'<p class="level-guide-pending" role="status">共同拠点の最新情報を確認しています。説明は読めますが、共同普請は確認完了後に行ってください。</p>':''}<div class="level-guide-choices"><section class="level-guide-card"><span class="level-guide-label">施設を解放・普請枠を増やす</span><h3>${icon('castle')}天守を育てる</h3><p class="level-guide-current">${esc(keepLevel)}</p><ol class="level-guide-steps"><li>城下町の<strong>「天守」</strong>を押します。</li><li>費用と工期を確認し、<strong>「${staff?'共同普請する':'増築する'}」</strong>を押します。</li><li>工事が完成するとLv.が1上がります。新しい施設の解放条件も満たせます。</li></ol><button type="button" class="button gold full" data-action="building" data-id="keep">天守を開く${icon('chevron')}</button></section><section class="level-guide-card"><span class="level-guide-label">城の守り・領地収入を高める</span><h3>${icon('shield')}城郭を育てる</h3><p class="level-guide-current">${esc(c.name)} · ${esc(castleLevel)}</p><ol class="level-guide-steps"><li>${sharedCastle?'城下町の<strong>「京都御所の共同普請を開く」</strong>を押します。':'<strong>「天下地図」</strong>で自分の城を選び、<strong>「城郭の拡張」</strong>を開きます。'}</li><li>費用と工期を確認し、<strong>「${esc(castleAction)}」</strong>を押します。</li><li>完成したら次の段階へ。城郭を育てても、天守のLv.は変わりません。</li></ol><button type="button" class="button gold full" data-action="level-guide-castle" data-id="${c.id}">${esc(c.name)}の城郭を開く${icon('chevron')}</button></section></div><section class="level-guide-basics"><h3>着手する前に</h3><ul><li><strong>資源と指令1回</strong>が必要です。金銭・木材・石材の必要量は、各詳細画面に表示されます。</li><li>工期は1段階につき<strong>1倍速で60・120・180秒</strong>。天守は120秒、Lv.16以降からの増築は180秒です。完成するまでLv.や効果は変わりません。</li><li>指令は<strong>1倍速で20秒ごとに1回復</strong>します。時間停止中は回復・工事とも進みません。</li><li>施設と城郭は合わせて<strong>${slots?`現在${slots}枠`:'2〜6枠'}</strong>。天守Lv.8・16・24・32で普請枠が1つずつ増えます。研究は別枠です。</li></ul></section><details class="level-guide-details" data-level-guide-section="queue"><summary>工事中に、次のLv.を予約したい</summary><p><strong>施設</strong>は詳細を開いたまま<strong>「次の増築を予約」</strong>で1段階ずつ連続予約できます。予約するたびに、その段階の資源と指令1回を先払いし、前の工事が終わると順番に着工します。同じ施設の予約はまとめて普請1枠です。</p><p>予約はLv.32まで。取り消しはできません。<strong>城郭は連続予約できないため、拡張の完成後に次の段階を選びます。</strong></p></details><details class="level-guide-details" data-level-guide-section="blocked"><summary>ボタンを押せないときは？</summary><p>資源・指令が足りるか、普請枠が空いているか、上限に達していないかを確認してください。城郭は同じ城の工事中に重ねて着工できません。未解放の施設は、詳細に表示された天守Lv.が必要です。</p><p>端末同期・共通時刻の反映中や、別端末が操作中のときも強化を待ちます。共同普請は、最新の共同拠点情報と、共通時間が進行中であることを確認してから行います。</p></details><details class="level-guide-details" data-level-guide-section="limits"><summary>レベルの上限・拠点ごとの違い</summary><dl class="level-guide-limits"><div><dt>天守・全64施設</dt><dd>Lv.32</dd></div><div><dt>通常城の城郭</dt><dd>Lv.32</dd></div><div><dt>二条・大坂・名古屋の城郭</dt><dd>Lv.48</dd></div><div><dt>江戸城の城郭</dt><dd>Lv.64</dd></div><div><dt>京都御所の城郭</dt><dd>Lv.128</dd></div></dl><p>${esc(roleText)}</p><p>「32段階の姿を見る」「32段階の城郭を見る」は見本の閲覧です。見本を切り替えても実際のレベルは上がりません。城郭Lv.33以降も絵は最終形態のまま、能力が育ちます。</p></details><p class="level-guide-more"><a href="guide/#castle-upgrades" target="_blank" rel="noopener">詳しい遊び方を別の画面で読む</a></p></div>`,
      `<button type="button" class="button" data-action="close">閉じる</button>`,'level-guide',{id:c.id});
    document.querySelectorAll('#modal-content [data-level-guide-section]').forEach(node=>{node.open=openSections.includes(node.dataset.levelGuideSection);});
  }

  function artPreviewModal(kind,id,level){const isCastle=kind==='castle',info=isCastle?game.castle(id):data.buildings.find(b=>b.id===id);if(!info)return;const actual=isCastle?info.level:state().buildings[id],chosen=Math.max(1,Math.min(32,Number.isInteger(level)?level:actual||1));modal(`${info.name} · 32段階の絵巻`,`${isCastle?'城郭':'施設'}の現在レベル：${actual?`Lv.${actual}`:'未建設'}`,`<div class="art-preview-stage" id="level-art-preview">${(isCastle?window.SengokuArt?.castle(id,'level-preview-art',chosen):window.SengokuArt?.facility(id,'level-preview-art',chosen))||icon('castle')}</div><div class="art-level-controls"><button class="button small" data-action="art-level-step" data-delta="-1" ${chosen===1?'disabled':''}>前の姿</button><strong id="art-preview-caption">Lv.${chosen} / 32</strong><button class="button small" data-action="art-level-step" data-delta="1" ${chosen===32?'disabled':''}>次の姿</button></div><label for="art-preview-level">見たいレベルを選ぶ</label><input class="range" id="art-preview-level" type="range" min="1" max="32" step="1" value="${chosen}"><p class="subtitle">32段階の完成イラストを閲覧できます。表示する姿を変えても、実際のレベル・資源・進行状態は変わりません。</p>`,`<button class="button primary" data-action="close">閉じる</button>`,'art-preview',{kind,id,level:chosen});}
  function updateArtPreview(level){if(activeModal!=='art-preview'||!activeModalContext)return;const c=activeModalContext,chosen=Math.max(1,Math.min(32,Math.floor(Number(level)||1)));c.level=chosen;const art=c.kind==='castle'?window.SengokuArt?.castle(c.id,'level-preview-art',chosen):window.SengokuArt?.facility(c.id,'level-preview-art',chosen);patchHTML($('#level-art-preview'),art||icon('castle'));$('#art-preview-caption').textContent=`Lv.${chosen} / 32`;$('#art-preview-level').value=chosen;document.querySelectorAll('[data-action="art-level-step"]').forEach(el=>el.disabled=Number(el.dataset.delta)<0?chosen===1:chosen===32);}
  function portrait(o){if(window.SengokuArt?.portrait)return window.SengokuArt.portrait(o);const n=o.name.split('').reduce((a,c)=>a+c.charCodeAt(0),0),horn=n%3;return `<svg class="portrait" viewBox="0 0 120 130" aria-hidden="true"><defs><linearGradient id="armor-${o.id}" x2="1" y2="1"><stop stop-color="#b59b6d" stop-opacity=".6"/><stop offset="1" stop-color="#242c2c"/></linearGradient></defs><path d="M6 130q3-36 30-40l24-5 24 5q27 4 30 40" fill="url(#armor-${o.id})" stroke="currentColor" stroke-width="1"/><path d="m29 97-7 27m69-27 7 27M33 106h54M29 115h62M38 94l22 19 22-19M60 113v17" fill="none" stroke="currentColor" opacity=".7"/><path d="M40 55v22q3 17 20 18 17-1 20-18V55Z" fill="#b4a58b"/><path d="M32 60q0-35 28-35t28 35l-9 9-3-17H44l-4 17Z" fill="#2c3434" stroke="currentColor"/><path d="m27 58 13-6h40l13 6-5 8H32Z" fill="#3a3b30" stroke="currentColor"/><path d="m40 27-13-17 7 28m46-11 13-17-7 28" fill="none" stroke="currentColor" stroke-width="3"/>${horn===0?'<path d="m60 8-6 15 6 7 6-7Z" fill="currentColor"/>':horn===1?'<circle cx="60" cy="22" r="8" fill="none" stroke="currentColor" stroke-width="2"/>':'<path d="M45 16q15 18 30 0" fill="none" stroke="currentColor" stroke-width="3"/>'}<path d="m47 65 7 1m12 0 7-1m-13 4-2 9h5m-11 6q8 4 16 0" fill="none" stroke="#3d3932" stroke-width="1.5"/><path d="m40 72-8 10v11l12-4M80 72l8 10v11l-12-4" fill="#303833" stroke="currentColor" opacity=".7"/></svg>`;}
  function officerFilterDefaults(context='archive'){return{q:'',clan:'all',ownership:'all',sort:context==='governor'?'politics':'lead',direction:'desc',rank:'all',skill:'all',assignment:'all',page:1};}
  function normalizeOfficerFilter(value,context='archive'){
    const base=officerFilterDefaults(context),input=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
    base.q=typeof input.q==='string'?input.q.slice(0,80):'';
    if(input.clan==='all'||roster.some(o=>o.clan===input.clan)||input.clan==='德川家')base.clan=input.clan;
    if(['all','owned','free'].includes(input.ownership))base.ownership=input.ownership;
    if(['lead','valor','intellect','politics','total','rarity','name'].includes(input.sort))base.sort=input.sort;
    if(['asc','desc'].includes(input.direction))base.direction=input.direction;
    if(input.rank==='all'||data.ranks.includes(input.rank))base.rank=input.rank;
    if(input.skill==='all'||Object.hasOwn(skillNames,input.skill))base.skill=input.skill;
    if(['all','idle','army','governor'].includes(input.assignment))base.assignment=input.assignment;
    return base;
  }
  function saveOfficerPreferences(){try{localStorage.setItem(officerPreferencesKey,JSON.stringify({archive:normalizeOfficerFilter(filter),army:normalizeOfficerFilter(choiceFilters.army,'army'),governor:normalizeOfficerFilter(choiceFilters.governor,'governor')}));}catch(_){} }
  function filterOfficerList(list,options,{rankMatches=false}={}){
    const normalize=value=>String(value??'').normalize('NFKC').replace(/德/g,'徳').replace(/\s+/g,'').toLocaleLowerCase('ja'),query=normalize(options.q),s=state(),ranks={D:0,C:1,B:2,A:3,S:4,SS:5,SSS:6,U:7},assigned=new Set(Object.values(s.governors)),army=new Set(s.army),direction=options.direction==='asc'?1:-1;
    const result=list.filter(Boolean).filter(o=>(!query||normalize([o.name,o.clan,o.region,skillNames[o.skill]||''].join(' ')).includes(query))&&(!options.clan||options.clan==='all'||normalize(o.clan)===normalize(options.clan))&&(!rankMatches||!options.rank||options.rank==='all'||o.rank===options.rank)&&(!options.skill||options.skill==='all'||o.skill===options.skill)&&(!options.assignment||options.assignment==='all'||options.assignment==='army'&&army.has(o.id)||options.assignment==='governor'&&assigned.has(o.id)||options.assignment==='idle'&&s.officers.includes(o.id)&&!army.has(o.id)&&!assigned.has(o.id))&&(!options.ownership||options.ownership==='all'||(options.ownership==='owned'?game.ownsVariant(o.id,o.rank):!game.ownsVariant(o.id,o.rank))));
    const value=o=>options.sort==='rarity'?ranks[o.rank]??0:options.sort==='total'?o.lead+o.valor+o.intellect+o.politics:Number(o[options.sort])||0;
    return result.sort((a,b)=>(options.sort==='name'?a.name.localeCompare(b.name,'ja'):(value(a)-value(b)))*direction||a.name.localeCompare(b.name,'ja')||String(a.id).localeCompare(String(b.id)));
  }
  function officerFilterToolbar(context,options){
    const archive=context==='archive',prefix=archive?'officer':'choice',clans=[...new Set(roster.map(o=>o.clan))].sort((a,b)=>a.localeCompare(b,'ja'));
    const defaults=officerFilterDefaults(context);
    const hasConditions=['clan','rank','skill','assignment','sort','direction'].some(key=>options[key]!==defaults[key]);
    const select=(key,label,values)=>`<label class="officer-filter-field" for="${prefix}-${key}"><span>${label}</span><select class="select" id="${prefix}-${key}" data-officer-filter="${key}" data-officer-context="${context}">${values.map(([value,text])=>`<option value="${esc(value)}" ${options[key]===value?'selected':''}>${esc(text)}</option>`).join('')}</select></label>`;
    return `<section class="officer-filter-bar" aria-label="武将の並び替えと絞り込み"><div class="officer-filter-heading"><b>${icon('search')}並び替え・絞り込み</b><button type="button" class="text-link" data-action="officer-reset" data-context="${context}">条件をリセット</button></div><div class="officer-filter-fields"><label class="officer-filter-field officer-filter-search" for="${prefix}-search"><span>武将を検索</span><input class="input" id="${prefix}-search" type="search" maxlength="80" value="${esc(options.q)}" placeholder="武将名・勢力・地方・特技" data-officer-filter="q" data-officer-context="${context}" autocomplete="off"></label></div><details class="officer-filter-drawer"${hasConditions?' open':''}><summary>勢力・能力で絞り込む／並べ替える</summary><div class="officer-filter-fields">${select('clan','勢力',[['all','すべての勢力'],...clans.map(clan=>[clan,clan])])}${select('rank',archive?'表示するランク':'最高所持ランク',[['all',archive?'最高所持・基本ランク':'すべてのランク'],...data.ranks.slice().reverse().map(rank=>[rank,rank+'ランク'])])}${select('skill','特技',[['all','すべての特技'],...Object.entries(skillNames)])}${select('assignment','任命状況',[['all','すべて'],['idle','待機中'],['army','軍団に編成中'],['governor','奉行に任命中']])}${select('sort','並び替え',[['lead','統率'],['valor','武勇'],['intellect','知略'],['politics','政治'],['total','総合能力'],['rarity','ランク'],['name','名前']])}${select('direction','並び順',[['desc','降順'],['asc','昇順']])}</div></details>${archive?`<div class="tabs officer-ownership-tabs" role="group" aria-label="絵巻の所持状況">${[['all','すべて'],['owned','絵巻所持'],['free','未所持']].map(([value,label])=>`<button type="button" class="${options.ownership===value?'active':''}" data-action="officer-filter" data-id="${value}" aria-pressed="${options.ownership===value}">${label}</button>`).join('')}</div>`:'<p class="officer-filter-hint">所持する最高ランクの能力で比較します。</p>'}</section>`;
  }
  function updateOfficerFilter(context,key,value){
    if(!['archive','army','governor'].includes(context)||!['q','clan','rank','skill','assignment','sort','direction'].includes(key))return;
    const previous=context==='archive'?filter:choiceFilters[context],next=normalizeOfficerFilter({...previous,[key]:value},context);
    if(context==='archive')filter=next;else choiceFilters[context]=next;
    choicePage=1;saveOfficerPreferences();
    if(context==='archive'){const target=$('#officer-results');if(target)patchHTML(target,officersResults());}
    else if(activeModal==='officer-select'&&choiceMode===context){const target=$('#officer-choice-results');if(target)patchHTML(target,officerChoiceResults());}
    refreshLiveControls();window.SengokuDesktopFit?.refresh();
  }
  function resetOfficerFilters(context){
    if(context==='archive'){filter=officerFilterDefaults();saveOfficerPreferences();render();}
    else if(['army','governor'].includes(context)){choiceFilters[context]=officerFilterDefaults(context);saveOfficerPreferences();pickOfficer(choiceMode,choiceTarget,1);}
    // An explicit reset replaces the user's draft; background refreshes do not.
    const defaults=context==='archive'?filter:choiceFilters[context];
    if(defaults)document.querySelectorAll('[data-officer-filter]').forEach(node=>{if(node.dataset.officerContext===context){const value=defaults[node.dataset.officerFilter];if(value!==undefined&&node.value!==String(value))node.value=String(value);}});
  }
  function filteredOfficers(){const selectedRank=filter.rank==='all'?undefined:filter.rank;return filterOfficerList(roster.map(o=>game.officer(o.id,selectedRank)),filter);}
  function officerCard(o){return `<button class="officer-card" data-rank="${o.rank}" data-action="officer" data-id="${o.id}"><div class="officer-art"><span class="clan-script clan-script-kamon">${clanCrest(o.clan,30)}</span>${portrait(o)}<span class="rarity rank-${o.rank}">${o.rank}</span>${game.ownsVariant(o.id,o.rank)?'<span class="owned-tag">絵巻所持</span>':'<span class="owned-tag unowned-variant">未所持</span>'}</div><div class="officer-content"><small>${esc(o.clan==='德川家'?'徳川家':o.clan)} · ${esc(o.region)}</small><h3>${esc(o.name==='德川家康'?'徳川家康':o.name)}</h3><div class="mini-stats">${[['lead','統率'],['valor','武勇'],['intellect','知略'],['politics','政治']].map(([k,n])=>`<span>${n}<b>${o[k]}</b></span>`).join('')}</div><div class="skill-tag">${icon(skillIcons[o.skill]||'flag')}${esc(skillNames[o.skill]||o.skill)}</div></div></button>`;}
  function officersResults(){const list=filteredOfficers(),pages=Math.max(1,Math.ceil(list.length/8));filter.page=Math.max(1,Math.min(filter.page,pages));return `<div class="section-heading" style="margin-top:0"><small>${num(list.length)}名 · ${filter.rank==='all'?'最高所持・基本ランク':`${filter.rank}ランクの絵巻`} · ${filter.page} / ${pages}頁</small><small>本作用に描き起こした創作肖像</small></div><div class="officers-grid">${list.slice((filter.page-1)*8,filter.page*8).map(officerCard).join('')||`<div class="empty">${icon('search')}<p>条件に合う絵巻が見つかりません。</p></div>`}</div><div class="pagination"><button class="button small" data-action="officer-page" data-delta="-1" ${filter.page<=1?'disabled':''}>前の頁</button><span>${filter.page} / ${pages}</span><button class="button small" data-action="officer-page" data-delta="1" ${filter.page>=pages?'disabled':''}>次の頁</button></div>`;}
  function renderOfficers(){if(officerSection==='gacha')return heading('武将招集','WARLORD SUMMON · 群雄招来','勾玉を捧げ、まだ見ぬ英傑との縁を結ぶ。')+officerTabs()+renderGacha();return heading('武将名鑑','OFFICER ARCHIVE · 人こそ城',`${num(roster.length)}名 × 8ランク · 所持対象 ${num(game.collection().totalVariants)}種の絵巻。`)+officerTabs()+`${officerFilterToolbar('archive',filter)}<div id="officer-results">${officersResults()}</div><div class="notice">登場年代を越えた「群雄集結」シナリオです。能力・特技・格付けはゲーム用の創作で、歴史上の評価ではありません。全256名それぞれに D・C・B・A・S・SS・SSS・U の8種類、計2,048種の絵巻があります。ランクを選ぶと、そのランクの全武将を閲覧できます。軍団・奉行には所持する最高ランクの能力が反映されます。</div>`;}
  function officerTabs(){const collection=game.collection();return `<div class="officer-subnav"><div class="tabs" role="group" aria-label="武将の画面"><button class="${officerSection==='archive'?'active':''}" data-action="officer-section" data-id="archive" aria-pressed="${officerSection==='archive'}">${icon('users')}武将名鑑</button><button class="${officerSection==='gacha'?'active':''}" data-action="officer-section" data-id="gacha" aria-pressed="${officerSection==='gacha'}">${icon('magatama')}武将招集</button></div><span class="collection-count">家臣 ${collection.officers} / ${roster.length}名<br>絵巻 ${num(collection.variants)} / ${num(collection.totalVariants)}種</span></div>`;}
  function renderGacha(){const s=state(),g=data.gacha,odds=game.gachaOdds(),history=s.gachaHistory.slice(0,48),pages=Math.max(1,Math.ceil(history.length/4));gachaHistoryPage=Math.max(1,Math.min(gachaHistoryPage,pages));const recent=history.slice((gachaHistoryPage-1)*4,gachaHistoryPage*4);return `<section class="gacha-sanctuary"><div class="gacha-sanctuary-art" aria-hidden="true">${icon('magatama')}<span>縁</span></div><div class="gacha-hero-copy"><div class="eyebrow">A FATE WORTH FOLLOWING</div><h2>次なる英傑と、天下へ。</h2><p>全${roster.length}名・8ランク、${num(game.collection().totalVariants)}種の絵巻が招集対象。<br>同じ武将でも、ランクごとに姿と能力が異なります。</p><div class="gacha-balance"><span>${icon('magatama')}所持勾玉</span><b data-magatama-balance>${num(s.magatama)}</b></div><div class="gacha-actions"><button class="button gold" data-action="draw-officers" data-count="1">1回招集 <span>${icon('magatama')}${num(g.singleCost)}</span></button><button class="button primary" data-action="draw-officers" data-count="10">10回招集 <span>${icon('magatama')}${num(g.tenCost)}</span></button></div><p class="gacha-smallprint">指令の消費なし · 10回招集は勾玉${num(g.singleCost*10-g.tenCost)}お得</p></div></section><div class="gacha-details-grid"><section class="panel"><div class="panel-heading"><h2>${icon('crown')}招集の提供割合</h2><button class="text-link" data-action="gacha-odds">全武将の割合を見る</button></div><div class="gacha-rates">${odds.map(r=>`<div><span class="gacha-rank rank-${r.rank}">${r.rank}</span><b>${r.rate}<small>%</small></b><small>${r.count}名</small></div>`).join('')}</div><p class="subtitle">ランク内の対象武将から等確率で抽選。一部の特別な絵巻は抽選対象外です。1回・10回とも同じ割合で1枠ずつ抽選します。確定枠や天井はありません。</p><div class="notice">同じ武将でも別ランクなら新規絵巻です。同じ武将・同じランクの重複だけが勾玉${g.duplicateRefund}に変換されます。戦力には最高所持ランクを反映します。</div></section><section class="panel"><div class="panel-heading"><h2>${icon('magatama')}勾玉を集める</h2><small>プレイで獲得</small></div><div class="gacha-source"><span>${icon('calendar')}月次褒賞</span><b>+${g.monthlyReward}<small> / ゲーム内1か月</small></b></div><div class="gacha-source"><span>${icon('castle')}城の初攻略</span><b>+${g.firstCaptureReward}<small> / 1城につき1度</small></b></div><div class="gacha-source"><span>${icon('scroll')}領主の任務</span><b>+100〜1,000<small> / 任務</small></b></div><p class="subtitle">新しい物語は勾玉${num(g.initial)}で開始します。勾玉の購入や現金の支払いはありません。</p><button class="button full" data-view="council" style="margin-top:17px">${icon('target')}任務と報酬を確認する</button></section></div><div class="section-heading"><h2>${icon('scroll')}最近の招集</h2><small>累計 ${num(s.stats.gachaDraws)}回 · 最新48枚</small></div>${recent.length?`<div class="gacha-history">${recent.map(item=>{const o=game.officer(item.officerId,item.rank);return `<button data-action="officer" data-id="${o.id}" data-rank="${item.rank}" class="gacha-history-row"><span class="gacha-history-rank rank-${item.rank}">${item.rank}</span><span><b>${esc(o.name==='德川家康'?'徳川家康':o.name)}</b><small>${esc(o.clan==='德川家'?'徳川家':o.clan)} · ${shortDate(item.turn)}</small></span><small class="${item.isNew?'new-officer':''}">${item.isNew?(item.isNewOfficer?'新家臣・新絵巻':item.upgraded?'新絵巻・能力上昇':'新たな絵巻'):`同一絵巻 · 勾玉+${item.duplicateRefund}`}</small></button>`;}).join('')}</div>${pageControls('gacha-history-page',gachaHistoryPage,pages)}`:'<div class="panel empty"><p>招集した武将の記録が、ここに残ります。</p><p class="subtitle">まずは1回、あるいは10回。新たな出会いを軍団や城下の力に。</p></div>'}`;}
  function gachaOfficerOddsRows(rank,page){const odds=game.gachaOdds().find(r=>r.rank===rank);if(!odds)return'';const all=game.gachaPool(rank).map(o=>game.officer(o.id,rank)).sort((a,b)=>a.name.localeCompare(b.name,'ja')),list=page===undefined?all:all.slice((page-1)*10,page*10);return list.map(o=>`<tr><th>${esc(o.name==='德川家康'?'徳川家康':o.name)}<small>${esc(o.clan==='德川家'?'徳川家':o.clan)}</small></th><td class="rank-${rank}">${rank}</td><td>${odds.perOfficerRate.toFixed(4)}%</td></tr>`).join('');}
  function individualOddsPage(){const pages=Math.max(1,Math.ceil(game.gachaPool(gachaOddsRank).length/10));gachaOddsPage=Math.max(1,Math.min(gachaOddsPage,pages));return `<div class="gacha-odds-table-wrap"><table class="gacha-odds-table"><thead><tr><th>武将</th><th>ランク</th><th>提供割合</th></tr></thead><tbody id="gacha-individual-odds">${gachaOfficerOddsRows(gachaOddsRank,gachaOddsPage)}</tbody></table></div>${pageControls('gacha-odds-page',gachaOddsPage,pages)}`;}

  function gachaOddsModal(){const odds=game.gachaOdds();modal('武将招集の提供割合',`${roster.length}名・8ランク · 招集対象 ${num(game.collection().totalVariants)}種 · 1回と10回の各枠は同じ確率です。`,`<div class="notice">先にランクを抽選し、そのランクの対象武将から等確率で1名を選びます。対象の人数と各絵巻の割合は、この一覧で確認できます。所持状況・天守レベルは抽選割合に影響しません。確定枠・天井・期間限定武将はありません。</div><div class="gacha-odds-table-wrap"><table class="gacha-odds-table"><thead><tr><th>ランク</th><th>ランク合計</th><th>人数</th><th>武将1名あたり</th></tr></thead><tbody>${odds.map(r=>`<tr><th class="rank-${r.rank}">${r.rank}</th><td>${r.rate}%</td><td>${r.count}名</td><td>${r.perOfficerRate.toFixed(4)}%</td></tr>`).join('')}</tbody></table></div><p class="subtitle">表示は小数第4位まで。厳密な個別割合は「ランク合計 ÷ そのランクの対象人数」です。同じ武将・同じランクの重複だけが勾玉${data.gacha.duplicateRefund}に変換されます。</p><details class="gacha-all-officers"><summary>ランク別・対象武将の個別提供割合</summary><label for="gacha-odds-rank" style="margin-top:17px">確認するランク</label><select id="gacha-odds-rank" class="select">${data.ranks.map(rank=>`<option value="${rank}" ${rank===gachaOddsRank?'selected':''}>${rank}ランク · ${game.gachaPool(rank).length}名</option>`).join('')}</select><div id="gacha-individual-list">${individualOddsPage()}</div></details>`,`<button class="button primary" data-action="close">招集画面へ戻る</button>`,'gacha-odds');}
  function gachaResult(result){modal(result.results.length===10?'十連招集の結果':'武将招集の結果',`新規絵巻 ${result.newCount}枚 · 新たな家臣 ${result.newOfficerCount}名 · 重複変換 勾玉${num(result.refund)}`,`<div class="gacha-result-summary"><span>消費 ${icon('magatama')}${num(result.cost)}</span><span>現在の勾玉 <b data-magatama-balance>${num(state().magatama)}</b></span></div><div class="gacha-result-grid ${result.results.length===1?'single-draw':''}">${result.results.map(item=>`<div class="gacha-draw-result" data-rank="${item.rank}"><div class="gacha-result-label ${item.isNew?'new-officer':''}">${item.isNew?(item.isNewOfficer?'NEW · 新家臣・新絵巻':item.upgraded?'NEW · 上位絵巻':'NEW · 新たな絵巻'):`同一絵巻 · 勾玉+${item.duplicateRefund}`}</div>${officerCard(game.officer(item.officerId,item.rank))}</div>`).join('')}</div><p class="subtitle">絵巻を押すとそのランクの姿・能力・特技を確認できます。上位ランクを獲得すると軍団・奉行の能力が自動で向上します。下位ランクの新規獲得で能力が下がることはありません。</p>`,`<button class="button" data-action="close">招集画面へ</button><button class="button gold" data-view="army">${icon('swords')}軍団を編成</button>`,'gacha-result');playNote(784,.12);}
  function gachaScope(){return JSON.stringify([window.SengokuSocial?.getUser?.()?.id||'',state().walking?.campaignId||'',state().clan,state().home,roleEpoch]);}
  function clearGachaPresentation(){const previous=gachaPresentation;if(previous?.timer)clearTimeout(previous.timer);gachaPresentation=null;if(previous)refreshLiveControls();}
  function finishGachaPresentation(){
    const presentation=gachaPresentation;if(!presentation||presentation.phase!=='playing')return;
    if(presentation.scope!==gachaScope()){closeModal();return;}
    clearTimeout(presentation.timer);presentation.timer=null;presentation.phase='results';gachaResult(presentation.result);
  }
  function beginGachaPresentation(result){
    clearGachaPresentation();
    const highest=result.results.reduce((rank,item)=>data.ranks.indexOf(item.rank)>data.ranks.indexOf(rank)?item.rank:rank,'D');
    gachaPresentation={phase:'playing',result,scope:gachaScope(),timer:null};
    if(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches||window.SengokuPresentation?.getEffectiveMotion?.()==='quiet'){finishGachaPresentation();return;}
    modal(result.results.length===10?'十の縁、英傑招来':'英傑招来','新たな絵巻との出会い。',`<section class="gacha-reveal-stage" data-rank="${highest}"><div class="gacha-reveal-halo" aria-hidden="true"></div><img class="gacha-reveal-emblem" src="assets/emblem.webp" alt=""><div class="gacha-reveal-cards ${result.results.length===1?'single-draw':''}" aria-hidden="true">${result.results.map((item,index)=>`<span class="gacha-sealed-scroll" data-rank="${item.rank}" style="--reveal-index:${index}"><i>縁</i><b>${item.rank}</b></span>`).join('')}</div><h3 class="gacha-reveal-title">群雄、ここに集う。</h3><p role="status">${result.results.length}枚の絵巻を開いています…</p><div class="gacha-reveal-progress" aria-hidden="true"><span></span></div></section>`,`<button type="button" class="button gold" data-action="gacha-skip">演出をスキップ</button>`,'gacha-animation');
    playNote(523,.1);const presentation=gachaPresentation;
    presentation.timer=setTimeout(()=>{if(gachaPresentation===presentation)finishGachaPresentation();},3200);
  }
  function summonOfficers(count){
    if(gachaDrawing||gachaPresentation)return;
    gachaDrawing=true;refreshLiveControls();
    try{const result=drawDurableOfficers(count);if(result.ok)beginGachaPresentation(result);else toast(result.message,true);}
    finally{gachaDrawing=false;refreshLiveControls();}
  }
  function drawDurableOfficers(count){
    if(gachaPresentation)return{ok:false,message:'招集結果を確認してから次の招集へ進んでください。'};
    if(!canMutate())return{ok:false,message:syncMessage()};
    if(!saveEnabled)return{ok:false,message:'自動保存が停止中です。「保存・設定」で保存状態を確認してから招集してください。'};
    const before=JSON.parse(JSON.stringify(state())),result=game.drawOfficers(count);
    if(!result.ok)return result;
    if(!save()){game.state=before;renderHeader();refreshLiveControls();return{ok:false,retryable:true,message:'保存できなかったため、招集と勾玉の消費を取り消しました。保存状態を確認してから再度お試しください。'};}
    preserveInteraction($('#main'),render);return result;
  }
  function officerModal(id,rank){const o=game.officer(id,rank);if(!o)return;const owned=state().officers.includes(id),variantOwned=game.ownsVariant(id,o.rank),highest=game.highestOwnedRank(id),can=game.canRecruitOfficer(id),ranks=game.ownedRanks(id),recruitRank=game.canOwnOfficerVariant(id,o.baseRank)?o.baseRank:'SSS';modal(o.name==='德川家康'?'徳川家康':o.name,`${o.clan==='德川家'?'徳川家':o.clan} · ${o.region} · 絵巻 ${ranks.length} / 8種`,`<div class="variant-tabs" role="group" aria-label="絵巻のランクを選ぶ">${data.ranks.map(r=>`<button data-action="officer-rank-detail" data-id="${id}" data-rank="${r}" class="${r===o.rank?'active':''} ${game.ownsVariant(id,r)?'variant-owned':''}" aria-pressed="${r===o.rank}"><b class="rank-${r}">${r}</b><small>${game.ownsVariant(id,r)?'所持':'未所持'}</small></button>`).join('')}</div><div class="officer-detail-top illustrated-officer" data-rank="${o.rank}"><div class="officer-detail-portrait">${portrait(o)}</div><div><span class="eyebrow">${esc(o.rank)} · ${variantOwned?'所持する絵巻':'未所持の絵巻'}</span><h3>${esc(o.name==='德川家康'?'徳川家康':o.name)}</h3><span class="skill-tag" style="border:0;padding:0;margin:0">${icon(skillIcons[o.skill]||'flag')}${esc(skillNames[o.skill]||o.skill)}</span><p class="subtitle">最高所持ランク：${highest||'未登用'}</p></div></div><div class="stats-bars">${[['lead','統率'],['valor','武勇'],['intellect','知略'],['politics','政治']].map(([k,n])=>`<div class="stat-bar"><label>${n}<b>${o[k]}</b></label><div class="progress"><i style="width:${o[k]}%"></i></div></div>`).join('')}</div><p class="subtitle">${o.rank}絵巻の能力：基礎能力に各 +${o.rankBonus}（上限100）。軍団・奉行には所持する最高ランクの能力が自動で反映されます。</p><p>${esc(o.description||`${o.clan}にゆかりのある人物。`)}</p><div class="notice"><strong>${esc(skillNames[o.skill]||o.skill)}</strong><br>${esc(skillDescriptions[o.skill]||'能力と任命先に応じて軍団・施設を支えます。')}<br>軍団内で同じ特技は重複しません。同一人物を別ランクで重複編成することもできません。</div>${!variantOwned?`<p class="subtitle">${game.canOwnOfficerVariant(id,o.rank)?`この${o.rank}絵巻は未所持です。同じ人物の別ランクも新規獲得になります。`:'このUランクの絵巻は通常の抽選・登用の対象外です。SSS以下の絵巻を選べます。'}</p>`:''}${!owned?`<h3>${recruitRank}絵巻で直接登用</h3><p>直接登用では ${recruitRank} 絵巻を獲得します。天守 Lv.${can.requiredLevel}以上 · 指示1回</p>${costHtml({gold:can.cost})}<p data-recruit-reason="${id}" style="color:var(--gold)">${!can.ok?esc(can.reason):''}</p>`:`<p style="margin-top:16px">${state().army.includes(id)?'出陣軍団に所属しています。':Object.values(state().governors).includes(id)?'施設の奉行を務めています。':'軍団への編成、または奉行への任命ができます。'}</p>`}`,`<button class="button" data-action="close">閉じる</button><button class="button gold" data-action="open-gacha">${icon('magatama')}武将招集</button>${owned?'<button class="button primary" data-view="army">軍団を編成</button>':`<button class="button primary" data-action="recruit-officer" data-id="${id}" ${!can.ok?'disabled':''}>${recruitRank}で登用</button>`}`,'officer',{id,rank:o.rank});}
  function maximumRecruitAmount(){
    const s=state(),limit=Math.max(0,Math.min(20000,Math.floor((game.availableTroopCapacity?.()??game.troopCapacity())-s.troops)));
    if(s.gameOver||!Number.isFinite(limit)||limit<100||!hasResources(game.recruitTroopCost(100)))return 0;
    let low=100,high=limit;
    while(low<high){const amount=Math.ceil((low+high)/2);if(hasResources(game.recruitTroopCost(amount)))low=amount;else high=amount-1;}
    return low;
  }
  function recruitLimitText(maximum){
    const s=state(),space=Math.max(0,Math.floor((game.availableTroopCapacity?.()??game.troopCapacity())-s.troops));
    if(s.gameOver)return 'この戦記は終了しています。';
    if(space<100)return space===0?'兵数が収容上限に達しています。兵舎を増築してください。':`収容上限まで残り${num(space)}人のため、最低100人を募兵できません。兵舎を増築してください。`;
    if(maximum<100)return '最低100人分の金銭・兵糧が足りません。';
    return `現在の最大：${num(maximum)}人（1回100〜20,000人）。${s.command<1?'指令の回復後に募兵できます。':'「最大」で人数を設定し、「募兵する」で実行します。'}`;
  }
  function selectMaximumRecruitment(){
    const input=$('#recruit-amount'),maximum=maximumRecruitAmount();
    if(!input||maximum<100){refreshLiveControls();return;}
    input.value=String(maximum);
    const cost=$('#recruit-cost');if(cost)patchHTML(cost,costHtml(game.recruitTroopCost(maximum)));
    refreshLiveControls();
  }
  function renderArmy(){const s=state(),stats=game.armyStats(),maximum=maximumRecruitAmount();return heading('軍団編成','YOUR ARMY · 兵を知り、将を知る','三名の将を選び、次の合戦に備える。')+`<section class="army-muster-overview" aria-label="出陣前の軍団状況"><div><span>編成した将</span><strong>${stats.count}<small> / 3名</small></strong></div><div><span>本拠の兵力</span><strong>${num(s.troops)}<small>人</small></strong></div><div><span>軍団の士気</span><strong>${s.morale}<small> / 100</small></strong></div></section><div class="army-layout"><div class="left-column"><div class="army-slots">${[0,1,2].map((slot)=>{const o=game.officer(s.army[slot]);return `<section class="army-slot army-illustrated-slot${o?'':' is-vacant'}" data-rank="${o?esc(o.rank):'none'}"><div class="army-slot-heading"><span class="slot-label">${['総大将','副将・一','副将・二'][slot]}</span><span class="army-slot-number" aria-hidden="true">${['壱','弐','参'][slot]}</span></div>${o?`<button type="button" class="army-portrait" data-action="officer" data-id="${esc(o.id)}" aria-label="${esc(o.name==='德川家康'?'徳川家康':o.name)}の能力と絵巻を見る">${portrait(o)}</button>`:`<div class="army-portrait army-portrait-empty" aria-hidden="true">${icon('users')}<span>次の将を、ここに。</span></div>`}<div class="army-card-copy"><h3>${o?`<span class="officer-rank-label rank-${o.rank}">${esc(o.rank)}</span> ${esc(o.name==='德川家康'?'徳川家康':o.name)}`:'未任命'}</h3><p class="army-officer-house">${o?esc(o.clan==='德川家'?'徳川家':o.clan):'家臣から武将を選択'}</p>${o?`<div class="army-abilities" aria-label="${esc(o.name==='德川家康'?'徳川家康':o.name)}の能力">${[['lead','統率'],['valor','武勇'],['intellect','知略']].map(([key,label])=>`<div class="army-ability"><span>${label}</span><b>${o[key]}</b><span class="army-ability-track" aria-hidden="true"><i style="width:${Math.min(100,Math.max(0,o[key]))}%"></i></span></div>`).join('')}</div><p class="army-officer-skill">${icon('flag')}${esc(skillNames[o.skill]||o.skill)}</p>`:'<p class="army-vacancy-copy">三名の将の能力を組み合わせ、次の合戦に備えましょう。</p>'}<button class="button ${slot===0?'gold ':''}full" data-action="pick-army" data-slot="${slot}">${o?'武将を変更':'武将を任命'}</button></div></section>`;}).join('')}</div><section class="panel"><div class="panel-heading"><h2>兵を集める</h2>${icon('swords')}</div><p class="subtitle">兵数 ${num(s.troops)} / ${num(game.troopCapacity())}人 · 兵舎の増築で上限が増加</p><div class="enlist-form"><label for="recruit-amount" class="subtitle">人数</label><div class="recruit-amount-controls"><input id="recruit-amount" class="input" type="number" min="100" max="20000" step="1" value="1000" inputmode="numeric" aria-describedby="recruit-limit"><button type="button" class="button gold" data-action="recruit-max" aria-label="募兵できる最大人数を入力" aria-controls="recruit-amount" aria-describedby="recruit-limit" ${maximum<100?'disabled':''}>最大</button></div><button class="button primary" data-action="recruit-troops" ${s.command<1||s.gameOver?'disabled':''}>${icon('users')}募兵する</button></div><div id="recruit-cost">${costHtml(game.recruitTroopCost(1000))}</div><p id="recruit-limit" class="subtitle recruit-limit" role="status">${esc(recruitLimitText(maximum))}</p><p class="subtitle">募兵・訓練はそれぞれ指令1回。指令は1倍速で20秒ごとに1回復します。</p><hr class="divider"><div class="stat-row"><span>士気</span><b>${s.morale} / 100</b></div><div class="progress"><i style="width:${s.morale}%"></i></div>${costHtml(game.trainingCost?game.trainingCost():{gold:180,rice:250})}<button class="button full" data-action="train" ${s.morale>=100||s.command<1||s.gameOver?'disabled':''}>${icon('flag')}軍団を訓練する</button></section><div class="section-heading"><h2>${icon('swords')}合戦の戦法</h2><small>出陣ごとに選択できます</small></div><div class="tactics-grid">${data.tactics.map(t=>`<div class="tactic-card" data-tactic="${esc(t.id)}"><h3>${esc(t.name)}</h3><p>${esc(t.description)}</p></div>`).join('')}</div></div><aside><section class="panel"><div class="panel-heading"><h2>軍団の平均能力</h2>${icon('flag')}</div>${[['lead','統率'],['valor','武勇'],['intellect','知略']].map(([k,n])=>`<div class="army-average-stat"><div class="stat-row"><span>${n}</span><b>${stats[k]}<small> / 100</small></b></div><div class="army-ability-track" aria-hidden="true"><i style="width:${Math.min(100,Math.max(0,stats[k]))}%"></i></div></div>`).join('')}<div class="notice">軍団には同じ武将を重複して編成できません。奉行に任命すると軍団から外れます。</div><button class="button primary full" data-view="map" style="margin-top:18px">${icon('map')}天下地図から出陣</button><button class="button full" data-view="roaming" style="margin-top:10px">${icon('swords')}野良兵士と戦う</button><button class="button full" data-view="covert" style="margin-top:10px">${icon('eye')}派遣部隊を管理</button><button class="button gold full" data-action="troop-trade" style="margin-top:10px">${icon('handshake')}兵士を輸出入</button></section><section class="panel"><div class="panel-heading"><h2>補給の見通し</h2>${icon('wheat')}</div><div class="stat-row"><span>月間兵糧生産</span><b>+${num(game.income().grossRice)}</b></div><div class="stat-row"><span>兵・城の維持費</span><b>−${num(game.income().upkeep)}</b></div><div class="stat-row"><span>差引</span><b style="color:${game.income().rice<0?'#d8837a':'var(--green)'}">${game.income().rice>=0?'+':''}${num(game.income().rice)}</b></div><p class="subtitle">兵糧不足は兵の脱走と士気低下につながります。</p></section></aside></div>`;}
  function officerChoiceResults(){
    const s=state(),list=filterOfficerList(s.officers.map(id=>game.officer(id)),{...choiceFilters[choiceMode],ownership:'owned'},{rankMatches:true}),pages=Math.max(1,Math.ceil(list.length/8));choicePage=Math.max(1,Math.min(choicePage,pages));
    return `<div class="officer-choice-count" role="status">${list.length} / ${s.officers.length}名 · ${choicePage} / ${pages}頁</div><div class="officer-choice-list">${list.slice((choicePage-1)*8,choicePage*8).map(o=>`<button class="officer-choice" data-action="${choiceMode==='army'?'assign-army':'assign-governor'}" data-id="${o.id}" data-target="${choiceTarget}">${officerCrest(o)}<span class="officer-choice-description"><b><span class="officer-rank-label rank-${o.rank}">${esc(o.rank)}</span> ${esc(o.name==='德川家康'?'徳川家康':o.name)}</b><small>統率 ${o.lead} · 武勇 ${o.valor} · 知略 ${o.intellect} · 政治 ${o.politics}</small><small>${esc(skillNames[o.skill]||o.skill)}</small></span><small>${s.army.includes(o.id)?'軍団':Object.values(s.governors).includes(o.id)?'奉行':'待機'}</small></button>`).join('')||'<div class="empty"><p>条件に合う家臣がいません。</p><button type="button" class="button" data-action="officer-reset" data-context="'+choiceMode+'">条件をリセット</button></div>'}</div>${pageControls('choice-page',choicePage,pages)}`;
  }
  function pickOfficer(mode,target,page=1){
    choiceMode=mode==='army'?'army':'governor';choiceTarget=target;choicePage=page;
    modal(choiceMode==='army'?'出陣する将を選ぶ':'奉行を任命する',choiceMode==='army'?'編成には指示を使いません。':`${game.governorDescription?.(target)||governorHelp[target]||'施設の働きを高めます。'}任命には指示を使いません。`,officerFilterToolbar(choiceMode,choiceFilters[choiceMode])+`<div id="officer-choice-results">${officerChoiceResults()}</div>`,`<button class="button ghost" data-action="${choiceMode==='army'?'remove-army':'remove-governor'}" data-target="${target}">任命を解除</button><button class="button" data-action="close">閉じる</button>`,'officer-select',{mode:choiceMode,target});
  }
  function renderResearch(){
    const s=state(),totalLevels=data.techs.reduce((sum,t)=>sum+t.max,0),learnedLevels=data.techs.reduce((sum,t)=>sum+Math.min(t.max,s.tech[t.id]||0),0),completed=data.techs.filter(t=>(s.tech[t.id]||0)>=t.max).length,active=data.techs.find(t=>currentJob('research',t.id));
    const illustrations={cultivation:'irrigation',commerce:'market',forestry:'sawmill',masonry:'stoneworks',conscription:'barracks',discipline:'war_school',gunnery:'gunsmith',siege:'engineering_shop'};
    return heading('技術研究','RESEARCH · 富国強兵','学問を育て、内政と軍事に新たな力を。')+`<section class="research-overview" aria-label="技術研究の進捗"><div class="research-overview-copy"><span class="eyebrow">知を積み重ね、国を強く。</span><h2>領国の技術を磨く</h2><p>技術レベルは学問所のレベルまで。研究は同時に1つ、各技術は最大Lv.5です。</p><button class="button gold" data-action="building" data-id="academy">${icon('book')}学問所を確認・増築</button></div><div class="research-overview-metrics"><div><span>修得した段階</span><strong>${learnedLevels}<small> / ${totalLevels}</small></strong><div class="progress" aria-hidden="true"><i style="width:${totalLevels?learnedLevels/totalLevels*100:0}%"></i></div></div><div><span>極めた技術</span><strong>${completed}<small> / ${data.techs.length}</small></strong></div><div><span>学問所</span><strong><small>Lv.</small>${s.buildings.academy}</strong></div><div class="research-current"><span>現在の研究</span><b>${active?esc(active.name):'研究待ち'}</b></div></div></section><div class="research-grid">${data.techs.map(t=>{const lv=s.tech[t.id]||0,job=currentJob('research',t.id),cost=game.researchCost(t.id),max=lv>=t.max,locked=lv>=s.buildings.academy,artId=illustrations[t.id]||'academy',status=max?'completed':job?'running':locked?'locked':'available';return `<section class="research-card research-illustrated-card" data-research-state="${status}" data-art-theme="research"><div class="research-visual" aria-hidden="true">${window.SengokuArt?.facility(artId,'research-art',Math.max(1,s.buildings[artId]||1))||icon(t.icon)}<span class="research-state">${max?'修得完了':job?'研究中':locked?'学問所の増築で解放':'次の研究へ'}</span></div><div class="research-card-copy"><div class="research-card-heading">${icon(t.icon)}<h3>${esc(t.name)}</h3></div><p>${esc(t.description)}</p><div class="stat-row"><span>研究レベル</span><b>Lv.${lv} / ${t.max}</b></div><div class="research-levels" aria-label="研究レベル${lv}、最大${t.max}">${Array.from({length:t.max},(_,level)=>`<span class="${level<lv?'is-learned':''}" aria-hidden="true">${level+1}</span>`).join('')}</div>${max?'<p class="notice research-completed">すべての段階を修得しました。</p>':job?`<div class="notice">研究中 · <span data-job-clock="${jobKey(job)}">${esc(jobClockText(job))}</span>${sharedJobAttribution(job)}</div><div class="progress"><i data-job-progress="${jobKey(job)}" style="width:${game.constructionProgress(job)}%"></i></div>`:`${costHtml(cost)}<button class="button ${locked?'':'gold'} full" data-action="research" data-id="${t.id}" ${locked||s.command<1||!hasResources(cost)||s.jobs.some(j=>j.kind==='research')||s.gameOver?'disabled':''}>${locked?'学問所の増築が必要':'研究を始める'}</button>`}</div></section>`;}).join('')}</div>`;
  }
  function renderCouncil(){const s=state(),questPages=Math.max(1,Math.ceil(data.quests.length/4)),logPages=Math.max(1,Math.ceil(s.log.length/5));questPage=Math.max(1,Math.min(questPage,questPages));logPage=Math.max(1,Math.min(logPage,logPages));return heading('軍議','COUNCIL · 進むべき道','功績を重ね、天下への歩みを記す。')+strategyEntry()+`<div class="council-grid"><section><div class="section-heading" style="margin-top:0"><h2>${icon('target')}領主の任務</h2><small>${s.claimedQuests.length} / ${data.quests.length} 達成報酬受取済み</small></div><div class="quest-list">${data.quests.slice((questPage-1)*4,questPage*4).map(q=>{const a=game.questStatus(q.id);return `<section class="quest-row"><div class="quest-emblem">${icon(a.claimed?'check':a.complete?'crown':'flag')}</div><div class="quest-content"><h3>${esc(q.name)}</h3><p>${esc(q.description)} ${a.progress} / ${a.target}</p><div class="progress"><i style="width:${Math.min(100,a.progress/a.target*100)}%"></i></div></div><div class="quest-reward">${Object.keys(q.reward).map(k=>`${k==='magatama'?'勾玉':resNames[k]} +${num(q.reward[k])}`).join('<br>')}</div><button class="button small ${a.complete&&!a.claimed?'gold':''}" data-action="claim-quest" data-id="${q.id}" ${!a.complete||a.claimed?'disabled':''}>${a.claimed?'受取済み':a.complete?'報酬を受け取る':'挑戦中'}</button></section>`;}).join('')}</div>${pageControls('quest-page',questPage,questPages)}</section><section><div class="section-heading"><h2>${icon('scroll')}領国の戦記</h2><button class="text-link" data-action="export-save">この戦記を保存</button></div><section class="panel log-panel">${s.log.slice((logPage-1)*5,logPage*5).map(l=>`<div class="activity-item"><small>${shortDate(l.turn)}</small><p>${esc(logText(l.text))}</p></div>`).join('')}</section>${pageControls('log-page',logPage,logPages)}</section></div>`;}

  let battleAdviceStyle='balanced',battleAdviceBinding=null;
  function currentBattleAdvice(){return game.adviseBattle({mode:battleBranchTarget?'branch':'castle',targetId:battleBranchTarget||battleTarget,style:battleAdviceStyle});}
  function renderBattleAdvisor(){const host=$('#battle-advisor-slot');if(host&&window.SengokuBattleAdvisor)window.SengokuBattleAdvisor.render(host,currentBattleAdvice(),{action:'battle-apply'});}
  function mountBattleAdvisor(){
    battleAdviceBinding?.dispose();battleAdviceBinding=null;const host=$('#battle-advisor-slot'),advisor=window.SengokuBattleAdvisor;if(!host||!advisor)return;
    renderBattleAdvisor();battleAdviceBinding=advisor.bind(host,{action:'battle-apply',getAdvice:()=>activeModal==='battle'?currentBattleAdvice():null,onApply(advice){if(activeModal!=='battle')return;battleTactic=advice.tactic;battleTroops=advice.troops;const tactic=$('#battle-tactic');if(tactic)tactic.value=battleTactic;updateBattlePreview();toast('軍師の案を反映しました。出陣内容を確認してください。');},onStyleChange(style){battleAdviceStyle=style;renderBattleAdvisor();},onUnavailable(advice){renderBattleAdvisor();if(advice?.message)toast(advice.message);}});
  }
  function battleModal(id,preserve=false,branchId=''){syncMusic('battle');const c=game.castle(id);if(!c)return;battleTarget=id;battleBranchTarget=branchId;if(!preserve){battleTactic='balanced';battleTroops=state().troops;}const p=branchId?game.previewBranchBattle(branchId,battleTactic,battleTroops):game.previewBattle(id,battleTactic,battleTroops),targetName=branchId?window.SengokuBranches?.name?.(game,branchId)||'支拠点':c.name;modal(`${targetName}への出陣`,`${c.owner} · ${c.province}国`,`<div class="stat-comparison"><div><small>出陣する兵</small><b id="battle-troop-count" class="large-stat">${num(battleTroops)}</b><small>${state().army.map(i=>esc(game.officer(i)?.name)).join('・')||'武将未任命'}</small></div><span class="versus">対</span><div><small>${branchId?'支拠点を守る兵':'城を守る兵'}</small><b id="battle-enemy-count" class="large-stat">${num(branchId?p.enemyTroops:c.troops)}</b><small id="battle-enemy-wall">${branchId?'支拠点 Lv.'+(p.branchLevel||0):'城郭 Lv.'+c.level+' · 城壁 Lv.'+c.wall}</small></div></div><div class="form-row"><label for="battle-troops" class="inline-label"><span>出陣兵数</span><span>${num(battleTroops)} / ${num(state().troops)}人</span></label><input id="battle-troops" class="range" type="range" min="${Math.min(300,state().troops)}" max="${state().troops}" step="1" value="${battleTroops}"></div><label for="battle-tactic">戦法を選ぶ</label><select id="battle-tactic" class="select">${data.tactics.map(t=>`<option value="${t.id}" ${battleTactic===t.id?'selected':''}>${esc(t.name)} — ${esc(t.description)}</option>`).join('')}</select><div id="battle-advisor-slot"></div><div style="margin:18px 0" id="battle-preview">${battlePreview(p)}</div>${branchId?'<p class="branch-battle-note">支拠点を落としてから本城へ進軍します。支拠点戦では領地の占領・資源の獲得はありません。</p>':''}<div class="notice">出陣は指示1回を使います。合戦では兵を失うことがあります。勝率は戦力差による予測で、勝利の保証ではありません。</div>`,`<button class="button" data-action="close">再考する</button><button id="attack-confirm" class="button primary" data-action="${branchId?'attack-branch':'attack'}" ${!p.ok?'disabled':''}>${icon('swords')}出陣する</button>`,'battle');mountBattleAdvisor();}
  function battlePreview(p){return `${window.SengokuTravelUI?.preview(p.travel)||''}<div class="battle-chance">予想勝率 <b>${p.winChance}%</b></div><div class="stat-row"><span>自軍戦力 / 敵軍戦力</span><b>${num(p.attackPower)} / ${num(p.defensePower)}</b></div><div class="cost"><span>${icon('wheat')}兵糧 ${num(p.foodCost)}</span>${p.scouted?`<span>${icon('eye')}偵察補正 +10%</span>`:''}</div>${!p.ok?`<p style="color:#e7a194;font-size:13px">${esc(p.message)}</p>`:''}`;}
  function updateBattlePreview(){if(!$('#battle-preview'))return;const c=game.castle(battleTarget),s=state(),slider=$('#battle-troops');battleTroops=Math.max(0,Math.min(battleTroops,s.troops));if(slider){slider.min=Math.min(300,s.troops);slider.max=s.troops;if(Number(slider.value)!==battleTroops)slider.value=battleTroops;}const p=battleBranchTarget?game.previewBranchBattle(battleBranchTarget,battleTactic,battleTroops):game.previewBattle(battleTarget,battleTactic,battleTroops);patchHTML($('#battle-preview'),battlePreview(p));$('#battle-troop-count').textContent=num(battleTroops);$('#attack-confirm').disabled=!p.ok;if(c){$('#battle-enemy-count').textContent=num(battleBranchTarget?p.enemyTroops:c.troops);$('#battle-enemy-wall').textContent=battleBranchTarget?`支拠点 Lv.${p.branchLevel||0}`:`城郭 Lv.${c.level} · 城壁 Lv.${c.wall}`;const subtitle=$('#modal .modal-header p');if(subtitle)subtitle.textContent=`${c.owner} · ${c.province}国`;}const label=$('label[for="battle-troops"]');if(label)patchHTML(label,`<span>出陣兵数</span><span>${num(battleTroops)} / ${num(s.troops)}人</span>`);renderBattleAdvisor();}
  function branchBattleResult(b){syncMusic(b.won?'victory':'defeat');modal(b.won?'支拠点陥落の報せ':'支拠点から撤退',`${shortDate()} · ${b.castleName}`,`<div class="battle-result ${b.won?'':'lost'}"><h2>${b.won?'支拠点を突破':'退却'}</h2><p>${b.won?'残る支拠点をすべて落とすと、本城へ出陣できます。':'兵を立て直し、次の機会をうかがいましょう。'}</p></div><p class="branch-battle-note">この戦いでは領地の占領・資源の獲得はありません。</p><div class="stat-row"><span>出陣兵数</span><b>${num(b.ourBefore)}人</b></div><div class="stat-row"><span>自軍の損失</span><b>${num(b.ourLost)}人</b></div><div class="stat-row"><span>帰還兵</span><b>${num(Math.max(0,b.ourBefore-b.ourLost))}人</b></div><div class="battle-phases">${(b.phases||[]).map(phase=>`<div class="battle-phase"><b>${esc(phase.title)}</b><p>${esc(phase.text)}</p></div>`).join('')}</div>`,`<button class="button primary" data-action="close">地図へ戻る</button>`,'result');}
  function battleResult(b){syncMusic(b.won?'victory':'defeat');modal(b.won?'戦勝の報せ':'撤退の報せ',`${shortDate()} · ${b.castleName}`,`<div class="battle-result ${b.won?'':'lost'}"><div class="eyebrow">${b.won?'VICTORY':'RETREAT'}</div><h2>${b.won?'勝鬨':'退却'}</h2><p class="subtitle">${b.won?`${esc(b.castleName)}があなたの領国に加わりました。`:'兵を立て直し、次の機会をうかがいましょう。'}</p></div><div class="stat-comparison"><div><small>自軍の損失</small><b class="large-stat">${num(b.ourLost)}</b><small>出陣 ${num(b.ourBefore)}人</small></div><span class="versus">/</span><div><small>敵軍の損失</small><b class="large-stat">${num(b.enemyLost)}</b><small>守備 ${num(b.enemyBefore)}人</small></div></div><div class="stat-row"><span>城の守備隊へ配置</span><b>${num(b.garrison||0)} 人</b></div><div class="stat-row"><span>出陣軍から帰還</span><b>${num(Math.max(0,b.ourBefore-b.ourLost-(b.garrison||0)))} 人</b></div><p class="subtitle">帰還兵は待機兵に戻ります。新領地の守備兵は、出陣できる兵数と別に管理します。</p><div class="battle-phases">${(b.phases||[]).map(p=>`<div class="battle-phase"><b>${esc(p.title)}</b><p>${esc(p.text)}</p></div>`).join('')}</div>${b.rewards?.gold||b.rewards?.rice?`<h3>戦利品</h3>${costHtml(b.rewards)}`:''}${b.capturedOfficer?`<div class="notice">${esc(typeof b.capturedOfficer==='string'?(game.officer(b.capturedOfficer)?.name||b.capturedOfficer):b.capturedOfficer.name)}が家臣に加わりました。</div>`:''}`,`<button class="button primary" data-action="close">領国へ戻る</button>`,'result');}
  function settingsModal(){modal('保存・設定','あなたの歩みを、次の一手へ。',`${saveWarning?`<div class="notice">${esc(saveWarning)}</div>`:''}${window.SengokuPresentation?.settingsMarkup?.()||''}<div class="settings-stack"><button class="button" data-action="notifications">${icon('flag')}<span>通知設定<small>合戦・書状・作戦・普請・イベント。日本時間で静かな時間帯を設定。</small></span></button><button class="button" data-action="progress" data-tab="recap">${icon('book')}<span>成長手帳・留守中の報告<small>任務、編成セット、武将育成、歴代記録を確認。</small></span></button><p class="notice">各資産の所有上限は100,000,000です。施設の収容量や1回の出陣人数は別に適用されます。</p><button class="button" data-action="premium" aria-haspopup="dialog">${icon('flag')}<span>有料版・支援<small>実際の外観を見比べ、購入済みの装いを管理します。</small></span></button><button class="button" data-action="walking">${icon('walking')}<span>ウォーキング<small>1歩ごとに5つの資産が各2増えます。端末の動きで歩数を推定。</small></span></button><button class="button" data-action="open-recovery">${icon('upload')}<span>引き継ぎ・データ復元<small>ドメイン変更・機種変更後に、元の領主と進行へ戻ります。</small></span></button><button class="button" data-action="export-complete-backup">${icon('save')}<span>領主と進行をまとめて書き出す<small>ログイン情報とセーブを一つのバックアップへ。</small></span></button><button class="button" data-action="open-sync">${icon('refresh')}<span>端末同期・引き継ぎ<small>${esc(syncAccess.linked?syncMessage():'同じ領主IDを連携すると、進行を自動で共有します。')}</small></span></button><button class="button" data-action="export-sync-backup">${icon('download')}<span>同期・読込前のセーブを取り出す<small>置き換え前のバックアップをJSONで書き出します。</small></span></button>${game.isAdmin?`<div class="notice admin-fixed-base">${icon('castle')}<strong>本拠：江戸城（固定）</strong><br>武将・施設・資源は連携した端末へ引き継ぎます。</div><button class="button gold" data-action="restore-admin-assets">${icon('crown')}<span>徳川家康 U を復元<small>利用資格を確認済み。何度押しても重複付与しません。</small></span></button>`:''}<button class="button" data-action="open-gacha">${icon('magatama')}<span>武将招集・勾玉<small>所持 ${num(state().magatama)} · プレイで集める専用通貨。</small></span></button><button class="button" data-action="export-save">${icon('download')}<span>セーブデータを書き出す<small>JSONファイルとして保存。他の端末へ引き継げます。</small></span></button><button class="button" data-action="import-save">${icon('upload')}<span>セーブデータを読み込む<small>確認後に、現在のプレイへ反映します。</small></span></button><button class="button" data-action="install">${icon('plus')}<span>ホーム画面に追加<small>スマホからアプリのように起動。</small></span></button></div><hr class="divider"><div class="settings-row"><label>BGM · 全16曲</label><button class="button small" data-action="sound-settings">${settings.sound?'再生中 · 停止':'停止中 · 再生'}</button></div><p class="notice">BGMを再生すると、対応するスマホ・タブレットではマナーモード中も音が鳴ります。端末のメディア音量を上げ、最初に再生ボタンをタップしてください。</p><button class="button gold full" style="margin-top:14px" data-action="music">${icon('sound')}音楽帳を開く · 16曲から選ぶ</button><div class="settings-row"><label for="volume">音量</label><input id="volume" type="range" min="0" max="100" step="1" value="${settings.volume}" aria-label="BGM音量"></div><div class="settings-row"><label for="tips">城下町のヒント</label><select id="tips" class="select"><option value="on" ${settings.tips?'selected':''}>表示する</option><option value="off" ${settings.tips?'':'selected'}>表示しない</option></select></div><div class="settings-row"><span style="font-size:14px">現在の難易度</span><span style="font-size:13px;color:var(--gold)">${({easy:'初陣',normal:'戦国',hard:'修羅'})[state().difficulty]}</span></div><button class="button danger full" style="margin-top:23px" data-action="new-game">${icon('refresh')}新しい物語を始める</button><div class="notice">未連携ではこのブラウザに自動保存します。領主登録・端末連携後は同じIDの進行を自動同期します。操作できる端末は同時に1台です。通信が切れても世界の時間は進み続け、再接続時に共通時刻へ追いつきます。通信を確認できるまで操作は待機します。領主データとセーブは書き出して保管できます。</div>`,`<button class="button" data-action="help">遊び方</button><button class="button primary" data-action="close">ゲームへ戻る</button>`,'settings');}
  function helpModal(){modal('天下への道しるべ','月を重ね、城を育て、将とともに天下へ。',`<div class="help-steps">${[['城下を育てる','田畑は兵糧、商家は金銭を生みます。施設を選んで増築すると表示された秒数で完成。木材と石材も計画的に確保しましょう。'],['武将を迎える','名鑑から武将を登用するほか、勾玉で武将招集ができます。勾玉は毎月・任務・城の初攻略で集まります。軍団に最大3名を編成。政治の高い家臣は各施設の奉行に任命し、生産・登用・募兵・防衛・研究を支えます。'],['時を味方にする','資源は毎秒、普請と研究は実時間で進みます。1倍速では指令が20秒ごとに1回復し、60秒がゲーム内の1か月です。時間は全プレイヤー共通。1560〜1615年を周回し、画面を閉じていても進みます。再接続時に経過した分を反映します。速度・停止は全員共通です。'],['軍備を整える','募兵と訓練で兵数と士気を確保します。兵糧は軍の維持と出陣に必要です。研究で生産量や戦闘力を強化できます。'],['兵士を輸出入する','交流の交易で、兵士の人数と対価を指定して他の領主と輸出入できます。無償の移送も可能です。輸出兵は提案時に預け、相手の承認で移動します。取消・拒否の兵士は受取待ちに戻り、兵舎の収容上限を確認して受け取ります。'],['野良兵士と戦う','野良兵戦でCPU部隊を選び、出陣兵数と戦法を決めます。指令1と兵糧を消費し、勝利すると資源や勾玉を獲得します。戦闘では兵の損失が発生します。城の所有は変わりません。'],['天下を切り拓く','天下地図で自領に隣接する城を選び、出陣兵数と戦法を決定。偵察や6か月の同盟も活用して保護された江戸城・京都御所を除く城の統一を目指します。自分の役職で領有できる城の数は画面に表示されます。'],['領主と向き合う','共通フィールドには実際のプレイヤーの本拠と、所領の二条・大坂・名古屋が表示されます。拠点を選んで出陣し、この3都市は勝利すると領有できます。外交が成立した6か月間は互いに攻撃できません。江戸城・京都御所の報酬戦にも挑戦でき、勝利時は戦勝報酬を得ます。この2城は占領されません。'],['戦記を守る','端末を連携すると進行を自動同期します。連携前の自動保存や、設定からのセーブ書き出しも利用できます。同じ領主IDを連携した端末へ引き継げます。']].map(([t,p])=>`<div class="help-step"><div><h3>${t}</h3><p>${p}</p></div></div>`).join('')}</div><div class="notice">天下地図はCPU勢力との戦役です。共通フィールドでは他プレイヤーの拠点を選び、襲撃や合意に基づく外交ができます。年月・接続状況・交流も全員で共有します。実在の人物・城を題材に、年代・能力・外交・合戦をゲーム向けに再構成しています。</div>`,`<button class="button primary" data-action="close">城下町へ</button>`,'help');}
  function aboutModal(){const sourceInfo=window.SENGOKU_ROSTER_META;modal('ゲーム概要・収録情報','戦国VS · KASAI SOLUTIONS',`<h3>城下町を育て、武将を編成する戦国ブラウザゲーム</h3><p>「戦国VS」は、KASAI SOLUTIONSによる戦国ブラウザゲームです。はじまりの城を選び、城下町の施設を連続増築し、武将を編成して領国を発展させます。PC・スマートフォン・タブレットで遊べます。</p><p>全員共通の年月のもと、天下地図でのCPU勢力の城攻略、共通フィールドでの外交、同盟の資産共有、領主や所属同盟への書状を楽しめます。軍師AIの自動進軍、対応端末でのウォーキング報酬、領主を連携した端末間の自動同期にも対応しています。</p><p class="subtitle"><a href="about/" target="_blank" rel="noopener">詳しいゲーム概要・制作方針</a> · <a href="guide/" target="_blank" rel="noopener">遊び方と各機能の条件</a></p><h3>収録人物</h3><p>戦国から織豊期を中心に${num(roster.length)}名、${new Set(roster.map(o=>o.clan)).size}勢力の人物を収録しています。史料に残る武将を一人残らず網羅した名簿ではありません。人物の改名は原則として同一人物にまとめています。</p><h3>歴史とゲームの関係</h3><p>本作は256名の人物・${data.castles.length}城・64施設が登場する「群雄集結」です。通常城と64施設は最大Lv.32、二条・大坂・名古屋の城郭はLv.48、江戸城の城郭はLv.64、京都御所はLv.128まで育成できます。城の姿は32段階で、Lv.33以降も最終形態を使用します。城郭${num(data.castles.length*32)}種・施設2,048種の段階別イラストがあります。武将絵巻と合わせて全${num(window.SengokuArt?.totalIllustrations||8224)}種を収録し、16曲のオリジナルBGMを収録しています。異なる年代の人物と城が同時に登場します。能力値・格付け・特技・城の勢力配置・施設効果はすべてゲーム用の創作です。武将1名につき8ランク、計2,048種の創作肖像を閲覧・収集できます。肖像は実際の容姿を示すものではありません。</p><h3>資料</h3><ul class="about-links">${(sourceInfo?.sources||[]).map(x=>`<li><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a></li>`).join('')}</ul><p class="subtitle"><a href="SOURCES.md" target="_blank" rel="noopener">人物資料</a>・<a href="SOURCES-MAP.md" target="_blank" rel="noopener">地図の出典</a>・<a href="SOURCES-KAMON.md" target="_blank" rel="noopener">家紋の出典</a>を確認できます。</p><hr class="divider"><p class="subtitle">ゲーム内城下町：オリジナル生成イラスト<br>音楽：戦国VSのために作曲・編曲したステレオ録音<br>著作権：© KASAI SOLUTIONS</p>`,`<button class="button primary" data-action="close">閉じる</button>`,'about');}
  function renderStartSelection(){return `<section class="start-campaign-welcome"><div class="start-campaign-emblem" aria-hidden="true">${icon('castle')}</div><div class="eyebrow">YOUR FIRST CASTLE</div><h1>天下への一歩を、<br>あなたの城から。</h1><p>${game.isAdmin?'家は徳川家、本拠は江戸城です。難易度を決めて出陣しましょう。':game.isStaff?'家は徳川家、共同本拠は京都御所です。難易度を決めて、共有の城下町から出陣しましょう。':`全国${data.castles.filter(c=>!c.majorCity).length}城の領主として入城するか、ほかのプレイヤーの家臣として参加できます。領主の城がすべて埋まっていても、家臣として始められます。`}<br>選択を確定するまで、新しい進行は保存されません。</p><div class="start-campaign-actions"><button class="button primary" data-action="new-game">${icon('castle')}${game.isAdmin?'江戸城で開始設定':game.isStaff?'京都御所で開始設定':'はじまりの城を選ぶ'}</button><button class="button" data-action="open-recovery">${icon('upload')}以前の領主を復元</button></div><small>以前の進行がある方は、引き継ぎ・データ復元からお戻りください。</small></section>`;}
  function openStartSelection(){if(startPending&&!$('#modal').open&&!document.querySelector('.social-dialog[open]'))newGameModal();}
  function newGameModal(){stopStrategy();newClan=game.isAdmin?data.adminClan.name:game.isStaff?data.staffClan.name:state().clan;newStartCastle=game.isAdmin?'edo':game.isStaff?staffBaseId:'';newResidencyMode='lord';newResidencyDirectory=null;newResidencyError='';newResidencyLoading=!game.isAdmin&&!game.isStaff;newGameGeneration++;drawNewGame();if(newResidencyLoading)loadAdmissionChoices();}
  async function loadAdmissionChoices(){const generation=newGameGeneration;if(game.isAdmin||game.isStaff)return;newResidencyLoading=true;newResidencyError='';refreshLiveControls();try{const directory=await window.SengokuResidency?.loadDirectory?.({force:true});if(generation!==newGameGeneration||activeModal!=='new')return;if(!directory)throw Error('城の入城状況を確認できませんでした。');newResidencyDirectory=directory;if(newResidencyMode!=='local')newResidencyMode=window.SengokuResidency.choiceMode(directory,newResidencyMode);}catch(error){if(generation===newGameGeneration)newResidencyError=error.message||'入城状況を読み込めませんでした。';}finally{if(generation===newGameGeneration){newResidencyLoading=false;if(activeModal==='new'&&!residencyStartPending)preserveInteraction($('#modal-content'),drawNewGame);refreshLiveControls();}}}
  function admissionRow(){return newResidencyDirectory?.castles?.find(row=>row.castleId===newStartCastle)||null;}
  function admissionCastleAllowed(id){if(game.isAdmin)return id==='edo';if(game.isStaff)return id===staffBaseId;if(newResidencyMode==='local')return !syncAccess.linked&&data.castles.some(c=>c.id===id&&!c.majorCity);const row=newResidencyDirectory?.castles?.find(c=>c.castleId===id);return Boolean(row&&(newResidencyMode==='lord'?row.available:!row.available&&row.lord));}
  function startCastlePreview(){const chosen=data.castles.find(c=>c.id===newStartCastle),row=newResidencyMode==='local'?null:admissionRow(),level=game.isStaff&&chosen?.id===staffBaseId?(game.getStaffBase?.()?.castleLevel||1):1;return chosen?`<div class="start-castle-portrait">${window.SengokuArt?.castle(chosen.id,'start-castle-art',level)||icon('castle')}</div><div><span class="start-castle-location">${esc(chosen.region)} · ${esc(chosen.province)}国</span><h3>${esc(chosen.name)}</h3><p>${newResidencyMode==='retainer'&&!game.isAdmin&&!game.isStaff?'この城に仕えるプレイヤー家臣として参加します。':newResidencyMode==='local'?'この端末の個人の戦役として開始します。':`${esc(newClan)}の本拠として、この一城から開始します。`}</p>${row&&!row.available?`<div class="residency-start-lord"><span>現在の領主</span>${window.SengokuResidency?.personHtml?.(row.lord)||esc(row.lord?.name||'確認中')}</div><span class="residency-start-order">入城時の継承順の目安：${num(row.retainerCount+1)}番目</span>`:`<div class="start-castle-facts"><span>城郭 Lv.${level} / ${castleLevelLimit(chosen.id)}</span><span>守備兵 1,200人</span></div>`}${game.isAdmin?'<strong class="start-castle-admin">本拠 · 江戸城固定</strong>':game.isStaff?'<strong class="start-castle-admin">共同本拠 · 京都御所固定</strong>':''}</div>`:`<div class="start-castle-empty">${icon('map')}<strong>${newResidencyMode==='retainer'?'仕える城を選んでください':'あなたの本拠を選んでください'}</strong><span>${newResidencyMode==='retainer'?'領主と家臣の人数を見て、参加する城を選べます。':'城を選ぶと所在地と開始時の守備兵を確認できます。'}</span></div>`;}
  function drawNewGame(){
    const houses=game.isAdmin?[data.adminClan]:game.isStaff?[data.staffClan]:data.clans,difficulty=$('#new-difficulty')?.value||state().difficulty,clan=houses.find(c=>c.name===newClan)||houses[0],special=game.isAdmin||game.isStaff,linked=syncAccess.linked;
    if(game.isAdmin)newStartCastle='edo';else if(game.isStaff)newStartCastle=staffBaseId;else if(['edo',staffBaseId].includes(newStartCastle))newStartCastle='';if(linked&&newResidencyMode==='local')newResidencyMode=window.SengokuResidency?.choiceMode?.(newResidencyDirectory)||'lord';
    const eligible=data.castles.filter(c=>!c.majorCity),rows=newResidencyMode==='local'?eligible.map(c=>({...c,castleId:c.id,castleName:c.name,available:true})):window.SengokuResidency?.choices?.(newResidencyDirectory,newResidencyMode)||[],regions=[...new Set(rows.map(c=>c.region))],retainer=newResidencyMode==='retainer',local=newResidencyMode==='local',status=newResidencyError||(newResidencyLoading?'城の領主と空きを確認しています。':newResidencyDirectory?.full?'領主の空き城はありません。家臣として仕える城を選ぶと参加できます。':newResidencyDirectory?`領主の空き城 ${num(newResidencyDirectory.capacity-newResidencyDirectory.occupied)} / ${num(newResidencyDirectory.capacity)}城。領主がいる城には家臣として参加できます。`:''),label=retainer?'この城の家臣として始める':local?'端末だけで始める':'この城から始める';
    if(!special&&newResidencyDirectory&&!rows.some(row=>row.castleId===newStartCastle))newStartCastle='';
    modal(startPending?'はじまりの城を選ぶ':'新しい物語',game.isAdmin?'出発点は、江戸城に固定されています。':game.isStaff?'徳川家として、共同本拠の京都御所から出発します。':'領主として旗を掲げるか、家臣として城を支える。',`${startPending?`<div class="start-recovery-row"><span>以前のプレイを続ける方はこちら</span><button class="button small" data-action="open-recovery">${icon('upload')}以前の領主を復元</button></div>`:''}<div class="new-campaign-layout"><section class="new-campaign-house"><h3>仕える家</h3><p class="new-campaign-help">${special?'家は徳川家に固定されています。':'個人の武将と家の特性を選びます。プレイヤーの家臣として入城しても、自分の武将・資源を育てます。'}</p><div class="clan-select-grid">${houses.map(c=>`<button class="clan-choice ${newClan===c.name?'active':''}" data-action="choose-clan" data-id="${c.name}" aria-pressed="${newClan===c.name}">${clanCrest(c.name,38)}<span><b>${esc(c.name==='德川家'?'徳川家':c.name)}</b><small>${esc(c.leader==='德川家康'?'徳川家康':c.leader)}</small></span></button>`).join('')}</div><div class="start-clan-bonus">${clanCrest(clan.name,25)}<strong>${esc(clan.bonus)}</strong></div><div class="form-row"><label for="new-difficulty">難易度</label><select id="new-difficulty" class="select">${[['easy','初陣 — 初めての領主へ'],['normal','戦国 — ほどよい緊張感'],['hard','修羅 — 手強い群雄との戦い']].map(([v,n])=>`<option value="${v}" ${difficulty===v?'selected':''}>${n}</option>`).join('')}</select></div></section><section class="new-campaign-castle"><h3>${retainer&&!special?'家臣として仕える城を選ぶ':'はじまりの城'}</h3>${special?`<p class="new-campaign-help">${game.isAdmin?'本拠は江戸城です。':'本拠は保護された京都御所です。共同で城郭・城下町を育てます。'}</p>`:`<div class="residency-choice-modes" aria-label="城への参加方法"><button type="button" class="button" data-action="choose-residency-mode" data-id="lord" aria-pressed="${newResidencyMode==='lord'}" ${newResidencyDirectory?.full?'disabled':''}>領主として入城</button><button type="button" class="button" data-action="choose-residency-mode" data-id="retainer" aria-pressed="${retainer}">家臣として参加</button>${linked?'':'<button type="button" class="button" data-action="choose-residency-mode" data-id="local" aria-pressed="'+local+'">端末だけで遊ぶ</button>'}</div><p id="residency-start-status" class="residency-start-status ${!local&&newResidencyError?'is-error':''}" role="status">${esc(local?'この端末の個人の戦役です。共有フィールドの領主の席は確保しません。':status)}</p>${newResidencyError&&!local?'<button type="button" class="button small" data-action="residency-retry">入城状況を再確認</button>':''}<label for="new-start-castle" class="new-campaign-help">${retainer?'仕える城':'本拠にする城'}を一つ選択 · ${rows.length}城</label><select id="new-start-castle" class="select" required aria-describedby="start-castle-rule"><option value="" ${!rows.some(c=>c.castleId===newStartCastle)?'selected':''} disabled>城を選んでください</option>${regions.map(region=>`<optgroup label="${esc(region)}">${rows.filter(c=>c.region===region).map(c=>`<option value="${c.castleId}" ${newStartCastle===c.castleId?'selected':''}>${esc(c.castleName)}（${esc(c.province)}国）${retainer?' · '+esc(c.lord?.name||'領主')+' · 家臣'+num(c.retainerCount)+'人':''}</option>`).join('')}</optgroup>`).join('')}</select>`}<div id="start-castle-preview" class="start-castle-preview" aria-live="polite">${startCastlePreview()}</div><p id="start-castle-rule" class="new-campaign-help">${game.isAdmin?'徳川家康 U の特別イラストを所持して開始します。':game.isStaff?'徳川家の京都御所と施設は、共同普請の現在の成長を引き継ぎます。武将・資源・研究は個人ごとに育ちます。':retainer?'この城が本拠の防衛戦で敗れると、先に仕えた家臣から順に領主を引き継ぎます。順番は入城確定時に決まります。前の領主は家臣の最後尾へ移ります。登用した武将とは別の、プレイヤー同士の所属です。':local?'未登録の進行はこの端末に保存します。共有フィールドへの入城は、領主登録時に空き城と家臣の順番を確認して決まります。':'一つの城に領主は一人です。江戸・京都御所・二条（京）・大坂・名古屋は、通常の開始城として選べません。'}</p>${!special&&!local&&!linked?'<p class="residency-start-help">共有の城で始めるには、まず「領主登録へ」で名前を登録してください。入城する城は登録後に確定します。</p>':''}</section></div><p class="start-save-notice">${startPending?'入城の確定が終わるまで、本拠と進行は保存されません。':'確定すると現在の進行を新しい物語に置き換えます。今のセーブは置き換え前のバックアップにも残します。'}</p><p id="start-campaign-sync" class="start-campaign-sync" role="status"></p>`,`<button class="button" data-action="close">${startPending?'あとで選ぶ':'やめる'}</button>${startPending?'':'<button class="button" data-action="export-save">今のセーブを保存</button>'}<button class="button primary" data-action="${!special&&!local&&!linked?'open-lord-registration':'start-new'}">${!special&&!local&&!linked?'領主登録へ':label}</button>`,'new');
    refreshLiveControls();
  }
  async function startRegisteredGame(choice){
    const social=window.SengokuSocial,sync=window.SengokuCloudSync,owner=String(social?.getUser?.()?.id||''),epoch=roleEpoch;if(!owner||!sync?.acceptSnapshot||!social?.residencyRequest)throw Error('領主登録と端末同期を確認してください。');
    const verify=()=>{if(owner!==String(social.getUser?.()?.id||'')||epoch!==roleEpoch)throw Object.assign(Error('接続するプレイヤーが変わったため、以前の入城結果を反映していません。'),{code:'STALE_IDENTITY'});};
    if(!startPending&&!save({allowClockCatchup:true}))throw Error('現在の進行を保存してから入城してください。');
    residencyStartPending=true;fieldActionPending=true;refreshLiveControls();
    try{
      const flushed=await sync.flush();verify();if(!flushed?.ok||!sync.getStatus().writable)throw Error('最新の進行を同期できませんでした。端末同期を確認して再度お試しください。');
      const admission=window.SengokuResidency.createAdmission({playerId:owner,storage:localStorage,uuid:()=>crypto.randomUUID(),writer:()=>({deviceId:sync.getDevice().id,revision:sync.getStatus().revision}),onPending:record=>{newStartCastle=record.choice.castleId;newResidencyMode=record.choice.mode;newClan=record.choice.clan;const status=$('#start-campaign-sync');if(status)status.textContent='入城の受付と最新の保存を確認しています。';},send:async payload=>{verify();const result=await social.residencyRequest('/castles/residency/start',{method:'POST',data:payload});verify();return result;},accept:async result=>{verify();const accepted=await sync.acceptSnapshot(result);verify();return accepted;}});
      const result=await admission.run(choice);verify();retireLocalWalkingContext();selectedCastle='';filter.page=1;currentView='town';closeModal();history.replaceState(null,'','#town');render();$('#main').scrollTop=0;$('#main').scrollLeft=0;toast(result.effectiveChoice.mode==='retainer'?`${result.residency?.castleName||'選んだ城'}の家臣として参加しました。`:`${result.residency?.castleName||'選んだ城'}の領主として入城しました。`);return true;
    }catch(error){if(owner===String(social.getUser?.()?.id||'')){try{await sync.refresh();}catch(_){}newResidencyError=error.message||'入城の結果を確認できませんでした。同じ内容で再確認してください。';if(activeModal==='new'){try{newResidencyDirectory=await window.SengokuResidency.loadDirectory({force:true});}catch(_){}preserveInteraction($('#modal-content'),drawNewGame);}}toast(error.message||'入城の結果を確認できませんでした。',true);return false;}
    finally{residencyStartPending=false;fieldActionPending=false;refreshLiveControls();queueWorldProgress();}
  }
  async function startNewGame(){
    if(!canStartNew()||residencyStartPending){toast('端末同期と共通時刻を確認しています。確認が終わってから開始してください。',true);return false;}
    const special=game.isAdmin||game.isStaff;if(!special&&newResidencyMode!=='local'&&!syncAccess.linked){closeModal();window.SengokuSocial?.open?.('profile');return false;}
    const castleId=game.isAdmin?'edo':game.isStaff?staffBaseId:$('#new-start-castle')?.value||newStartCastle;if(!admissionCastleAllowed(castleId)){toast('入城状況を確認し、開始する城を一つ選んでください。',true);$('#new-start-castle')?.focus();return false;}
    const difficulty=$('#new-difficulty')?.value||state().difficulty;if(!special&&syncAccess.linked)return startRegisteredGame({castleId,mode:newResidencyMode,clan:newClan,difficulty});
    let candidate;try{candidate=new SengokuEngine({clan:newClan,difficulty,officers:roster,isAdmin:game.isAdmin,isStaff:game.isStaff,staffBase:game.getStaffBase?.(),startCastle:castleId});const clock=confirmedWorldClock();if(clock)candidate.applyWorldClock(clock);backupCurrentSave('new-game');localStorage.setItem(saveKey,candidate.exportSave());}catch(error){toast('新しい物語を保存できませんでした。これまでの進行は変更していません。端末の保存領域を確認してください。',true);return false;}
    game=candidate;startPending=false;retireLocalWalkingContext();worldCatchingUp=false;lastRealtime=performance.now();saveCounter=0;newStartCastle=castleId;selectedCastle='';filter.page=1;saveEnabled=true;saveWarning='';currentView='town';closeModal();history.replaceState(null,'','#town');render();$('#main').scrollTop=0;$('#main').scrollLeft=0;const indicator=$('#save-indicator');if(indicator)indicator.textContent=syncAccess.linked?'端末に保存 · 同期中':'端末に自動保存済み';window.dispatchEvent(new CustomEvent('sengoku:game-saved'));toast(`${newClan}の新たな物語が、${data.castles.find(c=>c.id===castleId).name}から始まりました。`);return true;
  }
  function downloadBlob(blob,name){const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}
  function exportSave(){if(startPending){toast('本拠を決めて物語を開始すると、セーブを書き出せます。');return;}downloadBlob(new Blob([game.exportSave()],{type:'application/json'}),`sengoku-vs-save-${date().year}-${date().month}.json`);toast('セーブデータを書き出しました。ダウンロード先を確認してください。');}
  let importedGame=null;
  $('#save-import').addEventListener('change',async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;if(!requireWritable())return;if(file.size>2*1024*1024){toast('セーブファイルが大きすぎます。2MB以下のJSONを選んでください。',true);return;}try{await window.SengokuWorldClock?.refresh();importedGame=SengokuEngine.fromSave(await file.text(),roster,{isAdmin:game.isAdmin,isStaff:game.isStaff,staffBase:game.getStaffBase?.()});const importAuthority=confirmedWorldClock();if(!importAuthority)throw Error('共通時計を確認してから、もう一度読み込んでください。');if(importedGame.state.worldClock?.id===importAuthority.id&&importedGame.state.worldClock.elapsedMs>importAuthority.elapsedMs)throw Error('現在の共通時計より未来のセーブは読み込めません。');modal('セーブを読み込みますか？','現在のプレイは読み込んだ内容に置き換わります。',`<p>${esc(importedGame.state.clan)} · ${shortDate(importedGame.state.turn)}</p><div class="stat-row"><span>家臣</span><b>${importedGame.state.officers.length}名</b></div><div class="stat-row"><span>領有拠点</span><b>${importedGame.ownedCastles().length}城</b></div>`,`<button class="button" data-action="close">やめる</button><button class="button primary" data-action="confirm-import">読み込む</button>`,'import');}catch(e){importedGame=null;toast('このセーブは読み込めません。形式・バージョン・武将データを確認してください。',true);}});

  let installPrompt=null;
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;});
  async function install(){if(installPrompt){await installPrompt.prompt();installPrompt=null;return;}modal('ホーム画面に追加','ブラウザのメニューから登録できます。',`<div class="help-steps"><div class="help-step"><div><h3>iPhone・iPad</h3><p>Safariで公開版を開き、「共有」から「ホーム画面に追加」を選んでください。</p></div></div><div class="help-step"><div><h3>Android</h3><p>Chromeで公開版を開き、メニューから「ホーム画面に追加」または「アプリをインストール」を選んでください。</p></div></div></div><div class="notice">初回は通信が必要です。ホーム追加やオフライン動作の対応はブラウザにより異なります。</div>`,`<button class="button primary" data-action="close">わかりました</button>`,'install');}
  let music=null,voiceAudioActive=false;
  function setVoiceActive(value){voiceAudioActive=value===true;music?.setVoiceActive?.(voiceAudioActive)?.catch?.(()=>{});}
  function ensureAudio(){if(!music){music=new SengokuMusic({volume:settings.volume});music.setVoiceActive?.(voiceAudioActive);}return music;}
  function sceneTrack(scene){const tracks=window.SENGOKU_MUSIC_TRACKS||[];if(settings.musicMode==='manual'&&tracks.some(t=>t.id===settings.track))return settings.track;const match=tracks.filter(t=>t.scene===(scene||({town:'town',facilities:'town',map:'world',field:'world',roaming:'army',covert:'army',officers:'officers',army:'army',research:'research',council:'chronicle'})[currentView]||'town'));return (match[Math.floor(state().turn/3)%Math.max(1,match.length)]||tracks[0])?.id;}
  function syncMusic(scene){if(!settings.sound)return;try{const player=ensureAudio(),id=sceneTrack(scene);if(id&&id!==player.currentId)player.play(id).catch(()=>{});}catch(_){} }
  function playNote(){if(settings.sound&&music)music.playEffect('confirm');}
  async function toggleSound(){try{const player=ensureAudio();if(settings.sound){player.pause();settings.sound=false;}else{await player.play(sceneTrack());settings.sound=true;}safeSettings();renderHeader();}catch(e){settings.sound=false;toast('このブラウザでは音声を再生できません。',true);}}
  function musicModal(){const tracks=window.SENGOKU_MUSIC_TRACKS||[],now=music?.currentId,pages=Math.max(1,Math.ceil(tracks.length/8));musicPage=Math.max(1,Math.min(musicPage,pages));modal('十六の戦国旋律','本作のために作曲した、16曲のオリジナルBGM。',`<p>箏と尺八の城下町、金管と陣太鼓の合戦、独奏チェロが歌う敗戦。場面を選ぶと、そのために書き下ろした録音が流れます。</p><div class="music-mode"><button class="button ${settings.musicMode==='auto'?'gold':''}" data-action="music-auto">場面に合わせて自動選曲</button><span>${settings.musicMode==='auto'?'自動選曲中':'選んだ曲をループ'}</span></div><div class="music-list">${tracks.slice((musicPage-1)*8,musicPage*8).map((t,i)=>`<button class="music-track ${settings.sound&&now===t.id?'playing':''}" data-action="play-track" data-id="${t.id}"><span class="track-number">${String((musicPage-1)*8+i+1).padStart(2,'0')}</span><span class="track-title"><b>${esc(t.name)}</b><small>${esc(t.description)}</small></span><span class="track-duration">${Math.floor((t.durationSeconds||t.duration)/60)}:${String(Math.round((t.durationSeconds||t.duration)%60)).padStart(2,'0')}</span><span class="track-state">${settings.sound&&now===t.id?'演奏中':'聴く'}</span></button>`).join('')}</div>${pageControls('music-page',musicPage,pages)}<div class="notice">曲を選ぶとステレオ録音を繰り返し再生します。初期音量は10です。</div>`,`<button class="button" data-action="music-stop">演奏を止める</button><button class="button primary" data-action="close">戻る</button>`,'music');}
  document.addEventListener('click',async event=>{const node=event.target.closest('[data-action],[data-view]:not(#main)');if(!node||node.disabled)return;if(node.dataset.view){go(node.dataset.view);return;}const a=node.dataset.action,id=node.dataset.id;if(mutationActions.has(a)&&!requireWritable())return;switch(a){
    case 'close':if(activeModal==='gacha-animation')finishGachaPresentation();else closeModal();break;
    case 'gacha-skip':finishGachaPresentation();break;
    case 'help':helpModal();break;
    case 'hints':closeModal();window.SengokuHintsUI?.open?.();break;
    case 'toggle-town-facilities':toggleTownFacilities(node);break;
    case 'toggle-town-legend':toggleTownFacilities(node,true);break;
    case 'level-guide':levelGuideModal(id);break;
    case 'level-guide-castle':castleUpgradeModal(id);break;
    case 'about':if(node.tagName==='A'&&(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||event.button>0))return;if(node.tagName==='A')event.preventDefault?.();aboutModal();break;
    case 'settings':settingsModal();break;
    case 'progress':openExpansion('progress',node.dataset.tab);break;
    case 'tutorial':openExpansion('tutorial');break;
    case 'alliance-strategy':openExpansion('alliance');break;
    case 'conquest':openExpansion('conquest');break;
    case 'shogunate':closeModal();window.SengokuShogunate?.open();break;
    case 'notifications':openExpansion('notifications');break;
    case 'premium':if(window.SengokuPremium?.open)window.SengokuPremium.open();else toast('有料版のご案内を読み込めませんでした。画面を再読み込みしてください。',true);break;
    case 'walking':closeModal();window.SengokuWalking?.open?.();break;
    case 'events':closeModal();window.SengokuEvents?.open?.();break;
    case 'troop-trade':closeModal();window.SengokuTrade?.openTroops?.();break;
    case 'strategy':closeModal();window.SengokuStrategy?.open?.();break;
    case 'strategy-stop':window.SengokuStrategy?.stop?.();break;
    case 'open-recovery':stopStrategy();closeModal();window.SengokuSocial?.open('recovery');break;
    case 'export-complete-backup':try{if(!window.SengokuSocial?.exportRecoveryBackup)throw Error('引き継ぎ機能を読み込めませんでした。画面を再読み込みしてください。');window.SengokuSocial.exportRecoveryBackup();}catch(error){toast(error.message||'統合バックアップを書き出せませんでした。',true);}break;
    case 'open-sync':closeModal();window.SengokuSocial?.open('sync');break;
    case 'export-sync-backup':exportSyncBackup();break;
    case 'restore-admin-assets':{const result=restoreAdminAssets();toast(result.message||'德川家康Uを復元しました。',!result.ok);if(result.ok)settingsModal();break;}
    case 'sound':await toggleSound();break;
    case 'music':musicModal();break;
    case 'music-page':musicPage+=Number(node.dataset.delta);musicModal();break;
    case 'music-auto':settings.musicMode='auto';safeSettings();syncMusic();musicModal();break;
    case 'music-stop':if(music)music.pause();settings.sound=false;safeSettings();renderHeader();musicModal();break;
    case 'play-track':try{settings.musicMode='manual';settings.track=id;await ensureAudio().play(id);settings.sound=true;safeSettings();renderHeader();musicModal();}catch(_){toast('再生を開始できませんでした。',true);}break;
    case 'sound-settings':await toggleSound();settingsModal();break;
    case 'fullscreen':try{if(document.fullscreenElement)await document.exitFullscreen();else if(document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen();else toast('このブラウザでは全画面表示に対応していません。');}catch(_){toast('全画面表示を開始できませんでした。',true);}break;
    case 'world-clock-info':worldClockModal();break;
    case 'player-evaluation':showEvaluation();break;
    case 'world-clock-apply':updateWorldClock(node);break;
    case 'toggle-time':worldClockModal();break;
    case 'building':buildingModal(id);break;
    case 'staff-base-detail':staffBaseModal();break;
    case 'upgrade':if(game.isStaff)await upgradeSharedBase('building',id);else{const result=upgradeDurableBuilding(id);toast(result.message,!result.ok);}break;
    case 'upgrade-castle':if(game.isStaff&&id===staffBaseId)await upgradeSharedBase('castle',id);else perform(game.upgradeCastle(id));break;
    case 'build-branch':case 'upgrade-branch':case 'repair-branch':case 'build-branch-facility':case 'upgrade-branch-facility':{node.disabled=true;try{const action=a.replace('-branch',''),payload=action==='build'?{parentCastleId:id,direction:node.dataset.direction}:action.endsWith('-facility')?{branchId:id,facilityId:node.dataset.facility}:{branchId:id},result=await requestBranches('/branches/'+action,{method:'POST',data:payload});if(!result?.ok)throw Error(result?.message||'支拠点の普請を開始できませんでした。');preserveInteraction($('#main'),render);refreshActiveModal();toast(result.message||'支拠点の普請を開始しました。');}catch(error){toast(error.message||'支拠点の結果を確認してください。',true);}finally{refreshLiveControls();}break;}
    case 'preview-art':artPreviewModal(node.dataset.kind,id);break;
    case 'art-level-step':updateArtPreview((activeModalContext?.level||1)+Number(node.dataset.delta));break;
    case 'dismiss-tip':settings.tips=false;safeSettings();render();break;
    case 'council':go('council');break;
    case 'claim-quest':perform(game.claimQuest(id));break;
    case 'officer':officerModal(id,node.dataset.rank);break;
    case 'officer-rank-detail':officerModal(id,node.dataset.rank);break;
    case 'officer-section':officerSection=id==='gacha'?'gacha':'archive';go('officers');break;
    case 'open-gacha':officerSection='gacha';go('officers');break;
    case 'gacha-odds':gachaOddsPage=1;gachaOddsModal();break;
    case 'gacha-odds-page':gachaOddsPage+=Number(node.dataset.delta);patchHTML($('#gacha-individual-list'),individualOddsPage());window.SengokuDesktopFit?.refresh();break;
    case 'draw-officers':summonOfficers(Number(node.dataset.count));break;
    case 'officer-filter':if(!['all','owned','free'].includes(id))break;filter.ownership=id;filter.page=1;saveOfficerPreferences();render();break;
    case 'officer-reset':resetOfficerFilters(node.dataset.context);break;
    case 'officer-page':filter.page+=Number(node.dataset.delta);patchHTML($('#officer-results'),officersResults());window.SengokuDesktopFit?.refresh();break;
    case 'facility-page':facilityPage+=Number(node.dataset.delta);patchHTML($('#facility-results'),facilitiesResults());window.SengokuDesktopFit?.refresh();break;
    case 'territory-page':territoryPage+=Number(node.dataset.delta);patchHTML($('#territory-results'),territoryResults());window.SengokuDesktopFit?.refresh();break;
    case 'quest-page':questPage+=Number(node.dataset.delta);render();break;
    case 'log-page':logPage+=Number(node.dataset.delta);render();break;
    case 'gacha-history-page':gachaHistoryPage+=Number(node.dataset.delta);render();break;
    case 'choice-page':pickOfficer(choiceMode,choiceTarget,choicePage+Number(node.dataset.delta));break;
    case 'crests':go('crests');break;
    case 'crest-page':crestPage+=Number(node.dataset.delta);patchHTML($('#crest-results'),crestResults());window.SengokuDesktopFit?.refresh();break;
    case 'crest-detail':crestModal(id);break;
    case 'recruit-officer':perform(game.recruitOfficer(id));break;
    case 'select-castle':if(!game.canOwnCastle?.(id)&&['edo',staffBaseId].includes(id)){toast(id===staffBaseId?'京都御所は保護された共同拠点です。':'江戸城は保護された拠点です。');break;}selectedCastle=id;render();break;
    case 'map-zoom':if(Number(node.dataset.delta)>0)worldMapController?.zoomIn();else worldMapController?.zoomOut();break;
    case 'map-home':worldMapController?.fit('home');break;
    case 'map-fit':worldMapController?.fit('nation');break;
    case 'scout':perform(game.scout(id));break;
    case 'diplomacy-info':diplomacyModal(id);break;
    case 'diplomacy':perform(game.diplomacy(id));break;
    case 'prepare-battle':battleModal(id);break;
    case 'prepare-branch-battle':{const branch=game.branch?.(id);if(branch)battleModal(branch.parentCastleId,false,id);break;}
    case 'attack-branch':case 'attack':{node.disabled=true;try{const result=await departCampaign(a==='attack-branch'?'branch':'castle',a==='attack-branch'?battleBranchTarget:battleTarget,battleTactic,battleTroops);if(!result.ok){toast(result.message,true);break;}closeModal();render();window.SengokuTravelUI?.accept(result);toast(result.message||result.march?.message||(result.marching?'出陣しました。到着までの時間は画面下の進軍状況から確認できます。':'到着結果を確認しました。画面下から戦果を確認できます。'));}catch(error){toast(error.message||'出陣を確認できませんでした。',true);}finally{node.disabled=false;refreshLiveControls();}break;}
    case 'pick-army':pickOfficer('army',node.dataset.slot);break;
    case 'assign-army':{const slot=Number(node.dataset.target),arr=[...state().army],old=arr[slot],existing=arr.indexOf(id);if(existing>=0){if(old)arr[existing]=old;else arr.splice(existing,1);}arr[slot]=id;perform(game.assignArmy(arr.filter(Boolean)));break;}
    case 'remove-army':{const arr=[...state().army];arr.splice(Number(node.dataset.target),1);perform(game.assignArmy(arr));break;}
    case 'pick-governor':pickOfficer('governor',id);break;
    case 'auto-governors':autoAssignGovernors();break;
    case 'assign-governor':perform(game.assignGovernor(node.dataset.target,id));break;
    case 'remove-governor':perform(game.assignGovernor(node.dataset.target,null));break;
    case 'recruit-max':selectMaximumRecruitment();break;
    case 'recruit-troops':perform(game.recruitTroops(Number($('#recruit-amount').value)));break;
    case 'train':perform(game.train());break;
    case 'research':perform(game.research(id));break;
    case 'export-save':exportSave();break;
    case 'import-save':stopStrategy();$('#save-import').click();break;
    case 'confirm-import':if(importedGame){try{backupCurrentSave('manual-import');}catch(_){toast('バックアップを保存できませんでした。先にセーブを書き出してください。',true);break;}lastRealtime=performance.now();game=SengokuEngine.fromSave(importedGame.exportSave(),roster,{isAdmin:game.isAdmin,isStaff:game.isStaff,staffBase:game.getStaffBase?.()});const importClock=confirmedWorldClock();if(importClock)worldCatchingUp=Boolean(game.applyWorldClock(importClock,{deferCycleSettlement:syncAccess.linked}).pending);importedGame=null;saveEnabled=true;saveWarning='';selectedCastle='';retireLocalWalkingContext();closeModal();save();render();toast(worldCatchingUp?'セーブを読み込み、共通時刻までの進行を反映しています。':'セーブデータを読み込みました。');queueWorldProgress();}break;
    case 'install':await install();break;
    case 'new-game':newGameModal();break;
    case 'choose-residency-mode':if(!residencyStartPending&&['lord','retainer','local'].includes(id)&&!(id==='local'&&syncAccess.linked)){newResidencyMode=id;newStartCastle='';drawNewGame();}break;
    case 'open-lord-registration':{
      const community=$('#community-modal');
      if(!community||!window.SengokuSocial?.open){toast('領主登録を開けませんでした。画面を再読み込みしてください。',true);break;}
      const firstStart=startPending,generation=newGameGeneration;
      closeModal();
      community.addEventListener('close',()=>{
        if(activeModal||generation!==newGameGeneration||(firstStart&&!startPending))return;
        drawNewGame();
        if(syncAccess.linked&&!game.isAdmin&&!game.isStaff)loadAdmissionChoices();
      },{once:true});
      window.SengokuSocial.open('profile');
      break;
    }
    case 'residency-retry':loadAdmissionChoices();break;
    case 'choose-clan':if(residencyStartPending)break;newStartCastle=$('#new-start-castle')?.value||'';if(!game.isAdmin&&!game.isStaff&&data.clans.some(c=>c.name===id))newClan=id;drawNewGame();break;
    case 'start-new':startNewGame();break;
  }});
  document.addEventListener('input',e=>{if(e.target.dataset?.officerFilter==='q'){updateOfficerFilter(e.target.dataset.officerContext,'q',e.target.value);return;}if(e.target.id==='crest-search'){crestQuery=e.target.value.trim();crestPage=1;patchHTML($('#crest-results'),crestResults());}if(e.target.id==='art-preview-level')updateArtPreview(Number(e.target.value));if(e.target.id==='castle-search'){mapQuery=e.target.value.trim();territoryPage=1;patchHTML($('#territory-results'),territoryResults());}if(e.target.id==='facility-search'){facilityQuery=e.target.value.trim();facilityPage=1;patchHTML($('#facility-results'),facilitiesResults());}if(e.target.id==='battle-troops'){battleTroops=Number(e.target.value);updateBattlePreview();}if(e.target.id==='recruit-amount'){patchHTML($('#recruit-cost'),costHtml(game.recruitTroopCost(Number(e.target.value))));refreshLiveControls();}if(e.target.id==='volume'){settings.volume=Number(e.target.value);if(music)music.setVolume(settings.volume);safeSettings();}});
  document.addEventListener('change',e=>{if(e.target.dataset?.branchParent){if(window.SengokuBranches?.selectDirection?.(game,e.target.dataset.branchParent,e.target.value)){preserveInteraction($('#main'),render);refreshActiveModal();}return;}if(e.target.dataset?.officerFilter){updateOfficerFilter(e.target.dataset.officerContext,e.target.dataset.officerFilter,e.target.value);return;}if(e.target.id==='new-start-castle'){newStartCastle=e.target.value;patchHTML($('#start-castle-preview'),startCastlePreview());refreshLiveControls();}if(e.target.id==='gacha-odds-rank'&&data.ranks.includes(e.target.value)){gachaOddsRank=e.target.value;gachaOddsPage=1;patchHTML($('#gacha-individual-list'),individualOddsPage());}if(e.target.id==='facility-category'){facilityCategory=e.target.value;facilityPage=1;patchHTML($('#facility-results'),facilitiesResults());}if(e.target.id==='map-region'){mapRegion=e.target.value;territoryPage=1;render();}if(e.target.id==='battle-tactic'){battleTactic=e.target.value;updateBattlePreview();}if(e.target.id==='tips'){settings.tips=e.target.value==='on';safeSettings();render();}});
  document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('.castle-node')){e.preventDefault();if(e.target.dataset.id==='edo'&&!game.isAdmin){toast('江戸城は保護された拠点です。');return;}selectedCastle=e.target.dataset.id;render();}if(e.key==='Escape'){if(activeModal==='gacha-animation'){e.preventDefault();finishGachaPresentation();return;}clearGachaPresentation();activeModal='';activeModalContext=null;}});
  $('#modal').addEventListener('cancel',event=>{if(activeModal==='gacha-animation'){event.preventDefault();finishGachaPresentation();}else clearGachaPresentation();});
  $('#modal').addEventListener('click',e=>{if(e.target===$('#modal')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom){if(activeModal==='gacha-animation')finishGachaPresentation();else closeModal();}}});
  window.addEventListener('hashchange',()=>{const view=location.hash.slice(1);if(['town','facilities','map','field','roaming','covert','court','officers','crests','army','research','council'].includes(view)&&view!==currentView)go(view);});
  if(['town','facilities','map','field','roaming','covert','court','officers','crests','army','research','council'].includes(location.hash.slice(1)))currentView=location.hash.slice(1);
  if('serviceWorker' in navigator&&!window.SENGOKU_OFFLINE&&location.protocol!=='file:')window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
  function refreshLiveControls(){
    refreshTouchHeaderStatus();
    if(!game?.state)return;
    const s=state(),canCommand=s.command>0&&!s.gameOver;
    document.querySelectorAll('[data-action]').forEach(node=>{
      const id=node.dataset.id;let disabled;
      switch(node.dataset.action){
        case 'start-new':disabled=!canStartNew()||residencyStartPending||(!game.isAdmin&&!game.isStaff&&newResidencyMode!=='local'&&syncAccess.linked&&newResidencyLoading)||!admissionCastleAllowed(game.isAdmin?'edo':game.isStaff?staffBaseId:$('#new-start-castle')?.value||newStartCastle);break;
        case 'upgrade':{const b=data.buildings.find(b=>b.id===id),chain=buildingChain(id);disabled=!b||!canCommand||!saveEnabled||!game.buildingUnlock(id).ok||buildingTailLevel(id)>=game.buildingMax(id)||!chain.length&&constructionCount(game.isStaff===true)>=game.constructionSlots()||game.isStaff&&!staffConstructionReady()||!hasResources(game.costs(id));break;}
        case 'upgrade-castle':{const c=game.castle(id);disabled=!saveEnabled||!canCommand||!c||c.owner!==s.clan||c.level>=castleLevelLimit(id)||!!currentJob('castle',id)||constructionCount(game.isStaff===true&&id===staffBaseId)>=game.constructionSlots()||game.isStaff&&id===staffBaseId&&!staffConstructionReady()||!hasResources(game.castleUpgradeCost(id));if(node.dataset.homeUpgrade==='true'){const hint=$('#home-castle-upgrade-hint');if(hint)hint.textContent=homeCastleUpgradeHint(id);}break;}
        case 'build-branch':case 'upgrade-branch':case 'repair-branch':case 'build-branch-facility':case 'upgrade-branch-facility':{const action=node.dataset.action.replace('-branch',''),quote=window.SengokuBranches?.quote?.(game,action,action==='build'?{parentCastleId:id,direction:node.dataset.direction}:action.endsWith('-facility')?{branchId:id,facilityId:node.dataset.facility}:{branchId:id});disabled=!saveEnabled||!canCommand||quote?.ok!==true||!hasResources(quote?.cost);break;}
        case 'research':{const t=data.techs.find(t=>t.id===id);disabled=!t||!canCommand||s.tech[id]>=t.max||s.tech[id]>=s.buildings.academy||s.jobs.some(j=>j.kind==='research')||!hasResources(game.researchCost(id));break;}
        case 'recruit-officer':disabled=!game.canRecruitOfficer(id).ok;break;
        case 'auto-governors':{const status=governorAssignmentStatus();disabled=!saveEnabled||!status.facilityCount||!status.candidateCount||game.isStaff&&!staffConstructionReady();break;}
        case 'draw-officers':disabled=gachaDrawing||Boolean(gachaPresentation)||!saveEnabled||!game.canDrawOfficers(Number(node.dataset.count)).ok;break;
        case 'recruit-max':{const maximum=maximumRecruitAmount(),hint=$('#recruit-limit');disabled=maximum<100;if(hint){const text=recruitLimitText(maximum);if(hint.textContent!==text)hint.textContent=text;}break;}
        case 'recruit-troops':{const raw=Number($('#recruit-amount')?.value),amount=Math.floor(raw);disabled=!canCommand||!Number.isFinite(raw)||amount<100||amount>20000||s.troops+amount>(game.availableTroopCapacity?.()??game.troopCapacity())||!hasResources(game.recruitTroopCost(amount));break;}
        case 'train':disabled=!canCommand||s.morale>=100||!hasResources(game.trainingCost());break;
        case 'scout':{const c=game.castle(id);disabled=!canCommand||!c||c.owner===s.clan||!game.adjacentTargets().some(t=>t.id===id)||(s.scouted[id]||0)>s.turn||!hasResources(game.scoutCost(id));break;}
        case 'diplomacy':{const c=game.castle(id);disabled=!canCommand||!c||c.owner===s.clan||(s.treaties[c.owner]||0)>s.turn||Object.values(s.treaties).filter(t=>t>s.turn).length>=2||!hasResources(game.diplomacyCost(id));break;}
        case 'claim-quest':{const q=game.questStatus(id);disabled=!q.complete||q.claimed;break;}
        case 'attack':disabled=!game.previewBattle(battleTarget,battleTactic,battleTroops).ok;break;
        case 'attack-branch':disabled=!game.previewBranchBattle(battleBranchTarget,battleTactic,battleTroops).ok;break;
        case 'world-clock-apply':disabled=!game.isAdmin||!window.SengokuWorldClock?.snapshot().ready;break;
        case 'restore-admin-assets':case 'confirm-admin-castle':disabled=!game.isAdmin;break;
      }
      if(mutationActions.has(node.dataset.action)&&!canMutate())disabled=true;
      else if(disabled===undefined&&mutationActions.has(node.dataset.action))disabled=false;
      if(disabled!==undefined)node.disabled=disabled;
    });
    // Choosing a compass direction edits only a local preference. Quiet clock
    // and sync catches must lock construction actions without blurring this field.
    document.querySelectorAll('[data-branch-parent]').forEach(node=>{const disabled=!game.branchStatus?.(node.dataset.branchParent)?.directions?.some(direction=>direction.available);if(node.disabled!==disabled)node.disabled=disabled;});
    const speedControl=$('#realtime-speed');if(speedControl)speedControl.disabled=!canMutate();
    for(const control of document.querySelectorAll('#new-start-castle,#new-difficulty,.clan-choice,[data-action="choose-residency-mode"],[data-action="residency-retry"]'))control.disabled=residencyStartPending||(control.dataset.id==='lord'&&control.dataset.action==='choose-residency-mode'&&newResidencyDirectory?.full===true);
    const startStatus=$('#start-campaign-sync');if(startStatus)startStatus.textContent=$('[data-action="open-lord-registration"]')?'':residencyStartPending?'入城の受付と最新の保存を確認しています。':canStartNew()?'':game.isStaff&&!staffConstructionReady()?'共同拠点の最新の成長を確認しています。':syncAccess.linked&&(!syncAccess.ready||!syncAccess.writable)?syncMessage():window.SengokuWorldClock?.snapshot().message||'同期の確認が終わると開始できます。';
    document.querySelectorAll('[data-magatama-balance]').forEach(el=>{const value=num(s.magatama);if(el.textContent!==value)el.textContent=value;});
    document.querySelectorAll('[data-cost-resource]').forEach(el=>{
      const key=el.dataset.costResource,balance=key==='magatama'?s.magatama:s.resources[key];
      const missing=Math.max(0,Number(el.dataset.costAmount)-balance),detail=el.querySelector('[data-cost-shortage]');
      el.classList.toggle('insufficient',missing>0);
      if(detail){const message=missing?`（あと${num(missing)}）`:'';if(detail.textContent!==message)detail.textContent=message;}
    });
    document.querySelectorAll('[data-recruit-reason]').forEach(el=>{const info=game.canRecruitOfficer(el.dataset.recruitReason);el.textContent=info.ok?'':info.reason;});
    document.querySelectorAll('[data-branch-facility-reason]').forEach(el=>{const reason=window.SengokuBranches?.facilityReason?.(game,el.dataset.branchFacilityReason,el.dataset.facility,{writable:canMutate()&&saveEnabled,writableReason:!saveEnabled?'保存状態を確認してから普請してください。':syncMessage()})||'';if(el.textContent!==reason)el.textContent=reason;el.hidden=!reason;});
    if(currentView==='roaming'&&roamingController)roamingController.refresh();
    if(currentView==='covert'&&covertController)covertController.refresh();
    if(currentView==='court'&&courtController)courtController.refresh();
    window.SengokuHintsUI?.refresh?.({throttled:true});
  }
  function jobDuration(value){const seconds=Math.max(0,Math.floor(Number(value)||0)),minutes=Math.floor(seconds/60);return minutes?`${minutes}分${String(seconds%60).padStart(2,'0')}秒`:`${seconds}秒`;}
  function jobClockText(job){
    if(!job)return'完成';
    const rt=state().realtime||{},total=Math.max(0,Number(job.totalSeconds??job.total*60)||0),remaining=Math.min(total,Math.max(0,Number(job.remainingSeconds??job.remaining*60)||0)),elapsed=Math.max(0,total-remaining),speed=[1,2,4].includes(Number(rt.speed))?Number(rt.speed):1;
    const speedLabel=rt.running===false?'（停止中）':speed!==1?`（${speed}倍速）`:'';
    if(job.queued)return `着工まで ${jobDuration(Math.ceil(Math.max(0,Number(job.startsInSeconds)||0)/speed))} · 工期 ${jobDuration(total)}${speedLabel}`;
    return `経過 ${jobDuration(elapsed)} / ${jobDuration(total)} · あと ${jobDuration(Math.ceil(remaining/speed))}${speedLabel}`;
  }
  function refreshJobTimers(){
    document.querySelectorAll('[data-job-clock]').forEach(el=>{const [kind,id,scope,targetLevel]=el.dataset.jobClock.split(':'),job=currentJob(kind,id,scope,targetLevel);el.textContent=jobClockText(job);el.title=job?.queued?'先の工事が終わると着工します。工期は1倍速換算、着工までは現在の速度です。停止中は進みません。':'経過・全体は1倍速換算の進行時間です。残り時間は現在の速度で表示します。停止中は進みません。';});
    document.querySelectorAll('[data-job-progress]').forEach(el=>{const [kind,id,scope,targetLevel]=el.dataset.jobProgress.split(':'),job=currentJob(kind,id,scope,targetLevel);el.style.width=(job?.queued?0:job?game.constructionProgress(job):100)+'%';});
  }
  function interactionLocator(node,container){
    if(!node||!container)return null;
    if(node===container)return{root:true};
    if(!container.contains(node))return null;
    if(node.id)return{id:node.id};
    const keys=['action','id','facility','target','rank','count','slot','view','mapAction','mapMarker'];
    if(node.dataset&&(node.dataset.action||node.dataset.view||node.dataset.mapAction||node.dataset.mapMarker)){
      const data=Object.fromEntries(keys.filter(key=>node.dataset[key]!==undefined).map(key=>[key,node.dataset[key]])),matches=[...container.querySelectorAll(node.tagName)].filter(candidate=>Object.entries(data).every(([key,value])=>candidate.dataset?.[key]===value));
      return{tag:node.tagName,data,index:Math.max(0,matches.indexOf(node))};
    }
    const path=[];let part=node;
    while(part&&part!==container){const parent=part.parentElement;if(!parent)return null;path.unshift([...parent.children].indexOf(part));part=parent;}
    return part===container?{path}:null;
  }
  function locateInteraction(locator,container){
    if(!locator||!container)return null;if(locator.root)return container;
    if(locator.id){const node=document.getElementById(locator.id);return container.contains(node)?node:null;}
    if(locator.data){const matches=[...container.querySelectorAll(locator.tag||'*')].filter(node=>Object.entries(locator.data).every(([key,value])=>node.dataset?.[key]===value));return matches[locator.index||0]||matches[0]||null;}
    let node=container;for(const index of locator.path||[]){node=node?.children?.[index];if(!node)return null;}return node;
  }
  function preserveInteraction(container,draw){
    if(!container){draw();return;}
    const epoch=interactionEpoch,view=currentView,previous=interactionRestores.get(container),token={anchor:previous?.anchor??container.style?.overflowAnchor??'',epoch,view,pending:true},focused=document.activeElement,focus=interactionLocator(focused,container),selection=focus?{start:focused.selectionStart,end:focused.selectionEnd,direction:focused.selectionDirection}:null;
    interactionRestores.set(container,token);
    const fields=[...container.querySelectorAll('input,select,textarea')].filter(el=>el.type!=='file').map(el=>({locator:interactionLocator(el,container),value:el.value,checked:el.checked}));
    const scrollers=[container,...container.querySelectorAll('*')].filter(el=>el===container||el.id==='town-console'||el.scrollTop||el.scrollLeft).map(el=>({locator:interactionLocator(el,container),top:el.scrollTop,left:el.scrollLeft}));
    // Role, save and shared-base updates can redraw in one response. A new
    // console may clamp its offset to zero before the desktop layout settles;
    // carry the pending position through those redraws, but never past input.
    if(previous?.pending&&previous.epoch===epoch&&previous.view===view){
      const retained=previous.scrollers?.find(saved=>saved.locator?.id==='town-console'),current=scrollers.find(saved=>saved.locator?.id==='town-console');
      if(retained&&current){if(current.top===0&&retained.top>0)current.top=retained.top;if(current.left===0&&retained.left>0)current.left=retained.left;}
    }
    token.scrollers=scrollers;
    const dialog=$('#modal'),dialogScroll={top:dialog?.scrollTop||0,left:dialog?.scrollLeft||0},scrollX=window.scrollX,scrollY=window.scrollY;
    // A redraw is not navigation. Disable scroll anchoring while replacement
    // nodes and asynchronous artwork sizing settle, then restore each pane.
    if(container.style)container.style.overflowAnchor='none';
    draw();
    for(const field of fields){const el=locateInteraction(field.locator,container);if(!el)continue;el.value=field.value;if(typeof field.checked==='boolean')el.checked=field.checked;}
    const replacement=locateInteraction(focus,container);
    if(replacement){replacement.focus?.({preventScroll:true});if(typeof selection?.start==='number'&&replacement.setSelectionRange){try{replacement.setSelectionRange(selection.start,selection.end,selection.direction||'none');}catch(_){}}}
    const restore=()=>{
      if(interactionEpoch!==epoch||currentView!==view||interactionRestores.get(container)!==token)return false;
      for(const saved of scrollers){const node=locateInteraction(saved.locator,container);if(node){node.scrollTop=saved.top;node.scrollLeft=saved.left;}}
      if(dialog){dialog.scrollTop=dialogScroll.top;dialog.scrollLeft=dialogScroll.left;}
      if(window.scrollX!==scrollX||window.scrollY!==scrollY)window.scrollTo({left:scrollX,top:scrollY,behavior:'instant'});
      return true;
    };
    restore();
    const finish=()=>{token.pending=false;if(interactionRestores.get(container)===token&&container.style)container.style.overflowAnchor=token.anchor;};
    if(window.requestAnimationFrame)window.requestAnimationFrame(()=>{if(!restore()){finish();return;}window.requestAnimationFrame(()=>{restore();finish();});});
    else finish();
    const recruitAmount=$('#recruit-amount'),recruitCost=$('#recruit-cost');if(recruitAmount&&recruitCost)patchHTML(recruitCost,costHtml(game.recruitTroopCost(Number(recruitAmount.value))));
    refreshLiveControls();refreshJobTimers();
  }
  function diplomacyModal(id){const c=game.castle(id);if(!c)return;modal(`${c.owner}と同盟を結ぶ`,'6か月間、互いの領地への攻撃を停止します。',`<p>同盟は最大2勢力まで。同盟期間が終わると再び攻撃の対象になります。</p>${costHtml(game.diplomacyCost(id))}<p>指示を1回使います。</p>`,`<button class="button" data-action="close">やめる</button><button class="button gold" data-action="diplomacy" data-id="${id}">同盟を結ぶ</button>`,'diplomacy',{id});}
  function refreshActiveModal(){
    if((activeModal==='gacha-animation'||activeModal==='gacha-result')&&gachaPresentation&&gachaPresentation.scope!==gachaScope()){closeModal();return;}
    if(!$('#modal').open||!activeModalContext)return;
    const context={...activeModalContext},kind=activeModal;
    if(kind==='officer-select')preserveInteraction($('#modal-content'),()=>pickOfficer(context.mode,context.target,choicePage));
    else if(kind==='staff-base')preserveInteraction($('#modal-content'),staffBaseModal);
    else if(kind==='level-guide')preserveInteraction($('#modal-content'),()=>levelGuideModal(context.id));
    else if(kind==='player-evaluation')preserveInteraction($('#modal-content'),showEvaluation);
    else if(kind==='castle-upgrade')preserveInteraction($('#modal-content'),()=>castleUpgradeModal(context.id));
    else if(kind==='building')preserveInteraction($('#modal-content'),()=>buildingModal(context.id));
    else if(kind==='officer')preserveInteraction($('#modal-content'),()=>officerModal(context.id,context.rank));
    else if(kind==='diplomacy')preserveInteraction($('#modal-content'),()=>diplomacyModal(context.id));
    else if(kind==='art-preview')preserveInteraction($('#modal-content'),()=>artPreviewModal(context.kind,context.id,context.level));
  }
  function upgradeDurableBuilding(id){
    if(!canMutate()||!saveEnabled)return{ok:false,message:!saveEnabled?'保存できる状態を確認してから増築してください。':syncMessage()};
    const before=JSON.parse(JSON.stringify(state())),result=game.upgrade(id);if(!result.ok)return result;
    if(!save()){game.state=before;renderHeader();refreshLiveControls();return{ok:false,message:'保存できなかったため増築の手配を取り消しました。資源と指令は元に戻しています。'};}
    preserveInteraction($('#main'),render);refreshActiveModal();playNote(659,.075);return result;
  }
  function applyDurableGift(gift,receiptId){
    if(!canMutate())return{ok:false,retryable:true,message:syncMessage()};
    if(!saveEnabled)return{ok:false,retryable:true,message:'自動保存が停止中のため、贈り物はまだ受け取っていません。保存できる状態にして再度お試しください。'};
    // Currency, ordinary resources, receipt ledger and log are one durable save.
    // On failure all four roll back together before the same receipt is retried.
    const before=JSON.parse(JSON.stringify(state())),result=game.applyGift(gift,receiptId);
    if(!result.ok||result.already)return result;
    if(!save()){game.state=before;renderHeader();refreshLiveControls();return{ok:false,retryable:true,message:'保存できなかったため受取を取り消しました。同じ贈り物をもう一度受け取れます。'};}
    preserveInteraction($('#main'),render);refreshActiveModal();return result;
  }
  function getWalkingAccess(){
    const walking=state().walking||{},campaignId=walking.campaignId||'',user=window.SengokuSocial?.getUser?.(),linked=syncAccess.linked,mode=linked?'remote':'local';
    let ownerId=linked?String(user?.id||''):'';
    if(!linked&&campaignId){
      try{
        if(localWalkingContext?.campaignId!==campaignId){const stored=JSON.parse(localStorage.getItem('sengoku-walking-local-context-v1')||'null');localWalkingContext=stored?.campaignId===campaignId&&typeof stored.id==='string'?stored:{campaignId,id:'local-'+(window.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2))};localStorage.setItem('sengoku-walking-local-context-v1',JSON.stringify(localWalkingContext));}
        ownerId=localWalkingContext.id;
      }catch(_){return{started:!startPending,mode,ownerId:'',campaignId,canCount:false,canClaim:false,reason:'storage',message:'歩行記録の保存領域を利用できません。端末の保存設定を確認してください。'};}
    }
    const online=!linked||navigator.onLine!==false,applying=linked&&syncAccess.reason==='applying'&&syncAccess.ready&&!syncAccess.rolePending&&Boolean(syncAccess.leaseExpiresAt)&&Date.parse(syncAccess.leaseExpiresAt)>Date.now()+1000,lease=!linked||!syncAccess.rolePending&&syncAccess.ready&&(syncAccess.writable||applying)&&(!syncAccess.leaseExpiresAt||Date.parse(syncAccess.leaseExpiresAt)>Date.now()+1000),ready=!startPending&&saveEnabled&&Boolean(campaignId&&ownerId)&&online&&lease;
    const reason=startPending?'unstarted':!saveEnabled?'storage':!online?'offline':linked&&!ownerId?'identity':!lease?syncAccess.reason||'follower':'ready';
    const message=reason==='unstarted'?'はじめに本拠の城を選んでください。':reason==='storage'?'端末に保存できる状態にしてから開始してください。':reason==='offline'?'通信が戻ると、保管した歩行分を同期できます。':!ready?syncMessage():linked?'この領主の進行へ自動で同期します。':'この端末の物語に自動保存します。';
    return{started:!startPending,mode,ownerId,campaignId,playerId:user?.id||null,canCount:ready,canClaim:ready&&canMutate(true),reason,message,totalSteps:(walking.localSteps||0)+(walking.serverSteps||0)};
  }
  function retireLocalWalkingContext(){
    stopStrategy();strategyEpoch++;window.SengokuWalking?.pause?.('identity');localWalkingContext=null;
    try{localStorage.removeItem('sengoku-walking-local-context-v1');}catch(_){}
    window.SengokuWalking?.invalidateCampaign?.();
  }
  function localWalkingOperation(kind,payload={}){
    const access=getWalkingAccess();if(access.mode!=='local'||!access.canClaim||payload.campaignId!==access.campaignId)return{ok:false,code:'WALKING_ACCESS',retryable:true,message:'現在の物語と操作端末を確認してから、歩行の報酬を保存します。'};
    const before=JSON.parse(JSON.stringify(state()));let result;
    try{
      if(kind==='begin'){
        const previous=state().walking.localSession;if(previous&&!previous.closed&&previous.id!==payload.sessionId)game.endLocalWalkingSession(previous.id);
        result=game.beginLocalWalkingSession(payload.sessionId);
      }else if(kind==='progress')result=game.applyLocalWalkingProgress(payload.sessionId,payload.totalSteps);
      else result=game.endLocalWalkingSession(payload.sessionId);
      if(!result?.ok){game.state=before;return result||{ok:false};}
      if((result.changed||JSON.stringify(before.walking)!==JSON.stringify(state().walking))&&!save({allowClockCatchup:true})){game.state=before;renderHeader();return{ok:false,code:'WALKING_SAVE',retryable:true,message:'歩行の報酬を保存できませんでした。同じ歩数で再試行できます。'};}
      renderHeader();refreshLiveControls();return result;
    }catch(error){game.state=before;return{ok:false,code:'WALKING_SAVE',retryable:true,message:'歩行の保存を確認できませんでした。同じ歩数で再試行してください。'};}
  }
  async function requestWalking(route,payload={}){
    if(!['/walking/start','/walking/claim'].includes(route))throw Error('ウォーキングの操作を確認してください。');
    const initial=getWalkingAccess(),social=window.SengokuSocial,sync=window.SengokuCloudSync;
    if(initial.mode!=='remote'||!initial.canClaim||!social?.walkingRequest||!sync?.flush)throw Object.assign(Error(initial.message||'端末同期を確認してから歩行を開始してください。'),{code:'WALKING_WAIT'});
    const verify=()=>{const current=getWalkingAccess();if(current.mode!=='remote'||current.ownerId!==initial.ownerId||current.campaignId!==initial.campaignId)throw Object.assign(Error('領主または物語が変わったため、以前の歩行結果は反映していません。'),{code:'STALE_IDENTITY'});};
    if(route==='/walking/start'&&payload.campaignId!==initial.campaignId)throw Object.assign(Error('物語が変わりました。歩行計測を開始し直してください。'),{code:'WALKING_CAMPAIGN_CHANGED'});
    if(!save({allowClockCatchup:true}))throw Object.assign(Error('歩行前の進行を保存できませんでした。'),{code:'WALKING_SAVE'});
    walkingActionPending=true;refreshLiveControls();let sent=false;
    try{
      const flushed=await sync.flush();verify();if(!flushed?.ok||!sync.getStatus().writable)throw Object.assign(Error('最新の進行を同期しています。歩行分は端末に保管しています。'),{code:'WALKING_WAIT'});
      const result=await social.walkingRequest(route,{method:'POST',data:{...payload,deviceId:sync.getDevice().id,expectedRevision:sync.getStatus().revision}});sent=true;verify();
      if(!Number.isSafeInteger(result.revision)||!result.walkingSession)throw Error('歩行の保存結果を確認できませんでした。');
      if(result.clock)window.SengokuWorldClock?.accept(result.clock);
      let refreshed=await sync.refresh();verify();if(sync.getStatus().revision<result.revision){refreshed=await sync.refresh();verify();}
      if(!refreshed?.ok||sync.getStatus().revision<result.revision)throw Object.assign(Error('歩行分の反映を確認しています。同じ記録で再試行できます。'),{code:'WALKING_RECONCILE_PENDING'});
      return result;
    }catch(error){
      if(sent||['REVISION_CONFLICT','LEASE_REQUIRED','WALKING_CHANGED'].includes(error?.code)){try{verify();await sync.refresh();verify();}catch(_){}}
      throw error;
    }finally{walkingActionPending=false;refreshLiveControls();window.SengokuWalking?.refreshAccess?.();queueWorldProgress();}
  }
  function strategyScope(){const a=getWalkingAccess();return JSON.stringify([a.mode,a.ownerId,a.campaignId,roleEpoch,strategyEpoch,state().cycle?.index||0,state().clan,state().home]);}
  function getStrategyAccess(){
    const base=getWalkingAccess(),shared=window.SengokuWorldClock?.snapshot(),clock=shared?.clock,hasClock=!window.SengokuWorldClock||shared?.ready&&Boolean(clock),running=window.SengokuWorldClock?clock?.running===true:state().realtime?.running!==false,applying=syncAccess.linked&&syncAccess.reason==='applying'&&syncAccess.ready&&(!syncAccess.leaseExpiresAt||Date.parse(syncAccess.leaseExpiresAt)>Date.now()+1000);
    const writable=base.canCount||applying,staffReady=!game.isStaff||staffConstructionReady(),hidden=document.hidden||window.SENGOKU_AT_TITLE===true;
    const fatal=!base.started||!saveEnabled||hidden||!writable||!hasClock||!running||worldSettlementPending||!staffReady||state().gameOver;
    const temporary=!fatal&&(applying||marchStatusPending||worldCatchingUp||!clockIsApplied()||fieldActionPending||walkingActionPending||strategyActionPending);
    const reason=!base.started?'unstarted':!saveEnabled?'storage':hidden?'hidden':!writable?base.reason:!hasClock?'clock':!running?'paused':worldSettlementPending?'cycle':!staffReady?'staff':state().gameOver?'defeat':applying?'applying':worldCatchingUp||!clockIsApplied()?'catchup':fieldActionPending||walkingActionPending||marchStatusPending?'busy':strategyActionPending?'strategy':'ready';
    const messages={unstarted:'はじめに本拠の城を選んでください。',storage:'保存できる状態を確認してから再開してください。',hidden:'画面が非表示のため自動進軍を停止しました。',clock:'共通時刻を確認してから開始してください。',paused:'共通時間が停止しているため、自動進軍も停止しています。',cycle:'新しい時代への切り替えを確認しています。作戦は再設定してください。',staff:'京都御所の共同拠点を確認してから開始してください。',defeat:'領国の状態を確認し、新しい物語から再開してください。',applying:'最新の進行を反映しています。',catchup:'共通時刻までの進行を反映しています。',busy:'他の操作の保存を待っています。',strategy:'出陣と保存を確認しています。',ready:'現在の戦況を評価して出陣できます。'};
    return{scopeId:strategyScope(),canRun:!fatal,canAct:!fatal&&!temporary,temporary,executionReady:!fatal&&!applying&&!marchStatusPending&&!worldCatchingUp&&clockIsApplied()&&!fieldActionPending&&!walkingActionPending,reason,message:messages[reason]||base.message,runId:strategyRun?.active?strategyRun.id:null,active:strategyRun?.active===true};
  }
  function strategyDecisionView(value={}){const result={};for(const key of ['ok','action','code','reason','castleId','castleName','tactic','tacticName','troops','foodCost','winChance','estimatedLoss','reserveAfter','progress','travel'])if(value[key]!==undefined)result[key]=JSON.parse(JSON.stringify(value[key]));if(Array.isArray(value.alternatives))result.alternatives=value.alternatives.slice(0,3).map(strategyDecisionView);return result;}
  function previewStrategy(text){
    if(typeof game.compileStrategy!=='function'||typeof game.planStrategy!=='function')return{ok:false,message:'軍師AIを読み込み直してください。'};
    const compiled=game.compileStrategy(text);if(!compiled.ok)return compiled;
    return{...compiled,decision:strategyDecisionView(game.planStrategy(compiled.policy))};
  }
  function beginStrategy(text){
    const access=getStrategyAccess();if(!access.canAct)return{ok:false,message:access.message};
    const preview=previewStrategy(text);if(!preview.ok||preview.decision?.action==='stop')return{...preview,ok:false,message:preview.decision?.reason||preview.message};
    if(strategyRun?.active)stopStrategy(strategyRun.id);
    const id='strategy-'+(window.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2));
    strategyRun={id,scopeId:access.scopeId,policy:JSON.parse(JSON.stringify(preview.policy)),active:true};
    return{ok:true,runId:id,scopeId:access.scopeId,...JSON.parse(JSON.stringify(preview))};
  }
  function stopStrategy(runId){const changed=strategyRun?.active&&(!runId||strategyRun.id===runId);if(changed){strategyRun.active=false;window.SengokuStrategy?.refreshAccess?.();}return{ok:true};}
  async function stepStrategy(runId){
    const run=strategyRun;if(!run?.active||run.id!==runId)return{ok:false,stop:true,message:'この作戦は終了しています。'};
    const current=()=>{const access=getStrategyAccess();if(strategyRun!==run||!run.active||run.scopeId!==access.scopeId)throw Object.assign(Error('作戦・領主・物語が変わったため、自動進軍を停止しました。'),{code:'STRATEGY_STOP'});if(!access.canRun)throw Object.assign(Error(access.message||'現在の戦況では自動進軍を続けられません。'),{code:'STRATEGY_STOP'});return access;};
    let access;try{access=current();}catch(error){run.active=false;return{ok:false,stop:true,message:error.message};}
    if(!access.canAct||strategyActionPending)return{ok:true,executed:false,waiting:true,message:access.message};
    if(run.pendingMarchId){
      const all=window.SengokuTravelUI?.snapshot()||{},receipt=(state().marchHistory||[]).find(m=>m.id===run.pendingMarchId)||(all.history||[]).find(m=>m.id===run.pendingMarchId);
      if(!receipt)return{ok:true,executed:false,waiting:true,marching:true,marchId:run.pendingMarchId,message:'出陣した部隊の到着と戦果を待っています。次の出陣は結果を確認してから判断します。'};
      const marchId=run.pendingMarchId;run.pendingMarchId=null;
      const next=game.planStrategy(run.policy),stop=receipt.status==='cancelled'||receipt.battle?.won===false||next.action==='stop';if(stop)run.active=false;
      return{ok:true,arrived:true,executed:false,confirmed:true,marchId,battle:receipt.battle||null,cancelled:receipt.status==='cancelled',stop,shouldStop:stop,nextDecision:strategyDecisionView(next),decision:strategyDecisionView(next),message:receipt.status==='cancelled'?receipt.message||'出陣が取り消されたため、自動進軍を停止しました。':receipt.battle?.won===false?'敗戦のため、自動進軍を停止しました。':stop?next.reason:'部隊が到着し、戦果を確認しました。次の出陣に備えます。'};
    }
    if(!save()){run.active=false;return{ok:false,stop:true,message:'出陣前の進行を保存できませんでした。'};}
    strategyActionPending=true;refreshLiveControls();
    try{
      if(syncAccess.linked){const flushed=await window.SengokuCloudSync.flush();current();if(!flushed?.ok)throw Error('最新の進行を同期できなかったため、自動進軍を停止しました。');}
      const fresh=current();if(!fresh.executionReady)return{ok:true,executed:false,waiting:true,message:fresh.message};
      const decision=game.planStrategy(run.policy);if(decision.action==='stop'){run.active=false;return{ok:true,executed:false,stop:true,decision:strategyDecisionView(decision),message:decision.reason};}
      if(decision.action!=='attack')return{ok:true,executed:false,waiting:true,decision:strategyDecisionView(decision),message:decision.reason};
      // Both manual and AI marches use the same authoritative departure path.
      const result=await departCampaign('castle',decision.castleId,decision.tactic,decision.troops,{allowStrategy:true});
      const march=window.SengokuTravelUI?.commandMarch(result);
      if(!result.ok||!march){if(result.battle)return{ok:false,stop:true,message:'出陣の受付を再確認してください。'};return{...result,executed:false,waiting:true,decision:strategyDecisionView(decision),message:result.message||'戦況を確認して次の機会を待ちます。'};}
      window.SengokuTravelUI?.record(march);if(march.status!=='marching'){const stop=march.status==='cancelled'||march.battle?.won===false;if(stop)run.active=false;return{ok:true,arrived:true,executed:false,confirmed:true,marchId:march.id,battle:march.battle,cancelled:march.status==='cancelled',stop,message:march.message||'到着済みの戦果を確認しました。'};}
      run.pendingMarchId=march.id;
      preserveInteraction($('#main'),render);refreshActiveModal();
      return{...result,executed:true,confirmed:true,marchId:march.id,decision:strategyDecisionView(decision),nextDecision:strategyDecisionView(game.planStrategy(run.policy)),stop:false,message:result.message||'出陣しました。到着するまで次の出陣を待ちます。'};
    }catch(error){run.active=false;return{ok:false,stop:true,message:error.message||'自動進軍を停止しました。進軍状況を確認してください。'};}
    finally{strategyActionPending=false;refreshLiveControls();window.SengokuStrategy?.refreshAccess?.();queueWorldProgress();}
  }
  function setSyncAccess(access){Promise.resolve().then(()=>window.SengokuBridge?.primeProgress?.());const wasWritable=canMutate(),wasReady=syncAccess.linked&&syncAccess.ready;syncAccess={...syncAccess,...access};if(!syncAccess.linked||syncAccess.banned||['initializing','auth','access-changed'].includes(syncAccess.reason))game.setBranchAuthority?.({resolvedElapsedMs:0});if(!syncAccess.linked)evaluationOwnerId='';else if(!wasReady&&syncAccess.ready&&!syncAccess.rolePending)evaluationOwnerId=String(window.SengokuSocial?.getUser?.()?.id||'');refreshEvaluationUI();if(wasWritable!==canMutate()){lastRealtime=performance.now();saveCounter=0;}const banner=$('#sync-access-notice'),markup=syncBanner();if(markup!==renderedSyncBanner||Boolean(banner)!==Boolean(markup)){preserveInteraction($('#main'),()=>{if(banner)banner.outerHTML=markup;else if(markup){const host=$('#town-overview')||$('#main');host.insertAdjacentHTML(host.id==='town-overview'?'beforeend':'afterbegin',markup);}});renderedSyncBanner=markup;}const indicator=$('#save-indicator');if(indicator)indicator.textContent=syncAccess.banned?'利用停止中':startPending?'本拠の選択待ち':syncAccess.linked?(syncAccess.ready?(syncAccess.writable?'クラウド自動同期':'同期データを表示中'):'クラウドを確認中'):'端末に自動保存';refreshLiveControls();if(syncAccess.ready&&syncAccess.writable)queueWorldProgress();window.SengokuStrategy?.refreshAccess?.();window.SengokuHintsUI?.refresh?.();}
  function setRoleAccess({isAdmin=false,isStaff=false,pending=false}={}){
    pending=pending===true;isAdmin=!pending&&isAdmin===true;isStaff=!pending&&isStaff===true&&!isAdmin;
    const wasPending=syncAccess.rolePending===true;
    // Unknown authentication is a read-only view, not a confirmed demotion.
    // Preserve the exact campaign before removing privileged projections.
    if(pending&&!wasPending&&!startPending&&saveEnabled){try{pendingRoleSave=game.exportSave();}catch(_){pendingRoleSave=null;saveEnabled=false;saveWarning='元のセーブを保護するため保存を停止しました。クラウドの進行を確認してください。';}}
    syncAccess.rolePending=pending;if(pending)game.setBranchAuthority?.({resolvedElapsedMs:0});
    const changed=game.isAdmin!==isAdmin||Boolean(game.isStaff)!==isStaff;
    if(changed||wasPending!==pending){roleEpoch++;staffBaseReady=false;stopStrategy();}
    if(!pending&&wasPending&&pendingRoleSave){
      try{game=SengokuEngine.fromSave(pendingRoleSave,roster,{isAdmin,isStaff});pendingRoleSave=null;}
      catch(_){syncAccess.rolePending=true;return{ok:false,message:'元のセーブを確認できるまで、操作と保存を待機しています。'};}
    }else if(!pending&&(isAdmin||isStaff)&&changed&&syncAccess.linked&&!syncAccess.ready){try{const raw=localStorage.getItem(saveKey);if(raw)game=SengokuEngine.fromSave(raw,roster,{isAdmin,isStaff});}catch(_){}}
    const result=game.setRoleAccess?game.setRoleAccess({isAdmin,isStaff}):game.setAdminAccess(isAdmin);
    if(!changed&&!result.changed&&wasPending===pending)return result;
    if(selectedCastle==='edo'&&!isAdmin||selectedCastle===staffBaseId&&!isStaff)selectedCastle='';
    preserveInteraction($('#main'),render);
    if(activeModal==='new'){newStartCastle=isAdmin?'edo':isStaff?staffBaseId:['edo',staffBaseId].includes(newStartCastle)?'':newStartCastle;preserveInteraction($('#modal-content'),drawNewGame);}else refreshActiveModal();
    return {...result,changed:true};
  }
  function applyCourtAccess(value,meta={}){
    const context=window.SengokuSocial?.getCourtContext?.(),valid=Boolean(value&&context?.user&&!context.pending&&!context.banned&&!syncAccess.rolePending&&context.playerId===meta.playerId&&context.epoch===meta.epoch&&context.privilegeEpoch===meta.privilegeEpoch&&context.accountEpoch===meta.accountEpoch);
    game.setCourtAccess?.({isCourtEmperor:valid&&value.isCourtEmperor===true});return{ok:valid};
  }
  function trustedBranchAuthority(meta={},candidate=game){
    const owner=String(window.SengokuSocial?.getUser?.()?.id||''),campaignId=candidate?.state?.walking?.campaignId;
    if(meta.source!=='cloud'||!syncAccess.linked||syncAccess.rolePending||syncAccess.banned||!owner||meta.playerId!==owner||!campaignId||meta.branchCampaignId!==campaignId)return null;
    return{resolvedElapsedMs:Number.isSafeInteger(meta.branchResolvedElapsedMs)&&meta.branchResolvedElapsedMs>=0?meta.branchResolvedElapsedMs:0};
  }
  function applyBranchAuthority(meta={}){const authority=trustedBranchAuthority(meta);return authority?(game.setBranchAuthority?.(authority)||{ok:true,changed:false}):{ok:false,ignored:true};}
  function setAdminAccess(value){return setRoleAccess({isAdmin:value===true,isStaff:game.isStaff===true});}
  function applyStaffBase(base,meta={}){
    if(!game.isStaff||meta.roleEpoch!==undefined&&meta.roleEpoch!==roleEpoch)return {ok:false,message:'スタッフ権限が変わったため共同拠点の更新を取り消しました。'};
    const wasReady=staffBaseReady;
    if(!base){staffBaseReady=false;if(wasReady){preserveInteraction($('#main'),render);refreshActiveModal();}return {ok:true,changed:wasReady};}
    const result=game.applyStaffBase?.(base)||{ok:false,message:'スタッフ共同拠点を読み込めませんでした。'};
    staffBaseReady=result.ok===true;
    if(result.changed||wasReady!==staffBaseReady){preserveInteraction($('#main'),render);if(activeModal==='new')preserveInteraction($('#modal-content'),drawNewGame);else refreshActiveModal();refreshJobTimers();if(!result.displayOnly)queueWorldProgress();}
    return result;
  }
  function applyCloudSave(snapshot,meta={}){
    try{
      const candidate=SengokuEngine.fromSave(typeof snapshot==='string'?snapshot:JSON.stringify(snapshot),roster,{isAdmin:meta.isAdmin===true,isStaff:meta.isStaff===true,staffBase:meta.staffBase||null});
      candidate.setBranchAuthority?.(trustedBranchAuthority(meta,candidate)||{resolvedElapsedMs:0});
      if(meta.backup===true)backupCurrentSave(meta.reason||'cloud',meta.backupRuntime===true);
      localStorage.setItem(saveKey,candidate.exportSave());
      const wasPending=startPending;window.SengokuBranches?.transferSelection?.(game,candidate);game=candidate;staffBaseReady=game.isStaff===true&&Boolean(game.getStaffBase?.());pendingRoleSave=null;syncAccess.rolePending=false;startPending=false;saveEnabled=true;saveWarning='';lastRealtime=performance.now();saveCounter=0;
      if(selectedCastle==='edo'&&!game.isAdmin||selectedCastle===staffBaseId&&!game.isStaff)selectedCastle='';
      if(meta.reason==='initial'||meta.reason==='conflict')importedGame=null;
      if(wasPending&&activeModal==='new'||activeModal==='import'&&!importedGame)closeModal();
      preserveInteraction($('#main'),render);refreshActiveModal();
      if(activeModal==='battle')updateBattlePreview();
      if(meta.reason==='domain-recovery'&&!syncAccess.linked)retireLocalWalkingContext();else window.SengokuWalking?.refreshAccess?.();window.SengokuStrategy?.refreshAccess?.();
      queueWorldProgress();return{ok:true};
    }catch(error){return{ok:false,message:'同期データを安全に保存できませんでした。端末の空き容量とセーブ形式を確認してください。'};}
  }
  function prepareRecoverySave(snapshot,meta={}){
    try{
      const candidate=SengokuEngine.fromSave(typeof snapshot==='string'?snapshot:JSON.stringify(snapshot),roster,{isAdmin:meta.isAdmin===true,isStaff:meta.isStaff===true,staffBase:meta.staffBase||null});
      return{ok:true,save:JSON.parse(candidate.exportSave()),summary:{clan:candidate.state.clan,home:candidate.state.home,turn:candidate.state.turn,officers:candidate.state.officers.length}};
    }catch(error){return{ok:false,message:'ゲームの保存形式を確認できませんでした。戦国VSのセーブデータを選んでください。'};}
  }
  function applyRecoverySave(snapshot,meta={}){
    return applyCloudSave(snapshot,{isAdmin:meta.isAdmin===true,isStaff:meta.isStaff===true,staffBase:meta.staffBase||null,backup:true,reason:'domain-recovery'});
  }
  function prepareNewRecoverySave(meta={}){
    if(meta.isAdmin!==true)return{ok:false,message:'新しい物語は、はじめに本拠の城を選択してください。'};
    const candidate=new SengokuEngine({clan:meta.clan||state().clan,officers:roster,isAdmin:true,startCastle:'edo'}),clock=confirmedWorldClock();
    if(clock)candidate.applyWorldClock(clock);
    return{ok:true,save:JSON.parse(candidate.exportSave()),summary:{clan:candidate.state.clan,home:candidate.state.home,turn:candidate.state.turn,officers:candidate.state.officers.length}};
  }
  function restoreAdminAssets(){
    if(!canMutate())return{ok:false,message:syncMessage()};
    if(!game.isAdmin)return{ok:false,message:'運営アカウントの認証が必要です。'};
    const before=JSON.parse(JSON.stringify(state())),result=game.restoreAdminAssets();
    if(!result.ok)return result;
    if(!save()){game.state=before;return{ok:false,message:'保存できなかったため、復元を取り消しました。'};}
    preserveInteraction($('#main'),render);refreshActiveModal();return result;
  }
  window.SengokuBridge={getMarches:()=>window.SengokuTravelUI?.snapshot()||{active:[],history:[]},openMarches:()=>window.SengokuTravelUI?.open(),primeProgress,confirmProtectionExit,requestExpansion,getExpansionAccess,openProgress:tab=>openExpansion('progress',tab),setVoiceActive,openCourt,applyCourtAccess,applyBranchAuthority,getEventAccess,eventBattle:requestEventBattle,refreshPremiumAppearance,getHints,followHint,openHintHelp,getEvaluation,showEvaluation,getStrategyAccess,previewStrategy,beginStrategy,stepStrategy,stopStrategy,getState:()=>state(),hasStarted:()=>!startPending,getSave:getGameSave,getStoredSave,toast,canReceiveGifts:()=>saveEnabled&&canMutate(),applyGift:applyDurableGift,getWalkingAccess,beginLocalWalkingSession:payload=>localWalkingOperation('begin',payload),applyLocalWalkingProgress:payload=>localWalkingOperation('progress',payload),endLocalWalkingSession:payload=>localWalkingOperation('end',payload),startWalkingSession:payload=>requestWalking('/walking/start',payload),claimWalkingSteps:payload=>requestWalking('/walking/claim',payload),spendableAssets,troopCapacity:()=>Math.min(1000000,game.troopCapacity()),tradeRequest:requestTrade,guildTransfer:payload=>requestField('/guild/treasury/transfer',{method:'POST',data:payload}),openSettings:settingsModal,openStartSelection,openCastleAdmission:newGameModal,setSyncAccess,setRoleAccess,setAdminAccess,getRoleAccess:()=>({isAdmin:game.isAdmin===true,isStaff:game.isStaff===true,pending:syncAccess.rolePending===true,epoch:roleEpoch}),applyStaffBase,getStaffBase:()=>staffConstructionReady()?game.getStaffBase():null,applyCloudSave,prepareRecoverySave,prepareNewRecoverySave,applyRecoverySave,restoreAdminAssets};
  let lastRealtime=performance.now(),saveCounter=0;
  document.addEventListener('visibilitychange',()=>{lastRealtime=performance.now();if(document.hidden)save();else{window.SengokuWorldClock?.refresh();processWorldClock();}});
  window.addEventListener('pagehide',()=>save());
  function settleWorldCycle(){
    const sync=window.SengokuCloudSync;
    if(!syncAccess.linked||worldSettlementPending||Date.now()<worldSettlementRetryAt||!sync?.flush||!sync?.refresh)return;
    // This is the last pre-boundary save. Persist and flush it before the
    // authoritative server counts occupation and grants the single receipt.
    if(!save({allowClockCatchup:true})){worldSettlementRetryAt=Date.now()+5000;return;}
    const previousCycle=state().cycle?.index??Math.floor(state().turn/672);
    worldSettlementPending=true;refreshLiveControls();
    return (async()=>{
      try{
        const flushed=await sync.flush();if(!flushed?.ok)throw Error('区切り直前の進行を保存しています。通信回復後に報酬を確認します。');
        const refreshed=await sync.refresh({settleCycle:true});if(!refreshed?.ok||(state().cycle?.index??Math.floor(state().turn/672))<=previousCycle)throw Error('占領報酬を確認しています。通信回復後に同期を再開します。');
        worldSettlementRetryAt=0;
      }catch(error){worldSettlementRetryAt=Date.now()+5000;toast(error.message||'占領報酬を確認できませんでした。通信回復後に再試行します。',true);}
      finally{worldSettlementPending=false;refreshLiveControls();queueWorldProgress();}
    })();
  }
  function processWorldClock(allowStrategy=false){
    allowStrategy=allowStrategy===true;
    if(worldCatchupTimer!==null){clearTimeout(worldCatchupTimer);worldCatchupTimer=null;}
    const shared=window.SengokuWorldClock?.snapshot();if(!shared)return;
    const status=$('#shared-world-status');if(status){status.textContent=worldCatchingUp?'共通時刻までの進行を反映中':shared.message;status.classList.toggle('running',shared.ready&&shared.clock?.running);}
    const p=$('#month-progress');if(p&&shared.clock)p.style.width=shared.clock.calendar.elapsed/60*100+'%';
    if(document.hidden||!shared.ready||!shared.clock||!canMutate(true,false,allowStrategy)){renderHeader();refreshLiveControls();window.SengokuStrategy?.refreshAccess?.();return;}
    const wasCatchingUp=worldCatchingUp,result=game.applyWorldClock(confirmedWorldClock(),{maxSeconds:7200,deferCycleSettlement:syncAccess.linked});worldCatchingUp=Boolean(result.pending);renderHeader();refreshLiveControls();refreshJobTimers();window.SengokuStrategy?.refreshAccess?.();
    if(!result.ok)return;
    if(result.pending){worldCatchupTimer=setTimeout(processWorldClock,0);return;}
    if(result.settlementRequired){settleWorldCycle();return;}
    const s=state(),count=$('#command-count'),pips=$('#command-pips');if(count)count.textContent=s.command;if(pips)patchHTML(pips,Array.from({length:game.commandMax()},(_,i)=>`<i class="${i<s.command?'filled':''}"></i>`).join(''));
    if(activeModal==='battle')updateBattlePreview();
    const clockKey=`${shared.ready}:${shared.clock.running}:${shared.clock.speed}:${shared.clock.calendar.cycle}`;
    if(wasCatchingUp||result.monthChanged||result.completed?.length||result.marchResults?.length||result.covertResults?.length||clockKey!==worldClockStatusKey){worldClockStatusKey=clockKey;preserveInteraction($('#main'),render);refreshActiveModal();syncMusic();}
    if(result.events?.length)toast(result.events.slice(0,2).join(' / '));
    window.SengokuTravelUI?.refresh();
    if(result.changed){saveCounter++;if(saveCounter>=10||wasCatchingUp||result.migrated||result.monthChanged||result.completed?.length||result.marchResults?.length||result.covertResults?.length){saveCounter=0;save({allowStrategy});}}
  }
  navigator.serviceWorker?.addEventListener?.('message',event=>{if(event.data?.type==='sengoku-open-recap'){noticeRecapPending=true;openPendingRecap();}});
  window.SengokuResidency?.configure?.({getContext:()=>window.SengokuSocial?.getCourtContext?.()||{playerId:'',user:null},request:(...args)=>window.SengokuSocial.residencyRequest(...args),homeCastleId:()=>state().home,onChoose:newGameModal,onMessage:toast,onChange:change=>{if(change.before&&(change.before.role!==change.self?.role||change.before.castleId!==change.self?.castleId||change.before.lordEpoch!==change.self?.lordEpoch))stopStrategy();refreshPremiumAppearance();}});
  configureTravel();configureProgress();setInterval(()=>{if(!document.hidden)primeProgress();},10000);
  setInterval(processWorldClock,1000);
  render();refreshJobTimers();save();window.SengokuWorldClock?.subscribe(()=>{refreshLiveControls();queueWorldProgress();});window.SengokuWorldClock?.start().then(processWorldClock);
})();
