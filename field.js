/* Shared player bases: presentation only. Every action uses the app's guarded
 * request facade and the server's result; battles are never simulated here. */
(function(global){
'use strict';
const caches=new Map(),mounted=new WeakMap();
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=value=>Number.isFinite(Number(value))?Number(value):0;
const integer=value=>Math.max(0,Math.floor(number(value)));
const num=value=>integer(value).toLocaleString('ja-JP');
const playerName=(name,evaluation,appearance=null,playerId='',avatarVersion,showAvatar=true)=>`<span class="player-evaluation-person">${showAvatar&&playerId?global.SengokuAvatar?.markup?.({id:playerId,name,avatarVersion},'inline')||'':''}<span class="player-evaluation-name" data-premium-player="${esc(playerId)}" data-premium-player-name="${esc(name)}">${global.SengokuPremiumRuntime?.nameMarkup?.(name,appearance)||esc(name)}</span>${global.SengokuEvaluationUI?.badge?.(evaluation)||''}</span>`;
const playerText=(name,evaluation,appearance=null)=>{const label=global.SengokuEvaluationUI?.label?.(evaluation),owned=global.SengokuPremiumRuntime?.ownershipLabel?.(appearance);return String(name||'領主')+(label?`（${label}）`:'')+(owned?`［${owned}］`:'');};
const castleLevelLimit=id=>['edo','sunpu'].includes(id)?64:['nijo','osaka','nagoya'].includes(id)?48:32;
const REWARD_CASTLES=['edo','sunpu'],CAPTURE_CASTLES=['nijo','osaka','nagoya'];
const targetCastleId=player=>player?.targetCastleId||player?.homeCastleId||'';
const targetCastleName=player=>{const id=targetCastleId(player);return(typeof player?.targetCastleName==='string'&&player.targetCastleName)||(id===player?.homeCastleId&&typeof player?.homeCastleName==='string'&&player.homeCastleName)||global.SENGOKU_DATA?.castles?.find(c=>c.id===id)?.name||id;};
const targetKey=player=>String(player?.playerId||'')+':'+targetCastleId(player);
const isHomeTarget=player=>targetCastleId(player)===player?.homeCastleId;
function battlePolicy(player,rules={}){
  const id=targetCastleId(player),modern=rules.targetCastles===true;
  if(modern&&rules.specialBaseBattles===true&&REWARD_CASTLES.includes(id)&&player?.battleMode==='reward'&&player?.capturable===false)return{mode:'reward',label:'報酬戦',tag:'報酬戦・占領不可',description:'勝利すると報酬を獲得します。この城は占領できません。守備側の領地と資源は維持されます。'};
  if(modern&&CAPTURE_CASTLES.includes(id)&&player?.battleMode==='capture'&&player?.capturable===true)return{mode:'capture',label:'占領戦',tag:'占領戦',description:'勝利するとこの城を自分の領地に加えます。あなたの本拠は変わりません。新たに得た城には帰還兵の15%を守備兵として残します。相手の本拠だった場合、相手は通常の城へ移ります。'};
  if(REWARD_CASTLES.includes(id)||modern&&CAPTURE_CASTLES.includes(id)||player?.isAdmin||player?.isStaff||!isHomeTarget(player))return{mode:'protected',label:'出陣不可',tag:'出陣条件を確認中',description:player?.attackReason||`${id==='edo'?'江戸城':id==='sunpu'?'駿府城':targetCastleName(player)}の出陣条件を確認できません。共有フィールドを更新してください。`};
  return{mode:'raid',label:'襲撃',tag:'資源をめぐる合戦',description:'勝利すると相手の資源を獲得します。本拠の占領は行いません。守備側には戦後の保護期間があります。'};
}
function keepLevelInfo(player){
  const value=player?.keepLevel,level=typeof value==='number'||typeof value==='string'&&value.trim()?Number(value):NaN;
  const known=player?.keepLevelKnown!==false&&Number.isFinite(level)&&Number.isInteger(level)&&level>=1;
  return{level:known?Math.min(32,level):1,known};
}
const keepLabel=player=>{if(!isHomeTarget(player))return`城郭 Lv.${Math.max(1,integer(player.level))}`;const keep=keepLevelInfo(player);return keep.known?`天守 Lv.${keep.level}`:'天守 未取得';};
function castleAppearance(player,{marker=false}={}){
  const keep=keepLevelInfo(player),className=marker?'field-map-castle-art':'field-castle-art';
  const art=global.SengokuArt?.castle?.(targetCastleId(player),className,keep.level)||`<span class="field-castle-fallback">${icon('castle')}</span>`;
  const label=marker?(keep.known?`Lv.${isHomeTarget(player)?keep.level:Math.max(1,integer(player.level))}`:'Lv.?'):keepLabel(player);
  return`<span class="field-castle-visual ${isHomeTarget(player)&&player.appearance?.town==='moonlit-castle'?'is-moonlit':''} ${marker?'field-map-castle':''}" data-field-keep-level="${keep.level}" data-field-keep-known="${keep.known}" role="img" aria-label="${esc(targetCastleName(player))}・${esc(keepLabel(player))}">${art}<span class="field-castle-level" aria-hidden="true">${label}</span>${marker&&player.playerId?`<span class="field-map-owner-avatar">${global.SengokuAvatar?.markup?.({id:player.playerId,name:player.name,avatarVersion:player.avatarVersion},'inline')||''}</span>`:''}</span>`;
}
function markerAppearance(marker){
  const player=marker.players?.find(p=>targetKey(p)===marker.displayTargetId);if(!player)return null;
  return{html:castleAppearance(player,{marker:true}),label:`${marker.name} ${playerText(player.name,player.evaluation,player.appearance)}の${isHomeTarget(player)?'本拠':'所領'} ${keepLabel(player)}${isHomeTarget(player)?' 城郭 Lv.'+player.level:''}${marker.players.length>1?'・'+marker.players.length+'人の領主':''}`};
}
const DEFAULT_RULES={minTroops:300,maxTroops:100000,commandCost:1,foodBase:150,foodPerTroop:.3,attackCooldownMs:60000,defenderProtectionMs:60000,allianceDurationMs:360000,tactics:[{id:'balanced',name:'正攻法',food:1},{id:'assault',name:'総攻撃',food:1.25},{id:'siege',name:'兵糧攻め',food:1.65},{id:'ambush',name:'伏兵',food:1.1}]};
const icons={refresh:'M20 8a9 9 0 1 0 1 7M20 3v5h-5',search:'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14m5-2 6 6',castle:'M3 20h18M5 20V10l7-5 7 5v10M3 10h18M9 5l3-3 3 3M10 20v-5h4v5',swords:'m4 3 7 7-3 3-7-7 3-3Zm9 10 7 7M15 18l3-3M20 3l-7 7 3 3 7-7-3-3ZM11 13l-7 7M9 18l-3-3',flag:'M4 22V3m0 1c6-5 10 5 16 0v10c-6 5-10-5-16 0',check:'m4 12 5 5L20 6',shield:'m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6l9-4ZM8 12l3 3 5-6',clock:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v6l4 2',users:'M9 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM2 21v-3c0-3 3-5 7-5s7 2 7 5v3M17 4c5-1 6 7 1 8m1 2c3 1 4 3 4 7',close:'m6 6 12 12M6 18 18 6'};
const icon=name=>`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[name]||icons.castle}"/></svg>`;
function normalizePlayers(payload){
  const input=Array.isArray(payload)?payload:Array.isArray(payload?.targets)?payload.targets:payload?.players;if(!Array.isArray(input))return[];
  const seen=new Set();return input.flatMap(player=>{
    if(!player||typeof player.playerId!=='string'||!player.playerId||typeof player.name!=='string'||typeof player.homeCastleId!=='string'||!player.homeCastleId||player.targetCastleId!==undefined&&(typeof player.targetCastleId!=='string'||!player.targetCastleId))return[];
    const key=targetKey(player);if(seen.has(key))return[];
    const keep=keepLevelInfo(player),castleId=targetCastleId(player);
    seen.add(key);return[{...player,targetCastleId:castleId,targetCastleName:targetCastleName(player),isHome:castleId===player.homeCastleId,level:Math.max(1,Math.min(castleLevelLimit(castleId),integer(player.level)||1)),keepLevel:keep.level,keepLevelKnown:keep.known,defenseTroops:integer(player.defenseTroops),defensePower:Math.max(0,number(player.defensePower)),isAdmin:player.isAdmin===true,isStaff:player.isStaff===true&&player.isAdmin!==true,self:player.self===true,online:player.online===true,attackable:player.attackable===true,capturable:typeof player.capturable==='boolean'?player.capturable:null,battleMode:['reward','capture','raid'].includes(player.battleMode)?player.battleMode:null}];
  });
}
function rulesFor(rules){return{...DEFAULT_RULES,...rules,tactics:Array.isArray(rules?.tactics)&&rules.tactics.length?rules.tactics:DEFAULT_RULES.tactics};}
function foodCost(troops,tactic,rules){const r=rulesFor(rules),choice=r.tactics.find(t=>t.id===tactic);return choice?Math.ceil(integer(troops)*number(r.foodPerTroop)*number(choice.food))+integer(r.foodBase):null;}
function remainingLabel(milliseconds){const value=Math.max(0,number(milliseconds));return value>=60000?Math.ceil(value/60000)+'か月':Math.ceil(value/1000)+'秒';}
function relationshipFor(player,me,identity){
  if(player?.self||player?.playerId===identity?.id)return'self';
  return me?.relationships?.find(item=>item.targetPlayerId===player?.playerId)?.status||player?.relationship||'neutral';
}
function groupBases(players,coordinates={},castles=[],identity,selectedTargetId='',rules={}){
  const defs=new Map(castles.map(c=>[c.id,c])),groups=new Map();
  for(const player of players){const id=targetCastleId(player),point=coordinates[id];if(!point||!Number.isFinite(Number(point.lon))||!Number.isFinite(Number(point.lat)))continue;
    if(!groups.has(id)){const def=defs.get(id)||{};groups.set(id,{id,name:targetCastleName(player)||def.name||id,region:def.region||'',geo:point,players:[],level:1,troops:0,neighbors:[]});}
    const group=groups.get(id);group.players.push(player);group.level=Math.max(group.level,player.level);group.troops+=player.defenseTroops;
  }
  return[...groups.values()].map(group=>{
    const own=group.players.some(p=>p.self||p.playerId===identity?.id),allied=group.players.some(p=>p.relationship==='allied');
    const representative=group.players.find(p=>targetKey(p)===selectedTargetId||p.playerId===selectedTargetId)||group.players.find(p=>p.self||p.playerId===identity?.id)||[...group.players].sort((a,b)=>keepLevelInfo(b).level-keepLevelInfo(a).level||a.playerId.localeCompare(b.playerId))[0];
    const keep=keepLevelInfo(representative);
    return{...group,name:group.name+(group.players.length>1?` · ${group.players.length}領主`:''),owner:own?'あなたの領地':allied?'同盟の領地':`${group.players.length}領主の領地`,reachable:group.players.some(p=>p.attackable&&battlePolicy(p,rules).mode!=='protected'),own,keepLevel:keep.level,keepLevelKnown:keep.known,isHome:isHomeTarget(representative),homeCastleId:representative.homeCastleId,targetCastleId:targetCastleId(representative),displayPlayerId:representative.playerId,displayTargetId:targetKey(representative),displayPlayerName:representative.name,displayPlayerEvaluation:representative.evaluation,displayPlayerAppearance:representative.appearance,displayPlayerAvatarVersion:representative.avatarVersion,displayLevelLabel:keepLabel(representative)};
  });
}
function attackValidation({player,me,identity,access={},state={},troops,tactic,rules,clock}){
  if(!identity?.id)return{ok:false,message:'領主登録・ログインが必要です。'};
  if(access.fieldPending)return{ok:false,message:'前の采配を反映しています。'};
  if(!access.writable)return{ok:false,message:'この端末を操作端末にすると出陣できます。'};
  if(clock&&(!clock.ready||clock.clock?.running===false))return{ok:false,message:clock.ready?'共通時間が停止しています。':'共通時刻の確認を待っています。'};
  if(!player)return{ok:false,message:'相手の領主を選んでください。'};
  if(player.self||player.playerId===identity.id)return{ok:false,message:'自分の領地には出陣できません。'};
  const policy=battlePolicy(player,rules);if(policy.mode==='protected')return{ok:false,message:policy.description};
  if(relationshipFor(player,me,identity)==='allied')return{ok:false,message:'同盟中の領主には出陣できません。'};
  if(!player.attackable)return{ok:false,message:player.attackReason||'この拠点は現在保護されています。'};
  if(!me?.attack?.ready)return{ok:false,message:me?.attack?.reason||'本拠と出陣の準備を確認しています。'};
  const r=rulesFor(rules),amount=Number(troops),min=Math.max(1,integer(me.attack.minTroops)||integer(r.minTroops)),max=Math.min(integer(me.attack.maxTroops)||integer(r.maxTroops),integer(me.attack.availableTroops),state.troops===undefined?Infinity:integer(state.troops));
  if(!Number.isInteger(amount)||amount<min||amount>max)return{ok:false,message:`出陣兵数は${num(min)}〜${num(max)}人で指定してください。`};
  const cost=foodCost(amount,tactic,r);if(cost===null)return{ok:false,message:'戦法を選んでください。'};
  if(integer(state.command??me.attack.command)<integer(r.commandCost))return{ok:false,message:'出陣に必要な指令がありません。'};
  if(integer(state.resources?.rice??me.attack.rice)<cost)return{ok:false,message:`兵糧が${num(cost)}必要です。`};
  const payload={targetPlayerId:player.playerId,troops:amount,tactic};if(r.targetCastles===true)payload.targetCastleId=targetCastleId(player);
  return{ok:true,foodCost:cost,battleMode:policy.mode,payload};
}
function playerPhoto(player){const user={...player,id:player.playerId};return global.SengokuAvatar?.markup?.(user,'small')||'';}
function publicRow(player,{selectedId='',identity,relationship=player.relationship,rules={}}={}){
  const own=player.self||player.playerId===identity?.id,label=own?'あなた':relationship==='allied'?'同盟':relationship==='incoming'?'申請あり':relationship==='outgoing'?'申請中':player.online?'接続中':'領主';
  const photo=playerPhoto(player),selected=selectedId===targetKey(player),policy=battlePolicy(player,rules);
  return`<button type="button" class="field-player-row ${selected?'is-selected':''} ${own?'is-self':''}" data-field-action="select-player" data-player-id="${esc(player.playerId)}" data-target-id="${esc(targetKey(player))}" aria-pressed="${selected}">${photo?`<span class="field-player-mon field-player-photo">${photo}</span>`:`<span class="field-player-mon" data-field-crest="${esc(player.clan==='德川家'?'徳川家':player.clan||'')}">${icon('flag')}</span>`}<span class="field-player-copy"><strong>${playerName(player.name,player.evaluation,player.appearance,player.playerId,player.avatarVersion,false)}</strong><small>${esc(targetCastleName(player))} · ${isHomeTarget(player)?'本拠':'所領'}</small><small>${esc(player.clan==='德川家'?'徳川家':player.clan||'')}${['reward','capture'].includes(policy.mode)?' · '+policy.tag:''}</small></span><span class="field-player-meta"><span class="field-player-tag ${player.online?'is-online':''}">${esc(label)}</span><small>${keepLabel(player)}${isHomeTarget(player)?' · 城郭 Lv.'+player.level:''}</small><small>${num(player.defenseTroops)}兵</small></span></button>`;
}
function battleSummary(battle={},viewerId){
  const attacker=Boolean(viewerId&&battle.attackerPlayerId===viewerId),defender=Boolean(viewerId&&battle.defenderPlayerId===viewerId),confirmed=typeof battle.won==='boolean',won=battle.won===true;
  const mode=['reward','capture','raid'].includes(battle.battleMode)?battle.battleMode:'raid';
  const captured=confirmed&&won&&mode==='capture'&&battle.capture?.captured===true&&CAPTURE_CASTLES.includes(battle.castleId)&&battle.capture.castleId===battle.castleId;
  const positive=confirmed&&(attacker?won:defender?!won:false),loss=attacker?integer(battle.attackerLost):defender?integer(battle.defenderLost?.troops)+integer(battle.defenderLost?.garrison):0;
  let title='合戦結果を確認中',effect='勝敗が確定した記録を読み込み直してください。';
  if(confirmed){
    if(mode==='reward'){
      title=attacker?(won?'報酬戦に勝利':'報酬戦から撤退'):defender?(won?'報酬戦で敗北':'報酬戦を防衛'):(won?'攻撃側の勝利':'守備側の勝利');
      effect=attacker?(won?'勝利報酬を獲得しました。この城の占領は行われません。':'勝利報酬はありません。この城の占領は行われません。'):'守備側の本拠・領地・資源は維持されています。この城の占領は行われません。';
    }else if(mode==='capture'){
      title=attacker?(won?(captured?(battle.capture.newlyOwned===false?'城の支配を確保':'城を占領'):'合戦に勝利'):'占領できず撤退'):defender?(won?(captured?'城を奪われました':'合戦で敗北'):'城を守り抜きました'):(won?'攻撃側の勝利':'守備側の勝利');
      effect=captured?(attacker?'この城はあなたの所領です。あなたの本拠は変わりません。':'この城は攻撃側の所領になりました。'):won?'占領の確定情報を確認できません。合戦の記録を更新してください。':'城の所有は変わりません。';
    }else{
      title=attacker?(won?'襲撃に成功':'軍を撤退'):defender?(won?'襲撃を受けました':'本拠を防衛'):(won?'攻撃側の勝利':'守備側の勝利');
      effect='本拠の所有は変わりません。';
    }
  }
  return{attacker,defender,confirmed,positive,mode,captured,title,effect,loss};
}
function battleReportHtml(battle,viewerId){
  const summary=battleSummary(battle,viewerId),when=global.SengokuWorldClock?.calendar?.(battle.occurredElapsedMs),loot=battle.loot||{},rewards=battle.rewards||{};
  const values=[['gold','金銭'],['rice','兵糧'],['wood','木材'],['stone','石材']],rewardValues=[...values,...(rewards.magatama!==undefined?[['magatama','勾玉']]:[])];
  const resourceBox=(heading,assets,fields,kind)=>`<div class="field-loot" data-field-reward-kind="${kind}"><span>${heading}</span><div>${fields.map(([key,label])=>`<small>${label}<b>${num(assets[key])}</b></small>`).join('')}</div></div>`;
  const lootBox=summary.mode!=='reward'||values.some(([key])=>integer(loot[key])>0)?resourceBox(summary.attacker?'獲得した戦利品':summary.defender?'失った資源':'移動した資源',loot,values,'loot'):'';
  const rewardBox=summary.mode==='reward'||rewardValues.some(([key])=>integer(rewards[key])>0)?resourceBox(summary.attacker?'勝利報酬':'攻撃側の勝利報酬',rewards,rewardValues,'reward'):'';
  const relocated=summary.captured&&battle.capture?.defenderHomeCastleName?`<p>守備側の本拠：${esc(battle.capture.defenderHomeCastleName)}</p>`:'';
  const garrison=summary.captured&&battle.capture?.newlyOwned!==false&&integer(battle.capture?.garrison)>0?`<p>${summary.attacker?'帰還兵から':'攻撃側の帰還兵から'}${num(battle.capture.garrison)}人を、この城の守備兵として配置しました。</p>`:'';
  return`<article class="field-battle-report ${summary.positive?'is-victory':''}" data-field-battle-mode="${summary.mode}"><span class="field-eyebrow">${summary.attacker?'出陣の記録':summary.defender?'拠点の防衛':'合戦の記録'} · ${summary.mode==='reward'?'報酬戦・占領不可':summary.mode==='capture'?'占領戦':'襲撃'}</span><h3>${summary.title}</h3><p>${playerName(battle.attackerName,battle.attackerEvaluation,battle.attackerAppearance,battle.attackerPlayerId,battle.attackerAvatarVersion)} → ${playerName(battle.defenderName,battle.defenderEvaluation,battle.defenderAppearance,battle.defenderPlayerId,battle.defenderAvatarVersion)}</p><strong>${esc(battle.castleName||'')}</strong><p class="field-battle-effect">${summary.effect}</p>${relocated}${garrison}<div class="field-report-stats"><div><span>出陣</span><b>${num(battle.troops)}人</b></div><div><span>${summary.attacker||summary.defender?'自軍の損失':'攻撃側の損失'}</span><b>${num(summary.attacker||summary.defender?summary.loss:battle.attackerLost)}人</b></div></div>${lootBox}${rewardBox}<small class="field-report-date">${when?`${when.year}年${when.month}月`:'共通時間の合戦記録'}</small></article>`;
}
function makeCache(){return{players:[],total:0,nextCursor:null,me:null,rules:rulesFor(),clock:null,lastFetched:0,loading:false,promise:null,busy:false,error:'',selectedId:'',castleFilter:'',query:'',filter:'all',page:1,tab:'base',relationshipPage:1,battlePage:1,troops:'',tactic:'balanced',confirm:null,lastBattle:null,watchers:new Set()};}
function mount(container,options={}){
  if(!container?.querySelector)return null;if(mounted.has(container)){const existing=mounted.get(container);existing.update(options);return existing;}
  let opts={stateKey:'shared-field',...options},key='',cache=null,map=null,destroyed=false,timer=null,detailHost=null,detailMarkup=null;
  const listeners=[],doc=container.ownerDocument||global.document;
  const getKey=()=>opts.stateKey+':'+(opts.identity?.id||'guest');
  const clockSnapshot=()=>global.SengokuWorldClock?.snapshot?.()||{ready:true,clock:cache.clock};
  const elapsed=()=>clockSnapshot().clock?.confirmedElapsedMs??clockSnapshot().clock?.elapsedMs??cache.clock?.elapsedMs??0;
  const current=()=>cache.players.find(p=>targetKey(p)===cache.selectedId)||null;
  const access=()=>opts.getSyncStatus?.()||{};
  const state=()=>opts.getState?.()||{};
  const canAct=()=>Boolean(opts.identity?.id&&access().writable&&!access().fieldPending&&!cache.busy);
  const notify=()=>{for(const callback of cache.watchers)callback();};
  const message=(text,error=false)=>opts.onMessage?.(text,error);
  function bindCache(){const next=getKey();if(next===key)return;cache?.watchers.delete(render);key=next;if(!caches.has(key))caches.set(key,makeCache());cache=caches.get(key);cache.watchers.add(render);}
  function listen(node,type,fn){node.addEventListener(type,fn);listeners.push(()=>node.removeEventListener(type,fn));}
  function structure(){
    map?.destroy();map=null;
    container.innerHTML=`<div class="sengoku-field"><div class="field-toolbar"><div class="field-world-count"><span>SHARED WORLD</span><strong data-field-summary>領主の拠点を確認中</strong></div><label class="field-search">${icon('search')}<input type="search" data-field-input="search" aria-label="領主・城・勢力を検索" placeholder="領主・城・勢力を検索"></label><select data-field-input="filter" class="field-filter" aria-label="表示する領主"><option value="all">すべての領主</option><option value="online">接続中</option><option value="allied">同盟中</option></select><button type="button" class="field-icon-button" data-field-action="refresh" aria-label="共有フィールドを更新" title="更新">${icon('refresh')}</button></div><div class="field-feedback" data-field-feedback role="status" hidden></div><div class="field-workspace"><section class="field-map-column"><div class="geographic-map-panel field-map-panel"><div class="geographic-map-host" data-field-map></div></div><div class="field-list-heading"><h2>領主の本拠と所領</h2><span data-field-filter-label></span></div><div class="field-player-grid" data-field-players></div><div class="field-pagination" data-field-pagination></div></section><aside class="field-sidebar"><nav class="field-tabs" role="tablist" aria-label="共有フィールドの情報"><button type="button" data-field-action="tab" data-tab="base" role="tab">本拠</button><button type="button" data-field-action="tab" data-tab="diplomacy" role="tab">外交<span data-field-incoming></span></button><button type="button" data-field-action="tab" data-tab="reports" role="tab">合戦報告</button></nav><div class="field-detail" data-field-detail role="tabpanel"></div></aside></div><p class="field-footnote">登録された領主の本拠と所有大都市を、実際の城跡の位置に表示しています。本拠の絵は天守、所領の絵は城郭の成長に連動します。同じ城の領主は一覧で切り替えられます。</p></div>`;
  }
  function selectedRelation(){return cache.me?.relationships?.find(r=>r.targetPlayerId===current()?.playerId);}
  function validation(){return attackValidation({player:current(),me:cache.me,identity:opts.identity,access:access(),state:state(),troops:cache.troops,tactic:cache.tactic,rules:cache.rules,clock:clockSnapshot()});}
  function confirmationKey(player=current()){return JSON.stringify([targetKey(player),battlePolicy(player,cache.rules).mode,String(cache.troops),cache.tactic]);}
  function diplomacyControls(player){
    const relation=relationshipFor(player,cache.me,opts.identity),disabled=!canAct()?' disabled':'';
    if(relation==='self')return'';
    if(relation==='allied'){const record=selectedRelation(),left=record?Math.max(0,record.expiresElapsedMs-elapsed()):0;return`<div class="field-relationship is-allied">${icon('check')}<span>同盟中${record?` · あと${remainingLabel(left)}`:''}<small>同盟が続く間は互いに襲撃できません。</small></span></div>`;}
    if(relation==='incoming')return`<div class="field-relationship"><span>この領主から同盟の申し出が届いています。</span></div><div class="field-actions"><button class="field-button is-gold" data-field-action="diplomacy" data-operation="accept" data-player-id="${esc(player.playerId)}"${disabled}>同盟を承諾</button><button class="field-button" data-field-action="diplomacy" data-operation="reject" data-player-id="${esc(player.playerId)}"${disabled}>辞退</button></div>`;
    if(relation==='outgoing')return`<div class="field-relationship"><span>同盟の返答を待っています。</span></div><button class="field-button is-subtle" data-field-action="diplomacy" data-operation="cancel" data-player-id="${esc(player.playerId)}"${disabled}>申し出を取り消す</button>`;
    return`<button class="field-button is-gold is-full" data-field-action="diplomacy" data-operation="propose" data-player-id="${esc(player.playerId)}"${disabled}>${icon('flag')}同盟を申し込む</button><p class="field-caption">相手の承諾で6か月間の同盟が成立します。</p>`;
  }
  function baseDetail(){
    const player=current();
    if(!player)return`<div class="field-empty"><span>${icon('castle')}</span><h3>${cache.loading?'拠点を確認しています':'領主の拠点を選んでください'}</h3><p>${cache.players.length?'地図の拠点か、下の領主一覧から選べます。':'クラウドへ保存された本拠と所領が、ここに表示されます。'}</p>${!opts.identity?'<button class="field-button is-gold" data-field-action="register">領主登録・ログイン</button>':''}</div>`;
    const relation=relationshipFor(player,cache.me,opts.identity),own=relation==='self',home=isHomeTarget(player),castleId=targetCastleId(player),castleName=targetCastleName(player),policy=battlePolicy(player,cache.rules),art=castleAppearance(player);
    const coLocated=cache.players.filter(p=>targetCastleId(p)===castleId).length,protection=Math.max(0,number(player.protectedUntilElapsedMs)-elapsed());
    let result=`<div class="field-base-heading">${art}<div><span class="field-eyebrow">${esc(castleName)} · 城郭 Lv.${player.level}</span><h3 class="field-lord-heading">${playerPhoto(player)}${playerName(player.name,player.evaluation,player.appearance,player.playerId,player.avatarVersion,false)}</h3><p>${esc(player.clan==='德川家'?'徳川家':player.clan||'')} · ${own?'あなたの':''}${home?'本拠':'所領'}</p><span class="field-online ${player.online?'is-online':''}">${player.online?'接続中':'現在は不在'}</span></div></div><div class="field-base-stats"><div><span>守備兵</span><b>${num(player.defenseTroops)}</b></div><div><span>防衛力</span><b>${num(Math.round(player.defensePower))}</b></div><div><span>軍団</span><b>${num(player.armySummary?.officerCount)}<small>名</small></b></div></div>`;
    if(castleLevelLimit(castleId)>32)result+=`<div class="major-city-badge">${icon('castle')}大都市拠点 · 城郭上限 Lv.${castleLevelLimit(castleId)}</div>`;
    if(['reward','capture'].includes(policy.mode))result+=`<div class="field-battle-mode is-${policy.mode}" data-field-battle-mode="${policy.mode}">${icon(policy.mode==='reward'?'shield':'flag')}<strong>${policy.tag}</strong></div>`;
    if(!home)result+=`<p class="field-caption">領主の本拠：${esc(player.homeCastleName||player.homeCastleId)}。この城は所領です。</p>`;
    if(coLocated>1)result+=`<p class="field-caption">この城には${coLocated}人の領主の拠点があります。一覧で守備する領主を選べます。</p>`;
    if(castleId==='sunpu')result+='<p class="field-caption">駿府城は共同で成長する拠点です。戦後の保護期間も共通です。</p>';
    if(!opts.identity?.id)return result+'<div class="field-notice">出陣・外交・書状・交易は、領主登録後に利用できます。</div><button class="field-button is-gold is-full" data-field-action="register">領主登録・ログイン</button>';
    if(!canAct()&&!cache.busy)result+=`<div class="field-notice">${esc(access().fieldPending?'前の采配を反映しています。':'操作端末と共通時刻を確認すると采配できます。')}<button class="field-inline-button" data-field-action="sync">端末同期を確認</button></div>`;
    if(own){const cooldown=Math.max(0,number(cache.me?.attack?.cooldownUntilElapsedMs)-elapsed());return result+`<div class="field-self-note">${icon('shield')}<div><strong>あなたの旗が、この城に掲がっています。</strong><p>ほかの領主の拠点を選ぶと、出陣や同盟の申し出ができます。</p></div></div><div class="field-key-value"><span>出陣できる兵</span><b>${num(state().troops??cache.me?.attack?.availableTroops)}人</b></div>${cooldown?`<div class="field-key-value"><span>出陣の再準備</span><b>あと${remainingLabel(cooldown)}</b></div>`:''}${protection?`<div class="field-notice">戦後の保護 · あと${remainingLabel(protection)}</div>`:''}`;}
    result+=`<section class="field-letter-box"><h4>領主へ書状を届ける</h4><div class="field-letter-actions"><button type="button" class="field-button" data-field-action="letter-player" data-player-id="${esc(player.playerId)}">領主に書状</button><button type="button" class="field-button" data-field-action="letter-guild" data-player-id="${esc(player.playerId)}">所属同盟に書状</button></div><p class="field-caption">本人への便りか、所属同盟への連絡を選べます。</p></section>`;
    result+='<section class="field-trade-box"><h4>資産を輸出・輸入する</h4><button type="button" class="field-button" data-field-action="trade-player" data-player-id="'+esc(player.playerId)+'">この領主に交易を申し出る</button><p class="field-caption">資産を預け、相手の承認で交換します。無償での提供もできます。</p></section>';
    result+=`<section class="field-diplomacy-box"><h4>外交</h4>${diplomacyControls(player)}</section>`;
    if(policy.mode==='protected')return result+`<div class="field-notice">${icon('shield')}${esc(policy.description)}</div>`;
    if(protection)return result+`<div class="field-notice">戦後の保護期間です。あと${remainingLabel(protection)}で再び対象になります。</div>`;
    if(relation==='allied')return result;
    const attack=cache.me?.attack||{},r=cache.rules,max=Math.min(integer(attack.availableTroops),integer(attack.maxTroops)||r.maxTroops,state().troops===undefined?Infinity:integer(state().troops));
    if(cache.troops==='')cache.troops=String(Math.min(Math.max(r.minTroops,1000),Math.max(r.minTroops,max)));
    const valid=validation(),cost=foodCost(cache.troops,cache.tactic,r),confirm=cache.confirm?.signature===confirmationKey(player),actionLabel=policy.mode==='raid'?'この内容で襲撃':policy.label+'に出陣';
    result+=`<section class="field-attack-box"><h4>${icon('swords')}${policy.mode==='raid'?'拠点への襲撃':policy.label+'へ出陣'}</h4><div class="field-form-row"><label for="field-troops">出陣兵数<small>最大${num(max)}人</small></label><input id="field-troops" data-field-input="troops" type="number" min="${integer(attack.minTroops)||r.minTroops}" max="${max}" step="100" value="${esc(cache.troops)}" inputmode="numeric"></div><div class="field-form-row"><label for="field-tactic">戦法</label><select id="field-tactic" data-field-input="tactic">${r.tactics.map(t=>`<option value="${esc(t.id)}"${cache.tactic===t.id?' selected':''}>${esc(t.name)}</option>`).join('')}</select></div><div class="field-expense"><span>指令${num(r.commandCost)}</span><span>兵糧 <b data-field-food>${num(cost)}</b></span></div><p class="field-action-reason" data-field-attack-reason>${valid.ok?'兵数と戦法を確認して出陣します。':esc(valid.message)}</p>${confirm?`<div class="field-confirm" role="alert"><strong>${esc(castleName)}へ出陣しますか？</strong><p>守備する領主：${playerName(player.name,player.evaluation,player.appearance,player.playerId,player.avatarVersion)} · ${policy.tag}</p><p>${num(cache.troops)}人 · ${esc(r.tactics.find(t=>t.id===cache.tactic)?.name||'')} · 兵糧${num(cost)}</p><p>${policy.description}</p><div class="field-actions"><button class="field-button" data-field-action="cancel-attack">戻る</button><button class="field-button is-danger" data-field-action="attack"${!valid.ok||cache.busy?' disabled':''}>${actionLabel}</button></div></div>`:`<button class="field-button is-danger is-full" data-field-action="confirm-attack"${!valid.ok||cache.busy?' disabled':''}>${icon('swords')}出陣を確認</button><p class="field-caption">${policy.description}</p>`}</section>`;
    return result;
  }
  function diplomacyDetail(){
    if(!opts.identity?.id)return'<div class="field-empty"><h3>外交の使者を送る</h3><p>領主登録後、ほかの領主と同盟を結べます。</p><button class="field-button is-gold" data-field-action="register">領主登録・ログイン</button></div>';
    const order={incoming:0,outgoing:1,allied:2},all=[...(cache.me?.relationships||[])].sort((a,b)=>(order[a.status]??9)-(order[b.status]??9)),pages=Math.max(1,Math.ceil(all.length/4));cache.relationshipPage=Math.min(cache.relationshipPage,pages);
    return`<div class="field-section-title"><h3>外交の往来</h3><p>同盟は双方の承諾で成立します。</p></div>${all.slice((cache.relationshipPage-1)*4,cache.relationshipPage*4).map(rel=>{const label={incoming:'同盟の申し出',outgoing:'返答待ち',allied:'同盟中'}[rel.status]||'',left=Math.max(0,number(rel.expiresElapsedMs)-elapsed()),operations=rel.status==='incoming'?[['accept','承諾'],['reject','辞退']]:rel.status==='outgoing'?[['cancel','取消']]:[];return`<div class="field-diplomacy-row"><div><span class="field-eyebrow">${label}</span><strong>${playerName(rel.targetName,rel.targetEvaluation,rel.targetAppearance,rel.targetPlayerId,rel.targetAvatarVersion)}</strong><small>あと${remainingLabel(left)} · 共通時間</small></div><div class="field-actions">${operations.map(([action,name])=>`<button class="field-button ${action==='accept'?'is-gold':''}" data-field-action="diplomacy" data-operation="${action}" data-player-id="${esc(rel.targetPlayerId)}"${!canAct()?' disabled':''}>${name}</button>`).join('')}</div></div>`;}).join('')||'<div class="field-empty is-small"><span>'+icon('flag')+'</span><p>現在、同盟や返答待ちの申し出はありません。<br>本拠から相手の領主を選んでください。</p></div>'}${pages>1?pagination('relationship-page',cache.relationshipPage,pages):''}`;
  }
  function reportsDetail(){
    const all=[...(cache.me?.battles||[])];if(cache.lastBattle&&!all.some(b=>b.id===cache.lastBattle.id))all.unshift(cache.lastBattle);
    const pages=Math.max(1,Math.ceil(all.length/4));cache.battlePage=Math.min(cache.battlePage,pages);
    const selected=cache.lastBattle||all[0];return`<div class="field-section-title"><h3>合戦の報せ</h3><p>確定した合戦の記録です。</p></div>${selected?battleReportHtml(selected,opts.identity?.id):'<div class="field-empty is-small"><span>'+icon('swords')+'</span><p>まだ合戦の記録はありません。</p></div>'}${all.length>1?`<div class="field-report-list">${all.slice((cache.battlePage-1)*4,cache.battlePage*4).map(b=>`<button class="field-report-row" data-field-action="report" data-battle-id="${esc(b.id)}"><span>${esc(b.castleName||'本拠')}</span><small>${playerName(b.attackerName,b.attackerEvaluation,b.attackerAppearance,b.attackerPlayerId,b.attackerAvatarVersion)} → ${playerName(b.defenderName,b.defenderEvaluation,b.defenderAppearance,b.defenderPlayerId,b.defenderAvatarVersion)}</small></button>`).join('')}</div>${pages>1?pagination('battle-page',cache.battlePage,pages):''}`:''}`;
  }
  function pagination(action,page,pages){return`<div class="field-pager"><button class="field-button" data-field-action="${action}" data-delta="-1"${page<=1?' disabled':''}>前へ</button><span>${page} / ${pages}</span><button class="field-button" data-field-action="${action}" data-delta="1"${page>=pages?' disabled':''}>次へ</button></div>`;}
  function decorateCrests(){for(const node of container.querySelectorAll('[data-field-crest]')){const src=global.SengokuKamon?.url?.(node.dataset.fieldCrest);if(typeof src==='string'&&/^(data:image\/|assets\/)/.test(src))node.innerHTML=`<img src="${esc(src)}" alt="">`;}}
  function renderDetail(){
    const host=container.querySelector('[data-field-detail]');if(!host)return;
    const markup=cache.tab==='diplomacy'?diplomacyDetail():cache.tab==='reports'?reportsDetail():baseDetail();
    // Loaded artwork mutates its own DOM. Keep that DOM and any focused input
    // when the underlying detail has not changed during a shared refresh.
    if(host!==detailHost||markup!==detailMarkup){
      const focused=doc.activeElement,focusedKind=container.contains(focused)?focused?.dataset?.fieldInput:null,selection=focusedKind==='troops'?[focused.selectionStart,focused.selectionEnd]:null;
      host.innerHTML=markup;detailHost=host;detailMarkup=markup;
      if(focusedKind==='troops'||focusedKind==='tactic'){const next=host.querySelector(`[data-field-input="${focusedKind}"]`);next?.focus({preventScroll:true});if(selection?.[0]!=null)try{next?.setSelectionRange(...selection);}catch(_){}}
    }
    for(const button of container.querySelectorAll('[data-tab]'))button.setAttribute('aria-selected',String(button.dataset.tab===cache.tab));
  }
  function render(){
    if(destroyed)return;if(!container.querySelector('.sengoku-field'))structure();
    if(!current()){cache.selectedId=cache.players.length?targetKey(cache.players.find(p=>p.playerId===opts.identity?.id&&isHomeTarget(p))||cache.players[0]):'';cache.confirm=null;}
    const search=container.querySelector('[data-field-input="search"]');if(search.value!==cache.query)search.value=cache.query;container.querySelector('[data-field-input="filter"]').value=cache.filter;
    container.querySelector('[data-field-summary]').textContent=cache.total?`${num(cache.total)}人の領主が、同じ山河に。`:cache.loading?'領主の拠点を確認中':'最初の旗を、この山河へ。';
    const error=container.querySelector('[data-field-feedback]');error.hidden=!cache.error&&!cache.busy;error.textContent=cache.busy?'采配を反映しています…':cache.error;
    container.querySelector('[data-field-action="refresh"]').disabled=cache.loading||cache.busy;
    const q=cache.query.normalize('NFKC').toLocaleLowerCase('ja-JP');
    const filtered=cache.players.filter(p=>(!cache.castleFilter||targetCastleId(p)===cache.castleFilter)&&(cache.filter==='all'||cache.filter==='online'&&p.online||cache.filter==='allied'&&relationshipFor(p,cache.me,opts.identity)==='allied')&&(!q||[p.name,targetCastleName(p),p.clan].some(s=>String(s||'').normalize('NFKC').toLocaleLowerCase('ja-JP').includes(q))));
    const pages=Math.max(1,Math.ceil(filtered.length/4));cache.page=Math.min(Math.max(1,cache.page),pages);
    const castleName=targetCastleName(cache.players.find(p=>targetCastleId(p)===cache.castleFilter));
    container.querySelector('[data-field-filter-label]').innerHTML=`${cache.castleFilter?`<button class="field-inline-button" data-field-action="clear-castle">${esc(castleName||'本拠')}の領主 ${icon('close')}</button>`:`${num(filtered.length)}拠点${new Set(cache.players.map(p=>p.playerId)).size<cache.total?` · ${num(new Set(cache.players.map(p=>p.playerId)).size)} / ${num(cache.total)}領主を読込済み`:''}`}`;
    container.querySelector('[data-field-players]').innerHTML=filtered.slice((cache.page-1)*4,cache.page*4).map(p=>publicRow(p,{selectedId:cache.selectedId,identity:opts.identity,relationship:relationshipFor(p,cache.me,opts.identity),rules:cache.rules})).join('')||`<div class="field-list-empty">${cache.loading?'本拠の情報を読み込んでいます…':cache.players.length?'条件に合う領主はいません。':'まだ公開された本拠はありません。領主登録後にクラウド保存すると、あなたの本拠が表示されます。'}</div>`;
    container.querySelector('[data-field-pagination]').innerHTML=`${pages>1?pagination('page',cache.page,pages):''}${cache.nextCursor?`<button class="field-inline-button" data-field-action="load-more"${cache.loading?' disabled':''}>さらに領主を読み込む</button>`:''}`;
    const incoming=cache.me?.relationships?.filter(r=>r.status==='incoming').length||0;container.querySelector('[data-field-incoming]').textContent=incoming?' '+incoming:'';
    renderDetail();decorateCrests();
    const geography=opts.geography||global.SENGOKU_GEOGRAPHY,groups=groupBases(cache.players,geography?.castles||{},global.SENGOKU_DATA?.castles||[],opts.identity,cache.selectedId,cache.rules),self=cache.players.find(p=>p.playerId===opts.identity?.id&&isHomeTarget(p));
    const mapOptions={stateKey:opts.stateKey+':map:'+String(opts.identity?.id||'guest'),castles:groups,selectedId:targetCastleId(current()),homeId:self?.homeCastleId,clan:'あなたの領地',treaties:{'同盟の領地':1},turn:0,isAdmin:opts.identity?.isAdmin===true,allowRestrictedSelection:true,region:'all',geography,title:'群雄の領地',eyebrow:'SHARED FIELD · JAPAN',countUnit:'拠点',hideRoutes:true,markerSize:48,markerAppearance,legend:{own:'あなた',ally:'同盟',reachable:'出陣可能',other:'ほかの領主'},markerTooltip:marker=>({title:marker.name,description:`表示中：${playerText(marker.displayPlayerName,marker.displayPlayerEvaluation,marker.displayPlayerAppearance)} · ${marker.displayLevelLabel||keepLabel(marker)}`,detail:marker.players?.slice(0,5).map(p=>`${playerText(p.name,p.evaluation,p.appearance)}（${keepLabel(p)}）`).join('・')}),onSelect:castleId=>{cache.castleFilter=castleId;cache.query='';cache.filter='all';cache.page=1;cache.tab='base';cache.confirm=null;const occupants=cache.players.filter(p=>targetCastleId(p)===castleId);if(!occupants.some(p=>targetKey(p)===cache.selectedId))cache.selectedId=occupants[0]?targetKey(occupants[0]):'';render();}};
    if(map)map.update(mapOptions);else map=global.SengokuWorldMap?.mount?.(container.querySelector('[data-field-map]'),mapOptions)||null;
    global.SengokuDesktopFit?.refresh?.();
  }
  async function refresh({append=false}={}){
    if(destroyed)return;if(cache.promise)return cache.promise;if(typeof opts.request!=='function'){cache.error='共有フィールドへ接続できません。ページを再読み込みしてください。';notify();return;}
    const target=cache,identity=opts.identity,request=opts.request,cursor=append?target.nextCursor:null;if(append&&!cursor)return;
    target.loading=true;target.error='';notify();
    const promise=Promise.resolve().then(async()=>{
      const results=await Promise.allSettled([request('/field?limit=100'+(cursor?'&cursor='+encodeURIComponent(cursor):''),{method:'GET'}),!append&&identity?.id?request('/field/me',{method:'GET'}):Promise.resolve(null)]);
      if(results[0].status==='fulfilled'){const payload=results[0].value;if(!Array.isArray(payload?.players)&&!Array.isArray(payload?.targets))throw Error('本拠一覧の応答を確認できませんでした。');const fresh=normalizePlayers(payload);target.players=append?[...new Map([...target.players,...fresh].map(p=>[targetKey(p),p])).values()]:fresh;target.total=Math.max(new Set(target.players.map(p=>p.playerId)).size,integer(payload.total));target.nextCursor=payload.nextCursor??null;target.rules=rulesFor(payload.rules);target.clock=payload.clock||target.clock;target.lastFetched=Date.now();}
      else target.error=results[0].reason?.message||'本拠を取得できませんでした。「更新」から再接続できます。';
      if(results[1].status==='fulfilled'&&results[1].value){target.me=results[1].value;if(target.lastBattle)target.lastBattle=target.me.battles?.find(b=>b.id===target.lastBattle.id)||target.lastBattle;target.rules=rulesFor(target.me.rules||target.rules);target.clock=target.me.clock||target.clock;}
      else if(results[1].status==='rejected'){target.me=null;target.error=results[1].reason?.message||'あなたの出陣準備を確認できませんでした。';}
      for(const player of target.players){const rel=target.me?.relationships?.find(r=>r.targetPlayerId===player.playerId);if(rel)player.relationship=rel.status;}
    }).catch(error=>{target.error=error.message||'共有フィールドへ再接続してください。';}).finally(()=>{target.loading=false;target.promise=null;for(const callback of target.watchers)callback();});
    target.promise=promise;return promise;
  }
  function schedule(){if(timer!==null)global.clearTimeout(timer);timer=null;if(!destroyed&&!doc.hidden)timer=global.setTimeout(async()=>{timer=null;await refresh();schedule();},15000);}
  async function mutate(route,data){
    if(cache.busy)return;const target=cache,request=opts.request,onMutation=opts.onMutation;if(!canAct()){message('この端末の操作権と共通時刻を確認してください。',true);return;}
    target.busy=true;target.error='';target.confirm=null;notify();
    try{const result=await request(route,{method:'POST',data});if(result?.ok===false)throw Error(result.error?.message||'采配を完了できませんでした。');if(route==='/field/attack'&&(!result?.battle||typeof result.battle.won!=='boolean'||typeof result.battle.id!=='string'))throw Error('合戦結果を確認できませんでした。合戦の記録を更新してください。');if(result?.battle){target.lastBattle=result.battle;target.tab='reports';target.battlePage=1;}await onMutation?.(result);target.lastFetched=0;message(route==='/field/attack'?'合戦の報せが届きました。':'外交の状況を更新しました。');}
    catch(error){target.error=error.message||'通信を確認して、もう一度お試しください。';message(target.error,true);}
    finally{target.busy=false;for(const callback of target.watchers)callback();if(!destroyed)await refresh();}
  }
  async function click(event){
    const button=event.target.closest?.('[data-field-action]');if(!button||!container.contains(button)||button.disabled)return;event.stopPropagation();const action=button.dataset.fieldAction;
    if(action==='refresh'){await refresh();return;}if(action==='load-more'){await refresh({append:true});return;}
    if(action==='letter-player'||action==='letter-guild'){if(!opts.identity?.id){opts.onRegister?.();return;}if(global.SengokuLetters?.openCompose)await global.SengokuLetters.openCompose({playerId:button.dataset.playerId,destination:action==='letter-guild'?'guild':'player'});else message('書状を読み込めませんでした。画面を再読み込みしてください。',true);return;}
    if(action==='trade-player'){if(!opts.identity?.id){opts.onRegister?.();return;}if(global.SengokuTrade?.openCompose)await global.SengokuTrade.openCompose({playerId:button.dataset.playerId});else message('交易を読み込めませんでした。画面を再読み込みしてください。',true);return;}
    if(action==='register'){opts.onRegister?.();return;}if(action==='sync'){(opts.onSync||opts.onRegister)?.();return;}
    if(action==='select-player'){const selected=cache.players.find(p=>button.dataset.targetId?targetKey(p)===button.dataset.targetId:p.playerId===button.dataset.playerId&&isHomeTarget(p));if(!selected)return;cache.selectedId=targetKey(selected);cache.tab='base';cache.confirm=null;cache.troops='';render();return;}
    if(action==='clear-castle'){cache.castleFilter='';cache.page=1;render();return;}
    if(action==='tab'){cache.tab=button.dataset.tab;cache.confirm=null;renderDetail();global.SengokuDesktopFit?.refresh?.();return;}
    if(action==='page'||action==='relationship-page'||action==='battle-page'){const key=action==='page'?'page':action==='relationship-page'?'relationshipPage':'battlePage';cache[key]+=Number(button.dataset.delta)||0;render();return;}
    if(action==='report'){cache.lastBattle=cache.me?.battles?.find(b=>String(b.id)===button.dataset.battleId)||cache.lastBattle;renderDetail();return;}
    if(action==='cancel-attack'){cache.confirm=null;renderDetail();return;}
    if(action==='confirm-attack'){const check=validation();if(!check.ok){message(check.message,true);return;}cache.confirm={signature:confirmationKey()};renderDetail();global.SengokuDesktopFit?.refresh?.();return;}
    if(action==='attack'){const check=validation();if(!check.ok){message(check.message,true);return;}if(cache.confirm?.signature!==confirmationKey())return;await mutate('/field/attack',check.payload);return;}
    if(action==='diplomacy'){const operation=button.dataset.operation;if(!['propose','accept','reject','cancel'].includes(operation))return;await mutate('/field/diplomacy',{targetPlayerId:button.dataset.playerId,action:operation});}
  }
  function input(event){const kind=event.target.dataset.fieldInput;if(!kind)return;
    if(kind==='search'){cache.query=event.target.value;cache.page=1;render();}
    else if(kind==='filter'){cache.filter=event.target.value;cache.page=1;render();}
    else if(kind==='troops'||kind==='tactic'){cache[kind]=event.target.value;cache.confirm=null;const cost=container.querySelector('[data-field-food]');if(cost)cost.textContent=num(foodCost(cache.troops,cache.tactic,cache.rules));const check=validation(),reason=container.querySelector('[data-field-attack-reason]');if(reason)reason.textContent=check.ok?'兵数と戦法を確認して出陣します。':check.message;const confirm=container.querySelector('[data-field-action="confirm-attack"]');if(confirm)confirm.disabled=!check.ok||cache.busy;const sent=container.querySelector('[data-field-action="attack"]');if(sent)renderDetail();}
  }
  bindCache();structure();listen(container,'click',click);listen(container,'input',input);listen(container,'change',event=>{if(event.target.tagName==='SELECT')input(event);});listen(doc,'visibilitychange',()=>{if(!doc.hidden)refresh();schedule();});
  const controller={refresh,update(next={}){if(destroyed)return;const old=key;opts={...opts,...next};bindCache();if(old!==key){map?.destroy();map=null;}render();if(old!==key||Date.now()-cache.lastFetched>15000)refresh();},destroy(){if(destroyed)return;destroyed=true;if(timer!==null)global.clearTimeout(timer);timer=null;map?.destroy();cache.watchers.delete(render);for(const remove of listeners)remove();mounted.delete(container);}};
  mounted.set(container,controller);render();if(Date.now()-cache.lastFetched>15000||!cache.lastFetched)refresh();schedule();return controller;
}
const api={mount,normalizePlayers,groupBases,targetKey,targetCastleId,targetCastleName,isHomeTarget,battlePolicy,battleSummary,battleReportHtml,keepLevelInfo,castleAppearance,markerAppearance,foodCost,remainingLabel,relationshipFor,attackValidation,publicRow};global.SengokuField=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
