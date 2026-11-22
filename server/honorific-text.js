import {japaneseIntent} from './honorific-intent.js';

// Inflect complete predicates. The lexical endings are matched longest first,
// so prohibitions, past negatives and progressive forms keep their own meaning.
const conjugations=new Map();
const rows={
  'う':['い','わ','え','お','って','った'],'つ':['ち','た','て','と','って','った'],
  'る':['り','ら','れ','ろ','って','った'],'む':['み','ま','め','も','んで','んだ'],
  'ぶ':['び','ば','べ','ぼ','んで','んだ'],'ぬ':['に','な','ね','の','んで','んだ'],
  'く':['き','か','け','こ','いて','いた'],'ぐ':['ぎ','が','げ','ご','いで','いだ'],
  'す':['し','さ','せ','そ','して','した']
};
const godan='行く いく 書く 聞く 訊く 着く 届く 働く 置く 向く 動く 引く 歩く 開く 防ぐ 急ぐ 泳ぐ 待つ 立つ 持つ 打つ 撃つ 役立つ 勝つ 送る 戻る 帰る 渡る 入る 守る 作る 取る 知る 分かる わかる 頑張る 頼る 走る 乗る 集まる 変わる 終わる 困る 余る 減る 足す 渡す 話す 貸す 返す 直す 出す 探す 外す 目指す 頼む 読む 休む 込む 飲む 進む 組む 運ぶ 選ぶ 呼ぶ 遊ぶ 死ぬ 会う 合う 扱う 使う 買う 払う 思う 言う 違う 向かう もらう 手伝う 救う 倒す 残す 隠す やる 積む ある 有る なる 受け取る 失う 追う 伐る 降る 売る 要る 誘う 傷つく 配る 回る'.split(' ');
const ichidan='見る みる 食べる 受ける 受け取れる 備える 攻める 集める 助ける 守れる 勝てる 行ける 出せる 持てる 撤退できる 出かける 戻れる 投げる 止める 進める 始める 終える 閉める 開ける 届ける 任せる 控える 調べる 伝える 答える 考える 感じる 決める 変える 増やせる 足りる 過ぎる できる 出来る いる くれる 出る 寝る 教える 確かめる 見せる 迎える 待てる 増える 減らせる 控えられる 来られる 負ける 捨てる 立てる 建てる 当てる 育てる'.split(' ');
function register(verb,stem,negative,past,continuative,imperative,volitional){
  const forms=[
    [verb,'plain'],[past,'past'],[negative+'ない','negative'],[negative+'なかった','pastNegative'],
    [negative+'ないで','negativeRequest'],[negative+'ないでくれ','negativeRequest'],[verb+'な','prohibit'],
    [imperative,'command'],[continuative,'request'],[volitional,'invitation'],
    [stem+'たい','desire'],[stem+'たくない','negativeDesire']
  ];
  for(const [form,kind] of forms)if(form&&!conjugations.has(form))conjugations.set(form,{verb,stem,negative,continuative,kind});
}
for(const verb of godan){
  const root=verb.slice(0,-1),[i,a,e,o,te,ta]=rows[verb.slice(-1)],iku=['行く','いく'].includes(verb);
  register(verb,root+i,root+a,root+(iku?'った':ta),root+(iku?'って':te),root+e,root+o+'う');
  // 五段 verb potential is an 一段 predicate (送る → 送れる → 送れない).
  const potential=root+e;
  for(const [tail,kind] of [['る','plain'],['ない','negative'],['た','past'],['なかった','pastNegative']]){
    const form=potential+tail;
    if(!conjugations.has(form))conjugations.set(form,{verb:potential+'る',stem:potential,negative:potential,continuative:potential+'て',kind});
  }
}
for(const verb of ichidan){const root=verb.slice(0,-1);register(verb,root,root,root+'た',root+'て',root+'ろ',root+'よう');}
register('する','し','し','した','して','しろ','しよう');
register('来る','来','来','来た','来て','来い','来よう');
register('くる','き','こ','きた','きて','こい','こよう');
const endings=Array.from(conjugations.keys()).sort((a,b)=>b.length-a.length);
const teForms=Array.from(new Set(Array.from(conjugations.values(),item=>item.continuative)));
const greetings=new Map([
  ['ありがとう','ありがとうございます'],['ありがと','ありがとうございます'],['どうもありがとう','どうもありがとうございます'],['ありがとね','ありがとうございます'],
  ['助かった','助かりました'],['助かる','助かります'],['おはよう','おはようございます'],['おつかれ','お疲れさまです'],['お疲れ','お疲れさまです'],
  ['よろしく','よろしくお願いいたします'],['よろしく頼む','よろしくお願いいたします'],['よろしくお願い','よろしくお願いいたします'],
  ['了解','承知いたしました'],['了解した','承知いたしました'],['了解だ','承知いたしました'],['わかった','承知いたしました'],['分かった','承知いたしました'],
  ['ごめん','申し訳ありません'],['ごめんなさい','申し訳ありません'],['すまない','申し訳ありません'],['おめでとう','おめでとうございます'],
  ['返事して','ご返信いただけますか'],['返事をして','ご返信いただけますか'],['返事をくれ','ご返信いただけますか'],['確認よろしく','ご確認をお願いいたします'],
  ['オッケー','承知いたしました'],['おっけー','承知いたしました'],['OK','承知いたしました'],['ＯＫ','承知いたしました'],['了解っす','承知いたしました'],
  ['はい','はい'],['いいえ','いいえ'],['うん','はい'],['ううん','いいえ'],['了解です','承知いたしました']
]);
const adjectives=['早い','遅い','近い','遠い','強い','弱い','多い','少ない','高い','安い','短い','長い','大きい','小さい','寒い','暑い','良い','よい','いい','悪い','忙しい','難しい','嬉しい','ほしい','欲しい','ありがたい','危ない','痛い','すごい','重い','軽い'];
const honorificStem={行く:'いらっしゃい',いく:'いらっしゃい',来る:'いらっしゃい',くる:'いらっしゃい',いる:'いらっしゃい',見る:'ご覧になり',言う:'おっしゃい',食べる:'召し上がり'};
const humbleStem={行く:'参り',いく:'参り',来る:'参り',くる:'参り',見る:'拝見し',言う:'申し',聞く:'伺い',訊く:'伺い'};
const courtesy=/(?:です|ます|ません|でした|ました|ましょう|でしょう|ください|下さい|いたします|ございます|存じます|承知しました|こんにちは|こんばんは|失礼いたしました)(?:よね|か|ね|よ|が|ので|けれども)?$/u;
const wh=/(?:いつ(?!も|か|でも)|どこ(?!も|か|にも|でも)|誰(?!も|か|でも)|だれ(?!も|か|でも)|どなた|どちら|どの(?:城|道|部隊|武将|拠点|くらい|ぐらい|方)|どれ(?!も|か|でも)|なぜ|どうして(?!も)|どう(?:する|した|すれば)|いくら|何(?:時|人|個|日|を|が|処|色))/u;
const clauseQuestion=/(?:[?？]|かな[。！!、]?|だろうか)$/u;
const nominalQuestion=/(?:必要|大丈夫|可能|予定|本当|どっち|いくら|何時|何人|どこ|誰|どなた|いつ)$/u;
const administrative=/(?:確認|連絡|報告|相談|説明|案内|返答|返信|提出|手配|用意|準備|調整|失礼|参加|対応|お願い)\s*$/u;
function protect(text){
  let marker='\uE000';while(text.includes(marker))marker+=marker;
  const spans=[],pairs={'「':'」','『':'』','“':'”','‘':'’','【':'】','〈':'〉','《':'》'};
  const pattern=/```|`|https?:\/\/|www\.|@[A-Za-z0-9_-]+|[＃#][\p{L}\p{N}＿_ー-]+|[「『“‘【〈《"']/giu;
  let cursor=0,masked='',match;
  while((match=pattern.exec(text))){
    const start=match.index,token=match[0];let end=pattern.lastIndex;
    if(token==='\u0060'||token==='\u0060\u0060\u0060'){const next=text.indexOf(token,end);end=next<0?text.length:next+token.length;}
    else if(token==='"'||token==="'"){
      if(token==="'"&&/[A-Za-z0-9]/u.test(text[start-1]||''))continue;
      const next=text.indexOf(token,end);end=next<0?text.length:next+1;
    }else if(pairs[token]){
      const stack=[pairs[token]];
      while(end<text.length&&stack.length){const ch=text[end++];if(pairs[ch])stack.push(pairs[ch]);else if(ch===stack[stack.length-1])stack.pop();}
    }else if(!/^[@＃#]/u.test(token)){
      while(end<text.length&&!/[\s<>"「」『』、。！？【】（）、]/u.test(text[end]))end++;
      // A final full stop is prose punctuation, not part of the destination.
      if(text[end-1]==='.')end--;
    }
    masked+=text.slice(cursor,start)+marker+spans.length+marker;spans.push(text.slice(start,end));cursor=end;pattern.lastIndex=end;
  }
  masked+=text.slice(cursor);
  const restore=value=>value.replace(new RegExp(marker+'(\\d+)'+marker,'gu'),(_,n)=>spans[Number(n)]);
  // Punctuation inside unquoted reported speech is not a new command to the
  // recipient (守れ！ではなく攻めろ！と伝えて). Protect its original wording.
  masked=masked.replace(/[^。！？!?\n]+[。！？!?](?=ではなく|じゃなく|でなく|とは|と(?:言|いっ|伝|書)|って(?:言|いっ|伝|書))/gu,part=>{
    const id=spans.length;spans.push(restore(part));return marker+id+marker;
  });
  return {masked,restore};
}
function speakerRole(prefix){
  // Conflicting subjects in a clause stay in neutral polite form.
  const final=prefix.split('、').pop();if(final!==prefix&&/[はが]/u.test(final))prefix=final;
  const self=/(?:私|わたし|僕|俺|自分|こちら|当方|我々|私たち)(?:から|の方)?[はが]/u.test(prefix);
  const listener=/(?:あなた|貴方|貴君|お前|あんた|そちら|殿|様)(?:から|の方)?[はが]/u.test(prefix);
  const other=/(?:彼|彼女|相手|敵(?:軍|兵)?|味方|武将|部隊|兵士|兵|隊|援軍|使者|領主|将軍|家臣|仲間)[はが]/u.test(prefix)||!self&&!listener&&/[\p{L}\p{N}]が/u.test(prefix);
  return other||self&&listener?'other':self?'speaker':listener?'listener':'neutral';
}
function rewritePredicate(line,question,intent){
  const form=endings.find(suffix=>line.endsWith(suffix));if(!form)return null;
  const {verb,stem,negative,continuative,kind}=conjugations.get(form),prefix=line.slice(0,-form.length);
  const role=speakerRole(prefix),head=prefix;
  // People literally talk, hear sounds, or look at scenery. Humble idioms for a
  // visit or inspection are restricted to explicit interpersonal contexts.
  let polite=stem;
  if(role==='listener')polite=honorificStem[verb]||stem;
  if(role==='speaker'&&(!['聞く','訊く','見る'].includes(verb)||/(?:話|お名前|ご意見|資料|書状|報告書|計画書)(?:を|について)$/u.test(prefix)))polite=humbleStem[verb]||stem;
  if(verb==='する'&&role==='speaker'&&administrative.test(prefix))polite='いたし';
  const ending=question?'か':'';
  switch(kind){
    case 'plain':return head+polite+'ます'+ending;
    case 'past':return head+polite+'ました'+ending;
    case 'negative':return head+polite+'ません'+ending;
    case 'pastNegative':return head+polite+'ませんでした'+ending;
    case 'desire':return head+stem+'たいです'+ending;
    case 'negativeDesire':return head+stem+'たくありません'+ending;
    case 'invitation':return head+stem+'ましょう'+(question?'か':'');
    case 'prohibit':
    case 'negativeRequest':return ['other','speaker'].includes(role)?null:head+negative+(role==='listener'?'ないでくださいますか':'ないでいただけますか');
    case 'command':return head+continuative+(role==='listener'?'くださいますか':'いただけますか');
    case 'request':
      // A conjunctive form with an explicit third-party or speaker subject can
      // be an unfinished report. A model score alone never turns it into an order.
      return ['neutral','listener'].includes(role)&&intent!=='statement'?head+continuative+(role==='listener'?'くださいますか':'いただけますか'):null;
    default:return null;
  }
}
function rewriteClause(raw,punctuation,field,depth=0){
  const white=raw.match(/^(\s*)([\s\S]*?)(\s*)$/u),text=white[2];
  if(!text)return raw;
  let polite=text;
  if(!courtesy.test(text)){
    const stripped=text.replace(/(?:だよね|だよ|だね|よね|よ|ね|ぞ|ぜ)$/u,m=>m.startsWith('だ')?'だ':'');
    const directQuestion=/[?？]/u.test(punctuation),endingQuestion=clauseQuestion.test(stripped);
    let base=endingQuestion?stripped.replace(/(?:かな|だろうか)$/u,''):stripped;
    base=base.replace(/(^|[、\s(（])(?:お前|あんた|君)(?=[はがのをにと、])/gu,'$1あなた').replace(/(^|[、\s(（])(?:俺|僕)(?=[はがのをにと])/gu,'$1私');
    // Restore only known missing object particles. Keep names and identifiers.
    base=base.replace(/(援軍|兵糧|木材|書状|軍資金|報告書|食料|石材)(?=送|運|届|渡|集|買|売)/gu,'$1を');
    const explicitKa=/か$/u.test(base)&&!/(?:かどうか|何か|誰か|どこか|いつか|幾らか)$/u.test(base);
    if(explicitKa&&endings.some(form=>base.slice(0,-1).endsWith(form)))base=base.slice(0,-1);
    if(directQuestion&&base.endsWith('の')&&endings.some(form=>base.slice(0,-1).endsWith(form)))base=base.slice(0,-1);
    const intent=japaneseIntent(base+punctuation);
    const confirmation=text.endsWith('よね');
    const question=!confirmation&&(directQuestion||endingQuestion||explicitKa||intent==='question'&&wh.test(base)&&!/(?:かを|かは|かが|のか|かに|かどうか)/u.test(base)&&!/(?:わからない|分からない|わかんない|分かんない|知っている|知らない|忘れた|決めた)$/u.test(base));
    const joined=depth<4&&!/(?:の|ん)だから/u.test(base)&&base.match(/^(.+?)(から(?!には|こそ|して|とい)|ので(?!あれ|あっ|あろ|は|す|も)|けど|けれど)、?\s*(.+)$/u);
    const firstPart=joined&&rewriteClause(joined[1],'',field,depth+1);
    const preceding=firstPart&&!firstPart.unresolved&&/(?:です|ます|ません|でした|ました)$/u.test(firstPart.text)&&firstPart.text;
    const following=preceding&&rewriteClause(joined[3],punctuation,field,depth+1);
    if(following&&!following.unresolved)polite=preceding+(['から','ので'].includes(joined[2])?'ので、':'が、')+following.text;
    else if(greetings.has(stripped)&&!question)polite=greetings.get(stripped);
    else if(/ありがとう$/u.test(base)&&!question)polite=base+'ございます';
    else if(/(?:わかんない|分かんない)$/u.test(base))polite=base.replace(/(?:わかんない|分かんない)$/u,'分かりません')+(question?'か':'');
    else if(/っす$/u.test(base))polite=base.slice(0,-2)+'です'+(question?'か':'');
    else if(base.endsWith('なかった')&&teForms.some(form=>base.slice(0,-4).endsWith(form)))polite=base.slice(0,-4)+'いませんでした'+(question?'か':'');
    else if(base.endsWith('ない')&&teForms.some(form=>base.slice(0,-2).endsWith(form)))polite=base.slice(0,-2)+'いません'+(question?'か':'');
    else if(/(?:ちゃ|じゃ)(?:った|う)$/u.test(base)){
      const ended=base.endsWith('った'),stem=base.replace(/(?:ちゃ|じゃ)(?:った|う)$/u,m=>m.startsWith('ちゃ')?'て':'で');
      polite=stem+'しまい'+(ended?'ました':'ます')+(question?'か':'');
    }else if(/待って(?:い)?て$/u.test(base)&&!['speaker','other'].includes(speakerRole(base)))polite=base.replace(/待って(?:い)?て$/u,'お待ちいただけますか');
    else if(/(?:て|で)て$/u.test(base)&&!['speaker','other'].includes(speakerRole(base)))polite=base.slice(0,-1)+'いていただけますか';
    else if(/来れない$/u.test(base))polite=base.slice(0,-4)+'来られません'+(question?'か':'');
    else if(/(?:集合|出発|待機|撤収|解散)$/u.test(base)&&field!=='title'){
      // A time and action without a subject can be a schedule or an order.
      // Use the neutral announcement and retain that distinction.
      const role=speakerRole(base);
      polite=base+(role==='speaker'?'いたします':role==='other'?'します':'です')+(question?'か':'');
    }
    else if(/よろしく$/u.test(base)&&!question)polite=base+'お願いいたします';
    else if(/を頼む$/u.test(base)&&speakerRole(base)==='neutral'&&!question)polite=base.slice(0,-2)+'お願いいたします';
    else if(/^(?:ない|無い)$|[がは](?:全く|まだ|もう)?(?:ない|無い)$/u.test(base))polite=base.replace(/(?:ない|無い)$/u,'ありません')+(question?'か':'');
    else if(/(?:て|で)くれ(?:る|ない)?$/u.test(base)&&['neutral','listener'].includes(speakerRole(base))&&(/くれ$/u.test(base)||question)){
      const explicitlyAddressed=speakerRole(base)==='listener',negated=/くれない$/u.test(base);
      polite=base.replace(/くれ(?:る|ない)?$/u,(explicitlyAddressed?'ください':'いただけ')+(negated?'ませんか':'ますか'));
    }
    else if(/てもいい$/u.test(base)&&question)polite=base.replace(/てもいい$/u,'てもよろしいでしょうか');
    else if(/(?:て|で)ほしい$/u.test(base)&&!question)polite=base+'です';
    else if(/(?:て|で)ほしくない$/u.test(base))polite=base.slice(0,-2)+'ありません'+(question?'か':'');
    else if(/(?:て|で)る$/u.test(base))polite=base.slice(0,-1)+'います'+(question?'か':'');
    else if(/(?:じゃ|では)なかった$/u.test(base))polite=base.replace(/(?:じゃ|では)なかった$/u,'ではありませんでした')+(question?'か':'');
    else if(/(?:ん|の)じゃない$/u.test(base))polite=null;
    else if(/(?:じゃ|では)ない$/u.test(base))polite=base.replace(/(?:じゃ|では)ない$/u,'ではありません')+(question?'か':'');
    else if(/(?:だった|でした)$/u.test(base))polite=base.replace(/だった$/u,'でした')+(question?'か':'');
    else if(/だ$/u.test(base)){
      polite=rewritePredicate(base,question,intent);
      if(!polite&&!/いだ$/u.test(base))polite=(/んだ$/u.test(base)?base.slice(0,-2)+'のです':base.slice(0,-1)+'です')+(question?'か':'');
    }
    else if(/(?:予定|つもり|準備中|検討中|連絡済み|大丈夫|必要|可能|無理|了解|不足|完了|本当)$/u.test(base)||question&&nominalQuestion.test(base))polite=base+'です'+(question?'か':'');
    else if(adjectives.some(adj=>base.endsWith(adj)))polite=base+'です'+(question?'か':'');
    else if(/くない$/u.test(base))polite=base.slice(0,-2)+'ありません'+(question?'か':'');
    else if(/くなかった$/u.test(base))polite=base.slice(0,-4)+'ありませんでした'+(question?'か':'');
    else polite=rewritePredicate(base,question,intent);
    if(confirmation&&polite&&/(?:です|ます|ません|でした|ました)$/u.test(polite))polite+='よね';
  }
  return {text:white[1]+(polite||text)+white[3],unresolved:!polite&&field!=='title'};
}
export function honorificText(value,{field='body'}={}){
  const source=String(value??'');if(!source.trim())return source;
  if(/^(?:「[\s\S]*」|『[\s\S]*』)とお伝えいたします。$/u.test(source))return source;
  const literal=protect(source);
  const quoted=value=>{
    const text=value.trim();
    if(/^(?:「[\s\S]*」|『[\s\S]*』|“[\s\S]*”|"[\s\S]*"|`[\s\S]*`)$/u.test(text))return text+'とお伝えいたします。';
    return text.includes('「')||text.includes('」')?'『'+text+'』とお伝えいたします。':'「'+text+'」とお伝えいたします。';
  };
  const rewritten=literal.masked.replace(/([^。！？!?\n]+)([。！？!?]*|$)/gu,(whole,raw,punctuation)=>{
    const clause=rewriteClause(raw,punctuation,field);if(typeof clause==='string')return clause+punctuation;
    if(clause.unresolved){
      const leading=raw.match(/^\s*/u)[0],trailing=raw.match(/\s*$/u)[0];
      return leading+quoted(literal.restore(raw.slice(leading.length)+punctuation))+(punctuation?'':trailing);
    }
    return clause.text+punctuation;
  });
  const output=literal.restore(rewritten);
  // Raw-input caps still apply at ingress. Prevent pathological repetition of
  // short requests from expanding a full-length message beyond storage limits.
  if(output.length>source.length*2+24&&source.length>100)return quoted(source);
  return output;
}
