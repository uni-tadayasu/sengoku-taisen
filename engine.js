/* 戦国天統 — deterministic, browser-local strategy simulation.
 * Historical names are used in a fictional all-era campaign.
 * All strengths, economies, allegiances in a campaign and outcomes are game rules.
 */
(function (root) {
  'use strict';
  const RESOURCES = ['gold', 'rice', 'wood', 'stone'];
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
  const MAJOR_CITY_IDS=Object.freeze(['edo','sunpu','nijo','osaka','nagoya']);
  const CASTLES = ROWS.map(r=>({id:r[0],name:r[1],province:r[2],region:r[3],clan:r[4],x:r[5],y:r[6],wall:r[7],initialTroops:r[8],majorCity:MAJOR_CITY_IDS.includes(r[0]),neighbors:[]}));
  const CASTLE_BY_ID = Object.assign(Object.create(null),Object.fromEntries(CASTLES.map(c=>[c.id,c])));
  for (const [a,b] of EDGES) { if(!CASTLE_BY_ID[a].neighbors.includes(b))CASTLE_BY_ID[a].neighbors.push(b); if(!CASTLE_BY_ID[b].neighbors.includes(a))CASTLE_BY_ID[b].neighbors.push(a); }
  const TACTICS = [
    {id:'balanced',name:'正攻法',description:'安定した戦力で攻める標準の戦法。',modifier:1,food:1,loss:1},
    {id:'assault',name:'総攻撃',description:'攻撃力 +18%。兵の損耗と兵糧消費が増える。',modifier:1.18,food:1.25,loss:1.35},
    {id:'siege',name:'包囲戦',description:'城壁の効果を半減。兵糧を多く消費する。',modifier:.97,food:1.65,loss:.8},
    {id:'ambush',name:'伏兵',description:'軍団の平均知略が高いほど強力。偵察との併用が有効。',modifier:1,food:1.1,loss:.95}
  ];
  const QUESTS = [
    {id:'first_upgrade',name:'城下の礎',description:'施設の増築を1回完成させる。',target:1,reward:{gold:600,rice:500},prestige:10},
    {id:'first_recruit',name:'人こそ城',description:'武将を1名、新たに登用する。',target:1,reward:{gold:450,wood:300},prestige:10},
    {id:'first_battle',name:'初陣の勝鬨',description:'攻城戦に1回勝利する。',target:1,reward:{gold:1000,rice:1400},prestige:20},
    {id:'three_castles',name:'一国の主',description:'領有する城を3城に増やす。',target:3,reward:{gold:1800,wood:900,stone:700},prestige:30},
    {id:'five_officers',name:'英傑の集い',description:'家臣を8名以上に増やす。',target:8,reward:{gold:1200,rice:1000},prestige:20},
    {id:'technology',name:'新しき知恵',description:'研究を1回完成させる。',target:1,reward:{gold:700,wood:400,stone:400},prestige:15},
    {id:'ten_castles',name:'天下への道',description:'領有する城を10城に増やす。',target:10,reward:{gold:4000,rice:6000,wood:2000,stone:2000},prestige:60},
    {id:'unify',name:'天下統一',description:'全国128城を統一する。',target:128,reward:{gold:10000,rice:10000},prestige:300}
  ];
  const GACHA = {currency:'勾玉',initial:3000,singleCost:300,tenCost:2700,duplicateRefund:50,monthlyReward:30,firstCaptureReward:120,rates:[{rank:'D',rate:25},{rank:'C',rate:25},{rank:'B',rate:20},{rank:'A',rate:15},{rank:'S',rate:8},{rank:'SS',rate:4},{rank:'SSS',rate:2},{rank:'U',rate:1}]};
  [100,100,200,300,200,150,500,1000].forEach((amount,i)=>QUESTS[i].reward.magatama=amount);
  const RANK_BONUSES={D:0,C:2,B:4,A:6,S:8,SS:10,SSS:12,U:15};
  const ADMIN_ASSETS=Object.freeze({castleId:'edo',officerId:'of_b0616adde162',rank:'U',clanName:'德川家'});
  const ADMIN_CLAN=Object.freeze({...CLANS.find(c=>c.name==='徳川家'),name:ADMIN_ASSETS.clanName,leader:'德川家康',home:ADMIN_ASSETS.castleId,description:'江戸城を本拠とする、運営専用の家。'});
  const STAFF_CLAN=Object.freeze({...CLANS.find(c=>c.name==='徳川家'),name:ADMIN_ASSETS.clanName,leader:'徳川家康',home:'sunpu',description:'駿府城を共同本拠とする、スタッフの家。'});
  const GIFT_FIELDS=[...RESOURCES,'magatama'];
  // Role belongs to the authenticated runtime. It is never serialized in a save.
  const ADMIN_ACCESS=new WeakMap(),STAFF_ACCESS=new WeakMap(),STAFF_VIEW=new WeakMap(),STAFF_ORIGIN=new WeakMap();
  const WORLD_CALENDAR=Object.freeze({startYear:1560,yearsPerCycle:56,monthsPerCycle:672,secondsPerMonth:60});
  const MAX_TURN=999999999;
  const DATA = {version:2,gacha:GACHA,rankBonuses:RANK_BONUSES,adminAssets:ADMIN_ASSETS,adminClan:ADMIN_CLAN,staffClan:STAFF_CLAN,majorCityIds:MAJOR_CITY_IDS,worldCalendar:WORLD_CALENDAR,secondsPerMonth:60,secondsPerCommand:20,buildingLimit:32,ranks:RANKS,categories:CATEGORY_LABELS,clans:CLANS,buildings:BUILDINGS,techs:TECHS,castles:CASTLES,tactics:TACTICS,quests:QUESTS,resources:RESOURCES};
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const copy=o=>JSON.parse(JSON.stringify(o));
  const int=n=>Math.floor(Number(n)||0);
  const fail=message=>({ok:false,message});
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
      &&Array.isArray(policy.excludeCastleIds)&&policy.excludeCastleIds.length<=128&&policy.excludeCastleIds.every(id=>CASTLE_BY_ID[id])&&Array.isArray(policy.excludeRegions)&&policy.excludeRegions.length<=9&&policy.excludeRegions.every(id=>STRATEGY_REGIONS.includes(id))&&Array.isArray(policy.excludeClans)&&policy.excludeClans.length<=STRATEGY_CLANS.length&&policy.excludeClans.every(id=>STRATEGY_CLANS.includes(id))
      &&!!a&&walkingId(a.campaignId)&&n(a.cycle,0,Math.floor(MAX_TURN/672))&&n(a.startBattles,0,10000000)&&typeof a.clan==='string'&&!!CASTLE_BY_ID[a.home]&&['admin','staff','player'].includes(a.role)&&typeof a.worldId==='string'&&a.worldId.length<=100;
  }
  class SengokuEngine {
    constructor(options={}) {
      ADMIN_ACCESS.set(this,options.isAdmin===true);STAFF_ACCESS.set(this,options.isStaff===true);
      this.roster = options.officers || root.SENGOKU_OFFICERS || [];
      this.officerMap = Object.assign(Object.create(null),Object.fromEntries(this.roster.map(o=>[o.id,o])));
      if(!this.isAdmin&&!this.isStaff&&options.clan===ADMIN_ASSETS.clanName)throw new Error('德川家は運営・スタッフ専用です。通常の徳川家は選択できます。');
      const personal=CLANS.find(c=>c.name===options.clan)||(this.isStaff?CLANS.find(c=>c.name==='徳川家'):CLANS[0]);
      const clan = this.isAdmin?ADMIN_CLAN:this.isStaff?STAFF_CLAN:personal;
      if(this.isStaff)STAFF_ORIGIN.set(this,{clan:personal.name,home:personal.home,cycleHome:personal.home});
      if(!this.isAdmin&&!this.isStaff&&options.startCastle!==undefined&&(!CASTLES.some(c=>c.id===options.startCastle)||MAJOR_CITY_IDS.includes(options.startCastle)))throw new Error('開始する城を、大都市拠点（江戸・駿府・二条・大坂・名古屋）以外の123城から一つ選んでください。');
      const home=this.isAdmin?ADMIN_ASSETS.castleId:this.isStaff?'sunpu':options.startCastle??clan.home;
      const difficulty=['easy','normal','hard'].includes(options.difficulty)?options.difficulty:'normal';
      const rosterClan=this.isAdmin||this.isStaff?'徳川家':clan.name,rosterLeader=this.isAdmin||this.isStaff?'徳川家康':clan.leader;
      const initial = this.roster.filter(o=>o.clan===rosterClan).sort((a,b)=>(b.name===rosterLeader?10000:b.lead+b.valor+b.politics)-(a.name===rosterLeader?10000:a.lead+a.valor+a.politics)).slice(0,4).map(o=>o.id);
      if (!initial.length) initial.push(...this.roster.slice(0,4).map(o=>o.id));
      const scale={easy:.8,normal:1,hard:1.2}[difficulty];
      this.state={
        version:2,clan:clan.name,home,turn:0,difficulty,cycle:{index:0,home,latestReward:null},
        resources:{gold:difficulty==='easy'?4400:3200,rice:5400,wood:1800,stone:1200},
        troops:3400,morale:80,prestige:0,command:3,magatama:GACHA.initial,captureRewards:[home],gachaHistory:[],
        realtime:{running:true,speed:1,elapsed:0,commandProgress:0,incomeRemainders:{gold:0,rice:0,wood:0,stone:0}},
        buildings:{...Object.fromEntries(EXTRA_FACILITIES.map(b=>[b.id,0])),keep:2,farm:2,market:2,lumber:1,quarry:1,barracks:2,wall:1,academy:1},
        jobs:[],officers:initial,officerVariants:initial.map(id=>`${id}:${this._baseGrantRank(id)}`),army:initial.slice(0,3),governors:{},
        tech:Object.fromEntries(TECHS.map(t=>[t.id,0])),
        castles:Object.fromEntries(CASTLES.map(c=>[c.id,{owner:c.id===home?clan.name:c.clan===clan.name?'在地衆':c.clan,troops:c.id===home?1200:Math.round(c.initialTroops*scale),wall:c.id===home?1:c.wall,level:1}])),
        treaties:{},scouted:{},log:[],claimedQuests:[],giftReceipts:[],walking:walkingState(undefined,newWalkingCampaign()),seed:((options.seed??Date.now())>>>0)||123456789,
        lastBattle:null,stats:{battles:0,wins:0,upgrades:0,recruited:0,researches:0,gachaDraws:0,gachaDuplicates:0,castleUpgrades:0},won:false,gameOver:false
      };
      this.log(`${clan.name}、${CASTLE_BY_ID[home].name}より天下への歩みを始める。`,'story');
      this.log('共通の時刻は60秒で1か月進みます。1560〜1615年を周回し、占領拠点を精算して最初の本拠から再出発します。家臣・施設・資源は引き継ぎます。','guide');
      this.log(`門出の贈り物として勾玉${GACHA.initial.toLocaleString()}を受け取りました。武将招集に使えます。`,'gacha');
      if(this.isAdmin)this.restoreAdminAssets();
      if(options.staffBase&&this.isStaff)this.applyStaffBase(options.staffBase);
    }
    get data(){return DATA;}
    get isAdmin(){return ADMIN_ACCESS.get(this)===true;}
    get isStaff(){return !this.isAdmin&&STAFF_ACCESS.get(this)===true;}
    castleLevelLimit(id){return MAJOR_CITY_IDS.includes(id)?64:32;}
    canOwnCastle(id){return Boolean(CASTLE_BY_ID[id])&&(id!==ADMIN_ASSETS.castleId||this.isAdmin)&&(id!=='sunpu'||this.isStaff);}
    canOwnOfficerVariant(id,rank){return Boolean(this.baseOfficer(id))&&RANKS.includes(rank)&&(id!==ADMIN_ASSETS.officerId||rank!==ADMIN_ASSETS.rank||this.isAdmin);}
    _baseGrantRank(id){const o=this.baseOfficer(id),rank=o?.rank||o?.rarity;return id===ADMIN_ASSETS.officerId&&rank==='U'&&!this.isAdmin?'SSS':rank;}
    gachaPool(rank){return RANKS.includes(rank)?this.roster.filter(o=>this.canOwnOfficerVariant(o.id,rank)):[];}
    unificationTarget(){return CASTLES.filter(c=>this.canOwnCastle(c.id)).length;}
    _updateCampaignOutcome(){const s=this.state;s.won=CASTLES.filter(c=>this.canOwnCastle(c.id)).every(c=>s.castles[c.id].owner===s.clan);s.gameOver=!this.ownedCastles().length;if(s.gameOver)s.realtime.running=false;}
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
        const canonical=this.isStaff?'sunpu':CLANS.find(c=>c.name===s.clan)?.home||'okazaki';
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
        for(const key of ['troops','wall','level'])edo[key]=Math.max(edo[key],previous[key]);
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
    _clearStaffProjection(){const view=STAFF_VIEW.get(this),origin=STAFF_ORIGIN.get(this);if(view){this._rememberStaffPersonalProgress();this.state.buildings=copy(view.personalBuildings);this.state.castles.sunpu.level=view.personalSunpuLevel;this.state.castles.sunpu.wall=view.personalSunpuWall;}
      const personalClan=view?.personalClan||origin?.clan;if(CLANS.some(c=>c.name===personalClan))this._renameCampaignClan(personalClan);
      const home=view?.personalHome||origin?.home;if(CASTLE_BY_ID[home]&&!['edo','sunpu'].includes(home)){const s=this.state,previous=view?.personalHomeCastle||s.castles[home];for(const key of ['troops','wall','level'])s.castles[home][key]=Math.max(s.castles[home][key],previous[key]);s.castles[home].level=Math.min(this.castleLevelLimit(home),s.castles[home].level);s.castles[home].owner=s.clan;s.home=home;s.cycle.home=view?.personalCycleHome||origin.cycleHome;}
      STAFF_VIEW.delete(this);STAFF_ORIGIN.delete(this);
    }
    _enforceStaffHome(){
      const s=this.state;if(this.isStaff){if(s.clan!==STAFF_CLAN.name){const personal=CLANS.find(c=>c.name===s.clan);if(personal)STAFF_ORIGIN.set(this,{clan:personal.name,home:['edo','sunpu'].includes(s.home)?personal.home:s.home,cycleHome:['edo','sunpu'].includes(s.cycle.home)?personal.home:s.cycle.home});}const renamed=this._renameCampaignClan(STAFF_CLAN.name),changed=renamed||s.home!=='sunpu'||s.castles.sunpu.owner!==s.clan;s.home='sunpu';s.cycle.home='sunpu';s.castles.sunpu.owner=s.clan;s.gameOver=false;return changed;}
      const source=s.castles.sunpu,owned=source.owner===s.clan,wasHome=s.home==='sunpu';if(!owned&&!wasHome){if(s.cycle.home==='sunpu')s.cycle.home=s.home;return false;}
      const canonical=CLANS.find(c=>c.name===s.clan)?.home||'kiyosu',choices=CASTLES.filter(c=>!['edo','sunpu'].includes(c.id)&&s.castles[c.id].owner===s.clan),fallback=choices.find(c=>c.id===canonical)?.id||choices[0]?.id||canonical;
      if(wasHome){const destination=s.castles[fallback];for(const key of ['troops','wall','level'])destination[key]=Math.max(destination[key],source[key]);destination.level=Math.min(this.castleLevelLimit(fallback),destination.level);destination.owner=s.clan;s.home=fallback;}
      s.jobs=s.jobs.flatMap(job=>job.kind==='castle'&&job.id==='sunpu'?(wasHome&&s.castles[fallback].level<this.castleLevelLimit(fallback)?[{...job,id:fallback,targetLevel:s.castles[fallback].level+1}]:[]):[job]);
      if(wasHome){const seen=new Map(),other=[];for(const job of s.jobs){if(job.kind!=='castle'){other.push(job);continue;}if(job.id===fallback){if(s.castles[fallback].level>=this.castleLevelLimit(fallback))continue;job.targetLevel=s.castles[fallback].level+1;}if(!seen.has(job.id)||job.remainingSeconds<seen.get(job.id).remainingSeconds)seen.set(job.id,job);}s.jobs=[...other,...seen.values()];}
      const original=CASTLE_BY_ID.sunpu;s.castles.sunpu={owner:original.clan===s.clan?'在地衆':original.clan,troops:original.initialTroops,wall:original.wall,level:1};
      s.captureRewards=s.captureRewards.filter(id=>id!=='sunpu');if(wasHome&&!s.captureRewards.includes(fallback))s.captureRewards.push(fallback);if(s.cycle.home==='sunpu')s.cycle.home=fallback;return true;
    }
    setRoleAccess({isAdmin=false,isStaff=false}={},options={}){
      if(typeof isAdmin!=='boolean'||typeof isStaff!=='boolean')return fail('役職の認証状態が正しくありません。');
      const changed=this.isAdmin!==isAdmin||this.isStaff!==(!isAdmin&&isStaff);if(this.isStaff&&(!isStaff||isAdmin))this._clearStaffProjection();STAFF_ACCESS.set(this,isStaff);
      const result=this._setAdminAccess(isAdmin,options),migrated=this._enforceStaffHome();if(!this.isStaff){this.state.command=Math.min(this.state.command,this.commandMax());this.state.governors=Object.fromEntries(Object.entries(this.state.governors).filter(([id])=>this.state.buildings[id]>0));if(this.constructionChains()>this.constructionSlots())this.state.staffService={baseId:'sunpu'};}this._updateCampaignOutcome();return {...result,isStaff:this.isStaff,changed:changed||result.changed||migrated};
    }
    setAdminAccess(isAdmin,options={}){if(typeof isAdmin!=='boolean')return fail('運営の認証状態が正しくありません。');return this.setRoleAccess({isAdmin,isStaff:STAFF_ACCESS.get(this)===true},options);}
    applyStaffBase(base){
      if(!this.isStaff)return fail('スタッフの共同拠点へ接続してください。');
      const validBuildings=value=>value&&BUILDINGS.every(b=>Number.isInteger(value[b.id])&&value[b.id]>=(b.core?1:0)&&value[b.id]<=32);
      if(!base||base.id!=='sunpu'||!Number.isSafeInteger(base.revision)||base.revision<0||!validBuildings(base.buildings)||!validBuildings(base.initial?.buildings)||!Number.isInteger(base.castleLevel)||base.castleLevel<1||base.castleLevel>64||!Number.isInteger(base.initial.castleLevel)||base.initial.castleLevel<1||base.initial.castleLevel>64||!Array.isArray(base.history)||base.history.length>2200||!Array.isArray(base.jobs)||base.jobs.length>192)return fail('共同拠点の情報を確認できません。');
      const validCastle=(value,id)=>value&&typeof value==='object'&&!Array.isArray(value)&&[...CASTLES.map(c=>c.clan),...CLANS.map(c=>c.name),'在地衆',ADMIN_ASSETS.clanName].includes(value.owner)&&Number.isInteger(value.troops)&&value.troops>=0&&value.troops<=1000000&&Number.isInteger(value.wall)&&value.wall>=1&&value.wall<=32&&Number.isInteger(value.level)&&value.level>=1&&value.level<=this.castleLevelLimit(id);
      if(base.personalClan!==undefined&&!CLANS.some(c=>c.name===base.personalClan)||base.clanSinceElapsedMs!==undefined&&(!Number.isSafeInteger(base.clanSinceElapsedMs)||base.clanSinceElapsedMs<0)||base.accessSinceElapsedMs!==undefined&&(!Number.isSafeInteger(base.accessSinceElapsedMs)||base.accessSinceElapsedMs<0)||base.personalHome!==undefined&&(!CASTLE_BY_ID[base.personalHome]||['edo','sunpu'].includes(base.personalHome))||base.personalCycleHome!==undefined&&(!CASTLE_BY_ID[base.personalCycleHome]||['edo','sunpu'].includes(base.personalCycleHome))||base.personalSunpu!==undefined&&!validCastle(base.personalSunpu,'sunpu')||base.personalHomeCastle!==undefined&&!validCastle(base.personalHomeCastle,base.personalHome))return fail('共同拠点へ就任する前の領国を確認できません。');
      const events=[...base.history,...base.jobs.map(job=>({...job,level:job.targetLevel,effectiveElapsedMs:job.completesElapsedMs}))];
      if(events.some(e=>!['building','castle'].includes(e.kind)||!(e.kind==='castle'?e.id==='sunpu':BUILDINGS.some(b=>b.id===e.id))||!Number.isInteger(e.level)||e.level<1||e.level>(e.kind==='castle'?64:32)||!Number.isSafeInteger(e.effectiveElapsedMs)||e.effectiveElapsedMs<0))return fail('共同普請の履歴を確認できません。');
      const chains=new Map(),jobIds=new Set();
      for(const job of base.jobs){const key=job.kind+':'+job.id,previous=chains.get(key),level=previous?.targetLevel??(job.kind==='castle'?base.castleLevel:base.buildings[job.id]);if(typeof job.jobId!=='string'||!job.jobId||jobIds.has(job.jobId)||!Number.isInteger(job.totalSeconds)||job.totalSeconds<60||job.totalSeconds>180||!Number.isSafeInteger(job.startedElapsedMs)||job.startedElapsedMs<0||job.completesElapsedMs-job.startedElapsedMs!==job.totalSeconds*1000||job.targetLevel!==level+1||previous&&(job.kind!=='building'||job.startedElapsedMs<previous.completesElapsedMs))return fail('共同普請の予約順を確認できません。');jobIds.add(job.jobId);chains.set(key,job);}
      if(chains.size>2+Math.floor(base.buildings.keep/8))return fail('共同普請の工事枠を確認できません。');
      const personalKey=value=>JSON.stringify([value.accessSinceElapsedMs,value.clanSinceElapsedMs,value.personalClan,value.personalHome,value.personalCycleHome,value.personalSunpu,value.personalHomeCastle]);
      let view=STAFF_VIEW.get(this);if(view&&base.revision<view.base.revision)return {ok:true,changed:false};if(view&&base.revision===view.base.revision&&personalKey(base)===personalKey(view.base))return {ok:true,changed:false};
      if(!view){const personalHome=base.personalHome||this.state.home,personalSunpu=base.personalSunpu||this.state.castles.sunpu;view={personalClan:base.personalClan||STAFF_ORIGIN.get(this)?.clan||'徳川家',personalBuildings:copy(this.state.buildings),personalSunpuLevel:personalSunpu.level,personalSunpuWall:personalSunpu.wall,personalSunpu:copy(personalSunpu),staffSunpuTroops:this.state.castles.sunpu.troops,personalHome,personalCycleHome:base.personalCycleHome||this.state.cycle.home,personalHomeCastle:copy(base.personalHomeCastle||this.state.castles[personalHome]),phase:null};}
      if(base.personalHome&&base.personalHome!==view.personalHome){view.personalHome=base.personalHome;view.personalHomeCastle=copy(base.personalHomeCastle||this.state.castles[base.personalHome]);}
      if(base.personalCycleHome)view.personalCycleHome=base.personalCycleHome;if(base.personalClan)view.personalClan=base.personalClan;STAFF_ORIGIN.set(this,{clan:view.personalClan,home:view.personalHome,cycleHome:view.personalCycleHome});
      if(base.personalHomeCastle)for(const key of ['troops','wall','level'])view.personalHomeCastle[key]=Math.max(view.personalHomeCastle[key],base.personalHomeCastle[key]);
      view.base=copy(base);view.events=events.sort((a,b)=>a.effectiveElapsedMs-b.effectiveElapsedMs);STAFF_VIEW.set(this,view);this._projectStaffAt();return {ok:true,changed:true};
    }
    getStaffBase(){const view=this.isStaff?STAFF_VIEW.get(this):null;return view?copy(view.base):null;}
    // Keep this personal castle snapshot outside the shared projection. The
    // server persists it in the same transaction as a save or cycle settlement.
    _rememberStaffPersonalProgress(){const view=this.isStaff?STAFF_VIEW.get(this):null;if(!view||['edo','sunpu'].includes(view.personalHome))return;const current=this.state.castles[view.personalHome];if(current?.owner!==this.state.clan)return;for(const key of ['troops','wall','level'])view.personalHomeCastle[key]=Math.max(view.personalHomeCastle[key],current[key]);view.personalHomeCastle.level=Math.min(view.personalHomeCastle.level,this.castleLevelLimit(view.personalHome));view.personalHomeCastle.owner=this.state.clan;}
    getStaffPersonalProgress(){const view=this.isStaff?STAFF_VIEW.get(this):null;if(!view||['edo','sunpu'].includes(view.personalHome))return null;this._rememberStaffPersonalProgress();return {home:view.personalHome,castle:copy(view.personalHomeCastle)};}
    _projectStaffAt(elapsed=this.state.worldClock?.elapsedMs??this.state.turn*60000+this.state.realtime.elapsed*1000){
      const view=this.isStaff?STAFF_VIEW.get(this):null;if(!view)return;const s=this.state,base=view.base;
      if(elapsed<(base.accessSinceElapsedMs||0)){
        this._renameCampaignClan(view.personalClan);
        s.buildings=copy(view.personalBuildings);
        // Enter once: normal CPU home relocation and garrison growth must keep
        // progressing while an older save catches up to the appointment time.
        if(view.phase!=='personal'){if(view.phase==='shared')view.staffSunpuTroops=s.castles.sunpu.troops;s.home=view.personalHome;s.cycle.home=view.personalCycleHome;s.castles.sunpu=copy(view.personalSunpu);view.phase='personal';this._updateCampaignOutcome();}
        s.castles.sunpu.level=view.personalSunpuLevel;s.castles.sunpu.wall=view.personalSunpuWall;return;
      }
      if(view.phase==='personal'){view.personalSunpu=copy(s.castles.sunpu);view.personalSunpuLevel=s.castles.sunpu.level;view.personalSunpuWall=s.castles.sunpu.wall;s.castles.sunpu.troops=view.staffSunpuTroops;}
      s.buildings=copy(base.initial.buildings);let level=base.initial.castleLevel;
      for(const event of view.events){if(event.effectiveElapsedMs>elapsed)break;if(event.kind==='castle')level=event.level;else s.buildings[event.id]=event.level;}
      this._renameCampaignClan(elapsed<(base.clanSinceElapsedMs??base.accessSinceElapsedMs??0)?view.personalClan:STAFF_CLAN.name);s.home='sunpu';s.cycle.home='sunpu';s.castles.sunpu.owner=s.clan;s.castles.sunpu.level=level;s.castles.sunpu.wall=s.buildings.wall;
      if(view.phase!=='shared'){view.phase='shared';this._updateCampaignOutcome();}
    }
    constructionJobs(){
      const view=this.isStaff?STAFF_VIEW.get(this):null,elapsed=this.state.worldClock?.elapsedMs??this.state.turn*60000+this.state.realtime.elapsed*1000,waits=new Map(),positions=new Map();
      const personal=this.state.jobs.map(job=>{const key=job.kind+':'+job.id,startsInSeconds=job.kind==='building'?(waits.get(key)||0):0,queuePosition=(positions.get(key)||0)+1;positions.set(key,queuePosition);waits.set(key,startsInSeconds+job.remainingSeconds);return{...job,shared:false,queued:startsInSeconds>0,startsInSeconds,finishesInSeconds:startsInSeconds+job.remainingSeconds,queuePosition};});
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
    highestOwnedRank(id){return this.ownedRanks(id).at(-1)||null;}
    collection(){return{officers:this.state.officers.length,variants:this.state.officerVariants.filter(key=>{const [id,rank]=key.split(':');return this.canOwnOfficerVariant(id,rank);}).length,totalVariants:RANKS.reduce((sum,rank)=>sum+this.gachaPool(rank).length,0)};}
    officer(id,rank){
      const base=this.baseOfficer(id);if(!base)return null;
      const chosen=rank===undefined?this.highestOwnedRank(id)||this._baseGrantRank(id):rank;if(!RANKS.includes(chosen))return null;
      const rankBonus=RANK_BONUSES[chosen],baseStats=Object.fromEntries(['lead','valor','intellect','politics'].map(k=>[k,base[k]]));
      const exclusive=id===ADMIN_ASSETS.officerId&&chosen==='U';
      return{...base,name:exclusive?'德川家康':base.name,clan:exclusive?ADMIN_ASSETS.clanName:base.clan,baseRank:base.rank||base.rarity,rank:chosen,rarity:chosen,rankBonus,baseStats,...Object.fromEntries(Object.entries(baseStats).map(([k,v])=>[k,clamp(v+rankBonus,0,100)])),variantOwned:this.ownsVariant(id,chosen)};
    }
    _grantOfficerVariant(id,rank){
      if(!this.canOwnOfficerVariant(id,rank))return null;
      const previous=this.highestOwnedRank(id),isNewOfficer=!this.state.officers.includes(id),isNew=!this.ownsVariant(id,rank);
      if(isNewOfficer){this.state.officers.push(id);this.state.stats.recruited++;}
      if(isNew)this.state.officerVariants.push(`${id}:${rank}`);
      return{isNew,isNewOfficer,upgraded:isNew&&!isNewOfficer&&RANKS.indexOf(rank)>RANKS.indexOf(previous)};
    }
    castle(id){const c=CASTLE_BY_ID[id];return c?{...c,...this.state.castles[id]}:null;}
    ownedCastles(){return CASTLES.filter(c=>this.canOwnCastle(c.id)&&this.state.castles[c.id].owner===this.state.clan).map(c=>this.castle(c.id));}
    adjacentTargets(){const ids=new Set();for(const c of this.ownedCastles())for(const id of c.neighbors)if(this.canOwnCastle(id)&&this.state.castles[id].owner!==this.state.clan)ids.add(id);return [...ids].map(id=>this.castle(id));}
    commandMax(){return 3+Math.floor(this.state.buildings.keep/8);}
    constructionSlots(){return 2+Math.floor(this.state.buildings.keep/8);}
    constructionChains(){return new Set(this.state.jobs.filter(j=>j.kind!=='research').map(j=>j.kind+':'+j.id)).size;}
    buildingMax(){return 32;}
    troopCapacity(){const extra=EXTRA_FACILITIES.filter(b=>b.category==='military').reduce((a,b)=>a+this.state.buildings[b.id]*b.capacity*this._governorBonus(b.id),0);return Math.floor((1000+this.state.buildings.barracks*2000+this.state.buildings.keep*500+this.ownedCastles().length*500+extra)*this._governorBonus('barracks'));}
    log(text,kind='info'){this.state.log.unshift({turn:this.state.turn,text,kind});this.state.log=this.state.log.slice(0,160);}
    random(){let x=this.state.seed>>>0;x^=x<<13;x^=x>>>17;x^=x<<5;this.state.seed=x>>>0;return(this.state.seed>>>0)/4294967296;}
    _guard(){if(this.isStaff&&!STAFF_VIEW.get(this))return fail('駿府城の共同拠点を確認しています。');if(this.state.gameOver)return fail('本拠を失いました。新しい物語を始めてください。');if(this.state.command<1)return fail('指示を使い切りました。1倍速では20秒ごとに1回復します。');return null;}
    _canPay(cost){return RESOURCES.every(k=>this.state.resources[k]>=(cost[k]||0));}
    _pay(cost){for(const k of RESOURCES)this.state.resources[k]=Math.max(0,this.state.resources[k]-(cost[k]||0));}
    _gain(reward){for(const k of RESOURCES)this.state.resources[k]=Math.min(999999999,this.state.resources[k]+(reward[k]||0));if(reward.magatama)this.state.magatama=Math.min(999999999,this.state.magatama+reward.magatama);}
    static normalizeWalkingState(raw){return walkingState(raw);}
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
      const rewards=Object.fromEntries(GIFT_FIELDS.map(k=>[k,Math.min(999999999-(k==='magatama'?this.state.magatama:this.state.resources[k]),delta*2)]));
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
    _action(text,kind='info',extra={}){this.state.command--;this.log(text,kind);return{ok:true,message:text,...extra};}
    _governorBonus(id){const o=this.officer(this.state.governors[id]);if(!o)return 1;const category=BUILDINGS.find(b=>b.id===id)?.category;const specialty=(o.skill==='farmer'&&category==='rice')||(o.skill==='merchant'&&category==='gold')||(o.skill==='engineer'&&['wood','stone','defense','research'].includes(category));return 1+(o.politics||0)/400+(specialty?.1:o.skill==='administrator'?.05:0);}
    _facilityEffect(category){return EXTRA_FACILITIES.filter(b=>b.category===category).reduce((a,b)=>a+this.state.buildings[b.id]*b.effect*this._governorBonus(b.id),0);}
    buildingUnlock(id){const b=BUILDINGS.find(b=>b.id===id);if(!b)return{ok:false,requiredLevel:1,reason:'施設が見つかりません。'};const ok=this.state.buildings.keep>=b.requiredKeep;return{ok,requiredLevel:b.requiredKeep,reason:ok?'建設・増築できます。':`天守 Lv.${b.requiredKeep}が必要です。`};}
    governorDescription(id){const category=BUILDINGS.find(b=>b.id===id)?.category;const named={keep:'政治力に応じて武将の登用費用を軽減します。',barracks:'政治力に応じて兵数上限を増やし募兵費用を軽減します。',wall:'政治力に応じて本拠の防衛力を高めます。',academy:'政治力に応じて研究費用を軽減します。'};return named[id]||({gold:'政治力に応じてこの施設の金銭生産を増やします。',rice:'政治力に応じてこの施設の兵糧生産を増やします。',wood:'政治力に応じてこの施設の木材生産を増やします。',stone:'政治力に応じてこの施設の石材生産を増やします。',military:'政治力に応じてこの施設の攻撃力・兵数上限の効果を高めます。',defense:'政治力に応じてこの施設の防衛補正を高めます。',research:'政治力に応じてこの施設の研究費軽減を強化します。',diplomacy:'政治力に応じてこの施設の交渉・偵察・登用費軽減を強化します。'})[category]||'';}
    buildingSummary(id){const b=BUILDINGS.find(b=>b.id===id);if(!b)return'';const lv=this.state.buildings[id];if(!lv)return'未建設';const gov=this._governorBonus(id),inc=this.income(),v=lv*b.effect*gov;if(!b.core){if(RESOURCES.includes(b.category))return`${({gold:'金銭',rice:'兵糧',wood:'木材',stone:'石材'})[b.category]} +${Math.floor(v).toLocaleString()} /月（技術補正前）`;if(b.category==='military')return`攻撃 +${(v*100).toFixed(1)}%・兵数 +${Math.floor(lv*b.capacity*gov).toLocaleString()}`;if(b.category==='defense')return`領国防衛 +${(v*100).toFixed(1)}%`;if(b.category==='research')return`研究効率 +${(v*100).toFixed(1)}%`;return`交渉効率 +${(v*100).toFixed(1)}%`;}
      return({keep:`登用条件 Lv.${lv}・指示 ${this.commandMax()}回`,farm:`兵糧 +${Math.floor(lv*450*gov).toLocaleString()} /月`,market:`金銭 +${Math.floor(lv*180*gov).toLocaleString()} /月`,lumber:`木材 +${Math.floor(lv*170*gov).toLocaleString()} /月`,quarry:`石材 +${Math.floor(lv*130*gov).toLocaleString()} /月`,barracks:`兵数上限 ${this.troopCapacity().toLocaleString()}`,wall:`本拠防衛 +${(lv*.16*100).toFixed(0)}%`,academy:`研究上限 Lv.${Math.min(5,lv)}・費用効率 +${((lv-1)*2.5).toFixed(1)}%`})[id]||'';
    }
    diplomacyCost(){return{gold:Math.max(60,Math.round((this.state.clan==='毛利家'?420:600)/(1+this._facilityEffect('diplomacy'))))};}
    scoutCost(){return{gold:Math.max(20,Math.round(120/(1+this._facilityEffect('diplomacy'))))};}
    trainingCost(){return{gold:180,rice:250};}
    trainingGain(){return 14+(this.state.clan==='上杉家'?6:0)+Math.floor(this._facilityEffect('military')*4);}
    defensePower(id){const c=this.castle(id);if(!c)return 0;const s=this.state;if(c.owner!==s.clan)return Math.round(c.troops*(1+c.wall*.16)*(1+(c.level-1)*.04));const home=id===s.home,reinforce=Math.round(s.troops*(home?.45:.18)),wall=home?s.buildings.wall:c.wall;return Math.round((c.troops+reinforce)*(1+wall*.16)*(1+s.tech.discipline*.06)*(['徳川家',ADMIN_ASSETS.clanName].includes(s.clan)?1.15:1)*(home?this._governorBonus('wall'):1)*(1+this._facilityEffect('defense'))*(1+(c.level-1)*.04));}

    income(){
      const s=this.state,b=s.buildings,t=s.tech,owned=this.ownedCastles(),n=owned.length,expanded=owned.reduce((sum,c)=>sum+c.level-1,0);
      const gold=Math.floor((180+b.keep*50+b.market*180*this._governorBonus('market')+this._facilityEffect('gold')+n*100+expanded*15)*(1+t.commerce*.12)*(s.clan==='織田家'?1.15:1));
      const grossRice=Math.floor((b.farm*450*this._governorBonus('farm')+this._facilityEffect('rice')+n*170+expanded*20)*(1+t.cultivation*.12)*(s.clan==='北条家'?1.15:1));
      const upkeep=Math.ceil(s.troops*.12+n*60);
      return{gold,rice:grossRice-upkeep,wood:Math.floor((b.lumber*170*this._governorBonus('lumber')+this._facilityEffect('wood')+n*40+expanded*5)*(1+t.forestry*.15)),stone:Math.floor((b.quarry*130*this._governorBonus('quarry')+this._facilityEffect('stone')+n*30+expanded*5)*(1+t.masonry*.15)),upkeep,grossRice};
    }
    costs(id,fromLevel){const b=BUILDINGS.find(b=>b.id===id);if(fromLevel===undefined){const jobs=this.isStaff?STAFF_VIEW.get(this)?.base.jobs||[]:this.state.jobs;fromLevel=Math.max(this.state.buildings[id]??0,...jobs.filter(j=>j.kind==='building'&&j.id===id).map(j=>j.targetLevel));}if(!b||!Number.isInteger(fromLevel)||fromLevel<0||fromLevel>32)return null;const level=fromLevel,mult=1+level*.32+level*level*.025,turns=level>=16?3:level>=6||id==='keep'?2:1;return{gold:Math.round(b.base.gold*mult),wood:Math.round(b.base.wood*mult),stone:Math.round(b.base.stone*mult),rice:0,turns,seconds:turns*60};}
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
    castleUpgradeCost(id){const c=this.castle(id);if(!c)return null;const lv=c.level-1,mult=1+lv*.3+lv*lv*.015,turns=c.level>=16?3:c.level>=6?2:1;return{gold:Math.round(700*mult),rice:0,wood:Math.round(280*mult),stone:Math.round(400*mult),turns,seconds:turns*60};}
    upgradeCastle(id){
      if(this.isStaff&&id==='sunpu')return fail('駿府城の共同普請は通信で全スタッフへ反映します。');
      const guard=this._guard();if(guard)return guard;const c=this.castle(id),s=this.state;
      if(!this.canOwnCastle(id))return fail(id==='sunpu'?'駿府城はスタッフ専用の城です。':'江戸城は運営専用の城です。');
      if(!c||c.owner!==s.clan)return fail('領有している城だけを拡張できます。');
      if(c.level>=this.castleLevelLimit(id))return fail(`この城郭は最高のLv.${this.castleLevelLimit(id)}です。`);
      if(s.jobs.some(j=>j.kind==='castle'&&j.id===id))return fail('この城郭は拡張中です。');
      if(this.constructionChains()>=this.constructionSlots())return fail(`施設と城郭を合わせて同時に${this.constructionSlots()}件まで普請できます。`);
      const cost=this.castleUpgradeCost(id);if(!this._canPay(cost))return fail('城郭拡張に必要な資源が足りません。');
      this._pay(cost);s.jobs.push({kind:'castle',id,remaining:cost.turns,total:cost.turns,remainingSeconds:cost.seconds,totalSeconds:cost.seconds,targetLevel:c.level+1});
      return this._action(`${c.name}の城郭をLv.${c.level+1}へ拡張開始。あと${cost.seconds}秒（1倍速）で完成。`,'build');
    }
    recruitmentCost(id){const o=this.baseOfficer(id);if(!o)return 0;const base=RANK_COST[this._baseGrantRank(id)]||180;return Math.round(base*(o.clan===this.state.clan?0.75:1)/this._governorBonus('keep')/(1+this._facilityEffect('diplomacy')*.2));}
    canRecruitOfficer(id){
      const o=this.baseOfficer(id);if(!o)return{ok:false,reason:'武将が見つかりません。',cost:0,requiredLevel:1};
      const cost=this.recruitmentCost(id),requiredLevel=o.clan===this.state.clan?1:(RANK_KEEP[this._baseGrantRank(id)]||1);
      if(this.state.officers.includes(id))return{ok:false,reason:'すでに家臣です。',cost,requiredLevel};
      if(this.state.buildings.keep<requiredLevel)return{ok:false,reason:`登用には天守 Lv.${requiredLevel} が必要です。`,cost,requiredLevel};
      if(this.state.command<1)return{ok:false,reason:'指示の回復をお待ちください（1倍速で20秒に1回）。',cost,requiredLevel};
      if(this.state.resources.gold<cost)return{ok:false,reason:'登用に必要な金銭が足りません。',cost,requiredLevel};
      if(this.state.gameOver)return{ok:false,reason:'本拠を失っています。',cost,requiredLevel};
      return{ok:true,reason:'登用できます。',cost,requiredLevel};
    }
    recruitOfficer(id){const can=this.canRecruitOfficer(id);if(!can.ok)return fail(can.reason);this._pay({gold:can.cost});this._grantOfficerVariant(id,this._baseGrantRank(id));this.state.prestige+=3;return this._action(`${this.officer(id).name}が家臣に加わりました。`,'officer',{officer:this.officer(id)});}
    searchOfficers(){return this.roster.filter(o=>!this.state.officers.includes(o.id));}
    assignArmy(ids){
      if(!Array.isArray(ids)||ids.length>3||new Set(ids).size!==ids.length||ids.some(id=>!this.state.officers.includes(id)))return fail('家臣から最大3名を重複なく選んでください。');
      this.state.army=[...ids];for(const key of Object.keys(this.state.governors))if(ids.includes(this.state.governors[key]))delete this.state.governors[key];
      this.log('出陣軍団の編成を更新しました。','army');return{ok:true,message:'軍団編成を更新しました。'};
    }
    assignGovernor(buildingId,officerId){
      if(!BUILDINGS.some(b=>b.id===buildingId))return fail('施設が見つかりません。');
      if(officerId===null||officerId===''){delete this.state.governors[buildingId];return{ok:true,message:'奉行の任命を解除しました。'};}
      if(!this.state.officers.includes(officerId))return fail('家臣から奉行を選んでください。');
      if(this.state.buildings[buildingId]<1)return fail('先にこの施設を建設してください。');
      for(const id of Object.keys(this.state.governors))if(this.state.governors[id]===officerId)delete this.state.governors[id];
      this.state.army=this.state.army.filter(id=>id!==officerId);this.state.governors[buildingId]=officerId;
      return{ok:true,message:`${this.officer(officerId).name}を${BUILDINGS.find(b=>b.id===buildingId).name}の奉行に任命しました。`};
    }
    recruitTroopCost(amount){const n=int(amount),m=(1-this.state.tech.conscription*.08)*(this.state.clan==='伊達家'?.85:1)/this._governorBonus('barracks');return{gold:Math.ceil(n*.32*m),rice:Math.ceil(n*.45*m),wood:0,stone:0};}
    recruitTroops(amount){
      const g=this._guard();if(g)return g;const n=int(amount);if(!Number.isFinite(Number(amount))||n<100||n>20000)return fail('募兵数は100〜20,000人で指定してください。');
      if(this.state.troops+n>this.troopCapacity())return fail(`兵数上限は${this.troopCapacity().toLocaleString()}人です。兵舎を増築してください。`);
      const cost=this.recruitTroopCost(n);if(!this._canPay(cost))return fail('募兵に必要な金銭・兵糧が足りません。');
      this._pay(cost);this.state.troops+=n;this.state.morale=clamp(this.state.morale-Math.ceil(n/700),25,100);return this._action(`${n.toLocaleString()}人を募兵しました。`,'army');
    }
    train(){const g=this._guard();if(g)return g;if(this.state.morale>=100)return fail('士気は最高です。');const cost=this.trainingCost();if(!this._canPay(cost))return fail('訓練には金銭180・兵糧250が必要です。');this._pay(cost);const gain=this.trainingGain();this.state.morale=clamp(this.state.morale+gain,0,100);return this._action(`軍団を訓練。士気が${this.state.morale}になりました。`,'army');}
    researchCost(id){if(!TECHS.some(t=>t.id===id))return null;const lv=this.state.tech[id],divisor=this._governorBonus('academy')*(1+(this.state.buildings.academy-1)*.025+this._facilityEffect('research')),turns=lv>=2?2:1;return{gold:Math.round((650+lv*420)/divisor),wood:Math.round((180+lv*120)/divisor),stone:Math.round((120+lv*100)/divisor),rice:0,turns,seconds:turns*60};}
    research(id){const g=this._guard();if(g)return g;const t=TECHS.find(t=>t.id===id);if(!t)return fail('技術が見つかりません。');if(this.state.tech[id]>=t.max)return fail('この技術は研究を極めています。');if(this.state.tech[id]>=this.state.buildings.academy)return fail('先に学問所を増築してください。');if(this.state.jobs.some(j=>j.kind==='research'))return fail('研究は同時に1つまで進められます。');const cost=this.researchCost(id);if(!this._canPay(cost))return fail('研究に必要な資源が足りません。');this._pay(cost);this.state.jobs.push({kind:'research',id,remaining:cost.turns,total:cost.turns,remainingSeconds:cost.turns*60,totalSeconds:cost.turns*60,targetLevel:this.state.tech[id]+1});return this._action(`${t.name}の研究を開始。あと${cost.turns*60}秒（通常速度）で完成。`,'research');}
    diplomacy(castleId){const g=this._guard();if(g)return g;const c=this.castle(castleId);if(!c||c.owner===this.state.clan)return fail('外交先の他勢力を選んでください。');if((this.state.treaties[c.owner]||0)>this.state.turn)return fail('すでに同盟を結んでいます。');const active=Object.values(this.state.treaties).filter(t=>t>this.state.turn).length;if(active>=2)return fail('同時に結べる同盟は2勢力までです。');const cost=this.diplomacyCost(castleId);if(!this._canPay(cost))return fail(`同盟には金銭${cost.gold}が必要です。`);this._pay(cost);this.state.treaties[c.owner]=this.state.turn+6;return this._action(`${c.owner}と6か月の同盟を締結しました。`,'diplomacy');}
    scout(castleId){const g=this._guard();if(g)return g;const c=this.castle(castleId);if(!c||c.owner===this.state.clan)return fail('偵察する敵城を選んでください。');if(!this.adjacentTargets().some(t=>t.id===castleId))return fail('偵察できるのは自領に隣接する敵城です。');const cost=this.scoutCost(castleId);if(!this._canPay(cost))return fail(`偵察には金銭${cost.gold}が必要です。`);this._pay(cost);this.state.scouted[castleId]=this.state.turn+3;return this._action(`${c.name}を偵察。3か月間、この城への攻撃力が10%増加します。`,'scout');}
    armyStats(){const arr=this.state.army.map(id=>this.officer(id)).filter(Boolean);if(!arr.length)return{lead:35,valor:35,intellect:35,politics:35,count:0};return{lead:Math.round(arr.reduce((a,o)=>a+o.lead,0)/arr.length),valor:Math.round(arr.reduce((a,o)=>a+o.valor,0)/arr.length),intellect:Math.round(arr.reduce((a,o)=>a+o.intellect,0)/arr.length),politics:Math.round(arr.reduce((a,o)=>a+o.politics,0)/arr.length),count:arr.length};}
    previewBattle(castleId,tactic='balanced',troops=this.state.troops){
      const s=this.state,c=this.castle(castleId),t=TACTICS.find(t=>t.id===tactic),n=int(troops);
      if(!c)return{ok:false,message:'城が見つかりません。'};if(!t)return{ok:false,message:'戦法を選んでください。'};
      const a=this.armyStats(),foodCost=Math.ceil(n*.3*t.food)+150;
      const wallFactor=(1-s.tech.siege*.12)*(tactic==='siege'?.5:1);
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
      const defensePower=(c.troops*(1+c.wall*.11*wallFactor)+c.wall*130*wallFactor)*(s.difficulty==='hard'?1.1:s.difficulty==='easy'?.9:1)*(1+(c.level-1)*.04);
      const ratio=attackPower/Math.max(1,defensePower);
      const chance=ratio>=2.2?.99:ratio<=.45?.02:clamp(.5+Math.log(ratio)*.65,.05,.97);
      let reason='';if(s.gameOver)reason='本拠を失っています。';else if(!this.canOwnCastle(castleId))reason=castleId==='sunpu'?'駿府城はスタッフ専用のため出陣できません。':'江戸城は運営専用のため出陣できません。';else if(c.owner===s.clan)reason='この城はすでに自領です。';else if(!this.adjacentTargets().some(a=>a.id===castleId))reason='自領に隣接する城へ出陣できます。';else if((s.treaties[c.owner]||0)>s.turn)reason='同盟期間中の勢力には出陣できません。';else if(n<300||n>s.troops)reason='出陣兵数は300人以上、現在の兵数以下で指定してください。';else if(s.command<1)reason='指示の回復をお待ちください（1倍速で20秒に1回）。';else if(s.resources.rice<foodCost)reason='出陣に必要な兵糧が足りません。';
      return{ok:!reason,message:reason||'出陣できます。',castleId,castleName:c.name,tactic,troops:n,enemyTroops:c.troops,attackPower:Math.round(attackPower),defensePower:Math.round(defensePower),winChance:Math.round(chance*100),foodCost,scouted:(s.scouted[castleId]||0)>s.turn,ratio,tactics:TACTICS};
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
      if(targetCastleId&&['edo','sunpu'].includes(targetCastleId))return bad('江戸城・駿府城は保護された本拠のため、自動攻略の目標にはできません。');
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
      if(policy.hold||policy.maxBattles===0)return result('stop','STRATEGY_HOLD','攻撃せず待機する作戦です。');
      if(battles>=policy.maxBattles||s.stats.battles>=10000000)return result('stop','STRATEGY_LIMIT','設定した出陣回数に達しました。');
      if(s.gameOver)return result('stop','STRATEGY_DEFEATED','本拠を失ったため作戦を停止しました。');
      const goals=policy.targetCastleId?[CASTLE_BY_ID[policy.targetCastleId]]:policy.targetRegion?CASTLES.filter(c=>c.region===policy.targetRegion&&!['edo','sunpu'].includes(c.id)):null;
      if(goals?.every(c=>s.castles[c.id].owner===s.clan))return result('stop','STRATEGY_TARGET_REACHED','指定した目標を制圧しました。');
      if(this.isStaff&&!STAFF_VIEW.get(this))return result('wait','STAFF_BASE_PENDING','駿府城の共同拠点を確認しています。');
      if(!s.realtime.running)return result('wait','STRATEGY_PAUSED','共通時間の再開を待っています。');
      if(s.command<1)return result('wait','STRATEGY_COMMAND','出陣に必要な指示の回復を待っています。');
      const blocked=c=>['edo','sunpu'].includes(c.id)||!this.canOwnCastle(c.id)||policy.excludeCastleIds.includes(c.id)||policy.excludeRegions.includes(c.region)||policy.excludeClans.includes(s.castles[c.id].owner)||(s.treaties[s.castles[c.id].owner]||0)>s.turn;
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
          candidates.push({castleId:c.id,castleName:c.name,tactic:tactic.id,tacticName:tactic.name,troops,foodCost:p.foodCost,winChance:p.winChance,estimatedLoss,reserveAfter:{troops:s.troops-troops,rice:s.resources.rice-p.foodCost},score:Math.round(score*100)/100,defensePower:p.defensePower,castleDefense:this.previewBattle(c.id,'balanced',300).defensePower,distance:distances?.get(c.id)??0});
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
      const result=this.attack(current.castleId,current.tactic,current.troops);if(!result.ok)return{...result,changed:false,shouldStop:false};
      const after=this.planStrategy(policy),stopReason=!result.battle.won?'defeat':after.action==='stop'?after.code:null;
      return{...result,changed:true,decision:current,shouldStop:!!stopReason,stopReason,nextDecision:after};
    }
    attack(castleId,tactic='balanced',troops=this.state.troops){
      const p=this.previewBattle(castleId,tactic,troops);if(!p.ok)return fail(p.message);
      const s=this.state,c=this.castle(castleId),t=TACTICS.find(t=>t.id===tactic),random=this.random();
      const won=random<p.winChance/100;
      const lostRate=won?clamp(.08+.19/Math.max(.5,p.ratio),.08,.32):clamp(.27+.13/Math.max(.4,p.ratio),.27,.65);
      const medic=this.state.army.some(id=>this.officer(id)?.skill==='medic');
      const ourLost=Math.min(p.troops,Math.max(30,Math.round(p.troops*lostRate*t.loss*(.92+this.random()*.16)*(medic?.9:1))));
      const enemyLost=won?c.troops:Math.max(0,Math.min(c.troops-100,Math.round(c.troops*clamp(p.ratio*.32,.08,.65))));
      this._pay({rice:p.foodCost});s.troops-=ourLost;s.stats.battles++;s.morale=clamp(s.morale+(won?5:-12),15,100);
      const rewards=won?{gold:450+c.wall*180,rice:500+c.wall*200,magatama:s.captureRewards.includes(castleId)?0:GACHA.firstCaptureReward}:{gold:0,rice:0,magatama:0};
      const phases=[
        {title:'出陣',text:`${p.troops.toLocaleString()}の兵が${c.name}へ進軍。${t.name}を採用。`},
        {title:'開戦',text:`守備兵${c.troops.toLocaleString()}、城壁 Lv.${c.wall}。${p.scouted?'偵察で得た情報をもとに攻め手を定めた。':'敵の防備を見極めながら攻撃を開始した。'}`},
        {title:won?'突破':'激戦',text:won?'敵の守りを崩し、城門へと迫った。':'城兵の抵抗は強く、攻め手は消耗した。'},
        {title:won?'落城':'撤退',text:won?`${c.name}を制圧。領国に新たな旗が上がった。`:'被害の拡大を防ぐため軍を撤収。兵と兵糧を整え、再起を図る。'}
      ];
      let capturedOfficer=null,garrison=0;
      if(won){
        s.stats.wins++;s.prestige+=20+c.wall*5;this._gain(rewards);
        if(!s.captureRewards.includes(castleId)){s.captureRewards.push(castleId);phases.push({title:'初攻略の褒賞',text:`この城の初めての攻略により、勾玉${GACHA.firstCaptureReward}を得た。同じ城の再攻略では受け取れません。`});}
        garrison=Math.min(300,Math.floor((p.troops-ourLost)*.18));garrison=Math.min(garrison,s.troops);s.troops-=garrison;
        s.castles[castleId]={owner:s.clan,troops:garrison,wall:Math.max(1,c.wall-1),level:c.level};
        const candidates=this.roster.filter(o=>o.clan===c.owner&&!s.officers.includes(o.id));
        if(candidates.length){const chosen=candidates[Math.floor(this.random()*candidates.length)];this._grantOfficerVariant(chosen.id,this._baseGrantRank(chosen.id));capturedOfficer=chosen.id;phases.push({title:'帰順',text:`${chosen.name}が新たに家臣へ加わった。`});}
      }else s.castles[castleId].troops=Math.max(100,c.troops-enemyLost);
      const report={won,castleId,castleName:c.name,ourBefore:p.troops,ourLost,enemyBefore:c.troops,enemyLost,phases,rewards,capturedOfficer,garrison,tactic,turn:s.turn};
      s.lastBattle=report;this._updateCampaignOutcome();
      const text=won?`${c.name}を攻略！ ${garrison}人を守備兵として配置。${capturedOfficer?`${this.officer(capturedOfficer).name}が帰順。`:''}`:`${c.name}の攻城戦から撤退。兵${ourLost.toLocaleString()}人を失いました。`;
      const result=this._action(text,won?'victory':'defeat',{battle:report});
      if(s.won)this.log(`攻略対象の${this.unificationTarget()}城を統一。戦乱の世に、新しい天下が訪れました。`,'victory');
      return result;
    }
    _cpuTurn(){
      const s=this.state;if(s.turn<5||s.turn%3!==0)return[];const events=[];
      const choices=[];
      for(const c of CASTLES){const a=s.castles[c.id];if(a.owner===s.clan)continue;for(const tid of c.neighbors){const b=s.castles[tid];if(tid===ADMIN_ASSETS.castleId||tid==='sunpu')continue;if(a.owner===b.owner)continue;if((s.treaties[a.owner]||0)>s.turn&&b.owner===s.clan)continue;choices.push({from:c.id,to:tid});}}
      if(!choices.length)return events;
      const playerThreats=choices.filter(e=>s.castles[e.to].owner===s.clan),others=choices.filter(e=>s.castles[e.to].owner!==s.clan);
      const canRaid=playerThreats.length&&s.turn>=8&&this.random()<(s.difficulty==='hard'?.45:s.difficulty==='easy'?.16:.28);
      const pool=canRaid?playerThreats:(others.length?others:choices);
      const move=pool[Math.floor(this.random()*pool.length)],a=s.castles[move.from],b=s.castles[move.to],ac=CASTLE_BY_ID[move.from],bc=CASTLE_BY_ID[move.to];
      if(b.owner===s.clan){
        if((s.treaties[a.owner]||0)>s.turn)return events;
        const home=move.to===s.home,reinforce=home?Math.round(s.troops*.45):Math.round(s.troops*.18),wall=home?s.buildings.wall:b.wall;
        const attack=a.troops*(s.difficulty==='hard'?.85:s.difficulty==='easy'?.55:.7),defense=this.defensePower(move.to);
        const held=defense>=attack*(.84+this.random()*.32);
        const fieldLoss=Math.min(s.troops,Math.round(reinforce*(held?.12:.3)));s.troops-=fieldLoss;
        if(held){b.troops=Math.max(100,b.troops-Math.round(b.troops*.18));a.troops=Math.max(300,a.troops-Math.round(attack*.3));s.prestige+=5;events.push(`${a.owner}が${bc.name}へ侵攻。守備隊が撃退しました（援軍損失${fieldLoss}人）。`);}
        else{b.owner=a.owner;if(s.jobs.some(j=>j.kind==='castle'&&j.id===move.to)){s.jobs=s.jobs.filter(j=>j.kind!=='castle'||j.id!==move.to);events.push(`${bc.name}の落城により、進行中の城郭拡張は中止されました。`);}b.troops=Math.max(250,Math.round(a.troops*.3));a.troops=Math.max(350,a.troops-Math.round(b.troops*.6));s.morale=clamp(s.morale-10,15,100);events.push(`${a.owner}の侵攻により${bc.name}を失いました。`);if(!this.ownedCastles().length){s.gameOver=true;events.push('最後の城が陥落しました。設定から新しい物語を始められます。');}else if(home){s.home=this.ownedCastles()[0].id;events.push(`${CASTLE_BY_ID[s.home].name}へ本拠を移しました。`);}}
      }else{
        const ratio=a.troops/(b.troops*(1+b.wall*.08)*(1+(b.level-1)*.04));
        if(this.random()<clamp(.32+(ratio-1)*.3,.1,.8)){const old=b.owner;b.owner=a.owner;b.troops=Math.max(450,Math.round(a.troops*.42));a.troops=Math.max(500,a.troops-Math.round(b.troops*.4));events.push(`${a.owner}が${old}の${bc.name}を攻略しました。`);}
        else{a.troops=Math.max(400,a.troops-Math.round(a.troops*.14));b.troops=Math.max(300,b.troops-Math.round(b.troops*.08));events.push(`${ac.name}の${a.owner}が${bc.name}へ進軍。両軍は戦いの後、兵を引きました。`);}
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
    applyWorldClock(clock,{maxSeconds=7200,deferCycleSettlement=false}={}){
      if(!clock||typeof clock.id!=='string'||!clock.id||clock.id.length>100||!Number.isSafeInteger(clock.elapsedMs)||clock.elapsedMs<0||Math.floor(clock.elapsedMs/60000)>MAX_TURN||typeof clock.running!=='boolean'||![1,2,4].includes(clock.speed))return{...fail('共通時刻を確認できません。'),changed:false,events:[],completed:[]};
      const s=this.state,rt=s.realtime,anchor=s.worldClock;
      rt.running=clock.running&&!s.gameOver;rt.speed=clock.speed;
      if(!anchor||anchor.id!==clock.id){
        const turn=Math.floor(clock.elapsedMs/60000),offset=turn-s.turn,shift=v=>Math.max(0,Math.min(MAX_TURN,Math.floor(v)+offset));
        s.treaties=Object.fromEntries(Object.entries(s.treaties).filter(([,until])=>until>s.turn).map(([clan,until])=>[clan,Math.min(MAX_TURN+6,turn+(until-s.turn))]));
        s.scouted=Object.fromEntries(Object.entries(s.scouted).filter(([,until])=>until>s.turn).map(([id,until])=>[id,Math.min(MAX_TURN+6,turn+(until-s.turn))]));
        for(const record of s.log)record.turn=shift(record.turn);
        for(const record of s.gachaHistory)record.turn=shift(record.turn);
        if(s.lastBattle)s.lastBattle.turn=shift(s.lastBattle.turn??s.turn);
        s.turn=turn;rt.elapsed=(clock.elapsedMs%60000)/1000;s.worldClock={id:clock.id,elapsedMs:clock.elapsedMs};s.cycle.index=Math.floor(turn/WORLD_CALENDAR.monthsPerCycle);
        this._projectStaffAt(clock.elapsedMs);rt.running=clock.running&&!s.gameOver;return{ok:true,changed:true,migrated:true,monthChanged:true,pending:false,events:[],completed:[]};
      }
      // Absolute time is monotonic even when the visible calendar wraps to 1560.
      // A delayed packet cannot rewind resources, jobs or treaty expiry.
      if(clock.elapsedMs<=anchor.elapsedMs)return{ok:true,changed:false,pending:false,events:[],completed:[]};
      const limit=Math.max(60,Math.min(86400,Number(maxSeconds)||7200))*1000;
      const cycleMs=WORLD_CALENDAR.monthsPerCycle*60000,nextBoundary=(s.cycle.index+1)*cycleMs;
      const settlementRequired=deferCycleSettlement&&clock.elapsedMs>=nextBoundary;
      const target=Math.min(clock.elapsedMs,anchor.elapsedMs+limit,settlementRequired?Math.max(anchor.elapsedMs,nextBoundary-1):Infinity);
      const events=[],completed=[],cycleRewards=[];let changed=false,monthChanged=false;
      while(anchor.elapsedMs<target){
        this._projectStaffAt(anchor.elapsedMs);
        // A defeated private campaign stops earning until its appointment. Split
        // here so becoming staff can resume the remaining shared-clock interval.
        const priorCycle=s.cycle.index,boundary=(s.cycle.index+1)*cycleMs,accessSince=this.isStaff?STAFF_VIEW.get(this)?.base.accessSinceElapsedMs:0,clanSince=this.isStaff?STAFF_VIEW.get(this)?.base.clanSinceElapsedMs:0,end=Math.min(target,Math.max(anchor.elapsedMs+1,boundary),accessSince>anchor.elapsedMs?accessSince:Infinity,clanSince>anchor.elapsedMs?clanSince:Infinity);
        const result=s.gameOver?{events:[],completed:[],monthChanged:Math.floor(end/60000)!==s.turn}:this._advanceRealtime((end-anchor.elapsedMs)/1000);
        events.push(...result.events);completed.push(...result.completed);monthChanged=monthChanged||result.monthChanged;changed=true;
        s.turn=Math.floor(end/60000);rt.elapsed=(end%60000)/1000;anchor.elapsedMs=end;this._projectStaffAt(end);
        const reward=this._settleCycle(Math.floor(s.turn/WORLD_CALENDAR.monthsPerCycle))||(s.cycle.index>priorCycle?s.cycle.latestReward:null);if(reward){cycleRewards.push(reward);events.push(`占領${reward.captured}城の周回報酬を受け取りました。`);}
      }
      rt.running=clock.running&&!s.gameOver;rt.speed=clock.speed;this._projectStaffAt(target);
      return{ok:true,events,completed,cycleRewards,changed,monthChanged,settlementRequired:settlementRequired&&target>=nextBoundary-1,pending:target<clock.elapsedMs&&(!settlementRequired||target<nextBoundary-1),remainingSeconds:(clock.elapsedMs-target)/1000};
    }
    _settleCycle(index){
      const s=this.state;if(index<=s.cycle.index)return null;
      this._rememberStaffPersonalProgress();
      const view=this.isStaff?STAFF_VIEW.get(this):null,beforeAppointment=view&&s.turn*60000+s.realtime.elapsed*1000<(view.base.accessSinceElapsedMs||0);
      const home=this.isAdmin?ADMIN_ASSETS.castleId:beforeAppointment?view.personalCycleHome:this.isStaff?'sunpu':s.cycle.home;
      const captured=CASTLES.filter(c=>c.id!==home&&s.castles[c.id].owner===s.clan&&this.canOwnCastle(c.id)).length;
      const reward={cycle:s.cycle.index,captured,gold:captured*1000,rice:captured*1000,magatama:captured*100};
      const homeBefore={...s.castles[home]},scale={easy:.8,normal:1,hard:1.2}[s.difficulty];
      s.castles=Object.fromEntries(CASTLES.map(c=>[c.id,c.id===home?{...homeBefore,owner:s.clan,troops:Math.max(1200,homeBefore.troops),wall:Math.max(homeBefore.wall,s.buildings.wall)}:{owner:c.clan===s.clan?'在地衆':c.clan,troops:Math.round(c.initialTroops*scale),wall:c.wall,level:1}]));
      s.home=home;s.cycle={index,home,latestReward:reward};s.jobs=s.jobs.filter(job=>job.kind!=='castle'||job.id===home);
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
    _advanceRealtime(seconds){
      const s=this.state,rt=s.realtime,events=[],completed=[];let left=seconds,monthChanged=false;
      const precise=v=>Math.round(v*1e8)/1e8;
      while(left>1e-8&&!s.gameOver){
        // Rates only change at a monthly boundary or completion. Integrating each
        // interval makes long shared-clock catch-up exact without one loop per second.
        const elapsed=s.turn*60000+rt.elapsed*1000;this._projectStaffAt(elapsed);const view=this.isStaff?STAFF_VIEW.get(this):null,nextShared=view?Math.min(...view.events.filter(e=>e.effectiveElapsedMs>elapsed).map(e=>e.effectiveElapsedMs),view.base.accessSinceElapsedMs>elapsed?view.base.accessSinceElapsedMs:Infinity,view.base.clanSinceElapsedMs>elapsed?view.base.clanSinceElapsedMs:Infinity):Infinity;
        const activeJobs=new Set(),activeKeys=new Set();for(const job of s.jobs){const key=job.kind+':'+job.id;if(activeKeys.has(key))continue;activeKeys.add(key);activeJobs.add(job);}
        const step=Math.min(left,60-rt.elapsed,...[...activeJobs].map(j=>j.remainingSeconds),(nextShared-elapsed)/1000);
        if(!(step>0))break;
        const income=this.income();
        for(const key of RESOURCES){
          const accrued=rt.incomeRemainders[key]+income[key]*step/60;
          const units=Math.trunc(accrued+Math.sign(accrued)*1e-9);
          const before=s.resources[key],after=clamp(before+units,0,999999999);
          s.resources[key]=after;
          rt.incomeRemainders[key]=Math.abs(accrued-units)<1e-8?0:accrued-units;
          if((after===0&&accrued<0)||(after===999999999&&accrued>0))rt.incomeRemainders[key]=0;
        }
        const pending=[];
        for(const job of s.jobs){
          if(!activeJobs.has(job)){pending.push(job);continue;}
          job.remainingSeconds=precise(Math.max(0,job.remainingSeconds-step));
          job.remaining=Math.max(0,Math.ceil((job.remainingSeconds-1e-8)/60));
          if(job.remainingSeconds<=1e-8){
            const def=(job.kind==='building'?BUILDINGS:job.kind==='castle'?CASTLES:TECHS).find(v=>v.id===job.id);
            if(job.kind==='building'){
              const staffView=this.isStaff?STAFF_VIEW.get(this):null,personal=staffView?.personalBuildings;
              (personal||s.buildings)[job.id]=job.targetLevel;s.stats.upgrades++;
              if(job.id==='wall'){
                if(!staffView||staffView.phase==='personal')s.castles[s.home].wall=Math.max(s.castles[s.home].wall,job.targetLevel);
                else if(!['edo','sunpu'].includes(staffView.personalHome)){staffView.personalHomeCastle.wall=Math.max(staffView.personalHomeCastle.wall,job.targetLevel);const former=s.castles[staffView.personalHome];if(former.owner===s.clan)former.wall=Math.max(former.wall,job.targetLevel);}
                this._rememberStaffPersonalProgress();
              }
            }
            else if(job.kind==='castle'){s.castles[job.id].level=job.targetLevel;s.stats.castleUpgrades++;this._rememberStaffPersonalProgress();}
            else{s.tech[job.id]=job.targetLevel;s.stats.researches++;}
            const text=`${def.name} Lv.${job.targetLevel}の${job.kind==='research'?'研究':'普請'}が完成しました。`;
            events.push(text);this.log(text,'complete');completed.push({kind:job.kind,id:job.id,name:def.name,level:job.targetLevel});
          }else pending.push(job);
        }
        s.jobs=pending;
        if(s.command<this.commandMax()){
          rt.commandProgress=precise(rt.commandProgress+step);
          while(rt.commandProgress>=20-1e-8&&s.command<this.commandMax()){s.command++;rt.commandProgress=precise(Math.max(0,rt.commandProgress-20));}
          if(s.command>=this.commandMax())rt.commandProgress=0;
        }else rt.commandProgress=0;
        rt.elapsed=precise(rt.elapsed+step);left=precise(left-step);
        if(rt.elapsed>=60-1e-8){rt.elapsed=0;monthChanged=true;events.push(...this._advanceMonth());}
      }
      if(s.gameOver)rt.running=false;
      const calendar=this.calendar();
      return{ok:true,message:monthChanged?`${calendar.year}年${calendar.month}月になりました。`:completed.length?events[0]:'',events,completed,changed:seconds>0,monthChanged};
    }
    _advanceMonth(){
      const s=this.state,events=[];s.turn++;this._projectStaffAt(s.turn*60000);
      const cycleReset=this._settleCycle(Math.floor(s.turn/WORLD_CALENDAR.monthsPerCycle));
      this._gain({magatama:GACHA.monthlyReward});events.push(`月次褒賞として勾玉${GACHA.monthlyReward}を受け取りました。`);
      // Production, jobs and command recovery already progressed continuously in tick().
      if(this.income().rice<0&&s.resources.rice===0){const loss=Math.min(s.troops,Math.ceil(s.troops*.08));s.troops-=loss;s.morale=clamp(s.morale-12,15,100);events.push(`兵糧不足で${loss}人が離散。兵糧施設を増築してください。`);}
      else s.morale=clamp(s.morale+2,15,100);
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
    claimQuest(id){const q=QUESTS.find(q=>q.id===id);if(!q)return fail('目標が見つかりません。');const status=this.questStatus(id);if(status.claimed)return fail('この報酬は受け取り済みです。');if(!status.complete)return fail('まだ目標を達成していません。');this.state.claimedQuests.push(id);this._gain(q.reward);this.state.prestige+=q.prestige;this.log(`目標「${q.name}」達成。報酬を受け取りました。`,'quest');return{ok:true,message:`「${q.name}」の報酬を受け取りました。`,rewards:q.reward};}
    exportSave(){const state=copy(this.state),view=this.isStaff?STAFF_VIEW.get(this):null;if(view){state.buildings=copy(view.personalBuildings);state.castles.sunpu.level=view.personalSunpuLevel;state.castles.sunpu.wall=view.personalSunpuWall;}if(this.isStaff){const origin=STAFF_ORIGIN.get(this);state.staffService={baseId:'sunpu',...(origin?{personalClan:origin.clan,personalHome:origin.home,personalCycleHome:origin.cycleHome}:{})};}return JSON.stringify({game:'sengoku-tento',version:2,savedAt:new Date().toISOString(),state},null,2);}
    static fromSave(raw,officers,options={}){
      let obj;try{obj=typeof raw==='string'?JSON.parse(raw):copy(raw);}catch(e){throw new Error('セーブデータを読み取れません。JSONファイルを選んでください。');}
      const s=obj?.state||obj;
      const invalid=()=>{throw new Error('このセーブデータは形式または内容が正しくありません。');};
      const isObj=v=>v&&typeof v==='object'&&!Array.isArray(v);
      const num=(v,min=0,max=999999999)=>typeof v==='number'&&Number.isFinite(v)&&Number.isInteger(v)&&v>=min&&v<=max;
      if(!isObj(s)||s.version!==2||obj?.game&&obj.game!=='sengoku-tento')invalid();
      if(s.clan!==ADMIN_ASSETS.clanName&&!CLANS.some(c=>c.name===s.clan)||!CASTLE_BY_ID[s.home]||!['easy','normal','hard'].includes(s.difficulty))invalid();
      const g=new SengokuEngine({clan:s.clan===ADMIN_ASSETS.clanName?'徳川家':s.clan,difficulty:s.difficulty,officers,isAdmin:options?.isAdmin===true,isStaff:options?.isStaff===true});
      const serviceSave=s.staffService?.baseId==='sunpu';if(serviceSave&&!g.isStaff){s.command=Math.min(Number(s.command),3+Math.floor(s.buildings?.keep/8));if(isObj(s.governors))s.governors=Object.fromEntries(Object.entries(s.governors).filter(([id])=>!BUILDINGS.some(b=>b.id===id)||s.buildings?.[id]>0));}
      if(!num(s.turn,0,MAX_TURN)||!num(s.troops,0,1000000)||!num(s.morale,0,100)||!num(s.prestige)||!num(s.command,0,7)||!num(s.seed,0,4294967295))invalid();
      if(!isObj(s.resources)||!RESOURCES.every(k=>num(s.resources[k])))invalid();
      if(!isObj(s.buildings)||Object.keys(s.buildings).length!==BUILDINGS.length||!BUILDINGS.every(b=>num(s.buildings[b.id],b.core?1:0,32)))invalid();
      if(!g.isStaff&&s.command>3+Math.floor(s.buildings.keep/8))invalid();
      if(!isObj(s.tech)||!TECHS.every(t=>num(s.tech[t.id],0,t.max)))invalid();
      const validOwner=new Set([...CASTLES.map(c=>c.clan),'在地衆',ADMIN_ASSETS.clanName]);for(const c of CLANS)validOwner.add(c.name);
      if(!isObj(s.castles)||Object.keys(s.castles).length!==CASTLES.length||!CASTLES.every(c=>{const v=s.castles[c.id];if(isObj(v)&&v.level===undefined)v.level=1;return isObj(v)&&validOwner.has(v.owner)&&num(v.troops,0,1000000)&&num(v.wall,1,32)&&num(v.level,1,g.castleLevelLimit(c.id));}))invalid();
      if(!Array.isArray(s.officers)||s.officers.length>g.roster.length||new Set(s.officers).size!==s.officers.length||s.officers.some(id=>typeof id!=='string'||!g.officer(id)))invalid();
      if(!Array.isArray(s.army)||s.army.length>3||new Set(s.army).size!==s.army.length||s.army.some(id=>!s.officers.includes(id)))invalid();
      if(!isObj(s.governors)||Object.keys(s.governors).some(id=>!BUILDINGS.some(b=>b.id===id)||!g.isStaff&&s.buildings[id]<1)||Object.values(s.governors).some(id=>!s.officers.includes(id)||s.army.includes(id))||new Set(Object.values(s.governors)).size!==Object.values(s.governors).length)invalid();
      const scalar=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
      if(s.realtime===undefined)s.realtime={running:true,speed:1,elapsed:0,commandProgress:0,incomeRemainders:{gold:0,rice:0,wood:0,stone:0}};
      const rt=s.realtime;
      if(s.worldClock!==undefined&&(!isObj(s.worldClock)||typeof s.worldClock.id!=='string'||!s.worldClock.id||s.worldClock.id.length>100||!Number.isSafeInteger(s.worldClock.elapsedMs)||s.worldClock.elapsedMs<0||Math.floor(s.worldClock.elapsedMs/60000)!==s.turn||Math.abs((s.worldClock.elapsedMs%60000)/1000-rt.elapsed)>.00001))invalid();
      if(!isObj(rt)||typeof rt.running!=='boolean'||![1,2,4].includes(rt.speed)||!scalar(rt.elapsed,0,59.99999999)||!scalar(rt.commandProgress,0,19.99999999)||!isObj(rt.incomeRemainders)||Object.keys(rt.incomeRemainders).length!==4||!RESOURCES.every(k=>scalar(rt.incomeRemainders[k],-1,1)&&Math.abs(rt.incomeRemainders[k])<1))invalid();
      if(!Array.isArray(s.jobs)||s.jobs.length>193)invalid();
      for(const j of s.jobs){if(!isObj(j))invalid();if(j.remainingSeconds===undefined)j.remainingSeconds=j.remaining*60;if(j.totalSeconds===undefined)j.totalSeconds=j.total*60;if(!scalar(j.remainingSeconds,.00000001,180)||!num(j.totalSeconds,60,180)||j.totalSeconds!==j.total*60||j.remainingSeconds>j.totalSeconds||j.remaining!==Math.ceil((j.remainingSeconds-1e-8)/60))invalid();}

      const jobkeys=new Map();for(const j of s.jobs){if(!isObj(j)||!['building','castle','research'].includes(j.kind)||!num(j.remaining,1,3)||!num(j.total,1,3)||j.remaining>j.total)invalid();const defs=j.kind==='building'?BUILDINGS:j.kind==='castle'?CASTLES:TECHS,current=j.kind==='castle'?s.castles[j.id]?.level:(j.kind==='building'?s.buildings:s.tech)[j.id],key=j.kind+':'+j.id,count=jobkeys.get(key)||0;if(!defs.some(d=>d.id===j.id)||j.targetLevel!==current+count+1||j.targetLevel>(j.kind==='research'?5:j.kind==='castle'?g.castleLevelLimit(j.id):32)||j.kind==='castle'&&s.castles[j.id]?.owner!==s.clan||count&&(j.kind!=='building'||j.remainingSeconds!==j.totalSeconds))invalid();jobkeys.set(key,count+1);}
      if(s.jobs.filter(j=>j.kind==='research').length>1||[...jobkeys.keys()].filter(key=>!key.startsWith('research:')).length>(g.isStaff||serviceSave?6:2+Math.floor(s.buildings.keep/8)))invalid();
      if(!isObj(s.treaties)||Object.entries(s.treaties).some(([k,v])=>!validOwner.has(k)||k===s.clan||!num(v,0,MAX_TURN+6)))invalid();
      if(!isObj(s.scouted)||Object.entries(s.scouted).some(([k,v])=>!CASTLE_BY_ID[k]||!num(v,0,MAX_TURN+6)))invalid();
      if(!Array.isArray(s.claimedQuests)||new Set(s.claimedQuests).size!==s.claimedQuests.length||s.claimedQuests.some(id=>!QUESTS.some(q=>q.id===id)))invalid();
      if(s.giftReceipts===undefined)s.giftReceipts=[];
      if(!Array.isArray(s.giftReceipts)||s.giftReceipts.length>2000||new Set(s.giftReceipts).size!==s.giftReceipts.length||s.giftReceipts.some(id=>typeof id!=='string'||id.length<1||id.length>128))invalid();
      s.walking=walkingState(s.walking);
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
      const n=g.state;for(const k of ['clan','home','turn','difficulty','resources','troops','morale','prestige','command','buildings','jobs','officers','officerVariants','army','governors','tech','castles','treaties','scouted','log','claimedQuests','giftReceipts','walking','magatama','captureRewards','gachaHistory','seed','stats','realtime'])n[k]=copy(s[k]);
      n.jobs=n.jobs.map(j=>Object.fromEntries(['kind','id','remaining','total','remainingSeconds','totalSeconds','targetLevel'].map(k=>[k,j[k]])));
      if(serviceSave){n.staffService={baseId:'sunpu'};if(g.isStaff&&CLANS.some(c=>c.name===s.staffService.personalClan)){const clan=s.staffService.personalClan,valid=id=>CASTLE_BY_ID[id]&&!['edo','sunpu'].includes(id),home=valid(s.staffService.personalHome)?s.staffService.personalHome:CLANS.find(c=>c.name===clan).home;STAFF_ORIGIN.set(g,{clan,home,cycleHome:valid(s.staffService.personalCycleHome)?s.staffService.personalCycleHome:home});}}
      if(s.worldClock)n.worldClock={id:s.worldClock.id,elapsedMs:s.worldClock.elapsedMs};
      if(s.cycle!==undefined){const c=s.cycle,r=c?.latestReward;if(!isObj(c)||!num(c.index,0,Math.floor(MAX_TURN/WORLD_CALENDAR.monthsPerCycle))||!CASTLE_BY_ID[c.home]||r!==null&&(!isObj(r)||!num(r.cycle,0,c.index-1)||!num(r.captured,0,127)||r.gold!==r.captured*1000||r.rice!==r.captured*1000||r.magatama!==r.captured*100))invalid();n.cycle={index:c.index,home:c.home,latestReward:r===null?null:copy(r)};}else n.cycle={index:Math.floor(s.turn/WORLD_CALENDAR.monthsPerCycle),home:s.home,latestReward:null};
      n.won=CASTLES.every(c=>n.castles[c.id].owner===n.clan);n.gameOver=!CASTLES.some(c=>n.castles[c.id].owner===n.clan);
      if(!n.gameOver&&n.castles[n.home].owner!==n.clan)invalid();if(n.gameOver)n.realtime.running=false;
      n.lastBattle=null;
      if(s.lastBattle!==null&&s.lastBattle!==undefined){const b=s.lastBattle;if(!isObj(b)||typeof b.won!=='boolean'||!CASTLE_BY_ID[b.castleId]||!num(b.ourBefore)||!num(b.ourLost)||!num(b.enemyBefore)||!num(b.enemyLost)||!Array.isArray(b.phases)||b.phases.length>10||b.phases.some(p=>!isObj(p)||typeof p.title!=='string'||p.title.length>50||typeof p.text!=='string'||p.text.length>1000)||!isObj(b.rewards)||!num(b.rewards.gold)||!num(b.rewards.rice)||!num(b.rewards.magatama??0)||b.capturedOfficer!==null&&b.capturedOfficer!==undefined&&!g.officer(b.capturedOfficer))invalid();n.lastBattle={won:b.won,castleId:b.castleId,castleName:CASTLE_BY_ID[b.castleId].name,ourBefore:b.ourBefore,ourLost:b.ourLost,enemyBefore:b.enemyBefore,enemyLost:b.enemyLost,phases:copy(b.phases),rewards:{gold:b.rewards.gold,rice:b.rewards.rice,magatama:b.rewards.magatama??0},capturedOfficer:b.capturedOfficer||null,garrison:num(b.garrison)?b.garrison:0,tactic:TACTICS.some(t=>t.id===b.tactic)?b.tactic:'balanced',turn:num(b.turn,0,MAX_TURN)?b.turn:n.turn};}
      g._enforceAdminRestrictions();if(g.isAdmin)g.restoreAdminAssets();g._enforceStaffHome();if(g.isAdmin)n.cycle.home='edo';else if(n.cycle.home==='edo')n.cycle.home=n.home;if(g.isStaff&&options.staffBase)g.applyStaffBase(options.staffBase);g._updateCampaignOutcome();return g;
    }
  }
  root.SENGOKU_DATA=DATA;root.SengokuEngine=SengokuEngine;
  if(typeof module!=='undefined'&&module.exports)module.exports={SengokuEngine,SENGOKU_DATA:DATA};
})(typeof window!=='undefined'?window:globalThis);
