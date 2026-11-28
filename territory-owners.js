/* Public territory ownership is separate from a player's campaign factions.
 * This reader returns plain data only. Every renderer must escape names and
 * labels or assign them with textContent; it never grants territory or access.
 */
(function(global){
'use strict';
const SPECIAL=new Set(['edo','kyoto_gosho','nijo','osaka','nagoya','kagoshima']);
const TTL=30000,MAX_PAGES=20,MAX_PAGE_TARGETS=12800;
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,150}$/.test(value);
const validText=value=>typeof value==='string'&&value.trim().length>0&&value.length<=300;
const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
function person(value){
  if(!value||!validId(value.playerId)||!validText(value.name))return null;
  const result={playerId:value.playerId,name:value.name,avatarVersion:typeof value.avatarVersion==='string'&&/^[a-f0-9]{64}$/.test(value.avatarVersion)?value.avatarVersion:null};
  if(value.appearance&&typeof value.appearance==='object'&&!Array.isArray(value.appearance))result.appearance=clone(value.appearance);
  return result;
}
function palace(value){
  return value?.castleId==='kyoto_gosho'&&validText(value.governmentName)&&validId(value.controller?.id)&&validText(value.controller.name)
    ?{governmentName:value.governmentName,controller:{id:value.controller.id,name:value.controller.name}}:null;
}
function emptySource(){return{records:new Map(),relationships:new Map(),loaded:false,failed:false,revision:-1,palace:null,includesTerritories:false};}
function createController(initial={}){
  let options={...initial},stamp=null,identity={playerId:'',blocked:false},generation=0,inFlight=null,lastAttempt=-Infinity;
  let directory=emptySource(),field=emptySource(),lastSignature='';
  const clock=()=>typeof options.now==='function'?options.now():Date.now();
  function readContext(){
    let value;try{value=options.getContext?.()||{};}catch(_){value={pending:true};}
    const playerId=String(value.playerId||value.user?.id||''),userId=value.user?.id==null?'':String(value.user.id);
    const blocked=value.pending===true||value.banned===true||Boolean(userId&&userId!==playerId);
    return{playerId,blocked,stamp:JSON.stringify([value.epoch??0,value.accountEpoch??0,value.privilegeEpoch??0,playerId,userId,value.pending===true,value.banned===true])};
  }
  function describeCurrent(id){
    const special=SPECIAL.has(id),home=directory.records.get(id),holding=field.records.get(id);
    const homeOwners=special?[]:home?.owners||[],holdingOwners=holding?.owners||[];
    // The residency ledger establishes the real home lord, while the public
    // field establishes additional occupied holdings. Retainer home rows are
    // deliberately excluded by readField; personal campaign factions cannot
    // turn a vacant seat into an owner by themselves.
    const combined=new Map(homeOwners.map(owner=>[owner.playerId,owner]));
    for(const owner of holdingOwners)if(!combined.has(owner.playerId))combined.set(owner.playerId,owner);
    const owners=clone([...combined.values()]);
    const stale=special?field.failed&&field.loaded:Boolean(homeOwners.length&&directory.failed||holdingOwners.length&&field.failed);
    const complete=special?field.loaded&&!field.failed:Boolean(home&&!directory.failed&&field.loaded&&!field.failed&&field.includesTerritories);
    const outdated=stale?'前回確認した情報です。最新の領主は未確認です。':'';
    if(id==='kyoto_gosho'){
      const control=field.palace,details=['京都御所は朝廷の役職者が共有する領地です。'];
      if(control)details.push(`${control.governmentName}の支配下 · 支配者 ${control.controller.name}`);
      if(owners.length)details.push(`公開されている領主：${owners.map(owner=>owner.name).join('、')}`);
      if(outdated)details.push(outdated);else if(field.failed)details.push('公開領主の最新情報は未確認です。');
      return{status:'shared',label:'朝廷の共同領地',relation:'shared',owners,detail:details.join(' '),stale};
    }
    if(!owners.length&&!complete)return{status:'unknown',label:'領主未確認',relation:'unknown',owners:[],detail:(special?field.failed:directory.failed||field.failed)?'公開領主を確認できません。次の更新で再確認します。':'公開領主の情報を確認しています。',stale:false};
    if(!owners.length)return{status:'vacant',label:special?'公開領主なし':'空き拠点',relation:'vacant',owners:[],detail:special?'現在の公開領主は未入城です。':'本拠の領主・公開された占領領主はいません。',stale};
    const multiple=owners.length>1,own=!multiple&&owners[0].playerId===identity.playerId;
    // Diplomacy may only supplement a confirmed owner by exact player id.
    const allied=!multiple&&field.loaded&&!field.failed&&field.relationships.get(owners[0].playerId)==='allied';
    const relation=multiple?'shared':own?'self':allied?'ally':'other';
    const uncertainRelation=!own&&!multiple&&field.failed?'同盟関係は未確認です。':'';
    const origin=special?[]:[homeOwners.length?`本拠の領主：${homeOwners.map(owner=>owner.name).join('、')}`:'',holdingOwners.length?`占領領主：${holdingOwners.map(owner=>owner.name).join('、')}`:'',!home||directory.failed?'本拠の最新情報は未確認です。':'',!field.loaded||field.failed||!field.includesTerritories?'占領領地の最新情報は未確認です。':''];
    return{status:multiple?'shared':'known',label:'領主 '+owners[0].name+(multiple?` ほか${owners.length-1}名`:''),relation,owners,detail:[multiple?`公開領主：${owners.map(owner=>owner.name).join('、')}`:`公開領主：${owners[0].name}`,...origin,outdated,uncertainRelation].filter(Boolean).join(' · '),stale};
  }
  function signature(){
    const ids=[...new Set([...SPECIAL,...directory.records.keys(),...field.records.keys()])].sort();
    return JSON.stringify([directory.failed,ids.map(id=>[id,describeCurrent(id)])]);
  }
  function notify(){const next=signature();if(next===lastSignature)return;lastSignature=next;options.onChange?.();}
  function clear(){generation++;inFlight=null;lastAttempt=-Infinity;directory=emptySource();field=emptySource();}
  function syncIdentity(){
    const current=readContext();
    if(current.stamp!==stamp){const first=stamp===null;stamp=current.stamp;identity=current;clear();if(first)lastSignature=signature();else notify();}
    return identity;
  }
  function isCurrent(epoch,initialStamp){syncIdentity();return epoch===generation&&initialStamp===stamp&&!identity.blocked;}
  async function readDirectory(){
    if(typeof options.loadDirectory!=='function')throw Error('Missing residency reader');
    // Residency also caches its directory. This controller owns the 30s TTL.
    const value=await options.loadDirectory({force:true});
    if(!value||value.ok===false||!Number.isSafeInteger(value.revision)||value.revision<0||!Array.isArray(value.castles)||value.castles.length>1000)throw Error('Invalid residency directory');
    const records=new Map();
    for(const row of value.castles){
      if(!row||!validId(row.castleId)||records.has(row.castleId))throw Error('Invalid castle seat');
      if(SPECIAL.has(row.castleId))continue;
      const lord=person(row.lord);
      if(row.available===true&&row.lord==null)records.set(row.castleId,{owners:[]});
      else if(row.available===false&&lord)records.set(row.castleId,{owners:[lord]});
      else throw Error('Unconfirmed castle seat');
    }
    return{records,loaded:true,failed:false,revision:value.revision,palace:null};
  }
  async function readField(epoch,initialStamp){
    if(typeof options.requestField!=='function')throw Error('Missing public field reader');
    const records=new Map(),relationships=new Map(),cursors=new Set();let cursor='',control=null,includesTerritories=true;
    const maxPages=Number.isSafeInteger(options.maxPages)?Math.max(1,Math.min(MAX_PAGES,options.maxPages)):MAX_PAGES;
    for(let page=0;page<maxPages;page++){
      if(!isCurrent(epoch,initialStamp))throw Error('Identity changed');
      const value=await options.requestField('/field?view=owners&limit=100'+(cursor?'&cursor='+encodeURIComponent(cursor):''),{method:'GET'});
      if(!isCurrent(epoch,initialStamp))throw Error('Identity changed');
      // Legacy home-only rows cannot establish that every major-city holding
      // has been read. Require the server's complete target projection.
      if(!value||value.ok===false||!Array.isArray(value.targets)||value.targets.length>MAX_PAGE_TARGETS)throw Error('Invalid public field');
      includesTerritories=includesTerritories&&value.ownersIncludeTerritories===true;
      control=palace(value.palaceControl)||control;
      for(const row of value.targets){
        const castleId=row?.targetCastleId||row?.homeCastleId;
        if(!validId(castleId)||!validId(row.playerId))throw Error('Invalid public target');
        // Different target cities can reference the same person. If pages
        // disagree after a diplomacy change, prefer an unconfirmed alliance.
        const relation=row.relationship==='allied'?'allied':'other';
        relationships.set(row.playerId,relationships.has(row.playerId)&&relationships.get(row.playerId)!==relation?'other':relation);
        if(!SPECIAL.has(castleId)&&row.holdingKind!=='territory')continue;
        const owner=person(row);if(!owner)throw Error('Unconfirmed public lord');
        const record=records.get(castleId)||{owners:[]};
        const existing=record.owners.findIndex(item=>item.playerId===owner.playerId);
        if(existing<0)record.owners.push(owner);else record.owners[existing]=owner;
        records.set(castleId,record);
        if(castleId==='kyoto_gosho')control=palace(row.palaceControl)||control;
      }
      const next=value.nextCursor;
      if(next==null||next===''){
        for(const record of records.values())record.owners.sort((a,b)=>a.playerId<b.playerId?-1:a.playerId>b.playerId?1:0);
        return{records,relationships,loaded:true,failed:false,revision:0,palace:control,includesTerritories};
      }
      if(!validId(next)||cursors.has(next))throw Error('Incomplete public field');
      cursors.add(next);cursor=next;
    }
    throw Error('Public field page limit reached');
  }
  function ensure({force=false}={}){
    syncIdentity();
    if(identity.blocked)return Promise.resolve({ok:false,blocked:true});
    if(inFlight)return inFlight;
    if(!force&&clock()-lastAttempt<TTL)return Promise.resolve({ok:directory.loaded&&!directory.failed&&field.loaded&&!field.failed,cached:true});
    const epoch=generation,initialStamp=stamp;lastAttempt=clock();
    const task=Promise.resolve().then(async()=>{
      if(!isCurrent(epoch,initialStamp))return{ok:false,ignored:true};
      const results=await Promise.allSettled([readDirectory(),readField(epoch,initialStamp)]);
      if(!isCurrent(epoch,initialStamp))return{ok:false,ignored:true};
      let directoryOK=false,fieldOK=false;
      if(results[0].status==='fulfilled'&&results[0].value.revision>=directory.revision){directory=results[0].value;directoryOK=true;}else directory.failed=true;
      // Replace a field snapshot only after all pages succeed. A partial page
      // must never turn an unseen owner into an empty castle.
      if(results[1].status==='fulfilled'){field=results[1].value;fieldOK=true;}else field.failed=true;
      notify();return{ok:directoryOK&&fieldOK,directory:directoryOK,field:fieldOK};
    }).finally(()=>{if(inFlight===task)inFlight=null;});
    inFlight=task;return task;
  }
  const api={configure(value={}){options={...options,...value};syncIdentity();return api;},ensure,reset(){syncIdentity();clear();notify();},describe(id){syncIdentity();return describeCurrent(typeof id==='string'?id:'');}};
  syncIdentity();return api;
}
const api=createController();api.createController=createController;
global.SengokuTerritoryOwners=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
