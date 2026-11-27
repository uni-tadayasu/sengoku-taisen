/* Private court event workshop. The server owns admission, plans and publication. */
(function (global) {
  'use strict';
  const PENDING_KEY = 'sengoku-court-events-pending-v1:';
  const RESOURCES = { gold: '金銭', rice: '兵糧', wood: '木材', stone: '石材', magatama: '勾玉' };
  const DIFFICULTIES = { beginner: '入門', standard: '標準', advanced: '上級' };
  const ACTIONS = { generate: '下書きの生成', publish: '公開', end: '開催の終了', discard: '下書きの破棄' };
  const copy = value => JSON.parse(JSON.stringify(value));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const integer = (value, min = 0) => Number.isSafeInteger(value) && value >= min;
  const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,90}$/.test(value);
  const text = (value, max = 1000, empty = false) => typeof value === 'string' && (empty || value.length > 0) && value.length <= max;
  const promptText = (value, empty = false) => typeof value === 'string' && (empty || value.trim().length > 0) && Array.from(value.normalize('NFC').replace(/\s+/g, ' ').trim()).length <= 600;
  const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
  const disabled = value => value ? ' disabled' : '';
  const number = value => Number(value || 0).toLocaleString('ja-JP');
  const date = value => timestamp(value) ? new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) + ' JST' : '公開時に確定';
  const schema = () => global.SengokuEvents || (typeof module !== 'undefined' && module.exports ? require('./events.js') : null);
  const invalid = () => { throw Error('制作室の記録を確認できませんでした。最新情報を取得してください。'); };

  function cleanTemplates(value) {
    if (!Array.isArray(value) || value.length !== 20) return invalid();
    const result = value.map(row => {
      if (!row || !id(row.id) || !text(row.name, 120) || !id(row.category) || !text(row.description, 1500) || !/^(history|castle|roaming):[A-Za-z0-9_-]{1,90}$/.test(String(row.battleId || '')) || !text(row.battleName, 120) || !integer(row.durationDays, 1) || row.durationDays > 7 || !Object.hasOwn(DIFFICULTIES, row.difficulty) || !id(row.themeId)) return invalid();
      return { id: row.id, name: row.name, category: row.category, description: row.description, battleId: row.battleId, battleName: row.battleName, durationDays: row.durationDays, difficulty: row.difficulty, themeId: row.themeId };
    });
    if (new Set(result.map(row => row.id)).size !== result.length) return invalid();
    return result;
  }
  function cleanSource(value) {
    if (!value || value.generator !== 'game-ai-v1' || !['template', 'ai'].includes(value.mode) || !id(value.templateId) || !text(value.templateName, 120) || !promptText(value.prompt, true) || !Object.hasOwn(DIFFICULTIES, value.difficulty) || !Array.isArray(value.matchedKeywords) || value.matchedKeywords.length > 40 || value.matchedKeywords.some(item => !text(item, 100)) || !Array.isArray(value.reasons) || value.reasons.length > 20 || value.reasons.some(item => !text(item, 1000))) return invalid();
    return { generator: value.generator, mode: value.mode, templateId: value.templateId, templateName: value.templateName, prompt: value.prompt, difficulty: value.difficulty, matchedKeywords: [...value.matchedKeywords], reasons: [...value.reasons] };
  }
  function cleanEvent(value, validateEvent) {
    const validator = validateEvent || schema()?.cleanEvent;
    if (typeof validator !== 'function') throw Error('合戦の表示を準備できません。画面を再読み込みしてください。');
    const event = validator(value, true);
    if (!event || !integer(value.revision) || !id(value.creator?.id) || !text(value.creator.name, 120)) return invalid();
    return { ...event, revision: value.revision, creator: { id: value.creator.id, name: value.creator.name }, source: cleanSource(value.source) };
  }
  function cleanDirectory(value, validateEvent) {
    if (value?.ok !== true || value.canManage !== true || !timestamp(value.serverNow) || !Array.isArray(value.events) || value.events.length > 200 || typeof value.hasMore !== 'boolean' || !integer(value.draftLimit, 1) || value.draftLimit > 200 || !integer(value.draftCount) || value.generator?.id !== 'game-ai-v1' || value.generator.label !== 'ゲームAI' || !text(value.generator.description, 1500)) return invalid();
    const events = value.events.map(row => cleanEvent(row, validateEvent)), templates = cleanTemplates(value.templates);
    if (new Set(events.map(row => row.id)).size !== events.length) return invalid();
    const active = value.activeEvent;
    if (active !== null && (!active || !id(active.id) || !text(active.name, 120) || !timestamp(active.endsAt))) return invalid();
    return { templates, events, hasMore: value.hasMore, draftLimit: value.draftLimit, draftCount: value.draftCount, activeEvent: active && { id: active.id, name: active.name, endsAt: active.endsAt }, generator: { ...value.generator }, serverNow: value.serverNow };
  }
  function cleanMutation(value, pending, validateEvent) {
    if (value?.ok !== true || value.canManage !== true || typeof value.idempotent !== 'boolean' || !timestamp(value.serverNow)) return invalid();
    const event = cleanEvent(value.event, validateEvent), receipt = value.receipt;
    if (!receipt || receipt.action !== pending.action || receipt.eventId !== event.id || !integer(receipt.revision) || receipt.revision > event.revision || pending.action === 'generate' && receipt.revision !== 0 || pending.action !== 'generate' && (receipt.eventId !== pending.eventId || receipt.revision <= pending.data.expectedRevision)) return invalid();
    if (pending.action === 'generate' && (event.durationDays !== pending.data.durationDays || event.source.mode !== pending.data.generationMode || pending.data.generationMode === 'template' && event.source.templateId !== pending.data.templateId || event.source.prompt !== String(pending.data.prompt || '').normalize('NFC').replace(/\s+/g, ' ').trim())) return invalid();
    return { event, receipt: { action: receipt.action, eventId: receipt.eventId, revision: receipt.revision }, serverNow: value.serverNow, idempotent: value.idempotent };
  }

  function createController(options = {}) {
    const getContext = options.getContext || (() => global.SengokuSocial?.getCourtContext?.());
    const request = options.request || ((route, settings) => global.SengokuSocial.courtEventRequest(route, settings));
    const uuid = options.uuid || (() => global.crypto.randomUUID()), now = options.now || Date.now;
    let storage; try { storage = options.storage || global.localStorage; } catch (_) {}
    const blank = () => ({ open: false, signedIn: false, authorized: false, loaded: false, loading: false, detailLoading: false, sending: false, pane: 'create', mode: 'template', templateId: '', prompt: '', durationDays: 3, query: '', filter: 'draft', directory: null, selectedId: '', event: null, confirmation: null, pending: null, error: '', message: '', serverOffset: 0, change: 'init' });
    let state = blank(), stamp = '', generation = 0, readSequence = 0, detailSequence = 0, disposed = false, writePromise = null;
    function context() {
      const c = getContext() || {}, owner = String(c.playerId || c.user?.id || '');
      const signedIn = !!owner && c.user?.id === owner && !c.pending && !c.banned && !c.user?.isBanned;
      return { owner, signedIn, stamp: JSON.stringify([owner, c.epoch ?? 0, c.accountEpoch ?? 0, c.privilegeEpoch ?? 0, !!c.pending, !!c.banned, !!c.user?.isBanned, c.user?.isAdmin === true, c.user?.isStaff === true, c.isCourtRegent === true]) };
    }
    const storageKey = owner => PENDING_KEY + encodeURIComponent(owner);
    function readPending(who) {
      if (!who.signedIn) return null;
      try {
        const record = JSON.parse(storage?.getItem(storageKey(who.owner)) || 'null'), data = record?.data;
        if (!record || record.ownerId !== who.owner || !Object.hasOwn(ACTIONS, record.action) || !id(data?.requestId)) return null;
        if (record.action === 'generate') {
          if (record.route !== '/court/events/generate' || !['template', 'ai'].includes(data.generationMode) || !integer(data.durationDays, 1) || data.durationDays > 7 || data.templateId !== undefined && !id(data.templateId) || data.generationMode === 'template' && !id(data.templateId) || data.prompt !== undefined && !promptText(data.prompt, true) || data.generationMode === 'ai' && !promptText(data.prompt)) return null;
          return { ownerId: who.owner, action: 'generate', route: record.route, eventId: '', data: { generationMode: data.generationMode, ...(data.templateId ? { templateId: data.templateId } : {}), ...(data.prompt !== undefined ? { prompt: data.prompt } : {}), durationDays: data.durationDays, requestId: data.requestId } };
        }
        if (!id(record.eventId) || record.route !== '/court/events/' + record.eventId + '/' + record.action || !integer(data.expectedRevision)) return null;
        return { ownerId: who.owner, action: record.action, route: record.route, eventId: record.eventId, data: { expectedRevision: data.expectedRevision, requestId: data.requestId } };
      } catch (_) { return null; }
    }
    function storePending(pending) {
      const saved = JSON.stringify(pending);
      if (!storage?.setItem) throw Error('操作記録を保存できません。端末の保存設定を確認してください。');
      storage.setItem(storageKey(pending.ownerId), saved);
      if (storage.getItem(storageKey(pending.ownerId)) !== saved) throw Error('操作記録を保存できませんでした。');
    }
    function clearPending(pending) {
      try { if (readPending({ signedIn: true, owner: pending.ownerId })?.data.requestId === pending.data.requestId) storage.removeItem(storageKey(pending.ownerId)); } catch (_) {}
    }
    function identity() {
      const who = context();
      if (who.stamp !== stamp) {
        stamp = who.stamp; generation++; readSequence++; detailSequence++; writePromise = null;
        state = { ...blank(), signedIn: who.signedIn, pending: readPending(who) };
      }
      return who;
    }
    const current = (g, key) => !disposed && generation === g && stamp === key && context().stamp === key;
    const snapshot = () => { identity(); return { ...copy(state), identity: stamp, serverNow: now() + state.serverOffset }; };
    const emit = (change = 'status') => { if (!disposed) { state.change = change; options.onChange?.(snapshot()); } };
    const clock = value => { if (timestamp(value)) state.serverOffset = Date.parse(value) - now(); };
    function deny(message) { state.authorized = false; state.directory = null; state.event = null; state.selectedId = ''; state.confirmation = null; state.prompt = ''; state.query = ''; state.templateId = ''; state.error = message; }
    function adoptEvent(event) {
      const previous = state.directory?.events.find(row => row.id === event.id);
      if (previous && previous.revision > event.revision) return;
      if (state.directory) state.directory.events = [event, ...state.directory.events.filter(row => row.id !== event.id)];
      if (state.selectedId === event.id) state.event = event;
    }
    function adoptDirectory(directory) {
      state.directory = directory; state.authorized = true; state.loaded = true; clock(directory.serverNow);
      if (state.pending?.action === 'generate') { const data = state.pending.data; state.mode = data.generationMode; state.templateId = data.templateId || ''; state.durationDays = data.durationDays; state.prompt = data.prompt || ''; }
      if (!state.templateId && state.mode === 'template') state.templateId = directory.templates[0]?.id || '';
      if (state.selectedId) {
        const fresh = directory.events.find(row => row.id === state.selectedId);
        if (fresh && (!state.event || fresh.revision >= state.event.revision)) state.event = fresh;
      } else {
        state.event = directory.events.find(row => row.status === 'draft') || directory.events[0] || null;
        state.selectedId = state.event?.id || '';
      }
    }
    async function refresh({ quiet = false, preserveError = false } = {}) {
      const who = identity();
      if (!who.signedIn || !state.open || state.sending) { emit(); return false; }
      const g = generation, key = stamp, seq = ++readSequence;
      state.loading = !quiet || !state.loaded; emit('loading');
      try {
        const result = await request('/court/events', { method: 'GET' });
        if (!current(g, key) || seq !== readSequence) return false;
        adoptDirectory(cleanDirectory(result, options.cleanEvent));
        if (!preserveError) state.error = '';
        return true;
      } catch (error) {
        if (current(g, key) && seq === readSequence) {
          if ([401, 403].includes(error.status) || error.code === 'COURT_EVENT_ACCESS_CHANGED') deny(error.message || '制作室は朝廷の担当者専用です。');
          else state.error = error.message || '制作室に接続できませんでした。';
        }
        return false;
      } finally { if (current(g, key) && seq === readSequence) { state.loading = false; emit('loaded'); } }
    }
    async function open() {
      const who = identity();
      if (!who.signedIn) { state.error = '交流の間で領主の接続を確認してください。'; emit(); return false; }
      state.open = true; emit('open'); return refresh();
    }
    function close() { identity(); state.open = false; state.confirmation = null; emit('close'); }
    function refreshAccess() { identity(); emit('access'); }
    function update(field, value) {
      identity();
      if (!state.authorized || state.sending || state.pending) return false;
      if (field === 'prompt') state.prompt = Array.from(String(value ?? '')).slice(0, 600).join('');
      else if (field === 'query') state.query = String(value ?? '').slice(0, 100);
      else if (field === 'durationDays') { const days = Number(value); if (!integer(days, 1) || days > 7) return false; state.durationDays = days; }
      else if (field === 'mode') { if (!['template', 'ai'].includes(value)) return false; state.mode = value; }
      else if (field === 'templateId') { if (value && !state.directory?.templates.some(row => row.id === value)) return false; state.templateId = value; }
      else if (field === 'filter') { if (!['draft', 'active', 'history'].includes(value)) return false; state.filter = value; state.event = state.directory?.events.find(row => eventGroup(row, now() + state.serverOffset) === value) || null; state.selectedId = state.event?.id || ''; detailSequence++; state.detailLoading = false; }
      else if (field === 'pane') { if (!['create', 'shared'].includes(value)) return false; state.pane = value; }
      else return false;
      state.confirmation = null; state.error = ''; emit('edit'); return true;
    }
    function chooseTemplate(value) {
      identity();
      if (!state.authorized || state.sending || state.pending) return false;
      const template = state.directory?.templates.find(row => row.id === value); if (!template) return false;
      state.templateId = template.id; state.durationDays = template.durationDays; state.confirmation = null; emit('template'); return true;
    }
    async function selectEvent(value) {
      identity();
      if (!state.authorized || state.sending || state.pending || !id(value)) return false;
      const listed = state.directory?.events.find(row => row.id === value); if (!listed) return false;
      state.selectedId = value; state.event = listed; state.pane = 'shared'; state.confirmation = null; state.detailLoading = true; state.error = '';
      const g = generation, key = stamp, seq = ++detailSequence; emit('selection');
      try {
        const result = await request('/court/events/' + value, { method: 'GET' });
        if (!current(g, key) || seq !== detailSequence || state.selectedId !== value) return false;
        if (result?.ok !== true || result.canManage !== true || !timestamp(result.serverNow) || result.event?.id !== value) return invalid();
        adoptEvent(cleanEvent(result.event, options.cleanEvent)); clock(result.serverNow); return true;
      } catch (error) {
        if (current(g, key) && seq === detailSequence) {
          if ([401, 403].includes(error.status) || error.code === 'COURT_EVENT_ACCESS_CHANGED') deny(error.message || '制作室を利用する権限が変更されました。');
          else state.error = error.message || 'イベントの詳細を確認できませんでした。';
        }
        return false;
      } finally { if (current(g, key) && seq === detailSequence) { state.detailLoading = false; emit('detail'); } }
    }
    function canAct(action, event = state.event) {
      if (!event || !state.authorized || state.detailLoading) return false;
      if (action === 'publish') return event.status === 'draft' && (!state.directory?.activeEvent || Date.parse(state.directory.activeEvent.endsAt) <= now() + state.serverOffset);
      if (action === 'discard') return event.status === 'draft';
      return action === 'end' && event.status === 'active' && Date.parse(event.endsAt) > now() + state.serverOffset;
    }
    function prepare(action) {
      identity();
      if (!state.open || state.sending || state.pending || !canAct(action)) return false;
      state.confirmation = { action, eventId: state.event.id, name: state.event.name, durationDays: state.event.durationDays, expectedRevision: state.event.revision };
      state.error = ''; emit('confirm'); return true;
    }
    function cancel() { identity(); if (state.sending || state.pending) return false; state.confirmation = null; emit('cancel'); return true; }
    function intent(action) {
      const who = identity();
      if (!who.signedIn || !state.authorized) throw Error('制作室を利用する権限を確認してください。');
      if (action === 'generate') {
        if (state.directory.draftCount >= state.directory.draftLimit) throw Error('下書きが上限に達しています。共有イベントで不要な下書きを整理してください。');
        if (state.mode === 'template' && !state.directory.templates.some(row => row.id === state.templateId)) throw Error('テンプレートを選択してください。');
        if (state.mode === 'ai' && !state.prompt.trim()) throw Error('ゲームAIへ企画の要望を入力してください。');
        return { ownerId: who.owner, action, route: '/court/events/generate', eventId: '', data: { generationMode: state.mode, ...(state.templateId ? { templateId: state.templateId } : {}), ...(state.mode === 'ai' ? { prompt: state.prompt.trim() } : {}), durationDays: state.durationDays, requestId: uuid() } };
      }
      const c = state.confirmation;
      if (!c || c.action !== action || c.eventId !== state.event?.id || c.expectedRevision !== state.event.revision || !canAct(action)) throw Error('イベントの状態が更新されました。最新の内容で確認し直してください。');
      return { ownerId: who.owner, action, route: '/court/events/' + c.eventId + '/' + action, eventId: c.eventId, data: { expectedRevision: c.expectedRevision, requestId: uuid() } };
    }
    async function submit(action) {
      identity();
      if (!state.open || !state.authorized || state.sending) return false;
      if (!state.pending) {
        try { const pending = intent(action); storePending(pending); state.pending = pending; }
        catch (error) { state.error = error.message; emit(); return false; }
      }
      const pending = copy(state.pending), g = generation, key = stamp;
      state.sending = true; state.error = ''; state.message = ''; readSequence++; detailSequence++; state.loading = false; state.detailLoading = false; emit('sending');
      const task = (async () => {
        try {
          const value = await request(pending.route, { method: 'POST', data: copy(pending.data) });
          if (!current(g, key)) return false;
          const result = cleanMutation(value, pending, options.cleanEvent);
          clearPending(pending); state.pending = null; state.confirmation = null; state.selectedId = result.event.id; adoptEvent(result.event); state.event = result.event; state.pane = 'shared';
          state.filter = result.event.status === 'draft' ? 'draft' : result.event.status === 'active' && Date.parse(result.event.endsAt) > Date.parse(result.serverNow) ? 'active' : 'history';
          clock(result.serverNow);
          state.message = result.idempotent ? ACTIONS[pending.action] + 'の記録を確認しました。最新の状態を表示しています。' : pending.action === 'generate' ? '共有下書きを作成しました。戦場・ルール・報酬を確認してから公開してください。' : pending.action === 'publish' ? 'イベントを公開しました。領主たちが参加できます。' : pending.action === 'end' ? 'イベントの開催を終了しました。' : '下書きを破棄しました。';
          return true;
        } catch (error) {
          if (current(g, key)) {
            if ([400, 401, 403, 404, 409, 422].includes(error.status) && !error.retryable) { clearPending(pending); state.pending = null; state.confirmation = null; }
            if ([401, 403].includes(error.status) || error.code === 'COURT_EVENT_ACCESS_CHANGED') deny(error.message || '制作室を利用する権限が変更されました。');
            else state.error = error.message || '結果を確認できませんでした。同じ操作番号で結果を確認してください。';
          }
          return false;
        } finally {
          if (current(g, key)) {
            state.sending = false; writePromise = null; emit('result');
            if (!state.pending && state.authorized && state.open) void refresh({ quiet: true, preserveError: !!state.error });
          }
        }
      })(); writePromise = task; return task;
    }
    identity();
    return { snapshot, open, close, refresh, refreshAccess, update, chooseTemplate, selectEvent, prepare, cancel, submit, dispose() { disposed = true; generation++; readSequence++; detailSequence++; state = blank(); writePromise = null; } };
  }

  function giftMarkup(gift) {
    return Object.entries(RESOURCES).filter(([key]) => gift?.[key] > 0).map(([key, label]) => `<span>${label} <b>${number(gift[key])}</b></span>`).join('') || '<span>資源報酬なし</span>';
  }
  function status(event, now) { return event.status === 'draft' ? '下書き' : event.status === 'discarded' ? '破棄済み' : event.status === 'ended' || Date.parse(event.endsAt) <= now ? '終了' : '開催中'; }
  function eventGroup(event, now) { return event.status === 'draft' ? 'draft' : status(event, now) === '開催中' ? 'active' : 'history'; }
  function planMarkup(event) {
    const p = event.plan;
    return `<section class="cer-section"><h3>企画の概要</h3><p>${esc(p.synopsis)}</p><div class="cer-meta"><span>${p.durationDays}日間</span><span>${esc(p.theme.label)}</span><span>指令 ${number(p.commandCost)} / 出陣</span></div></section>
      <section class="cer-section"><h3>3つの戦場</h3><ol class="cer-stages">${p.stages.map((stage, index) => `<li><span class="cer-stage-number">${index + 1}</span><div><h4>${esc(stage.name)}</h4><p>${esc(stage.description)}</p><dl><div><dt>相手</dt><dd>${esc(stage.enemyName)}</dd></div><div><dt>基準戦力</dt><dd>${number(stage.enemyPower)}</dd></div><div><dt>基準戦功</dt><dd>${number(stage.basePoints)}点</dd></div></dl><p class="cer-note">${esc(stage.tacticHint)}</p></div></li>`).join('')}</ol></section>
      <section class="cer-section"><h3>参加ルール</h3><ul class="cer-rules">${p.rules.map(rule => `<li>${esc(rule)}</li>`).join('')}</ul></section>
      ${p.battleRewards ? `<section class="cer-section"><h3>出陣ごとの報酬</h3><div class="cer-battle-rewards">${p.stages.map((stage, index) => `<article><h4>${esc(stage.name)}</h4><strong>勝利報酬</strong><div class="cer-gifts">${giftMarkup(p.battleRewards.victory[index])}</div><strong>奮戦報酬</strong><div class="cer-gifts">${giftMarkup(p.battleRewards.defeat[index])}</div></article>`).join('')}</div></section>` : ''}
      <section class="cer-section"><h3>累計戦功の褒賞</h3><div class="cer-milestones">${p.milestones.map(item => `<article><h4>${esc(item.title)} <small>${number(item.points)}点</small></h4><div class="cer-gifts">${giftMarkup(item.gift)}</div></article>`).join('')}</div></section>
      ${p.ending?.kind === 'unification' ? `<section class="cer-section cer-unification"><h3>天下統一と幕府開設権</h3><p>3つの戦場すべてで勝利し、累計戦功 ${number(p.ending.requiredPoints)}点に達すると幕府開設権を獲得します。幕府開設には別途、天皇または摂政への申請が必要です。</p></section>` : ''}
      <details class="cer-section cer-tactics"><summary>選べる5つの戦術</summary><dl>${p.tactics.map(item => `<div><dt>${esc(item.name)}</dt><dd>${esc(item.description)}</dd></div>`).join('')}</dl></details>`;
  }
  function confirmationMarkup(state) {
    const c = state.confirmation; if (!c) return '';
    const stale = state.event?.id !== c.eventId || state.event.revision !== c.expectedRevision;
    const blocked = c.action === 'publish' && state.directory.activeEvent && Date.parse(state.directory.activeEvent.endsAt) > state.serverNow;
    return `<section class="cer-confirm" tabindex="-1" data-stable-key="cer-confirm" aria-label="${esc(ACTIONS[c.action])}の確認"><h3>${esc(c.name)}を${c.action === 'publish' ? '公開' : c.action === 'end' ? '終了' : '破棄'}しますか</h3><p>${c.action === 'publish' ? `確認した内容で、今から${c.durationDays}日間開催します。すべての領主のイベント一覧に公開されます。` : c.action === 'end' ? '新しい出陣の受付を終了します。確定済みの戦功や配布済みの報酬は残ります。' : '共有下書きを破棄し、公開できない状態にします。朝廷の担当者全員に反映されます。'}</p>${stale ? '<p class="cer-warning" role="alert">ほかの担当者が記録を更新しました。最新の内容で確認し直してください。</p>' : ''}${blocked ? '<p class="cer-warning">現在のイベントが終了してから公開できます。</p>' : ''}<div class="cer-actions"><button class="cer-button" data-cer-action="cancel"${disabled(state.sending)}>戻る</button><button class="cer-button ${c.action === 'publish' ? 'is-primary' : 'is-danger'}" data-cer-action="commit"${disabled(state.sending || stale || blocked)}>${c.action === 'publish' ? 'この内容で公開する' : c.action === 'end' ? '開催を終了する' : '下書きを破棄する'}</button></div></section>`;
  }
  function creatorMarkup(state) {
    const d = state.directory, locked = state.sending || !!state.pending, selected = d.templates.find(row => row.id === state.templateId);
    const query = state.query.normalize('NFKC').toLocaleLowerCase('ja'), templates = d.templates.filter(row => [row.name, row.description, row.battleName, DIFFICULTIES[row.difficulty]].join(' ').normalize('NFKC').toLocaleLowerCase('ja').includes(query));
    return `<section class="cer-create" data-stable-key="cer-create"><div class="cer-section-heading"><div><span class="cer-eyebrow">新しい企画</span><h2>下書きから制作する</h2></div><span class="cer-counter">共有下書き ${d.draftCount} / ${d.draftLimit}</span></div><div class="cer-mode" role="group" aria-label="制作方法"><button class="cer-button" data-cer-action="mode" data-cer-value="template" aria-pressed="${state.mode === 'template'}"${disabled(locked)}>20種類のテンプレート</button><button class="cer-button" data-cer-action="mode" data-cer-value="ai" aria-pressed="${state.mode === 'ai'}"${disabled(locked)}>ゲームAIに相談</button></div>
      ${state.mode === 'template' ? `<label for="cer-template-query">テンプレートを探す</label><input id="cer-template-query" type="search" maxlength="100" placeholder="合戦名・地形・難しさ" value="${esc(state.query)}"${disabled(locked)}><p class="cer-note">${templates.length} / 20種類 · 選ぶと推奨の開催日数を設定します。</p><ul class="cer-templates" aria-label="イベントのテンプレート">${templates.map(row => `<li data-stable-key="cer-template-${esc(row.id)}"><button type="button" class="cer-template" data-cer-action="template" data-cer-value="${esc(row.id)}" aria-pressed="${row.id === state.templateId}"${disabled(locked)}><span class="cer-template-meta">${esc(DIFFICULTIES[row.difficulty])} · ${row.durationDays}日</span><strong>${esc(row.name)}</strong><span>${esc(row.description)}</span><small>${esc(row.battleName)}</small></button></li>`).join('')}</ul>${!templates.length ? '<p class="cer-empty">条件に一致するテンプレートがありません。</p>' : ''}${selected ? `<section class="cer-selected" data-stable-key="cer-selected"><h3>選択中：${esc(selected.name)}</h3><p>${esc(selected.description)}</p><p class="cer-note">公開名：${esc(selected.battleName)}</p></section>` : ''}` : `<section class="cer-ai"><span class="cer-eyebrow">ゲームAI</span><p>${esc(d.generator.description)}</p><p class="cer-note">要望から合戦やテンプレートを選び、戦場・戦術・難しさを組み立てます。生成後の内容は共有下書きで確認できます。</p><label for="cer-prompt">どんなイベントにしますか</label><textarea id="cer-prompt" rows="5" maxlength="1200" placeholder="例：初心者も参加しやすい、川辺での攻防。奇襲を学べる合戦にしたい。"${disabled(locked)}>${esc(state.prompt)}</textarea><p class="cer-note cer-character-count">${Array.from(state.prompt).length} / 600文字</p><label for="cer-ai-template">参考にするテンプレート</label><select id="cer-ai-template"${disabled(locked)}><option value="">ゲームAIに任せる</option>${d.templates.map(row => `<option value="${esc(row.id)}"${row.id === state.templateId ? ' selected' : ''}>${esc(row.name)}</option>`).join('')}</select><p class="cer-note">要望に合う合戦が見つかると、参考テンプレートより優先します。</p></section>`}
      <section class="cer-generation-settings"><label for="cer-duration">公開後の開催日数</label><select id="cer-duration"${disabled(locked)}>${Array.from({ length: 7 }, (_, i) => `<option value="${i + 1}"${state.durationDays === i + 1 ? ' selected' : ''}>${i + 1}日間</option>`).join('')}</select><p class="cer-note">公開した時点から現実時間で数えます。生成しただけでは公開されません。</p><button class="cer-button is-primary" data-cer-action="generate"${disabled(locked || d.draftCount >= d.draftLimit || state.mode === 'template' && !selected || state.mode === 'ai' && !state.prompt.trim())}>${state.mode === 'ai' ? 'ゲームAIで下書きを生成' : 'このテンプレートで下書きを作る'}</button>${d.draftCount >= d.draftLimit ? '<p class="cer-warning">共有下書きが上限に達しています。不要な下書きを整理してください。</p>' : ''}</section></section>`;
  }
  function sharedMarkup(state) {
    const d = state.directory, locked = state.sending || !!state.pending, rows = d.events.filter(row => eventGroup(row, state.serverNow) === state.filter), event = state.event;
    return `<section class="cer-shared" data-stable-key="cer-shared"><div class="cer-section-heading"><div><span class="cer-eyebrow">朝廷で共有</span><h2>イベントの記録</h2></div><span class="cer-note">担当者全員が管理できます</span></div><nav class="cer-filters" aria-label="イベントの状態">${[['draft', '下書き'], ['active', '開催中'], ['history', '履歴']].map(([key, label]) => `<button class="cer-button is-small" data-cer-action="filter" data-cer-value="${key}" aria-pressed="${state.filter === key}"${disabled(locked)}>${label} <span>${d.events.filter(row => eventGroup(row, state.serverNow) === key).length}</span></button>`).join('')}</nav><div class="cer-workspace"><aside class="cer-list" aria-label="共有イベントの一覧">${rows.length ? rows.map(row => `<button class="cer-event" data-stable-key="cer-event-${esc(row.id)}" data-cer-action="event" data-cer-value="${esc(row.id)}" aria-pressed="${state.selectedId === row.id}"${disabled(locked)}><span class="cer-status" data-status="${eventGroup(row, state.serverNow)}">${status(row, state.serverNow)}</span><strong>${esc(row.name)}</strong><small>${row.durationDays}日間 · ${esc(row.creator.name)}</small><small>${date(row.createdAt)}</small></button>`).join('') : '<p class="cer-empty">この状態のイベントはありません。</p>'}${d.hasMore ? '<p class="cer-note">新しい記録から表示しています。公開・終了後は「最新情報を取得」で更新できます。</p>' : ''}</aside><div class="cer-preview" data-stable-key="cer-preview">${event ? `<header class="cer-preview-heading" data-stable-key="cer-preview-heading"><span class="cer-status" data-status="${eventGroup(event, state.serverNow)}">${status(event, state.serverNow)}</span><h2 tabindex="-1" data-cer-preview-title>${esc(event.name)}</h2><p class="cer-note">企画：${esc(event.creator.name)} · ${date(event.createdAt)}</p>${event.status === 'draft' ? '<p class="cer-preview-warning">共有下書きです。戦場・参加ルール・報酬を確認してから公開してください。</p>' : `<p class="cer-note">開始：${date(event.startsAt)}<br>終了：${date(event.endedAt || event.endsAt)}</p>`}</header><section class="cer-source"><h3>${event.source.mode === 'ai' ? 'ゲームAIの企画' : 'テンプレートから制作'}</h3><p>${esc(event.source.templateName)} · ${esc(DIFFICULTIES[event.source.difficulty])}</p>${event.source.prompt ? `<details><summary>制作時の要望</summary><p>${esc(event.source.prompt)}</p></details>` : ''}${event.source.reasons.length ? `<ul>${event.source.reasons.map(reason => `<li>${esc(reason)}</li>`).join('')}</ul>` : ''}</section>${planMarkup(event)}<section class="cer-event-actions" data-stable-key="cer-event-actions"><h3>このイベントを管理する</h3>${state.detailLoading ? '<p class="cer-note" aria-busy="true">最新の状態を確認しています。</p>' : ''}${event.status === 'draft' ? `<div class="cer-actions"><button class="cer-button is-primary" data-cer-action="prepare" data-cer-value="publish"${disabled(locked || state.detailLoading || !!d.activeEvent && Date.parse(d.activeEvent.endsAt) > state.serverNow)}>公開内容を確認</button><button class="cer-button is-danger" data-cer-action="prepare" data-cer-value="discard"${disabled(locked || state.detailLoading)}>下書きの破棄を確認</button></div>${d.activeEvent && Date.parse(d.activeEvent.endsAt) > state.serverNow ? `<p class="cer-note">「${esc(d.activeEvent.name)}」が開催中です。${date(d.activeEvent.endsAt)}の終了後に公開できます。</p>` : ''}` : eventGroup(event, state.serverNow) === 'active' ? `<button class="cer-button is-danger" data-cer-action="prepare" data-cer-value="end"${disabled(locked || state.detailLoading)}>開催の終了を確認</button>` : '<p class="cer-note">このイベントの管理操作は完了しています。</p>'}</section>${confirmationMarkup(state)}` : '<p class="cer-empty">共有イベントを選ぶと、内容と報酬を確認できます。</p>'}</div></div></section>`;
  }
  function markup(state) {
    if (!state.signedIn) return '<section class="cer-empty"><h2>領主の接続を確認してください</h2><p>制作室は朝廷の担当者専用です。</p></section>';
    let html = `<p class="cer-feedback${state.error ? ' is-error' : ''}" role="${state.error ? 'alert' : 'status'}" data-stable-key="cer-feedback">${esc(state.error || state.message || ' ')}</p>`;
    if (!state.authorized || !state.directory) return html + `<section class="cer-empty"${state.loading ? ' aria-busy="true"' : ''}><h2>${state.loading ? '制作室の入室資格を確認しています' : '朝廷の担当者専用の制作室'}</h2><p>太政大臣・京都御所のメンバー・摂政が利用できます。</p></section>`;
    html += `<p class="cer-intro" data-stable-key="cer-intro">下書きは朝廷の担当者で共有します。公開すると、すべての領主がイベントに参加できます。</p>`;
    if (state.pending) html += `<section class="cer-pending" data-stable-key="cer-pending"><h2>${esc(ACTIONS[state.pending.action])}の結果を確認</h2><p>操作は保存済みです。同じ操作番号で結果を確認します。</p><button class="cer-button is-primary" data-cer-action="retry"${disabled(state.sending)}>${state.sending ? '処理を確認しています…' : '同じ操作の結果を確認'}</button></section>`;
    html += `<nav class="cer-tabs" aria-label="制作室の案内" data-stable-key="cer-tabs"><button class="cer-button" data-cer-action="pane" data-cer-value="create" aria-pressed="${state.pane === 'create'}"${disabled(state.sending || !!state.pending)}>新しく制作</button><button class="cer-button" data-cer-action="pane" data-cer-value="shared" aria-pressed="${state.pane === 'shared'}"${disabled(state.sending || !!state.pending)}>共有イベント</button></nav>`;
    return html + (state.pane === 'create' ? creatorMarkup(state) : sharedMarkup(state));
  }

  function createUI(options = {}) {
    const doc = options.document || global.document;
    let dialog, controller, returnFocus, disposed = false, timer, focusConfirmation = false, lastIdentity = '';
    const later = options.setTimeout || global.setTimeout, cancelTimer = options.clearTimeout || global.clearTimeout;
    function ensureDialog() {
      if (dialog || !doc) return;
      dialog = doc.createElement('dialog'); dialog.setAttribute('class', 'court-events-dialog'); dialog.setAttribute('aria-labelledby', 'cer-title');
      dialog.innerHTML = '<header class="cer-header"><div><span class="cer-eyebrow">朝廷の担当者専用</span><h1 id="cer-title">イベント制作室</h1></div><button class="cer-close" data-cer-action="close" aria-label="制作室を閉じる">×</button></header><div class="cer-main"></div><footer class="cer-footer"><button class="cer-button is-small" data-cer-action="reload">最新情報を取得</button><span>公開前に内容を確認できます</span><button class="cer-button is-small" data-cer-action="close">閉じる</button></footer>';
      dialog.addEventListener('click', event => {
        const button = event.target?.closest?.('[data-cer-action]'); if (!button || !dialog.contains(button) || button.disabled) return;
        event.preventDefault(); const action = button.dataset.cerAction, value = button.dataset.cerValue;
        if (action === 'close') controller.close();
        else if (action === 'reload') void controller.refresh();
        else if (['pane', 'mode', 'filter'].includes(action)) controller.update(action, value);
        else if (action === 'template') controller.chooseTemplate(value);
        else if (action === 'event') void controller.selectEvent(value);
        else if (action === 'generate') void controller.submit('generate');
        else if (action === 'prepare') { focusConfirmation = true; controller.prepare(value); focusConfirmation = false; }
        else if (action === 'cancel') controller.cancel();
        else if (action === 'commit') void controller.submit(controller.snapshot().confirmation?.action);
        else if (action === 'retry') void controller.submit();
      });
      dialog.addEventListener('input', event => { const fields = { 'cer-prompt': 'prompt', 'cer-template-query': 'query' }; if (fields[event.target?.id]) controller.update(fields[event.target.id], event.target.value); });
      dialog.addEventListener('change', event => { const fields = { 'cer-duration': 'durationDays', 'cer-ai-template': 'templateId' }; if (fields[event.target?.id]) controller.update(fields[event.target.id], event.target.value); });
      dialog.addEventListener('cancel', event => { event.preventDefault(); controller.close(); });
      dialog.addEventListener('close', () => { if (controller.snapshot().open) controller.close(); });
      doc.body.append(dialog);
    }
    function render(state) {
      if (disposed) return;
      if (!state.open) {
        if (dialog?.open) { dialog.close(); if (returnFocus?.isConnected) returnFocus.focus?.({ preventScroll: true }); }
        if (lastIdentity !== state.identity && dialog) dialog.querySelector('.cer-main').innerHTML = '';
        lastIdentity = state.identity; options.onChange?.(state); return;
      }
      ensureDialog(); if (!dialog) return;
      const main = dialog.querySelector('.cer-main'), top = main.scrollTop, html = markup(state);
      if (global.SengokuStableDOM?.patch) global.SengokuStableDOM.patch(main, html, { key: ['court-events', state.identity] });
      else {
        const active = doc.activeElement, field = main.contains(active) && active.id, start = active?.selectionStart, end = active?.selectionEnd;
        if (main.innerHTML !== html) main.innerHTML = html;
        if (field) { const node = doc.getElementById?.(field) || main.querySelector('#' + field); if (node) { node.focus?.({ preventScroll: true }); if (Number.isInteger(start) && node.setSelectionRange) try { node.setSelectionRange(start, end); } catch (_) {} } }
      }
      if (main.scrollTop !== top) main.scrollTop = top;
      for (const [name, value] of [['cer-prompt', state.prompt], ['cer-template-query', state.query], ['cer-duration', state.durationDays], ['cer-ai-template', state.templateId]]) {
        const node = main.querySelector('#' + name); if (node && node.value !== String(value)) node.value = String(value);
      }
      const reload = dialog.querySelector('[data-cer-action="reload"]'); reload.disabled = state.sending || state.loading;
      if (!dialog.open) dialog.showModal();
      if (focusConfirmation && state.confirmation) { const panel = main.querySelector('.cer-confirm'); panel?.focus?.({ preventScroll: true }); panel?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'instant' }); }
      else if (state.change === 'result' && state.message && !state.pending) { const heading = main.querySelector('[data-cer-preview-title]'); heading?.focus?.({ preventScroll: true }); heading?.scrollIntoView?.({ block: 'start', behavior: 'instant' }); }
      lastIdentity = state.identity; options.onChange?.(state);
    }
    controller = createController({ ...options, onChange: render });
    async function poll() {
      if (disposed) return;
      try { controller.refreshAccess(); const s = controller.snapshot(); if (s.open && s.authorized && !s.sending && !s.pending && !s.confirmation && !s.loading && !doc?.hidden) await controller.refresh({ quiet: true }); }
      finally { if (!disposed && later && options.autoPoll !== false) timer = later(poll, 30000); }
    }
    if (options.autoPoll !== false && later) timer = later(poll, 30000);
    return {
      async open() { if (disposed) return false; if (!controller.snapshot().open) returnFocus = doc?.activeElement; return controller.open(); },
      close: () => controller.close(), refreshAccess: () => controller.refreshAccess(), refresh: () => controller.refresh(), getState: () => controller.snapshot(), controller,
      dispose() { if (disposed) return; disposed = true; cancelTimer?.(timer); controller.dispose(); dialog?.remove(); dialog = null; }
    };
  }
  let instance;
  const get = () => instance || (instance = createUI());
  global.SengokuCourtEvents = { open: () => get().open(), close: () => instance?.close(), refreshAccess: () => instance?.refreshAccess(), dispose: () => { instance?.dispose(); instance = null; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = { createController, createUI, cleanTemplates, cleanSource, cleanEvent, cleanDirectory, cleanMutation, markup, planMarkup, confirmationMarkup };
})(typeof window !== 'undefined' ? window : globalThis);
