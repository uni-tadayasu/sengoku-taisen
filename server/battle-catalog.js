/* One canonical battle catalogue shared by the event planner and the client.
 * Historical names are scenario inspirations; stages and victory conditions
 * are game rules, not a historical reenactment or a claim of historical outcome.
 */
(function(root){
 'use strict';
 const historical=[
  ['oninn','応仁の乱','plain'],['funada','船田合戦','river'],
  ['mikatagahara','三方ヶ原の戦い','plain'],
  ['nagashino','長篠の戦い','plain'],['kawanakajima','川中島の戦い','river'],
  ['okehazama','桶狭間の戦い','forest'],['inogahara','稲生の戦い','plain'],
  ['anezaki','姉川の戦い','river'],['kanegasaki','金ヶ崎の戦い','mountain'],
  ['ishiyama','石山合戦','castle'],['nagashima','長島一向一揆','river'],
  ['otaihara','小田井原の戦い','plain'],['uedahara','上田原の戦い','plain'],
  ['shiojiritoge','塩尻峠の戦い','mountain'],['tobe','砥石崩れ','mountain'],
  ['kawagoe','河越夜戦','night'],['konodai','国府台の戦い','river'],
  ['mimasetoge','三増峠の戦い','mountain'],['surugadai','駿河侵攻','coast'],
  ['tedorigawa','手取川の戦い','river'],
  ['otatenoran','御館の乱','castle'],['yamazaki','山崎の戦い','mountain'],
  ['shizugatake','賤ヶ岳の戦い','mountain'],['komakinagakute','小牧・長久手の戦い','forest'],
  ['ueda1','第一次上田合戦','castle'],['ueda2','第二次上田合戦','castle'],
  ['odawara','小田原征伐','castle',true],['oshijo','忍城の戦い','river'],
  ['sekigahara','関ヶ原の戦い','plain',true],['fushimi','伏見城の戦い','castle'],
  ['otsu','大津城の戦い','castle'],['gifu','岐阜城の戦い','mountain'],
  ['osaka_winter','大坂冬の陣','castle'],['osaka_summer','大坂夏の陣','plain',true],
  ['itsukushima','厳島の戦い','coast'],['gassantoda','月山富田城の戦い','mountain'],
  ['koriyama','吉田郡山城の戦い','mountain'],['oshikibata','折敷畑の戦い','mountain'],
  ['mimikawa','耳川の戦い','river'],
  ['okitanawate','沖田畷の戦い','river'],['okuchi','大口の戦い','mountain'],
  ['kizakihara','木崎原の戦い','plain'],['takajo','高城の戦い','castle'],
  ['hetsugigawa','戸次川の戦い','river'],['nezaka','根白坂の戦い','mountain'],
  ['iwatsurugi','岩剣城の戦い','mountain'],['iwaya','岩屋城の戦い','mountain'],
  ['suriagehara','摺上原の戦い','plain'],
  ['hitotoribashi','人取橋の戦い','river'],['osaki','大崎合戦','snow'],
  ['hasedo','長谷堂城の戦い','mountain'],['kitano','慶長出羽合戦','snow'],
  ['kunohe','九戸政実の乱','castle'],['tenmokuzan','天目山の戦い','mountain'],
  ['kizugawaguchi','木津川口の戦い','coast']
 ].map(([id,name,themeId,unificationEligible=false])=>Object.freeze({id:'history:'+id,name,category:'historical',themeId,unificationEligible,
  description:unificationEligible?'天下分け目のシナリオ。全3戦場の勝利と最終戦果目標の達成で、幕府開設権を獲得。':'合戦を題材にした3戦場のイベント。戦闘ごとの報酬と累計戦果の報酬を獲得。'}));
 // These scenarios have a specific castle represented on the game map.
 // Field battles and battles for a region do not inherit the nearest garrison.
 const historicalCastles={
  'history:nagashino':'nagashino','history:kawagoe':'kawagoe',
  'history:ueda1':'ueda','history:ueda2':'ueda','history:odawara':'odawara',
  'history:oshijo':'oshi','history:gifu':'inabayama',
  'history:osaka_winter':'osaka','history:osaka_summer':'osaka',
  'history:gassantoda':'gassan','history:koriyama':'yoshida','history:kunohe':'kunohe'
 };
 const castleAliases={
  inabayama:['岐阜城'],kiyosu:['清須城'],
  yoshida:['郡山城','安芸郡山城'],yamato_koriyama:['郡山城'],
  takamatsu:['高松城'],sanuki_takamatsu:['讃岐高松城']
 };
 function normalizeTitle(name){
  return typeof name==='string'?name.normalize('NFKC').replace(/\s/gu,'').replace(/[ヶヵケ]/gu,'ケ')
   .replace(/^第1次/u,'第一次').replace(/^第2次/u,'第二次').replace(/^大阪/u,'大坂').replace(/^河越/u,'川越'):'';
 }
 function targetCastleId(plan,data=root.SENGOKU_DATA){
  const castles=Array.isArray(data?.castles)?data.castles:[];
  const id=typeof plan==='string'?(plan.includes(':')?plan:null):plan?.battleId??plan?.battle?.id??plan?.id;
  if(id!=null){
   if(typeof id!=='string'||(plan?.battle?.id!=null&&plan.battle.id!==id))return null;
   const target=id.startsWith('castle:')?id.slice(7):Object.hasOwn(historicalCastles,id)?historicalCastles[id]:null;
   return target&&castles.some(c=>c.id===target)?target:null;
  }
  // Free-text plans predate catalogue IDs. Match the whole Japanese title.
  const title=normalizeTitle(typeof plan==='string'?plan:plan?.name);
  if(!title)return null;
  const scenario=historical.find(b=>normalizeTitle(b.name)===title);
  const historicalId=scenario?targetCastleId(scenario,data):null;
  if((scenario&&!historicalId)||!title.endsWith('の戦い'))return historicalId;
  const place=title.slice(0,-3);
  if(!place)return null;
  const matches=castles.filter(c=>[c.name,...(Object.hasOwn(castleAliases,c.id)?castleAliases[c.id]:[])].some(label=>{
   const full=normalizeTitle(label);
   return place===full||place===full.replace(/(?:御所|御坊|館|城)$/u,'');
  }));
  const candidates=new Set(matches.map(c=>c.id));
  if(historicalId)candidates.add(historicalId);
  return candidates.size===1?candidates.values().next().value:null;
 }
 function list(data=root.SENGOKU_DATA){
  const castles=Array.isArray(data?.castles)?data.castles:[],roaming=Array.isArray(data?.roaming?.encounters)?data.roaming.encounters:[];
  return [...historical,...castles.map(c=>({id:'castle:'+c.id,name:c.name+'の戦い',category:'castle',themeId:'castle',unificationEligible:false,description:c.province+'の'+c.name+'を舞台にした城攻め。戦闘報酬と累計戦果の報酬を獲得。'})),...roaming.map(r=>({id:'roaming:'+r.id,name:r.name,category:'roaming',themeId:({森:'forest',川辺:'river',峠:'mountain',丘陵:'mountain'})[r.terrain]||'plain',unificationEligible:false,description:r.description}))].map(v=>({...v}));
 }
 const api=Object.freeze({version:1,list,get:(id,data)=>list(data).find(v=>v.id===id)||null,targetCastleId});
 root.SengokuBattleCatalog=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
