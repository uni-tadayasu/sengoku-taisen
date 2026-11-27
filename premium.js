/* Shared storefront and account UI. Preview state never grants an entitlement. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    const ui = api.createUI();
    root.SengokuPremium = Object.assign(ui, { renderCatalog: api.renderCatalog });
    const start = () => ui.mount(root.document);
    if (root.document?.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
  }
})(typeof window !== 'undefined' ? window : globalThis, function (global) {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const text = (value, maximum = 1000) => typeof value === 'string' ? value.slice(0, maximum) : '';
  const slots = { 'gold-banner': 'nameplate', 'moonlit-castle': 'town', supporter: 'badge', 'vermilion-banner': 'nameplate', 'silver-banner': 'nameplate', 'phoenix-medallion': 'badge', 'sakura-town': 'town', 'snow-town': 'town' };
  const passId = 'reroll-pass-30d';
  const ids = [...Object.keys(slots), passId];
  const isReward = value => typeof value === 'string' && /^supporter-20\d{2}(?:0[1-9]|1[0-2])-(flower|moon|star)$/.test(value);
  const slotFor = id => slots[id] || (isReward(id) ? 'nameplate' : id === passId ? 'pass' : '');
  const standardTownImage = 'assets/responsive/castle-town-raden-1536.webp';
  const standardTownAlt = '翡翠色に光る屋根と橋、朱提灯の商家を見渡す、月夜の城下町';
  const standardPreview = { key: 'standard', label: 'いつもの城下町', description: '無料で遊べる通常の城下町です。景色や装いを見比べても、ゲームの状態は変わりません。' };
  const safePrefix = value => typeof value === 'string' && /^(?:\.{1,2}\/|\/)?(?:[a-zA-Z0-9_-]+\/)*$/.test(value) ? value : '';
  const safeId = value => text(value, 80).replace(/[^a-zA-Z0-9_-]/g, '-') || 'premium';
  const assetPath = value => /^assets\/premium\/[a-z0-9-]+\.(?:webp|svg)$/.test(value || '') ? value : '';
  const priceLabel = product => `${product.priceYen.toLocaleString('ja-JP')}円${product.kind === 'subscription' ? ' / 月' : product.kind === 'pass' ? ' / 30日' : ''}`;
  const periodText = '月額780円（税込）で自動更新します。支払いが完了した各利用期間に、3種から1種の外観を確定で選べます。解約手続きをすると現在の利用期間の末日で終了し、期間終了までバッジを利用できます。選んだ外観は解約後も所持・装備できます。';
  const passText = '480円（税込）、購入反映から実時間30日間。自動更新はありません。1人招集の結果を1日3回まで、同じ結果につき1回だけ再抽選し、元の武将と新しい武将から1人を選びます。10人招集は対象外です。回数は毎日05:00（日本時間）に更新され、繰り越されません。有効期間中は追加購入できません。';
  function cleanProduct(product) {
    return {
      id: product.id, slot: slotFor(product.id), name: text(product.name, 120), kind: ['subscription', 'pass', 'reward'].includes(product.kind) ? product.kind : 'cosmetic',
      priceYen: Number.isSafeInteger(product.priceYen) && product.priceYen >= 0 ? product.priceYen : 0,
      summary: text(product.summary), benefits: (Array.isArray(product.benefits) ? product.benefits : []).map(value => text(value, 400)).filter(Boolean).slice(0, 8),
      previewKey: product.id, previewLabel: text(product.previewLabel, 180) || text(product.name, 120), previewDescription: text(product.previewDescription),
      palette: Object.fromEntries(['background', 'border', 'accent', 'text'].filter(key => /^#[a-f0-9]{6}$/i.test(product.palette?.[key] || '')).map(key => [key, product.palette[key]])),
      art: { src: assetPath(product.art?.src), width: Number(product.art?.width) || 1024, height: Number(product.art?.height) || 1024, alt: text(product.art?.alt, 300) || text(product.name, 120) }
    };
  }

  function productsFrom(catalog) {
    let source;
    try { source = catalog?.getProducts?.(); } catch { source = []; }
    const seen = new Set();
    return (Array.isArray(source) ? source : []).filter(product => {
      if (!ids.includes(product?.id) || seen.has(product.id)) return false;
      seen.add(product.id); return true;
    }).map(cleanProduct);
  }
  function rewardProduct(catalog, id) { const product = isReward(id) ? catalog?.getProduct?.(id) : null; return product?.id === id && product?.slot === 'nameplate' ? cleanProduct(product) : null; }
  function rewardPalette(product) { return Object.entries(product?.palette || {}).map(([key, value]) => '--supporter-' + key + ':' + value).join(';'); }
  function publicEvaluation(value) {
    if (!value || value.version !== 1 || !Number.isSafeInteger(value.score) || value.score < 0 || value.score > 100000 || value.maxScore !== 100000 || !Number.isSafeInteger(value.rankIndex) || value.rankIndex < 0 || value.rankIndex >= 17 || typeof value.rankId !== 'string' || !value.rankId || value.rankId.length > 64 || typeof value.rankName !== 'string' || !value.rankName.trim() || value.rankName.length > 32) return null;
    return { version: 1, score: value.score, maxScore: 100000, rankIndex: value.rankIndex, rankId: value.rankId, rankName: value.rankName };
  }
  function playerMarkup(user) {
    if (!user) return '';
    return `<span class="player-evaluation-person">${global.SengokuAvatar?.markup?.(user, 'inline') || ''}${global.SengokuCityHonors?.slot?.(user.id)||''}<span class="player-evaluation-name">${esc(user.name)}</span>${global.SengokuEvaluationUI?.badge?.(user.evaluation) || ''}${global.SengokuPublicCourt?.selfSlot?.(user.id) || ''}</span>`;
  }
  function normalizeContext(raw) {
    const status = ['loading', 'ready', 'anonymous', 'offline', 'error', 'banned'].includes(raw?.status) ? raw.status : 'offline';
    const user = raw?.user && text(raw.user.id, 100) ? { id: text(raw.user.id, 100), name: text(raw.user.name, 180) || '領主', avatarVersion: typeof raw.user.avatarVersion === 'string' && /^[a-f0-9]{64}$/.test(raw.user.avatarVersion) ? raw.user.avatarVersion : null, evaluation: publicEvaluation(raw.user.evaluation) } : null;
    const ready = status === 'ready' && raw?.ready === true && Boolean(user);
    const products = ids.map(id => {
      const item = (Array.isArray(raw?.products) ? raw.products : []).find(product => product?.id === id);
      return { id, owned: ready && item?.owned === true, equipped: ready && item?.owned === true && item?.equipped === true, expiresAt: text(item?.expiresAt, 80) || null, canPurchase: ready && item?.owned !== true && item?.canPurchase === true, purchaseBlockReason: text(item?.purchaseBlockReason, 80) };
    });
    const ownedRewards = ready ? [...new Set((Array.isArray(raw?.appearance?.ownedProducts) ? raw.appearance.ownedProducts : []).filter(isReward))] : [];
    const supporterRewards = { periods: ready ? (Array.isArray(raw?.supporterRewards?.periods) ? raw.supporterRewards.periods : []).flatMap(period => {
      if (!/^srp_[A-Za-z0-9_-]{1,100}$/.test(period?.periodId || '') || !/^20\d{2}(?:0[1-9]|1[0-2])$/.test(period?.periodKey || '')) return [];
      const choices = [...new Set((Array.isArray(period.choices) ? period.choices : []).filter(id => isReward(id) && id.startsWith('supporter-' + period.periodKey + '-')))];
      if (!choices.length || period.claimedProductId != null && !choices.includes(period.claimedProductId)) return [];
      return [{ periodId: period.periodId, periodKey: period.periodKey, startsAt: text(period.startsAt, 80), endsAt: text(period.endsAt, 80), claimedProductId: period.claimedProductId || null, choices }];
    }) : [] };
    const pass = raw?.rerollPass, passOwned = products.find(item => item.id === passId)?.owned;
    const rerollPass = ready && pass && pass.dailyLimit === 3 && Number.isSafeInteger(pass.usedToday) && pass.usedToday >= 0 && pass.usedToday <= 3 && Number.isSafeInteger(pass.remainingToday) && pass.remainingToday >= 0 && pass.remainingToday <= 3 ? { active: passOwned && pass.active === true, expiresAt: text(pass.expiresAt, 80), usedToday: pass.usedToday, remainingToday: pass.active === true && passOwned ? pass.remainingToday : 0, dailyLimit: 3, nextResetAt: text(pass.nextResetAt, 80), countsVerified: pass.countsVerified === true } : null;
    return { status, ready, user, products, supporterRewards, rerollPass, appearance: { nameplate: ownedRewards.includes(raw?.appearance?.nameplate) ? raw.appearance.nameplate : null, ownedProducts: ownedRewards }, portalUrl: ready ? portalURL(raw?.portalUrl) : '', serverNow: text(raw?.serverNow, 80), error: text(raw?.error, 500) };
  }
  function portalURL(value) {
    if (typeof value !== 'string' || !value.startsWith('https://') || /[\s\\\u0000-\u001f\u007f]/u.test(value)) return '';
    try { const url = new URL(value); return url.hostname === 'billing.stripe.com' && !url.username && !url.password && !url.port && !url.hash && url.pathname.startsWith('/p/') ? url.href : ''; } catch { return ''; }
  }
  function expiryLabel(value) {
    const date = new Date(value || '');
    return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date) + '（日本時間）' : '';
  }
  function stateFor(context, id) { return context.products.find(product => product.id === id) || (isReward(id) ? { id, owned: context.ready && context.appearance.ownedProducts.includes(id), equipped: context.ready && context.appearance.nameplate === id, canPurchase: false } : null); }
  function previewChoices(products) { return [standardPreview, ...products.filter(product => product.kind !== 'pass').map(product => ({ key: product.id, label: product.previewLabel, description: product.previewDescription }))]; }
  function accountMarkup(context) {
    const descriptions = {
      loading: '購入・装備の状態を確認しています。', anonymous: '購入する前に、商品を受け取る領主を登録・確認してください。',
      offline: '通信できないため、購入と装備変更を利用できません。見本はそのまま確認できます。',
      error: context.error || '購入状態を確認できませんでした。接続を確かめて再確認してください。', banned: 'この領主は現在、購入と装備変更を利用できません。',
      ready: context.ready ? '「ゲームに適用」で装備し、「通常に戻す」で解除できます。見本の切り替えだけでは装備は変わりません。' : context.error || '購入サービスを確認しています。利用できる状態になってから、購入と装備変更を行えます。'
    };
    return `<div class="premium-account-heading"><h2>自分の商品・特典</h2><button type="button" class="premium-account-refresh" data-premium-ui="refresh"${context.status === 'loading' || context.status === 'banned' ? ' disabled' : ''}>購入状態を再確認</button></div>${context.user ? `<p class="premium-account-user"><span>接続中の領主</span><strong>${playerMarkup(context.user)}</strong><code>${esc(context.user.id)}</code></p>` : ''}<p class="premium-account-message">${esc(descriptions[context.status])}</p>${context.status === 'anonymous' ? '<button type="button" class="premium-primary" data-premium-ui="register">領主を登録・確認する</button>' : ''}${context.portalUrl ? `<a class="premium-contract-link" href="${esc(context.portalUrl)}" target="_blank" rel="noopener noreferrer">支援の契約・解約を確認</a>` : ''}`;
  }
  function productStateMarkup(product, surface, context, gamePrefix) {
    if (surface === 'public') return `<a class="premium-purchase" href="${esc(gamePrefix)}?premium=${product.id}" data-premium-purchase="${product.id}">ゲームで購入する</a><p class="premium-availability">受け取る領主をゲーム内で確認してから、購入手続きへ進みます。</p>`;
    const state = stateFor(context, product.id);
    if (product.kind === 'pass' && context.ready && state.owned) {
      const pass = context.rerollPass;
      return `<p class="premium-owned" tabindex="-1">パス利用中</p><p class="premium-expiry">利用期限：${esc(expiryLabel(state.expiresAt))}</p><p class="premium-pass-remaining">${pass?.active && pass.countsVerified ? `今日の再抽選：残り <strong>${pass.remainingToday} / 3 回</strong><span>本日使用 ${pass.usedToday} 回</span>` : '本日の残り回数は再確認が必要です。'}</p>${pass?.nextResetAt ? `<p class="premium-expiry">次の回数更新：${esc(expiryLabel(pass.nextResetAt))}</p>` : ''}<button type="button" class="premium-purchase" data-premium-purchase="${product.id}" disabled>利用中のため再購入できません</button><p class="premium-availability">「武将招集」で1人招集の結果から使えます。自動更新・回数の繰越はありません。</p>`;
    }
    if (context.ready && state.owned) {
      const expires = product.kind === 'subscription' ? expiryLabel(state.expiresAt) : '';
      return `<p class="premium-owned" tabindex="-1">${state.equipped ? '適用中' : product.kind === 'subscription' ? '利用期間中' : '所持しています'}</p>${expires ? `<p class="premium-expiry">利用期限：${esc(expires)}</p>` : ''}<button type="button" class="premium-purchase premium-equip" data-premium-equip="${product.id}"${state.equipped ? ' data-premium-remove' : ''}>${state.equipped ? '通常に戻す' : 'ゲームに適用'}</button>`;
    }
    const label = context.ready ? state.canPurchase ? '購入内容を確認' : '現在は購入できません' : context.status === 'loading' ? '購入状態を確認中' : context.status === 'anonymous' ? '領主の確認が必要です' : '購入を利用できません';
    const blocked = context.ready && !state.canPurchase ? { subscription_exists: '継続中の契約があります。「支援の契約・解約を確認」から支払い・更新の状況をご確認ください。', monthly_choices_exhausted: 'この月の3種類分の選択権があります。翌月の外観が始まってから再契約できます。', preparing: '販売準備中です。購入先の確認が完了すると利用できます。', portal_unavailable: '契約管理の接続を確認中です。時間をおいて購入状態を再確認してください。' }[state.purchaseBlockReason] || '' : '';
    return `<p class="premium-ownership">${context.ready ? state.purchaseBlockReason === 'subscription_exists' ? '契約状態の確認が必要です' : ['subscription', 'pass'].includes(product.kind) ? '現在は利用していません' : '未所持' : '所有状態は未確認です'}</p><button type="button" class="premium-purchase" data-premium-purchase="${product.id}"${state.canPurchase ? '' : ' disabled'}>${label}</button>${blocked ? `<p class="premium-availability">${esc(blocked)}</p>` : ''}`;
  }
  const artworkWidths = {
    'castle-town-raden': [400,720,1080,1536], 'moonlit-castle': [400,720,1080,1536], 'sakura-town': [400,720,1080,1536], 'snow-town': [400,720,1080,1536],
    'gold-banner': [160,320,512,768], 'supporter-badge': [48,96,224,448,640]
  };
  function artworkSources(prefix, name) {
    return (artworkWidths[name] || []).map(width => `${prefix}assets/responsive/${name}-${width}.webp ${width}w`).join(', ');
  }
  function productSizes(id) {
    if (slots[id] === 'badge') return '195px';
    if (slots[id] === 'nameplate') return '(max-width: 650px) 175px, 160px';
    return '(max-width: 650px) 86vw, (min-width: 1460px) 420px, 30vw';
  }
  function productArt(product, prefix) {
    if (!product.art.src) return '';
    return `<figure class="premium-product-art premium-product-art--${product.id}"><img src="${esc(prefix + product.art.src)}" srcset="${artworkSources(prefix, product.id === 'supporter' ? 'supporter-badge' : product.id)}" sizes="${productSizes(product.id)}" width="${product.art.width}" height="${product.art.height}" alt="${esc(product.art.alt)}" loading="lazy" decoding="async"></figure>`;
  }
  function renderProduct(product, surface, context, idPrefix, assetPrefix, gamePrefix) {
    const id = `${idPrefix}-${product.id}`;
    return `<article class="premium-product" data-premium-product="${product.id}" data-premium-slot="${product.slot}" aria-labelledby="${id}-name">${productArt(product, assetPrefix)}<div class="premium-product-content"><p class="premium-label">${product.kind === 'subscription' ? '月額の継続支援・毎支払い期間に選べる外観' : product.kind === 'pass' ? '30日間の再抽選特典・自動更新なし' : '買い切りの外観アイテム'}</p><h3 id="${id}-name">${esc(product.name)}</h3><p class="premium-product-summary">${esc(product.summary)}</p><p class="premium-price"><strong>${priceLabel(product)}</strong><span>税込${product.kind === 'subscription' ? '・自動更新' : product.kind === 'pass' ? '・実時間30日・更新なし' : '・買い切り'}</span></p>${product.kind === 'pass' ? '<p class="premium-gameplay-note">武将の獲得結果に影響する有料特典です。</p>' : ''}<details class="premium-product-details"><summary>商品に含まれるもの</summary><ul>${product.benefits.map(benefit => `<li>${esc(benefit)}</li>`).join('')}</ul><p>${product.kind === 'pass' ? '通常の1人招集には勾玉が必要です。再抽選では追加の勾玉を消費しません。排出率は通常の1人招集と同じで、希望の武将や高レアリティを保証しません。' : '外観の特典です。武将の能力や資産を追加しません。'}同じ領主で利用できます。別の領主への譲渡・交易はできません。</p></details>${product.kind === 'subscription' ? `<p class="premium-subscription-terms">${periodText}</p>` : product.kind === 'pass' ? `<p class="premium-subscription-terms">${passText}</p>` : ''}<div class="premium-product-actions">${product.kind !== 'pass' ? `<button type="button" class="premium-preview-link" data-premium-preview="${product.id}" data-premium-jump aria-pressed="false" disabled>表示例を見る</button>` : ''}<div class="premium-product-state" data-premium-product-state="${product.id}">${productStateMarkup(product, surface, context, gamePrefix)}</div></div></div></article>`;
  }
  function periodLabel(key) { return /^20\d{2}(?:0[1-9]|1[0-2])$/.test(key || '') ? `${key.slice(0, 4)}年${Number(key.slice(4))}月` : ''; }
  function supporterMarkup(catalog, context, surface, prefix, previewPeriodKey) {
    const periods = surface === 'game' && context.ready ? context.supporterRewards.periods : [];
    const current = new Date(context.serverNow || Date.now());
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit' }).formatToParts(Number.isFinite(current.getTime()) ? current : new Date());
    const sampleKey = surface === 'public' ? /^20\d{2}(?:0[1-9]|1[0-2])$/.test(previewPeriodKey || '') ? previewPeriodKey : '202611' : parts.find(part => part.type === 'year').value + parts.find(part => part.type === 'month').value;
    function card(product, period = null) {
      const state = stateFor(context, product.id), owned = surface === 'game' && state?.owned;
      const action = owned ? `<p class="premium-owned">解約後も所持できる外観${state.equipped ? '・適用中' : ''}</p><button type="button" class="premium-purchase" data-premium-equip="${product.id}"${state.equipped ? ' data-premium-remove' : ''}>${state.equipped ? '通常に戻す' : 'ゲームに適用'}</button>` : period && !period.claimedProductId ? `<button type="button" class="premium-purchase" data-premium-reward-choice="${product.id}" data-premium-reward-period="${period.periodId}">この外観を選ぶ</button>` : period?.claimedProductId === product.id ? '<p class="premium-availability">受け取り状態を再確認してください。</p>' : '<p class="premium-availability">対象の支払い期間で選べる外観の見本です。</p>';
      return `<article class="premium-reward-card" data-premium-reward="${product.id}"><figure><img src="${esc(prefix + product.art.src)}" alt="${esc(product.art.alt)}" width="${product.art.width}" height="${product.art.height}" loading="lazy" decoding="async"></figure><h3>${esc(product.previewLabel)}</h3><p class="premium-reward-nameplate" style="${rewardPalette(product)}">${esc(context.user?.name || 'あなたの一城')}</p><p>${esc(product.summary)}</p><button type="button" class="premium-preview-link" data-premium-preview="${product.id}" data-premium-jump aria-pressed="false" disabled>城下町での表示例</button>${action}</article>`;
    }
    const selectedIds = new Set(periods.map(period => period.claimedProductId).filter(Boolean));
    const retained = context.appearance.ownedProducts.filter(id => !selectedIds.has(id)).map(id => rewardProduct(catalog, id)).filter(Boolean);
    const rows = periods.map(period => {
      const choices = (period.claimedProductId ? [period.claimedProductId] : period.choices).map(id => rewardProduct(catalog, id)).filter(Boolean);
      return `<details class="premium-reward-period"${period.claimedProductId ? '' : ' open'}><summary>${periodLabel(period.periodKey)}の外観${period.claimedProductId ? ' · 受け取り済み' : ' · 1種を選べます'}</summary><p class="premium-reward-dates">支払い対象：${esc(expiryLabel(period.startsAt))} 〜 ${esc(expiryLabel(period.endsAt))}</p><div class="premium-reward-grid">${choices.map(product => card(product, period)).join('')}</div></details>`;
    }).join('');
    const samples = !periods.length ? (catalog?.getSupporterChoices?.(sampleKey) || []).map(cleanProduct) : [];
    return `<div class="premium-section-heading"><p class="premium-label">サポーターの選べる永久外観</p><h2>支払い期間ごとに、3種から1種。</h2><p>支払い完了を確認した各利用期間につき、好きな旗印と名札を1種、確定で受け取れます。選んだ外観は解約後も残ります。12か月の季節配色が毎年巡ります。</p></div><p class="premium-reward-rule">選択を確定すると、その支払い期間の外観は変更できません。未選択の過去の支払い期間も、ここから受け取れます。</p>${rows}${retained.length ? `<h3>所持している支援特典</h3><div class="premium-reward-grid">${retained.map(product => card(product)).join('')}</div>` : ''}${samples.length ? `<p class="premium-reward-dates">${periodLabel(sampleKey)}の配色例${surface === 'game' ? ' · 受け取れる支払い期間は購入状態の確認後に表示されます。' : ''}</p><div class="premium-reward-grid">${samples.map(product => card(product)).join('')}</div>` : ''}`;
  }
  function renderCatalog(options = {}) {
    const catalog = options.catalog || global.SengokuPremiumCatalog, products = productsFrom(catalog), choices = previewChoices(products);
    const assetPrefix = safePrefix(options.assetPrefix || ''), gamePrefix = safePrefix(options.gamePrefix ?? assetPrefix), id = safeId(options.idPrefix || 'premium');
    const surface = options.surface === 'game' ? 'game' : 'public', context = normalizeContext(surface === 'game' ? options.context : null);
    const selected = choices.some(choice => choice.key === options.initialPreview) ? options.initialPreview : surface === 'public' ? 'moonlit-castle' : 'standard';
    const initial = choices.find(choice => choice.key === selected) || standardPreview;
    const selection = products.find(product => product.id === selected);
    const landscape = selection?.slot === 'town' ? selection.art.src : standardTownImage;
    return `<div class="premium-catalog" data-premium-catalog data-premium-surface="${surface}" data-premium-id="${id}" data-premium-asset-prefix="${esc(assetPrefix)}" data-premium-selected="${initial.key}">
${surface === 'game' ? `      <div class="premium-introduction"><p class="premium-label">外観コレクション・月額支援・30日再抽選パス</p><h2>一城の景色に、あなたらしい彩りを。</h2><p>一城を彩る外観、支払い期間ごとに永久外観を選べる月額支援、武将の1人招集を引き直せる30日パス。内容と期限を確かめて選べます。城を育て、武将を迎え、合戦や交易を重ねる基本プレイは無料です。</p></div>` : ''}
      ${surface === 'game' ? `<section class="premium-account" aria-label="接続中の領主と外観の管理" data-premium-account>${accountMarkup(context)}</section><p class="premium-feedback" role="status" data-premium-feedback hidden></p><section class="premium-confirm" data-premium-confirm hidden></section>` : '<p class="premium-public-note">購入・外観の適用はゲーム内で行います。見本はどなたでも切り替えられます。</p>'}
      <section class="premium-supporter-section" data-premium-supporter>${supporterMarkup(catalog, context, surface, assetPrefix, options.previewPeriodKey)}</section>
      <section class="premium-preview-section" aria-labelledby="${id}-preview-heading"><div class="premium-section-heading"><p class="premium-label">同じ素材を、ゲームの装いに</p><h2 id="${id}-preview-heading">完成した外観を見比べる</h2><p>この下の切り替えは、カタログの見本だけに反映されます。</p></div><div class="premium-preview-layout"><figure class="premium-stage" data-premium-stage data-premium-preview-mode="${initial.key}" data-premium-preview-slot="${slots[initial.key] || 'standard'}"><div class="premium-stage-image"><img class="premium-stage-landscape" data-premium-landscape src="${esc(assetPrefix + landscape)}" srcset="${artworkSources(assetPrefix, selection?.slot === 'town' ? initial.key : 'castle-town-raden')}" sizes="(max-width: 650px) 88vw, (min-width: 1460px) 760px, 51vw" loading="lazy" alt="${esc(selection?.slot === 'town' ? selection.art.alt : standardTownAlt)}" width="1536" height="1024" decoding="async"><span class="premium-preview-watermark">プレビュー</span><img class="premium-preview-banner" src="${esc(assetPrefix + (selection?.slot === 'nameplate' ? selection.art.src : 'assets/premium/gold-banner-v1.webp'))}" srcset="${artworkSources(assetPrefix, selection?.slot === 'nameplate' ? selected : 'gold-banner')}" sizes="(max-width: 650px) 22vw, 160px" loading="lazy" alt="" width="1024" height="1536" aria-hidden="true"><div class="premium-preview-nameplate"><span class="premium-preview-nameplate-label">領主名の表示例</span><div class="premium-preview-name-row"><strong>あなたの一城</strong><img class="premium-preview-supporter" src="${esc(assetPrefix + (selection?.slot === 'badge' ? selection.art.src : 'assets/premium/supporter-badge-v1.webp'))}" srcset="${artworkSources(assetPrefix, selection?.slot === 'badge' && selected !== 'supporter' ? selected : 'supporter-badge')}" sizes="32px" loading="lazy" alt="サポーターバッジの32px表示例" width="32" height="32"></div></div></div><figcaption aria-live="polite" aria-atomic="true"><strong data-premium-preview-title>${esc(initial.label)}</strong><p data-premium-preview-description>${esc(initial.description)}</p></figcaption></figure><div class="premium-preview-controls"><div class="premium-preview-options" role="group" aria-label="外観イメージを選ぶ">${choices.map(choice => `<button type="button" data-premium-preview="${choice.key}" aria-pressed="${choice.key === initial.key ? 'true' : 'false'}" disabled><span class="premium-swatch premium-swatch--${choice.key}" aria-hidden="true"></span><span>${esc(choice.label)}</span></button>`).join('')}</div><p class="premium-preview-note">画像は実際に使われる素材です。プレビューを選んでも所持や装備の状態は変わりません。</p><noscript><p class="premium-preview-note">外観の切り替えには JavaScript を使います。商品内容はこのまま下で確認できます。</p></noscript></div></div></section>
      <section class="premium-products-section" aria-labelledby="${id}-products-heading"><div class="premium-section-heading"><h2 id="${id}-products-heading">外観・継続支援・再抽選パス</h2><p>外観は買い切り、サポーターは月額780円。再抽選パスは480円で実時間30日間、自動更新なしです。</p></div><div class="premium-product-filters" role="group" aria-label="商品の種類"><button type="button" data-premium-filter="all" aria-pressed="true">すべて</button><button type="button" data-premium-filter="nameplate" aria-pressed="false">旗印</button><button type="button" data-premium-filter="town" aria-pressed="false">城下町</button><button type="button" data-premium-filter="badge" aria-pressed="false">勲章・支援</button><button type="button" data-premium-filter="pass" aria-pressed="false">再抽選パス</button></div><div class="premium-products">${products.length ? products.map(product => renderProduct(product, surface, context, id, assetPrefix, gamePrefix)).join('') : '<p class="premium-empty">商品情報を読み込めませんでした。画面を再読み込みしてください。</p>'}</div></section>
      <section class="premium-comparison-section" aria-labelledby="${id}-comparison-heading"><div class="premium-section-heading"><h2 id="${id}-comparison-heading">無料プレイとの違い</h2><p>外観・サポーターは装いの特典です。再抽選パスには、武将の獲得結果に影響する有料特典があります。</p></div><div class="premium-comparison-wrap"><table class="premium-comparison"><caption>無料プレイ・外観と支援・再抽選パスの内容</caption><thead><tr><th scope="col">できること</th><th scope="col">無料プレイ</th><th scope="col">外観・サポーター</th><th scope="col">再抽選パス</th></tr></thead><tbody><tr><th scope="row">城下町・武将・合戦・交易</th><td>遊べます</td><td>遊べます</td><td>遊べます</td></tr><tr><th scope="row">城下町や領主表示の外観</th><td>通常の外観</td><td>購入・受け取り済みの装い</td><td>外観は含みません</td></tr><tr><th scope="row">支払済み期間の選べる永久外観</th><td>なし</td><td>サポーターは3種から1種</td><td>含みません</td></tr><tr><th scope="row">勾玉による1人招集の再抽選</th><td>なし</td><td>含みません</td><td>1日3回・元の武将との選択可</td></tr><tr><th scope="row">勾玉・資産の直接購入</th><td>なし</td><td>なし</td><td>なし</td></tr></tbody></table></div><p class="premium-comparison-note">勾玉そのものは販売しません。再抽選は通常の1人招集と同じ排出率で、希望の武将や高レアリティは保証しません。有料商品の交易・譲渡はできません。</p></section>
      <section class="premium-faq-section" aria-labelledby="${id}-faq-heading"><div class="premium-section-heading"><h2 id="${id}-faq-heading">よくある質問</h2></div><div class="premium-faq"><details><summary>どこから購入できますか？</summary><p>ゲーム内の「保存・設定」から「有料版・支援」を開き、接続中の領主名・IDと商品を確認して購入画面へ進みます。購入手続きはStripeの画面で行います。通信や購入サービスを確認できない間は、購入ボタンを利用できません。</p></details><details><summary>購入後はどうやって外観を使いますか？</summary><p>ゲームへ戻り、「購入状態を再確認」を押してください。受け取りを確認すると、商品に「ゲームに適用」が表示されます。外観を元に戻すときは「通常に戻す」を選びます。購入画面から戻っただけで、未確認の権利が付くことはありません。</p></details><details><summary>月額サポーターの更新と解約は？</summary><p>${periodText}「支援の契約・解約を確認」から手続きできます。期間終了後はバッジが表示されなくなり、受け取り済みの支援特典と買い切りの外観は引き続き使えます。</p></details><details><summary>再抽選パスの使い方と利用期限は？</summary><p>${passText}利用中は重ねて購入できません。「武将招集」で1人招集した後に、再抽選するか、そのままの武将を迎えるかを選べます。パスの期限はゲームの速度設定やログイン日数にかかわらず進みます。</p></details><details><summary>プレビューを選ぶと、ゲームにも反映されますか？</summary><p>カタログの見本だけが切り替わります。ゲームへの適用は、購入状態を確認した後の別の操作です。見本の選択で資産やプレイ記録が変わることはありません。</p></details><details><summary>購入すると合戦や育成で有利になりますか？</summary><p>再抽選パスは武将の1人招集を引き直し、元と新しい武将を見比べて選べるため、獲得結果に影響します。外観アイテムとサポーターの特典は装飾です。勾玉・資産の直接販売や、武将能力・生産量・指令回復への倍率は含みません。</p></details></div></section><p class="premium-closing-note">自分らしい一城を楽しみながら、戦国VSのこれからを応援できます。</p>
    </div>`;
  }

  function createUI(options = {}) {
    const doc = options.document || global.document;
    const readCatalog = () => typeof options.catalog === 'function' ? options.catalog() : options.catalog || global.SengokuPremiumCatalog;
    const readRuntime = () => typeof options.runtime === 'function' ? options.runtime() : options.runtime || global.SengokuPremiumRuntime;
    const openWindow = options.openWindow || ((...args) => global.open?.(...args));
    const mounts = new Map();
    let dialog = null, body = null, heading = null, returnFocus = null, unsubscribe = null, runtime = null;
    let context = normalizeContext(null), scope = '', openEpoch = 0, accessEpoch = 0, busy = '', confirmation = null, checkoutWindow = null, viewTracked = '';
    const readContext = () => { try { return normalizeContext(runtime?.getContext?.()); } catch { return normalizeContext({ status: 'error', error: '購入状態を確認できませんでした。' }); } };
    function closeEmptyWindow() { try { if (checkoutWindow && !checkoutWindow.closed) checkoutWindow.close(); } catch {} checkoutWindow = null; }
    function feedback(message = '', error = false, url = '') {
      const node = body?.querySelector('[data-premium-feedback]'); if (!node) return;
      node.hidden = !message; node.setAttribute('role', error ? 'alert' : 'status');
      node.innerHTML = `${esc(message)}${url ? `<a class="premium-checkout-continuation" href="${esc(url)}" target="_blank" rel="noopener noreferrer">購入画面を開く</a>` : ''}`;
    }
    function clearConfirmation() { confirmation = null; const node = body?.querySelector('[data-premium-confirm]'); if (node) { const focused = node.contains(doc.activeElement); node.hidden = true; node.innerHTML = ''; if (focused && dialog?.open) heading?.focus?.({ preventScroll: true }); } }
    function setMarkup(node, markup) {
      if (!node || node._premiumMarkup === markup) return;
      const focused = node.contains(doc.activeElement);
      node.innerHTML = markup; node._premiumMarkup = markup;
      if (focused) (node.querySelector('button') || heading)?.focus?.({ preventScroll: true });
    }
    function recordEvent(event, productId) { try { runtime?.trackEvent?.(event, productId)?.catch?.(() => {}); } catch {} }
    function updateContext(next) {
      if (!dialog?.open) return;
      const value = normalizeContext(next), nextScope = `${value.status}:${value.ready}:${value.user?.id || ''}`;
      if (scope && scope !== nextScope) { accessEpoch++; busy = ''; closeEmptyWindow(); clearConfirmation(); feedback(); }
      scope = nextScope; context = value;
      if (confirmation?.kind === 'purchase' && (!value.ready || !stateFor(value, confirmation.product.id)?.canPurchase || confirmation.owner !== value.user?.id)) { accessEpoch++; busy = ''; closeEmptyWindow(); clearConfirmation(); }
      if (confirmation?.kind === 'reward') {
        const period = value.supporterRewards.periods.find(item => item.periodId === confirmation.periodId);
        if (!value.ready || confirmation.owner !== value.user?.id || !period || period.claimedProductId || !period.choices.includes(confirmation.product.id)) clearConfirmation();
      }
      setMarkup(body.querySelector('[data-premium-account]'), accountMarkup(value));
      setMarkup(body.querySelector('[data-premium-supporter]'), supporterMarkup(readCatalog(), value, 'game', safePrefix(options.assetPrefix || '')));
      for (const button of body.querySelectorAll('[data-premium-preview]')) button.disabled = false;
      if (confirmation && value.user?.id === confirmation.owner) setMarkup(body.querySelector('[data-premium-confirm-user]'), playerMarkup(value.user));
      for (const product of productsFrom(readCatalog())) setMarkup(body.querySelector(`[data-premium-product-state="${product.id}"]`), productStateMarkup(product, 'game', value, ''));
      for (const node of body.querySelectorAll('[data-premium-purchase]')) node.disabled = Boolean(busy) || !stateFor(value, node.getAttribute('data-premium-purchase'))?.canPurchase;
      for (const node of body.querySelectorAll('[data-premium-equip]')) node.disabled = Boolean(busy);
      for (const node of body.querySelectorAll('[data-premium-reward-choice]')) node.disabled = Boolean(busy) || !value.ready;
      const refreshButton = body.querySelector('[data-premium-ui="refresh"]'); if (refreshButton) refreshButton.disabled = Boolean(busy) || value.status === 'loading' || value.status === 'banned';
      const proceed = body.querySelector('[data-premium-ui="checkout"]'); if (proceed) proceed.disabled = Boolean(busy);
      const claim = body.querySelector('[data-premium-ui="claim-reward"]'); if (claim) claim.disabled = Boolean(busy);
      if (value.ready && value.user && viewTracked !== value.user.id) { viewTracked = value.user.id; recordEvent('shop_view'); }
    }
    function refresh() { if (!dialog?.open) return false; updateContext(readContext()); return true; }
    async function refreshAccount() {
      const epoch = openEpoch, currentRuntime = runtime;
      if (!currentRuntime?.refresh) { updateContext({ status: 'offline' }); return false; }
      try { await currentRuntime.refresh(); if (epoch !== openEpoch || runtime !== currentRuntime || !dialog?.open) return false; refresh(); return true; }
      catch (error) { if (epoch === openEpoch && dialog?.open) { refresh(); feedback(text(error?.message, 500) || '購入状態を再確認できませんでした。', true); } return false; }
    }
    function mountOne(element) {
      if (!element || mounts.has(element)) return false;
      const products = productsFrom(readCatalog()), choices = previewChoices(products), prefix = safePrefix(element.getAttribute('data-premium-asset-prefix') || '');
      const select = (key, jump = false) => {
        const reward = rewardProduct(readCatalog(), key);
        const choice = choices.find(item => item.key === key) || (reward ? { key, label: reward.previewLabel, description: reward.previewDescription } : null), stage = element.querySelector('[data-premium-stage]'); if (!choice || !stage) return false;
        element.setAttribute('data-premium-selected', choice.key); stage.setAttribute('data-premium-preview-mode', choice.key); stage.setAttribute('data-premium-preview-slot', slotFor(choice.key) || 'standard');
        stage.setAttribute('data-premium-reward-preview', reward ? 'true' : 'false');
        stage.setAttribute('style', reward ? rewardPalette(reward) : '');
        const product = products.find(item => item.id === choice.key) || reward;
        const image = stage.querySelector('[data-premium-landscape]');
        image?.setAttribute('srcset', artworkSources(prefix, product?.slot === 'town' ? choice.key : 'castle-town-raden'));
        image?.setAttribute('src', prefix + (product?.slot === 'town' ? product.art.src : standardTownImage));
        image?.setAttribute('alt', product?.slot === 'town' ? product.art.alt : standardTownAlt);
        const ornament = product?.slot === 'nameplate' ? stage.querySelector('.premium-preview-banner') : product?.slot === 'badge' ? stage.querySelector('.premium-preview-supporter') : null;
        if (ornament) { ornament.setAttribute('srcset', artworkSources(prefix, choice.key === 'supporter' ? 'supporter-badge' : choice.key)); ornament.setAttribute('src', prefix + product.art.src); ornament.setAttribute('alt', product.art.alt); }
        const title = element.querySelector('[data-premium-preview-title]'), description = element.querySelector('[data-premium-preview-description]');
        if (title) title.textContent = choice.label; if (description) description.textContent = choice.description;
        for (const button of element.querySelectorAll('[data-premium-preview]')) button.setAttribute('aria-pressed', String(button.getAttribute('data-premium-preview') === choice.key));
        if (jump) stage.scrollIntoView?.({ block: 'nearest', behavior: 'auto' }); return true;
      };
      const click = event => {
        const filter = event.target?.closest?.('[data-premium-filter]');
        if (filter && element.contains(filter)) {
          const value = filter.getAttribute('data-premium-filter');
          if (!['all', 'nameplate', 'town', 'badge', 'pass'].includes(value)) return;
          event.preventDefault();
          for (const item of element.querySelectorAll('[data-premium-slot]')) item.hidden = value !== 'all' && item.getAttribute('data-premium-slot') !== value;
          for (const item of element.querySelectorAll('[data-premium-filter]')) item.setAttribute('aria-pressed', String(item === filter));
          return;
        }
        const button = event.target?.closest?.('[data-premium-preview]'); if (!button || !element.contains(button) || button.disabled) return;
        event.preventDefault(); select(button.getAttribute('data-premium-preview'), button.hasAttribute('data-premium-jump'));
      };
      element.addEventListener('click', click);
      for (const button of element.querySelectorAll('[data-premium-preview]')) button.disabled = false;
      mounts.set(element, { select, destroy() { element.removeEventListener?.('click', click); for (const button of element.querySelectorAll('[data-premium-preview]')) button.disabled = true; } });
      select(element.getAttribute('data-premium-selected') || 'standard'); return true;
    }
    function mount(target = doc) {
      if (!target) return 0;
      const elements = target.matches?.('[data-premium-catalog]') ? [target] : [...target.querySelectorAll?.('[data-premium-catalog]') || []];
      return elements.reduce((count, element) => count + Number(mountOne(element)), 0);
    }
    function unmount(target) { for (const [element, controller] of mounts) if (!target || element === target || target.contains?.(element)) { controller.destroy(); mounts.delete(element); } }
    function selectPreview(productId, jump = false) { const element = body?.querySelector('[data-premium-catalog]'); return mounts.get(element)?.select(productId, jump) || false; }
    function confirmPurchase(productId) {
      if (busy) return;
      refresh(); const product = productsFrom(readCatalog()).find(item => item.id === productId);
      if (!product || !context.ready || !stateFor(context, productId)?.canPurchase) { feedback('現在の領主と購入状態を確認してください。', true); return; }
      confirmation = { kind: 'purchase', product, owner: context.user.id };
      const node = body.querySelector('[data-premium-confirm]');
      node.innerHTML = `<h2 tabindex="-1">購入する領主を確認</h2><p class="premium-confirm-product">${esc(product.name)} <strong>${priceLabel(product)}（税込）</strong></p><dl><div><dt>受け取る領主</dt><dd data-premium-confirm-user>${playerMarkup(context.user)}</dd></div><div><dt>領主ID</dt><dd><code>${esc(context.user.id)}</code></dd></div></dl><p>${product.kind === 'subscription' ? periodText : product.kind === 'pass' ? passText + '武将の獲得結果に影響する有料特典です。利用期間中は重ねて購入できません。' : '買い切りの商品です。確認した領主に外観が紐付きます。別の領主への譲渡・交易はできません。'}</p><p>Stripeの購入画面へ進みます。支払い後はこの画面に戻り、購入状態を再確認してください。</p><div class="premium-confirm-actions"><button type="button" class="premium-primary" data-premium-ui="checkout">購入手続きへ</button><button type="button" class="premium-dismiss" data-premium-ui="cancel-checkout">戻る</button></div>`;
      node.hidden = false; feedback(); node.scrollIntoView?.({ block: 'nearest', behavior: 'auto' }); node.querySelector('h2')?.focus?.({ preventScroll: true });
    }
    async function checkout() {
      if (busy || confirmation?.kind !== 'purchase') return;
      const chosen = confirmation, epoch = openEpoch, access = accessEpoch, currentRuntime = runtime, latest = readContext();
      if (!latest.ready || latest.user?.id !== chosen.owner || !stateFor(latest, chosen.product.id)?.canPurchase || !currentRuntime?.checkout) { updateContext(latest); clearConfirmation(); feedback('領主または購入状態が変わりました。もう一度確認してください。', true); return; }
      try { checkoutWindow = openWindow('about:blank', '_blank'); if (checkoutWindow) checkoutWindow.opener = null; } catch { checkoutWindow = null; }
      const pendingWindow = checkoutWindow;
      const abandonWindow = () => { try { if (pendingWindow && !pendingWindow.closed) pendingWindow.close(); } catch {} if (checkoutWindow === pendingWindow) checkoutWindow = null; };
      busy = 'checkout'; updateContext(latest);
      recordEvent('checkout_start', chosen.product.id);
      try {
        const result = await currentRuntime.checkout(chosen.product.id);
        if (epoch !== openEpoch || access !== accessEpoch || runtime !== currentRuntime || !dialog?.open) { abandonWindow(); return; }
        const current = readContext();
        if (!current.ready || current.user?.id !== chosen.owner) { abandonWindow(); updateContext(current); return; }
        const url = result?.productId === chosen.product.id ? readCatalog()?.checkoutURL?.(chosen.product.id, result.url) : '';
        if (!url) throw Error('購入先を確認できませんでした。もう一度お試しください。');
        let opened = false;
        try { if (pendingWindow && !pendingWindow.closed) { pendingWindow.location.href = url; opened = true; } } catch {}
        if (opened) { if (checkoutWindow === pendingWindow) checkoutWindow = null; } else abandonWindow();
        clearConfirmation(); feedback(opened ? '購入画面を別のタブで開きました。手続き後に「購入状態を再確認」を押してください。' : '購入画面を開く準備ができました。次のリンクから手続きを続けてください。', false, opened ? '' : url);
      } catch (error) { abandonWindow(); if (epoch === openEpoch && access === accessEpoch && dialog?.open) feedback(text(error?.message, 500) || '購入画面を開けませんでした。', true); }
      finally { if (epoch === openEpoch && access === accessEpoch && dialog?.open) { busy = ''; refresh(); } }
    }
    async function equip(productId, remove) {
      if (busy) return;
      const latest = readContext(), product = productsFrom(readCatalog()).find(item => item.id === productId) || rewardProduct(readCatalog(), productId);
      if (!product || !latest.ready || !stateFor(latest, productId)?.owned || !runtime?.equip) { updateContext(latest); feedback('所有状態を確認してから、もう一度お試しください。', true); return; }
      const epoch = openEpoch, access = accessEpoch, owner = latest.user.id, currentRuntime = runtime;
      busy = 'equip'; feedback(); updateContext(latest);
      try {
        await currentRuntime.equip(remove ? null : productId, product.slot);
        if (epoch !== openEpoch || access !== accessEpoch || runtime !== currentRuntime || !dialog?.open || readContext().user?.id !== owner) return;
        refresh(); feedback(remove ? '外観を通常の表示に戻しました。' : `${product.name}をゲームに適用しました。`);
      } catch (error) { if (epoch === openEpoch && access === accessEpoch && dialog?.open) feedback(text(error?.message, 500) || '装備を変更できませんでした。', true); }
      finally { if (epoch === openEpoch && access === accessEpoch && dialog?.open) { busy = ''; refresh(); } }
    }
    function confirmReward(periodId, productId) {
      if (busy) return;
      refresh();
      const period = context.supporterRewards.periods.find(item => item.periodId === periodId), product = rewardProduct(readCatalog(), productId);
      if (!context.ready || !period || period.claimedProductId || !period.choices.includes(productId) || !product || !runtime?.claimSupporterReward) { feedback('受け取れる支払い期間と外観を確認してください。', true); return; }
      confirmation = { kind: 'reward', periodId, product, owner: context.user.id };
      const node = body.querySelector('[data-premium-confirm]');
      node.innerHTML = `<h2 tabindex="-1">この外観を受け取りますか？</h2><p class="premium-confirm-product"><strong>${esc(product.name)}</strong></p><dl><div><dt>受け取る領主</dt><dd data-premium-confirm-user>${playerMarkup(context.user)}</dd></div><div><dt>領主ID</dt><dd><code>${esc(context.user.id)}</code></dd></div><div><dt>対象の期間</dt><dd>${esc(expiryLabel(period.startsAt))} 〜 ${esc(expiryLabel(period.endsAt))}</dd></div></dl><p>この支払い期間の選択権1回分を使います。確定後は別の外観に変更できません。受け取った外観は、サポーター解約後も所持・装備できます。追加の支払いはありません。</p><div class="premium-confirm-actions"><button type="button" class="premium-primary" data-premium-ui="claim-reward">この外観で確定する</button><button type="button" class="premium-dismiss" data-premium-ui="cancel-checkout">選び直す</button></div>`;
      node.hidden = false; feedback(); node.scrollIntoView?.({ block: 'nearest', behavior: 'auto' }); node.querySelector('h2')?.focus?.({ preventScroll: true });
    }
    async function claimReward() {
      if (busy || confirmation?.kind !== 'reward') return;
      const chosen = confirmation, latest = readContext(), period = latest.supporterRewards.periods.find(item => item.periodId === chosen.periodId);
      if (!latest.ready || latest.user?.id !== chosen.owner || !period || period.claimedProductId || !period.choices.includes(chosen.product.id)) { updateContext(latest); clearConfirmation(); feedback('受け取り状態が変わりました。もう一度確認してください。', true); return; }
      const epoch = openEpoch, access = accessEpoch, currentRuntime = runtime;
      busy = 'reward'; feedback(); updateContext(latest);
      try {
        await currentRuntime.claimSupporterReward(chosen.periodId, chosen.product.id);
        if (epoch !== openEpoch || access !== accessEpoch || runtime !== currentRuntime || !dialog?.open || readContext().user?.id !== chosen.owner) return;
        refresh(); clearConfirmation(); feedback(`${chosen.product.name}を受け取りました。「ゲームに適用」で装備できます。`);
      } catch (error) { if (epoch === openEpoch && access === accessEpoch && dialog?.open) feedback(text(error?.message, 500) || '外観の受け取りを確認できません。購入状態を再確認してください。', true); }
      finally { if (epoch === openEpoch && access === accessEpoch && dialog?.open) { busy = ''; refresh(); } }
    }
    function finishClose() {
      openEpoch++; accessEpoch++; busy = ''; closeEmptyWindow(); clearConfirmation(); unsubscribe?.(); unsubscribe = null;
      if (body) { unmount(body); body.innerHTML = ''; }
      runtime = null; scope = ''; viewTracked = ''; context = normalizeContext(null);
      const previous = returnFocus; returnFocus = null; if (previous?.isConnected && !previous.disabled) previous.focus?.({ preventScroll: true });
    }
    function ensureDialog() {
      if (dialog) return true; if (!doc?.body) return false;
      dialog = doc.createElement('dialog'); dialog.id = 'premium-modal'; dialog.className = 'premium-dialog'; dialog.setAttribute('aria-labelledby', 'premium-dialog-title');
      dialog.innerHTML = '<header class="premium-dialog-header"><div><span class="premium-label">戦国VSの外観・支援・再抽選パス</span><h1 id="premium-dialog-title" tabindex="-1">プレミアム</h1></div><button type="button" class="premium-close" data-premium-close aria-label="プレミアムを閉じる">×</button></header><div class="premium-dialog-body"></div><footer class="premium-dialog-footer"><span>プレビューと適用は別の操作です</span><button type="button" class="premium-dismiss" data-premium-close>閉じる</button></footer>';
      body = dialog.querySelector('.premium-dialog-body'); heading = dialog.querySelector('#premium-dialog-title');
      dialog.addEventListener('click', event => {
        const closeButton = event.target?.closest?.('[data-premium-close]'); if (closeButton && dialog.contains(closeButton)) { close(); return; }
        const purchase = event.target?.closest?.('[data-premium-purchase]'); if (purchase && dialog.contains(purchase) && !purchase.disabled) { event.preventDefault(); confirmPurchase(purchase.getAttribute('data-premium-purchase')); return; }
        const equipment = event.target?.closest?.('[data-premium-equip]'); if (equipment && dialog.contains(equipment) && !equipment.disabled) { event.preventDefault(); equip(equipment.getAttribute('data-premium-equip'), equipment.hasAttribute('data-premium-remove')); return; }
        const reward = event.target?.closest?.('[data-premium-reward-choice]'); if (reward && dialog.contains(reward) && !reward.disabled) { event.preventDefault(); confirmReward(reward.getAttribute('data-premium-reward-period'), reward.getAttribute('data-premium-reward-choice')); return; }
        const control = event.target?.closest?.('[data-premium-ui]'); if (!control || !dialog.contains(control) || control.disabled) return;
        event.preventDefault(); const action = control.getAttribute('data-premium-ui');
        if (action === 'refresh' && !busy) refreshAccount();
        if (action === 'register' && !busy) { const service = runtime; close(); service?.openRegistration?.(); }
        if (action === 'checkout') checkout();
        if (action === 'claim-reward') claimReward();
        if (action === 'cancel-checkout' && !busy) clearConfirmation();
      });
      dialog.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation?.(); close(); } });
      dialog.addEventListener('cancel', event => { event.preventDefault(); event.stopPropagation?.(); close(); });
      dialog.addEventListener('close', () => { if (!dialog?.open) finishClose(); }); doc.body.append(dialog); return true;
    }
    function open(productId) {
      if (!ensureDialog()) return false;
      const requested = typeof productId === 'string' ? productId : productId?.productId;
      if (dialog.open) { if (ids.includes(requested)) selectPreview(requested, true); if (requested === passId) body.querySelector(`[data-premium-product="${passId}"]`)?.scrollIntoView?.({ block: 'start' }); refresh(); return true; }
      returnFocus = doc.activeElement; runtime = readRuntime(); context = readContext(); scope = ''; openEpoch++; accessEpoch++; busy = '';
      body.innerHTML = renderCatalog({ catalog: readCatalog(), surface: 'game', context, assetPrefix: options.assetPrefix || '', idPrefix: 'premium-dialog-catalog', initialPreview: requested }); mount(body);
      if (typeof dialog.showModal !== 'function') { finishClose(); return false; }
      dialog.showModal(); body.scrollTop = 0; heading?.focus?.({ preventScroll: true }); updateContext(context);
      if (requested === passId) body.querySelector(`[data-premium-product="${passId}"]`)?.scrollIntoView?.({ block: 'start' });
      const epoch = openEpoch, currentRuntime = runtime;
      if (runtime?.subscribe) unsubscribe = runtime.subscribe(() => { if (epoch === openEpoch && runtime === currentRuntime && dialog?.open) refresh(); });
      refreshAccount(); return true;
    }
    function close() { if (!dialog?.open) return false; dialog.close(); finishClose(); return true; }
    function dispose() { close(); unmount(); dialog?.remove(); dialog = body = heading = null; }
    return { open, close, mount, refresh, dispose, isOpen: () => Boolean(dialog?.open) };
  }
  return { renderCatalog, createUI, normalizeContext, expiryLabel };
});
