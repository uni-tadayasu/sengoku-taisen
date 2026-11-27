/* Operator controls for the shared soundtrack. Playback stays in SengokuMusic. */
(function (global) {
  'use strict';
  const API = '/admin/music';
  const MODES = ['loop', 'continuous'];
  const clone = value => JSON.parse(JSON.stringify(value));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const instant = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value.replace(/Z$/, value.includes('.') ? 'Z' : '.000Z');
  const emptyBroadcast = () => ({ enabled: false, mode: 'loop', revision: 0, startedAt: null, updatedAt: null });
  function clean(value) {
    if (!value || typeof value.enabled !== 'boolean' || !MODES.includes(value.mode) || !Number.isSafeInteger(value.revision) || value.revision < 0 || value.startedAt !== null && !instant(value.startedAt) || value.updatedAt !== null && !instant(value.updatedAt)) return null;
    if (value.enabled && !value.startedAt || !value.enabled && value.startedAt !== null || value.revision > 0 && !value.updatedAt || value.startedAt && (!value.updatedAt || Date.parse(value.startedAt) > Date.parse(value.updatedAt))) return null;
    return { enabled: value.enabled, mode: value.mode, revision: value.revision, startedAt: value.startedAt, updatedAt: value.updatedAt };
  }
  const displayDate = value => instant(value) ? new Date(value).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'まだ変更されていません';
  function markup(view = {}) {
    if (!view.authorized) return '<section class="music-broadcast-panel"><h3>全員共通のBGM</h3><p>この設定は運営だけが変更できます。</p></section>';
    const music = clean(view.musicBroadcast) || emptyBroadcast();
    const locked = !view.loaded || view.loading || view.sending || Boolean(view.pending) || view.denied;
    const disabled = locked ? ' disabled' : '';
    const status = view.sending ? '切り替えています…' : view.loading ? '現在の設定を確認しています…' : view.pending ? '切り替え結果の確認が必要です' : !view.loaded ? '設定を確認してください' : music.enabled ? '全プレイヤーへ配信中' : '通常のBGMを再生中';
    return `<section class="music-broadcast-panel" aria-labelledby="music-broadcast-heading" aria-busy="${Boolean(view.loading || view.sending)}">
      <header class="music-broadcast-heading"><div><span class="music-broadcast-eyebrow">運営の音楽放送</span><h3 id="music-broadcast-heading">全員共通のBGM</h3></div><span class="music-broadcast-status ${music.enabled && view.loaded ? 'is-on' : ''}">${esc(status)}</span></header>
      <div class="music-broadcast-track"><span class="music-broadcast-seal" aria-hidden="true">音</span><div><strong>運営放送 00004</strong><p>添付されたBGMから放送を始めます。</p></div></div>
      <div class="music-broadcast-enable"><div><strong>全プレイヤーに流す</strong><p>OFFにすると、それぞれの通常BGMへ戻ります。</p></div><button type="button" class="music-broadcast-switch" role="switch" aria-label="全プレイヤーへのBGM配信" aria-checked="${music.enabled}" data-bgm-command="toggle"${disabled}><span class="music-broadcast-switch-rail" aria-hidden="true"><span></span></span><b>${music.enabled ? 'ON' : 'OFF'}</b></button></div>
      <fieldset class="music-broadcast-modes"${disabled}><legend>再生方式</legend><div class="music-broadcast-mode-options">
        <button type="button" class="social-button music-broadcast-mode" data-bgm-command="mode" data-bgm-mode="loop" aria-pressed="${music.mode === 'loop'}"${disabled}><strong>ループ再生</strong><span>00004だけを繰り返す</span></button>
        <button type="button" class="social-button music-broadcast-mode" data-bgm-command="mode" data-bgm-mode="continuous" aria-pressed="${music.mode === 'continuous'}"${disabled}><strong>連続再生</strong><span>00004から全曲を順番に</span></button>
      </div></fieldset>
      <p class="music-broadcast-order">連続再生は、00004・支度・朝活・昼活・夜活・既存の16曲の順に流れ、最後の曲が終わると00004へ戻ります。</p>
      <p class="music-broadcast-note">再生中に方式を変えると、00004の先頭から切り替わります。接続中のプレイヤーへ順次反映し、途中から参加したプレイヤーも同じ曲の位置から再生します。各自のミュート・音量設定は保たれます。</p>
      <div class="music-broadcast-feedback${view.error ? ' is-error' : ''}" role="status" aria-live="polite">${esc(view.error || view.status || '')}</div>
      <footer class="music-broadcast-footer"><span>最終変更：${esc(displayDate(music.updatedAt))}（日本時間）</span><div>${view.pending ? `<button type="button" class="social-button primary" data-bgm-command="retry"${view.sending || view.loading ? ' disabled' : ''}>切り替え結果を確認</button>` : `<button type="button" class="social-button subtle" data-bgm-command="refresh"${view.sending || view.loading ? ' disabled' : ''}>設定を更新</button>`}</div></footer>
    </section>`;
  }
  function create(options = {}) {
    const getContext = options.getContext || (() => null);
    const request = options.request || (() => Promise.reject(Error('音楽放送に接続できませんでした。')));
    const uuid = options.uuid || (() => global.crypto.randomUUID());
    const onUpdate = options.onUpdate || (() => {});
    let root = null, lastHTML = '', stamp = '', generation = 0, readSequence = 0, disposed = false;
    const empty = () => ({ authorized: false, musicBroadcast: emptyBroadcast(), serverNow: '', loaded: false, loading: false, sending: false, denied: false, pending: null, error: '', status: '' });
    let state = empty();
    function context() {
      let value; try { value = getContext(); } catch (_) { value = null; }
      const user = value?.user, identity = value?.identity;
      const allowed = Boolean(user?.id && identity?.id && String(user.id) === String(identity.id) && user.isAdmin === true && user.isBanned !== true && !value?.pending && !value?.banned);
      return { allowed, stamp: JSON.stringify([user?.id ?? null, user?.isAdmin === true, user?.isBanned === true, identity?.id ?? null, identity?.token ?? null, value?.epoch ?? null, value?.privilegeEpoch ?? null, value?.accountEpoch ?? null, Boolean(value?.pending), Boolean(value?.banned)]) };
    }
    function render() {
      if (!root || disposed) return;
      const html = markup(state); if (html === lastHTML) return;
      const active = root.ownerDocument?.activeElement;
      const focus = root.contains?.(active) && active?.getAttribute?.('data-bgm-command');
      const mode = focus ? active.getAttribute('data-bgm-mode') : null;
      root.innerHTML = html; lastHTML = html;
      if (focus) root.querySelector?.(`[data-bgm-command="${focus}"]${mode ? `[data-bgm-mode="${mode}"]` : ''}`)?.focus?.({ preventScroll: true });
    }
    function identity() {
      const who = context();
      if (who.stamp !== stamp) { stamp = who.stamp; generation++; readSequence++; state = { ...empty(), authorized: who.allowed }; render(); }
      return who;
    }
    function current(g, who) { const now = context(); return !disposed && generation === g && who === stamp && now.stamp === stamp && now.allowed; }
    function getState() { if (!disposed) identity(); return clone(state); }
    function receive(value, serverNow) {
      if (disposed) return false;
      identity(); const next = clean(value);
      if (!next || !instant(serverNow) || next.revision < state.musicBroadcast.revision) return false;
      if ((state.loaded || state.musicBroadcast.revision > 0) && next.revision === state.musicBroadcast.revision && JSON.stringify(next) !== JSON.stringify(state.musicBroadcast)) return false;
      const changed = !state.loaded || JSON.stringify(next) !== JSON.stringify(state.musicBroadcast);
      state.musicBroadcast = next; state.serverNow = serverNow; if (!state.denied) state.loaded = true;
      if (changed) render(); return true;
    }
    function accept(result) {
      if (result?.ok !== true || !clean(result.musicBroadcast) || !instant(result.serverNow)) throw Error('放送設定を確認できませんでした。もう一度確認してください。');
      receive(result.musicBroadcast, result.serverNow);
      try { onUpdate(clone(state.musicBroadcast), state.serverNow); } catch (_) { /* The server result remains confirmed if a local view is unavailable. */ }
    }
    async function refresh({ preserveStatus = false } = {}) {
      const who = identity(); if (disposed || !who.allowed || state.loading || state.sending || state.pending) return false;
      const g = generation, key = stamp, seq = ++readSequence;
      state.loading = true; state.error = ''; if (!preserveStatus) state.status = ''; render();
      try {
        const result = await request(API, { method: 'GET' });
        if (!current(g, key) || seq !== readSequence) { identity(); return false; }
        state.denied = false; accept(result); state.loaded = true; return true;
      } catch (error) {
        if (current(g, key) && seq === readSequence) { state.loaded = false; state.denied = error?.status === 401 || error?.status === 403; state.error = state.denied ? '運営権限を確認できません。領主の接続を確認してください。' : '設定を取得できませんでした。「設定を更新」でお試しください。'; }
        else identity(); return false;
      } finally { if (current(g, key) && seq === readSequence) { state.loading = false; render(); } }
    }
    async function sendPending() {
      const who = identity(); if (disposed || !who.allowed || !state.pending || state.sending || state.loading || state.denied) return false;
      const g = generation, key = stamp, body = clone(state.pending);
      state.sending = true; state.error = ''; state.status = ''; readSequence++; render();
      try {
        const result = await request(API, { method: 'POST', body });
        if (!current(g, key)) { identity(); return false; }
        accept(result); state.pending = null;
        state.status = state.musicBroadcast.enabled ? '全プレイヤーへBGMを配信する設定を保存しました。' : '全員共通のBGMをOFFにしました。通常のBGMへ戻ります。';
        return true;
      } catch (error) {
        if (!current(g, key)) { identity(); return false; }
        if (error?.status === 409) {
          state.pending = null; state.sending = false; state.loaded = false;
          state.status = '別の端末で設定が変更されました。最新の状態を確認して、もう一度選んでください。';
          await refresh({ preserveStatus: true }); return false;
        }
        if (error?.status >= 400 && error.status < 500 && ![408, 429].includes(error.status)) {
          state.pending = null; state.loaded = false; state.denied = error.status === 401 || error.status === 403;
          state.error = state.denied ? '運営権限を確認できません。領主の接続を確認してください。' : '切り替えを完了できませんでした。設定を更新してお試しください。';
        } else state.error = '通信が途切れたため、切り替え結果を確認できません。「切り替え結果を確認」を押してください。';
        return false;
      } finally { if (current(g, key)) { state.sending = false; render(); } }
    }
    function change(values) {
      const who = identity();
      if (disposed || !who.allowed || !state.loaded || state.loading || state.sending || state.pending || state.denied) return Promise.resolve(false);
      const enabled = values.enabled ?? state.musicBroadcast.enabled, mode = values.mode ?? state.musicBroadcast.mode;
      if (typeof enabled !== 'boolean' || !MODES.includes(mode) || enabled === state.musicBroadcast.enabled && mode === state.musicBroadcast.mode) return Promise.resolve(false);
      let requestId; try { requestId = uuid(); } catch (_) { state.error = '切り替えの準備ができませんでした。再読み込みしてお試しください。'; render(); return Promise.resolve(false); }
      if (typeof requestId !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(requestId)) return Promise.resolve(false);
      state.pending = { enabled, mode, expectedRevision: state.musicBroadcast.revision, requestId };
      return sendPending();
    }
    const setEnabled = enabled => typeof enabled === 'boolean' ? change({ enabled }) : Promise.resolve(false);
    const setMode = mode => MODES.includes(mode) ? change({ mode }) : Promise.resolve(false);
    function click(event) {
      const target = event.target?.closest?.('[data-bgm-command]');
      if (!target || !root?.contains?.(target) || target.disabled) return;
      event.preventDefault(); event.stopPropagation();
      const action = target.getAttribute('data-bgm-command');
      if (action === 'toggle') void setEnabled(!state.musicBroadcast.enabled);
      else if (action === 'mode') void setMode(target.getAttribute('data-bgm-mode'));
      else if (action === 'retry') void sendPending();
      else if (action === 'refresh') void refresh();
    }
    function unmount() { root?.removeEventListener?.('click', click); root = null; lastHTML = ''; }
    function mount(node) {
      if (disposed) return Promise.resolve(false);
      // Social polling can remount the same host between pointerdown and click.
      // Keep its controls and delegated listener alive when the host is unchanged.
      if (root !== (node || null)) { unmount(); root = node || null; root?.addEventListener?.('click', click); }
      identity(); render(); return !state.loaded && !state.pending ? refresh() : Promise.resolve(state.loaded);
    }
    function clear() { if (disposed) return; generation++; readSequence++; stamp = ''; state = empty(); identity(); render(); }
    function dispose() { unmount(); generation++; readSequence++; disposed = true; state = empty(); }
    identity();
    return { mount, unmount, receive, refresh, setEnabled, setMode, retry: sendPending, getState, clear, dispose };
  }
  const api = { clean, markup, create };
  global.SengokuMusicBroadcast = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
