/* A searchable snapshot of the campaign's retained log. Reading and exporting
   never issue a game command, replace a save, or start a network request. */
(function (global) {
  'use strict';
  const LIMIT=160,PAGE_SIZE=20;
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
  function filterRecords(rows,options={}) {
    const group=Object.hasOwn(GROUPS,options.group)?options.group:'all';
    const words=normalize(queryValue(options.query)).trim().split(/\s+/).filter(Boolean);
    const result=rows.filter(row=>(group==='all'||row.group===group)&&words.every(word=>row.search.includes(word)));
    // Array position is authoritative. In-game month/turn wraps each cycle.
    return options.order==='oldest'?result.slice().reverse():result;
  }
  function exportText(rows,options={}) {
    const query=queryValue(options.query).replace(/[\r\n\t]+/g,' ').trim();
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
    if(dialog){dialog.querySelector('[data-records-list]').replaceChildren();dialog.querySelector('[data-records-query]').value='';}
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
    dialog.innerHTML='<header class="campaign-records-header"><div><p>CAMPAIGN JOURNAL</p><h2 id="campaign-records-title">領国の戦記</h2></div><button type="button" data-records-close>閉じる</button></header><div class="campaign-records-tools"><label class="campaign-records-search"><span>戦記を検索</span><input type="search" data-records-query maxlength="80" autocomplete="off" placeholder="城・武将・出来事の名前"></label><div class="campaign-records-selects"><label><span>出来事の種類</span><select data-records-group>'+Object.entries(GROUPS).map(([key,label])=>'<option value="'+key+'">'+label+'</option>').join('')+'</select></label><label><span>記録の順序</span><select data-records-order><option value="newest">新しい順</option><option value="oldest">古い順</option></select></label></div><div class="campaign-records-status"><p role="status" aria-live="polite" data-records-count></p><button type="button" data-records-reset>条件をリセット</button></div></div><div class="campaign-records-scroll" data-records-scroll tabindex="0" aria-label="戦記の検索結果"><ol class="campaign-records-list" data-records-list></ol><div class="campaign-records-empty" data-records-empty hidden><strong>該当する戦記はありません</strong><p>検索する言葉や出来事の種類を変えてください。</p></div></div><nav class="campaign-records-pagination" aria-label="戦記のページ"><button type="button" data-records-page="-1">前の20件</button><span data-records-page-label></span><button type="button" data-records-page="1">次の20件</button></nav><footer class="campaign-records-footer"><p id="campaign-records-note">保存されている最新160件までを表示します。月日は周回するため、記録された順に並べます。表示中は自動更新しません。</p><div><button type="button" data-records-refresh>最新の戦記を取得</button><button type="button" data-records-export>検索結果をテキスト保存</button></div><p class="campaign-records-feedback" data-records-feedback role="status" aria-live="polite"></p></footer>';
    // Leave native Escape/cancel behavior intact while keeping the app's
    // document-level Escape handler from clearing an underlying modal.
    dialog.addEventListener('keydown',event=>{if(event.key==='Escape')event.stopPropagation();});
    dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
    dialog.addEventListener('close',()=>{if(!dialog.open)finish();});
    dialog.addEventListener('click',event=>{
      if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(Number.isFinite(event.clientX)&&Number.isFinite(event.clientY)&&(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom))close();return;}
      const button=event.target.closest?.('[data-records-close],[data-records-reset],[data-records-page],[data-records-refresh],[data-records-export]');
      if(!button)return;if(button.hasAttribute('data-records-close'))return close();
      if(!validateScope())return;
      if(button.hasAttribute('data-records-reset')){session.query='';session.group='all';session.page=1;dialog.querySelector('[data-records-query]').value='';dialog.querySelector('[data-records-group]').value='all';render();dialog.querySelector('[data-records-query]').focus({preventScroll:true});}
      else if(button.hasAttribute('data-records-page')){session.page+=Number(button.dataset.recordsPage)||0;render();dialog.querySelector('[data-records-scroll]').focus({preventScroll:true});}
      else if(button.hasAttribute('data-records-refresh'))refresh();
      else download();
    });
    const input=event=>{if(!event.target.matches?.('[data-records-query]')||event.isComposing||!validateScope())return;session.query=queryValue(event.target.value);session.page=1;render();};
    dialog.addEventListener('input',input);dialog.addEventListener('compositionend',input);
    dialog.addEventListener('change',event=>{
      if(!validateScope())return;
      if(event.target.matches?.('[data-records-group]'))session.group=Object.hasOwn(GROUPS,event.target.value)?event.target.value:'all';
      else if(event.target.matches?.('[data-records-order]'))session.order=event.target.value==='oldest'?'oldest':'newest';else return;
      session.page=1;render();
    });
    doc.body.appendChild(dialog);return dialog;
  }
  function render(options={}) {
    if(!dialog?.open||!validateScope())return;
    const rows=filterRecords(session.rows,session),pages=Math.max(1,Math.ceil(rows.length/PAGE_SIZE));
    session.page=Math.max(1,Math.min(session.page,pages));
    const visible=rows.slice((session.page-1)*PAGE_SIZE,session.page*PAGE_SIZE),scroll=dialog.querySelector('[data-records-scroll]');
    session.visible=visible;session.filtered=rows;
    dialog.querySelector('[data-records-list]').innerHTML=visible.map(row=>'<li class="campaign-record" data-records-index="'+row.index+'" data-records-kind="'+row.group+'"><div><time>'+esc(row.date)+'</time><span>'+esc(GROUPS[row.group])+'</span></div><p>'+esc(row.text)+'</p></li>').join('');
    dialog.querySelector('[data-records-count]').textContent='検索結果 '+rows.length+'件 / 対象 '+session.rows.length+'件 · 最新'+LIMIT+'件まで';
    dialog.querySelector('[data-records-page-label]').textContent=session.page+' / '+pages+'頁';
    dialog.querySelector('[data-records-page="-1"]').disabled=session.page<=1;
    dialog.querySelector('[data-records-page="1"]').disabled=session.page>=pages;
    dialog.querySelector('[data-records-export]').disabled=rows.length===0;
    dialog.querySelector('[data-records-reset]').disabled=!session.query&&session.group==='all';
    dialog.querySelector('[data-records-empty]').hidden=rows.length>0;
    scroll.scrollTop=options.scrollTop??0;
  }
  function refresh() {
    if(!validateScope())return;
    const scroll=dialog.querySelector('[data-records-scroll]'),top=scroll.scrollTop;
    const scrollTop=scroll.getBoundingClientRect().top;
    const anchorNode=Array.from(dialog.querySelectorAll('[data-records-index]')).find(node=>node.getBoundingClientRect().bottom>scrollTop);
    const anchorRow=session.visible?.find(row=>row.index===Number(anchorNode?.dataset.recordsIndex))||session.visible?.[0];
    const first=anchorRow?.key,offset=(session.page-1)*PAGE_SIZE,anchorOffset=anchorNode?anchorNode.getBoundingClientRect().top-scrollTop:0;
    session.rows=snapshot(session.game,session.options);
    const rows=filterRecords(session.rows,session),anchor=first?rows.findIndex(row=>row.key===first):-1;
    session.page=Math.floor((anchor>=0?anchor:Math.min(offset,Math.max(0,rows.length-1)))/PAGE_SIZE)+1;
    render({scrollTop:top});
    if(anchor>=0){const next=dialog.querySelector('[data-records-index="'+rows[anchor].index+'"]');if(next)scroll.scrollTop+=next.getBoundingClientRect().top-scroll.getBoundingClientRect().top-anchorOffset;}
    dialog.querySelector('[data-records-feedback]').textContent='現在の戦記に更新しました。検索条件と並び順を保持しています。';
  }
  function download() {
    if(!validateScope())return false;
    const feedback=dialog.querySelector('[data-records-feedback]');
    let url='',link=null;
    try {
      if(!global.URL?.createObjectURL||!global.Blob)throw Error('download unavailable');
      const text=exportText(session.filtered,session);url=global.URL.createObjectURL(new global.Blob(['\uFEFF'+text],{type:'text/plain;charset=utf-8'}));
      link=global.document.createElement('a');link.href=url;link.download='sengoku-war-records.txt';
      global.document.body.appendChild(link);link.click();
      feedback.textContent=session.filtered.length+'件の戦記をテキストで書き出しました。復元用セーブではありません。';return true;
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
    const current={options,game,identity:identity(game),returnFocus:global.document.activeElement,rows:snapshot(game,options),query:'',group:'all',order:'newest',page:1,unsubscribe:null};
    session=current;el.querySelector('[data-records-query]').value='';el.querySelector('[data-records-group]').value='all';el.querySelector('[data-records-order]').value='newest';el.querySelector('[data-records-feedback]').textContent='';
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
  const api={open,close,snapshot,filterRecords,exportText,LIMIT,PAGE_SIZE};
  global.SengokuCampaignRecords=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
