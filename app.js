/* 戦国VS — browser interface, offline persistence and original procedural audio. */
(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num = v => Math.floor(Number(v)||0).toLocaleString('ja-JP');
  function patchHTML(host,html,options={}){if(!host)return;if(window.SengokuStableDOM){const result=window.SengokuStableDOM.patch(host,html,options);if(result.artwork)window.SengokuArt?.schedule?.(host);return result;}if(host.innerHTML!==html)host.innerHTML=html;}
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
  const mutationActions=new Set(['toggle-time','upgrade','upgrade-castle','build-branch','upgrade-branch','repair-branch','build-branch-facility','upgrade-branch-facility','assign-branch-commander','remove-branch-commander','auto-assign-branch-commanders','attack-branch','claim-quest','draw-officers','recruit-officer','scout','diplomacy','attack','assign-army','army-plan-apply','remove-army','assign-governor','remove-governor','auto-governors','recruit-troops','train','research','confirm-import','restore-admin-assets']);
  const roster=window.SENGOKU_OFFICERS||[], data=window.SENGOKU_DATA;
  const staffBaseId=data.staffBaseId||'kyoto_gosho';
  let worldCatchingUp=false,worldCatchupTimer=null,worldClockStatusKey='',fieldActionPending=false,walkingActionPending=false,strategyActionPending=false,startPending=false,interactionEpoch=0,worldSettlementPending=false,worldSettlementRetryAt=0,maintenanceCatchupPending=false,renderedNavigation='',staffBaseReady=false,roleEpoch=0,localWalkingContext=null,strategyEpoch=0,strategyRun=null;
  const interactionRestores=new WeakMap();
  for(const type of ['pointerdown','wheel','touchstart','touchmove','keydown'])document.addEventListener(type,()=>{interactionEpoch++;},{capture:true,passive:true});
  document.addEventListener('pointermove',event=>{if(event.buttons)interactionEpoch++;},{capture:true,passive:true});
  let relocationView=null,relocationBusy=false;
  let branchBookingPending=false;
  let newResidencyMode='lord',newResidencyDirectory=null,newResidencyLoading=false,newResidencyError='',residencyStartPending=false,newGameGeneration=0;
  let newStartCastle='',game,saveEnabled=true,saveWarning='',currentView='town',filter={q:'',clan:'all',ownership:'all',sort:'lead',direction:'desc',rank:'all',skill:'all',assignment:'all',page:1},selectedCastle='',toastTimer,activeModal='',activeModalContext=null,battleTarget='',battleBranchTarget='',battleTactic='balanced',battleTroops=0,newClan='織田家',mapZoom=1,mapRegion='all',mapQuery='',facilityCategory='all',facilityQuery='',officerSection='archive',gachaOddsRank='D',gachaOddsPage=1,facilityPage=1,territoryPage=1,questPage=1,logPage=1,gachaHistoryPage=1,choicePage=1,choiceMode='army',choiceTarget='',musicPage=1,crestPage=1,crestQuery='';
  let facilityState='all',territoryState='all',questState='all';
  let facilitySort='default',facilityLayout='cards',officerComparison=[];
  try{const prefs=window.SengokuManagement.readPreferences(localStorage,[...new Set(data.buildings.map(row=>row.category))]);facilityQuery=prefs.query;facilityCategory=prefs.category;facilityState=prefs.state;facilitySort=prefs.sort;facilityLayout=prefs.layout;}catch(_){}
  let townSection='town-overview';
  const townSections=['town-overview','town-facilities-section','town-reports-section'];
  const officerPreferencesKey='sengoku-officer-filters-v1';
  let choiceFilters={army:officerFilterDefaults('army'),governor:officerFilterDefaults('governor')},gachaPresentation=null,gachaDrawing=false;
  try{const saved=JSON.parse(localStorage.getItem(officerPreferencesKey)||'{}');filter=normalizeOfficerFilter(saved.archive,'archive');choiceFilters.army=normalizeOfficerFilter(saved.army,'army');choiceFilters.governor=normalizeOfficerFilter(saved.governor,'governor');}catch(_){}
  let music=null,voiceAudioActive=false,musicStarted=false,musicStarting=false,musicWaitingForGesture=false,musicFailure=false,musicRequest=0,musicRequestedId='',musicGestureAvailable=true,musicVolumeRetryPending=false,soundEffects=null;
  let settings={sound:true,volume:10,tips:true,townFacilitiesExpanded:false,townLegendExpanded:false,musicMode:'auto',track:''};
  try{settings={...settings,...JSON.parse(localStorage.getItem(settingsKey)||'{}')};}catch(_){}
  const storedVolume=settings.volume;
  settings.volume=(typeof storedVolume==='number'||typeof storedVolume==='string'&&storedVolume.trim()!=='')&&Number.isFinite(Number(storedVolume))?Math.round(Math.max(0,Math.min(100,Number(storedVolume)))):10;
  if(settings.musicMode!=='manual'||!(window.SENGOKU_MUSIC_TRACKS||[]).some(track=>track.id===settings.track))settings.musicMode='auto';
  if(!(Number(settings.audioPreferenceVersion)>=1)){
    settings.sound=true;if(settings.volume===0)settings.volume=10;
    settings.audioPreferenceVersion=1;safeSettings();
  }else settings.sound=settings.sound!==false;
  const storedEffectsVolume=settings.effectsVolume,effectsDefault=settings.sound&&settings.volume>0?settings.volume:0;
  settings.effectsVolume=(typeof storedEffectsVolume==='number'||typeof storedEffectsVolume==='string'&&storedEffectsVolume.trim()!=='')&&Number.isFinite(Number(storedEffectsVolume))?Math.round(Math.max(0,Math.min(100,Number(storedEffectsVolume)))):effectsDefault;
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
  function jobKey(job){return `${job.kind}:${job.id}:${job.shared?'shared':'personal'}:${job.targetLevel}${job.kind==='branch'&&job.facilityId?':'+job.facilityId:''}`;}
  function castleLevelLimit(id){return game.castleLevelLimit?.(id)||(id===staffBaseId?128:id==='edo'?64:['nijo','osaka','nagoya'].includes(id)?48:32);}
  function staffConstructionReady(){return game.isStaff&&staffBaseReady&&Boolean(game.getStaffBase?.());}
  function safeSettings(){try{localStorage.setItem(settingsKey,JSON.stringify(settings));}catch(_){}}
  function confirmedWorldClock(){const shared=window.SengokuWorldClock?.snapshot();if(!shared?.ready||!shared.clock)return null;const authority=game?.getMaintenanceStatus?.(),confirmed=shared.clock.confirmedElapsedMs??shared.clock.elapsedMs;return{...shared.clock,elapsedMs:authority&&authority.campaignId===game.state.walking?.campaignId?Math.min(confirmed,authority.asOfElapsedMs):confirmed};}
  function clockIsApplied(){if(!window.SengokuWorldClock)return true;const clock=confirmedWorldClock(),anchor=game?.state?.worldClock;return Boolean(clock&&anchor?.id===clock.id&&anchor.elapsedMs>=clock.elapsedMs&&anchor.elapsedMs<=clock.elapsedMs+5000);}
  function queueWorldProgress(){if(worldCatchupTimer===null)worldCatchupTimer=setTimeout(processWorldClock,0);}
  function canMutate(ignoreClock=false,allowSetup=false,allowStrategy=false){const lease=!syncAccess.linked||(syncAccess.ready&&syncAccess.writable&&(!syncAccess.leaseExpiresAt||Date.parse(syncAccess.leaseExpiresAt)>Date.now()+1000));return !syncAccess.banned&&lease&&!syncAccess.rolePending&&!fieldActionPending&&!walkingActionPending&&(!strategyActionPending||allowStrategy)&&!worldSettlementPending&&(allowSetup||!startPending)&&(ignoreClock||!game.getMaintenanceStatus?.()?.hasMore&&!worldCatchingUp&&clockIsApplied());}
  function canStartNew(){return canMutate(true,true)&&!worldCatchingUp&&(!game.isStaff||staffConstructionReady())&&(!window.SengokuWorldClock||Boolean(confirmedWorldClock()));}
  let saveChangedInAnotherTab=false,lastLocalSaveRaw=null,lastLocalSaveGame=null,localCampaignRefreshPending=false;
  function changedLocalCampaign(){
    if(startPending||syncAccess.linked||syncAccess.rolePending||game.isAdmin||game.isStaff)return false;
    const raw=localStorage.getItem(saveKey);if(!raw||raw===lastLocalSaveRaw&&game===lastLocalSaveGame)return false;
    const savedId=JSON.parse(raw)?.state?.walking?.campaignId;
    if(!savedId||savedId===state().walking?.campaignId){lastLocalSaveRaw=raw;lastLocalSaveGame=game;return false;}
    if(!localCampaignRefreshPending){
      localCampaignRefreshPending=true;
      Promise.resolve().then(()=>{
        localCampaignRefreshPending=false;
        if(syncAccess.linked||syncAccess.rolePending||game.isAdmin||game.isStaff)return;
        const latest=localStorage.getItem(saveKey);if(!latest)return;
        const next=SengokuEngine.fromSave(latest,roster);
        if(next.state.walking.campaignId===state().walking.campaignId)return;
        game=next;lastLocalSaveRaw=latest;lastLocalSaveGame=game;selectedCastle='';lastRealtime=performance.now();saveCounter=0;
        retireLocalWalkingContext();closeModal();render();
        toast(`別のタブで戦役が更新されました。現在の本拠は${relocationName(state().home)}です。`);
      }).catch(()=>toast('別のタブの進行を確認するため、画面を再読み込みしてください。',true));
    }
    return true;
  }
  window.addEventListener('storage',event=>{
    if(event.key!==saveKey&&event.key!==null)return;
    saveChangedInAnotherTab=true;
    try{changedLocalCampaign();}catch(_){/* An unreadable external save is handled by the next durable save check. */}
  });
  async function prepareReleaseSwitch(){
    const busy=()=>fieldActionPending||walkingActionPending||strategyActionPending||worldSettlementPending||syncAccess.rolePending;
    if(busy())return {ok:false,message:'進行中の操作が終わってから、もう一度お試しください。'};
    if(startPending)return {ok:true};
    const fingerprint=window.SengokuCloudSync?.fingerprint||(record=>JSON.stringify(record?.state));
    const matches=()=>{const current=getGameSave(),stored=getStoredSave();return !!current?.state&&!!stored?.state&&fingerprint(current)===fingerprint(stored);};
    const durable=()=>matches()||!saveChangedInAnotherTab&&canMutate()&&save()&&matches();
    try{
      if(saveEnabled&&durable()){
        if(syncAccess.linked&&syncAccess.writable){
          const result=await window.SengokuCloudSync?.flush?.();
          if(!result?.ok)return {ok:false,message:'同期を確認できませんでした。通信が戻ってからもう一度お試しください。'};
        }
        if(!busy()&&durable())return {ok:true};
      }
    }catch{/* Keep the current game open if the durable save cannot be verified. */}
    return {ok:false,message:'保存状態を確認できませんでした。「保存・設定」で進行状況をご確認ください。'};
  }
  function syncMessage(){if(game.getMaintenanceStatus?.()?.hasMore&&!syncAccess.banned&&!syncAccess.rolePending)return'外部に預けた兵の維持費を現在の時刻まで反映しています。';return syncAccess.banned?(syncAccess.message||'この領主は利用を停止されています。'):syncAccess.rolePending?'領主の権限を確認しています。確認が終わるまで操作と保存を待機しています。':worldSettlementPending?'占領した拠点の集計と報酬を同期しています。':syncAccess.message||(syncAccess.writable?'この端末で進行中 · 自動同期しています。':'他端末の進行を表示中です。「端末同期」から操作端末を切り替えられます。');}
  function requireWritable(){if(syncAccess.banned){toast(syncMessage(),true);return false;}if(canMutate())return true;toast(worldSettlementPending?'占領した拠点の集計と報酬を同期しています。':startPending?'はじめに本拠の城を一つ選んでください。以前の進行がある場合は、引き継ぎ・復元から再接続できます。':fieldActionPending?'共通フィールド・資産・共同普請の結果を同期しています。':worldCatchingUp||window.SengokuWorldClock?.snapshot().ready&&!clockIsApplied()?'共通時刻までの進行を反映しています。':window.SengokuWorldClock&&!window.SengokuWorldClock.snapshot().ready?window.SengokuWorldClock.snapshot().message:syncMessage(),true);return false;}
  function save({allowClockCatchup=false,allowStrategy=false,replaceCampaign=false}={}){
    if(startPending||!canMutate(allowClockCatchup,false,allowStrategy)||!saveEnabled)return false;
    try{
      if(!syncAccess.linked&&!replaceCampaign&&changedLocalCampaign())return false;
      const raw=game.exportSave();localStorage.setItem(saveKey,raw);
      if(!syncAccess.linked){lastLocalSaveRaw=raw;lastLocalSaveGame=game;}
      window.dispatchEvent(new CustomEvent('sengoku:game-saved'));return true;
    }catch(e){
      saveEnabled=false;saveWarning='このブラウザでは保存領域を利用できません。「保存・設定」でセーブを書き出してください。';
      toast(saveWarning,true);return false;
    }
  }
  function getGameSave(){if(startPending)return null;if(!saveEnabled)throw Error('元のセーブを読み込み・保存できないため、仮の進行は同期しません。');return JSON.parse(syncAccess.rolePending&&pendingRoleSave?pendingRoleSave:game.exportSave());}
  function beginUpkeepSync(){
    const original=game,epoch=roleEpoch,finish=game.beginUpkeepTracking();let result;
    return()=>result||(result={...finish(),current:game===original&&roleEpoch===epoch});
  }
  function getStoredSave(){const raw=localStorage.getItem(saveKey);return raw===null?null:JSON.parse(raw);}
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
  function toast(message,error=false){message=window.SengokuSyncNotices?.visibleText?.(message)??message;if(!message)return;clearTimeout(toastTimer);const el=$('#toast'),display=`toast show${error?' error':''}`;if(el.textContent!==message)el.textContent=message;if(el.className!==display)el.className=display;toastTimer=setTimeout(()=>el.classList.remove('show'),5200);}
  function closeModal(){clearGachaPresentation();const m=$('#modal');if(m.open)m.close();activeModal='';activeModalContext=null;syncMusic();}
  function modal(title,subtitle,body,footer='',kind='',context=null){const previousFocus=document.activeElement,restoreModalFocus=$('#modal').contains?.(previousFocus);if(kind!=='gacha-animation'&&kind!=='gacha-result')clearGachaPresentation();activeModal=kind;activeModalContext=context;$('#modal').setAttribute('aria-labelledby','modal-title');if(subtitle)$('#modal').setAttribute('aria-describedby','modal-description');else $('#modal').removeAttribute('aria-describedby');$('#modal').classList.toggle('gacha-modal',kind==='gacha-result'||kind==='gacha-odds'||kind==='gacha-animation');$('#modal').classList.toggle('start-castle-modal',kind==='new');$('#modal').classList.toggle('level-guide-modal',kind==='level-guide');$('#modal').classList.toggle('officer-comparison-modal',kind==='officer-comparison');$('#modal').classList.toggle('army-planner-modal',kind==='army-planner');$('#modal').classList.toggle('player-evaluation-modal',kind==='player-evaluation');if(!$('#modal').open)window.SengokuStableDOM?.forget($('#modal-content'));patchHTML($('#modal-content'),`<header class="modal-header"><div><h2 id="modal-title">${esc(title)}</h2>${subtitle?`<p id="modal-description">${esc(subtitle)}</p>`:''}</div><button class="icon-button" data-action="close" aria-label="閉じる">${icon('close')}</button></header><div class="modal-body">${body}</div>${footer?`<footer class="modal-footer">${footer}</footer>`:''}`,{key:[kind,context?.id,context?.mode,context?.target,context?.rank,context?.kind]});if(!$('#modal').open)$('#modal').showModal();refreshLiveControls();refreshJobTimers();if(restoreModalFocus&&!previousFocus?.isConnected)$('#modal .modal-header [data-action="close"]')?.focus?.({preventScroll:true});}
  function perform(result,{close=true,quiet=false}={}){if(!result?.ok){toast(result?.message||'実行できませんでした。',true);return false;}if(close)closeModal();save();render();playNote(659,.075);if(!quiet)toast(result.message);return true;}
  function hasResources(cost){return Object.keys(resNames).every(k=>state().resources[k]>=(cost?.[k]||0));}
  function costHtml(cost){
    const budget=state(),amounts={...budget.resources,magatama:budget.magatama};
    const items=Object.entries({...resNames,magatama:'勾玉'}).filter(([key])=>cost?.[key]>0).map(([key,name])=>{
      const amount=cost[key],missing=Math.max(0,amount-amounts[key]),overCap=amount>100000000;
      return `<span data-cost-resource="${key}" data-cost-amount="${amount}" class="${key==='magatama'?'magatama-cost ':''}${missing?'insufficient':''}">${icon(key==='magatama'?'magatama':resIcons[key])}${name} ${overCap?'上限超過':num(amount)}<small data-cost-shortage>${overCap?'（所持上限1億）':missing?`（あと${num(missing)}）`:''}</small></span>`;
    });
    if(cost?.turns)items.push(`<span>${icon('calendar')}${cost.seconds||cost.turns*60}秒（1倍速）</span>`);
    const multiplier=cost?.turns?(game.upgradeCostMultiplier?.()||1):1,castles=game.upgradeCastleCount?.()||1;
    const multiplierText=num(multiplier);
    return `<div class="cost">${items.join('')}</div>${multiplier>1?`<p class="upgrade-cost-note">領有${num(castles)}城 · 強化資産 ${multiplierText}倍（上限16倍）。施設維持費は変わりません。</p>`:''}`;
  }
  const navSections = [
    ['城と内政', [['town','castle','城下町'], ['facilities','castle','城下普請帳'], ['resource-planner','coins','資源計画','dialog'], ['defense-ledger','shield','修復・守備台帳','dialog'], ['research','book','技術研究'], ['court','scroll','京都御所']]],
    ['合戦と天下', [['map','map','天下地図'], ['field','flag','共通フィールド'], ['roaming','swords','野良兵戦'], ['covert','eye','派遣部隊']]],
    ['武将と軍団', [['officers','users','武将名鑑'], ['army','swords','軍団編成'], ['crests','flag','家紋帳']]],
    ['軍議と記録', [['command-activity','calendar','行動予定表','dialog'], ['campaign-records','scroll','戦記検索','dialog'], ['council','scroll','軍議'], ['progress','book','成長手帳','dialog'], ['shogunate','scroll','幕府の記録','dialog']]],
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
  function clanCrest(name,size=36){return window.SengokuKamon?.render(name,{size,className:'clan-kamon'})||`<span class="mon" title="${esc(name)}">${esc(window.SengokuVariants?.firstGrapheme?.(name)||Array.from(String(name||''))[0]||'')}</span>`;}
  function officerCrest(o){if(!o)return `<span class="avatar officer-kamon is-empty" role="img" aria-label="武将未任命">${icon('plus')}</span>`;const rank=data.ranks.includes(o.rank)?o.rank:'D';const crest=window.SengokuKamon?.render(o.clan,{size:48,className:'officer-house-kamon'})||'<img src="assets/kamon/unaffiliated.svg" alt="" width="48" height="48">';return `<span class="avatar officer-kamon" data-rank="${rank}" role="img" aria-label="${esc(o.name)}・${esc(o.clan)}の家紋・${rank}ランク" title="${esc(o.name)} · ${esc(o.clan)} · ${esc(o.rank)}"><span aria-hidden="true">${crest}</span><b class="portrait-rank-badge" aria-hidden="true">${rank}</b></span>`;}
  function pageControls(action,page,pages,label=''){return `<div class="pagination"><button class="button small" data-action="${action}" data-delta="-1" ${page<=1?'disabled':''}>前の頁</button><span>${label?`${esc(label)} · `:''}${page} / ${pages}</span><button class="button small" data-action="${action}" data-delta="1" ${page>=pages?'disabled':''}>次の頁</button></div>`;}
  function catalogMatches(value,query){const normalize=text=>String(text??'').normalize('NFKC').replace(/德/g,'徳').toLocaleLowerCase('ja'),haystack=normalize(value).replace(/\s+/g,'');return normalize(query).trim().split(/\s+/).filter(Boolean).every(term=>haystack.includes(term));}
  function catalogChips(kind,active,options){return `<div class="catalog-filter-chips" role="group" aria-label="${kind==='quest'?'任務の進捗':kind==='facility'?'施設の状態':'拠点の状態'}で絞り込む">${options.map(([id,label])=>`<button type="button" class="${active===id?'active':''}" data-action="catalog-state" data-kind="${kind}" data-id="${id}" aria-pressed="${active===id}">${label}</button>`).join('')}</div>`;}
  function resetCatalogFilters(kind){
    const resetFocused=document.activeElement?.getAttribute?.('data-action')==='catalog-reset';
    if(kind==='facility'){facilityQuery='';facilityCategory='all';facilityState='all';facilityPage=1;saveFacilityPreferences();const search=$('#facility-search'),category=$('#facility-category');if(search)search.value='';if(category)category.value='all';patchHTML($('#facility-results'),facilitiesResults());}
    else if(kind==='territory'){mapQuery='';mapRegion='all';territoryState='all';territoryPage=1;const search=$('#castle-search'),region=$('#map-region');if(search)search.value='';if(region)region.value='all';patchHTML($('#territory-results'),territoryResults());syncWorldMap();}
    else if(kind==='crest'){crestQuery='';crestPage=1;const search=$('#crest-search');if(search)search.value='';patchHTML($('#crest-results'),crestResults());}
    else if(kind==='quest'){questState='all';questPage=1;patchHTML($('#quest-results'),questResults());}
    const inputId={facility:'facility-search',territory:'castle-search',crest:'crest-search'}[kind];
    if(inputId&&resetFocused)$('#'+inputId)?.focus({preventScroll:true});
    refreshLiveControls();window.SengokuDesktopFit?.refresh();
  }
  function updateCatalogSearch(target){
    if(target?.dataset?.officerFilter==='q'){
      const context=target.dataset.officerContext,previous=context==='archive'?filter:choiceFilters[context];
      if(previous&&previous.q!==target.value)updateOfficerFilter(context,'q',target.value);
      return true;
    }
    const value=String(target?.value??'').trim();
    if(target?.id==='crest-search'){if(crestQuery!==value){crestQuery=value;crestPage=1;patchHTML($('#crest-results'),crestResults());}return true;}
    if(target?.id==='castle-search'){if(mapQuery!==value){mapQuery=value;territoryPage=1;patchHTML($('#territory-results'),territoryResults());}return true;}
    if(target?.id==='facility-search'){if(facilityQuery!==value){facilityQuery=value.slice(0,80);facilityPage=1;saveFacilityPreferences();patchHTML($('#facility-results'),facilitiesResults());}return true;}
    return false;
  }
  function crestResults(){const all=window.SengokuKamon?.entries()||[],list=all.filter(c=>catalogMatches([c.clan,c.name,c.motif,c.crestName].filter(Boolean).join(' '),crestQuery)),pages=Math.max(1,Math.ceil(list.length/20));crestPage=Math.max(1,Math.min(crestPage,pages));return `<div class="catalog-result-summary"><p role="status"><strong>${list.length}</strong> / ${all.length}勢力の家紋・群章</p><button type="button" class="text-link" data-action="catalog-reset" data-kind="crest"${crestQuery?'':' disabled'}>検索をクリア</button></div><div class="kamon-catalog">${list.slice((crestPage-1)*20,crestPage*20).map(c=>`<button class="kamon-entry" data-action="crest-detail" data-id="${esc(c.clan)}">${clanCrest(c.clan,62)}<b>${esc(c.clan)}</b><small>${esc(c.name||c.crestName||c.motif||'勢力の紋')}</small></button>`).join('')||'<div class="empty catalog-empty"><p>条件に合う家紋はありません。</p><button type="button" class="button" data-action="catalog-reset" data-kind="crest">すべての家紋を表示</button></div>'}</div>${pageControls('crest-page',crestPage,pages)}`;}
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
  function evaluationEntry(evaluation=getEvaluation()){if(startPending)return '';return `<button class="player-evaluation-entry" data-action="player-evaluation" data-player-evaluation-self aria-label="${esc(evaluationDescription(evaluation))}">${evaluationEntryContent(evaluation)}</button>`;}
  function evaluationModalKey(evaluation){const user=syncAccess.linked&&evaluation?window.SengokuSocial?.getUser?.():null;return JSON.stringify([evaluation,user?.id||'',user?.name||'',syncAccess.linked,startPending,window.SengokuPublicCourt?.selfText?.(evaluationCourtPlayer(evaluation))||'']);}
  function refreshEvaluationUI(evaluation=getEvaluation()){
    const markup=evaluationEntryContent(evaluation),description=evaluationDescription(evaluation);
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
      const rankBadge=`<span class="player-evaluation-current">${window.SengokuEvaluationUI?.badge(evaluation)||`<b>${esc(evaluation.rankName)}</b>`}${evaluationCourtSlot(evaluation)}</span>`,identityMarkup=user?`<span class="player-evaluation-person">${window.SengokuAvatar?.markup?.(user,'inline')||''}${window.SengokuCityHonors?.slot?.(user.id)||''}<span class="player-evaluation-name" data-premium-player="${esc(user.id)}" data-premium-player-name="${esc(user.name)}">${window.SengokuPremiumRuntime?.nameMarkup?.(user.name,user.appearance)||esc(user.name)}</span>${rankBadge}</span>`:rankBadge;
      body=`<div class="player-evaluation-body"><section class="player-evaluation-summary" aria-label="現在の位階と総合評価"><div class="player-evaluation-summary-top">${identityMarkup}<div class="player-evaluation-score">${num(evaluation.score)}<small> / ${num(evaluation.maxScore)} 点</small></div></div><p class="player-evaluation-next">${next?`次の位階 <strong>${esc(next.name)}</strong> まで、あと <strong>${num(evaluation.toNext)}点</strong>`:'最高位の正一位に到達しています。'}</p><div class="player-evaluation-meter" role="progressbar" aria-label="次の位階までの進捗" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}" aria-valuetext="${esc(next?`${next.name}まであと${num(evaluation.toNext)}点`:'最高位に到達')}"><i style="width:${percent}%"></i></div></section><p class="player-evaluation-notice">位階は、現在の領国・施設・武将・編成などを7項目で総合した称号です。領地や軍団・奉行が変わると評価も変わり、位階は上がることも下がることもあります。所持資源・残兵・消費額・発言数は点数に含めません。</p><div class="player-evaluation-breakdown">${evaluation.breakdown.map(item=>`<section class="player-evaluation-category" data-evaluation-category="${esc(item.id)}"><h3>${esc(item.name)}</h3><div class="player-evaluation-category-score"><b>${num(item.score)}</b><small> / ${num(item.maxScore)} 点</small></div><div class="player-evaluation-meter" aria-hidden="true"><i style="width:${Math.max(0,Math.min(100,item.score/Math.max(1,item.maxScore)*100))}%"></i></div><p>${esc(item.description)}</p></section>`).join('')}</div><details id="player-evaluation-ranks" class="player-evaluation-ranks"${expanded?' open':''}><summary>全17段階の位階と必要な総合評価</summary><ol class="player-evaluation-rank-list">${(data.evaluationRanks||[]).map(rank=>`<li${rank.id===evaluation.rankId?' aria-current="step"':''}><b>${esc(rank.name)}${rank.id===evaluation.rankId?' · 現在':''}</b><span>${num(rank.minScore)} 点〜</span></li>`).join('')}</ol></details>${syncAccess.linked?'<p class="player-evaluation-notice">他の領主に表示される位階は、最新の保存を同期した後に更新されます。</p>':''}</div>`;
    }
    modal('総合評価・位階',subtitle,body,'<button class="button" data-view="court">京都御所へ出向く</button><button class="button primary" data-action="close">ゲームへ戻る</button>','player-evaluation',{key});
  }
  function renderHeader(clockOnly=false){
    if(window.SENGOKU_AT_TITLE===true)return;
    const s=state(),shared=window.SengokuWorldClock?.snapshot(),clock=shared?.clock,d=date(clock?.calendar?.turn);
    if(startPending){
      patchHTML($('#calendar'),`<b>${d.year}年 ${d.month}月</b><span>全員共通の暦</span>`);
      if(clockOnly)return;
      refreshTouchHeaderStatus();refreshEvaluationUI();
      patchHTML($('#resources'),'<span class="start-campaign-status">本拠を選んで、新たな物語へ</span>');
      patchHTML($('#clan-panel'),'<div class="clan-line">'+icon('flag')+'<div><b>出陣の準備</b><small>本拠はまだ確定していません</small></div></div>');
      patchHTML($('#sound-button'),icon(settings.sound?'sound':'mute'));return;
    }
    const clockLabel=shared?.mode==='offline'?'オフライン版':shared?.ready?(clock?.running?'共通時間':'共通時間は停止中'):'時刻を確認中';
    patchHTML($('#calendar'),`<b>${d.year}年 ${d.month}月<span class="season-symbol">${d.season}</span></b><span>${clockLabel} · <i id="month-countdown" style="font-style:normal"></i>秒</span>`);
    const countdown=$('#month-countdown'),seconds=String(Math.ceil((60-(clock?.calendar?.elapsed??s.realtime?.elapsed??0))/(clock?.speed||1)));
    if(countdown&&countdown.textContent!==seconds)countdown.textContent=seconds;

    // Deltas own these text nodes. Keep the ledger and its illustrated controls
    // mounted across ordinary clock samples and authoritative balance changes.
    const ledger=$('#resources'),keys=Object.keys(resNames);
    if(ledger&&!$('#header-balance-gold')){
      patchHTML(ledger,keys.map(k=>`<button type="button" class="resource resource-inspect" id="header-resource-${k}" data-action="economy-details" data-resource="${k}" aria-haspopup="dialog"><span>${icon(resIcons[k],k)}</span><div><div class="resource-label">${resNames[k]}</div><div class="resource-amount"><span id="header-balance-${k}"></span><small class="resource-gain" id="header-gain-${k}"></small></div></div></button>`).join(''));
    }
    const income=game.income();
    for(const k of keys){
      const amount=$('#header-balance-'+k),gain=$('#header-gain-'+k),card=$('#header-resource-'+k);
      const balance=num(s.resources[k]),delta=economyNumber(income[k]),title=economyBalanceTitle(k,income);
      if(amount&&amount.textContent!==balance)amount.textContent=balance;
      if(gain&&gain.textContent!==delta)gain.textContent=delta;
      if(gain)gain.classList.toggle('is-negative',income[k]<0);
      if(card&&card.title!==title)card.title=title;
      const label=`${resNames[k]} ${balance}。毎月の差引 ${delta}。収支の内訳を開く`;
      if(card?.getAttribute?.('aria-label')!==label)card?.setAttribute?.('aria-label',label);
    }
    refreshEconomyPanels(income);
    window.SengokuCommandCenter?.refresh?.(game,{income,quests:data.quests});
    // Shared construction may complete between personal job events. Staff
    // keep their verified projected rank and castle display on those ticks.
    if(clockOnly&&!game.isStaff&&activeModal!=='player-evaluation')return;
    const evaluation=getEvaluation(),owned=game.ownedCastles().length,target=game.unificationTarget?.()||data.castles.length,leader=clanInfo().leader;
    if(!clockOnly)refreshTouchHeaderStatus();
    refreshEvaluationUI(evaluation);
    patchHTML($('#clan-panel'),`<div class="clan-line">${clanCrest(s.clan,42)}<div><b>${esc(s.clan)}</b><small>${esc(leader)} の治世</small></div></div><div class="clan-progress"><i style="width:${owned/target*100}%"></i></div><div class="clan-progress-label"><span>天下統一</span><span>${owned} / ${target} 城</span></div>${evaluationEntry(evaluation)}`);
    const sound=$('#sound-button'),label=settings.sound?'BGMを停止':'BGMを再生';
    patchHTML(sound,icon(settings.sound?'sound':'mute'));if(sound&&sound.getAttribute?.('aria-label')!==label)sound.setAttribute('aria-label',label);
  }
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
    const actions=`<div class="page-heading-actions">${evaluationEntry()}<div class="commands">指令 <span id="command-count">${s.command}</span><div class="command-pips" id="command-pips">${pips}</div></div><button class="button gold" data-action="world-clock-info">${icon('calendar')}${shared?.mode==='offline'?'オフライン時間':'共通時間'}${game.isAdmin?'・管理':''}</button></div>`;
    const chapter=`<header class="page-heading">${chapterCopy}${actions}${upgrade?'':'<div class="chapter-plate" aria-hidden="true"></div>'}</header>`;
    const ledger=`<div class="realtime-strip"><button class="currency-chip" data-action="open-gacha" aria-label="勾玉を確認して武将招集へ">${icon('magatama')}<span>勾玉</span><b data-magatama-balance>${num(s.magatama)}</b></button><div class="time-track"><i id="month-progress" style="width:${(rt.elapsed||0)/60*100}%"></i></div><span class="shared-time-speed">${rt.speed||1}倍 · 1560〜1615年を周回</span></div>`;
    const related=tools?`<div class="expansion-entry"><button class="button gold" data-action="progress" data-tab="${tools[0]}">${tools[1]}</button><button class="button" data-action="progress" data-tab="analysis">合戦の試算・分析</button></div>`:'';
    return chapter+ledger+related;
  }
  function worldClockModal(){const shared=window.SengokuWorldClock?.snapshot(),clock=shared?.clock,d=date();modal('全プレイヤー共通の時間',`${d.year}年${d.month}月`, `<div class="world-clock-summary"><span>${icon('calendar')}</span><strong>1560年1月 → 1615年12月 → 1560年1月</strong><p>全プレイヤーが同じ年月を共有します。1倍速では実時間60秒がゲーム内の1か月。暦が一周すると占領した拠点を集計し、本拠以外の領地は初期配置に戻ります。最初に選んだ本拠へ戻ります。固定本拠と共同拠点は、その城を維持します。武将・施設・資源、本拠の城郭レベルは引き継ぎます。</p><p>画面を閉じていても世界の時間は進み、再接続時に生産・普請・研究・月次処理が共通時刻へ追いつきます。区切りの時点で所有している本拠以外の城1つにつき、勾玉100・金銭1,000・兵糧1,000を一度だけ受け取れます。同盟・偵察と、本拠以外で進行中の城郭拡張はリセットされます。</p>${state().cycle?.latestReward?`<div class="notice cycle-reward-summary"><strong>前回の占領報酬</strong><p>対象 ${num(state().cycle.latestReward.captured)}城 · 勾玉 ${num(state().cycle.latestReward.magatama)} · 金銭 ${num(state().cycle.latestReward.gold)} · 兵糧 ${num(state().cycle.latestReward.rice)}</p></div>`:''}<div class="notice">${esc(shared?.message||'共通時刻を確認しています。')}${shared?.mode==='offline'?' このローカル環境では端末内の時間で進行します。':''}</div>${game.isAdmin&&shared?.mode!=='offline'?`<hr class="divider"><h3>共通時間の管理</h3><p>変更は全プレイヤーに反映されます。</p><div class="form-row"><label for="world-clock-speed">全体の速度</label><select id="world-clock-speed" class="select">${[1,2,4].map(speed=>`<option value="${speed}" ${clock?.speed===speed?'selected':''}>${speed}倍速</option>`).join('')}</select></div><div class="form-row"><label for="world-clock-running">全体の進行</label><select id="world-clock-running" class="select"><option value="true" ${clock?.running?'selected':''}>全員の時間を進める</option><option value="false" ${clock&&!clock.running?'selected':''}>全員の時間を停止する</option></select></div>`:''}</div>`,`<button class="button" data-action="close">戻る</button>${game.isAdmin&&shared?.mode!=='offline'?`<button class="button primary" data-action="world-clock-apply" ${!shared?.ready?'disabled':''}>全プレイヤーへ反映</button>`:''}`,'world-clock');}
  async function updateWorldClock(node){if(!game.isAdmin)return;const clock=window.SengokuWorldClock?.snapshot().clock;if(!clock)return;node.disabled=true;try{const result=await window.SengokuSocial?.setWorldClock?.({speed:Number($('#world-clock-speed').value),running:$('#world-clock-running').value==='true',revision:clock.revision});if(!result?.clock)throw Error('共通時刻を更新できませんでした。');window.SengokuWorldClock.accept(result.clock);closeModal();render();toast('全プレイヤー共通の時間設定を更新しました。');}catch(error){toast(error.message||'共通時刻の更新に失敗しました。',true);window.SengokuWorldClock?.refresh();node.disabled=false;}}


  function replaceMainContents(html){
    // The same scene, portrait nodes and mounted map stay attached while
    // resources and jobs change. The map owns its subtree and camera state.
    patchHTML($('#main'),html,{key:currentView,preserveSelectors:['#world-map']});
  }

  function render(){if(window.SENGOKU_AT_TITLE===true)return;renderHeader();nav();Promise.resolve().then(()=>window.SengokuProgress?.refresh?.());
    if(startPending){if(courtController){courtController.dispose();courtController=null;}if(fieldController){fieldController.destroy();fieldController=null;}if(roamingController){roamingController.dispose();roamingController=null;}if(covertController){covertController.dispose();covertController=null;}$('#main').dataset.view='start';patchHTML($('#main'),renderStartSelection(),{key:'start'});refreshLiveControls({refreshHints:false});window.SengokuDesktopFit?.refresh();window.SengokuHintsUI?.refresh?.();return;}
    if(currentView==='field'&&fieldController&&$('#shared-field')){fieldController.update(fieldOptions());refreshLiveControls({refreshHints:false});refreshJobTimers();window.SengokuDesktopFit?.refresh();window.SengokuHintsUI?.refresh?.();return;}
    if(currentView==='roaming'&&roamingController&&$('#roaming-field')){refreshLiveControls({refreshHints:false});window.SengokuDesktopFit?.refresh();window.SengokuHintsUI?.refresh?.();return;}
    if(currentView==='covert'&&covertController&&$('#covert-field')){refreshLiveControls({refreshHints:false});window.SengokuDesktopFit?.refresh();window.SengokuHintsUI?.refresh?.();return;}
    if(currentView==='court'&&courtController&&$('#court-field')){refreshLiveControls();window.SengokuDesktopFit?.refresh();return;}
    if(courtController){courtController.dispose();courtController=null;}
    if(fieldController){fieldController.destroy();fieldController=null;}
    if(roamingController){roamingController.dispose();roamingController=null;}if(covertController){covertController.dispose();covertController=null;}
    const renderers={town:renderTown,facilities:renderFacilities,map:renderMap,field:renderField,roaming:renderRoaming,covert:renderCovert,court:renderCourt,officers:renderOfficers,army:renderArmy,research:renderResearch,council:renderCouncil,crests:renderCrests};$('#main').dataset.view=currentView;replaceMainContents((saveWarning?`<div class="notice">${esc(saveWarning)}</div>`:'')+(state().gameOver?`<div class="banner"><div><h2>落城 — 再起の時</h2><p>領国を失いました。新たな勢力と難易度で再び天下へ。</p></div><button class="button primary" data-action="new-game">新たに始める</button></div>`:state().won?`<div class="banner"><div><h2>天下統一</h2><p>統一対象の${game.unificationTarget?.()||data.castles.length}城が、あなたの旗の下に集いました。</p></div><button class="button gold" data-action="shogunate">幕府を開く</button><button class="button" data-action="export-save">戦記を保存</button></div>`:'')+renderers[currentView]());document.querySelectorAll('[data-icon]').forEach(el=>patchHTML(el,icon(el.dataset.icon)));refreshLiveControls({refreshHints:false});refreshJobTimers();syncWorldMap();if(currentView==='field'&&window.SengokuField)fieldController=window.SengokuField.mount($('#shared-field'),fieldOptions());if(currentView==='roaming'&&window.SengokuRoaming)roamingController=window.SengokuRoaming.mount($('#roaming-field'),roamingOptions());if(currentView==='covert'&&window.SengokuCovert)covertController=window.SengokuCovert.mount($('#covert-field'),covertOptions());if(currentView==='court'&&window.SengokuCourt){courtController=window.SengokuCourt.mount($('#court-field'),courtOptions());courtManagementRequested=false;}window.SengokuDesktopFit?.refresh();window.SengokuHintsUI?.refresh?.();}
  function renderField(){return heading('共通フィールド','SHARED WORLD · 領主たちの天下','同じ世界に拠点を構え、攻撃と外交で関係を築く。')+'<div id="shared-field" class="shared-field"><div class="notice">領主たちの拠点を読み込んでいます。</div></div>';}
  function fieldOptions(){return{stateKey:'shared-field',identity:window.SengokuSocial?.getUser?.()||null,request:requestField,getState:()=>state(),getGame:()=>game,getSyncStatus:()=>({...window.SengokuCloudSync?.getStatus?.(),writable:canMutate(),fieldPending:fieldActionPending,deviceId:window.SengokuCloudSync?.getDevice?.().id}),onRegister:()=>window.SengokuSocial?.open('profile'),onSync:()=>window.SengokuSocial?.open('sync'),onMutation:async()=>{},onMessage:toast};}
  function renderRoaming(){return '<div id="roaming-field" class="roaming-field"><div class="notice">野良兵士の部隊を確認しています。</div></div>';}
  function getRoamingAccess(){
    const clock=window.SengokuWorldClock?.snapshot();
    const writable=Boolean(saveEnabled&&!startPending&&canMutate());
    const reason=startPending?'はじめに本拠を選んでください。':!saveEnabled?'端末に進行を保存できる状態を確認してください。':fieldActionPending?'出陣結果を確認しています。':!writable?(clock&&!clock.ready?'共通時刻を確認しています。':syncMessage()):'';
    const ownerId=String(window.SengokuSocial?.getUser?.()?.id||'local');
    return{writable,reason,ownerId,linked:syncAccess.linked===true,online:navigator.onLine!==false,stamp:[ownerId,roleEpoch,state().roaming?.campaignId||state().campaignId||state().home].join(':')};
  }
  function roamingOptions(){return{getGame:()=>game,getStatus:getRoamingAccess,request:(route,options)=>window.SengokuSocial.roamingRequest(route,options),mountManagement:host=>window.SengokuRoamingManagement?.mount(host,{getContext:()=>window.SengokuSocial?.getEventContext?.()||{},request:(route,options)=>window.SengokuSocial.roamingRequest(route,options),onDeploymentChanged:()=>roamingController?.controller?.loadDeployment?.()}),battle:requestRoamingBattle,onResult:()=>{renderHeader();refreshLiveControls({refreshHints:false});window.SengokuHintsUI?.refresh?.();playNote(659,.075);}};}
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
  function covertOptions(){return{getGame:()=>game,getStatus:getCovertAccess,load:cursor=>requestCovert('/covert'+(cursor?'?cursor='+encodeURIComponent(cursor)+'&limit=100':''),{method:'GET'}),mutate:(action,payload)=>requestCovert('/covert/'+action,{method:'POST',data:payload}),onResult:()=>{renderHeader();refreshLiveControls({refreshHints:false});window.SengokuHintsUI?.refresh?.();playNote(659,.075);}};}
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
    const action=route.slice('/branches/'.length);if(!(method==='GET'&&route==='/branches'||method==='POST'&&['build','upgrade','repair','build-facility','upgrade-facility','transfer-troops','assign-commander','remove-commander','auto-assign-commanders','auto-assign-officers'].includes(action)&&route==='/branches/'+action))throw Error('支拠点の操作を確認してください。');
    if(syncAccess.linked){const api=window.SengokuSocial?.branchRequest;if(!api)throw Error('支拠点に接続できません。');if(method==='GET')return api(route,{method});const actor=String(window.SengokuSocial?.getUser?.()?.id||''),epoch=roleEpoch,campaign=state().walking?.campaignId;const current=await api('/branches',{method:'GET'});if(actor!==String(window.SengokuSocial?.getUser?.()?.id||'')||epoch!==roleEpoch||campaign!==state().walking?.campaignId)throw Object.assign(Error('領主の進行が変わったため支拠点の操作を取り消しました。'),{code:'STALE_IDENTITY'});if(typeof current.campaignId!=='string'||!Number.isSafeInteger(current.sequence))throw Error('支拠点の最新情報を確認できませんでした。');return requestField(route,{method,data:{...payload,campaignId:current.campaignId,sequence:current.sequence}});}
    if(method==='GET')return{ok:true,branchState:{branches:state().branches||[]}};
    if(['transfer-troops','assign-commander','remove-commander','auto-assign-commanders','auto-assign-officers'].includes(action)){
      if(!canMutate()||!saveEnabled)throw Error(syncMessage());
      const previous=game,candidate=SengokuEngine.fromSave(game.exportSave(),roster,{isAdmin:game.isAdmin,isStaff:game.isStaff,staffBase:game.getStaffBase?.(),branchAuthority:{resolvedElapsedMs:game.branchResolvedElapsedMs},maintenanceAuthority:game.getMaintenanceAuthority?.()});
      const result=action==='auto-assign-officers'?candidate.autoAssignGovernors():action==='transfer-troops'?candidate.transferTroops(payload.from,payload.to,payload.troops):action==='auto-assign-commanders'?candidate.autoAssignBranchCommanders(payload.branchId):action==='assign-commander'?candidate.assignBranchCommander(payload.branchId,payload.officerId):candidate.removeBranchCommander(payload.branchId,payload.officerId);
      if(!result.ok)return result;
      window.SengokuBranches?.transferSelection?.(previous,candidate);game=candidate;
      if(!save()){game=previous;renderHeader();refreshLiveControls();throw Error('保存できなかったため、兵と武将の配置を操作前に戻しました。');}
      return result;
    }
    if(!canMutate()||!saveEnabled)throw Error(syncMessage());const before=JSON.parse(JSON.stringify(state())),result=action==='build'?game.buildBranch(payload.parentCastleId,payload.direction):action==='upgrade'?game.upgradeBranch(payload.branchId):action==='build-facility'?game.buildBranchFacility(payload.branchId,payload.facilityId):action==='upgrade-facility'?game.upgradeBranchFacility(payload.branchId,payload.facilityId):action==='transfer-troops'?game.transferTroops(payload.from,payload.to,payload.troops):game.repairBranch(payload.branchId);if(!result.ok)return result;
    if(!save()){game.state=before;renderHeader();refreshLiveControls();throw Error('保存できなかったため、支拠点の手配を取り消しました。資源と指令は元に戻しています。');}return result;
  }
  function getTroopGarrisonAccess(){
    const user=window.SengokuSocial?.getUser?.(),readable=Boolean(user&&syncAccess.linked&&syncAccess.ready&&!syncAccess.rolePending&&!syncAccess.banned);
    return{readable,writable:readable&&saveEnabled&&canMutate(),campaignId:state().walking?.campaignId||'',reason:!readable?'交流で領主登録と端末同期を確認してください。':!saveEnabled?'兵の配置を変更する前に保存状態を確認してください。':syncMessage()};
  }
  async function requestTroopGarrisons(route,{method='GET',data:payload}={}){
    if(!(method==='GET'&&route==='/troop-garrisons'||method==='POST'&&['/troop-garrisons/send','/troop-garrisons/recall'].includes(route)))throw Error('空城への兵の配置を確認してください。');
    const social=window.SengokuSocial,sync=window.SengokuCloudSync,api=social?.troopGarrisonRequest;
    if(!api||!syncAccess.linked)throw Error('空城への兵の配置には領主登録と端末同期が必要です。');
    if(method==='GET')return api(route,{method});
    const actor=String(social.getUser?.()?.id||''),epoch=roleEpoch,campaign=state().walking?.campaignId;
    const verify=()=>{if(!actor||String(social.getUser?.()?.id||'')!==actor||roleEpoch!==epoch||state().walking?.campaignId!==campaign)throw Object.assign(Error('領主または戦役が切り替わったため、以前の操作を停止しました。'),{code:'STALE_IDENTITY',retryable:true});};
    if(fieldActionPending)throw Object.assign(Error('前の兵や資産の操作結果を確認しています。'),{retryable:true});
    if(!payload?.requestId||!payload?.campaignId)throw Error('兵の配置の受付番号と戦役を確認してください。');
    verify();await window.SengokuWorldClock?.refresh();verify();processWorldClock();
    if(!getTroopGarrisonAccess().writable||!requireWritable())throw Object.assign(Error(getTroopGarrisonAccess().reason||'端末同期が整ってから操作してください。'),{retryable:true});
    if(!save())throw Error('保存できなかったため、兵の移動を見送りました。');
    fieldActionPending=true;refreshLiveControls();let sent=false,acknowledged=false;
    try{
      const flushed=await sync.flush();verify();if(!flushed?.ok||!sync.getStatus().writable)throw Object.assign(Error('最新の兵数を同期できませんでした。同じ操作の結果を再確認してください。'),{retryable:true});
      sent=true;const result=await api(route,{method,data:{...payload,deviceId:sync.getDevice().id,expectedRevision:sync.getStatus().revision}});acknowledged=result?.ok===true;verify();
      if(result.clock)window.SengokuWorldClock?.accept(result.clock);
      const needsSync=()=>!Number.isSafeInteger(result.revision)||!Number.isSafeInteger(sync.getStatus().revision)||sync.getStatus().revision<result.revision;
      let reconciled=await sync.refresh();verify();if(needsSync()){reconciled=await sync.refresh();verify();}
      if(!reconciled?.ok||needsSync())throw Object.assign(Error('兵の移動結果を保存先に確認しています。同じ操作の結果を再確認してください。'),{code:'TROOP_GARRISON_RECONCILE_PENDING',retryable:true});
      return result;
    }catch(error){if(acknowledged)error.retryable=true;if(sent&&String(social.getUser?.()?.id||'')===actor&&roleEpoch===epoch&&state().walking?.campaignId===campaign)try{await sync.refresh();}catch(_){}throw error;}
    finally{fieldActionPending=false;refreshLiveControls();queueWorldProgress();}
  }
  async function requestField(route,{method='GET',data:payload,allowStrategy=false}={}){
    const isCampaign=method==='POST'&&route==='/marches/campaign',isExpansion=method==='POST'&&/^\/(?:progress\/(?:claim|exchange)|alliance\/(?:rally\/(?:join|launch)|reinforcements\/send|units\/claim|treasury\/claim))$/.test(route),isBranch=method==='POST'&&/^\/branches\/(?:build|upgrade|repair|build-facility|upgrade-facility|transfer-troops|assign-commander|remove-commander|auto-assign-commanders|auto-assign-officers)$/.test(route),isGuild=route==='/guild/treasury/transfer'&&method==='POST',isStaff=route==='/staff/base/upgrade'&&method==='POST',isAttack=route==='/field/attack'&&method==='POST',isTrade=method==='POST'&&/^\/trades(?:\/tr_[a-f0-9]{32}\/(?:accept|cancel|reject|claim))?$/.test(route),isEvent=method==='POST'&&/^\/events\/ev_[a-f0-9]{32}\/battle$/.test(route),isRoaming=method==='POST'&&route==='/roaming/battle',isCovert=method==='POST'&&/^\/covert\/(?:hire|dispatch|recall|retaliate)$/.test(route);
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
  function localMarches(){const covert=state().covert;return[game.getMarchStatus?.(),...(state().marchHistory||[]),...(covert?.dispatches||[]),...(covert?.history||[]).filter(r=>r.march&&['resolved','cancelled'].includes(r.status)).map(r=>({...r.march,status:r.status,receipt:r,message:r.status==='cancelled'?'派遣を取りやめ、部隊と出陣費用を戻しました。':r.mode==='station'?'部隊が到着し、常駐を開始しました。':'調査が完了し、部隊は帰還しました。'}))].filter(Boolean);}
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
  function troopTransportCapacity(){return game.troopTransportCapacity();}
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
  function getLocalCommander(){const officer=!startPending&&game.officer(state().army[0]);return officer?{officerId:officer.id,name:officer.name,rank:officer.rank}:null;}
  function go(view){if(!['town','facilities','map','field','roaming','covert','court','officers','crests','army','research','council'].includes(view))return;interactionEpoch++;closeModal();currentView=view;syncMusic();history.replaceState(null,'','#'+view);render();const main=$('#main');if(main){main.scrollTop=0;main.scrollLeft=0;}window.scrollTo({top:0,left:0,behavior:'instant'});}
  function buildingOutput(id){return game.buildingSummary?game.buildingSummary(id):'';}
  function economyNumber(value,kind='net'){
    const amount=Number(value)||0;if(!amount)return '0';
    return (kind==='troopUpkeep'||kind==='facilityUpkeep'||kind==='governorSalary'||kind==='surplusAdjustment'||kind==='repairUpkeep'||amount<0?'−':'+')+num(Math.abs(amount));
  }
  function economyBalanceTitle(key,income){
    return `${resNames[key]}：毎月の差引（見込） ${economyNumber(income[key])}（生産 ${economyNumber(income.gross[key],'gross')}、兵の維持費 ${economyNumber(income.troopUpkeep[key],'troopUpkeep')}、施設・城の維持費 ${economyNumber(income.facilityUpkeep[key],'facilityUpkeep')}、奉行の給与 ${economyNumber(income.governorSalary[key],'governorSalary')}、余剰生産の調整 ${economyNumber(income.surplusAdjustment[key],'surplusAdjustment')}、拠点の修復費見込 ${economyNumber(income.repairUpkeep?.[key],'repairUpkeep')}）`;
  }
  function economyPanel(scope='ledger'){
    const income=game.income(),troops=[['field','本隊'],['marching','出陣中'],['castleGarrisons','本拠・所領の守備兵'],['branchGarrisons','支拠点の配置兵'],['retreating','帰還待機'],['covert','忍者・足軽'],['external','外部に配置・預けている兵']],levels=[['townLevels','城下の施設'],['castleLevels','所有する城郭'],['branchLevels','稼働中の支拠点'],['branchFacilityLevels','支拠点の施設']];
    return `<section class="panel economy-panel ${scope==='army'?'economy-panel-compact':''}" data-economy-panel="${scope}" aria-labelledby="economy-title-${scope}"><div class="panel-heading"><h2 id="economy-title-${scope}">毎月の収支</h2>${icon('scroll')}</div><div class="economy-total"><span>維持費の対象となる兵</span><strong><span data-economy-total>${num(income.totalTroops)}</span><small>人</small></strong></div><div class="economy-resources">${Object.entries(resNames).map(([key,label])=>`<article class="economy-resource" data-stable-key="economy-${scope}-${key}"${scope==='details'?` id="economy-resource-${key}" data-economy-resource-panel="${key}" role="tabpanel" aria-labelledby="economy-tab-${key}" tabindex="0"`:''}><h3>${icon(resIcons[key],key)}${label}</h3><dl>${[['gross','生産'],['troopUpkeep','兵の維持費'],['facilityUpkeep','施設・城の維持費'],['governorSalary','奉行の給与'],['surplusAdjustment','余剰生産の調整'],['repairUpkeep','拠点の修復費（見込）'],['net','差引（見込）']].map(([kind,title])=>`<div class="economy-row ${kind==='net'?'economy-net':''}"><dt>${title}</dt><dd data-economy-rate="${kind}" data-economy-resource="${key}" class="${kind==='net'&&income.net[key]<0?'is-negative':''}">${economyNumber(income[kind][key],kind)}</dd></div>`).join('')}</dl></article>`).join('')}</div><details class="economy-details"><summary>維持費・給与の対象と内訳</summary><h3>奉行の給与</h3><dl class="economy-breakdown"><div><dt>任命中の奉行</dt><dd><span data-economy-governors>${num(income.governorCount)}</span>人</dd></div><div><dt>1人の月給</dt><dd>金銭 ${num(data.maintenance.governorMonthlyGold)}</dd></div></dl><p>建設済み施設の奉行に、在任時間に応じて金銭を支払います。解除・軍団への異動後は、その武将の給与はかかりません。</p><h3>現在の兵数</h3><dl class="economy-breakdown">${troops.map(([key,label])=>`<div><dt>${label}</dt><dd><span data-economy-troops="${key}">${num(income.troopBreakdown[key])}</span>人</dd></div>`).join('')}</dl><h3>維持している完成レベル</h3><dl class="economy-breakdown">${levels.map(([key,label])=>`<div><dt>${label}</dt><dd>計 <span data-economy-levels="${key}">${num(income.facilityLevels[key])}</span></dd></div>`).join('')}<div><dt>完成レベルの合計</dt><dd><span data-economy-levels="totalLevels">${num(income.facilityLevels.totalLevels)}</span></dd></div></dl><p>施設・城の完成レベルと所有する城の数に応じた維持費です。未完成の普請・予約分は含みません。</p></details>${scope==='details'?'<details class="economy-rules"><summary>収支・自動減兵・修復の仕組み</summary>':''}<p class="economy-note">維持費・給与を引いた後の余剰が大きいほど、増える資産を緩やかに調整します。増産分の25%を残す計算により、大きな領国でも施設強化の効果が続きます（端数切り捨て）。少額の収入・赤字・現在の備蓄・報酬は、この調整で減りません。差引は現在の生産・維持費と、次回の修復費を含めた見込みです。</p><p class="economy-note">ゲーム内の月替わりに1回、金銭・兵糧の月間収支を確認します。赤字の場合は、手持ちの兵、本拠を優先した城の守備兵、支拠点の兵の順に、必要な人数だけ自動で減らし、その分の兵士維持費も下げます。月の途中では自動減兵しません。施設維持費は変わりません。</p><p class="economy-note">自領の城と稼働中の支拠点は、月替わりに最大耐久の10%まで修復します。回復100につき木材5・石材4を使い、修復した分だけ支払います。月途中の損傷は経過時間で按分し、資材が不足する場合は各拠点の必要量に応じて回復を配分します。満タン・未完成・陥落中の拠点には日常の修復費はかかりません。陥落した支拠点の復旧工事は、開始時の見積額で精算します。</p><p class="economy-note">1倍速では60秒で1か月。生産・維持費・奉行の給与は経過時間に応じて反映し、残高は0未満になりません。勾玉・威信は維持費の対象外です。</p>${scope==='details'?'</details>':''}</section>`;
  }
  function refreshEconomyPanels(income){
    const panels=document.querySelectorAll('[data-economy-panel]');if(!panels.length)return;
    for(const panel of panels){
      if(panel.closest?.('[hidden],[inert],dialog:not([open])'))continue;
      for(const node of panel.querySelectorAll('[data-economy-rate]')){
        const kind=node.dataset.economyRate,value=income[kind][node.dataset.economyResource],text=economyNumber(value,kind);
        if(node.textContent!==text)node.textContent=text;
        node.classList.toggle('is-negative',kind==='net'&&value<0);
      }
      for(const node of panel.querySelectorAll('[data-economy-total],[data-economy-governors],[data-economy-troops],[data-economy-levels]')){
        const value=node.hasAttribute('data-economy-total')?income.totalTroops:node.hasAttribute('data-economy-governors')?income.governorCount:node.hasAttribute('data-economy-troops')?income.troopBreakdown[node.dataset.economyTroops]:income.facilityLevels[node.dataset.economyLevels],text=num(value);
        if(node.textContent!==text)node.textContent=text;
      }
    }
  }
  function economyDetailsModal(resource='gold'){
    const key=Object.hasOwn(resNames,resource)?resource:'gold';
    const tabs=`<nav class="economy-resource-tabs" role="tablist" aria-label="資源ごとの収支">${Object.entries(resNames).map(([id,label])=>`<button type="button" role="tab" id="economy-tab-${id}" data-action="economy-resource" data-economy-resource-tab="${id}" data-resource="${id}" aria-selected="${key===id}" aria-controls="economy-resource-${id}" tabindex="${key===id?'0':'-1'}">${icon(resIcons[id])}<span>${label}</span></button>`).join('')}</nav>`;
    modal('毎月の収支','生産・兵の維持費・奉行の給与・修復費をまとめて確認。',`<div class="economy-details-view" data-resource="${key}"><div class="economy-details-intro"><span>${icon('scroll')}</span><p>資源を選ぶと、その内訳を確認できます。<br>数値は現在の編成・施設から計算した見込みです。</p></div>${tabs}${economyPanel('details')}</div>`,`<button class="button" data-view="facilities">${icon('castle')}生産施設を見直す</button><button class="button" data-view="army">${icon('users')}軍団を見直す</button><button class="button primary" data-action="close">閉じる</button>`,'economy-details',{resource:key});
    selectEconomyResource(key);
  }
  function selectEconomyResource(resource,focus=false){
    if(activeModal!=='economy-details'||!Object.hasOwn(resNames,resource))return;
    const view=$('#modal .economy-details-view');if(!view)return;
    view.dataset.resource=resource;activeModalContext.resource=resource;
    for(const tab of view.querySelectorAll('[data-economy-resource-tab]')){
      const selected=tab.dataset.economyResourceTab===resource;
      tab.setAttribute('aria-selected',String(selected));tab.setAttribute('tabindex',selected?'0':'-1');
      if(selected&&focus)tab.focus({preventScroll:true});
    }
    for(const panel of view.querySelectorAll('[data-economy-resource-panel]')){
      const selected=panel.dataset.economyResourcePanel===resource;
      panel.hidden=!selected;if(selected)panel.removeAttribute('inert');else panel.setAttribute('inert','');
    }
  }
  function economyResourceKeydown(event){
    if(event.defaultPrevented||event.isComposing||event.altKey||event.ctrlKey||event.metaKey)return;
    const tab=event.target.closest?.('[data-economy-resource-tab]');if(!tab)return;
    const keys=Object.keys(resNames),index=keys.indexOf(tab.dataset.economyResourceTab);
    const next=event.key==='ArrowRight'?keys[(index+1)%keys.length]:event.key==='ArrowLeft'?keys[(index+keys.length-1)%keys.length]:event.key==='Home'?keys[0]:event.key==='End'?keys.at(-1):null;
    if(!next)return;event.preventDefault();selectEconomyResource(next,true);
  }

  function facilityMaintenanceHtml(id,level,nextLevel=null){
    const current=game.facilityUpkeep(id,level),next=nextLevel===null?null:game.facilityUpkeep(id,nextLevel);
    return `<section class="facility-maintenance" aria-label="施設の毎月の維持費"><h3>毎月の維持費</h3><table><thead><tr><th scope="col">資源</th><th scope="col">現在 Lv.${level}</th>${next?`<th scope="col">Lv.${nextLevel}完成後</th>`:''}</tr></thead><tbody>${Object.entries(resNames).map(([key,label])=>`<tr data-maintenance-resource="${key}"><th scope="row">${label}</th><td data-maintenance-current>${num(current[key])}</td>${next?`<td data-maintenance-next>${num(next[key])}</td>`:''}</tr>`).join('')}</tbody></table><p>維持費は完成した段階にだけかかります。${next?'右列は次に手配する段階が完成したときの月額です。':''}普請の着手時に支払う資源とは別に、経過時間に応じて差し引きます。</p></section>`;
  }
  function buildingCard(b){const lv=state().buildings[b.id]||0,job=currentJob('building',b.id),max=game.buildingMax(b.id),unlock=game.buildingUnlock?.(b.id)||{ok:true};return `<button class="building-card ${!unlock.ok?'locked-building':''}" data-category="${esc(b.category)}" data-action="building" data-id="${b.id}">${window.SengokuArt?.facility(b.id,'building-art',lv||1)||''}${job?`<span class="job-label">${job.shared?'共同普請':'普請中'}</span>`:''}<div class="building-top"><span class="building-symbol">${icon(b.icon)}</span><span class="building-level">${lv?`Lv.${lv}/${max}`:'未建設'}</span></div><h3>${esc(b.name)}</h3><p>${!unlock.ok?`天守 Lv.${unlock.requiredLevel}で解放`:esc(buildingOutput(b.id))}</p>${facilityGovernorLabel(b.id)}<div class="building-track">${Array.from({length:16},(_,i)=>`<i class="${i<Math.ceil(lv/2)?'on':''}"></i>`).join('')}</div>${job?`<small class="building-job-clock" data-job-clock="${jobKey(job)}">${esc(jobClockText(job))}</small>`:''}</button>`;}
  const categoryNames={gold:'商業',rice:'農業・兵糧',wood:'林業・木材',stone:'鉱業・石材',military:'軍備',defense:'城郭・防衛',research:'学問・技術',diplomacy:'統治・外交'};
  function governorAssignmentStatus(){
    const s=state(),reserved=(s.branches||[]).filter(branch=>branch.level<1||branch.fallen||branch.retreating||!game.canOwnCastle(branch.parentCastleId)||s.castles[branch.parentCastleId]?.owner!==s.clan),army=new Set([...s.army,...reserved.flatMap(branch=>branch.commanders||[])]),facilities=data.buildings.filter(b=>s.buildings[b.id]>0);
    return{facilityCount:facilities.length,candidateCount:new Set(s.officers.filter(id=>!army.has(id))).size,assignedCount:facilities.filter(b=>Boolean(s.governors[b.id])).length};
  }
  function governorAssignmentEntry(){
    const status=governorAssignmentStatus(),payroll=game.governorPayroll(),unavailable=branchBookingPending||!saveEnabled||!status.facilityCount||!status.candidateCount||game.isStaff&&!staffConstructionReady();
    const hint=!status.facilityCount?'施設を建設すると奉行を配置できます。':!status.candidateCount?'本隊以外に配置できる家臣を迎えると利用できます。':game.isStaff&&!staffConstructionReady()?'共同拠点の成長を確認しています。':'本隊を維持し、配置済みの支拠点軍団も見直してから奉行を配置します。';
    return `<section class="governor-assignment-panel" aria-label="奉行のお任せ配置"><div class="governor-assignment-copy"><h3>${icon('users')}奉行のお任せ配置</h3><p>支拠点の軍団を優先して再編成し、残った武将を政治と特技に応じて配置します。給与後の金銭収支を見て、任命する人数を調整します。</p><small>${esc(hint)}</small></div><div class="governor-assignment-actions"><span>奉行 <b>${status.assignedCount} / ${status.facilityCount}</b>施設 · 候補 ${status.candidateCount}名</span><span>給与：金銭 <b>${num(payroll.gold)}</b> / 月（1人 ${num(payroll.perOfficer)}）</span><button type="button" class="button gold" data-action="auto-governors" ${unavailable?'disabled':''}>${icon('users')}奉行をお任せ配置</button></div></section>`;
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
    modal(result.changed||result.changedCount||result.branchAssignedCount?'武将をお任せ配置しました':'現在の配置を維持しました','本隊を維持し、支拠点の軍団、施設の奉行の順に配置',`<div class="governor-result-summary"><div><span>配置</span><b>${result.assignedCount} / ${result.facilityCount}<small>施設</small></b></div><div><span>変更</span><b>${result.changedCount}<small>施設</small></b></div><div><span>未任命</span><b>${result.vacantCount}<small>施設</small></b></div></div><p class="subtitle">所持する最高ランクの政治・特技による補正を比較し、給与後の金銭収支も考慮しています。同じ効果なら現在の配置を優先します。任命時の指令・金銭は不要です。任命中は1人につき月額${num(data.maintenance.governorMonthlyGold)}の金銭を在任時間に応じて支払います。現在の給与総額は金銭${num(game.governorPayroll().gold)}／月です。</p>${result.budgetLimitedCount?`<p class="notice">給与による赤字を抑えるため、${num(result.budgetLimitedCount)}施設は任命を見送りました。配置後の金銭差引は${economyNumber(result.projectedNetGold)}／月です。各施設から手動で任命することもできます。</p>`:''}${(result.staffingVacantCount??result.vacantCount)?'<p class="notice">家臣が足りない施設は未任命です。登用・招集後に、もう一度お任せ配置できます。</p>':''}${(result.branchChangedCount??result.branchAssignedCount)?`<p class="notice">支拠点の軍団を見直し、${num(result.branchChangedCount??result.branchAssignedCount)}枠を変更しました。${result.branchReplacedCount?`うち${num(result.branchReplacedCount)}名は配置済みの武将との入れ替えです。`:""}奉行から異動した武将は元の施設の配置を解除しています。</p>`:''}<ul class="governor-result-list">${rows}</ul>`,`<button class="button" data-view="facilities">全施設を確認</button><button class="button gold" data-action="close">閉じる</button>`,'governor-result');
  }
  async function autoAssignGovernors(){
    if(branchBookingPending||!requireWritable())return;
    if(!saveEnabled){toast('保存できる状態を確認してから武将を配置してください。',true);return;}
    if(game.isStaff&&!staffConstructionReady()){toast('共同拠点の最新の成長を確認してから配置してください。',true);return;}
    branchBookingPending=true;refreshLiveControls();
    try{
      const response=await requestBranches('/branches/auto-assign-officers',{method:'POST',data:{branchId:'all'}}),result=response?.result||response;
      if(!response?.ok||!result?.ok)throw Error(result?.message||response?.message||'武将を配置できませんでした。');
      preserveInteraction($('#main'),render);refreshActiveModal();playNote(659,.075);governorAssignmentResult(result);
    }catch(error){toast(error.message||'武将の配置結果を確認してください。',true);}
    finally{branchBookingPending=false;refreshLiveControls();}
  }
  function saveFacilityPreferences(){try{window.SengokuManagement.savePreferences(localStorage,{query:facilityQuery,category:facilityCategory,state:facilityState,sort:facilitySort,layout:facilityLayout},Object.keys(categoryNames));}catch(_){/* Display preferences never block play when storage access is denied. */}}
  function facilityPlannerTools(){
    const jobs=constructionJobs().filter(job=>job.kind!=='research'&&Boolean(job.shared)===Boolean(game.isStaff)),active=new Set(jobs.map(job=>job.kind+':'+job.id)).size;
    return `<section class="facility-planner" aria-label="普請の計画"><div class="facility-planner-overview"><div><span>${game.isStaff?'共同普請':'普請'}の使用枠</span><strong>${active}<small> / ${game.constructionSlots()} 件</small></strong></div><div><span>建設済み</span><strong>${data.buildings.filter(b=>state().buildings[b.id]>0).length}<small> / ${data.buildings.length} 施設</small></strong></div><button type="button" class="button" data-action="command-activity" data-filter="construction">${icon('calendar')}行動予定表</button></div><div class="facility-planner-tools"><label for="facility-sort">並べ替え<select id="facility-sort" class="select">${[['default','標準の順'],['level-asc','レベルが低い順'],['level-desc','レベルが高い順'],['cost','必要金銭が少ない順'],['name','名前順']].map(([key,label])=>`<option value="${key}"${facilitySort===key?' selected':''}>${label}</option>`).join('')}</select></label><div class="facility-layout-switch" role="group" aria-label="施設一覧の表示形式">${[['cards','絵札'],['list','一覧']].map(([key,label])=>`<button type="button" class="button${facilityLayout===key?' active':''}" data-action="facility-layout" data-id="${key}" aria-pressed="${facilityLayout===key}">${icon(key==='cards'?'castle':'scroll')}${label}</button>`).join('')}</div><span class="facility-planner-note">表示と検索条件をこの端末に保存</span></div></section>`;
  }
  function facilitiesResults(){
    const filtered=facilityCategory!=='all'||facilityQuery||facilityState!=='all';
    const model=window.SengokuManagement,rows=model.facilityRows(game,data.buildings),list=model.filterFacilities(rows,{query:facilityQuery,category:facilityCategory,state:facilityState,sort:facilitySort,layout:facilityLayout},catalogMatches,categoryNames);
    const pageSize=facilityLayout==='list'?16:6,pages=Math.max(1,Math.ceil(list.length/pageSize));facilityPage=Math.max(1,Math.min(facilityPage,pages));
    const notes={available:'天守の条件を満たした、普請中以外の施設です。資源・指令・空き枠は詳細で確認できます。',affordable:'普請中を除き、表示時点で次の増築に必要な資源が揃った施設です。指令・普請の空き枠は詳細で確認します。',vacant:'建設済みで奉行を任命していない施設です。奉行の給与は1人につき金銭50／月です。'};
    return `${catalogChips('facility',facilityState,[['all','すべて'],['available','強化候補'],['affordable','資源充足'],['unbuilt','未建設'],['working','普請中'],['vacant','奉行未任命'],['complete','完成']])}<div class="catalog-result-summary"><p role="status"><strong>${list.length}</strong> / ${data.buildings.length}施設 · ${facilityPage} / ${pages}頁</p><button type="button" class="text-link" data-action="catalog-reset" data-kind="facility"${filtered?'':' disabled'}>条件をリセット</button></div>${notes[facilityState]?`<p class="catalog-filter-note">${notes[facilityState]}${facilityState==='affordable'?'<button type="button" class="text-link" data-action="facility-refresh">最新の資源で更新</button>':''}</p>`:''}<div class="facility-catalog${facilityLayout==='list'?' facility-catalog-list':''}">${list.slice((facilityPage-1)*pageSize,facilityPage*pageSize).map(row=>{
      const {building:b,level,maximum,job:j,unlock:u,cost,status}=row;
      const statusLabel={complete:'最高段階',working:'普請中',locked:'解放待ち',shortage:'資源不足',funded:'資源充足'}[status];
      return `<section class="facility-entry" data-category="${esc(b.category)}" data-facility-entry="${b.id}">${window.SengokuArt?.facility(b.id,'facility-art',level||1)||''}<div class="facility-entry-heading"><span class="building-symbol">${icon(b.icon)}</span><div><small>${categoryNames[b.category]||'城下町'}</small><h3>${esc(b.name)}</h3></div><span class="facility-seal">${level?`<b>${level}</b><small>/ ${maximum}</small>`:'<small>未建設</small>'}</span></div><p class="facility-description">${esc(b.description)}</p><div class="facility-effect">${esc(b.effectText||b.output)}</div><div class="facility-management-meta">${facilityGovernorLabel(b.id)}<span class="facility-readiness" data-facility-status="${status}"${status==='shortage'||status==='funded'?' data-facility-funding':''}>${statusLabel}</span></div>${j?`<div class="notice">Lv.${j.targetLevel}へ${j.shared?'共同普請':'普請'}中 · <span data-job-clock="${jobKey(j)}">${esc(jobClockText(j))}</span>${sharedJobAttribution(j)}</div><div class="progress"><i data-job-progress="${jobKey(j)}" style="width:${j.queued?0:game.constructionProgress(j)}%"></i></div><button class="button gold full" data-action="building" data-id="${b.id}">${buildingTailLevel(b.id)<maximum?'次の増築を予約':'増築の予定を確認'}</button>`:level>=maximum?`<div class="notice">最高段階に到達</div><button class="button full" data-action="building" data-id="${b.id}">施設・奉行を確認</button>`:`${costHtml(cost)}<button class="button ${u.ok?'gold':''} full" data-action="building" data-id="${b.id}">${u.ok?(level?'増築・奉行を管理':'建設する'):esc(u.reason||`天守Lv.${u.requiredLevel}で解放`)}</button>`}</section>`;
    }).join('')||'<div class="empty catalog-empty"><p>条件に合う施設はありません。</p><button type="button" class="button" data-action="catalog-reset" data-kind="facility">すべての施設を表示</button></div>'}</div>${pageControls('facility-page',facilityPage,pages)}`;
  }
  function renderFacilities(){
    return heading('城下普請帳','CONSTRUCTION LEDGER · 六十四の礎',`${data.buildings.length}種類の施設を、各32段階まで育てる。`)+`${game.isStaff?`<div class="notice staff-base-note"><span role="status">${staffConstructionReady()?'京都御所の共同普請。着手者の資源・指令1回を使用。':'京都御所の共同拠点を確認中です。確認後に共同普請できます。'}</span> <button type="button" class="text-link" data-action="staff-base-detail">共同拠点の詳細</button></div>`:''}<div class="toolbar"><div class="search-box">${icon('search')}<input class="input" id="facility-search" type="search" maxlength="80" autocomplete="off" placeholder="施設名・効果を検索" value="${esc(facilityQuery)}" aria-label="施設を検索"></div><select id="facility-category" class="select" aria-label="施設の分類"><option value="all">すべての施設</option>${Object.entries(categoryNames).map(([k,n])=>`<option value="${k}" ${facilityCategory===k?'selected':''}>${n}</option>`).join('')}</select><button type="button" class="button" data-action="level-guide" data-id="${state().home}">${icon('book')}レベル上げガイド</button><button class="button" data-view="town">${icon('castle')}城下町に戻る</button></div>${facilityPlannerTools()}<div id="facility-results">${facilitiesResults()}</div><section class="facility-ledger-support" aria-label="普請を支える領国情報"><details id="facility-economy-support" class="economy-details facility-support-details"><summary>毎月の収支・維持費を確認</summary>${economyPanel('facilities')}</details><details id="facility-governor-support" class="economy-details facility-support-details"><summary>奉行をまとめて配置</summary>${governorAssignmentEntry()}</details><details id="facility-rules-support" class="economy-details facility-support-details"><summary>普請の上限・共同拠点のルール</summary>${staffBaseNotice()}<div class="notice">施設と城郭を合わせて同時に${game.constructionSlots()}件まで普請できます。未建設の施設はLv.1から育成し、全施設の上限はLv.32です。奉行に任命した家臣の能力・特技も効果に影響します。</div></details></section>`;
  }

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
    if(!canMutate()&&!window.SengokuSyncNotices?.isTransientStatus?.(syncAccess))return '同期・共通時刻の確認後に強化できます。';
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
  function premiumTownProduct(){const id=window.SengokuPremiumRuntime?.getAppearance?.().town;const product=window.SengokuPremiumCatalog?.getProduct?.(id);return product?.slot==='town'?product:null;}
  function premiumTownImage(){return premiumTownProduct()?.art?.src||'assets/castle-town.webp?v=4.9.10-20261123';}
  function premiumTownDescription(){return premiumTownProduct()?.art?.alt||'山々と川、城郭、田畑や商家まで見渡せる城下町の全景';}
  function townSceneSources(src){
    const name=src.includes('sakura-town')?'sakura-town':src.includes('snow-town')?'snow-town':src.includes('moonlit')?'moonlit-castle':'castle-town';
    return [400,720,1080,1536].map(width=>`assets/responsive/${name}-${width}.webp ${width}w`).join(', ');
  }
  function premiumTownBanner(){const id=window.SengokuPremiumRuntime?.getAppearance?.().nameplate,product=window.SengokuPremiumCatalog?.getProduct?.(id);return product?.slot==='nameplate'?'<img src="'+esc(product.art.src)+'" alt="'+esc(product.name)+'" width="'+product.art.width+'" height="'+product.art.height+'" decoding="async" draggable="false">':'';}
  function premiumLord(){const user=window.SengokuSocial?.getUser?.();return user&&!user.isBanned?`<span class="town-lord-identity"><span class="town-lord-label">${window.SengokuResidency?.self?.()?.role==='retainer'?'家臣':'領主'}</span>${window.SengokuAvatar?.markup?.(user,'inline')||''}${window.SengokuCityHonors?.slot?.(user.id)||''}<span class="player-evaluation-name" data-premium-player="${esc(user.id)}" data-premium-player-name="${esc(user.name)}">${window.SengokuPremiumRuntime?.nameMarkup?.(user.name,window.SengokuPremiumRuntime.getAppearance())||esc(user.name)}</span>${window.SengokuEvaluationUI?.badge?.(user.evaluation)||''}${window.SengokuPublicCourt?.selfSlot?.(user.id)||''}</span>`:'<span class="town-lord-label">あなたの一城を彩る</span>';}
  function refreshPremiumAppearance(){
    if(window.SENGOKU_AT_TITLE!==true){
      const src=premiumTownImage();for(const img of document.querySelectorAll('.town-scene-image,.town-scene-backdrop'))if(img.getAttribute('src')!==src){img.setAttribute('srcset',townSceneSources(src));img.src=src;if(img.classList.contains('town-scene-image'))img.alt=premiumTownDescription();}
      const banner=$('[data-town-premium-banner]');if(banner){const html=premiumTownBanner();patchHTML(banner,html);}
      const lord=$('[data-town-premium-lord]');if(lord){const html=premiumLord();patchHTML(lord,html);}
    }
    const user=window.SengokuSocial?.getUser?.(),appearance=window.SengokuPremiumRuntime?.getAppearance?.();
    if(user)for(const node of document.querySelectorAll('[data-premium-player]'))if(node.dataset.premiumPlayer===String(user.id))patchHTML(node,window.SengokuPremiumRuntime?.nameMarkup?.(node.dataset.premiumPlayerName,appearance)||esc(node.dataset.premiumPlayerName));
  }
  function townPanelAttributes(id){return `role="tabpanel" aria-labelledby="${id}-tab" tabindex="0"${townSection===id?'':' hidden inert'}`;}
  function townTabMarkup(){return townSections.map((id,index)=>`<button type="button" id="${id}-tab" role="tab" data-action="town-section" data-id="${id}" aria-controls="${id}" aria-selected="${townSection===id}" tabindex="${townSection===id?'0':'-1'}">${icon(index===2?'scroll':'castle')}${['本拠','施設','報告'][index]}</button>`).join('');}
  function syncTownSections(){
    const pane=$('#town-console');if(!pane)return;
    for(const id of townSections){
      const panel=$('#'+id),tab=$('#'+id+'-tab'),selected=townSection===id;
      if(panel){if(selected){panel.removeAttribute('hidden');panel.removeAttribute('inert');}else{panel.setAttribute('hidden','');panel.setAttribute('inert','');}}
      if(tab){tab.setAttribute('aria-selected',String(selected));tab.setAttribute('tabindex',selected?'0':'-1');}
    }
  }
  function jumpTownSection(id,{focus=false,scroll=true}={}){
    if(currentView!=='town'||!townSections.includes(id))return;
    const pane=$('#town-console'),target=$('#'+id);if(!pane||!target||!pane.contains(target))return;
    const previous=$('#'+townSection),restoreFocus=Boolean(previous&&previous.contains(document.activeElement));
    townSection=id;syncTownSections();interactionEpoch++;
    if(focus||restoreFocus)$('#'+id+'-tab')?.focus({preventScroll:true});
    refreshLiveControls({refreshHints:false});refreshJobTimers();window.SengokuDesktopFit?.refresh();window.SengokuTownFit?.refresh();
    if(!scroll)return;
    const nav=pane.querySelector('.town-console-nav');if(!nav)return;
    if(document.documentElement.classList.contains('sengoku-desktop-fit')){pane.scrollTo({top:0,left:pane.scrollLeft,behavior:'instant'});return;}
    let scroller=pane.parentElement;
    while(scroller&&scroller!==document.scrollingElement){
      const style=window.getComputedStyle(scroller);
      if(scroller.scrollHeight>scroller.clientHeight+1&&/auto|scroll/.test(style.overflowY))break;
      scroller=scroller.parentElement;
    }
    scroller=scroller||document.scrollingElement;if(!scroller)return;
    const overlay=scroller===document.scrollingElement?[$('.topbar'),$('#announcement-bar')].filter(node=>node&&/sticky|fixed/.test(window.getComputedStyle(node).position)).reduce((height,node)=>height+node.getBoundingClientRect().height,0):0;
    const origin=scroller===document.scrollingElement?0:scroller.getBoundingClientRect().top;
    const top=Math.max(0,scroller.scrollTop+nav.getBoundingClientRect().top-origin-overlay-12);
    scroller.scrollTo({top,left:scroller.scrollLeft,behavior:'instant'});
  }
  function townSectionKeydown(event){
    if(event.defaultPrevented||event.isComposing||event.altKey||event.ctrlKey||event.metaKey)return;
    const tab=event.target.closest?.('.town-console-nav [role="tab"]');if(!tab)return;
    const index=townSections.indexOf(tab.dataset.id);if(index<0)return;
    const destination=event.key==='ArrowRight'?townSections[(index+1)%townSections.length]:event.key==='ArrowLeft'?townSections[(index+townSections.length-1)%townSections.length]:event.key==='Home'?townSections[0]:event.key==='End'?townSections.at(-1):null;
    if(!destination)return;event.preventDefault();jumpTownSection(destination,{focus:true,scroll:false});
  }
  function renderTown(){const s=state(),home=game.castle(s.home),army=game.officer(s.army[0]),unclaimed=data.quests.find(q=>{const status=game.questStatus(q.id);return status.complete&&!status.claimed;})||data.quests.find(q=>!s.claimedQuests.includes(q.id))||data.quests.at(-1),qs=game.questStatus(unclaimed.id);const points={keep:[39,27],farm:[24,76],market:[51,62],lumber:[87,41],quarry:[86,79],barracks:[17,44],wall:[68,43],academy:[57,27]};
    const expanded=settings.townFacilitiesExpanded===true,legendExpanded=settings.townLegendExpanded===true,collapsedCount=Math.min(8,data.buildings.length),visibleBuildings=expanded?data.buildings:data.buildings.slice(0,collapsedCount);
    const legendBuildings=legendExpanded?data.buildings:data.buildings.slice(0,collapsedCount);
    const facilityToggle=(position,legend=false)=>{
      const open=legend?legendExpanded:expanded,prefix=legend?'town-legend':'town-facilities';
      return data.buildings.length>collapsedCount?`<button type="button" id="${prefix}-toggle${position==='bottom'?'-bottom':''}" class="button gold full town-facilities-toggle" data-action="${legend?'toggle-town-legend':'toggle-town-facilities'}" aria-expanded="${open}" aria-controls="${legend?'town-legend-grid':'town-buildings-grid'}"${position==='bottom'&&!open?' hidden':''}>${icon(open?'minus':'plus')}<span>${open?`折りたたむ（${collapsedCount}施設表示）`:`すべて表示（全${data.buildings.length}施設）`}</span></button>`:'';
    };
    return `<div class="dashboard-grid town-workspace"><div class="left-column town-visual"><section class="town-panel" aria-label="城下町の施設。施設名を押すと増築できます"><div class="town-scene-heading"><div class="scene-label"><i></i><strong class="town-scene-name">${esc(home.name)}</strong><span>${game.isStaff?'共同拠点':'城下町'}</span></div><div class="scene-topright"><button class="icon-button" data-action="help" aria-label="遊び方">${icon('help')}</button><button class="icon-button" data-action="fullscreen" aria-label="全画面表示">${icon('expand')}</button></div></div><div class="town-scene"><img class="town-scene-backdrop" src="${premiumTownImage()}" srcset="${townSceneSources(premiumTownImage())}" sizes="(max-width: 760px) 96vw, (max-width: 1050px) 80vw, 55vw" alt="" aria-hidden="true" width="1536" height="1024" decoding="async" draggable="false"><div class="town-scene-board"><img class="town-scene-image" src="${premiumTownImage()}" srcset="${townSceneSources(premiumTownImage())}" sizes="(max-width: 760px) 96vw, (max-width: 1050px) 80vw, 55vw" alt="${esc(premiumTownDescription())}" width="1536" height="1024" decoding="async" draggable="false"><span class="town-premium-banner" data-town-premium-banner>${premiumTownBanner()}</span>${data.buildings.slice(0,8).map(b=>`<button class="hotspot ${currentJob('building',b.id)?'has-job':''}" style="--town-marker-x:${points[b.id][0]}%;--town-marker-y:${points[b.id][1]}%" data-town-x="${points[b.id][0]}" data-town-y="${points[b.id][1]}" data-action="building" data-id="${b.id}" aria-label="${esc(b.name)} レベル${s.buildings[b.id]}の詳細"><span class="pin">${icon(b.icon)}<span class="town-pin-name" aria-hidden="true">${esc(b.name)}</span></span><span class="label">${esc(b.name)}<i>Lv.${s.buildings[b.id]}</i></span></button>`).join('')}</div><div class="town-scene-fallback" role="group" aria-label="城下町の主要施設">${data.buildings.slice(0,8).map(b=>`<button type="button" class="town-facility-button" data-action="building" data-id="${b.id}">${icon(b.icon)}<span>${esc(b.name)}</span><small>Lv.${s.buildings[b.id]||0}</small></button>`).join('')}</div></div><nav class="town-command-shortcuts" aria-label="城下町からの指令"><button type="button" data-view="facilities">${icon('castle')}<span>施設管理</span></button><button type="button" data-view="army">${icon('users')}<span>軍団編成</span></button><button type="button" data-view="map">${icon('flag')}<span>天下地図</span></button><button type="button" data-action="progress">${icon('book')}<span>任務</span></button></nav><div class="town-scene-legend" role="group" aria-label="城下町の施設一覧"><div class="town-facility-controls"><small id="town-legend-count" class="town-facility-count" role="status" aria-live="polite">${legendBuildings.length} / ${data.buildings.length}施設を表示中</small>${facilityToggle('top',true)}</div><div class="town-legend-grid" id="town-legend-grid">${legendBuildings.map(b=>`<button class="town-facility-button" data-action="building" data-id="${b.id}">${icon(b.icon)}<span>${esc(b.name)}</span><small>Lv.${s.buildings[b.id]||0}</small></button>`).join('')}</div>${facilityToggle('bottom',true)}</div><div class="town-premium-lord"><span data-town-premium-lord>${premiumLord()}</span><button type="button" class="text-link" data-action="premium">外観を変更</button></div><div class="scene-caption"><div><strong>${game.isStaff?'京都御所 · 共同の城下':esc(s.clan)+'の城下'}</strong><small>${game.isStaff?'共同普請が、この城下町を育てます。':'人を集め、地を耕し、次の一手を。'}</small></div><span class="weather">${icon('sun')} ${date().season}の風</span></div></section></div><aside class="right-column town-console" id="town-console"><nav class="town-console-nav" role="tablist" aria-label="城下町の操作場所">${townTabMarkup()}</nav><div class="town-overview" id="town-overview" ${townPanelAttributes('town-overview')}>${heading(esc(home.name),'YOUR DOMAIN · 城下町',`${esc(home.province)}国 · ${game.isStaff?'共同拠点':esc(s.clan)+'の本拠'} · 城郭 Lv.${home.level} / ${castleLevelLimit(home.id)}`,home.id)}${window.SengokuCommandCenter?.markup?.(game,{quests:data.quests,marches:window.SengokuTravelUI?.snapshot?.()?.active||[],icon})||''}${durabilityMarkup(home,'castle',{label:'本拠の耐久'})}${window.SengokuResidency?.compact?.()||''}<div class="expansion-entry"><button class="button gold" data-action="tutorial">${icon('flag')}初陣ガイド</button><button class="button" data-action="progress">${icon('book')}今日の任務</button><button class="button" data-action="progress" data-tab="recap">留守中の報告</button></div><section class="hint-entry" data-hint-entry aria-label="次の一手のヒント"><div class="hint-entry-copy"><span class="eyebrow">次の一手</span><strong data-hint-title>今の状況から、おすすめを確認</strong><p data-hint-reason>城・資産・兵力に合わせて、次にできることをご案内します。</p></div><button type="button" class="button gold" data-action="hints">${icon('help')}ヒントを見る</button></section><button type="button" class="button level-guide-entry full" data-action="level-guide" data-id="${s.home}">${icon('book')}レベル上げガイド</button></div><div class="town-facility-console" id="town-facilities-section" ${townPanelAttributes('town-facilities-section')}><div class="section-heading"><h2>${icon('castle')}施設の発展</h2><button class="text-link" data-view="facilities">全${data.buildings.length}施設を管理</button></div>${governorAssignmentEntry()}<div class="town-facility-controls"><small id="town-facility-count" class="town-facility-count" role="status" aria-live="polite">${visibleBuildings.length} / ${data.buildings.length}施設を表示中</small>${facilityToggle('top')}</div><div class="buildings-grid" id="town-buildings-grid">${visibleBuildings.map(buildingCard).join('')}</div>${facilityToggle('bottom')}${settings.tips?`<div class="tip-bar">${icon('help')}<span>田畑・商家を育てて国力を蓄えましょう。資源と普請は実時間で進み、指令は1倍速で20秒ごとに回復します。</span><button data-action="dismiss-tip" aria-label="ヒントを閉じる">${icon('close')}</button></div>`:''}</div><div class="town-status-panels" id="town-reports-section" ${townPanelAttributes('town-reports-section')}>${walkingEntry()}${staffBaseNotice()}<section class="panel objective"><div class="eyebrow">NEXT OBJECTIVE</div><h3>${esc(unclaimed.name)}</h3><p>${esc(unclaimed.description)}</p><div class="progress-meta"><span>達成状況</span><span>${qs.progress} / ${qs.target}</span></div><div class="progress"><i style="width:${Math.min(100,qs.progress/qs.target*100)}%"></i></div><button class="button ${qs.complete&&!qs.claimed?'gold':'ghost'} full" data-action="${qs.complete&&!qs.claimed?'claim-quest':'council'}" ${qs.complete&&!qs.claimed?`data-id="${unclaimed.id}"`:''}>${qs.complete&&!qs.claimed?'達成報酬を受け取る':'任務を確認'}</button></section><section class="panel"><div class="panel-heading"><h2>領国の状況</h2>${icon('flag')}</div><div class="stat-row"><span>${icon('castle')}領有拠点</span><b>${game.ownedCastles().length}<small> / ${game.unificationTarget()} 城</small></b></div><div class="stat-row"><span>${icon('users')}所持武将</span><b>${s.officers.length}<small> 名</small></b></div><div class="stat-row"><span>${icon('swords')}兵数</span><b>${num(s.troops)}<small> 人</small></b></div><div class="stat-row"><span>${icon('flag')}士気</span><b>${s.morale}<small> / 100</small></b></div><div class="army-summary">${officerCrest(army)}<div><strong>${army?esc(army.name):'総大将未任命'}</strong><small>${army?esc(army.rank)+' · ':''}出陣軍団 · ${s.army.length}名</small></div><button class="icon-button" data-view="army" aria-label="軍団を編成">${icon('chevron')}</button></div></section><section class="panel"><div class="panel-heading"><h2>${constructionJobs().length?'進行中の普請・研究':'城下の便り'}</h2><small>${constructionJobs().length?'あと少し':'RECENT'}</small></div>${constructionJobs().length?jobsHtml():logItems(3)}</section></div></aside></div>`;
  }
  function sharedJobAttribution(job){if(!job?.shared)return '';const raw=job.startedBy||{},user={...raw,id:/^u_[A-Za-z0-9_]{1,96}$/.test(String(raw.id||''))?String(raw.id):''},name=window.SengokuPremiumRuntime?.nameMarkup?.(user.name||'領主',user.appearance)||esc(user.name||'領主'),badge=window.SengokuEvaluationUI?.badge(user.evaluation)||'',photo=user.id?window.SengokuAvatar?.markup?.(user,'inline')||'':'';return `<small class="staff-base-job-owner">共同普請 · <span class="player-evaluation-person">${photo}<span class="player-evaluation-name" data-premium-player="${esc(user.id||'')}" data-premium-player-name="${esc(user.name||'領主')}">${name}</span>${badge}${window.SengokuPublicCourt?.slot?.(user.id)||''}</span>が${job.queued?'予約':'着手'}</small>`;}
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
  function buildingAvailability(id,{cost,chain,usedSlots,writable=canMutate()}={}){
    const s=state(),building=data.buildings.find(row=>row.id===id);
    if(!building)return{ok:false,state:'waiting',reason:'施設が見つかりません。'};
    if(game.isStaff&&!staffConstructionReady())return{ok:false,state:'waiting',reason:''};
    const queue=chain||buildingChain(id),level=s.buildings[id]||0,tail=Math.max(level,...queue.map(job=>job.targetLevel)),maximum=game.buildingMax(id);
    if(tail>=maximum)return{ok:false,state:'complete',reason:queue.length?`Lv.${maximum}まで予約済みです。完成をお待ちください。`:'最高レベルに達しています。'};
    if(s.gameOver)return{ok:false,state:'waiting',reason:'本拠を失いました。新しい物語を始めると普請できます。'};
    const unlock=game.buildingUnlock(id);
    if(!unlock.ok)return{ok:false,state:'locked',reason:unlock.reason||`天守をLv.${unlock.requiredLevel}以上にすると建設・増築できます。`};
    if(!saveEnabled)return{ok:false,state:'waiting',reason:'現在の進行を保存できる状態にしてから普請できます。'};
    if(!writable&&!window.SengokuSyncNotices?.isTransientStatus?.(syncAccess))return{ok:false,state:'waiting',reason:'この端末で最新の進行を確認してから普請できます。'};
    if(s.command<1)return{ok:false,state:'command',reason:'指令が1回必要です。1倍速では20秒ごとに1回復します。'};
    const occupied=usedSlots??constructionCount(Boolean(game.isStaff)),slots=game.constructionSlots();
    if(!queue.length&&occupied>=slots)return{ok:false,state:'slots',reason:`普請枠は${occupied} / ${slots}件を使用中です。施設・城郭・支拠点のいずれかの完成をお待ちください。`};
    const price=cost||game.costs(id),missing=Object.keys(resNames).filter(key=>s.resources[key]<(price?.[key]||0));
    if(missing.length)return{ok:false,state:'resources',reason:`${missing.map(key=>resNames[key]).join('・')}が不足しています。上の費用欄で不足量を確認できます。`};
    return{ok:writable,state:'available',reason:queue.length?'指令1回と表示の資源を支払い、前の工事に続く1段階を予約します。追加の普請枠は使いません。':'指令1回と表示の資源を支払い、普請1枠を使って建設・増築します。'};
  }
  function buildingModal(id){
    const b=data.buildings.find(b=>b.id===id);if(!b)return;
    const s=state(),lv=s.buildings[id]||0,chain=buildingChain(id),tail=Math.max(lv,...chain.map(job=>job.targetLevel)),max=game.buildingMax(id),cost=game.costs(id),governor=game.officer(s.governors[id]),canGov=lv>0,canQueue=tail<max,availability=buildingAvailability(id,{cost,chain});
    modal(`${b.name}　${lv?`Lv.${lv} / ${max}`:'未建設'}`,game.isStaff?'共同普請 · 京都御所':'城下町の発展',`${window.SengokuArt?.facility(id,'facility-modal-art',lv||1)||''}${game.isStaff?'<p class="notice staff-base-note">共同の城下町で成長を共有します。予約した領主が自分の資源と指令1回を支払います。奉行はあなた個人の任命です。</p>':''}${id==='keep'?`<button type="button" class="button small full level-guide-entry" data-action="level-guide" data-id="${s.home}">${icon('book')}レベル上げガイド</button>`:''}<p>${esc(b.description)}</p><div class="stat-row"><span>現在の効果 · Lv.${lv}</span><b>${buildingOutput(id)}</b></div>${facilityMaintenanceHtml(id,lv,canQueue?tail+1:null)}<button class="button small full" style="margin:13px 0" data-action="preview-art" data-kind="facility" data-id="${id}">${icon('eye')}32段階の姿を見る</button>${buildingQueueHtml(id)}${canQueue?`<h3>${chain.length?`次の増築を予約 · Lv.${tail+1}へ`:lv?`Lv.${lv+1}へ増築`:'Lv.1を建設'}</h3><p>1回の操作で1段階を手配し、その資源と指令1回を今支払います。同じ施設の予約はまとめて普請1枠を使います（同時${game.constructionSlots()}枠）。</p>${costHtml(cost)}<div class="facility-order-status" data-building-availability="${id}" data-building-state="${availability.state}"${availability.reason?'':' hidden'}><p id="building-order-reason-${id}" data-building-order-reason aria-live="polite">${esc(availability.reason)}</p><button type="button" class="button small" data-building-next-step="slots" data-action="command-activity" data-filter="construction"${availability.state==='slots'?'':' hidden'}>${icon('calendar')}普請の完成予定を見る</button><button type="button" class="button small" data-building-next-step="locked" data-action="building" data-id="keep"${availability.state==='locked'&&id!=='keep'?'':' hidden'}>${icon('castle')}天守を確認・増築</button></div><button type="button" class="button small" data-action="resource-planner" data-kind="building" data-id="${esc(id)}">${icon('coins')}資源が揃う目安</button><p class="subtitle">施設の効果と表示レベルは、各段階の完成時に上がります。予約の取り消しはできません。</p>`:`<div class="notice">${chain.length?`Lv.${max}まで予約済みです。完成をお待ちください。`:'最高レベルに達しています。'}</div>`}${canGov?`<hr class="divider"><div class="stat-row"><span>奉行</span><b>${governor?esc(governor.name):'未任命'}</b></div><p>${esc(game.governorDescription?.(id)||governorHelp[id]||b.description)}軍団との兼任はできません。任命時の指令・金銭は不要です。任命中は金銭${num(data.maintenance.governorMonthlyGold)}／月を在任時間に応じて支払います。</p><button class="button small gold" style="margin-top:14px" data-action="pick-governor" data-id="${id}">${icon('users')}奉行を選ぶ</button>`:''}`,`<button class="button" data-action="close">閉じる</button>${canQueue?`<button class="button primary" data-action="upgrade" data-id="${id}" aria-describedby="building-order-reason-${id}" ${availability.ok?'':'disabled'}>${icon('castle')}${chain.length?'次の増築を予約':game.isStaff?'共同普請する':lv?'増築する':'建設する'}</button>`:''}`,'building',{id});
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
    if(marker.branch)return{title:marker.name,description:`Lv.${marker.level} · ${marker.fallen?'陥落':marker.building?'普請中':'防衛中'}`,detail:[window.SengokuDurabilityUI?.summary(game.branch?.(marker.id)?.durability),'本城の方位を示す配置です。史実の所在地・距離ではありません。'].filter(Boolean).join(' · ')};
    const level=window.SengokuArt?.tileInfo?.('castle',marker.id,marker.level)?.level||Number(marker.level)||1;
    const location=Number.isFinite(marker.lat)&&Number.isFinite(marker.lon)?`${marker.lat.toFixed(4)}°N ${marker.lon.toFixed(4)}°E`:'';
    return{title:marker.name,description:[marker.owner,`城郭 Lv.${level}`,marker.home?'本拠':'',marker.restrictedLabel||(marker.disabled?'専用拠点':''),marker.reachable?'進軍可能':''].filter(Boolean).join(' · '),detail:[`${Number(marker.troops||0).toLocaleString('ja-JP')}兵`,window.SengokuDurabilityUI?.summary(game.castle(marker.id)?.durability),location].filter(Boolean).join(' · ')};
  }
  function syncWorldMap(){const container=$('#world-map');if(currentView!=='map'||!container){worldMapController?.destroy();worldMapController=null;worldMapElement=null;return;}if(!window.SengokuWorldMap){container.innerHTML='<p class="notice">地図を読み込めませんでした。再読み込みしてください。</p>';return;}if(window.SengokuWorldMap.prepareGeography?.(container,syncWorldMap)===false)return;const s=state(),reachable=new Set(game.adjacentTargets().map(c=>c.id)),options={stateKey:'campaign-map',castles:data.castles.map(c=>({...c,...s.castles[c.id],reachable:reachable.has(c.id)})),selectedId:selectedCastle,region:mapRegion,clan:s.clan,isAdmin:game.isAdmin,isStaff:game.isStaff,homeId:s.home,treaties:s.treaties,turn:s.turn,markerSize:56,branches:window.SengokuBranches?.mapBranches?.(game)||[],onBranchSelect:(parentId,branchId)=>{selectedCastle=parentId;const parent=game.castle(parentId),branch=state().branches?.find(row=>row.id===branchId);if(parent?.owner===state().clan||!branch?.level||branch.fallen)castleUpgradeModal(parentId);else battleModal(parentId,false,branchId);},markerAppearance:campaignCastleAppearance,cacheMarkerPresentation:true,markerTooltip:campaignCastleTooltip,crestFor:name=>window.SengokuKamon?.url(name),onSelect:id=>{if(id==='edo'&&!game.isAdmin||id===staffBaseId&&!game.isStaff)return;selectedCastle=id;preserveInteraction($('#main'),render);}};if(worldMapController&&worldMapElement===container)worldMapController.update(options);else{worldMapController?.destroy();worldMapElement=container;worldMapController=window.SengokuWorldMap.mount(container,options);}}
  function renderMap(){if(!selectedCastle||selectedCastle==='edo'&&!game.isAdmin)selectedCastle=game.adjacentTargets().sort((a,b)=>a.troops-b.troops)[0]?.id||state().home;const owned=game.ownedCastles(),reachable=new Set(game.adjacentTargets().map(c=>c.id));return heading('天下地図','JAPAN · 山河を越えて、天下へ','日本列島の地形と城跡の位置をたどり、領国を広げる。城の姿とLv.は城郭レベルに連動します。')+`<div class="toolbar map-toolbar"><div class="search-box">${icon('search')}<input id="castle-search" class="input" type="search" value="${esc(mapQuery)}" placeholder="城名・勢力・国名で探す" aria-label="城を検索"></div><select id="map-region" class="select" aria-label="地図の地方"><option value="all">全国${data.castles.length}城</option>${[...new Set(data.castles.map(c=>c.region))].map(r=>`<option ${mapRegion===r?'selected':''}>${r}</option>`).join('')}</select><button class="button small strategy-map-open" data-action="strategy">${icon('book')}軍師AI<span data-strategy-status>${strategyRun?.active?'実行中':'作戦を考える'}</span></button><button class="button small" data-action="strategy-stop" data-strategy-stop ${strategyRun?.active?'':'hidden'}>自動進軍を停止</button><button class="button small" data-view="covert">${icon('eye')}派遣部隊</button><button class="button small" data-view="court">${icon('scroll')}京都御所</button><button class="button small" data-action="map-home">${icon('castle')}本拠へ</button><button class="button small" data-action="map-fit">${icon('expand')}列島全景</button></div><div class="world-layout world-layout-real"><section class="geographic-map-panel" aria-label="日本列島の地理に基づく天下地図"><div id="world-map" class="geographic-map-host"></div></section><aside id="castle-detail" class="panel castle-detail">${castleDetail(selectedCastle)}</aside></div><div class="section-heading"><h2>${icon('flag')}拠点一覧</h2><small>自領 ${owned.length}城 · 隣接する敵城 ${reachable.size}城</small></div><div id="territory-results">${territoryResults()}</div><p class="notice map-data-note">海岸線は現代の地理データ、城は城跡・施設の代表地点に基づきます。戦国期の海岸線や国境を測量復元したものではありません。勢力配置・進軍経路はゲーム設定です。江戸城は保護された拠点です。</p>`;}
  function territoryResults(){
    const reachable=new Set(game.adjacentTargets().map(c=>c.id)),s=state(),filtered=mapRegion!=='all'||mapQuery||territoryState!=='all';
    const list=data.castles.map(c=>game.castle(c.id)).filter(c=>c&&(mapRegion==='all'||c.region===mapRegion)&&catalogMatches([c.name,c.owner,c.province,c.region].join(' '),mapQuery)&&(territoryState==='all'||territoryState==='own'&&c.owner===s.clan||territoryState==='reachable'&&reachable.has(c.id)||territoryState==='damaged'&&c.owner===s.clan&&c.durability?.max>0&&c.durability.current<c.durability.max)).sort((a,b)=>Number(reachable.has(b.id))-Number(reachable.has(a.id))||Number(b.owner===s.clan)-Number(a.owner===s.clan)),pages=Math.max(1,Math.ceil(list.length/4));territoryPage=Math.max(1,Math.min(territoryPage,pages));return `${catalogChips('territory',territoryState,[['all','すべて'],['own','自領'],['reachable','進軍候補'],['damaged','自領の修復中']])}<div class="catalog-result-summary"><p role="status"><strong>${list.length}</strong> / ${data.castles.length}城</p><button type="button" class="text-link" data-action="catalog-reset" data-kind="territory"${filtered?'':' disabled'}>条件をリセット</button></div><div class="territory-list all-territories">${list.slice((territoryPage-1)*4,territoryPage*4).map(c=>`<button class="territory-row ${selectedCastle===c.id?'active':''}" data-action="select-castle" data-id="${c.id}" ${c.id==='edo'&&!game.isAdmin?'disabled title="選択不可"':c.id===staffBaseId&&!game.isStaff?'disabled title="選択不可"':''}>${window.SengokuArt?.castle(c.id,'territory-art',c.level)||''}<div class="territory-name">${clanCrest(c.owner,23)}${esc(c.name)}<br><small>${esc(c.owner)} · ${esc(c.province)}</small></div><div class="territory-numbers"><small>${num(c.troops)}兵</small>${durabilityMarkup(c,'castle',{compact:true})}<span class="territory-label ${c.owner===s.clan?'own':reachable.has(c.id)?'reachable':''}">${c.id==='edo'&&!game.isAdmin?'選択不可':c.id===staffBaseId&&!game.isStaff?'選択不可':c.owner===s.clan?'自領':reachable.has(c.id)?'隣接':'遠方'}</span></div></button>`).join('')||'<div class="empty catalog-empty"><p>条件に合う拠点はありません。</p><button type="button" class="button" data-action="catalog-reset" data-kind="territory">すべての拠点を表示</button></div>'}</div>${pageControls('territory-page',territoryPage,pages,`${list.length}城`)}`;
  }

  function branchDeploymentHelpers(surface='map'){
    return{surface,writable:canMutate()&&saveEnabled&&!branchBookingPending,writableReason:branchBookingPending?'拠点の操作を確認しています。':!saveEnabled?'保存状態を確認してから兵と武将を配置してください。':syncMessage()};
  }
  function refreshBranchDeploymentPanels(){
    const ui=window.SengokuBranches;if(!ui||!game?.state)return;
    for(const host of document.querySelectorAll('[data-branch-troop-panel],[data-branch-commander-panel]')){
      const troop=host.hasAttribute('data-branch-troop-panel'),id=troop?host.dataset.branchTroopPanel:host.dataset.branchCommanderPanel,surface=troop?host.dataset.branchTroopSurface:host.dataset.branchCommanderSurface;
      const html=troop?ui.renderTroopTransfer?.(game,id,branchDeploymentHelpers(surface)):ui.renderCommanders?.(game,game.branch?.(id)||(state().branches||[]).find(row=>row.id===id),branchDeploymentHelpers(surface));
      const template=document.createElement('template');template.innerHTML=html||'';const next=template.content.firstElementChild;
      host.hidden=!next;patchHTML(host,next?.innerHTML||'');
      if(troop){const draft=ui.troopTransferSelection?.(game,id);for(const node of host.querySelectorAll('[data-branch-troop-field]')){const value=draft?.[node.dataset.branchTroopField];if(value!==undefined&&node.value!==value)node.value=value;}}
      else{const node=host.querySelector('[data-branch-commander-choice]'),value=ui.commanderSelection?.(game,id)||'';if(node&&node.value!==value)node.value=value;window.SengokuOfficerHealthUI?.refresh(host,game);}
    }
    for(const host of document.querySelectorAll('[data-branch-auto-panel]')){
      const html=ui.renderAutoCommanders?.(game,host.dataset.branchAutoPanel,branchDeploymentHelpers(host.dataset.branchAutoSurface));
      const template=document.createElement('template');template.innerHTML=html||'';patchHTML(host,template.content.firstElementChild?.innerHTML||'');
    }
  }
  function updateBranchTroopDraft(node){
    if(!node?.dataset?.branchTroopField)return false;
    const changed=window.SengokuBranches?.setTroopTransferSelection?.(game,node.dataset.branchTroopParent,{[node.dataset.branchTroopField]:node.value});
    if(changed)refreshBranchDeploymentPanels();return true;
  }
  async function submitBranchTroops(form){
    if(branchBookingPending||!requireWritable())return;
    const parentId=form.dataset.branchTroopParent,ui=window.SengokuBranches,draft={};
    for(const node of form.querySelectorAll('[data-branch-troop-field]'))draft[node.dataset.branchTroopField]=node.value;
    if(!ui?.setTroopTransferSelection?.(game,parentId,draft))return;
    const quote=ui.troopTransferQuote(game,parentId),reason=ui.troopTransferReason(game,parentId,branchDeploymentHelpers(),quote);
    if(reason||!quote?.ok){toast(reason||'移動する兵と拠点を確認してください。',true);refreshBranchDeploymentPanels();return;}
    branchBookingPending=true;refreshLiveControls();
    try{
      const result=await requestBranches('/branches/transfer-troops',{method:'POST',data:{from:draft.from,to:draft.to,troops:quote.troops}});
      if(!result?.ok)throw Error(result?.message||'兵の移動を確定できませんでした。');
      preserveInteraction($('#main'),render);refreshActiveModal();toast(result.result?.message||result.message||'兵を移動し、配置を保存しました。');
    }catch(error){toast(error.message||'兵の移動結果を確認してください。',true);}
    finally{branchBookingPending=false;refreshLiveControls();}
  }
  function durabilityMarkup(record,kind='castle',options={}){return window.SengokuDurabilityUI?.markup(record?.durability,{kind,id:record?.id,live:true,...options})||'';}
  function durabilityHelp(){return window.SengokuDurabilityUI?`<details class="durability-help"><summary>耐久の減少・修復について</summary><p>${esc(window.SengokuDurabilityUI.explanation())}</p></details>`:'';}
  function castleDetail(id,surface='map'){
    const c=game.castle(id);if(!c)return '';
    const s=state(),allowed=game.canOwnCastle?.(id)!==false,own=c.owner===s.clan&&allowed,shared=game.isStaff&&id===staffBaseId,adj=game.adjacentTargets().some(t=>t.id===id),ally=(s.treaties[c.owner]||0)>s.turn,scouted=(s.scouted[id]||0)>s.turn,job=currentJob('castle',id),benefit=game.castleBenefits(id),cost=game.castleUpgradeCost(id),limit=castleLevelLimit(id),branchesBlock=game.parentAttackPermission?.(id)?.ok===false;
    return `<div class="castle-banner">${window.SengokuArt?.castle(id,'castle-detail-art',c.level)||''}${icon('castle')}</div><div class="castle-info"><div class="eyebrow">${esc(c.region)} · ${esc(c.province)}国</div><h2>${esc(c.name)}</h2>${c.majorCity?`<span class="major-city-badge">${icon('castle')}大都市拠点${id==='edo'?' · 保護された拠点':id===staffBaseId?' · 共同拠点・占領不可':''}</span>`:''}<span class="castle-status ${own?'':'enemy'}">${clanCrest(c.owner,25)}${own?'自領':ally?'同盟勢力':'他勢力'} · ${esc(c.owner)}</span>${durabilityMarkup(c)}${durabilityHelp()}<div class="stat-row"><span>城郭レベル</span><b>Lv.${c.level} / ${limit}</b></div><div class="stat-row"><span>守備兵</span><b>${num(c.troops)} 人</b></div><div class="stat-row"><span>城壁</span><b>Lv.${c.wall}</b></div><div class="stat-row"><span>街道</span><b>${c.neighbors.length} 城に接続</b></div>${scouted?'<div class="stat-row"><span>偵察効果</span><b>攻撃力 +10%</b></div>':''}</div><button type="button" class="button small full level-guide-entry" data-action="level-guide" data-id="${id}">${icon('book')}レベル上げガイド</button><button class="button small full" data-action="preview-art" data-kind="castle" data-id="${id}">${icon('eye')}32段階の城郭を見る</button>${c.level>32?'<p class="subtitle">城郭は最終形態の姿で、さらに強化されています。</p>':''}${own?`<div class="castle-expansion"><h3>${icon('castle')}${shared?'京都御所の共同普請':'城郭の拡張'}</h3>${shared?'<p class="notice staff-base-note">城郭の成長は共同です。普請を指示するあなたが資源と指令1回を支払います。</p>':''}<p>城郭による防衛補正 +${benefit.defensePercent}%<br>領地の基礎収入：金銭${num(benefit.gold)}・兵糧${num(benefit.rice)} /月</p>${job?`<div class="notice">Lv.${job.targetLevel}へ${shared?'共同普請':'拡張'}中 · <span data-job-clock="${jobKey(job)}">${esc(jobClockText(job))}</span>${sharedJobAttribution(job)}</div><div class="progress"><i data-job-progress="${jobKey(job)}" style="width:${game.constructionProgress(job)}%"></i></div>`:c.level>=limit?`<div class="notice">城郭は最高のLv.${limit}です。</div>`:`${costHtml(cost)}<button class="button gold full${shared?' staff-base-upgrade':''}" data-action="upgrade-castle" data-id="${id}" ${shared&&!staffConstructionReady()?'disabled':''}>Lv.${c.level+1}へ${shared?'共同普請する':'拡張する'}</button>`}<small>${shared?'共同の':'個人の'}施設・城郭の普請枠を使用します。城郭レベルは天守などの施設レベルとは別に育ちます。</small></div><div class="notice">${id===s.home?'あなたの本拠です。城下町から施設も増築できます。':'この城を拠点として、さらに隣接する城へ進軍できます。領地収入は時間経過に応じて自動で加算されます。'}</div><button class="button gold full" data-view="town">${icon('castle')}城下町へ</button>`:!allowed?`<div class="notice">${id===staffBaseId?'京都御所は共同で成長する保護された御所です。':'江戸城は保護された本拠です。'}占領はできません。共通フィールドで報酬戦に挑めます。</div>${id===staffBaseId?'<button class="button gold full" data-view="court">京都御所へ出向く</button>':''}`:`<div><button class="button primary full" data-action="prepare-battle" data-id="${id}" ${!adj||ally||s.gameOver||branchesBlock?'disabled':''}>${icon('swords')}${branchesBlock?'支拠点を先に攻略':ally?'同盟期間中':adj?'この城へ出陣':'自領から遠い拠点'}</button><button class="button full" data-action="scout" data-id="${id}" ${!adj||s.command<1||scouted||s.gameOver?'disabled':''}>${icon('eye')}${scouted?'偵察済み':`偵察　金銭${game.scoutCost().gold}`}</button><button class="button ghost full" data-action="diplomacy-info" data-id="${id}" ${ally||s.gameOver?'disabled':''}>${icon('handshake')}${ally?`同盟あと${s.treaties[c.owner]-s.turn}か月`:'この勢力と同盟'}</button></div>`}${window.SengokuBranches?.render?.(game,id,{surface,writable:canMutate()&&saveEnabled&&!branchBookingPending,writableReason:branchBookingPending?'拠点の操作を確認しています。':!saveEnabled?'保存状態を確認してから普請してください。':syncMessage(),costHtml,jobKey,jobClockText})||''}`;
  }

  function levelGuideCastle(id){const s=state(),chosen=game.castle(id);return chosen&&chosen.owner===s.clan&&game.canOwnCastle?.(chosen.id)!==false?chosen:game.castle(s.home);}
  function defenseLedgerContext(){
    const access=getExpansionAccess();
    return {...access,roleEpoch,banned:syncAccess.banned===true||access.banned===true,rolePending:syncAccess.rolePending===true||access.rolePending===true};
  }
  function openDefenseBase({kind,id,parentCastleId}={}){
    const parent=game.castle(parentCastleId),branch=kind==='branch'?game.branch?.(id):null;
    if(startPending||syncAccess.banned||syncAccess.rolePending||!parent||parent.owner!==state().clan||game.canOwnCastle?.(parentCastleId)===false||
      !['castle','branch'].includes(kind)||kind==='castle'&&id!==parentCastleId||kind==='branch'&&branch?.parentCastleId!==parentCastleId)return false;
    castleUpgradeModal(parentCastleId);
    if(kind==='branch'){
      const card=Array.from($('#modal-content').querySelectorAll('.branch-card')).find(node=>node.getAttribute('data-stable-key')==='branch-'+id);
      const target=card?.querySelector('h4')||card;
      if(target){target.setAttribute('tabindex','-1');target.focus({preventScroll:true});card.scrollIntoView({block:'start',behavior:'instant'});}
    }
    return true;
  }
  function openDefenseLedger(){
    if(startPending){toast('はじめに本拠を選んでください。',true);return false;}
    return window.SengokuDefenseLedger?.open?.({getGame:()=>game,catalog:data,getContext:defenseLedgerContext,
      getClock:confirmedWorldClock,staffReady:staffConstructionReady,
      subscribe:listener=>window.SengokuTravelUI?.subscribe?.(listener),openBase:openDefenseBase})===true;
  }
  function openCommandOperation(target={}){
    if(!target||typeof target.id!=='string'||startPending||syncAccess.banned||syncAccess.rolePending)return false;
    if(target.kind==='building'){
      if(target.shared!==(game.isStaff===true)||!data.buildings.some(item=>item.id===target.id))return false;
      buildingModal(target.id);return true;
    }
    if(target.kind==='research'){
      if(target.shared||!data.techs.some(item=>item.id===target.id))return false;
      go('research');
      const card=Array.from($('#main').querySelectorAll('[data-research-card]')).find(node=>node.dataset.researchCard===target.id);
      const heading=card?.querySelector('h3');
      if(heading){card.setAttribute('data-command-target','');heading.setAttribute('tabindex','-1');heading.focus({preventScroll:true});heading.scrollIntoView({block:'center',behavior:'instant'});}
      return true;
    }
    if(target.kind==='castle'||target.kind==='branch')return openDefenseBase(target);
    return false;
  }
  function castleUpgradeModal(id){
    const c=levelGuideCastle(id);if(!c)return;
    if(game.isStaff&&c.id===staffBaseId){staffBaseModal();return;}
    modal(`${c.name}の城郭`,'現在の城郭と、次の拡張に必要な費用を確認',castleDetail(c.id,'modal'),`<button class="button" data-action="close">閉じる</button>`,'castle-upgrade',{id:c.id});
  }
  function levelGuideModal(id){
    const openSections=activeModal==='level-guide'?[...document.querySelectorAll('#modal-content [data-level-guide-section][open]')].map(node=>node.dataset.levelGuideSection):[];
    const s=state(),c=levelGuideCastle(id);if(!c)return;
    const staff=game.isStaff&&!game.isAdmin,sharedCastle=staff&&c.id===staffBaseId,ready=!staff||staffConstructionReady(),keep=s.buildings.keep,limit=castleLevelLimit(c.id),slots=ready?game.constructionSlots():null;
    const keepLevel=ready?`Lv.${keep} / 32`:'共同拠点を確認中',castleLevel=sharedCastle&&!ready?'共同拠点を確認中':`Lv.${c.level} / ${limit}`;
    const castleAction=c.level<limit?`Lv.${c.level+1}へ${sharedCastle?'共同普請する':'拡張する'}`:`Lv.○へ${sharedCastle?'共同普請する':'拡張する'}`;
    const roleText=staff?'共同拠点では、城郭と城下町の全施設を共有します。着手・予約した人が自分の資源と指令を払い、完成後は共同拠点へ反映されます。京都御所の城郭はLv.128まで成長します。京都御所以外の自領の城郭は個人で拡張します。':game.isAdmin?'あなたの本拠は江戸城です。江戸城の城郭はLv.64まで、天守を含む施設はLv.32まで。通常の資源・指令・工期で育てます。':'一般の領主は、自分が領有する城を拡張できます。最初は通常城から始め、二条・大坂・名古屋は領有後にLv.48まで育てられます。江戸・京都御所は保護された拠点のため、占領や本拠への変更はできません。';
    modal('本拠・城郭のレベル上げ',`${c.name}の城郭と、${staff?'京都御所の共同':'本拠の'}天守を案内`,
      `<div class="level-guide-body"><p class="level-guide-intro"><strong>本拠</strong>は、現在の拠点となる城です。育てる場所は<strong>天守（城下町の施設）</strong>と<strong>城郭（城そのもの）</strong>の2つ。それぞれ別のレベルを持ちます。</p>${staff&&!ready?'<p class="level-guide-pending" role="status">共同拠点の最新情報を確認しています。説明は読めますが、共同普請は確認完了後に行ってください。</p>':''}<div class="level-guide-choices"><section class="level-guide-card"><span class="level-guide-label">施設を解放・普請枠を増やす</span><h3>${icon('castle')}天守を育てる</h3><p class="level-guide-current">${esc(keepLevel)}</p><ol class="level-guide-steps"><li>城下町の<strong>「天守」</strong>を押します。</li><li>費用と工期を確認し、<strong>「${staff?'共同普請する':'増築する'}」</strong>を押します。</li><li>工事が完成するとLv.が1上がります。新しい施設の解放条件も満たせます。</li></ol><button type="button" class="button gold full" data-action="building" data-id="keep">天守を開く${icon('chevron')}</button></section><section class="level-guide-card"><span class="level-guide-label">城の守り・領地収入を高める</span><h3>${icon('shield')}城郭を育てる</h3><p class="level-guide-current">${esc(c.name)} · ${esc(castleLevel)}</p><ol class="level-guide-steps"><li>${sharedCastle?'城下町の<strong>「京都御所の共同普請を開く」</strong>を押します。':'<strong>「天下地図」</strong>で自分の城を選び、<strong>「城郭の拡張」</strong>を開きます。'}</li><li>費用と工期を確認し、<strong>「${esc(castleAction)}」</strong>を押します。</li><li>完成したら次の段階へ。城郭を育てても、天守のLv.は変わりません。</li></ol><button type="button" class="button gold full" data-action="level-guide-castle" data-id="${c.id}">${esc(c.name)}の城郭を開く${icon('chevron')}</button></section></div><section class="level-guide-basics"><h3>着手する前に</h3><ul><li><strong>資源と指令1回</strong>が必要です。金銭・木材・石材の必要量は、各詳細画面に表示されます。</li><li>強化時の資源は<strong>領有1城で1倍、2城で2倍、3城で4倍、4城で8倍、5城以降は16倍</strong>です。支拠点は城数に重複して数えず、施設維持費の単価は変わりません。</li><li>工期は1段階につき<strong>1倍速で60・120・180秒</strong>。天守は120秒、Lv.16以降からの増築は180秒です。完成するまでLv.や効果は変わりません。</li><li>指令は<strong>1倍速で20秒ごとに1回復</strong>します。時間停止中は回復・工事とも進みません。</li><li>施設と城郭は合わせて<strong>${slots?`現在${slots}枠`:'2〜6枠'}</strong>。天守Lv.8・16・24・32で普請枠が1つずつ増えます。研究は別枠です。</li></ul></section><details class="level-guide-details" data-level-guide-section="queue"><summary>工事中に、次のLv.を予約したい</summary><p><strong>施設</strong>は詳細を開いたまま<strong>「次の増築を予約」</strong>で1段階ずつ連続予約できます。予約するたびに、その段階の資源と指令1回を先払いし、前の工事が終わると順番に着工します。同じ施設の予約はまとめて普請1枠です。</p><p>予約はLv.32まで。取り消しはできません。<strong>城郭は連続予約できないため、拡張の完成後に次の段階を選びます。</strong></p></details><details class="level-guide-details" data-level-guide-section="blocked"><summary>ボタンを押せないときは？</summary><p>資源・指令が足りるか、普請枠が空いているか、上限に達していないかを確認してください。城郭は同じ城の工事中に重ねて着工できません。未解放の施設は、詳細に表示された天守Lv.が必要です。</p><p>端末同期・共通時刻の反映中や、別端末が操作中のときも強化を待ちます。共同普請は、最新の共同拠点情報と、共通時間が進行中であることを確認してから行います。</p></details><details class="level-guide-details" data-level-guide-section="limits"><summary>レベルの上限・拠点ごとの違い</summary><dl class="level-guide-limits"><div><dt>天守・全64施設</dt><dd>Lv.32</dd></div><div><dt>通常城の城郭</dt><dd>Lv.32</dd></div><div><dt>二条・大坂・名古屋の城郭</dt><dd>Lv.48</dd></div><div><dt>江戸城の城郭</dt><dd>Lv.64</dd></div><div><dt>京都御所の城郭</dt><dd>Lv.128</dd></div></dl><p>${esc(roleText)}</p><p>「32段階の姿を見る」「32段階の城郭を見る」は見本の閲覧です。見本を切り替えても実際のレベルは上がりません。城郭Lv.33以降も絵は最終形態のまま、能力が育ちます。</p></details><p class="level-guide-more"><a href="guide/#castle-upgrades" target="_blank" rel="noopener">詳しい遊び方を別の画面で読む</a></p></div>`,
      `<button type="button" class="button" data-action="close">閉じる</button>`,'level-guide',{id:c.id});
    document.querySelectorAll('#modal-content [data-level-guide-section]').forEach(node=>{node.open=openSections.includes(node.dataset.levelGuideSection);});
  }

  function artPreviewModal(kind,id,level){const isCastle=kind==='castle',info=isCastle?game.castle(id):data.buildings.find(b=>b.id===id);if(!info)return;const actual=isCastle?info.level:state().buildings[id],chosen=Math.max(1,Math.min(32,Number.isInteger(level)?level:actual||1));modal(`${info.name} · 32段階の絵巻`,`${isCastle?'城郭':'施設'}の現在レベル：${actual?`Lv.${actual}`:'未建設'}`,`<div class="art-preview-stage" id="level-art-preview">${(isCastle?window.SengokuArt?.castle(id,'level-preview-art',chosen):window.SengokuArt?.facility(id,'level-preview-art',chosen))||icon('castle')}</div><div class="art-level-controls"><button class="button small" data-action="art-level-step" data-delta="-1" ${chosen===1?'disabled':''}>前の姿</button><strong id="art-preview-caption">Lv.${chosen} / 32</strong><button class="button small" data-action="art-level-step" data-delta="1" ${chosen===32?'disabled':''}>次の姿</button></div><label for="art-preview-level">見たいレベルを選ぶ</label><input class="range" id="art-preview-level" type="range" min="1" max="32" step="1" value="${chosen}"><p class="subtitle">32段階の完成イラストを閲覧できます。表示する姿を変えても、実際のレベル・資源・進行状態は変わりません。</p>`,`<button class="button primary" data-action="close">閉じる</button>`,'art-preview',{kind,id,level:chosen});}
  function updateArtPreview(level){if(activeModal!=='art-preview'||!activeModalContext)return;const c=activeModalContext,chosen=Math.max(1,Math.min(32,Math.floor(Number(level)||1)));c.level=chosen;const art=c.kind==='castle'?window.SengokuArt?.castle(c.id,'level-preview-art',chosen):window.SengokuArt?.facility(c.id,'level-preview-art',chosen);patchHTML($('#level-art-preview'),art||icon('castle'));$('#art-preview-caption').textContent=`Lv.${chosen} / 32`;$('#art-preview-level').value=chosen;document.querySelectorAll('[data-action="art-level-step"]').forEach(el=>el.disabled=Number(el.dataset.delta)<0?chosen===1:chosen===32);}
  function portrait(o){if(window.SengokuArt?.portrait)return window.SengokuArt.portrait(o);const n=o.name.split('').reduce((a,c)=>a+c.charCodeAt(0),0),horn=n%3;const rank=data.ranks.includes(o.rank)?o.rank:'D';return `<span class="portrait-frame" data-rank="${rank}" role="img" aria-label="${esc(o.name)} ${rank}ランクの肖像"><svg class="portrait" viewBox="0 0 120 130" aria-hidden="true"><defs><linearGradient id="armor-${o.id}" x2="1" y2="1"><stop stop-color="#b59b6d" stop-opacity=".6"/><stop offset="1" stop-color="#242c2c"/></linearGradient></defs><path d="M6 130q3-36 30-40l24-5 24 5q27 4 30 40" fill="url(#armor-${o.id})" stroke="currentColor" stroke-width="1"/><path d="m29 97-7 27m69-27 7 27M33 106h54M29 115h62M38 94l22 19 22-19M60 113v17" fill="none" stroke="currentColor" opacity=".7"/><path d="M40 55v22q3 17 20 18 17-1 20-18V55Z" fill="#b4a58b"/><path d="M32 60q0-35 28-35t28 35l-9 9-3-17H44l-4 17Z" fill="#2c3434" stroke="currentColor"/><path d="m27 58 13-6h40l13 6-5 8H32Z" fill="#3a3b30" stroke="currentColor"/><path d="m40 27-13-17 7 28m46-11 13-17-7 28" fill="none" stroke="currentColor" stroke-width="3"/>${horn===0?'<path d="m60 8-6 15 6 7 6-7Z" fill="currentColor"/>':horn===1?'<circle cx="60" cy="22" r="8" fill="none" stroke="currentColor" stroke-width="2"/>':'<path d="M45 16q15 18 30 0" fill="none" stroke="currentColor" stroke-width="3"/>'}<path d="m47 65 7 1m12 0 7-1m-13 4-2 9h5m-11 6q8 4 16 0" fill="none" stroke="#3d3932" stroke-width="1.5"/><path d="m40 72-8 10v11l12-4M80 72l8 10v11l-12-4" fill="#303833" stroke="currentColor" opacity=".7"/></svg><b class="portrait-rank-badge" aria-hidden="true">${rank}</b></span>`;}
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
    if(['all','idle','army','governor','branch'].includes(input.assignment))base.assignment=input.assignment;
    return base;
  }
  function saveOfficerPreferences(){try{localStorage.setItem(officerPreferencesKey,JSON.stringify({archive:normalizeOfficerFilter(filter),army:normalizeOfficerFilter(choiceFilters.army,'army'),governor:normalizeOfficerFilter(choiceFilters.governor,'governor')}));}catch(_){} }
  function filterOfficerList(list,options,{rankMatches=false}={}){
    const normalize=value=>String(value??'').normalize('NFKC').replace(/德/g,'徳').replace(/\s+/g,'').toLocaleLowerCase('ja'),query=normalize(options.q),s=state(),ranks={D:0,C:1,B:2,A:3,S:4,SS:5,SSS:6,U:7},assigned=new Set(Object.values(s.governors)),army=new Set(s.army),stationed=new Set((s.branches||[]).flatMap(branch=>branch.commanders||[])),owned=new Set(s.officers),clan=options.clan&&options.clan!=='all'?normalize(options.clan):'',direction=options.direction==='asc'?1:-1;
    const result=list.filter(Boolean).filter(o=>(!query||normalize([o.name,o.clan,o.region,skillNames[o.skill]||''].join(' ')).includes(query))&&(!clan||normalize(o.clan)===clan)&&(!rankMatches||!options.rank||options.rank==='all'||o.rank===options.rank)&&(!options.skill||options.skill==='all'||o.skill===options.skill)&&(!options.assignment||options.assignment==='all'||options.assignment==='army'&&army.has(o.id)||options.assignment==='governor'&&assigned.has(o.id)||options.assignment==='branch'&&stationed.has(o.id)||options.assignment==='idle'&&owned.has(o.id)&&!army.has(o.id)&&!assigned.has(o.id)&&!stationed.has(o.id))&&(!options.ownership||options.ownership==='all'||(options.ownership==='owned')===(o.variantOwned??game.ownsVariant(o.id,o.rank))));
    const value=o=>options.sort==='rarity'?ranks[o.rank]??0:options.sort==='total'?o.lead+o.valor+o.intellect+o.politics:Number(o[options.sort])||0;
    return result.sort((a,b)=>(options.sort==='name'?a.name.localeCompare(b.name,'ja'):(value(a)-value(b)))*direction||a.name.localeCompare(b.name,'ja')||String(a.id).localeCompare(String(b.id)));
  }
  function officerFilterToolbar(context,options){
    const archive=context==='archive',prefix=archive?'officer':'choice',clans=[...new Set(roster.map(o=>o.clan))].sort((a,b)=>a.localeCompare(b,'ja'));
    const defaults=officerFilterDefaults(context);
    const hasConditions=['clan','rank','skill','assignment','sort','direction'].some(key=>options[key]!==defaults[key]);
    const select=(key,label,values)=>`<label class="officer-filter-field" for="${prefix}-${key}"><span>${label}</span><select class="select" id="${prefix}-${key}" data-officer-filter="${key}" data-officer-context="${context}">${values.map(([value,text])=>`<option value="${esc(value)}" ${options[key]===value?'selected':''}>${esc(text)}</option>`).join('')}</select></label>`;
    return `<section class="officer-filter-bar" aria-label="武将の並び替えと絞り込み"><div class="officer-filter-heading"><b>${icon('search')}並び替え・絞り込み</b><button type="button" class="text-link" data-action="officer-reset" data-context="${context}">条件をリセット</button></div><div class="officer-filter-fields"><label class="officer-filter-field officer-filter-search" for="${prefix}-search"><span>武将を検索</span><input class="input" id="${prefix}-search" type="search" maxlength="80" value="${esc(options.q)}" placeholder="武将名・勢力・地方・特技" data-officer-filter="q" data-officer-context="${context}" autocomplete="off"></label></div><details class="officer-filter-drawer"${hasConditions?' open':''}><summary>勢力・能力で絞り込む／並べ替える</summary><div class="officer-filter-fields">${select('clan','勢力',[['all','すべての勢力'],...clans.map(clan=>[clan,clan])])}${select('rank',archive?'表示するランク':'最高所持ランク',[['all',archive?'最高所持・基本ランク':'すべてのランク'],...data.ranks.slice().reverse().map(rank=>[rank,rank+'ランク'])])}${select('skill','特技',[['all','すべての特技'],...Object.entries(skillNames)])}${select('assignment','任命状況',[['all','すべて'],['idle','待機中'],['army','軍団に編成中'],['governor','奉行に任命中'],['branch','支拠点に配置中']])}${select('sort','並び替え',[['lead','統率'],['valor','武勇'],['intellect','知略'],['politics','政治'],['total','総合能力'],['rarity','ランク'],['name','名前']])}${select('direction','並び順',[['desc','降順'],['asc','昇順']])}</div></details>${archive?`<div class="tabs officer-ownership-tabs" role="group" aria-label="絵巻の所持状況">${[['all','すべて'],['owned','絵巻所持'],['free','未所持']].map(([value,label])=>`<button type="button" class="${options.ownership===value?'active':''}" data-action="officer-filter" data-id="${value}" aria-pressed="${options.ownership===value}">${label}</button>`).join('')}</div>`:'<p class="officer-filter-hint">所持する最高ランクの能力で比較します。</p>'}</section>`;
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
  function filteredOfficers(){
    const selected=filter.rank==='all'?undefined:filter.rank,ids=roster.map(base=>base.id);
    const list=game.officerViews?game.officerViews(ids,selected):ids.map(id=>game.officer(id,selected));
    return filterOfficerList(list,filter);
  }
  function officerDuty(id){
    const s=state(),branch=(s.branches||[]).find(row=>(row.commanders||[]).includes(id));
    if(branch){const parent=game.castle?.(branch.parentCastleId),direction=({north:'北',east:'東',south:'南',west:'西'})[branch.direction]||'';return{kind:'branch',label:window.SengokuBranches?.name?.(game,branch.id)||`${parent?.name||'本城'} ${direction}支拠点`,unavailable:'支拠点の配置を解除すると任命できます。'};}
    const slot=s.army.indexOf(id);if(slot>=0)return{kind:'army',label:`本隊・${['総大将','副将一','副将二'][slot]||'軍団'}`};
    const assigned=Object.entries(s.governors).find(([,officer])=>officer===id);if(assigned)return{kind:'governor',label:`${data.buildings.find(b=>b.id===assigned[0])?.name||'施設'}の奉行`};
    return s.officers.includes(id)?{kind:'idle',label:'待機中'}:{kind:'unowned',label:'未登用'};
  }
  function officerCard(o,archive=false){
    const duty=officerDuty(o.id);
    const identity=`<small>${esc(o.clan)} · ${esc(o.region)}</small><h3>${esc(o.name)}</h3>`;
    return `<button class="officer-card" data-rank="${o.rank}" data-action="officer" data-id="${o.id}">${archive?`<div class="officer-card-heading">${identity}</div>`:''}<div class="officer-art"><span class="clan-script clan-script-kamon">${clanCrest(o.clan,30)}</span>${portrait(o)}${game.ownsVariant(o.id,o.rank)?'<span class="owned-tag">絵巻所持</span>':'<span class="owned-tag unowned-variant">未所持</span>'}</div><div class="officer-content">${archive?'':identity}${duty.kind!=='unowned'?`<span class="officer-duty-badge" data-duty="${duty.kind}">${esc(duty.label)}</span>`:''}${window.SengokuOfficerHealthUI?.markup(game,o.id,{compact:true})||''}<div class="mini-stats">${[['lead','統率'],['valor','武勇'],['intellect','知略'],['politics','政治']].map(([k,n])=>`<span>${n}<b>${o[k]}</b></span>`).join('')}</div><div class="skill-tag">${icon(skillIcons[o.skill]||'flag')}${esc(skillNames[o.skill]||o.skill)}</div></div></button>`;
  }
  function officerComparisonSelected(o){return officerComparison.some(row=>row.id===o.id&&row.rank===o.rank);}
  function officerCompareCard(o){
    const selected=officerComparisonSelected(o);
    return `<article class="officer-comparison-card${selected?' is-comparing':''}" data-compare-card="${o.id}">${officerCard(o,true)}<button type="button" class="officer-compare-toggle" data-action="officer-compare-toggle" data-id="${o.id}" data-rank="${o.rank}" aria-pressed="${selected}" aria-label="${esc(o.name)} ${o.rank}ランクを${selected?'比較から外す':'比較に追加'}">${icon(selected?'check':'plus')}<span>${selected?'比較から外す':'比較に追加'}</span></button></article>`;
  }
  function officerComparisonTray(){
    const rows=window.SengokuManagement.compareOfficers(game,officerComparison).rows;
    if(!rows.length)return `<p class="officer-compare-prompt" id="officer-compare-count" role="status">絵巻の「比較に追加」で2〜3名を選択</p><button type="button" class="button small" id="officer-compare-open" data-action="officer-compare-open" aria-haspopup="dialog" disabled>比較する</button>`;
    return `<div class="officer-compare-intro"><b>${icon('users')}武将を見比べる</b><small id="officer-compare-count" role="status">${rows.length} / 3名を選択</small></div><div class="officer-compare-picks">${rows.map(o=>`<button type="button" class="officer-compare-pick" data-action="officer-compare-toggle" data-id="${o.id}" data-rank="${o.rank}" aria-label="${esc(o.name)} ${o.rank}ランクを比較から外す"><span>${esc(o.name)}<small class="rank-${o.rank}">${o.rank}</small></span>${icon('close')}</button>`).join('')}</div><div class="officer-compare-actions"><button type="button" class="button gold" id="officer-compare-open" data-action="officer-compare-open" aria-haspopup="dialog"${rows.length<2?' disabled':''}>${icon('users')}比較する${rows.length?'（'+rows.length+'名）':''}</button>${rows.length?'<button type="button" class="text-link" data-action="officer-compare-clear">選択を解除</button>':''}</div>`;
  }
  function refreshOfficerComparisonSelection(){
    const focused=document.activeElement;
    const tray=$('#officer-compare-tray');if(tray)patchHTML(tray,officerComparisonTray());
    document.querySelectorAll('[data-action="officer-compare-toggle"]').forEach(node=>{
      if(!node.classList.contains('officer-compare-toggle'))return;
      const selected=officerComparison.some(row=>row.id===node.dataset.id&&row.rank===node.dataset.rank),o=game.officer(node.dataset.id,node.dataset.rank);
      node.setAttribute('aria-pressed',String(selected));node.setAttribute('aria-label',`${o?.name||'武将'} ${node.dataset.rank}ランクを${selected?'比較から外す':'比較に追加'}`);
      patchHTML(node,icon(selected?'check':'plus')+`<span>${selected?'比較から外す':'比較に追加'}</span>`);
      node.closest('.officer-comparison-card')?.classList.toggle('is-comparing',selected);
    });
    document.querySelectorAll('[data-officer-compare-shortcut]').forEach(node=>{node.hidden=officerComparison.length<2;const label=`比較表へ（${officerComparison.length}名）`;if(node.textContent!==label)node.textContent=label;});
    if(focused&&!focused.isConnected){const next=$('#officer-compare-tray .officer-compare-pick')||Array.from(document.querySelectorAll('#officer-results .officer-compare-toggle')).find(node=>!node.disabled&&!node.closest('[hidden],[inert]'))||$('#officer-search');next?.focus({preventScroll:true});}
  }
  function toggleOfficerComparison(id,rank){
    const result=window.SengokuManagement.toggleComparison(officerComparison,{id,rank},roster.map(o=>o.id),data.ranks);
    if(result.reason==='full'){toast('比較は3名までです。選択した武将を外してから追加してください。');return;}
    if(result.reason==='invalid')return;
    officerComparison=result.selection;refreshOfficerComparisonSelection();
  }
  function officerComparisonModal(){
    const comparison=window.SengokuManagement.compareOfficers(game,officerComparison),rows=comparison.rows;
    if(rows.length<2){toast('比較する武将を2名以上選んでください。');return;}
    const names={lead:'統率',valor:'武勇',intellect:'知略',politics:'政治'};
    const cards=rows.map(o=>{const duty=officerDuty(o.id),owned=game.ownsVariant(o.id,o.rank),highest=game.highestOwnedRank(o.id);return `<section class="comparison-person" data-rank="${o.rank}"><div class="comparison-person-art">${portrait(o)}</div><div><span class="eyebrow">${esc(o.rank)} · ${owned?'絵巻所持':'未所持の絵巻'}</span><h3>${esc(o.name)}</h3><p>${esc(o.clan)}</p><span class="officer-duty-badge" data-duty="${duty.kind}">${esc(duty.label)}</span><small class="comparison-highest">最高所持：${highest||'未登用'}</small><button type="button" class="text-link" data-action="officer" data-id="${o.id}" data-rank="${o.rank}" aria-label="${esc(o.name)}の詳細">詳細</button></div></section>`;}).join('');
    const table=`<table class="officer-comparison-table"><caption>選んだ絵巻の能力。最大値には「最高」を表示します。</caption><thead><tr><th scope="col">能力</th>${rows.map(o=>`<th scope="col">${esc(o.name)}<small>${esc(o.rank)}ランク</small></th>`).join('')}</tr></thead><tbody>${Object.entries(names).map(([key,label])=>`<tr><th scope="row">${label}</th>${rows.map(o=>{const best=o[key]===comparison.maxima[key];return `<td${best?' class="comparison-best"':''}><strong>${o[key]}</strong><span class="comparison-stat-track" aria-hidden="true"><i style="width:${Math.max(0,Math.min(100,Number(o[key])||0))}%"></i></span><small>${best?'最高':'　'}</small></td>`;}).join('')}</tr>`).join('')}</tbody></table>`;
    const skills=`<div class="comparison-skills" style="--comparison-count:${rows.length}">${rows.map(o=>`<section><h4>${esc(o.name)}</h4><b>${icon(skillIcons[o.skill]||'flag')}${esc(skillNames[o.skill]||o.skill)}</b><p>${esc(skillDescriptions[o.skill]||'能力と任命先に応じて軍団・施設を支えます。')}</p></section>`).join('')}</div>`;
    modal('武将比較','選んだ絵巻の能力・特技・任命状況を確認',`<div class="officer-comparison"><p class="comparison-explanation">比較は選択したランクの値です。軍団・奉行では、所持する最高ランクが使われます。</p><div class="comparison-people" style="--comparison-count:${rows.length}">${cards}</div>${table}${skills}<p class="comparison-explanation">同じ特技は軍団内で重複しません。任命先と役割も見ながら選びましょう。</p></div>`,`<button type="button" class="button" data-action="close">比較を閉じる</button><button type="button" class="button gold" data-view="army">${icon('swords')}軍団編成へ</button>`,'officer-comparison',{});
  }
  function officersResults(){const list=filteredOfficers(),pages=Math.max(1,Math.ceil(list.length/8));filter.page=Math.max(1,Math.min(filter.page,pages));return `<div class="section-heading" style="margin-top:0"><small role="status">${num(list.length)} / ${num(roster.length)}名 · ${filter.rank==='all'?'最高所持・基本ランク':`${filter.rank}ランクの絵巻`} · ${filter.page} / ${pages}頁</small><small>本作用に描き起こした創作肖像</small></div><div class="officers-grid">${list.slice((filter.page-1)*8,filter.page*8).map(officerCompareCard).join('')||`<div class="empty">${icon('search')}<p>条件に合う絵巻が見つかりません。</p><button type="button" class="button" data-action="officer-reset" data-context="archive">条件をリセット</button></div>`}</div><div class="pagination"><button class="button small" data-action="officer-page" data-delta="-1" ${filter.page<=1?'disabled':''}>前の頁</button><span>${filter.page} / ${pages}</span><button class="button small" data-action="officer-page" data-delta="1" ${filter.page>=pages?'disabled':''}>次の頁</button></div>`;}
  function renderOfficers(){if(officerSection==='gacha')return heading('武将招集','WARLORD SUMMON · 群雄招来','勾玉を捧げ、まだ見ぬ英傑との縁を結ぶ。')+officerTabs()+renderGacha();return heading('武将名鑑','OFFICER ARCHIVE · 人こそ城',`${num(roster.length)}名 × 8ランク · 所持対象 ${num(game.collection().totalVariants)}種の絵巻。`)+officerTabs()+`${officerFilterToolbar('archive',filter)}<section id="officer-compare-tray" class="officer-compare-tray" aria-label="武将比較の選択">${officerComparisonTray()}</section><div id="officer-results">${officersResults()}</div><div class="notice">登場年代を越えた「群雄集結」シナリオです。能力・特技・格付けはゲーム用の創作で、歴史上の評価ではありません。全256名それぞれに D・C・B・A・S・SS・SSS・U の8種類、計2,048種の絵巻があります。ランクを選ぶと、そのランクの全武将を閲覧できます。軍団・奉行には所持する最高ランクの能力が反映されます。</div>`;}
  function officerTabs(){const collection=game.collection();return `<div class="officer-subnav"><div class="tabs" role="group" aria-label="武将の画面"><button class="${officerSection==='archive'?'active':''}" data-action="officer-section" data-id="archive" aria-pressed="${officerSection==='archive'}">${icon('users')}武将名鑑</button><button class="${officerSection==='gacha'?'active':''}" data-action="officer-section" data-id="gacha" aria-pressed="${officerSection==='gacha'}">${icon('magatama')}武将招集</button></div><span class="collection-count">家臣 ${collection.officers} / ${roster.length}名<br>絵巻 ${num(collection.variants)} / ${num(collection.totalVariants)}種</span></div>`;}
  function renderGacha(){const s=state(),g=data.gacha,odds=game.gachaOdds(),history=s.gachaHistory.slice(0,48),pages=Math.max(1,Math.ceil(history.length/4));gachaHistoryPage=Math.max(1,Math.min(gachaHistoryPage,pages));const recent=history.slice((gachaHistoryPage-1)*4,gachaHistoryPage*4);return `<section class="gacha-sanctuary"><div class="gacha-sanctuary-art" aria-hidden="true">${icon('magatama')}<span>縁</span></div><div class="gacha-hero-copy"><div class="eyebrow">A FATE WORTH FOLLOWING</div><h2>次なる英傑と、天下へ。</h2><p>全${roster.length}名・8ランク、${num(game.collection().totalVariants)}種の絵巻が招集対象。<br>同じ武将でも、ランクごとに姿と能力が異なります。</p><div class="gacha-balance"><span>${icon('magatama')}所持勾玉</span><b data-magatama-balance>${num(s.magatama)}</b></div><div class="gacha-actions"><button class="button gold" data-action="draw-officers" data-count="1">1回招集 <span>${icon('magatama')}${num(g.singleCost)}</span></button><button class="button primary" data-action="draw-officers" data-count="10">10回招集 <span>${icon('magatama')}${num(g.tenCost)}</span></button></div><p class="gacha-smallprint">指令の消費なし · 10回招集は勾玉${num(g.singleCost*10-g.tenCost)}お得</p></div></section><div class="gacha-details-grid"><section class="panel"><div class="panel-heading"><h2>${icon('crown')}招集の提供割合</h2><button class="text-link" data-action="gacha-odds">全武将の割合を見る</button></div><div class="gacha-rates">${odds.map(r=>`<div><span class="gacha-rank rank-${r.rank}">${r.rank}</span><b>${r.rate}<small>%</small></b><small>${r.count}名</small></div>`).join('')}</div><p class="subtitle">ランク内の対象武将から等確率で抽選。一部の特別な絵巻は抽選対象外です。1回・10回とも同じ割合で1枠ずつ抽選します。確定枠や天井はありません。</p><div class="notice">同じ武将でも別ランクなら新規絵巻です。同じ武将・同じランクの重複だけが勾玉${g.duplicateRefund}に変換されます。戦力には最高所持ランクを反映します。</div></section><section class="panel"><div class="panel-heading"><h2>${icon('magatama')}勾玉を集める</h2><small>プレイで獲得</small></div><div class="gacha-source"><span>${icon('calendar')}月次褒賞</span><b>+${g.monthlyReward}<small> / ゲーム内1か月</small></b></div><div class="gacha-source"><span>${icon('castle')}城の初攻略</span><b>+${g.firstCaptureReward}<small> / 1城につき1度</small></b></div><div class="gacha-source"><span>${icon('scroll')}領主の任務</span><b>+100〜1,000<small> / 任務</small></b></div><p class="subtitle">新しい物語は勾玉${num(g.initial)}で開始します。勾玉の購入や現金の支払いはありません。</p><button class="button full" data-view="council" style="margin-top:17px">${icon('target')}任務と報酬を確認する</button></section></div><div class="section-heading"><h2>${icon('scroll')}最近の招集</h2><small>累計 ${num(s.stats.gachaDraws)}回 · 最新48枚</small></div>${recent.length?`<div class="gacha-history">${recent.map(item=>{const o=game.officer(item.officerId,item.rank);return `<button data-action="officer" data-id="${o.id}" data-rank="${item.rank}" class="gacha-history-row"><span class="gacha-history-rank rank-${item.rank}">${item.rank}</span><span><b>${esc(o.name)}</b><small>${esc(o.clan)} · ${shortDate(item.turn)}</small></span><small class="${item.isNew?'new-officer':''}">${item.isNew?(item.isNewOfficer?'新家臣・新絵巻':item.upgraded?'新絵巻・能力上昇':'新たな絵巻'):`同一絵巻 · 勾玉+${item.duplicateRefund}`}</small></button>`;}).join('')}</div>${pageControls('gacha-history-page',gachaHistoryPage,pages)}`:'<div class="panel empty"><p>招集した武将の記録が、ここに残ります。</p><p class="subtitle">まずは1回、あるいは10回。新たな出会いを軍団や城下の力に。</p></div>'}`;}
  function gachaOfficerOddsRows(rank,page){const odds=game.gachaOdds().find(r=>r.rank===rank);if(!odds)return'';const all=(game.officerViews?game.officerViews(game.gachaPool(rank).map(o=>o.id),rank):game.gachaPool(rank).map(o=>game.officer(o.id,rank))).sort((a,b)=>a.name.localeCompare(b.name,'ja')),list=page===undefined?all:all.slice((page-1)*10,page*10);return list.map(o=>`<tr><th>${esc(o.name)}<small>${esc(o.clan)}</small></th><td class="rank-${rank}">${rank}</td><td>${odds.perOfficerRate.toFixed(4)}%</td></tr>`).join('');}
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
  function officerModal(id,rank){const o=game.officer(id,rank);if(!o)return;const owned=state().officers.includes(id),variantOwned=game.ownsVariant(id,o.rank),highest=game.highestOwnedRank(id),can=game.canRecruitOfficer(id),ranks=game.ownedRanks(id),recruitRank=game.canOwnOfficerVariant(id,o.baseRank)?o.baseRank:'SSS';modal(o.name,`${o.clan} · ${o.region} · 絵巻 ${ranks.length} / 8種`,`<div class="variant-tabs" role="group" aria-label="絵巻のランクを選ぶ">${data.ranks.map(r=>`<button data-action="officer-rank-detail" data-id="${id}" data-rank="${r}" class="${r===o.rank?'active':''} ${game.ownsVariant(id,r)?'variant-owned':''}" aria-pressed="${r===o.rank}"><b class="rank-${r}">${r}</b><small>${game.ownsVariant(id,r)?'所持':'未所持'}</small></button>`).join('')}</div><div class="officer-detail-top illustrated-officer" data-rank="${o.rank}"><div class="officer-detail-portrait">${portrait(o)}</div><div><span class="eyebrow">${esc(o.rank)} · ${variantOwned?'所持する絵巻':'未所持の絵巻'}</span><h3>${esc(o.name)}</h3><span class="skill-tag" style="border:0;padding:0;margin:0">${icon(skillIcons[o.skill]||'flag')}${esc(skillNames[o.skill]||o.skill)}</span><p class="subtitle">最高所持ランク：${highest||'未登用'}</p></div></div><div class="officer-detail-comparison"><button type="button" class="button officer-compare-toggle" data-action="officer-compare-toggle" data-id="${id}" data-rank="${o.rank}" aria-pressed="${officerComparisonSelected(o)}">${icon(officerComparisonSelected(o)?'check':'plus')}<span>${officerComparisonSelected(o)?'比較から外す':'比較に追加'}</span></button><button type="button" class="button" data-action="officer-compare-open" data-officer-compare-shortcut aria-haspopup="dialog"${officerComparison.length<2?' hidden':''}>比較表へ（${officerComparison.length}名）</button></div>${window.SengokuOfficerHealthUI?`<div class="officer-health-detail">${window.SengokuOfficerHealthUI.markup(game,id)}<p>${window.SengokuOfficerHealthUI.explanation(game)}</p></div>`:''}<div class="stats-bars">${[['lead','統率'],['valor','武勇'],['intellect','知略'],['politics','政治']].map(([k,n])=>`<div class="stat-bar"><label>${n}<b>${o[k]}</b></label><div class="progress"><i style="width:${o[k]}%"></i></div></div>`).join('')}</div><p class="subtitle">${o.rank}絵巻の能力：基礎能力に各 +${o.rankBonus}（上限100）。軍団・奉行には所持する最高ランクの能力が自動で反映されます。</p><p>${esc(o.description||`${o.clan}にゆかりのある人物。`)}</p><div class="notice"><strong>${esc(skillNames[o.skill]||o.skill)}</strong><br>${esc(skillDescriptions[o.skill]||'能力と任命先に応じて軍団・施設を支えます。')}<br>軍団内で同じ特技は重複しません。同一人物を別ランクで重複編成することもできません。</div>${!variantOwned?`<p class="subtitle">${game.canOwnOfficerVariant(id,o.rank)?`この${o.rank}絵巻は未所持です。同じ人物の別ランクも新規獲得になります。`:'このUランクの絵巻は通常の抽選・登用の対象外です。SSS以下の絵巻を選べます。'}</p>`:''}${!owned?`<h3>${recruitRank}絵巻で直接登用</h3><p>直接登用では ${recruitRank} 絵巻を獲得します。天守 Lv.${can.requiredLevel}以上 · 指示1回</p>${costHtml({gold:can.cost})}<p data-recruit-reason="${id}" style="color:var(--gold)">${!can.ok?esc(can.reason):''}</p>`:`<p style="margin-top:16px">${state().army.includes(id)?'出陣軍団に所属しています。':Object.values(state().governors).includes(id)?'施設の奉行を務めています。':'軍団への編成、または奉行への任命ができます。'}</p>`}`,`<button class="button" data-action="close">閉じる</button><button class="button gold" data-action="open-gacha">${icon('magatama')}武将招集</button>${owned?'<button class="button primary" data-view="army">軍団を編成</button>':`<button class="button primary" data-action="recruit-officer" data-id="${id}" ${!can.ok?'disabled':''}>${recruitRank}で登用</button>`}`,'officer',{id,rank:o.rank});}
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
    return `資産・収容枠での最大：${num(maximum)}人（1回100〜20,000人）。${s.command<1?'指令の回復後に募兵できます。':'「最大」で人数を設定し、「募兵する」で実行します。'}`;
  }
  function selectMaximumRecruitment(){
    const input=$('#recruit-amount'),maximum=maximumRecruitAmount();
    if(!input||maximum<100){refreshLiveControls();return;}
    input.value=String(maximum);
    const cost=$('#recruit-cost');if(cost)patchHTML(cost,costHtml(game.recruitTroopCost(maximum)));
    refreshLiveControls();
  }
  function recruitmentPreviewHtml(amount,income,budget){
    const preview=game.previewRecruitment(amount,income),recommended=budget.recommendedMax>=100?budget.recommendedMax:0;
    return `<div class="recruit-preview"><div class="recruit-recommendation"><p id="recruit-recommendation">収支内の目安：<strong><span data-recruit-recommended>${num(recommended)}</span>人</strong></p><button type="button" class="button" data-action="recruit-balanced" aria-controls="recruit-amount" aria-describedby="recruit-recommendation" ${state().gameOver||recommended<100?'disabled':''}>収支内で入力</button></div><table aria-label="募兵後の金銭と兵糧"><thead><tr><th scope="col">募兵後</th><th scope="col">金銭</th><th scope="col">兵糧</th></tr></thead><tbody>${[['balances','支払い後'],['net','毎月の差引']].map(([kind,label])=>`<tr><th scope="row">${label}</th>${['gold','rice'].map(key=>`<td data-recruit-preview="${kind}" data-recruit-resource="${key}" class="${preview?.[kind][key]<0?'is-negative':''}">${preview?(kind==='net'?economyNumber(preview.net[key]):num(preview.balances[key])):'—'}</td>`).join('')}</tr>`).join('')}</tbody></table><p class="recruit-preview-note">目安は金銭・兵糧の赤字を出さず、募兵後の維持費2か月分（金銭は最低500、兵糧は最低1,000）を残す人数です。最低100人に届かない場合は0人と表示します。人数は自由に入力できます。</p></div>`;
  }
  function refreshRecruitmentPreview(income,budget){
    const input=$('#recruit-amount');if(!input)return;
    const raw=Number(input.value),amount=Math.floor(raw),preview=Number.isFinite(raw)&&amount>=100&&amount<=20000?game.previewRecruitment(amount,income):null;
    for(const node of document.querySelectorAll('[data-recruit-preview]')){
      const kind=node.dataset.recruitPreview,key=node.dataset.recruitResource,value=preview?.[kind][key],text=preview?(kind==='net'?economyNumber(value):num(value)):'—';
      if(node.textContent!==text)node.textContent=text;
      node.classList.toggle('is-negative',Boolean(preview&&value<0));
    }
    const recommendation=$('[data-recruit-recommended]'),text=num(budget.recommendedMax>=100?budget.recommendedMax:0);
    if(recommendation&&recommendation.textContent!==text)recommendation.textContent=text;
  }
  function selectRecommendedRecruitment(){
    const input=$('#recruit-amount'),income=game.income(),budget=game.recruitmentBudget(income),amount=budget.recommendedMax;
    if(!input||state().gameOver||amount<100){refreshLiveControls();return;}
    input.value=String(amount);
    const cost=$('#recruit-cost');if(cost)patchHTML(cost,costHtml(game.recruitTroopCost(amount)));
    refreshLiveControls();
  }
  function renderArmy(){const s=state(),stats=game.armyStats(),income=game.income(),budget=game.recruitmentBudget(income),maximum=s.gameOver?0:budget.affordableMax,amount=budget.recommendedMax>=100?Math.min(1000,budget.recommendedMax):100;return heading('軍団編成','YOUR ARMY · 兵を知り、将を知る','三名の将を選び、次の合戦に備える。')+`<div class="army-briefing"><section class="army-muster-overview" aria-label="出陣前の軍団状況"><div><span>編成した将</span><strong>${stats.count}<small> / 3名</small></strong></div><div><span>本隊の兵力</span><strong>${num(s.troops)}<small>人</small></strong></div><div><span>軍団の士気</span><strong>${s.morale}<small> / 100</small></strong></div></section><section class="army-planner-entry"><div><h2>軍師の編成提案</h2><p>体力・特技・戦法から、次の軍団を選ぶ。</p></div><button type="button" class="button gold" data-action="army-planner" aria-haspopup="dialog">${icon('book')}編成案を比較する</button></section></div><div class="army-layout"><div class="left-column"><div class="army-slots">${[0,1,2].map((slot)=>{const o=game.officer(s.army[slot]),role=['総大将','副将・一','副将・二'][slot];return `<section class="army-slot army-illustrated-slot${o?'':' is-vacant'}" data-rank="${o?esc(o.rank):'none'}"><div class="army-slot-heading"><div><span class="slot-label">${role}</span><h3>${o?`<span class="officer-rank-label rank-${o.rank}">${esc(o.rank)}</span> ${esc(o.name)}`:'未任命'}</h3></div><button type="button" class="button small ${slot===0?'gold':''}" data-action="pick-army" data-slot="${slot}" aria-label="${role}の武将を${o?'変更':'任命'}">${o?'変更':'任命'}</button></div>${o?`<button type="button" class="army-portrait" data-action="officer" data-id="${esc(o.id)}" aria-label="${esc(o.name)}・${esc(o.rank)}ランクの能力と絵巻を見る">${portrait(o)}</button>`:`<div class="army-portrait army-portrait-empty" aria-hidden="true">${icon('users')}<span>次の将を、ここに。</span></div>`}<div class="army-card-copy"><p class="army-officer-house">${o?esc(o.clan):'家臣から武将を選択'}</p>${o?`${window.SengokuOfficerHealthUI?.markup(game,o.id,{compact:true})||''}<div class="army-abilities" aria-label="${esc(o.name)}の能力">${[['lead','統率'],['valor','武勇'],['intellect','知略']].map(([key,label])=>`<div class="army-ability"><span>${label}</span><b>${o[key]}</b><span class="army-ability-track" aria-hidden="true"><i style="width:${Math.min(100,Math.max(0,o[key]))}%"></i></span></div>`).join('')}</div><p class="army-officer-skill">${icon('flag')}${esc(skillNames[o.skill]||o.skill)}</p>`:'<p class="army-vacancy-copy">三名の将の能力を組み合わせ、次の合戦に備えましょう。</p>'}</div></section>`;}).join('')}</div><section class="panel"><div class="panel-heading"><h2>兵を集める</h2>${icon('swords')}</div><p class="subtitle">本隊 ${num(s.troops)}人 · 募兵上限 ${num(game.troopCapacity())}人（兵舎の増築で増加）。交易の輸入・返還と空城からの帰還は、募兵上限とは別枠で受け入れます。</p><div class="enlist-form"><label for="recruit-amount" class="subtitle">人数</label><div class="recruit-amount-controls"><input id="recruit-amount" class="input" type="number" min="100" max="20000" step="1" value="${amount}" inputmode="numeric" aria-describedby="recruit-limit recruit-recommendation"><button type="button" class="button gold" data-action="recruit-max" aria-label="資産と収容枠で募兵できる最大人数を入力" aria-controls="recruit-amount" aria-describedby="recruit-limit" ${maximum<100?'disabled':''}>最大</button></div><button class="button primary" data-action="recruit-troops" ${s.command<1||s.gameOver?'disabled':''}>${icon('users')}募兵する</button></div><div id="recruit-cost">${costHtml(game.recruitTroopCost(amount))}</div>${recruitmentPreviewHtml(amount,income,budget)}<p id="recruit-limit" class="subtitle recruit-limit" role="status">${esc(recruitLimitText(maximum))}</p><p class="subtitle">募兵・訓練はそれぞれ指令1回。指令は1倍速で20秒ごとに1回復します。</p><hr class="divider"><div class="stat-row"><span>士気</span><b>${s.morale} / 100</b></div><div class="progress"><i style="width:${s.morale}%"></i></div>${costHtml(game.trainingCost?game.trainingCost():{gold:180,rice:250})}<button class="button full" data-action="train" ${s.morale>=100||s.command<1||s.gameOver?'disabled':''}>${icon('flag')}軍団を訓練する</button></section><div class="section-heading"><h2>${icon('swords')}合戦の戦法</h2><small>出陣ごとに選択できます</small></div><div class="tactics-grid">${data.tactics.map(t=>`<div class="tactic-card" data-tactic="${esc(t.id)}"><h3>${esc(t.name)}</h3><p>${esc(t.description)}</p></div>`).join('')}</div></div><aside><section class="panel"><div class="panel-heading"><h2>軍団の平均能力</h2>${icon('flag')}</div><p class="subtitle">現在の体力を反映した、戦闘時の能力です。</p>${[['lead','統率'],['valor','武勇'],['intellect','知略']].map(([k,n])=>`<div class="army-average-stat"><div class="stat-row"><span>${n}</span><b><span data-army-health-stat="${k}">${stats[k]}</span><small> / 100</small></b></div><div class="army-ability-track" aria-hidden="true"><i data-army-health-stat-bar="${k}" style="width:${Math.min(100,Math.max(0,stats[k]))}%"></i></div></div>`).join('')}${window.SengokuOfficerHealthUI?`<p class="army-health-explanation">${window.SengokuOfficerHealthUI.explanation(game)}</p>`:''}<div class="notice">軍団には同じ武将を重複して編成できません。奉行に任命すると軍団から外れます。</div><button class="button primary full" data-view="map" style="margin-top:18px">${icon('map')}天下地図から出陣</button><button class="button full" data-view="roaming" style="margin-top:10px">${icon('swords')}野良兵士と戦う</button><button class="button full" data-view="covert" style="margin-top:10px">${icon('eye')}派遣部隊を管理</button><button class="button gold full" data-action="troop-trade" style="margin-top:10px">${icon('handshake')}兵士を輸出入</button></section>${economyPanel('army')}</aside></div>`;}
  function armyPlanScope(){return [roleEpoch,startPending?'start':'playing',state().walking?.campaignId,state().clan,state().home,window.SengokuSocial?.getUser?.()?.id||'local'].join(':');}
  function armyPlanReviewKey(plan){return JSON.stringify([plan.current.ids,plan.ids,plan.rows?.map(row=>[row.id,row.rank]),plan.displaced,plan.current.stats,plan.stats,Math.round((plan.delta||0)*10)]);}
  function armyPlannerModal(options={}){
    const api=window.SengokuArmyPlanner;if(!api)return;
    const prior=activeModal==='army-planner'&&activeModalContext?.scope===armyPlanScope()?activeModalContext:null;
    const config={tactic:options.tactic??prior?.config.tactic??'balanced',locked:options.locked??prior?.config.locked??[],includeGovernors:options.includeGovernors??prior?.config.includeGovernors??false};
    const plan=api.build(game,config),tacticName=data.tactics.find(row=>row.id===plan.tactic)?.name||'正攻法',delta=plan.ok?(Math.abs(plan.delta)<.05?'±0.0':`${plan.delta>0?'+':''}${plan.delta.toFixed(1)}`):'—';
    const lockButtons=state().army.map(id=>{const o=game.officer(id),locked=config.locked.includes(id);return `<button type="button" class="button small" data-action="army-plan-lock" data-id="${esc(id)}" aria-pressed="${locked}">${icon(locked?'shield':'users')}${esc(o?.name||id)} · ${locked?'固定中':'固定する'}</button>`;}).join('');
    const body=`<div class="army-plan"><div class="army-plan-banner"><div><span class="eyebrow">FORMATION COUNCIL</span><h3>戦法から選ぶ、次の三将。</h3><p>現在の体力と、重複しない特技の効果で組み合わせを比較します。</p></div><div class="army-plan-count"><strong>${plan.candidateCount}</strong>名が候補</div></div><div class="army-plan-tactics" role="group" aria-label="編成を提案する戦法">${data.tactics.map(t=>`<button type="button" class="button" data-action="army-plan-tactic" data-id="${esc(t.id)}" aria-pressed="${config.tactic===t.id}">${esc(t.name)}</button>`).join('')}</div><section class="army-plan-options"><h4>今の軍団で残したい武将を固定</h4><div class="army-plan-locks">${lockButtons||'<p class="army-plan-note">現在、軍団の任命はありません。</p>'}</div><div class="army-plan-governors"><button type="button" class="button small" data-action="army-plan-governors" aria-pressed="${config.includeGovernors}">${config.includeGovernors?'奉行も候補に含める：ON':'奉行も候補に含める：OFF'}</button><small>支拠点に任命中の武将は候補外です。</small></div></section>${plan.ok?`<div class="army-plan-summary"><h3>${esc(tacticName)}の編成案</h3><div class="army-plan-change${plan.delta<-.05?' is-negative':''}"><strong>${delta}%</strong><small>現在編成比 · 編成由来の戦力目安</small></div></div><div class="army-plan-cards">${plan.rows.map((o,index)=>`<article class="army-plan-card"><div class="army-plan-portrait">${portrait(o)}<span class="army-plan-position">${['総大将','副将・一','副将・二'][index]}</span></div><div class="army-plan-card-copy"><h4><span class="officer-rank-label rank-${esc(o.rank)}">${esc(o.rank)}</span> ${esc(o.name)}</h4><span class="army-plan-tag${plan.current.ids.includes(o.id)?'':' is-new'}">${plan.current.ids.includes(o.id)?'現在の軍団':'入れ替え候補'}</span><p>${esc(skillNames[o.skill]||o.skill)} · 体力 ${Math.floor(o.health.current)} / 100</p><p>${esc(officerDuty(o.id).label)}</p></div></article>`).join('')}</div><table class="army-plan-table"><caption>体力を反映した平均能力</caption><thead><tr><th scope="col">能力</th><th scope="col">現在</th><th scope="col">提案</th><th scope="col">増減</th></tr></thead><tbody>${[['lead','統率'],['valor','武勇'],['intellect','知略']].map(([key,label])=>{const diff=plan.stats[key]-plan.current.stats[key];return `<tr><th scope="row">${label}</th><td>${plan.current.stats[key]}</td><td>${plan.stats[key]}</td><td class="${diff>0?'is-positive':diff<0?'is-negative':''}">${diff>0?'+':diff<0?'':'±'}${diff}</td></tr>`;}).join('')}</tbody></table>${plan.displaced.length?`<div class="army-plan-warning"><p>採用すると、次の施設が奉行未任命になります。生産・費用補正と給与が変わります。</p><ul>${plan.displaced.map(row=>`<li>${esc(data.buildings.find(b=>b.id===row.building)?.name||row.building)}：${esc(row.name)}</li>`).join('')}</ul></div>`:''}${plan.rows.some(row=>row.health.marching)?'<p class="army-plan-warning">行軍中の武将が含まれています。出発済みの部隊は出発時点の編成で進行します。</p>':''}<p class="army-plan-note">${plan.medic?'救護の特技を含みます。合戦で失う兵を軽減します。 ':''}${plan.unchanged?'現在の軍団が、この条件の提案と一致しています。 ':''}表示はこの画面を開いた時点の比較です。体力の回復・所持武将・任命が変わったら「再計算」を押してください。</p>`:`<div class="army-plan-empty" role="status">${esc(plan.message)}</div>`}<p class="army-plan-note">同じ兵数・士気・研究・相手で比較した、通常のCPU攻城戦の編成効果です。勝率や勝利の保証ではありません。最大3名を選び、編成効果が同じなら救護の特技、現在の武将を多く残す案の順で優先します。採用するまで軍団・資源・指令は変わりません。</p></div>`;
    modal('軍師の編成提案','武将を固定し、戦法に合わせた軍団を比較',body,`<button type="button" class="button" data-action="army-plan-refresh">再計算</button><button type="button" class="button" data-action="close">閉じる</button><button type="button" class="button primary" data-action="army-plan-apply"${!plan.ok||plan.unchanged||!saveEnabled?' disabled':''}>${plan.unchanged?'現在の編成と一致':'この編成を採用'}</button>`,'army-planner',{scope:armyPlanScope(),config,plan,reviewKey:plan.ok?armyPlanReviewKey(plan):''});
  }
  function applyArmyPlan(){
    const context=activeModal==='army-planner'?activeModalContext:null;
    if(!context?.plan?.ok||context.scope!==armyPlanScope()){toast('戦役または領主が変わりました。編成提案を開き直してください。',true);return;}
    if(!saveEnabled||!requireWritable())return;
    const check=window.SengokuArmyPlanner.validity(game,context.plan.ids,context.config);
    if(!check.ok){armyPlannerModal(context.config);toast(check.message,true);return;}
    const fresh=window.SengokuArmyPlanner.build(game,{...context.config,locked:context.plan.ids});
    if(!fresh.ok||armyPlanReviewKey(fresh)!==context.reviewKey){armyPlannerModal(context.config);toast('武将や任命が更新されました。新しい提案を確認してから採用してください。',true);return;}
    perform(game.assignArmy(context.plan.ids));
  }
  function officerChoiceResults(){
    const s=state(),list=filterOfficerList(game.officerViews?game.officerViews(s.officers):s.officers.map(id=>game.officer(id)),{...choiceFilters[choiceMode],ownership:'owned'},{rankMatches:true}),pages=Math.max(1,Math.ceil(list.length/8));choicePage=Math.max(1,Math.min(choicePage,pages));
    const rows=list.slice((choicePage-1)*8,choicePage*8).map(o=>{const duty=officerDuty(o.id);return `<button class="officer-choice" data-action="${choiceMode==='army'?'assign-army':'assign-governor'}" data-id="${o.id}" data-target="${choiceTarget}"${duty.unavailable?` disabled title="${esc(duty.unavailable)}"`:''}>${officerCrest(o)}<span class="officer-choice-description"><b><span class="officer-rank-label rank-${o.rank}">${esc(o.rank)}</span> ${esc(o.name)}</b><small>統率 ${o.lead} · 武勇 ${o.valor} · 知略 ${o.intellect} · 政治 ${o.politics}</small><small>${esc(skillNames[o.skill]||o.skill)}</small>${duty.unavailable?`<small class="officer-choice-unavailable">${esc(duty.unavailable)}</small>`:''}</span><small class="officer-choice-duty" data-duty="${duty.kind}">${esc(duty.label)}</small>${window.SengokuOfficerHealthUI?.markup(game,o.id,{compact:true})||''}</button>`;}).join('');
    return `<div class="officer-choice-count" role="status">${list.length} / ${s.officers.length}名 · ${choicePage} / ${pages}頁</div><div class="officer-choice-list">${rows||'<div class="empty catalog-empty"><p>条件に合う家臣がいません。</p><button type="button" class="button" data-action="officer-reset" data-context="'+choiceMode+'">条件をリセット</button></div>'}</div>${pageControls('choice-page',choicePage,pages)}`;
  }

  function pickOfficer(mode,target,page=1){
    choiceMode=mode==='army'?'army':'governor';choiceTarget=target;choicePage=page;
    modal(choiceMode==='army'?'出陣する将を選ぶ':'奉行を任命する',choiceMode==='army'?'編成には指示を使いません。':`${game.governorDescription?.(target)||governorHelp[target]||'施設の働きを高めます。'}任命時の指令・金銭は不要です。任命中の給与は金銭${num(data.maintenance.governorMonthlyGold)}／月。在任時間に応じて支払います。`,officerFilterToolbar(choiceMode,choiceFilters[choiceMode])+`<div id="officer-choice-results">${officerChoiceResults()}</div>`,`<button class="button ghost" data-action="${choiceMode==='army'?'remove-army':'remove-governor'}" data-target="${target}">任命を解除</button><button class="button" data-action="close">閉じる</button>`,'officer-select',{mode:choiceMode,target});
  }
  function researchAvailability(id,{cost,writable=canMutate()}={}){
    const s=state(),tech=data.techs.find(t=>t.id===id),level=s.tech[id]||0;
    if(!tech)return{ok:false,state:'waiting',label:'研究を確認',reason:'技術が見つかりません。'};
    if(level>=tech.max)return{ok:false,state:'completed',label:'修得完了',reason:'この技術はすべての段階を修得しています。'};
    const active=s.jobs.find(job=>job.kind==='research');
    if(active?.id===id)return{ok:false,state:'running',label:'研究中',reason:'この技術を研究しています。完成までの時間を確認できます。'};
    if(s.gameOver)return{ok:false,state:'waiting',label:'戦役が終了しています',reason:'本拠を失いました。新しい物語を始めると研究できます。'};
    if(game.isStaff&&!staffConstructionReady())return{ok:false,state:'waiting',label:'共同拠点を確認',reason:'京都御所の共同拠点を確認してから研究できます。'};
    if(level>=s.buildings.academy)return{ok:false,state:'locked',label:'学問所の増築が必要',reason:`学問所をLv.${level+1}以上にすると、次の段階を研究できます。`};
    if(active){const name=data.techs.find(t=>t.id===active.id)?.name||'現在の研究';return{ok:false,state:'waiting',label:'ほかの技術を研究中',reason:`「${name}」の完成後に開始できます。研究は同時に1つまでです。`};}
    if(!saveEnabled)return{ok:false,state:'waiting',label:'保存状態の確認が必要',reason:'現在の進行を保存できる状態にしてから研究できます。'};
    if(!writable&&!window.SengokuSyncNotices?.isTransientStatus?.(syncAccess))return{ok:false,state:'waiting',label:'操作できる端末を確認',reason:'この端末で最新の進行を確認してから研究できます。'};
    if(s.command<1)return{ok:false,state:'waiting',label:'指令の回復待ち',reason:'指令が1回必要です。1倍速では20秒ごとに1回復します。'};
    const price=cost||game.researchCost(id),missing=Object.keys(resNames).filter(key=>s.resources[key]<(price?.[key]||0));
    if(missing.length)return{ok:false,state:'waiting',label:'資源が不足',reason:`${missing.map(key=>resNames[key]).join('・')}が不足しています。上の費用欄で不足量を確認できます。`};
    return{ok:writable,state:'available',label:'研究を始める',reason:'指令1回を使い、表示された工期で研究します。'};
  }
  function renderResearch(){
    const s=state(),totalLevels=data.techs.reduce((sum,t)=>sum+t.max,0),learnedLevels=data.techs.reduce((sum,t)=>sum+Math.min(t.max,s.tech[t.id]||0),0),completed=data.techs.filter(t=>(s.tech[t.id]||0)>=t.max).length,active=data.techs.find(t=>currentJob('research',t.id));
    const illustrations={cultivation:'irrigation',commerce:'market',forestry:'sawmill',masonry:'stoneworks',conscription:'barracks',discipline:'war_school',gunnery:'gunsmith',siege:'engineering_shop'};
    return heading('技術研究','RESEARCH · 富国強兵','学問を育て、内政と軍事に新たな力を。')+`<section class="research-overview" aria-label="技術研究の進捗"><div class="research-overview-copy"><span class="eyebrow">知を積み重ね、国を強く。</span><h2>領国の技術を磨く</h2><p>技術レベルは学問所のレベルまで。研究は同時に1つ、各技術は最大Lv.5です。</p><button class="button gold" data-action="building" data-id="academy">${icon('book')}学問所を確認・増築</button></div><div class="research-overview-metrics"><div><span>修得した段階</span><strong>${learnedLevels}<small> / ${totalLevels}</small></strong><div class="progress" aria-hidden="true"><i style="width:${totalLevels?learnedLevels/totalLevels*100:0}%"></i></div></div><div><span>極めた技術</span><strong>${completed}<small> / ${data.techs.length}</small></strong></div><div><span>学問所</span><strong><small>Lv.</small>${s.buildings.academy}</strong></div><div class="research-current"><span>現在の研究</span><b>${active?esc(active.name):'研究待ち'}</b></div></div></section><div class="research-grid">${data.techs.map(t=>{const lv=s.tech[t.id]||0,job=currentJob('research',t.id),cost=game.researchCost(t.id),max=lv>=t.max,artId=illustrations[t.id]||'academy',availability=researchAvailability(t.id,{cost}),status=availability.state;return `<section class="research-card research-illustrated-card" data-research-state="${status}" data-research-card="${t.id}" data-art-theme="research"><div class="research-visual" aria-hidden="true">${window.SengokuArt?.facility(artId,'research-art',Math.max(1,s.buildings[artId]||1))||icon(t.icon)}<span class="research-state" data-research-state-label>${esc(availability.state==='available'?'次の研究へ':availability.label)}</span></div><div class="research-card-copy"><div class="research-card-heading">${icon(t.icon)}<h3>${esc(t.name)}</h3></div><p>${esc(t.description)}</p><div class="stat-row"><span>研究レベル</span><b>Lv.${lv} / ${t.max}</b></div><div class="research-levels" aria-label="研究レベル${lv}、最大${t.max}">${Array.from({length:t.max},(_,level)=>`<span class="${level<lv?'is-learned':''}" aria-hidden="true">${level+1}</span>`).join('')}</div>${max?'<p class="notice research-completed">すべての段階を修得しました。</p>':job?`<div class="notice">研究中 · <span data-job-clock="${jobKey(job)}">${esc(jobClockText(job))}</span>${sharedJobAttribution(job)}</div><div class="progress"><i data-job-progress="${jobKey(job)}" style="width:${game.constructionProgress(job)}%"></i></div>`:`${costHtml(cost)}<button class="button ${availability.state==='available'?'gold':''} full" data-action="research" data-id="${t.id}" aria-describedby="research-reason-${t.id}"${availability.ok?'':' disabled'}>${esc(availability.label)}</button><p class="research-action-reason" id="research-reason-${t.id}">${esc(availability.reason)}</p><button type="button" class="button small full" data-action="resource-planner" data-kind="research" data-id="${esc(t.id)}">${icon('coins')}資源が揃う目安</button>`}</div></section>`;}).join('')}</div>`;
  }
  function questResults(){
    const all=data.quests.map((quest,index)=>{const status=game.questStatus(quest.id);return{quest,index,status,kind:status.claimed?'claimed':status.complete?'ready':'progress'};}),counts={all:all.length,ready:0,progress:0,claimed:0};
    for(const row of all)counts[row.kind]++;
    const priority={ready:0,progress:1,claimed:2},list=all.filter(row=>questState==='all'||row.kind===questState).sort((a,b)=>priority[a.kind]-priority[b.kind]||a.index-b.index),pages=Math.max(1,Math.ceil(list.length/4));
    questPage=Math.max(1,Math.min(questPage,pages));
    const empty=questState==='ready'?'受け取れる報酬はまだありません。':questState==='claimed'?'受け取った報酬はまだありません。':'挑戦中の任務はありません。';
    const rows=list.slice((questPage-1)*4,questPage*4).map(({quest:q,status:a,kind})=>`<section class="quest-row" data-stable-key="quest-${q.id}" data-quest-state="${kind}"><div class="quest-emblem">${icon(a.claimed?'check':a.complete?'crown':'flag')}</div><div class="quest-content"><span class="quest-progress-label">${kind==='ready'?'達成・報酬未受取':kind==='claimed'?'達成・受取済み':'挑戦中'}</span><h3>${esc(q.name)}</h3><p>${esc(q.description)} ${a.progress} / ${a.target}</p><div class="progress"><i style="width:${a.target>0?Math.min(100,a.progress/a.target*100):0}%"></i></div></div><div class="quest-reward">${Object.keys(q.reward).map(k=>`${k==='magatama'?'勾玉':resNames[k]} +${num(q.reward[k])}`).join('<br>')}</div><button class="button small ${kind==='ready'?'gold':''}" data-action="claim-quest" data-id="${q.id}"${kind==='ready'?'':' disabled'}>${a.claimed?'受取済み':a.complete?'報酬を受け取る':'挑戦中'}</button></section>`).join('');
    return `<div class="section-heading" style="margin-top:0"><h2>${icon('target')}領主の任務</h2><small>受取可能 ${counts.ready}件 · 受取済み ${counts.claimed} / ${counts.all}件</small></div>${catalogChips('quest',questState,[['all',`すべて ${counts.all}`],['ready',`受取可能 ${counts.ready}`],['progress',`挑戦中 ${counts.progress}`],['claimed',`受取済み ${counts.claimed}`]])}<div class="quest-list">${rows||`<div class="empty catalog-empty"><p>${empty}</p><button type="button" class="button" data-action="catalog-reset" data-kind="quest">すべての任務を表示</button></div>`}</div>${pageControls('quest-page',questPage,pages,`${list.length}件`)}`;
  }
  function renderCouncil(){
    const s=state(),logPages=Math.max(1,Math.ceil(s.log.length/5));logPage=Math.max(1,Math.min(logPage,logPages));
    return heading('軍議','COUNCIL · 進むべき道','功績を重ね、天下への歩みを記す。')+strategyEntry()+`<div class="council-grid"><section id="quest-results">${questResults()}</section><section><div class="section-heading"><h2>${icon('scroll')}領国の戦記</h2><button class="text-link" data-action="export-save">この戦記を保存</button></div><section class="panel log-panel">${s.log.slice((logPage-1)*5,logPage*5).map(l=>`<div class="activity-item"><small>${shortDate(l.turn)}</small><p>${esc(logText(l.text))}</p></div>`).join('')}</section>${pageControls('log-page',logPage,logPages)}</section></div>`;
  }


  let battleAdviceStyle='balanced',battleAdviceBinding=null;
  let battleAdviceReserves={reserveTroops:0,reserveRice:0};
  function currentBattleAdvice(){
    return game.adviseBattle({mode:battleBranchTarget?'branch':'castle',targetId:battleBranchTarget||battleTarget,style:battleAdviceStyle,...battleAdviceReserves});
  }
  function renderBattleAdvisor(){
    const host=$('#battle-advisor-slot');
    if(!host||!window.SengokuBattleAdvisor)return;
    const reserves={...battleAdviceReserves,troops:game.state.troops,rice:game.state.resources.rice,assetCap:game.data.assetCap};
    window.SengokuBattleAdvisor.render(host,currentBattleAdvice(),{action:'battle-apply',reserves});
  }
  function mountBattleAdvisor(){
    battleAdviceBinding?.dispose();battleAdviceBinding=null;const host=$('#battle-advisor-slot'),advisor=window.SengokuBattleAdvisor;if(!host||!advisor)return;
    renderBattleAdvisor();battleAdviceBinding=advisor.bind(host,{action:'battle-apply',getAdvice:()=>activeModal==='battle'?currentBattleAdvice():null,onApply(advice){if(activeModal!=='battle')return;battleTactic=advice.tactic;battleTroops=advice.troops;const tactic=$('#battle-tactic');if(tactic)tactic.value=battleTactic;updateBattlePreview();toast('軍師の案を反映しました。出陣内容を確認してください。');},onReserveChange(reserves){
      if(activeModal!=='battle')return;
      battleAdviceReserves=reserves;
      renderBattleAdvisor();
      toast('兵と兵糧を残す条件で再提案しました。軍師の案を確認してください。');
    },onStyleChange(style){battleAdviceStyle=style;renderBattleAdvisor();},onUnavailable(advice){renderBattleAdvisor();if(advice?.message)toast(advice.message);}});
  }
  function battleModal(id,preserve=false,branchId=''){syncMusic('battle');const c=game.castle(id);if(!c)return;battleTarget=id;battleBranchTarget=branchId;if(!preserve){battleTactic='balanced';battleTroops=state().troops;battleAdviceReserves={reserveTroops:0,reserveRice:0};}const p=branchId?game.previewBranchBattle(branchId,battleTactic,battleTroops):game.previewBattle(id,battleTactic,battleTroops),targetName=branchId?window.SengokuBranches?.name?.(game,branchId)||'支拠点':c.name;modal(`${targetName}への出陣`,`${c.owner} · ${c.province}国`,`<div class="stat-comparison"><div><small>出陣する兵</small><b id="battle-troop-count" class="large-stat">${num(battleTroops)}</b><small>${state().army.map(i=>esc(game.officer(i)?.name)).join('・')||'武将未任命'}</small></div><span class="versus">対</span><div><small>${branchId?'支拠点を守る兵':'城を守る兵'}</small><b id="battle-enemy-count" class="large-stat">${num(branchId?p.enemyTroops:c.troops)}</b><small id="battle-enemy-wall">${branchId?'支拠点 Lv.'+(p.branchLevel||0):'城郭 Lv.'+c.level+' · 城壁 Lv.'+c.wall}</small></div></div>${durabilityMarkup(branchId?game.branch(branchId):c,branchId?'branch':'castle',{label:'相手拠点の耐久'})}${window.SengokuOfficerHealthUI?.armyMarkup(game)||''}<div class="form-row"><label for="battle-troops" class="inline-label"><span>出陣兵数</span><span>${num(battleTroops)} / ${num(state().troops)}人</span></label><input id="battle-troops" class="range" type="range" min="${Math.min(300,state().troops)}" max="${state().troops}" step="1" value="${battleTroops}"></div><label for="battle-tactic">戦法を選ぶ</label><select id="battle-tactic" class="select">${data.tactics.map(t=>`<option value="${t.id}" ${battleTactic===t.id?'selected':''}>${esc(t.name)} — ${esc(t.description)}</option>`).join('')}</select><div id="battle-advisor-slot"></div><div style="margin:18px 0" id="battle-preview">${battlePreview(p)}</div>${branchId?'<p class="branch-battle-note">支拠点を落としてから本城へ進軍します。支拠点戦では領地の占領・資源の獲得はありません。</p>':''}<div class="notice">出陣は指示1回を使います。合戦では兵を失うことがあります。勝率は戦力差による予測で、勝利の保証ではありません。</div>`,`<button class="button" data-action="close">再考する</button><button id="attack-confirm" class="button primary" data-action="${branchId?'attack-branch':'attack'}" ${!p.ok?'disabled':''}>${icon('swords')}出陣する</button>`,'battle');mountBattleAdvisor();}
  function battlePreview(p){return `${window.SengokuTravelUI?.preview(p.travel)||''}<div class="battle-chance">予想勝率 <b>${p.winChance}%</b></div><div class="stat-row"><span>自軍戦力 / 敵軍戦力</span><b>${num(p.attackPower)} / ${num(p.defensePower)}</b></div><div class="cost"><span>${icon('wheat')}兵糧 ${num(p.foodCost)}</span>${p.scouted?`<span>${icon('eye')}偵察補正 +10%</span>`:''}</div>${!p.ok?`<p style="color:#e7a194;font-size:13px">${esc(p.message)}</p>`:''}`;}
  function updateBattlePreview(){if(!$('#battle-preview'))return;const c=game.castle(battleTarget),s=state(),slider=$('#battle-troops');battleTroops=Math.max(0,Math.min(battleTroops,s.troops));if(slider){slider.min=Math.min(300,s.troops);slider.max=s.troops;if(Number(slider.value)!==battleTroops)slider.value=battleTroops;}const p=battleBranchTarget?game.previewBranchBattle(battleBranchTarget,battleTactic,battleTroops):game.previewBattle(battleTarget,battleTactic,battleTroops);patchHTML($('#battle-preview'),battlePreview(p));$('#battle-troop-count').textContent=num(battleTroops);$('#attack-confirm').disabled=!p.ok;if(c){$('#battle-enemy-count').textContent=num(battleBranchTarget?p.enemyTroops:c.troops);$('#battle-enemy-wall').textContent=battleBranchTarget?`支拠点 Lv.${p.branchLevel||0}`:`城郭 Lv.${c.level} · 城壁 Lv.${c.wall}`;const subtitle=$('#modal .modal-header p');if(subtitle)subtitle.textContent=`${c.owner} · ${c.province}国`;}const label=$('label[for="battle-troops"]');if(label)patchHTML(label,`<span>出陣兵数</span><span>${num(battleTroops)} / ${num(s.troops)}人</span>`);renderBattleAdvisor();}
  function branchBattleResult(b){syncMusic(b.won?'victory':'defeat');modal(b.won?'支拠点陥落の報せ':'支拠点から撤退',`${shortDate()} · ${b.castleName}`,`<div class="battle-result ${b.won?'':'lost'}"><h2>${b.won?'支拠点を突破':'退却'}</h2><p>${b.won?'残る支拠点をすべて落とすと、本城へ出陣できます。':'兵を立て直し、次の機会をうかがいましょう。'}</p></div><p class="branch-battle-note">この戦いでは領地の占領・資源の獲得はありません。</p><div class="stat-row"><span>出陣兵数</span><b>${num(b.ourBefore)}人</b></div><div class="stat-row"><span>自軍の損失</span><b>${num(b.ourLost)}人</b></div><div class="stat-row"><span>帰還兵</span><b>${num(Math.max(0,b.ourBefore-b.ourLost))}人</b></div>${window.SengokuDurabilityUI?.battleMarkup(b.durability)||''}<div class="battle-phases">${(b.phases||[]).map(phase=>`<div class="battle-phase"><b>${esc(phase.title)}</b><p>${esc(phase.text)}</p></div>`).join('')}</div>`,`<button class="button primary" data-action="close">地図へ戻る</button>`,'result');}
  function battleResult(b){syncMusic(b.won?'victory':'defeat');modal(b.won?'戦勝の報せ':'撤退の報せ',`${shortDate()} · ${b.castleName}`,`<div class="battle-result ${b.won?'':'lost'}"><div class="eyebrow">${b.won?'VICTORY':'RETREAT'}</div><h2>${b.won?'勝鬨':'退却'}</h2><p class="subtitle">${b.won?`${esc(b.castleName)}があなたの領国に加わりました。`:'兵を立て直し、次の機会をうかがいましょう。'}</p></div><div class="stat-comparison"><div><small>自軍の損失</small><b class="large-stat">${num(b.ourLost)}</b><small>出陣 ${num(b.ourBefore)}人</small></div><span class="versus">/</span><div><small>敵軍の損失</small><b class="large-stat">${num(b.enemyLost)}</b><small>守備 ${num(b.enemyBefore)}人</small></div></div><div class="stat-row"><span>城の守備隊へ配置</span><b>${num(b.garrison||0)} 人</b></div><div class="stat-row"><span>出陣軍から帰還</span><b>${num(Math.max(0,b.ourBefore-b.ourLost-(b.garrison||0)))} 人</b></div><p class="subtitle">帰還兵は待機兵に戻ります。新領地の守備兵は、出陣できる兵数と別に管理します。</p>${window.SengokuDurabilityUI?.battleMarkup(b.durability)||''}<div class="battle-phases">${(b.phases||[]).map(p=>`<div class="battle-phase"><b>${esc(p.title)}</b><p>${esc(p.text)}</p></div>`).join('')}</div>${b.rewards?.gold||b.rewards?.rice?`<h3>戦利品</h3>${costHtml(b.rewards)}`:''}${b.capturedOfficer?`<div class="notice">${esc(typeof b.capturedOfficer==='string'?(game.officer(b.capturedOfficer)?.name||b.capturedOfficer):b.capturedOfficer.name)}が家臣に加わりました。</div>`:''}`,`<button class="button primary" data-action="close">領国へ戻る</button>`,'result');}
  function settingsModal(){
    const settingAction=(action,name,description,symbol,extra='')=>`<button class="button settings-action" data-action="${action}" ${extra}>${icon(symbol)}<span><strong>${name}</strong><small>${description}</small></span></button>`;
    const group=(id,name,description,symbol,body,open=false)=>`<details class="settings-group" id="settings-${id}" ${open?'open':''}><summary>${icon(symbol)}<span><strong>${name}</strong><small>${description}</small></span><span class="settings-disclosure" aria-hidden="true"></span></summary><div class="settings-group-body">${body}</div></details>`;
    const sound=`<div class="settings-sound-controls"><div class="settings-music"><div class="settings-row settings-audio-row"><div><strong>BGM</strong><small>全20曲・トップは支度、ゲーム内は朝昼夜</small></div><button class="button ${settings.sound?'':'gold'} small" data-action="sound-settings">${musicStatusText()} · ${settings.sound?'停止':'再生'}</button></div><div class="settings-row settings-volume"><label for="volume">BGM音量</label><input id="volume" type="range" min="0" max="100" step="1" value="${settings.volume}" aria-label="BGM音量"><output for="volume" id="settings-volume-value">${settings.volume}%</output></div><button class="button small" data-action="music-resume" ${settings.sound&&(musicWaitingForGesture||musicFailure)?'':'hidden'}>BGMを再生</button><button class="button full" data-action="music">${icon('sound')}音楽帳で曲を選ぶ</button><p class="settings-explanation">起動時にBGMの再生を試みます。ブラウザの許可待ちでは、画面を操作すると再生を試みます。停止・音量の設定は次回も保持します。</p></div><section class="settings-effects" aria-labelledby="effects-volume-label"><div class="settings-row settings-audio-row"><div><strong id="effects-volume-label">サウンド（効果音）</strong><small>操作・招集・結果確認の音を調整</small></div><button type="button" class="button small" data-sound-preview${settings.effectsVolume===0?' disabled':''}>音を試す</button></div><div class="settings-row settings-volume"><label for="effects-volume">効果音量</label><input id="effects-volume" type="range" min="0" max="100" step="1" value="${settings.effectsVolume}" aria-label="サウンド（効果音）の音量" aria-describedby="effects-volume-help"><output for="effects-volume" id="settings-effects-volume-value">${settings.effectsVolume}%${settings.effectsVolume===0?'・消音':''}</output></div><p id="effects-volume-help" class="settings-explanation">BGMとは別に調整できます。0%で効果音を消音します。この端末の設定は次回も保持します。通話中・別タブでは一時停止します。</p><p class="settings-effects-feedback" data-sound-feedback role="status" aria-live="polite"></p></section></div>${window.SengokuPresentation?.settingsMarkup?.()||''}<div class="settings-row"><label for="tips">城下町のヒント</label><select id="tips" class="select"><option value="on" ${settings.tips?'selected':''}>表示する</option><option value="off" ${settings.tips?'':'selected'}>表示しない</option></select></div>`;
    const saves=`<p class="settings-explanation">${syncAccess.linked?'領主の進行を、連携した端末間で引き継ぎます。同時に操作できる端末は1台です。':'このブラウザに進行を自動保存します。端末を変える前に、バックアップを書き出してください。'}</p><div class="settings-stack">${settingAction('export-complete-backup','領主と進行をまとめて書き出す','ログイン情報とセーブを一つのバックアップへ。','save')}${settingAction('open-recovery','引き継ぎ・データ復元','機種やドメインが変わった後、元の領主と進行へ。','upload')}${settingAction('open-sync','端末同期・引き継ぎ','端末の接続と引き継ぎを管理。','refresh')}</div><details class="settings-secondary"><summary>セーブファイルの個別操作</summary><div class="settings-stack">${settingAction('export-save','セーブデータを書き出す','現在の戦役をJSONファイルで保存。','download')}${settingAction('import-save','セーブデータを読み込む','内容を確認してから現在の進行へ反映。','upload')}${settingAction('export-sync-backup','同期・読込前のセーブを取り出す','置き換え前のバックアップを書き出す。','download')}</div></details><p class="settings-explanation">通信が切れても世界の時間は進み、再接続時に共通時刻へ追いつきます。接続の確認中は操作が待機します。</p>`;
    const convenience=`<div class="settings-stack">${settingAction('notifications','通知設定','合戦・書状・普請などを選択。静かな時間帯は日本時間で設定。','bell')}${settingAction('progress','成長手帳・留守中の報告','任務、編成セット、武将育成、歴代記録を確認。','book','data-tab="recap"')}${settingAction('walking','ウォーキング','歩数に応じて、5つの資産が増えます。','walking')}${settingAction('open-gacha','武将招集・勾玉',`所持 ${num(state().magatama)} · プレイで集める専用通貨。`,'magatama')}${settingAction('premium','有料版・支援','外観を見比べ、購入した装いを管理。','flag','aria-haspopup="dialog"')}${settingAction('install','ホーム画面に追加','スマホからアプリのように起動。','plus')}</div>`;
    const campaign=`<div class="settings-row"><span>現在の難易度</span><strong>${({easy:'初陣',normal:'戦国',hard:'修羅'})[state().difficulty]}</strong></div><p class="settings-explanation">各資産の所有上限は100,000,000です。施設の収容量と1回の出陣人数には別の上限があります。</p>${game.isAdmin?`<div class="notice admin-fixed-base">${icon('castle')}<strong>本拠：江戸城（固定）</strong><br>武将・施設・資源は連携した端末へ引き継ぎます。</div>${settingAction('restore-admin-assets','徳川家康 U を復元','資格を確認済み。重複して付与されません。','crown')}`:''}<div class="settings-new-campaign"><p>新しい勢力・難易度で始める場合は、次の画面で内容を確認できます。</p><button class="button danger full" data-action="new-game">${icon('refresh')}新しい物語を始める</button></div>`;
    const updatePanel=`<section id="settings-release-update" class="settings-group-body settings-stack" aria-labelledby="settings-release-heading"><div><h3 id="settings-release-heading">ゲームの更新</h3><span id="settings-release-version"></span></div><div class="settings-stack"><button type="button" id="settings-release-check" class="button small" disabled>更新を確認</button><button type="button" id="settings-release-open" class="button primary small" hidden>保存して新版を開く</button></div><p id="settings-release-status" role="status"></p></section>`;
    modal('保存・設定','音・表示、引き継ぎ、便利な機能をまとめて管理。',`${saveWarning?`<div class="notice" role="alert">${esc(saveWarning)}</div>`:''}<div class="settings-hub">${updatePanel}${group('appearance','音・表示','BGM・効果音・演出・城下町のヒント','sound',sound,true)}${group('save','保存・引き継ぎ','バックアップ・端末同期・データ復元','save',saves)}${group('features','便利な機能','通知・成長手帳・ウォーキング・外観','flag',convenience)}${group('campaign','戦役の設定','難易度の確認・新しい物語','castle',campaign)}</div>`,`<button class="button" data-action="help">遊び方</button><button class="button primary" data-action="close">ゲームへ戻る</button>`,'settings');
    window.SengokuUpdates?.renderSettings();
  }
  function helpModal(){modal('天下への道しるべ','月を重ね、城を育て、将とともに天下へ。',`<div class="help-steps">${[['城下を育てる','田畑は兵糧、商家は金銭を生みます。施設を選んで増築すると表示された秒数で完成。木材と石材も計画的に確保しましょう。強化時の資源は、領有1城で1倍、2城で2倍、3城で4倍、4城で8倍、5城以降は16倍です。施設維持費の単価は変わりません。'],['武将を迎える','名鑑から武将を登用するほか、勾玉で武将招集ができます。勾玉は毎月・任務・城の初攻略で集まります。軍団に最大3名を編成。政治の高い家臣は各施設の奉行に任命し、生産・登用・募兵・防衛・研究を支えます。奉行の給与は1人あたり月額50の金銭で、在任時間に応じて支払います。'],['時を味方にする','資源は毎秒、普請と研究は実時間で進みます。1倍速では指令が20秒ごとに1回復し、60秒がゲーム内の1か月です。時間は全プレイヤー共通。1560〜1615年を周回し、画面を閉じていても進みます。再接続時に経過した分を反映します。速度・停止は全員共通です。'],['拠点の耐久を守る','すべての城・大都市・支拠点に耐久があります。攻城戦で損傷すると城壁などの防御効果が弱まり、自領の城と稼働中の支拠点は、月替わりに最大耐久の10%まで修復します。回復100につき木材5・石材4を消費し、資材不足時は回復量を抑えます。占領直後は25%から復旧し、陥落した支拠点は修復工事が必要です。'],['軍備を整える','募兵と訓練で兵数と士気を確保します。現在保有する兵には金銭・兵糧の維持費がかかります。完成した施設・城の維持費は金銭・兵糧・木材・石材から差し引かれます。ゲーム内の月替わりに1回、金銭・兵糧の月間収支が赤字なら、手持ち・本拠を優先した城の守備兵・支拠点の順に必要な兵数を自動調整し、その分の兵士維持費も減ります。月の途中では自動減兵しません。軍団や城下普請帳の「毎月の収支」で内訳を確認できます。'],['兵士を輸出入する','交流の交易で、兵士の人数と対価を指定して他の領主と輸出入できます。無償の移送も可能です。輸出兵は提案時に預け、相手の承認で移動します。取消・拒否の兵士は受取待ちに戻ります。輸入・返還は募兵上限とは別枠で受け入れ、本隊と出陣中の兵を合わせた保有上限を確認します。'],['野良兵士と戦う','野良兵戦でCPU部隊を選び、出陣兵数と戦法を決めます。指令1と兵糧を消費し、勝利すると資源や勾玉を獲得します。戦闘では兵の損失が発生します。城の所有は変わりません。'],['天下を切り拓く','天下地図で自領に隣接する城を選び、出陣兵数と戦法を決定。偵察や6か月の同盟も活用して保護された江戸城・京都御所を除く城の統一を目指します。自分の役職で領有できる城の数は画面に表示されます。'],['領主と向き合う','共通フィールドには実際のプレイヤーの本拠と、所領の二条・大坂・名古屋が表示されます。拠点を選んで出陣し、この3都市は勝利すると領有できます。外交が成立した6か月間は互いに攻撃できません。江戸城・京都御所の報酬戦にも挑戦でき、勝利時は戦勝報酬を得ます。この2城は占領されません。'],['戦記を守る','端末を連携すると進行を自動同期します。連携前の自動保存や、設定からのセーブ書き出しも利用できます。同じ領主IDを連携した端末へ引き継げます。']].map(([t,p])=>`<div class="help-step"><div><h3>${t}</h3><p>${p}</p></div></div>`).join('')}</div><div class="notice">天下地図はCPU勢力との戦役です。共通フィールドでは他プレイヤーの拠点を選び、襲撃や合意に基づく外交ができます。年月・接続状況・交流も全員で共有します。実在の人物・城を題材に、年代・能力・外交・合戦をゲーム向けに再構成しています。</div>`,`<button class="button primary" data-action="close">城下町へ</button>`,'help');}
  function aboutModal(){const sourceInfo=window.SENGOKU_ROSTER_META;modal('ゲーム概要・収録情報','戦国VS · KASAI SOLUTIONS',`<h3>城下町を育て、武将を編成する戦国ブラウザゲーム</h3><p>「戦国VS」は、KASAI SOLUTIONSによる戦国ブラウザゲームです。はじまりの城を選び、城下町の施設を連続増築し、武将を編成して領国を発展させます。PC・スマートフォン・タブレットで遊べます。</p><p>全員共通の年月のもと、天下地図でのCPU勢力の城攻略、共通フィールドでの外交、同盟の資産共有、領主や所属同盟への書状を楽しめます。軍師AIの自動進軍、対応端末でのウォーキング報酬、領主を連携した端末間の自動同期にも対応しています。</p><p class="subtitle"><a href="about/" target="_blank" rel="noopener">詳しいゲーム概要・制作方針</a> · <a href="guide/" target="_blank" rel="noopener">遊び方と各機能の条件</a></p><h3>収録人物</h3><p>戦国から織豊期を中心に${num(roster.length)}名、${new Set(roster.map(o=>o.clan)).size}勢力の人物を収録しています。史料に残る武将を一人残らず網羅した名簿ではありません。人物の改名は原則として同一人物にまとめています。</p><h3>歴史とゲームの関係</h3><p>本作は256名の人物・${data.castles.length}城・64施設が登場する「群雄集結」です。通常城と64施設は最大Lv.32、二条・大坂・名古屋の城郭はLv.48、江戸城の城郭はLv.64、京都御所はLv.128まで育成できます。城の姿は32段階で、Lv.33以降も最終形態を使用します。城郭${num(data.castles.length*32)}種・施設2,048種の段階別イラストがあります。武将絵巻と合わせて全${num(window.SengokuArt?.totalIllustrations||8224)}種を収録し、支度・朝活・昼活・夜活の4曲と、従来のオリジナルBGM16曲を収録しています。異なる年代の人物と城が同時に登場します。能力値・格付け・特技・城の勢力配置・施設効果はすべてゲーム用の創作です。武将1名につき8ランク、計2,048種の創作肖像を閲覧・収集できます。肖像は実際の容姿を示すものではありません。</p><h3>資料</h3><ul class="about-links">${(sourceInfo?.sources||[]).map(x=>`<li><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a></li>`).join('')}</ul><p class="subtitle"><a href="SOURCES.md" target="_blank" rel="noopener">人物資料</a>・<a href="SOURCES-MAP.md" target="_blank" rel="noopener">地図の出典</a>・<a href="SOURCES-KAMON.md" target="_blank" rel="noopener">家紋の出典</a>を確認できます。</p><hr class="divider"><p class="subtitle">ゲーム内城下町：オリジナル生成イラスト<br>音楽：トップメニュー・時間帯別の提供音源4曲と、本作のために作曲・編曲した16曲<br>著作権：© KASAI SOLUTIONS</p>`,`<button class="button primary" data-action="close">閉じる</button>`,'about');}
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
    modal(startPending?'はじまりの城を選ぶ':'新しい物語',game.isAdmin?'出発点は、江戸城に固定されています。':game.isStaff?'徳川家として、共同本拠の京都御所から出発します。':'領主として旗を掲げるか、家臣として城を支える。',`${startPending?`<div class="start-recovery-row"><span>以前のプレイを続ける方はこちら</span><button class="button small" data-action="open-recovery">${icon('upload')}以前の領主を復元</button></div>`:''}<div class="new-campaign-layout"><section class="new-campaign-house"><h3>仕える家</h3><p class="new-campaign-help">${special?'家は徳川家に固定されています。':'個人の武将と家の特性を選びます。プレイヤーの家臣として入城しても、自分の武将・資源を育てます。'}</p><div class="clan-select-grid">${houses.map(c=>`<button class="clan-choice ${newClan===c.name?'active':''}" data-action="choose-clan" data-id="${c.name}" aria-pressed="${newClan===c.name}">${clanCrest(c.name,38)}<span><b>${esc(c.name)}</b><small>${esc(c.leader)}</small></span></button>`).join('')}</div><div class="start-clan-bonus">${clanCrest(clan.name,25)}<strong>${esc(clan.bonus)}</strong></div><div class="form-row"><label for="new-difficulty">難易度</label><select id="new-difficulty" class="select">${[['easy','初陣 — 初めての領主へ'],['normal','戦国 — ほどよい緊張感'],['hard','修羅 — 手強い群雄との戦い']].map(([v,n])=>`<option value="${v}" ${difficulty===v?'selected':''}>${n}</option>`).join('')}</select></div></section><section class="new-campaign-castle"><h3>${retainer&&!special?'家臣として仕える城を選ぶ':'はじまりの城'}</h3>${special?`<p class="new-campaign-help">${game.isAdmin?'本拠は江戸城です。':'本拠は保護された京都御所です。共同で城郭・城下町を育てます。'}</p>`:`<div class="residency-choice-modes" aria-label="城への参加方法"><button type="button" class="button" data-action="choose-residency-mode" data-id="lord" aria-pressed="${newResidencyMode==='lord'}" ${newResidencyDirectory?.full?'disabled':''}>領主として入城</button><button type="button" class="button" data-action="choose-residency-mode" data-id="retainer" aria-pressed="${retainer}">家臣として参加</button>${linked?'':'<button type="button" class="button" data-action="choose-residency-mode" data-id="local" aria-pressed="'+local+'">端末だけで遊ぶ</button>'}</div><p id="residency-start-status" class="residency-start-status ${!local&&newResidencyError?'is-error':''}" role="status">${esc(local?'この端末の個人の戦役です。共有フィールドの領主の席は確保しません。':status)}</p>${newResidencyError&&!local?'<button type="button" class="button small" data-action="residency-retry">入城状況を再確認</button>':''}<label for="new-start-castle" class="new-campaign-help">${retainer?'仕える城':'本拠にする城'}を一つ選択 · ${rows.length}城</label><select id="new-start-castle" class="select" required aria-describedby="start-castle-rule"><option value="" ${!rows.some(c=>c.castleId===newStartCastle)?'selected':''} disabled>城を選んでください</option>${regions.map(region=>`<optgroup label="${esc(region)}">${rows.filter(c=>c.region===region).map(c=>`<option value="${c.castleId}" ${newStartCastle===c.castleId?'selected':''}>${esc(c.castleName)}（${esc(c.province)}国）${retainer?' · '+esc(c.lord?.name||'領主')+' · 家臣'+num(c.retainerCount)+'人':''}</option>`).join('')}</optgroup>`).join('')}</select>`}<div id="start-castle-preview" class="start-castle-preview" aria-live="polite">${startCastlePreview()}</div><p id="start-castle-rule" class="new-campaign-help">${game.isAdmin?'徳川家康 U の特別イラストを所持して開始します。':game.isStaff?'徳川家の京都御所と施設は、共同普請の現在の成長を引き継ぎます。武将・資源・研究は個人ごとに育ちます。':retainer?'この城が本拠の防衛戦で敗れると、先に仕えた家臣から順に領主を引き継ぎます。順番は入城確定時に決まります。前の領主は家臣の最後尾へ移ります。登用した武将とは別の、プレイヤー同士の所属です。':local?'未登録の進行はこの端末に保存します。共有フィールドへの入城は、領主登録時に空き城と家臣の順番を確認して決まります。':'一つの城に領主は一人です。江戸・京都御所・二条（京）・大坂・名古屋は、通常の開始城として選べません。'}</p>${!special&&!local&&!linked?'<p class="residency-start-help">共有の城で始めるには、まず「領主登録へ」で名前を登録してください。入城する城は登録後に確定します。</p>':''}</section></div><p class="start-save-notice">${startPending?'入城の確定が終わるまで、本拠と進行は保存されません。':'確定すると現在の進行を新しい物語に置き換えます。今のセーブは置き換え前のバックアップにも残します。'}</p><p id="start-campaign-sync" class="start-campaign-sync" role="status"></p>`,`<button class="button" data-action="close">${startPending?'あとで選ぶ':'やめる'}</button>${startPending?'':'<button class="button" data-action="export-save">今のセーブを保存</button>'}<button class="button primary" data-action="${!special&&!local&&!linked?'open-lord-registration':'start-new'}">${!special&&!local&&!linked?'領主登録へ':label}</button>`,'new');
    refreshLiveControls();
  }
  function canShowRelocation(){
    return !startPending&&!game.isAdmin&&!game.isStaff&&!syncAccess.banned&&!syncAccess.rolePending&&window.SENGOKU_AT_TITLE!==true;
  }
  function sameRelocationPlayer(view){
    const user=window.SengokuSocial?.getUser?.();
    return canShowRelocation()&&roleEpoch===view.epoch&&Boolean(syncAccess.linked)===view.linked&&String(user?.id||'')===view.owner;
  }
  function sameRelocationCampaign(view,saveState=state()){
    return saveState?.home===view.source&&saveState?.walking?.campaignId===view.campaign;
  }
  function relocationName(id){return data.castles.find(castle=>castle.id===id)?.name||id;}
  function relocationCommand(view){
    const sync=window.SengokuCloudSync,social=window.SengokuSocial;
    function verify(){if(!sameRelocationPlayer(view))throw Object.assign(Error('領主または操作権限が変わりました。本拠をもう一度確認してください。'),{code:'STALE_IDENTITY'});}
    return window.SengokuResidency.createRelocation({
      playerId:view.owner,storage:localStorage,uuid:()=>crypto.randomUUID(),
      writer:()=>({deviceId:sync.getDevice().id,revision:sync.getStatus().revision}),
      send:async (payload,receipt)=>{verify();const route='/castles/residency/relocate'+(receipt?'?receipt=1':'');const result=await social.residencyRequest(route,{method:'POST',data:payload});verify();return result;},
      accept:async result=>{verify();const accepted=await sync.acceptSnapshot(result,{reason:'residency-relocation'});verify();return accepted;}
    });
  }
  function relocationRole(view,row){
    if(!view.linked)return 'この端末の個人の戦役で本拠を移します。共有フィールドの所属には参加しません。';
    if(!row)return '移転確定時に空き城なら領主に、領主がいる城なら家臣になります。';
    return row.available?'現在は空き城です。確定時も空いていれば、あなたが領主になります。':`現在の領主は${row.lord?.name||'ほかのプレイヤー'}です。確定時に領主がいれば、継承順の最後尾に家臣として加わります。`;
  }
  function relocationBlock(view){
    if(!sameRelocationPlayer(view))return '領主の接続状態が変わりました。画面を閉じ、本拠を確認し直してください。';
    if(!saveEnabled)return '端末の保存領域を確認してから移転してください。';
    if(relocationBusy)return '移転の受付結果を確認しています。';
    if(fieldActionPending||walkingActionPending||strategyActionPending||worldSettlementPending)return '進行中の操作が完了すると移転を確認できます。';
    if(view.pending&&!view.resend)return syncAccess.ready?'':'端末の同期が完了すると受付結果を確認できます。';
    if(!sameRelocationCampaign(view))return '本拠が更新されました。画面を閉じ、移転元を確認し直してください。';
    if(!canMutate())return view.linked&&!syncAccess.writable?'移転の確定には操作端末が必要です。「端末同期」で操作権を確認してください。':'現在の進行を同期しています。完了すると移転できます。';
    return '';
  }
  async function loadRelocationDirectory(view,notice=''){
    view.loading=true;view.error=notice;drawRelocation(view);
    try{
      const directory=await window.SengokuResidency.loadDirectory({force:true});
      if(!directory)throw Error('城の入城状況を確認できませんでした。');
      const allowed=new Set(data.castles.filter(castle=>!castle.majorCity&&castle.id!==view.source).map(castle=>castle.id));
      view.rows=directory.castles.filter(row=>allowed.has(row.castleId));
    }catch(error){view.rows=[];view.error=error.message||'移転先を取得できませんでした。';}
    finally{view.loading=false;if(relocationView===view&&activeModal==='relocate'&&sameRelocationPlayer(view))drawRelocation(view);}
  }
  function openRelocation(){
    if(!canShowRelocation()||relocationBusy)return;
    const view={source:state().home,campaign:state().walking?.campaignId,epoch:roleEpoch,linked:Boolean(syncAccess.linked),owner:String(window.SengokuSocial?.getUser?.()?.id||''),rows:[],target:'',loading:false,error:'',pending:null};
    if(view.linked&&!view.owner||!view.linked&&view.owner){toast('領主と端末の同期を確認してから移転先を選んでください。',true);return;}
    relocationView=view;
    if(view.linked){
      try{view.command=relocationCommand(view);view.pending=view.command.pending();}
      catch(error){toast(error.message||'前回の移転記録を読み込めませんでした。',true);return;}
      if(view.pending){view.target=view.pending.castleId;drawRelocationConfirm(view);return;}
      return loadRelocationDirectory(view);
    }
    view.rows=data.castles.filter(castle=>!castle.majorCity&&castle.id!==view.source).map(castle=>({castleId:castle.id,castleName:castle.name,region:castle.region,province:castle.province}));
    drawRelocation(view);
  }
  function drawRelocation(view){
    const row=view.rows.find(c=>c.castleId===view.target),groups=[...new Set(view.rows.map(c=>c.region))];
    const options=groups.map(region=>`<optgroup label="${esc(region)}">${view.rows.filter(c=>c.region===region).map(c=>`<option value="${esc(c.castleId)}" ${c.castleId===view.target?'selected':''}>${esc(c.castleName)}（${esc(c.province)}国）${view.linked?(c.available?' · 空き城':' · 領主在城'):''}</option>`).join('')}</optgroup>`).join('');
    const body=`<p>現在の本拠は<strong>${esc(relocationName(view.source))}</strong>です。移転回数に制限はありません。</p><div class="form-row"><label for="relocate-castle-select">移転先の城</label><select class="select" id="relocate-castle-select" aria-describedby="relocate-destination" ${view.loading||!view.rows.length?'disabled':''}><option value="">城を選んでください</option>${options}</select></div><p id="relocate-destination" aria-live="polite">${esc(relocationRole(view,row))}</p><p role="status">${esc(view.loading?'各城の入城状況を確認しています。':view.error)}</p>${view.error?'<button type="button" class="button small" data-action="relocate-retry">移転先を再取得</button>':''}`;
    modal('本拠を移す','移転先を選ぶ',body,`<button type="button" class="button" data-action="close">やめる</button><button type="button" class="button primary" data-action="relocate-review" ${row?'':'disabled'}>移転内容を確認</button>`,'relocate');
  }
  function drawRelocationConfirm(view){
    const row=view.rows.find(c=>c.castleId===view.target),pending=Boolean(view.pending)&&!view.resend;
    const details=`<div class="stat-row"><span>移転元</span><strong>${esc(relocationName(view.source))}</strong></div><div class="stat-row"><span>移転先</span><strong>${esc(relocationName(view.target))}</strong></div><p>${esc(relocationRole(view,row))}</p>${view.linked?'<p>移転元で領主の場合、継承資格のある家臣が順に領主を引き継ぎます。</p>':''}<h3>引き継ぐもの</h3><p>領主名・購入済みの品、所持武将・獲得ランク・武将の育成、軍団編成と編成セットを引き継ぎます。</p><h3>新しい城で初期化するもの</h3><p>資産（金銭・兵糧・木材・石材）、兵数、勾玉は、現在の残高と開始時の額のうち少ない方になります。移転で残高は増えません。</p><p>施設・研究・領地・支拠点・戦役の進捗は初期化され、奉行の任命、進行中の工事・研究・部隊派遣が解除されます。受領済みの贈物や報酬は再支給されません。</p>`;
    const body=(pending?`<p><strong>${esc(relocationName(view.target))}</strong>への移転の受付結果を確認します。前回の受付番号で最新の本拠を取得します。</p>`:details)+`<p class="residency-start-status is-error" role="alert">${esc(view.error)}</p><p id="relocate-sync-status" role="status"></p>`;
    modal(pending?'移転結果を再確認':'移転内容を確認',pending?'送信済みの移転':`${relocationName(view.source)} → ${relocationName(view.target)}`,body,`<button type="button" class="button" data-action="close" id="relocate-dismiss">${pending?'閉じる':'やめる'}</button>${view.resend?'<button type="button" class="button" data-action="relocate-receipt">受付結果だけ再確認</button>':view.pending?'':'<button type="button" class="button" data-action="relocate-back">移転先を選び直す</button>'}<button type="button" class="button primary" data-action="relocate-confirm">${pending?'移転結果を再確認':view.resend?'同じ移転を再送する':'この城へ本拠を移す'}</button>`,'relocate-confirm');
  }
  async function commitRelocation(){
    const view=relocationView;if(!view||activeModal!=='relocate-confirm'||relocationBusy)return;
    const block=relocationBlock(view);if(block){toast(block,true);return;}
    if(!view.pending&&!view.rows.some(c=>c.castleId===view.target))return;
    let fieldLocked=false;const earlierCampaign=state().walking?.campaignId;
    try{
      let message;
      if(view.linked){
        const sync=window.SengokuCloudSync;
        const journal=view.command.pending();
        if((journal?.requestId||null)!==(view.pending?.requestId||null))throw Error('移転の受付記録が更新されました。画面を閉じて本拠を確認してください。');
        if(!view.pending&&!save({allowClockCatchup:true}))throw Error('現在の進行を保存してから移転してください。');
        relocationBusy=true;fieldActionPending=true;fieldLocked=true;refreshLiveControls();
        if(!view.pending){
          const flushed=await sync.flush();
          if(!flushed?.ok||!sync.getStatus().writable||!sameRelocationPlayer(view)||!sameRelocationCampaign(view))throw Error('最新の本拠と操作端末を確認してから移転してください。');
        }
        const {result,superseded}=await view.command.run(view.target,view.pending?.requestId||null,{resend:view.resend===true});
        if(!sameRelocationPlayer(view))return;
        const membership=window.SengokuResidency.self?.()||result.residency;
        const role=membership?.castleId===state().home?membership.role:state().home===view.target&&!superseded?result.admission.mode:null;
        message=(state().home===view.target&&!superseded?`${relocationName(view.target)}に本拠を移しました。`:`最新の本拠は${relocationName(state().home)}です。`)+(role?`現在の所属は${role==='lord'?'領主':'家臣'}です。`:'');
        void window.SengokuResidency.loadDirectory({force:true}).catch(()=>{});
      }else{
        const stored=JSON.parse(localStorage.getItem(saveKey)||'null');
        if(!sameRelocationCampaign(view,stored?.state))throw Error('この端末の本拠が更新されました。ゲームを開き直してください。');
        const candidate=SengokuEngine.fromSave(game.exportSave(),roster);
        const result=candidate.relocateResidence(view.target,{role:'lord',worldClock:confirmedWorldClock()||undefined});
        if(!result.ok)throw Error(result.message);
        backupCurrentSave('residency-relocation',true);
        localStorage.setItem(saveKey,candidate.exportSave());
        game=candidate;window.dispatchEvent(new CustomEvent('sengoku:game-saved'));
        message=`${relocationName(view.target)}に、この端末の本拠を移しました。`;
      }
      if(earlierCampaign!==state().walking?.campaignId){retireLocalWalkingContext();selectedCastle='';filter.page=1;lastRealtime=performance.now();saveCounter=0;}
      if(activeModal==='relocate-confirm'&&$('#modal').open&&relocationView===view){if(document.querySelector('.social-dialog[open]'))window.SengokuSocial?.close?.();go('town');}else render();
      toast(message);
    }catch(error){
      if(!sameRelocationPlayer(view))return;
      view.error=error.message||'移転結果を取得できませんでした。端末の同期状態を確認してください。';
      if(view.linked){try{view.pending=view.command.pending();if(view.pending)view.target=view.pending.castleId;}catch(_){}view.resend=Boolean(view.pending&&error.code==='RELOCATION_RECEIPT_PENDING');if(view.resend)view.error='まだ受付結果がありません。もう一度照会するか、移転内容を確認して同じ受付番号で再送できます。';}
      if(activeModal==='relocate-confirm'&&$('#modal').open&&relocationView===view){
        if(view.linked&&!view.pending&&Number(error.status)>=400&&Number(error.status)<500){
          view.target='';view.resend=false;await window.SengokuCloudSync.refresh().catch(()=>{});
          if(activeModal==='relocate-confirm'&&$('#modal').open&&sameRelocationPlayer(view)){
            view.source=state().home;view.campaign=state().walking?.campaignId;await loadRelocationDirectory(view,view.error);
          }
        }else drawRelocationConfirm(view);
      }else toast(view.error,true);
    }finally{
      relocationBusy=false;if(fieldLocked){fieldActionPending=false;queueWorldProgress();}refreshLiveControls();
    }
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
    game=candidate;startPending=false;retireLocalWalkingContext();worldCatchingUp=false;lastRealtime=performance.now();saveCounter=0;newStartCastle=castleId;selectedCastle='';filter.page=1;saveEnabled=true;saveWarning='';currentView='town';closeModal();history.replaceState(null,'','#town');render();$('#main').scrollTop=0;$('#main').scrollLeft=0;window.dispatchEvent(new CustomEvent('sengoku:game-saved'));toast(`${newClan}の新たな物語が、${data.castles.find(c=>c.id===castleId).name}から始まりました。`);return true;
  }
  function downloadBlob(blob,name){const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}
  function exportSave(){if(startPending){toast('本拠を決めて物語を開始すると、セーブを書き出せます。');return;}downloadBlob(new Blob([game.exportSave()],{type:'application/json'}),`sengoku-vs-save-${date().year}-${date().month}.json`);toast('セーブデータを書き出しました。ダウンロード先を確認してください。');}
  let importedGame=null,importedScope=null,importReadGeneration=0;
  function fileImportScope(){const context=window.SengokuSocial?.getCourtContext?.();return JSON.stringify([syncAccess.linked===true,String(window.SengokuSocial?.getUser?.()?.id||''),roleEpoch,game.isAdmin===true,game.isStaff===true,state().walking?.campaignId||'',context?.epoch??null,context?.accountEpoch??null,context?.privilegeEpoch??null]);}
  function fileImportFailure(message){return Object.assign(Error(message),{code:'SAVE_IMPORT_BLOCKED'});}
  function fileImportMessage(error){return error?.code==='SAVE_IMPORT_BLOCKED'?error.message:'このセーブは読み込めません。形式・バージョン・武将データを確認してください。';}
  function prepareFileImport(raw,scope,{advance=false}={}){
    if(!scope||scope!==fileImportScope())throw fileImportFailure('領主・役職・物語が切り替わりました。現在の進行は変更していません。同期を確認してから、もう一度ファイルを選んでください。');
    if(!canMutate())throw fileImportFailure('端末同期と共通時刻の確認が終わってから、もう一度読み込んでください。現在の進行は変更していません。');
    const candidate=SengokuEngine.fromSave(raw,roster,{isAdmin:game.isAdmin,isStaff:game.isStaff,staffBase:game.getStaffBase?.()});
    if(syncAccess.linked){
      const owner=String(window.SengokuSocial?.getUser?.()?.id||''),context=window.SengokuSocial?.getCourtContext?.();
      if(!owner||context&&(!context.user||context.pending||context.banned||String(context.playerId)!==owner))throw fileImportFailure('接続中の領主を確認できません。現在の進行は変更していません。同期を確認してから、もう一度読み込んでください。');
      if(candidate.state.walking?.campaignId!==state().walking?.campaignId)throw fileImportFailure('現在の物語とは異なるセーブです。現在の進行は変更していません。「引き継ぎ・復元」から復元する領主を確認してください。');
      // File data never supplies private ownership history. Recheck the current
      // authenticated engine at both preview and commit before advancing time.
      const authority=game.getMaintenanceAuthority?.();
      if(!authority||authority.campaignId!==candidate.state.walking.campaignId)throw fileImportFailure('兵の維持費を同期してから、もう一度ファイルを読み込んでください。現在の進行は変更していません。');
      const accepted=candidate.setMaintenanceAuthority?.(authority);
      if(!accepted?.ok)throw fileImportFailure('このセーブの時点を確認できる維持費の履歴がありません。現在の進行は変更していません。最新データを同期してから再度読み込むか、「引き継ぎ・復元」を利用してください。');
    }
    const clock=confirmedWorldClock();
    if(!clock)throw fileImportFailure('共通時計を確認してから、もう一度読み込んでください。現在の進行は変更していません。');
    if(candidate.state.worldClock?.id===clock.id&&candidate.state.worldClock.elapsedMs>clock.elapsedMs)throw fileImportFailure('現在の共通時計より未来のセーブは読み込めません。現在の進行は変更していません。');
    const progress=advance?candidate.applyWorldClock(clock,{deferCycleSettlement:syncAccess.linked}):null;
    if(progress?.ok===false)throw fileImportFailure('共通時計と維持費の履歴を同期してから、もう一度読み込んでください。現在の進行は変更していません。');
    return{candidate,pending:Boolean(progress?.pending)};
  }
  function saveComparisonMarkup(current,candidate,record,fileName){
    const currentId=current.state.walking?.campaignId;
    const fileId=(record.state||record).walking?.campaignId;
    const identified=currentId&&fileId&&currentId!=='legacy_v1'&&fileId!=='legacy_v1';
    const monthDiff=candidate.state.turn-current.state.turn;
    const relation=!identified?'戦役の識別情報がないため、本拠と進行を確認してください。':
      fileId!==currentId?'別の戦役のセーブです。':
      monthDiff===0?'同じ戦役・同じ進行月です。':
      '同じ戦役の、現在より'+Math.abs(monthDiff).toLocaleString('ja-JP')+'か月'+(monthDiff<0?'前':'先')+'の記録です。';
    const timestamp=typeof record.savedAt==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(record.savedAt)?new Date(record.savedAt):null;
    const savedAt=timestamp&&Number.isFinite(timestamp.getTime())?timestamp.toLocaleString('ja-JP',{year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',timeZoneName:'short'}):'記録なし';
    function comparisonTable(caption,fields){
      const rows=fields.map(([label,read])=>{
        const before=read(current),after=read(candidate);
        return `<tr><th scope="row">${label}</th><td>${esc(before)}</td><td${before===after?'':' class="save-value-changed"'}>${esc(after)}</td></tr>`;
      }).join('');
      return `<table class="save-comparison-table" aria-label="${caption}"><colgroup><col><col><col></colgroup><thead><tr><th scope="col">項目</th><th scope="col">現在の戦役</th><th scope="col">読み込むセーブ</th></tr></thead><tbody>${rows}</tbody></table>`;
    }
    const progress=comparisonTable('戦役の比較',[
      ['勢力',g=>g.state.clan],['本拠',g=>g.data.castles.find(c=>c.id===g.state.home)?.name||g.state.home],
      ['進行年月',g=>{const d=g.calendar();return `第${d.cycle}周 · ${d.year}年${d.month}月`;}],
      ['家臣',g=>g.state.officers.length.toLocaleString('ja-JP')+'名'],
      ['領有拠点',g=>g.ownedCastleIds().length.toLocaleString('ja-JP')+'城'],
      ['手持ち兵',g=>g.state.troops.toLocaleString('ja-JP')+'人']
    ]);
    const resources=comparisonTable('資源の比較',[
      ['金銭',g=>g.state.resources.gold.toLocaleString('ja-JP')],['兵糧',g=>g.state.resources.rice.toLocaleString('ja-JP')],
      ['木材',g=>g.state.resources.wood.toLocaleString('ja-JP')],['石材',g=>g.state.resources.stone.toLocaleString('ja-JP')],
      ['勾玉',g=>g.state.magatama.toLocaleString('ja-JP')]
    ]);
    return `<section class="save-comparison" aria-label="読み込み前の確認"><p class="save-comparison-file"><b>${esc(fileName||'選択したファイル')}</b><small>ファイル内の保存日時　${esc(savedAt)}</small></p><p class="save-comparison-relation">${esc(relation)}</p>${progress}<details><summary>資源も比較する</summary>${resources}</details><p class="save-comparison-note">確認画面を開いた時点の比較です。読み込み後は共通時刻まで進行を反映します。</p></section>`;
  }
  function confirmFileImport(){
    if(activeModal!=='import'||!importedGame)return false;
    let prepared;try{prepared=prepareFileImport(importedGame.exportSave(),importedScope,{advance:true});}catch(error){importedGame=null;importedScope=null;importReadGeneration++;closeModal();toast(fileImportMessage(error),true);return false;}
    try{backupCurrentSave('manual-import');}catch(_){toast('バックアップを保存できませんでした。先にセーブを書き出してください。',true);return false;}
    lastRealtime=performance.now();game=prepared.candidate;worldCatchingUp=prepared.pending;importedGame=null;importedScope=null;importReadGeneration++;saveEnabled=true;saveWarning='';selectedCastle='';retireLocalWalkingContext();closeModal();save({replaceCampaign:true});render();toast(worldCatchingUp?'セーブを読み込み、共通時刻までの進行を反映しています。':'セーブデータを読み込みました。');queueWorldProgress();return true;
  }
  $('#save-import').addEventListener('change',async e=>{
    const file=e.target.files[0];e.target.value='';if(!file)return;
    const generation=++importReadGeneration;importedGame=null;importedScope=null;
    if(!requireWritable())return;
    if(file.size>2*1024*1024){toast('セーブファイルが大きすぎます。2MB以下のJSONを選んでください。',true);return;}
    const scope=fileImportScope();
    try{
      const [raw]=await Promise.all([file.text(),window.SengokuWorldClock?.refresh()]);if(generation!==importReadGeneration)return;
      importedGame=prepareFileImport(raw,scope).candidate;importedScope=scope;
      modal('セーブを読み込みますか？','現在のプレイは読み込んだ内容に置き換わります。',saveComparisonMarkup(game,importedGame,JSON.parse(raw),file.name),`<button class="button" data-action="close">やめる</button><button class="button primary" data-action="confirm-import">読み込む</button>`,'import');
    }catch(error){if(generation!==importReadGeneration)return;importedGame=null;importedScope=null;toast(fileImportMessage(error),true);}
  });

  let installPrompt=null;
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;});
  async function install(){if(installPrompt){await installPrompt.prompt();installPrompt=null;return;}modal('ホーム画面に追加','ブラウザのメニューから登録できます。',`<div class="help-steps"><div class="help-step"><div><h3>iPhone・iPad</h3><p>Safariで公開版を開き、「共有」から「ホーム画面に追加」を選んでください。</p></div></div><div class="help-step"><div><h3>Android</h3><p>Chromeで公開版を開き、メニューから「ホーム画面に追加」または「アプリをインストール」を選んでください。</p></div></div></div><div class="notice">初回は通信が必要です。ホーム追加やオフライン動作の対応はブラウザにより異なります。</div>`,`<button class="button primary" data-action="close">わかりました</button>`,'install');}
  function setVoiceActive(value){voiceAudioActive=value===true;soundEffects?.setVoiceActive?.(voiceAudioActive);music?.setVoiceActive?.(voiceAudioActive)?.finally?.(refreshMusicPlayback);refreshMusicPlayback();}
  function musicScene(){return window.SENGOKU_AT_TITLE===true||startPending?'title':'game';}
  function musicStatusText(){
    if(!settings.sound)return '停止中';
    if(!settings.volume)return '音量0';
    if(musicWaitingForGesture||music?.resuming&&!music?.audible)return '再生待機';
    if(musicFailure)return '読込失敗';
    if(voiceAudioActive)return '通話中・一時停止';
    if(music?.audible)return '再生中';
    return musicStarting||music?.playing?'読込中':'再生待機';
  }
  function removeMusicGesture(){
    for(const type of ['pointerdown','click','keydown'])document.removeEventListener(type,trustedGestureMusic,true);
    musicGestureAvailable=false;
  }
  function refreshMusicPlayback(){
    const status=musicStatusText(),toggle=settings.sound?'停止':'再生';
    if(music?.audible&&settings.sound)removeMusicGesture();
    for(const node of document.querySelectorAll('[data-audio-toggle]')){
      const text=settings.sound?`BGM ${status} · 停止`:'BGMを再生';
      if(node.textContent!==text)node.textContent=text;
      node.setAttribute('aria-label',settings.sound?'BGMを停止':'BGMを再生');
    }
    for(const node of document.querySelectorAll('[data-audio-status]')){
      const text=musicWaitingForGesture?'ブラウザの許可待ちです。画面を操作すると再生を試みます。':musicFailure?'音源を読み込めませんでした。再生ボタンでお試しください。':`BGM: ${status}`;
      if(node.textContent!==text)node.textContent=text;
    }
    for(const node of document.querySelectorAll('[data-action="sound-settings"]'))node.textContent=`${status} · ${toggle}`;
    for(const node of document.querySelectorAll('[data-action="music-resume"]'))node.hidden=!(settings.sound&&settings.volume>0&&(musicWaitingForGesture||musicFailure));
    const sound=$('#sound-button');if(sound)sound.setAttribute('aria-label',`${settings.sound?'BGMを停止':'BGMを再生'}（${status}）`);
    if(activeModal!=='music')return;
    for(const node of document.querySelectorAll('.music-track')){
      const selected=Boolean(settings.sound&&node.dataset.id===music?.currentId),playing=selected&&music.audible;
      node.classList.toggle('playing',playing);
      const label=node.querySelector('.track-state');if(label)label.textContent=playing?'演奏中':selected&&music?.playing?'読込中':'聴く';
    }
  }
  function musicPlaybackBlocked(){
    ++musicRequest;musicStarting=false;musicWaitingForGesture=true;musicFailure=false;
    refreshMusicPlayback();
  }
  function musicPlaybackFailed(error){
    if(error?.name==='NotAllowedError'){musicPlaybackBlocked();return;}
    ++musicRequest;musicStarting=false;musicWaitingForGesture=false;musicFailure=true;
    if(music?.playing)music.pause();refreshMusicPlayback();
    toast(error?.message||'音源を再生できませんでした。再生ボタンでお試しください。',true);
  }
  function ensureAudio(){
    if(!music){music=new SengokuMusic({volume:settings.volume,scene:musicScene(),onTrackChange:refreshMusicPlayback,onStateChange:refreshMusicPlayback,onPlaybackError:musicPlaybackFailed,onPlaybackBlocked:musicPlaybackBlocked});music.setVoiceActive?.(voiceAudioActive);}
    music.setAuto(settings.musicMode!=='manual');music.setScene(musicScene());return music;
  }
  function sceneTrack(){const tracks=window.SENGOKU_MUSIC_TRACKS||[];if(settings.musicMode==='manual'&&tracks.some(t=>t.id===settings.track))return settings.track;return SengokuMusic.automaticTrackId(musicScene());}
  async function requestMusicPlayback(){
    if(!settings.sound||!settings.volume)return;
    const request=++musicRequest;musicStarting=true;musicWaitingForGesture=false;musicFailure=false;
    try{
      const player=ensureAudio();musicRequestedId=sceneTrack();refreshMusicPlayback();
      const outcome=await player.attemptPlayback(musicRequestedId);
      if(request!==musicRequest)return;
      musicStarting=false;
      if(outcome==='waiting')musicWaitingForGesture=true;
      refreshMusicPlayback();
    }catch(error){if(request===musicRequest)musicPlaybackFailed(error);}
  }
  function trustedGestureMusic(event){
    if(event.isTrusted!==true||!musicGestureAvailable||!settings.sound||!settings.volume||voiceAudioActive||document.hidden)return;
    if(!musicWaitingForGesture&&!musicStarting&&!music?.resuming)return;
    if(event.type==='pointerdown'&&event.pointerType&&event.pointerType!=='mouse')return;
    if(event.type==='keydown'&&(event.repeat||event.isComposing||event.ctrlKey||event.metaKey||event.altKey||['Shift','Control','Alt','Meta','Escape'].includes(event.key)))return;
    if(event.target?.closest?.('[data-action="sound"],[data-action="sound-settings"],[data-action="music-stop"],[data-action="play-track"],[data-action="music-auto"],[data-action="music-resume"],[data-sound-preview],#volume,input[type="range"]'))return;
    removeMusicGesture();void requestMusicPlayback();
  }
  function applyMusicVolume(value){
    settings.volume=Math.max(0,Math.min(100,Number(value)||0));
    if(!settings.volume&&musicStarting){++musicRequest;musicStarting=false;musicWaitingForGesture=false;music?.pause();}
    if(!settings.volume)musicVolumeRetryPending=false;
    music?.setVolume(settings.volume);
    const output=$('#settings-volume-value');if(output)output.textContent=settings.volume+'%';
    safeSettings();refreshMusicPlayback();
    if(settings.sound&&settings.volume>0&&!musicStarting&&!musicVolumeRetryPending&&(musicWaitingForGesture||musicFailure||!music?.playing)){
      musicVolumeRetryPending=true;void requestMusicPlayback();
    }
  }
  function startMusic(){
    if(musicStarted)return;musicStarted=true;refreshMusicPlayback();
    if(!settings.sound||!settings.volume)return;
    for(const type of ['pointerdown','click','keydown'])document.addEventListener(type,trustedGestureMusic,true);
    return requestMusicPlayback();
  }
  function syncMusic(){
    if(!settings.sound)return;
    try{
      const player=ensureAudio(),id=sceneTrack();
      if(musicWaitingForGesture||musicFailure)return;
      if(musicStarting){if(id!==musicRequestedId)void requestMusicPlayback();return;}
      if(player.playing&&id!==player.currentId)void requestMusicPlayback();
    }catch(error){musicPlaybackFailed(error);}
  }
  function applyEffectsVolume(value){
    settings.effectsVolume=Math.round(Math.max(0,Math.min(100,Number(value)||0)));soundEffects?.setVolume(settings.effectsVolume);
    const output=$('#settings-effects-volume-value');if(output)output.textContent=settings.effectsVolume+'%'+(settings.effectsVolume===0?'・消音':'');
    for(const button of document.querySelectorAll('[data-sound-preview]'))button.disabled=settings.effectsVolume===0;
    const feedback=$('[data-sound-feedback]');if(feedback)feedback.textContent='';safeSettings();
  }
  function playNote(type='confirm'){
    if(!(settings.effectsVolume>0)||voiceAudioActive||document.hidden||!window.SengokuSoundEffects)return Promise.resolve(false);
    try{if(!soundEffects)soundEffects=new window.SengokuSoundEffects({volume:settings.effectsVolume});soundEffects.setVolume(settings.effectsVolume);return soundEffects.play(typeof type==='string'?type:'confirm');}catch(_){return Promise.resolve(false);}
  }
  async function previewSoundEffect(){
    const result=await playNote(),feedback=$('[data-sound-feedback]');if(feedback)feedback.textContent=result?'確認音を再生しました。':voiceAudioActive?'通話中は効果音を一時停止しています。':settings.effectsVolume===0?'効果音は消音中です。':'音を再生できませんでした。もう一度「音を試す」を押してください。';
  }
  function stopMusic(){
    settings.sound=false;++musicRequest;musicStarting=false;musicWaitingForGesture=false;musicFailure=false;
    music?.pause();safeSettings();renderHeader();refreshMusicPlayback();
  }
  async function toggleSound(){
    if(settings.sound){stopMusic();return;}
    settings.sound=true;safeSettings();await requestMusicPlayback();renderHeader();refreshMusicPlayback();
  }
  function musicModal(){const tracks=window.SENGOKU_MUSIC_TRACKS||[],now=music?.currentId,pages=Math.max(1,Math.ceil(tracks.length/8));musicPage=Math.max(1,Math.min(musicPage,pages));modal('戦国の音楽帳','支度・朝活・昼活・夜活と、従来の16曲。全20曲から選べます。',`<p>自動モードでは、ゲーム開始前のトップメニューと本拠選択中に「支度」、ゲーム内では端末の時刻に合わせて「朝活」「昼活」「夜活」が流れます。同じ時間帯の画面移動では、曲を最初から再生し直しません。</p><p class="subtitle">朝 05:00〜11:59 · 昼 12:00〜17:59 · 夜 18:00〜翌04:59。ゲーム内の年月とは別に切り替わります。</p><div class="music-mode"><button class="button ${settings.musicMode==='auto'?'gold':''}" data-action="music-auto">時間帯に合わせて自動選曲</button><span>${settings.musicMode==='auto'?'トップは支度・ゲーム内は朝昼夜':'選んだ曲をループ'}</span></div><div class="music-list">${tracks.slice((musicPage-1)*8,musicPage*8).map((t,i)=>`<button class="music-track ${settings.sound&&music?.audible&&now===t.id?'playing':''}" data-action="play-track" data-id="${t.id}"><span class="track-number">${String((musicPage-1)*8+i+1).padStart(2,'0')}</span><span class="track-title"><b>${esc(t.name)}</b><small>${esc(t.description)}</small></span><span class="track-duration">${Math.floor((t.durationSeconds||t.duration)/60)}:${String(Math.round((t.durationSeconds||t.duration)%60)).padStart(2,'0')}</span><span class="track-state">${settings.sound&&music?.audible&&now===t.id?'演奏中':'聴く'}</span></button>`).join('')}</div>${pageControls('music-page',musicPage,pages)}<div class="notice">曲を選ぶと、その曲を時間帯に関係なく繰り返し再生します。自動に戻すとトップメニューは「支度」、ゲーム内は朝・昼・夜の曲へ切り替わります。初期音量は10です。</div>`,`<button class="button" data-action="music-stop">演奏を止める</button><button class="button primary" data-action="close">戻る</button>`,'music');}
  document.addEventListener('click',async event=>{const preview=event.target.closest('[data-sound-preview]');if(preview){if(!preview.disabled)await previewSoundEffect();return;}const node=event.target.closest('[data-action],[data-view]:not(#main)');if(!node||node.disabled)return;if(node.dataset.view){if(node.dataset.view==='officers'&&node.closest('#navigation'))officerSection='archive';go(node.dataset.view);return;}const a=node.dataset.action,id=node.dataset.id;if(mutationActions.has(a)&&!requireWritable())return;switch(a){
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
    case 'economy-details':economyDetailsModal(node.dataset.resource);break;
    case 'economy-resource':selectEconomyResource(node.dataset.resource);break;
    case 'command-marches':window.SengokuTravelUI?.open?.();break;
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
    case 'music-auto':settings.musicMode='auto';music?.setAuto(true);safeSettings();if(settings.sound&&(musicWaitingForGesture||musicFailure))await requestMusicPlayback();else syncMusic();musicModal();break;
    case 'music-stop':stopMusic();musicModal();break;
    case 'music-resume':settings.sound=true;safeSettings();await requestMusicPlayback();refreshMusicPlayback();break;
    case 'play-track':settings.musicMode='manual';settings.track=id;settings.sound=true;safeSettings();await requestMusicPlayback();renderHeader();musicModal();break;
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
    case 'branch-troop-max':{const q=window.SengokuBranches?.troopTransferQuote?.(game,id);if(!branchBookingPending&&q?.maxTroops>0){window.SengokuBranches.setTroopTransferSelection(game,id,{troops:String(q.maxTroops)});refreshBranchDeploymentPanels();}break;}
    case 'build-branch':case 'upgrade-branch':case 'repair-branch':case 'build-branch-facility':case 'upgrade-branch-facility':case 'assign-branch-commander':case 'remove-branch-commander':case 'auto-assign-branch-commanders':{if(branchBookingPending)break;branchBookingPending=true;node.disabled=true;try{refreshLiveControls();const action=a.replace('-branch',''),commander=action.endsWith('-commander')||action==='auto-assign-commanders',payload=action==='auto-assign-commanders'?{branchId:id}:action==='build'?{parentCastleId:id,direction:node.dataset.direction}:action.endsWith('-facility')?{branchId:id,facilityId:node.dataset.facility}:commander?{branchId:id,officerId:node.dataset.officer}:{branchId:id},result=await requestBranches('/branches/'+action,{method:'POST',data:payload});if(!result?.ok)throw Error(result?.message||'支拠点の操作を確定できませんでした。');preserveInteraction($('#main'),render);refreshActiveModal();toast(result.result?.message||result.message||(commander?'武将の配置を保存しました。':'支拠点の普請を開始しました。'));}catch(error){toast(error.message||'支拠点の結果を確認してください。',true);}finally{branchBookingPending=false;refreshLiveControls();}break;}
    case 'preview-art':artPreviewModal(node.dataset.kind,id);break;
    case 'art-level-step':updateArtPreview((activeModalContext?.level||1)+Number(node.dataset.delta));break;
    case 'dismiss-tip':settings.tips=false;safeSettings();render();break;
    case 'council':go('council');break;
    case 'claim-quest':perform(game.claimQuest(id));break;
    case 'officer':officerModal(id,node.dataset.rank);break;
    case 'officer-compare-toggle':toggleOfficerComparison(id,node.dataset.rank);break;
    case 'officer-compare-open':officerComparisonModal();break;
    case 'officer-compare-clear':officerComparison=[];refreshOfficerComparisonSelection();break;
    case 'officer-rank-detail':officerModal(id,node.dataset.rank);break;
    case 'officer-section':officerSection=id==='gacha'?'gacha':'archive';go('officers');break;
    case 'open-gacha':officerSection='gacha';go('officers');break;
    case 'gacha-odds':gachaOddsPage=1;gachaOddsModal();break;
    case 'gacha-odds-page':gachaOddsPage+=Number(node.dataset.delta);patchHTML($('#gacha-individual-list'),individualOddsPage());window.SengokuDesktopFit?.refresh();break;
    case 'draw-officers':summonOfficers(Number(node.dataset.count));break;
    case 'officer-filter':if(!['all','owned','free'].includes(id))break;filter.ownership=id;filter.page=1;saveOfficerPreferences();render();break;
    case 'officer-reset':resetOfficerFilters(node.dataset.context);break;
    case 'town-section':jumpTownSection(id);break;
    case 'catalog-reset':resetCatalogFilters(node.dataset.kind);break;
    case 'catalog-state':{
      if(node.dataset.kind==='facility'&&['all','available','affordable','unbuilt','working','vacant','complete'].includes(id)){facilityState=id;facilityPage=1;saveFacilityPreferences();patchHTML($('#facility-results'),facilitiesResults());}
      else if(node.dataset.kind==='territory'&&['all','own','reachable','damaged'].includes(id)){territoryState=id;territoryPage=1;patchHTML($('#territory-results'),territoryResults());}
      else if(node.dataset.kind==='quest'&&['all','ready','progress','claimed'].includes(id)){questState=id;questPage=1;patchHTML($('#quest-results'),questResults());refreshLiveControls();}
      window.SengokuDesktopFit?.refresh();break;
    }
    case 'officer-page':filter.page+=Number(node.dataset.delta);patchHTML($('#officer-results'),officersResults());window.SengokuDesktopFit?.refresh();break;
    case 'command-activity':window.SengokuCommandCenter?.open?.({getGame:()=>game,navigate:go,openOperation:openCommandOperation,filter:node.dataset.filter});break;
    case 'resource-planner':window.SengokuCommandCenter?.openPlanner?.({getGame:()=>game,navigate:go,openOperation:openCommandOperation,kind:node.dataset.kind,id:node.dataset.id,staffReady:()=>staffConstructionReady()});break;
    case 'defense-ledger':openDefenseLedger();break;
    case 'campaign-records':window.SengokuCampaignRecords?.open?.({getGame:()=>game,formatDate:shortDate,formatText:logText});break;
    case 'facility-refresh':preserveInteraction($('#main'),()=>{patchHTML($('#facility-results'),facilitiesResults());refreshLiveControls();});break;
    case 'facility-layout':if(!['cards','list'].includes(id))break;facilityLayout=id;facilityPage=1;saveFacilityPreferences();preserveInteraction($('#main'),render);break;
    case 'facility-page':facilityPage+=Number(node.dataset.delta);patchHTML($('#facility-results'),facilitiesResults());window.SengokuDesktopFit?.refresh();break;
    case 'territory-page':territoryPage+=Number(node.dataset.delta);patchHTML($('#territory-results'),territoryResults());window.SengokuDesktopFit?.refresh();break;
    case 'quest-page':questPage+=Number(node.dataset.delta);patchHTML($('#quest-results'),questResults());refreshLiveControls();window.SengokuDesktopFit?.refresh();break;
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
    case 'army-planner':armyPlannerModal();break;
    case 'army-plan-tactic':armyPlannerModal({tactic:id});break;
    case 'army-plan-lock':{const locks=activeModalContext?.config?.locked||[];armyPlannerModal({locked:locks.includes(id)?locks.filter(value=>value!==id):[...locks,id].slice(0,3)});break;}
    case 'army-plan-governors':armyPlannerModal({includeGovernors:!activeModalContext?.config?.includeGovernors});break;
    case 'army-plan-refresh':armyPlannerModal();break;
    case 'army-plan-apply':applyArmyPlan();break;
    case 'pick-army':pickOfficer('army',node.dataset.slot);break;
    case 'assign-army':{const slot=Number(node.dataset.target),arr=[...state().army],old=arr[slot],existing=arr.indexOf(id);if(existing>=0){if(old)arr[existing]=old;else arr.splice(existing,1);}arr[slot]=id;perform(game.assignArmy(arr.filter(Boolean)));break;}
    case 'remove-army':{const arr=[...state().army];arr.splice(Number(node.dataset.target),1);perform(game.assignArmy(arr));break;}
    case 'pick-governor':pickOfficer('governor',id);break;
    case 'auto-governors':await autoAssignGovernors();break;
    case 'assign-governor':perform(game.assignGovernor(node.dataset.target,id));break;
    case 'remove-governor':perform(game.assignGovernor(node.dataset.target,null));break;
    case 'recruit-max':selectMaximumRecruitment();break;
      case 'recruit-balanced':selectRecommendedRecruitment();break;
    case 'recruit-troops':perform(game.recruitTroops(Number($('#recruit-amount').value)));break;
    case 'train':perform(game.train());break;
    case 'research':perform(game.research(id));break;
    case 'export-save':exportSave();break;
    case 'import-save':stopStrategy();$('#save-import').click();break;
    case 'confirm-import':confirmFileImport();break;
    case 'install':await install();break;
    case 'relocate-open':await openRelocation();break;
    case 'relocate-review':if(activeModal==='relocate'&&sameRelocationPlayer(relocationView)&&relocationView.rows.some(c=>c.castleId===relocationView.target)){relocationView.error='';drawRelocationConfirm(relocationView);}break;
    case 'relocate-back':if(activeModal==='relocate-confirm'&&!relocationBusy&&!relocationView.pending){relocationView.error='';drawRelocation(relocationView);}break;
    case 'relocate-retry':if(activeModal==='relocate'&&!relocationView.loading)await loadRelocationDirectory(relocationView);break;
    case 'relocate-receipt':if(activeModal==='relocate-confirm'&&relocationView?.pending&&!relocationBusy){relocationView.resend=false;drawRelocationConfirm(relocationView);await commitRelocation();}break;
    case 'relocate-confirm':await commitRelocation();break;
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
  document.addEventListener('submit',event=>{const form=event.target.closest?.('[data-branch-troop-form]');if(!form)return;event.preventDefault();submitBranchTroops(form);});
  document.addEventListener('input',e=>{if(e.isComposing)return;if(updateCatalogSearch(e.target)||updateBranchTroopDraft(e.target))return;if(e.target.id==='art-preview-level')updateArtPreview(Number(e.target.value));if(e.target.id==='battle-troops'){battleTroops=Number(e.target.value);updateBattlePreview();}if(e.target.id==='recruit-amount'){patchHTML($('#recruit-cost'),costHtml(game.recruitTroopCost(Number(e.target.value))));refreshLiveControls();}if(e.target.id==='volume')applyMusicVolume(e.target.value);if(e.target.id==='effects-volume')applyEffectsVolume(e.target.value);});
  document.addEventListener('compositionend',e=>updateCatalogSearch(e.target));
  document.addEventListener('change',e=>{if(e.target.id==='effects-volume'){applyEffectsVolume(e.target.value);return;}if(e.target.id==='volume'){musicVolumeRetryPending=false;return;}if(updateBranchTroopDraft(e.target))return;if(e.target.hasAttribute?.('data-branch-commander-choice')){window.SengokuBranches?.selectCommander?.(game,e.target.dataset.branchCommanderChoice,e.target.value);refreshBranchDeploymentPanels();return;}if(e.target.dataset?.branchParent){if(window.SengokuBranches?.selectDirection?.(game,e.target.dataset.branchParent,e.target.value)){preserveInteraction($('#main'),render);refreshActiveModal();}return;}if(e.target.dataset?.officerFilter){updateOfficerFilter(e.target.dataset.officerContext,e.target.dataset.officerFilter,e.target.value);return;}if(e.target.id==='relocate-castle-select'&&activeModal==='relocate'){const view=relocationView,row=view.rows.find(c=>c.castleId===e.target.value);view.target=row?.castleId||'';const preview=$('#relocate-destination');if(preview)preview.textContent=relocationRole(view,row);refreshLiveControls();return;}if(e.target.id==='new-start-castle'){newStartCastle=e.target.value;patchHTML($('#start-castle-preview'),startCastlePreview());refreshLiveControls();}if(e.target.id==='gacha-odds-rank'&&data.ranks.includes(e.target.value)){gachaOddsRank=e.target.value;gachaOddsPage=1;patchHTML($('#gacha-individual-list'),individualOddsPage());}if(e.target.id==='facility-category'){facilityCategory=e.target.value;facilityPage=1;saveFacilityPreferences();patchHTML($('#facility-results'),facilitiesResults());}if(e.target.id==='facility-sort'&&window.SengokuManagement.SORTS.includes(e.target.value)){facilitySort=e.target.value;facilityPage=1;saveFacilityPreferences();patchHTML($('#facility-results'),facilitiesResults());refreshLiveControls();}if(e.target.id==='map-region'){mapRegion=e.target.value;territoryPage=1;render();}if(e.target.id==='battle-tactic'){battleTactic=e.target.value;updateBattlePreview();}if(e.target.id==='tips'){settings.tips=e.target.value==='on';safeSettings();render();}});
  document.addEventListener('keydown',townSectionKeydown);
  document.addEventListener('keydown',economyResourceKeydown);
  document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('.castle-node')){e.preventDefault();if(e.target.dataset.id==='edo'&&!game.isAdmin){toast('江戸城は保護された拠点です。');return;}selectedCastle=e.target.dataset.id;render();}if(e.key==='Escape'){if(activeModal==='gacha-animation'){e.preventDefault();finishGachaPresentation();return;}clearGachaPresentation();activeModal='';activeModalContext=null;}});
  $('#modal').addEventListener('cancel',event=>{if(activeModal==='relocate'||activeModal==='relocate-confirm'){event.preventDefault();closeModal();}else if(activeModal==='gacha-animation'){event.preventDefault();finishGachaPresentation();}else clearGachaPresentation();});
  $('#modal').addEventListener('click',e=>{if(e.target===$('#modal')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom){if(activeModal==='gacha-animation')finishGachaPresentation();else closeModal();}}});
  window.addEventListener('hashchange',()=>{const view=location.hash.slice(1);if(['town','facilities','map','field','roaming','covert','court','officers','crests','army','research','council'].includes(view)&&view!==currentView)go(view);});
  if(['town','facilities','map','field','roaming','covert','court','officers','crests','army','research','council'].includes(location.hash.slice(1)))currentView=location.hash.slice(1);
  function refreshLiveControls({refreshHints=true}={}){
    if(refreshLiveControls.suspended||window.SENGOKU_AT_TITLE===true&&!activeModal)return;
    refreshTouchHeaderStatus();
    if(!game?.state)return;
    // Closed dialogs retain their DOM for stable reopening. They must not run
    // battle, officer or construction checks during unrelated background ticks.
    const activeNodes=selector=>Array.from(window.SengokuLiveDOM?.nodes?.(selector)||document.querySelectorAll(selector)).filter(node=>{const dialog=node.closest?.('dialog');return node.isConnected!==false&&dialog?.open!==false&&!node.closest?.('[hidden],[inert]')&&!(window.SENGOKU_AT_TITLE===true&&node.closest?.('#app'));});
    const s=state(),canCommand=s.command>0&&!s.gameOver,writable=canMutate(),recruitInput=$('#recruit-amount'),recruitIncome=recruitInput?game.income():null,recruitBudget=recruitInput?game.recruitmentBudget(recruitIncome):null;
    const actionNodes=activeNodes('[data-action]'),recruitReasons=activeNodes('[data-recruit-reason]');
    const officerChecks=new Map(),recruitIds=[...new Set([...actionNodes.filter(node=>node.dataset.action==='recruit-officer').map(node=>node.dataset.id),...recruitReasons.map(node=>node.dataset.recruitReason)])].filter(Boolean);
    // Quote only the mounted, visible recruitment choices, once per refresh.
    // A new tick gets fresh economy/role checks; no quote authorizes a click.
    if(recruitIds.length&&typeof game.canRecruitOfficers==='function'){
      const quotes=game.canRecruitOfficers(recruitIds);recruitIds.forEach((id,index)=>officerChecks.set(id,quotes[index]));
    }
    const recruitInfo=id=>{if(!officerChecks.has(id))officerChecks.set(id,game.canRecruitOfficer(id));return officerChecks.get(id);};
    let constructionView;
    const construction=()=>{
      if(constructionView)return constructionView;
      const jobs=constructionJobs(),chains=new Map(),counts=[new Set(),new Set()];
      for(const job of jobs){const shared=job.shared?1:0;if(job.kind!=='research')counts[shared].add(job.kind+':'+job.id);if(job.kind==='building'){const key=job.id+':'+shared;if(!chains.has(key))chains.set(key,[]);chains.get(key).push(job);}}
      return constructionView={jobs,chains,counts:counts.map(set=>set.size)};
    };
    actionNodes.forEach(node=>{
      const id=node.dataset.id;let disabled;
      switch(node.dataset.action){
        case 'relocate-review':disabled=!relocationView?.target||relocationView.loading||!sameRelocationPlayer(relocationView);break;
        case 'relocate-back':disabled=relocationBusy;break;
        case 'relocate-confirm':{const reason=relocationBlock(relocationView),status=$('#relocate-sync-status'),dismiss=$('#relocate-dismiss'),dismissLabel=relocationBusy||relocationView.pending?'閉じる':'やめる';if(dismiss&&dismiss.textContent!==dismissLabel)dismiss.textContent=dismissLabel;const visible=window.SengokuSyncNotices?.visibleText?.(reason)??reason;if(status&&status.textContent!==visible)status.textContent=visible;disabled=Boolean(reason);break;}
        case 'start-new':disabled=!canStartNew()||residencyStartPending||(!game.isAdmin&&!game.isStaff&&newResidencyMode!=='local'&&syncAccess.linked&&newResidencyLoading)||!admissionCastleAllowed(game.isAdmin?'edo':game.isStaff?staffBaseId:$('#new-start-castle')?.value||newStartCastle);break;
        case 'upgrade':{
          const view=construction(),shared=game.isStaff?1:0,availability=buildingAvailability(id,{chain:view.chains.get(id+':'+shared)||[],usedSlots:view.counts[shared],writable});disabled=!availability.ok;
          const reason=$('#building-order-reason-'+id),section=reason?.closest?.('[data-building-availability]');
          if(reason&&reason.textContent!==availability.reason)reason.textContent=availability.reason;
          if(section){
            if(section.hidden!==!availability.reason)section.hidden=!availability.reason;
            if(section.getAttribute('data-building-state')!==availability.state)section.setAttribute('data-building-state',availability.state);
            for(const next of section.querySelectorAll('[data-building-next-step]')){const hidden=next.dataset.buildingNextStep!==availability.state||availability.state==='locked'&&id==='keep';if(next.hidden!==hidden)next.hidden=hidden;}
          }
          break;
        }
        case 'upgrade-castle':{const c=game.castle(id);disabled=!saveEnabled||!canCommand||!c||c.owner!==s.clan||c.level>=castleLevelLimit(id)||!!currentJob('castle',id)||construction().counts[game.isStaff&&id===staffBaseId?1:0]>=game.constructionSlots()||game.isStaff&&id===staffBaseId&&!staffConstructionReady()||!hasResources(game.castleUpgradeCost(id));if(node.dataset.homeUpgrade==='true'){const hint=$('#home-castle-upgrade-hint');if(hint){const message=homeCastleUpgradeHint(id);if(hint.textContent!==message)hint.textContent=message;}}break;}
        case 'build-branch':case 'upgrade-branch':case 'repair-branch':case 'build-branch-facility':case 'upgrade-branch-facility':{const action=node.dataset.action.replace('-branch',''),quote=window.SengokuBranches?.quote?.(game,action,action==='build'?{parentCastleId:id,direction:node.dataset.direction}:action.endsWith('-facility')?{branchId:id,facilityId:node.dataset.facility}:{branchId:id});disabled=branchBookingPending||!saveEnabled||!canCommand||quote?.ok!==true||!hasResources(quote?.cost);
          const hint=node.nextElementSibling;
          if(hint?.hasAttribute?.('data-branch-order-reason')){
            const reason=!writable||!saveEnabled?(!saveEnabled?'保存状態を確認してから普請してください。':syncMessage()):quote?.reason||quote?.message||'';
            const visible=window.SengokuSyncNotices?.visibleText?.(reason)??reason;if(hint.textContent!==visible)hint.textContent=visible;if(hint.hidden!==!visible)hint.hidden=!visible;
          }
          break;}
        case 'branch-troop-max':disabled=branchBookingPending||!(window.SengokuBranches?.troopTransferQuote?.(game,id)?.maxTroops>0);break;
        case 'auto-assign-branch-commanders':disabled=Boolean(window.SengokuBranches?.autoCommanderReason?.(game,id,branchDeploymentHelpers()));break;
        case 'assign-branch-commander':disabled=Boolean(window.SengokuBranches?.commanderReason?.(game,id,branchDeploymentHelpers()));break;
        case 'remove-branch-commander':disabled=branchBookingPending||!saveEnabled||!writable||!game.branchCommanderStatus?.(id)?.commanders?.some(row=>row.id===node.dataset.officer);break;
        case 'research':{
          const availability=researchAvailability(id,{writable});disabled=!availability.ok;
          if(node.textContent!==availability.label)node.textContent=availability.label;
          node.classList.toggle('gold',availability.state==='available');
          const reason=$('#research-reason-'+id);if(reason&&reason.textContent!==availability.reason)reason.textContent=availability.reason;
          const card=node.closest?.('[data-research-card]'),label=card?.querySelector('[data-research-state-label]'),text=availability.state==='available'?'次の研究へ':availability.label;
          if(card&&card.getAttribute('data-research-state')!==availability.state)card.setAttribute('data-research-state',availability.state);
          if(label&&label.textContent!==text)label.textContent=text;
          break;
        }
        case 'recruit-officer':disabled=!recruitInfo(id).ok;break;
        case 'army-plan-apply':disabled=!saveEnabled||!activeModalContext?.plan?.ok||activeModalContext?.plan?.unchanged;break;
        case 'assign-army':case 'assign-governor':disabled=!(s.officers||[]).includes(id)||(s.branches||[]).some(branch=>(branch.commanders||[]).includes(id));break;
        case 'auto-governors':{const status=governorAssignmentStatus();disabled=branchBookingPending||!saveEnabled||!status.facilityCount||!status.candidateCount||game.isStaff&&!staffConstructionReady();break;}
        case 'draw-officers':disabled=gachaDrawing||Boolean(gachaPresentation)||!saveEnabled||!game.canDrawOfficers(Number(node.dataset.count)).ok;break;
        case 'recruit-max':{const maximum=s.gameOver?0:recruitBudget?.affordableMax??maximumRecruitAmount(),hint=$('#recruit-limit');disabled=maximum<100;if(hint){const text=recruitLimitText(maximum);if(hint.textContent!==text)hint.textContent=text;}break;}
        case 'recruit-balanced':disabled=s.gameOver||!recruitBudget||recruitBudget.recommendedMax<100;break;
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
      if(mutationActions.has(node.dataset.action)&&!writable)disabled=true;
      else if(disabled===undefined&&mutationActions.has(node.dataset.action))disabled=false;
      if(disabled!==undefined&&node.disabled!==disabled)node.disabled=disabled;
    });
    if(recruitInput)refreshRecruitmentPreview(recruitIncome,recruitBudget);
    refreshBranchDeploymentPanels();
    // Choosing a compass direction edits only a local preference. Quiet clock
    // and sync catches must lock construction actions without blurring this field.
    activeNodes('[data-branch-parent]').forEach(node=>{const disabled=!game.branchStatus?.(node.dataset.branchParent)?.directions?.some(direction=>direction.available);if(node.disabled!==disabled)node.disabled=disabled;});
    const speedControl=$('#realtime-speed');if(speedControl)speedControl.disabled=!writable;
    for(const control of activeNodes('#new-start-castle,#new-difficulty,.clan-choice,[data-action="choose-residency-mode"],[data-action="residency-retry"]'))control.disabled=residencyStartPending||(control.dataset.id==='lord'&&control.dataset.action==='choose-residency-mode'&&newResidencyDirectory?.full===true);
    const startStatus=$('#start-campaign-sync');if(startStatus)startStatus.textContent=$('[data-action="open-lord-registration"]')?'':residencyStartPending?'入城の受付と最新の保存を確認しています。':canStartNew()?'':game.isStaff&&!staffConstructionReady()?'共同拠点の最新の成長を確認しています。':syncAccess.linked&&(!syncAccess.ready||!syncAccess.writable)?syncMessage():window.SengokuWorldClock?.snapshot().message||'同期の確認が終わると開始できます。';
    activeNodes('[data-magatama-balance]').forEach(el=>{const value=num(s.magatama);if(el.textContent!==value)el.textContent=value;});
    activeNodes('[data-cost-resource]').forEach(el=>{
      const key=el.dataset.costResource,balance=key==='magatama'?s.magatama:s.resources[key];
      const amount=Number(el.dataset.costAmount),missing=Math.max(0,amount-balance),detail=el.querySelector('[data-cost-shortage]');
      el.classList.toggle('insufficient',missing>0);
      if(detail){const message=amount>100000000?'（所持上限1億）':missing?`（あと${num(missing)}）`:'';if(detail.textContent!==message)detail.textContent=message;}
    });
    recruitReasons.forEach(el=>{const info=recruitInfo(el.dataset.recruitReason);const reason=info.ok?'':info.reason;if(el.textContent!==reason)el.textContent=reason;});
    for(const balance of activeNodes('[data-branch-commands]'))if(balance.textContent!==String(s.command))balance.textContent=String(s.command);
    if(currentView==='roaming'&&roamingController)roamingController.refresh();
    if(currentView==='covert'&&covertController)covertController.refresh();
    if(currentView==='court'&&courtController)courtController.refresh();
    window.SengokuOfficerHealthUI?.refresh(document,game);
    window.SengokuDurabilityUI?.refresh(document,game);
    if(currentView==='facilities')window.SengokuManagement?.refreshFunding?.($('#facility-results'),state().resources);
    const armyHealthStats=activeNodes('[data-army-health-stat]');
    if(armyHealthStats.length){const values=game.armyStats();for(const node of armyHealthStats){const value=String(values[node.dataset.armyHealthStat]);if(node.textContent!==value)node.textContent=value;}for(const node of activeNodes('[data-army-health-stat-bar]')){const width=Math.max(0,Math.min(100,values[node.dataset.armyHealthStatBar]))+'%';if(node.style.width!==width)node.style.width=width;}}
    if(refreshHints)window.SengokuHintsUI?.refresh?.({throttled:true});
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
    if(refreshJobTimers.suspended||window.SENGOKU_AT_TITLE===true&&!activeModal)return;
    const active=node=>{const dialog=node.closest?.('dialog');return node.isConnected!==false&&dialog?.open!==false&&!node.closest?.('[hidden],[inert]')&&!(window.SENGOKU_AT_TITLE===true&&node.closest?.('#app'));};
    const nodes=selector=>window.SengokuLiveDOM?.nodes?.(selector)||document.querySelectorAll(selector);
    const clocks=Array.from(nodes('[data-job-clock]')).filter(active),bars=Array.from(nodes('[data-job-progress]')).filter(active);
    if(!clocks.length&&!bars.length)return;
    const jobs=new Map();
    for(const job of constructionJobs()){
      const group=job.kind+':'+job.id+':'+(job.shared?'shared':'personal'),exact=jobKey(job);
      if(!jobs.has(exact))jobs.set(exact,job);
      const first=jobs.get(group);if(!first||job.kind!=='branch'&&job.targetLevel<first.targetLevel)jobs.set(group,job);
    }
    function find(key){
      const [kind,id,scope,level,facility]=key.split(':');
      if(facility||jobs.has(key))return jobs.get(key);
      const shared=scope?scope==='shared':game.isStaff&&(kind==='building'||kind==='castle'&&id===staffBaseId);
      return jobs.get(kind+':'+id+':'+(shared?'shared':'personal')+(level?':'+Number(level):''));
    }
    for(const el of clocks){
      const job=find(el.dataset.jobClock),text=jobClockText(job);
      const title=job?.queued?'先の工事が終わると着工します。工期は1倍速換算、着工までは現在の速度です。停止中は進みません。':'経過・全体は1倍速換算の進行時間です。残り時間は現在の速度で表示します。停止中は進みません。';
      if(el.textContent!==text)el.textContent=text;if(el.title!==title)el.title=title;if(el.tabIndex!==0)el.tabIndex=0;
    }
    for(const el of bars){
      const job=find(el.dataset.jobProgress),progress=job?.queued?0:job?game.constructionProgress(job):100,width=Math.round(progress*1000)/1000+'%';
      if(el.style.width!==width)el.style.width=width;
    }
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
    const scrollSnapshot=previous?.pending&&previous.epoch===epoch&&previous.view===view&&previous.scrollSnapshot||window.SengokuStableDOM?.captureScroll?.(container);
    token.scrollSnapshot=scrollSnapshot;
    const dialog=$('#modal'),dialogScroll={top:dialog?.scrollTop||0,left:dialog?.scrollLeft||0},scrollX=window.scrollX,scrollY=window.scrollY;
    // A redraw is not navigation. Disable scroll anchoring while replacement
    // nodes and asynchronous artwork sizing settle, then restore each pane.
    if(container.style)container.style.overflowAnchor='none';
    // Renderers and modal builders normally refresh their controls. Delay those
    // reads until the saved input values are restored, then perform one pass.
    const suspendedControls=refreshLiveControls.suspended,suspendedTimers=refreshJobTimers.suspended;
    refreshLiveControls.suspended=refreshJobTimers.suspended=true;
    try{draw();}finally{refreshLiveControls.suspended=suspendedControls;refreshJobTimers.suspended=suspendedTimers;}
    for(const field of fields){const el=locateInteraction(field.locator,container);if(!el)continue;if(el.value!==field.value)el.value=field.value;if(typeof field.checked==='boolean'&&el.checked!==field.checked)el.checked=field.checked;}
    const replacement=locateInteraction(focus,container);
    if(replacement){if(document.activeElement!==replacement)replacement.focus?.({preventScroll:true});if(typeof selection?.start==='number'&&replacement.setSelectionRange&&(replacement.selectionStart!==selection.start||replacement.selectionEnd!==selection.end||replacement.selectionDirection!==selection.direction)){try{replacement.setSelectionRange(selection.start,selection.end,selection.direction||'none');}catch(_){}}}
    const restore=()=>{
      if(interactionEpoch!==epoch||currentView!==view||interactionRestores.get(container)!==token)return false;
      if(scrollSnapshot&&window.SengokuStableDOM?.restoreScroll){window.SengokuStableDOM.restoreScroll(scrollSnapshot);return true;}
      for(const saved of scrollers){const node=locateInteraction(saved.locator,container);if(node){if(node.scrollTop!==saved.top)node.scrollTop=saved.top;if(node.scrollLeft!==saved.left)node.scrollLeft=saved.left;}}
      if(dialog){if(dialog.scrollTop!==dialogScroll.top)dialog.scrollTop=dialogScroll.top;if(dialog.scrollLeft!==dialogScroll.left)dialog.scrollLeft=dialogScroll.left;}
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
    else if(kind==='officer-comparison')preserveInteraction($('#modal-content'),officerComparisonModal);
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
    const message=reason==='unstarted'?'はじめに本拠の城を選んでください。':reason==='storage'?'端末に保存できる状態にしてから開始してください。':reason==='offline'?'通信が戻ると、保管した歩行分を同期できます。':!ready?syncMessage():'';
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
  function setSyncAccess(access){
    Promise.resolve().then(()=>window.SengokuBridge?.primeProgress?.());
    const previous=syncAccess,wasWritable=canMutate(),wasReady=previous.linked&&previous.ready,previousOwner=evaluationOwnerId;
    syncAccess={...previous,...access};
    globalThis.window?.SengokuDefenseLedger?.refreshAccess?.();
    if(!syncAccess.linked||syncAccess.banned||['initializing','auth','access-changed'].includes(syncAccess.reason)){game.setBranchAuthority?.({resolvedElapsedMs:0});game.setMaintenanceAuthority?.(null);}
    if(!syncAccess.linked)evaluationOwnerId='';else if(!wasReady&&syncAccess.ready&&!syncAccess.rolePending)evaluationOwnerId=String(window.SengokuSocial?.getUser?.()?.id||'');
    const writableChanged=wasWritable!==canMutate(),accessChanged=['linked','ready','writable','banned','rolePending','reason'].some(key=>previous[key]!==syncAccess[key]);
    const noticeChanged=previous.message!==syncAccess.message&&(syncAccess.banned||['auth','error','offline','follower','lease-expired'].includes(syncAccess.reason));
    // Save acknowledgements and lease renewals update the live authority above,
    // but do not require another scan of every control, portrait and hint.
    if(!accessChanged&&!writableChanged&&!noticeChanged&&previousOwner===evaluationOwnerId)return;
    refreshEvaluationUI();if(writableChanged){lastRealtime=performance.now();saveCounter=0;}
    refreshLiveControls({refreshHints:false});if(syncAccess.ready&&syncAccess.writable&&(accessChanged||writableChanged))queueWorldProgress();
    window.SengokuStrategy?.refreshAccess?.();window.SengokuHintsUI?.refresh?.();
  }
  function setRoleAccess({isAdmin=false,isStaff=false,pending=false}={}){
    pending=pending===true;isAdmin=!pending&&isAdmin===true;isStaff=!pending&&isStaff===true&&!isAdmin;
    const wasPending=syncAccess.rolePending===true;
    // Unknown authentication is a read-only view, not a confirmed demotion.
    // Preserve the exact campaign before removing privileged projections.
    if(pending&&!wasPending&&!startPending&&saveEnabled){try{pendingRoleSave=game.exportSave();}catch(_){pendingRoleSave=null;saveEnabled=false;saveWarning='元のセーブを保護するため保存を停止しました。クラウドの進行を確認してください。';}}
    syncAccess.rolePending=pending;if(pending){game.setBranchAuthority?.({resolvedElapsedMs:0});game.setMaintenanceAuthority?.(null);}
    const changed=game.isAdmin!==isAdmin||Boolean(game.isStaff)!==isStaff;
    if(changed||wasPending!==pending){roleEpoch++;staffBaseReady=false;stopStrategy();}
    globalThis.window?.SengokuDefenseLedger?.refreshAccess?.();
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
  function trustedMaintenanceAuthority(meta={},candidate=game){
    const owner=String(window.SengokuSocial?.getUser?.()?.id||''),authority=meta.maintenanceAuthority,campaignId=candidate?.state?.walking?.campaignId;
    if(meta.source!=='cloud'||!syncAccess.linked||syncAccess.rolePending||syncAccess.banned||!owner||meta.playerId!==owner||!authority||!campaignId||authority.campaignId!==campaignId)return null;
    return authority;
  }
  function applyMaintenanceAuthority(meta={}){
    const authority=trustedMaintenanceAuthority(meta);if(!authority)return{ok:false,ignored:true};
    const result=game.setMaintenanceAuthority?.(authority)||{ok:true,changed:false};
    if(result.ok&&result.changed){renderHeader(true);queueWorldProgress();}return result;
  }
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
      const maintenance=trustedMaintenanceAuthority(meta,candidate);if(maintenance){const result=candidate.setMaintenanceAuthority?.(maintenance);if(result?.ok===false)throw Error(result.message||'維持費の台帳を確認できませんでした。');}
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
  window.SengokuBridge={playInterfaceSound:()=>playNote('tap'),troopGarrisons:requestTroopGarrisons,getTroopGarrisonAccess,canShowRelocation,prepareReleaseSwitch,getMarches:()=>window.SengokuTravelUI?.snapshot()||{active:[],history:[]},openMarches:()=>window.SengokuTravelUI?.open(),primeProgress,confirmProtectionExit,requestExpansion,getExpansionAccess,openProgress:tab=>openExpansion('progress',tab),startMusic,syncMusic,setVoiceActive,openCourt,applyCourtAccess,applyBranchAuthority,applyMaintenanceAuthority,getMaintenanceAuthority:()=>game.getMaintenanceAuthority?.()||null,getEventAccess,eventBattle:requestEventBattle,refreshPremiumAppearance,getHints,followHint,openHintHelp,getEvaluation,showEvaluation,getStrategyAccess,previewStrategy,beginStrategy,stepStrategy,stopStrategy,getState:()=>state(),getLocalCommander,hasStarted:()=>!startPending,getSave:getGameSave,getStoredSave,beginUpkeepSync,toast,canReceiveGifts:()=>saveEnabled&&canMutate(),applyGift:applyDurableGift,getWalkingAccess,beginLocalWalkingSession:payload=>localWalkingOperation('begin',payload),applyLocalWalkingProgress:payload=>localWalkingOperation('progress',payload),endLocalWalkingSession:payload=>localWalkingOperation('end',payload),startWalkingSession:payload=>requestWalking('/walking/start',payload),claimWalkingSteps:payload=>requestWalking('/walking/claim',payload),spendableAssets,troopCapacity:()=>game.troopCapacity(),troopTransportCapacity,tradeRequest:requestTrade,guildTransfer:payload=>requestField('/guild/treasury/transfer',{method:'POST',data:payload}),openSettings:settingsModal,renderGameplay:render,openStartSelection,openCastleAdmission:newGameModal,setSyncAccess,setRoleAccess,setAdminAccess,getRoleAccess:()=>({isAdmin:game.isAdmin===true,isStaff:game.isStaff===true,pending:syncAccess.rolePending===true,epoch:roleEpoch}),applyStaffBase,getStaffBase:()=>staffConstructionReady()?game.getStaffBase():null,applyCloudSave,prepareRecoverySave,prepareNewRecoverySave,applyRecoverySave,restoreAdminAssets};
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
    if(document.hidden)return;
    const shared=window.SengokuWorldClock?.snapshot();if(!shared)return;
    const p=$('#month-progress');if(p&&shared.clock){const width=shared.clock.calendar.elapsed/60*100+'%';if(p.style.width!==width)p.style.width=width;}
    if(!shared.ready||!shared.clock||!canMutate(true,false,allowStrategy)){renderHeader(true);refreshLiveControls();window.SengokuStrategy?.refreshAccess?.();return;}
    const wasCatchingUp=worldCatchingUp,result=game.applyWorldClock(confirmedWorldClock(),{maxSeconds:600,deferCycleSettlement:syncAccess.linked});
    worldCatchingUp=Boolean(result.pending||game.getMaintenanceStatus?.()?.hasMore);
    const clockKey=`${shared.ready}:${shared.clock.running}:${shared.clock.speed}:${shared.clock.calendar.cycle}`;
    const redraw=result.ok&&!result.pending&&!result.settlementRequired&&(wasCatchingUp||result.monthChanged||result.completed?.length||result.marchResults?.length||result.covertResults?.length||clockKey!==worldClockStatusKey);
    // Long resumes yield between bounded simulation slices. Refresh controls
    // on entry and completion, with occasional progress while replay continues.
    const paintAt=window.performance?.now?.()??Date.now(),lastPaint=processWorldClock.lastCatchupPaint;
    if(!redraw&&(!result.pending||!wasCatchingUp||lastPaint===undefined||paintAt<lastPaint||paintAt-lastPaint>=100)){renderHeader(true);refreshLiveControls();refreshJobTimers();processWorldClock.lastCatchupPaint=paintAt;}
    window.SengokuStrategy?.refreshAccess?.();
    if(!result.ok)return;
    const pendingNotice=processWorldClock.pendingNotice,events=[...(pendingNotice?.game===game?pendingNotice.events:[]),...(result.events||[])].slice(0,2);
    processWorldClock.pendingNotice={game,events};
    if(result.pending){worldCatchupTimer=setTimeout(processWorldClock,0);return;}
    if(result.settlementRequired){settleWorldCycle();return;}
    if(game.getMaintenanceStatus?.()?.hasMore){
      if(!maintenanceCatchupPending&&save({allowClockCatchup:true,allowStrategy})){maintenanceCatchupPending=true;Promise.resolve(window.SengokuCloudSync?.flush?.()).then(result=>result?.ok?window.SengokuCloudSync?.refresh?.():null).catch(()=>null).finally(()=>{maintenanceCatchupPending=false;queueWorldProgress();});}return;
    }
    const s=state(),count=$('#command-count'),pips=$('#command-pips');if(count&&count.textContent!==String(s.command))count.textContent=String(s.command);if(pips)patchHTML(pips,Array.from({length:game.commandMax()},(_,i)=>`<i class="${i<s.command?'filled':''}"></i>`).join(''));
    if(activeModal==='battle')updateBattlePreview();
    if(redraw){worldClockStatusKey=clockKey;preserveInteraction($('#main'),render);refreshActiveModal();syncMusic();}
    processWorldClock.pendingNotice=null;if(events.length)toast(events.join(' / '));
    window.SengokuTravelUI?.refresh();
    if(result.changed){saveCounter++;if(saveCounter>=10||wasCatchingUp||result.migrated||result.monthChanged||result.completed?.length||result.marchResults?.length||result.covertResults?.length){saveCounter=0;save({allowStrategy});}}
  }
  navigator.serviceWorker?.addEventListener?.('message',event=>{if(event.data?.type==='sengoku-open-recap'){noticeRecapPending=true;openPendingRecap();}});
  window.SengokuResidency?.configure?.({getContext:()=>window.SengokuSocial?.getCourtContext?.()||{playerId:'',user:null},request:(...args)=>window.SengokuSocial.residencyRequest(...args),homeCastleId:()=>state().home,onChoose:newGameModal,onMessage:toast,onChange:change=>{if(change.before&&(change.before.role!==change.self?.role||change.before.castleId!==change.self?.castleId||change.before.lordEpoch!==change.self?.lordEpoch))stopStrategy();refreshPremiumAppearance();}});
  configureTravel();configureProgress();setInterval(()=>{if(!document.hidden)primeProgress();},10000);
  setInterval(processWorldClock,1000);
  // Apply a new clock sample before repainting controls. The mutation guards
  // remain synchronous, without a disabled/enabled flash on every clock poll.
  render();refreshJobTimers();save();window.SengokuWorldClock?.subscribe(()=>{queueWorldProgress();});window.SengokuWorldClock?.start().then(processWorldClock);
})();
