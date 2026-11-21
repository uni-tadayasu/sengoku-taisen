/* Private recruitment, reconnaissance and stationed forces. The campaign bridge
 * owns every write; an uncertain operation retains its original request ID. */
(function(global){
 'use strict';
 const KEY='sengoku-covert-pending-v1:',PAGE_SIZE=12,ACTIONS=['hire','dispatch','recall','retaliate'];
 const RESOURCE_NAMES={gold:'金銭',rice:'兵糧'},UNIT_NAMES={ninja:'忍者',ashigaru:'足軽'};
 const clone=value=>JSON.parse(JSON.stringify(value));
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const integer=(value,min=0,max=1e12)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
 const identifier=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
 const num=value=>Number.isFinite(value)?Math.floor(value).toLocaleString('ja-JP'):'—';
 const text=value=>typeof value==='string'?value.slice(0,200):'';
 const targetKey=target=>target?JSON.stringify([target.kind,target.castleId,target.kind==='player'?target.playerId:'']):'';
 const targetBody=target=>target?.kind==='player'?{kind:'player',castleId:target.castleId,playerId:target.playerId}:{kind:'castle',castleId:target?.castleId};
 const targetOK=target=>target&&['castle','player'].includes(target.kind)&&identifier(target.castleId)&&(target.kind!=='player'||identifier(target.playerId));
 function cleanTarget(target){if(!targetOK(target))return null;return{...targetBody(target),name:text(target.name)||target.castleId,playerName:text(target.playerName),region:text(target.region),available:target.available!==false,reason:text(target.reason)};}
 function cleanSnapshot(value){
  if(!value||value.version!==1||!identifier(value.campaignId)||!integer(value.sequence)||!value.rules||!['sources','targets','stations','reports','incidents','history'].every(key=>Array.isArray(value[key])))return null;
  const rules=value.rules;if(!integer(rules.minCount,1)||!integer(rules.maxCount,rules.minCount)||!integer(rules.commandCost)||!integer(rules.stationLimit,1)||!['scout','station','retaliate'].every(key=>integer(rules[key]?.riceBase)&&Number.isFinite(rules[key]?.ricePerUnit)&&rules[key].ricePerUnit>=0))return null;
  const sources=value.sources.filter(s=>s&&identifier(s.castleId)&&UNIT_NAMES[s.unitType]&&['reserve','stationed','capacity'].every(k=>integer(s[k]))&&integer(s.hireCost?.gold)&&integer(s.hireCost?.rice)).map(s=>({castleId:s.castleId,name:text(s.name)||s.castleId,unitType:s.unitType,unitName:UNIT_NAMES[s.unitType],reserve:s.reserve,stationed:s.stationed,capacity:s.capacity,hireCost:{gold:s.hireCost.gold,rice:s.hireCost.rice},available:s.available===true}));
  const targets=value.targets.map(cleanTarget).filter(Boolean),seen=new Set();
  const stations=value.stations.filter(s=>s&&identifier(s.id)&&identifier(s.sourceCastleId)&&UNIT_NAMES[s.unitType]&&integer(s.count,1)&&targetOK(s.target)&&integer(s.createdElapsedMs)).map(s=>({id:s.id,sourceCastleId:s.sourceCastleId,unitType:s.unitType,unitName:UNIT_NAMES[s.unitType],count:s.count,target:cleanTarget(s.target),createdElapsedMs:s.createdElapsedMs}));
  const incidents=value.incidents.filter(i=>i&&identifier(i.id)&&identifier(i.sourceCastleId)&&integer(i.occurredElapsedMs)&&typeof i.available==='boolean').map(i=>({id:i.id,sourceCastleId:i.sourceCastleId,kind:i.kind==='field'?'field':'cpu',occurredElapsedMs:i.occurredElapsedMs,available:i.available,expiresElapsedMs:integer(i.expiresElapsedMs)?i.expiresElapsedMs:null,stationIds:Array.isArray(i.stationIds)?i.stationIds.filter(identifier):null}));
  const reports=value.reports.filter(r=>r&&identifier(r.id)&&identifier(r.sourceCastleId)&&targetOK(r.target)&&r.snapshot&&typeof r.snapshot==='object').map(r=>({id:r.id,sourceCastleId:r.sourceCastleId,target:cleanTarget(r.target),observedElapsedMs:r.observedElapsedMs,snapshot:cleanIntelligence(r.snapshot)}));
  const history=value.history.filter(r=>r&&ACTIONS.includes(r.action)).map(r=>clone(r));
  return{version:1,campaignId:value.campaignId,sequence:value.sequence,rules:clone(rules),sources,targets:targets.filter(t=>{const key=targetKey(t);if(seen.has(key))return false;seen.add(key);return true;}),stations,reports,incidents,history};
 }
 function cleanIntelligence(snapshot){
  const result={};for(const key of ['level','troops','garrison','wall','defensePower'])if(integer(snapshot[key]))result[key]=snapshot[key];
  if(snapshot.resources){result.resources={};for(const key of ['gold','rice','wood','stone'])if(integer(snapshot.resources[key]))result.resources[key]=snapshot.resources[key];}
  if(snapshot.army){result.army={};for(const key of ['count','lead','valor','intellect','politics'])if(integer(snapshot.army[key]))result.army[key]=snapshot.army[key];}
  return result;
 }
 function payloadOK(action,data){
  if(!ACTIONS.includes(action)||!data||!identifier(data.requestId)||!identifier(data.campaignId)||!integer(data.sequence))return false;
  if(action==='hire'||action==='dispatch'){if(!identifier(data.sourceCastleId)||!integer(data.count,1,20000))return false;}
  if(action==='dispatch'&&(!['scout','station'].includes(data.mode)||!targetOK(data.target)))return false;
  if((action==='recall'||action==='retaliate')&&!identifier(data.stationId))return false;
  return action!=='retaliate'||identifier(data.incidentId);
 }
 function cleanReceipt(receipt,action,data){
  if(!payloadOK(action,data)||!receipt||receipt.action!==action||receipt.requestId!==data.requestId||receipt.campaignId!==data.campaignId||receipt.sequence!==data.sequence)return null;
  for(const field of ['sourceCastleId','count','mode','stationId','incidentId'])if(Object.hasOwn(data,field)&&receipt[field]!==data[field])return null;
  if(data.target&&targetKey(receipt.target)!==targetKey(data.target))return null;
  if(!integer(receipt.foodCost)||receipt.commandCost!==(action==='recall'?0:1)||receipt.goldCost!==undefined&&!integer(receipt.goldCost))return null;
  if(action==='dispatch'&&(!receipt.report||!targetOK(receipt.report.target)||targetKey(receipt.report.target)!==targetKey(data.target)||receipt.report.sourceCastleId!==data.sourceCastleId||!receipt.report.snapshot||data.mode==='station'&&!identifier(receipt.stationId)))return null;
  if(action==='retaliate'){const b=receipt.battle;if(!b||typeof b.won!=='boolean'||b.captured!==false||!integer(b.deployed,1)||!integer(b.ourLost,0,b.deployed)||b.survivors!==b.deployed-b.ourLost||!integer(b.attackPower)||!integer(b.defensePower)||!integer(b.defenderLost?.troops)||!integer(b.defenderLost?.garrison))return null;}
  return clone(receipt);
 }
 function createController(options={}){
  const getGame=options.getGame||(()=>null),getStatus=options.getStatus||(()=>({writable:false,readable:false,reason:'本拠を確認しています。'}));
  const loadRequest=options.load,mutate=options.mutate,now=options.now||Date.now,uuid=options.uuid||(()=>global.crypto.randomUUID());
  let storage;try{storage=options.storage??global.localStorage;}catch(_){}
  let disposed=false,stamp='',generation=0,flight=null,loadFlight=null,lastLoaded=0;
  const blank=()=>({covert:null,sourceId:'',hireInput:'10',countInput:'10',mode:'scout',targetId:'',query:'',filter:'all',sort:'name',page:1,incidentSelections:{},confirmation:null,pending:null,loading:false,sending:false,error:'',message:'',receipt:null});
  let state=blank();
  function context(){const game=getGame(),status=getStatus()||{},ownerId=String(status.ownerId||'local'),campaignId=game?.state?.walking?.campaignId||game?.covertStatus?.().campaignId||'',linked=status.linked===true;return{...status,game,ownerId,campaignId,linked,readable:status.readable!==false,writable:status.writable===true,online:status.online!==false,stamp:JSON.stringify([ownerId,campaignId,status.stamp??'',linked])};}
  const key=who=>KEY+encodeURIComponent(who.ownerId)+':'+encodeURIComponent(who.campaignId);
  function readPending(who){try{const saved=JSON.parse(storage?.getItem(key(who))||'null');return saved?.ownerId===who.ownerId&&saved.campaignId===who.campaignId&&payloadOK(saved.action,saved.data)?saved:null;}catch(_){return null;}}
  function persist(who,record){if(!storage?.setItem)throw Error('派遣の操作記録を保存できません。ブラウザの保存設定を確認してください。');const value=JSON.stringify(record);storage.setItem(key(who),value);if(storage.getItem(key(who))!==value)throw Error('派遣の操作記録を保存できませんでした。');}
  function clear(who,record){try{if(readPending(who)?.data.requestId===record.data.requestId)storage.removeItem(key(who));}catch(_){} }
  function adopt(value,who){const covert=cleanSnapshot(value);if(!covert||covert.campaignId!==who.campaignId)return false;if(state.covert&&covert.sequence<state.covert.sequence)return false;state.covert=covert;const sources=covert.sources.filter(s=>s.available);if(!sources.some(s=>s.castleId===state.sourceId))state.sourceId=sources[0]?.castleId||'';if(state.targetId&&!covert.targets.some(t=>targetKey(t)===state.targetId))state.targetId='';return true;}
  function identity(){const who=context();if(stamp!==who.stamp){stamp=who.stamp;generation++;flight=null;loadFlight=null;lastLoaded=0;state=blank();state.pending=readPending(who);if(!who.linked)adopt(who.game?.covertStatus?.(),who);if(state.pending){const d=state.pending.data;state.sourceId=d.sourceCastleId||state.sourceId;state.hireInput=String(d.count||10);state.countInput=String(d.count||10);state.mode=d.mode||'scout';state.targetId=d.target?targetKey(d.target):'';}}return who;}
  const current=(generationAtStart,expected)=>!disposed&&generation===generationAtStart&&context().stamp===expected;
  const editable=()=>!disposed&&!state.sending&&!state.pending;
  function resources(who){return{gold:who.game?.state?.resources?.gold||0,rice:who.game?.state?.resources?.rice||0,command:who.game?.state?.command||0};}
  function availableIncidents(station,who=context()){
   if(!station||!state.covert?.sources.some(s=>s.castleId===station.sourceCastleId&&s.available))return[];
   const elapsed=who.game?.state?.worldClock?.elapsedMs??who.game?.state?.realtime?.elapsedMs??0;
   return state.covert.incidents.filter(i=>i.available&&i.sourceCastleId===station.sourceCastleId&&i.occurredElapsedMs>=station.createdElapsedMs&&(!i.stationIds||i.stationIds.includes(station.id))&&(i.expiresElapsedMs===null||i.expiresElapsedMs>elapsed));
  }
  function preview(action,extra={},who=context()){
   const covert=state.covert,source=covert?.sources.find(s=>s.castleId===state.sourceId&&s.available),balance=resources(who),rules=covert?.rules;
   const fail=message=>({ok:false,action,message,costs:null});
   if(!covert)return fail(state.loading?'部隊を読み込んでいます。':'部隊の最新情報を確認してください。');
   const costs={gold:0,rice:0,command:0};let data={},label='',description='',unitName=source?.unitName||'兵';
   if(action==='hire'){
    if(!source)return fail('所有する大都市拠点が必要です。');
    const count=Number(state.hireInput.trim()===''?NaN:state.hireInput),space=Math.max(0,source.capacity-source.reserve-source.stationed),maximum=Math.min(rules.maxCount,space);
    if(maximum<rules.minCount)return fail('雇用上限に達しています。兵舎などを増築すると上限が増えます。');
    if(!integer(count,rules.minCount,maximum))return fail(`雇用人数を${num(rules.minCount)}〜${num(maximum)}人で指定してください。`);
    costs.gold=source.hireCost.gold*count;costs.rice=source.hireCost.rice*count;costs.command=rules.commandCost;
    data={sourceCastleId:source.castleId,count};label=`${source.name}で${unitName}を雇用`;description=`${unitName}${num(count)}人を雇い、待機部隊に加えます。`;
   }else if(action==='dispatch'){
    if(!source)return fail('所有する大都市拠点が必要です。');
    const target=covert.targets.find(t=>targetKey(t)===state.targetId),count=Number(state.countInput.trim()===''?NaN:state.countInput);
    if(!target)return fail('派遣する拠点を一覧から選んでください。');
    if(!target.available)return fail(target.reason||'この拠点には現在派遣できません。');
    if(target.kind==='player'&&!who.linked)return fail('他の領主への派遣には領主登録と接続が必要です。');
    if(source.reserve<rules.minCount)return fail('派遣元に待機部隊がいません。先に兵を雇用してください。');
    if(!integer(count,rules.minCount,Math.min(rules.maxCount,source.reserve)))return fail(`派遣人数を${num(rules.minCount)}〜${num(Math.min(rules.maxCount,source.reserve))}人で指定してください。`);
    if(state.mode==='station'&&covert.stations.length>=rules.stationLimit)return fail('常駐部隊の上限です。いずれかの部隊を帰還させてください。');
    const rule=rules[state.mode];costs.rice=rule.riceBase+Math.ceil(count*rule.ricePerUnit);costs.command=rules.commandCost;
    data={sourceCastleId:source.castleId,count,mode:state.mode,target:targetBody(target)};label=`${target.name}へ${state.mode==='scout'?'調査':'常駐'}派遣`;
    description=state.mode==='scout'?`${source.name}から${unitName}${num(count)}人が調査へ向かい、報告後に帰還します。報告はあなた専用です。`:`${source.name}の${unitName}${num(count)}人を常駐させます。派遣元への攻撃後に、ここで反撃を指示できます。`;
   }else{
    const station=covert.stations.find(s=>s.id===extra.stationId);if(!station)return fail('常駐中の部隊を選んでください。');unitName=station.unitName;data={stationId:station.id};
    if(action==='recall'){label=`${station.target.name}から帰還`;description=`${unitName}${num(station.count)}人が派遣元の待機部隊に戻ります。追加の費用はありません。`;}
    else if(action==='retaliate'){
     if(!covert.sources.some(s=>s.castleId===station.sourceCastleId&&s.available))return fail('派遣元の領有を失っているため反撃できません。部隊を帰還させることはできます。');
     const incidentId=extra.incidentId||state.incidentSelections[station.id]||availableIncidents(station,who)[0]?.id,incident=availableIncidents(station,who).find(i=>i.id===incidentId);
     if(!incident)return fail('この部隊の常駐後に、派遣元が攻撃を受けると反撃を指示できます。');
     if(station.target.kind==='castle'&&who.game?.ownedCastles?.().some(c=>c.id===station.target.castleId))return fail('自領の拠点には反撃できません。');
     data.incidentId=incident.id;costs.rice=rules.retaliate.riceBase+Math.ceil(station.count*rules.retaliate.ricePerUnit);costs.command=rules.commandCost;
     label=`${station.target.name}で反撃`;description=`常駐中の${unitName}${num(station.count)}人で反撃します。兵を失う可能性があります。この被攻撃記録は1度だけ使えます。城の占領や資源の獲得はありません。`;
    }else return fail('操作を確認してください。');
   }
   const base={action,data,costs,label,description,unitName};
   if(balance.command<costs.command)return{...base,ok:false,message:`指令が${num(costs.command)}必要です。通常の回復をお待ちください。`};
   for(const key of ['gold','rice'])if(balance[key]<costs[key])return{...base,ok:false,message:`${RESOURCE_NAMES[key]}が${num(costs[key])}必要です。`};
   return{...base,ok:true,message:''};
  }
  const fingerprint=(who,p)=>JSON.stringify([who.campaignId,state.covert?.sequence,p.action,p.data,p.costs]);
  function snapshot(){
   const who=context(),covert=state.covert,source=covert?.sources.find(s=>s.castleId===state.sourceId&&s.available),balance=resources(who),query=state.query.trim().toLocaleLowerCase('ja-JP');
   const filtered=(covert?.targets||[]).filter(t=>(state.filter==='all'||t.kind===state.filter)&&(!query||[t.name,t.playerName,t.region,t.castleId].join(' ').toLocaleLowerCase('ja-JP').includes(query))).sort((a,b)=>state.sort==='kind'?a.kind.localeCompare(b.kind)||a.name.localeCompare(b.name,'ja'):state.sort==='owner'?a.playerName.localeCompare(b.playerName,'ja')||a.name.localeCompare(b.name,'ja'):a.name.localeCompare(b.name,'ja')||a.playerName.localeCompare(b.playerName,'ja'));
   const pages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE)),page=Math.max(1,Math.min(state.page,pages)),hireMax=source?Math.max(0,Math.min(covert.rules.maxCount,source.capacity-source.reserve-source.stationed,...Object.entries(source.hireCost).filter(([,v])=>v>0).map(([k,v])=>Math.floor(balance[k]/v)))):0;
   return{...clone(state),status:{writable:who.writable,readable:who.readable,linked:who.linked,online:who.online,reason:who.reason||''},resources:balance,source,hireMax,dispatchMax:source?Math.min(covert.rules.maxCount,source.reserve):0,target:covert?.targets.find(t=>targetKey(t)===state.targetId)||null,targets:filtered.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE),targetCount:filtered.length,totalTargets:covert?.targets.length||0,page,pages,hirePreview:preview('hire',{},who),dispatchPreview:preview('dispatch',{},who),stations:(covert?.stations||[]).map(station=>({...station,incidents:availableIncidents(station,who),selectedIncident:state.incidentSelections[station.id]||availableIncidents(station,who)[0]?.id||'',recallPreview:preview('recall',{stationId:station.id},who),retaliatePreview:preview('retaliate',{stationId:station.id},who)}))};
  }
  function emit(){if(!disposed)options.onChange?.(snapshot());}
  function update(field,value){identity();if(!editable())return false;const allowed=['hireInput','countInput','query','filter','sort','mode','sourceId','targetId'];if(!allowed.includes(field))return false;
   if(field==='sourceId'&&!state.covert?.sources.some(s=>s.castleId===value&&s.available))return false;
   if(field==='targetId'&&!state.covert?.targets.some(t=>targetKey(t)===value))return false;
   if(field==='mode'&&!['scout','station'].includes(value)||field==='filter'&&!['all','castle','player'].includes(value)||field==='sort'&&!['name','kind','owner'].includes(value))return false;
   state[field]=String(value).slice(0,field==='query'?160:field==='targetId'?350:64);if(['filter','query','sort'].includes(field))state.page=1;else state.confirmation=null;state.error='';emit();return true;
  }
  function setPage(value){identity();const pages=snapshot().pages;state.page=Math.max(1,Math.min(Number(value)||1,pages));emit();}
  function setIncident(stationId,id){identity();if(!editable()||!availableIncidents(state.covert?.stations.find(s=>s.id===stationId)).some(i=>i.id===id))return false;state.incidentSelections[stationId]=id;state.confirmation=null;emit();return true;}
  function accessReason(who){return !who.writable?who.reason||'本拠の保存・同期状態を確認してください。':who.linked&&!who.online?'オンライン接続を確認してから操作してください。':'';}
  function prepare(action,extra={}){const who=identity();if(!editable())return false;const p=preview(action,extra,who),reason=accessReason(who);state.error='';if(reason||!p.ok){state.error=reason||p.message;emit();return false;}state.confirmation={...p,fingerprint:fingerprint(who,p)};emit();return true;}
  function cancel(){identity();if(!state.sending){state.confirmation=null;emit();}}
  async function reload(){
   const who=identity();if(disposed||state.sending)return false;if(loadFlight)return loadFlight;
   if(!who.linked){const ok=adopt(who.game?.covertStatus?.(),who);if(!ok)state.error='派遣部隊を読み込めませんでした。画面を再読み込みしてください。';emit();return ok;}
   if(!who.readable||!who.online||!loadRequest){state.error=who.reason||(!who.online?'接続を確認してから最新情報を取得してください。':'領主と端末同期を確認してください。');emit();return false;}
   const g=generation,expected=stamp;state.loading=true;emit();
   const task=(async()=>{await Promise.resolve();try{let response=await loadRequest();if(!current(g,expected))return false;
    if(response?.ok!==true)throw Error(response?.message||'派遣部隊の情報を確認できませんでした。');
    const complete=cleanSnapshot(response.covert);if(!complete||complete.campaignId!==who.campaignId)throw Error('派遣部隊の情報を確認できませんでした。再取得してください。');
    const seen=new Set();let cursor=response.covert.targetCursor;
    while(cursor){
     if(!identifier(cursor)||seen.has(cursor)||seen.size>=1000)throw Error('拠点一覧の続きを確認できませんでした。再取得してください。');seen.add(cursor);
     response=await loadRequest(cursor);if(!current(g,expected))return false;const page=cleanSnapshot(response?.covert);
     if(response?.ok!==true||!page||page.campaignId!==complete.campaignId||page.sequence!==complete.sequence)throw Error('拠点の状況が変わりました。最新情報を再取得してください。');
     complete.targets.push(...page.targets);cursor=response.covert.targetCursor;
    }
    if(!adopt(complete,who))throw Error('部隊の状況が変わりました。最新情報を再取得してください。');state.error='';return true;}catch(error){if(current(g,expected))state.error=error.message||'派遣部隊を読み込めませんでした。';return false;}finally{if(current(g,expected)){state.loading=false;loadFlight=null;lastLoaded=now();emit();}}})();loadFlight=task;return task;
  }
  async function submit(){
   const who=identity();if(disposed)return false;if(flight)return flight;const reason=accessReason(who);if(reason){state.error=reason;emit();return false;}
   let record=state.pending;if(!record){const confirmation=state.confirmation,p=confirmation?preview(confirmation.action,confirmation.data,who):null;if(!p?.ok||confirmation.fingerprint!==fingerprint(who,p)){state.confirmation=null;state.error='部隊や費用の状況が変わりました。操作内容をもう一度確認してください。';emit();return false;}
    record={ownerId:who.ownerId,campaignId:who.campaignId,action:p.action,data:{...clone(p.data),requestId:uuid(),campaignId:who.campaignId,sequence:state.covert.sequence}};
    if(!payloadOK(record.action,record.data)){state.error='派遣の操作番号を作成できませんでした。';emit();return false;}try{persist(who,record);}catch(error){state.error=error.message;emit();return false;}state.pending=record;
   }
   const g=generation,expected=stamp;state.sending=true;state.error='';state.message='';state.confirmation=null;emit();
   const task=(async()=>{await Promise.resolve();try{
    if(!mutate)throw Error('派遣部隊に接続できません。');const response=await mutate(record.action,clone(record.data));if(!current(g,expected))return false;
    if(response?.ok!==true)throw Object.assign(Error(response?.message||response?.error?.message||'派遣の操作を受け付けられませんでした。'),{status:response?.status||409,code:response?.code||response?.error?.code});
    const effective=identifier(response.effectiveRequestId)?{...record.data,requestId:response.effectiveRequestId}:record.data,receipt=cleanReceipt(response.result,record.action,effective);
    if(!receipt)throw Error('派遣の結果を確認できませんでした。同じ操作の結果を再確認してください。');
    const next=response.covert?clone(response.covert):(!who.linked?who.game?.covertStatus?.():null);if(who.linked&&next&&state.covert)next.targets=[...(next.targets||[]),...state.covert.targets];
    if(!adopt(next,who))throw Error('部隊の保存結果を確認しています。同じ操作の結果を再確認してください。');
    clear(who,record);state.pending=null;state.receipt=receipt;state.message=response.idempotent?'記録済みの結果を確認しました。兵と資源の追加消費はありません。':record.action==='hire'?'兵を雇用しました。派遣する拠点を選んでください。':record.action==='dispatch'?(record.data.mode==='scout'?'調査が完了しました。報告を受け取り、部隊は帰還しました。':'部隊が常駐しました。派遣元への攻撃に備えます。'):record.action==='recall'?'部隊が派遣元へ帰還しました。':'反撃の結果を反映しました。';lastLoaded=now();options.onResult?.(response);emit();return true;
   }catch(error){if(!current(g,expected))return false;state.error=error.message||'通信結果を確認できませんでした。';if(Number(error.status)>=400&&Number(error.status)<500&&![401,403,408,429].includes(Number(error.status))&&error.retryable!==true&&!['COVERT_SYNC_REQUIRED','COVERT_IDENTITY_REQUIRED','COVERT_CAMPAIGN_REQUIRED','STALE_IDENTITY'].includes(error.code)){clear(who,record);state.pending=null;lastLoaded=0;}return false;
   }finally{if(current(g,expected)){state.sending=false;flight=null;emit();}}})();flight=task;return task;
  }
  function refresh(){const who=identity();if(!who.linked)adopt(who.game?.covertStatus?.(),who);emit();if(who.linked&&!state.sending&&!loadFlight&&who.readable&&who.online&&(lastLoaded===0||now()-lastLoaded>45000))void reload();return snapshot();}
  identity();return{snapshot,refresh,reload,update,setPage,setIncident,prepare,cancel,submit,dispose(){disposed=true;generation++;flight=null;loadFlight=null;}};
 }
 function costsMarkup(costs={}){if(!costs)return '<p class="covert-cost-placeholder">人数と派遣内容を指定すると、費用を表示します。</p>';return `<div class="covert-costs" aria-label="消費する資源"><span>指令 <b>${num(costs.command||0)}</b></span><span>金銭 <b>${num(costs.gold||0)}</b></span><span>兵糧 <b>${num(costs.rice||0)}</b></span></div>`;}
 const targetLabel=target=>`${target?.name||'拠点'}${target?.kind==='player'?' · '+(target.playerName||'領主の拠点'):''}`;
 function clockLabel(value){if(!Number.isFinite(value))return'記録時';const date=global.SengokuWorldClock?.calendar?.(value);return date?`${date.year}年${date.month}月`:`共通時間 ${num(Math.floor(value/60000))}か月`;} 
 function unitArt(source){return global.SengokuArt?.castle?.(source.castleId,'covert-source-art',1)||'';}
 function resultMarkup(receipt){
  if(!receipt)return'';const names={hire:'雇用を完了',dispatch:receipt.mode==='scout'?'調査を完了':'常駐を開始',recall:'部隊が帰還',retaliate:'反撃の結果'},battle=receipt.battle;
  return `<section class="covert-result" data-covert-region="result" tabindex="-1" aria-label="派遣の結果"><span class="eyebrow">RESULT</span><h2>${esc(names[receipt.action]||'操作を完了')}</h2>${receipt.target?`<p>${esc(targetLabel(receipt.target))}</p>`:''}${battle?`<div class="covert-metrics"><span>戦果<b>${battle.won?'勝利':'撤退'}</b></span><span>出陣<b>${num(battle.deployed)}人</b></span><span>損失<b>${num(battle.ourLost)}人</b></span><span>生存<b>${num(battle.survivors)}人</b></span></div><p>相手の損失：兵 ${num(battle.defenderLost?.troops||0)}人・守備兵 ${num(battle.defenderLost?.garrison||0)}人。城の占領と資源の獲得はありません。生存兵は同じ拠点で常駐を続けます。</p>`:receipt.count?`<p>${num(receipt.count)}人の記録を反映しました。</p>`:''}${costsMarkup({gold:receipt.goldCost||0,rice:receipt.foodCost,command:receipt.commandCost})}</section>`;
 }
 function reportsMarkup(reports){
  const labels={level:'城郭Lv.',troops:'兵数',garrison:'守備兵',wall:'城壁',defensePower:'防衛力'};
  return `<section class="covert-panel covert-reports" data-covert-region="reports"><div class="covert-section-heading"><div><span class="eyebrow">INTELLIGENCE</span><h2>調査報告</h2></div><span>あなた専用 · ${reports.length}件</span></div>${reports.length?`<div class="covert-report-list">${reports.map(report=>`<details class="covert-report" data-covert-key="report-${esc(report.id)}"><summary><span><b>${esc(targetLabel(report.target))}</b><small>${esc(clockLabel(report.observedElapsedMs))}</small></span><span>報告を見る</span></summary><dl class="covert-intelligence">${Object.entries(labels).filter(([key])=>report.snapshot[key]!==undefined).map(([key,label])=>`<div><dt>${label}</dt><dd>${num(report.snapshot[key])}</dd></div>`).join('')}${Object.entries({gold:'金銭',rice:'兵糧',wood:'木材',stone:'石材'}).filter(([key])=>report.snapshot.resources?.[key]!==undefined).map(([key,label])=>`<div><dt>${label}</dt><dd>${num(report.snapshot.resources[key])}</dd></div>`).join('')}${Object.entries({count:'軍団の将',lead:'統率',valor:'武勇',intellect:'知略',politics:'政治'}).filter(([key])=>report.snapshot.army?.[key]!==undefined).map(([key,label])=>`<div><dt>${label}</dt><dd>${num(report.snapshot.army[key])}</dd></div>`).join('')}</dl><p>調査時点の情報です。最新の状況は再調査で確認できます。</p></details>`).join('')}</div>`:'<div class="covert-empty"><h3>まだ調査報告はありません</h3><p>拠点を選び、「情報を調べる」で部隊を派遣すると報告が届きます。</p></div>'}</section>`;
 }
 function markup(s){
  const c=s.covert,locked=s.sending||Boolean(s.pending),canWrite=s.status.writable&&(!s.status.linked||s.status.online),owned=c?.sources.filter(x=>x.available)||[],source=s.source;
  const disabled=value=>value?' disabled':'',hireReady=canWrite&&!locked&&s.hirePreview.ok,dispatchReady=canWrite&&!locked&&s.dispatchPreview.ok;
  const sourceName=id=>c?.sources.find(x=>x.castleId===id)?.name||id;
  let body=`<header class="covert-heading" data-covert-region="heading"><div><span class="eyebrow">RECONNAISSANCE & GARRISONS</span><h1>派遣部隊</h1><p>大都市で兵を雇い、各地を調査・警戒する。</p></div><span class="covert-private">あなた専用の記録</span></header><div class="covert-supplies" data-covert-region="supplies"><span>金銭 <b>${num(s.resources.gold)}</b></span><span>兵糧 <b>${num(s.resources.rice)}</b></span><span>指令 <b>${num(s.resources.command)}</b></span><button type="button" class="button small" data-covert-action="reload"${disabled(s.loading||s.sending)}>最新情報を${s.loading?'確認中…':'取得'}</button></div>`;
  if(s.status.reason||s.status.linked&&!s.status.online)body+=`<p class="notice" data-covert-region="access" role="status">${esc(s.status.reason||'オフラインです。接続後に派遣の操作を再開できます。')}</p>`;
  if(s.error)body+=`<p class="notice covert-error" data-covert-region="error" role="alert">${esc(s.error)}</p>`;
  if(s.message)body+=`<p class="notice covert-message" data-covert-region="message" role="status">${esc(s.message)}</p>`;
  if(s.pending)body+=`<section class="covert-pending" data-covert-region="action" tabindex="-1"><h2>${s.sending?'操作の結果を確認しています':'未確認の操作があります'}</h2><p>同じ操作番号で結果を確認します。兵と資源を二重に消費しません。</p><button type="button" class="button gold" data-covert-action="submit"${disabled(!canWrite||s.sending)}>${s.sending?'結果を確認中…':'同じ操作の結果を確認'}</button></section>`;
  else if(s.confirmation)body+=`<section class="covert-confirm" data-covert-region="action" tabindex="-1" aria-label="派遣部隊の最終確認"><span class="eyebrow">CONFIRM ORDER</span><h2>${esc(s.confirmation.label)}</h2><p>${esc(s.confirmation.description)}</p>${costsMarkup(s.confirmation.costs)}<div class="covert-actions"><button type="button" class="button" data-covert-action="cancel">準備に戻る</button><button type="button" class="button gold" data-covert-action="submit"${disabled(!canWrite)}>確定して${s.confirmation.action==='hire'?'雇用':s.confirmation.action==='recall'?'帰還':s.confirmation.action==='retaliate'?'反撃':'派遣'}</button></div></section>`;
  body+=`<details class="covert-help" data-covert-region="help"><summary>派遣部隊の仕組み・費用・反撃条件</summary><ol><li>所有する大都市を派遣元に選び、専用の兵を雇用します。江戸城は忍者、駿府城・二条城・大坂城・名古屋城は足軽です。軍団の兵士とは別に管理します。</li><li>「情報を調べる」は各地を調査し、あなた専用の報告を持ち帰ります。「常駐させる」は派遣先で待機します。</li><li>常駐後に派遣元が攻撃を受けると、${s.status.linked?'サーバーで確定した被攻撃（共通フィールドの合戦・サーバー進行中のCPU侵攻）':'その被攻撃記録'}を使って反撃を指示できます。1つの記録は1部隊・1回限り。反撃は自分で確定します。</li><li>雇用・派遣・反撃には表示された費用と指令を消費します。帰還は無料です。常駐中の兵も雇用上限に含みます。</li></ol>${!s.status.linked?'<p>この端末では天下地図の拠点を調査できます。他の領主の拠点への派遣は、交流から領主を登録して接続すると利用できます。</p>':''}</details>`;
  if(!c){body+=`<section class="covert-panel covert-empty" data-covert-region="loading" aria-busy="${s.loading}"><h2>${s.loading?'大都市拠点を確認しています':'部隊の情報を取得してください'}</h2><p>${s.loading?'所有する拠点と常駐部隊を読み込んでいます。':'接続と領主の保存状態を確認し、「最新情報を取得」を押してください。'}</p></section>`;return`<section class="covert-page" aria-label="派遣部隊">${body}</section>`;}
  if(!owned.length)body+=`<section class="covert-panel covert-locked" data-covert-region="locked"><span class="covert-lock-mark" aria-hidden="true">◆</span><div><span class="eyebrow">MAJOR CITY REQUIRED</span><h2>大都市拠点の確保が必要です</h2><p>現在、派遣元にできる大都市を所有していません。天下地図と共通フィールドで、二条城・大坂城・名古屋城などの大都市拠点を確認してください。</p><div class="covert-actions"><button type="button" class="button gold" data-view="map">天下地図を開く</button><button type="button" class="button" data-view="field">共通フィールドを開く</button></div></div></section>`;
  else{
   body+=`<div class="covert-preparation" data-covert-region="preparation"><section class="covert-panel covert-recruit"><div class="covert-section-heading"><div><span class="eyebrow">01 · RECRUIT</span><h2>派遣元と兵を準備</h2></div></div><label for="covert-source">所有する大都市拠点</label><select id="covert-source" class="select"${disabled(locked)}>${owned.map(x=>`<option value="${esc(x.castleId)}"${x.castleId===s.sourceId?' selected':''}>${esc(x.name)} · ${esc(x.unitName)}</option>`).join('')}</select><div class="covert-source">${source?unitArt(source):''}<div><h3>${esc(source?.name||'派遣元を選択')}</h3><p>${esc(source?.unitName||'兵')}を雇用・派遣</p></div></div><div class="covert-metrics"><span>待機<b>${num(source?.reserve)}人</b></span><span>常駐<b>${num(source?.stationed)}人</b></span><span>雇用上限<b>${num(source?.capacity)}人</b></span></div><label for="covert-hire-count">雇用人数 <span>現在の雇用可能数 ${num(s.hireMax)}人</span></label><div class="covert-number-row"><input id="covert-hire-count" class="input" type="number" inputmode="numeric" min="${c.rules.minCount}" max="${s.hireMax}" step="1" value="${esc(s.hireInput)}" aria-describedby="covert-hire-status"${disabled(locked)}><button type="button" class="button" data-covert-action="hire-max"${disabled(locked||s.hireMax<c.rules.minCount)}>最大</button></div><p class="covert-unit-cost">1人あたり 金銭 ${num(source?.hireCost.gold)}・兵糧 ${num(source?.hireCost.rice)}</p>${costsMarkup(s.hirePreview.costs)}<p id="covert-hire-status" class="covert-form-status">${esc(s.hirePreview.message||'雇用後、待機部隊から派遣できます。')}</p><button type="button" class="button gold full" data-covert-action="prepare-hire"${disabled(!hireReady)}>雇用内容を確認</button></section><section class="covert-panel covert-order"><div class="covert-section-heading"><div><span class="eyebrow">02 · DISPATCH</span><h2>派遣の内容</h2></div></div><div class="covert-selected-target"><small>選択中の派遣先</small><h3>${esc(s.target?targetLabel(s.target):'一覧から拠点を選択')}</h3><p>${s.target?(s.target.kind==='player'?'共通フィールドの領主の拠点':'天下地図の拠点'):'下の拠点一覧で城名や領主名を検索できます。'}</p></div><label for="covert-mode">任務</label><select id="covert-mode" class="select"${disabled(locked)}><option value="scout"${s.mode==='scout'?' selected':''}>情報を調べる · 調査後に帰還</option><option value="station"${s.mode==='station'?' selected':''}>常駐させる · 反撃に備える</option></select><label for="covert-count">派遣人数 <span>待機 ${num(s.dispatchMax)}人</span></label><div class="covert-number-row"><input id="covert-count" class="input" type="number" inputmode="numeric" min="${c.rules.minCount}" max="${s.dispatchMax}" step="1" value="${esc(s.countInput)}" aria-describedby="covert-dispatch-status"${disabled(locked)}><button type="button" class="button" data-covert-action="dispatch-all"${disabled(locked||s.dispatchMax<c.rules.minCount)}>全員</button></div>${costsMarkup(s.dispatchPreview.costs)}<p id="covert-dispatch-status" class="covert-form-status">${esc(s.dispatchPreview.message||(s.mode==='scout'?'調査報告はあなた専用です。部隊は調査後に帰還します。':'常駐した部隊は、派遣元への攻撃後に反撃できます。'))}</p><button type="button" class="button gold full" data-covert-action="prepare-dispatch"${disabled(!dispatchReady)}>派遣内容を確認</button></section></div>`;
   body+=`<section class="covert-panel covert-targets" data-covert-region="targets"><div class="covert-section-heading"><div><span class="eyebrow">DESTINATIONS</span><h2>派遣先を選ぶ</h2></div><span>${num(s.targetCount)} / ${num(s.totalTargets)}拠点</span></div><div class="covert-target-filters"><label for="covert-search">拠点を検索<input id="covert-search" class="input" type="search" placeholder="城名・領主名で検索" value="${esc(s.query)}"${disabled(locked)}></label><label for="covert-filter">拠点の種類<select id="covert-filter" class="select"${disabled(locked)}><option value="all"${s.filter==='all'?' selected':''}>すべての拠点</option><option value="castle"${s.filter==='castle'?' selected':''}>天下地図の拠点</option><option value="player"${s.filter==='player'?' selected':''}>領主の拠点</option></select></label><label for="covert-sort">並び順<select id="covert-sort" class="select"${disabled(locked)}><option value="name"${s.sort==='name'?' selected':''}>城名順</option><option value="kind"${s.sort==='kind'?' selected':''}>種類順</option><option value="owner"${s.sort==='owner'?' selected':''}>領主名順</option></select></label></div><div class="covert-target-list" role="group" aria-label="派遣先の拠点">${s.targets.length?s.targets.map(t=>`<button type="button" class="covert-target ${targetKey(t)===s.targetId?'is-selected':''}" data-covert-key="target-${esc(targetKey(t))}" data-covert-action="select-target" data-covert-target="${esc(targetKey(t))}" aria-pressed="${targetKey(t)===s.targetId}"${disabled(locked||!t.available)}><span class="covert-target-kind">${t.kind==='player'?'領主':'天下地図'}</span><strong>${esc(t.name)}</strong><small>${esc(t.kind==='player'?t.playerName||'領主の拠点':t.region||'城の調査・常駐')}</small>${targetKey(t)===s.targetId?'<span class="covert-selected-label">選択中</span>':''}</button>`).join(''):`<div class="covert-empty"><p>${s.filter==='player'&&!s.status.linked?'他の領主の拠点は、交流から領主を登録して接続すると表示されます。':'条件に一致する拠点がありません。城名や絞り込みを変更してください。'}</p></div>`}</div><div class="covert-pagination"><button type="button" class="button" data-covert-action="previous"${disabled(s.page<=1)}>前のページ</button><span aria-live="polite">${s.page} / ${s.pages}</span><button type="button" class="button" data-covert-action="next"${disabled(s.page>=s.pages)}>次のページ</button></div></section>`;
  }
  body+=`<section class="covert-panel covert-stations" data-covert-region="stations"><div class="covert-section-heading"><div><span class="eyebrow">STATIONED FORCES</span><h2>常駐部隊</h2></div><span>${s.stations.length}部隊</span></div>${s.stations.length?`<div class="covert-station-list">${s.stations.map(station=>`<article class="covert-station" data-covert-key="station-${esc(station.id)}"><div class="covert-station-title"><div><h3>${esc(targetLabel(station.target))}</h3><p>${esc(sourceName(station.sourceCastleId))}から派遣 · ${esc(clockLabel(station.createdElapsedMs))}</p></div><strong>${esc(station.unitName)} ${num(station.count)}人</strong></div>${station.incidents.length?`<label for="covert-incident-${esc(station.id)}">使用する被攻撃記録<select id="covert-incident-${esc(station.id)}" class="select" data-covert-station="${esc(station.id)}"${disabled(locked)}>${station.incidents.map(i=>`<option value="${esc(i.id)}"${i.id===station.selectedIncident?' selected':''}>${esc(clockLabel(i.occurredElapsedMs))} · ${i.kind==='field'?'共通フィールド':'天下地図'}での攻撃</option>`).join('')}</select></label>`:`<p class="covert-station-wait">${esc(station.retaliatePreview.message||'常駐後に派遣元が攻撃を受けると、反撃を指示できます。')}</p>`}${station.incidents.length?costsMarkup(station.retaliatePreview.costs):''}${!station.retaliatePreview.ok&&station.incidents.length?`<p class="covert-form-status">${esc(station.retaliatePreview.message)}</p>`:''}<div class="covert-actions"><button type="button" class="button" data-covert-action="prepare-recall" data-covert-id="${esc(station.id)}"${disabled(locked||!canWrite||!station.recallPreview.ok)}>帰還させる · 無料</button><button type="button" class="button gold" data-covert-action="prepare-retaliate" data-covert-id="${esc(station.id)}"${disabled(locked||!canWrite||!station.retaliatePreview.ok)}>反撃内容を確認</button></div></article>`).join('')}</div>`:'<div class="covert-empty"><h3>常駐中の部隊はいません</h3><p>兵を雇い、任務で「常駐させる」を選ぶと各地に配置できます。</p></div>'}</section>`;
  body+=resultMarkup(s.receipt)+reportsMarkup(c.reports);
  const actionLabels={hire:'雇用',dispatch:'派遣',recall:'帰還',retaliate:'反撃'};
  body+=`<section class="covert-panel covert-history" data-covert-region="history"><div class="covert-section-heading"><div><span class="eyebrow">PRIVATE RECORDS</span><h2>派遣の記録</h2></div><span>最新${c.rules.historyLimit||40}件</span></div>${c.history.length?`<ol>${c.history.map(item=>`<li><span class="covert-history-kind">${item.action==='dispatch'?(item.mode==='scout'?'調査':'常駐'):actionLabels[item.action]}</span><div><b>${esc(item.target?targetLabel(item.target):sourceName(item.sourceCastleId)||'部隊の操作')}</b><small>${item.count?num(item.count)+'人 · ':''}${esc(clockLabel(item.occurredElapsedMs??item.createdElapsedMs))}</small></div></li>`).join('')}</ol>`:'<p class="covert-empty">部隊を雇用・派遣すると記録が残ります。</p>'}</section>`;
  return`<section class="covert-page" aria-label="派遣部隊">${body}</section>`;
 }
 function mount(host,options={}){
  if(!host)return{refresh(){},dispose(){}};
  let alive=true,lastMarkup='',focusIntent='',returnFocus=null,awaitingResult=false,resultBefore='';
  function identityOf(node){return node?.nodeType===1?(node.id?'id:'+node.id:node.getAttribute('data-covert-region')?'region:'+node.getAttribute('data-covert-region'):node.getAttribute('data-covert-key')?'key:'+node.getAttribute('data-covert-key'):node.dataset?.covertAction?'action:'+node.dataset.covertAction+':'+(node.dataset.covertId||node.dataset.covertTarget||''):null):null;}
  function compatible(a,b){return a?.nodeType===b.nodeType&&(a.nodeType!==1||a.tagName===b.tagName&&identityOf(a)===identityOf(b));}
  function patchNode(live,fresh){
   if(live.nodeType===3){if(live.nodeValue!==fresh.nodeValue)live.nodeValue=fresh.nodeValue;return;}
   if(live.nodeType!==1)return;
   if(live.classList.contains('painted-art')&&fresh.classList.contains('painted-art')){
    if(['data-art-url','data-art-x','data-art-y'].every(name=>live.getAttribute(name)===fresh.getAttribute(name)))return;
    for(const attr of [...live.attributes])live.removeAttribute(attr.name);for(const attr of [...fresh.attributes])live.setAttribute(attr.name,attr.value);live.innerHTML=fresh.innerHTML;return;
   }
   const detailsOpen=live.tagName==='DETAILS'?live.open:undefined;
   for(const attr of [...live.attributes])if(!fresh.hasAttribute(attr.name)&&!(live.tagName==='DETAILS'&&attr.name==='open')&&!attr.name.startsWith('data-art-')&&!attr.name.startsWith('data-ghost-')&&!attr.name.startsWith('data-button-art')&&attr.name!=='style')live.removeAttribute(attr.name);
   for(const attr of [...fresh.attributes]){let value=attr.value;if(attr.name==='class'){const extras=['illustrated-item','art-ready','art-error'];value=[value,...extras.filter(name=>live.classList.contains(name)&&!fresh.classList.contains(name))].join(' ');}if(live.getAttribute(attr.name)!==value)live.setAttribute(attr.name,value);}
   if(live.tagName==='INPUT'){if(live.value!==fresh.value)live.value=fresh.value;live.disabled=fresh.disabled;return;}
   if(live.tagName==='SELECT'){
    // Retain the native select element and its options while a browser picker
    // is open. Monthly ticks normally only update disabled/value attributes.
    const oldOptions=[...live.options],newOptions=[...fresh.options];
    if(oldOptions.length!==newOptions.length||oldOptions.some((option,i)=>option.value!==newOptions[i].value||option.textContent!==newOptions[i].textContent))live.innerHTML=fresh.innerHTML;
    if(live.value!==fresh.value)live.value=fresh.value;live.disabled=fresh.disabled;return;
   }
   // Button artwork is added by the shared decorator. The semantic subtree is
   // kept when labels are unchanged, avoiding churn on each clock tick.
   const artIcon=live.tagName==='BUTTON'&&live.querySelector(':scope > svg')&&!fresh.querySelector(':scope > svg')?live.querySelector(':scope > svg'):null;
   const freshChildren=[...fresh.childNodes],claimed=new Set(artIcon?[artIcon]:[]);let at=artIcon?artIcon.nextSibling:live.firstChild;
   for(const next of freshChildren){
    let node=at;if(!compatible(node,next)){const key=identityOf(next);node=key?[...live.childNodes].find(item=>!claimed.has(item)&&compatible(item,next)):null;}
    if(!node){node=next.cloneNode(true);live.insertBefore(node,at);}else{if(node!==at)live.insertBefore(node,at);patchNode(node,next);}
    claimed.add(node);at=node.nextSibling;
   }
   for(const node of [...live.childNodes])if(!claimed.has(node))node.remove();if(detailsOpen!==undefined)live.open=detailsOpen;
  }
  function focusKey(element){if(!element||!host.contains(element))return null;return identityOf(element)||(element.tagName==='SUMMARY'?'summary:'+identityOf(element.parentElement):null);}
  function findFocus(key){if(!key)return null;if(key.startsWith('summary:'))return[...host.querySelectorAll('details > summary')].find(el=>'summary:'+identityOf(el.parentElement)===key)||null;return[...host.querySelectorAll('[id],[data-covert-action],[data-covert-region],[data-covert-key]')].find(el=>identityOf(el)===key)||null;}
  function render(snapshot){
   if(!alive)return;const html=markup(snapshot);if(html===lastMarkup)return;
   const doc=host.ownerDocument,active=doc?.activeElement,ownedFocus=host.contains(active),key=focusKey(active),selection={start:active?.selectionStart,end:active?.selectionEnd},hostTop=host.scrollTop,main=host.closest?.('main'),mainTop=main?.scrollTop;
   const template=doc?.createElement?.('template');if(template){template.innerHTML=html;const fresh=template.content.firstElementChild,live=host.querySelector('.covert-page');if(live)patchNode(live,fresh);else host.replaceChildren(fresh);}else host.innerHTML=html;lastMarkup=html;
   host.scrollTop=hostTop;if(main&&mainTop!==undefined)main.scrollTop=mainTop;
   let next=findFocus(key),revealResult=false;
   if(focusIntent==='confirm'&&snapshot.confirmation)next=host.querySelector('.covert-confirm');
   else if(focusIntent==='return')next=findFocus(returnFocus);
   else if(snapshot.sending&&key?.startsWith('action:submit'))next=host.querySelector('.covert-pending');
   else if(awaitingResult&&snapshot.receipt&&!snapshot.pending&&snapshot.receipt.requestId!==resultBefore){if(ownedFocus||active===doc?.body){next=host.querySelector('.covert-result');revealResult=Boolean(next);}awaitingResult=false;}
   if(next&&!next.disabled){if(doc?.activeElement!==next)next.focus?.({preventScroll:true});if(next.id===active?.id&&typeof selection.start==='number')try{next.setSelectionRange(selection.start,selection.end);}catch(_){}if(focusIntent==='confirm'||revealResult)next.scrollIntoView?.({block:'nearest',behavior:global.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});}
   if(snapshot.error&&!snapshot.pending)awaitingResult=false;focusIntent='';global.SengokuArt?.decorate?.();options.onChange?.(snapshot);
  }
  const controller=createController({...options,onChange:render});
  const click=event=>{const button=event.target.closest?.('[data-covert-action]');if(!button||!host.contains(button)||button.disabled)return;event.preventDefault();const action=button.dataset.covertAction,snapshot=controller.snapshot();
   if(action.startsWith('prepare-')){returnFocus=identityOf(button);focusIntent='confirm';controller.prepare(action.slice(8),{stationId:button.dataset.covertId});}
   else if(action==='select-target')controller.update('targetId',button.dataset.covertTarget);
   else if(action==='cancel'){focusIntent='return';controller.cancel();}
   else if(action==='submit'){awaitingResult=true;resultBefore=snapshot.receipt?.requestId||'';void controller.submit();}
   else if(action==='reload')void controller.reload();
   else if(action==='hire-max')controller.update('hireInput',snapshot.hireMax);
   else if(action==='dispatch-all')controller.update('countInput',snapshot.dispatchMax);
   else if(action==='previous'||action==='next')controller.setPage(snapshot.page+(action==='next'?1:-1));
  };
  const input=event=>{const fields={'covert-hire-count':'hireInput','covert-count':'countInput','covert-search':'query'},field=fields[event.target.id];if(field)controller.update(field,event.target.value);};
  const change=event=>{const fields={'covert-source':'sourceId','covert-mode':'mode','covert-filter':'filter','covert-sort':'sort'},field=fields[event.target.id];if(field)controller.update(field,event.target.value);else if(event.target.dataset?.covertStation)controller.setIncident(event.target.dataset.covertStation,event.target.value);};
  host.addEventListener('click',click);host.addEventListener('input',input);host.addEventListener('change',change);controller.refresh();
  return{controller,refresh:()=>controller.refresh(),dispose(){alive=false;controller.dispose();host.removeEventListener('click',click);host.removeEventListener('input',input);host.removeEventListener('change',change);}};
 }
 const api={createController,mount,markup,cleanSnapshot,cleanReceipt,targetKey,resultMarkup};global.SengokuCovert=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
