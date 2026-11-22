// Small supervised Japanese intent model. All training examples are original,
// synthetic utterances. Train once per Worker isolate; private text is never
// added to the training set or sent to another service.
const examples={
  request:[
    'そこを守って','もう少し待って','明日の予定を教えて','進軍を止めてくれ','増援を送ってくれ','出陣は控えてほしい','もう一度確認してほしい','先に食料を運んで','北に向かって','こちらを見て','結果を知らせてね','後で説明してね','一緒に来て','援軍を頼む','修理をお願い','そこの橋を渡るな','出陣しないで','兵を減らさないで'
  ],
  question:[
    'いつ城に着く','どの道を通る','誰が守る','どこに兵を集める','いつ頃出発する','何時に戻る','どうすればいい','どれを選ぶ','いくら必要','何人向かう','どちらに行く','どのくらいかかる','なぜ兵が少ない','どうして退いた','明日も来る？','届いたかな','終わったの？','大丈夫か'
  ],
  statement:[
    'こちらから届ける','今から行く','私は守る','兵は来ない','木材が足りない','一刻前に届いた','次は南を固める','まだ帰っていない','すでに橋を渡った','東門で待っている','私はそう思う','集めるつもりだ','明日には間に合う','私は渡りたい','向こうに二人いる','援軍は来る予定','まだ検討中','どうしても本陣に戻る'
  ],
  greeting:[
    'ありがとう','助かったよ','どうもありがとう','おはよう','またよろしく','いつも助かる','おつかれ','こんにちは','おやすみ','また会おう','ごめん','すまない','よろしく頼む','お久しぶり','ありがたい','どうぞよろしく'
  ],
  label:[
    '東門の守備について','補給計画','次の会議の議題','援軍の到着時刻','市場での取引','一番槍の編成案','南の拠点','連絡事項','本日の進軍予定','兵糧と軍資金','武将の配置表','西の城門','城下町の地図','共同作戦の記録','建設待ちの施設','太政官からのお知らせ'
  ]
};
function features(text){
  const value=text.replace(/[\s、。！!]/gu,'').slice(-48),chars=Array.from(value),set=new Set();
  for(let i=0;i<chars.length;i++){
    for(let n=1;n<=3&&i+n<=chars.length;n++)set.add('g'+chars.slice(i,i+n).join(''));
  }
  for(let n=1;n<=4&&n<=chars.length;n++)set.add('e'+chars.slice(-n).join(''));
  for(const term of ['いつ','どこ','だれ','誰','どの','どちら','どれ','いくら','何時','何人','なぜ','どうして','どうすれば','何を']){
    if(value.includes(term))set.add('interrogative');
  }
  return set;
}
let model;
function train(){
  const groups=Object.entries(examples).map(([intent,lines])=>({intent,vectors:lines.map(features)}));
  const frequency=new Map(),total=groups.reduce((n,group)=>n+group.vectors.length,0);
  for(const group of groups)for(const vector of group.vectors)for(const feature of vector)frequency.set(feature,(frequency.get(feature)||0)+1);
  const weight=new Map(Array.from(frequency,([feature,count])=>{
    const importance=feature==='interrogative'?3:feature.startsWith('e')?2:1;
    return [feature,importance*(1+Math.log((total+1)/(count+1)))];
  }));
  return {weight,classes:groups.map(({intent,vectors})=>{
    const centroid=new Map();
    for(const vector of vectors)for(const feature of vector)centroid.set(feature,(centroid.get(feature)||0)+weight.get(feature));
    const magnitude=Math.hypot(...centroid.values());
    return {intent,centroid:new Map(Array.from(centroid,([feature,value])=>[feature,value/magnitude]))};
  })};
}
export function japaneseIntent(text){
  model||=train();
  const vector=features(text),known=Array.from(vector).filter(feature=>model.weight.has(feature));
  const norm=Math.hypot(...known.map(feature=>model.weight.get(feature)));
  if(!norm)return 'unknown';
  const scores=model.classes.map(({intent,centroid})=>({intent,score:known.reduce((sum,feature)=>sum+model.weight.get(feature)*(centroid.get(feature)||0),0)/norm})).sort((a,b)=>b.score-a.score);
  return scores[0].score>=.16&&scores[0].score-scores[1].score>=.05?scores[0].intent:'unknown';
}
