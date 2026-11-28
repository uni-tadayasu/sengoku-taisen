/* Shared player bases: presentation only. Every action uses the app's guarded
 * request facade and the server's result; battles are never simulated here. */
(function(global){
'use strict';
const caches=new Map(),mounted=new WeakMap();
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=value=>Number.isFinite(Number(value))?Number(value):0;
const integer=value=>Math.max(0,Math.floor(number(value)));
const num=value=>integer(value).toLocaleString('ja-JP');
const playerName=(name,evaluation,appearance=null,playerId='',avatarVersion,showAvatar=true)=>`<span class="player-evaluation-person">${showAvatar&&playerId?global.SengokuAvatar?.markup?.({id:playerId,name,avatarVersion},'inline')||'':''}${global.SengokuCityHonors?.slot?.(playerId)||''}<span class="player-evaluation-name" data-premium-player="${esc(playerId)}" data-premium-player-name="${esc(name)}">${global.SengokuPremiumRuntime?.nameMarkup?.(name,appearance)||esc(name)}</span>${global.SengokuEvaluationUI?.badge?.(evaluation)||''}${global.SengokuPublicCourt?.slot?.(playerId)||''}</span>`;
const playerText=(name,evaluation,appearance=null,playerId='')=>{const label=global.SengokuEvaluationUI?.label?.(evaluation),owned=global.SengokuPremiumRuntime?.ownershipLabel?.(appearance);return String(name||'領主')+(global.SengokuCityHonors?.text?.(playerId)?`［${global.SengokuCityHonors.text(playerId)}］`:'')+(label?`（${label}）`:'')+(owned?`［${owned}］`:'')+(global.SengokuPublicCourt?.text?.(playerId)?`［${global.SengokuPublicCourt.text(playerId)}］`:'');};
const STAFF_BASE_ID=global.SENGOKU_DATA?.staffBaseId||'kyoto_gosho';
const RETIRED_BASE_ID=global.SENGOKU_DATA?.retiredBaseId||'sento_gosho';
const castleLevelLimit=id=>[STAFF_BASE_ID,RETIRED_BASE_ID].includes(id)?128:id==='edo'?64:['nijo','osaka','nagoya'].includes(id)?48:32;
const REWARD_CASTLES=['edo',STAFF_BASE_ID,RETIRED_BASE_ID,global.SENGOKU_DATA?.deputyBaseId||'kagoshima'],CAPTURE_CASTLES=['nijo','osaka','nagoya'];
const HALF_LOOT_POLICY='half-resources-v1';
const HALF_LOOT_DESCRIPTION='勝利報酬は、決着時点の相手の金銭・兵糧・木材・石材の各50%です（端数切り捨て）。各資源の所持上限1億まで受け取り、入らない分は相手に残ります。';
const halfResourceLoot=value=>value?.lootPolicy===HALF_LOOT_POLICY&&value?.lootFraction===.5;
const targetCastleId=player=>player?.targetCastleId||player?.homeCastleId||'';
const targetCastleName=player=>{if(player?.targetBranchId&&typeof player?.targetBranchName==='string')return player.targetBranchName;const id=targetCastleId(player);return(typeof player?.targetCastleName==='string'&&player.targetCastleName)||(id===player?.homeCastleId&&typeof player?.homeCastleName==='string'&&player.homeCastleName)||global.SENGOKU_DATA?.castles?.find(c=>c.id===id)?.name||id;};
const targetKey=player=>String(player?.playerId||'')+':'+targetCastleId(player);
const isHomeTarget=player=>!player?.targetBranchId&&targetCastleId(player)===player?.homeCastleId;
const isCourtEstate=player=>targetCastleId(player)===STAFF_BASE_ID&&player?.holdingKind==='court-estate';
const holdingLabel=player=>isCourtEstate(player)?'共同領地':player?.holdingKind==='territory'?'占領領地':isHomeTarget(player)?'本拠':'所領';
const protectedRegionName=player=>player?.regionProtected===true&&typeof player.protectedRegion==='string'?player.protectedRegion.trim().slice(0,40):'';
const regionProtectionLabel=player=>{const region=protectedRegionName(player);return region?region+'の地域保護':'地域保護';};
function normalizeDurability(raw){
 if(!raw||!Number.isFinite(raw.current)||!Number.isFinite(raw.max)||raw.max<0||raw.current<0||raw.current>raw.max)return null;
 return{current:raw.current,max:raw.max,ratio:raw.max?raw.current/raw.max:0,recoveryPerMonth:Number.isFinite(raw.recoveryPerMonth)?Math.max(0,raw.recoveryPerMonth):0};
}
function durabilityMarkup(raw,options={}){return global.SengokuDurabilityUI?.markup(raw,options)||'';}
function palaceControl(player){
 if(player?.shogunateIndependent===true)return null;
 const value=player?.palaceControl;
 if(targetCastleId(player)!==STAFF_BASE_ID||!value||value.castleId!==STAFF_BASE_ID||typeof value.governmentName!=='string'||!value.governmentName||value.governmentName.length>160||typeof value.controller?.id!=='string'||typeof value.controller?.name!=='string'||!Number.isSafeInteger(value.controlledAt)||value.controlledAt<0)return null;
 return value;
}
function normalizeBranches(rows,parentId){const names={north:'北',east:'東',south:'南',west:'西'},seen=new Set(),limit=global.SENGOKU_DATA?.branchRules?.parents?.find(row=>row.id===parentId)?.maxLevel||(parentId==='edo'?8:24);return(Array.isArray(rows)?rows:[]).flatMap(row=>{if(!row||!['edo','nijo','osaka','nagoya'].includes(parentId)||!Object.hasOwn(names,row.direction)||row.id!==parentId+'_'+row.direction||row.parentCastleId!==parentId||seen.has(row.id))return[];seen.add(row.id);const level=Math.min(limit,integer(row.level));return[{id:row.id,parentCastleId:parentId,direction:row.direction,name:typeof row.name==='string'?row.name:names[row.direction]+'支拠点',level,durability:normalizeDurability(row.durability),fallen:row.fallen===true,building:row.building===true,attackable:row.attackable===true&&level>0&&row.fallen!==true,attackReason:typeof row.attackReason==='string'?row.attackReason:'',defenseTroops:integer(row.defenseTroops),defensePower:Math.max(0,number(row.defensePower))}];});}
function branchTarget(player,branchId){const branch=player?.branches?.find(row=>row.id===branchId);return branch?{...player,targetBranchId:branch.id,targetBranchName:branch.name,durability:branch.durability,level:branch.level,keepLevel:Math.max(1,branch.level),keepLevelKnown:true,attackable:branch.attackable,attackReason:branch.attackReason,capturable:false,battleMode:'branch',defenseTroops:branch.defenseTroops,defensePower:branch.defensePower,armySummary:null}:player;}
function battlePolicy(player,rules={}){
  if(player?.displayOnly===true)return{mode:'protected',label:'領地を見る',tag:holdingLabel(player),description:isCourtEstate(player)?'本拠を保ちながら育てる、京都御所の共同領地です。':`${targetCastleName(player)}は、この領主が占領した領地です。`};
  const id=targetCastleId(player),modern=rules.targetCastles===true,lootRule=halfResourceLoot(rules)?HALF_LOOT_DESCRIPTION:'';
  if(player?.targetBranchId)return modern&&rules.branchBattles===true&&player.battleMode==='branch'&&player.capturable===false?{mode:'branch',label:'支拠点戦',tag:'支拠点を攻略',description:lootRule+'勝利すると支拠点が陥落します。残る支拠点をすべて落とすと、本城へ進軍できます。'}:{mode:'protected',label:'出陣不可',tag:'支拠点戦を確認中',description:'支拠点の出陣条件を確認してください。'};
  if(player?.regionProtected===true)return modern&&rules.specialBaseBattles===true&&player.battleMode==='reward'&&player.capturable===false?{mode:'reward',label:'合戦',tag:'地域保護 · 合戦',description:'地域保護の対象です。合戦に勝利しても占領は移りません。'+(lootRule||'勝利すると報酬を獲得します。')+'出陣前に兵力と兵糧を確認してください。'}:{mode:'protected',label:'出陣不可',tag:'地域保護を確認中',description:'地域保護の合戦条件を確認できません。共有フィールドを更新してください。'};
  if(modern&&rules.specialBaseBattles===true&&REWARD_CASTLES.includes(id)&&player?.battleMode==='reward'&&player?.capturable===false)return{mode:'reward',label:'合戦',tag:'合戦',description:(lootRule||'勝利すると報酬を獲得します。')+'出陣前に兵力と兵糧を確認してください。'};
  if(player?.battleMode==='reward')return{mode:'protected',label:'出陣不可',tag:'合戦条件を確認中',description:'この拠点の合戦条件を確認できません。共有フィールドを更新してください。'};
  if(modern&&CAPTURE_CASTLES.includes(id)&&player?.battleMode==='capture'&&player?.capturable===true)return{mode:'capture',label:'占領戦',tag:'占領戦',description:lootRule+'勝利するとこの城を自分の領地に加えます。あなたの本拠は変わりません。新たに得た城には帰還兵の15%を守備兵として残します。相手の本拠だった場合、相手は通常の城へ移ります。'};
  if(modern&&rules.occupiedTerritoryBattles===true&&(player?.holdingKind==='territory'||CAPTURE_CASTLES.includes(id))&&!REWARD_CASTLES.includes(id)&&player?.battleMode==='raid'&&player?.capturable===false)return{mode:'raid',label:'襲撃',tag:player.holdingKind==='territory'?'占領領地への襲撃':'資源をめぐる合戦',description:(lootRule||'勝利すると相手の資源を獲得します。')+'選択した領主の拠点へ出陣します。守備側には戦後の保護期間があります。'};
  if(REWARD_CASTLES.includes(id)||modern&&CAPTURE_CASTLES.includes(id)||player?.isAdmin||player?.isStaff||!isHomeTarget(player))return{mode:'protected',label:'出陣不可',tag:'出陣条件を確認中',description:player?.attackReason||`${id==='edo'?'江戸城':id===STAFF_BASE_ID?'京都御所':targetCastleName(player)}の出陣条件を確認できません。共有フィールドを更新してください。`};
  return{mode:'raid',label:'襲撃',tag:'資源をめぐる合戦',description:(lootRule||'勝利すると相手の資源を獲得します。')+'守備側には戦後の保護期間があります。'};
}
function keepLevelInfo(player){
  const value=player?.keepLevel,level=typeof value==='number'||typeof value==='string'&&value.trim()?Number(value):NaN;
  const known=player?.keepLevelKnown!==false&&Number.isFinite(level)&&Number.isInteger(level)&&level>=1;
  return{level:known?Math.min(32,level):1,known};
}
const keepLabel=player=>{if(player?.targetBranchId)return`支拠点 Lv.${integer(player.level)}`;if(!isHomeTarget(player))return`城郭 Lv.${Math.max(1,integer(player.level))}`;const keep=keepLevelInfo(player);return keep.known?`天守 Lv.${keep.level}`:'天守 未取得';};
function castleAppearance(player,{marker=false}={}){
  const keep=keepLevelInfo(player),className=marker?'field-map-castle-art':'field-castle-art',kagoshima=targetCastleId(player)==='kagoshima';
  const growth=global.SengokuArt?.castleGrowthInfo?.(targetCastleId(player),{castleLevel:player.level,keepLevel:keep.known?keep.level:undefined,home:isHomeTarget(player)&&!player.targetBranchId});
  const art=global.SengokuArt?.castle?.(targetCastleId(player),className,growth?.level??keep.level,player.appearance||null)||`<span class="field-castle-fallback">${icon('castle')}</span>`;
  const label=kagoshima?(marker?'鶴丸城':'鹿児島城<br>特別絵巻'):marker?(player.targetBranchId?`Lv.${integer(player.level)}`:growth?growth.source+growth.level:keep.known?`Lv.${isHomeTarget(player)?keep.level:Math.max(1,integer(player.level))}`:'Lv.?'):keepLabel(player);
  return`<span class="field-castle-visual ${kagoshima?'is-kagoshima':''} ${isHomeTarget(player)&&player.appearance?.town==='moonlit-castle'?'is-moonlit':''} ${marker?'field-map-castle':''}" data-field-keep-level="${keep.level}" data-field-keep-known="${keep.known}" data-appearance-level="${growth?.level??keep.level}" role="img" aria-label="${esc(targetCastleName(player))}・${kagoshima?'鶴丸城・特別絵巻・':''}${esc(player.targetBranchId?keepLabel(player):growth?.summary||keepLabel(player))}">${art}<span class="field-castle-level" aria-hidden="true">${label}</span>${marker&&player.playerId?`<span class="field-map-owner-identity"><span class="field-map-owner-avatar">${global.SengokuAvatar?.markup?.({id:player.playerId,name:player.name,avatarVersion:player.avatarVersion},'inline')||''}</span>${global.SengokuCityHonors?.slot?.(player.playerId,{cityId:targetCastleId(player),compact:true})||''}</span><span class="public-court-map-tag">${global.SengokuPublicCourt?.slot?.(player.playerId)||''}</span>`:''}</span>`;
}
function markerAppearance(marker){
  if(marker?.branch)return global.SengokuBranches?.mapAppearance?.(marker)||null;
  const player=marker.players?.find(p=>targetKey(p)===marker.displayTargetId);if(!player)return null;
  return{html:castleAppearance(player,{marker:true}),label:`${marker.name} ${marker.ownerLabel||ownershipFor(player).mapLabel} · ${targetCastleId(player)===STAFF_BASE_ID&&!isCourtEstate(player)?'駐在領主：':''}${playerText(player.name,player.evaluation,player.appearance,player.playerId)}の${holdingLabel(player)} ${keepLabel(player)}${isHomeTarget(player)?' 城郭 Lv.'+player.level:''}${marker.players.length>1?'・'+marker.players.length+'人の領主':''}`};
}
const DEFAULT_RULES={minTroops:300,maxTroops:100000,commandCost:1,foodBase:150,foodPerTroop:.3,attackCooldownMs:60000,defenderProtectionMs:60000,allianceDurationMs:360000,tactics:[{id:'balanced',name:'正攻法',food:1,modifier:1,loss:1},{id:'assault',name:'総攻撃',food:1.25,modifier:1.18,loss:1.35},{id:'siege',name:'包囲戦',food:1.65,modifier:.97,loss:.8},{id:'ambush',name:'伏兵',food:1.1,modifier:1.06,loss:.95}]};
const icons={refresh:'M20 8a9 9 0 1 0 1 7M20 3v5h-5',search:'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14m5-2 6 6',castle:'M3 20h18M5 20V10l7-5 7 5v10M3 10h18M9 5l3-3 3 3M10 20v-5h4v5',swords:'m4 3 7 7-3 3-7-7 3-3Zm9 10 7 7M15 18l3-3M20 3l-7 7 3 3 7-7-3-3ZM11 13l-7 7M9 18l-3-3',flag:'M4 22V3m0 1c6-5 10 5 16 0v10c-6 5-10-5-16 0',check:'m4 12 5 5L20 6',shield:'m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6l9-4ZM8 12l3 3 5-6',clock:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v6l4 2',users:'M9 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM2 21v-3c0-3 3-5 7-5s7 2 7 5v3M17 4c5-1 6 7 1 8m1 2c3 1 4 3 4 7',close:'m6 6 12 12M6 18 18 6'};
const icon=name=>`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[name]||icons.castle}"/></svg>`;
function normalizePlayers(payload){
  global.SengokuPublicCourt?.update?.(payload);const input=Array.isArray(payload)?payload:Array.isArray(payload?.targets)?payload.targets:payload?.players;if(!Array.isArray(input))return[];
  const seen=new Set();return input.flatMap(player=>{
    if(!player||typeof player.playerId!=='string'||!player.playerId||typeof player.name!=='string'||typeof player.homeCastleId!=='string'||!player.homeCastleId||player.targetCastleId!==undefined&&(typeof player.targetCastleId!=='string'||!player.targetCastleId))return[];
    const key=targetKey(player);if(seen.has(key))return[];
    const keep=keepLevelInfo(player),castleId=targetCastleId(player),displayOnly=player.displayOnly===true;
    seen.add(key);return[{...player,targetCastleId:castleId,targetCastleName:targetCastleName(player),isHome:castleId===player.homeCastleId,displayOnly,holdingKind:player.holdingKind==='court-estate'&&castleId===STAFF_BASE_ID?'court-estate':player.holdingKind==='territory'?'territory':null,canDevelopCourtEstate:castleId===STAFF_BASE_ID&&player.canDevelopCourtEstate===true,regionProtected:player.regionProtected===true,protectedRegion:protectedRegionName(player)||null,level:Math.max(1,Math.min(castleLevelLimit(castleId),integer(player.level)||1)),durability:normalizeDurability(player.durability),branches:displayOnly?[]:normalizeBranches(player.branches,castleId),keepLevel:keep.level,keepLevelKnown:keep.known,defenseTroops:integer(player.defenseTroops),defensePower:Math.max(0,number(player.defensePower)),isAdmin:player.isAdmin===true,isStaff:player.isStaff===true&&player.isAdmin!==true,self:player.self===true,online:player.online===true,attackable:!displayOnly&&player.attackable===true,capturable:displayOnly?false:typeof player.capturable==='boolean'?player.capturable:null,battleMode:!displayOnly&&['reward','capture','raid'].includes(player.battleMode)?player.battleMode:null}];
  });
}
function rulesFor(rules){return{...DEFAULT_RULES,...rules,tactics:Array.isArray(rules?.tactics)&&rules.tactics.length?rules.tactics:DEFAULT_RULES.tactics};}
function foodCost(troops,tactic,rules){const r=rulesFor(rules),choice=r.tactics.find(t=>t.id===tactic);return choice?Math.ceil(integer(troops)*number(r.foodPerTroop)*number(choice.food))+integer(r.foodBase):null;}
function remainingLabel(milliseconds){const value=Math.max(0,number(milliseconds));return value>=60000?Math.ceil(value/60000)+'か月':Math.ceil(value/1000)+'秒';}
function relationshipFor(player,me,identity){
  if(player?.self||player?.playerId===identity?.id)return'self';
  return me?.relationships?.find(item=>item.targetPlayerId===player?.playerId)?.status||player?.relationship||'neutral';
}
function ownershipFor(player,{identity,relationship=player?.relationship}={}){
  if(targetCastleId(player)===STAFF_BASE_ID){
    const control=palaceControl(player);
    return{relation:'shared',badge:'共同領地',lordLabel:isCourtEstate(player)?'共同領地':'駐在領主',title:control?`${control.governmentName}の支配下`:'朝廷の共同領地',detail:control?`支配者 ${control.controller.name}`:'役職者で共有する京都御所',mapLabel:control?`支配者 ${control.controller.name}`:'朝廷の共同領地'};
  }
  const relation=player?.self||player?.playerId===identity?.id?'self':relationship==='allied'?'ally':'other',name=String(player?.name||'領主');
  return{relation,badge:relation==='self'?'自領':relation==='ally'?'同盟領':'他領',lordLabel:'領主',title:`${name}の領地`,detail:'',mapLabel:`領主 ${name}`};
}
function ownershipBanner(player,options){
  const owner=ownershipFor(player,options);
  return`<div class="field-ownership-banner is-${owner.relation}" aria-label="拠点の領有"><span class="field-owner-relation is-${owner.relation}">${owner.badge}</span><div><strong>${esc(owner.title)}</strong>${owner.detail?`<span>${esc(owner.detail)}</span>`:''}</div></div>`;
}
function groupBases(players,coordinates={},castles=[],identity,selectedTargetId='',rules={}){
  const defs=new Map(castles.map(c=>[c.id,c])),groups=new Map();
  for(const player of players){const id=targetCastleId(player),point=coordinates[id];if(!point||!Number.isFinite(Number(point.lon))||!Number.isFinite(Number(point.lat)))continue;
    if(!groups.has(id)){const def=defs.get(id)||{};groups.set(id,{id,name:targetCastleName(player)||def.name||id,region:def.region||'',geo:point,players:[],level:1,troops:0,neighbors:[]});}
    const group=groups.get(id);group.players.push(player);group.level=Math.max(group.level,player.level);group.troops+=player.defenseTroops;
  }
  return[...groups.values()].map(group=>{
    const own=group.players.some(p=>p.self||p.playerId===identity?.id),allied=group.players.some(p=>p.relationship==='allied');
    const representative=group.players.find(p=>targetKey(p)===selectedTargetId||p.playerId===selectedTargetId)||group.players.find(p=>p.self||p.playerId===identity?.id)||group.players.reduce((best,player)=>!best||keepLevelInfo(player).level>keepLevelInfo(best).level||keepLevelInfo(player).level===keepLevelInfo(best).level&&player.playerId.localeCompare(best.playerId)<0?player:best,null);
    const keep=keepLevelInfo(representative),ownership=ownershipFor(representative,{identity}),shared=group.id===STAFF_BASE_ID||group.players.length>1;
    const ownerLabel=ownership.mapLabel+(group.id!==STAFF_BASE_ID&&group.players.length>1?` ほか${group.players.length-1}名`:''),ownerRelation=shared?'shared':ownership.relation;
    return{...group,name:group.name+(group.players.length>1?` · ${group.players.length}領主`:''),owner:own?'あなたの領地':allied?'同盟の領地':`${group.players.length}領主の領地`,ownerLabel,ownerRelation,reachable:group.players.some(p=>p.attackable&&battlePolicy(p,rules).mode!=='protected'),own,keepLevel:keep.level,keepLevelKnown:keep.known,isHome:isHomeTarget(representative),homeCastleId:representative.homeCastleId,targetCastleId:targetCastleId(representative),displayPlayerId:representative.playerId,displayTargetId:targetKey(representative),displayPlayerName:representative.name,displayPlayerEvaluation:representative.evaluation,displayPlayerAppearance:representative.appearance,displayPlayerAvatarVersion:representative.avatarVersion,displayLevelLabel:keepLabel(representative)+(isHomeTarget(representative)?' · 城郭 Lv.'+representative.level:''),durability:representative.durability};
  });
}
function attackValidation({player,me,identity,access={},state={},troops,tactic,rules,clock}){
  if(!identity?.id)return{ok:false,message:'領主登録・ログインが必要です。'};
  if(state.march)return{ok:false,message:'部隊が進軍中です。到着後の戦果を確認してから次の出陣を選べます。'};
  if(access.fieldPending)return{ok:false,message:'前の采配を反映しています。'};
  if(!access.writable)return{ok:false,message:'この端末を操作端末にすると出陣できます。'};
  if(clock&&(!clock.ready||clock.clock?.running===false))return{ok:false,message:clock.ready?'共通時間が停止しています。':'共通時刻の確認を待っています。'};
  if(!player)return{ok:false,message:'相手の領主を選んでください。'};
  if(player.self||player.playerId===identity.id)return{ok:false,message:'自分の領地には出陣できません。'};
  if(me?.residency?.castleId&&player.householdCastleId===me.residency.castleId)return{ok:false,message:'同じ城の領主・家臣には出陣できません。'};
  const policy=battlePolicy(player,rules);if(policy.mode==='protected')return{ok:false,message:policy.description};
  if(relationshipFor(player,me,identity)==='allied')return{ok:false,message:'同盟中の領主には出陣できません。'};
  if(me?.self?.homeCastleId===STAFF_BASE_ID&&targetCastleId(player)==='edo'&&me.attack?.canAttackEdoFromKyoto!==true)return{ok:false,message:player.attackReason||'京都御所から江戸城へ出陣できるのは、在任中の天皇または摂政です。'};
  if(!player.targetBranchId&&rules?.branchBattles===true&&player.branches?.some(branch=>branch.level>0&&!branch.fallen))return{ok:false,message:player.attackReason||'本城へ攻める前に、防衛中の支拠点をすべて陥落させてください。'};
  if(!player.attackable)return{ok:false,message:player.attackReason||'この拠点は現在保護されています。'};
  if(!me?.attack?.ready)return{ok:false,message:me?.attack?.reason||'本拠と出陣の準備を確認しています。'};
  const r=rulesFor(rules),amount=Number(troops),min=Math.max(1,integer(me.attack.minTroops)||integer(r.minTroops)),max=Math.min(integer(me.attack.maxTroops)||integer(r.maxTroops),integer(me.attack.availableTroops),state.troops===undefined?Infinity:integer(state.troops));
  if(!Number.isInteger(amount)||amount<min||amount>max)return{ok:false,message:`出陣兵数は${num(min)}〜${num(max)}人で指定してください。`};
  const cost=foodCost(amount,tactic,r);if(cost===null)return{ok:false,message:'戦法を選んでください。'};
  if(integer(state.command??me.attack.command)<integer(r.commandCost))return{ok:false,message:'出陣に必要な指令がありません。'};
  if(integer(state.resources?.rice??me.attack.rice)<cost)return{ok:false,message:`兵糧が${num(cost)}必要です。`};
  const payload={targetPlayerId:player.playerId,troops:amount,tactic};if(r.targetCastles===true)payload.targetCastleId=targetCastleId(player);if(player.targetBranchId&&r.branchBattles===true)payload.targetBranchId=player.targetBranchId;
  return{ok:true,foodCost:cost,battleMode:policy.mode,payload};
}
function armyPower(state={}){
  const ranks=global.SENGOKU_DATA?.ranks||['D','C','B','A','S','SS','SSS','U'],powers=[.9,.95,1,1.08,1.16,1.25,1.35,1.5],variants=new Set(state.officerVariants||[]),army=Array.isArray(state.army)?state.army:[];
  return army.length?Math.round(army.reduce((sum,id)=>sum+(Math.max(...ranks.map((rank,i)=>variants.has(id+':'+rank)?powers[i]||1:0))||1)*(global.SengokuEngine?.officerCombatFactor?.(state,id)??1),0)/army.length*1000)/1000:.75;
}
function estimateBattle({player,state={},troops,tactic,rules}={},readArmyPower=null){
  const r=rulesFor(rules),choice=r.tactics.find(t=>t.id===tactic),fallback=DEFAULT_RULES.tactics.find(t=>t.id===tactic),amount=Number(troops),defensePower=Number(player?.defensePower);
  if(!choice||!fallback||!Number.isInteger(amount)||amount<r.minTroops||amount>r.maxTroops||!Number.isFinite(defensePower)||defensePower<=0)return{ok:false,message:'公開されている守備戦力と出陣兵数を確認してください。'};
  const modifier=Number(choice.modifier??fallback.modifier),loss=Number(choice.loss??fallback.loss),morale=Math.max(0,Math.min(100,number(state.morale))),attackPower=Math.max(1,Math.round(amount*(.7+.5*morale/100)*(1+integer(state.tech?.discipline)*.06+integer(state.tech?.gunnery)*.05)*(readArmyPower?readArmyPower():armyPower(state))*modifier)),ratio=attackPower/defensePower,chance=Math.max(.05,Math.min(.95,.5+Math.log(ratio)*.6));
  const casualties=won=>Math.min(amount,Math.max(1,Math.floor(amount*Math.min(.35,(won?.08+.06/Math.max(.3,ratio):.2+.06/Math.max(.3,ratio))*loss))));
  return{ok:true,tactic,tacticName:choice.name,troops:amount,winChance:Math.round(chance*100),estimatedLoss:Math.round(chance*casualties(true)+(1-chance)*casualties(false)),foodCost:foodCost(amount,tactic,r),attackPower,defensePower,approximate:true,reasons:[`公開守備${num(player.defenseTroops)}人・守備戦力${num(defensePower)}を基準にした推定です。`,`軍団の階級・体力・士気・研究を反映し、${choice.name}で${num(amount)}人の出陣を比較しました。`,'敵の援軍や戦況の変化、包囲・攻城研究による守備力の低下はこの推定に含みません。']};
}
function battleAdvice(context={}){
  const advisor=global.SengokuBattleAdvisor;if(!advisor)return null;
  const {player,me,state={},style='balanced'}=context,r=rulesFor(context.rules),minimum=Math.max(1,integer(me?.attack?.minTroops)||r.minTroops),maximum=Math.min(integer(me?.attack?.maxTroops)||r.maxTroops,integer(me?.attack?.availableTroops),state.troops===undefined?Infinity:integer(state.troops)),rice=integer(state.resources?.rice??me?.attack?.rice),candidates=[];
  // Troop/tactic candidates share one army snapshot during this synchronous read.
  // Recompute on every new advice request so rank, health and army edits stay fresh.
  let strength;const readArmyPower=()=>strength??(strength=armyPower(state));
  const initial=attackValidation({...context,troops:minimum,tactic:r.tactics[0]?.id});
  for(const tactic of r.tactics){const max=Math.min(maximum,Math.floor((rice-r.foodBase)/(r.foodPerTroop*tactic.food)));if(max<minimum)continue;const counts=new Set([minimum,max,Number(context.troops)]);
    for(let i=1;i<24;i++)counts.add(Math.floor(minimum+(max-minimum)*i/24));
    const sample=estimateBattle({player,state,troops:minimum,tactic:tactic.id,rules:r},readArmyPower);if(sample.ok)for(const goal of [.5,.65,.75,.85,.9,.95])counts.add(Math.ceil(minimum*sample.defensePower*Math.exp((goal-.5)/.6)/sample.attackPower));
    for(const troops of counts){if(!Number.isInteger(troops)||troops<minimum||troops>max)continue;const check=attackValidation({...context,troops,tactic:tactic.id,rules:r});if(!check.ok)continue;const estimate=estimateBattle({player,state,troops,tactic:tactic.id,rules:r},readArmyPower);if(estimate.ok)candidates.push(estimate);}
  }
  return advisor.compare(candidates,{style,targetName:targetCastleName(player),emptyMessage:initial.ok?'公開守備戦力を再取得してください。':initial.message});
}
function playerPhoto(player){const user={...player,id:player.playerId};return global.SengokuAvatar?.markup?.(user,'small')||'';}
function publicRow(player,{selectedId='',identity,relationship=player.relationship,rules={}}={}){
  const own=player.self||player.playerId===identity?.id,label=own?'あなた':relationship==='allied'?'同盟':relationship==='incoming'?'申請あり':relationship==='outgoing'?'申請中':player.online?'接続中':'領主';
  const photo=playerPhoto(player),selected=selectedId===targetKey(player),policy=battlePolicy(player,rules),ownership=ownershipFor(player,{identity,relationship});
  const house=player.clan||'',crest=!photo&&global.SengokuKamon?.url?.(house);
  const crestArt=typeof crest==='string'&&/^(data:image\/|assets\/)/.test(crest)?`<img src="${esc(crest)}" alt="">`:icon('flag');
  return`<button type="button" class="field-player-row ${selected?'is-selected':''} ${own?'is-self':''}" data-field-action="select-player" data-stable-key="${esc(targetKey(player))}" data-player-id="${esc(player.playerId)}" data-target-id="${esc(targetKey(player))}" aria-pressed="${selected}">${photo?`<span class="field-player-mon field-player-photo">${photo}</span>`:`<span class="field-player-mon" data-field-crest="${esc(house)}">${crestArt}</span>`}<span class="field-player-copy"><strong class="field-owner-name"><span class="field-owner-caption">${ownership.lordLabel}</span>${playerName(player.name,player.evaluation,player.appearance,player.playerId,player.avatarVersion,false)}</strong><small class="field-owner-location"><span class="field-owner-relation is-${ownership.relation}">${ownership.badge}</span>${esc(targetCastleName(player))} · ${holdingLabel(player)}</small><small>${esc(player.clan||'')}${['reward','capture'].includes(policy.mode)?' · '+policy.tag:''}</small>${player.regionProtected===true&&!player.targetBranchId?`<small class="field-region-protection-label">${esc(regionProtectionLabel(player))}</small>`:''}${palaceControl(player)?`<small class="field-palace-label">${esc(palaceControl(player).governmentName)}の支配下</small>`:''}</span><span class="field-player-meta"><span class="field-player-tag ${player.online?'is-online':''}">${esc(label)}</span><small>${keepLabel(player)}${isHomeTarget(player)?' · 城郭 Lv.'+player.level:''}</small>${player.displayOnly?`<small>${isCourtEstate(player)?'共同普請':'占領領地'}</small>`:`<small>${num(player.defenseTroops)}兵</small>`}${player.durability?`<small>${esc(global.SengokuDurabilityUI?.summary(player.durability)||'')}</small>`:''}</span></button>`;
}
function battleSummary(battle={},viewerId){
  const attacker=Boolean(viewerId&&battle.attackerPlayerId===viewerId),defender=Boolean(viewerId&&battle.defenderPlayerId===viewerId),confirmed=typeof battle.won==='boolean',won=battle.won===true;
  const mode=['reward','capture','raid','branch'].includes(battle.battleMode)?battle.battleMode:'raid';
  const captured=confirmed&&won&&mode==='capture'&&battle.capture?.captured===true&&CAPTURE_CASTLES.includes(battle.castleId)&&battle.capture.castleId===battle.castleId;
  const positive=confirmed&&(attacker?won:defender?!won:false),loss=attacker?integer(battle.attackerLost):defender?integer(battle.defenderLost?.troops)+integer(battle.defenderLost?.garrison):0;
  let title='合戦結果を確認中',effect='勝敗が確定した記録を読み込み直してください。';
  if(confirmed){
    if(mode==='branch'){
      title=attacker?(won?'支拠点戦に勝利':'支拠点から撤退'):defender?(won?'支拠点が陥落':'支拠点を防衛'):(won?'攻撃側の勝利':'守備側の勝利');effect=won&&battle.branchFallen===true?'支拠点が陥落しました。残る支拠点をすべて落とすと本城へ進軍できます。':won?'支拠点の陥落状態を最新の報告で確認してください。':'支拠点の守りは維持されています。';
    }else if(mode==='reward'){
      title=attacker?(won?'合戦に勝利':'合戦から撤退'):defender?(won?'合戦で敗北':'城を守り抜きました'):(won?'攻撃側の勝利':'守備側の勝利');
      effect=attacker?(won?'勝利報酬を獲得しました。':'勝利報酬はありません。'):'合戦の結果と兵の損失を確認できます。';
    }else if(mode==='capture'){
      title=attacker?(won?(captured?(battle.capture.newlyOwned===false?'城の支配を確保':'城を占領'):'合戦に勝利'):'占領できず撤退'):defender?(won?(captured?'城を奪われました':'合戦で敗北'):'城を守り抜きました'):(won?'攻撃側の勝利':'守備側の勝利');
      effect=captured?(attacker?'この城はあなたの所領です。あなたの本拠は変わりません。':'この城は攻撃側の所領になりました。'):won?'占領の確定情報を確認できません。合戦の記録を更新してください。':'城の所有は変わりません。';
    }else{
      title=attacker?(won?'襲撃に成功':'軍を撤退'):defender?(won?'襲撃を受けました':'本拠を防衛'):(won?'攻撃側の勝利':'守備側の勝利');
      effect=battle.succession?.lordPlayerId?'襲撃の戦利品と兵の損失を反映しました。城の領主は家臣へ引き継がれます。':'合戦の戦利品と兵の損失を反映しました。';
    }
  }
  if(confirmed&&halfResourceLoot(battle)){
    const transfer=won?(attacker?'相手の資源を勝利報酬として移転しました。':defender?'攻撃側への資源の移転を反映しました。':'勝利報酬の資源移転を反映しました。'):'勝利報酬による資源の移転はありません。';
    effect=mode==='reward'?transfer:effect+transfer;
  }
  return{attacker,defender,confirmed,positive,mode,captured,title,effect,loss};
}
function battleReportHtml(battle,viewerId){
  const summary=battleSummary(battle,viewerId),when=global.SengokuWorldClock?.calendar?.(battle.occurredElapsedMs),loot=battle.loot||{},rewards=battle.rewards||{},halfResources=halfResourceLoot(battle);
  const values=[['gold','金銭'],['rice','兵糧'],['wood','木材'],['stone','石材']],rewardValues=[...values,...(rewards.magatama!==undefined?[['magatama','勾玉']]:[])];
  const resourceBox=(heading,assets,fields,kind)=>`<div class="field-loot" data-field-reward-kind="${kind}"><span>${heading}</span><div>${fields.map(([key,label])=>`<small>${label}<b>${num(assets[key])}</b></small>`).join('')}</div></div>`;
  const lootBox=halfResources||summary.mode!=='branch'&&(summary.mode!=='reward'||values.some(([key])=>integer(loot[key])>0))?resourceBox(summary.attacker?(halfResources?'勝利報酬・奪った資源':'獲得した戦利品'):summary.defender?'失った資源':'移動した資源',loot,values,'loot'):'';
  const rewardBox=!halfResources&&summary.mode!=='branch'&&(summary.mode==='reward'||rewardValues.some(([key])=>integer(rewards[key])>0))?resourceBox(summary.attacker?'勝利報酬':'攻撃側の勝利報酬',rewards,rewardValues,'reward'):'';
  const lootNote=halfResources?`<p class="field-caption" data-field-loot-policy="${HALF_LOOT_POLICY}">勝利時は、決着時点の守備側の金銭・兵糧・木材・石材を各50%移転します（端数切り捨て・攻撃側の各資源の所持上限1億まで）。表示額は実際の移転量です。${battle.lootCapacityLimited===true?'受取上限に達した資源は、入る分だけを移転しました。残りは守備側に残っています。':''}</p>`:'';
  const lootAnalysis=halfResources?'<dt>勝利時の資源移転率</dt><dd>各50% · 端数切り捨て</dd>':Number.isFinite(Number(battle.analysis?.lootScale))?`<dt>当時の戦力差による戦利品係数</dt><dd>${Number(battle.analysis.lootScale)*100}%</dd>`:'';
  const succession=battle.succession,successionHtml=succession?`<div class="residency-succession"><strong>領主の継承</strong><p>${succession.lordPlayerId?`${esc(succession.castleName||battle.castleName)}は、先に仕えた家臣 ${global.SengokuCityHonors?.slot?.(succession.lordPlayerId)||''}${esc(succession.lordName||'プレイヤー')}${global.SengokuPublicCourt?.slot?.(succession.lordPlayerId)||''} が領主を引き継ぎました。前の領主 ${global.SengokuCityHonors?.slot?.(succession.previousLordPlayerId)||''}${esc(succession.previousLordName||'プレイヤー')}${global.SengokuPublicCourt?.slot?.(succession.previousLordPlayerId)||''} は家臣の最後尾に移ります。`:`${esc(succession.castleName||battle.castleName)}の領主の席は空席になりました。`}</p><button type="button" class="field-button" data-residency-open="${esc(succession.castleId||'')}">城の領主と家臣</button></div>`:'';
  const relocated=summary.captured&&battle.capture?.defenderHomeCastleName?`<p>守備側の本拠：${esc(battle.capture.defenderHomeCastleName)}</p>`:'';
  const garrison=summary.captured&&battle.capture?.newlyOwned!==false&&integer(battle.capture?.garrison)>0?`<p>${summary.attacker?'帰還兵から':'攻撃側の帰還兵から'}${num(battle.capture.garrison)}人を、この城の守備兵として配置しました。</p>`:'';
  return`<article class="field-battle-report ${summary.positive?'is-victory':''}" data-field-battle-mode="${summary.mode}"><span class="field-eyebrow">${summary.attacker?'出陣の記録':summary.defender?'拠点の防衛':'合戦の記録'} · ${summary.mode==='reward'?'合戦':summary.mode==='capture'?'占領戦':summary.mode==='branch'?'支拠点戦':'襲撃'}</span><h3>${summary.title}</h3><p>${playerName(battle.attackerName,battle.attackerEvaluation,battle.attackerAppearance,battle.attackerPlayerId,battle.attackerAvatarVersion)} → ${playerName(battle.defenderName,battle.defenderEvaluation,battle.defenderAppearance,battle.defenderPlayerId,battle.defenderAvatarVersion)}</p><strong>${esc(battle.branchName||battle.castleName||'')}</strong><p class="field-battle-effect">${summary.effect}</p>${relocated}${garrison}${successionHtml}${global.SengokuDurabilityUI?.battleMarkup(battle.durability)||''}<div class="field-report-stats"><div><span>出陣</span><b>${num(battle.troops)}人</b></div><div><span>${summary.attacker||summary.defender?'自軍の損失':'攻撃側の損失'}</span><b>${num(summary.attacker||summary.defender?summary.loss:battle.attackerLost)}人</b></div></div>${lootBox}${rewardBox}${lootNote}${battle.analysis?`<details class="field-battle-analysis"><summary>勝敗の理由と補正を見る</summary><p>${esc(battle.analysis.explanation)}</p><dl><dt>攻撃戦力 / 防衛戦力</dt><dd>${num(battle.analysis.attackPower)} / ${num(battle.analysis.defensePower)}</dd><dt>事前の攻撃側勝率</dt><dd>${num(battle.analysis.winChance)}%（確定ではありません）</dd><dt>出陣時の士気 / 戦法</dt><dd>${num(battle.analysis.morale)} / ${esc(battle.analysis.tactic)}</dd><dt>防衛援軍</dt><dd>${num(battle.analysis.reinforcementTroops)}人</dd>${lootAnalysis}</dl></details>`:''}<small class="field-report-date">${when?`${when.year}年${when.month}月`:'共通時間の合戦記録'}</small></article>`;
}
function makeCache(){return{players:[],total:0,nextCursor:null,loadedPages:0,me:null,rules:rulesFor(),clock:null,lastFetched:0,loading:false,promise:null,busy:false,error:'',selectedId:'',selectedBranchId:'',castleFilter:'',query:'',filter:'all',page:1,tab:'base',relationshipPage:1,battlePage:1,troops:'',tactic:'balanced',advisorStyle:'balanced',confirm:null,lastBattle:null,watchers:new Set()};}
function mount(container,options={}){
  if(!container?.querySelector)return null;if(mounted.has(container)){const existing=mounted.get(container);existing.update(options);return existing;}
  let opts={stateKey:'shared-field',...options},key='',cache=null,map=null,destroyed=false,timer=null,detailHost=null,detailMarkup=null,homeSelectionPending=true;
  const listeners=[],doc=container.ownerDocument||global.document;
  const getKey=()=>opts.stateKey+':'+(opts.identity?.id||'guest');
  const clockSnapshot=()=>global.SengokuWorldClock?.snapshot?.()||{ready:true,clock:cache.clock};
  const elapsed=()=>clockSnapshot().clock?.confirmedElapsedMs??clockSnapshot().clock?.elapsedMs??cache.clock?.elapsedMs??0;
  const parentCurrent=()=>cache.players.find(p=>targetKey(p)===cache.selectedId)||null;
  const current=()=>branchTarget(parentCurrent(),cache.selectedBranchId);
  const access=()=>opts.getSyncStatus?.()||{};
  const state=()=>opts.getState?.()||{};
  const homeId=()=>state().home||cache.me?.self?.homeCastleId||cache.players.find(p=>p.playerId===opts.identity?.id&&isHomeTarget(p))?.homeCastleId;
  const canAct=()=>Boolean(opts.identity?.id&&access().writable&&!access().fieldPending&&!cache.busy);
  const notify=()=>{for(const callback of cache.watchers)callback();};
  const message=(text,error=false)=>opts.onMessage?.(text,error);
  function bindCache(){const next=getKey();if(next===key)return;cache?.watchers.delete(render);key=next;if(!caches.has(key))caches.set(key,makeCache());cache=caches.get(key);cache.selectedId='';cache.selectedBranchId='';cache.castleFilter='';cache.tab='base';cache.confirm=null;homeSelectionPending=true;cache.watchers.add(render);}
  function listen(node,type,fn){node.addEventListener(type,fn);listeners.push(()=>node.removeEventListener(type,fn));}
  function structure(){
    map?.destroy();map=null;
    container.innerHTML=`<div class="sengoku-field"><div class="field-toolbar"><div class="field-world-count"><span>SHARED WORLD</span><strong data-field-summary>領主の拠点を確認中</strong></div><label class="field-search">${icon('search')}<input type="search" data-field-input="search" aria-label="領主・城・勢力を検索" placeholder="領主・城・勢力を検索"></label><button type="button" class="field-button input-list-button" data-field-action="search-list" aria-label="領主・城・勢力の一覧から選ぶ">一覧</button><select data-field-input="filter" class="field-filter" aria-label="表示する領主"><option value="all">すべての拠点</option><option value="own">自分の領地</option><option value="territories">占領領地</option><option value="court-estate">京都御所</option><option value="online">接続中</option><option value="allied">同盟中</option></select><button type="button" class="field-icon-button" data-field-action="refresh" aria-label="共有フィールドを更新" title="更新">${icon('refresh')}</button></div><div class="field-feedback" data-field-feedback role="status" hidden></div><div class="field-workspace"><section class="field-map-column"><div class="geographic-map-panel field-map-panel"><div class="geographic-map-host" data-field-map></div></div><div class="field-list-heading"><h2>領主の本拠と所領</h2><button type="button" class="field-inline-button" data-field-action="own-court" hidden>京都御所を見る</button><span data-field-filter-label></span></div><div class="field-player-grid" data-field-players></div><div class="field-pagination" data-field-pagination></div></section><aside class="field-sidebar"><nav class="field-tabs" role="tablist" aria-label="共有フィールドの情報"><button type="button" data-field-action="tab" data-tab="base" role="tab">本拠</button><button type="button" data-field-action="tab" data-tab="diplomacy" role="tab">外交<span data-field-incoming></span></button><button type="button" data-field-action="tab" data-tab="reports" role="tab">合戦報告</button></nav><div class="field-detail" data-field-detail role="tabpanel"></div></aside></div><p class="field-footnote">登録された領主の本拠と占領領地を、実際の城跡の位置に表示しています。共同普請できる領主には、京都御所も共同領地として表示します。鹿児島城は鶴丸城の特別絵巻で表示します。ほかの本拠の絵は天守、所領の絵は城郭の成長に連動します。同じ城の領地も、領主ごとに選んで確認できます。「城の領主と家臣」でプレイヤー家臣と継承順を確認できます。名前や位階の横の役職名は、現在の公職を表します。</p></div>`;
  }
  function selectedRelation(){return cache.me?.relationships?.find(r=>r.targetPlayerId===current()?.playerId);}
  function validation(){return attackValidation({player:current(),me:cache.me,identity:opts.identity,access:access(),state:state(),troops:cache.troops,tactic:cache.tactic,rules:cache.rules,clock:clockSnapshot()});}
  function advice(){return battleAdvice({player:current(),me:cache.me,identity:opts.identity,access:access(),state:state(),troops:cache.troops,rules:cache.rules,clock:clockSnapshot(),style:cache.advisorStyle});}
  function applyAdvice(){if(!canAct())return false;const proposed=advice();if(!proposed?.ok){message(proposed?.message||'出陣条件を確認してください。',true);return false;}cache.troops=String(proposed.troops);cache.tactic=proposed.tactic;cache.confirm=null;renderDetail();message('軍師の案を反映しました。出陣内容を確認してください。');return true;}
  function confirmationKey(player=current()){return JSON.stringify([targetKey(player),player?.targetBranchId||'',battlePolicy(player,cache.rules).mode,player?.regionProtected===true,protectedRegionName(player),String(cache.troops),cache.tactic]);}
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
    let result=`${ownershipBanner(player,{identity:opts.identity,relationship:relation})}<div class="field-base-heading">${art}<div><span class="field-eyebrow">${esc(castleName)} · ${player.targetBranchId?'支拠点':'城郭'} Lv.${player.level}</span><h3 class="field-lord-heading">${playerPhoto(player)}${playerName(player.name,player.evaluation,player.appearance,player.playerId,player.avatarVersion,false)}</h3><p>${esc(player.clan||'')} · ${own?'あなたの':''}${player.targetBranchId?'支拠点':holdingLabel(player)}</p>${global.SengokuLordProfile?.profileButton?.({id:player.playerId,name:player.name},'領主プロフィール')||''}<span class="field-online ${player.online?'is-online':''}">${player.online?'接続中':'現在は不在'}</span></div></div>${player.displayOnly?`<p class="field-holding-summary field-caption">${esc(policy.description)}</p>`:`<div class="field-base-stats"><div><span>守備兵</span><b>${num(player.defenseTroops)}</b></div><div><span>防衛力</span><b>${num(Math.round(player.defensePower))}</b></div><div><span>軍団</span><b>${num(player.armySummary?.officerCount)}<small>名</small></b></div></div>`}`;
    result+=`<div class="field-base-durability">${durabilityMarkup(player.durability,{kind:player.targetBranchId?'branch':'castle',id:player.targetBranchId||castleId})}</div>`;
    if(!player.targetBranchId&&castleLevelLimit(castleId)>32)result+=`<div class="major-city-badge">${icon('castle')}大都市拠点 · 城郭上限 Lv.${castleLevelLimit(castleId)}</div>`;
    if(['reward','capture','branch'].includes(policy.mode))result+=`<div class="field-battle-mode is-${policy.mode}" data-field-battle-mode="${policy.mode}">${icon('flag')}<strong>${policy.tag}</strong></div>`;
    if(player.regionProtected===true&&!player.targetBranchId)result+=`<div class="field-notice" data-field-region-protected>${icon('shield')}<div><strong>${esc(regionProtectionLabel(player))}</strong><p>合戦に勝利しても占領は移りません。</p></div></div>`;
    if(!home&&!player.targetBranchId)result+=`<p class="field-caption">領主の本拠：${esc(player.homeCastleName||player.homeCastleId)}。${isCourtEstate(player)?'京都御所は共同普請できる領地です。':player.holdingKind==='territory'?'この城は占領領地です。':'この城は所領です。'}</p>`;
    if(home&&!player.targetBranchId&&global.SENGOKU_DATA?.castles?.some(c=>c.id===castleId&&!c.majorCity))result+=`<div class="residency-field-entry"><button type="button" class="field-button is-full" data-residency-open="${esc(castleId)}">城の領主と家臣</button><p class="field-caption">家臣 ${num(player.retainerCount)}人 · 本拠の防衛戦に敗れると、先に仕えた家臣から領主を継承します。</p></div>`;
    if(coLocated>1)result+=`<p class="field-caption">この城には${coLocated}人分の領地が表示されています。一覧で領主ごとの領地を選べます。</p>`;
    if(castleId===STAFF_BASE_ID){
      const control=palaceControl(player);
      result+=control?`<section class="field-palace-control" aria-label="京都御所の支配"><strong>${esc(control.governmentName)}の支配下</strong><span>支配者：${esc(control.controller.name)}</span><p>天皇による幕府開設の承認期限（申請から72時間）が過ぎたため、京都御所はこの幕府の支配下にあります。</p></section>`:'<p class="field-caption">京都御所は朝廷が治めています。幕府開設の申請を天皇が72時間以内に承認しないと、申請した幕府の支配下になります。</p>';
      result+='<p class="field-caption">京都御所は共同普請で成長する拠点です。</p>';
      if(own&&player.canDevelopCourtEstate)result+='<button type="button" class="field-button is-gold is-full" data-field-action="court-estate">京都御所を共同普請</button>';
    }
    if(player.branches?.length){const parent=parentCurrent(),intact=player.branches.filter(branch=>branch.level>0&&!branch.fallen);result+=`<section class="field-branches"><h4>本城と支拠点</h4><p class="field-caption">${intact.length?'本城への出陣には、残る支拠点 '+intact.length+'か所の攻略が必要です。':'防衛中の支拠点はありません。'}</p><div class="field-branch-list"><button class="field-branch-choice" data-field-action="select-branch" data-branch-id="" aria-pressed="${!player.targetBranchId}"><span>${esc(targetCastleName(parent))} · 本城</span><small>${intact.length?'支拠点を先に攻略':'本城を選ぶ'}</small></button>${player.branches.map(branch=>`<button class="field-branch-choice" data-field-action="select-branch" data-branch-id="${esc(branch.id)}" data-stable-key="field-branch-${esc(branch.id)}" aria-pressed="${player.targetBranchId===branch.id}"><span>${esc(branch.name)} · ${branch.level?'Lv.'+num(branch.level):'建設中'}</span><small>${branch.fallen?'陥落':branch.level<1?'未完成':branch.building?'増築中・防衛中':'防衛中'}</small>${durabilityMarkup(branch.durability,{compact:true,kind:'branch',id:branch.id})}</button>`).join('')}</div></section>`;}
    if(!opts.identity?.id)return result+'<div class="field-notice">出陣・外交・書状・交易は、領主登録後に利用できます。</div><button class="field-button is-gold is-full" data-field-action="register">領主登録・ログイン</button>';
    if(!canAct()&&!cache.busy)result+=`<div class="field-notice">${esc(access().fieldPending?'前の采配を反映しています。':'操作端末と共通時刻を確認すると采配できます。')}<button class="field-inline-button" data-field-action="sync">端末同期を確認</button></div>`;
    if(own){const cooldown=Math.max(0,number(cache.me?.attack?.cooldownUntilElapsedMs)-elapsed());return result+`<div class="field-self-note">${icon('shield')}<div><strong>あなたの旗が、この城に掲がっています。</strong><p>ほかの領主の拠点を選ぶと、出陣や同盟の申し出ができます。</p></div></div><div class="field-key-value"><span>出陣できる兵</span><b>${num(state().troops??cache.me?.attack?.availableTroops)}人</b></div>${cooldown?`<div class="field-key-value"><span>出陣の再準備</span><b>あと${remainingLabel(cooldown)}</b></div>`:''}${protection?`<div class="field-notice">戦後の保護 · あと${remainingLabel(protection)}</div>`:''}`;}
    result+=`<section class="field-letter-box"><h4>領主へ書状を届ける</h4><div class="field-letter-actions"><button type="button" class="field-button" data-field-action="letter-player" data-player-id="${esc(player.playerId)}">領主に書状</button><button type="button" class="field-button" data-field-action="letter-guild" data-player-id="${esc(player.playerId)}">所属同盟に書状</button></div><p class="field-caption">本人への便りか、所属同盟への連絡を選べます。</p></section>`;
    result+='<section class="field-trade-box"><h4>資産を輸出・輸入する</h4><button type="button" class="field-button" data-field-action="trade-player" data-player-id="'+esc(player.playerId)+'">この領主に交易を申し出る</button><p class="field-caption">資産を預け、相手の承認で交換します。無償での提供もできます。</p></section>';
    result+=`<section class="field-diplomacy-box"><h4>外交</h4>${diplomacyControls(player)}</section>`;
    result+=!player.displayOnly&&global.SengokuBattleAdvisor?.markup(advice(),{action:'field-apply',disabled:!canAct(),showStyles:true,note:'公開情報からの推定です。案を反映したあと、出陣内容を確認してください。'})||'';
    if(policy.mode==='protected')return result+`<div class="field-notice">${icon('shield')}${esc(policy.description)}</div>`;
    if(protection)return result+`<div class="field-notice">戦後の保護期間です。あと${remainingLabel(protection)}で再び対象になります。</div>`;
    if(relation==='allied')return result;
    const attack=cache.me?.attack||{},r=cache.rules,max=Math.min(integer(attack.availableTroops),integer(attack.maxTroops)||r.maxTroops,state().troops===undefined?Infinity:integer(state().troops));
    if(cache.troops==='')cache.troops=String(Math.min(Math.max(r.minTroops,1000),Math.max(r.minTroops,max)));
    const valid=validation(),cost=foodCost(cache.troops,cache.tactic,r),confirm=cache.confirm?.signature===confirmationKey(player),actionLabel=policy.mode==='raid'?'この内容で襲撃':policy.label+'に出陣';
    const travel=global.SengokuTravel?.plan({sourceCastleId:state().home||cache.me?.self?.homeCastleId,targetCastleId:castleId,...(player.targetBranchId?{branchDirection:player.branches?.find(b=>b.id===player.targetBranchId)?.direction}:{})});
    result+=`${global.SengokuTravelUI?.preview(travel)||''}<section class="field-attack-box">${global.SengokuOfficerHealthUI?.armyMarkup(opts.getGame?.()||global.SengokuBridge?.getGame?.(),{deferred:true})||''}<h4>${icon('swords')}${policy.mode==='raid'?'拠点への襲撃':policy.label+'へ出陣'}</h4><div class="field-form-row"><label for="field-troops">出陣兵数<small>最大${num(max)}人</small></label><input id="field-troops" data-field-input="troops" type="number" min="${integer(attack.minTroops)||r.minTroops}" max="${max}" step="100" value="${esc(cache.troops)}" inputmode="numeric"></div><div class="field-form-row"><label for="field-tactic">戦法</label><select id="field-tactic" data-field-input="tactic">${r.tactics.map(t=>`<option value="${esc(t.id)}"${cache.tactic===t.id?' selected':''}>${esc(t.name)}</option>`).join('')}</select></div><div class="field-expense"><span>指令${num(r.commandCost)}</span><span>兵糧 <b data-field-food>${num(cost)}</b></span></div><p class="field-action-reason" data-field-attack-reason>${valid.ok?'兵数と戦法を確認して出陣します。':esc(valid.message)}</p>${confirm?`<div class="field-confirm" role="alert"><strong>${esc(castleName)}へ出陣しますか？</strong><p>守備する領主：${playerName(player.name,player.evaluation,player.appearance,player.playerId,player.avatarVersion)} · ${policy.tag}</p><p>${num(cache.troops)}人 · ${esc(r.tactics.find(t=>t.id===cache.tactic)?.name||'')} · 兵糧${num(cost)}</p><p>${policy.description}</p><div class="field-actions"><button class="field-button" data-field-action="cancel-attack">戻る</button><button class="field-button is-danger" data-field-action="attack"${!valid.ok||cache.busy?' disabled':''}>${actionLabel}</button></div></div>`:`<button class="field-button is-danger is-full" data-field-action="confirm-attack"${!valid.ok||cache.busy?' disabled':''}>${icon('swords')}出陣を確認</button><p class="field-caption">${policy.description}</p>`}</section>`;
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
  function patchRegion(selector,html){
    const node=container.querySelector(selector);
    if(global.SengokuStableDOM)global.SengokuStableDOM.patch(node,html,{key});
    else if(node.innerHTML!==html)node.innerHTML=html;
  }
  function renderDetail(){
    const host=container.querySelector('[data-field-detail]');if(!host)return;
    const markup=cache.tab==='diplomacy'?diplomacyDetail():cache.tab==='reports'?reportsDetail():baseDetail();
    // Loaded artwork mutates its own DOM. Keep that DOM and any focused input
    // when the underlying detail has not changed during a shared refresh.
    if(host!==detailHost||markup!==detailMarkup){
      const focused=doc.activeElement,focusedKind=container.contains(focused)?focused?.dataset?.fieldInput:null,selection=focusedKind==='troops'?[focused.selectionStart,focused.selectionEnd]:null;
      if(global.SengokuStableDOM){const changed=global.SengokuStableDOM.patch(host,markup,{key:['field-detail',key,cache.tab,cache.selectedId,cache.selectedBranchId]});if(changed.artwork)global.SengokuArt?.schedule?.(host);}else host.innerHTML=markup;detailHost=host;detailMarkup=markup;
      if(focusedKind==='troops'||focusedKind==='tactic'){const next=host.querySelector(`[data-field-input="${focusedKind}"]`);if(!global.SengokuStableDOM||next!==focused)next?.focus({preventScroll:true});if((!global.SengokuStableDOM||next!==focused)&&selection?.[0]!=null)try{next?.setSelectionRange(...selection);}catch(_){}}
    }
    global.SengokuOfficerHealthUI?.refresh(host,opts.getGame?.()||global.SengokuBridge?.getGame?.());
    for(const button of container.querySelectorAll('[data-tab]'))button.setAttribute('aria-selected',String(button.dataset.tab===cache.tab));
  }
  function matchesFieldFilter(player){
    return (!cache.castleFilter||targetCastleId(player)===cache.castleFilter)&&
      (cache.filter==='all'||cache.filter==='own'&&(player.self||player.playerId===opts.identity?.id)||cache.filter==='territories'&&!isHomeTarget(player)&&!isCourtEstate(player)||cache.filter==='court-estate'&&targetCastleId(player)===STAFF_BASE_ID||cache.filter==='online'&&player.online||cache.filter==='allied'&&relationshipFor(player,cache.me,opts.identity)==='allied');
  }
  function openFieldList(trigger){
    const candidates=new Map(),openedKey=key;
    for(const player of cache.players.filter(matchesFieldFilter)){
      for(const [value,detail] of [[player.name,'領主'],[targetCastleName(player),'城'],[player.clan,'勢力']]){
        if(value&&!candidates.has(value))candidates.set(value,{value,label:value,detail});
      }
    }
    global.SengokuInputList?.open({trigger,title:'領主・城・勢力の一覧',
      options:[...candidates.values()].sort((a,b)=>a.label.localeCompare(b.label,'ja')),
      hint:cache.nextCursor?'現在読み込み済みの領主を表示します。さらに探す場合は「さらに領主を読み込む」を押してください。':'',
      emptyText:'表示条件に合う領主・城・勢力がありません。',
      valid:()=>!destroyed&&key===openedKey,
      onSelect(option){cache.query=option.value;cache.page=1;render({mapChanged:false,detailChanged:false});}
    });
  }
  function render({mapChanged=true,detailChanged=true}={}){
    if(destroyed)return;if(!container.querySelector('.sengoku-field'))structure();
    // Entering the field starts at this lord's home. A mounted field keeps its
    // current target through later syncs, including a selection outside page one.
    if(homeSelectionPending){const home=homeId(),own=cache.players.find(p=>p.playerId===opts.identity?.id&&isHomeTarget(p)&&(!home||p.homeCastleId===home));cache.selectedId=own?targetKey(own):opts.identity?.id&&home?opts.identity.id+':'+home:'';if(own||!opts.identity?.id)homeSelectionPending=false;}
    if(!current()&&!homeSelectionPending){mapChanged=detailChanged=true;cache.selectedId=cache.players.length?targetKey(cache.players.find(p=>p.playerId===opts.identity?.id&&isHomeTarget(p))||cache.players[0]):'';cache.confirm=null;}
    const search=container.querySelector('[data-field-input="search"]');if(search.value!==cache.query)search.value=cache.query;const filter=container.querySelector('[data-field-input="filter"]');if(filter.value!==cache.filter)filter.value=cache.filter;
    const summary=container.querySelector('[data-field-summary]'),summaryText=cache.total?`${num(cache.total)}人の領主が、同じ山河に。`:cache.loading?'領主の拠点を確認中':'最初の旗を、この山河へ。';if(summary.textContent!==summaryText)summary.textContent=summaryText;
    const ownCourt=cache.players.find(p=>p.playerId===opts.identity?.id&&targetCastleId(p)===STAFF_BASE_ID&&p.canDevelopCourtEstate),courtShortcut=container.querySelector('[data-field-action="own-court"]');if(courtShortcut)courtShortcut.hidden=!ownCourt;
    const error=container.querySelector('[data-field-feedback]');error.hidden=!cache.error&&!cache.busy;const feedback=cache.busy?'采配を反映しています…':cache.error;if(error.textContent!==feedback)error.textContent=feedback;
    container.querySelector('[data-field-action="refresh"]').disabled=cache.loading||cache.busy;
    const q=cache.query.normalize('NFKC').toLocaleLowerCase('ja-JP');
    const filtered=cache.players.filter(p=>matchesFieldFilter(p)&&(!q||[p.name,targetCastleName(p),p.clan].some(s=>String(s||'').normalize('NFKC').toLocaleLowerCase('ja-JP').includes(q))));
    const pages=Math.max(1,Math.ceil(filtered.length/4));cache.page=Math.min(Math.max(1,cache.page),pages);
    const castleName=targetCastleName(cache.players.find(p=>targetCastleId(p)===cache.castleFilter));
    patchRegion('[data-field-filter-label]',`${cache.castleFilter?`<button class="field-inline-button" data-field-action="clear-castle">${esc(castleName||'本拠')}の領主 ${icon('close')}</button>`:`${num(filtered.length)}拠点${new Set(cache.players.map(p=>p.playerId)).size<cache.total?` · ${num(new Set(cache.players.map(p=>p.playerId)).size)} / ${num(cache.total)}領主を読込済み`:''}`}`);
    patchRegion('[data-field-players]',filtered.slice((cache.page-1)*4,cache.page*4).map(p=>publicRow(p,{selectedId:cache.selectedId,identity:opts.identity,relationship:relationshipFor(p,cache.me,opts.identity),rules:cache.rules})).join('')||`<div class="field-list-empty">${cache.loading?'本拠の情報を読み込んでいます…':cache.players.length?'条件に合う領主はいません。':'まだ公開された本拠はありません。領主登録後にクラウド保存すると、あなたの本拠が表示されます。'}</div>`);
    patchRegion('[data-field-pagination]',`${pages>1?pagination('page',cache.page,pages):''}${cache.nextCursor?`<button class="field-inline-button" data-field-action="load-more"${cache.loading?' disabled':''}>さらに領主を読み込む</button>`:''}`);
    const incoming=cache.me?.relationships?.filter(r=>r.status==='incoming').length||0;const badge=container.querySelector('[data-field-incoming]'),count=incoming?' '+incoming:'';if(badge.textContent!==count)badge.textContent=count;
    if(detailChanged)renderDetail();
    if(!mapChanged){global.SengokuDesktopFit?.refresh?.();return;}
    const mapElement=container.querySelector('[data-field-map]');
    if(!opts.geography&&global.SengokuWorldMap?.prepareGeography?.(mapElement,render)===false)return;
    const geography=opts.geography||global.SENGOKU_GEOGRAPHY,groups=groupBases(cache.players,geography?.castles||{},global.SENGOKU_DATA?.castles||[],opts.identity,cache.selectedId,cache.rules),ownHomeId=homeId();
    // A signed-in caller without local home data waits for the first response
    // before mounting; later home metadata must never recenter a map in use.
    if(!map&&opts.identity?.id&&!ownHomeId&&!cache.lastFetched)return;
    const mapOptions={stateKey:opts.stateKey+':map:'+String(opts.identity?.id||'guest'),initialView:'home',restoreView:false,castles:groups,selectedId:targetCastleId(current())||(homeSelectionPending?ownHomeId:undefined),homeId:ownHomeId,clan:'あなたの領地',treaties:{'同盟の領地':1},turn:0,isAdmin:opts.identity?.isAdmin===true,allowRestrictedSelection:true,region:'all',geography,title:'群雄の領地',eyebrow:'SHARED FIELD · JAPAN',countUnit:'拠点',hideRoutes:true,cacheMarkerPresentation:true,markerSize:48,branches:(parentCurrent()?.branches||[]).map(branch=>({...branch,own:parentCurrent()?.playerId===opts.identity?.id})),onBranchSelect:(_parentId,branchId)=>{homeSelectionPending=false;cache.selectedBranchId=branchId;cache.tab='base';cache.confirm=null;render();},markerAppearance,legend:{own:'あなた',ally:'同盟',reachable:'出陣可能',other:'ほかの領主'},markerTooltip:marker=>marker.branch?{title:marker.name,description:`支拠点 Lv.${marker.level} · ${marker.fallen?'陥落':marker.building?'普請中':'防衛中'} · ${global.SengokuDurabilityUI?.summary(marker.durability)||''}`,detail:'本城の方位を示す配置です。史実の所在地・距離ではありません。'}:({title:marker.name,description:`${marker.ownerLabel||''} · 表示中：${playerText(marker.displayPlayerName,marker.displayPlayerEvaluation,marker.displayPlayerAppearance,marker.displayPlayerId)} · ${marker.displayLevelLabel||keepLabel(marker)}${marker.durability?' · '+(global.SengokuDurabilityUI?.summary(marker.durability)||''):''}`,detail:marker.players?.slice(0,5).map(p=>`${playerText(p.name,p.evaluation,p.appearance,p.playerId)}（${keepLabel(p)}）`).join('・')}),onSelect:castleId=>{homeSelectionPending=false;cache.castleFilter=castleId;cache.selectedBranchId='';cache.query='';cache.filter='all';cache.page=1;cache.tab='base';cache.confirm=null;const occupants=cache.players.filter(p=>targetCastleId(p)===castleId);if(!occupants.some(p=>targetKey(p)===cache.selectedId))cache.selectedId=occupants[0]?targetKey(occupants[0]):'';render();}};
    if(map)map.update(mapOptions);else map=global.SengokuWorldMap?.mount?.(container.querySelector('[data-field-map]'),mapOptions)||null;
    global.SengokuDesktopFit?.refresh?.();
  }
  async function refresh({append=false,background=false}={}){
    if(destroyed)return;if(cache.promise)return cache.promise;if(typeof opts.request!=='function'){cache.error='共有フィールドへ接続できません。ページを再読み込みしてください。';notify();return;}
    const target=cache,identity=opts.identity,request=opts.request,cursor=append?target.nextCursor:null;if(append&&!cursor)return;
    const showLoading=!background||!target.lastFetched;
    if(showLoading){target.loading=true;target.error='';notify();}
    const readPlayers=async()=>{
      // A background refresh must cover the pages the player has already
      // opened. Replacing them with page one reset their selected lord, page
      // and detail pane every fifteen seconds. Re-read the loaded range using
      // fresh cursors so departed lords and lost holdings are removed as well.
      const wanted=append?1:Math.max(1,target.loadedPages),seen=new Set(),players=[];
      let next=cursor,pages=0,payload;
      do{
        if(next&&seen.has(next))throw Error('本拠一覧の続きを確認できませんでした。もう一度更新してください。');
        if(next)seen.add(next);
        payload=await request('/field?limit=25'+(next?'&cursor='+encodeURIComponent(next):''),{method:'GET'});
        if(!Array.isArray(payload?.players)&&!Array.isArray(payload?.targets))throw Error('本拠一覧の応答を確認できませんでした。');
        players.push(...normalizePlayers(payload));pages++;next=payload.nextCursor??null;
      }while(next&&pages<wanted);
      return{payload,players:[...new Map(players.map(p=>[targetKey(p),p])).values()],pages,nextCursor:next};
    };
    const promise=Promise.resolve().then(async()=>{
      const results=await Promise.allSettled([readPlayers(),!append&&identity?.id?request('/field/me',{method:'GET'}):Promise.resolve(null)]);
      // Commit once the entire requested range is available. A later-page
      // failure must not temporarily shrink the list to the completed prefix.
      if(results[0].status==='fulfilled'){const {payload,players:fresh,pages,nextCursor}=results[0].value;target.players=append?[...new Map([...target.players,...fresh].map(p=>[targetKey(p),p])).values()]:fresh;target.loadedPages=append?target.loadedPages+pages:pages;target.total=Math.max(new Set(target.players.map(p=>p.playerId)).size,integer(payload.total));target.nextCursor=nextCursor;target.rules=rulesFor(payload.rules);target.clock=payload.clock||target.clock;target.lastFetched=Date.now();target.error='';}
      else target.error=results[0].reason?.message||'本拠を取得できませんでした。「更新」から再接続できます。';
      if(results[1].status==='fulfilled'&&results[1].value){target.me=results[1].value;if(Number.isSafeInteger(target.me.residencyRevision))global.SengokuResidency?.observe?.(target.me,{playerId:String(identity?.id||''),revision:target.me.residencyRevision});if(target.lastBattle)target.lastBattle=target.me.battles?.find(b=>b.id===target.lastBattle.id)||target.lastBattle;target.rules=rulesFor(target.me.rules||target.rules);target.clock=target.me.clock||target.clock;}
      else if(results[1].status==='rejected'){target.me=null;target.error=results[1].reason?.message||'あなたの出陣準備を確認できませんでした。';}
      const relationships=new Map((target.me?.relationships||[]).map(rel=>[rel.targetPlayerId,rel]));
      for(const player of target.players){const rel=relationships.get(player.playerId);if(rel)player.relationship=rel.status;}
    }).catch(error=>{target.error=error.message||'共有フィールドへ再接続してください。';}).finally(()=>{target.loading=false;target.promise=null;for(const callback of target.watchers)callback();});
    target.promise=promise;return promise;
  }
  function schedule(){if(timer!==null)global.clearTimeout(timer);timer=null;if(!destroyed&&!doc.hidden)timer=global.setTimeout(async()=>{timer=null;await refresh({background:true});schedule();},15000);}
  async function mutate(route,data){
    if(cache.busy)return;const target=cache,request=opts.request,onMutation=opts.onMutation;if(!canAct()){message('この端末の操作権と共通時刻を確認してください。',true);return;}
    target.busy=true;target.error='';target.confirm=null;notify();
    try{const result=await request(route,{method:'POST',data});if(result?.ok===false)throw Error(result.error?.message||'采配を完了できませんでした。');const march=global.SengokuTravelUI?.commandMarch(result);if(route==='/field/attack'&&!march&&(!result?.battle||typeof result.battle.won!=='boolean'||typeof result.battle.id!=='string'))throw Error('出陣の受付を確認できませんでした。同じ出陣を再確認してください。');if(march)global.SengokuTravelUI?.record(march);if(result?.battle){target.lastBattle=result.battle;target.tab='reports';target.battlePage=1;}await onMutation?.(result);target.lastFetched=0;message(march?.status==='marching'?'出陣しました。到着までの時間は画面下の進軍状況から確認できます。':march?.status==='cancelled'?march.message||'出陣が取り消されました。部隊と費用の返還を確認できます。':route==='/field/attack'?'合戦の報せが届きました。':'外交の状況を更新しました。');}
    catch(error){target.error=error.message||'通信を確認して、もう一度お試しください。';message(target.error,true);}
    finally{target.busy=false;for(const callback of target.watchers)callback();if(!destroyed)await refresh();}
  }
  async function click(event){
    const button=event.target.closest?.('[data-field-action],[data-battle-advisor-action]');if(!button||!container.contains(button)||button.disabled)return;event.stopPropagation();if(button.dataset.battleAdvisorAction==='field-apply'){event.preventDefault();applyAdvice();return;}const action=button.dataset.fieldAction;
    if(action==='search-list'){openFieldList(button);return;}
    if(action==='refresh'){await refresh();return;}if(action==='load-more'){await refresh({append:true});return;}
    if(action==='letter-player'||action==='letter-guild'){if(!opts.identity?.id){opts.onRegister?.();return;}if(global.SengokuLetters?.openCompose)await global.SengokuLetters.openCompose({playerId:button.dataset.playerId,destination:action==='letter-guild'?'guild':'player'});else message('書状を読み込めませんでした。画面を再読み込みしてください。',true);return;}
    if(action==='trade-player'){if(!opts.identity?.id){opts.onRegister?.();return;}if(global.SengokuTrade?.openCompose)await global.SengokuTrade.openCompose({playerId:button.dataset.playerId});else message('交易を読み込めませんでした。画面を再読み込みしてください。',true);return;}
    if(action==='own-court'){const ownCourt=cache.players.find(p=>p.playerId===opts.identity?.id&&targetCastleId(p)===STAFF_BASE_ID&&p.canDevelopCourtEstate);if(!ownCourt)return;homeSelectionPending=false;cache.selectedId=targetKey(ownCourt);cache.castleFilter=STAFF_BASE_ID;cache.selectedBranchId='';cache.query='';cache.filter='all';cache.page=1;cache.tab='base';cache.confirm=null;render();return;}
    if(action==='court-estate'){const selected=current();if(selected?.playerId===opts.identity?.id&&targetCastleId(selected)===STAFF_BASE_ID&&selected.canDevelopCourtEstate===true)await global.SengokuCourtEstate?.open?.({tab:'castle'});return;}
    if(action==='register'){opts.onRegister?.();return;}if(action==='sync'){(opts.onSync||opts.onRegister)?.();return;}
    if(action==='select-player'){const selected=cache.players.find(p=>button.dataset.targetId?targetKey(p)===button.dataset.targetId:p.playerId===button.dataset.playerId&&isHomeTarget(p));if(!selected)return;homeSelectionPending=false;cache.selectedId=targetKey(selected);cache.selectedBranchId='';cache.tab='base';cache.confirm=null;cache.troops='';render();return;}
    if(action==='select-branch'){const id=button.dataset.branchId;if(id&&!parentCurrent()?.branches?.some(branch=>branch.id===id))return;homeSelectionPending=false;cache.selectedBranchId=id||'';cache.confirm=null;cache.lastBattle=null;renderDetail();return;}
    if(action==='clear-castle'){cache.castleFilter='';cache.page=1;render();return;}
    if(action==='tab'){cache.tab=button.dataset.tab;cache.confirm=null;renderDetail();global.SengokuDesktopFit?.refresh?.();return;}
    if(action==='page'||action==='relationship-page'||action==='battle-page'){const key=action==='page'?'page':action==='relationship-page'?'relationshipPage':'battlePage';cache[key]+=Number(button.dataset.delta)||0;if(action==='page')render({mapChanged:false,detailChanged:false});else renderDetail();return;}
    if(action==='report'){cache.lastBattle=cache.me?.battles?.find(b=>String(b.id)===button.dataset.battleId)||cache.lastBattle;renderDetail();return;}
    if(action==='cancel-attack'){cache.confirm=null;renderDetail();return;}
    if(action==='confirm-attack'){const check=validation();if(!check.ok){message(check.message,true);return;}cache.confirm={signature:confirmationKey()};renderDetail();global.SengokuDesktopFit?.refresh?.();return;}
    if(action==='attack'){const check=validation();if(!check.ok){message(check.message,true);return;}if(cache.confirm?.signature!==confirmationKey())return;await mutate('/field/attack',check.payload);return;}
    if(action==='diplomacy'){const operation=button.dataset.operation;if(!['propose','accept','reject','cancel'].includes(operation))return;await mutate('/field/diplomacy',{targetPlayerId:button.dataset.playerId,action:operation});}
  }
  function input(event){if(event.target.matches?.('[data-battle-advisor-style]')){if(!cache.busy&&global.SengokuBattleAdvisor?.styles[event.target.value]){cache.advisorStyle=event.target.value;cache.confirm=null;renderDetail();}return;}const kind=event.target.dataset.fieldInput;if(!kind)return;
    if(kind==='search'){cache.query=event.target.value;cache.page=1;render({mapChanged:false,detailChanged:false});}
    else if(kind==='filter'){cache.filter=event.target.value;cache.page=1;render({mapChanged:false,detailChanged:false});}
    else if(kind==='troops'||kind==='tactic'){cache[kind]=event.target.value;cache.confirm=null;const cost=container.querySelector('[data-field-food]');if(cost)cost.textContent=num(foodCost(cache.troops,cache.tactic,cache.rules));const check=validation(),reason=container.querySelector('[data-field-attack-reason]');if(reason)reason.textContent=check.ok?'兵数と戦法を確認して出陣します。':check.message;const confirm=container.querySelector('[data-field-action="confirm-attack"]');if(confirm)confirm.disabled=!check.ok||cache.busy;renderDetail();}
  }
  bindCache();structure();listen(container,'click',click);listen(container,'input',input);listen(container,'change',event=>{if(event.target.tagName==='SELECT')input(event);});listen(doc,'visibilitychange',()=>{if(!doc.hidden)refresh();schedule();});
  const controller={refresh,applyAdvice,update(next={}){if(destroyed)return;const old=key;opts={...opts,...next};bindCache();if(old!==key){map?.destroy();map=null;}render();if(old!==key||Date.now()-cache.lastFetched>15000)refresh({background:old===key});},destroy(){if(destroyed)return;destroyed=true;if(timer!==null)global.clearTimeout(timer);timer=null;map?.destroy();cache.watchers.delete(render);for(const remove of listeners)remove();mounted.delete(container);}};
  mounted.set(container,controller);render();if(Date.now()-cache.lastFetched>15000||!cache.lastFetched)refresh();schedule();return controller;
}
const api={mount,normalizePlayers,normalizeBranches,branchTarget,groupBases,targetKey,targetCastleId,targetCastleName,isHomeTarget,isCourtEstate,holdingLabel,battlePolicy,battleSummary,battleReportHtml,keepLevelInfo,castleAppearance,markerAppearance,foodCost,remainingLabel,relationshipFor,ownershipFor,ownershipBanner,attackValidation,estimateBattle,battleAdvice,publicRow};global.SengokuField=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);

