/* Private alliance planning, real troop escrow and membership governance. */
(function(global){
'use strict';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=v=>Math.max(0,Math.floor(Number(v)||0)).toLocaleString('ja-JP');
const labels={attack:'攻撃',defend:'防衛',gather:'集合',planned:'予定',marching:'進軍中',completed:'完了',cancelled:'中止',yes:'参加',maybe:'調整中',no:'不参加',stationed:'派遣中',returning:'受取待ち',claimed:'帰還済み',rally:'集結',aid:'援軍',pending:'承認待ち',approved:'承認済み',denied:'辞退',invited:'招待',joined:'参加済み',used:'受取済み',gold:'金銭',rice:'兵糧',wood:'木材',stone:'石材',magatama:'勾玉',treasury:'寄付',defense:'防衛',open:'自由参加',approval:'承認制',invite:'招待制'};
const date=v=>new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(v));
const inputDate=v=>new Date(v+9*3600000).toISOString().slice(0,16);
const parseDate=v=>Date.parse(v+':00+09:00');
const empty=message=>'<p class="alliance-empty">'+esc(message)+'</p>';
const button=(action,label,data='',extra='')=>'<button type="button" class="button" data-alliance="'+action+'"'+(data?' data-id="'+esc(data)+'"':'')+extra+'>'+esc(label)+'</button>';
const field=(label,control)=>'<label>'+esc(label)+control+'</label>';
const textInput=(name,placeholder,max=80,value='')=>'<input class="input" name="'+name+'" maxlength="'+max+'" placeholder="'+esc(placeholder)+'" value="'+esc(value)+'">';
const amountInput=(name,value=1000,max=50000)=>'<input class="input" type="number" inputmode="numeric" min="1" max="'+max+'" step="1" name="'+name+'" value="'+value+'" required>';
const options=(items,value)=>items.map(i=>'<option value="'+esc(i.id)+'"'+(String(i.id)===String(value)?' selected':'')+'>'+esc(i.name)+'</option>').join('');
const select=(name,items,value)=>'<select class="input" name="'+name+'">'+options(items,value)+'</select>';
function createController(opts={}){
 let alive=true,generation=0,loadSeq=0,targetSeq=0,who='',flight=null;
 const context=opts.getContext||(()=>global.SengokuSocial?.getExpansionContext?.()||{user:global.SengokuSocial?.getUser?.()});
 const request=opts.request||((route)=>global.SengokuSocial.expansionRequest(route,{method:'GET'}));
 const mutate=opts.mutate||((route,data)=>global.SengokuBridge.requestExpansion(route,{method:'POST',data}));
 const storage=opts.storage||(()=>{try{return global.localStorage;}catch{return null;}})();
 let s={data:null,targets:[],fieldRules:null,loading:false,sending:false,error:'',message:'',pending:null};
 const key=id=>'sengoku-alliance-pending-v1:'+encodeURIComponent(id);
 const identity=()=>{const c=context()||{},id=String(c.playerId||c.user?.id||'');const stamp=JSON.stringify([id,c.epoch,c.accountEpoch,c.guildEpoch,c.privilegeEpoch,c.user?.guildId||c.guildId||'',c.user?.guildRole||c.guildRole||'']);if(who!==stamp){who=stamp;generation++;loadSeq++;targetSeq++;flight=null;s={data:null,targets:[],fieldRules:null,loading:false,sending:false,error:'',message:'',pending:null};try{const p=JSON.parse(storage?.getItem(key(id))||'null');if(p?.ownerId===id&&typeof p.route==='string'&&p.route.startsWith('/alliance/')&&typeof p.data?.requestId==='string')s.pending=p;}catch{}}return{id,stamp,user:c.user||null};};
 const emit=()=>{if(alive)opts.onChange?.(snapshot());};
 const snapshot=()=>{const current=identity();return{...s,identity:current};};
 async function load(){
  const c=identity(),g=generation,ticket=++loadSeq;if(!c.id){s.error='領主を登録してから同盟作戦をご利用ください。';emit();return false;}
  s.loading=true;s.error='';emit();
  try{const value=await request('/alliance');if(!alive||g!==generation||ticket!==loadSeq||identity().stamp!==c.stamp)return false;if(!value?.ok)throw Error(value?.error?.message||'同盟を読み込めませんでした。');s.data=value;if(value.marches)global.SengokuTravelUI?.ingest(value,{kind:'rally'});if(value.operations?.some(o=>o.kind==='attack'&&o.status==='planned')&&(opts.readField||global.SengokuSocial?.fieldRequest))await loadTargets();return alive&&g===generation&&identity().stamp===c.stamp;}
  catch(e){if(alive&&g===generation)s.error=e.message||'同盟を読み込めませんでした。';return false;}
  finally{if(alive&&g===generation){s.loading=false;emit();}}
 }
 async function loadTargets(){const c=identity(),g=generation,ticket=++targetSeq;try{const value=await (opts.readField?opts.readField():global.SengokuSocial.fieldRequest('/field'));if(!alive||identity().stamp!==c.stamp||g!==generation||ticket!==targetSeq)return false;s.targets=value?.targets||value?.players||[];s.fieldRules=value?.rules||null;emit();return true;}catch(e){if(alive&&identity().stamp===c.stamp&&g===generation&&ticket===targetSeq){s.error=e.message||'共通フィールドを読み込めませんでした。';emit();}return false;}}
 async function send(route,data={}){
  const c=identity();if(!c.id||flight)return false;
  if(s.pending&&(s.pending.route!==route||data.requestId!==s.pending.data.requestId)){s.error='前の操作結果を先に再確認してください。';emit();return false;}
  const pending=s.pending||{ownerId:c.id,route,data:{...data,requestId:data.requestId||global.crypto.randomUUID()}};
  try{if(!storage)throw Error();storage.setItem(key(c.id),JSON.stringify(pending));if(storage.getItem(key(c.id))!==JSON.stringify(pending))throw Error();}catch{s.error='操作記録を保存できません。ブラウザの保存設定を確認してください。';emit();return false;}
  s.pending=pending;s.sending=true;s.error='';s.message='';emit();const g=generation;
  flight=(async()=>{try{
   const value=await mutate(pending.route,pending.data);if(!alive||g!==generation||identity().stamp!==c.stamp)return false;if(value?.ok===false)throw Object.assign(Error(value.error?.message||value.message||'操作できませんでした。'),{status:409});
   const march=global.SengokuTravelUI?.commandMarch(value,pending.data.requestId);if(value.accepted===true&&!march)throw Error('出陣の受付内容を確認できません。同じ操作で確認してください。');if(march)global.SengokuTravelUI?.record(march);
   storage.removeItem(key(c.id));s.pending=null;s.message=march?.status==='marching'?'集結軍が出陣しました。到着してから合戦を行い、生存兵は各参加者へ帰還します。':march?.status==='cancelled'?march.message||'集結軍の出陣が取り消されました。':value?.result?.message||(value?.battle?(value.battle.won?'集結軍が勝利しました。生存兵を受け取れます。':'集結軍は撤退しました。生存兵を受け取れます。'):'同盟の操作を反映しました。');opts.onMessage?.(s.message);await load();return true;
  }catch(e){if(alive&&g===generation){s.error=e.message||'結果を確認できませんでした。同じ操作を再確認してください。';if(e.status>=400&&e.status<500&&![401,408,429].includes(e.status)){storage.removeItem(key(c.id));s.pending=null;}}return false;}
  finally{if(alive&&g===generation){s.sending=false;flight=null;emit();}}
  })();return flight;
 }
 identity();
 return{snapshot,load,loadTargets,send,retry(){return s.pending?send(s.pending.route,s.pending.data):Promise.resolve(false);},dispose(){alive=false;generation++;loadSeq++;}};
}
function rallyAdvice(o,{data,me={},targets=[],game,rules,access={}}={}){
 const advisor=global.SengokuBattleAdvisor;if(!advisor)return null;const unavailable=message=>advisor.compare([],{targetName:o?.castleName,emptyMessage:message});
 if(!o||o.kind!=='attack'||o.status!=='planned'||o.expiresAt<=data?.serverNow)return unavailable('現在進行中の集結攻撃を選んでください。');
 if(o.creatorId!==me.id&&!['owner','officer'].includes(data?.guild?.role))return unavailable('作戦の作成者または同盟役職者が、出陣者の軍団で軍議を行います。仲間は集結への兵の提供で支援できます。');
 if(!game?.state)return unavailable('本領の軍団・士気・研究を読み込んでから軍議を行います。');
 if(access.writable===false||access.gameWritable===false)return unavailable(access.reason||'操作端末と本領の同期を確認してください。');
 if(game.state.gameOver)return unavailable('本拠の状態を回復してから出陣してください。');
 if(o.startsAt>data.serverNow)return unavailable('作戦の開始時刻まで集結兵と補給を整えてください。');
 if(!Number.isSafeInteger(o.troops)||o.troops<300||o.troops>100000)return unavailable('集結兵を300〜100,000人に整えてください。');
 const raw=targets.find(p=>p.playerId===o.targetPlayerId&&(p.targetCastleId||p.homeCastleId)===o.castleId),field=global.SengokuField;
 let target=raw&&field?.normalizePlayers([raw])[0];if(!target)return unavailable('最新の共通フィールドを取得すると、集結軍と公開守備戦力を比較できます。');
 if(o.branchId){if(!target.branches?.some(b=>b.id===o.branchId))return unavailable('対象の支拠点の状態を再取得してください。');target=field.branchTarget(target,o.branchId);}
 if(target.playerId===me.id)return unavailable('自分の拠点には集結攻撃できません。');
 if(!target.attackable||target.relationship==='allied')return unavailable(target.attackReason||'現在この相手には出陣できません。');
 const estimate=field.estimateBattle({player:target,state:game.state,troops:o.troops,tactic:o.tactic||'balanced',rules});if(!estimate.ok)return unavailable(estimate.message);
 if(Number(game.state.command)<1)return unavailable('出陣者の指令が不足しています。回復を待ってください。');
 if(Number(game.state.resources?.rice)<estimate.foodCost)return unavailable(`出陣者の兵糧が${num(estimate.foodCost)}必要です。補給を整えてください。`);
 return advisor.compare([{...estimate,reasons:[`現在の集結兵${num(o.troops)}人と、作戦で決めた${estimate.tacticName}を評価しました。`,'集結兵と戦法はこの軍議から変更しません。出陣者の軍団・士気・研究を使用します。',...estimate.reasons]}],{targetName:target.targetBranchName||o.castleName});
}
function operationTravel(o,game){return global.SengokuTravel?.plan({sourceCastleId:game?.state?.home,targetCastleId:o?.castleId,...(o?.branchId?{branchDirection:o.branchId.split('_').at(-1)}:{})});}
function operationCard(o,d,me,advisorContext={}){
 const organizer=o.creatorId===me.id||['owner','officer'].includes(d.guild?.role),active=o.status==='planned'&&o.expiresAt>d.serverNow;
 const taskRows=o.assignments.map(a=>'<li><span>'+esc(d.members.find(m=>m.id===a.playerId)?.name||'元メンバー')+(global.SengokuPublicCourt?.slot?.(a.playerId)||'')+'：'+esc(a.label)+'</span>'+((a.playerId===me.id||organizer)&&active?'<button class="button small" data-alliance="task" data-id="'+esc(o.id)+'" data-task="'+esc(a.id)+'" data-done="'+(!a.done)+'">'+(a.done?'完了済み':'完了にする')+'</button>':'<b>'+(a.done?'完了':'進行中')+'</b>')+'</li>').join('');
 const counts=['yes','maybe','no'].map(k=>labels[k]+' '+o.rsvps.filter(r=>r.response===k).length).join(' / ');
 return'<article class="alliance-operation" data-operation="'+esc(o.id)+'"><header><span class="alliance-kind">'+esc(labels[o.kind])+'</span><h3>'+esc(o.title)+'</h3><b>'+esc(labels[o.status])+'</b></header><p class="alliance-date">'+esc(date(o.startsAt))+' ～ '+esc(date(o.expiresAt))+' JST</p><p>'+esc(o.castleName)+(o.branchId?'・'+esc({north:'北',east:'東',south:'南',west:'西'}[o.branchId.split('_').at(-1)]||'')+'支拠点':'')+'</p><p>'+esc(o.note)+'</p><p class="alliance-subtle">'+esc(counts)+'</p>'+
 (active?'<div class="alliance-actions">'+['yes','maybe','no'].map(r=>'<button type="button" class="button small" data-alliance="rsvp" data-id="'+esc(o.id)+'" data-response="'+r+'">'+labels[r]+'</button>').join('')+button('map-focus','地図で見る',o.castleId)+'</div>':'')+
 (taskRows?'<ul class="alliance-tasks">'+taskRows+'</ul>':'')+
 (active&&organizer?'<form data-alliance-form="assignment" data-id="'+esc(o.id)+'" class="alliance-inline">'+select('playerId',d.members,me.id)+textInput('label','例：北支拠点を担当',80)+'<button class="button" type="submit">担当を追加</button></form>':'')+
 (active&&o.kind==='attack'?(global.SengokuTravelUI?.preview(operationTravel(o,advisorContext.game))||'')+'<section class="alliance-rally"><h4>集結兵 '+num(o.troops)+' / 100,000人</h4><p>出陣者の軍団・研究・戦法を使用します。兵糧と指令は出陣者が支払い、占領した城と戦利品も出陣者へ反映します。生存兵は各参加者へ帰還します。</p><div data-alliance-advisor-operation="'+esc(o.id)+'">'+(global.SengokuBattleAdvisor?.markup(rallyAdvice(o,{...advisorContext,data:d,me}),{action:'rally-review',disabled:!organizer||advisorContext.blocked,showStyles:false,applyLabel:'この集結軍の出陣を確認',note:'現在の集結兵と作戦の戦法による推定です。確認画面で出陣を決めます。'})||'')+'</div><form data-alliance-form="rally" data-id="'+esc(o.id)+'" class="alliance-inline">'+field('提供する兵',amountInput('troops',1000))+'<button class="button" type="submit">兵を集結へ送る</button></form>'+(organizer?button('launch','この集結軍で出陣',o.id,o.startsAt>d.serverNow?' disabled':''):'')+'</section>':'')+
 (o.status==='marching'?'<section class="alliance-rally"><h4>集結軍が進軍中</h4>'+(global.SengokuTravelUI?.preview(o.march?.travel||o.march)||'')+(global.SengokuTravelUI?.countdownMarkup(o.march,{elapsedMs:global.SengokuWorldClock?.snapshot?.()?.clock?.elapsedMs})||'')+'<p>到着後に合戦を行います。生存兵の帰還は戦果の確定後です。</p>'+button('marches','進軍状況・戦果を見る')+'</section>':'')+
 (o.result&&typeof o.result.won==='boolean'?'<div class="alliance-result"><b>'+(o.result.won?'集結勝利':'集結撤退')+'</b><span>出陣 '+num(o.result.pooledTroops)+'人 / 損失 '+num(o.result.attackerLost)+'人</span></div>':'')+
 (active&&organizer?'<div class="alliance-actions">'+button('complete','作戦を完了',o.id)+button('cancel','作戦を中止',o.id)+'</div>':'')+'</article>';
}
function operationsView(d,me,targets,advisorContext={}){
 if(!d.guild)return empty('同盟へ参加すると作戦予定表と地図マークを共有できます。');
 const castles=global.SENGOKU_DATA?.castles||[],targetOptions=[{id:'',name:'相手を選択（集合・防衛予定は省略可）'},...targets.filter(p=>!p.self&&p.playerId!==me.id).map(p=>({id:p.playerId+':'+(p.targetCastleId||p.homeCastleId),name:p.name+' / '+(p.targetCastleName||p.homeCastleName)}))];
 return'<section class="alliance-panel"><h2>同盟の作戦地図</h2><p>この地図の作戦マークは所属する仲間にだけ共有されます。</p><div class="alliance-map" data-alliance-map></div></section><details class="alliance-panel"><summary>新しい作戦・地図マークを登録</summary><form data-alliance-form="operation" class="alliance-form">'+field('作戦名',textInput('title','例：大坂城の東支拠点へ集結',60))+field('種類',select('kind',[{id:'attack',name:'集結攻撃'},{id:'defend',name:'防衛予定'},{id:'gather',name:'集合・打合せ'}],'attack'))+
 '<div class="alliance-target-load">'+button('targets','共通フィールドの領主を取得')+'</div>'+field('相手の領主と拠点',select('targetKey',targetOptions,''))+field('地図の城',select('castleId',castles,'osaka'))+field('攻撃対象',select('direction',[{id:'',name:'本城'},{id:'north',name:'北支拠点'},{id:'east',name:'東支拠点'},{id:'south',name:'南支拠点'},{id:'west',name:'西支拠点'}],''))+field('戦法',select('tactic',[{id:'balanced',name:'正攻法'},{id:'assault',name:'総攻撃'},{id:'siege',name:'包囲戦'},{id:'ambush',name:'伏兵'}],'balanced'))+
 field('開始（日本時間）','<input class="input" type="datetime-local" name="startsAt" value="'+inputDate(Date.now()+5*60000)+'" required>')+field('終了（日本時間・最大24時間）','<input class="input" type="datetime-local" name="expiresAt" value="'+inputDate(Date.now()+2*3600000)+'" required>')+field('作戦内容','<textarea class="input" name="note" maxlength="500" rows="3" placeholder="集合時刻や担当する支拠点を記入"></textarea>')+'<button class="button primary" type="submit">作戦を登録</button></form></details><div class="alliance-operations">'+(d.operations.map(o=>operationCard(o,d,me,{...advisorContext,targets})).join('')||empty('作戦はまだありません。仲間と次の目標を決めましょう。'))+'</div>';
}
function unitsView(d,me){
 const own=d.units.filter(u=>u.ownerId===me.id),castles=global.SENGOKU_DATA?.castles||[];
 const form=d.guild?'<details class="alliance-panel"><summary>仲間の城へ援軍を派遣</summary><p>兵は派遣中、本隊から離れます。帰還時に収容力を超えた分は消えずに受取待ちへ残ります。</p><form data-alliance-form="aid" class="alliance-form">'+field('援軍先の仲間',select('targetPlayerId',d.members.filter(m=>m.id!==me.id)))+field('守備する城',select('castleId',castles,'osaka'))+field('兵数',amountInput('troops'))+field('駐屯時間',select('hours',[{id:1,name:'1時間'},{id:6,name:'6時間'},{id:12,name:'12時間'},{id:24,name:'24時間'}],6))+'<button class="button primary" type="submit">援軍を派遣</button></form></details>':'';
 const cards=own.map(u=>'<article class="alliance-unit"><div><b>'+esc(labels[u.kind])+'・'+esc(u.castleName)+'</b><p>'+esc(u.targetName||'作戦の攻撃先')+(global.SengokuPublicCourt?.slot?.(u.targetPlayerId)||'')+' / '+num(u.troops)+'人</p><p>'+esc(labels[u.state])+' · 期限 '+esc(date(u.expiresAt))+'</p></div><div class="alliance-actions">'+(u.state==='stationed'?button('recall','撤収する',u.id):u.state==='returning'?button('claim','本隊へ受取',u.id):'')+'</div></article>').join('');
 const others=d.units.filter(u=>u.kind==='aid'&&u.targetPlayerId===me.id&&u.ownerId!==me.id&&u.state==='stationed').map(u=>'<li>'+esc(u.ownerName)+(global.SengokuPublicCourt?.slot?.(u.ownerId)||'')+'から '+num(u.troops)+'人 · '+esc(u.castleName)+'</li>').join('');
 return form+'<section class="alliance-panel"><h2>自分の派遣部隊</h2>'+(cards||empty('派遣中・受取待ちの兵はありません。'))+'</section>'+(others?'<section class="alliance-panel"><h2>あなたの城を守る援軍</h2><ul>'+others+'</ul></section>':'');
}
function membershipView(d,me){
 const canManage=['owner','officer'].includes(d.guild?.role);
 return'<section class="alliance-panel"><h2>同盟を探す</h2><div class="alliance-directory">'+d.directory.map(g=>'<article><h3>'+esc(g.name)+'</h3><p>'+num(g.members)+'人 / '+esc(labels[g.joinMode])+'</p><p>'+esc(g.description||'募集文は未設定')+'</p><small>'+esc(g.activity)+'</small>'+(!d.guild?'<div class="alliance-actions">'+(g.joinMode==='open'?button('join','参加する',g.id):g.joinMode==='approval'?button('apply','加入を申請',g.id):'<span>盟主からの招待をお待ちください。</span>')+'</div>':'')+'</article>').join('')+'</div></section>'+
 '<section class="alliance-panel"><h2>加入申請・招待</h2>'+(d.applications.map(a=>'<article class="alliance-unit"><div><b>'+esc(a.name)+(global.SengokuPublicCourt?.slot?.(a.playerId)||'')+' / '+esc(a.guildName)+'</b><p>'+esc(labels[a.status])+' · '+esc(a.message)+'</p></div><div class="alliance-actions">'+(a.playerId===me.id&&!d.guild&&['approved','invited'].includes(a.status)?button('join','この同盟へ参加',a.guildId):canManage&&a.status==='pending'?'<button class="button" data-alliance="application-approve" data-id="'+esc(a.playerId)+'" data-guild="'+esc(a.guildId)+'">承認</button><button class="button" data-alliance="application-deny" data-id="'+esc(a.playerId)+'" data-guild="'+esc(a.guildId)+'">辞退</button>':'')+'</div></article>').join('')||empty('申請・招待はありません。'))+'</section>'+
 (canManage?'<section class="alliance-panel"><h2>領主を招待</h2><p>交流で確認した領主の公開IDを入力してください。</p><form class="alliance-inline" data-alliance-form="invite">'+textInput('playerId','領主の公開ID',90)+'<button type="submit" class="button">招待を送る</button></form></section>':'');
}
function policyView(d,me){
 if(!d.guild)return empty('同盟へ参加すると金庫のルールと出金申請を確認できます。');
 const p=d.policy,owner=d.guild.role==='owner';
 const editor=owner?'<details class="alliance-panel"><summary>募集・金庫ルールを編集</summary><form data-alliance-form="policy" class="alliance-form">'+field('加入方法',select('joinMode',[{id:'open',name:'自由参加'},{id:'approval',name:'承認制'},{id:'invite',name:'招待制'}],p.joinMode))+field('募集文','<textarea name="description" class="input" maxlength="300" rows="3">'+esc(p.description)+'</textarea>')+field('主な活動時間',textInput('activity','例：平日20〜23時、初心者歓迎',80,p.activity))+field('承認なしで出金できる役職',select('withdrawRole',[{id:'all',name:'全メンバー'},{id:'officers',name:'盟主・副盟主'},{id:'owner',name:'盟主のみ'}],p.withdrawRole))+field('1人1日の出金合計上限','<input class="input" name="dailyLimit" type="number" min="0" max="100000000" value="'+p.dailyLimit+'" required>')+field('この数量を超える出金は承認','<input class="input" name="approvalThreshold" type="number" min="0" max="1000000" value="'+p.approvalThreshold+'" required>')+field('新規加入者の出金待機（時間）','<input class="input" name="newcomerHours" type="number" min="0" max="168" value="'+p.newcomerHours+'" required>')+'<p class="alliance-subtle">1日の区切りは日本時間0時。盟主は管理上の出金制限の対象外です。承認済みでも新規加入待機と1日の上限は守られます。</p><button class="button primary" type="submit">ルールを保存</button></form></details>':'';
 return editor+'<section class="alliance-panel"><h2>現在の出金ルール</h2><p>1人1日 '+num(p.dailyLimit)+'まで / '+num(p.approvalThreshold)+'を超える出金は盟主承認 / 加入後 '+num(p.newcomerHours)+'時間は待機</p><p>通常の預入・出金は交流の共有金庫を利用できます。承認が必要な出金はこちらから申請してください。</p><form data-alliance-form="withdrawal" class="alliance-inline">'+field('資産',select('resource',Object.entries(labels).filter(([id])=>['gold','rice','wood','stone','magatama'].includes(id)).map(([id,name])=>({id,name}))))+field('数量',amountInput('amount',1000,1000000))+'<button type="submit" class="button">出金を申請</button></form></section><section class="alliance-panel"><h2>出金申請</h2>'+(d.withdrawals.map(w=>'<article class="alliance-unit"><div><b>'+esc(w.name)+(global.SengokuPublicCourt?.slot?.(w.playerId)||'')+' · '+esc(labels[w.resource])+' '+num(w.amount)+'</b><p>'+esc(labels[w.status])+' · 期限 '+esc(date(w.expiresAt))+'</p></div><div class="alliance-actions">'+(owner&&w.status==='pending'?button('withdraw-approve','承認',w.id)+button('withdraw-deny','辞退',w.id):w.playerId===me.id&&w.status==='approved'?button('withdraw-claim','承認済み資産を受取',w.id):'')+'</div></article>').join('')||empty('出金申請はありません。'))+'</section>';
}
function contributionsView(d){return'<section class="alliance-panel"><h2>同盟への貢献</h2><p>集結への兵の提供、攻撃、防衛援軍、金庫への寄付を記録します。</p>'+(d.contributions.map(c=>'<article class="alliance-contribution"><div><b>'+esc(c.name)+(global.SengokuPublicCourt?.slot?.(c.playerId)||'')+'</b><span>'+esc(labels[c.kind]||c.kind)+' '+num(c.amount)+'</span></div><p>'+esc(c.detail)+'</p><small>'+esc(date(c.createdAt))+'</small></article>').join('')||empty('貢献記録はまだありません。'))+'</section>';}
function mount(host,opts={}){
 let tab='operations',disposed=false,model=null,confirmation=null,map=null,mapHost=null,selectedCastle='',timer=null,identityTimer=null,lastIdentity='';
 const drafts=new Map(),formKey=form=>form.dataset.allianceForm+':'+(form.dataset.id||'');
 const controller=createController({...opts,onChange:s=>{model=s;render();}}),identity=()=>model?.identity||{};
 function drawMap(){
  const el=host.querySelector('[data-alliance-map]');if(!el||!global.SengokuWorldMap){if(map){map.destroy();map=null;mapHost=null;}return;}
  if(global.SengokuWorldMap.prepareGeography?.(el,drawMap)===false)return;
  const d=model.data,active=d.operations.filter(o=>o.status==='planned'&&o.expiresAt>d.serverNow),byCastle=new Map();for(const o of active){const list=byCastle.get(o.castleId)||[];list.push(o);byCastle.set(o.castleId,list);}
  const castles=(global.SENGOKU_DATA?.castles||[]).map(c=>({...c,owner:byCastle.has(c.id)?'同盟作戦':'',level:1,troops:byCastle.get(c.id)?.reduce((n,o)=>n+o.troops,0)||0,disabled:false}));
  const options={stateKey:'alliance-private-'+d.guild.id,castles,clan:'同盟作戦',allowRestrictedSelection:true,isAdmin:true,selectedId:selectedCastle,region:'all',markerSize:32,onSelect:id=>{selectedCastle=id;map?.update({selectedId:id});const relevant=active.filter(o=>o.castleId===id);opts.onMessage?.(relevant.length?relevant.map(o=>o.title).join(' / '):'この城に同盟作戦はありません。');},markerAppearance:marker=>{const plans=byCastle.get(marker.id);return plans?{html:'<span class="alliance-map-pin">'+esc(labels[plans[0].kind])+'<b>'+plans.length+'</b></span>',label:marker.name+'：'+plans.map(p=>p.title).join('、')}:null;}};
  if(mapHost!==el){map?.destroy();map=global.SengokuWorldMap.mount(el,options);mapHost=el;}else map.update(options);
 }
 function render(){
  if(disposed||!model)return;const d=model.data,me=identity(),tabs=[['operations','作戦・集結'],['units','援軍・帰還'],['members','募集・加入'],['policy','金庫管理'],['contributions','貢献記録']];
  if(lastIdentity!==me.stamp){lastIdentity=me.stamp;drafts.clear();confirmation=null;map?.destroy();map=null;mapHost=null;}
  const openedDetails=[...host.querySelectorAll('details[open]')].map(el=>el.querySelector('summary')?.textContent);
  let content='<div class="alliance-heading"><div><span class="eyebrow">ALLIANCE STRATEGY</span><h2>'+(d?.guild?esc(d.guild.name)+'の作戦本部':'同盟作戦本部')+'</h2><p>仲間と目標を共有し、一緒に攻め、守る。</p></div>'+button('refresh','最新情報に更新')+'</div><div class="alliance-tabs" role="tablist">'+tabs.map(([id,label])=>'<button type="button" class="button'+(tab===id?' primary':'')+'" data-alliance="tab" data-id="'+id+'" role="tab" aria-selected="'+(tab===id)+'">'+label+'</button>').join('')+'</div>';
  if(model.error)content+='<p class="alliance-error" role="alert">'+esc(model.error)+'</p>';
  if(model.message)content+='<p class="alliance-message" role="status">'+esc(model.message)+'</p>';
  if(model.pending)content+='<div class="alliance-pending"><p>前の操作の結果を確認しています。新しい操作は結果の確認後に行えます。</p>'+button('retry','同じ操作の結果を再確認','',''+(model.sending?' disabled':''))+'</div>';
  if(confirmation)content+='<section class="alliance-confirm" role="alertdialog" aria-label="操作の確認"><h3>'+esc(confirmation.title)+'</h3><p>'+esc(confirmation.message)+'</p>'+(global.SengokuTravelUI?.preview(confirmation.travel)||'')+'<div class="alliance-actions">'+button('confirm','確認して実行')+button('dismiss','戻る')+'</div></section>';
  if(!d)content+=empty(model.loading?'同盟の情報を読み込んでいます。':'領主登録と接続状態を確認してください。');
  else content+='<div class="alliance-body"'+(model.sending?' aria-busy="true"':'')+'>'+(
   tab==='operations'?operationsView(d,me,model.targets,{game:opts.getGame?.(),rules:model.fieldRules,access:opts.getContext?.()||{},blocked:model.sending||Boolean(model.pending)}):tab==='units'?unitsView(d,me):tab==='members'?membershipView(d,me):tab==='policy'?policyView(d,me):contributionsView(d))+'</div>';
  const active=global.document?.activeElement,editing=active&&host.contains(active)&&/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName);
  if(editing&&!confirmation&&!model.sending&&d&&host.querySelector('.alliance-body'))return;
  if(global.SengokuStableDOM)global.SengokuStableDOM.patch(host,content);else host.innerHTML=content;
  host.querySelectorAll('form[data-alliance-form]').forEach(form=>{const draft=drafts.get(formKey(form));if(draft)for(const el of form.elements){if(el.name&&Object.hasOwn(draft,el.name))el.value=draft[el.name];}});
  host.querySelectorAll('details').forEach(el=>{if(openedDetails.includes(el.querySelector('summary')?.textContent))el.open=true;});
  if(model.sending||model.pending)host.querySelectorAll('.alliance-body button,.alliance-body input,.alliance-body select,.alliance-body textarea').forEach(el=>el.disabled=true);
  drawMap();
 }
 function confirm(title,message,route,data,travel=null){confirmation={title,message,route,data,travel};render();host.querySelector('.alliance-confirm button')?.focus();}
 async function click(event){
  const el=event.target.closest?.('[data-alliance],[data-battle-advisor-action]');if(!el||!host.contains(el)||el.disabled)return;let action=el.dataset.alliance,id=el.dataset.id;const d=model?.data,me=identity();if(el.dataset.battleAdvisorAction==='rally-review'){
   event.preventDefault();if(!d||model.sending||model.pending)return;id=el.closest('[data-alliance-advisor-operation]')?.dataset.allianceAdvisorOperation;const operation=d.operations.find(o=>o.id===id),advice=rallyAdvice(operation,{data:d,me,targets:model.targets,game:opts.getGame?.(),rules:model.fieldRules,access:opts.getContext?.()||{}});if(!advice?.ok){opts.onMessage?.(advice?.message||'最新の集結状況を確認してください。');return;}action='launch';
  }if(action==='marches'){global.SengokuTravelUI?.open();return;}if(action==='tab'){tab=id;confirmation=null;render();return;}if(action==='refresh'){await controller.load();return;}if(action==='retry'){await controller.retry();return;}if(action==='targets'){await controller.loadTargets();return;}if(action==='dismiss'){confirmation=null;render();return;}
  if(action==='confirm'){const c=confirmation;confirmation=null;if(c){await controller.send(c.route,c.data);}return;}
  if(action==='map-focus'){selectedCastle=id;map?.update({selectedId:id});map?.fit('selected',true);host.querySelector('[data-alliance-map]')?.scrollIntoView({behavior:'smooth',block:'nearest'});return;}
  if(!d||model.sending||model.pending)return;
  if(action==='rsvp')return controller.send('/alliance/operations/rsvp',{operationId:id,response:el.dataset.response});
  if(action==='task')return controller.send('/alliance/operations/assign',{operationId:id,assignmentId:el.dataset.task,done:el.dataset.done==='true'});
  if(action==='launch'){const o=d.operations.find(o=>o.id===id);return confirm('集結軍を出陣させますか',num(o.troops)+'人で'+o.castleName+'へ出陣します。あなたの指令と兵糧を消費します。距離に応じて移動し、到着時に合戦を行います。兵の損失・占領・戦利品は到着後に確定します。','/alliance/rally/launch',{operationId:id},operationTravel(o,opts.getGame?.()));}
  if(action==='cancel'||action==='complete')return confirm(action==='cancel'?'作戦を中止しますか':'作戦を完了しますか','集結中の兵は各参加者の受取待ちへ戻ります。','/alliance/operations/'+action,{operationId:id});
  if(action==='recall')return confirm('部隊を撤収しますか','防衛・集結から外し、生存兵を受取待ちへ戻します。','/alliance/units/recall',{unitId:id});
  if(action==='claim')return controller.send('/alliance/units/claim',{unitId:id});
  if(action==='apply')return controller.send('/alliance/apply',{guildId:id,message:'同盟への参加を希望します。'});
  if(action==='join'){try{await (opts.join?opts.join(id):global.SengokuSocial.expansionRequest('/guild/join',{method:'POST',data:{guildId:id}}));await global.SengokuSocial?.refresh?.();await controller.load();}catch(e){opts.onMessage?.(e.message);}return;}
  if(action.startsWith('application-'))return controller.send('/alliance/membership',{guildId:el.dataset.guild,playerId:id,decision:action==='application-approve'?'approve':'deny'});
  if(action==='withdraw-claim')return controller.send('/alliance/treasury/claim',{withdrawalId:id});
  if(action==='withdraw-approve'||action==='withdraw-deny')return controller.send('/alliance/treasury/approve',{withdrawalId:id,decision:action==='withdraw-approve'?'approve':'deny'});
 }
 async function submit(event){
  const form=event.target.closest?.('[data-alliance-form]');if(!form||!host.contains(form))return;event.preventDefault();if(model.sending||model.pending)return;const v=Object.fromEntries(new FormData(form)),kind=form.dataset.allianceForm,d=model.data;
  if(kind==='operation'){const [targetPlayerId,targetCastle]=String(v.targetKey||'').split(':'),castleId=targetCastle||v.castleId;return controller.send('/alliance/operations/create',{title:v.title,note:v.note,kind:v.kind,targetPlayerId:targetPlayerId||null,castleId,branchId:v.direction?castleId+'_'+v.direction:null,tactic:v.tactic,startsAt:parseDate(v.startsAt),expiresAt:parseDate(v.expiresAt)});}
  if(kind==='assignment')return controller.send('/alliance/operations/assign',{operationId:form.dataset.id,playerId:v.playerId,label:v.label});
  if(kind==='rally')return confirm('兵を集結へ送りますか',num(v.troops)+'人を本隊から預けます。出陣時に損失が発生し、生存兵は受取待ちへ戻ります。','/alliance/rally/join',{operationId:form.dataset.id,troops:Number(v.troops)});
  if(kind==='aid')return confirm('援軍を派遣しますか',num(v.troops)+'人を本隊から派遣し、仲間の城を守ります。防衛戦で損失が発生することがあります。','/alliance/reinforcements/send',{targetPlayerId:v.targetPlayerId,castleId:v.castleId,troops:Number(v.troops),hours:Number(v.hours)});
  if(kind==='invite')return controller.send('/alliance/invite',{guildId:d.guild.id,playerId:v.playerId});
  if(kind==='policy')return controller.send('/alliance/policy',{...v,revision:d.policy.revision,dailyLimit:Number(v.dailyLimit),approvalThreshold:Number(v.approvalThreshold),newcomerHours:Number(v.newcomerHours)});
  if(kind==='withdrawal')return controller.send('/alliance/treasury/request',{resource:v.resource,amount:Number(v.amount),transferRequestId:global.crypto.randomUUID()});
 }
 const edit=event=>{const form=event.target.closest?.('form[data-alliance-form]');if(form&&host.contains(form))drafts.set(formKey(form),Object.fromEntries(new FormData(form)));};
 host.classList.add('alliance-screen');host.addEventListener('click',click);host.addEventListener('submit',submit);host.addEventListener('input',edit);host.addEventListener('change',edit);
 void controller.load();timer=global.setInterval(()=>{if(!global.document.hidden&&!model?.sending&&!model?.pending&&!host.querySelector('input:focus,textarea:focus,select:focus'))void controller.load();},30000);
 identityTimer=global.setInterval(()=>{const next=controller.snapshot();if(next.identity.stamp!==lastIdentity){model=next;render();void controller.load();}},1000);
 return{refresh:()=>controller.load(),destroy(){disposed=true;global.clearInterval(timer);global.clearInterval(identityTimer);controller.dispose();map?.destroy();host.removeEventListener('click',click);host.removeEventListener('submit',submit);host.removeEventListener('input',edit);host.removeEventListener('change',edit);},controller};
}
let opened=null;
function open(options={}){
 if(opened){opened.controller.refresh();return opened;}
 const before=global.document.activeElement,dialog=global.document.createElement('dialog');dialog.className='alliance-dialog';dialog.innerHTML='<div class="alliance-dialog-top"><b>同盟作戦本部</b><button type="button" class="button" data-alliance-close aria-label="同盟作戦を閉じる">閉じる</button></div><div class="alliance-dialog-content"></div>';global.document.body.append(dialog);
 const controller=mount(dialog.querySelector('.alliance-dialog-content'),options),close=()=>{controller.destroy();dialog.close();dialog.remove();opened=null;before?.focus?.();};
 dialog.querySelector('[data-alliance-close]').addEventListener('click',close);dialog.addEventListener('cancel',e=>{e.preventDefault();close();});dialog.showModal();opened={controller,close};return opened;
}
const api={createController,mount,open,parseDate,inputDate,operationCard,policyView,rallyAdvice};global.SengokuAlliance=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
