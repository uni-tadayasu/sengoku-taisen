/* Shared player bases: presentation only. Every action uses the app's guarded
 * request facade and the server's result; battles are never simulated here. */
(function(global){
'use strict';
const caches=new Map(),mounted=new WeakMap();
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=value=>Number.isFinite(Number(value))?Number(value):0;
const integer=value=>Math.max(0,Math.floor(number(value)));
const num=value=>integer(value).toLocaleString('ja-JP');
const castleLevelLimit=id=>(global.SENGOKU_DATA?.majorCityIds||['edo','sunpu','nijo','osaka','nagoya']).includes(id)?64:32;
function keepLevelInfo(player){
  const value=player?.keepLevel,level=typeof value==='number'||typeof value==='string'&&value.trim()?Number(value):NaN;
  const known=player?.keepLevelKnown!==false&&Number.isFinite(level)&&Number.isInteger(level)&&level>=1;
  return{level:known?Math.min(32,level):1,known};
}
const keepLabel=player=>{const keep=keepLevelInfo(player);return keep.known?`天守 Lv.${keep.level}`:'天守 未取得';};
function castleAppearance(player,{marker=false}={}){
  const keep=keepLevelInfo(player),className=marker?'field-map-castle-art':'field-castle-art';
  const art=global.SengokuArt?.castle?.(player.homeCastleId,className,keep.level)||`<span class="field-castle-fallback">${icon('castle')}</span>`;
  const label=marker?(keep.known?`Lv.${keep.level}`:'Lv.?'):keepLabel(player);
  return`<span class="field-castle-visual ${marker?'field-map-castle':''}" data-field-keep-level="${keep.level}" data-field-keep-known="${keep.known}" role="img" aria-label="${esc(player.homeCastleName||player.homeCastleId)}・${esc(keepLabel(player))}">${art}<span class="field-castle-level" aria-hidden="true">${label}</span></span>`;
}
function markerAppearance(marker){
  const player=marker.players?.find(p=>p.playerId===marker.displayPlayerId);if(!player)return null;
  return{html:castleAppearance(player,{marker:true}),label:`${marker.name} ${player.name}の本拠 ${keepLabel(player)} 城郭 Lv.${player.level}${marker.players.length>1?'・'+marker.players.length+'人の領主':''}`};
}
const DEFAULT_RULES={minTroops:300,maxTroops:100000,commandCost:1,foodBase:150,foodPerTroop:.3,attackCooldownMs:60000,defenderProtectionMs:60000,allianceDurationMs:360000,tactics:[{id:'balanced',name:'正攻法',food:1},{id:'assault',name:'総攻撃',food:1.25},{id:'siege',name:'兵糧攻め',food:1.65},{id:'ambush',name:'伏兵',food:1.1}]};
const icons={refresh:'M20 8a9 9 0 1 0 1 7M20 3v5h-5',search:'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14m5-2 6 6',castle:'M3 20h18M5 20V10l7-5 7 5v10M3 10h18M9 5l3-3 3 3M10 20v-5h4v5',swords:'m4 3 7 7-3 3-7-7 3-3Zm9 10 7 7M15 18l3-3M20 3l-7 7 3 3 7-7-3-3ZM11 13l-7 7M9 18l-3-3',flag:'M4 22V3m0 1c6-5 10 5 16 0v10c-6 5-10-5-16 0',check:'m4 12 5 5L20 6',shield:'m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6l9-4ZM8 12l3 3 5-6',clock:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v6l4 2',users:'M9 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM2 21v-3c0-3 3-5 7-5s7 2 7 5v3M17 4c5-1 6 7 1 8m1 2c3 1 4 3 4 7',close:'m6 6 12 12M6 18 18 6'};
const icon=name=>`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[name]||icons.castle}"/></svg>`;
function normalizePlayers(payload){
  const input=Array.isArray(payload)?payload:payload?.players;if(!Array.isArray(input))return[];
  const seen=new Set();return input.flatMap(player=>{
    if(!player||typeof player.playerId!=='string'||!player.playerId||typeof player.name!=='string'||typeof player.homeCastleId!=='string'||seen.has(player.playerId))return[];
    const keep=keepLevelInfo(player);
    seen.add(player.playerId);return[{...player,level:Math.max(1,Math.min(castleLevelLimit(player.homeCastleId),integer(player.level)||1)),keepLevel:keep.level,keepLevelKnown:keep.known,defenseTroops:integer(player.defenseTroops),defensePower:Math.max(0,number(player.defensePower)),isAdmin:player.isAdmin===true,isStaff:player.isStaff===true&&player.isAdmin!==true,self:player.self===true,online:player.online===true,attackable:player.attackable===true}];
  });
}
function rulesFor(rules){return{...DEFAULT_RULES,...rules,tactics:Array.isArray(rules?.tactics)&&rules.tactics.length?rules.tactics:DEFAULT_RULES.tactics};}
function foodCost(troops,tactic,rules){const r=rulesFor(rules),choice=r.tactics.find(t=>t.id===tactic);return choice?Math.ceil(integer(troops)*number(r.foodPerTroop)*number(choice.food))+integer(r.foodBase):null;}
function remainingLabel(milliseconds){const value=Math.max(0,number(milliseconds));return value>=60000?Math.ceil(value/60000)+'か月':Math.ceil(value/1000)+'秒';}
function relationshipFor(player,me,identity){
  if(player?.self||player?.playerId===identity?.id)return'self';
  return me?.relationships?.find(item=>item.targetPlayerId===player?.playerId)?.status||player?.relationship||'neutral';
}
function groupBases(players,coordinates={},castles=[],identity,selectedPlayerId=''){
  const defs=new Map(castles.map(c=>[c.id,c])),groups=new Map();
  for(const player of players){const point=coordinates[player.homeCastleId];if(!point||!Number.isFinite(Number(point.lon))||!Number.isFinite(Number(point.lat)))continue;
    if(!groups.has(player.homeCastleId)){const def=defs.get(player.homeCastleId)||{};groups.set(player.homeCastleId,{id:player.homeCastleId,name:player.homeCastleName||def.name||player.homeCastleId,region:def.region||'',geo:point,players:[],level:1,troops:0,neighbors:[]});}
    const group=groups.get(player.homeCastleId);group.players.push(player);group.level=Math.max(group.level,player.level);group.troops+=player.defenseTroops;
  }
  return[...groups.values()].map(group=>{
    const own=group.players.some(p=>p.self||p.playerId===identity?.id),allied=group.players.some(p=>p.relationship==='allied');
    const representative=group.players.find(p=>p.playerId===selectedPlayerId)||group.players.find(p=>p.self||p.playerId===identity?.id)||[...group.players].sort((a,b)=>keepLevelInfo(b).level-keepLevelInfo(a).level||a.playerId.localeCompare(b.playerId))[0];
    const keep=keepLevelInfo(representative);
    return{...group,name:group.name+(group.players.length>1?` · ${group.players.length}領主`:''),owner:own?'あなたの本拠':allied?'同盟の本拠':`${group.players.length}領主の本拠`,reachable:group.players.some(p=>p.attackable),own,keepLevel:keep.level,keepLevelKnown:keep.known,displayPlayerId:representative.playerId,displayPlayerName:representative.name};
  });
}
function attackValidation({player,me,identity,access={},state={},troops,tactic,rules,clock}){
  if(!identity?.id)return{ok:false,message:'領主登録・ログインが必要です。'};
  if(access.fieldPending)return{ok:false,message:'前の采配を反映しています。'};
  if(!access.writable)return{ok:false,message:'この端末を操作端末にすると出陣できます。'};
  if(clock&&(!clock.ready||clock.clock?.running===false))return{ok:false,message:clock.ready?'運営が共通時間を停止しています。':'共通時刻の確認を待っています。'};
  if(!player)return{ok:false,message:'相手の領主を選んでください。'};
  if(player.self||player.playerId===identity.id)return{ok:false,message:'自分の本拠には出陣できません。'};
  if(player.isAdmin||player.homeCastleId==='edo')return{ok:false,message:'運営の本拠・江戸城は保護され、襲撃・占領の対象になりません。'};
  if(player.isStaff||player.homeCastleId==='sunpu')return{ok:false,message:'スタッフ共同拠点・駿府城は保護され、襲撃・占領の対象になりません。'};
  if(relationshipFor(player,me,identity)==='allied')return{ok:false,message:'同盟中の領主には出陣できません。'};
  if(!player.attackable)return{ok:false,message:player.attackReason||'この本拠は現在保護されています。'};
  if(!me?.attack?.ready)return{ok:false,message:me?.attack?.reason||'本拠と出陣の準備を確認しています。'};
  const r=rulesFor(rules),amount=Number(troops),min=Math.max(1,integer(me.attack.minTroops)||integer(r.minTroops)),max=Math.min(integer(me.attack.maxTroops)||integer(r.maxTroops),integer(me.attack.availableTroops),state.troops===undefined?Infinity:integer(state.troops));
  if(!Number.isInteger(amount)||amount<min||amount>max)return{ok:false,message:`出陣兵数は${num(min)}〜${num(max)}人で指定してください。`};
  const cost=foodCost(amount,tactic,r);if(cost===null)return{ok:false,message:'戦法を選んでください。'};
  if(integer(state.command??me.attack.command)<integer(r.commandCost))return{ok:false,message:'出陣に必要な指令がありません。'};
  if(integer(state.resources?.rice??me.attack.rice)<cost)return{ok:false,message:`兵糧が${num(cost)}必要です。`};
  return{ok:true,foodCost:cost,payload:{targetPlayerId:player.playerId,troops:amount,tactic}};
}
function playerPhoto(player){const user={...player,id:player.playerId};return global.SengokuAvatar?.imageURL?.(user)?global.SengokuAvatar.markup(user,'small'):'';}
function publicRow(player,{selectedId='',identity,relationship=player.relationship}={}){
  const own=player.self||player.playerId===identity?.id,label=own?'あなた':relationship==='allied'?'同盟':relationship==='incoming'?'申請あり':relationship==='outgoing'?'申請中':player.isAdmin?'運営':player.isStaff?'スタッフ':player.online?'接続中':'領主';
  const photo=playerPhoto(player);
  return`<button type="button" class="field-player-row ${selectedId===player.playerId?'is-selected':''} ${own?'is-self':''}" data-field-action="select-player" data-player-id="${esc(player.playerId)}" aria-pressed="${selectedId===player.playerId}">${photo?`<span class="field-player-mon field-player-photo">${photo}</span>`:`<span class="field-player-mon" data-field-crest="${esc(player.clan||'')}">${icon('flag')}</span>`}<span class="field-player-copy"><strong>${esc(player.name)}</strong><small>${esc(player.homeCastleName||player.homeCastleId)} · ${esc(player.clan||'')}</small></span><span class="field-player-meta"><span class="field-player-tag ${player.online?'is-online':''}">${esc(label)}</span><small>${keepLabel(player)} · 城郭 Lv.${player.level}</small><small>${num(player.defenseTroops)}兵</small></span></button>`;
}
function makeCache(){return{players:[],total:0,nextCursor:null,me:null,rules:rulesFor(),clock:null,lastFetched:0,loading:false,promise:null,busy:false,error:'',selectedId:'',castleFilter:'',query:'',filter:'all',page:1,tab:'base',relationshipPage:1,battlePage:1,troops:'',tactic:'balanced',confirm:null,lastBattle:null,watchers:new Set()};}
function mount(container,options={}){
  if(!container?.querySelector)return null;if(mounted.has(container)){const existing=mounted.get(container);existing.update(options);return existing;}
  let opts={stateKey:'shared-field',...options},key='',cache=null,map=null,destroyed=false,timer=null,detailHost=null,detailMarkup=null;
  const listeners=[],doc=container.ownerDocument||global.document;
  const getKey=()=>opts.stateKey+':'+(opts.identity?.id||'guest');
  const clockSnapshot=()=>global.SengokuWorldClock?.snapshot?.()||{ready:true,clock:cache.clock};
  const elapsed=()=>clockSnapshot().clock?.confirmedElapsedMs??clockSnapshot().clock?.elapsedMs??cache.clock?.elapsedMs??0;
  const current=()=>cache.players.find(p=>p.playerId===cache.selectedId)||null;
  const access=()=>opts.getSyncStatus?.()||{};
  const state=()=>opts.getState?.()||{};
  const canAct=()=>Boolean(opts.identity?.id&&access().writable&&!access().fieldPending&&!cache.busy);
  const notify=()=>{for(const callback of cache.watchers)callback();};
  const message=(text,error=false)=>opts.onMessage?.(text,error);
  function bindCache(){const next=getKey();if(next===key)return;cache?.watchers.delete(render);key=next;if(!caches.has(key))caches.set(key,makeCache());cache=caches.get(key);cache.watchers.add(render);}
  function listen(node,type,fn){node.addEventListener(type,fn);listeners.push(()=>node.removeEventListener(type,fn));}
  function structure(){
    map?.destroy();map=null;
    container.innerHTML=`<div class="sengoku-field"><div class="field-toolbar"><div class="field-world-count"><span>SHARED WORLD</span><strong data-field-summary>領主の本拠を確認中</strong></div><label class="field-search">${icon('search')}<input type="search" data-field-input="search" aria-label="領主・本拠・勢力を検索" placeholder="領主・本拠・勢力を検索"></label><select data-field-input="filter" class="field-filter" aria-label="表示する領主"><option value="all">すべての領主</option><option value="online">接続中</option><option value="allied">同盟中</option></select><button type="button" class="field-icon-button" data-field-action="refresh" aria-label="共有フィールドを更新" title="更新">${icon('refresh')}</button></div><div class="field-feedback" data-field-feedback role="status" hidden></div><div class="field-workspace"><section class="field-map-column"><div class="geographic-map-panel field-map-panel"><div class="geographic-map-host" data-field-map></div></div><div class="field-list-heading"><h2>領主の本拠</h2><span data-field-filter-label></span></div><div class="field-player-grid" data-field-players></div><div class="field-pagination" data-field-pagination></div></section><aside class="field-sidebar"><nav class="field-tabs" role="tablist" aria-label="共有フィールドの情報"><button type="button" data-field-action="tab" data-tab="base" role="tab">本拠</button><button type="button" data-field-action="tab" data-tab="diplomacy" role="tab">外交<span data-field-incoming></span></button><button type="button" data-field-action="tab" data-tab="reports" role="tab">合戦報告</button></nav><div class="field-detail" data-field-detail role="tabpanel"></div></aside></div><p class="field-footnote">登録された領主の本拠を、実際の城跡の位置に表示しています。城の絵は天守レベルに連動します。同じ城を本拠にする領主は、一覧で切り替えられます。</p></div>`;
  }
  function selectedRelation(){return cache.me?.relationships?.find(r=>r.targetPlayerId===cache.selectedId);}
  function validation(){return attackValidation({player:current(),me:cache.me,identity:opts.identity,access:access(),state:state(),troops:cache.troops,tactic:cache.tactic,rules:cache.rules,clock:clockSnapshot()});}
  function diplomacyControls(player){
    const relation=relationshipFor(player,cache.me,opts.identity),disabled=!canAct()?' disabled':'';
    if(relation==='self')return'';
    if(relation==='allied'){const record=selectedRelation(),left=record?Math.max(0,record.expiresElapsedMs-elapsed()):0;return`<div class="field-relationship is-allied">${icon('check')}<span>同盟中${record?` · あと${remainingLabel(left)}`:''}<small>同盟が続く間は互いに襲撃できません。</small></span></div>`;}
    if(relation==='incoming')return`<div class="field-relationship"><span>この領主から同盟の申し出が届いています。</span></div><div class="field-actions"><button class="field-button is-gold" data-field-action="diplomacy" data-operation="accept" data-player-id="${esc(player.playerId)}"${disabled}>同盟を承諾</button><button class="field-button" data-field-action="diplomacy" data-operation="reject" data-player-id="${esc(player.playerId)}"${disabled}>辞退</button></div>`;
    if(relation==='outgoing')return`<div class="field-relationship"><span>同盟の返答を待っています。</span></div><button class="field-button is-subtle" data-field-action="diplomacy" data-operation="cancel" data-player-id="${esc(player.playerId)}"${disabled}>申し出を取り消す</button>`;
    return`<button class="field-button is-gold is-full" data-field-action="diplomacy" data-operation="propose" data-player-id="${esc(player.playerId)}"${disabled}>${icon('flag')}同盟を申し込む</button><p class="field-caption">相手の承諾で6か月間の同盟が成立します。</p>`;
  }
  function baseDetail(){
    const player=current();
    if(!player)return`<div class="field-empty"><span>${icon('castle')}</span><h3>${cache.loading?'本拠を確認しています':'領主を選んでください'}</h3><p>${cache.players.length?'地図の拠点か、下の領主一覧から選べます。':'クラウドへ保存された本拠が、ここに表示されます。'}</p>${!opts.identity?'<button class="field-button is-gold" data-field-action="register">領主登録・ログイン</button>':''}</div>`;
    const relation=relationshipFor(player,cache.me,opts.identity),own=relation==='self',art=castleAppearance(player);
    const coLocated=cache.players.filter(p=>p.homeCastleId===player.homeCastleId).length;
    const protection=Math.max(0,number(player.protectedUntilElapsedMs)-elapsed());
    let result=`<div class="field-base-heading">${art}<div><span class="field-eyebrow">${esc(player.homeCastleName||player.homeCastleId)} · 城郭 Lv.${player.level}</span><h3 class="field-lord-heading">${playerPhoto(player)}<span>${esc(player.name)}</span></h3><p>${esc(player.clan||'')}${own?' · あなたの本拠':player.isAdmin?' · 運営の本拠':''}</p><span class="field-online ${player.online?'is-online':''}">${player.online?'接続中':'現在は不在'}</span></div></div><div class="field-base-stats"><div><span>守備兵</span><b>${num(player.defenseTroops)}</b></div><div><span>防衛力</span><b>${num(Math.round(player.defensePower))}</b></div><div><span>軍団</span><b>${num(player.armySummary?.officerCount)}<small>名</small></b></div></div>${coLocated>1?`<p class="field-caption">この城には${coLocated}人の領主の本拠があります。</p>`:''}`;
    if(castleLevelLimit(player.homeCastleId)===64)result+=`<div class="major-city-badge">${icon('castle')}大都市拠点 · 城郭上限 Lv.64${player.homeCastleId==='edo'?' · 運営専用 · 占領不可':player.homeCastleId==='sunpu'?' · スタッフ共同 · 占領不可':''}</div>`;
    if(player.isStaff||player.homeCastleId==='sunpu')result+='<p class="field-caption">駿府城の城郭と城下町施設は、スタッフ全員で共同成長させます。</p>';
    if(!opts.identity?.id)return result+'<div class="field-notice">襲撃・外交・書状は、領主登録後に利用できます。</div><button class="field-button is-gold is-full" data-field-action="register">領主登録・ログイン</button>';
    if(!canAct()&&!cache.busy)result+=`<div class="field-notice">${esc(access().fieldPending?'前の采配を反映しています。':'操作端末と共通時刻を確認すると采配できます。')}<button class="field-inline-button" data-field-action="sync">端末同期を確認</button></div>`;
    if(own){const cooldown=Math.max(0,number(cache.me?.attack?.cooldownUntilElapsedMs)-elapsed());return result+`<div class="field-self-note">${icon('shield')}<div><strong>あなたの旗が、この城に掲がっています。</strong><p>ほかの領主を選ぶと、襲撃や同盟の申し出ができます。</p></div></div><div class="field-key-value"><span>出陣できる兵</span><b>${num(state().troops??cache.me?.attack?.availableTroops)}人</b></div>${cooldown?`<div class="field-key-value"><span>襲撃の再準備</span><b>あと${remainingLabel(cooldown)}</b></div>`:''}${protection?`<div class="field-notice">襲撃後の保護 · あと${remainingLabel(protection)}</div>`:''}`;}
    result+=`<section class="field-letter-box"><h4>本拠へ書状を届ける</h4><div class="field-letter-actions"><button type="button" class="field-button" data-field-action="letter-player" data-player-id="${esc(player.playerId)}">領主に書状</button><button type="button" class="field-button" data-field-action="letter-guild" data-player-id="${esc(player.playerId)}">所属ギルドに書状</button></div><p class="field-caption">本人への便りか、所属ギルドへの連絡を選べます。</p></section>`;
    result+=`<section class="field-diplomacy-box"><h4>外交</h4>${diplomacyControls(player)}</section>`;
    if(player.isAdmin||player.homeCastleId==='edo')return result+`<div class="field-notice">${icon('shield')}運営の本拠・江戸城は保護され、襲撃・占領の対象になりません。</div>`;
    if(player.isStaff||player.homeCastleId==='sunpu')return result+`<div class="field-notice">${icon('shield')}スタッフ共同拠点・駿府城は保護され、襲撃・占領の対象になりません。</div>`;
    if(protection)return result+`<div class="field-notice">襲撃後の保護期間です。あと${remainingLabel(protection)}で再び対象になります。</div>`;
    if(relation==='allied')return result;
    const attack=cache.me?.attack||{},r=cache.rules,max=Math.min(integer(attack.availableTroops),integer(attack.maxTroops)||r.maxTroops,state().troops===undefined?Infinity:integer(state().troops));
    if(cache.troops==='')cache.troops=String(Math.min(Math.max(r.minTroops,1000),Math.max(r.minTroops,max)));
    const valid=validation(),cost=foodCost(cache.troops,cache.tactic,r),confirm=cache.confirm?.playerId===player.playerId;
    result+=`<section class="field-attack-box"><h4>${icon('swords')}本拠への襲撃</h4><div class="field-form-row"><label for="field-troops">出陣兵数<small>最大${num(max)}人</small></label><input id="field-troops" data-field-input="troops" type="number" min="${integer(attack.minTroops)||r.minTroops}" max="${max}" step="100" value="${esc(cache.troops)}" inputmode="numeric"></div><div class="field-form-row"><label for="field-tactic">戦法</label><select id="field-tactic" data-field-input="tactic">${r.tactics.map(t=>`<option value="${esc(t.id)}"${cache.tactic===t.id?' selected':''}>${esc(t.name)}</option>`).join('')}</select></div><div class="field-expense"><span>指令${num(r.commandCost)}</span><span>兵糧 <b data-field-food>${num(cost)}</b></span></div><p class="field-action-reason" data-field-attack-reason>${valid.ok?'兵数と戦法を確認して出陣します。':esc(valid.message)}</p>${confirm?`<div class="field-confirm" role="alert"><strong>${esc(player.name)}の本拠へ出陣しますか？</strong><p>${num(cache.troops)}人 · ${esc(r.tactics.find(t=>t.id===cache.tactic)?.name||'')} · 兵糧${num(cost)}</p><div class="field-actions"><button class="field-button" data-field-action="cancel-attack">戻る</button><button class="field-button is-danger" data-field-action="attack"${!valid.ok||cache.busy?' disabled':''}>この内容で襲撃</button></div></div>`:`<button class="field-button is-danger is-full" data-field-action="confirm-attack"${!valid.ok||cache.busy?' disabled':''}>${icon('swords')}出陣を確認</button>`}<p class="field-caption">襲撃では資源を奪い合います。本拠と武将は相手の領地に残り、守備側には戦後の保護期間があります。</p></section>`;
    return result;
  }
  function diplomacyDetail(){
    if(!opts.identity?.id)return'<div class="field-empty"><h3>外交の使者を送る</h3><p>領主登録後、ほかの領主と同盟を結べます。</p><button class="field-button is-gold" data-field-action="register">領主登録・ログイン</button></div>';
    const order={incoming:0,outgoing:1,allied:2},all=[...(cache.me?.relationships||[])].sort((a,b)=>(order[a.status]??9)-(order[b.status]??9)),pages=Math.max(1,Math.ceil(all.length/4));cache.relationshipPage=Math.min(cache.relationshipPage,pages);
    return`<div class="field-section-title"><h3>外交の往来</h3><p>同盟は双方の承諾で成立します。</p></div>${all.slice((cache.relationshipPage-1)*4,cache.relationshipPage*4).map(rel=>{const label={incoming:'同盟の申し出',outgoing:'返答待ち',allied:'同盟中'}[rel.status]||'',left=Math.max(0,number(rel.expiresElapsedMs)-elapsed()),operations=rel.status==='incoming'?[['accept','承諾'],['reject','辞退']]:rel.status==='outgoing'?[['cancel','取消']]:[];return`<div class="field-diplomacy-row"><div><span class="field-eyebrow">${label}</span><strong>${esc(rel.targetName)}</strong><small>あと${remainingLabel(left)} · 共通時間</small></div><div class="field-actions">${operations.map(([action,name])=>`<button class="field-button ${action==='accept'?'is-gold':''}" data-field-action="diplomacy" data-operation="${action}" data-player-id="${esc(rel.targetPlayerId)}"${!canAct()?' disabled':''}>${name}</button>`).join('')}</div></div>`;}).join('')||'<div class="field-empty is-small"><span>'+icon('flag')+'</span><p>現在、同盟や返答待ちの申し出はありません。<br>本拠から相手の領主を選んでください。</p></div>'}${pages>1?pagination('relationship-page',cache.relationshipPage,pages):''}`;
  }
  function battleReport(battle){
    const attacker=battle.attackerPlayerId===opts.identity?.id,positive=attacker?battle.won:!battle.won,loss=attacker?integer(battle.attackerLost):integer(battle.defenderLost?.troops)+integer(battle.defenderLost?.garrison),when=global.SengokuWorldClock?.calendar?.(battle.occurredElapsedMs),loot=battle.loot||{};
    return`<article class="field-battle-report ${positive?'is-victory':''}"><span class="field-eyebrow">${attacker?'出陣の記録':'本拠の防衛'}</span><h3>${attacker?(battle.won?'襲撃に成功':'軍を撤退'):(!battle.won?'本拠を防衛':'襲撃を受けました')}</h3><p>${esc(battle.attackerName)} → ${esc(battle.defenderName)}</p><strong>${esc(battle.castleName||'')}</strong><div class="field-report-stats"><div><span>出陣</span><b>${num(battle.troops)}人</b></div><div><span>自軍の損失</span><b>${num(loss)}人</b></div></div><div class="field-loot"><span>${attacker?'獲得した資源':'失った資源'}</span><div>${[['gold','金銭'],['rice','兵糧'],['wood','木材'],['stone','石材']].map(([key,label])=>`<small>${label}<b>${num(loot[key])}</b></small>`).join('')}</div></div><small class="field-report-date">${when?`${when.year}年${when.month}月`:'共通時間の合戦記録'}</small></article>`;
  }
  function reportsDetail(){
    const all=[...(cache.me?.battles||[])];if(cache.lastBattle&&!all.some(b=>b.id===cache.lastBattle.id))all.unshift(cache.lastBattle);
    const pages=Math.max(1,Math.ceil(all.length/4));cache.battlePage=Math.min(cache.battlePage,pages);
    const selected=cache.lastBattle||all[0];return`<div class="field-section-title"><h3>合戦の報せ</h3><p>サーバーが確定した襲撃の記録です。</p></div>${selected?battleReport(selected):'<div class="field-empty is-small"><span>'+icon('swords')+'</span><p>まだ合戦の記録はありません。</p></div>'}${all.length>1?`<div class="field-report-list">${all.slice((cache.battlePage-1)*4,cache.battlePage*4).map(b=>`<button class="field-report-row" data-field-action="report" data-battle-id="${esc(b.id)}"><span>${esc(b.castleName||'本拠')}</span><small>${esc(b.attackerName)} → ${esc(b.defenderName)}</small></button>`).join('')}</div>${pages>1?pagination('battle-page',cache.battlePage,pages):''}`:''}`;
  }
  function pagination(action,page,pages){return`<div class="field-pager"><button class="field-button" data-field-action="${action}" data-delta="-1"${page<=1?' disabled':''}>前へ</button><span>${page} / ${pages}</span><button class="field-button" data-field-action="${action}" data-delta="1"${page>=pages?' disabled':''}>次へ</button></div>`;}
  function decorateCrests(){for(const node of container.querySelectorAll('[data-field-crest]')){const src=global.SengokuKamon?.url?.(node.dataset.fieldCrest);if(typeof src==='string'&&/^(data:image\/|assets\/)/.test(src))node.innerHTML=`<img src="${esc(src)}" alt="">`;}}
  function renderDetail(){
    const host=container.querySelector('[data-field-detail]');if(!host)return;
    const markup=cache.tab==='diplomacy'?diplomacyDetail():cache.tab==='reports'?reportsDetail():baseDetail();
    // Loaded artwork mutates its own DOM. Keep that DOM and any focused input
    // when the underlying detail has not changed during a shared refresh.
    if(host!==detailHost||markup!==detailMarkup){
      const focused=doc.activeElement,focusedKind=container.contains(focused)?focused?.dataset?.fieldInput:null,selection=focusedKind==='troops'?[focused.selectionStart,focused.selectionEnd]:null;
      host.innerHTML=markup;detailHost=host;detailMarkup=markup;
      if(focusedKind==='troops'||focusedKind==='tactic'){const next=host.querySelector(`[data-field-input="${focusedKind}"]`);next?.focus({preventScroll:true});if(selection?.[0]!=null)try{next?.setSelectionRange(...selection);}catch(_){}}
    }
    for(const button of container.querySelectorAll('[data-tab]'))button.setAttribute('aria-selected',String(button.dataset.tab===cache.tab));
  }
  function render(){
    if(destroyed)return;if(!container.querySelector('.sengoku-field'))structure();
    const search=container.querySelector('[data-field-input="search"]');if(search.value!==cache.query)search.value=cache.query;container.querySelector('[data-field-input="filter"]').value=cache.filter;
    container.querySelector('[data-field-summary]').textContent=cache.total?`${num(cache.total)}人の領主が、同じ山河に。`:cache.loading?'領主の本拠を確認中':'最初の旗を、この山河へ。';
    const error=container.querySelector('[data-field-feedback]');error.hidden=!cache.error&&!cache.busy;error.textContent=cache.busy?'采配を反映しています…':cache.error;
    container.querySelector('[data-field-action="refresh"]').disabled=cache.loading||cache.busy;
    const q=cache.query.normalize('NFKC').toLocaleLowerCase('ja-JP');
    const filtered=cache.players.filter(p=>(!cache.castleFilter||p.homeCastleId===cache.castleFilter)&&(cache.filter==='all'||cache.filter==='online'&&p.online||cache.filter==='allied'&&relationshipFor(p,cache.me,opts.identity)==='allied')&&(!q||[p.name,p.homeCastleName,p.clan].some(s=>String(s||'').normalize('NFKC').toLocaleLowerCase('ja-JP').includes(q))));
    const pages=Math.max(1,Math.ceil(filtered.length/4));cache.page=Math.min(Math.max(1,cache.page),pages);
    const castleName=cache.players.find(p=>p.homeCastleId===cache.castleFilter)?.homeCastleName;
    container.querySelector('[data-field-filter-label]').innerHTML=`${cache.castleFilter?`<button class="field-inline-button" data-field-action="clear-castle">${esc(castleName||'本拠')}の領主 ${icon('close')}</button>`:`${num(filtered.length)}人${cache.players.length<cache.total?` / ${num(cache.total)}人中を読込済み`:''}`}`;
    container.querySelector('[data-field-players]').innerHTML=filtered.slice((cache.page-1)*4,cache.page*4).map(p=>publicRow(p,{selectedId:cache.selectedId,identity:opts.identity,relationship:relationshipFor(p,cache.me,opts.identity)})).join('')||`<div class="field-list-empty">${cache.loading?'本拠の情報を読み込んでいます…':cache.players.length?'条件に合う領主はいません。':'まだ公開された本拠はありません。領主登録後にクラウド保存すると、あなたの本拠が表示されます。'}</div>`;
    container.querySelector('[data-field-pagination]').innerHTML=`${pages>1?pagination('page',cache.page,pages):''}${cache.nextCursor?`<button class="field-inline-button" data-field-action="load-more"${cache.loading?' disabled':''}>さらに領主を読み込む</button>`:''}`;
    const incoming=cache.me?.relationships?.filter(r=>r.status==='incoming').length||0;container.querySelector('[data-field-incoming]').textContent=incoming?' '+incoming:'';
    if(!current()&&cache.players.length)cache.selectedId=(cache.players.find(p=>p.playerId===opts.identity?.id)||cache.players[0]).playerId;
    renderDetail();decorateCrests();
    const geography=opts.geography||global.SENGOKU_GEOGRAPHY,groups=groupBases(cache.players,geography?.castles||{},global.SENGOKU_DATA?.castles||[],opts.identity,cache.selectedId),self=cache.players.find(p=>p.playerId===opts.identity?.id);
    const mapOptions={stateKey:opts.stateKey+':map:'+String(opts.identity?.id||'guest'),castles:groups,selectedId:current()?.homeCastleId,homeId:self?.homeCastleId,clan:'あなたの本拠',treaties:{'同盟の本拠':1},turn:0,isAdmin:opts.identity?.isAdmin===true,allowRestrictedSelection:true,region:'all',geography,title:'群雄の本拠',eyebrow:'SHARED FIELD · JAPAN',countUnit:'拠点',hideRoutes:true,markerSize:48,markerAppearance,legend:{own:'あなた',ally:'同盟',reachable:'襲撃可能',other:'ほかの領主'},markerTooltip:marker=>({title:marker.name,description:`表示中：${marker.displayPlayerName||''} · ${keepLabel(marker)}`,detail:marker.players?.slice(0,5).map(p=>`${p.name}（${keepLabel(p)}）`).join('・')}),onSelect:castleId=>{cache.castleFilter=castleId;cache.query='';cache.filter='all';cache.page=1;cache.tab='base';cache.confirm=null;const occupants=cache.players.filter(p=>p.homeCastleId===castleId);if(!occupants.some(p=>p.playerId===cache.selectedId))cache.selectedId=occupants[0]?.playerId||'';render();}};
    if(map)map.update(mapOptions);else map=global.SengokuWorldMap?.mount?.(container.querySelector('[data-field-map]'),mapOptions)||null;
    global.SengokuDesktopFit?.refresh?.();
  }
  async function refresh({append=false}={}){
    if(destroyed)return;if(cache.promise)return cache.promise;if(typeof opts.request!=='function'){cache.error='共有フィールドへ接続できません。ページを再読み込みしてください。';notify();return;}
    const target=cache,identity=opts.identity,request=opts.request,cursor=append?target.nextCursor:null;if(append&&!cursor)return;
    target.loading=true;target.error='';notify();
    const promise=Promise.resolve().then(async()=>{
      const results=await Promise.allSettled([request('/field?limit=100'+(cursor?'&cursor='+encodeURIComponent(cursor):''),{method:'GET'}),!append&&identity?.id?request('/field/me',{method:'GET'}):Promise.resolve(null)]);
      if(results[0].status==='fulfilled'){const payload=results[0].value;if(!Array.isArray(payload?.players))throw Error('本拠一覧の応答を確認できませんでした。');const fresh=normalizePlayers(payload);target.players=append?[...new Map([...target.players,...fresh].map(p=>[p.playerId,p])).values()]:fresh;target.total=Math.max(target.players.length,integer(payload.total));target.nextCursor=payload.nextCursor??null;target.rules=rulesFor(payload.rules);target.clock=payload.clock||target.clock;target.lastFetched=Date.now();}
      else target.error=results[0].reason?.message||'本拠を取得できませんでした。「更新」から再接続できます。';
      if(results[1].status==='fulfilled'&&results[1].value){target.me=results[1].value;target.rules=rulesFor(target.me.rules||target.rules);target.clock=target.me.clock||target.clock;}
      else if(results[1].status==='rejected'){target.me=null;target.error=results[1].reason?.message||'あなたの出陣準備を確認できませんでした。';}
      for(const player of target.players){const rel=target.me?.relationships?.find(r=>r.targetPlayerId===player.playerId);if(rel)player.relationship=rel.status;}
    }).catch(error=>{target.error=error.message||'共有フィールドへ再接続してください。';}).finally(()=>{target.loading=false;target.promise=null;for(const callback of target.watchers)callback();});
    target.promise=promise;return promise;
  }
  function schedule(){if(timer!==null)global.clearTimeout(timer);timer=null;if(!destroyed&&!doc.hidden)timer=global.setTimeout(async()=>{timer=null;await refresh();schedule();},15000);}
  async function mutate(route,data){
    if(cache.busy)return;const target=cache,request=opts.request,onMutation=opts.onMutation;if(!canAct()){message('この端末の操作権と共通時刻を確認してください。',true);return;}
    target.busy=true;target.error='';target.confirm=null;notify();
    try{const result=await request(route,{method:'POST',data});if(result?.ok===false)throw Error(result.error?.message||'采配を完了できませんでした。');if(result?.battle){target.lastBattle=result.battle;target.tab='reports';target.battlePage=1;}await onMutation?.(result);target.lastFetched=0;message(route==='/field/attack'?'合戦の報せが届きました。':'外交の状況を更新しました。');}
    catch(error){target.error=error.message||'通信を確認して、もう一度お試しください。';message(target.error,true);}
    finally{target.busy=false;for(const callback of target.watchers)callback();if(!destroyed)await refresh();}
  }
  async function click(event){
    const button=event.target.closest?.('[data-field-action]');if(!button||!container.contains(button)||button.disabled)return;event.stopPropagation();const action=button.dataset.fieldAction;
    if(action==='refresh'){await refresh();return;}if(action==='load-more'){await refresh({append:true});return;}
    if(action==='letter-player'||action==='letter-guild'){if(!opts.identity?.id){opts.onRegister?.();return;}if(global.SengokuLetters?.openCompose)await global.SengokuLetters.openCompose({playerId:button.dataset.playerId,destination:action==='letter-guild'?'guild':'player'});else message('書状を読み込めませんでした。画面を再読み込みしてください。',true);return;}
    if(action==='register'){opts.onRegister?.();return;}if(action==='sync'){(opts.onSync||opts.onRegister)?.();return;}
    if(action==='select-player'){cache.selectedId=button.dataset.playerId;cache.tab='base';cache.confirm=null;cache.troops='';render();return;}
    if(action==='clear-castle'){cache.castleFilter='';cache.page=1;render();return;}
    if(action==='tab'){cache.tab=button.dataset.tab;cache.confirm=null;renderDetail();global.SengokuDesktopFit?.refresh?.();return;}
    if(action==='page'||action==='relationship-page'||action==='battle-page'){const key=action==='page'?'page':action==='relationship-page'?'relationshipPage':'battlePage';cache[key]+=Number(button.dataset.delta)||0;render();return;}
    if(action==='report'){cache.lastBattle=cache.me?.battles?.find(b=>String(b.id)===button.dataset.battleId)||cache.lastBattle;renderDetail();return;}
    if(action==='cancel-attack'){cache.confirm=null;renderDetail();return;}
    if(action==='confirm-attack'){const check=validation();if(!check.ok){message(check.message,true);return;}cache.confirm={playerId:cache.selectedId};renderDetail();global.SengokuDesktopFit?.refresh?.();return;}
    if(action==='attack'){const check=validation();if(!check.ok){message(check.message,true);return;}if(cache.confirm?.playerId!==cache.selectedId)return;await mutate('/field/attack',check.payload);return;}
    if(action==='diplomacy'){const operation=button.dataset.operation;if(!['propose','accept','reject','cancel'].includes(operation))return;await mutate('/field/diplomacy',{targetPlayerId:button.dataset.playerId,action:operation});}
  }
  function input(event){const kind=event.target.dataset.fieldInput;if(!kind)return;
    if(kind==='search'){cache.query=event.target.value;cache.page=1;render();}
    else if(kind==='filter'){cache.filter=event.target.value;cache.page=1;render();}
    else if(kind==='troops'||kind==='tactic'){cache[kind]=event.target.value;cache.confirm=null;const cost=container.querySelector('[data-field-food]');if(cost)cost.textContent=num(foodCost(cache.troops,cache.tactic,cache.rules));const check=validation(),reason=container.querySelector('[data-field-attack-reason]');if(reason)reason.textContent=check.ok?'兵数と戦法を確認して出陣します。':check.message;const confirm=container.querySelector('[data-field-action="confirm-attack"]');if(confirm)confirm.disabled=!check.ok||cache.busy;const sent=container.querySelector('[data-field-action="attack"]');if(sent)renderDetail();}
  }
  bindCache();structure();listen(container,'click',click);listen(container,'input',input);listen(container,'change',event=>{if(event.target.tagName==='SELECT')input(event);});listen(doc,'visibilitychange',()=>{if(!doc.hidden)refresh();schedule();});
  const controller={refresh,update(next={}){if(destroyed)return;const old=key;opts={...opts,...next};bindCache();if(old!==key){map?.destroy();map=null;}render();if(old!==key||Date.now()-cache.lastFetched>15000)refresh();},destroy(){if(destroyed)return;destroyed=true;if(timer!==null)global.clearTimeout(timer);timer=null;map?.destroy();cache.watchers.delete(render);for(const remove of listeners)remove();mounted.delete(container);}};
  mounted.set(container,controller);render();if(Date.now()-cache.lastFetched>15000||!cache.lastFetched)refresh();schedule();return controller;
}
const api={mount,normalizePlayers,groupBases,keepLevelInfo,castleAppearance,markerAppearance,foodCost,remainingLabel,relationshipFor,attackValidation,publicRow};global.SengokuField=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
