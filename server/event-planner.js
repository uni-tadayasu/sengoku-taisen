/* Pure, bounded game AI for event drafts and separate NPC battles.
 * The server owns the draft, roster projection and roll. This module never
 * reads a clock, calls a service, edits a campaign or grants a reward. */
import './game-runtime.js';
import './battle-catalog.js';

const STAGE_IDS=['stage-1','stage-2','stage-3'];
const POINTS=[60,90,120],ENEMY_POWER=[78,112,145];
const COMMAND_RULE='出陣ごとに通常の指令を1消費します。指令は通常の合戦・内政と同じ規則で回復します。';
const LEGACY_DAILY_RULE='開催開始から24時間ごとに、3回まで挑戦できます。未使用の回数は繰り越されません。';
const TACTICS=[
  {id:'balanced',name:'正攻法',description:'統率・武勇・知略を均等に生かし、崩れにくい陣で攻めます。'},
  {id:'charge',name:'突撃',description:'武勇を中心に突破力を高め、開けた場所の敵陣を崩します。'},
  {id:'raid',name:'奇襲',description:'知略を中心に敵の隙を探り、狭路や見通しの悪さを生かします。'},
  {id:'siege',name:'包囲',description:'知略と政治を生かして備えを整え、固い守りを切り崩します。'},
  {id:'defend',name:'堅守',description:'統率を中心に陣形を保ち、敵の勢いを受け止めて反撃します。'}
];
const WEIGHTS={balanced:[.40,.30,.25,.05],charge:[.25,.60,.10,.05],raid:[.20,.20,.55,.05],siege:[.25,.15,.40,.20],defend:[.50,.10,.25,.15]};
const THEMES=[
  {id:'plain',label:'開けた野戦',description:'見通しのよい平地で、陣形と突破の機会を見極める戦場。',words:[['関ヶ原',10],['原',4],['野',3],['平',3],['決戦',3]],
    stages:[['街道の先陣','街道の先鋒隊','広い街道に展開する先鋒を、陣形を乱さず押し返す。','balanced','まずは統率を生かす正攻法で、広い戦線を整えましょう。'],['丘陵の主力','丘陵の槍兵隊','丘の手前で止まった主力の間隙を、一気に突破する。','charge','武勇の高い軍団による突撃が、敵の隙を広げます。'],['本陣の反攻','本陣の精鋭隊','突破を警戒する精鋭の反撃を受け止め、勝機をつかむ。','defend','統率を軸に堅守を選び、反撃の勢いをいなしましょう。']]},
  {id:'mountain',label:'山あいの狭路',description:'高低差と狭い道を使い、知略と部隊のまとまりを競う戦場。',words:[['峠',6],['山',4],['谷',4],['峰',4],['坂',3],['狭間',5]],
    stages:[['峠道の伏兵','峠の伏兵隊','狭い山道の先に潜む敵を探り、先手を取る。','raid','知略を生かす奇襲で、山道に潜む敵の位置を見破りましょう。'],['尾根の防戦','尾根の強襲隊','高所から押し寄せる敵を受け止め、足場を確保する。','defend','堅守で陣を保ち、足場の悪さを補いましょう。'],['山頂への進撃','山頂の守備隊','分かれ道から合流する敵に対し、隊列をそろえて進む。','balanced','正攻法で部隊をまとめ、分断されずに山頂へ進みましょう。']]},
  {id:'river',label:'河畔の渡河戦',description:'渡り場と川岸の守りを読み、攻守を切り替える戦場。',words:[['川',5],['河',5],['渡',5],['橋',5],['水',3]],
    stages:[['渡り場の攻防','渡り場の先遣隊','川岸に迫る敵を防ぎ、渡河の準備を整える。','defend','統率の高い軍団で守りを固め、安全な渡り場を確保しましょう。'],['浅瀬の迂回','浅瀬の見張り隊','正面の守りを避け、浅瀬から敵の側面へ回る。','raid','奇襲で見張りの隙を突き、側面の道を開きましょう。'],['対岸への突入','対岸の精鋭隊','足場を得た部隊をまとめ、対岸の本隊へ切り込む。','charge','道が開いたら武勇を生かす突撃が有効です。']]},
  {id:'castle',label:'城砦の攻防',description:'外郭と防備の弱点を見極め、段階的に敵陣を崩す戦場。',words:[['城',6],['砦',6],['籠',5],['攻城',7],['堅城',7]],
    stages:[['外郭の包囲','外郭の守備隊','外側の守りを囲み、敵の動きを狭める。','siege','知略と政治を生かす包囲で、固い外郭の隙を作りましょう。'],['搦手の突破','搦手の警備隊','守りの薄い道を探り、本陣への連絡を断つ。','raid','奇襲で搦手の警戒を抜け、敵の備えを崩しましょう。'],['本丸の攻防','本丸の精鋭隊','最後の守備隊に対し、部隊を連携させて圧力をかける。','siege','包囲で補給と連携を整え、最後の守りを切り崩しましょう。']]},
  {id:'forest',label:'林間の戦線',description:'木々に遮られた視界を読み、奇襲と進路の確保を競う戦場。',words:[['森',5],['林',5],['木',2],['桶狭間',10]],
    stages:[['林道の探索','林道の斥候隊','木陰に潜む敵を探り、進路を確かめる。','raid','知略を生かす奇襲で、先に敵の動きをつかみましょう。'],['木立の守備','木立の遊撃隊','横道から現れる敵の動きを止め、戦線を守る。','defend','堅守で味方の分断を防ぎ、敵の回り込みに備えましょう。'],['開け地の決戦','開け地の主力隊','林を抜けた敵主力へ、まとまった部隊で打って出る。','charge','視界が開けた場所では、武勇を生かす突撃が力を発揮します。']]},
  {id:'coast',label:'海辺の陣取り',description:'浜と細い進路を押さえ、攻める場所を選ぶ戦場。',words:[['海',5],['浜',5],['浦',4],['舟',4],['船',4],['島',3]],
    stages:[['浜辺の陣形','浜辺の先遣隊','広い浜に隊列を整え、敵の押し込みを防ぐ。','balanced','正攻法で広い戦線を安定させ、進路を確保しましょう。'],['入江の迂回','入江の警戒隊','入り組んだ地形を使い、敵の側面を探る。','raid','奇襲で入江を回り込み、正面の守りを避けましょう。'],['岬の主力戦','岬の精鋭隊','細い進路の先で守る主力を、機を見て突破する。','charge','敵の隊列が伸びた瞬間に、武勇を生かす突撃で突破しましょう。']]},
  {id:'snow',label:'雪原の持久戦',description:'動きにくい雪道で、陣形の維持と備えの厚さを競う戦場。',words:[['雪',6],['冬',5],['氷',5],['霜',4]],
    stages:[['雪道の迎撃','雪道の先鋒隊','足場を確かめながら、迫る敵の先鋒を受け止める。','defend','堅守で足並みをそろえ、滑りやすい道の不利を抑えましょう。'],['白原の行軍','白原の遊撃隊','視界の悪い場所を抜け、互いの距離を保って進む。','balanced','正攻法で隊列を整え、部隊同士の連携を保ちましょう。'],['雪中の陣地戦','雪中の守備隊','備えを固める敵陣を囲み、動きを封じる。','siege','包囲で備えを整え、守備隊の動ける場所を狭めましょう。']]},
  {id:'night',label:'夜陰の攻防',description:'見通しの利かない夜の陣で、探り合いと反撃を競う戦場。',words:[['夜',6],['月',5],['闇',5],['暁',4],['星',3]],
    stages:[['夜道の奇襲','夜道の警備隊','見張りの交代を読み、暗い進路を切り開く。','raid','知略を生かす奇襲で、夜の見張りの隙を狙いましょう。'],['篝火の戦線','篝火の守備隊','照らされた陣を前に、味方の位置を確かめながら攻める。','balanced','正攻法で味方の動きをそろえ、暗闇での分断を防ぎましょう。'],['夜明けの反撃','夜明けの精鋭隊','最後の反撃を仕掛ける敵を受け止め、戦線を押し返す。','defend','堅守で精鋭の勢いを止め、夜明けの勝機をつかみましょう。']]}
];
function invalid(message){throw new RangeError(message);}
function text(value,label,max){if(typeof value!=='string')invalid(label+'を文字列で指定してください。');const result=value.normalize('NFC').trim();if(!result||Array.from(result).length>max||/[\u0000-\u001F\u007F-\u009F]/u.test(value))invalid(label+'は1〜'+max+'文字で指定してください。');return result;}
function days(value){if(!Number.isSafeInteger(value)||value<1||value>7)invalid('開催日数は1〜7日で指定してください。');return value;}
function seedText(value){if(typeof value==='number'){if(!Number.isSafeInteger(value)||value<0||value>0xffffffff)invalid('生成シードが正しくありません。');return String(value);}return text(value,'生成シード',128);}
function randomFrom(value){let hash=2166136261;for(let i=0;i<value.length;i++){hash^=value.charCodeAt(i);hash=Math.imul(hash,16777619);}let seed=hash>>>0;return()=>{let t=seed+=0x6D2B79F5;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
const cap=(value,max,label)=>{if(typeof value!=='number'||!Number.isFinite(value)||value<0)invalid(label+'が正しくありません。');return Math.min(max,value);};
const gift=(values,scale)=>Object.fromEntries(['gold','rice','wood','stone','magatama'].map((key,index)=>[key,Math.floor(values[index]*scale)]));
const GIFT_KEYS=['gold','rice','wood','stone','magatama'];
const battleGifts=()=>({victory:[[120,160,20,20,4],[180,240,30,30,6],[240,320,40,40,8]].map(v=>gift(v,1)),defeat:[[30,40,0,0,1],[45,60,0,0,1],[60,80,0,0,2]].map(v=>gift(v,1))});

export function generateEventPlan({battleId,durationDays,seed}={}){
  battleId=text(battleId,'戦いの選択',128);durationDays=days(durationDays);
  const battle=globalThis.SengokuBattleCatalog.get(battleId);
  if(!battle)invalid('戦い一覧から戦場を選んでください。');
  const name=text(battle.name,'戦いの名前',60),selected=THEMES.find(theme=>theme.id===battle.themeId);
  if(!selected)invalid('選択された戦場の地形が正しくありません。');
  const random=randomFrom(battleId+'\u0000'+durationDays+'\u0000'+seedText(seed));
  const stages=selected.stages.map(([stageName,enemyName,description,recommendedTactic,tacticHint],index)=>{
    const multipliers=Object.fromEntries(TACTICS.map(t=>[t.id,t.id===recommendedTactic?1.20+Math.floor(random()*4)/100:.94+Math.floor(random()*9)/100]));
    return{id:STAGE_IDS[index],name:stageName,description,enemyName,enemyPower:ENEMY_POWER[index]+Math.floor(random()*11)-5,basePoints:POINTS[index],recommendedTactic,tacticHint,tacticMultipliers:multipliers};
  });
  const scale=1+(durationDays-1)*.15;
  const ending={kind:battle.unificationEligible?'unification':'victory',requiredStageIds:[...STAGE_IDS],requiredPoints:160*durationDays,reward:battle.unificationEligible?'shogunate_right':null};
  return{schemaVersion:1,generator:'game-ai-v1',name,durationDays,battleId,battle:{...battle},ending,battleRewards:battleGifts(),theme:{id:selected.id,label:selected.label,description:selected.description},
    synopsis:`「${name}」を題材に、${selected.label}の特色を持つ3つの局面へ挑むイベントです。軍団の能力と戦場に合う戦術で戦功を重ねましょう。`,
    rules:[COMMAND_RULE,'3つのステージは最初から選べます。難しいステージほど獲得できる戦功が多くなります。','毎戦の報酬を本領へ直接付与します。敗北時にも少量の資源と戦功を獲得でき、段階報酬は各1回メールで届きます。','軍団の能力と士気をもとに、イベント用の戦力でNPCと戦います。本領の兵数・資源・領土は減りません。','武将の専用効果や本拠の特例は適用せず、能力は各100・軍団は3名・士気は100を上限に評価します。',battle.unificationEligible?`全3局面でそれぞれ勝利し、戦功${ending.requiredPoints}点に達すると、このイベントの天下統一を達成して幕府開設権を1回獲得できます。本領の城の所有や役職は変わりません。`:'この合戦は通常の戦功・資源報酬を獲得するイベントです。幕府開設権の対象ではありません。'],
    commandCost:1,tactics:TACTICS.map(t=>({...t})),stages,
    milestones:[
      {id:'milestone-1',title:'初陣の戦功',points:20*durationDays,gift:gift([600,800,200,200,30],scale)},
      {id:'milestone-2',title:'奮戦の戦功',points:80*durationDays,gift:gift([1200,1400,400,400,60],scale)},
      {id:'milestone-3',title:'大成の戦功',points:160*durationDays,gift:gift([2000,2200,800,800,100],scale)}]};
}

function validatePlan(plan){
  if(!plan||typeof plan!=='object'||plan.schemaVersion!==1||plan.generator!=='game-ai-v1'||plan.commandCost!==1)invalid('イベント計画が正しくありません。');
  text(plan.name,'戦いの名前',60);days(plan.durationDays);
  if(!Array.isArray(plan.stages)||plan.stages.length!==3||!Array.isArray(plan.milestones)||plan.milestones.length!==3)invalid('イベントの段階が正しくありません。');
  plan.stages.forEach((stage,index)=>{
    if(!stage||stage.id!==STAGE_IDS[index]||!Number.isSafeInteger(stage.enemyPower)||stage.enemyPower<60||stage.enemyPower>180||stage.basePoints!==POINTS[index]||!Object.hasOwn(WEIGHTS,stage.recommendedTactic))invalid('イベントの敵部隊が正しくありません。');
    text(stage.name,'ステージ名',60);text(stage.enemyName,'敵部隊名',60);
    if(!stage.tacticMultipliers||TACTICS.some(t=>typeof stage.tacticMultipliers[t.id]!=='number'||!Number.isFinite(stage.tacticMultipliers[t.id])||stage.tacticMultipliers[t.id]<.85||stage.tacticMultipliers[t.id]>1.3))invalid('戦場の適性が正しくありません。');
  });
  plan.milestones.forEach((milestone,index)=>{if(!milestone||milestone.id!=='milestone-'+(index+1)||milestone.points!==[20,80,160][index]*plan.durationDays||!milestone.gift||['gold','rice','wood','stone','magatama'].some(key=>!Number.isSafeInteger(milestone.gift[key])||milestone.gift[key]<0||milestone.gift[key]>(key==='magatama'?1000:10000)))invalid('イベント報酬が正しくありません。');});
  if(plan.battleId!==undefined||plan.battle!==undefined||plan.ending!==undefined||plan.battleRewards!==undefined){
    text(plan.battleId,'戦いの選択',128);
    const b=plan.battle,e=plan.ending,r=plan.battleRewards;
    // A published plan retains the catalogue snapshot approved at generation.
    // Future catalogue edits cannot rewrite an existing event's conditions.
    if(!b||b.id!==plan.battleId||b.name!==plan.name||!THEMES.some(t=>t.id===b.themeId)||b.themeId!==plan.theme?.id||typeof b.unificationEligible!=='boolean')invalid('イベントの戦場情報が正しくありません。');
    text(b.category,'戦いの分類',40);text(b.description,'戦いの説明',1000);
    if(!e||e.kind!==(b.unificationEligible?'unification':'victory')||e.reward!==(b.unificationEligible?'shogunate_right':null)||e.requiredPoints!==plan.milestones[2].points||!Array.isArray(e.requiredStageIds)||e.requiredStageIds.length!==3||e.requiredStageIds.some((id,i)=>id!==STAGE_IDS[i]))invalid('イベントの天下統一条件が正しくありません。');
    for(const result of ['victory','defeat'])if(!r||!Array.isArray(r[result])||r[result].length!==3||r[result].some(g=>!g||Object.keys(g).length!==5||GIFT_KEYS.some(k=>!Number.isSafeInteger(g[k])||g[k]<0||g[k]>(k==='magatama'?1000:10000))))invalid('毎戦の報酬が正しくありません。');
  }
}

export function normalizeEventPlan(plan){
  if(!plan||typeof plan!=='object'||Array.isArray(plan))invalid('イベント計画が正しくありません。');
  const legacy=plan.commandCost===undefined&&plan.dailyAttempts===3;
  if((!legacy&&plan.commandCost!==1)||(plan.dailyAttempts!==undefined&&plan.dailyAttempts!==null&&plan.dailyAttempts!==3))invalid('イベントの出陣条件が正しくありません。');
  if(!Array.isArray(plan.rules)||plan.rules.length<1||plan.rules.length>12)invalid('イベントの規則が正しくありません。');
  for(const rule of plan.rules)text(rule,'イベントの規則',1000);
  // Stored drafts and published plans keep their exact enemies and rewards.
  // Only the former daily quota and its explanation migrate to command use.
  const normalized={...plan,commandCost:1,rules:[COMMAND_RULE,...plan.rules.filter(rule=>rule!==LEGACY_DAILY_RULE&&rule!==COMMAND_RULE)]};
  delete normalized.dailyAttempts;
  if(normalized.rules.length>12)invalid('イベントの規則が正しくありません。');
  validatePlan(normalized);
  return JSON.parse(JSON.stringify(normalized));
}

function battleEstimate(plan,{stageId,tactic,army,morale}={}){
  const stage=plan.stages.find(item=>item.id===stageId),chosen=TACTICS.find(item=>item.id===tactic);
  if(!stage||!chosen)invalid('ステージと戦術を選んでください。');
  if(!army||typeof army!=='object'||!Number.isSafeInteger(army.count)||army.count<0)invalid('保存された軍団を確認できません。');
  const stats=['lead','valor','intellect','politics'].map(key=>cap(army[key],100,'軍団の能力')),count=Math.min(3,army.count),spirit=cap(morale,100,'士気');
  const ability=stats.reduce((sum,value,index)=>sum+value*WEIGHTS[tactic][index],0),fit=stage.tacticMultipliers[tactic];
  const playerPower=Math.max(1,Math.round((62+ability*.92)*(.76+count*.08)*(.9+spirit*.0016)*fit)),enemyPower=stage.enemyPower;
  const chance=Math.max(.10,Math.min(.96,.5+Math.log(playerPower/enemyPower)*.62));
  return{stage,chosen,stats,count,spirit,fit,playerPower,enemyPower,chance};
}

export function adviseEventBattle(plan,{stageId,army,morale}={}){
  plan=normalizeEventPlan(plan);
  const estimates=TACTICS.map(t=>battleEstimate(plan,{stageId,tactic:t.id,army,morale}));
  estimates.sort((a,b)=>b.chance-a.chance||b.playerPower-a.playerPower||TACTICS.indexOf(a.chosen)-TACTICS.indexOf(b.chosen));
  const best=estimates[0],option=v=>({tactic:v.chosen.id,tacticName:v.chosen.name,winChance:Math.round(v.chance*100),playerPower:v.playerPower,enemyPower:v.enemyPower});
  return{stageId,...option(best),reason:`現在の軍団と士気・戦場適性で5つの戦術を比較しました。${best.chosen.name}の予測勝率は${Math.round(best.chance*100)}%です。勝利を保証するものではありません。`,options:estimates.map(option)};
}

export function resolveEventBattle(plan,{stageId,tactic,army,morale}={},roll){
  // Only a server-stored approved plan belongs here. Request bodies contain
  // the stage/tactic selection, never an enemy, reward or claimed army stat.
  plan=normalizeEventPlan(plan);
  if(typeof roll!=='number'||!Number.isFinite(roll)||roll<0||roll>=1)invalid('合戦の判定値が正しくありません。');
  const {stage,chosen,stats,count,spirit,fit,playerPower,enemyPower,chance}=battleEstimate(plan,{stageId,tactic,army,morale});
  const won=roll<chance,points=won?stage.basePoints:Math.max(5,Math.floor(stage.basePoints*.25));
  const summary=won?`${stage.name}で敵陣を突破し、戦功${points}点を獲得しました。`:`${stage.name}で敵の抵抗を受け撤収し、奮戦の戦功${points}点を獲得しました。`;
  const reward=plan.battleRewards?.[won?'victory':'defeat']?.[plan.stages.findIndex(s=>s.id===stage.id)];
  return{won,points,stageId:stage.id,stageName:stage.name,tactic:chosen.id,tacticName:chosen.name,enemyName:stage.enemyName,playerPower,enemyPower,winChance:Math.round(chance*100),summary,...(reward?{offeredRewards:{...reward}}:{}),
    log:[`${stage.name}へ進軍。${stage.enemyName}と対峙しました。`,`軍団${count}名・統率${Math.round(stats[0])}・武勇${Math.round(stats[1])}・知略${Math.round(stats[2])}・政治${Math.round(stats[3])}・士気${Math.round(spirit)}で戦力を評価しました。`,`${chosen.name}を採用。戦場適性は${Math.round(fit*100)}%、味方戦力${playerPower}・敵戦力${enemyPower}です。`,summary]};
}
