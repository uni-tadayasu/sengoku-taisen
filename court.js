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
const sections={overview:'御所案内',chat:'御所の談話',audiences:'拝謁',management:'朝廷の役職'};
const officeTitles=Object.freeze({sangi:'参議',chunagon:'中納言',dainagon:'大納言',naidaijin:'内大臣',udaijin:'右大臣',sadaijin:'左大臣'});
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
  seen.add(row.id);offices.push({id:row.id,title:officeTitles[row.id],blockedByKyoto:row.blockedByKyoto===true,available:row.available===true&&row.blockedByKyoto!==true&&!holder,holder});
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
  if(!row||!id(row.id)||seen.has(row.id)||typeof row.name!=='string'||!row.name||typeof row.termId!=='string'||!row.termId||row.termId.length>150||row.homeCastleId!=='kyoto_gosho')throw Error('後継者の在任情報を確認できませんでした。');
  seen.add(row.id);return{id:row.id,name:cleanText(row.name,80),termId:row.termId,title:cleanText(row.title,40),homeCastleId:'kyoto_gosho',homeCastleName:'京都御所'};
 });
 const pending=value.pending===null?null:cleanSuccessionNomination(value.pending),history=cleanSuccessionHistory(value.history);
 if(pending&&pending.status!=='pending'||pending&&history.some(row=>row.id===pending.id)||typeof value.historyHasMore!=='boolean')throw Error('後継者の指名記録を確認できませんでした。');
 return{canNominate:true,sourceAppointmentToken:value.sourceAppointmentToken,candidates,pending,history,historyHasMore:value.historyHasMore};
}
const successionId=value=>typeof value==='string'&&/^csn_[a-f0-9]{32}$/.test(value);
const successionTime=value=>Number.isSafeInteger(value)&&value>=0&&Number.isFinite(new Date(value).getTime());
const successionKinds=new Set(['succession','succession-review','succession-cancel','succession-legacy']);
const isSuccession=value=>successionKinds.has(value?.kind);
function cleanSuccessionNomination(value){
 const person=row=>row&&id(row.id)&&typeof row.name==='string'&&row.name&&row.name.length<=150?{id:row.id,name:cleanText(row.name,80)}:null;
 const emperor=person(value?.emperor),successor=person(value?.successor),resolvedBy=value?.resolvedBy==null?null:person(value.resolvedBy);
 if(!value||!successionId(value.id)||!['pending','approved','rejected','cancelled','invalidated'].includes(value.status)||!Number.isSafeInteger(value.revision)||value.revision<0||!emperor||!successor||emperor.id===successor.id||!successionTime(value.nominatedAt)||value.status==='pending'&&(value.revision!==0||value.resolvedAt!==null||value.resolvedBy!==null)||value.status!=='pending'&&(value.revision<1||!successionTime(value.resolvedAt)||value.resolvedAt<value.nominatedAt)||['approved','rejected','cancelled'].includes(value.status)&&!resolvedBy||value.resolvedBy!=null&&!resolvedBy||value.reason!=null&&(typeof value.reason!=='string'||value.reason.length>1500))throw Error('皇位継承の記録を確認できませんでした。');
 return{id:value.id,status:value.status,revision:value.revision,emperor,successor,nominatedAt:value.nominatedAt,resolvedAt:value.resolvedAt,resolvedBy,reason:value.reason==null?null:cleanText(value.reason,1500)};
}
function cleanSuccessionHistory(value){
 if(!Array.isArray(value)||value.length>20)throw Error('皇位継承の履歴を確認できませんでした。');
 const history=value.map(cleanSuccessionNomination);if(history.some(row=>row.status==='pending')||new Set(history.map(row=>row.id)).size!==history.length)throw Error('皇位継承の履歴を確認できませんでした。');return history;
}
function cleanSuccessionReview(value){
 if(value?.ok!==true||value.canApprove!==true||!Array.isArray(value.pending)||value.pending.length>100||typeof value.historyHasMore!=='boolean')throw Error('太政大臣の認証待ち一覧を確認できませんでした。');
 const pending=value.pending.map(cleanSuccessionNomination),history=cleanSuccessionHistory(value.history);
 if(pending.some(row=>row.status!=='pending')||new Set([...pending,...history].map(row=>row.id)).size!==pending.length+history.length)throw Error('皇位継承の認証記録を確認できませんでした。');return{canApprove:true,pending,history,historyHasMore:value.historyHasMore};
}
function cleanSuccessionResult(value,pending,owner){
 if(value?.ok!==true||typeof value.idempotent!=='boolean'||value.needsSync!==false||value.legacy===true)throw Error('皇位継承の操作結果を確認できませんでした。同じ受付番号で再確認してください。');
 const nomination=cleanSuccessionNomination(value.nomination),receipt=value.receipt,action=pending.kind==='succession'?'nominate':pending.action,expectedStatus={nominate:'pending',approve:'approved',reject:'rejected',cancel:'cancelled'}[action],target=pending.data.targetPlayerId||pending.targetPlayerId;
 if(!expectedStatus||!receipt||receipt.action!==action||receipt.nominationId!==nomination.id||receipt.targetPlayerId!==target||nomination.successor.id!==target||receipt.status!==expectedStatus||!Number.isSafeInteger(receipt.revision)||receipt.revision>(nomination.revision)||receipt.nominatedAt!==nomination.nominatedAt||action==='nominate'&&(receipt.revision!==0||receipt.resolvedAt!==null||nomination.emperor.id!==owner)||action!=='nominate'&&(receipt.nominationId!==pending.nominationId||receipt.revision!==pending.data.expectedRevision+1||!successionTime(receipt.resolvedAt)||receipt.resolvedAt<receipt.nominatedAt||nomination.revision!==receipt.revision||nomination.status!==receipt.status||nomination.resolvedAt!==receipt.resolvedAt||nomination.resolvedBy?.id!==owner)||action==='cancel'&&nomination.emperor.id!==owner)throw Error('皇位継承の操作結果が一致しません。同じ受付番号で再確認してください。');
 return{nomination,receipt:{action,nominationId:receipt.nominationId,targetPlayerId:receipt.targetPlayerId,revision:receipt.revision,status:receipt.status,nominatedAt:receipt.nominatedAt,resolvedAt:receipt.resolvedAt}};
}
function cleanInfo(value){
 if(value?.ok!==true||typeof value.eligible!=='boolean'||!value.requirement||!Number.isFinite(value.requirement.minScore))throw Error('参内資格の応答を確認できませんでした。');
 const source=value.palace||{},self=value.self||{};
 return{eligible:value.eligible,requirement:{rankId:cleanText(value.requirement.rankId,40),rankName:cleanText(value.requirement.rankName,40),minScore:value.requirement.minScore},evaluation:value.evaluation||null,accessStamp:String(value.accessStamp||''),self:{id:id(self.id)?self.id:'',name:cleanText(self.name,80),title:cleanText(self.title,40),merit:Math.max(0,Number(self.merit)||0),canRespond:self.canRespond===true,canAppoint:self.canAppoint===true,isCourtEmperor:self.isCourtEmperor===true,isCourtRegent:self.isCourtRegent===true,canActForEmperor:self.canActForEmperor===true,canApproveShogunate:self.canApproveShogunate===true},palace:{id:'kyoto_gosho',name:'京都御所',level:Math.max(1,Math.min(128,Number(source.level)||1)),maxLevel:128,buildings:source.buildings&&typeof source.buildings==='object'?copy(source.buildings):{},jobCount:Math.max(0,Number(source.jobCount)||0),updatedElapsedMs:Number(source.updatedElapsedMs)||0,control:cleanPalaceControl(source.control)},features:{conversation:value.features?.conversation===true,audience:value.features?.audience===true,roster:value.features?.roster===true,eventRoom:value.features?.eventRoom===true},thresholds:Array.isArray(value.thresholds)?value.thresholds.map(row=>({title:cleanText(row.title,40),minMerit:Math.max(0,Number(row.minMerit)||0)})):[],contentRevision:Number.isSafeInteger(value.contentRevision)?value.contentRevision:0};
}
function createController(options={}){
 const getContext=options.getContext||(()=>global.SengokuSocial?.getCourtContext?.()||{}),request=options.request||((route,args)=>global.SengokuSocial.courtRequest(route,args)),now=options.now||Date.now,uuid=options.uuid||(()=>global.crypto.randomUUID());
 const blank=()=>({info:null,section:sections[options.initialSection]?options.initialSection:'overview',chat:[],chatLoaded:false,threads:[],threadsLoaded:false,nextCursor:null,threadId:'',thread:null,messages:[],hasOlder:false,nextBefore:null,roster:null,leaderTouched:false,succession:null,successionReview:null,regent:null,regentCandidate:null,regentQuery:'',regentLoading:false,offices:null,officeCandidate:null,officeQuery:'',officeLoading:false,drafts:{chat:'',title:'',body:'',reply:'',leader:'',successor:'',regentPlayer:'',regentSearch:'',office:'',officePlayer:'',officeSearch:''},confirmation:null,pending:null,sending:false,loading:false,error:'',message:''});
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

 function context(){const c=getContext()||{},owner=String(c.playerId||c.user?.id||''),authenticated=!!c.user&&String(c.user.id)===owner&&!c.pending&&!c.banned;return{...c,owner,authenticated,key:JSON.stringify([owner,c.epoch||0,c.privilegeEpoch||0,c.accountEpoch||0,!!c.pending,!!c.banned,c.user?.isAdmin===true,c.user?.isStaff===true])};}
 function identity(){const c=context();if(c.key!==identityKey){identityKey=c.key;generation++;readSequence++;lastRead=0;flight=null;state=blank();if(c.authenticated)state.pending=readSuccession(c.owner);}return c;}
 const current=(g,key)=>!disposed&&g===generation&&context().key===key;
 function snapshot(){const c=identity();return{...copy(state),context:{authenticated:c.authenticated,pending:!!c.pending,banned:!!c.banned,identity:c.key}};}
 const emit=()=>{if(!disposed)options.onChange?.(snapshot());};
 function clearContent(){state.chat=[];state.chatLoaded=false;state.messages=[];state.thread=null;state.threads=[];state.threadsLoaded=false;state.nextCursor=null;state.hasOlder=false;state.nextBefore=null;}
 function contentRevision(value){if(Number.isSafeInteger(value)&&state.info&&state.info.contentRevision!==value){clearContent();state.info.contentRevision=value;}}
 function clearOffices(){state.offices=null;state.officeCandidate=null;state.officeQuery='';state.officeLoading=false;for(const field of ['office','officePlayer','officeSearch'])state.drafts[field]='';if(state.confirmation?.kind==='office')state.confirmation=null;}
 function clearRegent(){state.regent=null;state.regentCandidate=null;state.regentQuery='';state.regentLoading=false;state.drafts.regentPlayer='';state.drafts.regentSearch='';if(state.confirmation?.kind==='regent')state.confirmation=null;}
 function clearPrivate(){const recovery=isSuccession(state.pending)?state.pending:null;clearContent();state.threadId='';state.roster=null;state.leaderTouched=false;state.succession=null;state.successionReview=null;clearOffices();clearRegent();state.drafts={chat:'',title:'',body:'',reply:'',leader:'',successor:'',regentPlayer:'',regentSearch:'',office:'',officePlayer:'',officeSearch:''};state.confirmation=null;state.pending=recovery;}
 function allowed(section){const info=state.info;return section==='overview'||info?.eligible&&(section==='chat'?info.features.conversation:section==='audiences'?info.features.audience:section==='management'&&info.features.roster);}
 function adoptInfo(value){const next=cleanInfo(value);if(state.info&&state.info.accessStamp!==next.accessStamp)clearPrivate();else if(state.info&&state.info.contentRevision!==next.contentRevision)clearContent();if(!next.eligible)clearPrivate();if(!next.self.canAppoint){clearOffices();clearRegent();state.successionReview=null;if(state.confirmation?.kind==='succession-review')state.confirmation=null;}if(!next.self.isCourtEmperor){state.succession=null;state.drafts.successor='';if(['succession','succession-cancel'].includes(state.confirmation?.kind))state.confirmation=null;}state.info=next;if(!allowed(state.section))state.section='overview';}
 function adoptOffices(value){const next=cleanOffices(value);if(state.offices&&next.revision<state.offices.revision)return;state.offices=next;const selected=state.offices.candidates.find(row=>row.id===state.drafts.officePlayer);if(selected)state.officeCandidate=selected;}
 function adoptRegent(value){const next=cleanRegent(value);if(state.regent&&next.revision<state.regent.revision)return;state.regent=next;const selected=next.candidates.find(row=>row.id===state.drafts.regentPlayer);if(selected)state.regentCandidate=selected;if(next.holder?.id===state.drafts.regentPlayer){state.regentCandidate=null;state.drafts.regentPlayer='';}}
 function absorbMessages(rows,prior=[],limit=200){const combined=new Map(prior.map(row=>[row.id,row]));for(const value of rows||[]){const row=cleanMessage(value);if(row)combined.set(row.id,row);}const result=[...combined.values()].sort((a,b)=>a.seq-b.seq);return limit?result.slice(-limit):result;}
 async function load({background=false,more=false,older=false,preserveError=false}={}){
  const c=identity();if(!c.authenticated){emit();return false;}if(state.sending)return false;
  const g=generation,key=identityKey,sequence=++readSequence;state.loading=!background||!state.info;const section=state.section,requestedThread=state.threadId;emit();
  const valid=()=>current(g,key)&&sequence===readSequence;
  const task=(async()=>{try{
   const info=await request('/court',{method:'GET'});if(!valid())return false;adoptInfo(info);
   if(state.section!==section||!state.info.eligible){state.error='';return true;}
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
    const r=await request('/staff/court',{method:'GET'});if(!valid())return false;if(!Array.isArray(r.roster))throw Error('朝廷の役職を確認できませんでした。');contentRevision(r.contentRevision);state.roster={leaderId:id(r.leaderId)?r.leaderId:null,rows:r.roster.filter(row=>id(row.id)).map(row=>({id:row.id,name:cleanText(row.name,80),title:cleanText(row.title,40),merit:Math.max(0,Number(row.merit)||0),completedUpgrades:Math.max(0,Number(row.completedUpgrades)||0),isLeader:row.isLeader===true,termId:cleanText(row.termId,100)}))};if(!state.leaderTouched&&!state.pending)state.drafts.leader=state.roster.rows.some(row=>row.id===state.roster.leaderId&&row.termId)?state.roster.leaderId:'';
    if(state.info.self.canAppoint){state.officeLoading=!background||!state.offices||state.officeLoading;if(state.officeLoading)emit();const officeData=await request('/admin/court/offices?q='+encodeURIComponent(state.officeQuery)+'&limit=20',{method:'GET'});if(!valid())return false;contentRevision(officeData.contentRevision);adoptOffices(officeData);state.regentLoading=!background||!state.regent||state.regentLoading;if(state.regentLoading)emit();const regentData=await request('/admin/court/regent?q='+encodeURIComponent(state.regentQuery)+'&limit=20',{method:'GET'});if(!valid())return false;adoptRegent(regentData);}
   }
   if(!preserveError)state.error='';return true;
  }catch(error){if(valid()){if((error.status===403||error.code==='COURT_SUCCESSION_ACCESS_CHANGED')&&state.info?.self.isCourtEmperor){state.succession=null;state.info.self.isCourtEmperor=false;if(['succession','succession-cancel'].includes(state.confirmation?.kind))state.confirmation=null;}if(error.status===403||error.code==='COURT_SUCCESSION_ACCESS_CHANGED'){state.successionReview=null;if(state.confirmation?.kind==='succession-review')state.confirmation=null;}if([401,403,404].includes(error.status)){if(error.code==='COURT_RANK_REQUIRED'||error.status===401){clearPrivate();if(state.info){state.info.eligible=false;state.info.features={conversation:false,audience:false,roster:false};}state.section='overview';}else if(requestedThread&&error.status===404){state.threadId='';state.thread=null;state.messages=[];}else if(section==='management'){state.roster=null;clearOffices();clearRegent();state.section='overview';}}state.error=error.message||'京都御所に接続できませんでした。';}return false;
  }finally{if(valid()){state.loading=false;state.officeLoading=false;state.regentLoading=false;lastRead=now();flight=null;emit();}}})();flight=task;return task;
 }
 function refresh(){const c=identity();emit();if(c.authenticated&&!flight&&!state.sending&&(lastRead===0||now()-lastRead>=15000))void load({background:true});return snapshot();}
 function selectSection(section){identity();if(!sections[section]||state.sending||state.pending)return false;if(state.info&&!allowed(section))return false;readSequence++;state.section=section;state.confirmation=null;state.error='';emit();void load({background:true});return true;}
 function openThread(value){identity();if(!threadId(value)||!allowed('audiences')||state.pending||state.sending)return false;state.threadId=value;state.thread=null;state.messages=[];state.drafts.reply='';emit();void load({background:true});return true;}
 function back(){if(state.pending||state.sending)return;readSequence++;state.threadId='';state.thread=null;state.messages=[];emit();void load({background:true});}
 function update(field,value){identity();if(state.sending||state.pending||!Object.hasOwn(state.drafts,field))return false;const max=field==='title'||field==='officeSearch'||field==='regentSearch'?80:field==='chat'?300:['leader','successor','regentPlayer','office','officePlayer'].includes(field)?150:1000;state.drafts[field]=String(value??'').slice(0,max);if(field==='leader')state.leaderTouched=true;if(field==='regentPlayer')state.regentCandidate=state.regent?.candidates.find(row=>row.id===state.drafts.regentPlayer)||(state.regentCandidate?.id===state.drafts.regentPlayer?state.regentCandidate:null);if(field==='officePlayer')state.officeCandidate=state.offices?.candidates.find(row=>row.id===state.drafts.officePlayer)||(state.officeCandidate?.id===state.drafts.officePlayer?state.officeCandidate:null);state.error='';state.confirmation=null;emit();return true;}
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
 function confirmLeader(){identity();if(!allowed('management')||!state.info.self.canAppoint||state.sending||state.pending||state.drafts.leader&&state.successionReview?.pending.length)return false;const target=state.drafts.leader?state.roster?.rows.find(row=>row.id===state.drafts.leader&&row.termId):null;if(state.drafts.leader&&!target)return false;state.confirmation={kind:'leader',targetPlayerId:target?.id||null,name:target?.name||'',termId:target?.termId||''};emit();return true;}
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
  if(kind==='chat'&&allowed('chat')){const text=normalized(state.drafts.chat,300);if(text)return{route:'/court/chat',data:{text},clear:['chat']};}
  if(kind==='audience'&&allowed('audiences')){const title=normalized(state.drafts.title,80),text=normalized(state.drafts.body,1000);if(title&&text)return{route:'/court/audiences',data:{title,text},clear:['title','body']};}
  if(kind==='reply'&&allowed('audiences')&&state.thread?.canReply){const text=normalized(state.drafts.reply,1000);if(text)return{route:'/court/audiences/'+state.thread.id+'/replies',data:{text},clear:['reply']};}
  if(kind==='leader'&&allowed('management')&&state.info.self.canAppoint&&state.confirmation?.kind==='leader'){const target=state.confirmation.targetPlayerId,row=state.roster?.rows.find(r=>r.id===target);if(target&&(!row?.termId||row.termId!==state.confirmation.termId||state.successionReview?.pending.length))throw Error('任命する役職の情報が変わりました。認証待ちの指名がある場合は、太政大臣の認証画面で確認してください。');return{route:'/admin/court/leader',data:{targetPlayerId:target},clear:[]};}
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
  const c=identity();if(!c.authenticated||state.sending)return false;
  if(!state.pending){try{const next=intent(kind);const candidate={...next,kind,data:{...next.data,requestId:uuid()}};if(isSuccession(candidate))saveSuccession(c.owner,candidate);state.pending=candidate;}catch(error){state.error=error.message;emit();return false;}}
  const pending=state.pending,g=generation,key=identityKey;readSequence++;flight=null;state.loading=false;state.sending=true;state.error='';state.message='';emit();
  try{const r=await request(pending.route,{method:'POST',data:copy(pending.data)});if(!current(g,key)||state.pending!==pending)return false;if(r?.ok!==true)throw Error('送信結果を確認できませんでした。');
   if(pending.kind==='succession-legacy'){
    const receipt=r.receipt;if(r.legacy!==true||r.status!=='legacy-approved'||r.idempotent!==true||!receipt||receipt.retiredPlayerId!==c.owner||receipt.successorPlayerId!==pending.data.targetPlayerId||typeof receipt.successorPlayerName!=='string'||!successionTime(receipt.retiredAt)||r.user?.id!==c.owner||r.needsSync!==true)throw Error('以前の譲位結果を確認できませんでした。同じ受付番号で再確認してください。');
    clearSuccession(c.owner,pending);state.pending=null;state.confirmation=null;state.succession=null;state.drafts.successor='';state.message='以前に成立した譲位の記録を確認しました。現在の領主情報を同期します。';state.sending=false;emit();
    try{if(options.onSuccession)await options.onSuccession(r);else if(global.SengokuSocial?.acceptCourtSuccession)await global.SengokuSocial.acceptCourtSuccession(r);else await global.SengokuCloudSync?.refresh?.();}catch{global.SengokuBridge?.toast?.('以前の譲位記録を確認しました。接続が戻ると現在の拠点を同期します。',true);}return true;
   }
   if(isSuccession(pending)){
    const result=cleanSuccessionResult(r,pending,c.owner);adoptSuccessionNomination(result.nomination);clearSuccession(c.owner,pending);state.pending=null;state.confirmation=null;state.drafts.successor='';
    const status=result.nomination.status,name=result.nomination.successor.name;
    state.message=r.idempotent?'皇位継承の操作記録を確認しました。現在の状態：'+({pending:'太政大臣の認証待ち',approved:'認証済み',rejected:'却下',cancelled:'取り下げ済み',invalidated:'指名失効'}[status])+'。':status==='pending'?name+'を後継者として指名しました。太政大臣の認証までは、天皇の権限・所属・拠点は変わりません。':status==='approved'?name+'への皇位継承を認証しました。前天皇は次回同期で上皇として一般拠点へ復帰します。':status==='rejected'?'後継者の指名を却下しました。現在の天皇は引き続き在任します。':status==='cancelled'?'後継者の指名を取り下げました。現在の天皇の権限・所属・拠点は変わりません。':'指名は在任状況の変更により失効しました。';
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
  }catch(error){if(current(g,key)){if([400,401,403,404,409,422].includes(error.status)&&!error.retryable){if(isSuccession(pending))clearSuccession(c.owner,pending);state.pending=null;if(['office','regent'].includes(pending.kind)||isSuccession(pending))state.confirmation=null;if(error.status===401||error.code==='COURT_RANK_REQUIRED'){clearPrivate();if(state.info)state.info.eligible=false;state.section='overview';}if(error.status===403&&['leader','office','regent','succession-review'].includes(pending.kind)){state.confirmation=null;state.roster=null;state.successionReview=null;clearOffices();clearRegent();}if(error.code==='COURT_SUCCESSION_ACCESS_CHANGED'){state.succession=null;state.successionReview=null;state.confirmation=null;}}state.error=error.message||'送信結果を確認できませんでした。同じ受付番号で再確認してください。';}return false;
  }finally{if(current(g,key)){state.sending=false;emit();if(!state.pending)void load({background:true,preserveError:!!state.error});}}
 }
 identity();return{snapshot,refresh,load,selectSection,openThread,back,update,chooseOfficeCandidate,chooseRegentCandidate,confirmLeader,confirmOffice,confirmRegent,confirmSuccession,confirmSuccessionDecision,searchOffices,searchRegent,cancel,submit,dispose(){disposed=true;generation++;readSequence++;state=blank();}};
}
const disabled=value=>value?' disabled':'';
function date(value){const time=new Date(value);return Number.isFinite(time.getTime())?new Intl.DateTimeFormat('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(time):'';}
function namedLord(person){return (global.SengokuCityHonors?.slot?.(person?.id)||'')+esc(person?.name||'領主')+(global.SengokuPublicCourt?.slot?.(person?.id)||'');}
function officeTitle(title){return global.SengokuPublicCourt?.badgeTitle?.(title)||esc(title);}
const successionReasons={emperor_changed:'天皇の在任状況または利用資格が変わったため、指名は失効しました。',successor_changed:'後継者の所属または利用資格が変わったため、指名は失効しました。',rejected:'太政大臣が指名を却下しました。',cancelled:'天皇が指名を取り下げました。'};
const successionStatus={pending:'太政大臣の認証待ち',approved:'認証済み',rejected:'却下',cancelled:'取り下げ済み',invalidated:'指名失効'};
function successionDate(value){return successionTime(value)?new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value))+' JST':'';}
function successionHistory(directory){
 if(!directory?.history.length)return'';
 return`<details class="court-succession-history" data-stable-key="court-succession-history"><summary>これまでの指名・認証の記録（${num(directory.history.length)}件）</summary>${directory.history.map(row=>`<article data-stable-key="court-succession-history-${esc(row.id)}"><header><strong>${esc(row.emperor.name)} → ${esc(row.successor.name)}</strong><span class="court-succession-status" data-status="${row.status}">${successionStatus[row.status]}</span></header><p>指名：${esc(successionDate(row.nominatedAt))} · 処理：${esc(successionDate(row.resolvedAt))}</p>${row.resolvedBy?`<p>確認者：${esc(row.resolvedBy.name)}</p>`:''}${row.reason?`<p>${esc(successionReasons[row.reason]||row.reason)}</p>`:''}</article>`).join('')}${directory.historyHasMore?'<p class="court-note">新しい記録から20件を表示しています。</p>':''}</details>`;
}
function successionConfirmation(s,locked){
 const c=s.confirmation;if(!c||!['succession','succession-review','succession-cancel'].includes(c.kind))return'';
 const nominating=c.kind==='succession',cancelling=c.kind==='succession-cancel',row=cancelling?s.succession?.pending:s.successionReview?.pending.find(row=>row.id===c.nominationId);
 const stale=nominating?!!s.succession?.pending||s.succession?.sourceAppointmentToken!==c.sourceAppointmentToken||!s.succession?.candidates.some(row=>row.id===c.targetPlayerId&&row.termId===c.termId):!row||row.status!=='pending'||row.id!==c.nominationId||row.revision!==c.expectedRevision||row.successor.id!==c.targetPlayerId||row.emperor.id!==c.emperorId;
 const heading=nominating?c.name+'を次の天皇の後継者に指名しますか':cancelling?c.name+'への後継者指名を取り下げますか':c.action==='approve'?c.name+'への皇位継承を認証しますか':c.name+'への後継者指名を却下しますか';
 const description=nominating?'指名を太政大臣へ届けます。認証が完了するまでは、あなたの天皇としての権限・所属・拠点は変わりません。認証後は後継者が天皇に即位し、あなたは上皇となって以前の一般拠点へ復帰します。':cancelling?'太政大臣の認証待ちとなっている指名を取り下げます。現在の天皇の権限・所属・拠点は変わりません。':c.action==='approve'?c.emperorName+'の指名を認証すると、'+c.name+'が天皇に即位し、天皇の権限を引き継ぎます。'+c.emperorName+'は上皇となり、次回同期で京都御所から以前の一般拠点へ復帰します。':'この指名を却下します。'+c.emperorName+'は引き続き天皇として在任し、権限・所属・拠点は変わりません。';
 return`<section class="court-confirm" data-stable-key="court-succession-confirm" tabindex="-1" aria-label="皇位継承の確認"><h3>${esc(heading)}</h3><p>${esc(description)}</p>${stale?'<p class="court-succession-stale" role="alert">指名または在任状況が更新されました。最新の内容で確認し直してください。</p>':''}<div class="court-actions"><button class="button" data-court-action="cancel"${disabled(locked)}>戻る</button><button class="button gold" data-court-action="${nominating?'commit-succession':'commit-succession-decision'}"${disabled(locked||stale)}>${nominating?'後継者として指名':cancelling?'指名を取り下げる':c.action==='approve'?'認証して即位':'指名を却下する'}</button></div></section>`;
}
function successionPanel(s,locked){
 const data=s.succession,pending=data?.pending;
 let html=`<section class="court-panel court-succession" data-stable-key="court-succession"><h2>次の天皇を指名する</h2><p>京都御所の在任メンバーから後継者を指名し、太政大臣の認証を受けます。認証が完了するまで、あなたの天皇としての権限・所属・拠点は変わりません。</p><p>認証後は後継者が天皇に即位し、幕府開設の承認権限を引き継ぎます。あなたは上皇となり、次回同期で以前の一般拠点へ復帰します。復帰後は本拠移転を利用できます。</p>`;
 if(!data)return html+'<p class="court-empty">後継者の指名状況を確認しています。</p></section>';
 if(pending)html+=`<article class="court-succession-pending" data-stable-key="court-succession-pending-${esc(pending.id)}"><h3>太政大臣の認証待ち</h3><p>指名した後継者：<strong>${esc(pending.successor.name)}</strong></p><p>指名日時：${esc(successionDate(pending.nominatedAt))}</p><p class="court-note">認証が完了するまでは、あなたが天皇として引き続き在任します。</p><button class="button" data-court-action="confirm-succession-cancel" data-court-nomination="${esc(pending.id)}"${disabled(locked)}>指名の取り下げを確認</button></article>`;
 else html+=`<label for="court-successor-select">次の天皇に指名する後継者</label><select id="court-successor-select"${disabled(locked||!data.candidates.length)}><option value="">${data.candidates.length?'京都御所のメンバーを選択':'現在、指名できる在任メンバーがいません'}</option>${data.candidates.filter(row=>row.id!==s.info.self.id).map(row=>`<option value="${esc(row.id)}"${row.id===s.drafts.successor?' selected':''}>${esc(row.name)}${row.title?' · '+esc(row.title):''}</option>`).join('')}</select><button class="button" data-court-action="confirm-succession"${disabled(locked||!s.drafts.successor)}>指名内容を確認</button>`;
 if(['succession','succession-cancel'].includes(s.confirmation?.kind))html+=successionConfirmation(s,locked);
 return html+successionHistory(data)+'</section>';
}
function successionReviewPanel(s,locked){
 const data=s.successionReview;
 let html=`<section class="court-panel court-succession-review" data-stable-key="court-succession-review"><div class="court-section-heading"><h2>皇位継承の認証</h2><span>太政大臣専用</span></div><p>天皇が指名した後継者を確認し、認証または却下します。認証が完了するまでは、現在の天皇の権限・所属・拠点は変わりません。</p>`;
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
 let html=`<section class="court-panel court-office-management" data-stable-key="court-office-management" aria-label="太政官の任命と解任"><div class="court-section-heading"><h2>太政官の任命・解任</h2><span>太政大臣専用</span></div><div class="court-fixed-office" data-stable-key="court-fixed-office"><div><strong>太政大臣</strong><span>${esc(data?.chancellor.name||s.info.self.name)}</span></div><p>固定地位です。任命・解任の対象には含まれません。</p></div><p>他の拠点の領主に、空席の太政官を任命できます。京都御所のメンバーが就いている役職は選べません。</p>`;
 if(!data)return html+`<p class="court-empty"${s.officeLoading?' aria-busy="true"':''}>${s.officeLoading?'太政官の任命状況を確認しています。':'任命状況を取得できていません。「最新情報を取得」で確認してください。'}</p></section>`;
 html+=`<div class="court-office-grid" aria-label="太政官の在任状況">${data.offices.map(row=>`<article class="court-office-row${row.id===s.drafts.office?' is-selected':''}" data-stable-key="court-office-${row.id}"><header><h3>${esc(row.title)}</h3><span class="court-office-status${row.available?' is-available':''}">${row.blockedByKyoto?'京都御所で在任中':row.holder?'任命済み':'空席'}</span></header><div class="court-office-holder">${row.holder?`<strong>${esc(row.holder.name)}</strong><span>${esc(row.holder.homeCastleName)}</span>`:row.blockedByKyoto?'<p>京都御所の官職を優先するため、任命できません。</p>':'<p>他の拠点の領主を任命できます。</p>'}</div>${row.holder?`<button class="button" data-court-action="confirm-office-dismiss" data-court-office="${row.id}"${disabled(wait)}>解任内容を確認</button>`:`<button class="button" data-court-action="select-office" data-court-office="${row.id}" aria-pressed="${row.id===s.drafts.office}"${disabled(wait||!row.available)}>${row.blockedByKyoto?'京都御所で在任中':row.id===s.drafts.office?'選択中':'この役職を選ぶ'}</button>`}</article>`).join('')}</div><p class="court-office-policy">京都御所の昇進などで役職が重なった場合は、京都御所を優先して他拠点の任命を解除します。別の領主・役職へ変更する場合は、現在の任命を先に解任してください。</p>`;
 const candidates=[...data.candidates];if(s.officeCandidate&&!candidates.some(row=>row.id===s.officeCandidate.id))candidates.unshift(s.officeCandidate);
 const selectedOffice=data.offices.find(row=>row.id===s.drafts.office),candidate=s.officeCandidate;
 html+=`<div class="court-office-appointment" data-stable-key="court-office-appointment"><h3>空席へ任命する</h3><label for="court-office-select">任命する役職</label><select id="court-office-select"${disabled(wait)}><option value="">役職を選択してください</option>${data.offices.map(row=>`<option value="${row.id}"${row.id===s.drafts.office?' selected':''}${disabled(!row.available)}>${esc(row.title)}${row.blockedByKyoto?' · 京都御所で在任中':row.holder?' · 任命済み':' · 空席'}</option>`).join('')}</select><form class="court-office-search" data-court-form="office-search"><label for="court-office-search">任命候補を名前で検索</label><div><input id="court-office-search" type="search" maxlength="80" value="${esc(s.drafts.officeSearch)}" placeholder="領主名を入力" aria-describedby="court-office-search-note"${disabled(locked)}><button class="button small" type="button" data-court-action="office-candidates" aria-haspopup="dialog"${disabled(wait)}>一覧</button><button class="button" type="submit"${disabled(wait)}>${s.officeLoading?'検索中…':'候補を検索'}</button></div><p id="court-office-search-note">${data.query?`「${esc(data.query)}」の検索結果`:'他拠点の任命候補'} · ${num(data.candidates.length)}人${data.hasMore?'以上。名前を入力して候補を絞り込めます。':'。'}拠点が確認できる領主を表示しています。</p></form><label for="court-office-player">任命する領主</label><select id="court-office-player"${disabled(wait||!candidates.length)}><option value="">${candidates.length?'領主を選択してください':'該当する任命候補がいません'}</option>${candidates.map(row=>`<option value="${esc(row.id)}"${row.id===s.drafts.officePlayer?' selected':''}${disabled(!!row.courtOffice)}>${esc(row.name)} · ${esc(row.homeCastleName)}${row.courtOffice?' · '+esc(row.courtOffice.title)+' 在任中':''}${!data.candidates.some(item=>item.id===row.id)?' · 選択中':''}</option>`).join('')}</select>${candidate?`<p class="court-office-selection">選択中：<strong>${esc(candidate.name)}</strong> · ${esc(candidate.homeCastleName)}${candidate.courtOffice?' · '+esc(candidate.courtOffice.title)+' 在任中（先に解任してください）':''}</p>`:''}<button class="button gold" data-court-action="confirm-office"${disabled(wait||!selectedOffice?.available||!candidate||!!candidate.courtOffice)}>任命内容を確認</button></div>`;
 if(s.confirmation?.kind==='office'){
  const c=s.confirmation,stale=data.revision!==c.expectedRevision;
  html+=`<section class="court-confirm" data-stable-key="court-office-confirm" tabindex="-1" aria-label="太政官の${c.action==='dismiss'?'解任':'任命'}確認"><h3>${esc(c.name)}${c.action==='dismiss'?'の'+esc(c.title)+'を解任':'を'+esc(c.title)+'に任命'}しますか</h3><p>${esc(c.homeCastleName)} · ${esc(c.title)}</p><p>${c.action==='dismiss'?'この領主から選択した太政官の役職を外します。領主の拠点やゲームの進行は変わりません。':'太政大臣の権限で、この領主に選択した役職を任命します。確定時にも空席と領主の所属を確認します。'}</p>${stale?'<p class="court-office-stale" role="alert">任命状況が更新されました。戻って最新の一覧から確認し直してください。</p>':''}<div class="court-actions"><button class="button" data-court-action="cancel"${disabled(locked)}>戻る</button><button class="button gold" data-court-action="commit-office"${disabled(wait||stale)}>${c.action==='dismiss'?'解任を確定':'任命を確定'}</button></div></section>`;
 }
 return html+'</section>';
}
function markup(s){
 const info=s.info,requirement=info?.requirement||fallbackRequirement,locked=s.sending||!!s.pending,eligible=info?.eligible===true;
 let html=`<section class="court-page" aria-label="京都御所"><header class="court-heading" data-stable-key="court-heading"><div><span class="eyebrow">KYOTO IMPERIAL COURT</span><h1>京都御所</h1><p>位階を重ね、朝廷との交流へ。</p></div><button class="button" data-court-action="reload"${disabled(s.loading||s.sending||!s.context.authenticated)}>${s.loading?'確認中…':'最新情報を取得'}</button></header><p class="court-feedback${s.error?' is-error':''}" role="status" data-stable-key="court-feedback">${esc(s.error||s.message||' ')}</p>`;
 if(!s.context.authenticated)return html+`<section class="court-panel court-admission"><h2>${s.context.pending?'領主の接続を確認しています':s.context.banned?'参内を利用できません':'京都御所への参内'}</h2><p>${s.context.banned?'領主の利用状態を交流の間で確認してください。':`参内は${esc(requirement.rankName)}（総合評価 ${num(requirement.minScore)}点）から。接続中の領主の評価を確認して案内します。`}</p><button class="button gold" data-court-action="register">交流の間で領主を確認</button></section></section>`;
 if(!info)return html+'<section class="court-panel court-admission" aria-busy="true"><h2>参内資格を確認しています</h2><p>最新の領主情報と御所の成長を読み込んでいます。</p></section></section>';
 html+=`<section class="court-admission court-panel" data-stable-key="court-admission"><div><span class="eyebrow">${eligible?'ADMISSION CONFIRMED':'COURT ADMISSION'}</span><h2>${eligible?'参内できます':`${esc(requirement.rankName)}から参内できます`}</h2><p>参内に必要な位階：${esc(requirement.rankName)} · 総合評価 ${num(requirement.minScore)}点</p><p>現在：${esc(info.evaluation?.rankName||'評価を確認中')} · ${num(info.evaluation?.score)}点${global.SengokuPublicCourt?.selfSlot?.(info.self.id)||''}</p></div><div class="court-palace-level"><span>御所の城郭</span><b>Lv.${num(info.palace.level)} <small>/ 128</small></b><span>共同普請 ${num(info.palace.jobCount)}件</span></div></section>`;
 if(info.palace.control)html+=`<section class="court-panel court-palace-control" data-stable-key="court-palace-control"><span class="eyebrow">京都御所の支配</span><h2>${esc(info.palace.control.governmentName)}の支配下</h2><p>支配領主：${esc(info.palace.control.controller.name)}</p><p>幕府開設申請の承認期限が過ぎたため、京都御所はこの幕府の支配下にあります。</p></section>`;
 if(isSuccession(s.pending))html+=`<section class="court-pending" data-stable-key="court-succession-recovery"><h2>${s.pending.kind==='succession-legacy'?'以前の譲位結果を確認':'皇位継承の通信結果を確認'}</h2><p>同じ受付番号で操作結果を確認します。通信結果が未確認の間は、別の指名や認証を送信しません。</p><button class="button gold" data-court-action="retry"${disabled(s.sending)}>${s.sending?'確認中…':'同じ操作の結果を確認する'}</button></section>`;
 if(!eligible)return html+'<p class="court-note">領国・内政・武将などを育て、最新の進行を同期すると参内資格を更新できます。</p><div class="court-actions"><button class="button" data-view="town">城下町へ</button><button class="button" data-court-action="reload">参内資格を再確認</button></div></section>';
 html+=`<nav class="court-tabs" aria-label="御所の案内">${Object.entries(sections).filter(([key])=>key==='overview'||key==='chat'&&info.features.conversation||key==='audiences'&&info.features.audience||key==='management'&&info.features.roster).map(([key,label])=>`<button type="button" data-court-action="section" data-court-section="${key}" aria-pressed="${s.section===key}"${disabled(locked)}>${label}</button>`).join('')}</nav>`;
 if(s.pending&&!isSuccession(s.pending))html+=`<section class="court-pending" data-stable-key="court-pending"><h2>${s.sending?'内容を届けています':'送信結果の確認'}</h2><p>同じ受付番号で結果を確認します。確認中の内容は保持されています。</p><button class="button gold" data-court-action="retry"${disabled(s.sending)}>${s.sending?'確認中…':'同じ内容の結果を確認'}</button></section>`;
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
  html+=`<section class="court-panel" data-stable-key="court-management"><span class="eyebrow">PRIVATE COURT ADMINISTRATION</span><h2>朝廷の役職と功績</h2><p class="court-note">この名簿と任命は、権限を持つ朝廷の担当者だけが確認できます。一般の参内画面に担当領主の対応表は表示されません。</p><div class="court-roster">${s.roster?s.roster.rows.map(row=>`<article data-stable-key="court-roster-${esc(row.id)}"><div><h3 class="court-roster-name">${global.SengokuCityHonors?.slot?.(row.id)||''}${esc(row.name)} ${global.SengokuPublicCourt?.slot?.(row.id)||officeTitle(row.title)}</h3></div><div><b>${num(row.merit)}点</b><small>普請完成 ${num(row.completedUpgrades)}件</small></div></article>`).join('')||'<p class="court-empty">任命できる担当者はいません。</p>':'<p class="court-empty">名簿を確認しています。</p>'}</div><details class="court-thresholds"><summary>完成した普請による役職</summary><ul>${info.thresholds.map(row=>`<li>${officeTitle(row.title)} <b>${num(row.minMerit)}点〜</b></li>`).join('')}</ul><p>功績は完了した共同普請に応じて加算されます。太政大臣は固定役職です。天皇は太政大臣の任命、または現天皇の指名を太政大臣が認証することで就任します。</p></details>${info.self.canAppoint&&s.roster?`<label for="court-leader-select">天皇の任命先</label><select id="court-leader-select"${disabled(locked)}><option value="">天皇を未任命にする</option>${s.roster.rows.filter(row=>row.termId).map(row=>`<option value="${esc(row.id)}"${row.id===s.drafts.leader?' selected':''}>${esc(row.name)} · ${esc(row.title)}</option>`).join('')}</select><button class="button gold" data-court-action="confirm-leader"${disabled(locked||!!s.drafts.leader&&!!s.successionReview?.pending.length)}>任命内容を確認</button>${s.successionReview?.pending.length?'<p class="court-note">有効な後継者指名があります。後継者を就任させる場合は、上の皇位継承の認証で確認してください。</p>':''}`:''}${s.confirmation?.kind==='leader'?`<section class="court-confirm" tabindex="-1" aria-label="天皇の任命確認"><h3>${s.confirmation.targetPlayerId?namedLord({id:s.confirmation.targetPlayerId,name:s.confirmation.name})+'を天皇に任命しますか':'天皇の任命を解除しますか'}</h3><p>現在の任命を更新します。担当者の任期が終了すると任命も解除されます。</p><div class="court-actions"><button class="button" data-court-action="cancel"${disabled(locked)}>戻る</button><button class="button gold" data-court-action="appoint"${disabled(locked)}>確定する</button></div></section>`:''}</section>`;
  if(info.self.canAppoint)html+=regentManagement(s,locked)+officeManagement(s,locked);
 }
 return html+'</section>';
}
function mount(host,options={}){
 if(!host)return{refresh(){},dispose(){}};let alive=true,lastKey='',controls=new Map(),focusConfirmation=false;
 function render(s){if(!alive)return;const key=s.context.identity,html=markup(s),top=host.closest?.('main')?.scrollTop,main=host.closest?.('main');if(global.SengokuStableDOM){const result=global.SengokuStableDOM.patch(host,html,{key:['court',key]});if(result.artwork)global.SengokuArt?.schedule?.(host);}else if(host.innerHTML!==html)host.innerHTML=html;
  const values=new Map([['court-chat-input',s.drafts.chat],['court-audience-title',s.drafts.title],['court-audience-body',s.drafts.body],['court-reply-input',s.drafts.reply],['court-leader-select',s.drafts.leader],['court-successor-select',s.drafts.successor],['court-office-select',s.drafts.office],['court-office-player',s.drafts.officePlayer],['court-office-search',s.drafts.officeSearch],['court-regent-search',s.drafts.regentSearch],['court-regent-player',s.drafts.regentPlayer]]);for(const [id,value]of values)if(key!==lastKey||controls.get(id)!==value){const node=host.querySelector('#'+id);if(node&&node.value!==value)node.value=value;}controls=values;lastKey=key;if(main&&main.scrollTop!==top)main.scrollTop=top;if(focusConfirmation&&s.confirmation){const panel=host.querySelector('.court-confirm');panel?.focus?.({preventScroll:true});panel?.scrollIntoView?.({block:'nearest',inline:'nearest',behavior:'instant'});}focusConfirmation=false;options.onChange?.(s);
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

 const click=event=>{const button=event.target.closest?.('[data-court-action]');if(!button||!host.contains(button)||button.disabled)return;event.preventDefault();const action=button.dataset.courtAction;if(action==='event-room'&&controller.snapshot().info?.features.eventRoom)void global.SengokuCourtEvents?.open?.();else if(action==='shogunate')void global.SengokuShogunate?.open?.();else if(action==='confirm-succession'){focusConfirmation=true;controller.confirmSuccession();focusConfirmation=false;}else if(action==='commit-succession')void controller.submit('succession');else if(['confirm-succession-approve','confirm-succession-reject','confirm-succession-cancel'].includes(action)){focusConfirmation=true;controller.confirmSuccessionDecision(action.replace('confirm-succession-',''),button.dataset.courtNomination);focusConfirmation=false;}else if(action==='commit-succession-decision')void controller.submit(controller.snapshot().confirmation?.kind);else if(action==='regent-candidates')browseCandidates(button,'regent');else if(action==='confirm-regent'||action==='confirm-regent-dismiss'){focusConfirmation=true;controller.confirmRegent(action==='confirm-regent-dismiss'?'dismiss':'appoint');focusConfirmation=false;}else if(action==='commit-regent')void controller.submit('regent');else if(action==='office-candidates')browseCandidates(button);else if(action==='reload')void controller.load();else if(action==='section')controller.selectSection(button.dataset.courtSection);else if(action==='thread')controller.openThread(button.dataset.courtId);else if(action==='back')controller.back();else if(action==='more')void controller.load({more:true});else if(action==='older')void controller.load({older:true});else if(action==='retry')void controller.submit();else if(action==='register')options.onRegister?.();else if(action==='confirm-leader'){focusConfirmation=true;controller.confirmLeader();focusConfirmation=false;}else if(action==='cancel')controller.cancel();else if(action==='appoint')void controller.submit('leader');else if(action==='select-office')controller.update('office',button.dataset.courtOffice);else if(action==='confirm-office'){focusConfirmation=true;controller.confirmOffice();focusConfirmation=false;}else if(action==='confirm-office-dismiss'){focusConfirmation=true;controller.confirmOffice('dismiss',button.dataset.courtOffice);focusConfirmation=false;}else if(action==='commit-office')void controller.submit('office');};
 const input=event=>{const field={'court-chat-input':'chat','court-audience-title':'title','court-audience-body':'body','court-reply-input':'reply','court-leader-select':'leader','court-successor-select':'successor','court-office-select':'office','court-office-player':'officePlayer','court-office-search':'officeSearch','court-regent-search':'regentSearch','court-regent-player':'regentPlayer'}[event.target.id];if(field)controller.update(field,event.target.value);};
 const submit=event=>{const form=event.target.closest?.('[data-court-form]');if(!form||!host.contains(form))return;event.preventDefault();if(form.dataset.courtForm==='regent-search')controller.searchRegent();else if(form.dataset.courtForm==='office-search')controller.searchOffices();else void controller.submit(form.dataset.courtForm);};
 host.addEventListener('click',click);host.addEventListener('input',input);host.addEventListener('change',input);host.addEventListener('submit',submit);mounts.add(controller);controller.refresh();
 return{controller,refresh:()=>controller.refresh(),dispose(){alive=false;mounts.delete(controller);controller.dispose();host.removeEventListener('click',click);host.removeEventListener('input',input);host.removeEventListener('change',input);host.removeEventListener('submit',submit);global.SengokuStableDOM?.forget?.(host);}};
}
const api={createController,mount,markup,cleanInfo,cleanMessage,cleanThread,cleanOffices,cleanRegent,cleanSuccession,cleanSuccessionNomination,cleanSuccessionReview,cleanSuccessionResult,refreshAccess(){for(const controller of mounts)controller.refresh();}};global.SengokuCourt=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
