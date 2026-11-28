/* Operator-only payment reviews and observed aggregate metrics. */
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
  const metricKeys = ['shopViews', 'checkoutStarts', 'fulfilledPasses', 'paidSupporterPeriods', 'loginClaimAccounts', 'loginClaims'];
  const metricAccountKeys = ['uniqueShopAccounts', 'uniqueCheckoutAccounts', 'uniquePaidAccounts', 'matchedPaidShopAccounts'];
  const metricPeriods = [14, 30, 60, 90];
  const metricProducts = Object.freeze({ 'gold-banner': '金彩の旗印', 'moonlit-castle': '月影の城下', supporter: '戦国VSサポーター', 'reroll-pass-30d': '武将再抽選パス・30日', 'vermilion-banner': '紅蓮の旗印', 'silver-banner': '白銀の旗印', 'phoenix-medallion': '鳳凰の勲章', 'sakura-town': '桜雲の城下', 'snow-town': '雪華の城下', 'castle-heritage': '名城絵巻・全城対応' });
  const metricDay = value => typeof value === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
  const metricCount = value => Number.isSafeInteger(value) && value >= 0;
  const metricText = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 1000;
  const metricInstant = value => typeof value === 'string' && /^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === (value.includes('.') ? value : value.replace('Z', '.000Z'));
  const metricRatio = (numerator, denominator, rate) => metricCount(numerator) && metricCount(denominator) && numerator <= denominator && (denominator === 0 ? rate === null : typeof rate === 'number' && Number.isFinite(rate) && rate >= 0 && rate <= 1 && Math.abs(rate - numerator / denominator) <= .0001);
  function cleanRevenue(value) {
    const keys = ['validAmount', 'validPayments', 'excludedAmount', 'excludedPayments'];
    if (!value || value.currency !== 'JPY' || value.taxIncluded !== true || !metricText(value.definition) || !metricText(value.dateBasis) || ![...keys, 'unclassifiedExcludedAmount', 'unclassifiedExcludedPayments'].every(key => metricCount(value[key])) || !Array.isArray(value.byProduct) || value.byProduct.length !== Object.keys(metricProducts).length) return null;
    const seen = new Set(), byProduct = value.byProduct.map(row => {
      if (!row || !Object.hasOwn(metricProducts, row.productId) || seen.has(row.productId) || !keys.every(key => metricCount(row[key]))) return null;
      seen.add(row.productId); return { productId: row.productId, ...Object.fromEntries(keys.map(key => [key, row[key]])) };
    });
    if (byProduct.some(row => !row) || !keys.every(key => byProduct.reduce((sum, row) => sum + row[key], 0) + (key === 'excludedAmount' ? value.unclassifiedExcludedAmount : key === 'excludedPayments' ? value.unclassifiedExcludedPayments : 0) === value[key])) return null;
    return { currency: 'JPY', taxIncluded: true, definition: value.definition, dateBasis: value.dateBasis, ...Object.fromEntries([...keys, 'unclassifiedExcludedAmount', 'unclassifiedExcludedPayments'].map(key => [key, value[key]])), byProduct };
  }
  function cleanRenewal(value, toDay) {
    if (!value || !metricText(value.definition) || value.graceDays !== 7 || !metricDay(value.throughDay) || value.throughDay > toDay || !metricRatio(value.renewedPeriods, value.eligiblePeriods, value.rate) || value.observedSince !== null && !metricInstant(value.observedSince) || value.observedSince === null && value.eligiblePeriods > 0) return null;
    return { definition: value.definition, graceDays: 7, observedSince: value.observedSince, eligiblePeriods: value.eligiblePeriods, renewedPeriods: value.renewedPeriods, rate: value.rate, throughDay: value.throughDay };
  }
  function cleanPlayerRetention(value, toDay) {
    if (!value || !metricText(value.definition) || !metricText(value.cohortBasis) || value.dayBoundary !== 'Asia/Tokyo 05:00' || !Array.isArray(value.segments) || value.segments.length !== 2) return null;
    const observedSince = value.observedSince;
    if (observedSince !== null && !metricInstant(observedSince)) return null;
    const seen = new Set(), segments = value.segments.map(row => {
      if (!row || !['free', 'paid'].includes(row.segment) || seen.has(row.segment) || !metricText(row.label) || !metricCount(row.observedAccounts)) return null;
      const periods = {};
      for (const key of ['d1', 'd30']) {
        const period = row[key];
        if (!period || !metricRatio(period.returnedAccounts, period.eligibleAccounts, period.rate) || period.eligibleAccounts > row.observedAccounts || !metricDay(period.throughDay) || period.throughDay > toDay) return null;
        periods[key] = { eligibleAccounts: period.eligibleAccounts, returnedAccounts: period.returnedAccounts, rate: period.rate, throughDay: period.throughDay };
      }
      if (periods.d30.eligibleAccounts > periods.d1.eligibleAccounts || observedSince === null && row.observedAccounts > 0) return null;
      seen.add(row.segment); return { segment: row.segment, label: row.label, observedAccounts: row.observedAccounts, ...periods };
    });
    return segments.some(row => !row) ? null : { definition: value.definition, observedSince, dayBoundary: value.dayBoundary, cohortBasis: value.cohortBasis, segments };
  }
  function cleanMetrics(value) {
    const day = metricDay;
    const counts = row => row && metricKeys.every(key => Number.isSafeInteger(row[key]) && row[key] >= 0) ? Object.fromEntries(metricKeys.map(key => [key, row[key]])) : null;
    if (value?.ok !== true || !Number.isSafeInteger(value.days) || value.days < 1 || value.days > 90 || !day(value.fromDay) || !day(value.toDay) || value.fromDay > value.toDay || !Array.isArray(value.daily) || value.daily.length > value.days) return null;
    const totals = counts(value.totals), seen = new Set(), daily = value.daily.map(row => {
      if (!day(row?.day) || seen.has(row.day) || row.day < value.fromDay || row.day > value.toDay || !counts(row)) return null;
      seen.add(row.day); return { day: row.day, ...counts(row) };
    });
    const retention = value.retention;
    if (!totals || daily.some(row => !row) || !retention || !Number.isSafeInteger(retention.cohortAccounts) || retention.cohortAccounts < 0 || !Number.isSafeInteger(retention.returnedNextDay) || retention.returnedNextDay < 0 || retention.returnedNextDay > retention.cohortAccounts || !day(retention.throughDay) || typeof retention.definition !== 'string' || !retention.definition || retention.definition.length > 200) return null;
    if (retention.cohortAccounts === 0 ? retention.rate !== null : typeof retention.rate !== 'number' || !Number.isFinite(retention.rate) || retention.rate < 0 || retention.rate > 1 || Math.abs(retention.rate - retention.returnedNextDay / retention.cohortAccounts) > .0001) return null;
    let conversion = null;
    if (value.conversion != null || metricAccountKeys.some(key => Object.hasOwn(value.totals, key))) {
      const raw = value.conversion;
      if (!metricAccountKeys.every(key => Number.isSafeInteger(value.totals[key]) && value.totals[key] >= 0) || !raw || typeof raw.definition !== 'string' || !raw.definition || raw.definition.length > 200 || !Number.isSafeInteger(raw.viewedAccounts) || !Number.isSafeInteger(raw.paidAfterViewAccounts) || raw.viewedAccounts < 0 || raw.paidAfterViewAccounts < 0 || raw.paidAfterViewAccounts > raw.viewedAccounts || raw.viewedAccounts !== value.totals.uniqueShopAccounts || raw.paidAfterViewAccounts !== value.totals.matchedPaidShopAccounts || raw.paidAfterViewAccounts > value.totals.uniquePaidAccounts || value.totals.uniqueShopAccounts > totals.shopViews || value.totals.uniqueCheckoutAccounts > totals.checkoutStarts) return null;
      if (raw.viewedAccounts === 0 ? raw.rate !== null : typeof raw.rate !== 'number' || !Number.isFinite(raw.rate) || raw.rate < 0 || raw.rate > 1 || Math.abs(raw.rate - raw.paidAfterViewAccounts / raw.viewedAccounts) > .0001) return null;
      Object.assign(totals, Object.fromEntries(metricAccountKeys.map(key => [key, value.totals[key]])));
      conversion = { definition: raw.definition, viewedAccounts: raw.viewedAccounts, paidAfterViewAccounts: raw.paidAfterViewAccounts, rate: raw.rate };
    }
    const revenue = value.revenue == null ? null : cleanRevenue(value.revenue), supporterRenewal = value.supporterRenewal == null ? null : cleanRenewal(value.supporterRenewal, value.toDay), playerRetention = value.playerRetention == null ? null : cleanPlayerRetention(value.playerRetention, value.toDay);
    if (value.revenue != null && !revenue || value.supporterRenewal != null && !supporterRenewal || value.playerRetention != null && !playerRetention) return null;
    return { days: value.days, fromDay: value.fromDay, toDay: value.toDay, daily, totals, conversion, revenue, supporterRenewal, playerRetention, retention: { definition: retention.definition, cohortAccounts: retention.cohortAccounts, returnedNextDay: retention.returnedNextDay, rate: retention.rate, throughDay: retention.throughDay } };
  }
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
    let stamp = '', generation = 0, readSequence = 0, metricsSequence = 0, disposed = false, writePromise = null;
    const empty = () => ({ ownerId: null, authorized: false, open: false, holds: [], nextCursor: null, serverNow: '', loaded: false, loading: false, loadingMore: false, selected: null, reason: '', confirmation: null, pending: null, sending: false, metrics: null, metricsDays: 60, metricsLoading: false, metricsError: '', error: '', status: '', change: 'init' });
    let state = empty();
    const snapshot = () => clone(state);
    const context = () => {
      const user = getUser(), value = getContext();
      return { ownerId: typeof user?.id === 'string' ? user.id : null, allowed: Boolean(user?.id && (user.isAdmin === true || user.isDeputy === true) && user.canOperate !== false && user.isBanned !== true && value), stamp: JSON.stringify([user?.id || null, user?.isAdmin === true, user?.isDeputy === true, user?.canOperate, user?.isBanned === true, value?.epoch ?? null, value?.privilegeEpoch ?? null]) };
    };
    function emit(change = 'status') { if (!disposed) { state.change = change; onChange(snapshot()); } }
    function reset(change = 'clear') {
      const who = context(); stamp = who.stamp; generation++; readSequence++; metricsSequence++; writePromise = null;
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
    async function loadMetrics(days = state.metricsDays) {
      if (!allowed() || state.metricsLoading || !metricPeriods.includes(days)) return false;
      const g = generation, owner = state.ownerId, seq = ++metricsSequence;
      state.metricsDays = days; state.metricsLoading = true; state.metricsError = ''; state.metrics = null; emit('metrics-loading');
      try {
        const result = await call('/admin/premium/metrics?days=' + days);
        if (!current(g, owner) || seq !== metricsSequence || !state.open) return false;
        const metrics = cleanMetrics(result);
        if (!metrics || metrics.days !== days) throw Error('計測データの形式を確認できません。更新してもう一度お試しください。');
        state.metrics = metrics; emit('metrics'); return true;
      } catch (error) {
        identity(); if (current(g, owner) && seq === metricsSequence && state.open && error.code !== 'STALE_IDENTITY') { state.metricsError = error.message || '計測データを取得できませんでした。'; emit('metrics-error'); } return false;
      } finally { if (current(g, owner) && seq === metricsSequence && state.open) { state.metricsLoading = false; emit(); } }
    }
    function close() { if (disposed) return; state.open = false; readSequence++; metricsSequence++; state.loading = state.loadingMore = state.metricsLoading = false; state.metrics = null; state.metricsError = ''; state.selected = null; state.reason = ''; state.confirmation = null; emit('close'); }
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
    return { getState() { identity(); return snapshot(); }, open, close, clear, dispose, refreshIdentity: identity, refresh: () => load(), loadMore: () => load({ more: true }), loadMetrics, select, setReason, prepare, back, cancelSelection, confirm, retry };
  }
  function revenueMarkup(value) {
    const title = '<h3>確認済み有効支払い合計</h3>';
    if (!value) return '<section class="premium-admin-measure">' + title + '<p class="premium-admin-note">この応答には支払額の集計が含まれていません。サーバーの対応後に指標を再取得してください。</p></section>';
    const number = n => n.toLocaleString('ja-JP');
    return '<section class="premium-admin-measure">' + title + '<div class="premium-admin-revenue-total"><strong>' + number(value.validAmount) + '円</strong><span>全商品・税込・手数料控除前</span></div><dl class="premium-admin-fraction"><div><dt>有効な支払い</dt><dd>' + number(value.validPayments) + '件</dd></div><div><dt>集計から除外</dt><dd>' + number(value.excludedPayments) + '件・' + number(value.excludedAmount) + '円</dd></div></dl><p>' + esc(value.definition) + '</p><p class="premium-admin-note">集計日：' + esc(value.dateBasis) + '。返金・取消・確認保留などの決済は、決済全額を有効額から除きます。除外額は実際の返金額ではありません。手数料、精算、入金の状況は含みません。</p>' + (value.unclassifiedExcludedPayments || value.unclassifiedExcludedAmount ? '<p class="premium-admin-note">商品を特定できない除外分：' + number(value.unclassifiedExcludedPayments) + '件・' + number(value.unclassifiedExcludedAmount) + '円。この分は合計の除外額に含み、商品別には割り当てていません。</p>' : '') + '<details><summary>全商品の内訳</summary><dl class="premium-admin-revenue-products">' + value.byProduct.map(row => '<div><dt>' + esc(metricProducts[row.productId]) + '</dt><dd><strong>' + number(row.validAmount) + '円</strong><span>有効 ' + number(row.validPayments) + '件</span></dd><dd><span>除外 ' + number(row.excludedPayments) + '件・' + number(row.excludedAmount) + '円</span></dd></div>').join('') + '</dl></details></section>';
  }
  function renewalMarkup(value) {
    const title = '<h3>サポーターの翌期間更新率</h3>';
    if (!value) return '<section class="premium-admin-measure">' + title + '<p class="premium-admin-note">この応答には更新率の集計が含まれていません。サーバーの対応後に指標を再取得してください。</p></section>';
    const number = n => n.toLocaleString('ja-JP');
    return '<section class="premium-admin-measure">' + title + '<p class="premium-admin-metric-rate">' + (value.rate === null ? '未観測（終了後7日の判定を終えた対象期間なし）' : (value.rate * 100).toFixed(1) + '％') + '</p><dl class="premium-admin-fraction"><div><dt>翌期間の支払い確認（分子）</dt><dd>' + number(value.renewedPeriods) + '期間</dd></div><div><dt>判定済みの有効支払期間（分母）</dt><dd>' + number(value.eligiblePeriods) + '期間</dd></div></dl><p>' + esc(value.definition) + '</p><p class="premium-admin-note">観測開始：' + (value.observedSince ? esc(date(value.observedSince)) + '（日本時間）' : 'まだ支払い確認の記録がありません') + '。</p><p class="premium-admin-note">計測開始以降、選択した集計期間内に終了し、終了後' + value.graceDays + '日まで観測できた支払期間が対象です。同じ契約の次の連続期間への支払いを、前期間終了から' + value.graceDays + '日後まで確認します。対象は' + esc(value.throughDay) + 'までに終了した期間です。人数ではなく支払期間ごとに数え、通常の解約・未更新も判定済み対象に含めます。</p></section>';
  }
  function playerRetentionMarkup(value, days) {
    const title = '<h3>登録領主のゲーム接続・再訪率</h3>';
    if (!value) return '<section class="premium-admin-measure">' + title + '<p class="premium-admin-note">この応答にはゲーム接続の再訪率が含まれていません。ログイン報酬の受取率とは別の指標です。</p></section>';
    const number = n => n.toLocaleString('ja-JP'), cards = [];
    for (const segment of value.segments) for (const [key, label] of [['d1', '翌日'], ['d30', '30日後']]) {
      const period = segment[key], waiting = segment.observedAccounts - period.eligibleAccounts;
      const rate = period.rate === null ? '未観測（' + (segment.observedAccounts ? '経過日数の判定待ち' : '対象の初回接続記録なし') + '）' : (period.rate * 100).toFixed(1) + '％';
      cards.push('<section class="premium-admin-cohort"><h4>' + esc(segment.label) + '・' + label + '</h4><p class="premium-admin-metric-rate' + (period.rate === null ? ' is-unobserved' : '') + '">' + rate + '</p><dl class="premium-admin-fraction"><div><dt>再訪（分子）</dt><dd>' + number(period.returnedAccounts) + 'アカウント</dd></div><div><dt>判定済み（分母）</dt><dd>' + number(period.eligibleAccounts) + 'アカウント</dd></div></dl><p>期間内の初回観測 ' + number(segment.observedAccounts) + 'アカウント · 経過日数待ち ' + number(waiting) + 'アカウント</p><p>' + esc(period.throughDay) + 'までの初回観測者が判定対象です。</p></section>');
    }
    return '<section class="premium-admin-measure">' + title + '<p>' + esc(value.definition) + '</p><p class="premium-admin-note">観測開始：' + (value.observedSince ? esc(date(value.observedSince)) + '（日本時間）' : 'まだ接続の記録がありません') + '。日本時間05:00区切り。未登録・未接続・オフラインのプレイは含みません。</p>' + (days <= 30 ? '<p class="premium-admin-note">30日後の判定を含めるには、集計期間を「直近60日」または「直近90日」にしてください。</p>' : '') + '<div class="premium-admin-cohort-grid">' + cards.join('') + '</div><details><summary>無料・課金の区分と計算対象</summary><p class="premium-admin-note">起点：' + esc(value.cohortBasis) + '。集計期間内に初めて観測した登録領主を対象に、翌日または30日後の1日が終了したアカウントだけで計算します。その該当日にゲーム接続を確認したアカウントが再訪者です。計測開始前から遊んでいた領主も含み、新規登録日の集計ではありません。</p><p class="premium-admin-note">初回観測時点で確認済みの有効な支払履歴がある領主を「課金」、ない領主を「無料」に固定します。その後の課金・返金で区分を変更しません。率は別々の集団の観測結果であり、課金による効果を直接示すものではありません。</p></details></section>';
  }
  function metricsMarkup(state) {
    if (state.metricsLoading) return '<p class="premium-admin-note" role="status">実際に記録された計測データを取得しています…</p>';
    if (state.metricsError) return '<p class="premium-admin-metrics-error" role="alert">' + esc(state.metricsError) + '</p>';
    if (!state.metrics) return '<p class="premium-admin-note">まだ取得していません。「指標を確認」を押すと、選んだ期間の記録を表示します。30日後の再訪は、観測が完了した領主だけで計算します。</p>';
    const value = state.metrics, counts = value.totals, number = value => value.toLocaleString('ja-JP');
    const transition = counts.shopViews ? (counts.checkoutStarts / counts.shopViews * 100).toFixed(1) + '％' : '算出できません（閲覧記録なし）';
    const rows = [['店舗表示', counts.shopViews, 'イベント'], ['購入手続き開始', counts.checkoutStarts, 'イベント'], ['再抽選パスの購入確認', counts.fulfilledPasses, '件'], ['サポーターの支払済み期間', counts.paidSupporterPeriods, '件'], ['ログイン報酬を受け取った領主', counts.loginClaimAccounts, 'アカウント'], ['ログイン報酬の受け取り', counts.loginClaims, '回']];
    if (value.conversion) rows.unshift(['店舗を閲覧した領主', counts.uniqueShopAccounts, 'アカウント'], ['購入手続きを始めた領主', counts.uniqueCheckoutAccounts, 'アカウント'], ['支払いを確認した領主', counts.uniquePaidAccounts, 'アカウント']);
    const conversion = value.conversion;
    const conversionHTML = '<h3>ショップ閲覧後の支払い確認率</h3>' + (conversion ? '<p>' + esc(conversion.definition) + '</p><p class="premium-admin-metric-rate">' + (conversion.rate === null ? '算出できません（閲覧した領主の記録なし）' : (conversion.rate * 100).toFixed(1) + '％') + '</p><p>閲覧した ' + number(conversion.viewedAccounts) + ' アカウントのうち、閲覧後に支払いを確認した領主 ' + number(conversion.paidAfterViewAccounts) + ' アカウント。同じ領主の複数回の閲覧・購入はそれぞれ1アカウントとして数えます。</p><p>対象は同じ集計期間内の閲覧と有効な支払い確認です。外観商品・パスの購入、サポーターの初回・更新支払いを含みます。未登録の利用者や、期間後に成立した支払いは含みません。</p>' : '<p class="premium-admin-note">この応答には、領主ごとの閲覧・支払い確認率のデータが含まれていません。指標を再取得してください。</p>');
    const retention = value.retention;
    return '<p class="premium-admin-note">店舗の操作は、接続中の登録領主によるゲーム内ショップの記録です。公開ページや未登録での閲覧は含みません。</p><p class="premium-admin-note">集計期間：' + esc(value.fromDay) + ' 〜 ' + esc(value.toDay) + '（各日05:00〜翌05:00・日本時間）</p>' + revenueMarkup(value.revenue) + renewalMarkup(value.supporterRenewal) + playerRetentionMarkup(value.playerRetention, value.days) + '<dl class="premium-admin-metrics-grid">' + rows.map(([label, count, unit]) => '<div><dt>' + label + '</dt><dd><strong>' + number(count) + '</strong><span>' + unit + '</span></dd></div>').join('') + '</dl><div class="premium-admin-metrics-explanation">' + conversionHTML + '<h3>購入手続き開始 / 店舗表示</h3><p class="premium-admin-metric-rate">' + transition + '</p><p>イベント件数の比率です。同じ領主の複数商品・複数日の操作を含み、人数ベースの購入率ではありません。支払い件数は有効な決済確認済みの記録で、返金などによる失効分を除きます。サポーターの更新支払いも含みます。</p><h3>翌日のログイン報酬受け取り</h3><p>' + esc(retention.definition) + '</p><p class="premium-admin-metric-rate">' + (retention.rate === null ? '翌日まで観測を終えた対象者がまだいません' : (retention.rate * 100).toFixed(1) + '％') + '</p><p>初回受取者 ' + number(retention.cohortAccounts) + ' アカウントのうち、翌日も受け取った領主 ' + number(retention.returnedNextDay) + ' アカウント。' + esc(retention.throughDay) + ' までの初回受取者を対象とし、翌日の観測が終わっていない領主は分母に含みません。通常のゲーム利用全体の継続率ではありません。</p></div><details class="premium-admin-daily"><summary>日別の記録を見る</summary><div class="premium-admin-metrics-table-wrap"><table><caption>日別件数・各日05:00切替</caption><thead><tr><th scope="col">日付</th><th scope="col">店舗表示</th><th scope="col">手続き開始</th><th scope="col">パス購入</th><th scope="col">支援期間</th><th scope="col">報酬受取者</th><th scope="col">受取回数</th></tr></thead><tbody>' + value.daily.map(row => '<tr><th scope="row">' + esc(row.day) + '</th>' + metricKeys.map(key => '<td>' + number(row[key]) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div><p class="premium-admin-note">期間の受取者数は重複を除いたアカウント数です。日別受取者数の合計とは一致しない場合があります。</p></details>';
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
      for (const selector of ['[data-admin-holds]', '[data-admin-editor]', '[data-admin-confirm]', '[data-admin-pending]', '[data-admin-metrics]']) setHTML($(selector), '');
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
      $('[data-premium-admin="metrics"]').disabled = state.metricsLoading;
      const period = $('#premium-admin-metrics-period'); period.disabled = state.metricsLoading; if (period.value !== String(state.metricsDays)) period.value = String(state.metricsDays);
      setHTML($('[data-admin-metrics]'), metricsMarkup(state));
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
      dialog.innerHTML = '<header class="premium-admin-header"><div><span class="premium-admin-label">運営専用</span><h1 id="premium-admin-title" tabindex="-1">購入保留・利用指標</h1></div><button type="button" class="premium-admin-button" data-premium-admin="close">閉じる</button></header><div class="premium-admin-main"><div class="premium-admin-intro"><p>Stripeで確認が必要な購入保留です。決済IDとイベントIDを照合し、確認した内容を残してから解除します。</p><button type="button" class="premium-admin-button" data-premium-admin="refresh">一覧を更新</button></div><details class="premium-admin-metrics"><summary>支払額・継続・利用の指標</summary><div class="premium-admin-metrics-heading"><h2>実際の利用記録</h2><label class="premium-admin-period" for="premium-admin-metrics-period">集計期間<select id="premium-admin-metrics-period"><option value="14">直近14日</option><option value="30">直近30日</option><option value="60" selected>直近60日</option><option value="90">直近90日</option></select></label><button type="button" class="premium-admin-button" data-premium-admin="metrics">指標を確認</button></div><div data-admin-metrics></div></details><p class="premium-admin-feedback" data-admin-feedback role="status" aria-live="polite" hidden></p><section class="premium-admin-pending" data-admin-pending hidden></section><div data-admin-holds></div><section class="premium-admin-editor" data-admin-editor hidden></section><section class="premium-admin-confirm" data-admin-confirm hidden></section><div class="premium-admin-more"><button type="button" class="premium-admin-button" data-premium-admin="more" hidden>続きを表示</button></div></div><footer class="premium-admin-footer">運営本人だけが利用できます · 日時は日本標準時（JST）</footer>';
      doc.body.append(dialog);
      dialog.addEventListener('click', event => {
        const button = event.target.closest?.('[data-premium-admin]'); if (!button || button.disabled) return;
        const action = button.getAttribute('data-premium-admin');
        if (action === 'close') controller.close();
        else if (action === 'refresh') controller.refresh();
        else if (action === 'more') controller.loadMore();
        else if (action === 'metrics') controller.loadMetrics();
        else if (action === 'select') controller.select(button.getAttribute('data-hold-key'));
        else if (action === 'cancel-selection') controller.cancelSelection();
        else if (action === 'back') controller.back();
        else if (action === 'confirm') controller.confirm();
        else if (action === 'retry') controller.retry();
      });
      dialog.addEventListener('change', event => { if (event.target.id === 'premium-admin-metrics-period') controller.loadMetrics(Number(event.target.value)); });
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
  if (typeof module !== 'undefined' && module.exports) module.exports = { createController, createUI, cleanHold, cleanMetrics, holdMarkup, confirmationMarkup, metricsMarkup };
})(typeof window !== 'undefined' ? window : globalThis);
