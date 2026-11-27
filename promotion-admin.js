/* Primary-operator report of anonymous event counts and separate account totals.
   Read only. Closing the dialog or changing identity discards private results. */
(function (global) {
  'use strict';
  const SOURCES = Object.freeze({direct:'直接・出所未指定',x:'X',line:'LINE',youtube:'YouTube',press:'紹介媒体',friend:'友人への紹介',discord:'Discord',copy_link:'URLのコピー',share_text:'紹介文のコピー',native_share:'端末の共有',english:'英語案内',other:'その他'});
  const clone = value => JSON.parse(JSON.stringify(value));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const count = value => Number.isSafeInteger(value) && value >= 0;
  const dateOK = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value + 'T00:00:00Z').toISOString().slice(0,10) === value;
  const number = value => value.toLocaleString('ja-JP');

  function cleanReport(value, days = 14) {
    try {
      if (value?.ok !== true || value.timezone !== 'Asia/Tokyo' || value.range?.days !== days || ![7,14,30].includes(days) || !dateOK(value.range.from) || !dateOK(value.range.to)) return null;
      const from = Date.parse(value.range.from + 'T00:00:00Z'), to = Date.parse(value.range.to + 'T00:00:00Z');
      if ((to-from)/86400000 !== days-1 || !Array.isArray(value.events) || value.events.length > days * Object.keys(SOURCES).length * 2) return null;
      if (!count(value.totals?.landing) || !count(value.totals?.play_click) || !count(value.accounts?.total) || !count(value.accounts?.createdInRange) || value.accounts.createdInRange > value.accounts.total) return null;
      const seen = new Set(), totals = {landing:0,play_click:0};
      const sources = Object.keys(SOURCES).map(source => ({source,landing:0,play_click:0}));
      const daily = Array.from({length:days},(_,i)=>({day:new Date(from+i*86400000).toISOString().slice(0,10),landing:0,play_click:0}));
      for (const row of value.events) {
        if (!dateOK(row?.day) || row.day < value.range.from || row.day > value.range.to || !Object.hasOwn(SOURCES,row.source) || !['landing','play_click'].includes(row.event) || !count(row.count)) return null;
        const key = row.day + ':' + row.source + ':' + row.event;
        if (seen.has(key)) return null;
        seen.add(key); totals[row.event] += row.count;
        if (!count(totals[row.event])) return null;
        sources.find(source=>source.source===row.source)[row.event] += row.count;
        daily.find(day=>day.day===row.day)[row.event] += row.count;
      }
      if (totals.landing !== value.totals.landing || totals.play_click !== value.totals.play_click) return null;
      return {range:{from:value.range.from,to:value.range.to,days},totals,accounts:{total:value.accounts.total,createdInRange:value.accounts.createdInRange},sources,daily,
        serverNow:typeof value.serverNow==='string'&&Number.isFinite(Date.parse(value.serverNow))?value.serverNow:''};
    } catch { return null; }
  }

  function createController(options = {}) {
    const request = options.request || ((route, settings) => global.SengokuSocial.promotionRequest(route, settings));
    const getContext = options.getContext || (() => global.SengokuSocial?.getPromotionContext?.());
    const onChange = options.onChange || (() => {});
    const empty = () => ({open:false,authorized:false,loading:false,report:null,error:'',days:14});
    let state = empty(), stamp = '', sequence = 0, disposed = false;
    const snapshot = () => clone(state);
    const context = () => {
      const c = getContext();
      return {allowed:Boolean(c?.user?.id && c.playerId===c.user.id && (c.canOperate??c.isAdmin)===true && (c.user.isAdmin===true||c.user.isDeputy===true) && c.user.canOperate!==false && c.user.isBanned!==true && !c.pending && !c.banned),
        stamp:JSON.stringify([c?.playerId,c?.user?.id,c?.isAdmin,c?.canOperate,c?.user?.isAdmin,c?.user?.isDeputy,c?.user?.canOperate,c?.user?.isBanned,c?.pending,c?.banned,c?.epoch,c?.privilegeEpoch,c?.accountEpoch])};
    };
    function emit() { if (!disposed) onChange(snapshot()); }
    function clear() { const who=context();stamp=who.stamp;sequence++;state={...empty(),authorized:who.allowed};emit(); }
    function identity() { const who=context();if(who.stamp!==stamp)clear();return who; }
    function current(seq, ownerStamp) { const who=identity();return !disposed&&seq===sequence&&state.open&&who.allowed&&who.stamp===ownerStamp; }
    async function refresh() {
      identity();if(disposed||!state.open||!state.authorized||state.loading)return false;
      const seq=++sequence,ownerStamp=stamp;state.loading=true;state.report=null;state.error='';emit();
      try {
        const result=await request('/admin/promotion?days='+state.days,{method:'GET'});
        if(!current(seq,ownerStamp))return false;
        const report=cleanReport(result,state.days);if(!report)throw Error('集計の応答を確認できませんでした。もう一度更新してください。');
        state.report=report;return true;
      } catch(error) {
        if(current(seq,ownerStamp)&&error?.code!=='STALE_IDENTITY')state.error=error?.message||'集計を取得できませんでした。時間をおいて更新してください。';
        return false;
      } finally { if(current(seq,ownerStamp)){state.loading=false;emit();} }
    }
    async function open() { identity();if(disposed||!state.authorized)return false;state.open=true;emit();return refresh(); }
    function close() { if(!disposed)clear(); }
    function dispose() { if(!disposed){clear();disposed=true;} }
    return {open,close,clear,refresh,dispose,refreshIdentity:identity,getState(){identity();return snapshot();}};
  }

  function reportMarkup(report) {
    const sources=report.sources.filter(row=>row.landing||row.play_click).sort((a,b)=>b.landing-a.landing||b.play_click-a.play_click);
    return '<p class="promotion-admin-range">'+esc(report.range.from)+' ～ '+esc(report.range.to)+' · 日本時間（JST）</p>'+ 
      '<dl class="promotion-admin-totals"><div><dt>紹介ページの閲覧</dt><dd>'+number(report.totals.landing)+'<small>回</small></dd></div><div><dt>ゲーム開始リンクの利用</dt><dd>'+number(report.totals.play_click)+'<small>回</small></dd></div></dl>'+
      '<p class="promotion-admin-note">受け付けた操作の回数です。実人数・ユニーク利用者数・プレイ完了数ではありません。同じタブでは、紹介ページごとに各操作を1回まで集計します。</p>'+
      '<div class="promotion-admin-tables"><section><h2>紹介元別</h2><div class="promotion-admin-table-wrap" tabindex="0" aria-label="紹介元別の集計表"><table><thead><tr><th scope="col">紹介元</th><th scope="col">閲覧</th><th scope="col">開始リンク</th></tr></thead><tbody>'+
      (sources.length?sources.map(row=>'<tr><th scope="row">'+esc(SOURCES[row.source])+'</th><td>'+number(row.landing)+'</td><td>'+number(row.play_click)+'</td></tr>').join(''):'<tr><td colspan="3">この期間の記録はまだありません。</td></tr>')+
      '</tbody></table></div></section><section><h2>日別</h2><div class="promotion-admin-table-wrap" tabindex="0" aria-label="日別の集計表"><table><thead><tr><th scope="col">日付</th><th scope="col">閲覧</th><th scope="col">開始リンク</th></tr></thead><tbody>'+
      report.daily.map(row=>'<tr><th scope="row">'+esc(row.day.slice(5).replace('-','/'))+'</th><td>'+number(row.landing)+'</td><td>'+number(row.play_click)+'</td></tr>').join('')+
      '</tbody></table></div></section></div><section class="promotion-admin-accounts"><h2>領主の登録状況</h2><dl class="promotion-admin-totals"><div><dt>この期間の新規登録</dt><dd>'+number(report.accounts.createdInRange)+'<small>アカウント</small></dd></div><div><dt>現在の登録総数</dt><dd>'+number(report.accounts.total)+'<small>アカウント</small></dd></div></dl><p class="promotion-admin-note">宣伝の操作回数とは別の集計です。宣伝経由で登録した人数を示すものではありません。登録総数には運営・スタッフ・利用停止中のアカウントを含み、端末だけで遊ぶ人は含みません。</p></section>'+
      '<p class="promotion-admin-note">計測を有効にする前の閲覧は含まれません。ブラウザの追跡拒否設定や通信制限などにより、計測されない操作があります。</p>';
  }

  function createUI(options = {}) {
    const doc=options.document||global.document;
    let dialog=null,controller,returnFocus=null,disposed=false;
    const query=selector=>dialog?.querySelector(selector);
    function clearDOM(){const host=query('[data-promotion-report]');if(host)host.textContent='';const feedback=query('[data-promotion-feedback]');if(feedback)feedback.textContent='';}
    function restoreFocus(){const target=returnFocus;returnFocus=null;if(target?.isConnected)target.focus({preventScroll:true});}
    function render(state){
      if(!dialog)return;
      if(!state.open||!state.authorized){if(dialog.open)dialog.close();clearDOM();restoreFocus();return;}
      if(!dialog.open){dialog.showModal();global.SengokuSocialViewport?.refresh?.();}
      query('[data-promotion-admin="refresh"]').disabled=state.loading;
      const feedback=query('[data-promotion-feedback]');feedback.hidden=!state.error&&!state.loading;feedback.textContent=state.error||(state.loading?'直近14日間の集計を読み込んでいます…':'');feedback.setAttribute('role',state.error?'alert':'status');feedback.setAttribute('data-error',String(Boolean(state.error)));
      const host=query('[data-promotion-report]');host.innerHTML=state.report?reportMarkup(state.report):'';
    }
    function ensureDialog(){
      if(dialog||!doc?.body)return;
      dialog=doc.createElement('dialog');dialog.id='promotion-admin-modal';dialog.className='premium-admin-dialog promotion-admin-dialog';dialog.setAttribute('aria-labelledby','promotion-admin-title');
      dialog.innerHTML='<header class="premium-admin-header"><div><span class="premium-admin-label">運営専用 · 直近14日間</span><h1 id="promotion-admin-title" tabindex="-1">宣伝の反応</h1></div><button type="button" class="premium-admin-button" data-promotion-admin="close">閉じる</button></header><div class="premium-admin-main"><div class="premium-admin-intro"><p>紹介ページの閲覧と開始リンクの利用を、個人を識別せず日別に集計します。</p><button type="button" class="premium-admin-button" data-promotion-admin="refresh">集計を更新</button></div><p class="premium-admin-feedback" data-promotion-feedback role="status" aria-live="polite" hidden></p><div data-promotion-report></div></div><footer class="premium-admin-footer">運営本人だけが利用できます · 表示は操作回数と登録アカウント数です</footer>';
      doc.body.append(dialog);
      dialog.addEventListener('click',event=>{if(event.target===dialog){controller.close();return;}const button=event.target.closest?.('[data-promotion-admin]');if(!button||button.disabled)return;const action=button.getAttribute('data-promotion-admin');if(action==='close')controller.close();else if(action==='refresh')controller.refresh();});
      dialog.addEventListener('cancel',event=>{event.preventDefault();event.stopPropagation();controller.close();});
      dialog.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();controller.close();}});
      dialog.addEventListener('close',()=>{if(!dialog.open){if(controller.getState().open)controller.close();else{clearDOM();restoreFocus();}}});
    }
    controller=createController({...options,onChange:state=>{render(state);options.onChange?.(state);}});
    return {async open(){if(disposed||!controller.getState().authorized)return false;ensureDialog();if(!dialog)return false;returnFocus=doc.activeElement;const task=controller.open();query('#promotion-admin-title')?.focus();return task;},close:()=>controller.close(),clear:()=>controller.clear(),refreshIdentity:()=>controller.refreshIdentity(),isOpen:()=>Boolean(dialog?.open),getState:()=>controller.getState(),dispose(){if(!disposed){controller.dispose();dialog?.remove();dialog=null;disposed=true;}}};
  }
  let instance=null;
  global.SengokuPromotionAdmin={open(){if(!instance)instance=createUI();return instance.open();},close(){instance?.close();},clear(){instance?.clear();},refreshIdentity(){instance?.refreshIdentity();},dispose(){instance?.dispose();instance=null;},isOpen:()=>instance?.isOpen()||false};
  if(typeof module!=='undefined'&&module.exports)module.exports={createController,createUI,cleanReport,reportMarkup};
})(typeof window!=='undefined'?window:globalThis);
