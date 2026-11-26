/* 戦国天統 — deterministic, browser-local strategy simulation.
 * Historical names are used in a fictional all-era campaign.
 * All strengths, economies, allegiances in a campaign and outcomes are game rules.
 */
(function (root) {
  'use strict';
  const RESOURCES = ['gold', 'rice', 'wood', 'stone'];
  const ASSET_CAP = 100000000;
  const ECONOMY_RULES=Object.freeze({surplusThresholds:Object.freeze({gold:5000,rice:9000,wood:3000,stone:2500}),surplusMarginalRetention:.25,upgradeMultiplierCap:16,recruitReserveMonths:2,recruitReserveMinimum:Object.freeze({gold:500,rice:1000})});
  function balanceSurplus(rawNet){
    const net={},surplusAdjustment={},retention=ECONOMY_RULES.surplusMarginalRetention;
    for(const key of RESOURCES){const raw=rawNet[key],threshold=ECONOMY_RULES.surplusThresholds[key];net[key]=raw>threshold?Math.floor(threshold+(raw-threshold)*retention+threshold*(1-retention)*Math.log(raw/threshold)):raw;surplusAdjustment[key]=raw-net[key];}
    return{net,surplusAdjustment};
  }
  function upgradeCostMultiplier(ownedCastleCount){
    if(!Number.isInteger(ownedCastleCount)||ownedCastleCount<0||ownedCastleCount>CASTLES.length)throw new Error('領有城数を確認できません。');
    return 2**Math.min(4,Math.max(0,ownedCastleCount-1));
  }
  function scaleUpgradeCost(cost,ownedCastleCount){
    if(cost==null)return null;
    const multiplier=upgradeCostMultiplier(ownedCastleCount),scaled={...cost};
    // This is a one-time price, not an asset balance or recurring upkeep.
    // A price above ASSET_CAP must remain unaffordable rather than be discounted.
    for(const key of RESOURCES)if(Object.hasOwn(cost,key)){
      if(!Number.isFinite(cost[key])||cost[key]<0||!Number.isFinite(cost[key]*multiplier))throw new Error('強化費用を確認できません。');
      scaled[key]=cost[key]*multiplier;
    }
    return scaled;
  }
  const MAINTENANCE_RULES=Object.freeze({troops:Object.freeze({gold:.04,rice:.12,wood:0,stone:0}),facilityLevel:Object.freeze({gold:2,rice:1,wood:1,stone:1}),castleRice:60,governorMonthlyGold:50});
  const OFFICER_HEALTH_RULES=Object.freeze({max:100,winCost:15,lossCost:25,recoveryPerMonth:10,minCombatFactor:.5});
  const DURABILITY_RULES=Object.freeze({recoveryFraction:.1,captureFraction:.25,minFortificationFactor:.25,repairCostPer100:Object.freeze({wood:5,stone:4})});
  function durabilityMax({castleId,level=1,wall=1,branch=false}={}){
    const lv=Math.max(0,Math.min(branch?32:128,Math.floor(Number(level)||0))),w=Math.max(1,Math.min(32,Math.floor(Number(wall)||1)));
    if(branch)return lv?5000+(lv-1)*1500:0;
    return (castleId===STAFF_BASE_ID?40000:castleId==='edo'?30000:MAJOR_CITY_IDS.includes(castleId)?20000:10000)+Math.max(0,lv-1)*2000+(w-1)*500;
  }
  function normalizeDurability(raw){
    if(raw===undefined)return undefined;
    if(!raw||typeof raw!=='object'||Array.isArray(raw)||raw.version!==1||!Number.isSafeInteger(raw.current)||!Number.isSafeInteger(raw.max)||raw.max<0||raw.max>ASSET_CAP||raw.current<0||raw.current>raw.max||!Number.isSafeInteger(raw.updatedElapsedMs)||raw.updatedElapsedMs<0)throw new Error('拠点の耐久値を確認できません。');
    if(raw.repairPendingHP!==undefined&&(!Number.isSafeInteger(raw.repairPendingHP)||raw.repairPendingHP<0||raw.repairPendingHP>ASSET_CAP)||raw.repairRemainder!==undefined&&(!Number.isSafeInteger(raw.repairRemainder)||raw.repairRemainder<0||raw.repairRemainder>=600000))throw new Error('拠点の修復進行を確認できません。');
    return{version:1,current:raw.current,max:raw.max,updatedElapsedMs:raw.updatedElapsedMs,...(raw.repairPendingHP!==undefined?{repairPendingHP:raw.repairPendingHP}:{}),...(raw.repairRemainder!==undefined?{repairRemainder:raw.repairRemainder}:{})};
  }
  // Paid views project work awaiting the monthly settlement, never unpaid HP.
  // NPC/alliance economies explicitly opt into the legacy free projection.
  // Construction adds capacity while retaining absolute damage in either mode.
  function durabilityView(raw,options={}){
    const record=normalizeDurability(raw),max=durabilityMax(options),elapsed=Math.max(0,Math.round(Number(options.elapsedMs)||0)),at=Math.max(elapsed,record?.updatedElapsedMs||0),inactive=options.fallen===true||options.branch===true&&Number(options.level)<1,recoveryMode=options.recoveryMode==='free'?'free':'paid';
    const duration=record?Math.min(600000,Math.max(0,elapsed-record.updatedElapsedMs)):0;
    const repaired=record?record.current+(recoveryMode==='free'?Math.floor(record.max*duration/600000):0):max;
    const current=inactive?0:record?Math.max(0,Math.min(max,repaired+max-record.max)):max,ratio=max?current/max:0;
    let repairPendingHP=0,repairRemainder=0;
    if(recoveryMode==='paid'&&!inactive&&record&&current<max){
      const work=(record.repairRemainder||0)+(record.current<record.max?record.max*duration:0);
      repairPendingHP=Math.min(max-current,(record.repairPendingHP||0)+Math.floor(work/600000));
      repairRemainder=repairPendingHP<max-current?work%600000:0;
    }
    return{version:1,current,max,ratio,recoveryMode,recoveryPerMonth:inactive?0:Math.round(max*DURABILITY_RULES.recoveryFraction),updatedElapsedMs:at,fortificationFactor:DURABILITY_RULES.minFortificationFactor+(1-DURABILITY_RULES.minFortificationFactor)*ratio,...(recoveryMode==='paid'?{repairPendingHP,repairRemainder}:{})};
  }
  function durabilityAfterBattle(view,{won=false,ratio=1,captured=false,elapsedMs=view?.updatedElapsedMs||0}={}){
    const max=Math.max(0,Math.round(view?.max||0)),before=Math.max(0,Math.min(max,Math.round(view?.current||0))),severity=Math.max(.1,Math.min(.35,.1+Math.max(0,Number(ratio)||0)*.15)),damage=won?before:Math.min(before,Math.max(1,Math.round(max*severity))),breachCurrent=before-damage,after=won&&captured?Math.round(max*DURABILITY_RULES.captureFraction):breachCurrent;
    const record={version:1,current:after,max,updatedElapsedMs:Math.max(Math.round(Number(elapsedMs)||0),view?.updatedElapsedMs||0),...(view?.recoveryMode==='paid'?{repairPendingHP:captured||!after?0:Math.min(max-after,view.repairPendingHP||0),repairRemainder:captured||!after?0:view.repairRemainder||0}:{})};
    return{before,after,damage,max,breachCurrent,breached:won===true,captured:won===true&&captured===true,record};
  }
  function normalizeDurabilityBattle(raw){
    if(raw===undefined)return undefined;
    const record=normalizeDurability(raw?.record),num=v=>Number.isSafeInteger(v)&&v>=0&&v<=ASSET_CAP;
    if(!raw||!record||!['before','after','damage','max'].every(k=>num(raw[k]))||typeof raw.breached!=='boolean'||typeof raw.captured!=='boolean'||raw.damage>raw.before||raw.after!==record.current||raw.max!==record.max||raw.after>raw.max||raw.captured&&!raw.breached||raw.breachCurrent!==undefined&&(!num(raw.breachCurrent)||raw.breachCurrent!==raw.before-raw.damage))throw new Error('拠点の耐久戦果を確認できません。');
    return{before:raw.before,after:raw.after,damage:raw.damage,max:raw.max,breachCurrent:raw.before-raw.damage,breached:raw.breached,captured:raw.captured,record};
  }
  // A single ownership ceiling applies to each stock of assets. Building
  // capacity and per-sortie limits are separate gameplay constraints.
  function normalizeAssets(state){
    const limit=(holder,key)=>{const value=holder?.[key];if(!Number.isSafeInteger(value)||value<0)throw new Error('資産の保存値が正しくありません。');if(value>ASSET_CAP)holder[key]=ASSET_CAP;};
    if(!state||typeof state!=='object'||Array.isArray(state))throw new Error('資産の保存値が正しくありません。');
    for(const key of RESOURCES)limit(state.resources,key);
    for(const key of ['magatama','troops','prestige'])limit(state,key);
    if(state.castles&&typeof state.castles==='object')for(const castle of Object.values(state.castles))limit(castle,'troops');
    if(state.staffService?.personalHomeCastle)limit(state.staffService.personalHomeCastle,'troops');
    return state;
  }
  const BUILDINGS = [
    {id:'keep',name:'天守',description:'城の格を高め、優秀な武将の登用と内政を支える。',output:'登用条件・兵数上限・基礎収入',icon:'castle',base:{gold:500,wood:300,stone:400}},
    {id:'farm',name:'田畑',description:'兵糧を生産する。大軍を維持するための基盤。',output:'毎月の兵糧',icon:'wheat',base:{gold:260,wood:160,stone:60}},
    {id:'market',name:'商家',description:'城下の往来を増やし、金銭収入を高める。',output:'毎月の金銭',icon:'coins',base:{gold:300,wood:160,stone:100}},
    {id:'lumber',name:'伐採所',description:'建設と研究に用いる木材を生産する。',output:'毎月の木材',icon:'tree',base:{gold:220,wood:70,stone:50}},
    {id:'quarry',name:'採石場',description:'城壁と建造物に必要な石材を生産する。',output:'毎月の石材',icon:'mountain',base:{gold:240,wood:120,stone:40}},
    {id:'barracks',name:'兵舎',description:'新兵を集め、出陣できる兵数を増やす。',output:'兵数上限・募兵効率',icon:'swords',base:{gold:340,wood:200,stone:140}},
    {id:'wall',name:'城壁',description:'本拠を守る防壁。敵の攻城に対する防御力が上がる。',output:'本拠の防御力',icon:'shield',base:{gold:280,wood:180,stone:300}},
    {id:'academy',name:'学問所',description:'技術を研究し、内政と軍事を恒久的に強化する。',output:'研究可能な技術レベル',icon:'book',base:{gold:360,wood:240,stone:180}}
  ];

  const CORE_BUILDING_IDS=BUILDINGS.map(b=>b.id);
  const CORE_CATEGORIES={keep:'diplomacy',farm:'rice',market:'gold',lumber:'wood',quarry:'stone',barracks:'military',wall:'defense',academy:'research'};
  const CORE_EFFECTS={keep:1,farm:450,market:180,lumber:170,quarry:130,barracks:2000,wall:.16,academy:.025};
  for(const b of BUILDINGS)Object.assign(b,{category:CORE_CATEGORIES[b.id],requiredKeep:1,effect:CORE_EFFECTS[b.id],effectText:b.output,core:true});
  const EXTRA_FACILITIES=[{"id":"gold_mine","name":"金山","description":"金の採掘で領国の財源を増やす。","output":"毎月の金銭 +90 / Lv","icon":"coins","base":{"gold":260,"wood":130,"stone":80},"category":"gold","requiredKeep":1,"effect":90,"effectText":"毎月の金銭 +90 / Lv","capacity":0},{"id":"silver_mine","name":"銀山","description":"銀の採掘と交易で収入を得る。","output":"毎月の金銭 +105 / Lv","icon":"coins","base":{"gold":370,"wood":185,"stone":145},"category":"gold","requiredKeep":2,"effect":105,"effectText":"毎月の金銭 +105 / Lv","capacity":0},{"id":"trade_port","name":"交易港","description":"海を行き来する商船の取引を支える。","output":"毎月の金銭 +120 / Lv","icon":"coins","base":{"gold":480,"wood":240,"stone":210},"category":"gold","requiredKeep":3,"effect":120,"effectText":"毎月の金銭 +120 / Lv","capacity":0},{"id":"wholesale","name":"問屋街","description":"商品の集積と流通で城下の商いを広げる。","output":"毎月の金銭 +135 / Lv","icon":"coins","base":{"gold":590,"wood":295,"stone":275},"category":"gold","requiredKeep":4,"effect":135,"effectText":"毎月の金銭 +135 / Lv","capacity":0},{"id":"artisan_town","name":"職人町","description":"職人の仕事を育てて領国の産業を増やす。","output":"毎月の金銭 +150 / Lv","icon":"coins","base":{"gold":700,"wood":350,"stone":340},"category":"gold","requiredKeep":6,"effect":150,"effectText":"毎月の金銭 +150 / Lv","capacity":0},{"id":"post_town","name":"宿場町","description":"旅人と商人の往来から安定した収益を得る。","output":"毎月の金銭 +165 / Lv","icon":"coins","base":{"gold":810,"wood":405,"stone":405},"category":"gold","requiredKeep":8,"effect":165,"effectText":"毎月の金銭 +165 / Lv","capacity":0},{"id":"mint","name":"鋳銭所","description":"貨幣の流通を整え領国の収入を高める。","output":"毎月の金銭 +180 / Lv","icon":"coins","base":{"gold":920,"wood":460,"stone":470},"category":"gold","requiredKeep":12,"effect":180,"effectText":"毎月の金銭 +180 / Lv","capacity":0},{"id":"rice_paddy","name":"水田","description":"水を引き込んだ田で米を安定生産する。","output":"毎月の兵糧 +170 / Lv","icon":"wheat","base":{"gold":260,"wood":130,"stone":80},"category":"rice","requiredKeep":1,"effect":170,"effectText":"毎月の兵糧 +170 / Lv","capacity":0},{"id":"dry_field","name":"畑作地","description":"麦や雑穀を育て軍の食を支える。","output":"毎月の兵糧 +195 / Lv","icon":"wheat","base":{"gold":370,"wood":185,"stone":145},"category":"rice","requiredKeep":2,"effect":195,"effectText":"毎月の兵糧 +195 / Lv","capacity":0},{"id":"orchard","name":"果樹園","description":"果実を収穫し領内の食料を増やす。","output":"毎月の兵糧 +220 / Lv","icon":"wheat","base":{"gold":480,"wood":240,"stone":210},"category":"rice","requiredKeep":3,"effect":220,"effectText":"毎月の兵糧 +220 / Lv","capacity":0},{"id":"fishery","name":"漁港","description":"漁場と水運を整備して食料を供給する。","output":"毎月の兵糧 +245 / Lv","icon":"wheat","base":{"gold":590,"wood":295,"stone":275},"category":"rice","requiredKeep":4,"effect":245,"effectText":"毎月の兵糧 +245 / Lv","capacity":0},{"id":"ranch","name":"牧畜場","description":"家畜を育て食料供給を厚くする。","output":"毎月の兵糧 +270 / Lv","icon":"wheat","base":{"gold":700,"wood":350,"stone":340},"category":"rice","requiredKeep":6,"effect":270,"effectText":"毎月の兵糧 +270 / Lv","capacity":0},{"id":"granary","name":"兵糧蔵","description":"収穫物の損耗を抑え利用できる兵糧を増やす。","output":"毎月の兵糧 +295 / Lv","icon":"wheat","base":{"gold":810,"wood":405,"stone":405},"category":"rice","requiredKeep":8,"effect":295,"effectText":"毎月の兵糧 +295 / Lv","capacity":0},{"id":"irrigation","name":"用水路","description":"田畑へ水を巡らせ追加の収穫を生む。","output":"毎月の兵糧 +320 / Lv","icon":"wheat","base":{"gold":920,"wood":460,"stone":470},"category":"rice","requiredKeep":12,"effect":320,"effectText":"毎月の兵糧 +320 / Lv","capacity":0},{"id":"cedar_forest","name":"杉林","description":"計画的な植林と伐採で建材を確保する。","output":"毎月の木材 +70 / Lv","icon":"tree","base":{"gold":260,"wood":130,"stone":80},"category":"wood","requiredKeep":1,"effect":70,"effectText":"毎月の木材 +70 / Lv","capacity":0},{"id":"bamboo_grove","name":"竹林","description":"竹を育て木材資源を補う。","output":"毎月の木材 +82 / Lv","icon":"tree","base":{"gold":370,"wood":185,"stone":145},"category":"wood","requiredKeep":2,"effect":82,"effectText":"毎月の木材 +82 / Lv","capacity":0},{"id":"sawmill","name":"製材所","description":"切り出した木材を使いやすい建材へ加工する。","output":"毎月の木材 +94 / Lv","icon":"tree","base":{"gold":480,"wood":240,"stone":210},"category":"wood","requiredKeep":3,"effect":94,"effectText":"毎月の木材 +94 / Lv","capacity":0},{"id":"timber_market","name":"材木問屋","description":"近隣から材木を買い集め供給を増やす。","output":"毎月の木材 +106 / Lv","icon":"tree","base":{"gold":590,"wood":295,"stone":275},"category":"wood","requiredKeep":4,"effect":106,"effectText":"毎月の木材 +106 / Lv","capacity":0},{"id":"charcoal_kiln","name":"炭焼き窯","description":"木材の利用効率を高め領国の生産を支える。","output":"毎月の木材 +118 / Lv","icon":"tree","base":{"gold":700,"wood":350,"stone":340},"category":"wood","requiredKeep":6,"effect":118,"effectText":"毎月の木材 +118 / Lv","capacity":0},{"id":"forest_office","name":"山林奉行所","description":"山林を管理し木材供給を持続させる。","output":"毎月の木材 +130 / Lv","icon":"tree","base":{"gold":810,"wood":405,"stone":405},"category":"wood","requiredKeep":8,"effect":130,"effectText":"毎月の木材 +130 / Lv","capacity":0},{"id":"water_sawmill","name":"水車製材所","description":"水力で製材を進め多くの木材を確保する。","output":"毎月の木材 +142 / Lv","icon":"tree","base":{"gold":920,"wood":460,"stone":470},"category":"wood","requiredKeep":12,"effect":142,"effectText":"毎月の木材 +142 / Lv","capacity":0},{"id":"stoneworks","name":"石工場","description":"石を加工して建設に使える石材を増やす。","output":"毎月の石材 +60 / Lv","icon":"mountain","base":{"gold":260,"wood":130,"stone":80},"category":"stone","requiredKeep":1,"effect":60,"effectText":"毎月の石材 +60 / Lv","capacity":0},{"id":"clay_pit","name":"粘土採掘所","description":"土壁や建築に使う建材を採掘する。","output":"毎月の石材 +70 / Lv","icon":"mountain","base":{"gold":370,"wood":185,"stone":145},"category":"stone","requiredKeep":2,"effect":70,"effectText":"毎月の石材 +70 / Lv","capacity":0},{"id":"lime_kiln","name":"石灰窯","description":"石灰を焼き城普請に使える建材を生産する。","output":"毎月の石材 +80 / Lv","icon":"mountain","base":{"gold":480,"wood":240,"stone":210},"category":"stone","requiredKeep":3,"effect":80,"effectText":"毎月の石材 +80 / Lv","capacity":0},{"id":"tile_kiln","name":"瓦窯","description":"屋根瓦を焼き建築資源を供給する。","output":"毎月の石材 +90 / Lv","icon":"mountain","base":{"gold":590,"wood":295,"stone":275},"category":"stone","requiredKeep":4,"effect":90,"effectText":"毎月の石材 +90 / Lv","capacity":0},{"id":"iron_mine","name":"鉄山","description":"鉱石を採掘し建設・軍備に使う資材を供給する。","output":"毎月の石材 +100 / Lv","icon":"mountain","base":{"gold":700,"wood":350,"stone":340},"category":"stone","requiredKeep":6,"effect":100,"effectText":"毎月の石材 +100 / Lv","capacity":0},{"id":"copper_mine","name":"銅山","description":"銅を採掘し加工済みの建材へ換える。","output":"毎月の石材 +110 / Lv","icon":"mountain","base":{"gold":810,"wood":405,"stone":405},"category":"stone","requiredKeep":8,"effect":110,"effectText":"毎月の石材 +110 / Lv","capacity":0},{"id":"stone_depot","name":"石材集積所","description":"運搬路を整えて使える石材を増やす。","output":"毎月の石材 +120 / Lv","icon":"mountain","base":{"gold":920,"wood":460,"stone":470},"category":"stone","requiredKeep":12,"effect":120,"effectText":"毎月の石材 +120 / Lv","capacity":0},{"id":"dojo","name":"武芸道場","description":"武芸を伝え軍団の攻撃力と兵数上限を高める。","output":"攻撃力 +0.6%・兵数上限 +200 / Lv","icon":"swords","base":{"gold":260,"wood":130,"stone":80},"category":"military","requiredKeep":1,"effect":0.006,"effectText":"攻撃力 +0.6%・兵数上限 +200 / Lv","capacity":200},{"id":"stable","name":"馬場","description":"馬と乗り手を育て軍団の戦力を増す。","output":"攻撃力 +0.7%・兵数上限 +250 / Lv","icon":"swords","base":{"gold":370,"wood":185,"stone":145},"category":"military","requiredKeep":2,"effect":0.007,"effectText":"攻撃力 +0.7%・兵数上限 +250 / Lv","capacity":250},{"id":"gunsmith","name":"鉄砲鍛冶","description":"火器を整備して軍団の攻撃力を高める。","output":"攻撃力 +0.8%・兵数上限 +300 / Lv","icon":"swords","base":{"gold":480,"wood":240,"stone":210},"category":"military","requiredKeep":3,"effect":0.008,"effectText":"攻撃力 +0.8%・兵数上限 +300 / Lv","capacity":300},{"id":"spear_workshop","name":"槍工房","description":"足軽の装備を充実させ軍備を拡大する。","output":"攻撃力 +0.9%・兵数上限 +350 / Lv","icon":"swords","base":{"gold":590,"wood":295,"stone":275},"category":"military","requiredKeep":4,"effect":0.009,"effectText":"攻撃力 +0.9%・兵数上限 +350 / Lv","capacity":350},{"id":"armory","name":"武具蔵","description":"武具を備え大軍の出陣を支える。","output":"攻撃力 +1.0%・兵数上限 +400 / Lv","icon":"swords","base":{"gold":700,"wood":350,"stone":340},"category":"military","requiredKeep":6,"effect":0.01,"effectText":"攻撃力 +1.0%・兵数上限 +400 / Lv","capacity":400},{"id":"drill_ground","name":"訓練場","description":"兵の連携を鍛え軍団の攻撃力を高める。","output":"攻撃力 +1.1%・兵数上限 +450 / Lv","icon":"swords","base":{"gold":810,"wood":405,"stone":405},"category":"military","requiredKeep":8,"effect":0.011,"effectText":"攻撃力 +1.1%・兵数上限 +450 / Lv","capacity":450},{"id":"war_school","name":"兵学寮","description":"軍学を伝えて精強な軍団を育てる。","output":"攻撃力 +1.2%・兵数上限 +500 / Lv","icon":"swords","base":{"gold":920,"wood":460,"stone":470},"category":"military","requiredKeep":12,"effect":0.012,"effectText":"攻撃力 +1.2%・兵数上限 +500 / Lv","capacity":500},{"id":"main_gate","name":"大手門","description":"城への進入を抑え領国の防衛力を高める。","output":"領国の防衛力 +0.8% / Lv","icon":"shield","base":{"gold":260,"wood":130,"stone":80},"category":"defense","requiredKeep":1,"effect":0.008,"effectText":"領国の防衛力 +0.8% / Lv","capacity":0},{"id":"moat","name":"堀","description":"堀を巡らせ敵軍の攻め手を鈍らせる。","output":"領国の防衛力 +0.9% / Lv","icon":"shield","base":{"gold":370,"wood":185,"stone":145},"category":"defense","requiredKeep":2,"effect":0.009,"effectText":"領国の防衛力 +0.9% / Lv","capacity":0},{"id":"watchtower","name":"物見櫓","description":"遠方を見張り守備隊の備えを強くする。","output":"領国の防衛力 +1.0% / Lv","icon":"shield","base":{"gold":480,"wood":240,"stone":210},"category":"defense","requiredKeep":3,"effect":0.01,"effectText":"領国の防衛力 +1.0% / Lv","capacity":0},{"id":"guardhouse","name":"詰所","description":"守備兵の活動を支え防衛を強化する。","output":"領国の防衛力 +1.1% / Lv","icon":"shield","base":{"gold":590,"wood":295,"stone":275},"category":"defense","requiredKeep":4,"effect":0.011,"effectText":"領国の防衛力 +1.1% / Lv","capacity":0},{"id":"earthworks","name":"土塁","description":"土の防壁を築いて敵の侵攻を防ぐ。","output":"領国の防衛力 +1.2% / Lv","icon":"shield","base":{"gold":700,"wood":350,"stone":340},"category":"defense","requiredKeep":6,"effect":0.012,"effectText":"領国の防衛力 +1.2% / Lv","capacity":0},{"id":"outpost","name":"支城","description":"周辺の守りを固め各領地の防衛力を増す。","output":"領国の防衛力 +1.3% / Lv","icon":"shield","base":{"gold":810,"wood":405,"stone":405},"category":"defense","requiredKeep":8,"effect":0.013,"effectText":"領国の防衛力 +1.3% / Lv","capacity":0},{"id":"herb_garden","name":"薬草園","description":"守備兵の療養を支え防衛力を維持する。","output":"領国の防衛力 +1.4% / Lv","icon":"shield","base":{"gold":920,"wood":460,"stone":470},"category":"defense","requiredKeep":12,"effect":0.014,"effectText":"領国の防衛力 +1.4% / Lv","capacity":0},{"id":"library","name":"蔵書院","description":"書物を集め技術研究の費用を軽減する。","output":"研究費用を軽減する（レベルと政治力で強化）","icon":"book","base":{"gold":260,"wood":130,"stone":80},"category":"research","requiredKeep":1,"effect":0.005,"effectText":"研究費用を軽減する（レベルと政治力で強化）","capacity":0},{"id":"observatory","name":"天文台","description":"暦と観測の知を研究へ役立てる。","output":"研究費用を軽減する（レベルと政治力で強化）","icon":"book","base":{"gold":370,"wood":185,"stone":145},"category":"research","requiredKeep":2,"effect":0.006,"effectText":"研究費用を軽減する（レベルと政治力で強化）","capacity":0},{"id":"craft_lab","name":"工芸所","description":"加工技術の改良で研究の無駄を減らす。","output":"研究費用を軽減する（レベルと政治力で強化）","icon":"book","base":{"gold":480,"wood":240,"stone":210},"category":"research","requiredKeep":3,"effect":0.007,"effectText":"研究費用を軽減する（レベルと政治力で強化）","capacity":0},{"id":"engineering_shop","name":"普請工房","description":"建築と工作の知識を研究に生かす。","output":"研究費用を軽減する（レベルと政治力で強化）","icon":"book","base":{"gold":590,"wood":295,"stone":275},"category":"research","requiredKeep":4,"effect":0.008,"effectText":"研究費用を軽減する（レベルと政治力で強化）","capacity":0},{"id":"medical_school","name":"医術所","description":"医学の知見を集め技術研究を支える。","output":"研究費用を軽減する（レベルと政治力で強化）","icon":"book","base":{"gold":700,"wood":350,"stone":340},"category":"research","requiredKeep":6,"effect":0.009,"effectText":"研究費用を軽減する（レベルと政治力で強化）","capacity":0},{"id":"school","name":"寺子屋","description":"読み書きの学びを広め技術の基礎を育てる。","output":"研究費用を軽減する（レベルと政治力で強化）","icon":"book","base":{"gold":810,"wood":405,"stone":405},"category":"research","requiredKeep":8,"effect":0.01,"effectText":"研究費用を軽減する（レベルと政治力で強化）","capacity":0},{"id":"foreign_studies","name":"南蛮学舎","description":"海外の知識を取り入れ研究費用を軽減する。","output":"研究費用を軽減する（レベルと政治力で強化）","icon":"book","base":{"gold":920,"wood":460,"stone":470},"category":"research","requiredKeep":12,"effect":0.011,"effectText":"研究費用を軽減する（レベルと政治力で強化）","capacity":0},{"id":"envoy_house","name":"使者館","description":"使者を迎え交渉と情報収集の費用を減らす。","output":"同盟・偵察・武将登用の費用を軽減する","icon":"handshake","base":{"gold":260,"wood":130,"stone":80},"category":"diplomacy","requiredKeep":1,"effect":0.006,"effectText":"同盟・偵察・武将登用の費用を軽減する","capacity":0},{"id":"tea_house","name":"茶室","description":"交流の場を設け外交と登用を助ける。","output":"同盟・偵察・武将登用の費用を軽減する","icon":"handshake","base":{"gold":370,"wood":185,"stone":145},"category":"diplomacy","requiredKeep":2,"effect":0.007,"effectText":"同盟・偵察・武将登用の費用を軽減する","capacity":0},{"id":"temple","name":"寺院","description":"人と知の往来を支え外交の費用を軽減する。","output":"同盟・偵察・武将登用の費用を軽減する","icon":"handshake","base":{"gold":480,"wood":240,"stone":210},"category":"diplomacy","requiredKeep":3,"effect":0.008,"effectText":"同盟・偵察・武将登用の費用を軽減する","capacity":0},{"id":"shrine","name":"社","description":"領内の結束を深め対外交流を支える。","output":"同盟・偵察・武将登用の費用を軽減する","icon":"handshake","base":{"gold":590,"wood":295,"stone":275},"category":"diplomacy","requiredKeep":4,"effect":0.009,"effectText":"同盟・偵察・武将登用の費用を軽減する","capacity":0},{"id":"guest_house","name":"迎賓館","description":"客人をもてなし他勢力との交渉を助ける。","output":"同盟・偵察・武将登用の費用を軽減する","icon":"handshake","base":{"gold":700,"wood":350,"stone":340},"category":"diplomacy","requiredKeep":6,"effect":0.01,"effectText":"同盟・偵察・武将登用の費用を軽減する","capacity":0},{"id":"relay_station","name":"伝馬所","description":"使者の移動を整え交渉と偵察の費用を減らす。","output":"同盟・偵察・武将登用の費用を軽減する","icon":"handshake","base":{"gold":810,"wood":405,"stone":405},"category":"diplomacy","requiredKeep":8,"effect":0.011,"effectText":"同盟・偵察・武将登用の費用を軽減する","capacity":0},{"id":"intelligence_office","name":"情報所","description":"情報を集め外交・偵察・登用の費用を軽減する。","output":"同盟・偵察・武将登用の費用を軽減する","icon":"handshake","base":{"gold":920,"wood":460,"stone":470},"category":"diplomacy","requiredKeep":12,"effect":0.012,"effectText":"同盟・偵察・武将登用の費用を軽減する","capacity":0}];
  BUILDINGS.push(...EXTRA_FACILITIES);
  const RANKS=['D','C','B','A','S','SS','SSS','U'];
  const RANK_COST={D:180,C:260,B:400,A:600,S:900,SS:1300,SSS:1900,U:2700};
  const RANK_KEEP={D:1,C:1,B:2,A:3,S:5,SS:8,SSS:12,U:16};
  const CATEGORY_LABELS={gold:'商業',rice:'兵糧',wood:'木材',stone:'石材',military:'軍備',defense:'防衛',research:'学術',diplomacy:'外交'};
  const TECHS = [
    {id:'cultivation',name:'灌漑農法',description:'兵糧生産がレベルごとに12%増加。',max:5,icon:'wheat'},
    {id:'commerce',name:'楽市楽座',description:'金銭収入がレベルごとに12%増加。',max:5,icon:'coins'},
    {id:'forestry',name:'木材加工',description:'木材生産がレベルごとに15%増加。',max:5,icon:'tree'},
    {id:'masonry',name:'石垣普請',description:'石材生産がレベルごとに15%増加。',max:5,icon:'mountain'},
    {id:'conscription',name:'兵農分離',description:'募兵費用がレベルごとに8%減少。',max:5,icon:'users'},
    {id:'discipline',name:'軍法整備',description:'攻撃力と守備力がレベルごとに6%増加。',max:5,icon:'shield'},
    {id:'gunnery',name:'鉄砲隊編制',description:'攻撃力がレベルごとに5%増加。',max:5,icon:'target'},
    {id:'siege',name:'攻城兵法',description:'敵城の城壁効果をレベルごとに12%軽減。',max:5,icon:'castle'}
  ];
  const CLANS = [
    {name:'織田家',leader:'織田信長',home:'kiyosu',color:'#bd514a',bonus:'商業収入 +15%',description:'尾張から天下へ。豊かな商いを軍事力に変える。'},
    {name:'武田家',leader:'武田信玄',home:'tsutsujigasaki',color:'#a44a58',bonus:'出陣攻撃力 +10%',description:'甲斐の山々から進む、攻めに秀でた軍団。'},
    {name:'上杉家',leader:'上杉謙信',home:'kasugayama',color:'#638bab',bonus:'訓練の士気上昇 +6',description:'越後の精鋭を率い、高い士気で難敵に挑む。'},
    {name:'徳川家',leader:'徳川家康',home:'okazaki',color:'#9c8b5e',bonus:'防衛力 +15%',description:'三河に根を張り、堅実な城づくりから大成する。'},
    {name:'毛利家',leader:'毛利元就',home:'yoshida',color:'#8b74a9',bonus:'外交費用 −30%',description:'安芸の地から、外交と策を重ねて勢力を広げる。'},
    {name:'島津家',leader:'島津義久',home:'uchijo',color:'#5c8d7f',bonus:'伏兵戦法の攻撃力 +15%',description:'薩摩の兵を鍛え、機を捉える戦いを得意とする。'},
    {name:'伊達家',leader:'伊達政宗',home:'yonezawa',color:'#4b7f9d',bonus:'募兵費用 −15%',description:'奥羽の群雄を制し、新たな時代への道を開く。'},
    {name:'北条家',leader:'北条氏康',home:'odawara',color:'#ab8151',bonus:'兵糧生産 +15%',description:'関東の実りを礎に、揺るぎない領国を築く。'}
  ];
  // Layout is a deliberately simplified strategic map, not a historical boundary map.
  const ROWS = [
    ['ishikawa','石川城','陸奥','東北','津軽家',88,12,1,1700],
    ['sannohe','三戸城','陸奥','東北','南部家',94,17,2,2100],
    ['minato','湊城','出羽','東北','安東家',81,22,1,1500],
    ['kakunodate','角館城','出羽','東北','戸沢家',85,30,1,1500],
    ['yamagata','山形城','出羽','東北','最上家',79,38,2,2200],
    ['yonezawa','米沢城','出羽','東北','伊達家',82,46,2,2600],
    ['kurokawa','黒川城','陸奥','東北','蘆名家',77,53,2,2200],
    ['odaka','小高城','陸奥','東北','相馬家',91,45,1,1600],
    ['ota','太田城','常陸','関東','佐竹家',90,57,2,2200],
    ['utsunomiya','宇都宮城','下野','関東','宇都宮家',83,59,2,1900],
    ['mayabashi','厩橋城','上野','関東','長野家',74,61,1,1600],
    ['oshi','忍城','武蔵','関東','成田家',82,67,2,1700],
    ['odawara','小田原城','相模','関東','北条家',77,76,3,2800],
    ['kasugayama','春日山城','越後','甲信越','上杉家',69,43,3,2600],
    ['ueda','上田城','信濃','甲信越','真田家',68,56,2,1900],
    ['tsutsujigasaki','躑躅ヶ崎館','甲斐','甲信越','武田家',69,68,2,2600],
    ['nanao','七尾城','能登','北陸','畠山家',58,40,2,2000],
    ['kanazawa','金沢御坊','加賀','北陸','本願寺勢',55,50,2,2100],
    ['ichijodani','一乗谷城','越前','北陸','朝倉家',51,58,2,2100],
    ['sunpu','駿府城','駿河','東海','今川家',68,78,2,2300],
    ['hikuma','引馬城','遠江','東海','飯尾家',62,81,1,1400],
    ['okazaki','岡崎城','三河','東海','徳川家',58,74,2,2400],
    ['kiyosu','清洲城','尾張','東海','織田家',55,68,2,2400],
    ['inabayama','稲葉山城','美濃','東海','斎藤家',59,61,2,2100],
    ['odani','小谷城','近江','近畿','浅井家',47,64,2,1800],
    ['kannonji','観音寺城','近江','近畿','六角家',48,72,2,1900],
    ['sakamoto','坂本城','近江','近畿','明智家',43,69,1,1700],
    ['nijo','二条御所','山城','近畿','足利家',39,65,2,1900],
    ['akutagawa','芥川山城','摂津','近畿','三好家',38,73,2,2400],
    ['takaya','高屋城','河内','近畿','畠山家',43,81,2,1800],
    ['tottori','鳥取城','因幡','中国','山名家',34,55,2,1800],
    ['gassan','月山富田城','出雲','中国','尼子家',26,55,3,2400],
    ['okayama','岡山城','備前','中国','宇喜多家',32,65,2,2100],
    ['yoshida','吉田郡山城','安芸','中国','毛利家',23,64,3,2600],
    ['yamaguchi','山口館','周防','中国','大内家',16,64,2,1900],
    ['takamatsu','備中高松城','備中','中国','清水家',28,71,1,1500],
    ['oko','岡豊城','土佐','四国','長宗我部家',28,88,2,2200],
    ['yuzuki','湯築城','伊予','四国','河野家',21,80,2,1600],
    ['shozui','勝瑞城','阿波','四国','三好家',37,87,2,2000],
    ['sogo','十河城','讃岐','四国','十河家',34,78,1,1600],
    ['akizuki','秋月城','筑前','九州','秋月家',11,73,2,1800],
    ['tachibana','立花城','筑前','九州','立花家',7,66,2,2100],
    ['funai','府内館','豊後','九州','大友家',16,80,2,2400],
    ['saga','佐賀城','肥前','九州','龍造寺家',3,76,2,2100],
    ['hitoyoshi','人吉城','肥後','九州','相良家',9,91,2,1800],
    ['kumamoto','隈本城','肥後','九州','城家',9,83,1,1600],
    ['obi','飫肥城','日向','九州','伊東家',17,94,2,1900],
    ['uchijo','内城','薩摩','九州','島津家',8,99,2,2600]
  ];

  const EXTRA_CASTLE_ROWS=[["hirosaki","弘前城","陸奥","津軽家","ishikawa",-3,-3,3],["nejo","根城","陸奥","南部家","sannohe",2,5,2],["morioka","盛岡城","陸奥","南部家","kakunodate",7,4,3],["sendai","仙台城","陸奥","伊達家","odaka",1,-7,3],["kubota","久保田城","出羽","佐竹家","minato",-3,6,2],["nihonmatsu","二本松城","陸奥","畠山家","yonezawa",3,6,2],["shirakawa","白河小峰城","陸奥","結城家","kurokawa",5,3,2],["kunohe","九戸城","陸奥","九戸家","sannohe",-3,7,2],["miharu","三春城","陸奥","田村家","kurokawa",10,-3,2],["mukaihaguroyama","向羽黒山城","陸奥","蘆名家","kurokawa",-2,-4,2],["mito","水戸城","常陸","佐竹家","ota",2,5,3],["minowa","箕輪城","上野","長野家","mayabashi",-3,-2,2],["nitta_kanayama","新田金山城","上野","由良家","mayabashi",3,2,2],["hachigata","鉢形城","武蔵","北条家","oshi",-6,2,2],["kawagoe","川越城","武蔵","太田家","oshi",-1,5,2],["edo","江戸城","武蔵","太田家","oshi",5,5,4],["hachioji","八王子城","武蔵","北条家","odawara",-2,-5,3],["motosakura","本佐倉城","下総","千葉家","oshi",10,1,2],["otaki","大多喜城","上総","本多家","odawara",11,3,2],["numata","沼田城","上野","真田家","mayabashi",2,-5,2],["kofu","甲府城","甲斐","浅野家","tsutsujigasaki",2,3,3],["kaizu","海津城","信濃","武田家","ueda",-1,-4,2],["komoro","小諸城","信濃","仙石家","ueda",3,4,2],["matsumoto","松本城","信濃","小笠原家","ueda",-5,5,3],["takato","高遠城","信濃","仁科家","tsutsujigasaki",-5,-3,2],["shibata","新発田城","越後","新発田家","kasugayama",4,-5,2],["murakami","村上城","越後","本庄家","kasugayama",7,-8,2],["shinpu","新府城","甲斐","武田家","tsutsujigasaki",-2,1,2],["toyama","富山城","越中","神保家","nanao",5,6,2],["takaoka","高岡城","越中","前田家","nanao",2,4,2],["maruoka","丸岡城","越前","柴田家","ichijodani",1,-4,2],["echizen_ono","越前大野城","越前","金森家","ichijodani",4,1,2],["kuniyoshi","佐柿国吉城","若狭","粟屋家","ichijodani",-5,2,2],["iwamura","岩村城","美濃","遠山家","inabayama",4,5,3],["yamanaka","山中城","伊豆","北条家","sunpu",6,1,2],["kakegawa","掛川城","遠江","朝比奈家","hikuma",3,-2,2],["inuyama","犬山城","尾張","織田家","kiyosu",2,-3,2],["nagoya","名古屋城","尾張","徳川家","kiyosu",1,3,4],["nagashino","長篠城","三河","奥平家","okazaki",5,-3,2],["gujo_hachiman","郡上八幡城","美濃","遠藤家","inabayama",-1,-5,2],["naegi","苗木城","美濃","遠山家","inabayama",5,0,2],["ogaki","大垣城","美濃","氏家家","kiyosu",-3,-4,2],["takatenjin","高天神城","遠江","小笠原家","hikuma",4,2,2],["iga_ueno","伊賀上野城","伊賀","藤堂家","kannonji",1,5,3],["matsusaka","松阪城","伊勢","蒲生家","takaya",10,2,2],["hikone","彦根城","近江","井伊家","odani",2,4,3],["azuchi","安土城","近江","織田家","kannonji",-1,-3,4],["osaka","大坂城","摂津","豊臣家","akutagawa",2,5,4],["himeji","姫路城","播磨","黒田家","akutagawa",-4,-2,3],["takeda_castle","竹田城","但馬","赤松家","nijo",-3,-5,3],["takatori","高取城","大和","筒井家","takaya",5,2,3],["wakayama","和歌山城","紀伊","浅野家","takaya",1,7,3],["fukuchiyama","福知山城","丹波","明智家","nijo",0,-4,2],["kishiwada","岸和田城","和泉","小出家","takaya",-3,2,2],["yamato_koriyama","大和郡山城","大和","筒井家","takaya",3,-2,2],["sumoto","洲本城","淡路","脇坂家","akutagawa",-1,8,2],["bitchu_matsuyama","備中松山城","備中","三村家","takamatsu",1,-5,3],["tsuyama","津山城","美作","森家","okayama",1,-4,3],["hiroshima","広島城","安芸","毛利家","yoshida",0,5,3],["iwakuni","岩国城","周防","吉川家","yamaguchi",4,5,3],["hagi","萩城","長門","毛利家","yamaguchi",-2,-5,3],["matsue","松江城","出雲","堀尾家","gassan",-2,-4,3],["yonago","米子城","伯耆","中村家","gassan",4,-1,2],["mihara","三原城","備後","小早川家","takamatsu",-3,3,2],["shintakayama","新高山城","安芸","小早川家","yoshida",3,3,2],["tsuwano","津和野城","石見","吉見家","yamaguchi",3,-4,2],["tokushima","徳島城","阿波","蜂須賀家","shozui",2,3,3],["sanuki_takamatsu","高松城","讃岐","生駒家","sogo",-1,-2,3],["marugame","丸亀城","讃岐","生駒家","sogo",-4,2,3],["imabari","今治城","伊予","藤堂家","yuzuki",3,-3,3],["uwajima","宇和島城","伊予","伊達家","yuzuki",-2,5,3],["kochi","高知城","土佐","山内家","oko",-2,4,3],["kokura","小倉城","豊前","細川家","akizuki",3,-3,3],["fukuoka","福岡城","筑前","黒田家","tachibana",-2,3,3],["nakatsu","中津城","豊前","黒田家","funai",1,-6,3],["oka","岡城","豊後","中川家","funai",-3,4,3],["hizen_nagoya","名護屋城","肥前","豊臣家","saga",-1,-5,4],["hirado","平戸城","肥前","松浦家","saga",-2,4,2],["shimabara","島原城","肥前","松倉家","kumamoto",-5,1,3],["kagoshima","鹿児島城","薩摩","島津家","uchijo",-2,-3,3]];
  const EXISTING_ROWS=Object.fromEntries(ROWS.map(r=>[r[0],r]));
  for(let i=0;i<EXTRA_CASTLE_ROWS.length;i++){
    const r=EXTRA_CASTLE_ROWS[i],anchor=EXISTING_ROWS[r[4]];
    ROWS.push([r[0],r[1],r[2],anchor[3],r[3],Math.max(1,Math.min(99,anchor[5]+r[5])),Math.max(3,Math.min(99,anchor[6]+r[6])),r[7],1600+(i*37%9)*180+r[7]*160]);
  }
  const EDGES = [
    ['ishikawa','sannohe'],['ishikawa','minato'],['sannohe','kakunodate'],['minato','kakunodate'],['minato','yamagata'],['kakunodate','yamagata'],['kakunodate','odaka'],['yamagata','yonezawa'],['yamagata','kasugayama'],['yonezawa','kurokawa'],['yonezawa','odaka'],['kurokawa','kasugayama'],['kurokawa','utsunomiya'],['odaka','ota'],['ota','utsunomiya'],['ota','oshi'],['utsunomiya','mayabashi'],['utsunomiya','oshi'],['mayabashi','oshi'],['mayabashi','ueda'],['oshi','odawara'],['odawara','tsutsujigasaki'],['odawara','sunpu'],['kasugayama','ueda'],['kasugayama','nanao'],['ueda','tsutsujigasaki'],['ueda','inabayama'],['tsutsujigasaki','sunpu'],['tsutsujigasaki','inabayama'],['nanao','kanazawa'],['kanazawa','ichijodani'],['ichijodani','odani'],['ichijodani','inabayama'],['sunpu','hikuma'],['hikuma','okazaki'],['okazaki','kiyosu'],['kiyosu','inabayama'],['kiyosu','kannonji'],['inabayama','odani'],['odani','kannonji'],['odani','nijo'],['kannonji','sakamoto'],['kannonji','takaya'],['sakamoto','nijo'],['sakamoto','akutagawa'],['nijo','akutagawa'],['nijo','tottori'],['akutagawa','takaya'],['akutagawa','okayama'],['takaya','shozui'],['tottori','gassan'],['tottori','okayama'],['gassan','yoshida'],['gassan','okayama'],['okayama','takamatsu'],['okayama','sogo'],['yoshida','takamatsu'],['yoshida','yamaguchi'],['yamaguchi','tachibana'],['yamaguchi','akizuki'],['takamatsu','sogo'],['takamatsu','yuzuki'],['sogo','shozui'],['sogo','oko'],['yuzuki','oko'],['yuzuki','funai'],['shozui','oko'],['tachibana','akizuki'],['tachibana','saga'],['akizuki','saga'],['akizuki','funai'],['akizuki','kumamoto'],['saga','kumamoto'],['funai','kumamoto'],['funai','obi'],['kumamoto','hitoyoshi'],['hitoyoshi','obi'],['hitoyoshi','uchijo'],['obi','uchijo']
  ];
  for(const r of EXTRA_CASTLE_ROWS){
    EDGES.push([r[0],r[4]]);
    const current=ROWS.find(c=>c[0]===r[0]);
    const nearest=ROWS.filter(c=>c[0]!==r[0]&&c[0]!==r[4]&&c[3]===current[3]).sort((a,b)=>Math.hypot(a[5]-current[5],a[6]-current[6])-Math.hypot(b[5]-current[5],b[6]-current[6]))[0];
    if(nearest)EDGES.push([r[0],nearest[0]]);
  }
  const STAFF_BASE_ID='kyoto_gosho';
  ROWS.push([STAFF_BASE_ID,'京都御所','山城','近畿','朝廷',39,63,2,1900]);
  EDGES.push([STAFF_BASE_ID,'nijo']);
  const MAJOR_CITY_IDS=Object.freeze(['edo',STAFF_BASE_ID,'nijo','osaka','nagoya']);
  const CASTLES = ROWS.map(r=>({id:r[0],name:r[1],province:r[2],region:r[3],clan:r[4],x:r[5],y:r[6],wall:r[7],initialTroops:r[8],majorCity:MAJOR_CITY_IDS.includes(r[0]),neighbors:[]}));
  const CASTLE_BY_ID = Object.assign(Object.create(null),Object.fromEntries(CASTLES.map(c=>[c.id,c])));
  for (const [a,b] of EDGES) { if(!CASTLE_BY_ID[a].neighbors.includes(b))CASTLE_BY_ID[a].neighbors.push(b); if(!CASTLE_BY_ID[b].neighbors.includes(a))CASTLE_BY_ID[b].neighbors.push(a); }
  const TACTICS = [
    {id:'balanced',name:'正攻法',description:'安定した戦力で攻める標準の戦法。',modifier:1,food:1,loss:1},
    {id:'assault',name:'総攻撃',description:'攻撃力 +18%。兵の損耗と兵糧消費が増える。',modifier:1.18,food:1.25,loss:1.35},
    {id:'siege',name:'包囲戦',description:'城壁の効果を半減。兵糧を多く消費する。',modifier:.97,food:1.65,loss:.8},
    {id:'ambush',name:'伏兵',description:'軍団の平均知略が高いほど強力。偵察との併用が有効。',modifier:1,food:1.1,loss:.95}
  ];
  // Repeatable field encounters have their own progress: they never count as
  // castle captures or advance the castle-attack strategy/quest counters.
  const ROAMING_TACTICS=Object.freeze([
    {id:'balanced',name:'正攻法',description:'陣形を保ち、街道の足軽や槍隊に対処する。',modifier:1,food:1,loss:1},
    {id:'assault',name:'突撃',description:'攻撃力を高めて接近。弓隊に強いが損耗が増える。',modifier:1.15,food:1.25,loss:1.3},
    {id:'ambush',name:'伏兵',description:'軍団の知略を生かし、森や峠で側面を突く。',modifier:1,food:1.1,loss:.9},
    {id:'encircle',name:'包囲',description:'退路を抑えて損耗を減らす。騎馬隊や鉄砲隊に有効。',modifier:.96,food:1.4,loss:.75}
  ].map(Object.freeze));
  const ROAMING_ENCOUNTERS=Object.freeze([
    {id:'road_scouts',name:'街道のはぐれ足軽',terrain:'街道',units:'足軽',description:'街道沿いをさまよう小勢。初めての野良兵戦に向いた相手。',tier:1,troops:450,power:1,preferred:'balanced',art:'post_town',rewards:{gold:250,rice:150,wood:30,stone:20,magatama:2},prestige:3},
    {id:'forest_bows',name:'森陰の野伏弓隊',terrain:'森',units:'弓兵',description:'木々の陰から矢を放つ野伏。接近する突撃が有効。',tier:2,troops:1200,power:1.08,preferred:'assault',art:'cedar_forest',rewards:{gold:500,rice:240,wood:70,stone:30,magatama:3},prestige:5},
    {id:'river_spears',name:'渡し場の槍兵団',terrain:'川辺',units:'槍兵',description:'川岸に長槍を並べる一団。正攻法で陣形を崩さず進む。',tier:3,troops:2400,power:1.12,preferred:'balanced',art:'irrigation',rewards:{gold:900,rice:360,wood:100,stone:80,magatama:5},prestige:8},
    {id:'pass_horsemen',name:'峠の流浪騎馬隊',terrain:'峠',units:'騎馬兵',description:'峠を駆ける騎馬隊。知略を生かした伏兵で迎え撃つ。',tier:4,troops:4500,power:1.18,preferred:'ambush',art:'ranch',rewards:{gold:1500,rice:520,wood:140,stone:120,magatama:8},prestige:12},
    {id:'hill_muskets',name:'丘陵の鉄砲衆',terrain:'丘陵',units:'鉄砲兵',description:'丘に陣を敷く熟練の鉄砲衆。包囲して射線を分断する。',tier:5,troops:8000,power:1.25,preferred:'encircle',art:'gunsmith',rewards:{gold:2200,rice:750,wood:200,stone:180,magatama:12},prestige:18},
    {id:'ronin_vanguard',name:'荒野の浪人精鋭軍',terrain:'荒野',units:'混成精鋭',description:'足軽・騎馬・鉄砲を備える歴戦の一団。十分な兵と軍団を整えよう。',tier:6,troops:14000,power:1.35,preferred:'encircle',art:'drill_ground',rewards:{gold:3600,rice:1100,wood:250,stone:300,magatama:18},prestige:30}
  ].map(v=>Object.freeze({...v,rewards:Object.freeze(v.rewards)})));
  const ROAMING_DEPLOYMENT_DEFAULTS=Object.freeze({revision:1,totalTroops:384000,squadSize:1000,respawnSeconds:300});
  function validateRoamingDeployment(raw){
    const bad=message=>({ok:false,message});
    if(!raw||typeof raw!=='object'||Array.isArray(raw))return bad('野良兵の配置内容を確認してください。');
    const {totalTroops,squadSize,respawnSeconds}=raw,revision=raw.revision??1;
    if(!Number.isSafeInteger(revision)||revision<1||revision>1000000000)return bad('配置の更新番号を確認してください。');
    if(!Number.isSafeInteger(totalTroops)||totalTroops<0||totalTroops>20000000)return bad('全国の総兵数は0〜20,000,000人の整数で指定してください。');
    if(!Number.isSafeInteger(squadSize)||squadSize<300||squadSize>20000)return bad('1部隊の兵数は300〜20,000人の整数で指定してください。');
    if(!Number.isSafeInteger(respawnSeconds)||respawnSeconds<60||respawnSeconds>3600)return bad('再出現までの時間は60〜3,600秒の整数で指定してください。');
    if(Math.ceil(totalTroops/squadSize)>4096)return bad('全国の部隊数が4,096部隊以内になるよう、総兵数か1部隊の兵数を調整してください。');
    return{ok:true,config:{revision,totalTroops,squadSize,respawnSeconds}};
  }
  function roamingDeploymentUnits(raw,castleId){
    const parsed=validateRoamingDeployment(raw);if(!parsed.ok)return[];
    const config=parsed.config,castleIndex=CASTLES.findIndex(c=>c.id===castleId);if(castleIndex<0)return[];
    const count=Math.ceil(config.totalTroops/config.squadSize),units=[];
    for(let index=castleIndex,slot=0;index<count;index+=CASTLES.length,slot++){
      const encounter=ROAMING_ENCOUNTERS[(castleIndex+slot)%ROAMING_ENCOUNTERS.length];
      units.push({unitId:`wild_${config.revision}_${castleId}_${slot}`,encounterId:encounter.id,castleId,troops:Math.min(config.squadSize,config.totalTroops-index*config.squadSize),slot,deploymentRevision:config.revision});
    }
    return units;
  }
  function roamingDeploymentSummary(raw){
    const parsed=validateRoamingDeployment(raw);if(!parsed.ok)return null;
    const config=parsed.config;
    return{...config,totalSquads:Math.ceil(config.totalTroops/config.squadSize),castles:CASTLES.map(c=>{const units=roamingDeploymentUnits(config,c.id);return{castleId:c.id,squads:units.length,troops:units.reduce((sum,u)=>sum+u.troops,0)};})};
  }
  function validRoamingUnit(unit,encounterId){
    return !!unit&&typeof unit==='object'&&!Array.isArray(unit)&&!!CASTLE_BY_ID[unit.castleId]&&unit.encounterId===encounterId&&Number.isSafeInteger(unit.deploymentRevision)&&unit.deploymentRevision>=1&&unit.deploymentRevision<=1000000000&&Number.isSafeInteger(unit.slot)&&unit.slot>=0&&unit.slot<32&&unit.unitId===`wild_${unit.deploymentRevision}_${unit.castleId}_${unit.slot}`&&Number.isSafeInteger(unit.troops)&&unit.troops>=1&&unit.troops<=20000;
  }
  const QUESTS = [
    {id:'first_upgrade',name:'城下の礎',description:'施設の増築を1回完成させる。',target:1,reward:{gold:600,rice:500},prestige:10},
    {id:'first_recruit',name:'人こそ城',description:'武将を1名、新たに登用する。',target:1,reward:{gold:450,wood:300},prestige:10},
    {id:'first_battle',name:'初陣の勝鬨',description:'攻城戦に1回勝利する。',target:1,reward:{gold:1000,rice:1400},prestige:20},
    {id:'three_castles',name:'一国の主',description:'領有する城を3城に増やす。',target:3,reward:{gold:1800,wood:900,stone:700},prestige:30},
    {id:'five_officers',name:'英傑の集い',description:'家臣を8名以上に増やす。',target:8,reward:{gold:1200,rice:1000},prestige:20},
    {id:'technology',name:'新しき知恵',description:'研究を1回完成させる。',target:1,reward:{gold:700,wood:400,stone:400},prestige:15},
    {id:'ten_castles',name:'天下への道',description:'領有する城を10城に増やす。',target:10,reward:{gold:4000,rice:6000,wood:2000,stone:2000},prestige:60},
    {id:'unify',name:'天下統一',description:'全国129拠点を統一する。',target:129,reward:{gold:10000,rice:10000},prestige:300}
  ];
  const GACHA = {currency:'勾玉',initial:3000,singleCost:300,tenCost:2700,duplicateRefund:50,monthlyReward:30,firstCaptureReward:120,rates:[{rank:'D',rate:25},{rank:'C',rate:25},{rank:'B',rate:20},{rank:'A',rate:15},{rank:'S',rate:8},{rank:'SS',rate:4},{rank:'SSS',rate:2},{rank:'U',rate:1}]};
  [100,100,200,300,200,150,500,1000].forEach((amount,i)=>QUESTS[i].reward.magatama=amount);
  const RANK_BONUSES={D:0,C:2,B:4,A:6,S:8,SS:10,SSS:12,U:15};
  const ADMIN_ASSETS=Object.freeze({castleId:'edo',officerId:'of_b0616adde162',rank:'U',clanName:'德川家'});
  const ADMIN_CLAN=Object.freeze({...CLANS.find(c=>c.name==='徳川家'),name:ADMIN_ASSETS.clanName,leader:'德川家康',home:ADMIN_ASSETS.castleId,description:'江戸城を本拠とする、運営専用の家。'});
  const STAFF_CLAN=Object.freeze({...CLANS.find(c=>c.name==='徳川家'),name:ADMIN_ASSETS.clanName,leader:'徳川家康',home:STAFF_BASE_ID,description:'京都御所を共同本拠とする、スタッフの家。'});
  const GIFT_FIELDS=[...RESOURCES,'magatama'];
  // Role belongs to the authenticated runtime. It is never serialized in a save.
  const ADMIN_ACCESS=new WeakMap(),STAFF_ACCESS=new WeakMap(),COURT_ACCESS=new WeakMap(),BRANCH_AUTHORITY=new WeakMap(),MAINTENANCE_AUTHORITY=new WeakMap(),BRANCH_PARENT_LOSSES=new WeakMap(),HOME_DEFENSE_LOSSES=new WeakMap(),STAFF_VIEW=new WeakMap(),STAFF_ORIGIN=new WeakMap();
  const UPKEEP_TRACKS=new WeakMap(),MAX_UPKEEP_TRACKS=128;
  const MAX_HOME_DEFENSE_LOSSES=256;
  const WORLD_CALENDAR=Object.freeze({startYear:1560,yearsPerCycle:56,monthsPerCycle:672,secondsPerMonth:60});
  const MAX_TURN=999999999;
  // Court titles are game progression, independent of account/guild permissions.
  // Keep this single scoring contract in the shared browser/Worker engine.
  const EVALUATION_MAX=100000;
  const EVALUATION_RANKS=Object.freeze([
    ['無位',0],['従八位',5000],['正八位',10000],['従七位',15000],['正七位',20000],
    ['従六位',25000],['正六位',30000],['従五位',35000],['正五位',40000],
    ['従四位',45000],['正四位',50000],['従三位',60000],['正三位',70000],
    ['従二位',80000],['正二位',90000],['従一位',95000],['正一位',98000]
  ].map(([name,minScore],index)=>Object.freeze({id:`court-${index}`,name,index,minScore})));
  const COVERT_RULES=Object.freeze({minCount:1,maxCount:20000,commandCost:1,stationLimit:1024,historyLimit:40,reportLimit:50,capacityDivisor:4,hire:{ninja:{gold:3,rice:2},ashigaru:{gold:1,rice:1}},scout:{riceBase:20,ricePerUnit:.2},station:{riceBase:30,ricePerUnit:.3},retaliate:{riceBase:50,ricePerUnit:.4}});
  const COURT_ADMISSION=Object.freeze({rankId:'court-7',rankName:'従五位',minScore:35000});
  const BRANCH_RULES=Object.freeze({commandCost:1,parents:Object.freeze([{id:'edo',maxBranches:4,maxLevel:8,facilitySlots:6},{id:'nijo',maxBranches:2,maxLevel:24,facilitySlots:12},{id:'osaka',maxBranches:2,maxLevel:24,facilitySlots:12},{id:'nagoya',maxBranches:2,maxLevel:24,facilitySlots:12}].map(Object.freeze)),directions:Object.freeze([{id:'north',name:'北'},{id:'east',name:'東'},{id:'south',name:'南'},{id:'west',name:'西'}].map(Object.freeze))});
  // A branch has its own small, fixed catalogue. Completed levels belong to
  // that branch; they never replace the main town's buildings or grant troops.
  const BRANCH_FACILITIES=Object.freeze([
    {id:'farm',name:'田畑',description:'支拠点の田畑を耕し、領国へ兵糧を届ける。',category:'rice',base:{gold:220,wood:100,stone:60},income:{rice:100},output:'兵糧 +100 /月・Lv'},
    {id:'market',name:'商家',description:'支拠点の商いを育て、領国の財源を補う。',category:'gold',base:{gold:260,wood:110,stone:90},income:{gold:45},output:'金銭 +45 /月・Lv'},
    {id:'lumber',name:'伐採所',description:'近郊の山林から普請用の木材を切り出す。',category:'wood',base:{gold:200,wood:70,stone:60},income:{wood:40},output:'木材 +40 /月・Lv'},
    {id:'quarry',name:'採石場',description:'近郊の石を採り、領国の普請を支える。',category:'stone',base:{gold:220,wood:110,stone:50},income:{stone:35},output:'石材 +35 /月・Lv'},
    {id:'barracks',name:'兵舎',description:'兵の滞在先を整え、領国の兵数上限を広げる。',category:'military',base:{gold:300,wood:160,stone:120},capacity:150,output:'領国の兵数上限 +150 / Lv'},
    {id:'watchtower',name:'物見櫓',description:'敵の動きを見張り、この支拠点の防衛力を高める。',category:'defense',base:{gold:300,wood:160,stone:180},defense:.01,output:'この支拠点の防衛力 +1% / Lv'},
    {id:'granary',name:'兵糧蔵',description:'収穫を蓄え、領国へ届ける兵糧の損耗を減らす。',category:'rice',base:{gold:280,wood:150,stone:100},income:{rice:75},output:'兵糧 +75 /月・Lv'},
    {id:'trade_port',name:'交易港',description:'水運の荷を集め、支拠点の交易収入を増やす。',category:'gold',base:{gold:320,wood:160,stone:120},income:{gold:35},output:'金銭 +35 /月・Lv'},
    {id:'sawmill',name:'製材所',description:'切り出した木を加工し、使える建材を増やす。',category:'wood',base:{gold:260,wood:120,stone:100},income:{wood:30},output:'木材 +30 /月・Lv'},
    {id:'stoneworks',name:'石工場',description:'石材の加工を進め、領国の資材供給を厚くする。',category:'stone',base:{gold:280,wood:130,stone:90},income:{stone:25},output:'石材 +25 /月・Lv'},
    {id:'drill_ground',name:'訓練場',description:'兵の受け入れを整え、領国の兵数上限を広げる。',category:'military',base:{gold:340,wood:170,stone:140},capacity:100,output:'領国の兵数上限 +100 / Lv'},
    {id:'moat',name:'堀',description:'支拠点の周囲に堀を巡らせる。攻城技術と攻城戦法で効果が弱まる。',category:'defense',base:{gold:320,wood:120,stone:240},siegeDefense:.0075,output:'この支拠点の防衛力 +0.75% / Lv（攻城で軽減）'}
  ].map(def=>Object.freeze({...def,artId:def.id,base:Object.freeze(def.base),...(def.income?{income:Object.freeze(def.income)}:{})})));
  function branchFacilityCatalog(parentCastleId){const rule=BRANCH_RULES.parents.find(row=>row.id===parentCastleId);return rule?BRANCH_FACILITIES.slice(0,rule.facilitySlots):[];}
  function branchFacilityCost(parentCastleId,facilityId,fromLevel){const rule=BRANCH_RULES.parents.find(row=>row.id===parentCastleId),def=branchFacilityCatalog(parentCastleId).find(row=>row.id===facilityId);if(!rule||!def||!Number.isInteger(fromLevel)||fromLevel<0||fromLevel>=rule.maxLevel)return null;const mult=1+fromLevel*.35+fromLevel*fromLevel*.02,turns=fromLevel>=16?3:fromLevel>=8?2:1;return{gold:Math.round(def.base.gold*mult),rice:0,wood:Math.round(def.base.wood*mult),stone:Math.round(def.base.stone*mult),turns,seconds:turns*60};}
  function branchFacilityEffects(branch,elapsedMs=Infinity){const bonus={income:{gold:0,rice:0,wood:0,stone:0},capacity:0,defense:0,siegeDefense:0};if(!branch||branch.level<1||branch.fallen||branch.retreating)return bonus;for(const def of branchFacilityCatalog(branch.parentCastleId)){const times=branch.facilityCompletedAt?.[def.id],level=times?times.filter(at=>at<=elapsedMs).length:branch.facilities?.[def.id]||0;for(const key of RESOURCES)bonus.income[key]+=level*(def.income?.[key]||0);bonus.capacity+=level*(def.capacity||0);bonus.defense+=level*(def.defense||0);bonus.siegeDefense+=level*(def.siegeDefense||0);}return bonus;}
  function completeBranchFacility(branch,job,elapsedMs){
    if(!branch||branch.fallen||!branchFacilityCatalog(branch.parentCastleId).some(def=>def.id===job.facilityId)||job.targetLevel!==(branch.facilities?.[job.facilityId]||0)+1||job.targetLevel>branch.level)return false;
    const times=Object.fromEntries(Object.entries(branch.facilities||{}).filter(([,level])=>level>0).map(([id,level])=>[id,[...(branch.facilityCompletedAt?.[id]||Array(level).fill(0))]]));
    times[job.facilityId]=[...(times[job.facilityId]||[]),Math.round(elapsedMs)];branch.facilityCompletedAt=times;branch.facilities={...branch.facilities,[job.facilityId]:job.targetLevel};return true;
  }
  function branchFacilityEffectText(def,level){const values=[];for(const key of RESOURCES)if(def.income?.[key])values.push(`${({gold:'金銭',rice:'兵糧',wood:'木材',stone:'石材'})[key]} +${(def.income[key]*level).toLocaleString()} /月`);if(def.capacity)values.push(`兵数上限 +${(def.capacity*level).toLocaleString()}`);if(def.defense||def.siegeDefense)values.push(`支拠点防衛 +${Number(((def.defense||def.siegeDefense)*level*100).toFixed(2))}%${def.siegeDefense?'（攻城で軽減）':''}`);return values.join('・');}
  const BRANCH_SITES=BRANCH_RULES.parents.flatMap(parent=>BRANCH_RULES.directions.map(direction=>({id:parent.id+'_'+direction.id,parentCastleId:parent.id,direction:direction.id,name:CASTLE_BY_ID[parent.id].name+'・'+direction.name+'支拠点',maxLevel:parent.maxLevel})));
  const BRANCH_BY_ID=Object.assign(Object.create(null),Object.fromEntries(BRANCH_SITES.map(site=>[site.id,site])));
  function branchUpgradeCost(parentCastleId,fromLevel){const rule=BRANCH_RULES.parents.find(row=>row.id===parentCastleId);if(!rule||!Number.isInteger(fromLevel)||fromLevel<0||fromLevel>=rule.maxLevel)return null;const stage=Math.max(1,fromLevel),lv=stage-1,mult=1+lv*.3+lv*lv*.015,turns=stage>=16?3:stage>=6?2:1;return{gold:Math.round(700*mult),rice:0,wood:Math.round(280*mult),stone:Math.round(400*mult),turns,seconds:turns*60};}
  // The previous save limit covers ordinary town work. Each permitted branch
  // can additionally reserve its own body and every facility up to its cap.
  const MAX_CONSTRUCTION_JOBS=193+BRANCH_RULES.parents.reduce((total,parent)=>
    total+parent.maxBranches*parent.maxLevel*(1+parent.facilitySlots),0);
  function branchQueuePlan(branch,jobs){
    const facilities={...branch?.facilities};let level=branch?.level||0,startsInSeconds=0;
    for(const job of jobs){
      if(job.facilityId)facilities[job.facilityId]=job.targetLevel;
      else level=job.targetLevel;
      startsInSeconds=job.finishesInSeconds??(startsInSeconds+job.remainingSeconds);
    }
    return {level,facilities,startsInSeconds,queuePosition:jobs.length+1,queued:jobs.length>0};
  }
  function normalizeBranchState(value,{castles,clan,jobs=[],officers=[],army=[],governors={},isAdmin=false,validateRole=true}={}){
    const invalid=()=>{throw Object.assign(Error('支拠点の配置・成長・工事を確認できません。'),{code:'INVALID_BRANCH_STATE'});},raw=value===undefined?[]:value;
    if(!Array.isArray(raw)||raw.length>BRANCH_RULES.parents.reduce((total,parent)=>total+parent.maxBranches,0)||!Array.isArray(jobs))invalid();
    const found=new Map(),counts=new Map(),commanders=new Set(),result=[];
    for(const row of raw){const site=row&&BRANCH_BY_ID[row.id],rule=site&&BRANCH_RULES.parents.find(parent=>parent.id===site.parentCastleId);if(!row||typeof row!=='object'||Array.isArray(row)||!site||row.parentCastleId!==site.parentCastleId||row.direction!==site.direction||found.has(row.id)||!Number.isInteger(row.level)||row.level<0||row.level>rule.maxLevel||!castles||!row.retreating&&(castles[site.parentCastleId]?.owner!==clan||validateRole&&site.parentCastleId==='edo'&&isAdmin!==true))invalid();const count=(counts.get(site.parentCastleId)||0)+1;if(count>rule.maxBranches)invalid();counts.set(site.parentCastleId,count);if(row.fallen!==undefined&&typeof row.fallen!=='boolean'||row.level===0&&row.fallen===true||row.retreating!==undefined&&typeof row.retreating!=='boolean'||row.stationedTroops!==undefined&&(!Number.isSafeInteger(row.stationedTroops)||row.stationedTroops<0||row.stationedTroops>ASSET_CAP)||row.level===0&&row.stationedTroops>0||row.retreating===true&&(!(row.stationedTroops>0)||row.level<1||row.fallen!==true||row.facilities!==undefined||row.facilityCompletedAt!==undefined))invalid();const clean={id:site.id,parentCastleId:site.parentCastleId,direction:site.direction,level:row.level,fallen:row.fallen===true};
      if(row.durability!==undefined){try{clean.durability=normalizeDurability(row.durability);}catch{invalid();}}
      if(row.stationedTroops!==undefined)clean.stationedTroops=row.stationedTroops;
      if(row.retreating===true)clean.retreating=true;
      if(row.commanders!==undefined){
        if(!Array.isArray(row.commanders)||row.commanders.length>(site.parentCastleId==='edo'?1:2)||row.retreating&&row.commanders.length||row.level===0&&row.commanders.length||row.commanders.some(id=>typeof id!=='string'||!officers.includes(id)||army.includes(id)||Object.values(governors).includes(id)||commanders.has(id)))invalid();
        for(const id of row.commanders){if(commanders.has(id))invalid();commanders.add(id);}clean.commanders=[...row.commanders];
      }
      // Absent maps are old saves with every facility unbuilt. Preserve that
      // compact shape so upgrading the client never rewrites the branch ledger.
      if(row.facilities!==undefined){if(!row.facilities||typeof row.facilities!=='object'||Array.isArray(row.facilities))invalid();const ids=new Set(branchFacilityCatalog(site.parentCastleId).map(def=>def.id)),entries=Object.entries(row.facilities);if(entries.length>rule.facilitySlots||entries.some(([id,level])=>!ids.has(id)||!Number.isInteger(level)||level<0||level>row.level))invalid();clean.facilities=Object.fromEntries(entries);}
      if(row.facilityCompletedAt!==undefined){if(!row.facilityCompletedAt||typeof row.facilityCompletedAt!=='object'||Array.isArray(row.facilityCompletedAt)||!clean.facilities)invalid();const entries=Object.entries(row.facilityCompletedAt),levels=Object.entries(clean.facilities).filter(([,level])=>level>0);if(entries.length!==levels.length||entries.some(([id,times])=>!Object.hasOwn(clean.facilities,id)||!Array.isArray(times)||times.length!==clean.facilities[id]||!times.length||times.some((at,i)=>!Number.isSafeInteger(at)||at<0||i>0&&at<times[i-1])))invalid();clean.facilityCompletedAt=Object.fromEntries(entries.map(([id,times])=>[id,[...times]]));}
      found.set(site.id,clean);result.push(clean);}
    const plans=new Map();
    for(const job of jobs){
      if(job?.kind!=='branch'){if(job?.facilityId!==undefined)invalid();continue;}
      const row=found.get(job.id);if(!row||row.retreating)invalid();
      const prior=plans.get(job.id),plan=prior||{level:row.level,facilities:{...row.facilities}};
      const repair=job.repair===true,facility=job.facilityId!==undefined;
      const level=facility?(plan.facilities[job.facilityId]||0):plan.level;
      const cost=facility?branchFacilityCost(row.parentCastleId,job.facilityId,level):
        branchUpgradeCost(row.parentCastleId,repair?Math.max(0,level-1):level);
      if(!cost||job.repair!==undefined&&!repair||repair&&(prior||facility||!row.fallen||row.level<1)||
        !repair&&row.fallen||facility&&(plan.level<1||job.targetLevel>plan.level)||
        job.targetLevel!==(repair?level:level+1)||job.totalSeconds!==cost.seconds||job.total!==cost.turns||
        !Number.isFinite(job.remainingSeconds)||job.remainingSeconds<=0||job.remainingSeconds>cost.seconds||
        prior&&job.remainingSeconds!==cost.seconds||job.remaining!==Math.ceil((job.remainingSeconds-1e-8)/60))invalid();
      const deadline=job.completesElapsedMs;
      if(deadline!==undefined&&(!Number.isSafeInteger(deadline)||deadline<0||
        prior?.deadline!==undefined&&deadline!==prior.deadline+cost.seconds*1000))invalid();
      if(facility)plan.facilities[job.facilityId]=job.targetLevel;else plan.level=job.targetLevel;
      plan.deadline=deadline;plans.set(job.id,plan);
    }
    if(result.some(row=>row.level===0&&!plans.has(row.id)))invalid();return result;
  }
  // A lost parent removes buildings, never finite stationed soldiers. Keep a
  // bounded, withdrawal-only record until its owner chooses a new destination.
  // This changes no army/castle balance, so replay cannot credit a retreat twice.
  function pruneBranchState(state,{isAdmin=true}={}){
    const prior=state.branches||[],branches=[];let changed=false;
    for(const row of prior){
      if(!BRANCH_BY_ID[row.id]){changed=true;continue;}
      const owned=state.castles[row.parentCastleId]?.owner===state.clan&&(row.parentCastleId!=='edo'||isAdmin);
      if(!row.retreating&&owned){branches.push(row);continue;}
      if(!(row.stationedTroops>0)){changed=true;continue;}
      const retreat={id:row.id,parentCastleId:row.parentCastleId,direction:row.direction,level:row.level,fallen:true,stationedTroops:row.stationedTroops,retreating:true};
      if(JSON.stringify(row)!==JSON.stringify(retreat))changed=true;
      branches.push(retreat);
    }
    const active=new Set(branches.filter(row=>!row.retreating).map(row=>row.id)),jobs=state.jobs.filter(job=>job.kind!=='branch'||active.has(job.id));
    if(jobs.length!==state.jobs.length)changed=true;
    if(changed){state.branches=branches;state.jobs=jobs;}
    return changed;
  }
  const DATA = {version:2,assetCap:ASSET_CAP,maintenance:MAINTENANCE_RULES,durability:DURABILITY_RULES,staffBaseId:STAFF_BASE_ID,courtAdmission:COURT_ADMISSION,branchRules:BRANCH_RULES,branchFacilities:BRANCH_FACILITIES,gacha:GACHA,rankBonuses:RANK_BONUSES,adminAssets:ADMIN_ASSETS,adminClan:ADMIN_CLAN,staffClan:STAFF_CLAN,majorCityIds:MAJOR_CITY_IDS,worldCalendar:WORLD_CALENDAR,secondsPerMonth:60,secondsPerCommand:20,buildingLimit:32,ranks:RANKS,evaluationRanks:EVALUATION_RANKS,evaluationMax:EVALUATION_MAX,categories:CATEGORY_LABELS,clans:CLANS,buildings:BUILDINGS,techs:TECHS,castles:CASTLES,tactics:TACTICS,quests:QUESTS,resources:RESOURCES,covert:COVERT_RULES,roaming:{commandCost:1,minTroops:300,historyLimit:20,encounters:ROAMING_ENCOUNTERS,tactics:ROAMING_TACTICS}};
  DATA.officerHealth=OFFICER_HEALTH_RULES;
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const copy=o=>JSON.parse(JSON.stringify(o));
  const int=n=>Math.floor(Number(n)||0);
  // realtime carries eight decimal places of seconds. Convert through that
  // integer precision so e.g. 2.007 seconds is exactly the 2007ms boundary.
  const elapsedMillis=state=>state.turn*60000+Math.round(state.realtime.elapsed*1e8)/1e5;
  const officerHealthElapsed=state=>Math.max(0,Math.round(elapsedMillis(state)));
  // One health value belongs to the person, shared by every collected rank.
  // Integer recovery units make 1 ms and a long catch-up produce identical saves.
  const HEALTH_UNITS=6000;
  function normalizeOfficerHealth(raw,state){
    const owned=state.officers,object=v=>v&&typeof v==='object'&&!Array.isArray(v);
    if(!Array.isArray(owned))return null;
    const ownedIds=new Set(owned);
    if(raw===undefined)return{version:1,asOfElapsedMs:officerHealthElapsed(state),values:Object.fromEntries(owned.map(id=>[id,OFFICER_HEALTH_RULES.max]))};
    if(!object(raw)||raw.version!==1||!Number.isSafeInteger(raw.asOfElapsedMs)||raw.asOfElapsedMs<0||raw.asOfElapsedMs>MAX_TURN*60000+59999||!object(raw.values)||Object.keys(raw.values).some(id=>!ownedIds.has(id))||Object.values(raw.values).some(value=>typeof value!=='number'||!Number.isFinite(value)||value<0||value>OFFICER_HEALTH_RULES.max))return null;
    return{version:1,asOfElapsedMs:raw.asOfElapsedMs,values:Object.fromEntries(owned.map(id=>[id,Object.hasOwn(raw.values,id)?Math.round(raw.values[id]*HEALTH_UNITS)/HEALTH_UNITS:OFFICER_HEALTH_RULES.max]))};
  }
  function officerMarchArmy(state,march=state.march){
    const ids=march?.profile?.army??march?.army;
    return Array.isArray(ids)?[...new Set(ids)].filter(id=>state.officers.includes(id)):[];
  }
  function projectOfficerHealth(state,elapsedMs=officerHealthElapsed(state),options={}){
    const health=normalizeOfficerHealth(state.officerHealth,state);
    if(!health||!Number.isSafeInteger(elapsedMs)||elapsedMs<0||elapsedMs>MAX_TURN*60000+59999)return null;
    const target=Math.max(health.asOfElapsedMs,elapsedMs),from=health.asOfElapsedMs,delta=target-from;
    if(!delta)return health;
    const march=Object.hasOwn(options,'march')?options.march:state.march,busy=new Set(officerMarchArmy(state,march));
    const departed=Number.isSafeInteger(march?.departedElapsedMs)?march.departedElapsedMs:from;
    const busyElapsed=march?Math.max(0,target-Math.max(from,departed)):0;
    for(const id of state.officers){
      const recovered=delta-(busy.has(id)?busyElapsed:0);
      health.values[id]=Math.min(OFFICER_HEALTH_RULES.max*HEALTH_UNITS,Math.round(health.values[id]*HEALTH_UNITS)+recovered)/HEALTH_UNITS;
    }
    health.asOfElapsedMs=target;
    return health;
  }
  function officerCombatFactor(state,id){
    const value=state.officerHealth?.values?.[id],current=typeof value==='number'&&Number.isFinite(value)?clamp(value,0,OFFICER_HEALTH_RULES.max):OFFICER_HEALTH_RULES.max;
    return OFFICER_HEALTH_RULES.minCombatFactor+(1-OFFICER_HEALTH_RULES.minCombatFactor)*current/OFFICER_HEALTH_RULES.max;
  }
  function officerHealthView(state,id,health,marchingIds){
    const current=health.values[id],marching=marchingIds.has(id);
    return{current,max:OFFICER_HEALTH_RULES.max,factor:officerCombatFactor({officerHealth:health},id),status:current===0?'exhausted':current<60?'tired':'healthy',recovering:current<OFFICER_HEALTH_RULES.max&&!marching&&state.realtime.running&&!state.gameOver,marching,recoveryPerMonth:OFFICER_HEALTH_RULES.recoveryPerMonth};
  }
  function maintenanceExternalAt(authority,elapsed){
    if(!authority||elapsed<authority.activatedElapsedMs||elapsed<authority.baseline.elapsedMs)return{vacant:0,trade:0,alliance:0};
    let lo=0,hi=authority.changes.length;
    while(lo<hi){const mid=Math.floor((lo+hi)/2);if(authority.changes[mid].elapsedMs<=elapsed)lo=mid+1;else hi=mid;}
    const current=lo?authority.changes[lo-1]:authority.baseline;
    return{vacant:current.vacant,trade:current.trade,alliance:current.alliance};
  }
  function maintenanceBoundaryAfter(authority,elapsed){
    if(!authority)return Infinity;
    if(authority.baseline.elapsedMs>elapsed)return authority.baseline.elapsedMs;
    let lo=0,hi=authority.changes.length;
    while(lo<hi){const mid=Math.floor((lo+hi)/2);if(authority.changes[mid].elapsedMs<=elapsed)lo=mid+1;else hi=mid;}
    return authority.changes[lo]?.elapsedMs??Infinity;
  }
  function normalizeMaintenanceAuthority(raw,campaignId){
    const bad=()=>{throw new Error('兵の維持費を計算する確定情報が正しくありません。');},obj=value=>value&&typeof value==='object'&&!Array.isArray(value),num=(value,max=MAX_TURN*60000+59999)=>Number.isSafeInteger(value)&&value>=0&&value<=max;
    if(!obj(raw)||raw.version!==1||raw.campaignId!==campaignId||!num(raw.activatedElapsedMs)||!num(raw.revision,Number.MAX_SAFE_INTEGER)||!num(raw.asOfElapsedMs)||raw.asOfElapsedMs<raw.activatedElapsedMs||raw.hasMore!==undefined&&typeof raw.hasMore!=='boolean'||!Array.isArray(raw.changes)||raw.changes.length>10000)bad();
    const snapshot=value=>{
      if(!obj(value)||!num(value.elapsedMs)||value.elapsedMs<raw.activatedElapsedMs||value.elapsedMs>raw.asOfElapsedMs||!['vacant','trade','alliance'].every(key=>num(value[key],1000000000000))||value.vacant+value.trade+value.alliance>1000000000000)bad();
      return{elapsedMs:value.elapsedMs,vacant:value.vacant,trade:value.trade,alliance:value.alliance};
    };
    const baseline=snapshot(raw.baseline),changes=raw.changes.map(snapshot);let previous=baseline.elapsedMs;
    for(const change of changes){if(change.elapsedMs<=previous)bad();previous=change.elapsedMs;}
    return{version:1,campaignId,activatedElapsedMs:raw.activatedElapsedMs,revision:raw.revision,asOfElapsedMs:raw.asOfElapsedMs,baseline,changes,...(raw.hasMore===true?{hasMore:true}:{})};
  }
  function normalizeUpkeepState(raw,turn){
    const bad=()=>{throw new Error('月次の兵維持費の記録が正しくありません。');},obj=value=>value&&typeof value==='object'&&!Array.isArray(value),num=value=>Number.isSafeInteger(value)&&value>=0;
    if(!num(turn)||turn>MAX_TURN)bad();
    // Older saves begin checking at their next monthly boundary. Loading them
    // never treats all earlier months as an unpaid troop adjustment.
    if(raw===undefined)return{version:1,settledTurn:turn,branchReductions:{}};
    if(!obj(raw)||raw.version!==1||!num(raw.settledTurn)||raw.settledTurn>turn||!obj(raw.branchReductions)||Object.entries(raw.branchReductions).some(([id,count])=>!Object.hasOwn(BRANCH_BY_ID,id)||!num(count)))bad();
    return{version:1,settledTurn:raw.settledTurn,branchReductions:{...raw.branchReductions}};
  }
  function normalizeRepairState(raw,turn){
    const bad=()=>{throw new Error('月次の拠点修復の記録が正しくありません。');},obj=value=>value&&typeof value==='object'&&!Array.isArray(value),num=value=>Number.isSafeInteger(value)&&value>=0;
    if(!num(turn)||turn>MAX_TURN)bad();
    if(raw===undefined)return{version:1,settledTurn:turn,spent:{wood:0,stone:0},credit:{wood:0,stone:0},recovered:{castles:{},branches:{}}};
    if(!obj(raw)||raw.version!==1||!num(raw.settledTurn)||raw.settledTurn>turn||!obj(raw.spent)||!obj(raw.credit)||!obj(raw.recovered)||!obj(raw.recovered.castles)||!obj(raw.recovered.branches))bad();
    for(const [group,known]of [['castles',CASTLE_BY_ID],['branches',BRANCH_BY_ID]])if(Object.entries(raw.recovered[group]).some(([id,value])=>!Object.hasOwn(known,id)||!num(value)))bad();
    const recovered=Object.values(raw.recovered.castles).concat(Object.values(raw.recovered.branches)).reduce((sum,value)=>sum+BigInt(value),0n);
    for(const key of ['wood','stone'])if(!num(raw.spent[key])||!num(raw.credit[key])||raw.credit[key]>=100||BigInt(raw.spent[key])*100n-recovered*BigInt(DURABILITY_RULES.repairCostPer100[key])!==BigInt(raw.credit[key]))bad();
    return{version:1,settledTurn:raw.settledTurn,spent:{wood:raw.spent.wood,stone:raw.spent.stone},credit:{wood:raw.credit.wood,stone:raw.credit.stone},recovered:{castles:{...raw.recovered.castles},branches:{...raw.recovered.branches}}};
  }
  // Existing garrisons below a battle's reserve keep their survivors. A
  // casualty floor may protect soldiers but cannot recruit replacements.
  const survivorsAfterLoss=(before,loss,reserve)=>before-Math.min(loss,Math.max(0,before-reserve));
  const BATTLE_COUNTER_MAX=10000000;
  const fail=message=>({ok:false,message});
  function governorBonusForCategory(category,officer){
    if(!officer)return 1;
    const specialty=(officer.skill==='farmer'&&category==='rice')||(officer.skill==='merchant'&&category==='gold')||(officer.skill==='engineer'&&['wood','stone','defense','research'].includes(category));
    return 1+(officer.politics||0)/400+(specialty?.1:officer.skill==='administrator'?.05:0);
  }
  const evaluationNumber=(value,max=Number.MAX_SAFE_INTEGER)=>typeof value==='number'&&Number.isFinite(value)?Math.max(0,Math.min(max,value)):0;
  function evaluationRank(score){
    const points=Math.floor(evaluationNumber(score,EVALUATION_MAX));
    return {...EVALUATION_RANKS.findLast(rank=>points>=rank.minScore)};
  }
  function evaluateState(state,options={}){
    // Callers pass their authorized, normalized current projection. This reader
    // never advances time, edits formations, exports a save, or trusts a supplied
    // evaluation/title. Public servers additionally project current roles/cycles.
    const s=state&&typeof state==='object'?state:{};
    const roster=Array.isArray(options.officers)?options.officers:root.SENGOKU_OFFICERS||[];
    const officerMap=new Map(roster.map(officer=>[officer.id,officer]));
    const owned=[...new Set(Array.isArray(s.officers)?s.officers:[])].filter(id=>officerMap.has(id));
    const ownedSet=new Set(owned),highestRanks=new Map();
    for(const key of Array.isArray(s.officerVariants)?s.officerVariants:[]){
      if(typeof key!=='string')continue;
      const at=key.lastIndexOf(':'),id=key.slice(0,at),rank=key.slice(at+1),index=RANKS.indexOf(rank);
      if(at<1||!ownedSet.has(id)||index<0)continue;
      highestRanks.set(id,Math.max(index,highestRanks.get(id)??-1));
    }
    const officers=new Map(owned.map(id=>{
      const base=officerMap.get(id),rankIndex=highestRanks.get(id)??Math.max(0,RANKS.indexOf(base.rank||base.rarity));
      const bonus=RANK_BONUSES[RANKS[rankIndex]];
      return [id,{...base,rankIndex,...Object.fromEntries(['lead','valor','intellect','politics'].map(stat=>[stat,evaluationNumber(evaluationNumber(base[stat],100)+bonus,100)]))}];
    }));
    const holdings=typeof s.clan==='string'&&s.clan?CASTLES.filter(c=>s.castles?.[c.id]?.owner===s.clan):[];
    const castleLevels=holdings.reduce((sum,c)=>sum+evaluationNumber(s.castles[c.id].level,c.id===STAFF_BASE_ID?128:c.id==='edo'?64:MAJOR_CITY_IDS.includes(c.id)?48:32),0);
    const buildingLevels=BUILDINGS.reduce((sum,b)=>sum+evaluationNumber(s.buildings?.[b.id],32),0);
    const rarityTotal=[...officers.values()].map(o=>o.rankIndex+1).sort((a,b)=>b-a).slice(0,30).reduce((sum,n)=>sum+n,0);
    const army=[...new Set(Array.isArray(s.army)?s.army:[])].filter(id=>officers.has(id)).slice(0,3);
    const armyAbility=army.reduce((sum,id)=>{const o=officers.get(id);return sum+o.lead+o.valor+o.intellect;},0);
    const assigned=new Set(army);let governorQuality=0;
    for(const building of BUILDINGS){
      const id=s.governors?.[building.id],officer=officers.get(id);
      if(!officer||assigned.has(id)||evaluationNumber(s.buildings?.[building.id],32)<1)continue;
      assigned.add(id);governorQuality+=Math.min(1,Math.max(0,(governorBonusForCategory(building.category,officer)-1)/.35));
    }
    const techLevels=TECHS.reduce((sum,t)=>sum+evaluationNumber(s.tech?.[t.id],t.max),0);
    const walkingSteps=evaluationNumber(s.walking?.localSteps,1000000)+evaluationNumber(s.walking?.serverSteps,1000000);
    const section=(id,name,value,maxScore,description)=>({id,name,score:Math.min(maxScore,Math.floor(Math.max(0,value)+1e-8)),maxScore,description});
    const breakdown=[
      section('territory','領国・城郭',Math.min(6000,holdings.length*600)+Math.min(14000,castleLevels*43.75),20000,'領有城1城につき600点（最大6,000点）と、完成した城郭Lv合計×43.75点（最大14,000点）。'),
      section('buildings','内政施設',buildingLevels/(BUILDINGS.length*32)*20000,20000,'天守を含む64施設の完成済みLv合計で評価。全施設Lv32で20,000点。建設予約は完成後に加算。'),
      section('officers','武将',Math.min(12000,owned.length*60)+rarityTotal*25,18000,'異なる武将1名につき60点（最大200名）と、上位30名の最高所有レア度を評価。D=1〜U=8として各25点。重複入手では増えません。'),
      section('formation','軍団・奉行',armyAbility/900*6000+governorQuality/BUILDINGS.length*6000,12000,'軍団3名の統率・武勇・知略で最大6,000点。奉行は政治力と施設への適性で最大6,000点。軍団との兼任・重複・未建築施設は数えません。'),
      section('research','研究',techLevels*250,10000,'8技術の研究済みLvを1段階につき250点で評価。全技術Lv5で10,000点。'),
      section('merit','戦功',evaluationNumber(s.prestige,20000)/2+evaluationNumber(s.stats?.wins,100)*50,15000,'威信2につき1点（最大10,000点）と、記録された合戦の勝利1回につき50点（最大5,000点）。'),
      section('walking','歩行',Math.min(1000000,walkingSteps)/200,5000,'記録された累計歩数200歩につき1点。100万歩で最大5,000点。')
    ];
    const score=breakdown.reduce((sum,item)=>sum+item.score,0),rank=evaluationRank(score),next=EVALUATION_RANKS[rank.index+1];
    return {version:1,score,maxScore:EVALUATION_MAX,rankId:rank.id,rankName:rank.name,rankIndex:rank.index,rankMinScore:rank.minScore,
      nextRank:next?{...next}:null,toNext:next?next.minScore-score:0,
      progressPercent:next?Math.floor((score-rank.minScore)/(next.minScore-rank.minScore)*100):100,breakdown};
  }
  // Rectangular Hungarian assignment. Rows and columns have a fixed order so
  // equal optima are deterministic; zero-weight columns represent vacancies.
  function maximumGovernorAssignment(weights){
    const rowCount=weights.length;if(!rowCount)return[];
    const columnCount=weights[0].length,u=Array(rowCount+1).fill(0),v=Array(columnCount+1).fill(0),rowAt=Array(columnCount+1).fill(0),previous=Array(columnCount+1).fill(0);
    for(let row=1;row<=rowCount;row++){
      rowAt[0]=row;let column=0;
      const minimum=Array(columnCount+1).fill(Infinity),used=Array(columnCount+1).fill(false);
      do{
        used[column]=true;const currentRow=rowAt[column];let delta=Infinity,next=0;
        for(let candidate=1;candidate<=columnCount;candidate++){
          if(used[candidate])continue;
          const reduced=-weights[currentRow-1][candidate-1]-u[currentRow]-v[candidate];
          if(reduced<minimum[candidate]){minimum[candidate]=reduced;previous[candidate]=column;}
          if(minimum[candidate]<delta){delta=minimum[candidate];next=candidate;}
        }
        for(let candidate=0;candidate<=columnCount;candidate++){
          if(used[candidate]){u[rowAt[candidate]]+=delta;v[candidate]-=delta;}
          else minimum[candidate]-=delta;
        }
        column=next;
      }while(rowAt[column]!==0);
      do{const next=previous[column];rowAt[column]=rowAt[next];column=next;}while(column!==0);
    }
    const assigned=Array(rowCount).fill(-1);
    for(let column=1;column<=columnCount;column++)if(rowAt[column])assigned[rowAt[column]-1]=column-1;
    return assigned;
  }
  const MAX_WALKING_STEPS=Math.floor(Number.MAX_SAFE_INTEGER/2);
  const walkingId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,90}$/.test(value);
  const newWalkingCampaign=()=>root.crypto?.randomUUID?.()||'walk_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2);
  function walkingState(raw,campaignId='legacy_v1'){
    if(raw===undefined)return{version:1,campaignId,localSteps:0,serverSteps:0,localSession:null};
    const num=n=>Number.isSafeInteger(n)&&n>=0&&n<=MAX_WALKING_STEPS;
    if(!raw||typeof raw!=='object'||Array.isArray(raw)||raw.version!==1||!walkingId(raw.campaignId)||!num(raw.localSteps)||!num(raw.serverSteps))throw new Error('歩行報酬の保存情報が正しくありません。');
    const session=raw.localSession;
    if(session!==null&&(!session||typeof session!=='object'||Array.isArray(session)||!walkingId(session.id)||!num(session.totalSteps)||session.totalSteps>raw.localSteps||typeof session.closed!=='boolean'))throw new Error('歩行計測の保存情報が正しくありません。');
    return{version:1,campaignId:raw.campaignId,localSteps:raw.localSteps,serverSteps:raw.serverSteps,localSession:session===null?null:{id:session.id,totalSteps:session.totalSteps,closed:session.closed}};
  }
  const STRATEGY_STYLES={conserve:{minWinChance:85,reserveTroops:1000,reserveRice:1000},balanced:{minWinChance:75,reserveTroops:500,reserveRice:500},rapid:{minWinChance:65,reserveTroops:300,reserveRice:300}};
  const STRATEGY_REGIONS=[...new Set(CASTLES.map(c=>c.region))];
  const STRATEGY_CLANS=[...new Set([...CASTLES.map(c=>c.clan),...CLANS.map(c=>c.name),ADMIN_ASSETS.clanName,'在地衆'])];
  function strategyCastles(text){
    const matches=[];for(const castle of CASTLES)for(const name of [castle.name,...(castle.name.endsWith('城')&&castle.name.length>2?[castle.name.slice(0,-1)]:[])]){let at=text.indexOf(name);while(at>=0){if(name===castle.name||text[at+name.length]!=='家')matches.push({castle,start:at,end:at+name.length});at=text.indexOf(name,at+name.length);}}
    matches.sort((a,b)=>(b.end-b.start)-(a.end-a.start)||a.start-b.start);const selected=[];for(const match of matches)if(!selected.some(other=>match.start<other.end&&match.end>other.start))selected.push(match);return [...new Map(selected.map(m=>[m.castle.id,m.castle])).values()];
  }
  const strategyNumber=value=>Number(String(value).replace(/万$/,'e4').replace(/千$/,'e3'));
  const strategyAnchor=game=>({campaignId:game.state.walking.campaignId,cycle:game.state.cycle?.index??Math.floor(game.state.turn/672),clan:game.state.clan,home:game.state.home,role:game.isAdmin?'admin':game.isStaff?'staff':'player',worldId:game.state.worldClock?.id||'local',startBattles:game.state.stats.battles});
  function validStrategy(policy){
    const n=(v,min,max)=>Number.isInteger(v)&&v>=min&&v<=max,a=policy?.anchor;
    return !!policy&&policy.version===1&&typeof policy.text==='string'&&policy.text.length<=1000&&Object.hasOwn(STRATEGY_STYLES,policy.style)&&['weakest','expand'].includes(policy.priority)&&typeof policy.hold==='boolean'
      &&n(policy.minWinChance,50,99)&&n(policy.reserveTroops,0,1000000)&&n(policy.reserveRice,0,999999999)&&n(policy.maxBattles,0,20)
      &&(policy.targetCastleId===null||!!CASTLE_BY_ID[policy.targetCastleId])&&(policy.targetRegion===null||STRATEGY_REGIONS.includes(policy.targetRegion))
      &&Array.isArray(policy.excludeCastleIds)&&policy.excludeCastleIds.length<=CASTLES.length&&policy.excludeCastleIds.every(id=>CASTLE_BY_ID[id])&&Array.isArray(policy.excludeRegions)&&policy.excludeRegions.length<=9&&policy.excludeRegions.every(id=>STRATEGY_REGIONS.includes(id))&&Array.isArray(policy.excludeClans)&&policy.excludeClans.length<=STRATEGY_CLANS.length&&policy.excludeClans.every(id=>STRATEGY_CLANS.includes(id))
      &&!!a&&walkingId(a.campaignId)&&n(a.cycle,0,Math.floor(MAX_TURN/672))&&n(a.startBattles,0,10000000)&&typeof a.clan==='string'&&!!CASTLE_BY_ID[a.home]&&['admin','staff','player'].includes(a.role)&&typeof a.worldId==='string'&&a.worldId.length<=100;
  }
  function roamingState(raw,campaignId){
    const invalid=()=>{throw new Error('野良兵戦の保存情報が正しくありません。');};
    if(raw===undefined)return{version:1,campaignId,sequence:0,wins:0,history:[]};
    const obj=v=>v&&typeof v==='object'&&!Array.isArray(v),num=(v,max=999999999)=>Number.isSafeInteger(v)&&v>=0&&v<=max;
    if(!obj(raw)||raw.version!==1||raw.campaignId!==campaignId||!num(raw.sequence,10000000)||!num(raw.wins,raw.sequence)||!Array.isArray(raw.history)||raw.history.length>20||raw.history.length>raw.sequence)invalid();
    const ids=new Set(),seqs=new Set(),history=raw.history.map(b=>{
      const encounter=ROAMING_ENCOUNTERS.find(e=>e.id===b?.encounterId),tactic=ROAMING_TACTICS.find(t=>t.id===b?.tactic);
      if(!obj(b)||!encounter||!tactic||!walkingId(b.requestId)||b.requestId.length>90||b.campaignId!==campaignId||!num(b.sequence,raw.sequence-1)||ids.has(b.requestId)||seqs.has(b.sequence)||typeof b.won!=='boolean')invalid();
      ids.add(b.requestId);seqs.add(b.sequence);
      for(const key of ['deployed','ourLost','survivors','enemyTroops','enemyLost','foodCost','commandBefore','commandAfter','prestigeGain','turn'])if(!num(b[key]))invalid();
      if(b.deployed<300||b.deployed>1000000||b.ourLost>b.deployed||b.survivors!==b.deployed-b.ourLost||b.enemyTroops<1||b.enemyLost>b.enemyTroops||b.commandCost!==1||b.commandBefore<1||b.commandBefore>7||b.commandAfter!==b.commandBefore-1||b.prestigeGain>encounter.prestige||!num(b.attackPower,1000000000000)||!num(b.enemyPower,1000000000000)||!obj(b.rewards)||Object.keys(b.rewards).length!==5||!GIFT_FIELDS.every(k=>num(b.rewards[k],encounter.rewards[k])&&(b.won||b.rewards[k]===0)))invalid();
      let placement={};
      if(b.unitId!==undefined||b.castleId!==undefined||b.deploymentRevision!==undefined){
        if(!walkingId(b.unitId)||b.unitId.length>90||!CASTLE_BY_ID[b.castleId]||!num(b.deploymentRevision,1000000000)||b.deploymentRevision<1||!new RegExp('^wild_'+b.deploymentRevision+'_'+b.castleId+'_(?:[0-9]|[12][0-9]|3[01])$').test(b.unitId))invalid();
        placement={unitId:b.unitId,castleId:b.castleId,deploymentRevision:b.deploymentRevision};
        if(b.respawnAt!==undefined){if(b.respawnAt!==null&&!num(b.respawnAt,Number.MAX_SAFE_INTEGER))invalid();placement.respawnAt=b.respawnAt;}
      }
      return {requestId:b.requestId,campaignId,sequence:b.sequence,encounterId:encounter.id,encounterName:encounter.name,tactic:tactic.id,tacticName:tactic.name,won:b.won,deployed:b.deployed,ourLost:b.ourLost,survivors:b.deployed-b.ourLost,enemyTroops:b.enemyTroops,enemyLost:b.enemyLost,attackPower:b.attackPower,enemyPower:b.enemyPower,foodCost:b.foodCost,commandCost:1,commandBefore:b.commandBefore,commandAfter:b.commandAfter,rewards:copy(b.rewards),prestigeGain:b.prestigeGain,turn:b.turn,...placement};
    });
    if(history.some((b,i)=>i&&b.sequence>=history[i-1].sequence))invalid();
    return{version:1,campaignId,sequence:raw.sequence,wins:raw.wins,history};
  }
  const covertError=(code,message)=>({ok:false,code,message});
  const covertHash=value=>{let hash=2166136261;for(const char of String(value))hash=Math.imul(hash^char.charCodeAt(0),16777619);return(hash>>>0).toString(36);};
  function covertTarget(raw){
    if(!raw||typeof raw!=='object'||!['castle','player'].includes(raw.kind)||!CASTLE_BY_ID[raw.castleId]||raw.kind==='player'&&!walkingId(raw.playerId))throw new Error('派遣先の保存情報が正しくありません。');
    return{kind:raw.kind,castleId:raw.castleId,name:CASTLE_BY_ID[raw.castleId].name,...(raw.kind==='player'?{playerId:raw.playerId,playerName:typeof raw.playerName==='string'?raw.playerName.slice(0,80):''}:{})};
  }
  function covertSnapshot(raw){
    const num=(value,max=999999999)=>Number.isSafeInteger(value)&&value>=0&&value<=max;
    if(!raw||typeof raw!=='object'||!['level','troops','garrison','wall','defensePower'].every(key=>num(raw[key],key==='defensePower'?1000000000000:999999999)))throw new Error('諜報の保存情報が正しくありません。');
    const out=Object.fromEntries(['level','troops','garrison','wall','defensePower'].map(key=>[key,raw[key]]));
    if(raw.resources!==undefined){if(!raw.resources||!RESOURCES.every(key=>num(raw.resources[key])))throw new Error('諜報資源が正しくありません。');out.resources=Object.fromEntries(RESOURCES.map(key=>[key,raw.resources[key]]));}
    if(raw.army!==undefined){if(!raw.army||!['count','lead','valor','intellect','politics'].every(key=>num(raw.army[key],key==='count'?3:1000000)))throw new Error('諜報軍団が正しくありません。');out.army=Object.fromEntries(['count','lead','valor','intellect','politics'].map(key=>[key,raw.army[key]]));}
    return out;
  }
  function normalizeCovertDispatch(raw,campaignId,sequence){
    const bad=()=>{throw new Error('派遣部隊の進軍情報が正しくありません。');},num=(v,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(v)&&v>=0&&v<=max;
    const phase=raw?.phase??'outbound',returning=phase==='returning';
    if(!raw||typeof raw!=='object'||raw.version!==1||raw.kind!=='covert'||!['outbound','returning'].includes(phase)||raw.authority!==undefined&&!['local','server'].includes(raw.authority)||!walkingId(raw.id)||!walkingId(raw.requestId)||raw.campaignId!==campaignId||!num(raw.sequence,sequence-1)||!num(raw.cycle,Math.floor(MAX_TURN/672))||typeof raw.clan!=='string'||!raw.clan||raw.clan.length>80||!MAJOR_CITY_IDS.includes(raw.sourceCastleId)||!num(raw.count,COVERT_RULES.maxCount)||raw.count<1||raw.troops!==raw.count||!['scout','station'].includes(raw.mode)||!num(raw.foodCost,ASSET_CAP)||raw.commandCost!==(returning?0:1)||returning&&raw.foodCost!==0||returning&&raw.mode==='station'&&!walkingId(raw.stationId)||!num(raw.departedElapsedMs)||!num(raw.arrivesElapsedMs)||!num(raw.battleCursor??0)||!raw.travel)bad();
    const target=covertTarget(raw.target),travel=travelRules()?.plan(returning?{sourceCastleId:target.castleId,targetCastleId:raw.sourceCastleId}:{sourceCastleId:raw.sourceCastleId,targetCastleId:target.castleId});
    if(!travel||raw.targetCastleId!==target.castleId||travel.durationMs!==raw.travel.durationMs||travel.distanceKm!==raw.travel.distanceKm||raw.arrivesElapsedMs!==raw.departedElapsedMs+travel.durationMs)bad();
    return{version:1,kind:'covert',phase,...(raw.authority?{authority:raw.authority}:{}),id:raw.id,requestId:raw.requestId,campaignId,sequence:raw.sequence,cycle:raw.cycle,clan:raw.clan,sourceCastleId:raw.sourceCastleId,targetCastleId:target.castleId,troops:raw.count,count:raw.count,mode:raw.mode,target,...(returning&&raw.mode==='station'?{stationId:raw.stationId}:{}),foodCost:raw.foodCost,commandCost:raw.commandCost,departedElapsedMs:raw.departedElapsedMs,arrivesElapsedMs:raw.arrivesElapsedMs,travel,battleCursor:raw.battleCursor??0};
  }
  function covertState(raw,campaignId){
    const invalid=()=>{throw new Error('派遣部隊の保存情報が正しくありません。');};
    const obj=value=>value&&typeof value==='object'&&!Array.isArray(value),num=(value,max=999999999)=>Number.isSafeInteger(value)&&value>=0&&value<=max;
    if(raw===undefined)return{version:1,campaignId,sequence:0,reserves:Object.fromEntries(MAJOR_CITY_IDS.map(id=>[id,0])),stations:[],dispatches:[],reports:[],incidents:[],history:[]};
    if(obj(raw)&&obj(raw.reserves)&&Object.hasOwn(raw.reserves,'sunpu')){
      raw=copy(raw);const old=raw.reserves.sunpu,current=raw.reserves[STAFF_BASE_ID]??0;
      if(!num(old,COVERT_RULES.maxCount)||!num(current,COVERT_RULES.maxCount)||old&&current)invalid();
      raw.reserves[STAFF_BASE_ID]=old||current;delete raw.reserves.sunpu;
      const move=value=>{if(!obj(value))return;if(value.sourceCastleId==='sunpu')value.sourceCastleId=STAFF_BASE_ID;if(value.report)move(value.report);};
      for(const key of ['stations','dispatches','reports','incidents','history'])if(Array.isArray(raw[key]))for(const value of raw[key])move(value);
    }
    if(!obj(raw)||raw.version!==1||raw.campaignId!==campaignId||!num(raw.sequence,10000000)||!obj(raw.reserves)||Object.keys(raw.reserves).some(id=>!MAJOR_CITY_IDS.includes(id)))invalid();
    const reserves=Object.fromEntries(MAJOR_CITY_IDS.map(id=>[id,raw.reserves[id]??0]));if(Object.values(reserves).some(value=>!num(value,COVERT_RULES.maxCount)))invalid();
    for(const [key,max] of [['stations',1024],['reports',50],['incidents',128],['history',40]])if(!Array.isArray(raw[key])||raw[key].length>max)invalid();
    if(raw.dispatches!==undefined&&(!Array.isArray(raw.dispatches)||raw.dispatches.length>COVERT_RULES.stationLimit))invalid();
    const dispatches=(raw.dispatches||[]).map(v=>normalizeCovertDispatch(v,campaignId,raw.sequence));
    const unique=(values,key)=>new Set(values.map(value=>value[key])).size===values.length;
    const stations=raw.stations.map(v=>{if(!obj(v)||!walkingId(v.id)||!MAJOR_CITY_IDS.includes(v.sourceCastleId)||!num(v.count,COVERT_RULES.maxCount)||v.count<1||!num(v.createdElapsedMs,Number.MAX_SAFE_INTEGER)||!num(v.battleCursor??0,Number.MAX_SAFE_INTEGER)||!num(v.deploymentSequence??0,raw.sequence-1))invalid();return{id:v.id,sourceCastleId:v.sourceCastleId,unitType:v.sourceCastleId==='edo'?'ninja':'ashigaru',unitName:v.sourceCastleId==='edo'?'忍者':'足軽',count:v.count,target:covertTarget(v.target),createdElapsedMs:v.createdElapsedMs,battleCursor:v.battleCursor??0,deploymentSequence:v.deploymentSequence??0};});
    if(MAJOR_CITY_IDS.some(id=>reserves[id]+stations.filter(v=>v.sourceCastleId===id).reduce((sum,v)=>sum+v.count,0)+dispatches.filter(v=>v.sourceCastleId===id).reduce((sum,v)=>sum+v.count,0)>COVERT_RULES.maxCount))invalid();
    const reports=raw.reports.map(v=>{if(!obj(v)||!walkingId(v.id)||!MAJOR_CITY_IDS.includes(v.sourceCastleId)||!num(v.observedElapsedMs,Number.MAX_SAFE_INTEGER))invalid();return{id:v.id,sourceCastleId:v.sourceCastleId,target:covertTarget(v.target),observedElapsedMs:v.observedElapsedMs,snapshot:covertSnapshot(v.snapshot)};});
    const incidents=raw.incidents.map(v=>{if(!obj(v)||!walkingId(v.id)||!MAJOR_CITY_IDS.includes(v.sourceCastleId)||!['cpu','field'].includes(v.kind)||!num(v.occurredElapsedMs,Number.MAX_SAFE_INTEGER)||typeof v.used!=='boolean'||!num(v.battleCursor??0,Number.MAX_SAFE_INTEGER)||!num(v.stationSequence??0,raw.sequence))invalid();return{id:v.id,sourceCastleId:v.sourceCastleId,kind:v.kind,occurredElapsedMs:v.occurredElapsedMs,used:v.used,battleCursor:v.battleCursor??0,stationSequence:v.stationSequence??0};});
    const history=raw.history.map(v=>{
      if(!obj(v)||!walkingId(v.requestId)||v.campaignId!==campaignId||!num(v.sequence,raw.sequence-1)||!['hire','dispatch','recall','retaliate'].includes(v.action))invalid();
      const result={requestId:v.requestId,campaignId,sequence:v.sequence,action:v.action};
      for(const key of ['sourceCastleId','stationId','incidentId','dispatchId'])if(v[key]!==undefined){if(!walkingId(v[key])||key==='sourceCastleId'&&!MAJOR_CITY_IDS.includes(v[key]))invalid();result[key]=v[key];}
      if(v.mode!==undefined){if(!['scout','station'].includes(v.mode))invalid();result.mode=v.mode;}
      if(v.target!==undefined)result.target=covertTarget(v.target);
      for(const key of ['count','foodCost','commandCost','goldCost','createdElapsedMs','resolvedElapsedMs'])if(v[key]!==undefined){if(!num(v[key],Number.MAX_SAFE_INTEGER))invalid();result[key]=v[key];}
      if(v.accepted!==undefined){if(typeof v.accepted!=='boolean')invalid();result.accepted=v.accepted;}
      if(v.status!==undefined){if(!['marching','resolved','cancelled'].includes(v.status))invalid();result.status=v.status;}
      if(v.march!==undefined){result.march=normalizeCovertDispatch(v.march,campaignId,raw.sequence);if(result.march.requestId!==v.requestId||result.march.id!==v.dispatchId)invalid();}
      if(v.report!==undefined){const r=v.report;if(!obj(r)||!walkingId(r.id)||!num(r.observedElapsedMs,Number.MAX_SAFE_INTEGER)||!MAJOR_CITY_IDS.includes(r.sourceCastleId))invalid();result.report={id:r.id,sourceCastleId:r.sourceCastleId,target:covertTarget(r.target),observedElapsedMs:r.observedElapsedMs,snapshot:covertSnapshot(r.snapshot)};}
      if(v.battle!==undefined){const b=v.battle;if(!obj(b)||typeof b.won!=='boolean'||b.captured!==false||!['deployed','ourLost','survivors','attackPower','defensePower'].every(key=>num(b[key],1000000000000))||b.ourLost>b.deployed||b.survivors!==b.deployed-b.ourLost||!obj(b.defenderLost)||!num(b.defenderLost.troops)||!num(b.defenderLost.garrison))invalid();result.battle={won:b.won,captured:false,deployed:b.deployed,ourLost:b.ourLost,survivors:b.survivors,attackPower:b.attackPower,defensePower:b.defensePower,defenderLost:{troops:b.defenderLost.troops,garrison:b.defenderLost.garrison},...(b.durability!==undefined?{durability:normalizeDurabilityBattle(b.durability)}:{})};}
      return result;
    });
    if(stations.length+dispatches.filter(v=>v.mode==='station'&&v.phase!=='returning').length>COVERT_RULES.stationLimit||!unique(dispatches,'id')||!unique(dispatches,'requestId')||!unique(dispatches,'sequence')||!unique(stations,'id')||!unique(reports,'id')||!unique(incidents,'id')||!unique(history,'requestId')||!unique(history,'sequence')||history.some((v,i)=>i&&v.sequence>=history[i-1].sequence))invalid();
    return{version:1,campaignId,sequence:raw.sequence,reserves,stations,dispatches,reports,incidents,history};
  }
  const MARCH_CONTEXT=new WeakMap();
  const travelRules=()=>root.SengokuTravel||(typeof require==='function'?require('./travel.js'):null);
  function normalizeMarch(raw,state){
    if(raw===undefined||raw===null)return null;
    const bad=()=>{throw new Error('進軍の保存情報が正しくありません。');},obj=v=>v&&typeof v==='object'&&!Array.isArray(v),num=(v,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(v)&&v>=0&&v<=max;
    if(!obj(raw)||raw.version!==1||!['local','server'].includes(raw.authority)||!walkingId(raw.id)||!['castle','branch','roaming','field','rally'].includes(raw.kind)||raw.authority==='local'&&!['castle','branch','roaming'].includes(raw.kind)||raw.campaignId!==state.walking.campaignId||!num(raw.cycle,Math.floor(MAX_TURN/672))||typeof raw.clan!=='string'||!raw.clan||raw.clan.length>80||!CASTLE_BY_ID[raw.sourceCastleId]||!CASTLE_BY_ID[raw.targetCastleId]||!num(raw.troops,ASSET_CAP)||raw.troops<1||typeof raw.tactic!=='string'||raw.tactic.length>30||!num(raw.foodCost,ASSET_CAP)||!num(raw.commandCost,1)||!num(raw.departedElapsedMs)||!num(raw.arrivesElapsedMs)||!obj(raw.travel))bad();
    const route=travelRules()?.plan({sourceCastleId:raw.sourceCastleId,targetCastleId:raw.targetCastleId,branchDirection:raw.travel.branchDirection,localOffsetKm:raw.travel.localOffsetKm});
    if(!route||route.durationMs!==raw.travel.durationMs||Math.abs(route.distanceKm-raw.travel.distanceKm)>.000001||raw.arrivesElapsedMs!==raw.departedElapsedMs+route.durationMs)bad();
    const out={version:1,authority:raw.authority,id:raw.id,kind:raw.kind,campaignId:raw.campaignId,cycle:raw.cycle,clan:raw.clan,sourceCastleId:raw.sourceCastleId,targetCastleId:raw.targetCastleId,troops:raw.troops,tactic:raw.tactic,foodCost:raw.foodCost,commandCost:raw.commandCost,departedElapsedMs:raw.departedElapsedMs,arrivesElapsedMs:raw.arrivesElapsedMs,travel:route};
    for(const key of ['targetPlayerId','targetBranchId'])if(raw[key]!==undefined){if(!walkingId(raw[key]))bad();out[key]=raw[key];}
    if(raw.army!==undefined){if(!Array.isArray(raw.army)||raw.army.length>3||new Set(raw.army).size!==raw.army.length||raw.army.some(id=>typeof id!=='string'||!state.officers.includes(id)))bad();out.army=[...raw.army];}
    if(raw.authority==='server')return out;
    const p=raw.profile;
    if(raw.commandCost!==1||!obj(p)||!num(p.attackPower,1000000000000000)||p.attackPower<1||!num(p.siege,5)||typeof p.medic!=='boolean'||!Array.isArray(p.army)||p.army.length>3||new Set(p.army).size!==p.army.length||p.army.some(id=>typeof id!=='string'||!state.officers.includes(id))||!num(raw.seed,4294967295)||!num(raw.commandBefore,7)||raw.commandBefore<1)bad();
    out.profile={attackPower:p.attackPower,siege:p.siege,medic:p.medic,army:[...p.army]};out.seed=raw.seed;out.commandBefore=raw.commandBefore;
    if(raw.kind==='roaming'){
      const o=raw.options;if(!obj(o)||!walkingId(o.requestId)||o.campaignId!==raw.campaignId||!num(o.sequence,10000000)||!ROAMING_ENCOUNTERS.some(e=>e.id===raw.encounterId)||!ROAMING_TACTICS.some(t=>t.id===raw.tactic))bad();
      out.encounterId=raw.encounterId;out.options={requestId:o.requestId,campaignId:o.campaignId,sequence:o.sequence};if(o.respawnSeconds!==undefined){if(!num(o.respawnSeconds,3600)||o.respawnSeconds<60)bad();out.options.respawnSeconds=o.respawnSeconds;}
      if(o.deploymentUnit!==undefined){if(!validRoamingUnit(o.deploymentUnit,raw.encounterId)||o.deploymentUnit.castleId!==raw.targetCastleId)bad();out.options.deploymentUnit=Object.fromEntries(['unitId','castleId','encounterId','deploymentRevision','slot','troops'].map(k=>[k,o.deploymentUnit[k]]));out.options.deploymentUnit.available=true;for(const key of ['unitId','castleId','deploymentRevision'])out.options[key]=out.options.deploymentUnit[key];}
    }else{
      if(!TACTICS.some(t=>t.id===raw.tactic)||typeof raw.targetOwner!=='string'||!raw.targetOwner||raw.targetOwner.length>80)bad();out.targetOwner=raw.targetOwner;
      if(raw.kind==='branch'&&(!BRANCH_BY_ID[raw.targetBranchId]||BRANCH_BY_ID[raw.targetBranchId].parentCastleId!==raw.targetCastleId))bad();
    }
    return out;
  }
  function normalizeMarchHistory(raw,state){
    if(raw===undefined)return[];
    const bad=()=>{throw new Error('進軍結果の保存情報が正しくありません。');},num=(v,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(v)&&v>=0&&v<=max;
    if(!Array.isArray(raw)||raw.length>20||new Set(raw.map(r=>r?.id)).size!==raw.length)bad();
    return raw.map(row=>{
      const march=normalizeMarch(row,state);if(!march||!['resolved','cancelled'].includes(row.status)||!num(row.resolvedElapsedMs)||typeof row.message!=='string'||row.message.length>2000)bad();
      const out={...march,status:row.status,resolvedElapsedMs:row.resolvedElapsedMs,message:row.message};
      if(row.status==='resolved'){
        const b=row.battle;if(!b||typeof b.won!=='boolean')bad();
        if(march.kind==='roaming'){try{out.battle=roamingState({version:1,campaignId:state.walking.campaignId,sequence:b.sequence+1,wins:b.won?1:0,history:[b]},state.walking.campaignId).history[0];}catch{bad();}}
        else{
          if(!CASTLE_BY_ID[b.castleId]||!['ourBefore','ourLost','enemyBefore','enemyLost','garrison','turn'].every(k=>num(b[k]))||b.ourLost>b.ourBefore||!Array.isArray(b.phases)||b.phases.length>10||b.phases.some(p=>!p||typeof p.title!=='string'||p.title.length>50||typeof p.text!=='string'||p.text.length>1000)||!b.rewards||!['gold','rice','magatama'].every(k=>num(b.rewards[k],ASSET_CAP))||b.capturedOfficer!==null&&b.capturedOfficer!==undefined&&!state.officers.includes(b.capturedOfficer))bad();
          out.battle={won:b.won,castleId:b.castleId,castleName:march.kind==='branch'?BRANCH_BY_ID[march.targetBranchId].name:CASTLE_BY_ID[b.castleId].name,ourBefore:b.ourBefore,ourLost:b.ourLost,enemyBefore:b.enemyBefore,enemyLost:b.enemyLost,phases:copy(b.phases),rewards:copy(b.rewards),capturedOfficer:b.capturedOfficer||null,garrison:b.garrison,tactic:march.tactic,turn:b.turn,...(b.durability!==undefined?{durability:normalizeDurabilityBattle(b.durability)}:{}),...(march.kind==='branch'?{branchId:march.targetBranchId,parentCastleId:b.castleId,captured:false}:{})};
        }
      }
      return out;
    });
  }
  class SengokuEngine {
    constructor(options={}) {
      ADMIN_ACCESS.set(this,options.isAdmin===true);STAFF_ACCESS.set(this,options.isStaff===true);COURT_ACCESS.set(this,options.isCourtEmperor===true&&options.isStaff===true&&options.isAdmin!==true);
      this.roster = options.officers || root.SENGOKU_OFFICERS || [];
      this.officerMap = Object.assign(Object.create(null),Object.fromEntries(this.roster.map(o=>[o.id,o])));
      if(!this.isAdmin&&!this.isStaff&&options.clan===ADMIN_ASSETS.clanName)throw new Error('德川家は運営・スタッフ専用です。通常の徳川家は選択できます。');
      const personal=CLANS.find(c=>c.name===options.clan)||(this.isStaff?CLANS.find(c=>c.name==='徳川家'):CLANS[0]);
      const clan = this.isAdmin?ADMIN_CLAN:this.isStaff?STAFF_CLAN:personal;
      if(this.isStaff)STAFF_ORIGIN.set(this,{clan:personal.name,home:personal.home,cycleHome:personal.home});
      if(!this.isAdmin&&!this.isStaff&&options.startCastle!==undefined&&(!CASTLES.some(c=>c.id===options.startCastle)||MAJOR_CITY_IDS.includes(options.startCastle)))throw new Error('開始する城を、大都市拠点（江戸・京都御所・二条・大坂・名古屋）以外の124城から一つ選んでください。');
      const home=this.isAdmin?ADMIN_ASSETS.castleId:this.isStaff?STAFF_BASE_ID:options.startCastle??clan.home;
      const difficulty=['easy','normal','hard'].includes(options.difficulty)?options.difficulty:'normal';
      const rosterClan=this.isAdmin||this.isStaff?'徳川家':clan.name,rosterLeader=this.isAdmin||this.isStaff?'徳川家康':clan.leader;
      const initial = this.roster.filter(o=>o.clan===rosterClan).sort((a,b)=>(b.name===rosterLeader?10000:b.lead+b.valor+b.politics)-(a.name===rosterLeader?10000:a.lead+a.valor+a.politics)).slice(0,4).map(o=>o.id);
      if (!initial.length) initial.push(...this.roster.slice(0,4).map(o=>o.id));
      const scale={easy:.8,normal:1,hard:1.2}[difficulty];
      this.state={
        version:2,clan:clan.name,home,turn:0,difficulty,cycle:{index:0,home,latestReward:null},upkeep:{version:1,settledTurn:0,branchReductions:{}},repair:normalizeRepairState(undefined,0),
        resources:{gold:difficulty==='easy'?4400:3200,rice:5400,wood:1800,stone:1200},
        troops:3400,troopTransferSequence:0,morale:80,prestige:0,command:3,magatama:GACHA.initial,captureRewards:[home],gachaHistory:[],
        realtime:{running:true,speed:1,elapsed:0,commandProgress:0,incomeRemainders:{gold:0,rice:0,wood:0,stone:0}},
        buildings:{...Object.fromEntries(EXTRA_FACILITIES.map(b=>[b.id,0])),keep:2,farm:2,market:2,lumber:1,quarry:1,barracks:2,wall:1,academy:1},
        jobs:[],branches:[],officers:initial,officerVariants:initial.map(id=>`${id}:${this._baseGrantRank(id)}`),army:initial.slice(0,3),governors:{},
        tech:Object.fromEntries(TECHS.map(t=>[t.id,0])),
        castles:Object.fromEntries(CASTLES.map(c=>[c.id,{owner:c.id===home?clan.name:c.clan===clan.name?'在地衆':c.clan,troops:c.id===home?1200:Math.round(c.initialTroops*scale),wall:c.id===home?1:c.wall,level:1}])),
        treaties:{},scouted:{},log:[],claimedQuests:[],giftReceipts:[],walking:walkingState(undefined,newWalkingCampaign()),seed:((options.seed??Date.now())>>>0)||123456789,
        lastBattle:null,march:null,marchHistory:[],stats:{battles:0,wins:0,upgrades:0,recruited:0,researches:0,gachaDraws:0,gachaDuplicates:0,castleUpgrades:0},won:false,gameOver:false
      };
      this.state.roaming=roamingState(undefined,this.state.walking.campaignId);
      this.state.covert=covertState(undefined,this.state.walking.campaignId);
      this.state.progress=normalizePlayerProgress(undefined,this.state);
      this.state.officerHealth=normalizeOfficerHealth(undefined,this.state);
      this.log(`${clan.name}、${CASTLE_BY_ID[home].name}より天下への歩みを始める。`,'story');
      this.log('共通の時刻は60秒で1か月進みます。1560〜1615年を周回し、占領拠点を精算して最初の本拠から再出発します。家臣・施設・資源は引き継ぎます。','guide');
      this.log(`門出の贈り物として勾玉${GACHA.initial.toLocaleString()}を受け取りました。武将招集に使えます。`,'gacha');
      if(this.isAdmin)this.restoreAdminAssets();
      if(options.staffBase&&this.isStaff)this.applyStaffBase(options.staffBase);
      if(options.branchAuthority!==undefined){const authority=this.setBranchAuthority(options.branchAuthority);if(!authority.ok)throw new Error(authority.message);}
      if(options.maintenanceAuthority!==undefined){const authority=this.setMaintenanceAuthority(options.maintenanceAuthority);if(!authority.ok)throw new Error(authority.message);}
    }
    relocateResidence(castleId,options={}){
      const previous=this.state,role=options?.role;
      if(this.isAdmin||this.isStaff)return{ok:false,code:'RESIDENCY_FIXED_HOME',message:'役職に定められた本拠からは移転できません。'};
      if(typeof castleId!=='string'||!Object.hasOwn(CASTLE_BY_ID,castleId)||MAJOR_CITY_IDS.includes(castleId))
        return{ok:false,code:'INVALID_CASTLE',message:'大都市拠点以外の124城から移転先を選んでください。'};
      // A defeated lord may already run the private realm from another holding,
      // while still registered in the former castle's public household.
      const registeredHome=options?.residencyCastleId??previous.home;
      if(registeredHome===castleId)return{ok:false,code:'RESIDENCY_SAME_CASTLE',message:'現在の本拠と異なる城を選んでください。'};
      if(role!=='lord'&&role!=='retainer')return{ok:false,code:'INVALID_RESIDENCY_ROLE',message:'移転先での立場を選んでください。'};

      // Build the new campaign independently. No partial reset can reach the
      // live model if validation fails, and queued actions keep their old scope.
      const fresh=new SengokuEngine({clan:previous.clan,difficulty:previous.difficulty,
        startCastle:castleId,officers:this.roster,seed:previous.seed});
      const next=fresh.state;
      const clock=options.worldClock??(previous.worldClock&&{...previous.worldClock,
        running:previous.realtime.running||previous.gameOver,speed:previous.realtime.speed});
      if(clock!==undefined&&clock!==null){
        if(previous.worldClock&&clock.id===previous.worldClock.id&&clock.elapsedMs<previous.worldClock.elapsedMs)
          return{ok:false,code:'INVALID_WORLD_CLOCK',message:'共通時刻を更新してから移転してください。'};
        const synced=fresh.applyWorldClock(clock);
        if(!synced.ok)return{ok:false,code:'INVALID_WORLD_CLOCK',message:synced.message};
      }
      for(const key of RESOURCES)next.resources[key]=Math.min(next.resources[key],previous.resources[key]);
      next.troops=Math.min(next.troops,previous.troops);
      const oldGarrison=previous.castles[previous.home];
      next.castles[castleId].troops=Math.min(next.castles[castleId].troops,oldGarrison.owner===previous.clan?oldGarrison.troops:0);
      next.magatama=Math.min(next.magatama,previous.magatama);

      // Keep exactly the player's collected paintings. A relocation must never
      // recruit the default household again or discard a previously earned rank.
      next.officers=[...previous.officers];
      next.officerVariants=[...previous.officerVariants];
      next.officerHealth=projectOfficerHealth(previous,officerHealthElapsed(previous));
      next.officerHealth.asOfElapsedMs=clamp(next.officerHealth.asOfElapsedMs+officerHealthElapsed(next)-officerHealthElapsed(previous),0,MAX_TURN*60000+59999);
      next.army=[...previous.army];
      next.progress.officers=copy(previous.progress.officers);
      next.progress.presets=copy(previous.progress.presets);

      next.giftReceipts=[...previous.giftReceipts];
      next.claimedQuests=[...previous.claimedQuests];
      next.captureRewards=[...new Set([...previous.captureRewards,castleId])];
      next.walking.localSteps=previous.walking.localSteps;
      next.walking.serverSteps=previous.walking.serverSteps;
      if(previous.walking.localSession)next.walking.localSession={...previous.walking.localSession,closed:true};

      next.log=[];
      const message=CASTLE_BY_ID[castleId].name+'へ本拠を移し、'+(role==='lord'?'領主':'家臣')+'として新たな戦役を始めました。';
      // A concurrent public admission can determine the office at commit time.
      // The private diary records the move, independent of the resulting seat.
      fresh.log(CASTLE_BY_ID[castleId].name+'へ本拠を移し、新たな戦役を始めました。','story');
      this.state=next;
      BRANCH_AUTHORITY.delete(this);BRANCH_PARENT_LOSSES.delete(this);HOME_DEFENSE_LOSSES.delete(this);
      return{ok:true,previousHome:previous.home,home:castleId,role,message};
    }
    get data(){return DATA;}
    evaluation(){return evaluateState(this.state,{officers:this.roster});}
    static evaluateState(state,options={}){return evaluateState(state,options);}
    static get ASSET_CAP(){return ASSET_CAP;}
    static normalizeAssets(state){return normalizeAssets(state);}
    static upgradeCostMultiplier(ownedCastleCount){return upgradeCostMultiplier(ownedCastleCount);}
    static scaleUpgradeCost(cost,ownedCastleCount){return scaleUpgradeCost(cost,ownedCastleCount);}
    static evaluationRank(score){return evaluationRank(score);}
    static get maxConstructionJobs(){return MAX_CONSTRUCTION_JOBS;}
    static normalizeBranchState(value,options={}){return normalizeBranchState(value,options);}
    static pruneBranchState(state,options={}){return pruneBranchState(state,options);}
    static branchFacilityCost(parentCastleId,facilityId,fromLevel){return branchFacilityCost(parentCastleId,facilityId,fromLevel);}
    static branchFacilityEffects(branch,elapsedMs=Infinity){return branchFacilityEffects(branch,elapsedMs);}
    static completeBranchFacility(branch,job,elapsedMs){return completeBranchFacility(branch,job,elapsedMs);}
    static branchUpgradeCost(parentCastleId,fromLevel){return branchUpgradeCost(parentCastleId,fromLevel);}
    static durabilityMax(options={}){return durabilityMax(options);}
    static normalizeDurability(raw){return normalizeDurability(raw);}
    static durabilityView(raw,options={}){return durabilityView(raw,options);}
    static durabilityAfterBattle(view,options={}){return durabilityAfterBattle(view,options);}
    static normalizeDurabilityBattle(raw){return normalizeDurabilityBattle(raw);}
    static publicEvaluation(state,options={}){
      const {version,score,maxScore,rankId,rankName,rankIndex}=evaluateState(state,options);
      return {version,score,maxScore,rankId,rankName,rankIndex};
    }
    get isAdmin(){return ADMIN_ACCESS.get(this)===true;}
    get isStaff(){return !this.isAdmin&&STAFF_ACCESS.get(this)===true;}
    // Only verified runtime metadata supplies court authority. It is never
    // inferred from a save, evaluation rank, title, clan, or imported flags.
    get isCourtEmperor(){return this.isStaff&&COURT_ACCESS.get(this)===true;}
    setCourtAccess({isCourtEmperor=false}={}){if(typeof isCourtEmperor!=='boolean'||isCourtEmperor&&!this.isStaff)return fail('現在の天皇の任命とスタッフ在任を確認してください。');const changed=this.isCourtEmperor!==isCourtEmperor;COURT_ACCESS.set(this,isCourtEmperor);return{ok:true,changed,isCourtEmperor:this.isCourtEmperor};}
    // A verified snapshot can contain newer branch outcomes than its campaign
    // clock. Keep their timeline outside saves so catch-up cannot apply those
    // outcomes to earlier CPU assaults, or trust an imported protection cursor.
    get branchResolvedElapsedMs(){const authority=BRANCH_AUTHORITY.get(this);if(authority?.campaignId===this.state.walking.campaignId)return authority.resolvedElapsedMs;BRANCH_AUTHORITY.delete(this);return 0;}
    setBranchAuthority(authority={}){const requested=authority?.resolvedElapsedMs??0;if(!authority||typeof authority!=='object'||Array.isArray(authority)||!Number.isSafeInteger(requested)||requested<0)return fail('支拠点の確定時刻を確認してください。');const current=this.branchResolvedElapsedMs,resolvedElapsedMs=requested===0?0:Math.max(current,requested),changed=current!==resolvedElapsedMs;BRANCH_AUTHORITY.set(this,{campaignId:this.state.walking.campaignId,resolvedElapsedMs});return{ok:true,changed,resolvedElapsedMs};}
    getMaintenanceAuthority(){const authority=MAINTENANCE_AUTHORITY.get(this);if(authority?.campaignId===this.state.walking.campaignId)return copy(authority);MAINTENANCE_AUTHORITY.delete(this);return null;}
    getMaintenanceStatus(){const authority=MAINTENANCE_AUTHORITY.get(this);if(authority?.campaignId===this.state.walking.campaignId)return{campaignId:authority.campaignId,revision:authority.revision,asOfElapsedMs:authority.asOfElapsedMs,...(authority.hasMore?{hasMore:true}:{})};MAINTENANCE_AUTHORITY.delete(this);return null;}
    setMaintenanceAuthority(raw){
      if(raw===null){const changed=MAINTENANCE_AUTHORITY.delete(this);return{ok:true,changed};}
      let authority;try{authority=normalizeMaintenanceAuthority(raw,this.state.walking.campaignId);}catch(error){return{...fail(error.message),code:'MAINTENANCE_AUTHORITY_INVALID'};}
      const current=this.getMaintenanceAuthority(),elapsed=elapsedMillis(this.state);
      if(authority.asOfElapsedMs<elapsed||authority.baseline.elapsedMs>Math.max(elapsed,authority.activatedElapsedMs))return{...fail('現在の進行に対応した兵の維持費情報を確認してください。'),code:'MAINTENANCE_AUTHORITY_INCOMPLETE'};
      if(current&&(authority.revision<current.revision||authority.asOfElapsedMs<current.asOfElapsedMs||authority.activatedElapsedMs!==current.activatedElapsedMs))return{...fail('兵の維持費情報が更新されています。最新の確定情報を確認してください。'),code:'MAINTENANCE_AUTHORITY_STALE'};
      if(current){
        // A newly issued timeline may start at a later saved checkpoint, but
        // its overlapping, already simulated interval must never be rewritten.
        const start=Math.max(current.baseline.elapsedMs,authority.baseline.elapsedMs),end=Math.min(elapsed,current.asOfElapsedMs),points=new Set([start,...current.changes.map(row=>row.elapsedMs),...authority.changes.map(row=>row.elapsedMs)]);
        for(const at of points)if(at>=start&&at<end&&JSON.stringify(maintenanceExternalAt(current,at))!==JSON.stringify(maintenanceExternalAt(authority,at)))return{...fail('確定済みの維持費の期間を変更することはできません。最新の保存を読み込んでください。'),code:'MAINTENANCE_AUTHORITY_REWRITE'};
      }
      const changed=JSON.stringify(current)!==JSON.stringify(authority);MAINTENANCE_AUTHORITY.set(this,authority);return{ok:true,changed,revision:authority.revision,asOfElapsedMs:authority.asOfElapsedMs};
    }
    _maintenanceExternalAt(elapsed){const authority=MAINTENANCE_AUTHORITY.get(this);return maintenanceExternalAt(authority?.campaignId===this.state.walking.campaignId?authority:null,elapsed);}
    takeBranchParentLosses(){const recorded=BRANCH_PARENT_LOSSES.get(this);BRANCH_PARENT_LOSSES.delete(this);return recorded?.campaignId===this.state.walking.campaignId?copy(recorded.losses):[];}
    _recordBranchParentLoss(parentCastleId){const s=this.state,branches=s.branches.filter(branch=>branch.parentCastleId===parentCastleId);if(!branches.length)return;const prior=BRANCH_PARENT_LOSSES.get(this),losses=prior?.campaignId===s.walking.campaignId?prior.losses:[],ids=new Set(branches.map(branch=>branch.id));losses.push({parentCastleId,branches:copy(branches),jobs:copy(s.jobs.filter(job=>job.kind==='branch'&&ids.has(job.id)))});BRANCH_PARENT_LOSSES.set(this,{campaignId:s.walking.campaignId,losses});}
    // Household succession consumes only losses produced by a trusted running
    // engine. These receipts are transient: save imports, logs, role projection
    // and territory resets cannot supply or replay them.
    takeHomeDefenseLosses(){const recorded=HOME_DEFENSE_LOSSES.get(this);HOME_DEFENSE_LOSSES.delete(this);return recorded?.campaignId===this.state.walking.campaignId?copy(recorded.losses):[];}
    _recordHomeDefenseLoss(castleId,sourceCastleId){
      const s=this.state;if(castleId!==s.home||s.castles[castleId]?.owner!==s.clan||!CASTLE_BY_ID[sourceCastleId]||s.castles[sourceCastleId]?.owner===s.clan||['edo',STAFF_BASE_ID].includes(castleId))return;
      const campaignId=s.walking.campaignId,cycle=Math.floor(s.turn/WORLD_CALENDAR.monthsPerCycle),id=`cpu-home:${campaignId}:${cycle}:${s.turn}:${sourceCastleId}:${castleId}`,prior=HOME_DEFENSE_LOSSES.get(this),losses=prior?.campaignId===campaignId?prior.losses:[];
      if(losses.length>=MAX_HOME_DEFENSE_LOSSES||losses.some(loss=>loss.id===id))return;
      losses.push({id,kind:'cpu',campaignId,cycle,turn:s.turn,occurredElapsedMs:Math.floor(s.turn*60000+s.realtime.elapsed*1000),castleId,sourceCastleId});
      HOME_DEFENSE_LOSSES.set(this,{campaignId,losses});
    }
    courtAttackPermission(sourceCastleId,targetCastleId){return sourceCastleId===STAFF_BASE_ID&&targetCastleId===ADMIN_ASSETS.castleId&&!this.isCourtEmperor?{ok:false,code:'COURT_EDO_ATTACK_REQUIRED',message:'京都御所から江戸城へ攻められるのは、太政大臣より上位の天皇だけです。現在の任命を確認してください。'}:{ok:true};}
    castleLevelLimit(id){return id===STAFF_BASE_ID?128:id==='edo'?64:MAJOR_CITY_IDS.includes(id)?48:32;}
    canOwnCastle(id){return Boolean(CASTLE_BY_ID[id])&&(id!==ADMIN_ASSETS.castleId||this.isAdmin)&&(id!==STAFF_BASE_ID||this.isStaff);}
    canOwnOfficerVariant(id,rank){return Boolean(this.baseOfficer(id))&&RANKS.includes(rank)&&(id!==ADMIN_ASSETS.officerId||rank!==ADMIN_ASSETS.rank||this.isAdmin);}
    _baseGrantRank(id){const o=this.baseOfficer(id),rank=o?.rank||o?.rarity;return id===ADMIN_ASSETS.officerId&&rank==='U'&&!this.isAdmin?'SSS':rank;}
    gachaPool(rank){return RANKS.includes(rank)?this.roster.filter(o=>this.canOwnOfficerVariant(o.id,rank)):[];}
    unificationTarget(){return CASTLES.filter(c=>this.canOwnCastle(c.id)).length;}
    getUnificationProof(){
      // Recompute from eligible holdings. Saved flags, battle names and event
      // results never establish campaign unification or change runtime roles.
      const s=this.state,targetCastleIds=CASTLES.filter(c=>this.canOwnCastle(c.id)).map(c=>c.id),ownedCastleIds=targetCastleIds.filter(id=>s.castles[id]?.owner===s.clan);
      return{version:1,campaignId:s.walking.campaignId,cycle:s.cycle?.index??Math.floor(s.turn/WORLD_CALENDAR.monthsPerCycle),clan:s.clan,home:s.home,role:this.isAdmin?'admin':this.isStaff?'staff':'player',worldId:s.worldClock?.id||'local',owned:ownedCastleIds.length,target:targetCastleIds.length,achieved:targetCastleIds.length>0&&ownedCastleIds.length===targetCastleIds.length,targetCastleIds,ownedCastleIds};
    }
    _pruneBranches(){return pruneBranchState(this.state,{isAdmin:this.isAdmin});}
    _updateCampaignOutcome(){const s=this.state;this._pruneBranches();s.won=CASTLES.filter(c=>this.canOwnCastle(c.id)).every(c=>s.castles[c.id].owner===s.clan);s.gameOver=!this.ownedCastles().length;if(s.gameOver)s.realtime.running=false;}
    _enforceAdminRestrictions(){
      if(this.isAdmin)return false;
      const s=this.state,forbidden=`${ADMIN_ASSETS.officerId}:U`,replacement=`${ADMIN_ASSETS.officerId}:SSS`;let changed=false;
      if(s.clan===ADMIN_ASSETS.clanName&&!this.isStaff){
        // Keep the exact holdings when an operator save is opened without an
        // authenticated role. Ordinary Tokugawa CPU castles are not holdings.
        for(const castle of Object.values(s.castles)){
          if(castle.owner===ADMIN_ASSETS.clanName)castle.owner='徳川家';
          else if(castle.owner==='徳川家')castle.owner='在地衆';
        }
        s.clan='徳川家';delete s.treaties[s.clan];changed=true;
      }
      if(s.officerVariants.includes(forbidden)){s.officerVariants=[...new Set(s.officerVariants.map(key=>key===forbidden?replacement:key))];changed=true;}
      for(const entry of s.gachaHistory)if(entry.officerId===ADMIN_ASSETS.officerId&&entry.rank==='U'){entry.rank='SSS';changed=true;}
      const edo=s.castles[ADMIN_ASSETS.castleId],wasHome=s.home===ADMIN_ASSETS.castleId,ownedEdo=edo.owner===s.clan;
      if(wasHome||ownedEdo){
        const canonical=this.isStaff?STAFF_BASE_ID:CLANS.find(c=>c.name===s.clan)?.home||'okazaki';
        const other=CASTLES.filter(c=>c.id!==ADMIN_ASSETS.castleId&&s.castles[c.id].owner===s.clan);
        const fallback=other.find(c=>c.id===canonical)?.id||other[0]?.id||canonical;
        // An older Edo-only campaign keeps its garrison and castle progress at
        // the clan's normal home; no other game progress is discarded.
        if(ownedEdo&&!other.length){s.castles[fallback]={...edo,owner:s.clan,level:Math.min(edo.level,this.castleLevelLimit(fallback))};if(!s.captureRewards.includes(fallback))s.captureRewards.push(fallback);}
        if(wasHome)s.home=fallback;if(s.cycle?.home==='edo')s.cycle.home=fallback;
        if(ownedEdo){const original=CASTLE_BY_ID[ADMIN_ASSETS.castleId];s.castles[ADMIN_ASSETS.castleId]={owner:original.clan===s.clan?'在地衆':original.clan,troops:original.initialTroops,wall:original.wall,level:1};}
        changed=true;
      }
      const jobs=s.jobs.filter(j=>j.kind!=='castle'||j.id!==ADMIN_ASSETS.castleId);
      if(jobs.length!==s.jobs.length){s.jobs=jobs;changed=true;}
      const rewards=s.captureRewards.filter(id=>id!==ADMIN_ASSETS.castleId);
      if(rewards.length!==s.captureRewards.length){s.captureRewards=rewards;changed=true;}
      if(changed)this.log('運営専用資産の条件を適用しました。德川家康Uは徳川家康SSSへ引き継ぎ、江戸城を本拠としていた場合は一般の城へ移しています。','system');
      this._updateCampaignOutcome();return changed;
    }
    _enforceAdminHome(){
      if(!this.isAdmin)return false;
      const s=this.state,id=ADMIN_ASSETS.castleId,edo=s.castles[id],oldHome=s.home,previous=s.castles[oldHome];let changed=false;
      if(s.clan!==ADMIN_ASSETS.clanName){
        const previousClan=s.clan;
        // Ownership is evaluated before changing the house. Never blanket-map
        // ordinary Tokugawa territory into the operator's exclusive house.
        for(const castle of Object.values(s.castles)){
          if(castle.owner===previousClan)castle.owner=ADMIN_ASSETS.clanName;
          else if(castle.owner===ADMIN_ASSETS.clanName)castle.owner='在地衆';
        }
        s.clan=ADMIN_ASSETS.clanName;delete s.treaties[s.clan];changed=true;
      }
      if(oldHome!==id){
        // Relocation preserves both the former holding and all campaign assets.
        // Copy progress once, without repeatedly replenishing the Edo garrison.
        for(const key of ['troops','wall','level'])edo[key]=Math.max(edo[key],previous[key]);edo.level=Math.min(edo.level,this.castleLevelLimit(id));
        s.home=id;if(s.cycle)s.cycle.home=id;changed=true;
        s.jobs=s.jobs.filter(job=>{
          if(job.kind!=='castle'||job.id!==id)return true;
          if(edo.level>=this.castleLevelLimit('edo'))return false;
          job.targetLevel=edo.level+1;return true;
        });
      }
      if(edo.owner!==s.clan){edo.owner=s.clan;changed=true;}
      if(!s.captureRewards.includes(id)){s.captureRewards.push(id);changed=true;}
      if(oldHome!==id)this.log('運営の本拠を江戸城に統一しました。旧本拠の領有と城郭の成長、資源・施設を引き継ぎます。','system');
      return changed;
    }
    _setAdminAccess(isAdmin,{restoreAssets=true}={}){
      if(typeof isAdmin!=='boolean')return fail('運営の認証状態が正しくありません。');
      const roleChanged=this.isAdmin!==isAdmin;ADMIN_ACCESS.set(this,isAdmin);
      const migrated=isAdmin?this._enforceAdminHome():this._enforceAdminRestrictions(),restored=isAdmin&&restoreAssets!==false?this.restoreAdminAssets():null;
      this._updateCampaignOutcome();return{ok:true,isAdmin:this.isAdmin,changed:roleChanged||migrated||Boolean(restored?.changed),migrated,restored,message:isAdmin?'運営の権限を反映しました。':'一般の領主として接続しました。'};
    }
    _renameCampaignClan(clan){const s=this.state;if(s.clan===clan)return false;const previous=s.clan;for(const castle of Object.values(s.castles)){if(castle.owner===previous)castle.owner=clan;else if(castle.owner===clan)castle.owner='在地衆';}s.clan=clan;delete s.treaties[clan];return true;}
    _clearStaffProjection(){const view=STAFF_VIEW.get(this),origin=STAFF_ORIGIN.get(this);if(view){this._rememberStaffPersonalProgress();this.state.buildings=copy(view.personalBuildings);this.state.castles[STAFF_BASE_ID].level=view.personalBaseLevel;this.state.castles[STAFF_BASE_ID].wall=view.personalBaseWall;}
      const personalClan=view?.personalClan||origin?.clan;if(CLANS.some(c=>c.name===personalClan))this._renameCampaignClan(personalClan);
      const home=view?.personalHome||origin?.home;if(CASTLE_BY_ID[home]&&!['edo',STAFF_BASE_ID].includes(home)){const s=this.state,previous=view?.personalHomeCastle||origin?.homeCastle||s.castles[home];if(s.castles[home].owner!==s.clan)s.castles[home]=copy(previous);else for(const key of ['troops','wall','level'])s.castles[home][key]=Math.max(s.castles[home][key],previous[key]);s.castles[home].level=Math.min(this.castleLevelLimit(home),s.castles[home].level);s.castles[home].owner=s.clan;s.home=home;s.cycle.home=view?.personalCycleHome||origin.cycleHome;}
      if(this.state.staffService)this.state.staffService={baseId:STAFF_BASE_ID};
      STAFF_VIEW.delete(this);STAFF_ORIGIN.delete(this);
    }
    _enforceStaffHome(){
      const s=this.state;if(this.isStaff){if(s.clan!==STAFF_CLAN.name){const personal=CLANS.find(c=>c.name===s.clan);if(personal)STAFF_ORIGIN.set(this,{clan:personal.name,home:['edo',STAFF_BASE_ID].includes(s.home)?personal.home:s.home,cycleHome:['edo',STAFF_BASE_ID].includes(s.cycle.home)?personal.home:s.cycle.home});}const renamed=this._renameCampaignClan(STAFF_CLAN.name),changed=renamed||s.home!==STAFF_BASE_ID||s.castles[STAFF_BASE_ID].owner!==s.clan;s.home=STAFF_BASE_ID;s.cycle.home=STAFF_BASE_ID;s.castles[STAFF_BASE_ID].owner=s.clan;s.gameOver=false;return changed;}
      const source=s.castles[STAFF_BASE_ID],owned=source.owner===s.clan,wasHome=s.home===STAFF_BASE_ID;if(!owned&&!wasHome){if(s.cycle.home===STAFF_BASE_ID)s.cycle.home=s.home;return false;}
      const canonical=CLANS.find(c=>c.name===s.clan)?.home||'kiyosu',choices=CASTLES.filter(c=>!['edo',STAFF_BASE_ID].includes(c.id)&&s.castles[c.id].owner===s.clan),fallback=choices.find(c=>c.id===canonical)?.id||choices[0]?.id||canonical;
      if(wasHome){const destination=s.castles[fallback];for(const key of ['troops','wall','level'])destination[key]=Math.max(destination[key],source[key]);destination.level=Math.min(this.castleLevelLimit(fallback),destination.level);destination.owner=s.clan;s.home=fallback;}
      s.jobs=s.jobs.flatMap(job=>job.kind==='castle'&&job.id===STAFF_BASE_ID?(wasHome&&s.castles[fallback].level<this.castleLevelLimit(fallback)?[{...job,id:fallback,targetLevel:s.castles[fallback].level+1}]:[]):[job]);
      if(wasHome){const seen=new Map(),other=[];for(const job of s.jobs){if(job.kind!=='castle'){other.push(job);continue;}if(job.id===fallback){if(s.castles[fallback].level>=this.castleLevelLimit(fallback))continue;job.targetLevel=s.castles[fallback].level+1;}if(!seen.has(job.id)||job.remainingSeconds<seen.get(job.id).remainingSeconds)seen.set(job.id,job);}s.jobs=[...other,...seen.values()];}
      const original=CASTLE_BY_ID[STAFF_BASE_ID];s.castles[STAFF_BASE_ID]={owner:original.clan===s.clan?'在地衆':original.clan,troops:original.initialTroops,wall:original.wall,level:1};
      s.captureRewards=s.captureRewards.filter(id=>id!==STAFF_BASE_ID);if(wasHome&&!s.captureRewards.includes(fallback))s.captureRewards.push(fallback);if(s.cycle.home===STAFF_BASE_ID)s.cycle.home=fallback;return true;
    }
    setRoleAccess({isAdmin=false,isStaff=false}={},options={}){
      if(typeof isAdmin!=='boolean'||typeof isStaff!=='boolean')return fail('役職の認証状態が正しくありません。');
      const changed=this.isAdmin!==isAdmin||this.isStaff!==(!isAdmin&&isStaff);if(changed){COURT_ACCESS.set(this,false);BRANCH_AUTHORITY.delete(this);BRANCH_PARENT_LOSSES.delete(this);}if(this.isStaff&&(!isStaff||isAdmin))this._clearStaffProjection();STAFF_ACCESS.set(this,isStaff);
      const result=this._setAdminAccess(isAdmin,options),migrated=this._enforceStaffHome();if(!this.isStaff){this.state.command=Math.min(this.state.command,this.commandMax());this.state.governors=Object.fromEntries(Object.entries(this.state.governors).filter(([id])=>this.state.buildings[id]>0));if(this.constructionChains()>this.constructionSlots())this.state.staffService={baseId:STAFF_BASE_ID};}this._updateCampaignOutcome();return {...result,isStaff:this.isStaff,changed:changed||result.changed||migrated};
    }
    setAdminAccess(isAdmin,options={}){if(typeof isAdmin!=='boolean')return fail('運営の認証状態が正しくありません。');return this.setRoleAccess({isAdmin,isStaff:STAFF_ACCESS.get(this)===true},options);}
    applyStaffBase(base){
      if(!this.isStaff)return fail('スタッフの共同拠点へ接続してください。');
      if(base&&typeof base==='object'){
        const legacy=base.id==='sunpu';
        if(legacy&&(base.castleLevel>64||base.initial?.castleLevel>64||[...(Array.isArray(base.history)?base.history:[]),...(Array.isArray(base.jobs)?base.jobs:[])].some(event=>event?.kind==='castle'&&(event.level??event.targetLevel)>64)))return fail('旧共同拠点の情報を確認できません。');
        base={...base,...(legacy?{id:STAFF_BASE_ID}:{}),...(base.personalBaseCastle===undefined&&base.personalSunpu!==undefined?{personalBaseCastle:base.personalSunpu}:{})};
        if(legacy){for(const key of ['history','jobs'])if(Array.isArray(base[key]))base[key]=base[key].map(item=>item?.kind==='castle'&&item.id==='sunpu'?{...item,id:STAFF_BASE_ID}:item);}
        delete base.personalSunpu;
      }
      if(['sunpu','nijo','osaka','nagoya'].includes(base?.personalHome)&&Number.isInteger(base?.personalHomeCastle?.level)&&base.personalHomeCastle.level>this.castleLevelLimit(base.personalHome)&&base.personalHomeCastle.level<=64)base={...base,personalHomeCastle:{...base.personalHomeCastle,level:this.castleLevelLimit(base.personalHome)}};
      const validBuildings=value=>value&&BUILDINGS.every(b=>Number.isInteger(value[b.id])&&value[b.id]>=(b.core?1:0)&&value[b.id]<=32);
      if(!base||base.id!==STAFF_BASE_ID||!Number.isSafeInteger(base.revision)||base.revision<0||!validBuildings(base.buildings)||!validBuildings(base.initial?.buildings)||!Number.isInteger(base.castleLevel)||base.castleLevel<1||base.castleLevel>128||!Number.isInteger(base.initial.castleLevel)||base.initial.castleLevel<1||base.initial.castleLevel>128||!Array.isArray(base.history)||base.history.length>2200||!Array.isArray(base.jobs)||base.jobs.length>192)return fail('共同拠点の情報を確認できません。');
      if(base.durability!==undefined)try{normalizeDurability(base.durability);}catch{return fail('共同拠点の耐久値を確認できません。');}
      const validCastle=(value,id)=>value&&typeof value==='object'&&!Array.isArray(value)&&[...CASTLES.map(c=>c.clan),...CLANS.map(c=>c.name),'在地衆',ADMIN_ASSETS.clanName].includes(value.owner)&&Number.isInteger(value.troops)&&value.troops>=0&&value.troops<=ASSET_CAP&&Number.isInteger(value.wall)&&value.wall>=1&&value.wall<=32&&Number.isInteger(value.level)&&value.level>=1&&value.level<=this.castleLevelLimit(id);
      if(base.personalClan!==undefined&&!CLANS.some(c=>c.name===base.personalClan)||base.clanSinceElapsedMs!==undefined&&(!Number.isSafeInteger(base.clanSinceElapsedMs)||base.clanSinceElapsedMs<0)||base.accessSinceElapsedMs!==undefined&&(!Number.isSafeInteger(base.accessSinceElapsedMs)||base.accessSinceElapsedMs<0)||base.personalHome!==undefined&&(!CASTLE_BY_ID[base.personalHome]||['edo',STAFF_BASE_ID].includes(base.personalHome))||base.personalCycleHome!==undefined&&(!CASTLE_BY_ID[base.personalCycleHome]||['edo',STAFF_BASE_ID].includes(base.personalCycleHome))||base.personalBaseCastle!==undefined&&!validCastle(base.personalBaseCastle,STAFF_BASE_ID)||base.personalHomeCastle!==undefined&&!validCastle(base.personalHomeCastle,base.personalHome))return fail('共同拠点へ就任する前の領国を確認できません。');
      const events=[...base.history,...base.jobs.map(job=>({...job,level:job.targetLevel,effectiveElapsedMs:job.completesElapsedMs}))];
      if(events.some(e=>!['building','castle'].includes(e.kind)||!(e.kind==='castle'?e.id===STAFF_BASE_ID:BUILDINGS.some(b=>b.id===e.id))||!Number.isInteger(e.level)||e.level<1||e.level>(e.kind==='castle'?128:32)||!Number.isSafeInteger(e.effectiveElapsedMs)||e.effectiveElapsedMs<0))return fail('共同普請の履歴を確認できません。');
      const chains=new Map(),jobIds=new Set();
      for(const job of base.jobs){const key=job.kind+':'+job.id,previous=chains.get(key),level=previous?.targetLevel??(job.kind==='castle'?base.castleLevel:base.buildings[job.id]);if(typeof job.jobId!=='string'||!job.jobId||jobIds.has(job.jobId)||!Number.isInteger(job.totalSeconds)||job.totalSeconds<60||job.totalSeconds>180||!Number.isSafeInteger(job.startedElapsedMs)||job.startedElapsedMs<0||job.completesElapsedMs-job.startedElapsedMs!==job.totalSeconds*1000||job.targetLevel!==level+1||previous&&(job.kind!=='building'||job.startedElapsedMs<previous.completesElapsedMs))return fail('共同普請の予約順を確認できません。');jobIds.add(job.jobId);chains.set(key,job);}
      if(chains.size>2+Math.floor(base.buildings.keep/8))return fail('共同普請の工事枠を確認できません。');
      const personalKey=value=>JSON.stringify([value.accessSinceElapsedMs,value.clanSinceElapsedMs,value.personalClan,value.personalHome,value.personalCycleHome,value.personalBaseCastle,value.personalHomeCastle]);
      let view=STAFF_VIEW.get(this);if(view&&base.revision<view.base.revision)return {ok:true,changed:false};
      if(view&&base.revision===view.base.revision&&personalKey(base)===personalKey(view.base)){
        // A participant's name/title can change without a construction revision.
        // Refresh only that display metadata, preserving every job and progress.
        const incoming=new Map(base.jobs.map(job=>[job.jobId,job.startedBy]));let changed=false;
        for(const job of view.base.jobs){const author=incoming.get(job.jobId);if(author?.id&&author.id===job.startedBy?.id&&JSON.stringify(author)!==JSON.stringify(job.startedBy)){job.startedBy=copy(author);changed=true;}}
        return {ok:true,changed,...(changed?{displayOnly:true}:{})};
      }
      if(!view){
        const personalHome=base.personalHome||STAFF_ORIGIN.get(this)?.home||this.state.home;
        // A staff export contains its private castle, not the shared projection.
        // Keep that validated snapshot across reloads: the appointment backup
        // may predate a legacy Kyoto upgrade and its still-running private job.
        const privateBase=this.state.staffService?.baseId===STAFF_BASE_ID?this.state.castles[STAFF_BASE_ID]:null;
        const personalBaseCastle=copy(base.personalBaseCastle||this.state.castles[STAFF_BASE_ID]);
        // Ownership and the pre-appointment garrison still come from the
        // verified backup; only private construction levels use the export.
        if(privateBase){personalBaseCastle.level=privateBase.level;personalBaseCastle.wall=privateBase.wall;}
        view={personalClan:base.personalClan||STAFF_ORIGIN.get(this)?.clan||'徳川家',personalBuildings:copy(this.state.buildings),personalBaseLevel:personalBaseCastle.level,personalBaseWall:personalBaseCastle.wall,personalBaseCastle:copy(personalBaseCastle),staffBaseTroops:this.state.castles[STAFF_BASE_ID].troops,personalHome,personalCycleHome:base.personalCycleHome||STAFF_ORIGIN.get(this)?.cycleHome||this.state.cycle.home,personalHomeCastle:copy(base.personalHomeCastle||STAFF_ORIGIN.get(this)?.homeCastle||this.state.castles[personalHome]),phase:null};
      }
      if(base.personalHome&&base.personalHome!==view.personalHome){view.personalHome=base.personalHome;view.personalHomeCastle=copy(base.personalHomeCastle||this.state.castles[base.personalHome]);}
      if(base.personalCycleHome)view.personalCycleHome=base.personalCycleHome;if(base.personalClan)view.personalClan=base.personalClan;STAFF_ORIGIN.set(this,{clan:view.personalClan,home:view.personalHome,cycleHome:view.personalCycleHome,homeCastle:copy(view.personalHomeCastle)});
      if(base.personalHomeCastle)for(const key of ['troops','wall','level'])view.personalHomeCastle[key]=Math.max(view.personalHomeCastle[key],base.personalHomeCastle[key]);
      view.base=copy(base);view.events=events.sort((a,b)=>a.effectiveElapsedMs-b.effectiveElapsedMs);STAFF_VIEW.set(this,view);this._projectStaffAt();return {ok:true,changed:true};
    }
    getStaffBase(){const view=this.isStaff?STAFF_VIEW.get(this):null;return view?copy(view.base):null;}
    // Keep this personal castle snapshot outside the shared projection. The
    // server persists it in the same transaction as a save or cycle settlement.
    _rememberStaffPersonalProgress(){const view=this.isStaff?STAFF_VIEW.get(this):null;if(!view||['edo',STAFF_BASE_ID].includes(view.personalHome))return;const current=this.state.castles[view.personalHome];if(current?.owner!==this.state.clan)return;for(const key of ['troops','wall','level'])view.personalHomeCastle[key]=Math.max(view.personalHomeCastle[key],current[key]);view.personalHomeCastle.level=Math.min(view.personalHomeCastle.level,this.castleLevelLimit(view.personalHome));view.personalHomeCastle.owner=this.state.clan;if(current.durability!==undefined)view.personalHomeCastle.durability=copy(current.durability);}
    getStaffPersonalProgress(){const view=this.isStaff?STAFF_VIEW.get(this):null;if(!view||['edo',STAFF_BASE_ID].includes(view.personalHome))return null;this._rememberStaffPersonalProgress();return {home:view.personalHome,castle:copy(view.personalHomeCastle)};}
    _projectStaffAt(elapsed=this.state.worldClock?.elapsedMs??this.state.turn*60000+this.state.realtime.elapsed*1000){
      const view=this.isStaff?STAFF_VIEW.get(this):null;if(!view)return;const s=this.state,base=view.base;
      if(elapsed<(base.accessSinceElapsedMs||0)){
        this._renameCampaignClan(view.personalClan);
        s.buildings=copy(view.personalBuildings);
        // Enter once: normal CPU home relocation and garrison growth must keep
        // progressing while an older save catches up to the appointment time.
        if(view.phase!=='personal'){if(view.phase==='shared')view.staffBaseTroops=s.castles[STAFF_BASE_ID].troops;s.home=view.personalHome;s.cycle.home=view.personalCycleHome;s.castles[STAFF_BASE_ID]=copy(view.personalBaseCastle);view.phase='personal';this._updateCampaignOutcome();}
        s.castles[STAFF_BASE_ID].level=view.personalBaseLevel;s.castles[STAFF_BASE_ID].wall=view.personalBaseWall;return;
      }
      if(view.phase==='personal'){view.personalBaseCastle=copy(s.castles[STAFF_BASE_ID]);view.personalBaseLevel=s.castles[STAFF_BASE_ID].level;view.personalBaseWall=s.castles[STAFF_BASE_ID].wall;s.castles[STAFF_BASE_ID].troops=view.staffBaseTroops;}
      s.buildings=copy(base.initial.buildings);let level=base.initial.castleLevel;
      for(const event of view.events){if(event.effectiveElapsedMs>elapsed)break;if(event.kind==='castle')level=event.level;else s.buildings[event.id]=event.level;}
      this._renameCampaignClan(elapsed<(base.clanSinceElapsedMs??base.accessSinceElapsedMs??0)?view.personalClan:STAFF_CLAN.name);s.home=STAFF_BASE_ID;s.cycle.home=STAFF_BASE_ID;s.castles[STAFF_BASE_ID].owner=s.clan;s.castles[STAFF_BASE_ID].level=level;s.castles[STAFF_BASE_ID].wall=s.buildings.wall;if(base.durability!==undefined)s.castles[STAFF_BASE_ID].durability=copy(base.durability);
      if(view.phase!=='shared'){view.phase='shared';this._updateCampaignOutcome();}
    }
    constructionJobs(){
      const view=this.isStaff?STAFF_VIEW.get(this):null,elapsed=this.state.worldClock?.elapsedMs??this.state.turn*60000+this.state.realtime.elapsed*1000,waits=new Map(),positions=new Map();
      const personal=this.state.jobs.map(job=>{
        const key=job.kind+':'+job.id,queuePosition=(positions.get(key)||0)+1;
        const promisedStart=job.kind==='branch'&&Number.isSafeInteger(job.completesElapsedMs)?
          (job.completesElapsedMs-elapsed)/1000-job.remainingSeconds:0;
        const startsInSeconds=Math.max(0,promisedStart,waits.get(key)||0),finishesInSeconds=startsInSeconds+job.remainingSeconds;
        positions.set(key,queuePosition);waits.set(key,finishesInSeconds);
        const facility=job.kind==='branch'&&job.facilityId?BRANCH_FACILITIES.find(def=>def.id===job.facilityId):null;
        return{...job,...(facility?{name:BRANCH_BY_ID[job.id].name+'・'+facility.name,branchName:BRANCH_BY_ID[job.id].name,facilityName:facility.name}:{}),
          shared:false,queued:startsInSeconds>0,startsInSeconds,finishesInSeconds,queuePosition};
      });
      const sharedPositions=new Map(),shared=(view?.base.jobs||[]).filter(job=>job.completesElapsedMs>elapsed).map(job=>{const key=job.kind+':'+job.id,startsInSeconds=Math.max(0,(job.startedElapsedMs-elapsed)/1000),remainingSeconds=Math.min(job.totalSeconds,(job.completesElapsedMs-elapsed)/1000),queuePosition=(sharedPositions.get(key)||0)+1;sharedPositions.set(key,queuePosition);return{...job,shared:true,queued:startsInSeconds>0,startsInSeconds,finishesInSeconds:startsInSeconds+remainingSeconds,queuePosition,remainingSeconds,remaining:Math.ceil((remainingSeconds-1e-8)/60),total:job.totalSeconds/60};});
      return [...personal,...shared];
    }
    restoreAdminAssets(){
      if(!this.isAdmin)return fail('運営として認証された領主だけが専用資産を復元できます。');
      const homeChanged=this._enforceAdminHome(),acquired=this._grantOfficerVariant(ADMIN_ASSETS.officerId,ADMIN_ASSETS.rank),changed=homeChanged||Boolean(acquired?.isNew);
      if(changed)this.log('運営専用の德川家康Uと、江戸城の固定本拠を反映しました。','system');
      this._updateCampaignOutcome();return{ok:true,changed,officerId:ADMIN_ASSETS.officerId,rank:ADMIN_ASSETS.rank,castleGranted:true,message:changed?'運営専用資産を復元しました。':'運営専用資産はすでに反映されています。'};
    }
    selectAdminCastle(id=ADMIN_ASSETS.castleId){
      if(!this.isAdmin)return fail('江戸城は運営として認証された領主の固定本拠です。');
      if(id!==ADMIN_ASSETS.castleId)return fail('運営の本拠は江戸城に固定されています。');
      const restored=this.restoreAdminAssets();
      return{ok:true,changed:restored.changed,home:id,message:'運営の本拠は江戸城です。'};
    }
    baseOfficer(id){return this.officerMap[id]||null;}
    ownsVariant(id,rank){return this.canOwnOfficerVariant(id,rank)&&this.state.officerVariants.includes(`${id}:${rank}`);}
    ownedRanks(id){return RANKS.filter(rank=>this.ownsVariant(id,rank));}
    highestOwnedRank(id){for(let index=RANKS.length-1;index>=0;index--)if(this.ownsVariant(id,RANKS[index]))return RANKS[index];return null;}
    collection(){return{officers:this.state.officers.length,variants:this.state.officerVariants.filter(key=>{const [id,rank]=key.split(':');return this.canOwnOfficerVariant(id,rank);}).length,totalVariants:RANKS.reduce((sum,rank)=>sum+this.gachaPool(rank).length,0)};}
    _officerView(base,chosen,variantOwned){
      if(!base||!RANKS.includes(chosen))return null;
      const rankBonus=RANK_BONUSES[chosen],baseStats=Object.fromEntries(['lead','valor','intellect','politics'].map(k=>[k,base[k]]));
      const exclusive=base.id===ADMIN_ASSETS.officerId&&chosen==='U';
      return{...base,name:exclusive?'德川家康':base.name,clan:exclusive?ADMIN_ASSETS.clanName:base.clan,baseRank:base.rank||base.rarity,rank:chosen,rarity:chosen,rankBonus,baseStats,...Object.fromEntries(Object.entries(baseStats).map(([k,v])=>[k,clamp(v+rankBonus,0,100)])),variantOwned};
    }
    officer(id,rank){
      const base=this.baseOfficer(id);if(!base)return null;
      const highest=rank===undefined?this.highestOwnedRank(id):null,chosen=rank===undefined?highest||this._baseGrantRank(id):rank;
      return this._officerView(base,chosen,rank===undefined?Boolean(highest):this.ownsVariant(id,chosen));
    }
    officerViews(ids,rank){
      if(!ids.length)return[];
      // A fresh index belongs only to this synchronous read. Imports, direct
      // state edits, new variants and role changes are visible on the next call.
      const variants=new Set(this.state.officerVariants);
      return ids.map(id=>{
        const base=this.baseOfficer(id);if(!base)return null;
        let chosen=rank;
        if(chosen===undefined){for(let index=RANKS.length-1;index>=0;index--){const candidate=RANKS[index];if(this.canOwnOfficerVariant(id,candidate)&&variants.has(`${id}:${candidate}`)){chosen=candidate;break;}}chosen=chosen||this._baseGrantRank(id);}
        return this._officerView(base,chosen,this.canOwnOfficerVariant(id,chosen)&&variants.has(`${id}:${chosen}`));
      });
    }
    officerHealth(id){
      const s=this.state;if(!s.officers.includes(id))return null;
      return officerHealthView(s,id,projectOfficerHealth(s),new Set(officerMarchArmy(s)));
    }
    armyHealth(ids=this.state.army){
      const s=this.state,health=projectOfficerHealth(s),owned=new Set(s.officers),marchingIds=new Set(officerMarchArmy(s));
      const officers=[...new Set(ids)].filter(id=>owned.has(id)).map(id=>({id,...officerHealthView(s,id,health,marchingIds)})),count=officers.length;
      return{officers,current:count?officers.reduce((sum,v)=>sum+v.current,0)/count:OFFICER_HEALTH_RULES.max,max:OFFICER_HEALTH_RULES.max,factor:count?officers.reduce((sum,v)=>sum+v.factor,0)/count:1,recovering:officers.some(v=>v.recovering),marching:officers.some(v=>v.marching),recoveryPerMonth:OFFICER_HEALTH_RULES.recoveryPerMonth};
    }
    _grantOfficerVariant(id,rank){
      if(!this.canOwnOfficerVariant(id,rank))return null;
      const previous=this.highestOwnedRank(id),isNewOfficer=!this.state.officers.includes(id),isNew=!this.ownsVariant(id,rank);
      if(isNewOfficer){this.state.officers.push(id);this.state.stats.recruited++;if(!this.state.officerHealth)this.state.officerHealth=normalizeOfficerHealth(undefined,this.state);this.state.officerHealth.values[id]=OFFICER_HEALTH_RULES.max;}
      if(isNew)this.state.officerVariants.push(`${id}:${rank}`);
      return{isNew,isNewOfficer,upgraded:isNew&&!isNewOfficer&&RANKS.indexOf(rank)>RANKS.indexOf(previous)};
    }
    _castleRecoveryMode(id){return id!==STAFF_BASE_ID&&this.canOwnCastle(id)&&this.state.castles[id]?.owner===this.state.clan?'paid':'free';}
    _branchRecoveryMode(row){return this._castleRecoveryMode(row.parentCastleId);}
    castle(id){const c=CASTLE_BY_ID[id],record=this.state.castles[id];return c?{...c,...record,durability:durabilityView(record.durability,{castleId:id,level:record.level,wall:record.wall,elapsedMs:elapsedMillis(this.state),recoveryMode:this._castleRecoveryMode(id)})}:null;}
    _anchorCastleDurability(id,elapsedMs=elapsedMillis(this.state)){
      const row=this.state.castles[id];if(!row?.durability)return;
      const view=durabilityView(row.durability,{castleId:id,level:row.level,wall:row.wall,elapsedMs,recoveryMode:this._castleRecoveryMode(id)});row.durability=normalizeDurability(view);
    }
    _damageCastleDurability(id,{won=false,ratio=1,captured=false,before}={}){
      const row=this.state.castles[id],view=before||this.castle(id)?.durability;if(!row||!view)return null;
      const result=durabilityAfterBattle(view,{won,ratio,captured,elapsedMs:elapsedMillis(this.state)});
      if(captured){result.max=durabilityMax({castleId:id,level:row.level,wall:row.wall});result.after=Math.round(result.max*DURABILITY_RULES.captureFraction);result.record={...result.record,current:result.after,max:result.max};}
      row.durability=result.record;this._rememberStaffPersonalProgress();return result;
    }
    _anchorBranchDurability(id,elapsedMs=elapsedMillis(this.state)){
      const row=this.state.branches.find(branch=>branch.id===id);if(!row?.durability)return;
      row.durability=normalizeDurability(durabilityView(row.durability,{castleId:row.parentCastleId,level:row.level,branch:true,fallen:row.fallen||row.retreating,elapsedMs,recoveryMode:this._branchRecoveryMode(row)}));
    }
    _damageBranchDurability(id,options={}){
      const row=this.state.branches.find(branch=>branch.id===id),view=this.branch(id)?.durability;if(!row||!view)return null;
      const result=durabilityAfterBattle(view,{...options,captured:false,elapsedMs:elapsedMillis(this.state)});row.durability=result.record;return result;
    }
    branch(id){
      const site=BRANCH_BY_ID[id],record=this.state.branches.find(row=>row.id===id);
      if(!site||!record)return null;
      const jobs=this.constructionJobs().filter(job=>job.kind==='branch'&&job.id===id);
      return {...site,...copy(record),durability:durabilityView(record.durability,{castleId:record.parentCastleId,level:record.level,branch:true,fallen:record.fallen||record.retreating,elapsedMs:elapsedMillis(this.state),recoveryMode:this._branchRecoveryMode(record)}),facilities:copy(record.facilities||{}),job:jobs[0]||null,jobs};
    }
    _repairTargets(elapsedMs){
      const targets=[],add=(kind,id,row,options)=>{
        if(!row.durability||row.durability.updatedElapsedMs>elapsedMs)return;
        const view=durabilityView(row.durability,{...options,elapsedMs,recoveryMode:'paid'});
        if(view.current<view.max)targets.push({kind,id,view,requestedHP:Math.min(view.repairPendingHP,view.recoveryPerMonth)});
      };
      for(const castle of CASTLES){const row=this.state.castles[castle.id];if(this._castleRecoveryMode(castle.id)==='paid')add('castle',castle.id,row,{castleId:castle.id,level:row.level,wall:row.wall});}
      for(const row of this.state.branches)if(row.level>0&&!row.fallen&&!row.retreating&&this._branchRecoveryMode(row)==='paid')add('branch',row.id,row,{castleId:row.parentCastleId,level:row.level,branch:true});
      return targets.sort((a,b)=>(a.kind+':'+a.id)<(b.kind+':'+b.id)?-1:1);
    }
    repairQuote({elapsedMs=(this.state.turn+1)*60000,resources=this.state.resources}={}){
      const at=Math.max(0,Math.round(Number(elapsedMs)||0)),repair=this.state.repair,targets=this._repairTargets(at),requestedHP=targets.reduce((sum,row)=>sum+row.requestedHP,0);
      const affordableHP=Math.min(...['wood','stone'].map(key=>Math.floor((clamp(Math.floor(Number(resources[key])||0),0,ASSET_CAP)*100+repair.credit[key])/DURABILITY_RULES.repairCostPer100[key]))),repairedHP=Math.min(requestedHP,affordableHP);
      const costFor=hp=>Object.fromEntries(RESOURCES.map(key=>[key,key==='wood'||key==='stone'?Math.max(0,Math.ceil((hp*DURABILITY_RULES.repairCostPer100[key]-repair.credit[key])/100)):0]));
      const allocations=targets.map(row=>({...row,repairedHP:requestedHP?Math.floor(row.requestedHP*repairedHP/requestedHP):0}));
      let remaining=repairedHP-allocations.reduce((sum,row)=>sum+row.repairedHP,0);
      // Share scarce materials proportionally; exact integer remainders and
      // stable identifiers keep saves and different iteration orders identical.
      const ranked=requestedHP?[...allocations].sort((a,b)=>(b.requestedHP*repairedHP%requestedHP)-(a.requestedHP*repairedHP%requestedHP)||((a.kind+':'+a.id)<(b.kind+':'+b.id)?-1:1)):[];
      for(const row of ranked){if(!remaining)break;if(row.repairedHP<row.requestedHP){row.repairedHP++;remaining--;}}
      const cost=costFor(repairedHP),credit=Object.fromEntries(['wood','stone'].map(key=>[key,repair.credit[key]+cost[key]*100-repairedHP*DURABILITY_RULES.repairCostPer100[key]]));
      return{elapsedMs:at,requestedHP,repairedHP,limited:repairedHP<requestedHP,cost,requiredCost:costFor(requestedHP),credit,allocations:allocations.map(({kind,id,view,requestedHP,repairedHP})=>({kind,id,current:view.current,max:view.max,requestedHP,repairedHP,after:view.current+repairedHP,record:{version:1,current:view.current+repairedHP,max:view.max,updatedElapsedMs:at,repairPendingHP:0,repairRemainder:repairedHP===requestedHP&&view.current+repairedHP<view.max?view.repairRemainder:0}}))};
    }
    settleMonthlyRepairs(){
      const s=this.state,repair=s.repair;
      if(repair.settledTurn>=s.turn)return{ok:true,changed:false,repairedHP:0,cost:{gold:0,rice:0,wood:0,stone:0},allocations:[],message:''};
      const quote=this.repairQuote({elapsedMs:s.turn*60000});
      for(const allocation of quote.allocations){const row=allocation.kind==='castle'?s.castles[allocation.id]:s.branches.find(row=>row.id===allocation.id);row.durability={...allocation.record};if(allocation.repairedHP){const recovered=repair.recovered[allocation.kind==='castle'?'castles':'branches'];recovered[allocation.id]=(recovered[allocation.id]||0)+allocation.repairedHP;}}
      for(const key of ['wood','stone']){s.resources[key]-=quote.cost[key];repair.spent[key]+=quote.cost[key];repair.credit[key]=quote.credit[key];}
      repair.settledTurn=s.turn;this._rememberStaffPersonalProgress();
      const message=quote.repairedHP?`月替わりの修復で耐久を${quote.repairedHP.toLocaleString()}回復し、木材${quote.cost.wood.toLocaleString()}・石材${quote.cost.stone.toLocaleString()}を使用しました。${quote.limited?'資材に合わせて修復量を調整しました。':''}`:'';
      return{ok:true,changed:quote.repairedHP>0,...quote,message};
    }
    _migrateLegacyRepair(){
      const at=elapsedMillis(this.state),anchor=(row,options)=>{if(row?.durability)row.durability={...normalizeDurability(durabilityView(row.durability,{...options,elapsedMs:at,recoveryMode:'free'})),repairPendingHP:0,repairRemainder:0};};
      for(const castle of CASTLES){const row=this.state.castles[castle.id];if(this._castleRecoveryMode(castle.id)==='paid')anchor(row,{castleId:castle.id,level:row.level,wall:row.wall});}
      for(const row of this.state.branches)if(this._branchRecoveryMode(row)==='paid')anchor(row,{castleId:row.parentCastleId,level:row.level,branch:true,fallen:row.fallen||row.retreating});
      this._rememberStaffPersonalProgress();
    }
    activeBranches(parentCastleId){return this.state.branches.filter(row=>row.parentCastleId===parentCastleId&&row.level>0&&!row.fallen&&!row.retreating).map(row=>this.branch(row.id));}
    parentAttackPermission(parentCastleId){const branches=this.activeBranches(parentCastleId);return branches.length?{ok:false,code:'BRANCHES_REQUIRED',message:'大都市拠点へ攻めるには、残っている支拠点をすべて先に陥落させてください。',branchIds:branches.map(row=>row.id)}:{ok:true,branchIds:[]};}
    branchDefense(id,tactic='balanced',siege=0){const branch=this.branch(id),parent=branch&&this.castle(branch.parentCastleId);if(!branch||branch.level<1||branch.retreating||!parent)return null;const baselineTroops=Math.max(200,Math.floor(parent.troops*.25)),stationedTroops=branch.stationedTroops||0,force=baselineTroops+stationedTroops,wallFactor=Math.max(.2,1-(Number(siege)||0)*.12)*(tactic==='siege'?.5:1),facilities=branchFacilityEffects(branch,this.state?this.state.turn*60000+this.state.realtime.elapsed*1000:Infinity),condition=durabilityView(branch.durability,{castleId:branch.parentCastleId,level:branch.level,branch:true,fallen:branch.fallen||branch.retreating,elapsedMs:this.state?elapsedMillis(this.state):branch.durability?.updatedElapsedMs||0,recoveryMode:this._branchRecoveryMode(branch)}).fortificationFactor,facilityMultiplier=1+(facilities.defense+facilities.siegeDefense*wallFactor)*condition,power=Math.max(1,Math.round((force+200)*(1+branch.level*.08*condition)*(1+parent.wall*.03*wallFactor*condition)*facilityMultiplier));return{power,force,baselineTroops,stationedTroops,level:branch.level,parentCastleId:branch.parentCastleId,facilityMultiplier};}
    _fallBranch(id){const branch=this.state.branches.find(row=>row.id===id);if(!branch||branch.level<1||branch.fallen)return false;this._damageBranchDurability(id,{won:true});branch.fallen=true;this.state.jobs=this.state.jobs.filter(job=>job.kind!=='branch'||job.id!==id);return true;}
    branchStatus(parentCastleId){
      const rule=BRANCH_RULES.parents.find(parent=>parent.id===parentCastleId),parent=this.castle(parentCastleId),available=!!rule&&parent?.owner===this.state.clan&&(parentCastleId!=='edo'||this.isAdmin),branches=rule?this.state.branches.filter(row=>row.parentCastleId===parentCastleId).map(row=>this.branch(row.id)):[],reason=!rule?'この拠点には支拠点を設置できません。':parentCastleId==='edo'&&!this.isAdmin?'江戸城の支拠点は運営の権限が必要です。':parent?.owner!==this.state.clan?'親拠点を領有すると支拠点を設置できます。':'';
      return{parentCastleId,parentName:parent?.name||'',available,maxBranches:rule?.maxBranches||0,maxLevel:rule?.maxLevel||0,facilitySlots:rule?.facilitySlots||0,branches,directions:BRANCH_RULES.directions.map(direction=>({...direction,available:available&&branches.length<rule.maxBranches&&!branches.some(row=>row.direction===direction.id)})),reason};
    }
    branchCommanderStatus(branchId){
      const branch=this.branch(branchId),s=this.state,limit=branch?.parentCastleId==='edo'?1:2;
      const reason=!branch?'支拠点が見つかりません。':branch.retreating?'帰還待機中の支拠点には武将を配置できません。':!this.canOwnCastle(branch.parentCastleId)||s.castles[branch.parentCastleId]?.owner!==s.clan?'自分の支拠点を選んでください。':branch.level<1?'支拠点の建設が完了してから武将を配置してください。':branch.fallen?'陥落した支拠点からは武将の配置を解除できます。':'';
      const describe=id=>{const officer=this.officer(id);return{id,name:officer?.name||id,rank:officer?.rank||officer?.rarity||''};};
      const assigned=branch?.commanders||[],candidates=s.officers.map(id=>{
        const other=s.branches.find(row=>(row.commanders||[]).includes(id)),governor=Object.entries(s.governors).find(([,officer])=>officer===id);
        const blocked=reason||(other?(other.id===branchId?'この支拠点に配置済みです。':`${BRANCH_BY_ID[other.id].name}に配置されています。`):s.army.includes(id)?'出陣軍団に編成されています。':assigned.length>=limit?`この支拠点には武将を${limit}名まで配置できます。`:'');
        return{...describe(id),available:!blocked,reason:blocked,...(governor?{fromBuildingId:governor[0],fromBuildingName:BUILDINGS.find(row=>row.id===governor[0]).name}: {})};
      });
      return{branchId,limit,available:!reason,reason,commanders:assigned.map(describe),candidates};
    }
    branchCommanderAutoPlan(branchId){
      const s=this.state,all=branchId==='all',records=new Map(s.branches.map(branch=>[branch.id,branch]));
      const eligibility=id=>{const branch=records.get(id),reason=!branch?'支拠点が見つかりません。':branch.retreating?'帰還待機中の支拠点には武将を配置できません。':!this.canOwnCastle(branch.parentCastleId)||s.castles[branch.parentCastleId]?.owner!==s.clan?'自分の支拠点を選んでください。':branch.level<1?'支拠点の建設が完了してから武将を配置してください。':branch.fallen?'陥落した支拠点からは武将の配置を解除できます。':'';return{branch,reason};};
      const targets=(all?[...records.keys()].sort():[branchId]).map(eligibility);
      if(!all&&targets[0].reason)return{ok:false,code:'BRANCH_COMMANDER_UNAVAILABLE',message:targets[0].reason,assignments:[],formations:[]};
      const branches=targets.filter(row=>!row.reason).map(({branch})=>({branchId:branch.id,branchName:BRANCH_BY_ID[branch.id].name,limit:branch.parentCastleId==='edo'?1:2,previousCommanders:[...(branch.commanders||[])]}));
      if(!branches.length)return{ok:false,code:'BRANCH_COMMANDER_NO_SLOTS',message:'配置を見直せる、自分の稼働中の支拠点がありません。',assignments:[],formations:[]};
      const targetIds=new Set(branches.map(branch=>branch.branchId)),reserved=new Set(s.army),previousBranch=new Map(),governors=new Map();
      for(const branch of s.branches)for(const id of branch.commanders||[])if(targetIds.has(branch.id))previousBranch.set(id,branch.id);else reserved.add(id);
      for(const [buildingId,id]of Object.entries(s.governors))governors.set(id,{fromBuildingId:buildingId,fromBuildingName:BUILDINGS.find(row=>row.id===buildingId)?.name||buildingId});
      // Inspect the current formation as well as available officers. Another
      // branch's post is reserved only when that branch is outside this plan.
      // One batch reuses ranked officer data, without scanning the roster once
      // for every branch. Tied abilities prefer an existing target commander.
      const strength=(a,b)=>b.lead-a.lead||b.intellect-a.intellect||b.valor-a.valor||RANKS.indexOf(b.rank)-RANKS.indexOf(a.rank);
      const candidates=this.officerViews([...new Set(s.officers)].filter(id=>!reserved.has(id))).filter(Boolean).sort((a,b)=>strength(a,b)||Number(previousBranch.has(b.id))-Number(previousBranch.has(a.id))||(a.id<b.id?-1:a.id>b.id?1:0));
      if(!candidates.length)return{ok:false,code:'BRANCH_COMMANDER_NO_CANDIDATES',message:'本隊・対象外の支拠点以外に、編成できる武将がいません。',assignments:[],formations:[]};
      const capacity=branches.reduce((sum,branch)=>sum+branch.limit,0),selected=candidates.slice(0,capacity),selectedIds=new Set(selected.map(officer=>officer.id)),rankById=new Map(selected.map((officer,index)=>[officer.id,index]));
      const counts=new Map(branches.map(branch=>[branch.branchId,0])),selectedBefore=new Map(branches.map(branch=>[branch.branchId,branch.previousCommanders.filter(id=>selectedIds.has(id))]));let available=selected.length;
      // Cover one position in each branch before using its second. Within a
      // scarce roster, retain already covered branches before moving an equal
      // formation merely because of identifier ordering.
      for(let slot=0;slot<2;slot++)for(const branch of [...branches].filter(row=>row.limit>slot).sort((a,b)=>Number(selectedBefore.get(b.branchId).length>slot)-Number(selectedBefore.get(a.branchId).length>slot)||(a.branchId<b.branchId?-1:1))){if(!available)break;counts.set(branch.branchId,counts.get(branch.branchId)+1);available--;}
      const retained=new Set(),formations=branches.map(branch=>{
        const count=counts.get(branch.branchId),keep=new Set([...selectedBefore.get(branch.branchId)].sort((a,b)=>rankById.get(a)-rankById.get(b)).slice(0,count)),commanders=Array(count).fill(null);
        branch.previousCommanders.forEach((id,index)=>{if(keep.has(id)&&index<count){commanders[index]=id;retained.add(id);}});
        for(const id of branch.previousCommanders)if(keep.has(id)&&!retained.has(id)){commanders[commanders.indexOf(null)]=id;retained.add(id);}
        return{...branch,commanders};
      }),remaining=selected.filter(officer=>!retained.has(officer.id));
      for(let slot=0;slot<2;slot++)for(const formation of formations)if(slot<formation.commanders.length&&!formation.commanders[slot])formation.commanders[slot]=remaining.shift().id;
      const byId=new Map(selected.map(officer=>[officer.id,officer])),assignments=[];let replacedCount=0,removedCount=0;
      for(const formation of formations){
        const removed=formation.previousCommanders.filter(id=>!formation.commanders.includes(id));removedCount+=removed.length;
        formation.changed=formation.previousCommanders.length!==formation.commanders.length||formation.commanders.some((id,index)=>id!==formation.previousCommanders[index]);
        formation.commanders.forEach((id,slot)=>{if(formation.previousCommanders.includes(id))return;const officer=byId.get(id),previousOfficerId=removed.shift()||null,fromBranchId=previousBranch.get(id);if(previousOfficerId)replacedCount++;
          assignments.push({branchId:formation.branchId,branchName:formation.branchName,slot,officerId:id,name:officer.name,rank:officer.rank,lead:officer.lead,intellect:officer.intellect,valor:officer.valor,previousOfficerId,...(governors.get(id)||{}),...(fromBranchId?{fromBranchId,fromBranchName:BRANCH_BY_ID[fromBranchId].name}:{})});
        });
      }
      const assignedCount=selected.length,changedCount=formations.reduce((sum,formation)=>sum+Array.from({length:Math.max(formation.previousCommanders.length,formation.commanders.length)},(_,slot)=>Number(formation.previousCommanders[slot]!==formation.commanders[slot])).reduce((count,value)=>count+value,0),0),retainedCount=retained.size,releasedCount=[...previousBranch.keys()].filter(id=>!selectedIds.has(id)).length,remainingSlots=capacity-assignedCount,changed=formations.some(formation=>formation.changed);
      const message=changed?`${changedCount}枠の配置を見直します。${replacedCount?`既存の武将を${replacedCount}名入れ替えます。`:''}${remainingSlots?`武将が足りないため、残り${remainingSlots}枠は空けてあります。`:''}`:`現在の支拠点の編成が最適です。${retainedCount}名の配置を維持します。`;
      return{ok:true,branchId,assignments,formations,assignedCount,changedCount,replacedCount,retainedCount,releasedCount,removedCount,addedCount:assignments.length-replacedCount,remainingSlots,changed,commandCost:0,message};
    }
    autoAssignBranchCommanders(branchId){
      const plan=this.branchCommanderAutoPlan(branchId);if(!plan.ok||!plan.changed)return plan;
      for(const formation of plan.formations){const branch=this.state.branches.find(row=>row.id===formation.branchId);branch.commanders=[...formation.commanders];}
      const assigned=new Set(plan.formations.flatMap(formation=>formation.commanders));for(const id of Object.keys(this.state.governors))if(assigned.has(this.state.governors[id]))delete this.state.governors[id];
      const message=plan.message.replace('見直します。','見直しました。').replace('入れ替えます。','入れ替えました。');this.log(message,'officer');
      return{...plan,message};
    }
    assignBranchCommander(branchId,officerId){
      const status=this.branchCommanderStatus(branchId),candidate=status.candidates.find(row=>row.id===officerId);
      if(!candidate||!candidate.available)return{ok:false,code:'BRANCH_COMMANDER_UNAVAILABLE',message:candidate?.reason||status.reason||'所有している家臣から武将を選んでください。'};
      const branch=this.state.branches.find(row=>row.id===branchId);branch.commanders=[...(branch.commanders||[]),officerId];for(const id of Object.keys(this.state.governors))if(this.state.governors[id]===officerId)delete this.state.governors[id];
      const message=`${candidate.name}を${candidate.fromBuildingName?candidate.fromBuildingName+'の奉行から転任し、':''}${BRANCH_BY_ID[branchId].name}へ配置しました。`;this.log(message,'officer');
      return{ok:true,message,branchId,officerId,commanders:[...branch.commanders]};
    }
    removeBranchCommander(branchId,officerId){
      const branch=this.state.branches.find(row=>row.id===branchId);
      if(!branch||!this.canOwnCastle(branch.parentCastleId)||this.state.castles[branch.parentCastleId]?.owner!==this.state.clan||!(branch.commanders||[]).includes(officerId))return{ok:false,code:'BRANCH_COMMANDER_UNAVAILABLE',message:'この支拠点に配置されている武将を選んでください。'};
      branch.commanders=branch.commanders.filter(id=>id!==officerId);
      const message=`${this.officer(officerId).name}の${BRANCH_BY_ID[branchId].name}への配置を解除しました。`;this.log(message,'officer');
      return{ok:true,message,branchId,officerId,commanders:[...branch.commanders]};
    }
    troopTransferStatus(){
      const s=this.state,endpoints=[],add=(value,sourceReason='',destinationReason=sourceReason)=>{
        const canSource=!sourceReason,canDestination=!destinationReason;
        endpoints.push({...value,available:canSource||canDestination,canSource,canDestination,sourceReason,destinationReason,reason:sourceReason||destinationReason});
      };
      add({id:'army',kind:'army',name:'手元の軍勢',castleId:s.home,troops:s.troops,capacity:this.availableTroopCapacity()});
      for(const castle of this.ownedCastles())add({id:'castle:'+castle.id,kind:'castle',name:castle.name,castleId:castle.id,troops:castle.troops,capacity:ASSET_CAP},castle.id===STAFF_BASE_ID?'共同拠点の兵は個人の駐留兵として移動できません。':'');
      for(const record of s.branches){
        const site=BRANCH_BY_ID[record.id];if(!site)continue;
        const owned=this.canOwnCastle(record.parentCastleId)&&s.castles[record.parentCastleId]?.owner===s.clan;
        if(!owned&&!record.retreating)continue;
        const sourceReason=record.level<1?'建設中の支拠点には兵を配置できません。':'';
        const destinationReason=sourceReason||(record.retreating?'帰還待機中の兵は、自領の拠点または手元の軍勢へ撤収してください。':record.fallen?'陥落した支拠点からは撤収だけできます。':'');
        add({id:'branch:'+record.id,kind:'branch',name:site.name+(record.retreating?'・帰還待機':''),castleId:record.parentCastleId,parentCastleId:record.parentCastleId,troops:record.stationedTroops||0,capacity:ASSET_CAP,fallen:record.fallen===true,retreating:record.retreating===true},sourceReason,destinationReason);
      }
      return{commandCost:1,sequence:s.troopTransferSequence||0,endpoints};
    }
    troopTransferQuote(from,to,troops){
      const status=this.troopTransferStatus(),source=status.endpoints.find(row=>row.id===from),destination=status.endpoints.find(row=>row.id===to);
      const maxTroops=source?.canSource&&destination?.canDestination&&from!==to?Math.max(0,Math.min(source.troops,destination.capacity-destination.troops)):0;
      let code='',reason='';
      if(!source||!destination){code='INVALID_TROOP_ENDPOINT';reason='自領の城・支拠点または手元の軍勢を選んでください。';}
      else if(from===to){code='SAME_TROOP_ENDPOINT';reason='移動元と移動先には異なる拠点を選んでください。';}
      else if(!source.canSource||!destination.canDestination){code='TROOP_ENDPOINT_UNAVAILABLE';reason=source.sourceReason||destination.destinationReason;}
      else if(!Number.isSafeInteger(troops)||troops<1||troops>ASSET_CAP){code='INVALID_TROOP_AMOUNT';reason='移動する兵数を1人以上の整数で指定してください。';}
      else if(troops>source.troops){code='INSUFFICIENT_TROOPS';reason='移動元に配置されている兵が足りません。支拠点の基礎守備力は移動できません。';}
      else if(troops>maxTroops){code='TROOP_CAPACITY';reason=to==='army'?'帰還中・出陣中の兵を含めると、手元の軍勢の収容上限を超えます。':'移動先の兵数の上限を超えます。';}
      else if((this.state.troopTransferSequence||0)>=1000000000){code='TROOP_SEQUENCE_LIMIT';reason='兵の移動記録が上限に達しました。';}
      else{const guard=this._guard();if(guard){code='TROOP_TRANSFER_UNAVAILABLE';reason=guard.message;}}
      const amount=Number.isSafeInteger(troops)&&troops>=0&&troops<=ASSET_CAP?troops:0,ok=!reason;
      return{ok,code,reason,message:reason,from:typeof from==='string'?from:'',to:typeof to==='string'?to:'',troops:amount,maxTroops,commandCost:1,cost:{},sourceBefore:source?.troops||0,sourceAfter:(source?.troops||0)-(ok?amount:0),destinationBefore:destination?.troops||0,destinationAfter:(destination?.troops||0)+(ok?amount:0)};
    }
    transferTroops(from,to,troops){
      const quote=this.troopTransferQuote(from,to,troops);if(!quote.ok)return quote;
      const endpoints=this.troopTransferStatus().endpoints,source=endpoints.find(row=>row.id===from),destination=endpoints.find(row=>row.id===to),s=this.state;
      const set=(endpoint,amount)=>{if(endpoint.kind==='army')s.troops=amount;else if(endpoint.kind==='castle')s.castles[endpoint.castleId].troops=amount;else s.branches.find(row=>'branch:'+row.id===endpoint.id).stationedTroops=amount;};
      set(source,quote.sourceAfter);set(destination,quote.destinationAfter);s.troopTransferSequence=(s.troopTransferSequence||0)+1;
      // A former staff home is a saved personal holding, not a replenishment
      // floor. Keep its backup in step with an explicit debit or credit.
      const view=STAFF_VIEW.get(this),origin=STAFF_ORIGIN.get(this),home=view?.personalHome||origin?.home;
      if(home&&[source,destination].some(endpoint=>endpoint.kind==='castle'&&endpoint.castleId===home)){
        const current=s.castles[home];if(view)view.personalHomeCastle.troops=current.troops;if(origin?.homeCastle)origin.homeCastle.troops=current.troops;
        if(s.staffService?.personalHome===home&&s.staffService.personalHomeCastle)s.staffService.personalHomeCastle.troops=current.troops;
      }
      this._pruneBranches();
      const message=`${source.name}から${destination.name}へ兵${troops.toLocaleString()}人を移しました。`;
      return this._action(message,'army',{...quote,message,troopTransferSequence:s.troopTransferSequence});
    }
    branchQuote(parentCastleId,direction){
      const status=this.branchStatus(parentCastleId),site=BRANCH_BY_ID[parentCastleId+'_'+direction];
      const record=status.branches.find(row=>row.id===site?.id),level=record?.level||0;
      const plan=branchQueuePlan(record,record?.jobs||[]),queuedLevel=plan.level;
      const cost=site?this.scaleUpgradeCost(branchUpgradeCost(parentCastleId,queuedLevel)):null;let reason=status.reason;
      if(!reason&&!site)reason='支拠点の方角を北・東・南・西から選んでください。';
      else if(!reason&&record?.retreating)reason='帰還待機中の兵を撤収してから、支拠点を建設してください。';
      else if(!reason&&record?.fallen)reason='陥落した支拠点は、先に修復してください。';
      else if(!reason&&queuedLevel>=status.maxLevel)reason=`この支拠点は最高のLv.${status.maxLevel}まで建設・予約されています。`;
      else if(!reason&&!record&&status.branches.length>=status.maxBranches)reason=`この親拠点の支拠点は${status.maxBranches}か所までです。`;
      else if(!reason)reason=this._guard()?.message||'';
      if(!reason&&!plan.queued&&this.constructionChains()>=this.constructionSlots())reason=`施設・城郭・支拠点を合わせて同時に${this.constructionSlots()}件まで普請できます。`;
      if(!reason&&cost&&!this._canPay(cost))reason='支拠点の普請に必要な資源が足りません。';
      return{ok:!reason,reason,message:reason,id:site?.id||'',parentCastleId,direction,level,queuedLevel,targetLevel:queuedLevel+1,maxLevel:status.maxLevel,cost,commandCost:1,
        queued:plan.queued,queuePosition:plan.queuePosition,startsInSeconds:plan.startsInSeconds};
    }
    buildBranch(parentCastleId,direction){const id=parentCastleId+'_'+direction;if(this.state.branches.some(row=>row.id===id))return fail('この方角にはすでに支拠点があります。');return this._startBranch(parentCastleId,direction);}
    branchRepairQuote(id){const row=this.state.branches.find(branch=>branch.id===id),status=this.branchStatus(row?.parentCastleId),cost=row?.level>0?this.scaleUpgradeCost(branchUpgradeCost(row.parentCastleId,Math.max(0,row.level-1))):null,guard=this._guard();let reason=!row?'修復する支拠点が見つかりません。':row.retreating?'帰還待機中の兵を撤収してから、支拠点を建設してください。':status.reason||(!row.fallen?'この支拠点は陥落していません。':this.state.jobs.some(job=>job.kind==='branch'&&job.id===id)?'この支拠点は普請中です。':guard?.message||'');if(!reason&&this.constructionChains()>=this.constructionSlots())reason=`施設・城郭・支拠点を合わせて同時に${this.constructionSlots()}件まで普請できます。`;if(!reason&&cost&&!this._canPay(cost))reason='支拠点の修復に必要な資源が足りません。';return{ok:!reason,reason,message:reason,id,parentCastleId:row?.parentCastleId||'',direction:row?.direction||'',level:row?.level||0,targetLevel:row?.level||0,maxLevel:status.maxLevel,cost,commandCost:1,repair:true};}
    repairBranch(id){const quote=this.branchRepairQuote(id);if(!quote.ok)return quote;const {cost,targetLevel}=quote;this._pay(cost);this.state.jobs.push({kind:'branch',id,repair:true,remaining:cost.turns,total:cost.turns,remainingSeconds:cost.seconds,totalSeconds:cost.seconds,targetLevel});return this._action(`${BRANCH_BY_ID[id].name} Lv.${targetLevel}の修復を開始。あと${cost.seconds}秒（1倍速）で復旧します。`,'build',{branchId:id,targetLevel,repair:true});}
    upgradeBranch(id){const row=this.state.branches.find(branch=>branch.id===id);if(!row)return fail('増築する支拠点が見つかりません。');return this._startBranch(row.parentCastleId,row.direction);}
    _startBranch(parentCastleId,direction){
      const quote=this.branchQuote(parentCastleId,direction);if(!quote.ok)return quote;
      const {id}=quote,created=!this.state.branches.some(row=>row.id===id);
      if(created)this.state.branches.push({id,parentCastleId,direction,level:0,fallen:false});
      return this._enqueueBranch(quote,id,{parentCastleId,direction},BRANCH_BY_ID[id].name,created?'建設':'増築');
    }
    _enqueueBranch(quote,id,details,name,action){
      const {cost,targetLevel,queued,queuePosition,startsInSeconds}=quote;
      this._pay(cost);
      this.state.jobs.push({kind:'branch',id,...(details.facilityId?{facilityId:details.facilityId}:{}),
        remaining:cost.turns,total:cost.turns,remainingSeconds:cost.seconds,totalSeconds:cost.seconds,targetLevel});
      return this._action(`${name} Lv.${targetLevel}の${action}を${queued?'予約':'開始'}しました。工期${cost.seconds}秒（1倍速）。`,'build',
        {branchId:id,...details,targetLevel,queued,queuePosition,startsInSeconds});
    }
    branchFacilityBonuses(branchId){
      const total=branchFacilityEffects(null),s=this.state;
      for(const branch of s.branches){if(branchId!==undefined&&branch.id!==branchId||s.castles[branch.parentCastleId]?.owner!==s.clan||branch.parentCastleId==='edo'&&!this.isAdmin)continue;const bonus=branchFacilityEffects(branch,elapsedMillis(s));for(const key of RESOURCES)total.income[key]+=bonus.income[key];for(const key of ['capacity','defense','siegeDefense'])total[key]+=bonus[key];}
      return total;
    }
    branchFacilityStatus(branchId){
      const branch=this.branch(branchId),parent=branch&&this.branchStatus(branch.parentCastleId);
      const catalog=branch?branchFacilityCatalog(branch.parentCastleId):[],jobs=branch?.jobs||[],plan=branchQueuePlan(branch,jobs);
      const reason=!branch?'支拠点が見つかりません。':parent.reason||(branch.fallen?'陥落した支拠点を修復すると施設を利用できます。':
        !plan.level?'支拠点の建設を先に予約してください。':'');
      return{branchId,parentCastleId:branch?.parentCastleId||'',available:!reason,active:!reason&&branch.level>0,reason,
        slots:catalog.length,builtCount:catalog.filter(def=>(branch.facilities[def.id]||0)>0).length,
        totalLevels:catalog.reduce((sum,def)=>sum+(branch.facilities[def.id]||0),0),
        maxLevel:branch?.level||0,queuedLevel:plan.level,job:branch?.job||null,jobs,bonuses:this.branchFacilityBonuses(branchId),
        facilities:catalog.map(def=>{
          const level=branch.facilities[def.id]||0,work=jobs.filter(job=>job.facilityId===def.id);
          const quote=this._quoteBranchFacility(branch,def,parent,plan);
          const nextEffectText=quote.queuedLevel<plan.level?branchFacilityEffectText(def,quote.targetLevel):
            (plan.level>=parent.maxLevel?'最高レベルに達しています。':'支拠点を増築すると、さらに強化できます。');
          return{...def,level,maxLevel:branch.level,job:work[0]||null,jobs:work,quote,effectText:branchFacilityEffectText(def,level),nextEffectText};
        })};
    }
    branchFacilityQuote(branchId,facilityId){
      const branch=this.branch(branchId),status=this.branchStatus(branch?.parentCastleId);
      const def=branch&&branchFacilityCatalog(branch.parentCastleId).find(row=>row.id===facilityId);
      return this._quoteBranchFacility(branch,def,status,branchQueuePlan(branch,branch?.jobs||[]),branchId,facilityId);
    }
    _quoteBranchFacility(branch,def,status,plan,branchId=branch?.id,facilityId=def?.id){
      const level=branch?.facilities?.[facilityId]||0,queuedLevel=plan.facilities[facilityId]||0,maxLevel=plan.level;
      const cost=def?this.scaleUpgradeCost(branchFacilityCost(branch.parentCastleId,facilityId,queuedLevel)):null;let reason=!branch?'支拠点が見つかりません。':status.reason;
      if(!reason&&!def)reason='この支拠点に建設できる施設を選んでください。';
      else if(!reason&&!plan.level)reason='支拠点の建設を先に予約してください。';
      else if(!reason&&branch.fallen)reason='陥落した支拠点は、先に修復してください。';
      else if(!reason&&queuedLevel>=maxLevel)reason=maxLevel>=status.maxLevel?`この施設は最高のLv.${maxLevel}まで建設・予約されています。`:`施設は支拠点のLv.${maxLevel}まで強化できます。先に支拠点を増築してください。`;
      else if(!reason&&!this.state.realtime.running)reason='時間が停止中です。再開してから普請してください。';
      else if(!reason)reason=this._guard()?.message||'';
      if(!reason&&!plan.queued&&this.constructionChains()>=this.constructionSlots())reason=`施設・城郭・支拠点を合わせて同時に${this.constructionSlots()}件まで普請できます。`;
      if(!reason&&cost&&!this._canPay(cost))reason='支拠点の施設普請に必要な資源が足りません。';
      return{ok:!reason,reason,message:reason,branchId,facilityId,level,queuedLevel,targetLevel:queuedLevel+1,maxLevel,cost,commandCost:1,
        queued:plan.queued,queuePosition:plan.queuePosition,startsInSeconds:plan.startsInSeconds};
    }
    buildBranchFacility(branchId,facilityId){
      const quote=this.branchFacilityQuote(branchId,facilityId);
      if(quote.queuedLevel>0)return fail('この施設は建設済み、または建設予約済みです。増築を選んでください。');
      return this._startBranchFacility(quote);
    }
    upgradeBranchFacility(branchId,facilityId){
      const quote=this.branchFacilityQuote(branchId,facilityId);
      if(!quote.queuedLevel)return fail('この施設は未建設です。先に建設してください。');
      return this._startBranchFacility(quote);
    }
    _startBranchFacility(quote){
      if(!quote.ok)return quote;
      const {branchId,facilityId,targetLevel}=quote,def=BRANCH_FACILITIES.find(row=>row.id===facilityId);
      return this._enqueueBranch(quote,branchId,{facilityId},BRANCH_BY_ID[branchId].name+'の'+def.name,targetLevel===1?'建設':'増築');
    }
    ownedCastles(){return CASTLES.filter(c=>this.canOwnCastle(c.id)&&this.state.castles[c.id].owner===this.state.clan).map(c=>this.castle(c.id));}
    upgradeCastleCount(){return CASTLES.reduce((count,castle)=>count+(this.canOwnCastle(castle.id)&&!(this.isStaff&&castle.id===STAFF_BASE_ID)&&this.state.castles[castle.id]?.owner===this.state.clan?1:0),0);}
    upgradeCostMultiplier(){return upgradeCostMultiplier(this.upgradeCastleCount());}
    scaleUpgradeCost(cost){return scaleUpgradeCost(cost,this.upgradeCastleCount());}
    adjacentTargets(){const ids=new Set();for(const c of this.ownedCastles())for(const id of c.neighbors)if(this.canOwnCastle(id)&&this.state.castles[id].owner!==this.state.clan)ids.add(id);return [...ids].map(id=>this.castle(id));}
    commandMax(){return 3+Math.floor(this.state.buildings.keep/8);}
    constructionSlots(){return 2+Math.floor(this.state.buildings.keep/8);}
    constructionChains(){return new Set(this.state.jobs.filter(j=>j.kind!=='research').map(j=>j.kind+':'+j.id)).size;}
    buildingMax(){return 32;}
    troopCapacity(){const extra=EXTRA_FACILITIES.filter(b=>b.category==='military').reduce((a,b)=>a+this.state.buildings[b.id]*b.capacity*this._governorBonus(b.id),0);return Math.min(ASSET_CAP,Math.floor((1000+this.state.buildings.barracks*2000+this.state.buildings.keep*500+this.ownedCastles().length*500+extra)*this._governorBonus('barracks'))+this.branchFacilityBonuses().capacity);}
    log(text,kind='info'){this.state.log.unshift({turn:this.state.turn,text,kind});this.state.log=this.state.log.slice(0,160);}
    random(){const ctx=MARCH_CONTEXT.get(this);if(ctx){let x=ctx.seed>>>0;x^=x<<13;x^=x>>>17;x^=x<<5;ctx.seed=x>>>0;return(ctx.seed>>>0)/4294967296;}let x=this.state.seed>>>0;x^=x<<13;x^=x>>>17;x^=x<<5;this.state.seed=x>>>0;return(this.state.seed>>>0)/4294967296;}
    _guard(){if(this.isStaff&&!STAFF_VIEW.get(this))return fail('京都御所の共同拠点を確認しています。');if(this.state.gameOver)return fail('本拠を失いました。新しい物語を始めてください。');if(!MARCH_CONTEXT.has(this)&&this.state.command<1)return fail('指示を使い切りました。1倍速では20秒ごとに1回復します。');return null;}
    _canPay(cost){return RESOURCES.every(k=>this.state.resources[k]>=(cost[k]||0));}
    _pay(cost){if(MARCH_CONTEXT.has(this))return;for(const k of RESOURCES)this.state.resources[k]=clamp(this.state.resources[k]-(cost[k]||0),0,ASSET_CAP);}
    _gain(reward){const credited={};for(const k of GIFT_FIELDS){const holder=k==='magatama'?this.state:this.state.resources,before=holder[k];holder[k]=clamp(before+(reward[k]||0),0,ASSET_CAP);credited[k]=Math.max(0,holder[k]-before);}return credited;}
    static normalizeWalkingState(raw){return walkingState(raw);}
    static normalizeRoamingState(raw,campaignId){return roamingState(raw,campaignId);}
    static roamingDeploymentDefaults(){return{...ROAMING_DEPLOYMENT_DEFAULTS};}
    static validateRoamingDeployment(raw){return validateRoamingDeployment(raw);}
    static roamingDeploymentSummary(raw){return roamingDeploymentSummary(raw);}
    static roamingDeploymentUnits(raw,castleId){return roamingDeploymentUnits(raw,castleId);}
    static normalizeCovertState(raw,campaignId){return covertState(raw,campaignId);}
    static normalizeMarchState(raw,state){return normalizeMarch(raw,state);}
    static normalizeMarchHistory(raw,state){return normalizeMarchHistory(raw,state);}
    static normalizeCovertTarget(raw){return covertTarget(raw);}
    static normalizeCovertSnapshot(raw){return covertSnapshot(raw);}
    beginLocalWalkingSession(id){
      if(!walkingId(id))return fail('歩行計測の識別子が正しくありません。');
      const w=this.state.walking,current=w.localSession;
      if(current?.id===id)return{ok:true,changed:false,closed:current.closed,deltaSteps:0,totalSteps:current.totalSteps,rewards:{},message:current.closed?'この歩行計測は終了しています。':'歩行計測を再開します。'};
      if(current&&!current.closed)return fail('現在の歩行計測を終了してから開始してください。');
      w.localSession={id,totalSteps:0,closed:false};return{ok:true,changed:true,closed:false,deltaSteps:0,totalSteps:0,rewards:{},message:'歩行計測を開始しました。'};
    }
    applyLocalWalkingProgress(id,totalSteps){
      const w=this.state.walking,current=w.localSession;
      if(!walkingId(id)||!Number.isSafeInteger(totalSteps)||totalSteps<0||totalSteps>MAX_WALKING_STEPS)return fail('歩数の形式が正しくありません。');
      if(!current||current.id!==id)return fail('この歩行計測は現在の物語に接続されていません。');
      const delta=Math.max(0,totalSteps-current.totalSteps);
      if(!delta)return{ok:true,changed:false,closed:current.closed,deltaSteps:0,totalSteps:current.totalSteps,rewards:{},message:'この歩数は反映済みです。'};
      if(current.closed)return fail('終了済みの歩行計測には追加できません。');
      if(w.localSteps+delta>MAX_WALKING_STEPS)return fail('歩数の累計が保存できる範囲を超えています。');
      normalizeAssets(this.state);const rewards=Object.fromEntries(GIFT_FIELDS.map(k=>[k,Math.max(0,Math.min(ASSET_CAP-(k==='magatama'?this.state.magatama:this.state.resources[k]),delta*2))]));
      this._gain(rewards);current.totalSteps=totalSteps;w.localSteps+=delta;
      return{ok:true,changed:true,closed:false,deltaSteps:delta,totalSteps,rewards,message:`${delta}歩の報酬を反映しました。`};
    }
    endLocalWalkingSession(id){
      const current=this.state.walking.localSession;if(!current||current.id!==id)return fail('歩行計測が見つかりません。');
      const changed=!current.closed;current.closed=true;return{ok:true,changed,closed:true,deltaSteps:0,totalSteps:current.totalSteps,rewards:{},message:'歩行計測を終了しました。'};
    }
    gachaCost(count=1){return count===1?GACHA.singleCost:count===10?GACHA.tenCost:null;}
    gachaOdds(){return GACHA.rates.map(r=>{const count=this.gachaPool(r.rank).length;return{...r,count,perOfficerRate:count?r.rate/count:0};});}
    _gachaRank(roll){if(typeof roll!=='number'||!Number.isFinite(roll)||roll<0||roll>=1)return null;let ceiling=0;for(const row of GACHA.rates){ceiling+=row.rate;if(roll<ceiling/100)return row.rank;}return GACHA.rates.at(-1).rank;}
    canDrawOfficers(count=1){
      const cost=this.gachaCost(count);if(cost===null)return{ok:false,cost:0,reason:'招集は1回または10回で選んでください。'};
      if(this.state.gameOver)return{ok:false,cost,reason:'領国を失っています。新しい物語を始めてください。'};
      if(this.gachaOdds().some(r=>r.count===0))return{ok:false,cost,reason:'武将データが不足しているため招集できません。'};
      if(this.state.magatama<cost)return{ok:false,cost,reason:`勾玉が${(cost-this.state.magatama).toLocaleString()}不足しています。月次褒賞・任務・城の初攻略で集められます。`};
      return{ok:true,cost,reason:'招集できます。'};
    }
    drawOfficers(count=1){
      const can=this.canDrawOfficers(count);if(!can.ok)return fail(can.reason);
      const s=this.state,results=[];let refund=0,newCount=0,newOfficerCount=0,upgradedCount=0;s.magatama-=can.cost;
      for(let i=0;i<count;i++){
        const rank=this._gachaRank(this.random()),pool=this.gachaPool(rank),officer=pool[Math.floor(this.random()*pool.length)];
        const acquired=this._grantOfficerVariant(officer.id,rank),duplicateRefund=acquired.isNew?0:GACHA.duplicateRefund;
        if(acquired.isNew)newCount++;else{refund+=duplicateRefund;s.stats.gachaDuplicates++;}
        if(acquired.isNewOfficer)newOfficerCount++;if(acquired.upgraded)upgradedCount++;
        const item={officerId:officer.id,rank,...acquired,duplicateRefund,turn:s.turn};results.push(item);s.gachaHistory.unshift({...item});s.stats.gachaDraws++;
      }
      s.gachaHistory=s.gachaHistory.slice(0,50);this._gain({magatama:refund});
      const message=`武将を${count}回招集。新規絵巻${newCount}枚、新たな家臣${newOfficerCount}名。${refund?`同じ武将・同じランクの重複分は勾玉${refund}に変わりました。`:''}`;
      this.log(message,'gacha');return{ok:true,message,cost:can.cost,refund,newCount,newOfficerCount,upgradedCount,results,balance:s.magatama};
    }
    applyGift(gift,receiptId){
      if(typeof receiptId!=='string'||receiptId.length<1||receiptId.length>128)return fail('贈り物の受取番号が正しくありません。');
      if(!gift||typeof gift!=='object'||Array.isArray(gift)||Object.keys(gift).some(k=>!GIFT_FIELDS.includes(k))||GIFT_FIELDS.some(k=>Object.prototype.hasOwnProperty.call(gift,k)&&(!Number.isInteger(gift[k])||gift[k]<0||gift[k]>1000000)))return fail('贈り物の内容が正しくありません。');
      if(this.state.giftReceipts.includes(receiptId))return{ok:true,already:true,message:'この贈り物は受取済みです。'};
      if(this.state.giftReceipts.length>=2000)return fail('受取履歴が上限の2,000件に達しています。');
      const reward=Object.fromEntries(GIFT_FIELDS.map(k=>[k,Object.prototype.hasOwnProperty.call(gift,k)?gift[k]:0]));
      this._gain(reward);this.state.giftReceipts.push(receiptId);this.log(reward.magatama?'贈り物を受け取り、勾玉と資源に反映しました。':'贈り物を受け取り、領国の資源に加えました。','gift');
      return{ok:true,already:false,message:'贈り物を受け取りました。',rewards:reward};
    }
    _action(text,kind='info',extra={}){if(!MARCH_CONTEXT.has(this))this.state.command--;this.log(text,kind);return{ok:true,message:text,...extra};}
    governorBonusFor(buildingId,officerId,officers){return governorBonusForCategory(BUILDINGS.find(b=>b.id===buildingId)?.category,officers?officers.get(officerId):this.officer(officerId));}
    _governorViews(assignments=this.state.governors){const ids=[...new Set(Object.values(assignments))],views=this.officerViews(ids);return new Map(ids.map((id,index)=>[id,views[index]]));}
    _governorBonus(id,officers,assignments=this.state.governors){return this.governorBonusFor(id,assignments[id],officers);}
    _facilityEffect(category,officers,assignments=this.state.governors){return EXTRA_FACILITIES.filter(b=>b.category===category).reduce((a,b)=>a+this.state.buildings[b.id]*b.effect*this._governorBonus(b.id,officers,assignments),0);}
    buildingUnlock(id){const b=BUILDINGS.find(b=>b.id===id);if(!b)return{ok:false,requiredLevel:1,reason:'施設が見つかりません。'};const ok=this.state.buildings.keep>=b.requiredKeep;return{ok,requiredLevel:b.requiredKeep,reason:ok?'建設・増築できます。':`天守 Lv.${b.requiredKeep}が必要です。`};}
    governorDescription(id){const category=BUILDINGS.find(b=>b.id===id)?.category;const named={keep:'政治力に応じて武将の登用費用を軽減します。',barracks:'政治力に応じて兵数上限を増やし募兵費用を軽減します。',wall:'政治力に応じて本拠の防衛力を高めます。',academy:'政治力に応じて研究費用を軽減します。'};return named[id]||({gold:'政治力に応じてこの施設の金銭生産を増やします。',rice:'政治力に応じてこの施設の兵糧生産を増やします。',wood:'政治力に応じてこの施設の木材生産を増やします。',stone:'政治力に応じてこの施設の石材生産を増やします。',military:'政治力に応じてこの施設の攻撃力・兵数上限の効果を高めます。',defense:'政治力に応じてこの施設の防衛補正を高めます。',research:'政治力に応じてこの施設の研究費軽減を強化します。',diplomacy:'政治力に応じてこの施設の交渉・偵察・登用費軽減を強化します。'})[category]||'';}
    buildingSummary(id){const b=BUILDINGS.find(b=>b.id===id);if(!b)return'';const lv=this.state.buildings[id];if(!lv)return'未建設';const gov=this._governorBonus(id),v=lv*b.effect*gov;if(!b.core){if(RESOURCES.includes(b.category))return`${({gold:'金銭',rice:'兵糧',wood:'木材',stone:'石材'})[b.category]} +${Math.floor(v).toLocaleString()} /月（技術補正前）`;if(b.category==='military')return`攻撃 +${(v*100).toFixed(1)}%・兵数 +${Math.floor(lv*b.capacity*gov).toLocaleString()}`;if(b.category==='defense')return`領国防衛 +${(v*100).toFixed(1)}%`;if(b.category==='research')return`研究効率 +${(v*100).toFixed(1)}%`;return`交渉効率 +${(v*100).toFixed(1)}%`;}
      if(id==='barracks')return `兵数上限 ${this.troopCapacity().toLocaleString()}`;
      return({keep:`登用条件 Lv.${lv}・指示 ${this.commandMax()}回`,farm:`兵糧 +${Math.floor(lv*450*gov).toLocaleString()} /月`,market:`金銭 +${Math.floor(lv*180*gov).toLocaleString()} /月`,lumber:`木材 +${Math.floor(lv*170*gov).toLocaleString()} /月`,quarry:`石材 +${Math.floor(lv*130*gov).toLocaleString()} /月`,wall:`本拠防衛 +${(lv*.16*100).toFixed(0)}%`,academy:`研究上限 Lv.${Math.min(5,lv)}・費用効率 +${((lv-1)*2.5).toFixed(1)}%`})[id]||'';
    }
    diplomacyCost(){return{gold:Math.max(60,Math.round((this.state.clan==='毛利家'?420:600)/(1+this._facilityEffect('diplomacy'))))};}
    scoutCost(){return{gold:Math.max(20,Math.round(120/(1+this._facilityEffect('diplomacy'))))};}
    trainingCost(){return{gold:180,rice:250};}
    trainingGain(){return 14+(this.state.clan==='上杉家'?6:0)+Math.floor(this._facilityEffect('military')*4);}
    defensePower(id){const c=this.castle(id);if(!c)return 0;const s=this.state,condition=c.durability.fortificationFactor;if(c.owner!==s.clan)return Math.round(c.troops*(1+c.wall*.16*condition)*(1+(c.level-1)*.04*condition));const home=id===s.home,reinforce=Math.round(s.troops*(home?.45:.18)),wall=home?s.buildings.wall:c.wall;return Math.round((c.troops+reinforce)*(1+wall*.16*condition)*(1+s.tech.discipline*.06)*(['徳川家',ADMIN_ASSETS.clanName].includes(s.clan)?1.15:1)*(home?this._governorBonus('wall'):1)*(1+this._facilityEffect('defense')*condition)*(1+(c.level-1)*.04*condition));}

    facilityUpkeep(id,level=this.state.buildings[id]){
      if(!BUILDINGS.some(facility=>facility.id===id)||!Number.isInteger(level)||level<0||level>32)return null;
      return Object.fromEntries(RESOURCES.map(key=>[key,MAINTENANCE_RULES.facilityLevel[key]*level]));
    }
    castleUpkeep(id,level=this.state.castles[id]?.level){
      if(!Object.hasOwn(CASTLE_BY_ID,id)||!Number.isInteger(level)||level<1||level>this.castleLevelLimit(id))return null;
      const personalLevels=this.isStaff&&id===STAFF_BASE_ID?0:level;
      return Object.fromEntries(RESOURCES.map(key=>[key,MAINTENANCE_RULES.facilityLevel[key]*personalLevels+(key==='rice'?MAINTENANCE_RULES.castleRice:0)]));
    }
    branchUpkeep(id,level=this.state.branches.find(branch=>branch.id===id)?.level){
      const site=BRANCH_BY_ID[id],rule=site&&BRANCH_RULES.parents.find(parent=>parent.id===site.parentCastleId);
      if(!rule||!Number.isInteger(level)||level<0||level>rule.maxLevel)return null;
      return Object.fromEntries(RESOURCES.map(key=>[key,MAINTENANCE_RULES.facilityLevel[key]*level]));
    }
    governorPayroll(assignments=this.state.governors){
      const s=this.state,owned=new Set(s.officers),paid=new Set();
      // Staff saves may retain appointments to facilities that are not yet
      // built. Charge only an owned, known officer at a completed facility,
      // once per officer, without changing appointments or save data on reads.
      for(const building of BUILDINGS){
        const id=assignments?.[building.id];
        if(s.buildings[building.id]>0&&typeof id==='string'&&owned.has(id)&&this.officerMap[id])paid.add(id);
      }
      return{count:paid.size,perOfficer:MAINTENANCE_RULES.governorMonthlyGold,gold:paid.size*MAINTENANCE_RULES.governorMonthlyGold,rice:0,wood:0,stone:0};
    }
    maintenance({governors=this.state.governors}={}){
      const s=this.state,owned=this.ownedCastles(),personal=owned.filter(castle=>!(this.isStaff&&castle.id===STAFF_BASE_ID)),elapsed=elapsedMillis(s);
      const covert=s.covert,external=this._maintenanceExternalAt(elapsed),troops={field:s.troops,marching:this.reservedTroops(),castleGarrisons:personal.reduce((sum,castle)=>sum+castle.troops,0),branchGarrisons:0,retreating:0,covert:Object.values(covert?.reserves||{}).reduce((sum,count)=>sum+count,0)+(covert?.stations||[]).reduce((sum,row)=>sum+row.count,0)+(covert?.dispatches||[]).reduce((sum,row)=>sum+row.count,0),external:external.vacant+external.trade+external.alliance};
      const facilities={townLevels:BUILDINGS.reduce((sum,building)=>sum+s.buildings[building.id],0),castleLevels:personal.reduce((sum,castle)=>sum+castle.level,0),branchLevels:0,branchFacilityLevels:0,totalLevels:0};
      for(const branch of s.branches){
        // Explicit soldiers remain owned even after a fall or retreat. Parent-
        // derived support is a defense calculation, never a second troop stock.
        troops[branch.retreating?'retreating':'branchGarrisons']+=branch.stationedTroops||0;
        if(branch.level<1||branch.fallen||branch.retreating||s.castles[branch.parentCastleId]?.owner!==s.clan||branch.parentCastleId==='edo'&&!this.isAdmin)continue;
        facilities.branchLevels+=branch.level;
        for(const def of branchFacilityCatalog(branch.parentCastleId)){
          const times=branch.facilityCompletedAt?.[def.id];
          facilities.branchFacilityLevels+=times?times.filter(at=>at<=elapsed).length:branch.facilities?.[def.id]||0;
        }
      }
      facilities.totalLevels=facilities.townLevels+facilities.castleLevels+facilities.branchLevels+facilities.branchFacilityLevels;
      const totalTroops=Object.values(troops).reduce((sum,count)=>sum+count,0);
      // Round once on the whole finite force. Moving one soldier between owned
      // stocks must never change upkeep through per-stock rounding.
      const troopUpkeep={gold:Math.ceil(totalTroops/25),rice:Math.floor(totalTroops/25)*3+Math.ceil(totalTroops%25*3/25),wood:0,stone:0};
      const facilityUpkeep=Object.fromEntries(RESOURCES.map(key=>[key,facilities.totalLevels*MAINTENANCE_RULES.facilityLevel[key]+(key==='rice'?owned.length*MAINTENANCE_RULES.castleRice:0)]));
      const payroll=this.governorPayroll(governors),governorSalary=Object.fromEntries(RESOURCES.map(key=>[key,payroll[key]]));
      const totalUpkeep=Object.fromEntries(RESOURCES.map(key=>[key,troopUpkeep[key]+facilityUpkeep[key]+governorSalary[key]]));
      return{totalTroops,troops,facilities,troopUpkeep,facilityUpkeep,governorCount:payroll.count,governorSalary,totalUpkeep};
    }
    upkeepTroopSnapshot(){
      const s=this.state;
      return{army:s.troops,castles:Object.fromEntries(this.ownedCastles().map(c=>[c.id,c.troops])),branches:Object.fromEntries(s.branches.map(b=>[b.id,b.stationedTroops||0]))};
    }
    beginUpkeepTracking(){
      const tracking={records:[],overflow:false},active=UPKEEP_TRACKS.get(this)||new Set();let finished=false;
      active.add(tracking);UPKEEP_TRACKS.set(this,active);
      return()=>{if(!finished){finished=true;active.delete(tracking);if(!active.size)UPKEEP_TRACKS.delete(this);}return tracking;};
    }
    settleMonthlyUpkeep(){
      const s=this.state,upkeep=s.upkeep;
      if(upkeep.settledTurn>=s.turn)return{ok:true,changed:false,removed:0,reductions:{field:0,home:0,castles:0,branches:0},allocations:[],message:''};
      const result=this.rebalanceTroopsForUpkeep({monthlyTurn:s.turn});
      upkeep.settledTurn=s.turn;
      // The branch ledger lives on the server. Cumulative receipts preserve
      // these exact losses through synchronization, even if several months
      // pass before a save, or a branch is removed and built again.
      for(const allocation of result.allocations)if(allocation.kind==='branch')upkeep.branchReductions[allocation.id]=Math.min(Number.MAX_SAFE_INTEGER,(upkeep.branchReductions[allocation.id]||0)+allocation.removed);
      return result;
    }
    rebalanceTroopsForUpkeep({monthlyTurn=null}={}){
      const s=this.state,income=this.income(),reductions={field:0,home:0,castles:0,branches:0},allocations=[];
      const unchanged={ok:true,changed:false,removed:0,reductions,allocations,income,message:''};
      if(income.gold>=0&&income.rice>=0)return unchanged;
      // Ceil(N/25)<=gold and ceil(3*N/25)<=rice give exact integer
      // allowances. Facility upkeep and governor salaries remain fixed; only
      // the troop portion can decrease through this existing monthly rule.
      const gold=Math.max(0,income.gross.gold-income.facilityUpkeep.gold-(income.governorSalary?.gold||0)),rice=Math.max(0,income.gross.rice-income.facilityUpkeep.rice);
      const allowance=Math.min(gold*25,Math.floor(rice/3)*25+Math.floor((rice%3)*25/3));
      // Only an in-flight cloud write needs this small, bounded runtime journal.
      // It is never exported and ordinary positive-income ticks do no copying.
      const tracking=UPKEEP_TRACKS.get(this),recordBefore=tracking&&[...tracking].some(track=>!track.overflow)?this.upkeepTroopSnapshot():null;
      let remaining=Math.max(0,income.totalTroops-allowance);
      const take=(holder,key,kind,id,bucket)=>{
        const removed=Math.min(remaining,holder[key]||0);if(!removed)return;
        holder[key]-=removed;remaining-=removed;reductions[bucket]+=removed;allocations.push({kind,id,removed});
      };
      take(s,'troops','army','army','field');
      const view=STAFF_VIEW.get(this),origin=STAFF_ORIGIN.get(this);
      const home=this.isStaff&&s.home===STAFF_BASE_ID?(view?.personalHome||origin?.home||s.home):s.home;
      const castles=this.ownedCastles().filter(castle=>castle.id!==STAFF_BASE_ID).sort((a,b)=>(b.id===home)-(a.id===home)||(a.id<b.id?-1:a.id>b.id?1:0));
      for(const castle of castles){
        if(!remaining)break;const current=s.castles[castle.id],before=current.troops;
        take(current,'troops','castle',castle.id,castle.id===home?'home':'castles');
        if(current.troops===before)continue;
        // A staff member's personal holding is a backup, never a floor that
        // replenishes soldiers on reload, a new projection or a role change.
        if(view?.personalHome===castle.id){view.personalHomeCastle.troops=current.troops;if(view.base.personalHomeCastle)view.base.personalHomeCastle.troops=current.troops;}
        if(origin?.home===castle.id&&origin.homeCastle)origin.homeCastle.troops=current.troops;
        if(s.staffService?.personalHome===castle.id&&s.staffService.personalHomeCastle)s.staffService.personalHomeCastle.troops=current.troops;
      }
      for(const branch of [...s.branches].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)){
        if(!remaining)break;take(branch,'stationedTroops','branch',branch.id,'branches');
      }
      const removed=Object.values(reductions).reduce((sum,value)=>sum+value,0);if(!removed)return unchanged;
      if(reductions.branches)this._pruneBranches();
      if(recordBefore){
        const order=[{kind:'army',id:'army'},...castles.map(c=>({kind:'castle',id:c.id})),...Object.keys(recordBefore.branches).sort().map(id=>({kind:'branch',id}))];
        const count=(stocks,row)=>row.kind==='army'?stocks.army:stocks[row.kind==='castle'?'castles':'branches'][row.id]||0;
        const record={before:recordBefore,after:this.upkeepTroopSnapshot(),order,limit:order.reduce((sum,row)=>sum+count(recordBefore,row),0)-removed,...(monthlyTurn!==null?{monthlyTurn}:{})};
        for(const track of tracking){if(track.overflow)continue;if(track.records.length>=MAX_UPKEEP_TRACKS){track.overflow=true;track.records.length=0;}else track.records.push(record);}
      }
      const detail=[['field','手持ち'],['home','本拠の守備兵'],['castles','ほかの所有城の守備兵'],['branches','支拠点の配置兵']].filter(([key])=>reductions[key]>0).map(([key,label])=>label+reductions[key].toLocaleString()+'人').join(' → ');
      const message=`維持費の赤字に応じて兵${removed.toLocaleString()}人を自動調整しました（${detail}）。`;
      this.log(message,'upkeep');
      return{ok:true,changed:true,removed,reductions,allocations,income:this.income(),message};
    }
    income({governors:assignments=this.state.governors}={}){
      // Explicit appointments let previews use the exact production ledger
      // without temporarily changing state or losing instance-bound authority.
      const s=this.state,b=s.buildings,t=s.tech,governors=this._governorViews(assignments),owned=this.ownedCastles(),n=owned.length,expanded=owned.reduce((sum,c)=>sum+c.level-1,0),branchIncome=this.branchFacilityBonuses().income;
      const gold=Math.floor((180+b.keep*50+b.market*180*this._governorBonus('market',governors,assignments)+this._facilityEffect('gold',governors,assignments)+n*100+expanded*15)*(1+t.commerce*.12)*(s.clan==='織田家'?1.15:1))+branchIncome.gold;
      const grossRice=Math.floor((b.farm*450*this._governorBonus('farm',governors,assignments)+this._facilityEffect('rice',governors,assignments)+n*170+expanded*20)*(1+t.cultivation*.12)*(s.clan==='北条家'?1.15:1))+branchIncome.rice;
      const gross={gold,rice:grossRice,wood:Math.floor((b.lumber*170*this._governorBonus('lumber',governors,assignments)+this._facilityEffect('wood',governors,assignments)+n*40+expanded*5)*(1+t.forestry*.15))+branchIncome.wood,stone:Math.floor((b.quarry*130*this._governorBonus('quarry',governors,assignments)+this._facilityEffect('stone',governors,assignments)+n*30+expanded*5)*(1+t.masonry*.15))+branchIncome.stone};
      const maintenance=this.maintenance({governors:assignments}),rawNet=Object.fromEntries(RESOURCES.map(key=>[key,gross[key]-maintenance.totalUpkeep[key]])),{net:operatingNet,surplusAdjustment}=balanceSurplus(rawNet);
      const untilMonth=60-s.realtime.elapsed,forecastResources=Object.fromEntries(RESOURCES.map(key=>{const accrued=s.realtime.incomeRemainders[key]+operatingNet[key]*untilMonth/60;return[key,clamp(s.resources[key]+Math.trunc(accrued+Math.sign(accrued)*1e-9),0,ASSET_CAP)];})),repair=this.repairQuote({resources:forecastResources}),repairUpkeep=repair.cost,net=Object.fromEntries(RESOURCES.map(key=>[key,operatingNet[key]-repairUpkeep[key]]));
      // Full production funds troops, facilities and salaries before excess savings
      // taper. Existing sustainable forces and deficit signs never change just
      // because a developed town produces more than the ordinary savings rate.
      return{...net,upkeep:maintenance.totalUpkeep.rice,grossRice,gross,rawNet,surplusAdjustment,operatingNet,repairUpkeep,repair,net,troopUpkeep:maintenance.troopUpkeep,facilityUpkeep:maintenance.facilityUpkeep,governorCount:maintenance.governorCount,governorSalary:maintenance.governorSalary,totalTroops:maintenance.totalTroops,troopBreakdown:maintenance.troops,facilityLevels:maintenance.facilities};
    }
    costs(id,fromLevel){const b=BUILDINGS.find(b=>b.id===id);if(fromLevel===undefined){const jobs=this.isStaff?STAFF_VIEW.get(this)?.base.jobs||[]:this.state.jobs;fromLevel=Math.max(this.state.buildings[id]??0,...jobs.filter(j=>j.kind==='building'&&j.id===id).map(j=>j.targetLevel));}if(!b||!Number.isInteger(fromLevel)||fromLevel<0||fromLevel>32)return null;const level=fromLevel,mult=1+level*.32+level*level*.025,turns=level>=16?3:level>=6||id==='keep'?2:1;return this.scaleUpgradeCost({gold:Math.round(b.base.gold*mult),wood:Math.round(b.base.wood*mult),stone:Math.round(b.base.stone*mult),rice:0,turns,seconds:turns*60});}
    upgrade(id){
      if(this.isStaff)return fail('共同普請は通信で全スタッフへ反映します。');
      const g=this._guard();if(g)return g;
      const b=BUILDINGS.find(b=>b.id===id);if(!b)return fail('施設が見つかりません。');
      const chain=this.state.jobs.filter(j=>j.kind==='building'&&j.id===id),level=chain.at(-1)?.targetLevel??this.state.buildings[id];
      if(level>=32)return fail('この施設は最高レベルまで建設・予約されています。');
      const unlock=this.buildingUnlock(id);if(!unlock.ok)return fail(unlock.reason);
      if(!chain.length&&this.constructionChains()>=this.constructionSlots())return fail(`同時に建設・増築できる施設は${this.constructionSlots()}つまでです。`);
      const cost=this.costs(id,level);if(!this._canPay(cost))return fail('増築に必要な資源が足りません。');
      const startsInSeconds=chain.reduce((sum,j)=>sum+j.remainingSeconds,0);this._pay(cost);this.state.jobs.push({kind:'building',id,remaining:cost.turns,total:cost.turns,remainingSeconds:cost.turns*60,totalSeconds:cost.turns*60,targetLevel:level+1});
      return this._action(`${b.name}をLv.${level+1}へ${chain.length?'連続増築として予約':'建設・増築開始'}。${chain.length?'前の工事に続いて着工し、':''}工期${cost.turns*60}秒（通常速度）。`,'build',{queued:chain.length>0,targetLevel:level+1,startsInSeconds});
    }
    castleBenefits(id,level){const c=this.castle(id);if(!c)return null;const lv=level===undefined?c.level:level;if(!Number.isInteger(lv)||lv<1||lv>this.castleLevelLimit(id))return null;return{gold:100+(lv-1)*15,rice:170+(lv-1)*20,wood:40+(lv-1)*5,stone:30+(lv-1)*5,defensePercent:(lv-1)*4};}
    castleUpgradeCost(id){const c=this.castle(id);if(!c)return null;const lv=c.level-1,mult=1+lv*.3+lv*lv*.015,turns=c.level>=16?3:c.level>=6?2:1;return this.scaleUpgradeCost({gold:Math.round(700*mult),rice:0,wood:Math.round(280*mult),stone:Math.round(400*mult),turns,seconds:turns*60});}
    upgradeCastle(id){
      if(this.isStaff&&id===STAFF_BASE_ID)return fail('京都御所の共同普請は通信で全スタッフへ反映します。');
      const guard=this._guard();if(guard)return guard;const c=this.castle(id),s=this.state;
      if(!this.canOwnCastle(id))return fail(id===STAFF_BASE_ID?'京都御所はスタッフ専用の城です。':'江戸城は運営専用の城です。');
      if(!c||c.owner!==s.clan)return fail('領有している城だけを拡張できます。');
      if(c.level>=this.castleLevelLimit(id))return fail(`この城郭は最高のLv.${this.castleLevelLimit(id)}です。`);
      if(s.jobs.some(j=>j.kind==='castle'&&j.id===id))return fail('この城郭は拡張中です。');
      if(this.constructionChains()>=this.constructionSlots())return fail(`施設と城郭を合わせて同時に${this.constructionSlots()}件まで普請できます。`);
      const cost=this.castleUpgradeCost(id);if(!this._canPay(cost))return fail('城郭拡張に必要な資源が足りません。');
      this._pay(cost);s.jobs.push({kind:'castle',id,remaining:cost.turns,total:cost.turns,remainingSeconds:cost.seconds,totalSeconds:cost.seconds,targetLevel:c.level+1});
      return this._action(`${c.name}の城郭をLv.${c.level+1}へ拡張開始。あと${cost.seconds}秒（1倍速）で完成。`,'build');
    }
    recruitmentCost(id,modifiers){const o=this.baseOfficer(id);if(!o)return 0;const base=RANK_COST[this._baseGrantRank(id)]||180;return Math.round(base*(o.clan===this.state.clan?0.75:1)/(modifiers?.governor??this._governorBonus('keep'))/(modifiers?.diplomacy??(1+this._facilityEffect('diplomacy')*.2)));}
    canRecruitOfficer(id,modifiers){
      const o=this.baseOfficer(id);if(!o)return{ok:false,reason:'武将が見つかりません。',cost:0,requiredLevel:1};
      const cost=this.recruitmentCost(id,modifiers),requiredLevel=o.clan===this.state.clan?1:(RANK_KEEP[this._baseGrantRank(id)]||1);
      if(this.state.officers.includes(id))return{ok:false,reason:'すでに家臣です。',cost,requiredLevel};
      if(this.state.buildings.keep<requiredLevel)return{ok:false,reason:`登用には天守 Lv.${requiredLevel} が必要です。`,cost,requiredLevel};
      if(this.state.command<1)return{ok:false,reason:'指示の回復をお待ちください（1倍速で20秒に1回）。',cost,requiredLevel};
      if(this.state.resources.gold<cost)return{ok:false,reason:'登用に必要な金銭が足りません。',cost,requiredLevel};
      if(this.state.gameOver)return{ok:false,reason:'本拠を失っています。',cost,requiredLevel};
      return{ok:true,reason:'登用できます。',cost,requiredLevel};
    }
    canRecruitOfficers(ids){
      if(!ids.length)return[];
      // One read-only evaluation shares current facility bonuses. Nothing is
      // retained across evaluations; recruitOfficer still checks fresh state.
      const modifiers={governor:this._governorBonus('keep'),diplomacy:1+this._facilityEffect('diplomacy')*.2};
      return ids.map(id=>this.canRecruitOfficer(id,modifiers));
    }
    recruitOfficer(id){const can=this.canRecruitOfficer(id);if(!can.ok)return fail(can.reason);this._pay({gold:can.cost});this._grantOfficerVariant(id,this._baseGrantRank(id));this.state.prestige=Math.min(ASSET_CAP,this.state.prestige+3);return this._action(`${this.officer(id).name}が家臣に加わりました。`,'officer',{officer:this.officer(id)});}
    searchOfficers(){return this.roster.filter(o=>!this.state.officers.includes(o.id));}
    assignArmy(ids){
      if(!Array.isArray(ids)||ids.length>3||new Set(ids).size!==ids.length||ids.some(id=>!this.state.officers.includes(id)))return fail('家臣から最大3名を重複なく選んでください。');
      const stationed=this.state.branches.find(branch=>(branch.commanders||[]).some(id=>ids.includes(id)));if(stationed)return fail(`${BRANCH_BY_ID[stationed.id].name}に配置中の武将は、支拠点の配置を解除してから編成してください。`);
      this.state.army=[...ids];for(const key of Object.keys(this.state.governors))if(ids.includes(this.state.governors[key]))delete this.state.governors[key];
      this.log('出陣軍団の編成を更新しました。','army');return{ok:true,message:'軍団編成を更新しました。'};
    }
    assignGovernor(buildingId,officerId){
      if(!BUILDINGS.some(b=>b.id===buildingId))return fail('施設が見つかりません。');
      if(officerId===null||officerId===''){delete this.state.governors[buildingId];return{ok:true,message:'奉行の任命を解除しました。'};}
      if(!this.state.officers.includes(officerId))return fail('家臣から奉行を選んでください。');
      const stationed=this.state.branches.find(branch=>(branch.commanders||[]).includes(officerId));if(stationed)return fail(`${BRANCH_BY_ID[stationed.id].name}に配置中の武将は、支拠点の配置を解除してから任命してください。`);
      if(this.state.buildings[buildingId]<1)return fail('先にこの施設を建設してください。');
      for(const id of Object.keys(this.state.governors))if(this.state.governors[id]===officerId)delete this.state.governors[id];
      this.state.army=this.state.army.filter(id=>id!==officerId);this.state.governors[buildingId]=officerId;
      return{ok:true,message:`${this.officer(officerId).name}を${BUILDINGS.find(b=>b.id===buildingId).name}の奉行に任命しました。`};
    }
    planGovernorAssignments(){
      if(this.isStaff&&!STAFF_VIEW.get(this))return fail('京都御所の共同拠点を確認してから、奉行を配置してください。');
      const s=this.state,branchPlan=this.branchCommanderAutoPlan('all'),branchAssignments=branchPlan.ok?branchPlan.assignments:[],branchFormations=branchPlan.ok?branchPlan.formations:[],branchAssignedCount=branchAssignments.length,branchChangedCount=branchPlan.changedCount||0,branchReplacedCount=branchPlan.replacedCount||0,branchRetainedCount=branchPlan.retainedCount||0,branchReleasedCount=branchPlan.releasedCount||0,formations=new Map(branchFormations.map(formation=>[formation.branchId,formation.commanders])),facilities=BUILDINGS.filter(b=>s.buildings[b.id]>0),army=new Set([...s.army,...s.branches.flatMap(branch=>formations.get(branch.id)||branch.commanders||[])]);
      const officers=this.officerViews([...new Set(s.officers)].filter(id=>!army.has(id)).sort()).filter(Boolean);
      const facilityCount=facilities.length,candidateCount=officers.length,columnCount=Math.max(facilityCount,candidateCount),bonuses=facilities.map(b=>officers.map(o=>governorBonusForCategory(b.category,o)));
      // One point of actual suitability outweighs every possible retention
      // tie-break. Integer scores avoid rounding-dependent reassignment.
      const weights=facilities.map((b,row)=>Array.from({length:columnCount},(_,column)=>column<candidateCount?Math.round(bonuses[row][column]*400)*(facilityCount+1)+(s.governors[b.id]===officers[column].id?1:0):0));
      const choices=maximumGovernorAssignment(weights),governors={},officerById=new Map(officers.map(o=>[o.id,o]));
      const assignments=facilities.map((b,row)=>{
        const chosen=officers[choices[row]],officerId=chosen?.id||null,previousOfficerId=s.governors[b.id]||null;
        if(officerId)governors[b.id]=officerId;
        return{buildingId:b.id,officerId,previousOfficerId,bonus:governorBonusForCategory(b.category,chosen),previousBonus:governorBonusForCategory(b.category,officerById.get(previousOfficerId)||this.officer(previousOfficerId))};
      });
      // Start from the existing best suitability match, then keep salaries
      // within current recurring income. Removing the most expensive marginal
      // appointment first preserves gold-producing appointments that pay for
      // themselves, including when soldiers already cause an unavoidable deficit.
      const staffingVacantCount=facilityCount-Object.keys(governors).length;
      let projectedIncome=this.income({governors}),budgetLimitedCount=0;
      const noGovernorRawNetGold=projectedIncome.rawNet.gold<0?this.income({governors:{}}).rawNet.gold:projectedIncome.rawNet.gold;
      while(projectedIncome.rawNet.gold<0){
        let best=null;
        for(const assignment of assignments){
          if(!assignment.officerId)continue;
          const without={...governors};delete without[assignment.buildingId];
          const income=this.income({governors:without}),improvement=income.rawNet.gold-projectedIncome.rawNet.gold;
          // Whole-ledger rounding can make two individually neutral removals
          // save one gold together. Cross that plateau only when the current
          // plan is worse than leaving every governor post empty.
          if(improvement<0||improvement===0&&projectedIncome.rawNet.gold>=noGovernorRawNetGold)continue;
          if(!best||improvement>best.improvement||improvement===best.improvement&&(assignment.bonus<best.assignment.bonus||assignment.bonus===best.assignment.bonus&&assignment.buildingId<best.assignment.buildingId))best={assignment,income,improvement};
        }
        if(!best)break;
        delete governors[best.assignment.buildingId];best.assignment.officerId=null;best.assignment.bonus=1;
        projectedIncome=best.income;budgetLimitedCount++;
      }
      const projectedNetGold=projectedIncome.net.gold,projectedRawNetGold=projectedIncome.rawNet.gold,monthlySalary=projectedIncome.governorSalary.gold;
      // An explicit reassignment also returns dormant staff appointments on
      // unbuilt facilities to the candidate pool; saves and reloads never do so.
      const changedCount=[...new Set([...Object.keys(s.governors),...Object.keys(governors)])].filter(id=>(s.governors[id]||null)!==(governors[id]||null)).length;
      const clearedCount=Object.keys(s.governors).filter(id=>s.governors[id]&&!governors[id]).length,assignedCount=Object.keys(governors).length,vacantCount=facilityCount-assignedCount,changed=changedCount>0||branchChangedCount>0;
      const totalBonus=assignments.reduce((sum,a)=>sum+a.bonus,0),previousTotalBonus=assignments.reduce((sum,a)=>sum+a.previousBonus,0);
      const governorMessage=(!facilityCount?'建設済みの施設がありません。':!candidateCount?'軍団に編成されていない武将がいません。':changed?`奉行を${assignedCount}施設へ配置しました。`:'奉行はすでに適性に合う配置です。')+(staffingVacantCount?`候補不足のため${staffingVacantCount}施設は未任命です。`:'')+(budgetLimitedCount?`給与予算に合わせて${budgetLimitedCount}施設は未任命です。`:'');
      const message=(branchChangedCount?`支拠点の${branchChangedCount}枠を優先して編成し直しました。`:'')+governorMessage;
      return{ok:true,changed,governors,assignments,branchAssignments,branchFormations,branchAssignedCount,branchChangedCount,branchReplacedCount,branchRetainedCount,branchReleasedCount,facilityCount,candidateCount,assignedCount,vacantCount,staffingVacantCount,budgetLimitedCount,projectedNetGold,projectedRawNetGold,monthlySalary,changedCount,clearedCount,totalBonus,previousTotalBonus,message};
    }
    autoAssignGovernors(){const plan=this.planGovernorAssignments();if(plan.ok&&plan.changed){for(const formation of plan.branchFormations){const branch=this.state.branches.find(row=>row.id===formation.branchId);branch.commanders=[...formation.commanders];}this.state.governors={...plan.governors};}return plan;}
    _recruitCostMultiplier(){return(1-this.state.tech.conscription*.08)*(this.state.clan==='伊達家'?.85:1)/this._governorBonus('barracks');}
    recruitTroopCost(amount){const n=int(amount),m=this._recruitCostMultiplier();return{gold:Math.ceil(n*.32*m),rice:Math.ceil(n*.45*m),wood:0,stone:0};}
    _previewRecruitment(amount,income,multiplier,capacity){
      const cost={gold:Math.ceil(amount*.32*multiplier),rice:Math.ceil(amount*.45*multiplier),wood:0,stone:0},totalTroops=income.totalTroops+amount;
      const troopUpkeep={gold:Math.ceil(totalTroops/25),rice:Math.floor(totalTroops/25)*3+Math.ceil(totalTroops%25*3/25),wood:0,stone:0};
      const governorSalary=Object.fromEntries(RESOURCES.map(key=>[key,income.governorSalary?.[key]||0]));
      const totalUpkeep=Object.fromEntries(RESOURCES.map(key=>[key,income.facilityUpkeep[key]+troopUpkeep[key]+governorSalary[key]])),rawNet=Object.fromEntries(RESOURCES.map(key=>[key,income.gross[key]-totalUpkeep[key]])),{net}=balanceSurplus(rawNet);
      const balances=Object.fromEntries(RESOURCES.map(key=>[key,this.state.resources[key]-cost[key]])),reserve=Object.fromEntries(['gold','rice'].map(key=>[key,Math.max(ECONOMY_RULES.recruitReserveMinimum[key],totalUpkeep[key]*ECONOMY_RULES.recruitReserveMonths)]));
      return{amount,cost,balances,rawNet,net,troopUpkeep,governorSalary,totalUpkeep,totalTroops,reserve,sustainable:rawNet.gold>=0&&rawNet.rice>=0,affordable:RESOURCES.every(key=>balances[key]>=0),withinReserve:balances.gold>=reserve.gold&&balances.rice>=reserve.rice,withinCapacity:amount<=capacity};
    }
    previewRecruitment(amount,income=this.income()){
      if(!Number.isSafeInteger(amount)||amount<0||amount>20000)return null;
      return this._previewRecruitment(amount,income,this._recruitCostMultiplier(),Math.max(0,Math.min(20000,this.availableTroopCapacity()-this.state.troops)));
    }
    recruitmentBudget(income=this.income()){
      const multiplier=this._recruitCostMultiplier(),capacity=Math.max(0,Math.min(20000,this.availableTroopCapacity()-this.state.troops)),preview=amount=>this._previewRecruitment(amount,income,multiplier,capacity);
      const search=(limit,accept)=>{let low=0,high=limit;while(low<high){const middle=Math.ceil((low+high)/2);if(accept(preview(middle)))low=middle;else high=middle-1;}return low;};
      const goldBudget=Math.max(0,income.gross.gold-income.facilityUpkeep.gold-(income.governorSalary?.gold||0)),riceBudget=Math.max(0,income.gross.rice-income.facilityUpkeep.rice);
      const allowance=Math.min(goldBudget*25,Math.floor(riceBudget/3)*25+Math.floor((riceBudget%3)*25/3));
      const affordableMax=search(capacity,row=>row.affordable),sustainableMax=Math.min(capacity,Math.max(0,allowance-income.totalTroops)),recommendedMax=search(Math.min(affordableMax,sustainableMax),row=>row.withinReserve&&row.sustainable);
      return{affordableMax,sustainableMax,recommendedMax,reserveMonths:ECONOMY_RULES.recruitReserveMonths,minimumReserve:{...ECONOMY_RULES.recruitReserveMinimum}};
    }
    recruitTroops(amount){
      const g=this._guard();if(g)return g;const n=int(amount);if(!Number.isFinite(Number(amount))||n<100||n>20000)return fail('募兵数は100〜20,000人で指定してください。');
      if(this.state.troops+n>this.availableTroopCapacity())return fail(`兵数上限は${this.troopCapacity().toLocaleString()}人です。兵舎を増築してください。`);
      const cost=this.recruitTroopCost(n);if(!this._canPay(cost))return fail('募兵に必要な金銭・兵糧が足りません。');
      this._pay(cost);this.state.troops+=n;
      // Recruitment dilutes morale down to 25. A depleted force already below
      // that threshold keeps its morale until actual recovery or training.
      this.state.morale=Math.min(this.state.morale,Math.max(25,this.state.morale-Math.ceil(n/700)));
      return this._action(`${n.toLocaleString()}人を募兵しました。`,'army');
    }
    train(){const g=this._guard();if(g)return g;if(this.state.morale>=100)return fail('士気は最高です。');const cost=this.trainingCost();if(!this._canPay(cost))return fail('訓練には金銭180・兵糧250が必要です。');this._pay(cost);const gain=this.trainingGain();this.state.morale=clamp(this.state.morale+gain,0,100);return this._action(`軍団を訓練。士気が${this.state.morale}になりました。`,'army');}
    researchCost(id){if(!TECHS.some(t=>t.id===id))return null;const lv=this.state.tech[id],divisor=this._governorBonus('academy')*(1+(this.state.buildings.academy-1)*.025+this._facilityEffect('research')),turns=lv>=2?2:1;return this.scaleUpgradeCost({gold:Math.round((650+lv*420)/divisor),wood:Math.round((180+lv*120)/divisor),stone:Math.round((120+lv*100)/divisor),rice:0,turns,seconds:turns*60});}
    research(id){const g=this._guard();if(g)return g;const t=TECHS.find(t=>t.id===id);if(!t)return fail('技術が見つかりません。');if(this.state.tech[id]>=t.max)return fail('この技術は研究を極めています。');if(this.state.tech[id]>=this.state.buildings.academy)return fail('先に学問所を増築してください。');if(this.state.jobs.some(j=>j.kind==='research'))return fail('研究は同時に1つまで進められます。');const cost=this.researchCost(id);if(!this._canPay(cost))return fail('研究に必要な資源が足りません。');this._pay(cost);this.state.jobs.push({kind:'research',id,remaining:cost.turns,total:cost.turns,remainingSeconds:cost.turns*60,totalSeconds:cost.turns*60,targetLevel:this.state.tech[id]+1});return this._action(`${t.name}の研究を開始。あと${cost.turns*60}秒（通常速度）で完成。`,'research');}
    diplomacy(castleId){const g=this._guard();if(g)return g;const c=this.castle(castleId);if(!c||c.owner===this.state.clan)return fail('外交先の他勢力を選んでください。');if((this.state.treaties[c.owner]||0)>this.state.turn)return fail('すでに同盟を結んでいます。');const active=Object.values(this.state.treaties).filter(t=>t>this.state.turn).length;if(active>=2)return fail('同時に結べる同盟は2勢力までです。');const cost=this.diplomacyCost(castleId);if(!this._canPay(cost))return fail(`同盟には金銭${cost.gold}が必要です。`);this._pay(cost);this.state.treaties[c.owner]=this.state.turn+6;return this._action(`${c.owner}と6か月の同盟を締結しました。`,'diplomacy');}
    scout(castleId){const g=this._guard();if(g)return g;const c=this.castle(castleId);if(!c||c.owner===this.state.clan)return fail('偵察する敵城を選んでください。');if(!this.adjacentTargets().some(t=>t.id===castleId))return fail('偵察できるのは自領に隣接する敵城です。');const cost=this.scoutCost(castleId);if(!this._canPay(cost))return fail(`偵察には金銭${cost.gold}が必要です。`);this._pay(cost);this.state.scouted[castleId]=this.state.turn+3;return this._action(`${c.name}を偵察。3か月間、この城への攻撃力が10%増加します。`,'scout');}
    armyStats(ids=this.state.army){const arr=ids.map(id=>this.officer(id)).filter(Boolean),health=projectOfficerHealth(this.state);if(!arr.length)return{lead:35,valor:35,intellect:35,politics:35,count:0};return{...Object.fromEntries(['lead','valor','intellect','politics'].map(key=>[key,Math.round(arr.reduce((sum,o)=>sum+o[key]*officerCombatFactor({officerHealth:health},o.id),0)/arr.length)])),count:arr.length};}
    _covertElapsed(){return Math.floor(this.state.turn*60000+this.state.realtime.elapsed*1000);}
    _covertSourceAvailable(id){return MAJOR_CITY_IDS.includes(id)&&this.state.castles[id]?.owner===this.state.clan&&(id!=='edo'||this.isAdmin)&&(id!==STAFF_BASE_ID||this.isStaff);}
    covertStatus(){
      const s=this.state,c=s.covert||(s.covert=covertState(undefined,s.walking.campaignId)),capacity=Math.max(1,Math.min(COVERT_RULES.maxCount,Math.floor(this.troopCapacity()/COVERT_RULES.capacityDivisor)));
      const sources=MAJOR_CITY_IDS.filter(id=>this._covertSourceAvailable(id)||c.reserves[id]||c.stations.some(v=>v.sourceCastleId===id)||c.dispatches.some(v=>v.sourceCastleId===id)).map(id=>{const unitType=id==='edo'?'ninja':'ashigaru';return{castleId:id,name:CASTLE_BY_ID[id].name,unitType,unitName:unitType==='ninja'?'忍者':'足軽',reserve:c.reserves[id],stationed:c.stations.filter(v=>v.sourceCastleId===id).reduce((sum,v)=>sum+v.count,0),inTransit:c.dispatches.filter(v=>v.sourceCastleId===id).reduce((sum,v)=>sum+v.count,0),capacity,hireCost:copy(COVERT_RULES.hire[unitType]),available:this._covertSourceAvailable(id)};});
      const eligible=(incident,station)=>station.sourceCastleId===incident.sourceCastleId&&station.createdElapsedMs<=incident.occurredElapsedMs&&(incident.kind==='field'?station.battleCursor<incident.battleCursor:station.deploymentSequence<incident.stationSequence);
      return{version:1,campaignId:c.campaignId,sequence:c.sequence,rules:{...copy(COVERT_RULES),canAttackEdoFromKyoto:this.isCourtEmperor===true},sources,targets:CASTLES.map(v=>({kind:'castle',castleId:v.id,name:v.name})),stations:copy(c.stations),dispatches:c.dispatches.map(v=>({...copy(v),timeBasis:'world',remainingMs:Math.max(0,v.arrivesElapsedMs-this._covertElapsed())})),reports:copy(c.reports),incidents:c.incidents.filter(v=>!v.used).map(v=>({...copy(v),available:this._covertSourceAvailable(v.sourceCastleId)&&c.stations.some(st=>eligible(v,st)),stationIds:c.stations.filter(st=>eligible(v,st)).map(st=>st.id),expiresElapsedMs:null})),history:copy(c.history)};
    }
    _covertStart(action,intent,options={}){
      const c=this.state.covert||(this.state.covert=covertState(undefined,this.state.walking.campaignId)),requestId=options.requestId??newWalkingCampaign();
      if(!walkingId(requestId))return covertError('INVALID_INPUT','操作番号が正しくありません。');
      const signature=value=>JSON.stringify([value.action,value.sourceCastleId,value.count,value.mode,value.target?.kind,value.target?.playerId,value.target?.castleId,value.stationId,value.incidentId]);
      const pendingDispatch=c.dispatches.find(v=>v.requestId===requestId),old=c.history.find(v=>v.requestId===requestId)||(pendingDispatch?{...copy(pendingDispatch),action:pendingDispatch.phase==='returning'&&pendingDispatch.mode==='station'?'recall':'dispatch',accepted:true,dispatchId:pendingDispatch.id,march:copy(pendingDispatch),status:'marching'}:null);
      if(old){const compare={...old};for(const key of ['sourceCastleId','count','mode','target','stationId','incidentId'])if(intent[key]===undefined)delete compare[key];if(signature(compare)!==signature({action,...intent}))return covertError('REQUEST_ID_REUSED','この操作番号は別の派遣に使用されています。');return{ok:true,idempotent:true,result:copy(old),...(old.accepted?{accepted:true,marching:true,march:copy(old.march)}:{}),message:old.accepted?'この部隊はすでに進軍中です。':'記録済みの結果を表示しました。'};}
      if(options.campaignId!==undefined&&options.campaignId!==c.campaignId)return covertError('COVERT_SCOPE_CHANGED','物語が切り替わりました。派遣画面を更新してください。');
      if(options.sequence!==undefined&&options.sequence!==c.sequence)return covertError('COVERT_STATE_CHANGED','派遣部隊が更新されました。最新の状態を確認してください。');
      if(c.sequence>=10000000)return covertError('COVERT_LIMIT','この物語の派遣記録が上限に達しました。');
      if(action!=='recall'){const guard=this._guard();if(guard)return{...guard,code:'COVERT_UNAVAILABLE'};}
      return{pending:true,requestId,campaignId:c.campaignId,sequence:c.sequence,action,...intent};
    }
    _covertCommit(start,extra,message){
      const {pending,...base}=start,result={...base,...extra,createdElapsedMs:this._covertElapsed()},c=this.state.covert;c.sequence++;
      c.history.unshift(copy(result));c.history=c.history.slice(0,COVERT_RULES.historyLimit);
      if(result.commandCost)this.state.command-=result.commandCost;this.log(message,'covert');
      return{ok:true,idempotent:false,message,result:copy(result)};
    }
    hireCovert(sourceCastleId,count,options={}){
      const start=this._covertStart('hire',{sourceCastleId,count},options);if(!start.pending)return start;
      const source=this.covertStatus().sources.find(v=>v.castleId===sourceCastleId&&v.available);
      if(!source)return covertError('COVERT_SOURCE_UNAVAILABLE','部隊を雇用できる大都市拠点を選んでください。');
      if(!Number.isSafeInteger(count)||count<1||count>COVERT_RULES.maxCount)return covertError('INVALID_COUNT','雇用人数は1〜20,000人の整数で指定してください。');
      if(source.reserve+source.stationed+source.inTransit+count>source.capacity)return covertError('COVERT_CAPACITY','この拠点の派遣部隊上限を超えます。兵舎などを増築してください。');
      const cost={gold:count*source.hireCost.gold,rice:count*source.hireCost.rice};if(!this._canPay(cost))return covertError('INSUFFICIENT_RESOURCES','雇用に必要な金銭・兵糧が足りません。');
      this._pay(cost);this.state.covert.reserves[sourceCastleId]+=count;
      return this._covertCommit(start,{goldCost:cost.gold,foodCost:cost.rice,commandCost:1},source.name+'で'+source.unitName+count.toLocaleString()+'人を雇用しました。');
    }
    _covertTargetSnapshot(target,options){
      if(target.kind==='player'){if(!options.targetSnapshot)throw new Error('共有拠点への派遣はオンラインで行ってください。');return covertSnapshot(options.targetSnapshot);}
      const c=this.state.castles[target.castleId];return covertSnapshot({level:c.level,troops:0,garrison:c.troops,wall:c.wall,defensePower:Math.round(this.defensePower(target.castleId))});
    }
    dispatchCovert(sourceCastleId,target,count,mode='scout',options={}){
      let dest;try{dest=covertTarget(options.canonicalTarget||target);}catch{return covertError('INVALID_TARGET','派遣先を選んでください。');}
      const start=this._covertStart('dispatch',{sourceCastleId,target:dest,count,mode},options);if(!start.pending)return start;
      const c=this.state.covert,source=this.covertStatus().sources.find(v=>v.castleId===sourceCastleId&&v.available);
      if(!source)return covertError('COVERT_SOURCE_UNAVAILABLE','派遣できる大都市拠点を選んでください。');
      if(!['scout','station'].includes(mode)||!Number.isSafeInteger(count)||count<1||count>COVERT_RULES.maxCount)return covertError('INVALID_INPUT','派遣方法と1〜20,000人の人数を指定してください。');
      if(count>source.reserve)return covertError('INSUFFICIENT_FORCE','拠点で待機している部隊が足りません。');
      if(mode==='station'&&c.stations.length>=COVERT_RULES.stationLimit)return covertError('COVERT_STATION_LIMIT','常駐部隊が上限です。先に帰還させてください。');
      let snapshot;try{snapshot=this._covertTargetSnapshot(dest,options);}catch(error){return covertError('ONLINE_REQUIRED',error.message);}
      const rule=COVERT_RULES[mode],foodCost=rule.riceBase+Math.ceil(count*rule.ricePerUnit);if(this.state.resources.rice<foodCost)return covertError('INSUFFICIENT_RESOURCES','派遣に必要な兵糧が足りません。');
      this._pay({rice:foodCost});const key=covertHash(c.campaignId)+'_'+c.sequence,observedElapsedMs=this._covertElapsed(),report={id:'cr_'+key,sourceCastleId,target:dest,observedElapsedMs,snapshot};
      c.reports.unshift(report);c.reports=c.reports.slice(0,COVERT_RULES.reportLimit);
      let stationId;
      if(mode==='station'){stationId='cs_'+key;c.reserves[sourceCastleId]-=count;c.stations.push({id:stationId,sourceCastleId,unitType:source.unitType,unitName:source.unitName,count,target:dest,createdElapsedMs:observedElapsedMs,battleCursor:Number.isSafeInteger(options.battleCursor)?Math.max(0,options.battleCursor):0,deploymentSequence:c.sequence});}
      else if(dest.kind==='castle')this.state.scouted[dest.castleId]=this.state.turn+3;
      return this._covertCommit(start,{foodCost,commandCost:1,report,...(stationId?{stationId}:{})},dest.name+(mode==='station'?'に部隊を常駐させ、状況を確認しました。':'の状況を調査しました。部隊は全員帰還しました。'));
    }
    departCovertDispatch(sourceCastleId,target,count,mode='scout',options={}){
      let dest;try{dest=covertTarget(options.canonicalTarget||target);}catch{return covertError('INVALID_TARGET','派遣先を選んでください。');}
      const start=this._covertStart('dispatch',{sourceCastleId,target:dest,count,mode},options);if(!start.pending)return start;
      const c=this.state.covert,source=this.covertStatus().sources.find(v=>v.castleId===sourceCastleId&&v.available);
      if(!source)return covertError('COVERT_SOURCE_UNAVAILABLE','派遣できる大都市拠点を選んでください。');
      if(!['scout','station'].includes(mode)||!Number.isSafeInteger(count)||count<1||count>COVERT_RULES.maxCount)return covertError('INVALID_INPUT','派遣方法と1〜20,000人の人数を指定してください。');
      if(count>source.reserve)return covertError('INSUFFICIENT_FORCE','拠点で待機している部隊が足りません。');
      if(c.dispatches.length>=COVERT_RULES.stationLimit||mode==='station'&&c.stations.length+c.dispatches.filter(v=>v.mode==='station'&&v.phase!=='returning').length>=COVERT_RULES.stationLimit)return covertError('COVERT_STATION_LIMIT','派遣部隊が上限です。到着または帰還をお待ちください。');
      if(dest.kind==='player'){try{this._covertTargetSnapshot(dest,options);}catch(error){return covertError('ONLINE_REQUIRED',error.message);}}
      const travel=travelRules()?.plan({sourceCastleId,targetCastleId:dest.castleId});if(!travel)return covertError('INVALID_TARGET','派遣先までの距離を確認できません。');
      const rule=COVERT_RULES[mode],foodCost=rule.riceBase+Math.ceil(count*rule.ricePerUnit);if(this.state.resources.rice<foodCost)return covertError('INSUFFICIENT_RESOURCES','派遣に必要な兵糧が足りません。');
      const departedElapsedMs=this._covertElapsed(),id='cd_'+covertHash(c.campaignId)+'_'+c.sequence,march={version:1,authority:'local',kind:'covert',phase:'outbound',id,requestId:start.requestId,campaignId:c.campaignId,sequence:c.sequence,cycle:this.state.cycle.index,clan:this.state.clan,sourceCastleId,targetCastleId:dest.castleId,troops:count,count,mode,target:dest,foodCost,commandCost:1,departedElapsedMs,arrivesElapsedMs:departedElapsedMs+travel.durationMs,travel,battleCursor:Number.isSafeInteger(options.battleCursor)?Math.max(0,options.battleCursor):0};
      this._pay({rice:foodCost});c.reserves[sourceCastleId]-=count;c.dispatches.push(march);
      const result=this._covertCommit(start,{accepted:true,status:'marching',dispatchId:id,march:copy(march),foodCost,commandCost:1},`${source.name}から${dest.name}へ${source.unitName}${count.toLocaleString()}人を派遣しました。到着まで${travelRules().formatDuration(travel.durationMs)}（1倍速）。`);
      return{...result,accepted:true,marching:true,march:copy(march)};
    }
    _completeCovertDispatch(dispatch,{snapshot,battleCursor,cancelMessage}={}){
      const s=this.state,c=s.covert,key=covertHash(c.campaignId)+'_'+dispatch.sequence,elapsed=this._covertElapsed(),returning=dispatch.phase==='returning',previous=c.history.find(v=>v.requestId===dispatch.requestId);
      c.dispatches=c.dispatches.filter(v=>v.id!==dispatch.id);
      const result={...(previous?copy(previous):{}),requestId:dispatch.requestId,campaignId:c.campaignId,sequence:dispatch.sequence,action:returning&&dispatch.mode==='station'?'recall':'dispatch',sourceCastleId:dispatch.sourceCastleId,target:copy(dispatch.target),count:dispatch.count,mode:dispatch.mode,...(dispatch.stationId?{stationId:dispatch.stationId}:{}),foodCost:previous?.foodCost??dispatch.foodCost,commandCost:previous?.commandCost??dispatch.commandCost,createdElapsedMs:previous?.createdElapsedMs??dispatch.departedElapsedMs,accepted:false,dispatchId:dispatch.id,march:copy(dispatch),status:cancelMessage?'cancelled':'resolved',resolvedElapsedMs:elapsed};
      let message;
      if(cancelMessage){c.reserves[dispatch.sourceCastleId]+=dispatch.count;s.resources.rice=Math.min(ASSET_CAP,s.resources.rice+dispatch.foodCost);s.command=Math.min(this.commandMax(),s.command+dispatch.commandCost);message=cancelMessage+(returning?' 帰還中の部隊を待機人数へ戻しました。':' 派遣人数と出陣費用を戻しました。');}
      else if(returning){c.reserves[dispatch.sourceCastleId]+=dispatch.count;message=CASTLE_BY_ID[dispatch.sourceCastleId].name+'へ部隊'+dispatch.count.toLocaleString()+'人が帰還しました。再び派遣できます。';}
      else{
        const report={id:'cr_'+key,sourceCastleId:dispatch.sourceCastleId,target:copy(dispatch.target),observedElapsedMs:elapsed,snapshot:covertSnapshot(snapshot)};c.reports.unshift(report);c.reports=c.reports.slice(0,COVERT_RULES.reportLimit);result.report=copy(report);
        if(dispatch.mode==='station'){
          const stationId='cs_'+key;result.stationId=stationId;c.stations.push({id:stationId,sourceCastleId:dispatch.sourceCastleId,unitType:dispatch.sourceCastleId==='edo'?'ninja':'ashigaru',unitName:dispatch.sourceCastleId==='edo'?'忍者':'足軽',count:dispatch.count,target:copy(dispatch.target),createdElapsedMs:elapsed,battleCursor:Number.isSafeInteger(battleCursor)?Math.max(0,battleCursor):dispatch.battleCursor,deploymentSequence:Math.max(0,c.sequence-1)});
          message=dispatch.target.name+'へ部隊が到着し、常駐を開始しました。到着時の状況を報告しました。';
        }else{
          if(dispatch.target.kind==='castle')s.scouted[dispatch.target.castleId]=s.turn+3;
          // The return starts at the scheduled arrival, so reopening an offline
          // save or a delayed server poll never adds an extra journey's wait.
          const travel=travelRules().plan({sourceCastleId:dispatch.target.castleId,targetCastleId:dispatch.sourceCastleId}),departedElapsedMs=dispatch.arrivesElapsedMs;
          const back={...copy(dispatch),phase:'returning',foodCost:0,commandCost:0,travel,departedElapsedMs,arrivesElapsedMs:departedElapsedMs+travel.durationMs};
          c.dispatches.push(back);result.accepted=true;result.status='marching';result.march=copy(back);delete result.resolvedElapsedMs;
          message=dispatch.target.name+'の偵察報告が届きました。部隊は'+CASTLE_BY_ID[dispatch.sourceCastleId].name+'へ帰還中です。帰還後に再び派遣できます。';
        }
      }
      const index=c.history.findIndex(v=>v.requestId===dispatch.requestId);if(index>=0)c.history[index]=copy(result);this.log(message,'covert');
      if(result.accepted&&result.march.arrivesElapsedMs<=elapsed)return this._completeCovertDispatch(result.march);
      return{...copy(result),message};
    }
    _cancelCovertDispatches(message){return(this.state.covert.dispatches||[]).filter(v=>v.authority!=='server').map(dispatch=>this._completeCovertDispatch(dispatch,{cancelMessage:message}));}
    cancelCovertDispatch(id,message,{authoritative=false}={}){const dispatch=(this.state.covert.dispatches||[]).find(v=>v.id===id);if(!dispatch||dispatch.authority==='server'&&!authoritative)return null;return this._completeCovertDispatch(dispatch,{cancelMessage:message||'派遣を中止し、部隊が帰還しました。'});}
    settleCovertDue({targetSnapshots={},authoritative=false}={}){
      const s=this.state,results=[];
      for(const dispatch of [...(s.covert.dispatches||[])]){
        if(dispatch.authority==='server'&&!authoritative)continue;
        if(dispatch.campaignId!==s.walking.campaignId||dispatch.cycle!==s.cycle.index||dispatch.clan!==s.clan||!this._covertSourceAvailable(dispatch.sourceCastleId)||s.gameOver){results.push(this._completeCovertDispatch(dispatch,{cancelMessage:'派遣元や周回の変更により部隊が帰還しました。'}));continue;}
        if(this._covertElapsed()<dispatch.arrivesElapsedMs)continue;
        if(dispatch.phase==='returning'){results.push(this._completeCovertDispatch(dispatch));continue;}
        let snapshot,battleCursor;
        if(dispatch.target.kind==='player'){
          const key=dispatch.target.playerId+':'+dispatch.target.castleId,value=targetSnapshots instanceof Map?targetSnapshots.get(key):targetSnapshots[key];if(!value)continue;
          try{snapshot=covertSnapshot(value.snapshot||value);battleCursor=value.battleCursor;}catch{continue;}
        }else snapshot=this._covertTargetSnapshot(dispatch.target,{});
        results.push(this._completeCovertDispatch(dispatch,{snapshot,battleCursor}));
      }
      return results;
    }
    recallCovert(stationId,options={}){
      const start=this._covertStart('recall',{stationId},options);if(!start.pending)return start;
      const c=this.state.covert,station=c.stations.find(v=>v.id===stationId);if(!station)return covertError('COVERT_STATION_NOT_FOUND','常駐部隊が見つかりません。');
      if(c.dispatches.length>=COVERT_RULES.stationLimit)return covertError('COVERT_STATION_LIMIT','移動中の部隊が上限です。到着または帰還をお待ちください。');
      const travel=travelRules()?.plan({sourceCastleId:station.target.castleId,targetCastleId:station.sourceCastleId});if(!travel)return covertError('INVALID_TARGET','帰還先までの距離を確認できません。');
      const departedElapsedMs=this._covertElapsed(),id='cd_'+covertHash(c.campaignId)+'_'+c.sequence,march={version:1,authority:'local',kind:'covert',phase:'returning',id,requestId:start.requestId,campaignId:c.campaignId,sequence:c.sequence,cycle:this.state.cycle.index,clan:this.state.clan,sourceCastleId:station.sourceCastleId,targetCastleId:station.target.castleId,troops:station.count,count:station.count,mode:'station',stationId,target:copy(station.target),foodCost:0,commandCost:0,departedElapsedMs,arrivesElapsedMs:departedElapsedMs+travel.durationMs,travel,battleCursor:station.battleCursor};
      c.stations=c.stations.filter(v=>v.id!==stationId);c.dispatches.push(march);
      const result=this._covertCommit(start,{sourceCastleId:station.sourceCastleId,target:station.target,count:station.count,mode:'station',accepted:true,status:'marching',dispatchId:id,march:copy(march),foodCost:0,commandCost:0},station.unitName+station.count.toLocaleString()+'人が'+CASTLE_BY_ID[station.sourceCastleId].name+'への帰還を開始しました。到着まで'+travelRules().formatDuration(travel.durationMs)+'（1倍速）。');
      return{...result,accepted:true,marching:true,march:copy(march)};
    }
    _recordCovertIncident(sourceCastleId,fromCastleId){
      if(!this._covertSourceAvailable(sourceCastleId))return;
      const c=this.state.covert,elapsed=this._covertElapsed(),id='ci_'+covertHash(c.campaignId)+'_'+this.state.turn+'_'+fromCastleId+'_'+sourceCastleId;
      if(c.incidents.some(v=>v.id===id)||!c.stations.some(v=>v.sourceCastleId===sourceCastleId&&v.createdElapsedMs<=elapsed))return;
      c.incidents.unshift({id,sourceCastleId,kind:'cpu',occurredElapsedMs:elapsed,used:false,battleCursor:0,stationSequence:c.sequence});c.incidents=c.incidents.slice(0,128);
    }
    retaliateCovert(stationId,incidentId,options={}){
      const start=this._covertStart('retaliate',{stationId,incidentId},options);if(!start.pending)return start;
      const c=this.state.covert,station=c.stations.find(v=>v.id===stationId),incident=c.incidents.find(v=>v.id===incidentId);
      if(!station)return covertError('COVERT_STATION_NOT_FOUND','常駐部隊が見つかりません。');
      if(!this._covertSourceAvailable(station.sourceCastleId))return covertError('COVERT_SOURCE_UNAVAILABLE','派遣元を現在領有している必要があります。');
      const court=this.courtAttackPermission(station.sourceCastleId,station.target.castleId);if(!court.ok)return covertError(court.code,court.message);
      if(!incident||incident.used||incident.sourceCastleId!==station.sourceCastleId||incident.occurredElapsedMs<station.createdElapsedMs||(incident.kind==='field'?incident.battleCursor<=station.battleCursor:station.deploymentSequence>=incident.stationSequence))return covertError('COVERT_INCIDENT_REQUIRED','常駐後に派遣元が攻撃されたとき、一度だけ反撃できます。');
      const target=station.target,npc=target.kind==='castle'?this.state.castles[target.castleId]:null;
      if(npc?.owner===this.state.clan)return covertError('INVALID_TARGET','自分の領地には反撃できません。');
      if(npc&&(this.state.treaties[npc.owner]||0)>this.state.turn)return covertError('ALLIED_TARGET','同盟期間中の拠点には反撃できません。');
      let snapshot;try{snapshot=this._covertTargetSnapshot(target,options);}catch(error){return covertError('ONLINE_REQUIRED',error.message);}
      const localGate=target.kind==='castle'?this.parentAttackPermission(target.castleId):{ok:true},remoteBranches=options.targetSnapshot?.activeBranches;if(!localGate.ok||target.kind==='player'&&(Array.isArray(remoteBranches)?remoteBranches.length>0:Number.isSafeInteger(remoteBranches)&&remoteBranches>0))return covertError('BRANCHES_REQUIRED','大都市拠点への反撃は、残っている支拠点をすべて先に陥落させてから実行できます。');
      const rule=COVERT_RULES.retaliate,foodCost=rule.riceBase+Math.ceil(station.count*rule.ricePerUnit);if(this.state.resources.rice<foodCost)return covertError('INSUFFICIENT_RESOURCES','反撃に必要な兵糧が足りません。');
      const deployed=station.count,attackPower=Math.max(1,Math.round(deployed*(station.unitType==='ninja'?3:2)*(1+this.state.tech.discipline*.06))),defensePower=Math.max(1,snapshot.defensePower),ratio=attackPower/defensePower;
      const chance=clamp(.5+Math.log(ratio)*.35,.05,.95),won=this.random()<chance,ourLost=Math.min(deployed,Math.max(1,Math.ceil(deployed*(won?.08:.2)))),protectedTarget=['edo',STAFF_BASE_ID].includes(target.castleId);
      const defenderLost={troops:protectedTarget?0:Math.min(Math.floor(snapshot.troops*.1),Math.floor(deployed*(won?.08:.03))),garrison:protectedTarget?0:Math.min(Math.floor(snapshot.garrison*.1),Math.max(1,Math.floor(deployed*(won?.16:.06))))};
      if(npc)npc.troops=Math.max(0,npc.troops-defenderLost.garrison);
      station.count-=ourLost;if(!station.count)c.stations=c.stations.filter(v=>v.id!==stationId);incident.used=true;this._pay({rice:foodCost});
      const battle={won,captured:false,deployed,ourLost,survivors:deployed-ourLost,attackPower,defensePower,defenderLost,...(npc&&!protectedTarget?{durability:this._damageCastleDurability(target.castleId,{won,ratio,captured:false})}:{})};
      return this._covertCommit(start,{sourceCastleId:station.sourceCastleId,target:station.target,count:deployed,foodCost,commandCost:1,battle},target.name+'の常駐部隊が反撃しました。'+(won?'戦闘に勝利。':'戦闘に敗北。')+'生存兵は現地に駐留。'+'損失'+ourLost.toLocaleString()+'人。');
    }
    roamingEncounters(){const scale={easy:.85,normal:1,hard:1.15}[this.state.difficulty];return ROAMING_ENCOUNTERS.map(e=>({...copy(e),enemyTroops:Math.round(e.troops*scale),enemyPower:Math.round(e.troops*scale*e.power)}));}
    previewRoamingBattle(encounterId,tactic='balanced',troops=Math.min(this.state.troops,this.troopCapacity()),options={}){
      const s=this.state,ctx=MARCH_CONTEXT.get(this),t=ROAMING_TACTICS.find(t=>t.id===tactic),maxTroops=Math.max(0,Math.min(s.troops,ctx?ASSET_CAP:this.availableTroopCapacity(),1000000));
      let e=this.roamingEncounters().find(e=>e.id===encounterId);
      if(options.deploymentUnit!==undefined){
        const unit=options.deploymentUnit;
        if(!validRoamingUnit(unit,encounterId)||!e)return{ok:false,message:'地図の配置部隊を選び直してください。',maxTroops};
        if(unit.available===false)return{ok:false,message:'この部隊は再出現を待っています。別の部隊を選んでください。',maxTroops};
        const factor=Math.min(1,unit.troops/e.troops),scale={easy:.85,normal:1,hard:1.15}[s.difficulty];
        e={...e,enemyTroops:unit.troops,enemyPower:Math.max(1,Math.round(unit.troops*e.power*scale)),rewards:Object.fromEntries(GIFT_FIELDS.map(k=>[k,Math.floor(e.rewards[k]*factor)])),prestige:Math.floor(e.prestige*factor),unitId:unit.unitId,castleId:unit.castleId,deploymentRevision:unit.deploymentRevision};
      }
      if(!e||!t)return{ok:false,message:'戦う野良兵と戦術を選んでください。',maxTroops};
      if(!Number.isSafeInteger(troops)||troops<300||troops>maxTroops)return{ok:false,message:`出陣兵数は300〜${maxTroops.toLocaleString()}人の整数で指定してください。`,maxTroops,encounter:e};
      const a=this.armyStats(),skills=s.army.map(id=>this.officer(id)?.skill),foodCost=Math.ceil(troops*.24*t.food)+120;
      let power=troops*(.5+a.lead*.005+a.valor*.003)*(.55+s.morale*.006)*(1+s.tech.discipline*.06+s.tech.gunnery*.04)*(1+this._facilityEffect('military'))*t.modifier;
      if(tactic==='ambush')power*=.65+a.intellect*.006;
      if(tactic===e.preferred)power*=1.15;
      if(skills.includes('commander'))power*=1.04;
      if(skills.includes('cavalry')&&tactic==='assault')power*=1.06;
      if(skills.includes('infantry')&&tactic==='balanced')power*=1.05;
      if(skills.includes('ranged'))power*=1.04;
      if(skills.includes('strategist')&&tactic==='ambush')power*=1.08;
      if(s.clan==='武田家')power*=1.1;
      if(s.clan==='島津家'&&tactic==='ambush')power*=1.15;
      const attackPower=ctx?.attackPower??Math.max(1,Math.round(power)),ratio=attackPower/e.enemyPower,won=attackPower>=e.enemyPower;
      const rate=won?clamp(.045+.13/Math.max(1,ratio),.045,.175):clamp(.2+.14/Math.max(.25,ratio),.22,.65);
      const ourLost=Math.min(troops,Math.max(1,Math.ceil(troops*rate*t.loss*((ctx?ctx.medic:skills.includes('medic'))?.85:1))));
      const guard=this._marchBusy()||this._guard();let reason=guard?.message||'';
      if(!reason&&!(ctx?ctx.army.length:a.count))reason='軍団に武将を1名以上編成してください。';
      if(!reason&&!ctx&&s.resources.rice<foodCost)reason='出陣に必要な兵糧が足りません。';
      if(!reason&&s.roaming.sequence>=10000000)reason='野良兵戦の記録上限に達しました。';
      return{ok:!reason,message:reason||'出陣できます。',encounter:e,tactic:t.id,tacticName:t.name,troops,maxTroops,commandCost:1,foodCost,attackPower,enemyPower:e.enemyPower,enemyTroops:e.enemyTroops,predictedWin:won,expectedLoss:ourLost,ratio,rewards:won?copy(e.rewards):Object.fromEntries(GIFT_FIELDS.map(k=>[k,0])),tactics:copy(ROAMING_TACTICS),travel:this._attackTravel('roaming',encounterId,options)};
    }
    _marchElapsed(){return Math.round(this.state.turn*60000+this.state.realtime.elapsed*1000);}
    _attackTravel(kind,targetId,options={}){
      const rules=travelRules();if(!rules)return null;
      if(kind==='roaming')return rules.plan({sourceCastleId:this.state.home,targetCastleId:options.deploymentUnit?.castleId||this.state.home,localOffsetKm:2});
      const branch=kind==='branch'?this.branch(targetId):null,targetCastleId=branch?.parentCastleId||targetId;
      const sources=this.ownedCastles().filter(c=>c.neighbors.includes(targetCastleId)).map(c=>c.id);
      return rules.nearest(sources,targetCastleId,branch?{branchDirection:branch.direction}:{});
    }
    reservedTroops(){const m=this.state.march;return m&&m.kind!=='rally'?m.troops:0;}
    availableTroopCapacity(){return Math.max(0,this.troopCapacity()-this.reservedTroops());}
    // Imported and recalled soldiers use the ownership ceiling; reserve room
    // for the main army already travelling so its return cannot discard troops.
    troopTransportCapacity(){return Math.max(0,ASSET_CAP-this.reservedTroops());}
    getMarchStatus(){const m=this.state.march;if(!m)return null;return{...copy(m),status:'marching',timeBasis:'world',...(m.options?.requestId?{requestId:m.options.requestId}:{}),remainingMs:Math.max(0,m.arrivesElapsedMs-this._marchElapsed())};}
    _marchBusy(){return this.state.march&&!MARCH_CONTEXT.has(this)?{ok:false,code:'MARCH_ACTIVE',message:'出陣中の軍団が到着するまで、次の出陣をお待ちください。',march:this.getMarchStatus()}:null;}
    _departMarch(kind,targetId,tactic,troops,options={}){
      const s=this.state,old=s.march;
      const matches=m=>m.kind===kind&&(kind==='roaming'?m.encounterId===targetId&&(m.options?.deploymentUnit?.unitId||null)===(options.deploymentUnit?.unitId||options.unitId||null)&&(m.options?.requestId||null)===(options.requestId||null)&&m.options?.campaignId===options.campaignId&&m.options?.sequence===options.sequence&&(m.options?.deploymentUnit?.castleId||null)===(options.deploymentUnit?.castleId||options.castleId||null)&&(m.options?.deploymentUnit?.deploymentRevision||null)===(options.deploymentUnit?.deploymentRevision||options.deploymentRevision||null):kind==='branch'?m.targetBranchId===targetId:m.targetCastleId===targetId)&&m.tactic===tactic&&m.troops===troops;
      const cancelled=kind==='roaming'?s.marchHistory.find(m=>m.kind==='roaming'&&m.status==='cancelled'&&m.options?.requestId===options.requestId):null;
      if(cancelled){if(!matches(cancelled))return{ok:false,code:'REQUEST_ID_REUSED',message:'この操作番号は別の出陣に使われています。'};return{ok:true,accepted:false,marching:false,cancelled:true,idempotent:true,march:{...copy(cancelled),requestId:cancelled.options.requestId,timeBasis:'world',remainingMs:0},message:cancelled.message};}
      if(old){if(old.authority==='local'&&kind==='roaming'&&old.options?.requestId===options.requestId&&!matches(old))return{ok:false,code:'REQUEST_ID_REUSED',message:'この操作番号は別の出陣に使われています。'};if(old.authority==='local'&&matches(old))return{ok:true,accepted:true,marching:true,idempotent:true,march:this.getMarchStatus(),message:'この部隊はすでに進軍中です。'};return this._marchBusy();}
      if(!Number.isSafeInteger(troops))return fail('出陣兵数は整数で指定してください。');
      if(kind==='roaming'){
        const r=s.roaming,{requestId,campaignId,sequence}=options;
        if(!walkingId(requestId)||campaignId!==s.walking.campaignId||!Number.isSafeInteger(sequence)||sequence<0)return{ok:false,code:'ROAMING_SCOPE_CHANGED',message:'物語と出陣の操作番号を確認してください。'};
        const prior=r.history.find(b=>b.requestId===requestId);if(prior)return this.battleRoaming(targetId,tactic,troops,options);
        if(sequence!==r.sequence)return{ok:false,code:'ROAMING_SEQUENCE_CHANGED',message:'出陣記録が更新されています。最新の内容を確認してください。'};
        if((options.unitId!==undefined||options.castleId!==undefined||options.deploymentRevision!==undefined)&&(!validRoamingUnit(options.deploymentUnit,targetId)||options.unitId!==options.deploymentUnit.unitId||options.castleId!==options.deploymentUnit.castleId||options.deploymentRevision!==options.deploymentUnit.deploymentRevision))return{ok:false,code:'ROAMING_MAP_REQUIRED',message:'地図の配置部隊を選び直してください。'};
      }
      const p=kind==='castle'?this.previewBattle(targetId,tactic,troops):kind==='branch'?this.previewBranchBattle(targetId,tactic,troops):this.previewRoamingBattle(targetId,tactic,troops,options);
      if(!p.ok)return{ok:false,code:p.code,message:p.message};
      const travel=this._attackTravel(kind,targetId,options);if(!travel)return fail('出陣元と目的地の距離を確認できません。');
      const departedElapsedMs=this._marchElapsed(),commandBefore=s.command,army=[...s.army],seed=Math.floor(this.random()*4294967296)>>>0;
      const march={version:1,authority:'local',id:newWalkingCampaign(),kind,campaignId:s.walking.campaignId,cycle:s.cycle.index,clan:s.clan,sourceCastleId:travel.sourceCastleId,targetCastleId:travel.targetCastleId,troops,tactic,foodCost:p.foodCost,commandCost:1,departedElapsedMs,arrivesElapsedMs:departedElapsedMs+travel.durationMs,travel,profile:{attackPower:p.attackPower,siege:s.tech.siege,medic:army.some(id=>this.officer(id)?.skill==='medic'),army},seed,commandBefore};
      if(kind==='branch')march.targetBranchId=targetId;
      if(kind==='roaming'){
        march.encounterId=targetId;march.options={requestId:options.requestId,campaignId:options.campaignId,sequence:options.sequence};if(Number.isSafeInteger(options.respawnSeconds)&&options.respawnSeconds>=60&&options.respawnSeconds<=3600)march.options.respawnSeconds=options.respawnSeconds;
        if(options.deploymentUnit){march.options.deploymentUnit=Object.fromEntries(['unitId','castleId','encounterId','deploymentRevision','slot','troops'].map(k=>[k,options.deploymentUnit[k]]));march.options.deploymentUnit.available=true;for(const key of ['unitId','castleId','deploymentRevision'])march.options[key]=options.deploymentUnit[key];}
      }else march.targetOwner=s.castles[travel.targetCastleId].owner;
      this._pay({rice:p.foodCost});s.command--;s.troops-=troops;s.march=march;
      const destination=kind==='branch'?p.castleName:kind==='roaming'?p.encounter.name:travel.targetName,message=`${travel.sourceName}から${destination}へ${troops.toLocaleString()}人が出陣しました。到着まで${travelRules().formatDuration(travel.durationMs)}（1倍速）。`;
      this.log(message,'march');return{ok:true,accepted:true,marching:true,idempotent:false,march:this.getMarchStatus(),message};
    }
    departAttack(castleId,tactic='balanced',troops=this.state.troops){return this._departMarch('castle',castleId,tactic,troops);}
    departBranchAttack(branchId,tactic='balanced',troops=this.state.troops){return this._departMarch('branch',branchId,tactic,troops);}
    departRoamingBattle(encounterId,tactic='balanced',troops=Math.min(this.state.troops,this.troopCapacity()),options={}){return this._departMarch('roaming',encounterId,tactic,troops,options);}
    _finishMarch(march,status,message,battle){const record={...copy(march),status,resolvedElapsedMs:this._marchElapsed(),message,...(battle?{battle:copy(battle)}:{})};this.state.marchHistory.unshift(record);this.state.marchHistory=this.state.marchHistory.slice(0,20);return copy(record);}
    _cancelMarch(message){const m=this.state.march;if(!m||m.authority!=='local')return null;this.state.officerHealth=projectOfficerHealth(this.state);this.state.march=null;this.state.troops=Math.min(ASSET_CAP,this.state.troops+m.troops);this.state.resources.rice=Math.min(ASSET_CAP,this.state.resources.rice+m.foodCost);this.state.command=Math.min(this.commandMax(),this.state.command+m.commandCost);this.log(message,'march');return this._finishMarch(m,'cancelled',message);}
    resolveDueMarches(){
      const s=this.state,m=s.march;if(!m||m.authority!=='local'||MARCH_CONTEXT.has(this))return[];
      const cancel=message=>[this._cancelMarch(message)];
      if(m.campaignId!==s.walking.campaignId||m.cycle!==s.cycle.index||m.clan!==s.clan)return cancel('物語・周回・所属の変更により出陣を中止し、兵と出陣費用を戻しました。');
      if(s.gameOver||s.castles[m.sourceCastleId]?.owner!==s.clan)return cancel('出陣元を失ったため、部隊は帰還しました。兵と出陣費用を戻しました。');
      if(this._marchElapsed()<m.arrivesElapsedMs)return[];
      if(m.kind!=='roaming'&&s.castles[m.targetCastleId]?.owner!==m.targetOwner)return cancel('到着前に攻撃先の領主が変わったため、部隊は帰還しました。兵と出陣費用を戻しました。');
      const snapshot=copy(s);s.march=null;s.troops+=m.troops;MARCH_CONTEXT.set(this,{...copy(m.profile),seed:m.seed,commandBefore:m.commandBefore});
      let result;
      try{result=m.kind==='castle'?this.attack(m.targetCastleId,m.tactic,m.troops):m.kind==='branch'?this.attackBranch(m.targetBranchId,m.tactic,m.troops):this.battleRoaming(m.encounterId,m.tactic,m.troops,m.options);}
      catch(error){for(const key of Object.keys(s))delete s[key];Object.assign(s,snapshot);throw error;}
      finally{MARCH_CONTEXT.delete(this);}
      if(!result.ok){for(const key of Object.keys(s))delete s[key];Object.assign(s,snapshot);return cancel(`出陣を中止しました。${result.message} 兵と出陣費用を戻しました。`);}
      s.troops=Math.min(ASSET_CAP,s.troops);return[this._finishMarch(m,'resolved',result.message,result.battle)];
    }
    battleRoaming(encounterId,tactic,troops,options={}){
      const s=this.state,r=s.roaming,{requestId,campaignId,sequence}=options;
      if(!walkingId(requestId)||requestId.length>90||campaignId!==s.walking.campaignId||campaignId!==r.campaignId||!Number.isSafeInteger(sequence)||sequence<0)return{ok:false,code:'ROAMING_SCOPE_CHANGED',message:'物語と出陣の操作番号を確認してください。'};
      const prior=r.history.find(b=>b.requestId===requestId);
      if(prior){if(prior.encounterId!==encounterId||prior.tactic!==tactic||prior.deployed!==troops||prior.sequence!==sequence||(prior.unitId||null)!==(options.deploymentUnit?.unitId||options.unitId||null)||(prior.castleId||null)!==(options.deploymentUnit?.castleId||options.castleId||null)||(prior.deploymentRevision||null)!==(options.deploymentUnit?.deploymentRevision||options.deploymentRevision||null))return{ok:false,code:'REQUEST_ID_REUSED',message:'この操作番号は別の出陣に使われています。'};return{ok:true,idempotent:true,battle:copy(prior),message:'記録済みの戦果を表示しました。'};}
      if(sequence!==r.sequence)return{ok:false,code:'ROAMING_SEQUENCE_CHANGED',message:'出陣記録が更新されています。最新の内容を確認してください。'};
      if((options.unitId!==undefined||options.castleId!==undefined||options.deploymentRevision!==undefined)&&(!validRoamingUnit(options.deploymentUnit,encounterId)||options.unitId!==options.deploymentUnit.unitId||options.castleId!==options.deploymentUnit.castleId||options.deploymentRevision!==options.deploymentUnit.deploymentRevision))return{ok:false,code:'ROAMING_MAP_REQUIRED',message:'地図の配置部隊を選び直してください。'};
      const p=this.previewRoamingBattle(encounterId,tactic,troops,options);if(!p.ok)return fail(p.message);
      const e=p.encounter,won=p.predictedWin,commandBefore=MARCH_CONTEXT.get(this)?.commandBefore??s.command,prestigeBefore=s.prestige;
      this._pay({rice:p.foodCost});s.troops-=p.expectedLoss;s.morale=clamp(s.morale+(won?3:-8),15,100);
      const paid={...s.resources,magatama:s.magatama};if(won){this._gain(e.rewards);s.prestige=Math.min(ASSET_CAP,s.prestige+e.prestige);r.wins++;}
      const rewards=Object.fromEntries(GIFT_FIELDS.map(k=>[k,(k==='magatama'?s.magatama:s.resources[k])-paid[k]]));
      const battle={requestId,campaignId,sequence,encounterId:e.id,encounterName:e.name,tactic,tacticName:p.tacticName,won,deployed:troops,ourLost:p.expectedLoss,survivors:troops-p.expectedLoss,enemyTroops:p.enemyTroops,enemyLost:won?p.enemyTroops:Math.min(p.enemyTroops-1,Math.floor(p.enemyTroops*clamp(p.ratio*.5,.05,.8))),attackPower:p.attackPower,enemyPower:p.enemyPower,foodCost:p.foodCost,commandCost:1,commandBefore,commandAfter:commandBefore-1,rewards,prestigeGain:s.prestige-prestigeBefore,turn:s.turn};
      if(e.unitId){
        Object.assign(battle,{unitId:e.unitId,castleId:e.castleId,deploymentRevision:e.deploymentRevision});
        // The respawn window opens when the arrival settles, in wall time even when the world clock is catching up.
        if(MARCH_CONTEXT.has(this))battle.respawnAt=won?Date.now()+(options.respawnSeconds??ROAMING_DEPLOYMENT_DEFAULTS.respawnSeconds)*1000:null;
      }
      r.sequence++;r.history.unshift(copy(battle));r.history=r.history.slice(0,20);
      return this._action(`野良兵「${e.name}」に${won?'勝利':'敗北'}。兵${p.expectedLoss.toLocaleString()}人を失い、${won?`金銭${rewards.gold.toLocaleString()}・勾玉${rewards.magatama.toLocaleString()}などを獲得。`:'生存兵は本拠へ帰還。'}`,won?'victory':'defeat',{battle,idempotent:false});
    }
    previewBattle(castleId,tactic='balanced',troops=this.state.troops){
      const s=this.state,ctx=MARCH_CONTEXT.get(this),c=this.castle(castleId),t=TACTICS.find(t=>t.id===tactic),n=int(troops);
      if(!c)return{ok:false,message:'城が見つかりません。'};if(!t)return{ok:false,message:'戦法を選んでください。'};
      const a=this.armyStats(),foodCost=Math.ceil(n*.3*t.food)+150;
      const wallFactor=(1-(ctx?.siege??s.tech.siege)*.12)*(tactic==='siege'?.5:1);
      let attackPower=n*(.55+a.lead*.005+a.valor*.0025)*(.5+s.morale*.007)*(1+s.tech.discipline*.06+s.tech.gunnery*.05)*t.modifier*(1+this._facilityEffect('military'));
      const skills=s.army.map(id=>this.officer(id)?.skill);
      if(skills.includes('commander'))attackPower*=1.04;
      if(skills.includes('cavalry')&&tactic==='assault')attackPower*=1.06;
      if(skills.includes('infantry')&&tactic==='balanced')attackPower*=1.05;
      if(skills.includes('ranged'))attackPower*=1.04;
      if(skills.includes('strategist')&&tactic==='ambush')attackPower*=1.08;
      if(tactic==='ambush')attackPower*=.7+a.intellect*.005;
      if(s.clan==='武田家')attackPower*=1.1;
      if(s.clan==='島津家'&&tactic==='ambush')attackPower*=1.15;
      if((s.scouted[castleId]||0)>s.turn)attackPower*=1.1;
      if(a.count===0)attackPower*=.75;
      // Marches retain integer attack power. Use that exact value from the
      // first forecast so unchanged defenses produce the same arrival odds.
      attackPower=ctx?.attackPower??Math.round(attackPower);
      const condition=c.durability.fortificationFactor,defensePower=(c.troops*(1+c.wall*.11*wallFactor*condition)+c.wall*130*wallFactor*condition)*(s.difficulty==='hard'?1.1:s.difficulty==='easy'?.9:1)*(1+(c.level-1)*.04*condition);
      const ratio=attackPower/Math.max(1,defensePower);
      const chance=ratio>=2.2?.99:ratio<=.45?.02:clamp(.5+Math.log(ratio)*.65,.05,.97);
      const court=this.courtAttackPermission(s.home,castleId),branchGate=this.parentAttackPermission(castleId);let reason='';if(this._marchBusy())reason=this._marchBusy().message;else if(s.gameOver)reason='本拠を失っています。';else if(!court.ok)reason=court.message;else if(c.owner===s.clan)reason='この城はすでに自領です。';else if(!branchGate.ok)reason=branchGate.message;else if(!this.canOwnCastle(castleId))reason=castleId===STAFF_BASE_ID?'京都御所はスタッフ専用のため出陣できません。':'江戸城は運営専用のため出陣できません。';else if(!this.adjacentTargets().some(a=>a.id===castleId))reason='自領に隣接する城へ出陣できます。';else if((s.treaties[c.owner]||0)>s.turn)reason='同盟期間中の勢力には出陣できません。';else if(!Number.isSafeInteger(troops)||n<300||n>s.troops)reason='出陣兵数は300人以上、現在の兵数以下の整数で指定してください。';else if(!ctx&&s.command<1)reason='指示の回復をお待ちください（1倍速で20秒に1回）。';else if(!ctx&&s.resources.rice<foodCost)reason='出陣に必要な兵糧が足りません。';
      return{ok:!reason,...(!court.ok?{code:court.code}:!branchGate.ok&&reason===branchGate.message?{code:branchGate.code,branchIds:branchGate.branchIds}:{}),message:reason||'出陣できます。',castleId,castleName:c.name,durability:c.durability,tactic,troops:n,enemyTroops:c.troops,attackPower:Math.round(attackPower),defensePower:Math.round(defensePower),winChance:Math.round(chance*100),foodCost,scouted:(s.scouted[castleId]||0)>s.turn,ratio,tactics:TACTICS,travel:this._attackTravel('castle',castleId)};
    }
    previewBranchBattle(branchId,tactic='balanced',troops=this.state.troops){
      const branch=this.branch(branchId),s=this.state;if(!branch)return{ok:false,code:'BRANCH_NOT_FOUND',message:'攻撃する支拠点が見つかりません。'};
      const parent=this.castle(branch.parentCastleId),base=this.previewBattle(branch.parentCastleId,tactic,troops),defense=this.branchDefense(branchId,tactic,MARCH_CONTEXT.get(this)?.siege??s.tech.siege),court=this.courtAttackPermission(s.home,branch.parentCastleId),guard=this._marchBusy()||this._guard(),t=TACTICS.find(row=>row.id===tactic);let reason='',code;
      if(!court.ok){reason=court.message;code=court.code;}else if(!t)reason='戦法を選んでください。';else if(guard)reason=guard.message;else if(branch.level<1){reason='建設中の支拠点には攻撃できません。';code='BRANCH_UNBUILT';}else if(branch.fallen){reason='この支拠点はすでに陥落しています。';code='BRANCH_FALLEN';}else if(parent.owner===s.clan)reason='自分の支拠点には攻撃できません。';else if(!this.ownedCastles().some(castle=>castle.neighbors.includes(branch.parentCastleId)))reason='自領に隣接する大都市の支拠点へ出陣できます。';else if((s.treaties[parent.owner]||0)>s.turn)reason='同盟期間中の勢力には出陣できません。';else if(!Number.isSafeInteger(troops)||troops<300||troops>s.troops)reason='出陣兵数は300人以上、現在の兵数以下の整数で指定してください。';else if(!MARCH_CONTEXT.has(this)&&s.resources.rice<base.foodCost)reason='出陣に必要な兵糧が足りません。';
      const ratio=(base.attackPower||0)/Math.max(1,defense?.power||1),chance=ratio>=2.2?.99:ratio<=.45?.02:clamp(.5+Math.log(ratio)*.65,.05,.97);
      return{...base,ok:!reason,code,message:reason||'支拠点へ出陣できます。',branchId,parentCastleId:branch.parentCastleId,castleId:branch.parentCastleId,castleName:branch.name,durability:branch.durability,branchLevel:branch.level,enemyTroops:defense?.force||0,defensePower:defense?.power||0,ratio,winChance:Math.round(chance*100),captured:false,travel:this._attackTravel('branch',branchId)};
    }
    attackBranch(branchId,tactic='balanced',troops=this.state.troops){
      const p=this.previewBranchBattle(branchId,tactic,troops);if(!p.ok)return{ok:false,code:p.code,message:p.message};const s=this.state,t=TACTICS.find(row=>row.id===tactic),won=this.random()<p.winChance/100,lostRate=won?clamp(.08+.19/Math.max(.5,p.ratio),.08,.32):clamp(.27+.13/Math.max(.4,p.ratio),.27,.65),medic=MARCH_CONTEXT.get(this)?.medic??s.army.some(id=>this.officer(id)?.skill==='medic'),ourLost=Math.min(p.troops,Math.max(30,Math.round(p.troops*lostRate*t.loss*(.92+this.random()*.16)*(medic?.9:1))));this._pay({rice:p.foodCost});s.troops-=ourLost;const durability=this._damageBranchDurability(branchId,{won,ratio:p.ratio});if(won)this._fallBranch(branchId);
      const phases=[{title:'出陣',text:`${p.troops.toLocaleString()}の兵が${p.castleName}へ進軍。${t.name}を採用。`},{title:won?'支拠点陥落':'撤退',text:won?'支拠点の守りを突破しました。残る支拠点を落とすと親拠点を攻撃できます。':'支拠点の守りを突破できず、生存兵は帰還しました。'}],battle={won,durability,castleId:p.parentCastleId,parentCastleId:p.parentCastleId,branchId,castleName:p.castleName,captured:false,ourBefore:p.troops,ourLost,enemyBefore:p.enemyTroops,enemyLost:won?p.enemyTroops:0,phases,rewards:{gold:0,rice:0,magatama:0},capturedOfficer:null,garrison:0,tactic,turn:s.turn};s.lastBattle=battle;return this._action(`${p.castleName}への攻撃に${won?'勝利し、支拠点を陥落させました':'敗れ、生存兵は帰還しました'}。`,'battle',{battle});
    }
    adviseBattle(options={}){
      const invalid=message=>({ok:false,code:'INVALID_BATTLE_ADVICE',message,reasons:[message],alternatives:[]});
      if(!options||typeof options!=='object'||Array.isArray(options))return invalid('戦場と軍師の方針を選んでください。');
      const {mode='castle',targetId,style='balanced',reserveTroops=0,reserveRice=0,deploymentUnit}=options;
      if(!['castle','branch','roaming'].includes(mode)||typeof targetId!=='string'||!targetId||typeof style!=='string'||!Object.hasOwn(STRATEGY_STYLES,style)||![reserveTroops,reserveRice].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=ASSET_CAP))return invalid('戦場・方針・残す兵と兵糧の数値を確認してください。');
      if(deploymentUnit!==undefined&&(mode!=='roaming'||!validRoamingUnit(deploymentUnit,targetId)||deploymentUnit.available!==undefined&&typeof deploymentUnit.available!=='boolean'))return invalid('地図の配置部隊を選び直してください。');
      const policy={mode,targetId,style,reserveTroops,reserveRice};
      if(deploymentUnit!==undefined)policy.deploymentUnit=Object.fromEntries(['unitId','castleId','encounterId','deploymentRevision','slot','troops','available'].filter(key=>deploymentUnit[key]!==undefined).map(key=>[key,deploymentUnit[key]]));
      const s=this.state,roaming=mode==='roaming',maxTroops=Math.max(0,Math.min(s.troops-reserveTroops,roaming?this.troopCapacity():ASSET_CAP,roaming?1000000:ASSET_CAP)),minWinChance=roaming?100:STRATEGY_STYLES[style].minWinChance;
      const unavailable=(message,code='BATTLE_UNAVAILABLE')=>({ok:false,mode,targetId,style,policy,maxTroops,minWinChance,code,message,reasons:[message],alternatives:[]});
      const guard=this._guard();if(guard)return unavailable(guard.message,'BATTLE_GUARD');
      if(maxTroops<300)return unavailable(reserveTroops?'残す兵を確保すると、出陣に必要な300人を用意できません。':'出陣に必要な300人を用意してください。','BATTLE_TROOPS');
      if(s.resources.rice<reserveRice)return unavailable('残す兵糧を確保できるまで出陣を見合わせてください。','BATTLE_RICE');
      const tactics=roaming?ROAMING_TACTICS:TACTICS,preview=(tactic,troops)=>mode==='branch'?this.previewBranchBattle(targetId,tactic,troops):roaming?this.previewRoamingBattle(targetId,tactic,troops,deploymentUnit!==undefined?{deploymentUnit}:{}):this.previewBattle(targetId,tactic,troops);
      const chance=p=>roaming?(p.predictedWin?100:0):p.winChance,candidates=[],medic=s.army.some(id=>this.officer(id)?.skill==='medic')?.9:1;
      let blocked=null;
      // Only existing previews are evaluated: no RNG, state copies that run a
      // constructor, clocks, saves, rewards or battle execution are involved.
      for(const tactic of tactics){
        const rate=(roaming?.24:.3)*tactic.food,baseCost=roaming?120:150,budget=s.resources.rice-reserveRice;
        let available=Math.min(maxTroops,Math.floor((budget-baseCost)/rate));
        while(available>=300&&Math.ceil(available*rate)+baseCost>budget)available--;
        if(available<300)continue;
        const largest=preview(tactic.id,available);
        if(!largest.ok){blocked=blocked||largest;continue;}
        // The preview's chance is monotone in deployed troops. Binary search
        // finds legal thresholds exactly, including rounded castle chances and
        // the deterministic roaming win boundary, without a troop-sized loop.
        const firstAtChance=threshold=>{
          if(chance(largest)<threshold)return null;
          let low=300,high=available;
          while(low<high){const middle=low+Math.floor((high-low)/2),p=preview(tactic.id,middle);if(p.ok&&chance(p)>=threshold)high=middle;else low=middle+1;}
          return low;
        };
        const minimum=firstAtChance(minWinChance),strongest=firstAtChance(chance(largest)),troopOptions=new Set([300,available,minimum,strongest,Math.ceil(available*.25),Math.ceil(available*.5),Math.ceil(available*.75),minimum===null?null:Math.ceil((minimum+available)/2)]);
        for(const troops of troopOptions){
          if(!Number.isSafeInteger(troops)||troops<300||troops>available)continue;
          const p=preview(tactic.id,troops);if(!p.ok||s.resources.rice-p.foodCost<reserveRice)continue;
          const winChance=chance(p),winRate=clamp(.08+.19/Math.max(.5,p.ratio),.08,.32),loseRate=clamp(.27+.13/Math.max(.4,p.ratio),.27,.65);
          const lossAt=rate=>Math.min(troops,Math.max(30,Math.round(troops*rate*tactic.loss*medic))),estimatedLoss=roaming?p.expectedLoss:Math.round(lossAt(winRate)*winChance/100+lossAt(loseRate)*(1-winChance/100));
          const score=style==='conserve'?-estimatedLoss-p.foodCost*.08+winChance:style==='rapid'?winChance*30-estimatedLoss*.1-p.foodCost*.015:winChance*12-estimatedLoss*.35-p.foodCost*.035;
          candidates.push({mode,targetId,targetName:p.castleName||p.encounter?.name||targetId,...(mode==='castle'?{castleId:targetId}:mode==='branch'?{branchId:targetId,castleId:p.parentCastleId,parentCastleId:p.parentCastleId}:{encounterId:targetId,...(deploymentUnit?{unitId:deploymentUnit.unitId,deploymentRevision:deploymentUnit.deploymentRevision}:{})}),tactic:tactic.id,tacticName:tactic.name,troops,foodCost:p.foodCost,commandCost:1,travel:p.travel,winChance,estimatedLoss,attackPower:p.attackPower,defensePower:p.defensePower??p.enemyPower,enemyTroops:p.enemyTroops,deterministic:roaming,...(roaming?{predictedWin:p.predictedWin}:{}),reserveAfter:{troops:s.troops-troops,rice:s.resources.rice-p.foodCost},meetsGoal:winChance>=minWinChance,score:Math.round(score*100)/100});
        }
      }
      if(!candidates.length){const p=blocked||preview(tactics[0].id,Math.min(maxTroops,300));return unavailable(p.ok?'残す兵糧と出陣費用を確保できるまで出陣を見合わせてください。':p.message,p.code||'BATTLE_RICE');}
      const hasSafeChoice=candidates.some(c=>c.meetsGoal),choices=hasSafeChoice?candidates.filter(c=>c.meetsGoal):candidates;
      choices.sort((a,b)=>(hasSafeChoice?0:b.winChance-a.winChance)||b.score-a.score||a.foodCost-b.foodCost||a.troops-b.troops||a.tactic.localeCompare(b.tactic));
      const chosen=choices[0],alternatives=[];
      for(const candidate of choices)if(candidate.tactic!==chosen.tactic&&!alternatives.some(row=>row.tactic===candidate.tactic)){alternatives.push(copy(candidate));if(alternatives.length===3)break;}
      const labels={conserve:'兵の損耗と兵糧消費を抑える',balanced:'勝率・損耗・兵糧の釣り合いを取る',rapid:'勝率を優先して攻略を進める'},reasons=[`${labels[style]}方針で、${chosen.tacticName}と兵${chosen.troops.toLocaleString()}人を提案します。`,roaming?`現在の戦力と相性では${chosen.predictedWin?'勝利':'敗北'}予測です。予想損失は${chosen.estimatedLoss.toLocaleString()}人です。`:`予想勝率${chosen.winChance}%、予想損失${chosen.estimatedLoss.toLocaleString()}人です。勝利を保証するものではありません。`,`出陣費用は兵糧${chosen.foodCost.toLocaleString()}。出陣中も兵${chosen.reserveAfter.troops.toLocaleString()}人・兵糧${chosen.reserveAfter.rice.toLocaleString()}を残せます。`];
      if(!chosen.meetsGoal)reasons.unshift(roaming?'現在の条件では勝利できる編成がありません。増兵・編成・訓練を整えて再評価してください。':`方針の目安である勝率${minWinChance}%に届きません。増兵・編成・訓練を整えてからの出陣を勧めます。`);
      return{ok:true,...chosen,style,policy,maxTroops,minWinChance,caution:!chosen.meetsGoal,recommendation:chosen.meetsGoal?'attack':'prepare',message:reasons[0],reasons,alternatives};
    }
    compileStrategy(input){
      if(typeof input!=='string'||Array.from(input).length>500||!input.trim())return{ok:false,code:'STRATEGY_TEXT_REQUIRED',message:'作戦を500文字以内で入力してください。',warnings:[]};
      const text=input.normalize('NFKC').trim().replace(/(\d),(?=\d{3}(?:\D|$))/g,'$1'),clauses=text.split(/[。、,;；\n]+/).map(v=>v.trim()).filter(Boolean);
      const recognized=new Set(),warnings=[],excluded=new Set(),excludeRegions=new Set(),excludeClans=new Set(),targets=new Set(),regions=new Set();let style='balanced',priority='weakest',hold=false,explicitCount=null,explicitWin=null,explicitTroops=null,explicitRice=null;
      const bad=message=>({ok:false,code:'STRATEGY_UNDERSTOOD_PARTLY',message,warnings:[...warnings,message],recognized:[...recognized]});
      for(const clause of clauses){
        let known=false;const castles=strategyCastles(clause),places=STRATEGY_REGIONS.filter(r=>clause.includes(r)),families=STRATEGY_CLANS.filter(c=>clause.includes(c));
        const attackProhibited=/攻め(?:ない|ず|ぬ|ません|るな|て(?:は)?(?:いけない|いけません|駄目|だめ))|(?:攻撃|出陣|攻略|侵攻)\s*(?:を|は)?\s*(?:しない|せず|しません|禁止|するな|して(?:は)?(?:いけない|いけません|駄目|だめ)|(?:し|することを)?(?:避ける|やめる))|戦わない/.test(clause),noAttack=attackProhibited||/避け|除外|対象外|以外|行かない|狙わない/.test(clause);
        if(/(?:^|[^\p{Script=Han}])[東西南北](?:に|へ|は|を|側|方面)/u.test(clause)&&!places.length)return bad('東西南北だけの指定は読み取れません。地方名か城名で指定してください。');
        if(/他(?:の)?プレイヤ|対人|PVP|PvP|自動募兵|徴兵|武将.{0,5}編成|自動増築|外交|偵察/.test(clause)&&!noAttack&&!/しない|不要|禁止|せず/.test(clause))return bad('この作戦AIが実行するのは天下地図の隣接城への攻撃です。そのほかの操作は作戦から分けてください。');
        if(noAttack&&(castles.length||places.length)){
          for(const c of castles)excluded.add(c.id);for(const r of places)excludeRegions.add(r);known=true;recognized.add('指定した城・地方を除外');
          if((castles.length+places.length)>1&&/目指|狙う|攻める|攻略する/.test(clause))return bad('攻めない対象と目指す対象は、句点で分けて指定してください。');
        }else if(castles.length||places.length){for(const c of castles)targets.add(c.id);for(const r of places)regions.add(r);known=true;recognized.add('指定目標');}
        if(noAttack&&families.length){for(const family of families)excludeClans.add(family);known=true;recognized.add('指定した家を除外');}
        if(noAttack&&/味方|友軍|同盟|自領/.test(clause)){known=true;recognized.add('味方と同盟を尊重');}
        else if(!castles.length&&!places.length&&!families.length&&(attackProhibited||/待機|防衛(?:に)?専念|守備だけ|守るだけ/.test(clause))){hold=true;known=true;recognized.add('攻撃せず待機');}
        if(/温存(?!しない|せず|不要)|損(?:害|耗).{0,6}(?:抑|少|減)|慎重|堅実|安全|無理.{0,4}しない|兵.{0,8}(?:使い切らない|無駄にしない)|急がない/.test(clause)){style='conserve';known=true;recognized.add('兵を温存');}
        else if(/速攻|速度|速く|早く|急い|迅速|素早|積極|一気/.test(clause)){if(style!=='conserve')style='rapid';known=true;recognized.add('速度を重視');}
        if(/弱い|弱小|防備.{0,3}薄|守り.{0,3}薄|勝てる|確実/.test(clause)){if(noAttack&&!castles.length&&!places.length&&!hold)return bad('弱い城を避ける指示には対応していません。目標の城か地方を指定してください。');priority='weakest';known=true;recognized.add('弱い城を優先');}
        if(/領土|勢力|拡大|統一|どんどん/.test(clause)){priority='expand';known=true;recognized.add('領土を広げる');}
        if(/(?:標準|バランス|正攻法)/.test(clause)){known=true;recognized.add('標準方針');}
        if(!castles.length&&!places.length&&families.length&&!noAttack)return bad('家名だけの目標指定には対応していません。目標の城か地方を指定してください。');
        const count=clause.match(/(-?\d+(?:\.\d+)?)\s*(?:回|戦)/);
        if(count){const n=Number(count[1]);if(!Number.isInteger(n)||n<0||n>20)return bad('自動出陣の上限は0〜20回で指定してください。');explicitCount=explicitCount===null?n:Math.min(explicitCount,n);known=true;recognized.add('出陣回数の上限');if(n===0)hold=true;}
        const win=clause.match(/勝(?:率|算)\s*(?:は|を)?\s*(-?\d+(?:\.\d+)?)\s*(?:%|パーセント)/);
        if(win){const n=Number(win[1]);if(!Number.isInteger(n)||n<50||n>99)return bad('最低勝率は50〜99%で指定してください。');explicitWin=explicitWin===null?n:Math.max(explicitWin,n);known=true;recognized.add('最低勝率');}
        for(const [kind,pattern] of [['rice',/兵糧\s*(?:を|は)?\s*(-?\d+(?:\.\d+)?(?:万|千)?)\s*(?:以上|だけ|ほど)?\s*(?:を|は)?\s*(?:残す|残して|残し|確保|温存)/],['troops',/兵(?:力|士|数)?\s*(?:を|は)?\s*(-?\d+(?:\.\d+)?(?:万|千)?)\s*(?:人|以上|だけ|ほど)?\s*(?:を|は)?\s*(?:残す|残して|残し|確保|温存)/]]){
          const m=clause.match(pattern);if(!m)continue;const n=strategyNumber(m[1]),max=kind==='rice'?999999999:1000000;if(!Number.isSafeInteger(n)||n<0||n>max)return bad('残す兵数または兵糧の数値を確認してください。');if(kind==='rice')explicitRice=Math.max(explicitRice??0,n);else explicitTroops=Math.max(explicitTroops??0,n);known=true;recognized.add(kind==='rice'?'残す兵糧':'残す兵数');
        }
        if(/攻め|攻撃|攻略|出陣|自動|任せ|おまかせ|周辺|隣接|近く|近隣|目指/.test(clause)){known=true;recognized.add('周辺の城を攻略');}
        if(!known&&!/^(?:お願いします|よろしくお願いします|よろしく|してください)$/.test(clause))warnings.push(`読み取れなかった指示: ${clause}`);
      }
      if(warnings.length||!recognized.size)return bad('作戦を読み取れませんでした。「兵を温存して弱い城から攻める」のように、方針・城・地方・回数を指定してください。');
      if([...targets].some(id=>excluded.has(id))||[...regions].some(id=>excludeRegions.has(id)))return bad('目標と攻めない対象が重なっています。禁止対象を優先し、作戦を開始しません。');
      if(targets.size>1||regions.size>1)return bad('一度の作戦では、目標の城と地方をそれぞれ一つまで指定してください。');
      const targetCastleId=[...targets][0]||null,targetRegion=[...regions][0]||null;
      if(targetCastleId&&['edo',STAFF_BASE_ID].includes(targetCastleId))return bad('江戸城・京都御所は保護された本拠のため、自動攻略の目標にはできません。');
      if(targetCastleId&&excludeRegions.has(CASTLE_BY_ID[targetCastleId].region))return bad('目標の城が、攻めない地方に含まれています。');
      if(targetCastleId&&targetRegion&&CASTLE_BY_ID[targetCastleId].region!==targetRegion)return bad('指定した城と地方が一致しません。目標を確認してください。');
      const defaults=STRATEGY_STYLES[style],policy={version:1,text,style,priority,hold,minWinChance:explicitWin??defaults.minWinChance,reserveTroops:explicitTroops??defaults.reserveTroops,reserveRice:explicitRice??defaults.reserveRice,maxBattles:explicitCount??5,targetCastleId,targetRegion,excludeCastleIds:[...excluded],excludeRegions:[...excludeRegions],excludeClans:[...excludeClans],anchor:strategyAnchor(this)};
      const labels={conserve:'兵を温存',balanced:'標準',rapid:'速度重視'},exclusions=[...excluded].map(id=>CASTLE_BY_ID[id].name).concat([...excludeRegions],[...excludeClans]),summary=(hold?'攻撃せず待機します。':`${labels[style]}・${priority==='weakest'?'弱い城から':'勢力を拡大'}。${targetCastleId?CASTLE_BY_ID[targetCastleId].name+'を目標に、':targetRegion?targetRegion+'を目標に、':''}勝率${policy.minWinChance}%以上、兵${policy.reserveTroops.toLocaleString()}・兵糧${policy.reserveRice.toLocaleString()}を残して最大${policy.maxBattles}回出陣します。`)+(exclusions.length?` 除外: ${exclusions.join('・')}。`:'');
      return{ok:true,policy,summary,recognized:[...recognized],warnings:[],message:summary};
    }
    planStrategy(policy){
      if(!validStrategy(policy))return{ok:false,action:'stop',code:'INVALID_STRATEGY',reason:'作戦の設定を読み取り直してください。'};
      const s=this.state,anchor=strategyAnchor(this),battles=s.stats.battles-policy.anchor.startBattles,progress={battles:Math.max(0,battles),maxBattles:policy.maxBattles,remaining:Math.max(0,policy.maxBattles-Math.max(0,battles))};
      const result=(action,code,reason,extra={})=>({ok:true,action,code,reason,progress,alternatives:[],...extra});
      if(Object.keys(anchor).some(k=>k!=='startBattles'&&anchor[k]!==policy.anchor[k])||battles<0)return result('stop','STRATEGY_SCOPE_CHANGED','物語・周回・本拠・役職が変わったため、作戦を開始し直してください。');
      if(s.march)return result('wait','STRATEGY_MARCHING','出陣中の軍団の到着と戦果を待っています。',{march:this.getMarchStatus()});
      if(policy.hold||policy.maxBattles===0)return result('stop','STRATEGY_HOLD','攻撃せず待機する作戦です。');
      if(battles>=policy.maxBattles||s.stats.battles>=BATTLE_COUNTER_MAX)return result('stop','STRATEGY_LIMIT','設定した出陣回数に達しました。');
      if(s.gameOver)return result('stop','STRATEGY_DEFEATED','本拠を失ったため作戦を停止しました。');
      const goals=policy.targetCastleId?[CASTLE_BY_ID[policy.targetCastleId]]:policy.targetRegion?CASTLES.filter(c=>c.region===policy.targetRegion&&!['edo',STAFF_BASE_ID].includes(c.id)):null;
      if(goals?.every(c=>s.castles[c.id].owner===s.clan))return result('stop','STRATEGY_TARGET_REACHED','指定した目標を制圧しました。');
      if(this.isStaff&&!STAFF_VIEW.get(this))return result('wait','STAFF_BASE_PENDING','京都御所の共同拠点を確認しています。');
      if(!s.realtime.running)return result('wait','STRATEGY_PAUSED','共通時間の再開を待っています。');
      if(s.command<1)return result('wait','STRATEGY_COMMAND','出陣に必要な指示の回復を待っています。');
      const blocked=c=>['edo',STAFF_BASE_ID].includes(c.id)||!this.canOwnCastle(c.id)||policy.excludeCastleIds.includes(c.id)||policy.excludeRegions.includes(c.region)||policy.excludeClans.includes(s.castles[c.id].owner)||(s.treaties[s.castles[c.id].owner]||0)>s.turn;
      let targets=this.adjacentTargets().filter(c=>!blocked(c));
      let distances=null;
      if(goals){
        distances=new Map();const queue=goals.filter(c=>s.castles[c.id].owner!==s.clan&&!blocked(c)).map(c=>c.id);for(const id of queue)distances.set(id,0);
        for(let i=0;i<queue.length;i++)for(const id of CASTLE_BY_ID[queue[i]].neighbors){const c=CASTLE_BY_ID[id];if(distances.has(id)||s.castles[id].owner!==s.clan&&blocked(c))continue;distances.set(id,distances.get(queue[i])+1);queue.push(id);}
        const distance=Math.min(...this.ownedCastles().map(c=>distances.get(c.id)??Infinity));
        targets=targets.filter(c=>(distances.get(c.id)??Infinity)<distance);
        if(!Number.isFinite(distance)||!targets.length)return result('wait','STRATEGY_ROUTE_BLOCKED','保護城・同盟・除外対象を避けて目標へ進める経路がありません。');
      }
      if(!targets.length)return result(s.won?'stop':'wait',s.won?'STRATEGY_UNIFIED':'STRATEGY_NO_TARGET','条件を満たす隣接城がありません。');
      const maxDeploy=s.troops-policy.reserveTroops;
      if(maxDeploy<300)return result('wait','STRATEGY_TROOPS','残す兵を確保すると出陣兵数が不足します。');
      if(s.resources.rice-policy.reserveRice<240)return result('wait','STRATEGY_RICE','残す兵糧と出陣費用を確保できるまで待機します。');
      const candidates=[],medic=s.army.some(id=>this.officer(id)?.skill==='medic')?.9:1;
      for(const c of targets)for(const tactic of TACTICS){
        const available=Math.min(maxDeploy,Math.floor((s.resources.rice-policy.reserveRice-150)/(.3*tactic.food)));if(available<300)continue;
        const largest=this.previewBattle(c.id,tactic.id,available);if(!largest.ok||largest.winChance<policy.minWinChance)continue;
        const threshold=policy.minWinChance>=98?2.2:Math.exp((policy.minWinChance/100-.5)/.65),minimum=Math.max(300,Math.ceil(available*threshold/largest.ratio));
        const troopOptions=[...new Set([available,minimum,Math.ceil((minimum+available)/2),Math.ceil(available*.75)].filter(n=>n>=300&&n<=available))];
        for(const troops of troopOptions){
          const p=this.previewBattle(c.id,tactic.id,troops);if(!p.ok||p.winChance<policy.minWinChance||s.resources.rice-p.foodCost<policy.reserveRice)continue;
          const winLoss=clamp(.08+.19/Math.max(.5,p.ratio),.08,.32),loseLoss=clamp(.27+.13/Math.max(.4,p.ratio),.27,.65),estimatedLoss=Math.round(troops*(winLoss*p.winChance/100+loseLoss*(1-p.winChance/100))*tactic.loss*medic),newEdges=c.neighbors.filter(id=>s.castles[id].owner!==s.clan&&!blocked(CASTLE_BY_ID[id])).length;
          const score=policy.style==='conserve'?-estimatedLoss-p.foodCost*.08+p.winChance:policy.style==='rapid'?p.winChance*30+(policy.priority==='expand'?newEdges*40:0)-estimatedLoss*.1-p.foodCost*.015:p.winChance*12-estimatedLoss*.35-p.foodCost*.035+(policy.priority==='expand'?newEdges*30:0);
          candidates.push({castleId:c.id,castleName:c.name,tactic:tactic.id,tacticName:tactic.name,troops,foodCost:p.foodCost,winChance:p.winChance,estimatedLoss,reserveAfter:{troops:s.troops-troops,rice:s.resources.rice-p.foodCost},score:Math.round(score*100)/100,defensePower:p.defensePower,castleDefense:this.previewBattle(c.id,'balanced',300).defensePower,travel:p.travel,distance:distances?.get(c.id)??0});
        }
      }
      if(!candidates.length)return result('wait','STRATEGY_NO_SAFE_ATTACK',`勝率${policy.minWinChance}%と兵・兵糧の温存条件を満たす出陣がありません。`);
      candidates.sort((a,b)=>a.distance-b.distance||(policy.priority==='weakest'?a.castleDefense-b.castleDefense:0)||b.score-a.score||a.foodCost-b.foodCost||a.troops-b.troops||a.castleId.localeCompare(b.castleId)||a.tactic.localeCompare(b.tactic));
      const chosen=candidates[0],alternatives=[];for(const c of candidates)if(!alternatives.some(v=>v.castleId===c.castleId)){alternatives.push(c);if(alternatives.length===3)break;}
      // A complete local fingerprint avoids hash collisions and any stale-plan
      // reuse. It is never sent to a service, persisted, or shown as game text.
      const token=JSON.stringify([policy,this.isAdmin,this.isStaff,!!STAFF_VIEW.get(this),s]);
      return result('attack','STRATEGY_ATTACK',`${chosen.castleName}へ${chosen.tacticName}で出陣。勝率${chosen.winChance}%、兵${chosen.troops.toLocaleString()}・兵糧${chosen.foodCost.toLocaleString()}。`,{...chosen,alternatives,token});
    }
    executeStrategy(policy,decision){
      const current=this.planStrategy(policy);
      if(!current.ok||current.action!=='attack')return{ok:false,changed:false,message:current.reason,decision:current,shouldStop:current.action==='stop'};
      if(!decision||decision.action!=='attack'||typeof decision.token!=='string'||decision.token!==current.token||decision.castleId!==current.castleId||decision.tactic!==current.tactic||decision.troops!==current.troops)return{ok:false,changed:false,code:'STRATEGY_CHANGED',message:'戦況が変わりました。最新の作戦を評価し直してください。',decision:current,shouldStop:false};
      const guard=this._guard();if(guard)return{...guard,changed:false,shouldStop:false};
      const result=this.departAttack(current.castleId,current.tactic,current.troops);if(!result.ok)return{...result,changed:false,shouldStop:false};
      return{...result,changed:true,decision:current,shouldStop:false,stopReason:null,nextDecision:this.planStrategy(policy)};
    }
    attack(castleId,tactic='balanced',troops=this.state.troops){
      const p=this.previewBattle(castleId,tactic,troops);if(!p.ok)return{...fail(p.message),...(p.code?{code:p.code}:{})};
      const s=this.state,c=this.castle(castleId),t=TACTICS.find(t=>t.id===tactic),random=this.random();
      const won=random<p.winChance/100;
      const lostRate=won?clamp(.08+.19/Math.max(.5,p.ratio),.08,.32):clamp(.27+.13/Math.max(.4,p.ratio),.27,.65);
      const medic=MARCH_CONTEXT.get(this)?.medic??this.state.army.some(id=>this.officer(id)?.skill==='medic');
      const ourLost=Math.min(p.troops,Math.max(30,Math.round(p.troops*lostRate*t.loss*(.92+this.random()*.16)*(medic?.9:1))));
      const enemyLost=won?c.troops:Math.max(0,Math.min(c.troops-100,Math.round(c.troops*clamp(p.ratio*.32,.08,.65))));
      this._pay({rice:p.foodCost});s.troops-=ourLost;s.stats.battles=Math.min(BATTLE_COUNTER_MAX,s.stats.battles+1);s.morale=clamp(s.morale+(won?5:-12),15,100);
      const rewards={gold:0,rice:0,magatama:0};
      const phases=[
        {title:'出陣',text:`${p.troops.toLocaleString()}の兵が${c.name}へ進軍。${t.name}を採用。`},
        {title:'開戦',text:`守備兵${c.troops.toLocaleString()}、城壁 Lv.${c.wall}。${p.scouted?'偵察で得た情報をもとに攻め手を定めた。':'敵の防備を見極めながら攻撃を開始した。'}`},
        {title:won?'突破':'激戦',text:won?'敵の守りを崩し、城門へと迫った。':'城兵の抵抗は強く、攻め手は消耗した。'},
        {title:won?'落城':'撤退',text:won?`${c.name}を制圧。領国に新たな旗が上がった。`:'被害の拡大を防ぐため軍を撤収。兵と兵糧を整え、再起を図る。'}
      ];
      let capturedOfficer=null,garrison=0;
      if(won){
        s.stats.wins=Math.min(BATTLE_COUNTER_MAX,s.stats.wins+1);s.prestige=Math.min(ASSET_CAP,s.prestige+20+c.wall*5);
        const firstCapture=!s.captureRewards.includes(castleId);
        const gained=this._gain({gold:450+c.wall*180,rice:500+c.wall*200,magatama:firstCapture?GACHA.firstCaptureReward:0});
        rewards.gold=gained.gold;rewards.rice=gained.rice;rewards.magatama=gained.magatama;
        if(firstCapture){
          s.captureRewards.push(castleId);
          const text=rewards.magatama>0?`この城の初攻略により、勾玉${rewards.magatama}を得た。`:'勾玉が所持上限に達しています。';
          phases.push({title:'初攻略の褒賞',text:text+'同じ城の再攻略では受け取れません。'});
        }
        garrison=Math.min(300,Math.floor((p.troops-ourLost)*.18));garrison=Math.min(garrison,s.troops);s.troops-=garrison;
        const removedBranches=new Set(s.branches.filter(branch=>branch.parentCastleId===castleId).map(branch=>branch.id));s.branches=s.branches.filter(branch=>branch.parentCastleId!==castleId);s.jobs=s.jobs.filter(job=>job.kind!=='branch'||!removedBranches.has(job.id));
        s.castles[castleId]={owner:s.clan,troops:garrison,wall:Math.max(1,c.wall-1),level:c.level};
        const candidates=this.roster.filter(o=>o.clan===c.owner&&!s.officers.includes(o.id));
        if(candidates.length){const chosen=candidates[Math.floor(this.random()*candidates.length)];this._grantOfficerVariant(chosen.id,this._baseGrantRank(chosen.id));capturedOfficer=chosen.id;phases.push({title:'帰順',text:`${chosen.name}が新たに家臣へ加わった。`});}
      }else s.castles[castleId].troops=c.troops-enemyLost;
      const durability=this._damageCastleDurability(castleId,{won,ratio:p.ratio,captured:won,before:c.durability});phases.push({title:'城郭の耐久',text:`耐久 ${durability.before.toLocaleString()} → ${durability.breachCurrent.toLocaleString()}。${won?'占領後は最大耐久の25%から修復を始めます。':'傷んだ防備は時間とともに修復されます。'}`});
      const report={won,durability,castleId,castleName:c.name,ourBefore:p.troops,ourLost,enemyBefore:c.troops,enemyLost,phases,rewards,capturedOfficer,garrison,tactic,turn:s.turn};
      s.lastBattle=report;this._updateCampaignOutcome();
      const text=won?`${c.name}を攻略！ ${garrison}人を守備兵として配置。${capturedOfficer?`${this.officer(capturedOfficer).name}が帰順。`:''}`:`${c.name}の攻城戦から撤退。兵${ourLost.toLocaleString()}人を失いました。`;
      const result=this._action(text,won?'victory':'defeat',{battle:report});
      if(s.won)this.log(`攻略対象の${this.unificationTarget()}城を統一。戦乱の世に、新しい天下が訪れました。`,'victory');
      return result;
    }
    static cpuTurnDue(turn){return turn>=5&&turn%3===0;}
    _cpuTurn(){
      const s=this.state;if(!SengokuEngine.cpuTurnDue(s.turn))return[];const events=[];
      const choices=[];
      for(const c of CASTLES){const a=s.castles[c.id];if(a.owner===s.clan)continue;for(const tid of c.neighbors){const b=s.castles[tid];if((tid===ADMIN_ASSETS.castleId||tid===STAFF_BASE_ID)&&!(b.owner===s.clan&&(s.covert.stations.some(v=>v.sourceCastleId===tid)||this.activeBranches(tid).length)))continue;if(a.owner===b.owner)continue;if((s.treaties[a.owner]||0)>s.turn&&b.owner===s.clan)continue;choices.push({from:c.id,to:tid});}}
      if(!choices.length)return events;
      const playerThreats=choices.filter(e=>s.castles[e.to].owner===s.clan),others=choices.filter(e=>s.castles[e.to].owner!==s.clan);
      const canRaid=playerThreats.length&&s.turn>=8&&this.random()<(s.difficulty==='hard'?.45:s.difficulty==='easy'?.16:.28);
      const pool=canRaid?playerThreats:others;
      if(!pool.length)return events;
      const move=pool[Math.floor(this.random()*pool.length)],a=s.castles[move.from],b=s.castles[move.to],ac=CASTLE_BY_ID[move.from],bc=CASTLE_BY_ID[move.to];
      if(b.owner===s.clan){
        if(s.turn*60000+s.realtime.elapsed*1000<=this.branchResolvedElapsedMs&&s.branches.some(branch=>branch.parentCastleId===move.to))return events;
        if((s.treaties[a.owner]||0)>s.turn)return events;
        this._recordCovertIncident(move.to,move.from);
        const branch=this.activeBranches(move.to)[0];if(branch){const defense=this.branchDefense(branch.id),attack=a.troops*(s.difficulty==='hard'?.85:s.difficulty==='easy'?.55:.7),held=defense.power>=attack*(.84+this.random()*.32);this.recordOfficerBattle({key:`defense:${s.walking.campaignId}:${s.turn}:${branch.id}`,won:held,role:'defense',army:branch.commanders||[]});a.troops=survivorsAfterLoss(a.troops,Math.round(defense.force*(held?.3:.1)),300);if(held){this._damageBranchDurability(branch.id,{won:false,ratio:attack/Math.max(1,defense.power)});events.push(`${a.owner}が${branch.name}へ侵攻しましたが、支拠点が守りを固めて撃退しました。`);}else{this._fallBranch(branch.id);events.push(`${a.owner}の攻撃で${branch.name}が陥落。親拠点の領有と守備資産は維持しました。`);}for(const event of events)this.log(event,'world');return events;}
        if(['edo',STAFF_BASE_ID].includes(move.to)){events.push(a.owner+'が'+bc.name+'へ侵攻。城の領有と守備資産を維持しました。');for(const e of events)this.log(e,'world');return events;}
        const home=move.to===s.home,reinforce=home?Math.round(s.troops*.45):Math.round(s.troops*.18),wall=home?s.buildings.wall:b.wall;
        const attack=a.troops*(s.difficulty==='hard'?.85:s.difficulty==='easy'?.55:.7),defense=this.defensePower(move.to);
        const beforeDurability=this.castle(move.to).durability,held=defense>=attack*(.84+this.random()*.32);
        this.recordOfficerBattle({key:`defense:${s.walking.campaignId}:${s.turn}:${move.from}:${move.to}`,won:held,role:'defense'});
        const fieldLoss=Math.min(s.troops,Math.round(reinforce*(held?.12:.3)));s.troops-=fieldLoss;
        if(held){b.troops=survivorsAfterLoss(b.troops,Math.round(b.troops*.18),100);a.troops=survivorsAfterLoss(a.troops,Math.round(attack*.3),300);s.prestige=Math.min(ASSET_CAP,s.prestige+5);events.push(`${a.owner}が${bc.name}へ侵攻。守備隊が撃退しました（援軍損失${fieldLoss}人）。`);}
        else{this._recordHomeDefenseLoss(move.to,move.from);this._recordBranchParentLoss(move.to);b.owner=a.owner;this._pruneBranches();if(s.jobs.some(j=>j.kind==='castle'&&j.id===move.to)){s.jobs=s.jobs.filter(j=>j.kind!=='castle'||j.id!==move.to);events.push(`${bc.name}の落城により、進行中の城郭拡張は中止されました。`);}b.troops=Math.max(250,Math.round(a.troops*.3));a.troops=survivorsAfterLoss(a.troops,Math.round(b.troops*.6),350);s.morale=clamp(s.morale-10,15,100);events.push(`${a.owner}の侵攻により${bc.name}を失いました。`);if(!this.ownedCastles().length){s.gameOver=true;events.push('最後の城が陥落しました。設定から新しい物語を始められます。');}else if(home){s.home=this.ownedCastles()[0].id;events.push(`${CASTLE_BY_ID[s.home].name}へ本拠を移しました。`);}}
        this._damageCastleDurability(move.to,{won:!held,ratio:attack/Math.max(1,defense),captured:!held,before:beforeDurability});
      }else{
        const beforeDurability=this.castle(move.to).durability,condition=beforeDurability.fortificationFactor,ratio=a.troops/Math.max(1,b.troops*(1+b.wall*.08*condition)*(1+(b.level-1)*.04*condition)),captured=this.random()<clamp(.32+(ratio-1)*.3,.1,.8);
        if(captured){const old=b.owner;b.owner=a.owner;b.troops=Math.max(450,Math.round(a.troops*.42));a.troops=survivorsAfterLoss(a.troops,Math.round(b.troops*.4),500);events.push(`${a.owner}が${old}の${bc.name}を攻略しました。`);}
        else{a.troops=survivorsAfterLoss(a.troops,Math.round(a.troops*.14),400);b.troops=survivorsAfterLoss(b.troops,Math.round(b.troops*.08),300);events.push(`${ac.name}の${a.owner}が${bc.name}へ進軍。両軍は戦いの後、兵を引きました。`);}
        this._damageCastleDurability(move.to,{won:captured,ratio,captured,before:beforeDurability});
      }
      for(const e of events)this.log(e,'world');return events;
    }
    setRunning(running){
      if(this.state.worldClock)return fail('時間は全プレイヤー共通です。個人では停止できません。');
      if(typeof running!=='boolean')return fail('進行状態が正しくありません。');
      if(running&&this.state.gameOver)return fail('領国を失っています。新しい物語を始めてください。');
      this.state.realtime.running=running;
      return{ok:true,message:running?'時の進行を再開しました。':'時を止めました。軍議を整えましょう。'};
    }
    setSpeed(speed){if(this.state.worldClock)return fail('速度は全プレイヤー共通です。');if(![1,2,4].includes(speed))return fail('速度は1・2・4倍から選んでください。');this.state.realtime.speed=speed;return{ok:true,message:`進行速度を${speed}倍にしました。`};}
    calendar(turn=this.state.turn){const absolute=Math.max(0,Math.floor(turn)),within=absolute%WORLD_CALENDAR.monthsPerCycle;return{year:WORLD_CALENDAR.startYear+Math.floor(within/12),month:within%12+1,cycle:Math.floor(absolute/WORLD_CALENDAR.monthsPerCycle)+1,turn:absolute};}
    applyWorldClock(clock,{maxSeconds=7200,deferCycleSettlement=false,rebalanceTroops=true,settleRepairs=true}={}){
      if(!clock||typeof clock.id!=='string'||!clock.id||clock.id.length>100||!Number.isSafeInteger(clock.elapsedMs)||clock.elapsedMs<0||Math.floor(clock.elapsedMs/60000)>MAX_TURN||typeof clock.running!=='boolean'||![1,2,4].includes(clock.speed))return{...fail('共通時刻を確認できません。'),changed:false,events:[],completed:[]};
      const s=this.state,rt=s.realtime,anchor=s.worldClock;
      const maintenance=MAINTENANCE_AUTHORITY.get(this),confirmedThrough=maintenance?.campaignId===s.walking.campaignId?maintenance.asOfElapsedMs:Infinity,maintenancePending=clock.elapsedMs>confirmedThrough;
      if(maintenancePending)clock={...clock,elapsedMs:confirmedThrough};
      rt.running=clock.running&&!s.gameOver;rt.speed=clock.speed;
      if(!anchor||anchor.id!==clock.id){
        const health=projectOfficerHealth(s,officerHealthElapsed(s));
        const delta=clock.elapsedMs-this._marchElapsed();for(const march of [s.march,...(s.covert.dispatches||[])])if(march&&march.authority!=='server'){march.departedElapsedMs=Math.max(0,march.departedElapsedMs+delta);march.arrivesElapsedMs=march.departedElapsedMs+march.travel.durationMs;}
        health.asOfElapsedMs=clamp(Math.round(health.asOfElapsedMs+delta),0,MAX_TURN*60000+59999);s.officerHealth=health;
        // Linking a campaign to a different clock changes the time origin; it
        // must not treat that offset as elapsed repair time.
        for(const [castleId,row] of Object.entries(s.castles))if(row.durability){const view=durabilityView(row.durability,{castleId,level:row.level,wall:row.wall,elapsedMs:elapsedMillis(s),recoveryMode:this._castleRecoveryMode(castleId)});row.durability={...normalizeDurability(view),updatedElapsedMs:clock.elapsedMs};}
        for(const row of s.branches)if(row.durability){const view=durabilityView(row.durability,{castleId:row.parentCastleId,level:row.level,branch:true,fallen:row.fallen||row.retreating,elapsedMs:elapsedMillis(s),recoveryMode:this._branchRecoveryMode(row)});row.durability={...normalizeDurability(view),updatedElapsedMs:clock.elapsedMs};}

        for(const job of s.jobs)if(job.kind==='branch'&&Number.isSafeInteger(job.completesElapsedMs)){
          job.completesElapsedMs=Math.max(0,Math.round(job.completesElapsedMs+delta));
        }
        for(const branch of s.branches)if(branch.facilityCompletedAt)branch.facilityCompletedAt=Object.fromEntries(Object.entries(branch.facilityCompletedAt).map(([id,times])=>[id,times.map(at=>Math.max(0,Math.round(at+delta)))]));
        const turn=Math.floor(clock.elapsedMs/60000),offset=turn-s.turn,shift=v=>Math.max(0,Math.min(MAX_TURN,Math.floor(v)+offset));
        s.treaties=Object.fromEntries(Object.entries(s.treaties).filter(([,until])=>until>s.turn).map(([clan,until])=>[clan,Math.min(MAX_TURN+6,turn+(until-s.turn))]));
        s.scouted=Object.fromEntries(Object.entries(s.scouted).filter(([,until])=>until>s.turn).map(([id,until])=>[id,Math.min(MAX_TURN+6,turn+(until-s.turn))]));
        for(const record of s.log)record.turn=shift(record.turn);
        for(const record of s.gachaHistory)record.turn=shift(record.turn);
        if(s.lastBattle)s.lastBattle.turn=shift(s.lastBattle.turn??s.turn);
        s.turn=turn;rt.elapsed=(clock.elapsedMs%60000)/1000;s.worldClock={id:clock.id,elapsedMs:clock.elapsedMs};s.cycle.index=Math.floor(turn/WORLD_CALENDAR.monthsPerCycle);s.upkeep.settledTurn=turn;s.repair.settledTurn=turn;
        this._projectStaffAt(clock.elapsedMs);rt.running=clock.running&&!s.gameOver;return{ok:true,changed:true,migrated:true,monthChanged:true,pending:false,...(maintenancePending?{maintenancePending:true}:{}),events:[],completed:[]};
      }
      // Absolute time is monotonic even when the visible calendar wraps to 1560.
      // A delayed packet cannot rewind resources, jobs or treaty expiry.
      if(clock.elapsedMs<=anchor.elapsedMs)return{ok:true,changed:false,pending:false,...(maintenancePending?{maintenancePending:true}:{}),events:[],completed:[]};
      const limit=Math.max(60,Math.min(86400,Number(maxSeconds)||7200))*1000;
      const cycleMs=WORLD_CALENDAR.monthsPerCycle*60000,nextBoundary=(s.cycle.index+1)*cycleMs;
      const settlementRequired=deferCycleSettlement&&clock.elapsedMs>=nextBoundary;
      const target=Math.min(clock.elapsedMs,anchor.elapsedMs+limit,settlementRequired?Math.max(anchor.elapsedMs,nextBoundary-1):Infinity);
      const events=[],completed=[],cycleRewards=[],marchResults=[],covertResults=[];let changed=false,monthChanged=false;
      while(anchor.elapsedMs<target){
        this._projectStaffAt(anchor.elapsedMs);
        // A defeated private campaign stops earning until its appointment. Split
        // here so becoming staff can resume the remaining shared-clock interval.
        const priorCycle=s.cycle.index,boundary=(s.cycle.index+1)*cycleMs,accessSince=this.isStaff?STAFF_VIEW.get(this)?.base.accessSinceElapsedMs:0,clanSince=this.isStaff?STAFF_VIEW.get(this)?.base.clanSinceElapsedMs:0,end=Math.min(target,Math.max(anchor.elapsedMs+1,boundary),accessSince>anchor.elapsedMs?accessSince:Infinity,clanSince>anchor.elapsedMs?clanSince:Infinity);
        const result=s.gameOver?{events:[],completed:[],monthChanged:Math.floor(end/60000)!==s.turn}:this._advanceRealtime((end-anchor.elapsedMs)/1000,{rebalanceTroops,settleRepairs});
        events.push(...result.events);completed.push(...result.completed);marchResults.push(...(result.marchResults||[]));covertResults.push(...(result.covertResults||[]));monthChanged=monthChanged||result.monthChanged;changed=true;
        s.turn=Math.floor(end/60000);rt.elapsed=(end%60000)/1000;anchor.elapsedMs=end;this._projectStaffAt(end);
        const reward=this._settleCycle(Math.floor(s.turn/WORLD_CALENDAR.monthsPerCycle))||(s.cycle.index>priorCycle?s.cycle.latestReward:null);if(reward){cycleRewards.push(reward);events.push(`占領${reward.captured}城の周回報酬を受け取りました。`);}
      }
      rt.running=clock.running&&!s.gameOver;rt.speed=clock.speed;this._projectStaffAt(target);
      return{ok:true,events,completed,cycleRewards,marchResults,covertResults,changed,monthChanged,settlementRequired:settlementRequired&&target>=nextBoundary-1,pending:target<clock.elapsedMs&&(!settlementRequired||target<nextBoundary-1),...(maintenancePending?{maintenancePending:true}:{}),remainingSeconds:(clock.elapsedMs-target)/1000};
    }
    _settleCycle(index){
      const s=this.state;if(index<=s.cycle.index)return null;
      this._cancelMarch('周回の切り替えにより出陣を中止し、兵と出陣費用を戻しました。');if(this._cancelCovertDispatches)this._cancelCovertDispatches('周回の切り替えにより派遣部隊が帰還しました。');
      this._rememberStaffPersonalProgress();
      const view=this.isStaff?STAFF_VIEW.get(this):null,beforeAppointment=view&&s.turn*60000+s.realtime.elapsed*1000<(view.base.accessSinceElapsedMs||0);
      const home=this.isAdmin?ADMIN_ASSETS.castleId:beforeAppointment?view.personalCycleHome:this.isStaff?STAFF_BASE_ID:s.cycle.home;
      const captured=CASTLES.filter(c=>c.id!==home&&s.castles[c.id].owner===s.clan&&this.canOwnCastle(c.id)).length;
      const reward={cycle:s.cycle.index,captured,gold:captured*1000,rice:captured*1000,magatama:captured*100};
      const homeBefore={...s.castles[home]},scale={easy:.8,normal:1,hard:1.2}[s.difficulty];
      s.castles=Object.fromEntries(CASTLES.map(c=>[c.id,c.id===home?{...homeBefore,owner:s.clan,troops:Math.max(1200,homeBefore.troops),wall:Math.max(homeBefore.wall,s.buildings.wall)}:{owner:c.clan===s.clan?'在地衆':c.clan,troops:Math.round(c.initialTroops*scale),wall:c.wall,level:1}]));
      s.home=home;s.cycle={index,home,latestReward:reward};s.jobs=s.jobs.filter(job=>job.kind!=='castle'||job.id===home);this._pruneBranches();
      s.treaties={};s.scouted={};s.captureRewards=[home];s.lastBattle=null;s.won=false;s.gameOver=false;
      this._gain({gold:reward.gold,rice:reward.rice,magatama:reward.magatama});
      this.log(`領地を精算しました。占領${captured}城の報酬：勾玉${reward.magatama}・金銭${reward.gold}・兵糧${reward.rice}。${CASTLE_BY_ID[home].name}から再出発します。`,'cycle');
      return reward;
    }
    constructionProgress(job){return job&&job.totalSeconds>0?clamp((1-job.remainingSeconds/job.totalSeconds)*100,0,100):0;}
    tick(deltaSeconds){
      if(this.state.worldClock)return{ok:true,events:[],completed:[],changed:false,monthChanged:false};
      if(typeof deltaSeconds!=='number'||!Number.isFinite(deltaSeconds)||deltaSeconds<0)return{...fail('経過時間が正しくありません。'),events:[],completed:[],changed:false,monthChanged:false};
      if(!this.state.realtime.running||this.state.gameOver||deltaSeconds===0)return{ok:true,events:[],completed:[],changed:false,monthChanged:false};
      // A suspended tab never produces an unbounded catch-up. The UI also pauses hidden tabs.
      return this._advanceRealtime(Math.min(5,deltaSeconds)*this.state.realtime.speed);
    }
    _advanceRealtime(seconds,{rebalanceTroops=true,settleRepairs=true}={}){
      const maintenance=MAINTENANCE_AUTHORITY.get(this),authority=maintenance?.campaignId===this.state.walking.campaignId?maintenance:null,elapsedBefore=elapsedMillis(this.state),maintenancePending=Boolean(authority&&seconds>(authority.asOfElapsedMs-elapsedBefore)/1000);
      if(authority)seconds=Math.max(0,Math.min(seconds,(authority.asOfElapsedMs-elapsedBefore)/1000));
      const s=this.state,rt=s.realtime,events=[],completed=[],marchResults=[],covertResults=[],priorMarchIds=new Set(s.marchHistory.map(v=>v.id));this._pruneBranches();let left=seconds,monthChanged=false;
      const settle=()=>{for(const result of this.resolveDueMarches()){marchResults.push(result);events.push(result.message);}if(this.settleCovertDue)for(const result of this.settleCovertDue()){covertResults.push(result);events.push(result.message);}};settle();
      const precise=v=>Math.round(v*1e8)/1e8;
      while(left>1e-8&&!s.gameOver){
        // Rates only change at a monthly boundary or completion. Integrating each
        // interval makes long shared-clock catch-up exact without one loop per second.
        const elapsed=elapsedMillis(s);this._projectStaffAt(elapsed);const view=this.isStaff?STAFF_VIEW.get(this):null,nextShared=view?Math.min(...view.events.filter(e=>e.effectiveElapsedMs>elapsed).map(e=>e.effectiveElapsedMs),view.base.accessSinceElapsedMs>elapsed?view.base.accessSinceElapsedMs:Infinity,view.base.clanSinceElapsedMs>elapsed?view.base.clanSinceElapsedMs:Infinity):Infinity;
        const activeJobs=new Set(),activeKeys=new Set();let nextBranchStart=Infinity;
        for(const job of s.jobs){
          const key=job.kind+':'+job.id;if(activeKeys.has(key))continue;activeKeys.add(key);
          // A defender can receive a completed predecessor before catching up
          // its private clock. Its successor must still wait for the promised start.
          const start=job.kind==='branch'&&Number.isSafeInteger(job.completesElapsedMs)?
            job.completesElapsedMs-job.remainingSeconds*1000:elapsed;
          if(start>elapsed+.00001)nextBranchStart=Math.min(nextBranchStart,start);
          else activeJobs.add(job);
        }
        const nextMarch=s.march?.authority==='local'?s.march.arrivesElapsedMs:Infinity,nextCovert=Math.min(Infinity,...(s.covert.dispatches||[]).filter(v=>v.authority!=='server'&&(v.target.kind==='castle'||v.phase==='returning')&&v.arrivesElapsedMs>elapsed).map(v=>v.arrivesElapsedMs));
        // A defender can receive a server-completed facility while its normal
        // checkpoint is still older. Its recorded completion boundary prevents
        // retroactive resource production during later clock catch-up.
        const nextFacility=Math.min(Infinity,...s.branches.flatMap(branch=>Object.values(branch.facilityCompletedAt||{}).flatMap(times=>{const at=times.find(at=>at>elapsed);return at===undefined?[]:[at];})));
        const nextMaintenance=maintenanceBoundaryAfter(authority,elapsed);
        const step=Math.min(left,60-rt.elapsed,...[...activeJobs].map(j=>j.remainingSeconds),(nextShared-elapsed)/1000,(nextMarch-elapsed)/1000,(nextCovert-elapsed)/1000,(nextFacility-elapsed)/1000,(nextBranchStart-elapsed)/1000,(nextMaintenance-elapsed)/1000);
        if(!(step>0))break;
        s.officerHealth=projectOfficerHealth(s,Math.round(elapsed+step*1000));
        const income=this.income();
        for(const key of RESOURCES){
          const accrued=rt.incomeRemainders[key]+(income.operatingNet||income)[key]*step/60;
          const units=Math.trunc(accrued+Math.sign(accrued)*1e-9);
          const before=s.resources[key],after=clamp(before+units,0,ASSET_CAP);
          s.resources[key]=after;
          rt.incomeRemainders[key]=Math.abs(accrued-units)<1e-8?0:accrued-units;
          if((after===0&&accrued<0)||(after===ASSET_CAP&&accrued>0))rt.incomeRemainders[key]=0;
        }
        const pending=[];
        for(const job of s.jobs){
          if(!activeJobs.has(job)){pending.push(job);continue;}
          job.remainingSeconds=precise(Math.max(0,job.remainingSeconds-step));
          job.remaining=Math.max(0,Math.ceil((job.remainingSeconds-1e-8)/60));
          if(job.remainingSeconds<=1e-8){
            const def=job.kind==='branch'&&job.facilityId?BRANCH_FACILITIES.find(v=>v.id===job.facilityId):(job.kind==='building'?BUILDINGS:job.kind==='castle'?CASTLES:job.kind==='branch'?BRANCH_SITES:TECHS).find(v=>v.id===job.id);
            if(job.kind==='building'){
              const staffView=this.isStaff?STAFF_VIEW.get(this):null,personal=staffView?.personalBuildings;
              (personal||s.buildings)[job.id]=job.targetLevel;s.stats.upgrades++;
              if(job.id==='wall'){
                if(!staffView||staffView.phase==='personal')s.castles[s.home].wall=Math.max(s.castles[s.home].wall,job.targetLevel);
                else if(!['edo',STAFF_BASE_ID].includes(staffView.personalHome)){staffView.personalHomeCastle.wall=Math.max(staffView.personalHomeCastle.wall,job.targetLevel);const former=s.castles[staffView.personalHome];if(former.owner===s.clan)former.wall=Math.max(former.wall,job.targetLevel);}
                this._anchorCastleDurability(staffView&&staffView.phase!=='personal'?staffView.personalHome:s.home,Math.round(elapsed+step*1000));this._rememberStaffPersonalProgress();
              }
            }
            else if(job.kind==='castle'){
              const staffView=this.isStaff?STAFF_VIEW.get(this):null;
              if(staffView&&job.id===STAFF_BASE_ID){
                // An old private job never upgrades the shared palace. Its
                // completion belongs to the private export and survives reload.
                staffView.personalBaseLevel=job.targetLevel;staffView.personalBaseCastle.level=job.targetLevel;
                if(staffView.phase==='personal'){s.castles[job.id].level=job.targetLevel;this._anchorCastleDurability(job.id,Math.round(elapsed+step*1000));}
              }else{s.castles[job.id].level=job.targetLevel;this._anchorCastleDurability(job.id,Math.round(elapsed+step*1000));}
              s.stats.castleUpgrades++;this._rememberStaffPersonalProgress();
            }
            else if(job.kind==='branch'){const branch=s.branches.find(row=>row.id===job.id);if(!branch)continue;if(job.facilityId){if(!completeBranchFacility(branch,job,elapsed+step*1000))continue;}else{branch.level=job.targetLevel;branch.fallen=false;if(job.repair)delete branch.durability;else this._anchorBranchDurability(branch.id,Math.round(elapsed+step*1000));}}
            else{s.tech[job.id]=job.targetLevel;s.stats.researches++;}
            const name=job.kind==='branch'&&job.facilityId?BRANCH_BY_ID[job.id].name+'・'+def.name:def.name,text=`${name} Lv.${job.targetLevel}の${job.repair?'修復':job.kind==='research'?'研究':'普請'}が完成しました。`;
            events.push(text);this.log(text,'complete');completed.push({kind:job.kind,id:job.id,name,level:job.targetLevel,...(job.repair?{repair:true}:{}),...(job.facilityId?{facilityId:job.facilityId}:{})});
          }else pending.push(job);
        }
        s.jobs=pending;
        if(s.command<this.commandMax()){
          rt.commandProgress=precise(rt.commandProgress+step);
          while(rt.commandProgress>=20-1e-8&&s.command<this.commandMax()){s.command++;rt.commandProgress=precise(Math.max(0,rt.commandProgress-20));}
          if(s.command>=this.commandMax())rt.commandProgress=0;
        }else rt.commandProgress=0;
        rt.elapsed=precise(rt.elapsed+step);left=precise(left-step);
        const monthlyBoundary=rt.elapsed>=60-1e-8;
        if(monthlyBoundary){rt.elapsed=0;monthChanged=true;events.push(...this._advanceMonth({settleRepairs}));}
        settle();
        // Adjust troop upkeep once as a new month begins, after that boundary's
        // completions, garrison growth and arrivals. Midmonth changes wait for
        // the next month; the saved monthly receipt prevents a repeated check.
        if(monthlyBoundary&&rebalanceTroops){this._projectStaffAt(elapsedMillis(s));const balance=this.settleMonthlyUpkeep();if(balance.changed)events.push(balance.message);}
      }
      if(s.gameOver){rt.running=false;settle();}
      for(const result of s.marchHistory)if(!priorMarchIds.has(result.id)&&!marchResults.some(v=>v.id===result.id))marchResults.push(copy(result));
      const calendar=this.calendar();
      return{ok:true,message:monthChanged?`${calendar.year}年${calendar.month}月になりました。`:completed.length?events[0]:'',events,completed,marchResults,covertResults,changed:seconds>0||marchResults.length>0||covertResults.length>0,monthChanged,...(maintenancePending?{maintenancePending:true}:{})};
    }
    _advanceMonth({settleRepairs=true}={}){
      const s=this.state,events=[];s.turn++;this._projectStaffAt(s.turn*60000);
      if(settleRepairs){const repaired=this.settleMonthlyRepairs();if(repaired.message)events.push(repaired.message);}
      const cycleReset=this._settleCycle(Math.floor(s.turn/WORLD_CALENDAR.monthsPerCycle));
      this._gain({magatama:GACHA.monthlyReward});events.push(`月次褒賞として勾玉${GACHA.monthlyReward}を受け取りました。`);
      // Production, jobs and command recovery already progressed continuously in tick().
      s.morale=clamp(s.morale+2,15,100);
      for(const c of CASTLES){const v=s.castles[c.id];if(v.owner===s.clan)v.troops=Math.min(Math.max(v.troops,1200+s.buildings.wall*300),v.troops+60);else v.troops=Math.min(s.difficulty==='hard'?8500:6500,v.troops+(s.difficulty==='hard'?110:s.difficulty==='easy'?40:70));}
      for(const [clan,until]of Object.entries(s.treaties)){if(until<=s.turn){delete s.treaties[clan];events.push(`${clan}との同盟期間が終了しました。`);}}
      for(const [id,until]of Object.entries(s.scouted))if(until<=s.turn)delete s.scouted[id];
      if(s.turn%4===0){const roll=this.random();if(roll<.25){const gain=350+s.buildings.market*70;this._gain({gold:gain});events.push(`城下で市が賑わい、臨時収入${gain}を得ました。`);}else if(roll<.5){const gain=500+s.buildings.farm*80;this._gain({rice:gain});events.push(`豊作により兵糧${gain}を追加で収穫しました。`);}else if(roll<.7){this._gain({wood:300,stone:200});events.push('領民の協力により木材300・石材200が集まりました。');}else if(roll<.85){s.morale=clamp(s.morale+8,15,100);events.push('軍中に結束が広がり、士気が8上昇しました。');}else{const loss=Math.min(250,s.resources.rice);s.resources.rice-=loss;events.push(`長雨により兵糧${loss}を失いました。`);}}
      const calendar=this.calendar();this.log(`${calendar.year}年${calendar.month}月。領内の月次報告が届きました。`,'calendar');
      for(const e of events)this.log(e,'event');if(!cycleReset)events.push(...this._cpuTurn());return events;
    }
    // Compatibility/testing helper. The game UI uses tick(), pause and speed controls only.
    nextTurn(){if(this.state.worldClock)return fail('年月は全プレイヤー共通の時刻で進みます。');if(this.state.gameOver)return fail('最後の城を失っています。新しい物語を始めてください。');return this._advanceRealtime(60);}
    questStatus(id){const q=QUESTS.find(q=>q.id===id);if(!q)return{complete:false,claimed:false,progress:0,target:0};const s=this.state,target=id==='unify'?this.unificationTarget():q.target;let progress=0;switch(id){case'first_upgrade':progress=s.stats.upgrades;break;case'first_recruit':progress=s.stats.recruited;break;case'first_battle':progress=s.stats.wins;break;case'three_castles':case'ten_castles':case'unify':progress=this.ownedCastles().length;break;case'five_officers':progress=s.officers.length;break;case'technology':progress=s.stats.researches;break;}return{complete:progress>=target,claimed:s.claimedQuests.includes(id),progress:Math.min(target,progress),target};}
    claimQuest(id){
      const q=QUESTS.find(q=>q.id===id);if(!q)return fail('目標が見つかりません。');
      const status=this.questStatus(id);if(status.claimed)return fail('この報酬は受け取り済みです。');if(!status.complete)return fail('まだ目標を達成していません。');
      const credited=this._gain(q.reward),rewards=Object.fromEntries(Object.keys(q.reward).map(key=>[key,credited[key]]));
      this.state.claimedQuests.push(id);this.state.prestige=Math.min(ASSET_CAP,this.state.prestige+q.prestige);
      const limited=Object.keys(q.reward).some(key=>rewards[key]<q.reward[key]);
      const message=`「${q.name}」の報酬を受け取りました。${limited?'所持上限に達した資産は、空きのある分まで加算しました。':''}`;
      this.log(message,'quest');return{ok:true,message,rewards};
    }
    exportSave(){this._pruneBranches();this._rememberStaffPersonalProgress();const state=copy(this.state),view=this.isStaff?STAFF_VIEW.get(this):null;if(view){state.buildings=copy(view.personalBuildings);state.castles[STAFF_BASE_ID].level=view.personalBaseLevel;state.castles[STAFF_BASE_ID].wall=view.personalBaseWall;}if(this.isStaff){const origin=STAFF_ORIGIN.get(this),homeCastle=view?.personalHomeCastle||origin?.homeCastle;state.staffService={baseId:STAFF_BASE_ID,...(origin?{personalClan:origin.clan,personalHome:origin.home,personalCycleHome:origin.cycleHome}:{}),...(homeCastle?{personalHomeCastle:copy(homeCastle)}:{})};}normalizeAssets(state);return JSON.stringify({game:'sengoku-tento',version:2,savedAt:new Date().toISOString(),state},null,2);}
    static fromSave(raw,officers,options={}){
      let obj;try{obj=typeof raw==='string'?JSON.parse(raw):copy(raw);}catch(e){throw new Error('セーブデータを読み取れません。JSONファイルを選んでください。');}
      const s=obj?.state||obj,legacyRepair=s?.repair===undefined;
      const invalid=()=>{throw new Error('このセーブデータは形式または内容が正しくありません。');};
      const isObj=v=>v&&typeof v==='object'&&!Array.isArray(v);
      const num=(v,min=0,max=999999999)=>typeof v==='number'&&Number.isFinite(v)&&Number.isInteger(v)&&v>=min&&v<=max;
      if(!isObj(s)||s.version!==2||obj?.game&&obj.game!=='sengoku-tento')invalid();
      if(s.clan!==ADMIN_ASSETS.clanName&&!CLANS.some(c=>c.name===s.clan)||!CASTLE_BY_ID[s.home]||!['easy','normal','hard'].includes(s.difficulty))invalid();
      if(s.magatama===undefined)s.magatama=GACHA.initial;try{normalizeAssets(s);}catch(error){invalid();}
      const g=new SengokuEngine({clan:s.clan===ADMIN_ASSETS.clanName?'徳川家':s.clan,difficulty:s.difficulty,officers,isAdmin:options?.isAdmin===true,isStaff:options?.isStaff===true,isCourtEmperor:options?.isCourtEmperor===true});
      const oldMap=isObj(s.castles)&&!Object.hasOwn(s.castles,STAFF_BASE_ID)&&Object.keys(s.castles).length===CASTLES.length-1&&CASTLES.filter(c=>c.id!==STAFF_BASE_ID).every(c=>Object.hasOwn(s.castles,c.id));
      const legacyStaff=s.staffService?.baseId==='sunpu'||oldMap&&s.home==='sunpu'&&(s.clan===ADMIN_ASSETS.clanName||g.isStaff);
      if(oldMap){const original=CASTLE_BY_ID[STAFF_BASE_ID],scale={easy:.8,normal:1,hard:1.2}[s.difficulty];s.castles[STAFF_BASE_ID]={owner:original.clan===s.clan?'在地衆':original.clan,troops:Math.round(original.initialTroops*scale),wall:original.wall,level:1};}
      if(legacyStaff&&isObj(s.castles)&&isObj(s.castles.sunpu)&&isObj(s.castles[STAFF_BASE_ID])){
        // The old staff garrison moves once. Resetting the old reserved slot
        // prevents duplicate troops/levels while leaving global assets intact.
        const old=s.castles.sunpu,wasHome=s.home==='sunpu',owned=old.owner===s.clan;if(!num(old.level??1,1,64))invalid();
        if(wasHome||owned){
          s.castles[STAFF_BASE_ID]=copy(old);const original=CASTLE_BY_ID.sunpu;
          s.castles.sunpu={owner:original.clan===s.clan?'在地衆':original.clan,troops:original.initialTroops,wall:original.wall,level:1};
          if(wasHome)s.home=STAFF_BASE_ID;if(s.cycle?.home==='sunpu')s.cycle.home=STAFF_BASE_ID;
          if(Array.isArray(s.jobs))s.jobs=s.jobs.map(job=>job?.kind==='castle'&&job.id==='sunpu'?{...job,id:STAFF_BASE_ID}:job);
          if(Array.isArray(s.captureRewards))s.captureRewards=[...new Set(s.captureRewards.map(id=>id==='sunpu'?STAFF_BASE_ID:id))];
        }
        if(s.staffService)s.staffService={...s.staffService,baseId:STAFF_BASE_ID};
      }
      const serviceSave=[STAFF_BASE_ID,'sunpu'].includes(s.staffService?.baseId);if(serviceSave&&!g.isStaff){s.command=Math.min(Number(s.command),3+Math.floor(s.buildings?.keep/8));if(isObj(s.governors))s.governors=Object.fromEntries(Object.entries(s.governors).filter(([id])=>!BUILDINGS.some(b=>b.id===id)||s.buildings?.[id]>0));}
      if(s.troopTransferSequence===undefined)s.troopTransferSequence=0;
      if(!num(s.turn,0,MAX_TURN)||!num(s.troops,0,ASSET_CAP)||!num(s.troopTransferSequence,0,1000000000)||!num(s.morale,0,100)||!num(s.prestige)||!num(s.command,0,7)||!num(s.seed,0,4294967295))invalid();
      s.upkeep=normalizeUpkeepState(s.upkeep,s.turn);
      s.repair=normalizeRepairState(s.repair,s.turn);
      if(!isObj(s.resources)||!RESOURCES.every(k=>num(s.resources[k])))invalid();
      if(!isObj(s.buildings)||Object.keys(s.buildings).length!==BUILDINGS.length||!BUILDINGS.every(b=>num(s.buildings[b.id],b.core?1:0,32)))invalid();
      if(!g.isStaff&&s.command>3+Math.floor(s.buildings.keep/8))invalid();
      if(!isObj(s.tech)||!TECHS.every(t=>num(s.tech[t.id],0,t.max)))invalid();
      const validOwner=new Set([...CASTLES.map(c=>c.clan),'在地衆',ADMIN_ASSETS.clanName]);for(const c of CLANS)validOwner.add(c.name);
      // Legacy metropolitan saves used Lv.64. Validate that former range first,
      // then lower only those three castle levels; retain the complete campaign.
      const legacyCastleLevels=new Map();
      if(!isObj(s.castles)||Object.keys(s.castles).length!==CASTLES.length||!CASTLES.every(c=>{const v=s.castles[c.id],limit=g.castleLevelLimit(c.id),legacyLimit=['sunpu','nijo','osaka','nagoya'].includes(c.id)?64:limit;if(isObj(v)&&v.level===undefined)v.level=1;const valid=isObj(v)&&validOwner.has(v.owner)&&num(v.troops,0,ASSET_CAP)&&num(v.wall,1,32)&&num(v.level,1,legacyLimit);if(valid&&v.level>limit){legacyCastleLevels.set(c.id,v.level);v.level=limit;}return valid;}))invalid();
      try{for(const row of Object.values(s.castles))if(row.durability!==undefined)row.durability=normalizeDurability(row.durability);}catch{invalid();}
      if(!Array.isArray(s.officers)||s.officers.length>g.roster.length||new Set(s.officers).size!==s.officers.length||s.officers.some(id=>typeof id!=='string'||!g.officer(id)))invalid();
      if(!Array.isArray(s.army)||s.army.length>3||new Set(s.army).size!==s.army.length||s.army.some(id=>!s.officers.includes(id)))invalid();
      if(!isObj(s.governors)||Object.keys(s.governors).some(id=>!BUILDINGS.some(b=>b.id===id)||!g.isStaff&&s.buildings[id]<1)||Object.values(s.governors).some(id=>!s.officers.includes(id)||s.army.includes(id))||new Set(Object.values(s.governors)).size!==Object.values(s.governors).length)invalid();
      const scalar=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
      if(s.realtime===undefined)s.realtime={running:true,speed:1,elapsed:0,commandProgress:0,incomeRemainders:{gold:0,rice:0,wood:0,stone:0}};
      const rt=s.realtime;
      if(s.worldClock!==undefined&&(!isObj(s.worldClock)||typeof s.worldClock.id!=='string'||!s.worldClock.id||s.worldClock.id.length>100||!Number.isSafeInteger(s.worldClock.elapsedMs)||s.worldClock.elapsedMs<0||Math.floor(s.worldClock.elapsedMs/60000)!==s.turn||Math.abs((s.worldClock.elapsedMs%60000)/1000-rt.elapsed)>.00001))invalid();
      if(!isObj(rt)||typeof rt.running!=='boolean'||![1,2,4].includes(rt.speed)||!scalar(rt.elapsed,0,59.99999999)||!scalar(rt.commandProgress,0,19.99999999)||!isObj(rt.incomeRemainders)||Object.keys(rt.incomeRemainders).length!==4||!RESOURCES.every(k=>scalar(rt.incomeRemainders[k],-1,1)&&Math.abs(rt.incomeRemainders[k])<1))invalid();
      s.officerHealth=normalizeOfficerHealth(s.officerHealth,s);if(!s.officerHealth)invalid();
      if(!Array.isArray(s.jobs)||s.jobs.length>MAX_CONSTRUCTION_JOBS)invalid();
      for(const j of s.jobs){if(!isObj(j))invalid();if(j.remainingSeconds===undefined)j.remainingSeconds=j.remaining*60;if(j.totalSeconds===undefined)j.totalSeconds=j.total*60;if(!scalar(j.remainingSeconds,.00000001,180)||!num(j.totalSeconds,60,180)||j.totalSeconds!==j.total*60||j.remainingSeconds>j.totalSeconds||j.remaining!==Math.ceil((j.remainingSeconds-1e-8)/60))invalid();}
      // Pre-release local exports allowed a single Edo branch up to Lv.32.
      // The revised four-direction layout caps every branch at Lv.8, without
      // granting assets or restoring a fallen defense. Server uploads remain
      // strict through normalizeBranchState before reaching this compatibility.
      const legacyEdo=new Map();if(Array.isArray(s.branches))for(const row of s.branches)if(row?.parentCastleId==='edo'&&BRANCH_BY_ID[row.id]?.parentCastleId==='edo'&&num(row.level,8,32)){legacyEdo.set(row.id,{level:row.level,fallen:row.fallen===true});row.level=Math.min(row.level,8);}
      s.jobs=s.jobs.flatMap(job=>{const legacy=job.kind==='branch'&&legacyEdo.get(job.id);if(!legacy)return[job];const repair=job.repair===true,stage=Math.max(1,repair?legacy.level-1:legacy.level),turns=stage>=16?3:stage>=6?2:1;
        if(legacy.level>8&&job.targetLevel!==(repair?legacy.level:legacy.level+1))invalid();
        if(job.targetLevel>8&&job.targetLevel<=32&&job.targetLevel===(repair?legacy.level:legacy.level+1)){
          if(job.repair!==undefined&&!repair||repair!==legacy.fallen||job.total!==turns||job.totalSeconds!==turns*60||job.completesElapsedMs!==undefined&&(!Number.isSafeInteger(job.completesElapsedMs)||job.completesElapsedMs<0))invalid();
          if(!repair)return[];
          const cost=branchUpgradeCost('edo',7),remainingSeconds=Math.min(job.remainingSeconds,cost.seconds),elapsed=s.worldClock?.elapsedMs??s.turn*60000+s.realtime.elapsed*1000;
          return[{...job,targetLevel:8,total:cost.turns,totalSeconds:cost.seconds,remainingSeconds,remaining:Math.ceil((remainingSeconds-1e-8)/60),...(job.completesElapsedMs!==undefined?{completesElapsedMs:Math.min(job.completesElapsedMs,Math.round(elapsed+remainingSeconds*1000))}:{})}];
        }return[job];
      });
      try{s.branches=normalizeBranchState(s.branches,{castles:s.castles,clan:s.clan,jobs:s.jobs,officers:s.officers,army:s.army,governors:s.governors,isAdmin:g.isAdmin,validateRole:false});}catch(error){invalid();}
      const jobkeys=new Map();
      for(const j of s.jobs){
        if(!isObj(j)||!['building','castle','research','branch'].includes(j.kind)||!num(j.remaining,1,3)||!num(j.total,1,3)||j.remaining>j.total)invalid();
        const key=j.kind+':'+j.id,count=jobkeys.get(key)||0;jobkeys.set(key,count+1);
        // The branch validator walks each mixed FIFO in order, applying the
        // scheduled body/individual facility stages to all later checks.
        if(j.kind==='branch')continue;
        const castle=j.kind==='castle',research=j.kind==='research';
        const defs=castle?CASTLES:research?TECHS:BUILDINGS;
        const current=castle?(legacyCastleLevels.get(j.id)??s.castles[j.id]?.level):(research?s.tech:s.buildings)[j.id];
        const limit=castle?(['sunpu','nijo','osaka','nagoya'].includes(j.id)?64:g.castleLevelLimit(j.id)):research?5:32;
        if(!defs.some(d=>d.id===j.id)||j.targetLevel!==current+count+1||j.targetLevel>limit||
          castle&&s.castles[j.id]?.owner!==s.clan||count&&(j.kind!=='building'||j.remainingSeconds!==j.totalSeconds))invalid();
      }
      if(s.jobs.filter(j=>j.kind==='research').length>1||[...jobkeys.keys()].filter(key=>!key.startsWith('research:')).length>(g.isStaff||serviceSave?6:2+Math.floor(s.buildings.keep/8)))invalid();
      s.jobs=s.jobs.filter(j=>j.kind!=='castle'||j.targetLevel<=g.castleLevelLimit(j.id));
      if(!isObj(s.treaties)||Object.entries(s.treaties).some(([k,v])=>!validOwner.has(k)||k===s.clan||!num(v,0,MAX_TURN+6)))invalid();
      if(!isObj(s.scouted)||Object.entries(s.scouted).some(([k,v])=>!CASTLE_BY_ID[k]||!num(v,0,MAX_TURN+6)))invalid();
      if(!Array.isArray(s.claimedQuests)||new Set(s.claimedQuests).size!==s.claimedQuests.length||s.claimedQuests.some(id=>!QUESTS.some(q=>q.id===id)))invalid();
      if(s.giftReceipts===undefined)s.giftReceipts=[];
      if(!Array.isArray(s.giftReceipts)||s.giftReceipts.length>2000||new Set(s.giftReceipts).size!==s.giftReceipts.length||s.giftReceipts.some(id=>typeof id!=='string'||id.length<1||id.length>128))invalid();
      s.walking=walkingState(s.walking);
      s.roaming=roamingState(s.roaming,s.walking.campaignId);
      s.covert=covertState(s.covert,s.walking.campaignId);
      s.march=normalizeMarch(s.march,s);s.marchHistory=normalizeMarchHistory(s.marchHistory,s);
      s.progress=normalizePlayerProgress(s.progress,s);
      if(s.magatama===undefined)s.magatama=GACHA.initial;if(!num(s.magatama))invalid();
      if(s.captureRewards===undefined)s.captureRewards=CASTLES.filter(c=>s.castles[c.id].owner===s.clan).map(c=>c.id);
      if(!Array.isArray(s.captureRewards)||s.captureRewards.length>CASTLES.length||new Set(s.captureRewards).size!==s.captureRewards.length||s.captureRewards.some(id=>typeof id!=='string'||!CASTLE_BY_ID[id]))invalid();
      if(!isObj(s.stats)||!['battles','wins','upgrades','recruited'].every(k=>num(s.stats[k],0,10000000))||s.stats.wins>s.stats.battles)invalid();
      for(const key of ['gachaDraws','gachaDuplicates','castleUpgrades']){if(s.stats[key]===undefined)s.stats[key]=0;if(!num(s.stats[key],0,10000000))invalid();}if(s.stats.gachaDuplicates>s.stats.gachaDraws)invalid();
      if(s.gachaHistory===undefined)s.gachaHistory=[];
      if(!Array.isArray(s.gachaHistory)||s.gachaHistory.length>50||s.gachaHistory.length>s.stats.gachaDraws||s.gachaHistory.some(v=>!isObj(v)||!g.baseOfficer(v.officerId)||!s.officers.includes(v.officerId)||!RANKS.includes(v.rank)||typeof v.isNew!=='boolean'||v.duplicateRefund!==(v.isNew?0:GACHA.duplicateRefund)||!num(v.turn,0,s.turn)))invalid();
      s.gachaHistory=s.gachaHistory.map(v=>({officerId:v.officerId,rank:v.rank,isNew:v.isNew,isNewOfficer:v.isNewOfficer===undefined?v.isNew:v.isNewOfficer,upgraded:v.upgraded===undefined?false:v.upgraded,duplicateRefund:v.duplicateRefund,turn:v.turn}));
      if(s.gachaHistory.some(v=>typeof v.isNewOfficer!=='boolean'||typeof v.upgraded!=='boolean'||v.isNewOfficer&&!v.isNew||v.upgraded&&(!v.isNew||v.isNewOfficer)))invalid();
      if(s.officerVariants===undefined){const variants=new Set(s.officers.map(id=>`${id}:${g.baseOfficer(id).rank||g.baseOfficer(id).rarity}`));for(const v of s.gachaHistory)variants.add(`${v.officerId}:${v.rank}`);s.officerVariants=[...variants];}
      const validVariants=new Map(g.roster.flatMap(o=>RANKS.map(rank=>[`${o.id}:${rank}`,o.id])));
      if(!Array.isArray(s.officerVariants)||s.officerVariants.length>g.roster.length*RANKS.length||new Set(s.officerVariants).size!==s.officerVariants.length||s.officerVariants.some(key=>typeof key!=='string'||!validVariants.has(key)||!s.officers.includes(validVariants.get(key)))||s.officers.some(id=>!RANKS.some(rank=>s.officerVariants.includes(`${id}:${rank}`)))||s.gachaHistory.some(v=>!s.officerVariants.includes(`${v.officerId}:${v.rank}`)))invalid();
      if(!num(s.stats.researches??0,0,10000000))invalid();s.stats.researches=s.stats.researches??Object.values(s.tech).reduce((a,b)=>a+b,0);
      if(!Array.isArray(s.log)||s.log.length>200||s.log.some(l=>!isObj(l)||!num(l.turn,0,MAX_TURN)||typeof l.text!=='string'||l.text.length>2000||typeof l.kind!=='string'||l.kind.length>30))invalid();
      // Only retain known, validated fields; do not merge arbitrary imported object keys.
      const n=g.state;for(const k of ['clan','home','turn','difficulty','upkeep','repair','resources','troops','troopTransferSequence','morale','prestige','command','buildings','jobs','branches','officers','officerVariants','officerHealth','army','governors','tech','castles','treaties','scouted','log','claimedQuests','giftReceipts','walking','roaming','covert','progress','magatama','captureRewards','gachaHistory','seed','stats','realtime','march','marchHistory'])n[k]=copy(s[k]);
      n.jobs=n.jobs.map(j=>({...Object.fromEntries(['kind','id','remaining','total','remainingSeconds','totalSeconds','targetLevel'].map(k=>[k,j[k]])),...(j.kind==='branch'&&j.repair===true?{repair:true}:{}),...(j.kind==='branch'&&j.facilityId!==undefined?{facilityId:j.facilityId}:{}),...(j.kind==='branch'&&j.completesElapsedMs!==undefined?{completesElapsedMs:j.completesElapsedMs}:{})}));
      if(serviceSave){n.staffService={baseId:STAFF_BASE_ID};if(CLANS.some(c=>c.name===s.staffService.personalClan)){
        const clan=s.staffService.personalClan,valid=id=>CASTLE_BY_ID[id]&&!['edo',STAFF_BASE_ID].includes(id),home=valid(s.staffService.personalHome)?s.staffService.personalHome:CLANS.find(c=>c.name===clan).home,cycleHome=valid(s.staffService.personalCycleHome)?s.staffService.personalCycleHome:home,rawHome=s.staffService.personalHomeCastle;
        if(rawHome!==undefined&&(!isObj(rawHome)||!validOwner.has(rawHome.owner)||!num(rawHome.troops,0,ASSET_CAP)||!num(rawHome.wall,1,32)||!num(rawHome.level,1,['nijo','osaka','nagoya','sunpu'].includes(home)?64:g.castleLevelLimit(home))))invalid();
        const homeCastle=rawHome?{owner:rawHome.owner,troops:rawHome.troops,wall:rawHome.wall,level:Math.min(rawHome.level,g.castleLevelLimit(home)),...(rawHome.durability!==undefined?{durability:normalizeDurability(rawHome.durability)}:{})}:null;
        STAFF_ORIGIN.set(g,{clan,home,cycleHome,...(homeCastle?{homeCastle}:{})});n.staffService={baseId:STAFF_BASE_ID,personalClan:clan,personalHome:home,personalCycleHome:cycleHome,...(homeCastle?{personalHomeCastle:copy(homeCastle)}:{})};
      }}
      if(s.worldClock)n.worldClock={id:s.worldClock.id,elapsedMs:s.worldClock.elapsedMs};
      if(s.cycle!==undefined){const c=s.cycle,r=c?.latestReward;if(!isObj(c)||!num(c.index,0,Math.floor(MAX_TURN/WORLD_CALENDAR.monthsPerCycle))||!CASTLE_BY_ID[c.home]||r!==null&&(!isObj(r)||!num(r.cycle,0,c.index-1)||!num(r.captured,0,CASTLES.length-1)||r.gold!==r.captured*1000||r.rice!==r.captured*1000||r.magatama!==r.captured*100))invalid();n.cycle={index:c.index,home:c.home,latestReward:r===null?null:copy(r)};}else n.cycle={index:Math.floor(s.turn/WORLD_CALENDAR.monthsPerCycle),home:s.home,latestReward:null};
      n.won=CASTLES.every(c=>n.castles[c.id].owner===n.clan);n.gameOver=!CASTLES.some(c=>n.castles[c.id].owner===n.clan);
      if(!n.gameOver&&n.castles[n.home].owner!==n.clan)invalid();if(n.gameOver)n.realtime.running=false;
      n.lastBattle=null;
      if(s.lastBattle?.durability!==undefined)try{s.lastBattle.durability=normalizeDurabilityBattle(s.lastBattle.durability);}catch{invalid();}
      if(s.lastBattle!==null&&s.lastBattle!==undefined){const b=s.lastBattle;if(!isObj(b)||typeof b.won!=='boolean'||!CASTLE_BY_ID[b.castleId]||!num(b.ourBefore)||!num(b.ourLost)||!num(b.enemyBefore)||!num(b.enemyLost)||!Array.isArray(b.phases)||b.phases.length>10||b.phases.some(p=>!isObj(p)||typeof p.title!=='string'||p.title.length>50||typeof p.text!=='string'||p.text.length>1000)||!isObj(b.rewards)||!num(b.rewards.gold)||!num(b.rewards.rice)||!num(b.rewards.magatama??0)||b.capturedOfficer!==null&&b.capturedOfficer!==undefined&&!g.officer(b.capturedOfficer))invalid();n.lastBattle={won:b.won,castleId:b.castleId,castleName:CASTLE_BY_ID[b.castleId].name,ourBefore:b.ourBefore,ourLost:b.ourLost,enemyBefore:b.enemyBefore,enemyLost:b.enemyLost,phases:copy(b.phases),rewards:{gold:b.rewards.gold,rice:b.rewards.rice,magatama:b.rewards.magatama??0},capturedOfficer:b.capturedOfficer||null,garrison:num(b.garrison)?b.garrison:0,tactic:TACTICS.some(t=>t.id===b.tactic)?b.tactic:'balanced',turn:num(b.turn,0,MAX_TURN)?b.turn:n.turn,...(b.durability?{durability:copy(b.durability)}:{})};if(b.branchId!==undefined){const site=BRANCH_BY_ID[b.branchId];if(!site||site.parentCastleId!==b.castleId||b.parentCastleId!==undefined&&b.parentCastleId!==site.parentCastleId||b.rewards.gold||b.rewards.rice||b.rewards.magatama||b.capturedOfficer||b.garrison)invalid();Object.assign(n.lastBattle,{branchId:site.id,parentCastleId:site.parentCastleId,castleName:site.name,captured:false});}}
      if(serviceSave&&!g.isStaff&&!g.isAdmin&&STAFF_ORIGIN.has(g))g._clearStaffProjection();
      g._enforceAdminRestrictions();if(g.isAdmin)g.restoreAdminAssets();g._enforceStaffHome();if(g.isAdmin)n.cycle.home='edo';else if(n.cycle.home==='edo')n.cycle.home=n.home;if(g.isStaff&&options.staffBase)g.applyStaffBase(options.staffBase);if(legacyRepair)g._migrateLegacyRepair();g._updateCampaignOutcome();if(options.branchAuthority!==undefined){const authority=g.setBranchAuthority(options.branchAuthority);if(!authority.ok)throw new Error(authority.message);}if(options.maintenanceAuthority!==undefined){const authority=g.setMaintenanceAuthority(options.maintenanceAuthority);if(!authority.ok)throw new Error(authority.message);}return g;
    }
  }
  // Player progression is an optional, versioned section. Older saves receive
  // empty records; this data never grants server roles or online reward rights.
  const PROGRESS_ROLES={siege:'攻城',defense:'防衛',interior:'内政'};
  const PROGRESS_TUTORIAL=[
    {id:'farm',title:'田畑を一段育てる',text:'城下町の田畑を開き、増築の完成を待ちましょう。',view:'town',selector:'[data-action="building"][data-id="farm"], [data-action="upgrade"][data-id="farm"], [data-building="farm"]'},
    {id:'governor',title:'奉行を任命する',text:'城下町の施設に奉行を任命しましょう。「お任せ配置」も使えます。',view:'town',selector:'[data-action="auto-governors"], [data-action="pick-governor"]'},
    {id:'army',title:'三名の軍団を整える',text:'総大将と副将二名を確認し、得意な戦法を考えましょう。',view:'army',selector:'[data-action="pick-army"]'},
    {id:'recruit',title:'兵と士気を準備する',text:'軍団編成で一度募兵しましょう。兵糧の維持費も確認できます。',view:'army',selector:'[data-action="recruit-troops"]'},
    {id:'battle',title:'野良兵戦へ初出陣',text:'地図から野良兵を選び、勝敗見込みと損失を確認して出陣します。',view:'roaming',selector:'[data-roaming-action="prepare"], [data-roaming-action="submit"], .roaming-map'},
    {id:'reward',title:'達成した任務を受け取る',text:'軍議の固定任務、または日次・週次任務で達成した報酬を受け取りましょう。',view:'council',selector:'[data-action="claim-quest"]'}
  ];
  function normalizePlayerProgress(raw,state){
    const bad=()=>{throw Error('成長記録の形式が正しくありません。');},obj=v=>v&&typeof v==='object'&&!Array.isArray(v),num=(v,max=1000000000)=>Number.isSafeInteger(v)&&v>=0&&v<=max;
    const empty={version:1,presets:[],tutorial:{status:'new',stage:0,baseline:null},officers:{},counters:{recruits:0,training:0},reports:[],cycles:[],best:{captured:0,wins:0},recentKeys:[]};
    if(raw===undefined)return empty;if(!obj(raw)||raw.version!==1)bad();
    const validIds=new Set(state.officers||[]),out=empty;
    if(!Array.isArray(raw.presets)||raw.presets.length>5)bad();
    out.presets=raw.presets.map(v=>{if(!obj(v)||!num(v.slot,4)||typeof v.name!=='string'||v.name.length<1||v.name.length>24||!Array.isArray(v.army)||!v.army.length||v.army.length>3||new Set(v.army).size!==v.army.length||v.army.some(id=>!validIds.has(id)))bad();return{slot:v.slot,name:v.name,army:[...v.army]};});
    if(new Set(out.presets.map(v=>v.slot)).size!==out.presets.length)bad();
    const t=raw.tutorial;if(!obj(t)||!['new','active','paused','complete'].includes(t.status)||!num(t.stage,6))bad();
    let baseline=null;if(t.baseline!==null){if(!obj(t.baseline)||!['farm','upgrades','recruits','roaming','claims','rewardClaims'].every(k=>num(t.baseline[k])))bad();baseline=Object.fromEntries(['farm','upgrades','recruits','roaming','claims','rewardClaims'].map(k=>[k,t.baseline[k]]));}
    out.tutorial={status:t.status,stage:t.stage,baseline};
    if(!obj(raw.officers)||Object.keys(raw.officers).length>validIds.size)bad();
    for(const [id,v] of Object.entries(raw.officers)){if(!validIds.has(id)||!obj(v)||!PROGRESS_ROLES[v.role]||!['sorties','wins','defenses','administration'].every(k=>num(v[k])))bad();out.officers[id]={role:v.role,...Object.fromEntries(['sorties','wins','defenses','administration'].map(k=>[k,v[k]]))};}
    if(!obj(raw.counters)||!['recruits','training'].every(k=>num(raw.counters[k])))bad();out.counters={recruits:raw.counters.recruits,training:raw.counters.training};
    if(!Array.isArray(raw.reports)||raw.reports.length>30)bad();out.reports=raw.reports.map(v=>{if(!obj(v)||typeof v.id!=='string'||v.id.length>150||typeof v.name!=='string'||v.name.length>100||typeof v.won!=='boolean'||!['attack','defense','chance','lost','turn'].every(k=>num(v[k],Number.MAX_SAFE_INTEGER))||v.chance>100||typeof v.summary!=='string'||v.summary.length>400||!Array.isArray(v.army)||v.army.length>3||v.army.some(id=>!validIds.has(id)))bad();return{id:v.id,name:v.name,won:v.won,attack:v.attack,defense:v.defense,chance:v.chance,lost:v.lost,turn:v.turn,summary:v.summary,army:[...v.army]};});
    if(!Array.isArray(raw.cycles)||raw.cycles.length>24)bad();out.cycles=raw.cycles.map(v=>{if(!obj(v)||!['cycle','captured','wins'].every(k=>num(v[k]))||typeof v.title!=='string'||v.title.length>60)bad();return{cycle:v.cycle,captured:v.captured,wins:v.wins,title:v.title};});
    if(!obj(raw.best)||!num(raw.best.captured)||!num(raw.best.wins))bad();out.best={captured:raw.best.captured,wins:raw.best.wins};
    if(!Array.isArray(raw.recentKeys)||raw.recentKeys.length>60||raw.recentKeys.some(k=>typeof k!=='string'||k.length>150))bad();out.recentKeys=[...new Set(raw.recentKeys)];return out;
  }
  SengokuEngine.normalizePlayerProgress=normalizePlayerProgress;
  SengokuEngine.officerHealthRules=OFFICER_HEALTH_RULES;
  SengokuEngine.economyRules=ECONOMY_RULES;
  SengokuEngine.maintenanceRulesVersion=1;
  SengokuEngine.normalizeUpkeepState=normalizeUpkeepState;
  SengokuEngine.normalizeRepairState=normalizeRepairState;
  SengokuEngine.normalizeOfficerHealth=normalizeOfficerHealth;
  SengokuEngine.projectOfficerHealth=projectOfficerHealth;
  SengokuEngine.officerCombatFactor=officerCombatFactor;
  SengokuEngine.recordOfficerBattleState=(state,options)=>SengokuEngine.prototype.recordOfficerBattle.call({state},options);
  SengokuEngine.progressRoles=PROGRESS_ROLES;
  SengokuEngine.tutorialSteps=PROGRESS_TUTORIAL;
  Object.assign(SengokuEngine.prototype,{
    saveArmyPreset(slot,name,ids=this.state.army){
      if(!Number.isInteger(slot)||slot<0||slot>4||typeof name!=='string'||!name.trim()||name.trim().length>24||!Array.isArray(ids)||!ids.length||ids.length>3||new Set(ids).size!==ids.length||ids.some(id=>!this.state.officers.includes(id)))return fail('名前は1〜24文字、軍団は所持武将1〜3名で保存してください。');
      const p=this.state.progress;p.presets=p.presets.filter(v=>v.slot!==slot);p.presets.push({slot,name:name.trim(),army:[...ids]});p.presets.sort((a,b)=>a.slot-b.slot);return{ok:true,message:'軍団の編成セットを保存しました。'};
    },
    deleteArmyPreset(slot){this.state.progress.presets=this.state.progress.presets.filter(v=>v.slot!==slot);return{ok:true,message:'編成セットを削除しました。'};},
    previewArmyPreset(slot){
      const p=this.state.progress.presets.find(v=>v.slot===slot);if(!p)return{ok:false,message:'編成セットがありません。'};
      const adjusted=this.armyStats(p.army),stats=Object.fromEntries(['lead','valor','intellect','politics'].map(k=>[k,adjusted[k]]));
      return{ok:true,...copy(p),stats,current:this.armyStats(),removedGovernors:Object.entries(this.state.governors).filter(([,id])=>p.army.includes(id)).map(([buildingId,officerId])=>({buildingId,officerId,building:BUILDINGS.find(b=>b.id===buildingId)?.name||buildingId,name:this.officer(officerId)?.name||officerId}))};
    },
    applyArmyPreset(slot,{confirmGovernors=false}={}){const p=this.previewArmyPreset(slot);if(!p.ok)return p;if(p.removedGovernors.length&&!confirmGovernors)return{ok:false,code:'GOVERNORS_CONFIRM_REQUIRED',message:'軍団へ移る奉行を確認してください。',removedGovernors:p.removedGovernors};return this.assignArmy(p.army);},
    tutorialStatus(rewardClaims=0){
      const t=this.state.progress.tutorial,s=this.state,b=t.baseline||{},step=PROGRESS_TUTORIAL[Math.min(t.stage,5)];
      const checks=[s.buildings.farm>(b.farm??s.buildings.farm)||s.stats.upgrades>(b.upgrades??s.stats.upgrades),Object.keys(s.governors).length>0,s.army.length===3,s.progress.counters.recruits>(b.recruits??s.progress.counters.recruits),s.roaming.sequence>(b.roaming??s.roaming.sequence),s.claimedQuests.length>(b.claims??s.claimedQuests.length)||rewardClaims>(b.rewardClaims??rewardClaims)];
      return{...copy(t),step:{...step},complete:t.stage>=6||checks[t.stage],total:6};
    },
    updateTutorial(action,rewardClaims=0){
      const t=this.state.progress.tutorial,s=this.state;if(action==='start'||action==='restart'){t.status='active';if(action==='restart'||!t.baseline){t.stage=0;t.baseline={farm:s.buildings.farm,upgrades:s.stats.upgrades,recruits:s.progress.counters.recruits,roaming:s.roaming.sequence,claims:s.claimedQuests.length,rewardClaims:Math.max(0,Math.floor(rewardClaims))};}}
      else if(action==='pause')t.status='paused';else if(action==='next'){if(!this.tutorialStatus(rewardClaims).complete)return fail('この段階の操作を終えてから進みましょう。');t.stage=Math.min(6,t.stage+1);t.status=t.stage===6?'complete':'active';}else return fail('初陣ガイドの操作を確認してください。');return{ok:true,message:t.status==='complete'?'初陣の章を達成しました。':t.status==='paused'?'初陣ガイドは成長の記録から再開できます。':'初陣ガイドを更新しました。'};
    },
    setOfficerRole(id,role){if(!this.state.officers.includes(id)||!PROGRESS_ROLES[role])return fail('所持武将と育成分野を選んでください。');const p=this.state.progress.officers;p[id]=p[id]||{role,sorties:0,wins:0,defenses:0,administration:0};p[id].role=role;return{ok:true,message:'武将の育成分野を変更しました。'};},
    officerMastery(id){
      const p=this.state.progress.officers[id]||{role:'siege',sorties:0,wins:0,defenses:0,administration:0},xp=p.role==='interior'?p.administration:p.role==='defense'?p.defenses:p.sorties+p.wins,level=Math.min(5,Math.floor(xp/10)),titles=['見習い','若武者','熟達','名手','達人','名将'];
      return{...copy(p),xp,level,title:PROGRESS_ROLES[p.role]+titles[level],next:level===5?null:(level+1)*10};
    },
    recordOfficerBattle({key,won,role='siege',army=this.state.army,elapsedMs=officerHealthElapsed(this.state)}={}){
      const p=this.state.progress;if(typeof key!=='string'||!key||key.length>150||p.recentKeys.includes(key))return false;
      const health=projectOfficerHealth(this.state,elapsedMs);if(!health)return false;
      p.recentKeys.unshift(key);p.recentKeys=p.recentKeys.slice(0,60);this.state.officerHealth=health;
      for(const id of [...new Set(army)].filter(id=>this.state.officers.includes(id))){health.values[id]=Math.max(0,Math.round(health.values[id]*HEALTH_UNITS)-(won?OFFICER_HEALTH_RULES.winCost:OFFICER_HEALTH_RULES.lossCost)*HEALTH_UNITS)/HEALTH_UNITS;const v=p.officers[id]||(p.officers[id]={role:'siege',sorties:0,wins:0,defenses:0,administration:0});v.sorties=Math.min(1000000000,v.sorties+1);if(won)v.wins=Math.min(1000000000,v.wins+1);if(role==='defense')v.defenses=Math.min(1000000000,v.defenses+(won?2:1));}
      return true;
    },
    battleAnalysis(castleId,tactic='balanced',troops=this.state.troops){
      const p=this.previewBattle(castleId,tactic,troops);if(!p.attackPower&&!p.defensePower)return{...p,factors:[],notes:[]};const s=this.state,a=this.armyStats(),t=TACTICS.find(t=>t.id===tactic),skills=s.army.map(id=>this.officer(id)?.skill),factors=[];
      const add=(label,multiplier)=>factors.push({label,multiplier});add('兵数',Math.max(0,Math.floor(troops)));add('統率・武勇',.55+a.lead*.005+a.valor*.0025);add('士気',.5+s.morale*.007);add('技術研究',1+s.tech.discipline*.06+s.tech.gunnery*.05);add('戦法',t.modifier);add('軍備施設・奉行',1+this._facilityEffect('military'));
      if(skills.includes('commander'))add('指揮の特技',1.04);if(skills.includes('cavalry')&&tactic==='assault')add('騎兵の特技',1.06);if(skills.includes('infantry')&&tactic==='balanced')add('足軽の特技',1.05);if(skills.includes('ranged'))add('遠射の特技',1.04);if(skills.includes('strategist')&&tactic==='ambush')add('軍師の特技',1.08);if(tactic==='ambush')add('伏兵の知略',.7+a.intellect*.005);if(s.clan==='武田家')add('武田家の強み',1.1);if(s.clan==='島津家'&&tactic==='ambush')add('島津家の強み',1.15);if(p.scouted)add('偵察',1.1);if(a.count===0)add('武将未任命',.75);
      const notes=[];if(s.morale<70)notes.push('士気が低下しています。訓練後の戦力と比べてください。');if(new Set(skills).size<skills.length)notes.push('同じ特技は重複して加算されません。別の特技の組み合わせも試せます。');if(!p.scouted)notes.push('偵察で攻撃力を10%高められます。');if(p.defensePower>p.attackPower)notes.push('現在の戦力は相手が上です。兵数・士気・城壁への対策を比較してください。');
      return{...p,factors,notes,army:[...s.army],probabilityNote:'攻城戦は予想勝率に基づく判定です。高い勝率でも勝利を保証しません。'};
    },
    simulateArmy({castleId,tactic='balanced',troops=this.state.troops,army=this.state.army}={}){
      if(!Array.isArray(army)||army.length>3||new Set(army).size!==army.length||army.some(id=>!this.state.officers.includes(id)))return fail('所持武将から重複なく最大3名を選んでください。');
      const g=SengokuEngine.fromSave({game:'sengoku-tento',version:2,state:copy(this.state)},this.roster,{isAdmin:this.isAdmin,isStaff:this.isStaff,staffBase:this.isStaff?this.getStaffBase?.():undefined,maintenanceAuthority:this.getMaintenanceAuthority()}),assigned=g.assignArmy(army);if(!assigned.ok)return assigned;return{...g.battleAnalysis(castleId,tactic,troops),simulation:true};
    }
  });
  // Record real successful operations only. Previews and repeat delivery of a
  // roaming receipt never train an officer or add another battle report.
  for(const method of ['attack','attackBranch','battleRoaming']){
    const original=SengokuEngine.prototype[method];SengokuEngine.prototype[method]=function(...args){
      const beforeArmy=[...(MARCH_CONTEXT.get(this)?.army||this.state.army)],preview=method==='attack'?this.battleAnalysis(...args):method==='attackBranch'?this.previewBranchBattle(...args):this.previewRoamingBattle(...args),result=original.apply(this,args);
      if(result.ok&&result.battle&&!result.idempotent){const b=result.battle,p=this.state.progress,key=method+':'+(b.requestId||`${this.state.walking.campaignId}:${this.state.turn}:${this.state.seed}:${p.reports.length}`),won=b.won;this.recordOfficerBattle({key,won,army:beforeArmy});
        const chance=Number.isFinite(preview.winChance)?preview.winChance:preview.predictedWin?100:0,attack=preview.attackPower||0,defense=preview.defensePower||preview.enemyPower||0,summary=method==='battleRoaming'?'野良兵戦は表示した戦力と相性で判定します。':won?'戦力と戦法が勝利につながりました。次も確率による変動があります。':chance>=50?'戦力上は有利でしたが、確率判定で敗北しました。兵損と備蓄を整えて再挑戦できます。':'戦力上で不利な戦いでした。士気・兵数・城壁対策を見直せます。';
        p.reports.unshift({id:key,name:b.castleName||b.encounterName||'合戦',won,attack,defense,chance,lost:b.ourLost||0,turn:this.state.turn,summary,army:beforeArmy});p.reports=p.reports.slice(0,30);p.best.captured=Math.max(p.best.captured,this.ownedCastles().length-1);p.best.wins=Math.max(p.best.wins,this.state.stats.wins+this.state.roaming.wins);
      }return result;
    };
  }
  for(const [method,counter] of [['recruitTroops','recruits'],['train','training']]){const original=SengokuEngine.prototype[method];SengokuEngine.prototype[method]=function(...args){const r=original.apply(this,args);if(r.ok)this.state.progress.counters[counter]=Math.min(1000000000,this.state.progress.counters[counter]+1);return r;};}
  const progressAdvance=SengokuEngine.prototype._advanceRealtime;
  SengokuEngine.prototype._advanceRealtime=function(...args){const r=progressAdvance.apply(this,args);if(r.completed?.length)for(const id of new Set(Object.values(this.state.governors))){const p=this.state.progress.officers,v=p[id]||(p[id]={role:'interior',sorties:0,wins:0,defenses:0,administration:0});v.administration=Math.min(1000000000,v.administration+r.completed.length);}return r;};
  const progressCycle=SengokuEngine.prototype._settleCycle;
  SengokuEngine.prototype._settleCycle=function(...args){const wins=this.state.stats.wins,r=progressCycle.apply(this,args);if(r){const p=this.state.progress;p.best.captured=Math.max(p.best.captured,r.captured);p.best.wins=Math.max(p.best.wins,wins);p.cycles.unshift({cycle:r.cycle,captured:r.captured,wins,title:r.captured>=100?'天下の覇者':r.captured>=30?'大領主':r.captured>=10?'一国の雄':r.captured?'領土開拓者':'城下の守り手'});p.cycles=p.cycles.slice(0,24);}return r;};

  root.SENGOKU_DATA=DATA;root.SengokuEngine=SengokuEngine;
  if(typeof module!=='undefined'&&module.exports)module.exports={SengokuEngine,SENGOKU_DATA:DATA};
})(typeof window!=='undefined'?window:globalThis);
