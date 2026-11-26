/* Operator-only review of existing payment holds. No payment or entitlement is created here. */
(function (global) {
  'use strict';
  const API = '/admin/premium/reviews';
  const SCOPES = Object.freeze({ session: ['cs_', '購入手続き'], payment_intent: ['pi_', '決済'], charge: ['ch_', '売上'], invoice: ['in_', '請求書'], subscription: ['sub_', '定期購入'] });
  const SOFT = Object.freeze({ refund_review: '返金状況の確認', dispute_review: '異議申し立ての確認', fraud_review: '不正利用の確認' });
  const HARD = Object.freeze({ refund: '返金済み', charge_refunded: '売上の返金済み', dispute_lost: '異議申し立てによる失効', conflicting_snapshot: '決済情報の不一致' });
  const clone = value => JSON.parse(JSON.stringify(value));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeInteger = value => Number.isSafeInteger(value) && value >= 1;
  const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_]{1,150}$/.test(value);
  const holdKey = hold => hold.scope + ':' + hold.objectId;
  const reasonLength = value => Array.from(value).length;
  const date = value => { const d = new Date(value); return value && Number.isFinite(d.getTime()) ? d.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '日時不明'; };
  function cleanHold(value) {
    if (!value || !Object.hasOwn(SCOPES, value.scope) || !identifier(value.objectId) || !value.objectId.startsWith(SCOPES[value.scope][0]) || !safeInteger(value.revision) || !identifier(value.eventId) || !value.eventId.startsWith('evt_') || typeof value.reason !== 'string' || !value.reason || value.reason.length > 200 || !Array.isArray(value.players)) return null;
    const players = value.players.map(player => player && typeof player.id === 'string' && /^[A-Za-z0-9_-]{1,150}$/.test(player.id) && typeof player.name === 'string' ? { id: player.id, name: player.name.slice(0, 120), avatarVersion: typeof player.avatarVersion === 'string' && /^[a-f0-9]{64}$/.test(player.avatarVersion) ? player.avatarVersion : null, evaluation: global.SengokuEvaluationUI?.key?.(player.evaluation) ? { version: player.evaluation.version, score: player.evaluation.score, maxScore: player.evaluation.maxScore, rankId: player.evaluation.rankId, rankName: player.evaluation.rankName, rankIndex: player.evaluation.rankIndex } : null, appearance: global.SengokuPremiumRuntime?.cleanAppearance?.(player.appearance) || null } : null);
    if (players.some(player => !player)) return null;
    return { scope: value.scope, objectId: value.objectId, revision: value.revision, eventId: value.eventId, reason: value.reason, createdAt: typeof value.createdAt === 'string' ? value.createdAt : '', updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '', canRelease: value.canRelease === true && Object.hasOwn(SOFT, value.reason), players };
  }
  function createController(options = {}) {
    const request = options.request || ((path, settings) => global.SengokuSocial.premiumReviewRequest(path, settings));
    const getUser = options.getUser || (() => global.SengokuSocial?.getUser?.());
    const getContext = options.getContext || (() => global.SengokuSocial?.getModerationContext?.());
    const uuid = options.uuid || (() => global.crypto.randomUUID());
    const onChange = options.onChange || (() => {});
    let stamp = '', generation = 0, readSequence = 0, disposed = false, writePromise = null;
    const empty = () => ({ ownerId: null, authorized: false, open: false, holds: [], nextCursor: null, serverNow: '', loaded: false, loading: false, loadingMore: false, selected: null, reason: '', confirmation: null, pending: null, sending: false, error: '', status: '', change: 'init' });
    let state = empty();
    const snapshot = () => clone(state);
    const context = () => {
      const user = getUser(), value = getContext();
      return { ownerId: typeof user?.id === 'string' ? user.id : null, allowed: Boolean(user?.id && user.isAdmin === true && user.isBanned !== true && value), stamp: JSON.stringify([user?.id || null, user?.isAdmin === true, user?.isBanned === true, value?.epoch ?? null, value?.privilegeEpoch ?? null]) };
    };
    function emit(change = 'status') { if (!disposed) { state.change = change; onChange(snapshot()); } }
    function reset(change = 'clear') {
      const who = context(); stamp = who.stamp; generation++; readSequence++; writePromise = null;
      state = { ...empty(), ownerId: who.ownerId, authorized: who.allowed }; emit(change); return who;
    }
    function identity() { const who = context(); if (who.stamp !== stamp) return reset('identity'); return who; }
    function current(g, owner) { const who = context(); return !disposed && generation === g && state.ownerId === owner && who.ownerId === owner && who.allowed && who.stamp === stamp; }
    function allowed() { identity(); return !disposed && state.authorized && state.open; }
    async function call(path, settings = { method: 'GET' }) {
      const g = generation, owner = state.ownerId;
      if (!current(g, owner)) throw Object.assign(Error('運営権限を確認してください。'), { code: 'STALE_IDENTITY' });
      const result = await request(path, settings);
      if (!current(g, owner)) { identity(); throw Object.assign(Error('接続する領主または運営権限が変わりました。'), { code: 'STALE_IDENTITY' }); }
      return result;
    }
    async function load({ more = false, preserveStatus = false } = {}) {
      if (!allowed() || state.sending || state.loading || state.loadingMore || more && !state.nextCursor) return false;
      const g = generation, owner = state.ownerId, seq = ++readSequence, cursor = more ? state.nextCursor : null;
      state.loading = !more; state.loadingMore = more; state.error = '';
      if (!preserveStatus) state.status = '';
      if (!more) { state.holds = []; state.nextCursor = null; state.loaded = false; state.selected = null; state.reason = ''; state.confirmation = null; }
      emit('loading');
      try {
        const result = await call(API + '?limit=20' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
        if (!current(g, owner) || seq !== readSequence) return false;
        if (result?.ok !== true || !Array.isArray(result.holds) || result.nextCursor != null && typeof result.nextCursor !== 'string') throw Error('保留一覧の応答を確認できませんでした。更新してもう一度お試しください。');
        const rows = result.holds.map(cleanHold);
        if (rows.some(row => !row)) throw Error('保留情報の形式を確認できませんでした。更新してもう一度お試しください。');
        state.holds = [...new Map((more ? [...state.holds, ...rows] : rows).map(row => [holdKey(row), row])).values()];
        state.nextCursor = result.nextCursor || null; state.serverNow = typeof result.serverNow === 'string' ? result.serverNow : ''; state.loaded = true;
        emit('list'); return true;
      } catch (error) {
        identity(); if (current(g, owner) && seq === readSequence && error.code !== 'STALE_IDENTITY') { state.error = error.message || '保留一覧を取得できませんでした。'; emit('error'); } return false;
      } finally { if (current(g, owner) && seq === readSequence) { state.loading = state.loadingMore = false; emit(); } }
    }
    async function open() {
      identity(); if (disposed || !state.authorized) return false;
      state.open = true; emit('open');
      if (!state.sending) await load(); return true;
    }
    function close() { if (disposed) return; state.open = false; readSequence++; state.loading = state.loadingMore = false; state.selected = null; state.reason = ''; state.confirmation = null; emit('close'); }
    function select(key) {
      if (!allowed() || state.loading || state.loadingMore || state.sending || state.pending) return false;
      const hold = state.holds.find(item => holdKey(item) === key);
      if (!hold?.canRelease) return false;
      state.selected = clone(hold); state.reason = ''; state.confirmation = null; state.error = state.status = ''; emit('select'); return true;
    }
    function setReason(value) { if (allowed() && state.selected && !state.confirmation && !state.sending && !state.pending) { state.reason = String(value ?? ''); state.error = ''; emit('reason'); } }
    function prepare() {
      if (!allowed() || state.loading || state.loadingMore || state.sending || state.pending || !state.selected?.canRelease) return false;
      const hold = state.holds.find(item => holdKey(item) === holdKey(state.selected)), reason = state.reason.normalize('NFC').trim();
      if (!hold?.canRelease || hold.revision !== state.selected.revision || hold.eventId !== state.selected.eventId) { state.selected = null; state.reason = ''; state.error = '保留の状態が変わりました。一覧を更新し、確認をやり直してください。'; emit('error'); return false; }
      if (reasonLength(reason) < 8 || reasonLength(reason) > 500) { state.error = 'Stripeで確認した内容と解除する理由を、8〜500文字で入力してください。'; emit('error'); return false; }
      const requestId = String(uuid());
      if (!/^[A-Za-z0-9_-]{1,90}$/.test(requestId)) { state.error = '確認用の送信番号を作成できませんでした。画面を開き直してください。'; emit('error'); return false; }
      state.confirmation = { ownerId: state.ownerId, hold: clone(hold), body: { scope: hold.scope, objectId: hold.objectId, expectedRevision: hold.revision, expectedEventId: hold.eventId, reason, requestId } };
      state.error = ''; emit('confirm'); return true;
    }
    function back() { if (allowed() && !state.sending && !state.pending) { state.confirmation = null; state.error = ''; emit('back'); } }
    function cancelSelection() { if (allowed() && !state.sending && !state.pending) { state.selected = null; state.reason = ''; state.confirmation = null; state.error = ''; emit('selection-close'); } }
    function matches(record, result) {
      const review = result?.review, body = record.body;
      return result?.ok === true && /^prv_[a-f0-9]{32}$/.test(String(review?.id || '')) && review.scope === body.scope && review.objectId === body.objectId && review.eventId === body.expectedEventId && review.reason === body.reason && safeInteger(review.revision) && review.revision === body.expectedRevision;
    }
    function send(record) {
      if (writePromise) return writePromise;
      if (!allowed() || state.sending || state.loading || state.loadingMore || !record || record.ownerId !== state.ownerId || !record.hold.canRelease) return Promise.resolve(false);
      const g = generation, owner = state.ownerId;
      state.pending = clone(record); state.confirmation = null; state.selected = null; state.reason = ''; state.sending = true; state.error = state.status = ''; emit('sending');
      let reload = false;
      writePromise = Promise.resolve().then(async () => {
        try {
          if (!current(g, owner)) { identity(); return false; }
          const result = await call(API, { method: 'POST', body: clone(record.body) });
          if (!current(g, owner)) return false;
          if (!matches(record, result)) throw Error('解除結果を確認できませんでした。同じ送信番号で結果を確認してください。');
          state.pending = null; state.status = '保留の解除結果を確認しました。確認記録：' + result.review.id + '。最新の保留状況を取得します。'; state.error = ''; reload = true; emit('settled'); return true;
        } catch (error) {
          identity(); if (!current(g, owner) || error.code === 'STALE_IDENTITY') return false;
          const status = Number(error.status || error.statusCode);
          if (status === 409) {
            state.pending = null; state.confirmation = null; state.selected = null; state.reason = ''; state.holds = []; state.nextCursor = null; state.loaded = false;
            state.status = '保留の状態が変わったため、解除していません。最新の一覧を確認し、Stripeでの確認と理由の入力をやり直してください。'; state.error = ''; reload = true;
          } else if (status >= 400 && status < 500 && ![408, 425, 429].includes(status)) {
            state.pending = null; state.error = error.message || '解除を受け付けられませんでした。';
          } else state.error = error.message || '通信結果が未確認です。同じ送信番号で結果を確認してください。';
          emit('error'); return false;
        } finally {
          if (current(g, owner)) { state.sending = false; writePromise = null; emit(); if (reload && state.open) await load({ preserveStatus: true }); }
        }
      });
      return writePromise;
    }
    function confirm() { identity(); return state.confirmation && !state.pending && !state.sending ? send(clone(state.confirmation)) : Promise.resolve(false); }
    function retry() { identity(); return state.pending && !state.sending ? send(clone(state.pending)) : Promise.resolve(false); }
    function clear() { if (!disposed) reset('clear'); }
    function dispose() { if (disposed) return; reset('dispose'); disposed = true; }
    return { getState() { identity(); return snapshot(); }, open, close, clear, dispose, refreshIdentity: identity, refresh: () => load(), loadMore: () => load({ more: true }), select, setReason, prepare, back, cancelSelection, confirm, retry };
  }
  function identifiersMarkup(hold) {
    return '<dl class="premium-admin-identifiers"><div><dt>決済ID</dt><dd><code>' + esc(hold.objectId) + '</code></dd></div><div><dt>イベントID</dt><dd><code>' + esc(hold.eventId) + '</code></dd></div><div><dt>確認対象の版</dt><dd>' + esc(hold.revision) + '</dd></div></dl>';
  }
  function playersMarkup(players) {
    return players.length ? '<ul class="premium-admin-players">' + players.map(player => '<li><strong class="player-evaluation-person">' + (global.SengokuAvatar?.markup?.(player, 'inline') || '') + (global.SengokuCityHonors?.slot?.(player.id)||'') + '<span class="player-evaluation-name" data-premium-player="' + esc(player.id) + '" data-premium-player-name="' + esc(player.name) + '">' + (global.SengokuPremiumRuntime?.nameMarkup?.(player.name, player.appearance) || esc(player.name)) + '</span>' + (global.SengokuEvaluationUI?.badge?.(player.evaluation) || '') + (global.SengokuPublicCourt?.slot?.(player.id) || '') + '</strong><code>' + esc(player.id) + '</code></li>').join('') + '</ul>' : '<p class="premium-admin-note">関連する領主はありません。</p>';
  }
  function holdMarkup(hold, locked = false) {
    return '<article class="premium-admin-hold"><div class="premium-admin-hold-heading"><div><span class="premium-admin-label">' + esc(SCOPES[hold.scope][1]) + '</span><h2>' + esc(SOFT[hold.reason] || HARD[hold.reason] || '決済情報の確認が必要') + '</h2></div><span class="premium-admin-state' + (hold.canRelease ? ' is-reviewable' : '') + '">' + (hold.canRelease ? '運営による確認待ち' : '閲覧のみ') + '</span></div><p class="premium-admin-code"><code>' + esc(hold.reason) + '</code></p>' + identifiersMarkup(hold) + playersMarkup(hold.players) + '<div class="premium-admin-hold-footer"><p class="premium-admin-note">更新：' + esc(date(hold.updatedAt)) + ' JST</p>' + (hold.canRelease ? '<button type="button" class="premium-admin-button" data-premium-admin="select" data-hold-key="' + esc(holdKey(hold)) + '"' + (locked ? ' disabled' : '') + '>内容を確認する</button>' : '<p class="premium-admin-note">この保留はここから解除できません。</p>') + '</div></article>';
  }
  function confirmationMarkup(record, pending = false) {
    return '<span class="premium-admin-label">' + (pending ? '同じ操作の結果確認' : '解除する内容の確認') + '</span><h2 id="premium-admin-confirm-title" tabindex="-1">' + (pending ? '送信した確認内容' : 'この購入保留を解除しますか？') + '</h2>' + identifiersMarkup(record.hold) + playersMarkup(record.hold.players) + '<h3>Stripeで確認した内容・解除の理由</h3><p class="premium-admin-confirm-reason">' + esc(record.body.reason) + '</p><p class="premium-admin-notice">この保留の解除を記録します。新しい購入権利の付与や、返金の実行は行いません。別の保留がある場合は、その確認が必要です。</p>' + (pending ? '<p class="premium-admin-note">送信番号：<code>' + esc(record.body.requestId) + '</code></p>' : '<div class="premium-admin-actions"><button type="button" class="premium-admin-button" data-premium-admin="back">戻って確認する</button><button type="button" class="premium-admin-button is-primary" data-premium-admin="confirm">確認済みの保留を解除</button></div>');
  }
  function createUI(options = {}) {
    const doc = options.document || global.document;
    let dialog = null, controller, returnFocus = null, selectedKey = '', confirmationKey = '', listHTML = '', disposed = false;
    const $ = selector => dialog?.querySelector(selector);
    const setHTML = (node, value) => { if (node && node.innerHTML !== value) node.innerHTML = value; };
    function clearDOM() {
      for (const selector of ['[data-admin-holds]', '[data-admin-editor]', '[data-admin-confirm]', '[data-admin-pending]']) setHTML($(selector), '');
      if ($('[data-admin-feedback]')) $('[data-admin-feedback]').textContent = '';
      selectedKey = confirmationKey = listHTML = '';
    }
    function restoreFocus() { const node = returnFocus; returnFocus = null; if (node?.isConnected) node.focus({ preventScroll: true }); }
    function closeDialog() { if (dialog?.open) dialog.close(); clearDOM(); restoreFocus(); }
    function render(state) {
      if (!dialog) return;
      if (!state.authorized || !state.open || ['clear', 'identity', 'dispose'].includes(state.change)) { closeDialog(); return; }
      if (!dialog.open) { dialog.showModal(); global.SengokuSocialViewport?.refresh?.(); }
      const feedback = $('[data-admin-feedback]'), message = state.error || state.status;
      feedback.hidden = !message; feedback.setAttribute('role', state.error ? 'alert' : 'status'); feedback.setAttribute('data-error', String(Boolean(state.error))); feedback.textContent = message;
      const locked = state.sending || state.loading || state.loadingMore || Boolean(state.pending || state.confirmation || state.selected);
      $('[data-premium-admin="refresh"]').disabled = locked;
      const list = $('[data-admin-holds]'), markup = state.holds.length ? state.holds.map(hold => holdMarkup(hold, locked)).join('') : '<p class="premium-admin-empty">' + (state.loading ? '購入保留を確認しています…' : state.loaded ? '確認待ちの購入保留はありません。' : '一覧を取得して、購入保留を確認してください。') + '</p>';
      if (listHTML !== markup) { listHTML = markup; list.innerHTML = markup; }
      list.hidden = Boolean(state.selected || state.confirmation || state.pending);
      const more = $('[data-premium-admin="more"]'); more.hidden = !state.nextCursor || list.hidden; more.disabled = locked; more.textContent = state.loadingMore ? '読み込み中…' : '続きを表示';
      const editor = $('[data-admin-editor]'); editor.hidden = !state.selected || Boolean(state.confirmation);
      if (state.selected) {
        const key = holdKey(state.selected) + ':' + state.selected.revision + ':' + state.selected.eventId;
        if (selectedKey !== key) {
          selectedKey = key; editor.innerHTML = '<h2 id="premium-admin-editor-title" tabindex="-1">Stripeで確認した内容を記録</h2>' + identifiersMarkup(state.selected) + playersMarkup(state.selected.players) + '<form data-admin-form><label for="premium-admin-reason">確認内容・解除する理由 <span>必須・8〜500文字</span></label><p id="premium-admin-reason-help" class="premium-admin-note">Stripe上で、対象の決済とイベント、返金や異議申し立ての状態を確認してください。確認した事実と、解除してよいと判断した理由を記録します。</p><textarea id="premium-admin-reason" rows="5" maxlength="500" required aria-describedby="premium-admin-reason-help" placeholder="Stripeで確認した決済状況と、保留を解除する理由を入力してください。"></textarea><p class="premium-admin-note" data-admin-count></p><div class="premium-admin-actions"><button type="button" class="premium-admin-button" data-premium-admin="cancel-selection">一覧へ戻る</button><button type="submit" class="premium-admin-button is-primary" data-premium-admin="prepare">解除内容を確認する</button></div></form>';
        }
        const input = $('#premium-admin-reason'); if (input.value !== state.reason) input.value = state.reason; input.disabled = state.sending;
        $('[data-admin-count]').textContent = reasonLength(state.reason.trim()) + ' / 500文字';
        $('[data-premium-admin="prepare"]').disabled = state.sending;
        if (state.change === 'select' || state.change === 'back') input.focus();
      } else { selectedKey = ''; setHTML(editor, ''); }
      const confirm = $('[data-admin-confirm]'); confirm.hidden = !state.confirmation;
      if (state.confirmation) {
        const key = JSON.stringify(state.confirmation);
        if (confirmationKey !== key) { confirmationKey = key; confirm.innerHTML = confirmationMarkup(state.confirmation); $('#premium-admin-confirm-title')?.focus(); }
      } else { confirmationKey = ''; setHTML(confirm, ''); }
      const pending = $('[data-admin-pending]'); pending.hidden = !state.pending;
      if (state.pending) setHTML(pending, '<div class="premium-admin-pending-heading"><strong>' + (state.sending ? '解除結果を確認しています…' : '通信結果が未確認です') + '</strong><p>結果が分かるまで、同じ送信番号で確認します。ほかの保留は解除できません。</p></div>' + confirmationMarkup(state.pending, true) + '<div class="premium-admin-actions"><button type="button" class="premium-admin-button is-primary" data-premium-admin="retry"' + (state.sending ? ' disabled' : '') + '>結果を確認・再試行</button></div>'); else setHTML(pending, '');
      if (['settled', 'selection-close'].includes(state.change)) $('#premium-admin-title')?.focus();
    }
    function ensureDialog() {
      if (dialog || !doc?.body) return;
      dialog = doc.createElement('dialog'); dialog.id = 'premium-admin-modal'; dialog.className = 'premium-admin-dialog'; dialog.setAttribute('aria-labelledby', 'premium-admin-title');
      dialog.innerHTML = '<header class="premium-admin-header"><div><span class="premium-admin-label">運営専用</span><h1 id="premium-admin-title" tabindex="-1">購入保留の確認</h1></div><button type="button" class="premium-admin-button" data-premium-admin="close">閉じる</button></header><div class="premium-admin-main"><div class="premium-admin-intro"><p>Stripeで確認が必要な購入保留です。決済IDとイベントIDを照合し、確認した内容を残してから解除します。</p><button type="button" class="premium-admin-button" data-premium-admin="refresh">一覧を更新</button></div><p class="premium-admin-feedback" data-admin-feedback role="status" aria-live="polite" hidden></p><section class="premium-admin-pending" data-admin-pending hidden></section><div data-admin-holds></div><section class="premium-admin-editor" data-admin-editor hidden></section><section class="premium-admin-confirm" data-admin-confirm hidden></section><div class="premium-admin-more"><button type="button" class="premium-admin-button" data-premium-admin="more" hidden>続きを表示</button></div></div><footer class="premium-admin-footer">運営本人だけが利用できます · 日時は日本標準時（JST）</footer>';
      doc.body.append(dialog);
      dialog.addEventListener('click', event => {
        const button = event.target.closest?.('[data-premium-admin]'); if (!button || button.disabled) return;
        const action = button.getAttribute('data-premium-admin');
        if (action === 'close') controller.close();
        else if (action === 'refresh') controller.refresh();
        else if (action === 'more') controller.loadMore();
        else if (action === 'select') controller.select(button.getAttribute('data-hold-key'));
        else if (action === 'cancel-selection') controller.cancelSelection();
        else if (action === 'back') controller.back();
        else if (action === 'confirm') controller.confirm();
        else if (action === 'retry') controller.retry();
      });
      dialog.addEventListener('input', event => { if (event.target.id === 'premium-admin-reason') controller.setReason(event.target.value); });
      dialog.addEventListener('submit', event => { if (event.target.hasAttribute('data-admin-form')) { event.preventDefault(); controller.prepare(); } });
      dialog.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); controller.close(); } });
      dialog.addEventListener('cancel', event => { event.preventDefault(); event.stopPropagation(); controller.close(); });
      dialog.addEventListener('close', () => { if (!dialog.open) { if (controller.getState().open) controller.close(); else { clearDOM(); restoreFocus(); } } });
    }
    controller = createController({ ...options, onChange: state => { render(state); options.onChange?.(state); } });
    return {
      async open() { if (disposed || !controller.getState().authorized) return false; ensureDialog(); if (!dialog) return false; if (!dialog.open) returnFocus = doc.activeElement; const result = controller.open(); $('#premium-admin-title')?.focus(); return result; },
      close: () => controller.close(), clear: () => controller.clear(), refreshIdentity: () => controller.refreshIdentity(), isOpen: () => Boolean(dialog?.open),
      dispose() { if (disposed) return; controller.dispose(); dialog?.remove(); dialog = null; disposed = true; },
      getState: () => controller.getState()
    };
  }
  let instance = null;
  global.SengokuPremiumAdmin = {
    open() { if (!instance) instance = createUI(); return instance.open(); },
    close() { instance?.close(); }, clear() { instance?.clear(); }, refreshIdentity() { instance?.refreshIdentity(); },
    dispose() { instance?.dispose(); instance = null; }, isOpen: () => instance?.isOpen() || false
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = { createController, createUI, cleanHold, holdMarkup, confirmationMarkup };
})(typeof window !== 'undefined' ? window : globalThis);
