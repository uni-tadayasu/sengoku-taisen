/* Kyoto court: server-authorized admission and private audiences. */
(function(global){
'use strict';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const copy=value=>JSON.parse(JSON.stringify(value)),num=value=>Math.max(0,Math.floor(Number(value)||0)).toLocaleString('ja-JP');
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,150}$/.test(value),threadId=value=>typeof value==='string'&&/^ca_[a-f0-9]{32}$/.test(value);
const cleanText=(value,max)=>typeof value==='string'?value.slice(0,max):'';
const normalized=(value,max)=>String(value??'').normalize('NFC').trim().slice(0,max);
const fallbackRequirement={rankId:'court-7',rankName:'従五位',minScore:35000};
const mounts=new Set();
const sections={overview:'御所案内',negotiations:'武家との交渉',chat:'御所の談話',audiences:'拝謁',management:'朝廷の役職'};
const officeTitles=Object.freeze({sangi:'参議',chunagon:'中納言',dainagon:'大納言',naidaijin:'内大臣',udaijin:'右大臣',sadaijin:'左大臣'});
const nobleHouses=Object.freeze({konoe:'近衛家',kujo:'九条家',ichijo:'一条家',nijo:'二条家',takatsukasa:'鷹司家'});
const nobleHouseId=value=>typeof value==='string'&&Object.hasOwn(nobleHouses,value);
const membershipHouse=s=>nobleHouseId(s.info?.lineage?.houseId)?s.info.lineage.houseId:s.drafts.houseId;
const courtTerm=value=>typeof value==='string'&&value.length>0&&value.length<=150&&!/[\u0000-\u001f\u007f]/u.test(value);
const imperialName=value=>typeof value==='string'&&!/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value)?value.normalize('NFKC').trim():'';
const validImperialName=value=>typeof value==='string'&&value===imperialName(value)&&[...value].length>=2&&[...value].length<=20&&!/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value);
const isLineage=value=>['house','imperial-house'].includes(value?.kind);
const negotiationResources=Object.freeze({gold:'金銭',rice:'兵糧',wood:'木材',stone:'石材'}),negotiationActions=['propose','counter','accept','reject','cancel'];
const negotiationId=value=>typeof value==='string'&&/^cn_[a-f0-9]{32}$/.test(value),isNegotiation=value=>value?.kind==='negotiation';
const negotiationTime=value=>Number.isSafeInteger(value)&&value>=0&&Number.isFinite(new Date(value).getTime());
const negotiationDrafts=()=>({negotiationTarget:'',negotiationGold:'',negotiationRice:'',negotiationWood:'',negotiationStone:''});
const negotiationField=key=>'negotiation'+key[0].toUpperCase()+key.slice(1);
function cleanNegotiationOffer(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==4||Object.keys(negotiationResources).some(key=>!Number.isSafeInteger(value[key])||value[key]<0||value[key]>1000000)||!Object.values(value).some(amount=>amount>0))throw Error('交渉の対価を確認できませんでした。各資源は0〜1,000,000、1種類以上を1以上にしてください。');
 return Object.fromEntries(Object.keys(negotiationResources).map(key=>[key,value[key]]));
}
function negotiationOffer(drafts){try{return cleanNegotiationOffer(Object.fromEntries(Object.keys(negotiationResources).map(key=>{const value=drafts[negotiationField(key)];return[key,value===''?0:/^\d{1,7}$/.test(value)?Number(value):NaN];})));}catch{return null;}}
const sameNegotiationOffer=(a,b)=>!!a&&!!b&&Object.keys(negotiationResources).every(key=>a[key]===b[key]);
function cleanNegotiation(value,owner){
 const person=(row,lord)=>{if(!row||!id(row.id)||typeof row.name!=='string'||!row.name||row.name.length>100)return null;if(lord){if(row.houseName!==null&&(typeof row.houseName!=='string'||!row.houseName||row.houseName.length>80)||row.imperialHouseName!=null&&(typeof row.imperialHouseName!=='string'||!row.imperialHouseName||[...row.imperialHouseName].length>20))return null;return{id:row.id,name:row.name,houseName:row.houseName,imperialHouseName:row.imperialHouseName||null};}if(typeof row.clan!=='string'||row.clan.length>80)return null;return{id:row.id,name:row.name,clan:row.clan};};
 const lord=person(value?.lord,true),warrior=person(value?.warrior,false),permissions=['canAccept','canCounter','canReject','canCancel'];
 if(!value||!negotiationId(value.id)||!Number.isSafeInteger(value.revision)||value.revision<1||!['pending','accepted','rejected','cancelled'].includes(value.status)||!lord||!warrior||lord.id===warrior.id||![lord.id,warrior.id].includes(owner)||![lord.id,warrior.id].includes(value.offeredBy)||!negotiationTime(value.createdAt)||!negotiationTime(value.updatedAt)||new Date(value.updatedAt).getTime()<new Date(value.createdAt).getTime()||permissions.some(key=>typeof value[key]!=='boolean')||value.status!=='pending'&&permissions.some(key=>value[key])||value.offeredBy===owner&&['canAccept','canCounter','canReject'].some(key=>value[key])||value.offeredBy!==owner&&value.canCancel||value.reason!=null&&(typeof value.reason!=='string'||value.reason.length>1500))throw Error('交渉の相手・条件・操作権限を確認できませんでした。');
 return{id:value.id,revision:value.revision,status:value.status,lord,warrior,offer:cleanNegotiationOffer(value.offer),offeredBy:value.offeredBy,createdAt:value.createdAt,updatedAt:value.updatedAt,...Object.fromEntries(permissions.map(key=>[key,value[key]])),reason:cleanText(value.reason,1500)};
}
function cleanNegotiationDirectory(value,owner){
 const rules=value?.rules;if(value?.ok!==true||!Array.isArray(value.negotiations)||value.negotiations.length>20||typeof value.canPropose!=='boolean'||value.nextCursor!==null&&(typeof value.nextCursor!=='string'||!/^[A-Za-z0-9_-]{1,512}$/.test(value.nextCursor))||!rules||!Array.isArray(rules.resources)||rules.resources.length!==4||new Set(rules.resources).size!==4||Object.keys(negotiationResources).some(key=>!rules.resources.includes(key))||rules.maxAmount!==1000000||rules.balanceLimit!==100000000||rules.maxPending!==20)throw Error('武家との交渉一覧を確認できませんでした。');
 const rows=value.negotiations.map(row=>cleanNegotiation(row,owner));if(new Set(rows.map(row=>row.id)).size!==rows.length)throw Error('交渉一覧の受付番号が重複しています。');return{rows,canPropose:value.canPropose,nextCursor:value.nextCursor};
}
function cleanNegotiationRecipient(value,owner,target){
 const row=value?.player;if(value?.ok!==true||typeof value.eligible!=='boolean'||!row||!id(row.id)||row.id!==target||row.id===owner||typeof row.name!=='string'||!row.name||row.name.length>100||typeof row.clan!=='string'||row.clan.length>80||value.reason!=null&&(typeof value.reason!=='string'||value.reason.length>1500))throw Error('交渉相手を確認できませんでした。領主のプロフィールから選び直してください。');
 return{player:{id:row.id,name:row.name,clan:row.clan},eligible:value.eligible,reason:cleanText(value.reason,1500)};
}
function negotiationReviewCurrent(s,c){
 if(!isNegotiation(c))return false;
 if(c.action==='propose')return s.canPropose===true&&s.negotiationRecipient?.eligible===true&&s.negotiationRecipient.player.id===c.warrior.id&&s.drafts.negotiationTarget===c.warrior.id&&sameNegotiationOffer(negotiationOffer(s.drafts),c.offer);
 const row=s.negotiation?.id===c.negotiationId?s.negotiation:s.negotiations.find(row=>row.id===c.negotiationId),permission={counter:'canCounter',accept:'canAccept',reject:'canReject',cancel:'canCancel'}[c.action];
 return !!row&&row.status==='pending'&&row[permission]===true&&row.revision===c.proposalRevision&&row.lord.id===c.lord.id&&row.warrior.id===c.warrior.id&&row.offeredBy===c.offeredBy&&sameNegotiationOffer(row.offer,c.previousOffer)&&(c.action!=='counter'||sameNegotiationOffer(negotiationOffer(s.drafts),c.offer));
}
function cleanNegotiationResult(value,pending,owner){
 if(value?.ok!==true||typeof value.idempotent!=='boolean')throw Error('交渉の受付結果を確認できません。同じ受付番号で確認してください。');
 const row=cleanNegotiation(value.negotiation,owner),receipt=value.receipt,c=pending.review,expectedRevision=pending.action==='propose'?1:pending.data.proposalRevision+1,expectedStatus={propose:'pending',counter:'pending',accept:'accepted',reject:'rejected',cancel:'cancelled'}[pending.action];
 if(!receipt||receipt.requestId!==pending.data.requestId||receipt.action!==pending.action||receipt.negotiationId!==row.id||pending.action!=='propose'&&row.id!==c.negotiationId||receipt.revision!==expectedRevision||row.revision<receipt.revision||receipt.lordId!==c.lord.id||receipt.warriorId!==c.warrior.id||row.lord.id!==c.lord.id||row.warrior.id!==c.warrior.id||!sameNegotiationOffer(cleanNegotiationOffer(receipt.offer),c.offer)||row.revision===receipt.revision&&(row.status!==expectedStatus||!sameNegotiationOffer(row.offer,receipt.offer)||row.offeredBy!==(['propose','counter'].includes(pending.action)?owner:c.offeredBy)))throw Error('交渉の相手・対価・受付結果が確認した内容と一致しません。同じ受付番号で確認してください。');
 return{negotiation:row,receipt:{requestId:receipt.requestId,negotiationId:row.id,action:receipt.action,revision:receipt.revision,lordId:receipt.lordId,warriorId:receipt.warriorId,offer:cleanNegotiationOffer(receipt.offer)}};
}
const cleanJurisdiction=(title,value)=>Object.values(officeTitles).includes(title)&&['kyoto','external'].includes(value)?value:null;
function cleanOfficePerson(value){
 if(!value||!id(value.id))return null;
 const held=value.officeId;if(held!=null&&!Object.hasOwn(officeTitles,held))return null;
 return{id:value.id,name:cleanText(value.name,80)||'領主',homeCastleId:cleanText(value.homeCastleId,80),homeCastleName:cleanText(value.homeCastleName,80)||'拠点を確認中',courtOffice:held?{id:held,title:officeTitles[held]}:null};
}
function cleanOffices(value){
 if(value?.ok!==true||value.canManage!==true||!Number.isSafeInteger(value.revision)||value.revision<0||!Array.isArray(value.offices)||!Array.isArray(value.candidates))throw Error('太政官の任命状況を確認できませんでした。');
 const chancellor=cleanOfficePerson(value.chancellor),seen=new Set(),offices=[];
 if(!chancellor||value.chancellor.fixed!==true)throw Error('太政大臣の在任情報を確認できませんでした。');
 for(const row of value.offices){
  if(!row||!Object.hasOwn(officeTitles,row.id)||seen.has(row.id))throw Error('太政官の役職一覧を確認できませんでした。');
  const holder=cleanOfficePerson(row.holder);if(row.holder&&!holder)throw Error('太政官の在任情報を確認できませんでした。');
  seen.add(row.id);offices.push({id:row.id,title:officeTitles[row.id],blockedByKyoto:row.blockedByKyoto===true,holderJurisdiction:holder?(row.holderJurisdiction==='kyoto'||row.holder?.officeJurisdiction==='kyoto'?'kyoto':'external'):null,available:row.available===true&&row.blockedByKyoto!==true&&!holder,holder});
 }
 if(seen.size!==Object.keys(officeTitles).length)throw Error('太政官の役職一覧を確認できませんでした。');
 return{revision:value.revision,chancellor:{id:chancellor.id,name:chancellor.name,title:'太政大臣',fixed:true},offices,candidates:value.candidates.slice(0,50).map(cleanOfficePerson).filter(Boolean),query:cleanText(value.query,80),hasMore:value.hasMore===true};
}
function cleanRegentPerson(value){
 if(!value||!id(value.id)||typeof value.name!=='string'||!value.name||typeof value.isStaff!=='boolean'||value.homeCastleId!=null&&!id(value.homeCastleId)||value.homeCastleName!=null&&typeof value.homeCastleName!=='string')return null;
 return{id:value.id,name:cleanText(value.name,80),isStaff:value.isStaff,homeCastleId:value.homeCastleId||null,homeCastleName:cleanText(value.homeCastleName,80)||(value.isStaff?'京都御所':'現在の拠点'),appointedAt:Number.isSafeInteger(value.appointedAt)?value.appointedAt:null};
}
function cleanRegent(value){
 if(value?.ok!==true||value.canManage!==true||!Number.isSafeInteger(value.revision)||value.revision<0||!Array.isArray(value.candidates)||value.candidates.length>50)throw Error('摂政の任命状況を確認できませんでした。');
 const holder=value.holder==null?null:cleanRegentPerson(value.holder),candidates=value.candidates.map(cleanRegentPerson);
 if(value.holder!=null&&(!holder||holder.appointedAt==null||holder.appointedAt<0)||candidates.some(row=>!row)||new Set(candidates.map(row=>row.id)).size!==candidates.length||holder&&candidates.some(row=>row.id===holder.id))throw Error('摂政の在任情報と候補を確認できませんでした。');
 return{revision:value.revision,holder,candidates,query:cleanText(value.query,80),hasMore:value.hasMore===true};
}
function cleanMessage(value){
 if(!value||!id(value.id)||!Number.isSafeInteger(value.seq)||value.seq<0||typeof value.text!=='string')return null;
 const court=value.author?.kind==='court',author=court?{kind:'court',id:null,name:'朝廷',avatarVersion:null,evaluation:null}:{kind:'visitor',id:id(value.author?.id)?value.author.id:null,name:cleanText(value.author?.name,80)||'参内した領主',avatarVersion:/^[a-f0-9]{64}$/.test(value.author?.avatarVersion||'')?value.author.avatarVersion:null,evaluation:value.author?.evaluation||null};
 return{id:value.id,seq:value.seq,text:cleanText(value.text,1000),createdAt:cleanText(value.createdAt,40),author,own:value.own===true};
}
function cleanThread(value){if(!value||!threadId(value.id))return null;return{id:value.id,title:cleanText(value.title,80),status:value.status==='answered'?'answered':'open',createdAt:cleanText(value.createdAt,40),updatedAt:cleanText(value.updatedAt,40),messageCount:Math.max(0,Number(value.messageCount)||0),requester:{id:id(value.requester?.id)?value.requester.id:'',name:cleanText(value.requester?.name,80)||'領主'},canReply:value.canReply===true};}
function cleanPalaceControl(value){
 if(value==null)return null;
 if(value.castleId!=='kyoto_gosho'||!id(value.controller?.id)||typeof value.controller?.name!=='string'||typeof value.governmentName!=='string'||!Number.isSafeInteger(value.controlledAt)||value.controlledAt<0||!Number.isFinite(new Date(value.controlledAt).getTime()))throw Error('京都御所の支配状況を確認できませんでした。');
 return{castleId:'kyoto_gosho',controller:{id:value.controller.id,name:cleanText(value.controller.name,80)},governmentName:cleanText(value.governmentName,160),controlledAt:value.controlledAt};
}
function cleanSuccession(value){
 if(value?.ok!==true||value.canNominate!==true||value.approvalRequired!==true||(typeof value.sourceAppointmentToken!=='string'||!value.sourceAppointmentToken||value.sourceAppointmentToken.length>150)||!Array.isArray(value.candidates)||value.candidates.length>1000)throw Error('後継者の指名状況を確認できませんでした。');
 const seen=new Set(),candidates=value.candidates.map(row=>{
  if(!row||!id(row.id)||seen.has(row.id)||typeof row.name!=='string'||!row.name||typeof row.termId!=='string'||!row.termId||row.termId.length>150||!id(row.homeCastleId)||typeof row.homeCastleName!=='string'||!row.homeCastleName)throw Error('後継者の在任情報を確認できませんでした。');
  seen.add(row.id);return{id:row.id,name:cleanText(row.name,80),termId:row.termId,title:cleanText(row.title,40),imperialHouseName:cleanText(row.imperialHouseName,80),homeCastleId:row.homeCastleId,homeCastleName:cleanText(row.homeCastleName,80)};
 });
 const pending=value.pending===null?null:cleanSuccessionNomination(value.pending),history=cleanSuccessionHistory(value.history);
 if(pending&&pending.status!=='pending'||pending&&history.some(row=>row.id===pending.id)||typeof value.historyHasMore!=='boolean')throw Error('後継者の指名記録を確認できませんでした。');
 return{canNominate:true,sourceAppointmentToken:value.sourceAppointmentToken,candidates,pending,history,historyHasMore:value.historyHasMore,capacity:cleanImperialCapacity(value.capacity),retirementPreview:cleanRetirementDestination(value.retirementPreview)};
}
const successionId=value=>typeof value==='string'&&/^csn_[a-f0-9]{32}$/.test(value);
const successionTime=value=>Number.isSafeInteger(value)&&value>=0&&Number.isFinite(new Date(value).getTime());
const isRetirement=value=>value?.kind==='retirement';
function cleanImperialCapacity(value){
 if(value==null)return null;
 const shared=value.shared,holder=shared?.holder;
 if(!shared||shared.limit!==1||!Number.isSafeInteger(shared.count)||shared.count<0||typeof shared.available!=='boolean'||shared.available!==(shared.count===0)||shared.count===0&&holder!==null||shared.count>0&&(!holder||!id(holder.id)||typeof holder.name!=='string'||!holder.name||holder.name.length>150||!['retired-emperor','cloistered-emperor'].includes(holder.kind)||holder.title!==(holder.kind==='cloistered-emperor'?'法皇':'上皇')))throw Error('上皇・法皇の共通枠を確認できませんでした。');
 const result={shared:{limit:1,count:shared.count,available:shared.available,holder:holder?{id:holder.id,name:cleanText(holder.name,80),kind:holder.kind,title:holder.title}:null}};
 for(const key of ['retired','cloistered']){const seat=value[key],holder=seat?.holder;
  if(!seat||seat.limit!==1||!Number.isSafeInteger(seat.count)||seat.count<0||seat.available!==shared.available||seat.count===0&&holder!==null||seat.count>0&&(!holder||!id(holder.id)||typeof holder.name!=='string'||!holder.name||holder.name.length>150))throw Error('上皇・法皇の在位状況を確認できませんでした。');
  result[key]={limit:1,count:seat.count,available:seat.available,holder:holder?{id:holder.id,name:cleanText(holder.name,80)}:null};
 }
 if(result.retired.count+result.cloistered.count!==shared.count)throw Error('上皇・法皇の共通枠と在位記録が一致しません。');
 return result;
}
function cleanRetirementDestination(value){
 if(value==null)return null;
 if(!['retired-emperor','imperial'].includes(value.kind)||value.title!==(value.kind==='imperial'?'皇族':'上皇'))throw Error('退位後の身分を確認できませんでした。');
 return{kind:value.kind,title:value.title};
}
function cleanRetirement(value){
 const row=value?.retirement;
 if(value?.ok!==true||!row||!['none','imperial','retired-emperor','cloistered-emperor'].includes(row.kind)||typeof row.isRetiredEmperor!=='boolean'||typeof row.isReturnedImperial!=='boolean'||typeof row.isCloisteredEmperor!=='boolean'||typeof row.canOrdain!=='boolean'||typeof row.canRelocate!=='boolean'||typeof row.shogunateIndependent!=='boolean'||!Number.isSafeInteger(row.revision)||row.revision<0||row.reason!=null&&typeof row.reason!=='string')throw Error('退位後の最新の身分を確認できませんでした。');
 const title={none:null,imperial:'皇族','retired-emperor':'上皇','cloistered-emperor':'法皇'}[row.kind];
 if(row.title!==title||row.isRetiredEmperor!==['retired-emperor','cloistered-emperor'].includes(row.kind)||row.isReturnedImperial!==(row.kind==='imperial')||row.isCloisteredEmperor!==(row.kind==='cloistered-emperor'))throw Error('退位後の身分と記録が一致しません。');
 if(row.isRetiredEmperor?(row.canRelocate||row.base?.id!=='sento_gosho'||row.base.name!=='仙洞御所'||row.base.fixed!==true):row.base!=null)throw Error('退位後の本拠を確認できませんでした。');
 if(row.kind!=='none'){
  if(!id(row.successionId)||!successionTime(row.retiredAt)||row.shogunateIndependent!==row.isRetiredEmperor||row.canOrdain&&row.kind!=='retired-emperor')throw Error('退位と出家の記録を確認できませんでした。');
  if(row.isCloisteredEmperor?(!successionTime(row.ordainedAt)||row.ordainedAt<row.retiredAt||row.canOrdain):row.ordainedAt!==null)throw Error('退位と出家の記録を確認できませんでした。');
 }else if(row.canOrdain||row.canRelocate||row.shogunateIndependent||row.successionId!==null||row.retiredAt!==null||row.ordainedAt!==null)throw Error('退位と出家の記録を確認できませんでした。');
 return{kind:row.kind,isReturnedImperial:row.isReturnedImperial,isRetiredEmperor:row.isRetiredEmperor,isCloisteredEmperor:row.isCloisteredEmperor,title:row.title,canOrdain:row.canOrdain,revision:row.revision,successionId:row.successionId,retiredAt:row.retiredAt,ordainedAt:row.ordainedAt,canRelocate:row.canRelocate,base:row.isRetiredEmperor?{id:'sento_gosho',name:'仙洞御所',fixed:true}:null,shogunateIndependent:row.shogunateIndependent,reason:cleanText(row.reason,400),capacity:cleanImperialCapacity(row.capacity||value.capacity)};
}
function cleanRetirementResult(value,pending){
 const retirement=cleanRetirement(value),receipt=value.receipt;
 if(typeof value.idempotent!=='boolean'||!receipt||receipt.requestId!==pending.data.requestId||receipt.action!=='ordain'||receipt.successionId!==pending.data.successionId||receipt.revision!==pending.data.expectedRevision+1||!successionTime(receipt.ordainedAt)||receipt.title!=='法皇'||!value.idempotent&&(!retirement.isCloisteredEmperor||retirement.successionId!==receipt.successionId||retirement.revision!==receipt.revision||retirement.ordainedAt!==receipt.ordainedAt))throw Error('出家の受付結果が確認した内容と一致しません。同じ受付番号で再確認してください。');
 return retirement;
}
const successionKinds=new Set(['succession','succession-review','succession-cancel','succession-legacy']);
const isSuccession=value=>successionKinds.has(value?.kind);
function cleanSuccessionNomination(value){
 const person=row=>row&&id(row.id)&&typeof row.name==='string'&&row.name&&row.name.length<=150?{id:row.id,name:cleanText(row.name,80)}:null;
 const emperor=person(value?.emperor),successor=person(value?.successor),resolvedBy=value?.resolvedBy==null?null:person(value.resolvedBy);
 if(!value||!successionId(value.id)||!['pending','approved','rejected','cancelled','invalidated'].includes(value.status)||!Number.isSafeInteger(value.revision)||value.revision<0||!emperor||!successor||emperor.id===successor.id||!successionTime(value.nominatedAt)||value.status==='pending'&&(value.revision!==0||value.resolvedAt!==null||value.resolvedBy!==null)||value.status!=='pending'&&(value.revision<1||!successionTime(value.resolvedAt)||value.resolvedAt<value.nominatedAt)||['approved','rejected','cancelled'].includes(value.status)&&!resolvedBy||value.resolvedBy!=null&&!resolvedBy||value.reason!=null&&(typeof value.reason!=='string'||value.reason.length>1500))throw Error('皇位継承の記録を確認できませんでした。');
 return{id:value.id,status:value.status,revision:value.revision,emperor,successor,nominatedAt:value.nominatedAt,resolvedAt:value.resolvedAt,resolvedBy,reason:value.reason==null?null:cleanText(value.reason,1500),retirement:cleanRetirementDestination(value.retirement)};
}
function cleanSuccessionHistory(value){
 if(!Array.isArray(value)||value.length>20)throw Error('皇位継承の履歴を確認できませんでした。');
 const history=value.map(cleanSuccessionNomination);if(history.some(row=>row.status==='pending')||new Set(history.map(row=>row.id)).size!==history.length)throw Error('皇位継承の履歴を確認できませんでした。');return history;
}
function cleanSuccessionReview(value){
 if(value?.ok!==true||value.canApprove!==true||!Array.isArray(value.pending)||value.pending.length>100||typeof value.historyHasMore!=='boolean')throw Error('太政大臣の認証待ち一覧を確認できませんでした。');
 const pending=value.pending.map(cleanSuccessionNomination),history=cleanSuccessionHistory(value.history);
 if(pending.some(row=>row.status!=='pending')||new Set([...pending,...history].map(row=>row.id)).size!==pending.length+history.length)throw Error('皇位継承の認証記録を確認できませんでした。');return{canApprove:true,pending,history,historyHasMore:value.historyHasMore,capacity:cleanImperialCapacity(value.capacity),retirementPreview:cleanRetirementDestination(value.retirementPreview)};
}
function cleanSuccessionResult(value,pending,owner){
 if(value?.ok!==true||typeof value.idempotent!=='boolean'||value.needsSync!==false||value.legacy===true)throw Error('皇位継承の操作結果を確認できませんでした。同じ受付番号で再確認してください。');
 const nomination=cleanSuccessionNomination(value.nomination),receipt=value.receipt,action=pending.kind==='succession'?'nominate':pending.action,expectedStatus={nominate:'pending',approve:'approved',reject:'rejected',cancel:'cancelled'}[action],target=pending.data.targetPlayerId||pending.targetPlayerId;
 if(!expectedStatus||!receipt||receipt.action!==action||receipt.nominationId!==nomination.id||receipt.targetPlayerId!==target||nomination.successor.id!==target||receipt.status!==expectedStatus||!Number.isSafeInteger(receipt.revision)||receipt.revision>(nomination.revision)||receipt.nominatedAt!==nomination.nominatedAt||action==='nominate'&&(receipt.revision!==0||receipt.resolvedAt!==null||nomination.emperor.id!==owner)||action!=='nominate'&&(receipt.nominationId!==pending.nominationId||receipt.revision!==pending.data.expectedRevision+1||!successionTime(receipt.resolvedAt)||receipt.resolvedAt<receipt.nominatedAt||nomination.revision!==receipt.revision||nomination.status!==receipt.status||nomination.resolvedAt!==receipt.resolvedAt||nomination.resolvedBy?.id!==owner)||action==='cancel'&&nomination.emperor.id!==owner)throw Error('皇位継承の操作結果が一致しません。同じ受付番号で再確認してください。');
 if(action==='approve'&&(receipt.retirement!=null||nomination.retirement!=null)){const retirement=cleanRetirementDestination(receipt.retirement);if(!retirement||!nomination.retirement||retirement.kind!==nomination.retirement.kind)throw Error('認証した退位先の身分が一致しません。同じ受付番号で再確認してください。');}
 return{nomination,receipt:{action,nominationId:receipt.nominationId,targetPlayerId:receipt.targetPlayerId,revision:receipt.revision,status:receipt.status,nominatedAt:receipt.nominatedAt,resolvedAt:receipt.resolvedAt}};
}
function cleanMembership(value,{detail=false}={}){
 if(!value||typeof value.isMember!=='boolean'||typeof value.canJoin!=='boolean'||!value.requirement||!Number.isFinite(value.requirement.minScore))throw Error('京都御所の正式加入条件を確認できませんでした。');
 const office=value.inheritedOffice;if(office!=null&&(!Object.hasOwn(officeTitles,office.id)||office.title!==officeTitles[office.id]))throw Error('現在の任命官職を確認できませんでした。');
 const next={isMember:value.isMember,canJoin:value.canJoin&&!value.isMember,reason:cleanText(value.reason,400),inheritedOffice:office?{id:office.id,title:officeTitles[office.id]}:null,requirement:{rankId:cleanText(value.requirement.rankId,40),rankName:cleanText(value.requirement.rankName,40),minScore:value.requirement.minScore}};
 if(!detail)return next;
 const owned=value.ownedCastles;
 if(!Array.isArray(owned)||owned.length>129||!Number.isSafeInteger(value.ownedCastleCount)||value.ownedCastleCount!==owned.length||owned.some(row=>!id(row?.id)||typeof row.name!=='string')||new Set(owned.map(row=>row.id)).size!==owned.length||value.homeCastleId!==null&&!id(value.homeCastleId)||value.expectedRevision!==null&&(!Number.isSafeInteger(value.expectedRevision)||value.expectedRevision<0))throw Error('手放す拠点と最新の保存状態を確認できませんでした。');
 const retained=value.retainedCastles,released=value.releasedCastles,lists=[[retained,value.retainedCastleCount],[released,value.releasedCastleCount]],ownedById=new Map(owned.map(row=>[row.id,row.name]));
 if(lists.some(([rows,count])=>!Array.isArray(rows)||!Number.isSafeInteger(count)||count!==rows.length||rows.length>129||rows.some(row=>!id(row?.id)||typeof row.name!=='string'||ownedById.get(row.id)!==row.name))||retained.length+released.length!==owned.length||new Set([...retained,...released].map(row=>row.id)).size!==owned.length||!['kyoto','retained-base'].includes(value.joinMode)||value.officeAppointmentToken!==null&&!courtTerm(value.officeAppointmentToken)||!id(value.destinationHomeCastleId)||typeof value.destinationHomeCastleName!=='string'||!value.destinationHomeCastleName||value.joinMode==='kyoto'&&value.destinationHomeCastleId!=='kyoto_gosho'||value.joinMode==='retained-base'&&(value.destinationHomeCastleId!==value.homeCastleId||!retained.some(row=>row.id===value.homeCastleId)))throw Error('保持する領地・返還する領地と、加入後の本拠を確認できませんでした。');
 const castles=rows=>rows.map(row=>({id:row.id,name:cleanText(row.name,80)}));
 return{...next,homeCastleId:value.homeCastleId,homeCastleName:cleanText(value.homeCastleName,80),ownedCastleCount:value.ownedCastleCount,ownedCastles:castles(owned),retainedCastleCount:retained.length,retainedCastles:castles(retained),releasedCastleCount:released.length,releasedCastles:castles(released),joinMode:value.joinMode,officeAppointmentToken:value.officeAppointmentToken,destinationHomeCastleId:value.destinationHomeCastleId,destinationHomeCastleName:cleanText(value.destinationHomeCastleName,80),expectedRevision:value.expectedRevision};
}
function cleanLineage(value){
 if(value==null)return null;
 const house=value.houseId,name=value.imperialHouseName,requirement=value.requirement;
 if(![null,'kuge','imperial'].includes(value.class)||house!==null&&!nobleHouseId(house)||value.houseName!==(house===null?null:nobleHouses[house])||name!==null&&!validImperialName(name)||name!==null&&!nobleHouseId(house)||value.class!=='imperial'&&name!==null||typeof value.needsHouseSelection!=='boolean'||value.needsHouseSelection&&house!==null||!Number.isSafeInteger(value.revision)||value.revision<0||value.termId!==null&&!courtTerm(value.termId)||typeof value.canChooseHouse!=='boolean'||typeof value.canCreateImperialHouse!=='boolean'||value.canChooseHouse&&(value.class!=='kuge'||!value.needsHouseSelection||!courtTerm(value.termId))||value.canCreateImperialHouse&&(value.class!=='kuge'||!nobleHouseId(house)||name!==null||!courtTerm(value.termId))||!requirement||requirement.officeId!=='sadaijin'||requirement.officeName!=='左大臣'||!Number.isSafeInteger(requirement.minMerit)||requirement.minMerit<1)throw Error('家柄と宮家の最新状況を確認できませんでした。');
 return{class:value.class,houseId:house,houseName:house===null?null:nobleHouses[house],originalClan:typeof value.originalClan==='string'?cleanText(value.originalClan,80):null,imperialHouseName:name,needsHouseSelection:value.needsHouseSelection,revision:value.revision,termId:value.termId,canChooseHouse:value.canChooseHouse,canCreateImperialHouse:value.canCreateImperialHouse,reason:cleanText(value.reason,400),requirement:{officeId:'sadaijin',officeName:'左大臣',minMerit:requirement.minMerit}};
}
function cleanLineageResult(value,pending){
 const lineage=cleanLineage(value?.lineage),receipt=value?.receipt,choosing=pending.kind==='house',action=choosing?'choose-house':'create-imperial-house';
 if(value?.ok!==true||typeof value.idempotent!=='boolean'||!lineage||!receipt||receipt.requestId!==pending.data.requestId||receipt.action!==action||receipt.houseId!==pending.houseId||receipt.name!==(choosing?null:pending.data.name)||!Number.isSafeInteger(receipt.revision)||receipt.revision!==pending.data.expectedRevision+1||receipt.revision>lineage.revision||lineage.houseId!==receipt.houseId)throw Error('家柄・宮家の受付結果が一致しません。同じ受付番号で再確認してください。');
 return{lineage,receipt:{requestId:receipt.requestId,action,houseId:receipt.houseId,name:receipt.name,revision:receipt.revision}};
}
function cleanInfo(value){
 if(value?.ok!==true||typeof value.eligible!=='boolean'||!value.requirement||!Number.isFinite(value.requirement.minScore))throw Error('参内資格の応答を確認できませんでした。');
 const source=value.palace||{},self=value.self||{},membership=value.membership==null?null:cleanMembership(value.membership),lineage=cleanLineage(value.lineage);
 return{retirement:value.retirement==null?null:cleanRetirement({ok:true,retirement:value.retirement}),membership,lineage,eligible:value.eligible,requirement:{rankId:cleanText(value.requirement.rankId,40),rankName:cleanText(value.requirement.rankName,40),minScore:value.requirement.minScore},evaluation:value.evaluation||null,accessStamp:String(value.accessStamp||''),self:{id:id(self.id)?self.id:'',name:cleanText(self.name,80),title:cleanText(self.title,40),officeJurisdiction:cleanJurisdiction(self.title,self.officeJurisdiction),merit:Math.max(0,Number(self.merit)||0),canRespond:self.canRespond===true,canAppoint:self.canAppoint===true,isCourtEmperor:self.isCourtEmperor===true,isRetiredEmperor:self.isRetiredEmperor===true,isReturnedImperial:self.isReturnedImperial===true,isCloisteredEmperor:self.isCloisteredEmperor===true,canOrdain:self.canOrdain===true,shogunateIndependent:self.shogunateIndependent===true,isCourtRegent:self.isCourtRegent===true,canActForEmperor:self.canActForEmperor===true,canApproveShogunate:self.canApproveShogunate===true,canDevelopEstate:self.canDevelopEstate===true},palace:{id:'kyoto_gosho',name:'京都御所',level:Math.max(1,Math.min(128,Number(source.level)||1)),maxLevel:128,buildings:source.buildings&&typeof source.buildings==='object'?copy(source.buildings):{},jobCount:Math.max(0,Number(source.jobCount)||0),updatedElapsedMs:Number(source.updatedElapsedMs)||0,control:cleanPalaceControl(source.control)},features:{conversation:value.features?.conversation===true,audience:value.features?.audience===true,roster:value.features?.roster===true,eventRoom:value.features?.eventRoom===true,estate:value.features?.estate===true},thresholds:Array.isArray(value.thresholds)?value.thresholds.map(row=>({title:cleanText(row.title,40),minMerit:Math.max(0,Number(row.minMerit)||0)})):[],contentRevision:Number.isSafeInteger(value.contentRevision)?value.contentRevision:0};
}
function createController(options={}){
 const getContext=options.getContext||(()=>global.SengokuSocial?.getCourtContext?.()||{}),request=options.request||((route,args)=>global.SengokuSocial.courtRequest(route,args)),negotiationRequest=options.negotiationRequest||((route,args)=>global.SengokuBridge?.requestCourtNegotiation?global.SengokuBridge.requestCourtNegotiation(route,args):global.SengokuSocial.courtNegotiationRequest(route,args)),now=options.now||Date.now,uuid=options.uuid||(()=>global.crypto.randomUUID());
 const blank=()=>({negotiations:[],negotiationsLoaded:false,negotiationsExpanded:false,negotiationsBox:'active',negotiationsCursor:null,negotiation:null,negotiationId:'',negotiationRecipient:null,negotiationRecipientLoading:false,negotiationCounterRevision:null,canPropose:false,negotiationReceiptMissing:false,info:null,section:sections[options.initialSection]?options.initialSection:'overview',chat:[],chatLoaded:false,threads:[],threadsLoaded:false,nextCursor:null,threadId:'',thread:null,messages:[],hasOlder:false,nextBefore:null,roster:null,leaderTouched:false,succession:null,successionReview:null,retirement:null,regent:null,regentCandidate:null,regentQuery:'',regentLoading:false,offices:null,officeCandidate:null,officeQuery:'',officeLoading:false,drafts:{...negotiationDrafts(),chat:'',title:'',body:'',reply:'',leader:'',successor:'',regentPlayer:'',regentSearch:'',office:'',officePlayer:'',officeSearch:'',houseId:'',imperialName:''},confirmation:null,pending:null,membershipReceiptMissing:false,lineageReceiptMissing:false,sending:false,loading:false,notificationCheck:false,error:'',message:''});
 let state=blank(),identityKey='',generation=0,readSequence=0,lastRead=0,flight=null,disposed=false;
 const storage=options.storage||global.localStorage,successionKey=owner=>'sengoku-court-succession-v1:'+encodeURIComponent(owner);
 function readSuccession(owner){
  try{
   const value=JSON.parse(storage?.getItem(successionKey(owner))||'null');if(!value)return null;
   const validRequest=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,90}$/.test(value);
   if(value.version!==2){if(!id(value.targetPlayerId)||!validRequest(value.requestId))return null;return{kind:'succession-legacy',route:'/court/succession',data:{targetPlayerId:value.targetPlayerId,requestId:value.requestId},clear:['successor']};}
   const data=value.data;if(!isSuccession(value)||value.kind==='succession-legacy'||!validRequest(data?.requestId))return null;
   if(value.kind==='succession'){
    if(value.route!=='/court/succession'||!id(data.targetPlayerId)||typeof data.targetTermId!=='string'||!data.targetTermId||data.targetTermId.length>150||typeof data.sourceAppointmentToken!=='string'||!data.sourceAppointmentToken||data.sourceAppointmentToken.length>150)return null;
    return{kind:'succession',route:value.route,data:{targetPlayerId:data.targetPlayerId,targetTermId:data.targetTermId,sourceAppointmentToken:data.sourceAppointmentToken,requestId:data.requestId},clear:['successor']};
   }
   const cancelling=value.kind==='succession-cancel',action=value.action;
   if(!successionId(value.nominationId)||!id(value.targetPlayerId)||!(cancelling?action==='cancel':['approve','reject'].includes(action))||!Number.isSafeInteger(data.expectedRevision)||data.expectedRevision<0||value.route!==(cancelling?'/court/succession/':'/admin/court/succession/')+value.nominationId+'/'+action)return null;
   return{kind:value.kind,route:value.route,action,nominationId:value.nominationId,targetPlayerId:value.targetPlayerId,data:{expectedRevision:data.expectedRevision,requestId:data.requestId},clear:[]};
  }catch{return null;}
 }
 function saveSuccession(owner,pending){const saved=JSON.stringify({version:2,kind:pending.kind,route:pending.route,...(pending.action?{action:pending.action,nominationId:pending.nominationId,targetPlayerId:pending.targetPlayerId}:{}),data:pending.data});storage?.setItem(successionKey(owner),saved);if(storage?.getItem(successionKey(owner))!==saved)throw Error('皇位継承の操作記録を保存できません。端末の保存設定を確認してください。');}
 function clearSuccession(owner,pending){try{if(readSuccession(owner)?.data.requestId===pending.data.requestId)storage?.removeItem(successionKey(owner));}catch{}}

 const retirementKey=owner=>'sengoku-court-retirement-v1:'+encodeURIComponent(owner);
 function readRetirement(owner){
  try{const saved=JSON.parse(storage?.getItem(retirementKey(owner))||'null'),data=saved?.data;
   if(saved?.version!==1||saved.owner!==owner||!data||!id(data.requestId)||data.requestId.length>90||!id(data.successionId)||!Number.isSafeInteger(data.expectedRevision)||data.expectedRevision<0||data.confirmed!==true)return null;
   return{kind:'retirement',route:'/court/retirement/ordain',data:{requestId:data.requestId,successionId:data.successionId,expectedRevision:data.expectedRevision,confirmed:true},clear:[]};
  }catch{return null;}
 }
 function saveRetirement(owner,pending){const saved=JSON.stringify({version:1,owner,data:pending.data});storage?.setItem(retirementKey(owner),saved);if(storage?.getItem(retirementKey(owner))!==saved)throw Error('出家の受付記録を保存できません。端末の保存設定を確認してください。');}
 function clearRetirement(owner,pending){try{if(readRetirement(owner)?.data.requestId===pending.data.requestId)storage?.removeItem(retirementKey(owner));}catch{}}

 const membershipKey=owner=>'sengoku-court-membership-v1:'+encodeURIComponent(owner);
 function readMembership(owner){
  try{const record=JSON.parse(storage?.getItem(membershipKey(owner))||'null'),data=record?.data,review=record?.review;
   if(![1,2,3].includes(record?.version)||record.owner!==owner||!data||!id(data.requestId)||!id(data.deviceId)||!id(data.expectedHomeCastleId)||!Number.isSafeInteger(data.expectedRevision)||data.expectedRevision<0||data.confirmed!==true||record.version>=2&&!nobleHouseId(data.houseId))return null;
   if(record.version>=2&&(!review||!['kyoto','retained-base'].includes(review.joinMode)||!id(review.destinationHomeCastleId)||review.joinMode==='kyoto'&&review.destinationHomeCastleId!=='kyoto_gosho'||review.joinMode==='retained-base'&&review.destinationHomeCastleId!==data.expectedHomeCastleId||!Number.isSafeInteger(review.retainedCastleCount)||review.retainedCastleCount<0||!Number.isSafeInteger(review.releasedCastleCount)||review.releasedCastleCount<0||review.retainedCastleCount+review.releasedCastleCount>129))return null;
   if(record.version===3&&(data.expectedJoinMode!==review.joinMode||data.expectedOfficeToken!==null&&!courtTerm(data.expectedOfficeToken)))return null;
   return{kind:'membership',route:'/court/membership',data:{requestId:data.requestId,deviceId:data.deviceId,expectedRevision:data.expectedRevision,expectedHomeCastleId:data.expectedHomeCastleId,confirmed:true,...(record.version>=2?{houseId:data.houseId}:{}),...(record.version===3?{expectedJoinMode:data.expectedJoinMode,expectedOfficeToken:data.expectedOfficeToken}:{})},...(record.version>=2?{review:{joinMode:review.joinMode,destinationHomeCastleId:review.destinationHomeCastleId,retainedCastleCount:review.retainedCastleCount,releasedCastleCount:review.releasedCastleCount}}:{}),clear:[],lookup:true};
  }catch{return null;}
 }
 function saveMembership(owner,pending){const saved=JSON.stringify({version:3,owner,data:pending.data,review:pending.review});storage?.setItem(membershipKey(owner),saved);if(storage?.getItem(membershipKey(owner))!==saved)throw Error('正式加入の受付記録を保存できません。端末の保存設定を確認してください。');}
 function clearMembership(owner,pending){try{if(readMembership(owner)?.data.requestId===pending.data.requestId)storage?.removeItem(membershipKey(owner));}catch{}}
 function restartLegacyMembership(){
  const c=identity(),pending=state.pending;
  if(!c.authenticated||state.sending||pending?.kind!=='membership'||nobleHouseId(pending.data.houseId)||!state.membershipReceiptMissing)return false;
  clearMembership(c.owner,pending);state.pending=null;state.confirmation=null;state.membershipReceiptMissing=false;state.error='';state.message='家柄を選び、正式加入の内容をもう一度確認してください。';emit();void load({background:true});return true;
 }
 const lineageKey=owner=>'sengoku-court-lineage-v1:'+encodeURIComponent(owner);
 function readLineage(owner){
  try{
   const record=JSON.parse(storage?.getItem(lineageKey(owner))||'null'),data=record?.data;
   if(record?.version!==1||record.owner!==owner||!isLineage(record)||!nobleHouseId(record.houseId)||!data||!id(data.requestId)||!Number.isSafeInteger(data.expectedRevision)||data.expectedRevision<0||!courtTerm(data.termId)||data.confirmed!==true)return null;
   const choosing=record.kind==='house';if(choosing?data.houseId!==record.houseId:!validImperialName(data.name))return null;
   return{kind:record.kind,route:choosing?'/court/house':'/court/imperial-house',houseId:record.houseId,data:{requestId:data.requestId,expectedRevision:data.expectedRevision,termId:data.termId,confirmed:true,...(choosing?{houseId:data.houseId}:{name:data.name})},clear:choosing?['houseId']:['imperialName'],lookup:true};
  }catch{return null;}
 }
 function saveLineage(owner,pending){const saved=JSON.stringify({version:1,owner,kind:pending.kind,houseId:pending.houseId,data:pending.data});storage?.setItem(lineageKey(owner),saved);if(storage?.getItem(lineageKey(owner))!==saved)throw Error('家柄・宮家の受付記録を保存できません。端末の保存設定を確認してください。');}
 function clearLineage(owner,pending){try{if(readLineage(owner)?.data.requestId===pending.data.requestId)storage?.removeItem(lineageKey(owner));}catch{}}
 const negotiationKey=owner=>'sengoku-court-negotiation-v1:'+encodeURIComponent(owner);
 function readNegotiation(owner){
  try{
   const saved=JSON.parse(storage?.getItem(negotiationKey(owner))||'null'),data=saved?.data,c=saved?.review,action=saved?.action;
   if(saved?.version!==1||saved.owner!==owner||!negotiationActions.includes(action)||!data||!id(data.requestId)||data.requestId.length>90||data.confirmed!==true||!isNegotiation(c)||c.action!==action||c.owner!==owner)return null;
   const proposing=action==='propose',route=proposing?'/court/negotiations':'/court/negotiations/'+c.negotiationId+'/'+action;
   if(saved.route!==route||proposing&&(data.targetPlayerId!==c.warrior?.id||c.lord?.id!==owner)||!proposing&&(!negotiationId(c.negotiationId)||!Number.isSafeInteger(data.proposalRevision)||data.proposalRevision<1||data.proposalRevision!==c.proposalRevision))return null;
   const row=cleanNegotiation({id:proposing?'cn_'+'0'.repeat(32):c.negotiationId,revision:proposing?1:c.proposalRevision,status:'pending',lord:c.lord,warrior:c.warrior,offer:c.previousOffer||c.offer,offeredBy:c.offeredBy,createdAt:0,updatedAt:0,canAccept:false,canCounter:false,canReject:false,canCancel:false,reason:''},owner);
   const offer=cleanNegotiationOffer(c.offer);if(['propose','counter'].includes(action)&&!sameNegotiationOffer(cleanNegotiationOffer(data.offer),offer)||!['propose','counter'].includes(action)&&!sameNegotiationOffer(row.offer,offer)||['accept','counter','reject'].includes(action)&&row.offeredBy===owner||action==='cancel'&&row.offeredBy!==owner)return null;
   return{kind:'negotiation',action,route,data:{requestId:data.requestId,confirmed:true,...(proposing?{targetPlayerId:data.targetPlayerId}:{proposalRevision:data.proposalRevision}),...(['propose','counter'].includes(action)?{offer}:{} )},review:{kind:'negotiation',action,owner,lord:row.lord,warrior:row.warrior,offer,previousOffer:row.offer,offeredBy:row.offeredBy,...(!proposing?{negotiationId:row.id,proposalRevision:row.revision}:{})},lookup:true};
  }catch{return null;}
 }
 function saveNegotiation(owner,pending){const saved=JSON.stringify({version:1,owner,action:pending.action,route:pending.route,data:pending.data,review:pending.review});storage?.setItem(negotiationKey(owner),saved);if(storage?.getItem(negotiationKey(owner))!==saved)throw Error('交渉の受付記録を保存できません。端末の保存設定を確認してください。');}
 function clearNegotiation(owner,pending){try{if(readNegotiation(owner)?.data.requestId===pending.data.requestId)storage?.removeItem(negotiationKey(owner));}catch{}}
 function adoptNegotiation(row){
  const previous=state.negotiation?.id===row.id?state.negotiation:state.negotiations.find(value=>value.id===row.id);if(previous&&previous.revision>row.revision)return previous;
  const visible=state.negotiationsBox==='active'?row.status==='pending':row.status!=='pending';state.negotiations=state.negotiations.filter(value=>value.id!==row.id);if(visible)state.negotiations.push(row);state.negotiations.sort((a,b)=>b.createdAt-a.createdAt||b.id.localeCompare(a.id));if(state.negotiationId===row.id)state.negotiation=row;return row;
 }
 function openNegotiations(targetPlayerId){
  const c=identity();if(!c.authenticated||state.sending||state.pending)return false;if(targetPlayerId!=null&&(!id(targetPlayerId)||targetPlayerId===c.owner))return false;
  readSequence++;flight=null;state.section='negotiations';state.confirmation=null;state.error='';state.message='';state.negotiationId='';state.negotiation=null;state.negotiationCounterRevision=null;
  if(targetPlayerId){state.drafts.negotiationTarget=targetPlayerId;state.negotiationRecipient=null;}
  emit();void load({background:true});return true;
 }
 function openNegotiation(value){
  if(!identity().authenticated||!negotiationId(value)||state.sending||state.pending)return false;
  readSequence++;flight=null;state.section='negotiations';state.negotiationId=value;state.negotiation=state.negotiations.find(row=>row.id===value)||null;state.negotiationCounterRevision=null;state.confirmation=null;state.error='';emit();void load({background:true});return true;
 }
 function selectNegotiationBox(box){
  if(!identity().authenticated||!['active','history'].includes(box)||state.sending||state.pending)return false;
  readSequence++;flight=null;state.negotiationsBox=box;state.negotiations=[];state.negotiationsLoaded=false;state.negotiationsExpanded=false;state.negotiationsCursor=null;state.negotiation=null;state.negotiationId='';state.negotiationCounterRevision=null;state.confirmation=null;state.error='';emit();void load({background:true});return true;
 }
 function backNegotiation(){if(state.sending||state.pending)return false;state.negotiationId='';state.negotiation=null;state.negotiationCounterRevision=null;state.confirmation=null;emit();return true;}
 async function lookupNegotiationRecipient(){
  const c=identity(),target=state.drafts.negotiationTarget;if(!c.authenticated||!state.canPropose||state.sending||state.pending)return false;
  if(!id(target)||target===c.owner){state.error='相手の領主IDを確認してください。自分自身へは交渉を申し込めません。';state.negotiationRecipient=null;emit();return false;}
  const g=generation,key=identityKey,sequence=++readSequence;flight=null;state.loading=false;state.negotiationRecipientLoading=true;state.negotiationRecipient=null;state.confirmation=null;state.error='';emit();const valid=()=>current(g,key)&&sequence===readSequence&&state.drafts.negotiationTarget===target;
  try{const result=await negotiationRequest('/court/negotiations/recipient?playerId='+encodeURIComponent(target),{method:'GET'});if(!valid())return false;state.negotiationRecipient=cleanNegotiationRecipient(result,c.owner,target);return true;}
  catch(error){if(valid())state.error=error.message||'交渉相手を確認できませんでした。';return false;}
  finally{if(current(g,key)&&sequence===readSequence){state.negotiationRecipientLoading=false;emit();}}
 }
 function startCounter(){
  if(!identity().authenticated||state.sending||state.pending||!state.negotiation?.canCounter)return false;state.negotiationCounterRevision=state.negotiation.revision;for(const key of Object.keys(negotiationResources))state.drafts[negotiationField(key)]=String(state.negotiation.offer[key]);state.confirmation=null;state.error='';emit();return true;
 }
 function confirmNegotiation(action){
  const c=identity();if(!c.authenticated||state.sending||state.pending||!negotiationActions.includes(action))return false;
  const row=state.negotiation,proposing=action==='propose',offer=['propose','counter'].includes(action)?negotiationOffer(state.drafts):row?.offer;
  if(!offer){state.error='対価は0〜1,000,000の整数で入力し、1種類以上を1以上にしてください。';emit();return false;}
  let review;
  if(proposing){const recipient=state.negotiationRecipient;if(!state.canPropose||!recipient?.eligible||recipient.player.id!==state.drafts.negotiationTarget)return false;review={kind:'negotiation',action,owner:c.owner,lord:{id:c.owner,name:state.info?.self.name||c.user?.name||'あなた',houseName:state.info?.lineage?.houseName||'公家',imperialHouseName:state.info?.lineage?.imperialHouseName||null},warrior:copy(recipient.player),offer,previousOffer:offer,offeredBy:c.owner};}
  else{const permission={counter:'canCounter',accept:'canAccept',reject:'canReject',cancel:'canCancel'}[action];if(!row||!row[permission]||row.status!=='pending'||action==='counter'&&state.negotiationCounterRevision!==row.revision)return false;review={kind:'negotiation',action,owner:c.owner,negotiationId:row.id,proposalRevision:row.revision,lord:copy(row.lord),warrior:copy(row.warrior),offer,previousOffer:copy(row.offer),offeredBy:row.offeredBy};}
  state.confirmation=review;state.error='';state.message='';emit();return true;
 }
 async function submitNegotiation(resend=false){
  const c=identity();if(!c.authenticated||state.sending||state.pending&&!isNegotiation(state.pending))return false;
  if(!state.pending){
   const review=state.confirmation;if(!negotiationReviewCurrent(state,review)||review.owner!==c.owner){state.error='相手または交渉条件が更新されました。最新の内容を確認し直してください。';state.confirmation=null;emit();return false;}
   const action=review.action,proposing=action==='propose',pending={kind:'negotiation',action,review:copy(review),route:proposing?'/court/negotiations':'/court/negotiations/'+review.negotiationId+'/'+action,data:{requestId:uuid(),confirmed:true,...(proposing?{targetPlayerId:review.warrior.id}:{proposalRevision:review.proposalRevision}),...(['propose','counter'].includes(action)?{offer:copy(review.offer)}:{})},lookup:false};
   try{saveNegotiation(c.owner,pending);}catch(error){state.error=error.message||'交渉の受付記録を保存できませんでした。';emit();return false;}state.pending=pending;
  }
  const pending=state.pending,g=generation,key=identityKey,retry=resend&&state.negotiationReceiptMissing,lookup=pending.lookup===true&&!retry;readSequence++;flight=null;state.loading=false;state.sending=true;state.negotiationRecipientLoading=false;state.negotiationReceiptMissing=false;state.error='';state.message='';emit();
  try{
   const result=await negotiationRequest(pending.route+(lookup?'?receipt=1':''),{method:'POST',data:copy(pending.data)});if(!current(g,key)||state.pending!==pending)return false;
   const accepted=cleanNegotiationResult(result,pending,c.owner);clearNegotiation(c.owner,pending);state.pending=null;state.confirmation=null;state.section='negotiations';state.negotiationCounterRevision=null;state.negotiationId=accepted.negotiation.id;state.negotiation=accepted.negotiation;adoptNegotiation(accepted.negotiation);
   if(['propose','counter'].includes(pending.action))for(const resource of Object.keys(negotiationResources))state.drafts[negotiationField(resource)]='';
   state.message=pending.action==='accept'?'最新の条件で合意し、公家から武家への支払いと主従関係が成立しました。':pending.action==='propose'?'交渉を申し込みました。相手が最新の条件に同意すると、対価の支払いと主従関係が成立します。':pending.action==='counter'?'条件を提示し直しました。前の条件への同意は無効になり、相手の確認を待ちます。':pending.action==='reject'?'交渉を辞退しました。資源は移りません。':'交渉を取り下げました。資源は移りません。';
   if(result.idempotent)state.message=accepted.negotiation.revision>accepted.receipt.revision?'同じ受付の処理結果を確認しました。現在の状態：'+({pending:'交渉中',accepted:'合意成立',rejected:'辞退済み',cancelled:'取り下げ済み'}[accepted.negotiation.status])+'。下に最新の条件を表示しています。':'同じ受付の処理結果を確認しました。'+state.message;
   if(pending.action==='accept')try{Promise.resolve(global.SengokuSocial?.refresh?.()).catch(()=>{});}catch{}
   return true;
  }catch(error){
   if(current(g,key)&&state.pending===pending){pending.lookup=true;state.confirmation=null;if(lookup&&error.code==='COURT_NEGOTIATION_RECEIPT_PENDING')state.negotiationReceiptMissing=true;else if(error.code==='COURT_NEGOTIATION_CONFIRMATION_EXPIRED'||!lookup&&['INVALID_INPUT','COURT_NEGOTIATION_FORBIDDEN','COURT_NEGOTIATION_INELIGIBLE','COURT_NEGOTIATION_CHANGED','COURT_NEGOTIATION_NOT_PENDING','COURT_NEGOTIATION_LIMIT','COURT_NEGOTIATION_DUPLICATE','COURT_NEGOTIATION_NOT_FOUND','INSUFFICIENT_ASSETS','ASSET_LIMIT','COURT_NEGOTIATION_CONFIRMATION_EXPIRED','ACCOUNT_BANNED'].includes(error.code)){clearNegotiation(c.owner,pending);state.pending=null;}
    state.error=error.message||'交渉の結果を確認できませんでした。同じ受付番号で確認してください。';}
   return false;
  }finally{if(current(g,key)){state.sending=false;emit();if(!state.pending)void load({background:true,preserveError:!!state.error});}}
 }
 function confirmLineage(kind){
  const c=identity(),lineage=state.info?.lineage;if(!c.authenticated||state.sending||state.pending||!lineage||!['house','imperial-house'].includes(kind))return false;
  const choosing=kind==='house',houseId=choosing?state.drafts.houseId:lineage.houseId,name=choosing?null:imperialName(state.drafts.imperialName);
  if(choosing?!lineage.canChooseHouse:!lineage.canCreateImperialHouse)return false;
  if(!nobleHouseId(houseId)||!choosing&&!validImperialName(name)){state.error=choosing?'家柄を選んでください。':'宮家名は2〜20文字の1行で入力してください。';emit();return false;}
  state.confirmation={kind,houseId,name,expectedRevision:lineage.revision,termId:lineage.termId};state.error='';state.message='';emit();return true;
 }
 function membershipWriter(){const sync=global.SengokuCloudSync,status=options.getSyncStatus?.()||sync?.getStatus?.(),device=options.getDevice?.()||sync?.getDevice?.();return{ready:status?.linked===true&&status.ready===true,writable:status?.writable===true,revision:status?.revision,deviceId:device?.id};}
 async function confirmMembership(){
  const c=identity();if(!c.authenticated||state.sending||state.pending||!state.info?.membership?.canJoin)return false;
  const houseId=membershipHouse(state);if(!nobleHouseId(houseId)){state.error='加入する家柄を選んでください。';emit();return false;}
  const g=generation,key=identityKey;readSequence++;flight=null;state.loading=false;state.sending=true;state.confirmation=null;state.error='';state.message='現在の拠点と正式加入条件を確認しています。';emit();
  try{
   const prepared=await(options.prepareMembership?options.prepareMembership():global.SengokuCloudSync?.flush?.());
   if(!current(g,key))return false;
   if(!prepared?.ok)throw Error(prepared?.message||'最新の進行を同期してから、正式加入を確認してください。');
   const result=await request('/court/membership',{method:'GET'});if(!current(g,key))return false;
   if(result?.ok!==true)throw Error('正式加入の条件を確認できませんでした。');
   const membership=cleanMembership(result.membership,{detail:true});state.info.membership=cleanMembership(result.membership);
   if(!membership.canJoin)throw Error(membership.reason||'現在は京都御所へ正式加入できません。');
   const writer=membershipWriter();if(!writer.ready||!writer.writable||!id(writer.deviceId)||writer.revision!==membership.expectedRevision||!id(membership.homeCastleId))throw Error('拠点と操作端末の状態が変わりました。最新の進行を同期して、もう一度確認してください。');
   state.confirmation={kind:'membership',...membership,houseId,deviceId:writer.deviceId};state.message='';return true;
  }catch(error){if(current(g,key)){state.message='';state.error=error.message||'正式加入の条件を確認できませんでした。';}return false;}
  finally{if(current(g,key)){state.sending=false;emit();}}
 }

 function context(){const c=getContext()||{},owner=String(c.playerId||c.user?.id||''),authenticated=!!c.user&&String(c.user.id)===owner&&!c.pending&&!c.banned;return{...c,owner,authenticated,key:JSON.stringify([owner,c.epoch||0,c.privilegeEpoch||0,c.accountEpoch||0,!!c.pending,!!c.banned,c.user?.isAdmin===true,c.user?.isStaff===true])};}
 function identity(){const c=context();if(c.key!==identityKey){identityKey=c.key;generation++;readSequence++;lastRead=0;flight=null;state=blank();if(c.authenticated){state.pending=readSuccession(c.owner)||readRetirement(c.owner)||readMembership(c.owner)||readLineage(c.owner)||readNegotiation(c.owner);if(isNegotiation(state.pending))state.section='negotiations';}}return c;}
 const current=(g,key)=>!disposed&&g===generation&&context().key===key;
 function snapshot(){const c=identity();return{...copy(state),context:{owner:c.owner,authenticated:c.authenticated,pending:!!c.pending,banned:!!c.banned,identity:c.key}};}
 const emit=()=>{if(!disposed)options.onChange?.(snapshot());};
 function clearContent(){state.chat=[];state.chatLoaded=false;state.messages=[];state.thread=null;state.threads=[];state.threadsLoaded=false;state.nextCursor=null;state.hasOlder=false;state.nextBefore=null;}
 function contentRevision(value){if(Number.isSafeInteger(value)&&state.info&&state.info.contentRevision!==value){clearContent();state.info.contentRevision=value;}}
 function clearOffices(){state.offices=null;state.officeCandidate=null;state.officeQuery='';state.officeLoading=false;for(const field of ['office','officePlayer','officeSearch'])state.drafts[field]='';if(state.confirmation?.kind==='office')state.confirmation=null;}
 function clearRegent(){state.regent=null;state.regentCandidate=null;state.regentQuery='';state.regentLoading=false;state.drafts.regentPlayer='';state.drafts.regentSearch='';if(state.confirmation?.kind==='regent')state.confirmation=null;}
 function clearPrivate(){const recovery=isSuccession(state.pending)||isRetirement(state.pending)||isLineage(state.pending)||isNegotiation(state.pending)||state.pending?.kind==='membership'?state.pending:null;const negotiations=Object.fromEntries(Object.keys(negotiationDrafts()).map(key=>[key,state.drafts[key]]));clearContent();state.threadId='';state.roster=null;state.leaderTouched=false;state.succession=null;state.successionReview=null;state.retirement=null;clearOffices();clearRegent();state.drafts={...negotiations,chat:'',title:'',body:'',reply:'',leader:'',successor:'',regentPlayer:'',regentSearch:'',office:'',officePlayer:'',officeSearch:'',houseId:'',imperialName:''};if(!isNegotiation(state.confirmation))state.confirmation=null;state.pending=recovery;}
 function allowed(section){const info=state.info;return section==='overview'||section==='negotiations'&&context().authenticated||!state.notificationCheck&&info?.eligible&&(section==='chat'?info.features.conversation:section==='audiences'?info.features.audience:section==='management'&&info.features.roster);}
 function adoptInfo(value){const next=cleanInfo(value);if(next.lineage&&next.self.id!==context().owner)throw Error('家柄を確認する領主の情報が一致しません。');if(state.info&&state.info.accessStamp!==next.accessStamp)clearPrivate();else if(state.info&&state.info.contentRevision!==next.contentRevision)clearContent();if(!next.eligible)clearPrivate();if(!next.self.canAppoint){clearOffices();clearRegent();state.successionReview=null;if(state.confirmation?.kind==='succession-review')state.confirmation=null;}if(!next.self.isCourtEmperor){state.succession=null;state.drafts.successor='';if(['succession','succession-cancel'].includes(state.confirmation?.kind))state.confirmation=null;}if(!next.self.isRetiredEmperor&&!next.self.isReturnedImperial){state.retirement=null;if(isRetirement(state.confirmation))state.confirmation=null;}state.info=next;state.notificationCheck=false;if(!allowed(state.section))state.section='overview';}
 function adoptOffices(value){const next=cleanOffices(value);if(state.offices&&next.revision<state.offices.revision)return;state.offices=next;const selected=state.offices.candidates.find(row=>row.id===state.drafts.officePlayer);if(selected)state.officeCandidate=selected;}
 function adoptRegent(value){const next=cleanRegent(value);if(state.regent&&next.revision<state.regent.revision)return;state.regent=next;const selected=next.candidates.find(row=>row.id===state.drafts.regentPlayer);if(selected)state.regentCandidate=selected;if(next.holder?.id===state.drafts.regentPlayer){state.regentCandidate=null;state.drafts.regentPlayer='';}}
 function absorbMessages(rows,prior=[],limit=200){const combined=new Map(prior.map(row=>[row.id,row]));for(const value of rows||[]){const row=cleanMessage(value);if(row)combined.set(row.id,row);}const result=[...combined.values()].sort((a,b)=>a.seq-b.seq);return limit?result.slice(-limit):result;}
 async function load({background=false,more=false,older=false,preserveError=false}={}){
  const c=identity();if(!c.authenticated){emit();return false;}if(state.sending)return false;
  const g=generation,key=identityKey,sequence=++readSequence;state.loading=!background||!state.info;const section=state.section,requestedThread=state.threadId;emit();
  const valid=()=>current(g,key)&&sequence===readSequence;
  const task=(async()=>{try{
   if(section==='negotiations'){
    const box=state.negotiationsBox,requested=state.negotiationId,cursor=more&&state.negotiationsCursor?'&cursor='+encodeURIComponent(state.negotiationsCursor):'',directory=cleanNegotiationDirectory(await negotiationRequest('/court/negotiations?box='+box+'&limit=20'+cursor,{method:'GET'}),c.owner);if(!valid()||state.negotiationsBox!==box)return false;
    const hadRows=state.negotiationsLoaded;if(box==='active'||!background&&!more)state.negotiations=[];if(!background&&!more)state.negotiationsExpanded=false;if(more)state.negotiationsExpanded=true;for(const row of directory.rows)adoptNegotiation(row);state.canPropose=directory.canPropose;state.negotiationsLoaded=true;if(more||!hadRows||!state.negotiationsExpanded)state.negotiationsCursor=directory.nextCursor;
    if(requested){const detail=await negotiationRequest('/court/negotiations/'+requested,{method:'GET'});if(!valid()||state.negotiationId!==requested)return false;if(detail?.ok!==true)throw Error('交渉の内容を確認できませんでした。');const row=cleanNegotiation(detail.negotiation,c.owner);if(row.id!==requested)throw Error('交渉の受付番号が一致しません。');adoptNegotiation(row);}
    const target=state.drafts.negotiationTarget;if(state.canPropose&&!requested&&!state.pending&&id(target)&&target!==c.owner){const recipient=await negotiationRequest('/court/negotiations/recipient?playerId='+encodeURIComponent(target),{method:'GET'});if(!valid())return false;if(state.drafts.negotiationTarget===target)state.negotiationRecipient=cleanNegotiationRecipient(recipient,c.owner,target);}
    if(!preserveError)state.error='';return true;
   }
   const info=await request('/court',{method:'GET'});if(!valid())return false;adoptInfo(info);
   if((state.info.self.isRetiredEmperor||state.info.self.isReturnedImperial||isRetirement(state.pending))&&['overview','management'].includes(section)){const retirement=state.info.retirement?{ok:true,retirement:state.info.retirement}:await request('/court/retirement',{method:'GET'});if(!valid())return false;state.retirement=cleanRetirement(retirement);if(isRetirement(state.confirmation)&&(!state.retirement.canOrdain||state.retirement.revision!==state.confirmation.expectedRevision||state.retirement.successionId!==state.confirmation.successionId))state.confirmation=null;}
   if(state.section!==section||!state.info.eligible&&section!=='negotiations'){state.error='';return true;}
   if(state.info.self.isCourtEmperor&&['overview','management'].includes(section)){const succession=await request('/court/succession',{method:'GET'});if(!valid())return false;state.succession=cleanSuccession(succession);if(state.succession.pending&&state.succession.pending.emperor.id!==c.owner)throw Error('指名した天皇の情報が一致しません。');if(state.drafts.successor&&!state.succession.candidates.some(row=>row.id===state.drafts.successor)){state.drafts.successor='';if(state.confirmation?.kind==='succession')state.confirmation=null;}}
   if(state.info.self.canAppoint&&['overview','management'].includes(section)){const review=await request('/admin/court/succession',{method:'GET'});if(!valid())return false;state.successionReview=cleanSuccessionReview(review);}
   if(section==='chat'){
    const after=state.chat.at(-1)?.seq||0,r=await request('/court/chat?after='+after+'&contentRevision='+state.info.contentRevision+'&limit=50',{method:'GET'});if(!valid())return false;
    if(!Array.isArray(r.messages))throw Error('御所の談話を確認できませんでした。');contentRevision(r.contentRevision);state.chat=absorbMessages(r.messages,r.reset?[]:state.chat);state.chatLoaded=true;
   }else if(section==='audiences'){
    if(requestedThread&&state.threadId===requestedThread){
     const query=older&&state.nextBefore?'?before='+state.nextBefore+'&limit=50':'?limit=50',r=await request('/court/audiences/'+requestedThread+query,{method:'GET'});if(!valid()||state.threadId!==requestedThread)return false;
     const thread=cleanThread(r.thread);if(!thread||!Array.isArray(r.messages))throw Error('拝謁の内容を確認できませんでした。');contentRevision(r.contentRevision);const hadMessages=state.messages.length>0;state.thread=thread;state.messages=absorbMessages(r.messages,state.messages,0);if(older||!hadMessages){state.hasOlder=r.hasOlder===true;state.nextBefore=Number.isSafeInteger(r.nextBefore)?r.nextBefore:null;}
    }else{
     const cursor=more&&state.nextCursor?'&cursor='+encodeURIComponent(state.nextCursor):'',r=await request('/court/audiences?limit=30'+cursor,{method:'GET'});if(!valid())return false;
     if(!Array.isArray(r.threads))throw Error('拝謁の一覧を確認できませんでした。');contentRevision(r.contentRevision);const rows=r.threads.map(cleanThread).filter(Boolean);state.threads=[...new Map([...(more?state.threads:[]),...rows].map(t=>[t.id,t])).values()];state.threadsLoaded=true;state.nextCursor=typeof r.nextCursor==='string'?r.nextCursor:null;
    }
   }else if(section==='management'){
    const r=await request('/staff/court',{method:'GET'});if(!valid())return false;if(!Array.isArray(r.roster))throw Error('朝廷の役職を確認できませんでした。');contentRevision(r.contentRevision);state.roster={leaderId:id(r.leaderId)?r.leaderId:null,rows:r.roster.filter(row=>id(row.id)).map(row=>({id:row.id,name:cleanText(row.name,80),title:cleanText(row.title,40),officeJurisdiction:cleanJurisdiction(row.title,row.officeJurisdiction),merit:Math.max(0,Number(row.merit)||0),completedUpgrades:Math.max(0,Number(row.completedUpgrades)||0),isLeader:row.isLeader===true,termId:cleanText(row.termId,100),canBecomeEmperor:row.canBecomeEmperor===true&&Boolean(row.termId)}))};if(!state.leaderTouched&&!state.pending)state.drafts.leader=state.roster.rows.some(row=>row.id===state.roster.leaderId&&row.termId&&row.canBecomeEmperor)?state.roster.leaderId:'';
    if(state.info.self.canAppoint){state.officeLoading=!background||!state.offices||state.officeLoading;if(state.officeLoading)emit();const officeData=await request('/admin/court/offices?q='+encodeURIComponent(state.officeQuery)+'&limit=20',{method:'GET'});if(!valid())return false;contentRevision(officeData.contentRevision);adoptOffices(officeData);state.regentLoading=!background||!state.regent||state.regentLoading;if(state.regentLoading)emit();const regentData=await request('/admin/court/regent?q='+encodeURIComponent(state.regentQuery)+'&limit=20',{method:'GET'});if(!valid())return false;adoptRegent(regentData);}
   }
   if(!preserveError)state.error='';return true;
  }catch(error){if(valid()){if(section==='negotiations'){state.canPropose=false;state.negotiationRecipient=null;for(const row of [...state.negotiations,state.negotiation].filter(Boolean))for(const permission of ['canAccept','canCounter','canReject','canCancel'])row[permission]=false;if([401,403].includes(error.status)){state.negotiations=[];state.negotiation=null;}state.error=error.message||'交渉の最新情報を確認できませんでした。';return false;}if((error.status===403||error.code==='COURT_SUCCESSION_ACCESS_CHANGED')&&state.info?.self.isCourtEmperor){state.succession=null;state.info.self.isCourtEmperor=false;if(['succession','succession-cancel'].includes(state.confirmation?.kind))state.confirmation=null;}if(error.status===403||error.code==='COURT_SUCCESSION_ACCESS_CHANGED'){state.successionReview=null;if(state.confirmation?.kind==='succession-review')state.confirmation=null;}if([401,403,404].includes(error.status)){if(error.code==='COURT_RANK_REQUIRED'||error.status===401){clearPrivate();if(state.info){state.info.eligible=false;state.info.features={conversation:false,audience:false,roster:false};}state.section='overview';}else if(requestedThread&&error.status===404){state.threadId='';state.thread=null;state.messages=[];}else if(section==='management'){state.roster=null;clearOffices();clearRegent();state.section='overview';}}state.error=error.message||'京都御所に接続できませんでした。';}return false;
  }finally{if(valid()){state.loading=false;state.officeLoading=false;state.regentLoading=false;state.negotiationRecipientLoading=false;lastRead=now();flight=null;emit();}}})();flight=task;return task;
 }
 function refresh(){const c=identity();emit();if(c.authenticated&&!flight&&!state.sending&&(lastRead===0||now()-lastRead>=15000))void load({background:true});return snapshot();}
 function selectSection(section){identity();if(!sections[section]||state.sending||state.pending)return false;if(state.info&&!allowed(section))return false;readSequence++;state.section=section;state.confirmation=null;state.error='';emit();void load({background:true});return true;}
 function openNotification(destination){
  if(destination==='courtNegotiations')return openNegotiations();
  const section=destination==='courtChat'?'chat':destination==='courtAudiences'?'audiences':null;
  if(disposed||!section)return false;
  const c=identity();if(!c.authenticated||state.sending||state.pending){emit();return false;}
  readSequence++;state.section=section;state.confirmation=null;state.error='';state.message='';state.notificationCheck=true;
  // Check admission again before showing cached private information. A push
  // never supplies a thread ID or grants court access on its own.
  if(section==='chat'){state.chat=[];state.chatLoaded=false;}
  else{state.threadId='';state.thread=null;state.messages=[];state.threads=[];state.threadsLoaded=false;state.nextCursor=null;state.hasOlder=false;state.nextBefore=null;state.drafts.reply='';}
  emit();void load();return true;
 }
 function openThread(value){identity();if(!threadId(value)||!allowed('audiences')||state.pending||state.sending)return false;state.threadId=value;state.thread=null;state.messages=[];state.drafts.reply='';emit();void load({background:true});return true;}
 function back(){if(state.pending||state.sending)return;readSequence++;state.threadId='';state.thread=null;state.messages=[];emit();void load({background:true});}
 function update(field,value){identity();if(state.sending||state.pending||!Object.hasOwn(state.drafts,field))return false;const max=Object.keys(negotiationDrafts()).includes(field)?field==='negotiationTarget'?150:30:field==='title'||field==='officeSearch'||field==='regentSearch'||field==='imperialName'?80:field==='chat'?300:['leader','successor','regentPlayer','office','officePlayer'].includes(field)?150:1000;state.drafts[field]=String(value??'').slice(0,max);if(field==='negotiationTarget')state.negotiationRecipient=null;if(field==='leader')state.leaderTouched=true;if(field==='regentPlayer')state.regentCandidate=state.regent?.candidates.find(row=>row.id===state.drafts.regentPlayer)||(state.regentCandidate?.id===state.drafts.regentPlayer?state.regentCandidate:null);if(field==='officePlayer')state.officeCandidate=state.offices?.candidates.find(row=>row.id===state.drafts.officePlayer)||(state.officeCandidate?.id===state.drafts.officePlayer?state.officeCandidate:null);state.error='';state.confirmation=null;emit();return true;}
 function chooseOfficeCandidate(directory,id){
  identity();
  if(!allowed('management')||!state.info.self.canAppoint||state.sending||state.pending||!directory||!state.offices)return false;
  state.confirmation=null;
  const latest=directory.revision>=state.offices.revision?directory:state.offices;
  const candidate=latest.candidates.find(row=>row.id===id&&!row.courtOffice);
  state.officeCandidate=candidate||null;
  state.drafts.officePlayer=candidate?.id||'';
  if(!candidate){state.error='任命候補が更新されました。一覧からもう一度選んでください。';emit();return false;}
  state.offices=latest;state.officeQuery=latest.query;state.drafts.officeSearch=candidate.name;
  state.error='';emit();return true;
 }
 function chooseRegentCandidate(directory,value){
  identity();if(!allowed('management')||!state.info.self.canAppoint||state.sending||state.pending||!directory||!state.regent)return false;
  const latest=directory.revision>=state.regent.revision?directory:state.regent,candidate=latest.holder?null:latest.candidates.find(row=>row.id===value);state.confirmation=null;state.regent=latest;state.regentCandidate=candidate||null;state.drafts.regentPlayer=candidate?.id||'';
  if(!candidate){state.error='摂政の任命候補が更新されました。現在の在任状況を確認してください。';emit();return false;}state.regentQuery=latest.query;state.drafts.regentSearch=candidate.name;state.error='';emit();return true;
 }
 function searchRegent(){identity();if(!allowed('management')||!state.info.self.canAppoint||state.sending||state.pending||state.regentLoading)return false;state.regentQuery=normalized(state.drafts.regentSearch,80);state.confirmation=null;state.error='';state.regentLoading=true;emit();void load({background:true});return true;}
 function confirmRegent(action='appoint'){
  identity();if(!allowed('management')||!state.info.self.canAppoint||state.sending||state.pending||state.regentLoading||!state.regent||!['appoint','dismiss'].includes(action))return false;
  const target=action==='dismiss'?state.regent.holder:state.regentCandidate;if(!target||action==='appoint'&&(state.regent.holder||target.id!==state.drafts.regentPlayer))return false;
  state.confirmation={kind:'regent',action,targetPlayerId:target.id,name:target.name,homeCastleName:target.homeCastleName,expectedRevision:state.regent.revision};state.error='';emit();return true;
 }
 function confirmLeader(){identity();if(!allowed('management')||!state.info.self.canAppoint||state.sending||state.pending||state.drafts.leader&&state.successionReview?.pending.length)return false;const target=state.drafts.leader?state.roster?.rows.find(row=>row.id===state.drafts.leader&&row.termId&&row.canBecomeEmperor):null;if(state.drafts.leader&&!target)return false;state.confirmation={kind:'leader',targetPlayerId:target?.id||null,name:target?.name||'',termId:target?.termId||''};emit();return true;}
 async function relocateRetirement(){
  const c=identity(),row=state.retirement;
  if(!c.authenticated||state.sending||state.pending||!row?.canRelocate||!row.isReturnedImperial||row.isRetiredEmperor)return false;
  const g=generation,key=identityKey;state.sending=true;state.error='';emit();
  try{const action=options.onRetirementRelocation||global.SengokuBridge?.openRetirementRelocation;if(typeof action!=='function')throw Error('本拠移転の画面を読み込めませんでした。画面を更新してください。');await action();return true;}
  catch(error){if(current(g,key)){state.error=error.message||'一般拠点への移転先を確認できませんでした。';}return false;}
  finally{if(current(g,key)){state.sending=false;emit();}}
 }
 function confirmRetirement(){
  const c=identity(),row=state.retirement;
  if(!c.authenticated||state.sending||state.pending||!state.info?.self.isRetiredEmperor||!row?.canOrdain||row.isCloisteredEmperor)return false;
  state.confirmation={kind:'retirement',successionId:row.successionId,expectedRevision:row.revision};state.error='';emit();return true;
 }
 function confirmSuccession(){identity();if(!state.info?.self.isCourtEmperor||state.sending||state.pending||state.succession?.pending)return false;const target=state.succession?.candidates.find(row=>row.id===state.drafts.successor&&row.id!==context().owner);if(!target)return false;state.confirmation={kind:'succession',targetPlayerId:target.id,name:target.name,termId:target.termId,sourceAppointmentToken:state.succession.sourceAppointmentToken};state.error='';emit();return true;}
 function confirmSuccessionDecision(action,nominationId){
  identity();if(state.sending||state.pending||!['approve','reject','cancel'].includes(action))return false;
  const cancelling=action==='cancel',row=cancelling?state.succession?.pending:state.successionReview?.pending.find(row=>row.id===nominationId);
  if(!row||row.id!==nominationId||row.status!=='pending'||(cancelling?!state.info?.self.isCourtEmperor||row.emperor.id!==context().owner:!state.info?.self.canAppoint))return false;
  state.confirmation={kind:cancelling?'succession-cancel':'succession-review',action,nominationId:row.id,targetPlayerId:row.successor.id,name:row.successor.name,emperorId:row.emperor.id,emperorName:row.emperor.name,expectedRevision:row.revision};state.error='';emit();return true;
 }
 function adoptSuccessionNomination(row){
  for(const key of ['succession','successionReview']){
   const directory=state[key];if(!directory)continue;
   if(key==='succession'){if(row.emperor.id!==context().owner)continue;directory.pending=row.status==='pending'?row:null;}
   else directory.pending=[...(row.status==='pending'?[row]:[]),...directory.pending.filter(item=>item.id!==row.id)];
   directory.history=[...(row.status==='pending'?[]:[row]),...directory.history.filter(item=>item.id!==row.id)].slice(0,20);
  }
 }

 function searchOffices(){identity();if(!allowed('management')||!state.info.self.canAppoint||state.sending||state.pending||state.officeLoading)return false;state.officeQuery=normalized(state.drafts.officeSearch,80);state.confirmation=null;state.error='';state.officeLoading=true;emit();void load({background:true});return true;}
 function confirmOffice(action='appoint',officeId=state.drafts.office){
  identity();if(!allowed('management')||!state.info.self.canAppoint||state.sending||state.pending||state.officeLoading||!state.offices)return false;
  const office=state.offices.offices.find(row=>row.id===officeId),target=action==='dismiss'?office?.holder:state.officeCandidate;
  if(!office||!['appoint','dismiss'].includes(action)||!target||action==='appoint'&&(!office.available||target.courtOffice||target.id!==state.drafts.officePlayer)||action==='dismiss'&&!office.holder)return false;
  state.confirmation={kind:'office',action,officeId:office.id,title:office.title,targetPlayerId:target.id,name:target.name,homeCastleName:target.homeCastleName,expectedRevision:state.offices.revision};state.error='';emit();return true;
 }
 function cancel(){if(!state.sending){state.confirmation=null;emit();}}
 function intent(kind){
  if(kind==='retirement'&&isRetirement(state.confirmation)){
   const c=state.confirmation,row=state.retirement;
   if(!state.info?.self.isRetiredEmperor||!row?.canOrdain||row.isCloisteredEmperor||row.revision!==c.expectedRevision||row.successionId!==c.successionId)throw Error('上皇の身分が更新されました。最新の内容で出家を確認し直してください。');
   return{route:'/court/retirement/ordain',data:{expectedRevision:c.expectedRevision,successionId:c.successionId,confirmed:true},clear:[]};
  }
  if(['house','imperial-house'].includes(kind)&&state.confirmation?.kind===kind){
   const c=state.confirmation,lineage=state.info?.lineage,choosing=kind==='house';
   if(!lineage||lineage.revision!==c.expectedRevision||lineage.termId!==c.termId||!courtTerm(c.termId)||!nobleHouseId(c.houseId)||(choosing?!lineage.canChooseHouse||c.houseId!==state.drafts.houseId:!lineage.canCreateImperialHouse||c.houseId!==lineage.houseId||c.name!==imperialName(state.drafts.imperialName)||!validImperialName(c.name)))throw Error('家柄・身分・在任状況が更新されました。最新の内容で確認し直してください。');
   return{route:choosing?'/court/house':'/court/imperial-house',houseId:c.houseId,data:{expectedRevision:c.expectedRevision,termId:c.termId,confirmed:true,...(choosing?{houseId:c.houseId}:{name:c.name})},clear:choosing?['houseId']:['imperialName'],lookup:false};
  }
  if(kind==='membership'&&state.info?.membership?.canJoin&&state.confirmation?.kind==='membership'){
   const c=state.confirmation,writer=membershipWriter();if(!nobleHouseId(c.houseId)||c.houseId!==membershipHouse(state)||!writer.ready||!writer.writable||writer.deviceId!==c.deviceId||writer.revision!==c.expectedRevision)throw Error('確認後に家柄や進行が更新されました。正式加入の内容をもう一度確認してください。');
   return{route:'/court/membership',data:{deviceId:c.deviceId,expectedRevision:c.expectedRevision,expectedHomeCastleId:c.homeCastleId,expectedJoinMode:c.joinMode,expectedOfficeToken:c.officeAppointmentToken,houseId:c.houseId,confirmed:true},review:{joinMode:c.joinMode,destinationHomeCastleId:c.destinationHomeCastleId,retainedCastleCount:c.retainedCastleCount,releasedCastleCount:c.releasedCastleCount},clear:[],lookup:false};
  }
  if(kind==='chat'&&allowed('chat')){const text=normalized(state.drafts.chat,300);if(text)return{route:'/court/chat',data:{text},clear:['chat']};}
  if(kind==='audience'&&allowed('audiences')){const title=normalized(state.drafts.title,80),text=normalized(state.drafts.body,1000);if(title&&text)return{route:'/court/audiences',data:{title,text},clear:['title','body']};}
  if(kind==='reply'&&allowed('audiences')&&state.thread?.canReply){const text=normalized(state.drafts.reply,1000);if(text)return{route:'/court/audiences/'+state.thread.id+'/replies',data:{text},clear:['reply']};}
  if(kind==='leader'&&allowed('management')&&state.info.self.canAppoint&&state.confirmation?.kind==='leader'){const target=state.confirmation.targetPlayerId,row=state.roster?.rows.find(r=>r.id===target);if(target&&(!row?.termId||!row.canBecomeEmperor||row.termId!==state.confirmation.termId||state.successionReview?.pending.length))throw Error('任命する役職の情報が変わりました。認証待ちの指名がある場合は、太政大臣の認証画面で確認してください。');return{route:'/admin/court/leader',data:{targetPlayerId:target},clear:[]};}
  if(kind==='succession'&&state.info?.self.isCourtEmperor&&state.confirmation?.kind==='succession'){
   const c=state.confirmation,target=state.succession?.candidates.find(row=>row.id===c.targetPlayerId&&row.termId===c.termId);
   if(!target||target.id===context().owner||state.succession.pending||state.succession.sourceAppointmentToken!==c.sourceAppointmentToken)throw Error('後継者または天皇の在任情報が変わりました。最新の一覧で指名し直してください。');
   return{route:'/court/succession',data:{targetPlayerId:target.id,targetTermId:c.termId,sourceAppointmentToken:c.sourceAppointmentToken},clear:['successor']};
  }
  if(['succession-review','succession-cancel'].includes(kind)&&state.confirmation?.kind===kind){
   const c=state.confirmation,cancelling=kind==='succession-cancel',row=cancelling?state.succession?.pending:state.successionReview?.pending.find(row=>row.id===c.nominationId);
   if(!row||row.status!=='pending'||row.id!==c.nominationId||row.revision!==c.expectedRevision||row.successor.id!==c.targetPlayerId||row.emperor.id!==c.emperorId||(cancelling?!state.info?.self.isCourtEmperor||row.emperor.id!==context().owner:!state.info?.self.canAppoint))throw Error('後継者の指名状況が変わりました。最新の内容で確認し直してください。');
   return{route:(cancelling?'/court/succession/':'/admin/court/succession/')+row.id+'/'+c.action,action:c.action,nominationId:row.id,targetPlayerId:row.successor.id,data:{expectedRevision:c.expectedRevision},clear:[]};
  }

  if(kind==='regent'&&allowed('management')&&state.info.self.canAppoint&&state.confirmation?.kind==='regent'){
   const c=state.confirmation;if(state.regent?.revision!==c.expectedRevision||c.action==='appoint'&&(state.regent.holder||state.regentCandidate?.id!==c.targetPlayerId)||c.action==='dismiss'&&state.regent.holder?.id!==c.targetPlayerId)throw Error('摂政の任命状況が変わりました。最新の一覧で確認し直してください。');
   return{route:'/admin/court/regent',data:{action:c.action,targetPlayerId:c.targetPlayerId,expectedRevision:c.expectedRevision},clear:[]};
  }
  if(kind==='office'&&allowed('management')&&state.info.self.canAppoint&&state.confirmation?.kind==='office'){
   const c=state.confirmation,office=state.offices?.offices.find(row=>row.id===c.officeId);
   if(state.offices?.revision!==c.expectedRevision||!office||c.action==='appoint'&&(!office.available||state.officeCandidate?.id!==c.targetPlayerId||state.officeCandidate?.courtOffice)||c.action==='dismiss'&&office.holder?.id!==c.targetPlayerId)throw Error('太政官の任命状況が変わりました。最新の一覧で確認し直してください。');
   return{route:'/admin/court/offices',data:{action:c.action,officeId:c.officeId,targetPlayerId:c.targetPlayerId,expectedRevision:c.expectedRevision},clear:[]};
  }
  throw Error('参内資格と入力内容を確認してください。');
 }
 async function submit(kind){
  if(isNegotiation(state.pending)||kind==='negotiation'||kind==='negotiation-resend')return submitNegotiation(kind==='negotiation-resend');
  const c=identity();if(!c.authenticated||state.sending)return false;
  // Normal world-clock saves can advance the revision while the player reads.
  // Refresh that revision only when the reviewed home and full territory set
  // still match; a changed destination or loss list needs a new confirmation.
  if(kind==='membership'&&!state.pending&&state.confirmation?.kind==='membership'){
   const reviewed=copy(state.confirmation),g=generation,key=identityKey;readSequence++;flight=null;state.loading=false;state.sending=true;state.error='';emit();
   try{
    const prepared=await(options.prepareMembership?options.prepareMembership():global.SengokuCloudSync?.flush?.());if(!current(g,key))return false;
    if(!prepared?.ok)throw Error(prepared?.message||'最新の進行を同期してから、正式加入を確認してください。');
    const result=await request('/court/membership',{method:'GET'});if(!current(g,key))return false;if(result?.ok!==true)throw Error('正式加入の最新条件を確認できませんでした。');
    const latest=cleanMembership(result.membership,{detail:true}),writer=membershipWriter(),castles=(value,key)=>value[key].map(row=>row.id).sort().join(',');
    state.info.membership=cleanMembership(result.membership);
    if(!latest.canJoin||latest.homeCastleId!==reviewed.homeCastleId||latest.joinMode!==reviewed.joinMode||latest.officeAppointmentToken!==reviewed.officeAppointmentToken||JSON.stringify(latest.inheritedOffice)!==JSON.stringify(reviewed.inheritedOffice)||latest.destinationHomeCastleId!==reviewed.destinationHomeCastleId||['ownedCastles','retainedCastles','releasedCastles'].some(key=>castles(latest,key)!==castles(reviewed,key))){state.confirmation=null;throw Error(latest.reason||'確認後に本拠や領地の内訳が変わりました。保持する拠点・手放す拠点をもう一度確認してください。');}
    if(!writer.ready||!writer.writable||writer.deviceId!==reviewed.deviceId||writer.revision!==latest.expectedRevision)throw Error('操作端末が変わりました。正式加入の内容をもう一度確認してください。');
    state.confirmation={...reviewed,expectedRevision:latest.expectedRevision};
   }catch(error){if(current(g,key)){state.error=error.message||'正式加入の条件を再確認してください。';}return false;}
   finally{if(current(g,key)){state.sending=false;emit();}}
  }
  if(!state.pending){try{const next=intent(kind);const candidate={...next,kind,data:{...next.data,requestId:uuid()}};if(isSuccession(candidate))saveSuccession(c.owner,candidate);if(isRetirement(candidate))saveRetirement(c.owner,candidate);if(kind==='membership')saveMembership(c.owner,candidate);if(isLineage(candidate))saveLineage(c.owner,candidate);state.pending=candidate;}catch(error){state.error=error.message;emit();return false;}}
  const pending=state.pending,g=generation,key=identityKey;const membershipRetry=pending.kind==='membership'&&kind==='membership-resend'&&state.membershipReceiptMissing&&nobleHouseId(pending.data.houseId),membershipLookup=pending.kind==='membership'&&pending.lookup===true&&!membershipRetry,lineageRetry=isLineage(pending)&&kind==='lineage-resend'&&state.lineageReceiptMissing,lineageLookup=isLineage(pending)&&pending.lookup===true&&!lineageRetry;state.membershipReceiptMissing=false;state.lineageReceiptMissing=false;readSequence++;flight=null;state.loading=false;state.sending=true;state.error='';state.message='';emit();
  try{const r=await request(pending.route+(membershipLookup||lineageLookup?'?receipt=1':''),{method:'POST',data:copy(pending.data),...(membershipRetry?{recoverMembership:true}:{})});if(!current(g,key)||state.pending!==pending)return false;if(r?.ok!==true)throw Error('送信結果を確認できませんでした。');
   if(isRetirement(pending)){
    const retirement=cleanRetirementResult(r,pending);state.retirement=retirement;
    if(state.info){for(const key of ['isRetiredEmperor','isReturnedImperial','isCloisteredEmperor','canOrdain','shogunateIndependent'])state.info.self[key]=retirement[key];if(retirement.title)state.info.self.title=retirement.title;if(retirement.shogunateIndependent)state.info.palace.control=null;}
    clearRetirement(c.owner,pending);state.pending=null;state.confirmation=null;
    state.message=r.idempotent?(retirement.isCloisteredEmperor?'出家が成立した記録を確認しました。法皇として幕府から独立した身分を保持します。':'出家が成立した過去の記録を確認しました。現在の身分を最新情報から表示します。'):'出家し、法皇となりました。現在の拠点・資産・宮家を引き継ぎ、幕府から独立した身分を保持します。';
    try{Promise.resolve(global.SengokuSocial?.refresh?.()).catch(()=>{});}catch{}
    return true;
   }
   if(isLineage(pending)){
    const result=cleanLineageResult(r,pending);if(state.info)state.info.lineage=result.lineage;clearLineage(c.owner,pending);state.pending=null;state.confirmation=null;state.lineageReceiptMissing=false;for(const field of pending.clear)state.drafts[field]='';
    state.message=r.idempotent?'家柄・宮家の受付記録を確認しました。現在の所属と身分を表示しています。':pending.kind==='house'?nobleHouses[pending.houseId]+'を家柄として登録しました。':pending.data.name+'を宮家として創立し、皇族クラスへ移りました。';
    try{Promise.resolve(global.SengokuSocial?.refresh?.()).catch(()=>{});}catch{}
    return true;
   }
   if(pending.kind==='membership'){
    const receipt=r.admission,membership=cleanMembership(r.membership),review=pending.review,destination=review?.destinationHomeCastleId||'kyoto_gosho';
    if(!receipt||receipt.requestId!==pending.data.requestId||receipt.castleId!==destination||receipt.previousHomeCastleId!==pending.data.expectedHomeCastleId||nobleHouseId(pending.data.houseId)&&receipt.houseId!==pending.data.houseId||review&&(receipt.joinMode!==review.joinMode||receipt.destinationHomeCastleId!==destination||receipt.retainedCastleCount!==review.retainedCastleCount||receipt.releasedCastleCount!==review.releasedCastleCount)||!Number.isSafeInteger(receipt.releasedCastleCount)||receipt.releasedCastleCount<0||!id(receipt.termId)||typeof receipt.idempotent!=='boolean'||r.user?.id!==c.owner||!r.save?.state||!Number.isSafeInteger(r.revision)||r.revision<pending.data.expectedRevision||membership.isMember&&!receipt.idempotent&&r.save.state.home!==destination)throw Error('正式加入の受付結果が一致しません。同じ受付番号で再確認してください。');
    const accepted=await(options.acceptMembership?options.acceptMembership(r):global.SengokuCloudSync?.acceptSnapshot?.(r,{reason:'court-membership'}));
    if(!accepted?.ok)throw Error('加入結果を端末へ反映できませんでした。同じ受付番号で再確認してください。');
    const latest=context();if(latest.owner!==c.owner||!latest.authenticated)return false;
    clearMembership(c.owner,pending);identity();state.pending=null;state.confirmation=null;state.membershipReceiptMissing=false;state.sending=false;state.section='overview';state.error='';
    state.message=membership.isMember&&!accepted.superseded?(receipt.joinMode==='retained-base'?'現在の本拠を保持して、京都御所へ正式に加入しました。正式官職は参議から始まります。':'京都御所へ正式に加入しました。正式官職は参議から始まります。本拠と領地の表示を更新しました。'):'正式加入の受付記録を確認し、現在の所属と本拠を同期しました。';
    global.SengokuTerritoryOwners?.reset?.();void global.SengokuTerritoryOwners?.ensure?.({force:true});emit();void load({background:true});return true;
   }
   if(pending.kind==='succession-legacy'){
    const receipt=r.receipt;if(r.legacy!==true||r.status!=='legacy-approved'||r.idempotent!==true||!receipt||receipt.retiredPlayerId!==c.owner||receipt.successorPlayerId!==pending.data.targetPlayerId||typeof receipt.successorPlayerName!=='string'||!successionTime(receipt.retiredAt)||r.user?.id!==c.owner||r.needsSync!==true)throw Error('以前の譲位結果を確認できませんでした。同じ受付番号で再確認してください。');
    clearSuccession(c.owner,pending);state.pending=null;state.confirmation=null;state.succession=null;state.drafts.successor='';state.message='以前に成立した譲位の記録を確認しました。現在の領主情報を同期します。';state.sending=false;emit();
    try{if(options.onSuccession)await options.onSuccession(r);else if(global.SengokuSocial?.acceptCourtSuccession)await global.SengokuSocial.acceptCourtSuccession(r);else await global.SengokuCloudSync?.refresh?.();}catch{global.SengokuBridge?.toast?.('以前の譲位記録を確認しました。接続が戻ると現在の拠点を同期します。',true);}return true;
   }
   if(isSuccession(pending)){
    const result=cleanSuccessionResult(r,pending,c.owner);adoptSuccessionNomination(result.nomination);clearSuccession(c.owner,pending);state.pending=null;state.confirmation=null;state.drafts.successor='';
    const status=result.nomination.status,name=result.nomination.successor.name;
    state.message=r.idempotent?'皇位継承の操作記録を確認しました。現在の状態：'+({pending:'太政大臣の認証待ち',approved:'認証済み',rejected:'却下',cancelled:'取り下げ済み',invalidated:'指名失効'}[status])+'。':status==='pending'?name+'を後継者として指名しました。太政大臣の認証までは、天皇の権限・所属・拠点は変わりません。':status==='approved'?name+'への皇位継承を認証しました。前天皇は'+(result.nomination.retirement?.title||'上皇')+'として京都御所を離れ、一般拠点へ復帰・移転できます。':status==='rejected'?'後継者の指名を却下しました。現在の天皇は引き続き在任します。':status==='cancelled'?'後継者の指名を取り下げました。現在の天皇の権限・所属・拠点は変わりません。':'指名は在任状況の変更により失効しました。';
    return true;
   }
   if(pending.kind==='regent'){
    const receipt=r.receipt,next=cleanRegent(r);if(!receipt||receipt.action!==pending.data.action||receipt.targetPlayerId!==pending.data.targetPlayerId||!Number.isSafeInteger(receipt.revision)||receipt.revision<=pending.data.expectedRevision||receipt.revision>next.revision||receipt.action==='appoint'&&(!Number.isSafeInteger(receipt.appointedAt)||receipt.appointedAt<0)||receipt.action==='dismiss'&&receipt.appointedAt!=null)throw Error('摂政の操作結果を確認できませんでした。同じ受付番号で再確認してください。');
    adoptRegent(r);state.drafts.regentPlayer='';state.regentCandidate=null;
   }
   contentRevision(r.contentRevision);
   if(pending.kind==='chat'&&r.message){state.chat=absorbMessages([r.message],state.chat);state.chatLoaded=true;}if(pending.kind==='reply'&&r.message)state.messages=absorbMessages([r.message],state.messages,0);
   for(const field of pending.clear)state.drafts[field]='';if(pending.kind==='leader')state.leaderTouched=false;if(pending.kind==='office'){adoptOffices(r);if(state.drafts.officePlayer===pending.data.targetPlayerId){state.drafts.officePlayer='';state.officeCandidate=null;}}state.pending=null;state.confirmation=null;state.message=pending.kind==='regent'?(r.idempotent?'摂政の'+(pending.data.action==='dismiss'?'解任':'任命')+'記録を確認しました。最新の在任状況を表示しています。':pending.data.action==='dismiss'?'摂政を解任しました。対象の領主は現在の拠点に留まります。':'摂政を任命しました。対象の領主は現在の拠点に留まります。'):pending.kind==='office'?(pending.data.action==='dismiss'?'太政官の役職を解任しました。':'太政官の役職を任命しました。'):pending.kind==='leader'?'朝廷の任命を更新しました。':'内容を届けました。';
   if(pending.kind==='audience'&&threadId(r.thread?.id)){state.threadId=r.thread.id;state.thread=cleanThread(r.thread);state.messages=r.message?absorbMessages([r.message]):[];}
   return true;
  }catch(error){if(current(g,key)){
   if(isLineage(pending)){
    pending.lookup=true;state.confirmation=null;
    if(lineageLookup&&error.code==='COURT_LINEAGE_RECEIPT_PENDING')state.lineageReceiptMissing=true;
    else if(!lineageLookup&&['INVALID_INPUT','COURT_HOUSE_REQUIRED','COURT_MEMBERSHIP_CHANGED','COURT_LINEAGE_CHANGED','COURT_HOUSE_ALREADY_CHOSEN','COURT_IMPERIAL_HOUSE_REQUIRED','COURT_IMPERIAL_HOUSE_NAME_TAKEN','ACCOUNT_BANNED'].includes(error.code)){clearLineage(c.owner,pending);state.pending=null;}
    state.error=error.message||'家柄・宮家の結果を確認できませんでした。同じ受付番号で再確認してください。';return false;
   }
   if(pending.kind==='membership'){
    pending.lookup=true;state.confirmation=null;
    if(membershipLookup&&error.code==='COURT_MEMBERSHIP_RECEIPT_PENDING')state.membershipReceiptMissing=true;
    else if(!membershipLookup&&['INVALID_INPUT','REQUEST_ID_REUSED','COURT_RANK_REQUIRED','COURT_HOME_CHANGED','ARMY_MARCHING','COURT_MEMBERSHIP_UNAVAILABLE','COURT_MEMBERSHIP_CHANGED','BASE_EXPELLED','SAVE_REQUIRED','REVISION_CONFLICT','LEASE_REQUIRED'].includes(error.code)){clearMembership(c.owner,pending);state.pending=null;}
    state.error=error.message||'正式加入の結果を確認できませんでした。同じ受付番号で再確認してください。';return false;
   }
   if([400,401,403,404,409,422].includes(error.status)&&!error.retryable){if(isSuccession(pending))clearSuccession(c.owner,pending);if(isRetirement(pending))clearRetirement(c.owner,pending);state.pending=null;if(['office','regent'].includes(pending.kind)||isSuccession(pending)||isRetirement(pending))state.confirmation=null;if(error.status===401||error.code==='COURT_RANK_REQUIRED'){clearPrivate();if(state.info)state.info.eligible=false;state.section='overview';}if(error.status===403&&['leader','office','regent','succession-review'].includes(pending.kind)){state.confirmation=null;state.roster=null;state.successionReview=null;clearOffices();clearRegent();}if(error.code==='COURT_SUCCESSION_ACCESS_CHANGED'){state.succession=null;state.successionReview=null;state.confirmation=null;}}state.error=error.message||'送信結果を確認できませんでした。同じ受付番号で再確認してください。';}return false;
  }finally{if(current(g,key)){state.sending=false;emit();if(!state.pending)void load({background:true,preserveError:!!state.error});}}
 }
 identity();if(id(options.targetPlayerId)&&options.targetPlayerId!==context().owner)state.drafts.negotiationTarget=options.targetPlayerId;return{snapshot,refresh,load,selectSection,openNotification,openThread,back,update,openNegotiations,openNegotiation,selectNegotiationBox,backNegotiation,lookupNegotiationRecipient,startCounter,confirmNegotiation,submitNegotiation,confirmMembership,restartLegacyMembership,confirmLineage,chooseOfficeCandidate,chooseRegentCandidate,confirmLeader,confirmOffice,confirmRegent,confirmSuccession,confirmSuccessionDecision,confirmRetirement,relocateRetirement,searchOffices,searchRegent,cancel,submit,dispose(){disposed=true;generation++;readSequence++;state=blank();}};
}
const disabled=value=>value?' disabled':'';
function date(value){const time=new Date(value);return Number.isFinite(time.getTime())?new Intl.DateTimeFormat('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(time):'';}
function namedLord(person){return (global.SengokuCityHonors?.slot?.(person?.id)||'')+esc(person?.name||'領主')+(global.SengokuPublicCourt?.slot?.(person?.id)||'');}
function officeTitle(title,jurisdiction){const source=cleanJurisdiction(title,jurisdiction),label=source==='kyoto'?'正式官職':source==='external'?'任命官職':'';return global.SengokuPublicCourt?.badgeTitle?.(title,source)||(label?`<span class="court-office-designation">${label}</span> `:'')+esc(title);}
const successionReasons={emperor_changed:'天皇の在任状況または利用資格が変わったため、指名は失効しました。',successor_changed:'後継者の所属または利用資格が変わったため、指名は失効しました。',rejected:'太政大臣が指名を却下しました。',cancelled:'天皇が指名を取り下げました。'};
const successionStatus={pending:'太政大臣の認証待ち',approved:'認証済み',rejected:'却下',cancelled:'取り下げ済み',invalidated:'指名失効'};
function successionDate(value){return successionTime(value)?new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value))+' JST':'';}
function successionHistory(directory){
 if(!directory?.history.length)return'';
 return`<details class="court-succession-history" data-stable-key="court-succession-history"><summary>これまでの指名・認証の記録（${num(directory.history.length)}件）</summary>${directory.history.map(row=>`<article data-stable-key="court-succession-history-${esc(row.id)}"><header><strong>${esc(row.emperor.name)} → ${esc(row.successor.name)}</strong><span class="court-succession-status" data-status="${row.status}">${successionStatus[row.status]}</span></header><p>指名：${esc(successionDate(row.nominatedAt))} · 処理：${esc(successionDate(row.resolvedAt))}</p>${row.resolvedBy?`<p>確認者：${esc(row.resolvedBy.name)}</p>`:''}${row.retirement?`<p>退位後の身分：${esc(row.retirement.title)}</p>`:''}${row.reason?`<p>${esc(successionReasons[row.reason]||row.reason)}</p>`:''}</article>`).join('')}${directory.historyHasMore?'<p class="court-note">新しい記録から20件を表示しています。</p>':''}</details>`;
}
function successionConfirmation(s,locked){
 const c=s.confirmation;if(!c||!['succession','succession-review','succession-cancel'].includes(c.kind))return'';
 const nominating=c.kind==='succession',cancelling=c.kind==='succession-cancel',row=cancelling?s.succession?.pending:s.successionReview?.pending.find(row=>row.id===c.nominationId);
 const stale=nominating?!!s.succession?.pending||s.succession?.sourceAppointmentToken!==c.sourceAppointmentToken||!s.succession?.candidates.some(row=>row.id===c.targetPlayerId&&row.termId===c.termId):!row||row.status!=='pending'||row.id!==c.nominationId||row.revision!==c.expectedRevision||row.successor.id!==c.targetPlayerId||row.emperor.id!==c.emperorId;
 const heading=nominating?c.name+'を次の天皇の後継者に指名しますか':cancelling?c.name+'への後継者指名を取り下げますか':c.action==='approve'?c.name+'への皇位継承を認証しますか':c.name+'への後継者指名を却下しますか';
 const description=nominating?'指名を太政大臣へ届けます。認証が完了するまでは、あなたの天皇としての権限・所属・拠点は変わりません。認証後は後継者が天皇に即位します。上皇・法皇の共通枠が空いていれば上皇となり、京都御所を離れて仙洞御所へ移ります。上皇または法皇が在位していれば、皇族に戻って退位し、一般拠点へ復帰・移転できます。上皇・法皇は幕府の支配下に入らず、京都御所の強化も引き継ぎます。':cancelling?'太政大臣の認証待ちとなっている指名を取り下げます。現在の天皇の権限・所属・拠点は変わりません。':c.action==='approve'?c.emperorName+'の指名を認証すると、'+c.name+'が天皇に即位し、天皇の権限を引き継ぎます。'+c.emperorName+'は、上皇・法皇の共通枠が空いていれば上皇として仙洞御所へ移ります。在位者がいれば皇族に戻って退位し、一般拠点へ復帰・移転できます。上皇・法皇は幕府の支配下に入らず、京都御所の強化も引き継ぎます。':'この指名を却下します。'+c.emperorName+'は引き続き天皇として在任し、権限・所属・拠点は変わりません。';
 return`<section class="court-confirm" data-stable-key="court-succession-confirm" tabindex="-1" aria-label="皇位継承の確認"><h3>${esc(heading)}</h3><p>${esc(description)}</p>${stale?'<p class="court-succession-stale" role="alert">指名または在任状況が更新されました。最新の内容で確認し直してください。</p>':''}<div class="court-actions"><button class="button" data-court-action="cancel"${disabled(locked)}>戻る</button><button class="button gold" data-court-action="${nominating?'commit-succession':'commit-succession-decision'}"${disabled(locked||stale)}>${nominating?'後継者として指名':cancelling?'指名を取り下げる':c.action==='approve'?'認証して即位':'指名を却下する'}</button></div></section>`;
}
function successionPanel(s,locked){
 const data=s.succession,pending=data?.pending;
 let html=`<section class="court-panel court-succession" data-stable-key="court-succession"><h2>次の天皇を指名する</h2><p>京都御所へ正式加入した皇族から後継者を指名し、太政大臣の認証を受けます。認証が完了するまで、あなたの天皇としての権限・所属・拠点は変わりません。</p><p>認証後は後継者が天皇に即位し、幕府開設の承認権限を引き継ぎます。退位時に上皇・法皇の共通枠が空いていれば上皇として仙洞御所へ移ります。上皇または法皇が在位していれば皇族に戻り、一般拠点へ復帰して本拠移転を利用できます。上皇・法皇は幕府の支配下に入らず、京都御所の強化も引き継ぎます。</p>`;
 html+=imperialCapacityMarkup(data?.capacity);
 if(data?.retirementPreview)html+=`<p class="court-note">現在の退位先：${esc(data.retirementPreview.title)}。承認時の在位状況で最終確定します。</p>`;
 if(!data)return html+'<p class="court-empty">後継者の指名状況を確認しています。</p></section>';
 if(pending)html+=`<article class="court-succession-pending" data-stable-key="court-succession-pending-${esc(pending.id)}"><h3>太政大臣の認証待ち</h3><p>指名した後継者：<strong>${esc(pending.successor.name)}</strong></p><p>指名日時：${esc(successionDate(pending.nominatedAt))}</p><p class="court-note">認証が完了するまでは、あなたが天皇として引き続き在任します。</p><button class="button" data-court-action="confirm-succession-cancel" data-court-nomination="${esc(pending.id)}"${disabled(locked)}>指名の取り下げを確認</button></article>`;
 else html+=`<label for="court-successor-select">次の天皇に指名する後継者</label><select id="court-successor-select"${disabled(locked||!data.candidates.length)}><option value="">${data.candidates.length?'京都御所の皇族を選択':'現在、指名できる皇族がいません'}</option>${data.candidates.filter(row=>row.id!==s.info.self.id).map(row=>`<option value="${esc(row.id)}"${row.id===s.drafts.successor?' selected':''}>${esc(row.name)}${row.imperialHouseName?' · '+esc(row.imperialHouseName):row.title?' · '+esc(row.title):''}</option>`).join('')}</select><button class="button" data-court-action="confirm-succession"${disabled(locked||!s.drafts.successor)}>指名内容を確認</button>`;
 if(['succession','succession-cancel'].includes(s.confirmation?.kind))html+=successionConfirmation(s,locked);
 return html+successionHistory(data)+'</section>';
}
function successionReviewPanel(s,locked){
 const data=s.successionReview;
 let html=`<section class="court-panel court-succession-review" data-stable-key="court-succession-review"><div class="court-section-heading"><h2>皇位継承の認証</h2><span>太政大臣専用</span></div><p>天皇が指名した後継者を確認し、認証または却下します。認証が完了するまでは、現在の天皇の権限・所属・拠点は変わりません。</p>`;
 html+=imperialCapacityMarkup(data?.capacity);
 if(data?.retirementPreview)html+=`<p class="court-note">現在の退位先：${esc(data.retirementPreview.title)}。上皇または法皇が在位していても、皇族に戻って退位できます。承認時の在位状況で最終確定します。</p>`;
 if(!data)return html+'<p class="court-empty">認証待ちの指名を確認しています。</p></section>';
 html+=data.pending.length?`<div class="court-succession-queue">${data.pending.map(row=>`<article class="court-succession-request" data-stable-key="court-succession-request-${esc(row.id)}"><span class="court-succession-status" data-status="pending">太政大臣の認証待ち</span><dl><div><dt>指名した天皇</dt><dd>${esc(row.emperor.name)}</dd></div><div><dt>指名された後継者</dt><dd>${esc(row.successor.name)}</dd></div></dl><p>指名日時：${esc(successionDate(row.nominatedAt))}</p><div class="court-actions"><button class="button gold" data-court-action="confirm-succession-approve" data-court-nomination="${esc(row.id)}"${disabled(locked)}>認証内容を確認</button><button class="button" data-court-action="confirm-succession-reject" data-court-nomination="${esc(row.id)}"${disabled(locked)}>却下内容を確認</button></div></article>`).join('')}</div>`:'<p class="court-empty">認証待ちの指名はありません。</p>';
 if(s.confirmation?.kind==='succession-review')html+=successionConfirmation(s,locked);
 return html+successionHistory(data)+'</section>';
}
function messages(rows){return rows.length?rows.map(row=>`<article class="court-message${row.own?' is-own':''}" data-stable-key="court-message-${esc(row.id)}"><header><strong>${row.author.kind==='court'?'朝廷':namedLord(row.author)}</strong><time>${esc(date(row.createdAt))}</time>${row.own?'<span>あなた</span>':''}</header><p>${esc(row.text)}</p></article>`).join(''):'<p class="court-empty">まだ言葉は届いていません。</p>';}
function regentManagement(s,locked){
 const data=s.regent,wait=locked||s.regentLoading;
 let html=`<section class="court-panel court-regent-management" data-stable-key="court-regent-management" aria-label="摂政の任命と解任"><div class="court-section-heading"><h2>摂政の任命・解任</h2><span>太政大臣専用</span></div><p>一般拠点の領主・京都御所のメンバーから1名を任命できます。摂政は現在の拠点と所属を保ち、天皇に代わって幕府開設の承認や朝廷の応対を行います。</p><p class="court-note">後継者の指名は天皇本人が行い、皇位継承には太政大臣の認証が必要です。別の摂政を任命する際は、在任中の摂政を先に解任してください。</p>`;
 if(!data)return html+`<p class="court-empty"${s.regentLoading?' aria-busy="true"':''}>${s.regentLoading?'摂政の任命状況を確認しています。':'「最新情報を取得」で摂政の在任状況を確認してください。'}</p></section>`;
 const candidates=[...data.candidates];if(s.regentCandidate&&!candidates.some(row=>row.id===s.regentCandidate.id))candidates.unshift(s.regentCandidate);
 html+=`<article class="court-regent-holder" data-stable-key="court-regent-holder"><div><h3>現在の摂政</h3>${data.holder?`<strong>${esc(data.holder.name)}</strong><p>${esc(data.holder.homeCastleName)} · ${data.holder.isStaff?'京都御所のメンバー':'一般拠点の領主'}</p>`:'<p>現在は空席です。</p>'}</div>${data.holder?`<button class="button" data-court-action="confirm-regent-dismiss"${disabled(wait)}>解任内容を確認</button>`:''}</article>`;
 if(!data.holder)html+=`<form class="court-regent-search" data-court-form="regent-search"><label for="court-regent-search">摂政の候補を名前で検索</label><div><input id="court-regent-search" type="search" maxlength="80" placeholder="領主名を入力" value="${esc(s.drafts.regentSearch)}"${disabled(locked)}><button class="button small" type="button" data-court-action="regent-candidates" aria-haspopup="dialog"${disabled(wait)}>一覧</button><button class="button" type="submit"${disabled(wait)}>${s.regentLoading?'検索中…':'候補を検索'}</button></div><p>${data.query?'「'+esc(data.query)+'」の候補':'一般拠点・京都御所の任命候補'} · ${num(data.candidates.length)}人${data.hasMore?'以上。名前で絞り込めます。':'。'}</p></form><label for="court-regent-player">任命する摂政</label><select id="court-regent-player"${disabled(wait||!candidates.length)}><option value="">${candidates.length?'領主を選択してください':'該当する任命候補がいません'}</option>${candidates.map(row=>`<option value="${esc(row.id)}"${row.id===s.drafts.regentPlayer?' selected':''}>${esc(row.name)} · ${esc(row.homeCastleName)}${!data.candidates.some(item=>item.id===row.id)?' · 選択中':''}</option>`).join('')}</select>${s.regentCandidate?`<p class="court-regent-selection">選択中：<strong>${esc(s.regentCandidate.name)}</strong> · ${esc(s.regentCandidate.homeCastleName)}（この拠点を維持）</p>`:''}<button class="button gold" data-court-action="confirm-regent"${disabled(wait||!s.regentCandidate)}>任命内容を確認</button>`;
 if(s.confirmation?.kind==='regent'){
  const c=s.confirmation,stale=data.revision!==c.expectedRevision;
  html+=`<section class="court-confirm" data-stable-key="court-regent-confirm" tabindex="-1" aria-label="摂政の${c.action==='dismiss'?'解任':'任命'}確認"><h3>${esc(c.name)}${c.action==='dismiss'?'の摂政を解任':'を摂政に任命'}しますか</h3><p>現在の拠点：${esc(c.homeCastleName)}。${c.action==='dismiss'?'天皇の代行権限を解除します。':'天皇に代わる幕府開設の承認・朝廷の応対を認めます。'}領主の拠点と所属はそのままです。</p>${stale?'<p class="court-regent-stale" role="alert">摂政の在任状況が更新されました。最新の一覧で確認し直してください。</p>':''}<div class="court-actions"><button class="button" data-court-action="cancel"${disabled(locked)}>戻る</button><button class="button gold" data-court-action="commit-regent"${disabled(wait||stale)}>${c.action==='dismiss'?'解任を確定':'任命を確定'}</button></div></section>`;
 }
 return html+'</section>';
}
function officeManagement(s,locked){
 const data=s.offices,wait=locked||s.officeLoading;
 let html=`<section class="court-panel court-office-management" data-stable-key="court-office-management" aria-label="太政官の任命と解任"><div class="court-section-heading"><h2>太政官の任命・解任</h2><span>太政大臣専用</span></div><div class="court-fixed-office" data-stable-key="court-fixed-office"><div><strong>太政大臣</strong><span>${esc(data?.chancellor.name||s.info.self.name)}</span></div><p>固定地位です。任命・解任の対象には含まれません。</p></div><p>他の拠点の領主に、空席の太政官を任命できます。京都御所で務める「正式官職」と、他の拠点で務める「任命官職」を区別して表示します。正式官職を含め、在任者がいる役職には重ねて任命できません。任命された領主が正式加入した場合は、その任命を終了し、正式官職の参議から始まります。</p>`;
 if(!data)return html+`<p class="court-empty"${s.officeLoading?' aria-busy="true"':''}>${s.officeLoading?'太政官の任命状況を確認しています。':'任命状況を取得できていません。「最新情報を取得」で確認してください。'}</p></section>`;
 html+=`<div class="court-office-grid" aria-label="太政官の在任状況">${data.offices.map(row=>`<article class="court-office-row${row.id===s.drafts.office?' is-selected':''}" data-stable-key="court-office-${row.id}"><header><h3>${esc(row.title)}</h3><span class="court-office-status${row.available?' is-available':''}">${row.blockedByKyoto||row.holderJurisdiction==='kyoto'?'正式官職で在任中':row.holder?'任命済み':'空席'}</span></header><div class="court-office-holder">${row.holder?`<strong>${esc(row.holder.name)}</strong><span>${esc(row.holder.homeCastleName)}</span>`:row.blockedByKyoto?'<p>京都御所の正式官職を優先するため、任命できません。</p>':'<p>他の拠点の領主を任命できます。</p>'}</div>${row.holder?`<button class="button" data-court-action="confirm-office-dismiss" data-court-office="${row.id}"${disabled(wait)}>解任内容を確認</button>`:`<button class="button" data-court-action="select-office" data-court-office="${row.id}" aria-pressed="${row.id===s.drafts.office}"${disabled(wait||!row.available)}>${row.blockedByKyoto?'正式官職で在任中':row.id===s.drafts.office?'選択中':'この役職を選ぶ'}</button>`}</article>`).join('')}</div><p class="court-office-policy">京都御所の昇進などで役職が重なった場合は、正式官職を優先して他拠点の任命官職を解除します。別の領主・役職へ変更する場合は、現在の任命を先に解任してください。</p>`;
 const candidates=[...data.candidates];if(s.officeCandidate&&!candidates.some(row=>row.id===s.officeCandidate.id))candidates.unshift(s.officeCandidate);
 const selectedOffice=data.offices.find(row=>row.id===s.drafts.office),candidate=s.officeCandidate;
 html+=`<div class="court-office-appointment" data-stable-key="court-office-appointment"><h3>空席へ任命する</h3><label for="court-office-select">任命する役職</label><select id="court-office-select"${disabled(wait)}><option value="">役職を選択してください</option>${data.offices.map(row=>`<option value="${row.id}"${row.id===s.drafts.office?' selected':''}${disabled(!row.available)}>${esc(row.title)}${row.blockedByKyoto||row.holderJurisdiction==='kyoto'?' · 京都御所の正式官職で在任中':row.holder?' · 任命済み':' · 空席'}</option>`).join('')}</select><form class="court-office-search" data-court-form="office-search"><label for="court-office-search">任命候補を名前で検索</label><div><input id="court-office-search" type="search" maxlength="80" value="${esc(s.drafts.officeSearch)}" placeholder="領主名を入力" aria-describedby="court-office-search-note"${disabled(locked)}><button class="button small" type="button" data-court-action="office-candidates" aria-haspopup="dialog"${disabled(wait)}>一覧</button><button class="button" type="submit"${disabled(wait)}>${s.officeLoading?'検索中…':'候補を検索'}</button></div><p id="court-office-search-note">${data.query?`「${esc(data.query)}」の検索結果`:'他拠点の任命候補'} · ${num(data.candidates.length)}人${data.hasMore?'以上。名前を入力して候補を絞り込めます。':'。'}拠点が確認できる領主を表示しています。</p></form><label for="court-office-player">任命する領主</label><select id="court-office-player"${disabled(wait||!candidates.length)}><option value="">${candidates.length?'領主を選択してください':'該当する任命候補がいません'}</option>${candidates.map(row=>`<option value="${esc(row.id)}"${row.id===s.drafts.officePlayer?' selected':''}${disabled(!!row.courtOffice)}>${esc(row.name)} · ${esc(row.homeCastleName)}${row.courtOffice?' · '+esc(row.courtOffice.title)+' 在任中':''}${!data.candidates.some(item=>item.id===row.id)?' · 選択中':''}</option>`).join('')}</select>${candidate?`<p class="court-office-selection">選択中：<strong>${esc(candidate.name)}</strong> · ${esc(candidate.homeCastleName)}${candidate.courtOffice?' · '+esc(candidate.courtOffice.title)+' 在任中（先に解任してください）':''}</p>`:''}<button class="button gold" data-court-action="confirm-office"${disabled(wait||!selectedOffice?.available||!candidate||!!candidate.courtOffice)}>任命内容を確認</button></div>`;
 if(s.confirmation?.kind==='office'){
  const c=s.confirmation,stale=data.revision!==c.expectedRevision;
  html+=`<section class="court-confirm" data-stable-key="court-office-confirm" tabindex="-1" aria-label="太政官の${c.action==='dismiss'?'解任':'任命'}確認"><h3>${esc(c.name)}${c.action==='dismiss'?'の'+esc(c.title)+'を解任':'を'+esc(c.title)+'に任命'}しますか</h3><p>${esc(c.homeCastleName)} · ${esc(c.title)}</p><p>${c.action==='dismiss'?'この領主から選択した太政官の役職を外します。領主の拠点やゲームの進行は変わりません。':'太政大臣の権限で、この領主に選択した役職を任命します。確定時にも空席と領主の所属を確認します。'}</p>${stale?'<p class="court-office-stale" role="alert">任命状況が更新されました。戻って最新の一覧から確認し直してください。</p>':''}<div class="court-actions"><button class="button" data-court-action="cancel"${disabled(locked)}>戻る</button><button class="button gold" data-court-action="commit-office"${disabled(wait||stale)}>${c.action==='dismiss'?'解任を確定':'任命を確定'}</button></div></section>`;
 }
 return html+'</section>';
}
function nobleHouseSelect(s,controlId,label,locked){
 return `<div class="court-house-choice"><label for="${controlId}">${label} <span class="court-required">必須</span></label><select id="${controlId}" required aria-describedby="${controlId}-help"${disabled(locked)}><option value=""${!nobleHouseId(s.drafts.houseId)?' selected':''}>家柄を選んでください</option>${Object.entries(nobleHouses).map(([value,name])=>`<option value="${value}"${s.drafts.houseId===value?' selected':''}>${name}</option>`).join('')}</select><p id="${controlId}-help" class="court-note">五摂家から自分の家柄を選びます。登録した家柄は変更できません。</p></div>`;
}
function membershipCastles(rows,label,kind){
 return `<details class="court-membership-castles is-${kind}" data-stable-key="court-membership-${kind}"><summary>${label}（${num(rows.length)}拠点）</summary>${rows.length?`<ul>${rows.map(row=>`<li>${esc(row.name)}</li>`).join('')}</ul>`:'<p>該当する領地はありません。</p>'}</details>`;
}
const negotiationStatuses={pending:'交渉中',accepted:'合意成立',rejected:'辞退',cancelled:'取り下げ'};
const negotiationLabels={propose:'この条件で申し込む',counter:'この条件を提示する',accept:'対価と主従関係に同意する',reject:'この交渉を辞退する',cancel:'この交渉を取り下げる'};
function negotiationAmounts(offer){return`<dl class="court-negotiation-amounts">${Object.entries(negotiationResources).map(([key,label])=>`<div><dt>${label}</dt><dd>${num(offer[key])}</dd></div>`).join('')}</dl>`;}
function negotiationAmountInputs(s,locked){return`<div class="court-negotiation-inputs">${Object.entries(negotiationResources).map(([key,label])=>`<label for="court-negotiation-${key}">${label}<input id="court-negotiation-${key}" type="number" min="0" max="1000000" step="1" inputmode="numeric" value="${esc(s.drafts[negotiationField(key)])}" placeholder="0"${disabled(locked)}></label>`).join('')}</div><p class="court-note">各資源は0〜1,000,000。1種類以上を1以上にしてください。どちらが条件を提示しても、支払いは公家から武家へ行います。</p>`;}
function negotiationConfirmation(s,locked){
 const c=s.confirmation;if(!isNegotiation(c))return'';const stale=!negotiationReviewCurrent(s,c),title={propose:'この対価で武家へ交渉を申し込みますか？',counter:'この条件を相手へ提示し直しますか？',accept:'この対価で合意し、主従関係を結びますか？',reject:'この交渉を辞退しますか？',cancel:'自分が提示した交渉を取り下げますか？'}[c.action],description={propose:'相手が最新の条件に同意するまで、支払いや主従関係は成立しません。',counter:'前の条件をこの提示で置き換えます。相手が最新の条件に同意するまで、支払いや主従関係は成立しません。',accept:'公家から武家へ、この対価を一度だけ支払い、武家が公家の支配下に入ります。合意成立はサーバーで確認してから反映します。',reject:'交渉を終了します。対価は支払われず、主従関係も成立しません。',cancel:'交渉を終了します。対価は支払われず、主従関係も成立しません。'}[c.action];
 return`<section class="court-confirm court-negotiation-confirm" data-stable-key="court-negotiation-confirm" tabindex="-1" aria-label="武家との交渉の確認"><h3>${title}</h3><p class="court-negotiation-direction"><strong>支払う公家：${esc(c.lord.name)}</strong><span>受け取る武家：${esc(c.warrior.name)}（${esc(c.warrior.clan)}）</span></p>${negotiationAmounts(c.offer)}<p>${description}</p>${['propose','counter','accept'].includes(c.action)?'<p class="court-note">武家が公家へ移行、専用役職へ就任、または別の城へ家臣入りした場合、この主従関係は終了します。支払済みの対価は返還しません。</p>':''}${c.proposalRevision?`<p class="court-note">確認した条件：第${num(c.proposalRevision)}案。相手が条件を変えた場合、この確認では合意できません。</p>`:''}${stale?'<p class="court-negotiation-stale" role="alert">相手または条件が更新されました。最新の内容を確認し直してください。</p>':''}<div class="court-actions"><button type="button" class="button" data-court-action="cancel"${disabled(locked)}>戻る</button><button type="button" class="button gold" data-court-action="commit-negotiation"${disabled(locked||stale)}>${negotiationLabels[c.action]}</button></div></section>`;
}
function negotiationMarkup(s){
 const locked=s.sending||!!s.pending,pending=isNegotiation(s.pending)?s.pending:null,row=s.negotiation;
 let html=`<section class="court-panel court-negotiations" data-stable-key="court-negotiations"><span class="eyebrow">公家と武家の合意</span><h2>武家との交渉</h2><p>公家が対価を提示し、武家と条件を交渉します。双方が最新の条件に合意すると、公家から武家へ資源を支払い、武家がその公家の支配下に入ります。</p><p class="court-note">交渉への返答に参内の位階条件はありません。あなたが当事者の交渉だけを表示します。</p>`;
 if(pending)html+=`<section class="court-pending court-negotiation-recovery" data-stable-key="court-negotiation-recovery"><h3>${s.sending?'交渉の受付を確認しています':'交渉の結果を確認'}</h3><p>${esc(pending.review.lord.name)}から${esc(pending.review.warrior.name)}へ。同じ受付番号で「${negotiationLabels[pending.action]}」の結果を確認します。</p>${negotiationAmounts(pending.review.offer)}<p>結果が未確認の間は別の申し込みや合意を送信しません。確認だけで新しく支払うことはありません。</p><div class="court-actions"><button type="button" class="button gold" data-court-action="retry"${disabled(s.sending)}>${s.sending?'確認中…':'同じ受付の結果を確認'}</button>${s.negotiationReceiptMissing?`<button type="button" class="button" data-court-action="resend-negotiation"${disabled(s.sending)}>同じ条件と受付で再送する</button>`:''}</div></section>`;
 html+=`<nav class="court-negotiation-boxes" aria-label="交渉の状態"><button type="button" class="button" data-court-action="negotiation-box" data-court-box="active" aria-pressed="${s.negotiationsBox==='active'}"${disabled(locked)}>交渉中</button><button type="button" class="button" data-court-action="negotiation-box" data-court-box="history" aria-pressed="${s.negotiationsBox==='history'}"${disabled(locked)}>これまでの交渉</button></nav>`;
 if(s.negotiationId){
  html+=`<button type="button" class="button small" data-court-action="negotiation-back"${disabled(locked)}>交渉一覧へ</button>`;
  if(!row)return html+'<p class="court-empty">交渉の最新の条件を確認しています。</p></section>';
  const offered=row.offeredBy===row.lord.id?row.lord:row.warrior;
  html+=`<article class="court-negotiation-detail" data-stable-key="court-negotiation-${esc(row.id)}"><header><h3>${esc(row.lord.name)}と${esc(row.warrior.name)}</h3><span class="court-negotiation-status" data-status="${row.status}">${negotiationStatuses[row.status]}</span></header><p class="court-negotiation-direction"><strong>支払う公家：${esc(row.lord.name)}（${esc(row.lord.imperialHouseName||row.lord.houseName)}）</strong><span>受け取る武家：${esc(row.warrior.name)}（${esc(row.warrior.clan)}）</span></p>${negotiationAmounts(row.offer)}<p class="court-note">第${num(row.revision)}案 · 提示者：${esc(offered.name)} · ${esc(date(row.updatedAt))}</p>${row.reason?`<p class="court-note">${esc(row.reason)}</p>`:''}<div class="court-actions">${row.canAccept?`<button type="button" class="button gold" data-court-action="confirm-negotiation-accept"${disabled(locked)}>この条件への同意を確認</button>`:''}${row.canCounter?`<button type="button" class="button" data-court-action="negotiation-counter"${disabled(locked)}>条件を出し直す</button>`:''}${row.canReject?`<button type="button" class="button" data-court-action="confirm-negotiation-reject"${disabled(locked)}>辞退を確認</button>`:''}${row.canCancel?`<button type="button" class="button" data-court-action="confirm-negotiation-cancel"${disabled(locked)}>取り下げを確認</button>`:''}</div>${row.status==='pending'&&row.canCancel?'<p class="court-note">あなたが提示した条件への相手の返答を待っています。</p>':''}`;
  if(s.negotiationCounterRevision!==null){const stale=s.negotiationCounterRevision!==row.revision||!row.canCounter;html+=`<form class="court-negotiation-offer" data-court-form="negotiation-counter"><h3>相手へ提示し直す条件</h3>${negotiationAmountInputs(s,locked||stale)}${stale?'<p class="court-negotiation-stale" role="alert">元の条件が更新されました。「条件を出し直す」から、新しい提示を確認してください。</p>':''}<button type="submit" class="button gold"${disabled(locked||stale||!negotiationOffer(s.drafts))}>提示する条件を確認</button></form>`;}
  html+=negotiationConfirmation(s,locked)+'</article>';
 }else{
  html+=`<div class="court-negotiation-list" aria-label="あなたの交渉">${s.negotiations.length?s.negotiations.map(value=>`<button type="button" class="court-negotiation-row" data-court-action="negotiation-open" data-court-negotiation="${esc(value.id)}" data-stable-key="court-negotiation-row-${esc(value.id)}"${disabled(locked)}><span><strong>${esc(value.lord.name)} → ${esc(value.warrior.name)}</strong><small>${value.status==='pending'?(value.offeredBy===s.context.owner?'相手の返答待ち':'あなたの返答待ち'):negotiationStatuses[value.status]} · 第${num(value.revision)}案 · ${esc(date(value.updatedAt))}</small></span><span class="court-negotiation-status" data-status="${value.status}">${negotiationStatuses[value.status]}</span></button>`).join(''):`<p class="court-empty">${s.negotiationsLoaded?(s.negotiationsBox==='active'?'交渉中の申し込みはありません。':'これまでの交渉はありません。'):'交渉を確認しています。'}</p>`}</div>${s.negotiationsCursor?`<button type="button" class="button" data-court-action="negotiation-more"${disabled(locked||s.loading)}>以前の交渉を読む</button>`:''}`;
  if(s.canPropose){const recipient=s.negotiationRecipient,ready=recipient?.eligible&&recipient.player.id===s.drafts.negotiationTarget;html+=`<section class="court-negotiation-compose" data-stable-key="court-negotiation-compose"><h3>武家に交渉を持ちかける</h3><p class="court-note">相手のプロフィールから選ぶか、領主IDを入力して確認してください。</p><form data-court-form="negotiation-recipient"><label for="court-negotiation-target">相手の領主ID</label><div class="court-negotiation-recipient-input"><input id="court-negotiation-target" maxlength="150" autocomplete="off" value="${esc(s.drafts.negotiationTarget)}"${disabled(locked)}><button type="submit" class="button"${disabled(locked||s.negotiationRecipientLoading||!id(s.drafts.negotiationTarget))}>${s.negotiationRecipientLoading?'相手を確認中…':'相手を確認'}</button></div></form>${recipient?`<p class="court-negotiation-recipient" role="status"><strong>${esc(recipient.player.name)}（${esc(recipient.player.clan)}）</strong>${recipient.eligible?' · 交渉を申し込めます。':' · '+esc(recipient.reason||'現在この領主へは申し込めません。')}</p>`:''}<form class="court-negotiation-offer" data-court-form="negotiation-propose"><h3>公家から武家に支払う対価</h3>${negotiationAmountInputs(s,locked||!ready)}<button type="submit" class="button gold"${disabled(locked||!ready||!negotiationOffer(s.drafts))}>申し込む条件を確認</button></form>${negotiationConfirmation(s,locked)}</section>`;}
  else if(s.negotiationsLoaded)html+='<p class="court-note">新しい申し込みは、家柄を登録した公家・皇族から行います。武家は届いた申し込みを開いて、同意・条件変更・辞退を選べます。</p>';
 }
 return html+'</section>';
}
function membershipMarkup(s){
 const membership=s.info?.membership,pending=s.pending?.kind==='membership'?s.pending:null,locked=s.sending||!!s.pending;
 if(!membership&&!pending)return'';
 let html='';
 if(pending)html+=`<section class="court-pending court-membership-pending" data-stable-key="court-membership-recovery"><h2>${s.sending?'正式加入の受付を確認しています':'正式加入の結果を確認'}</h2><p>受付番号を保持しています。通信が途切れた場合も、同じ加入手続きの結果を確認します。</p><div class="court-actions"><button class="button gold" data-court-action="retry"${disabled(s.sending)}>${s.sending?'確認中…':'加入結果を確認する'}</button>${s.membershipReceiptMissing?(nobleHouseId(pending.data.houseId)?`<button class="button" data-court-action="resend-membership"${disabled(s.sending)}>同じ加入内容を再送する</button>`:`<button class="button" data-court-action="restart-membership"${disabled(s.sending)}>家柄を選んで加入内容を確認し直す</button>`):''}</div></section>`;
 if(!membership||s.section!=='overview')return html;
 if(membership.isMember)return html+`<section class="court-panel court-membership is-member" data-stable-key="court-membership"><span class="eyebrow">京都御所の正式所属</span><h2>京都御所に正式所属しています</h2><p>京都御所への正式加入が確認されています。利用できる朝廷の機能は現在の役職に応じて案内します。家柄と身分は、下の「家柄と宮家」で確認できます。</p>${s.info.self.officeJurisdiction==='kyoto'?`<p class="court-membership-formal-office">現在の官職：${officeTitle(s.info.self.title,'kyoto')}</p>`:''}<button type="button" class="button gold" data-view="town">現在の城下町へ</button></section>`;
 const requirement=membership.requirement,c=s.confirmation?.kind==='membership'?s.confirmation:null,existingHouse=s.info?.lineage?.houseId,houseId=membershipHouse(s);
 html+=`<section class="court-panel court-membership" data-stable-key="court-membership"><span class="eyebrow">京都御所への正式加入</span><h2>${existingHouse?'家柄を引き継いで正式加入する':'家柄を選び、公家として加入する'}</h2><p>江戸城・鹿児島城と大都市拠点を保持して、京都御所へ正式に加入できます。任命官職を持つ領主は現在の本拠も維持でき、正式加入後は全員、京都御所の正式官職「参議」から始まります。通常の領地は、統一済み地域も返還の対象です。確定前に、保持する拠点・返還する領地と加入後の本拠を確認します。</p><p class="court-membership-requirement">加入条件：<strong>${esc(requirement.rankName)}以上</strong> · 総合評価 ${num(requirement.minScore)}点以上</p>${!membership.canJoin&&membership.reason?`<p class="court-membership-reason" role="status">${esc(membership.reason)}</p>`:''}${existingHouse?`<p class="court-membership-existing-house">加入する家柄：<strong>${esc(nobleHouses[existingHouse])}</strong>。登録済みの家柄と出身の家柄を引き継ぎます。</p>`:nobleHouseSelect(s,'court-join-house','加入する家柄',locked||!membership.canJoin)}<button type="button" class="button gold" data-court-action="confirm-membership" aria-controls="court-membership-confirm"${disabled(locked||!membership.canJoin||!nobleHouseId(houseId))}>${s.sending&&!pending?'加入条件を確認中…':'正式加入の内容を確認'}</button>`;
 if(c){
  const sameHome=c.homeCastleId===c.destinationHomeCastleId,releaseHome=c.releasedCastles.some(row=>row.id===c.homeCastleId),heading=sameHome?'現在の本拠「'+c.homeCastleName+'」を保持して、正式に入りますか？':releaseHome?'現在の拠点「'+c.homeCastleName+'」を手放し、'+c.destinationHomeCastleName+'へ正式に入りますか？':c.destinationHomeCastleName+'を新しい本拠として、正式に入りますか？';
  html+=`<section id="court-membership-confirm" class="court-confirm court-membership-confirm" tabindex="-1" role="region" aria-labelledby="court-membership-confirm-title"><h3 id="court-membership-confirm-title">${esc(heading)}</h3><dl class="court-membership-summary"><div><dt>現在の本拠</dt><dd>${esc(c.homeCastleName)}</dd></div><div><dt>加入後の本拠</dt><dd>${esc(c.destinationHomeCastleName)}</dd></div><div><dt>保持する拠点</dt><dd>${num(c.retainedCastleCount)}拠点</dd></div><div><dt>返還する領地</dt><dd>${num(c.releasedCastleCount)}拠点</dd></div><div><dt>選んだ家柄</dt><dd>${esc(nobleHouses[c.houseId]||'未選択')}</dd></div><div><dt>加入後の身分</dt><dd>${s.info?.lineage?.class==='imperial'?'皇族':'公家'}</dd></div><div><dt>正式加入後の官職</dt><dd>${officeTitle('参議','kyoto')}</dd></div></dl><div class="court-membership-effects">${c.officeAppointmentToken?`<p><strong>任命官職の終了</strong>${c.inheritedOffice?'現在の「'+esc(c.inheritedOffice.title)+'」は':'現在の任命官職は'}正式加入時に終了し、京都御所の正式官職「参議」から始まります。本拠を保持する場合も、官職は全員同じ条件で開始します。</p>`:''}${c.retainedCastleCount?'<p><strong>保持する拠点の育成</strong>下の一覧の拠点は、城郭・城壁・守備兵・耐久と、支拠点の成長・施設・普請を引き継ぎます。</p>':''}${c.releasedCastleCount?'<p><strong>返還する領地の育成</strong>返還する城の城郭・城壁・守備兵と、その領地の支拠点・普請を手放します。統一済み地域の占領保護を解除し、通常の領地も返還します。</p>':'<p><strong>領地の保護</strong>地域単位の占領保護は解除されます。下の一覧にある拠点は引き続き保持します。</p>'}<p><strong>引き継ぐもの</strong>領主情報・武将・購入情報・所持資源・勾玉・研究と個人施設の育成記録。</p>${sameHome?'<p><strong>現在の本拠を継続</strong>加入後も現在の本拠を維持し、選んだ家柄で京都御所に正式所属します。官職は参議から始まります。</p>':''}</div><p class="court-note">主君がいる場合は、公家への移行でその主従関係が終了します。支払済みの対価は返還しません。</p>${membershipCastles(c.retainedCastles,'保持する拠点を確認','retained')}${membershipCastles(c.releasedCastles,'手放す領地を確認','released')}<p class="court-note">「戻る」で内容を見直せます。手放した領地は、次の周回でも自動では戻りません。${c.joinMode==='retained-base'?'正式加入後も現在の本拠を維持します。官職は参議から始まります。朝廷で利用できる機能は、現在の役職に応じて案内します。':'正式加入すると、京都御所の共同普請と朝廷の業務に参加できます。'}出陣・派遣・同盟部隊の参加中は、終了後に加入できます。</p><div class="court-actions"><button type="button" class="button" data-court-action="cancel"${disabled(locked)}>戻る</button><button type="button" class="button gold" data-court-action="commit-membership"${disabled(locked||!nobleHouseId(c.houseId)||c.houseId!==houseId)}>${c.releasedCastleCount?'領地の返還に同意して正式加入':'拠点を保持して正式加入'}</button></div></section>`;
 }
 return html+'</section>';
}
function lineageMarkup(s){
 const lineage=s.info?.lineage,pending=isLineage(s.pending)?s.pending:null,locked=s.sending||!!s.pending;
 let html='';
 if(pending)html+=`<section class="court-pending court-lineage-pending" data-stable-key="court-lineage-recovery"><h2>${pending.kind==='house'?'家柄登録':'宮家創立'}の結果を確認</h2><p>${pending.kind==='house'?esc(nobleHouses[pending.houseId]):esc(pending.data.name)}の受付番号を保持しています。同じ操作の結果を確認します。</p><div class="court-actions"><button type="button" class="button gold" data-court-action="retry"${disabled(s.sending)}>${s.sending?'確認中…':'受付結果を確認する'}</button>${s.lineageReceiptMissing?`<button type="button" class="button" data-court-action="resend-lineage"${disabled(s.sending)}>同じ内容を再送する</button>`:''}</div></section>`;
 if(!lineage||s.section!=='overview'||!lineage.class&&!lineage.needsHouseSelection)return html;
 const c=isLineage(s.confirmation)?s.confirmation:null,stale=!!c&&(c.expectedRevision!==lineage.revision||c.termId!==lineage.termId||(c.kind==='house'?!lineage.canChooseHouse||c.houseId!==s.drafts.houseId:!lineage.canCreateImperialHouse||c.houseId!==lineage.houseId||c.name!==imperialName(s.drafts.imperialName))),choosing=c?.kind==='house';
 html+=`<section class="court-panel court-lineage" data-stable-key="court-lineage"><span class="eyebrow">京都御所の家柄と身分</span><h2>家柄と宮家</h2><dl class="court-lineage-summary"><div><dt>現在の身分</dt><dd><span class="court-lineage-class" data-court-class="${lineage.class||''}">${lineage.class==='imperial'?'皇族':lineage.class==='kuge'?'公家':'未登録'}</span></dd></div><div><dt>家柄</dt><dd>${esc(lineage.houseName||'未選択')}</dd></div>${lineage.originalClan?`<div><dt>出身の家柄</dt><dd>${esc(lineage.originalClan)}</dd></div>`:''}${lineage.imperialHouseName?`<div><dt>創立した宮家</dt><dd>${esc(lineage.imperialHouseName)}</dd></div>`:''}</dl><p>正式加入後、${esc(lineage.requirement.officeName)}に到達すると、皇族への移行と自分の宮家の創立を選べます。正式加入後の共同普請で朝廷功績${num(lineage.requirement.minMerit)}点に到達し、左大臣へ昇進することが条件です。内容を確認して宮家を創立すると、皇族クラスとなり、天皇への即位候補になります。天皇から後継者に指名され、太政大臣に認証されると即位します。</p>`;
 if(lineage.needsHouseSelection){
  html+=`<div class="court-lineage-enrollment"><h3>正式加入者の家柄を登録する</h3><p>家柄がまだ選ばれていません。五摂家から選び、登録する内容を確認してください。</p>${nobleHouseSelect(s,'court-member-house','登録する家柄',locked||!lineage.canChooseHouse)}<button type="button" class="button gold" data-court-action="confirm-house"${disabled(locked||!lineage.canChooseHouse||!nobleHouseId(s.drafts.houseId))}>家柄の登録内容を確認</button></div>`;
 }
 if(lineage.canCreateImperialHouse){
  html+=`<form class="court-imperial-form" data-court-form="imperial-house-preview"><h3>皇族へ移り、宮家を創立する</h3><label for="court-imperial-name">宮家の名称</label><input id="court-imperial-name" type="text" maxlength="80" autocomplete="off" required aria-describedby="court-imperial-name-help" value="${esc(s.drafts.imperialName)}"${disabled(locked||!lineage.canCreateImperialHouse)}><p id="court-imperial-name-help" class="court-note">2〜20文字の1行で入力してください（例：桜宮）。入力した名称で登録します。創立後の改名はできません。</p><button type="submit" class="button gold"${disabled(locked||!lineage.canCreateImperialHouse||!validImperialName(imperialName(s.drafts.imperialName)))}>宮家の創立内容を確認</button></form>`;
 }
 if(lineage.reason)html+=`<p class="court-lineage-reason" role="status">${esc(lineage.reason)}</p>`;
 if(c)html+=`<section class="court-confirm court-lineage-confirm" data-stable-key="court-lineage-confirm" tabindex="-1" aria-label="${choosing?'家柄の登録':'宮家の創立'}確認"><h3>${choosing?esc(nobleHouses[c.houseId])+'を家柄として登録しますか？':'宮家「'+esc(c.name)+'」を創立し、皇族になりますか？'}</h3><p>${choosing?'登録後に家柄を変更することはできません。':'公家から皇族クラスへ移り、宮家「'+esc(c.name)+'」を創立します。創立は一度だけで、登録後に宮家名を変更することはできません。'}</p>${choosing?'<p class="court-note">主君がいる場合は、公家への移行でその主従関係が終了します。支払済みの対価は返還しません。</p>':''}${stale?'<p class="court-lineage-stale" role="alert">家柄・身分・在任状況が更新されました。最新の内容で確認し直してください。</p>':''}<div class="court-actions"><button type="button" class="button" data-court-action="cancel"${disabled(locked)}>戻る</button><button type="button" class="button gold" data-court-action="${choosing?'commit-house':'commit-imperial-house'}"${disabled(locked||stale)}>${choosing?'この家柄で登録する':'皇族へ移り、宮家を創立する'}</button></div></section>`;
 return html+'</section>';
}
function imperialCapacityMarkup(capacity){
 if(!capacity)return'';
 const seat=capacity.shared;
 return `<dl class="court-retirement-summary court-imperial-capacity" aria-label="上皇と法皇の共通枠"><div><dt>上皇・法皇の定員</dt><dd>二つの身分で合計一人</dd></div><div><dt>現在の在位者</dt><dd>${seat.available?'空席':esc(seat.holder.name)+' · '+esc(seat.holder.title)+(seat.count>1?' ほか'+num(seat.count-1)+'人':'')}</dd></div></dl>`;
}
function retirementMarkup(s,locked){
 const retired=s.info?.self.isRetiredEmperor||s.info?.self.isReturnedImperial,row=s.retirement,pending=isRetirement(s.pending),confirmation=isRetirement(s.confirmation)?s.confirmation:null;
 if(!retired&&!pending)return'';
 let html=`<section class="court-panel court-retirement" data-stable-key="court-retirement"><span class="eyebrow">退位後の暮らし</span><h2>${officeTitle(row?.title||s.info.self.title||'上皇')}としての本拠と身分</h2><p>${row?.isReturnedImperial||s.info?.self.isReturnedImperial?'上皇または法皇が在位しているため、皇族に戻って退位しました。京都御所の所属を離れ、一般の城へ本拠を移せます。家柄・宮家と皇族の身分を引き継ぎます。':'上皇になった時点で京都御所を離れ、専用拠点の仙洞御所へ移ります。上皇・法皇の在位中は仙洞御所を本拠とし、幕府の支配下に入りません。'}</p><p class="court-note">上皇と法皇は、二つの身分で合計一人の共通枠です。上皇が出家すると、同じ枠のまま法皇になります。</p>`;
 html+=imperialCapacityMarkup(row?.capacity);
 if(!row)html+='<p class="court-empty" aria-busy="true">退位・出家と移転の最新状況を確認しています。</p>';
 else{
  html+=`<dl class="court-retirement-summary"><div><dt>現在の身分</dt><dd>${esc(row.title||'退位の記録なし')}</dd></div><div><dt>幕府との関係</dt><dd>${row.shogunateIndependent?'幕府から独立':row.isReturnedImperial?'皇族として通常の扱い':'最新情報を確認してください'}</dd></div>${row.retiredAt!==null?`<div><dt>退位</dt><dd>${esc(successionDate(row.retiredAt))}</dd></div>`:''}${row.ordainedAt!==null?`<div><dt>出家</dt><dd>${esc(successionDate(row.ordainedAt))}</dd></div>`:''}</dl>`;
  if(row.isRetiredEmperor)html+='<section class="court-retirement-enhancements"><h3>京都御所の強化を継承</h3><p>上皇・法皇は仙洞御所と京都御所の城郭・施設を比べ、高い方のレベルを能力計算に適用します。個人の育成記録はそのまま保持します。</p></section>';
  if(row.isRetiredEmperor||row.isReturnedImperial)html+=`<div class="court-actions">${row.isReturnedImperial?`<button type="button" class="button gold" data-court-action="retirement-relocate"${disabled(locked||!row.canRelocate)}>一般拠点への移転先を選ぶ</button>`:'<button type="button" class="button gold" data-view="town">仙洞御所の城下町へ</button>'}${row.isRetiredEmperor&&!row.isCloisteredEmperor?`<button type="button" class="button" data-court-action="confirm-retirement"${disabled(locked||!row.canOrdain)}>出家して法皇になる内容を確認</button>`:''}</div><p class="court-note">${row.isReturnedImperial?'本拠移転では、移転先と引き継ぐもの・初期化するものを次の画面で確認します。':'上皇・法皇の在位中は、仙洞御所が専用の本拠となります。出家後も同じ仙洞御所と資産を引き継ぎます。'}</p>`;
  if(row.reason)html+=`<p class="court-note" role="status">${esc(row.reason)}</p>`;
 }
 if(pending)html+=`<section class="court-pending" data-stable-key="court-retirement-recovery"><h3>出家の受付結果を確認</h3><p>同じ受付番号で結果を確認します。確認が終わるまで、別の出家操作は送信しません。</p><button type="button" class="button gold" data-court-action="retry"${disabled(s.sending)}>${s.sending?'確認中…':'同じ出家の結果を確認する'}</button></section>`;
 if(confirmation){const stale=!row?.canOrdain||row.isCloisteredEmperor||row.revision!==confirmation.expectedRevision||row.successionId!==confirmation.successionId;
  html+=`<section class="court-confirm court-retirement-confirm" data-stable-key="court-retirement-confirm" tabindex="-1" aria-label="法皇への出家の確認"><h3>出家し、法皇になりますか？</h3><p>上皇から法皇へ、同じ共通枠の中で身分を変更します。出家後も上皇・法皇の共通枠を保持します。</p><p>法皇から上皇へ戻すことはできません。仙洞御所・資産・宮家を引き継ぎ、幕府から独立した身分と京都御所の強化を保ちます。</p>${stale?'<p class="court-succession-stale" role="alert">身分または法皇の在位状況が更新されました。最新の内容で確認し直してください。</p>':''}<div class="court-actions"><button type="button" class="button" data-court-action="cancel"${disabled(locked)}>戻る</button><button type="button" class="button gold" data-court-action="commit-retirement"${disabled(locked||stale)}>出家して法皇になる</button></div></section>`;
 }
 return html+'</section>';
}
function markup(s){
 const info=s.info,requirement=info?.requirement||fallbackRequirement,locked=s.sending||!!s.pending,eligible=info?.eligible===true;
 let html=`<section class="court-page" aria-label="京都御所"><header class="court-heading" data-stable-key="court-heading"><div><span class="eyebrow">KYOTO IMPERIAL COURT</span><h1>京都御所</h1><p>位階を重ね、朝廷との交流へ。</p></div><button class="button" data-court-action="reload"${disabled(s.loading||s.sending||!s.context.authenticated)}>${s.loading?'確認中…':'最新情報を取得'}</button></header><p class="court-feedback${s.error?' is-error':''}" role="status" data-stable-key="court-feedback">${esc(s.error||s.message||' ')}</p>`;
 if(!s.context.authenticated)return html+`<section class="court-panel court-admission"><h2>${s.context.pending?'領主の接続を確認しています':s.context.banned?'参内を利用できません':'京都御所への参内'}</h2><p>${s.context.banned?'領主の利用状態を交流の間で確認してください。':`参内は${esc(requirement.rankName)}（総合評価 ${num(requirement.minScore)}点）から。接続中の領主の評価を確認して案内します。`}</p><button class="button gold" data-court-action="register">交流の間で領主を確認</button></section></section>`;
 if(s.section==='negotiations'||isNegotiation(s.pending))return html+`<nav class="court-tabs" aria-label="御所の案内"><button type="button" data-court-action="section" data-court-section="overview" aria-pressed="false"${disabled(locked)}>御所案内</button><button type="button" data-court-action="section" data-court-section="negotiations" aria-pressed="true"${disabled(locked)}>武家との交渉</button></nav>`+negotiationMarkup(s)+'</section>';
 if(!info||s.notificationCheck)return html+(s.notificationCheck&&s.error&&!s.loading?'<section class="court-panel court-admission"><h2>参内資格を確認できませんでした</h2><p>通信状態を確認して「最新情報を取得」を押してください。</p></section></section>':'<section class="court-panel court-admission" aria-busy="true"><h2>参内資格を確認しています</h2><p>最新の領主情報と御所の成長を読み込んでいます。</p></section></section>');
 html+=`<section class="court-admission court-panel" data-stable-key="court-admission"><div><span class="eyebrow">${eligible?'ADMISSION CONFIRMED':'COURT ADMISSION'}</span><h2>${eligible?'参内できます':`${esc(requirement.rankName)}から参内できます`}</h2><p>参内に必要な位階：${esc(requirement.rankName)} · 総合評価 ${num(requirement.minScore)}点</p><p>現在：${esc(info.evaluation?.rankName||'評価を確認中')} · ${num(info.evaluation?.score)}点${global.SengokuPublicCourt?.selfSlot?.(info.self.id)||''}</p></div><div class="court-palace-level"><span>御所の城郭</span><b>Lv.${num(info.palace.level)} <small>/ 128</small></b><span>共同普請 ${num(info.palace.jobCount)}件</span></div></section>`;
 if(s.section==='overview')html+=`<section class="court-panel court-nobles-entry" data-stable-key="court-nobles-entry"><div class="court-nobles-entry-seal" aria-hidden="true">扇</div><div><span class="eyebrow">雅の才、二十四の出会い</span><h2>公家名鑑・勾玉交換</h2><p>朝廷の才人24人を、勾玉で選んで迎えます。人物ごとの能力・特技と専用肖像を名鑑で確認できます。</p><span class="court-nobles-entry-tiers">SS 1,200勾玉 · SSS 2,400勾玉 · U 4,800勾玉</span></div><button type="button" class="button gold" data-court-action="nobles"${disabled(locked)}>公家名鑑を開く</button></section>`;
 html+=retirementMarkup(s,locked)+membershipMarkup(s)+lineageMarkup(s);
 if(info.palace.control&&!info.self.shogunateIndependent)html+=`<section class="court-panel court-palace-control" data-stable-key="court-palace-control"><span class="eyebrow">京都御所の支配</span><h2>${esc(info.palace.control.governmentName)}の支配下</h2><p>支配領主：${esc(info.palace.control.controller.name)}</p><p>幕府開設申請の承認期限が過ぎたため、京都御所はこの幕府の支配下にあります。</p></section>`;
 if(isSuccession(s.pending))html+=`<section class="court-pending" data-stable-key="court-succession-recovery"><h2>${s.pending.kind==='succession-legacy'?'以前の譲位結果を確認':'皇位継承の通信結果を確認'}</h2><p>同じ受付番号で操作結果を確認します。通信結果が未確認の間は、別の指名や認証を送信しません。</p><button class="button gold" data-court-action="retry"${disabled(s.sending)}>${s.sending?'確認中…':'同じ操作の結果を確認する'}</button></section>`;
 if(info.self.canDevelopEstate&&info.features.estate&&(s.section==='overview'||!eligible))html+=`<section class="court-panel court-estate-entry" data-stable-key="court-estate-entry"><span class="eyebrow">あなたの共同領地</span><h2>京都御所の強化・共同普請</h2><p>現在の本拠を維持したまま、京都御所を共同領地として育てられます。城郭はLv.128、施設はLv.32まで。資源と指令を支払い、全役職者と強化を共有します。</p><button class="button gold" data-court-action="estate"${disabled(locked)}>共同領地を開く</button></section>`;
 if(s.section==='overview')html+=`<section class="court-panel court-negotiation-entry" data-stable-key="court-negotiation-entry"><h2>武家との交渉</h2><p>公家と武家で対価を交渉し、双方が最新の条件に合意すると支払いと主従関係が成立します。届いた交渉は、参内資格がなくても確認・返答できます。</p><button type="button" class="button gold" data-court-action="section" data-court-section="negotiations"${disabled(locked)}>交渉を開く</button></section>`;
 if(!eligible)return html+'<p class="court-note">領国・内政・武将などを育て、最新の進行を同期すると参内資格を更新できます。</p><div class="court-actions"><button class="button" data-view="town">城下町へ</button><button class="button" data-court-action="reload">参内資格を再確認</button></div></section>';
 html+=`<nav class="court-tabs" aria-label="御所の案内">${Object.entries(sections).filter(([key])=>key==='overview'||key==='negotiations'||key==='chat'&&info.features.conversation||key==='audiences'&&info.features.audience||key==='management'&&info.features.roster).map(([key,label])=>`<button type="button" data-court-action="section" data-court-section="${key}" aria-pressed="${s.section===key}"${disabled(locked)}>${label}</button>`).join('')}</nav>`;
 if(s.pending&&!isSuccession(s.pending)&&!isRetirement(s.pending)&&!isLineage(s.pending)&&s.pending.kind!=='membership')html+=`<section class="court-pending" data-stable-key="court-pending"><h2>${s.sending?'内容を届けています':'送信結果の確認'}</h2><p>同じ受付番号で結果を確認します。確認中の内容は保持されています。</p><button class="button gold" data-court-action="retry"${disabled(s.sending)}>${s.sending?'確認中…':'同じ内容の結果を確認'}</button></section>`;
 if(s.section==='overview')html+=`<section class="court-panel" data-stable-key="court-overview"><h2>朝廷とのやり取り</h2><div class="court-feature-grid"><article><h3>御所の談話</h3><p>参内できる領主と、御所の広間で言葉を交わします。</p><button class="button" data-court-action="section" data-court-section="chat"${disabled(!info.features.conversation||locked)}>談話を開く</button></article><article><h3>拝謁を願い出る</h3><p>朝廷に相談や願いを届けます。拝謁の内容は、あなたと応対する朝廷だけが確認できます。</p><button class="button" data-court-action="section" data-court-section="audiences"${disabled(!info.features.audience||locked)}>拝謁を開く</button></article><article><h3>御所の成長</h3><p>共同普請により城郭はLv.128まで発展します。施設はLv.32まで。共通フィールドの合戦で力を試せます。幕府開設申請を天皇または摂政が3日以内に承認しない場合は、申請した領主の支配下に入ります。京都御所から江戸城への出陣は、在任中の天皇・摂政が行えます。</p><button class="button" data-view="field">共通フィールドへ</button></article></div><p class="court-note">参内・談話・拝謁で資源や指令は消費しません。会話や訪問で功績点は増えません。</p></section>`;
 if(s.section==='overview'&&info.features.eventRoom){
  html+=`<section class="court-panel court-event-room-entry" data-stable-key="court-event-room-entry"><span class="eyebrow">朝廷の制作室</span><h2>イベントを企画する</h2><p>朝廷の担当者で下書きを共有し、20種類のテンプレートやゲームAIから合戦イベントを制作できます。内容と報酬を確認してから、領主たちへ公開します。</p><button class="button gold" data-court-action="event-room"${disabled(locked)}>イベント制作室を開く</button></section>`;
 }
 if(s.section==='overview'&&info.self.canApproveShogunate){
  html+=`<section class="court-panel court-shogunate" data-stable-key="court-shogunate"><h2>${info.self.isCourtRegent?'摂政による幕府開設の代行承認':'天皇の幕府開設承認'}</h2>${info.self.isCourtRegent?'<p>現在の拠点から、天皇に代わって幕府開設を承認できます。</p>':''}<p>届いた開設申請を、申請から現実時間で3日以内に承認してください。期限を過ぎると京都御所も申請者の支配下に入ります。</p><button class="button gold" data-court-action="shogunate"${disabled(locked)}>幕府開設申請を確認</button></section>`;
 }
 if(['overview','management'].includes(s.section)&&info.self.isCourtEmperor)html+=successionPanel(s,locked);
 if(['overview','management'].includes(s.section)&&info.self.canAppoint)html+=successionReviewPanel(s,locked);
 if(s.section==='chat')html+=`<section class="court-panel" data-stable-key="court-chat"><div class="court-section-heading"><h2>御所の談話</h2><span>参内した領主の広間</span></div><div class="court-message-list" aria-label="御所の会話" aria-live="polite" aria-relevant="additions">${s.chatLoaded?messages(s.chat):'<p class="court-empty">談話を確認しています。</p>'}</div><form data-court-form="chat">${global.SengokuOperatorTemplatePicker?.launcher()||''}<label for="court-chat-input">広間への言葉</label><small id="court-chat-input-register">上位の相手へは敬語で送信します。</small><textarea aria-describedby="court-chat-input-register" id="court-chat-input" rows="3" maxlength="300" placeholder="礼をもって、言葉を交わす…"${disabled(locked)}>${esc(s.drafts.chat)}</textarea><div class="court-form-footer"><span>${s.drafts.chat.length} / 300文字</span><button class="button gold" type="submit"${disabled(locked||!s.drafts.chat.trim())}>広間へ届ける</button></div></form></section>`;
 if(s.section==='audiences'){
  if(s.threadId)html+=`<section class="court-panel" data-stable-key="court-thread-${esc(s.threadId)}"><button class="button small" data-court-action="back"${disabled(locked)}>拝謁一覧へ</button><h2>${esc(s.thread?.title||'拝謁の内容を確認しています')}</h2>${info.self.canRespond&&s.thread?`<p class="court-note">差出人：${namedLord(s.thread.requester)}</p>`:''}${s.hasOlder?`<button class="button small" data-court-action="older"${disabled(s.loading||locked)}>以前のやり取りを読む</button>`:''}<div class="court-message-list" aria-label="拝謁のやり取り">${messages(s.messages)}</div>${s.thread?.canReply?`<form data-court-form="reply">${global.SengokuOperatorTemplatePicker?.launcher()||''}<label for="court-reply-input">${info.self.canRespond?'朝廷からの返答':'続けて伝える内容'}</label><small id="court-reply-input-register">上位の相手へは敬語で送信します。</small><textarea aria-describedby="court-reply-input-register" id="court-reply-input" rows="4" maxlength="1000"${disabled(locked)}>${esc(s.drafts.reply)}</textarea><div class="court-form-footer"><span>${s.drafts.reply.length} / 1,000文字</span><button class="button gold" type="submit"${disabled(locked||!s.drafts.reply.trim())}>${info.self.canRespond?'朝廷として返答する':'内容を届ける'}</button></div></form>`:''}</section>`;
  else html+=`<section class="court-panel" data-stable-key="court-audiences"><div class="court-section-heading"><h2>${info.self.canRespond?'朝廷に届いた拝謁':'あなたの拝謁'}</h2><span>非公開のやり取り</span></div><div class="court-thread-list">${s.threads.length?s.threads.map(thread=>`<button class="court-thread-row" data-court-action="thread" data-court-id="${esc(thread.id)}" data-stable-key="court-thread-row-${esc(thread.id)}"${disabled(locked)}><span><strong>${esc(thread.title)}</strong><small>${info.self.canRespond?namedLord(thread.requester)+' · ':''}${esc(date(thread.updatedAt))} · ${num(thread.messageCount)}通</small></span><b>${thread.status==='answered'?'返答あり':'受付中'}</b></button>`).join(''):`<p class="court-empty">${s.threadsLoaded?'拝謁の記録はまだありません。':'拝謁を確認しています。'}</p>`}</div>${s.nextCursor?`<button class="button" data-court-action="more"${disabled(locked||s.loading)}>以前の拝謁を読む</button>`:''}<details class="court-compose" data-stable-key="court-compose"><summary>新しく拝謁を願い出る</summary><form data-court-form="audience">${global.SengokuOperatorTemplatePicker?.launcher()||''}<label for="court-audience-title">件名</label><input id="court-audience-title" maxlength="80" value="${esc(s.drafts.title)}"${disabled(locked)}><label for="court-audience-body">朝廷に届ける内容</label><small id="court-audience-body-register">上位の相手へは敬語で送信します。</small><textarea aria-describedby="court-audience-body-register" id="court-audience-body" rows="5" maxlength="1000"${disabled(locked)}>${esc(s.drafts.body)}</textarea><div class="court-form-footer"><span>${s.drafts.body.length} / 1,000文字</span><button class="button gold" type="submit"${disabled(locked||!s.drafts.title.trim()||!s.drafts.body.trim())}>拝謁を願い出る</button></div></form></details></section>`;
 }
 if(s.section==='management'&&info.features.roster){
  html+=`<section class="court-panel" data-stable-key="court-management"><span class="eyebrow">PRIVATE COURT ADMINISTRATION</span><h2>朝廷の役職と功績</h2><p class="court-note">この名簿と任命は、権限を持つ朝廷の担当者だけが確認できます。一般の参内画面に担当領主の対応表は表示されません。</p><div class="court-roster">${s.roster?s.roster.rows.map(row=>`<article data-stable-key="court-roster-${esc(row.id)}"><div><h3 class="court-roster-name">${global.SengokuCityHonors?.slot?.(row.id)||''}${esc(row.name)} ${global.SengokuPublicCourt?.slot?.(row.id)||officeTitle(row.title,row.officeJurisdiction)}</h3></div><div><b>${num(row.merit)}点</b><small>普請完成 ${num(row.completedUpgrades)}件</small></div></article>`).join('')||'<p class="court-empty">任命できる担当者はいません。</p>':'<p class="court-empty">名簿を確認しています。</p>'}</div><details class="court-thresholds"><summary>京都御所の正式官職と功績</summary><ul>${info.thresholds.map(row=>`<li>${officeTitle(row.title,'kyoto')} <b>${num(row.minMerit)}点〜</b></li>`).join('')}</ul><p>京都御所の正式官職は、完了した共同普請の功績に応じて昇進します。他拠点の任命官職は、太政大臣による任命・解任で決まります。正式加入した領主は全員、京都御所の正式官職「参議」から始まります。以前の任命官職は終了し、加入後の共同普請の功績で昇進します。本拠を保持した加入でも同じ扱いです。太政大臣は固定役職です。天皇は正式加入した皇族の中から、太政大臣の任命、または現天皇の指名を太政大臣が認証することで就任します。</p></details>${info.self.canAppoint&&s.roster?`<label for="court-leader-select">天皇の任命先</label><select id="court-leader-select"${disabled(locked)}><option value="">天皇を未任命にする</option>${s.roster.rows.filter(row=>row.termId&&row.canBecomeEmperor).map(row=>`<option value="${esc(row.id)}"${row.id===s.drafts.leader?' selected':''}>${esc(row.name)} · ${esc(row.title)}</option>`).join('')}</select><button class="button gold" data-court-action="confirm-leader"${disabled(locked||!!s.drafts.leader&&!!s.successionReview?.pending.length)}>任命内容を確認</button>${s.successionReview?.pending.length?'<p class="court-note">有効な後継者指名があります。後継者を就任させる場合は、上の皇位継承の認証で確認してください。</p>':''}`:''}${s.confirmation?.kind==='leader'?`<section class="court-confirm" tabindex="-1" aria-label="天皇の任命確認"><h3>${s.confirmation.targetPlayerId?namedLord({id:s.confirmation.targetPlayerId,name:s.confirmation.name})+'を天皇に任命しますか':'天皇の任命を解除しますか'}</h3><p>現在の任命を更新します。担当者の任期が終了すると任命も解除されます。</p><div class="court-actions"><button class="button" data-court-action="cancel"${disabled(locked)}>戻る</button><button class="button gold" data-court-action="appoint"${disabled(locked)}>確定する</button></div></section>`:''}</section>`;
  if(info.self.canAppoint)html+=regentManagement(s,locked)+officeManagement(s,locked);
 }
 return html+'</section>';
}
function mount(host,options={}){
 if(!host)return{refresh(){},dispose(){}};let alive=true,lastKey='',controls=new Map(),focusConfirmation=false;
 function render(s){if(!alive)return;const key=s.context.identity,html=markup(s),top=host.closest?.('main')?.scrollTop,main=host.closest?.('main');if(global.SengokuStableDOM){const result=global.SengokuStableDOM.patch(host,html,{key:['court',key]});if(result.artwork)global.SengokuArt?.schedule?.(host);}else if(host.innerHTML!==html)host.innerHTML=html;
  const values=new Map([['court-negotiation-target',s.drafts.negotiationTarget],...Object.keys(negotiationResources).map(key=>['court-negotiation-'+key,s.drafts[negotiationField(key)]]),['court-join-house',s.drafts.houseId],['court-member-house',s.drafts.houseId],['court-imperial-name',s.drafts.imperialName],['court-chat-input',s.drafts.chat],['court-audience-title',s.drafts.title],['court-audience-body',s.drafts.body],['court-reply-input',s.drafts.reply],['court-leader-select',s.drafts.leader],['court-successor-select',s.drafts.successor],['court-office-select',s.drafts.office],['court-office-player',s.drafts.officePlayer],['court-office-search',s.drafts.officeSearch],['court-regent-search',s.drafts.regentSearch],['court-regent-player',s.drafts.regentPlayer]]);for(const [id,value]of values)if(key!==lastKey||controls.get(id)!==value){const node=host.querySelector('#'+id);if(node&&node.value!==value)node.value=value;}controls=values;lastKey=key;if(main&&main.scrollTop!==top)main.scrollTop=top;if(focusConfirmation&&s.confirmation){const panel=host.querySelector('.court-confirm');panel?.focus?.({preventScroll:true});panel?.scrollIntoView?.({block:'nearest',inline:'nearest',behavior:'instant'});}focusConfirmation=false;options.onChange?.(s);
 }
 const controller=createController({...options,onChange:render});
 function browseCandidates(button,kind='office'){
  const regent=kind==='regent',initial=controller.snapshot();
  const valid=()=>{
   const s=controller.snapshot();
   return alive&&button.isConnected&&s.section==='management'&&s.context.authenticated&&s.context.identity===initial.context.identity&&s.info?.self?.canAppoint&&!s.sending&&!s.pending;
  };
  const directories=new Map();
  const rows=directory=>(directory?.candidates||[]).filter(row=>regent||!row.courtOffice).map(row=>{
   if((directories.get(row.id)?.revision??-1)<=directory.revision)directories.set(row.id,directory);
   return {value:row.id,label:row.name,detail:row.homeCastleName+' · '+row.id};
  });
  global.SengokuInputList?.open({trigger:button,title:regent?'摂政の任命候補':'太政官の任命候補',options:rows(regent?initial.regent:initial.offices),valid,
   emptyText:'任命可能な領主が見つかりません。',
   load:async(query,signal)=>{
    if(!valid()||signal?.aborted||query.length>80)return [];
    const read=options.request||((route,args)=>global.SengokuSocial.courtRequest(route,args));
    const result=await read((regent?'/admin/court/regent?q=':'/admin/court/offices?q=')+encodeURIComponent(query.trim())+'&limit=50',{method:'GET'});
    return valid()&&!signal?.aborted?rows(regent?cleanRegent(result):cleanOffices(result)):[];
   },
   onSelect:option=>{if(valid())(regent?controller.chooseRegentCandidate:controller.chooseOfficeCandidate)(directories.get(option.value),option.value);}
  });
 }

 const click=event=>{const button=event.target.closest?.('[data-court-action]');if(!button||!host.contains(button)||button.disabled)return;event.preventDefault();const action=button.dataset.courtAction;if(action==='negotiation-open')controller.openNegotiation(button.dataset.courtNegotiation);else if(action==='negotiation-box')controller.selectNegotiationBox(button.dataset.courtBox);else if(action==='negotiation-back')controller.backNegotiation();else if(action==='negotiation-more')void controller.load({more:true});else if(action==='negotiation-counter')controller.startCounter();else if(action.startsWith('confirm-negotiation-')){focusConfirmation=true;controller.confirmNegotiation(action.replace('confirm-negotiation-',''));focusConfirmation=false;}else if(action==='commit-negotiation')void controller.submitNegotiation();else if(action==='resend-negotiation')void controller.submitNegotiation(true);else if(action==='confirm-membership')void controller.confirmMembership().then(ok=>{if(ok&&alive){const panel=host.querySelector('.court-membership-confirm');panel?.focus?.({preventScroll:true});panel?.scrollIntoView?.({block:'nearest',inline:'nearest',behavior:'instant'});}});else if(action==='commit-membership')void controller.submit('membership');else if(action==='resend-membership')void controller.submit('membership-resend');else if(action==='restart-membership')controller.restartLegacyMembership();else if(action==='confirm-house'){focusConfirmation=true;controller.confirmLineage('house');focusConfirmation=false;}else if(action==='commit-house')void controller.submit('house');else if(action==='commit-imperial-house')void controller.submit('imperial-house');else if(action==='resend-lineage')void controller.submit('lineage-resend');else if(action==='nobles')void global.SengokuBridge?.openCourtNobles?.();else if(action==='estate'&&controller.snapshot().info?.features.estate)void global.SengokuCourtEstate?.open?.();else if(action==='event-room'&&controller.snapshot().info?.features.eventRoom)void global.SengokuCourtEvents?.open?.();else if(action==='shogunate')void global.SengokuShogunate?.open?.();else if(action==='retirement-relocate')void controller.relocateRetirement();else if(action==='confirm-retirement'){focusConfirmation=true;controller.confirmRetirement();focusConfirmation=false;}else if(action==='commit-retirement')void controller.submit('retirement');else if(action==='confirm-succession'){focusConfirmation=true;controller.confirmSuccession();focusConfirmation=false;}else if(action==='commit-succession')void controller.submit('succession');else if(['confirm-succession-approve','confirm-succession-reject','confirm-succession-cancel'].includes(action)){focusConfirmation=true;controller.confirmSuccessionDecision(action.replace('confirm-succession-',''),button.dataset.courtNomination);focusConfirmation=false;}else if(action==='commit-succession-decision')void controller.submit(controller.snapshot().confirmation?.kind);else if(action==='regent-candidates')browseCandidates(button,'regent');else if(action==='confirm-regent'||action==='confirm-regent-dismiss'){focusConfirmation=true;controller.confirmRegent(action==='confirm-regent-dismiss'?'dismiss':'appoint');focusConfirmation=false;}else if(action==='commit-regent')void controller.submit('regent');else if(action==='office-candidates')browseCandidates(button);else if(action==='reload')void controller.load();else if(action==='section')controller.selectSection(button.dataset.courtSection);else if(action==='thread')controller.openThread(button.dataset.courtId);else if(action==='back')controller.back();else if(action==='more')void controller.load({more:true});else if(action==='older')void controller.load({older:true});else if(action==='retry')void controller.submit();else if(action==='register')options.onRegister?.();else if(action==='confirm-leader'){focusConfirmation=true;controller.confirmLeader();focusConfirmation=false;}else if(action==='cancel')controller.cancel();else if(action==='appoint')void controller.submit('leader');else if(action==='select-office')controller.update('office',button.dataset.courtOffice);else if(action==='confirm-office'){focusConfirmation=true;controller.confirmOffice();focusConfirmation=false;}else if(action==='confirm-office-dismiss'){focusConfirmation=true;controller.confirmOffice('dismiss',button.dataset.courtOffice);focusConfirmation=false;}else if(action==='commit-office')void controller.submit('office');};
 const input=event=>{const field={'court-negotiation-target':'negotiationTarget','court-negotiation-gold':'negotiationGold','court-negotiation-rice':'negotiationRice','court-negotiation-wood':'negotiationWood','court-negotiation-stone':'negotiationStone','court-join-house':'houseId','court-member-house':'houseId','court-imperial-name':'imperialName','court-chat-input':'chat','court-audience-title':'title','court-audience-body':'body','court-reply-input':'reply','court-leader-select':'leader','court-successor-select':'successor','court-office-select':'office','court-office-player':'officePlayer','court-office-search':'officeSearch','court-regent-search':'regentSearch','court-regent-player':'regentPlayer'}[event.target.id];if(field)controller.update(field,event.target.value);};
 const submit=event=>{const form=event.target.closest?.('[data-court-form]');if(!form||!host.contains(form))return;event.preventDefault();if(form.dataset.courtForm==='negotiation-recipient')void controller.lookupNegotiationRecipient();else if(['negotiation-propose','negotiation-counter'].includes(form.dataset.courtForm)){focusConfirmation=true;controller.confirmNegotiation(form.dataset.courtForm.replace('negotiation-',''));focusConfirmation=false;}else if(form.dataset.courtForm==='imperial-house-preview'){focusConfirmation=true;controller.confirmLineage('imperial-house');focusConfirmation=false;}else if(form.dataset.courtForm==='regent-search')controller.searchRegent();else if(form.dataset.courtForm==='office-search')controller.searchOffices();else void controller.submit(form.dataset.courtForm);};
 host.addEventListener('click',click);host.addEventListener('input',input);host.addEventListener('change',input);host.addEventListener('submit',submit);mounts.add(controller);controller.refresh();
 return{controller,refresh:()=>controller.refresh(),dispose(){alive=false;mounts.delete(controller);controller.dispose();host.removeEventListener('click',click);host.removeEventListener('input',input);host.removeEventListener('change',input);host.removeEventListener('submit',submit);global.SengokuStableDOM?.forget?.(host);}};
}
const api={createController,mount,markup,cleanNegotiationOffer,cleanNegotiation,cleanNegotiationDirectory,cleanNegotiationRecipient,cleanNegotiationResult,openNegotiations(targetPlayerId){return [...mounts].at(-1)?.openNegotiations(targetPlayerId)||false;},cleanMembership,cleanLineage,cleanLineageResult,cleanInfo,cleanMessage,cleanThread,cleanOffices,cleanRegent,cleanSuccession,cleanSuccessionNomination,cleanSuccessionReview,cleanSuccessionResult,cleanRetirement,cleanRetirementResult,openNotification(destination){return [...mounts].at(-1)?.openNotification(destination)||false;},refreshAccess(){for(const controller of mounts)controller.refresh();}};global.SengokuCourt=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);

