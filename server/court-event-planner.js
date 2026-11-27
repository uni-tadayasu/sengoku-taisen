// Pure event-room planning: the brief selects bounded catalogue scenarios,
// tactics and NPC difficulty. Existing event rules continue to own rewards.
import {generateEventPlan,normalizeEventPlan} from './event-planner.js';

const CATEGORIES={beginner:'入門',training:'鍛錬',field:'野戦',unification:'天下統一',siege:'攻城',night:'夜戦',river:'渡河',defense:'防衛',mountain:'山岳',forest:'林間',coast:'海浜',winter:'雪戦'};
const DIFFICULTIES={beginner:{label:'入門',powers:[64,86,110],words:['初心者','入門','初めて','はじめて','初陣','やさしい','易しい','難しくない','練習','beginner']},standard:{label:'標準',powers:[78,112,145],words:['標準','普通','中級','standard']},advanced:{label:'上級',powers:[96,137,171],words:['上級','熟練','高難度','高難易度','難しい','手強い','精鋭向け','advanced']}};
const TACTICS={
 balanced:{name:'正攻法',words:['正攻法','陣形','連携','統率','基礎'],hint:'統率・武勇・知略を生かし、陣形を保って前進しましょう。'},
 charge:{name:'突撃',words:['突撃','騎兵','騎馬','武勇','突破','突進'],hint:'武勇を生かし、敵陣の隙に部隊を集中させましょう。'},
 raid:{name:'奇襲',words:['奇襲','伏兵','夜襲','知略','隠密','忍び','偵察'],hint:'知略を生かし、見張りや隊列の隙を探りましょう。'},
 siege:{name:'包囲',words:['包囲','攻城','兵糧攻め','城攻め','政治'],hint:'知略と政治を生かし、備えを整えて敵の動きを狭めましょう。'},
 defend:{name:'堅守',words:['防衛','堅守','守り','守備','迎撃','持久','守る'],hint:'統率を生かして陣を保ち、敵の勢いを受け止めましょう。'}
};
// Each preset has its own catalogue identity, tactical progression and brief.
// Tuple: id, name, category, battle, days, difficulty, keywords, tactics, stages.
const PRESETS=[
 ['first-march','初陣の基礎演習','beginner','history:inogahara',2,'beginner',['初心者','入門','初陣','はじめて','基礎演習'],['balanced','defend','balanced'],['隊列を整える','正面の押し合い','初陣の総仕上げ']],
 ['formation-drill','陣形と連携の鍛錬','training','history:oninn',2,'beginner',['訓練','鍛錬','陣形','連携','号令'],['balanced','defend','charge'],['号令の確認','連携の切り替え','整列した総攻撃']],
 ['plain-breakthrough','平野の突破戦','field','history:mikatagahara',3,'standard',['平野','平原','野戦','騎馬','突破'],['balanced','charge','charge'],['先陣の展開','中央の突破','本陣への進撃']],
 ['decisive-battle','天下分け目の決戦','unification','history:sekigahara',3,'advanced',['天下統一','天下分け目','関ヶ原','決戦','幕府'],['balanced','charge','defend'],['左右翼の攻防','中央戦線の激突','天下分け目の本陣']],
 ['siege-ring','城砦包囲の攻防','siege','history:ishiyama',3,'standard',['包囲','攻城','城砦','城攻め','兵糧攻め'],['siege','raid','siege'],['外郭の観察','補給路の遮断','包囲陣の完成']],
 ['stronghold-council','堅城攻略の軍議','siege','history:odawara',5,'advanced',['堅城','小田原','総攻撃','大包囲','難攻不落'],['siege','balanced','siege'],['城外の布陣','支城の連絡路','堅城の最終攻防']],
 ['night-raid','夜陰の奇襲作戦','night','history:kawagoe',2,'standard',['夜戦','夜襲','夜','闇','月明かり','川越'],['raid','balanced','raid'],['見張りの隙','篝火の間を進む','夜明け前の奇襲']],
 ['river-crossing','渡河の先陣争い','river','history:kawanakajima',3,'standard',['渡河','川','河','浅瀬','渡り場'],['defend','raid','charge'],['川岸の確保','浅瀬の迂回','対岸の主力戦']],
 ['bridge-defense','橋頭堡の守備戦','defense','history:hitotoribashi',2,'beginner',['橋','橋頭堡','橋を守','守備演習','渡河阻止'],['defend','balanced','defend'],['橋のたもとの警戒','渡り場の連携','橋頭堡の防衛']],
 ['mountain-pass','峠道の伏兵戦','mountain','history:mimasetoge',3,'standard',['峠','山道','山岳','高低差','伏兵'],['raid','defend','balanced'],['狭路の偵察','尾根の攻防','峠の出口']],
 ['rearguard','殿軍と撤退支援','mountain','history:kanegasaki',2,'advanced',['撤退','殿軍','退却','退路','撤収'],['defend','raid','defend'],['退路の確保','追撃隊の足止め','殿軍の合流']],
 ['forest-ambush','林間の奇襲演習','forest','history:okehazama',2,'standard',['森','林','林間','木陰','奇襲演習','桶狭間'],['raid','defend','charge'],['林道の索敵','木立の伏兵','開け地の反攻']],
 ['forest-maneuver','森を巡る遊撃戦','forest','history:komakinagakute',3,'advanced',['遊撃','回り込み','迂回','機動','長久手'],['raid','balanced','raid'],['横道への展開','連絡路の争奪','遊撃隊の合流']],
 ['coastal-landing','海辺の上陸作戦','coast','history:itsukushima',3,'standard',['海','浜','上陸','海辺','島'],['balanced','raid','charge'],['浜辺への展開','入江の側面攻撃','岬の突破']],
 ['harbor-escort','入江の船団警護','coast','history:kizugawaguchi',3,'advanced',['船','船団','舟','港','海上','警護'],['defend','balanced','raid'],['入港路の警戒','船団の護衛','河口の反攻']],
 ['winter-drill','雪道の持久演習','winter','history:osaki',3,'beginner',['雪道','冬の訓練','冬','雪','氷','持久演習'],['defend','balanced','siege'],['雪道の行軍','吹雪の中の連携','雪中の陣地']],
 ['winter-front','雪原の防衛線','winter','history:kitano',4,'advanced',['雪原','冬の防衛','寒冷','防衛線','出羽'],['defend','siege','defend'],['雪原の迎撃','陣地の補強','白い戦線の反攻']],
 ['encircled-counterattack','包囲網への反撃','defense','history:ueda1',3,'standard',['籠城','反撃','迎撃','上田','包囲網'],['defend','raid','defend'],['城門の迎撃','搦手からの反撃','包囲網の突破']],
 ['capital-guard','都の城砦を守る戦','defense','history:fushimi',2,'standard',['都','伏見','京','城を守','城の守り','守城'],['defend','siege','balanced'],['城下の警戒','外郭の守備','本陣の連携']],
 ['final-maincamp','最後の本陣決戦','unification','history:osaka_summer',5,'advanced',['大坂','大阪','最終決戦','本陣','夏の陣'],['charge','balanced','charge'],['先鋒の突破','主力の総攻撃','最後の本陣']]
].map(([id,name,category,battleId,durationDays,difficulty,keywords,tactics,stageNames])=>({id,name,category,battleId,durationDays,difficulty,keywords,tactics,stageNames}));
const DETAILS={
 'first-march':'初めての領主が、隊列・守り・正攻法を順に試す入門企画。',
 'formation-drill':'号令と部隊の連携を確かめ、攻守の切り替えを学ぶ鍛錬。',
 'plain-breakthrough':'広い戦線に部隊を展開し、主力を集中して突破口を開く野戦。',
 'decisive-battle':'左右翼と中央の戦線を制し、天下統一の条件達成を目指す決戦。',
 'siege-ring':'外郭・補給路・本陣の順に守りを崩す、段階的な包囲戦。',
 'stronghold-council':'堅城への圧力と部隊連携を重ね、天下統一の条件達成を目指す攻略戦。',
 'night-raid':'夜の見張りと篝火の位置を読み、夜明けまでの勝機を探る企画。',
 'river-crossing':'渡り場を確保し、迂回と突撃を使い分けて対岸へ進む渡河戦。',
 'bridge-defense':'橋のたもとで隊列を保ち、敵の攻勢を受け止める守備入門。',
 'mountain-pass':'狭い峠と尾根を使い、偵察・守備・進撃を切り替える山岳戦。',
 'rearguard':'退路の確保と追撃隊への足止めを題材に、殿軍の判断を試す戦い。',
 'forest-ambush':'木陰に潜む敵を探り、林道から開け地へ戦術を切り替える演習。',
 'forest-maneuver':'横道と連絡路を巡り、部隊の回り込みと合流を競う遊撃戦。',
 'coastal-landing':'浜辺を確保し、入江から岬へ進路を開く海辺の作戦。',
 'harbor-escort':'入港路と船団を守り、河口の敵へ反攻する警護作戦。',
 'winter-drill':'雪道で隊列を維持し、備えを整えて陣地を進む持久演習。',
 'winter-front':'雪原の陣地を固め、敵の攻勢へ段階的に応じる防衛戦。',
 'encircled-counterattack':'城門の守備と搦手の奇襲を組み合わせ、包囲網に反撃する企画。',
 'capital-guard':'都の城下と外郭を守り、本陣の連携で攻勢を受け止める守城戦。',
 'final-maincamp':'先鋒・主力・本陣の3局面を突破し、天下統一の条件達成を目指す総力戦。'
};
function invalid(message){const error=new RangeError(message);error.status=400;error.code='INVALID_INPUT';throw error;}
function cleanPrompt(value){
 if(typeof value!=='string')invalid('企画の要望は文字列で入力してください。');
 const result=value.normalize('NFC').replace(/\s+/gu,' ').trim();
 if(Array.from(result).length>600||/[\u0000-\u001f\u007f-\u009f<>]/u.test(result))invalid('企画の要望は、HTMLを含めず600文字以内で入力してください。');
 return result;
}
function cleanSeed(value){
 if(typeof value==='number'){if(!Number.isSafeInteger(value)||value<0||value>0xffffffff)invalid('生成シードが正しくありません。');return String(value);}
 if(typeof value!=='string'||!value.trim()||Array.from(value).length>128||/[\u0000-\u001f\u007f-\u009f]/u.test(value))invalid('生成シードが正しくありません。');
 return value.normalize('NFC').trim();
}
const searchText=value=>value.normalize('NFKC').toLowerCase();
function mentioned(prompt,word){
 const needle=searchText(word);let from=0;
 while(from<prompt.length){const at=prompt.indexOf(needle,from);if(at<0)return false;
  if(!/^(?:(?:の)?(?:戦い|戦|作戦|演習|戦闘|原))?(?:ではなく|ではない|じゃなく|じゃない|以外|なし|不要|を避け|は避け|を除)/u.test(prompt.slice(at+needle.length)))return true;
  from=at+needle.length;
 }return false;
}
const matches=(prompt,words)=>words.filter(word=>mentioned(prompt,word));
function randomFrom(value){let hash=2166136261;for(let i=0;i<value.length;i++){hash^=value.charCodeAt(i);hash=Math.imul(hash,16777619);}let seed=hash>>>0;return()=>{let t=seed+=0x6D2B79F5;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
function templateDto(preset){
 const battle=globalThis.SengokuBattleCatalog.get(preset.battleId);if(!battle)throw Error('Court event template battle is missing: '+preset.id);
 return{id:preset.id,name:preset.name,category:preset.category,categoryLabel:CATEGORIES[preset.category],description:DETAILS[preset.id],battleId:battle.id,battleName:battle.name,durationDays:preset.durationDays,difficulty:preset.difficulty,difficultyLabel:DIFFICULTIES[preset.difficulty].label,themeId:battle.themeId};
}
export function listCourtEventTemplates(){return PRESETS.map(templateDto);}
function namedBattle(prompt){
 const candidates=[];
 for(const battle of globalThis.SengokuBattleCatalog.list()){
  const names=new Set([battle.name,battle.name.replace(/の戦い$/u,'')]);
  for(const name of [...names])if(name.includes('大坂'))names.add(name.replaceAll('大坂','大阪'));
  for(const name of names)if(Array.from(name).length>=3&&mentioned(prompt,name))candidates.push({battle,word:name});
 }
 candidates.sort((a,b)=>b.word.length-a.word.length||(a.battle.id<b.battle.id?-1:a.battle.id>b.battle.id?1:0));return candidates[0]||null;
}
function selectPreset(prompt,preferred,battle){
 const candidates=PRESETS.filter(p=>!battle||globalThis.SengokuBattleCatalog.get(p.battleId).themeId===battle.themeId).map(p=>({preset:p,words:matches(prompt,p.keywords)}));
 // A difficulty request must not displace an explicit terrain such as
 // "初心者向けの夜戦"; the beginner profile is applied after selection.
 for(const candidate of candidates)candidate.score=candidate.words.reduce((sum,word)=>sum+(candidate.preset.category==='beginner'?1:1+Math.min(6,Array.from(word).length)),0);
 candidates.sort((a,b)=>b.score-a.score||(b.preset.id===preferred?.id?1:0)-(a.preset.id===preferred?.id?1:0));
 if(battle){const exact=candidates.find(item=>item.preset.battleId===battle.id);if(exact)return exact;}
 const selected=candidates[0];if(selected?.score)return selected;
 if(preferred&&(!battle||templateDto(preferred).themeId===battle.themeId))return{preset:preferred,words:[],score:0};
 return selected||{preset:PRESETS[0],words:[],score:0};
}

export function generateCourtEventPlan(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['templateId','prompt','durationDays','mode','seed'].includes(key)))invalid('イベント企画の入力内容を確認してください。');
 const {templateId,durationDays,mode='template'}=input,prompt=cleanPrompt(input.prompt===undefined?'':input.prompt),seed=cleanSeed(input.seed);
 if(!['template','ai'].includes(mode))invalid('テンプレートまたはゲームAIを選んでください。');
 if(!Number.isSafeInteger(durationDays)||durationDays<1||durationDays>7)invalid('開催日数は1〜7日で指定してください。');
 const preferred=templateId===undefined||templateId===null||templateId===''?null:PRESETS.find(p=>p.id===templateId);
 if(templateId!=null&&templateId!==''&&!preferred)invalid('20種類のテンプレートから選んでください。');
 if(mode==='template'&&!preferred)invalid('企画のテンプレートを選んでください。');
 if(mode==='ai'&&!prompt&&!preferred)invalid('企画の要望を入力するか、土台となるテンプレートを選んでください。');
 const searchable=mode==='ai'?searchText(prompt):'',named=mode==='ai'?namedBattle(searchable):null,selection=mode==='template'?{preset:preferred,words:[],score:0}:selectPreset(searchable,preferred,named?.battle),preset=selection.preset;
 const battleId=named?.battle.id||preset.battleId,template=templateDto(preset),reasons=[];
 const material=JSON.stringify([mode,preset.id,battleId,prompt,durationDays,seed]),random=randomFrom(material),variantSeed='court-'+Math.floor(random()*0x100000000).toString(16);
 const plan=generateEventPlan({battleId,durationDays,seed:variantSeed});
 if(mode==='template')reasons.push('テンプレート「'+preset.name+'」の戦場と3局面を組み立てました。');
 else if(named)reasons.push('要望中の「'+named.word+'」に一致する戦場を選び、「'+preset.name+'」の構成を合わせました。');
 else if(selection.words.length)reasons.push('要望の「'+selection.words.join('・')+'」に合う「'+preset.name+'」を選びました。');
 else reasons.push('「'+preset.name+'」を土台に、3局面の戦術とNPC戦力を構成しました。');
 const difficultyMatches=Object.entries(DIFFICULTIES).map(([id,value])=>({id,words:matches(searchable,value.words)})).filter(item=>item.words.length);
 difficultyMatches.sort((a,b)=>b.words.length-a.words.length||Math.max(...b.words.map(word=>searchable.lastIndexOf(searchText(word))))-Math.max(...a.words.map(word=>searchable.lastIndexOf(searchText(word)))));
 const difficulty=difficultyMatches[0]?.id||preset.difficulty,profile=DIFFICULTIES[difficulty];
 const tactical=Object.entries(TACTICS).map(([id,value])=>({id,words:matches(searchable,value.words)})).filter(item=>item.words.length);
 tactical.sort((a,b)=>b.words.length-a.words.length);
 const tactics=[...preset.tactics];if(tactical[0]){tactics[0]=tactical[0].id;tactics[2]=tactical[0].id;}if(tactical[1])tactics[1]=tactical[1].id;
 for(const [index,stage] of plan.stages.entries()){
  const tactic=tactics[index];stage.name=preset.stageNames[index];stage.enemyName=stage.name+'の'+(difficulty==='beginner'?'演習隊':difficulty==='advanced'?'精鋭隊':'守備隊');
  stage.enemyPower=profile.powers[index]+Math.floor(random()*7)-3;
  stage.recommendedTactic=tactic;stage.tacticHint=TACTICS[tactic].hint;
  stage.description=stage.description+' '+TACTICS[tactic].name+'を軸に、この局面の勝機を探ります。';
  stage.tacticMultipliers=Object.fromEntries(Object.keys(TACTICS).map(id=>[id,id===tactic?1.20+Math.floor(random()*5)/100:.94+Math.floor(random()*9)/100]));
 }
 const tacticNames=[...new Set(tactics)].map(id=>TACTICS[id].name);
 plan.synopsis='「'+plan.name+'」を舞台に、「'+preset.name+'」を構成しました。'+DETAILS[preset.id]+' '+tacticNames.join('・')+'を使い分け、3つの局面で戦功を重ねます。NPC部隊の強さは'+profile.label+'向けです。';
 reasons.push('3局面の推奨戦術は、'+tactics.map(id=>TACTICS[id].name).join(' → ')+'です。');
 reasons.push((difficultyMatches[0]?'要望の「'+difficultyMatches[0].words.join('・')+'」を反映し、':'テンプレートの設定に合わせ、')+'NPCの強さを「'+profile.label+'」にしました。');
 if(globalThis.SengokuBattleCatalog.targetCastleId(plan))reasons.push('対象の城に現職の領主が一人いる場合は、その城の守備戦力で戦います。難易度設定はNPC戦に適用します。');
 reasons.push('戦功・報酬・指令消費は、既存の開催日数に応じた規則を使用します。');
 const matchedKeywords=[...new Set([...(named?[named.word]:[]),...selection.words,...difficultyMatches.flatMap(item=>item.words),...tactical.flatMap(item=>item.words)])].slice(0,20);
 return{plan:normalizeEventPlan(plan),source:{generator:'game-ai-v1',label:'ゲームAI',mode,templateId:preset.id,templateName:preset.name,prompt,difficulty,difficultyLabel:profile.label,matchedKeywords,reasons}};
}
