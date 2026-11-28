/* Paid products are read from the authenticated service, never a game save.
 * This adapter deliberately keeps entitlement state in memory only. */
(function (global) {
  'use strict';
  const slots = Object.freeze({ 'gold-banner': 'nameplate', 'moonlit-castle': 'town', supporter: 'badge', 'vermilion-banner': 'nameplate', 'silver-banner': 'nameplate', 'phoenix-medallion': 'badge', 'sakura-town': 'town', 'snow-town': 'town', 'castle-heritage': 'town' });
  const passId = 'reroll-pass-30d';
  const productIds = Object.freeze([...Object.keys(slots), passId]);
  const rewardId = value => typeof value === 'string' && /^supporter-(20\d{2}(?:0[1-9]|1[0-2]))-(flower|moon|star)$/.test(value);
  const slotFor = id => slots[id] || (rewardId(id) ? 'nameplate' : null);
  const productLabels = Object.freeze({ 'gold-banner': '金彩の旗印を所有', 'moonlit-castle': '月影の城下を所有', supporter: '戦国VSサポーター（有効）', 'vermilion-banner': '紅蓮の旗印を所有', 'silver-banner': '白銀の旗印を所有', 'phoenix-medallion': '鳳凰の勲章を所有', 'sakura-town': '桜雲の城下を所有', 'snow-town': '雪華の城下を所有', 'castle-heritage': '名城絵巻・全城対応を所有' });
  const assets = Object.freeze({
    town: 'assets/premium/moonlit-castle-v1.webp',
    banner: 'assets/premium/gold-banner-v1.webp',
    badge: 'assets/premium/supporter-badge-v1.webp'
  });
  const emptyAppearance = () => ({ nameplate: null, town: null, badge: null, ownedProducts: [] });
  const cleanAppearance = value => ({
    nameplate: slotFor(value?.nameplate) === 'nameplate' ? value.nameplate : null,
    town: slots[value?.town] === 'town' ? value.town : null,
    badge: slots[value?.badge] === 'badge' ? value.badge : null,
    ownedProducts: [...Object.keys(slots).filter(id => Array.isArray(value?.ownedProducts) && value.ownedProducts.includes(id)), ...[...new Set(Array.isArray(value?.ownedProducts) ? value.ownedProducts.filter(rewardId) : [])].sort()]
  });
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function publicEvaluation(value) {
    if (!value || value.version !== 1 || !Number.isSafeInteger(value.score) || value.score < 0 || value.score > 100000 || value.maxScore !== 100000 || !Number.isSafeInteger(value.rankIndex) || value.rankIndex < 0 || value.rankIndex >= 17 || typeof value.rankId !== 'string' || !value.rankId || value.rankId.length > 64 || typeof value.rankName !== 'string' || !value.rankName.trim() || value.rankName.length > 32) return null;
    return { version: 1, score: value.score, maxScore: 100000, rankIndex: value.rankIndex, rankId: value.rankId, rankName: value.rankName };
  }
  function publicUser(value) {
    return value && typeof value.id === 'string' ? { id: value.id, name: String(value.name || '領主'), avatarVersion: typeof value.avatarVersion === 'string' && /^[a-f0-9]{64}$/.test(value.avatarVersion) ? value.avatarVersion : null, evaluation: publicEvaluation(value.evaluation) } : null;
  }
  function isoTime(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return NaN;
    const time = Date.parse(value);
    return Number.isFinite(time) && new Date(time).toISOString() === (value.includes('.') ? value : value.replace('Z', '.000Z')) ? time : NaN;
  }
  function cleanSupporterRewards(value) {
    const seen = new Set();
    const periods = (Array.isArray(value?.periods) ? value.periods : []).flatMap(period => {
      if (typeof period?.periodId !== 'string' || !/^srp_[A-Za-z0-9_-]{1,100}$/.test(period.periodId) || seen.has(period.periodId) || !/^20\d{2}(?:0[1-9]|1[0-2])$/.test(period.periodKey || '') || !Number.isFinite(isoTime(period.startsAt)) || !Number.isFinite(isoTime(period.endsAt)) || Date.parse(period.endsAt) <= Date.parse(period.startsAt)) return [];
      const choices = [...new Set((Array.isArray(period.choices) ? period.choices : []).filter(id => rewardId(id) && id.startsWith('supporter-' + period.periodKey + '-')))];
      if (!choices.length || period.claimedProductId != null && !choices.includes(period.claimedProductId)) return [];
      seen.add(period.periodId);
      return [{ periodId: period.periodId, periodKey: period.periodKey, startsAt: period.startsAt, endsAt: period.endsAt, claimedProductId: period.claimedProductId || null, choices }];
    });
    return { periods };
  }
  function cleanRerollPass(value, owned, now) {
    if (!value || value.dailyLimit !== 3 || !Number.isSafeInteger(value.usedToday) || value.usedToday < 0 || value.usedToday > 3 || !Number.isSafeInteger(value.remainingToday) || value.remainingToday < 0 || value.remainingToday > 3 || !Number.isFinite(isoTime(value.nextResetAt))) return null;
    const expiresAt = Number.isFinite(isoTime(value.expiresAt)) ? value.expiresAt : null;
    const active = owned === true && value.active === true && expiresAt !== null && Date.parse(expiresAt) > now;
    if (active && value.usedToday + value.remainingToday !== 3) return null;
    return { active, expiresAt, dailyLimit: 3, usedToday: value.usedToday, remainingToday: active ? value.remainingToday : 0, nextResetAt: value.nextResetAt, countsVerified: Date.parse(value.nextResetAt) > now };
  }
  function createRuntime(options = {}) {
    const social = () => options.social || global.SengokuSocial;
    const monotonic = options.now || (() => global.performance?.now?.() ?? Date.now());
    const subscribers = new Set();
    const choiceRequests = new Map();
    let identity = '', generation = 0, pending = null, mutation = false, disposed = false;
    let timer = null, expiryTimer = null, serverTime = 0, receivedAt = 0;
    let context = initial('anonymous');

    function initial(status, user = null, error = '') {
      return { status, user, ready: false, products: [], appearance: emptyAppearance(), supporterRewards: { periods: [] }, rerollPass: null, portalUrl: '', serverNow: null, error };
    }
    function currentIdentity() {
      const value = social()?.getPremiumContext?.() || {};
      const user = publicUser(value.user);
      return { key: `${value.epoch ?? 0}:${value.playerId || user?.id || ''}`, user, banned: value.banned === true, connected: value.connected === true, pending: value.pending === true };
    }
    function safePortal(value) {
      try { const u = new URL(value); return u.protocol === 'https:' && u.hostname === 'billing.stripe.com' && !u.username && !u.password ? u.href : ''; } catch (_) { return ''; }
    }
    function elapsedServerTime() { return serverTime + Math.max(0, monotonic() - receivedAt); }
    function snapshot() {
      const result = { ...context, user: publicUser(context.user), products: context.products.map(item => ({ ...item })), appearance: cleanAppearance(context.appearance), supporterRewards: cleanSupporterRewards(context.supporterRewards), rerollPass: context.rerollPass ? { ...context.rerollPass } : null };
      if (result.status === 'ready') {
        for (const product of result.products) {
          if (product.expiresAt && Date.parse(product.expiresAt) <= elapsedServerTime()) {
            product.owned = false; product.equipped = false;
            product.canPurchase = false; // Recheck server subscription status before another checkout.
            if (result.appearance[slotFor(product.id)] === product.id) result.appearance[slotFor(product.id)] = null;
            result.appearance.ownedProducts = result.appearance.ownedProducts.filter(id => id !== product.id);
          }
        }
        if (result.rerollPass) {
          if (Date.parse(result.rerollPass.expiresAt) <= elapsedServerTime()) { result.rerollPass.active = false; result.rerollPass.remainingToday = 0; }
          if (Date.parse(result.rerollPass.nextResetAt) <= elapsedServerTime()) result.rerollPass.countsVerified = false;
        }
      }
      return result;
    }
    function notify() {
      const value = snapshot();
      if (value.user) social()?.acceptPremiumAppearance?.(value.user.id, value.appearance);
      for (const listener of subscribers) { try { listener(value); } catch (_) {} }
      options.onChange?.(value);
      if (!options.social) global.SengokuBridge?.refreshPremiumAppearance?.();
    }
    function schedule() {
      if (options.noTimers || disposed) return;
      clearTimeout(timer); clearTimeout(expiryTimer);
      if (context.user && !global.document?.hidden) timer = setTimeout(() => { refresh().catch(() => {}); }, 30000);
      const expiry = context.products.filter(p => p.owned && p.expiresAt).map(p => Date.parse(p.expiresAt) - elapsedServerTime()).filter(t => t > 0);
      if (context.rerollPass?.active && Date.parse(context.rerollPass.nextResetAt) > elapsedServerTime()) expiry.push(Date.parse(context.rerollPass.nextResetAt) - elapsedServerTime());
      if (expiry.length) expiryTimer = setTimeout(() => { notify(); refresh().catch(() => {}); }, Math.min(...expiry, 2147483000) + 10);
    }
    function ensureIdentity() {
      const who = currentIdentity();
      if (who.key !== identity || who.banned && context.status !== 'banned' || !who.user && context.user) {
        identity = who.key; generation++; pending = null; mutation = false; choiceRequests.clear();
        context = initial(who.banned ? 'banned' : who.user || who.pending ? 'loading' : 'anonymous', who.user);
        serverTime = 0; receivedAt = monotonic();
        notify(); schedule();
      }
      if (context.status === 'ready' && !who.connected) {
        generation++; pending = null; mutation = false;
        context = initial('offline', who.user, '通信に接続できません。接続を確認して購入状況を更新してください。');
        notify(); schedule();
      }
      return who;
    }
    function receive(result, who) {
      if (!result || result.ok !== true || String(result.player?.id || '') !== who.user?.id || !Array.isArray(result.products) || result.products.length !== productIds.length || !Number.isFinite(isoTime(result.serverNow))) throw Error('購入状況の応答を確認できません。もう一度更新してください。');
      const now = isoTime(result.serverNow), seen = new Set();
      const products = result.products.filter(p => productIds.includes(p?.id) && !seen.has(p.id) && seen.add(p.id)).map(p => {
        const timed = p.id === 'supporter' || p.id === passId;
        const expiresAt = timed && Number.isFinite(isoTime(p.expiresAt)) ? new Date(p.expiresAt).toISOString() : null;
        const owned = p.owned === true && (!timed || expiresAt !== null && Date.parse(expiresAt) > now);
        return { id: p.id, owned, equipped: Boolean(slotFor(p.id)) && owned && p.equipped === true, expiresAt, canPurchase: result.ready === true && p.canPurchase === true && !owned, purchaseBlockReason: typeof p.purchaseBlockReason === 'string' ? p.purchaseBlockReason : '', reason: typeof p.reason === 'string' ? p.reason : '' };
      });
      if (products.length !== productIds.length) throw Error('商品情報を確認できません。もう一度更新してください。');
      const appearance = cleanAppearance(result.appearance);
      appearance.ownedProducts = [...Object.keys(slots).filter(id => products.some(p => p.id === id && p.owned)), ...appearance.ownedProducts.filter(rewardId)];
      for (const slot of ['nameplate', 'town', 'badge']) if (!(rewardId(appearance[slot]) && appearance.ownedProducts.includes(appearance[slot])) && !products.some(p => p.id === appearance[slot] && p.owned && p.equipped)) appearance[slot] = null;
      serverTime = now; receivedAt = monotonic();
      context = { status: 'ready', user: publicUser({ ...who.user, ...result.player, id: who.user.id, name: String(result.player.name || who.user.name) }), ready: result.ready === true, products, appearance, supporterRewards: cleanSupporterRewards(result.supporterRewards), rerollPass: cleanRerollPass(result.rerollPass, products.find(p => p.id === passId)?.owned, now), portalUrl: safePortal(result.portalUrl), serverNow: result.serverNow, error: result.ready === true ? '' : '購入機能を準備しています。時間をおいて更新してください。' };
      notify(); schedule(); return snapshot();
    }
    async function refresh() {
      if (disposed) return snapshot();
      const who = ensureIdentity();
      if (who.banned || !who.user) {
        context = initial(who.banned ? 'banned' : who.pending ? 'loading' : 'anonymous', who.user);
        notify(); schedule(); return snapshot();
      }
      if (mutation) return snapshot();
      if (pending) return pending;
      const ownGeneration = ++generation, ownIdentity = identity;
      const current = () => !disposed && ownIdentity === currentIdentity().key && ownGeneration === generation;
      pending = (async () => {
        try {
          const result = await social().premiumRequest('/premium?catalog=5');
          if (!current()) return snapshot();
          return receive(result, who);
        } catch (error) {
          if (!current()) return snapshot();
          context = initial(error.code === 'ACCOUNT_BANNED' ? 'banned' : 'offline', who.user, error.message || '購入状況を確認できません。接続を確認して更新してください。');
          notify(); schedule(); return snapshot();
        } finally { if (current()) pending = null; }
      })();
      return pending;
    }
    function requireReady(productId, checkPurchase) {
      const who = ensureIdentity(), value = snapshot(), product = value.products.find(p => p.id === productId) || (!checkPurchase && rewardId(productId) && value.appearance.ownedProducts.includes(productId) ? { owned: true } : null);
      if (!who.user || !who.connected || value.status !== 'ready' || value.user?.id !== who.user.id || !value.ready) throw Error('接続中の領主と購入状況を更新してください。');
      if (!product || checkPurchase && !product.canPurchase || !checkPurchase && !product.owned) throw Error(checkPurchase ? 'この商品は購入済み、または購入状況の確認待ちです。' : 'この外観はまだ使用できません。購入状況を更新してください。');
      if (mutation) throw Error('前の操作を確認しています。少しお待ちください。');
      return who;
    }
    async function checkout(productId) {
      const who = requireReady(productId, true), catalog = options.catalog || global.SengokuPremiumCatalog;
      if (typeof catalog?.checkoutURL !== 'function') throw Error('購入先の設定を確認できません。');
      const ownIdentity = identity, ownGeneration = ++generation; pending = null; mutation = true;
      try {
        const result = await social().premiumRequest('/premium/checkout', { method: 'POST', data: { productId } });
        if (disposed || ownIdentity !== currentIdentity().key || ownGeneration !== generation) throw Error('接続する領主が変わりました。購入画面を開き直してください。');
        const url = catalog.checkoutURL(productId, result.url);
        if (result.ok !== true || result.productId !== productId || typeof url !== 'string' || !url) throw Error('購入先を確認できません。もう一度お試しください。');
        return { url, productId, playerId: who.user.id };
      } catch (error) {
        if (!disposed && ownIdentity === currentIdentity().key && ownGeneration === generation) { context = initial('offline', who.user, error.message || '購入先を確認できません。'); notify(); }
        throw error;
      } finally { if (ownGeneration === generation) { mutation = false; schedule(); } }
    }
    async function equip(productId, slot = slotFor(productId)) {
      if (!['nameplate', 'town', 'badge'].includes(slot) || productId !== null && slotFor(productId) !== slot) throw Error('変更する外観を選んでください。');
      const target = productId || snapshot().appearance[slot] || snapshot().appearance.ownedProducts.find(id => slotFor(id) === slot), who = requireReady(target, false);
      const ownIdentity = identity, ownGeneration = ++generation; pending = null; mutation = true;
      try {
        const result = await social().premiumRequest('/premium/appearance?catalog=5', { method: 'PUT', data: { slot, productId } });
        if (disposed || ownIdentity !== currentIdentity().key || ownGeneration !== generation) throw Error('接続する領主が変わりました。外観を確認し直してください。');
        return receive(result, who);
      } catch (error) {
        if (!disposed && ownIdentity === currentIdentity().key && ownGeneration === generation) { context = initial('offline', who.user, error.message || '外観を確認できません。'); notify(); }
        throw error;
      } finally { if (ownGeneration === generation) { mutation = false; schedule(); } }
    }
    async function claimSupporterReward(periodId, productId) {
      const who = ensureIdentity(), value = snapshot();
      const period = value.supporterRewards.periods.find(item => item.periodId === periodId);
      if (!who.user || !who.connected || value.status !== 'ready' || !value.ready || value.user?.id !== who.user.id) throw Error('接続中の領主と購入状況を更新してください。');
      if (mutation) throw Error('前の操作を確認しています。少しお待ちください。');
      if (!period || period.claimedProductId || !period.choices.includes(productId)) throw Error('この支払い期間で受け取れる外観を確認してください。');
      const key = periodId + ':' + productId;
      if (!choiceRequests.has(key)) {
        const requestId = String(options.uuid?.() || global.crypto?.randomUUID?.() || '');
        if (!/^[A-Za-z0-9_-]{1,90}$/.test(requestId)) throw Error('受け取りの送信番号を作成できません。画面を開き直してください。');
        choiceRequests.set(key, requestId);
      }
      const requestId = choiceRequests.get(key), ownIdentity = identity, ownGeneration = ++generation;
      pending = null; mutation = true;
      try {
        const result = await social().premiumRequest('/premium/supporter-choice?catalog=5', { method: 'POST', data: { periodId, productId, requestId } });
        if (disposed || ownIdentity !== currentIdentity().key || ownGeneration !== generation) throw Error('接続する領主が変わりました。受け取り状況を確認し直してください。');
        const confirmed = cleanSupporterRewards(result?.supporterRewards).periods.find(item => item.periodId === periodId);
        if (confirmed?.claimedProductId !== productId || !cleanAppearance(result?.appearance).ownedProducts.includes(productId)) throw Error('外観の受け取りを確認できません。購入状態を再確認してください。');
        const received = receive(result, who); choiceRequests.delete(key); return received;
      } catch (error) {
        if (!disposed && ownIdentity === currentIdentity().key && ownGeneration === generation) { context = initial('offline', who.user, error.message || '外観の受け取りを確認できません。'); notify(); }
        throw error;
      } finally { if (ownGeneration === generation) { mutation = false; schedule(); } }
    }
    async function trackEvent(event, productId) {
      const who = ensureIdentity(), owner = identity;
      if (disposed || !who.user || !who.connected || who.banned || !['shop_view', 'checkout_start'].includes(event) || productId != null && !productIds.includes(productId)) return false;
      try {
        const result = await social().premiumRequest('/premium/events', { method: 'POST', data: { event, ...(productId ? { productId } : {}) } });
        return !disposed && owner === currentIdentity().key && result?.ok === true;
      } catch (_) { return false; }
    }
    function refreshIdentity() { ensureIdentity(); return refresh(); }
    function disconnect() {
      const who = currentIdentity(); generation++; pending = null; mutation = false;
      context = initial(who.banned ? 'banned' : who.user ? 'offline' : 'anonymous', who.user, who.user ? '通信に接続できません。接続を確認して購入状況を更新してください。' : '');
      notify(); schedule();
    }
    function subscribe(listener) { if (typeof listener !== 'function') return () => {}; subscribers.add(listener); listener(snapshot()); return () => subscribers.delete(listener); }
    function dispose() { disposed = true; generation++; clearTimeout(timer); clearTimeout(expiryTimer); subscribers.clear(); choiceRequests.clear(); context = initial('anonymous'); }
    return { getContext: () => { ensureIdentity(); return snapshot(); }, getAppearance: () => { ensureIdentity(); return snapshot().appearance; }, refresh, refreshIdentity, subscribe, checkout, equip, claimSupporterReward, trackEvent, disconnect, dispose, openRegistration: () => social()?.open?.('profile') };
  }
  function productAsset(id) {
    if (rewardId(id)) return 'assets/premium/supporter-' + id.slice(14, 16) + '-' + id.split('-')[2] + '-v1.svg';
    const extra = { 'vermilion-banner': 'assets/premium/vermilion-banner-v1.svg', 'silver-banner': 'assets/premium/silver-banner-v1.svg', 'phoenix-medallion': 'assets/premium/phoenix-medallion-v1.svg', 'sakura-town': 'assets/premium/sakura-town-v1.webp', 'snow-town': 'assets/premium/snow-town-v1.webp', 'castle-heritage': 'assets/castle-scenes/himeji-400.webp' };
    return ({ 'gold-banner': assets.banner, 'moonlit-castle': assets.town, supporter: assets.badge })[id] || extra[id] || '';
  }
  function productLabel(id) {
    if (productLabels[id]) return productLabels[id];
    const product = rewardId(id) ? global.SengokuPremiumCatalog?.getProduct?.(id) : null;
    return product?.name ? product.name + 'を永久所持' : rewardId(id) ? id.slice(10, 14) + '年' + Number(id.slice(14, 16)) + '月の支援特典を永久所持' : '';
  }
  function paletteStyle(id) {
    const palette = rewardId(id) ? global.SengokuPremiumCatalog?.getProduct?.(id)?.palette : null;
    return ['background', 'border', 'accent', 'text'].map(key => typeof palette?.[key] === 'string' && /^#[a-fA-F0-9]{6}$/.test(palette[key]) ? '--supporter-' + key + ':' + palette[key] : '').filter(Boolean).join(';');
  }
  function nameMarkup(name, appearance) {
    const a = cleanAppearance(appearance);
    const owned = a.ownedProducts.map(id => `<span class="sengoku-owned-product is-${id}${rewardId(id) ? ' is-supporter-reward' : ''}${a[slotFor(id)] === id ? ' is-equipped' : ''}" data-premium-product="${id}" role="img" aria-label="${esc(productLabel(id))}" title="${esc(productLabel(id))}"><img src="${productAsset(id)}" alt="" aria-hidden="true" width="26" height="26" decoding="async" draggable="false"></span>`).join('');
    return `<span class="sengoku-premium-name${a.nameplate ? ' is-gilded is-' + a.nameplate : ''}${rewardId(a.nameplate) ? ' is-supporter-reward' : ''}"${paletteStyle(a.nameplate) ? ` style="${paletteStyle(a.nameplate)}"` : ''}>${a.nameplate ? `<img class="sengoku-premium-name-flag" src="${productAsset(a.nameplate)}" alt="" width="20" height="30" decoding="async">` : ''}<span class="sengoku-premium-name-text">${esc(name)}</span>${owned ? `<span class="sengoku-owned-products">${owned}</span>` : ''}${a.badge && !a.ownedProducts.includes(a.badge) ? `<img class="sengoku-supporter-badge" src="${productAsset(a.badge)}" alt="${esc(productLabel(a.badge))}" title="${esc(productLabel(a.badge))}" width="32" height="32" decoding="async">` : ''}</span>`;
  }
  function ownershipLabel(appearance) { return cleanAppearance(appearance).ownedProducts.map(productLabel).join('・'); }
  const runtime = createRuntime();
  global.SengokuPremiumRuntime = Object.assign(runtime, { assets, cleanAppearance, nameMarkup, ownershipLabel, productAsset });
  if (typeof module !== 'undefined' && module.exports) module.exports = { createRuntime, cleanAppearance, cleanSupporterRewards, cleanRerollPass, nameMarkup, ownershipLabel, productAsset, assets };
  if (global.document) {
    const resume = () => { if (!global.document.hidden) runtime.refresh().catch(() => {}); };
    const start = () => {
      resume();
      const productId = new URLSearchParams(global.location?.search || '').get('premium');
      if (productIds.includes(productId)) global.SengokuPremium?.open?.(productId);
    };
    global.addEventListener?.('focus', resume);
    global.addEventListener?.('online', resume);
    global.addEventListener?.('offline', () => runtime.disconnect());
    global.document.addEventListener('visibilitychange', resume);
    if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
  }
})(typeof window !== 'undefined' ? window : globalThis);
