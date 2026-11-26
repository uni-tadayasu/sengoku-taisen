/* A searchable snapshot of the campaign's retained log. Reading and exporting
   never issue a game command, replace a save, or start a network request. */
(function (global) {
  'use strict';
  const LIMIT=160,PAGE_SIZE=20,BATTLE_LIMIT=30;
  const OUTCOMES={all:'すべて',won:'勝利',lost:'敗北'};
  const BATTLE_TYPES={attack:'攻城戦',attackBranch:'支拠点戦',battleRoaming:'野良兵戦'};
  const GROUPS={all:'すべて',campaign:'合戦・進軍',development:'内政・普請',people:'家臣・招集',rewards:'任務・報酬',story:'物語・暦',other:'その他'};
  const KINDS={campaign:['battle','march','victory','defeat','army','covert','scout','diplomacy','world'],development:['build','research','complete','upkeep'],people:['officer','gacha'],rewards:['quest','gift'],story:['story','guide','cycle','calendar','event']};
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const normalize=value=>String(value??'').normalize('NFKC').toLocaleLowerCase('ja-JP').replace(/[\u30a1-\u30f6]/g,c=>String.fromCharCode(c.charCodeAt(0)-0x60));
  const groupFor=kind=>Object.keys(KINDS).find(key=>KINDS[key].includes(kind))||'other';
  const queryValue=value=>String(value??'').slice(0,80);
  function snapshot(game,options={}) {
    const source=Array.isArray(game?.state?.log)?game.state.log:[];
    const occurrences=new Map();
    return source.slice(0,LIMIT).flatMap((entry,index)=>{
      if(!entry||typeof entry.text!=='string')return [];
      const turn=Number.isFinite(Number(entry.turn))?Number(entry.turn):null;
      const text=typeof options.formatText==='function'?String(options.formatText(entry.text)):entry.text;
      const kind=typeof entry.kind==='string'?entry.kind:'info',group=groupFor(kind);
      const date=turn!==null&&typeof options.formatDate==='function'?String(options.formatDate(turn)):turn===null?'時点不明':'記録時点 '+turn;
      const identity=JSON.stringify([turn,kind,entry.text]),occurrence=occurrences.get(identity)||0;
      occurrences.set(identity,occurrence+1);
      return [{index,turn,text,kind,group,date,key:identity+':'+occurrence,search:normalize(text+' '+date+' '+GROUPS[group])}];
    });
  }
  function battleSnapshot(game,options={}) {
    const reports=game?.state?.progress?.reports;
    if(!Array.isArray(reports))return [];
    const occurrences=new Map(),names=new Map();
    const metric=value=>Number.isSafeInteger(value)&&value>=0?value:null;
    const officerName=id=>{
      if(!names.has(id))names.set(id,game.officer?.(id)?.name||id);
      return names.get(id);
    };
    return reports.slice(0,BATTLE_LIMIT).flatMap((report,index)=>{
      if(!report||typeof report.won!=='boolean')return [];
      const name=typeof report.name==='string'&&report.name.trim()?report.name:'戦場名不明';
      const type=typeof report.id==='string'?report.id.split(':',1)[0]:'';
      const battleType=Object.hasOwn(BATTLE_TYPES,type)?BATTLE_TYPES[type]:'合戦';
      const turn=metric(report.turn),date=turn===null?'時点不明':typeof options.formatDate==='function'?String(options.formatDate(turn)):'記録時点 '+turn;
      const army=(Array.isArray(report.army)?report.army:[]).filter(id=>typeof id==='string'&&id).slice(0,3).map(officerName);
      const group=report.won?'won':'lost',summary=typeof report.summary==='string'?report.summary:'';
      const chance=metric(report.chance);
      const identity=typeof report.id==='string'&&report.id?report.id:JSON.stringify([turn,name,group,army,report.lost]);
      const occurrence=occurrences.get(identity)||0;
      occurrences.set(identity,occurrence+1);
      return [{index,key:JSON.stringify([identity,occurrence]),name,date,group,battleType,type,
        attack:metric(report.attack),defense:metric(report.defense),lost:metric(report.lost),chance:chance!==null&&chance<=100?chance:null,
        summary,army,search:normalize([name,date,battleType,OUTCOMES[group],...army,summary].join(' '))}];
    });
  }
  function displayMetric(value,unit='') {return value===null?'未記録':value.toLocaleString('ja-JP')+unit;}
  function battleFields(row) {
    const forecast=row.chance===null?'未記録':row.type==='battleRoaming'?(row.chance===100?'勝利見込み':'敗北見込み'):displayMetric(row.chance,'%');
    return {'戦場':row.name,'合戦の種類':row.battleType,'記録時点':row.date,'勝敗':OUTCOMES[row.group],
      '合戦時の見込み':forecast,'自軍戦力':displayMetric(row.attack),'敵軍戦力':displayMetric(row.defense),
      '自軍兵損':displayMetric(row.lost,'人'),'出陣した武将':row.army.join('・')||'未記録'};
  }
  function summaryText(rows) {
    if(!rows.length)return '';
    const wins=rows.filter(row=>row.group==='won').length,losses=rows.filter(row=>row.lost!==null);
    const lost=losses.reduce((sum,row)=>sum+row.lost,0);
    return '勝利 '+wins+'戦 ／ 敗北 '+(rows.length-wins)+'戦 ／ 実績勝率 '+Math.round(100*wins/rows.length)+'% ／ 自軍兵損 '+
      (losses.length?displayMetric(lost,'人')+(losses.length<rows.length?'（記録のある'+losses.length+'戦）':''):'未記録');
  }
  function battleCard(row) {
    const fields=battleFields(row);
    return '<li class="campaign-record campaign-battle" data-records-index="'+row.index+'" data-outcome="'+row.group+'"><div><time>'+esc(row.date)+'</time><span>'+row.battleType+' · '+OUTCOMES[row.group]+'</span></div>'+
      '<h3>'+esc(row.name)+'</h3><dl class="campaign-battle-stats">'+['自軍戦力','敵軍戦力','自軍兵損','合戦時の見込み'].map(label=>'<div><dt>'+label+'</dt><dd>'+esc(fields[label])+'</dd></div>').join('')+
      '</dl><p>出陣した武将　'+esc(fields['出陣した武将'])+'</p>'+(row.summary?'<p>'+esc(row.summary)+'</p>':'')+'</li>';
  }
  function filterRecords(rows,options={}) {
    const groups=options.view==='battles'?OUTCOMES:GROUPS;
    const group=Object.hasOwn(groups,options.group)?options.group:'all';
    const words=normalize(queryValue(options.query)).trim().split(/\s+/).filter(Boolean);
    const result=rows.filter(row=>(group==='all'||row.group===group)&&words.every(word=>row.search.includes(word)));
    // Array position is authoritative. In-game month/turn wraps each cycle.
    return options.order==='oldest'?result.slice().reverse():result;
  }
  function exportText(rows,options={}) {
    const query=queryValue(options.query).replace(/[\r\n\t]+/g,' ').trim();
    if(options.view==='battles')return ['戦国VS — 出陣戦績','閲覧用テキストです。ゲームの復元用セーブではありません。',
      '保存されている最新'+BATTLE_LIMIT+'戦までが対象です。','勝敗：'+(Object.hasOwn(OUTCOMES,options.group)?OUTCOMES[options.group]:OUTCOMES.all)+' / 順序：'+(options.order==='oldest'?'古い記録から':'新しい記録から'),
      '検索：'+(query||'指定なし')+' / '+rows.length+'戦',summaryText(rows),'',
      ...rows.flatMap(row=>['【'+row.name+'】',...Object.entries(battleFields(row)).slice(1).map(([label,value])=>label+'：'+value),row.summary,''])].join('\n');
    return ['戦国VS — 領国の戦記','閲覧用テキストです。ゲームの復元用セーブではありません。',
      'ゲームに残っている最新'+LIMIT+'件までが対象です。記録順はゲーム内の日付順と異なる場合があります。',
      '種類：'+(Object.hasOwn(GROUPS,options.group)?GROUPS[options.group]:GROUPS.all)+' / 順序：'+(options.order==='oldest'?'古い記録から':'新しい記録から'),
      '検索：'+(query||'指定なし')+' / '+rows.length+'件','',
      ...rows.flatMap(row=>['【'+row.date+' / '+GROUPS[row.group]+'】',row.text,''])].join('\n');
  }
  let dialog=null,session=null;
  function identity(game) {
    const state=game?.state||{},access=global.SengokuSocial?.getExpansionContext?.()||{};
    return JSON.stringify([state.walking?.campaignId||state.campaignId||'',state.clan||'',state.home||'',
      game?.isStaff===true,game?.isAdmin===true,access.playerId||access.user?.id||'',access.epoch,access.accountEpoch,
      access.privilegeEpoch,access.pending===true,access.banned===true]);
  }
  function finish() {
    const current=session;if(!current)return;
    session=null;current.unsubscribe?.();
    for(const name of ['sengoku:game-saved','hashchange','pagehide'])global.removeEventListener?.(name,validateScope);
    global.document?.removeEventListener?.('visibilitychange',validateScope);
    // Clear old player data as soon as the dialog is dismissed.
    if(dialog){
      for(const node of dialog.querySelectorAll('[data-records-list],[data-records-battle-summary],[data-records-comparison],[data-records-pick],[data-records-count],[data-records-feedback]'))node.replaceChildren();
      dialog.querySelector('[data-records-query]').value='';
    }
    if(current.returnFocus?.isConnected&&!current.returnFocus.closest?.('[hidden]'))current.returnFocus.focus({preventScroll:true});
  }
  function close(){if(dialog?.open)dialog.close();finish();}
  function validateScope(event) {
    if(!session)return false;
    if(event?.type==='pagehide'){close();return false;}
    const game=session.options.getGame?.()||session.options.game;
    if(game!==session.game||identity(game)!==session.identity||global.SENGOKU_AT_TITLE===true){close();return false;}
    return true;
  }
  function ensureDialog() {
    if(dialog)return dialog;
    const doc=global.document;if(!doc?.createElement)return null;
    dialog=doc.createElement('dialog');dialog.setAttribute('class','campaign-records-dialog');
    dialog.setAttribute('aria-labelledby','campaign-records-title');dialog.setAttribute('aria-describedby','campaign-records-note');
    dialog.innerHTML=`
      <header class="campaign-records-header"><h2 id="campaign-records-title">領国の戦記</h2><button type="button" data-records-close>閉じる</button></header>
      <div class="campaign-records-tools">
        <div class="campaign-records-views" role="group" aria-label="記録の種類"><button type="button" data-records-view="journal">出来事の記録</button><button type="button" data-records-view="battles">出陣戦績</button></div>
        <label class="campaign-records-search"><span data-records-search-label>戦記を検索</span><input type="search" data-records-query maxlength="80" autocomplete="off" placeholder="城・武将・出来事の名前"></label>
        <div class="campaign-records-selects"><label><span data-records-group-label>出来事の種類</span><select data-records-group></select></label><label><span>記録の順序</span><select data-records-order><option value="newest">新しい順</option><option value="oldest">古い順</option></select></label></div>
        <div class="campaign-records-status"><p role="status" aria-live="polite" data-records-count></p><button type="button" data-records-reset>条件をリセット</button></div>
      </div>
      <div class="campaign-records-scroll" data-records-scroll tabindex="0" aria-label="戦記の検索結果">
        <section class="campaign-battle-overview" data-records-overview hidden aria-label="検索結果の戦績"><p data-records-battle-summary></p>
          <details data-records-compare><summary>2戦を比較</summary>
            <div class="campaign-battle-selects"><label>合戦①<select data-records-pick="0"></select></label><label>合戦②<select data-records-pick="1"></select></label></div>
            <table class="campaign-battle-table"><thead><tr><th scope="col">項目</th><th scope="col">合戦①</th><th scope="col">合戦②</th></tr></thead><tbody data-records-comparison></tbody></table>
          </details>
        </section>
        <ol class="campaign-records-list" data-records-list></ol>
        <div class="campaign-records-empty" data-records-empty hidden><strong></strong><p></p></div>
      </div>
      <nav class="campaign-records-pagination" aria-label="戦記のページ"><button type="button" data-records-page="-1">前の20件</button><span data-records-page-label></span><button type="button" data-records-page="1">次の20件</button></nav>
      <footer class="campaign-records-footer"><p id="campaign-records-note"></p><div><button type="button" data-records-refresh>最新の記録を取得</button><button type="button" data-records-export>検索結果をテキスト保存</button></div><p class="campaign-records-feedback" data-records-feedback role="status" aria-live="polite"></p></footer>`;
    // Leave native Escape/cancel behavior intact while keeping the app's
    // document-level Escape handler from clearing an underlying modal.
    dialog.addEventListener('keydown',event=>{if(event.key==='Escape')event.stopPropagation();});
    dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
    dialog.addEventListener('close',()=>{if(!dialog.open)finish();});
    dialog.addEventListener('click',event=>{
      if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(Number.isFinite(event.clientX)&&Number.isFinite(event.clientY)&&(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom))close();return;}
      const button=event.target.closest?.('[data-records-close],[data-records-view],[data-records-reset],[data-records-page],[data-records-refresh],[data-records-export]');
      if(!button)return;if(button.hasAttribute('data-records-close'))return close();
      if(!validateScope())return;
      if(button.hasAttribute('data-records-view')){switchView(button.dataset.recordsView);return;}
      if(button.hasAttribute('data-records-reset')){session.query='';session.group='all';session.page=1;dialog.querySelector('[data-records-query]').value='';dialog.querySelector('[data-records-group]').value='all';render();dialog.querySelector('[data-records-query]').focus({preventScroll:true});}
      else if(button.hasAttribute('data-records-page')){session.page+=Number(button.dataset.recordsPage)||0;render();dialog.querySelector('[data-records-scroll]').focus({preventScroll:true});}
      else if(button.hasAttribute('data-records-refresh'))refresh();
      else download();
    });
    const input=event=>{if(!event.target.matches?.('[data-records-query]')||event.isComposing||!validateScope())return;session.query=queryValue(event.target.value);session.page=1;render();};
    dialog.addEventListener('input',input);dialog.addEventListener('compositionend',input);
    dialog.addEventListener('change',event=>{
      if(!validateScope())return;
      if(event.target.matches?.('[data-records-pick]')){pickBattle(Number(event.target.dataset.recordsPick),Number(event.target.value));return;}
      if(event.target.matches?.('[data-records-group]'))session.group=Object.hasOwn(session.view==='battles'?OUTCOMES:GROUPS,event.target.value)?event.target.value:'all';
      else if(event.target.matches?.('[data-records-order]'))session.order=event.target.value==='oldest'?'oldest':'newest';else return;
      session.page=1;render();
    });
    doc.body.appendChild(dialog);return dialog;
  }
  function updateViewControls() {
    const battle=session.view==='battles',group=dialog.querySelector('[data-records-group]');
    for(const button of dialog.querySelectorAll('[data-records-view]'))button.setAttribute('aria-pressed',String(button.dataset.recordsView===session.view));
    dialog.querySelector('[data-records-group-label]').textContent=battle?'勝敗':'出来事の種類';
    group.innerHTML=Object.entries(battle?OUTCOMES:GROUPS).map(([key,label])=>'<option value="'+key+'">'+label+'</option>').join('');
    group.value=session.group;
    dialog.querySelector('[data-records-order]').value=session.order;
    const input=dialog.querySelector('[data-records-query]');
    input.value=session.query;input.placeholder=battle?'戦場名・武将名・合戦の種類':'城・武将・出来事の名前';
    dialog.querySelector('[data-records-search-label]').textContent=battle?'出陣戦績を検索':'戦記を検索';
    dialog.querySelector('#campaign-records-note').textContent=battle?'攻城戦・支拠点戦・野良兵戦で保存された最新30戦が対象です。実績勝率と兵損は検索結果から集計します。':'保存されている最新160件までを表示します。月日は周回するため、記録された順に並べます。表示中は自動更新しません。';
    dialog.querySelector('[data-records-feedback]').textContent='';
  }
  function switchView(view) {
    if(!['journal','battles'].includes(view)||view===session.view)return;
    const {query,group,order,page}=session;
    session.views[session.view]={query,group,order,page,scrollTop:dialog.querySelector('[data-records-scroll]').scrollTop};
    session.view=view;
    if(view==='battles'&&!session.snapshots.battles)session.snapshots.battles=battleSnapshot(session.game,session.options);
    const restored=session.views[view]||{query:'',group:'all',order:'newest',page:1,scrollTop:0};
    Object.assign(session,restored,{rows:session.snapshots[view]});
    updateViewControls();render({scrollTop:restored.scrollTop});
  }
  function pickBattle(slot,index) {
    if(session.view!=='battles'||![0,1].includes(slot))return;
    const picked=session.filtered.find(row=>row.index===index);
    if(!picked)return;
    if(picked.key===session.picks[1-slot])session.picks[1-slot]=session.picks[slot];
    session.picks[slot]=picked.key;
    renderBattleOverview(session.filtered);
  }
  function renderBattleOverview(rows) {
    const battle=session.view==='battles',overview=dialog.querySelector('[data-records-overview]');
    overview.hidden=!battle||!rows.length;
    if(!battle)return;
    dialog.querySelector('[data-records-battle-summary]').textContent=summaryText(rows);
    const details=dialog.querySelector('[data-records-compare]');
    details.hidden=rows.length<2;
    if(details.hidden){details.open=false;return;}
    const previous=session.picks.map(key=>rows.find(row=>row.key===key));
    const first=previous[0]||rows.find(row=>row!==previous[1]);
    const second=previous[1]||rows.find(row=>row!==first);
    session.picks=[first.key,second.key];
    const options=rows.map(row=>'<option value="'+row.index+'">'+(row.index+1)+'. '+esc(row.name)+' · '+esc(row.date)+' · '+OUTCOMES[row.group]+'</option>').join('');
    for(const [slot,row] of [first,second].entries()){
      const select=dialog.querySelector('[data-records-pick="'+slot+'"]');
      select.innerHTML=options;select.value=String(row.index);
    }
    const fields=battleFields(first),other=battleFields(second);
    dialog.querySelector('[data-records-comparison]').innerHTML=Object.entries(fields).map(([label,value])=>'<tr><th scope="row">'+label+'</th><td>'+esc(value)+'</td><td>'+esc(other[label])+'</td></tr>').join('');
  }
  function render(options={}) {
    if(!dialog?.open||!validateScope())return;
    const rows=filterRecords(session.rows,session),pages=Math.max(1,Math.ceil(rows.length/PAGE_SIZE));
    session.page=Math.max(1,Math.min(session.page,pages));
    const visible=rows.slice((session.page-1)*PAGE_SIZE,session.page*PAGE_SIZE),scroll=dialog.querySelector('[data-records-scroll]');
    session.visible=visible;session.filtered=rows;
    const battle=session.view==='battles';
    renderBattleOverview(rows);
    dialog.querySelector('[data-records-list]').innerHTML=battle?visible.map(battleCard).join(''):visible.map(row=>'<li class="campaign-record" data-records-index="'+row.index+'" data-records-kind="'+row.group+'"><div><time>'+esc(row.date)+'</time><span>'+esc(GROUPS[row.group])+'</span></div><p>'+esc(row.text)+'</p></li>').join('');
    dialog.querySelector('[data-records-count]').textContent=battle?'検索結果 '+rows.length+'戦 / 対象 '+session.rows.length+'戦':'検索結果 '+rows.length+'件 / 対象 '+session.rows.length+'件 · 最新'+LIMIT+'件まで';
    dialog.querySelector('[data-records-page-label]').textContent=session.page+' / '+pages+'頁';
    dialog.querySelector('[data-records-page="-1"]').disabled=session.page<=1;
    dialog.querySelector('[data-records-page="1"]').disabled=session.page>=pages;
    dialog.querySelector('[data-records-export]').disabled=rows.length===0;
    dialog.querySelector('[data-records-reset]').disabled=!session.query&&session.group==='all';
    const empty=dialog.querySelector('[data-records-empty]');empty.hidden=rows.length>0;
    if(!rows.length){
      empty.querySelector('strong').textContent=battle?(session.rows.length?'条件に合う出陣戦績はありません':'出陣戦績はまだありません'):'該当する戦記はありません';
      empty.querySelector('p').textContent=battle&&!session.rows.length?'攻城戦・支拠点戦・野良兵戦を終えると記録されます。':battle?'検索する言葉や勝敗を変えてください。':'検索する言葉や出来事の種類を変えてください。';
    }
    scroll.scrollTop=options.scrollTop??0;
  }
  function refresh() {
    if(!validateScope())return;
    const scroll=dialog.querySelector('[data-records-scroll]'),top=scroll.scrollTop;
    const scrollTop=scroll.getBoundingClientRect().top;
    const anchorNode=Array.from(dialog.querySelectorAll('[data-records-index]')).find(node=>node.getBoundingClientRect().bottom>scrollTop);
    const anchorRow=session.visible?.find(row=>row.index===Number(anchorNode?.dataset.recordsIndex))||session.visible?.[0];
    const first=anchorRow?.key,offset=(session.page-1)*PAGE_SIZE,anchorOffset=anchorNode?anchorNode.getBoundingClientRect().top-scrollTop:0;
    session.rows=session.view==='battles'?battleSnapshot(session.game,session.options):snapshot(session.game,session.options);
    session.snapshots[session.view]=session.rows;
    const rows=filterRecords(session.rows,session),anchor=first?rows.findIndex(row=>row.key===first):-1;
    session.page=Math.floor((anchor>=0?anchor:Math.min(offset,Math.max(0,rows.length-1)))/PAGE_SIZE)+1;
    render({scrollTop:top});
    if(anchor>=0){const next=dialog.querySelector('[data-records-index="'+rows[anchor].index+'"]');if(next)scroll.scrollTop+=next.getBoundingClientRect().top-scroll.getBoundingClientRect().top-anchorOffset;}
    dialog.querySelector('[data-records-feedback]').textContent='最新の記録に更新しました。検索条件と並び順を保持しています。';
  }
  function download() {
    if(!validateScope())return false;
    const feedback=dialog.querySelector('[data-records-feedback]');
    let url='',link=null;
    try {
      if(!global.URL?.createObjectURL||!global.Blob)throw Error('download unavailable');
      const text=exportText(session.filtered,session);url=global.URL.createObjectURL(new global.Blob(['\uFEFF'+text],{type:'text/plain;charset=utf-8'}));
      link=global.document.createElement('a');link.href=url;link.download=session.view==='battles'?'sengoku-battle-reports.txt':'sengoku-war-records.txt';
      global.document.body.appendChild(link);link.click();
      feedback.textContent=session.filtered.length+(session.view==='battles'?'戦の出陣戦績':'件の戦記')+'をテキストで書き出しました。';return true;
    } catch(error) {feedback.textContent='テキストを保存できませんでした。このブラウザのダウンロード設定を確認してください。';return false;}
    finally {
      link?.remove();
      // Release failed downloads too, after the browser can consume a success.
      if(url)global.setTimeout(()=>global.URL.revokeObjectURL(url),1000);
    }
  }
  function open(options={}) {
    const game=options.getGame?.()||options.game;if(!game||global.SENGOKU_AT_TITLE===true)return false;
    const el=ensureDialog();if(!el)return false;if(session)close();
    const snapshots={journal:snapshot(game,options)};
    const current={options,game,identity:identity(game),returnFocus:global.document.activeElement,snapshots,rows:snapshots.journal,view:'journal',views:{},picks:[],query:'',group:'all',order:'newest',page:1,unsubscribe:null};
    session=current;el.querySelector('[data-records-compare]').open=false;updateViewControls();
    el.showModal();render();
    for(const name of ['sengoku:game-saved','hashchange','pagehide'])global.addEventListener?.(name,validateScope);
    global.document?.addEventListener?.('visibilitychange',validateScope);
    if(typeof global.SengokuCloudSync?.subscribe==='function'){
      const unsubscribe=global.SengokuCloudSync.subscribe(validateScope);
      if(session===current)current.unsubscribe=unsubscribe;else unsubscribe?.();
    }
    if(session!==current)return false;
    el.querySelector('[data-records-query]').focus({preventScroll:true});return true;
  }
  const api={open,close,snapshot,battleSnapshot,filterRecords,exportText,LIMIT,BATTLE_LIMIT,PAGE_SIZE};
  global.SengokuCampaignRecords=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
