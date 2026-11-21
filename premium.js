/* Shared, read-only product presentation. Preview choices live only in this UI. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    const ui = api.createUI();
    root.SengokuPremium = Object.assign(ui, { renderCatalog: api.renderCatalog });
    const start = () => ui.mount(root.document);
    if (root.document?.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }
})(typeof window !== 'undefined' ? window : globalThis, function (global) {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const text = (value, maximum = 1000) => typeof value === 'string' ? value.slice(0, maximum) : '';
  const previewKeys = new Set(['gold-banner', 'moonlit-castle', 'supporter']);
  const standardPreview = { key: 'standard', label: 'いつもの城下町', description: '無料で遊べる城下町のイラストです。まずは通常の景色から、予定している装飾の雰囲気を見比べられます。' };
  const safePrefix = value => typeof value === 'string' && /^(?:\.{1,2}\/|\/)?(?:[a-zA-Z0-9_-]+\/)*$/.test(value) ? value : '';
  const safeId = value => text(value, 80).replace(/[^a-zA-Z0-9_-]/g, '-') || 'premium';

  function productsFrom(catalog) {
    let source;
    try { source = catalog?.getProducts?.(); } catch { source = []; }
    const seen = new Set();
    return (Array.isArray(source) ? source : []).filter(product => {
      if (!previewKeys.has(product?.id) || seen.has(product.id)) return false;
      seen.add(product.id);
      return true;
    }).map(product => ({
      id: product.id,
      name: text(product.name, 120),
      kind: product.kind === 'subscription' ? 'subscription' : 'cosmetic',
      priceYen: Number.isSafeInteger(product.priceYen) && product.priceYen >= 0 ? product.priceYen : null,
      summary: text(product.summary),
      benefits: (Array.isArray(product.benefits) ? product.benefits : []).map(value => text(value, 400)).filter(Boolean).slice(0, 8),
      previewKey: previewKeys.has(product.previewKey) ? product.previewKey : product.id,
      previewLabel: text(product.previewLabel, 180) || text(product.name, 120),
      previewDescription: text(product.previewDescription)
    }));
  }

  function purchaseState(catalog, product) {
    let state;
    try { state = catalog?.getPurchaseState?.(product.id); } catch { state = null; }
    // The catalog is the only source of purchase destinations. The renderer
    // never reads a product's raw URL or a query parameter as a sale switch.
    if (state?.productId === product.id && state.status === 'available' && state.enabled === true && typeof state.url === 'string' && /^https:\/\//i.test(state.url)) {
      return { enabled: true, label: text(state.label, 100) || '購入ページへ', url: state.url };
    }
    return { enabled: false, label: '販売準備中', url: '' };
  }

  function previewChoices(products) {
    return [standardPreview, ...products.map(product => ({ key: product.previewKey, label: product.previewLabel, description: product.previewDescription }))];
  }

  function renderProduct(product, catalog, idPrefix) {
    const state = purchaseState(catalog, product), id = `${idPrefix}-${product.id}`;
    const price = product.priceYen === null ? '価格は後日ご案内' : `${product.priceYen.toLocaleString('ja-JP')}円${product.kind === 'subscription' ? ' / 月' : ''}`;
    const purchase = state.enabled
      ? `<a class="premium-purchase" href="${esc(state.url)}" target="_blank" rel="noopener noreferrer" data-premium-purchase="${product.id}">${esc(state.label)}</a>`
      : `<button type="button" class="premium-purchase" disabled aria-describedby="${id}-availability" data-premium-purchase="${product.id}">販売準備中</button>`;
    return `<article class="premium-product" data-premium-product="${product.id}" aria-labelledby="${id}-name">
      <div class="premium-product-top"><span class="premium-product-symbol premium-product-symbol--${product.id}" aria-hidden="true"></span><p class="premium-label">${product.kind === 'subscription' ? '月額の支援プラン' : '買い切りの外観アイテム'}</p></div>
      <h3 id="${id}-name">${esc(product.name)}</h3>
      <p class="premium-product-summary">${esc(product.summary)}</p>
      <p class="premium-price"><strong>${esc(price)}</strong><span>予定価格・税込</span></p>
      <details class="premium-product-details"><summary>予定している内容</summary><ul>${product.benefits.map(benefit => `<li>${esc(benefit)}</li>`).join('')}</ul><p>性能や資産の追加はありません。提供内容・外観は販売開始までに変更する場合があります。</p></details>
      <div class="premium-product-actions"><button type="button" class="premium-preview-link" data-premium-preview="${product.previewKey}" data-premium-jump aria-pressed="false" disabled>外観イメージを見る</button>${purchase}</div>
      <p class="premium-availability" id="${id}-availability">${state.enabled ? '購入条件はリンク先でご確認ください。' : '現在は購入・申し込みできません。'}</p>
    </article>`;
  }

  function renderCatalog(options = {}) {
    const catalog = options.catalog || global.SengokuPremiumCatalog;
    const products = productsFrom(catalog), choices = previewChoices(products);
    const assetPrefix = safePrefix(options.assetPrefix || ''), id = safeId(options.idPrefix || 'premium');
    return `<div class="premium-catalog" data-premium-catalog data-premium-id="${id}" data-premium-selected="standard">
      <div class="premium-introduction"><p class="premium-label">外観アイテムと、開発・運営への支援</p><h2>いつもの戦記に、あなたらしい彩りを。</h2><p>城を育て、武将を迎え、領主と戦記を重ねる遊びは無料のまま。城下町や領主表示を飾る外観アイテムと、戦国VSを応援する月額プランを準備しています。</p><p class="premium-preparing"><strong>販売準備中</strong><span>この画面では内容と外観のイメージをご覧いただけます。購入や申し込みはまだできません。</span></p></div>

      <section class="premium-preview-section" aria-labelledby="${id}-preview-heading">
        <div class="premium-section-heading"><h2 id="${id}-preview-heading">外観を見比べる</h2><p>気になる意匠を、この画面で試し見。</p></div>
        <div class="premium-preview-layout">
          <figure class="premium-stage" data-premium-stage data-premium-preview-mode="standard">
            <div class="premium-stage-image"><img src="${esc(assetPrefix)}assets/castle-town.webp" alt="天守と田畑、商家、川が広がる戦国VSの城下町" width="1536" height="1024" decoding="async"><span class="premium-preview-watermark">外観イメージ</span><span class="premium-preview-moon" aria-hidden="true"></span><span class="premium-preview-banner" aria-hidden="true"><img src="${esc(assetPrefix)}assets/emblem.webp" alt="" width="640" height="640"></span><div class="premium-preview-nameplate" aria-hidden="true"><span class="premium-preview-nameplate-label">領主表示の見本</span><strong>あなたの一城</strong><span class="premium-preview-supporter">応援の証</span></div></div>
            <figcaption aria-live="polite" aria-atomic="true"><strong data-premium-preview-title>${esc(standardPreview.label)}</strong><p data-premium-preview-description>${esc(standardPreview.description)}</p></figcaption>
          </figure>
          <div class="premium-preview-controls"><div class="premium-preview-options" role="group" aria-label="外観イメージを選ぶ">${choices.map(choice => `<button type="button" data-premium-preview="${choice.key}" aria-pressed="${choice.key === 'standard' ? 'true' : 'false'}" disabled><span class="premium-swatch premium-swatch--${choice.key}" aria-hidden="true"></span><span>${esc(choice.label)}</span></button>`).join('')}</div><p class="premium-preview-note">切り替わるのは、この見本だけです。ゲーム中の外観や所持品には適用されません。販売時の完成品とは異なる場合があります。</p><noscript><p class="premium-preview-note">外観の切り替えには JavaScript を使います。商品内容はこのまま下で確認できます。</p></noscript></div>
        </div>
      </section>

      <section class="premium-products-section" aria-labelledby="${id}-products-heading"><div class="premium-section-heading"><h2 id="${id}-products-heading">商品と内容</h2><p>価格と内容は予定です。販売開始時に、正式な条件をご案内します。</p></div><div class="premium-products">${products.length ? products.map(product => renderProduct(product, catalog, id)).join('') : '<p class="premium-empty">商品情報を準備しています。現在は購入できません。</p>'}</div></section>

      <section class="premium-comparison-section" aria-labelledby="${id}-comparison-heading"><div class="premium-section-heading"><h2 id="${id}-comparison-heading">無料プレイとの違い</h2><p>遊びを支える機能は、これまでどおり無料で使えます。</p></div><div class="premium-comparison-wrap"><table class="premium-comparison"><caption>無料プレイと販売予定商品の内容</caption><thead><tr><th scope="col">できること</th><th scope="col">無料プレイ</th><th scope="col">有料商品（予定）</th></tr></thead><tbody><tr><th scope="row">城下町・武将・合戦・交易</th><td>遊べます</td><td>同じ遊びを楽しめます</td></tr><tr><th scope="row">ヒント・ギルド・端末同期</th><td>利用できます</td><td>利用条件は変わりません</td></tr><tr><th scope="row">城や領主表示の外観</th><td>通常の外観</td><td>商品に応じた装飾を予定</td></tr><tr><th scope="row">戦力・資産・勾玉</th><td>ゲーム内で育成・獲得</td><td>購入による追加・優遇なし</td></tr></tbody></table></div><p class="premium-comparison-note">ゲーム内で獲得する勾玉と有料商品は別のものです。勾玉や資産の販売、有料商品の交易・譲渡は予定していません。</p></section>

      <section class="premium-faq-section" aria-labelledby="${id}-faq-heading"><div class="premium-section-heading"><h2 id="${id}-faq-heading">よくある質問</h2></div><div class="premium-faq">
        <details><summary>いま購入や申し込みはできますか？</summary><p>現在は販売準備中です。購入先はまだ公開しておらず、この画面で支払いや契約は発生しません。正式な価格、提供開始日、利用条件は、販売を始める際にご案内します。</p></details>
        <details><summary>購入すると合戦や育成で有利になりますか？</summary><p>予定しているのは外観アイテムと開発・運営への支援です。武将の能力、兵力、資産の生産、指令の回復などを強くする特典は付けません。無料プレイでも城下町、武将、合戦、交易を引き続き楽しめます。</p></details>
        <details><summary>外観イメージを選ぶと、ゲームにも反映されますか？</summary><p>このカタログの見本だけが切り替わります。選んだ状態は保存されず、ゲームの外観や資産、プレイ記録は変わりません。商品を手に入れた状態にもなりません。</p></details>
        <details><summary>月額プランは、いつから始まりますか？</summary><p>開始日は未定です。月額料金の請求時期、更新、解約、返金などの条件を整えたうえでご案内します。現在の表示や外観の切り替えで、申し込みが始まることはありません。</p></details>
      </div></section>
      <p class="premium-closing-note">自分らしい一城を楽しみながら、戦国VSのこれからを応援できる形を準備しています。</p>
    </div>`;
  }

  function createUI(options = {}) {
    const doc = options.document || global.document;
    const readCatalog = () => typeof options.catalog === 'function' ? options.catalog() : options.catalog || global.SengokuPremiumCatalog;
    const mounts = new Map();
    let dialog = null, body = null, heading = null, returnFocus = null;

    function mountOne(element) {
      if (!element || mounts.has(element)) return false;
      const choices = previewChoices(productsFrom(readCatalog()));
      const select = (key, jump = false) => {
        const choice = choices.find(item => item.key === key), stage = element.querySelector('[data-premium-stage]');
        if (!choice || !stage) return false;
        element.setAttribute('data-premium-selected', choice.key);
        stage.setAttribute('data-premium-preview-mode', choice.key);
        const title = element.querySelector('[data-premium-preview-title]'), description = element.querySelector('[data-premium-preview-description]');
        if (title) title.textContent = choice.label;
        if (description) description.textContent = choice.description;
        for (const button of element.querySelectorAll('[data-premium-preview]')) button.setAttribute('aria-pressed', String(button.getAttribute('data-premium-preview') === choice.key));
        if (jump) stage.scrollIntoView?.({ block: 'nearest', behavior: 'auto' });
        return true;
      };
      const click = event => {
        const button = event.target?.closest?.('[data-premium-preview]');
        if (!button || !element.contains(button) || button.disabled) return;
        event.preventDefault();
        select(button.getAttribute('data-premium-preview'), button.hasAttribute('data-premium-jump'));
      };
      element.addEventListener('click', click);
      for (const button of element.querySelectorAll('[data-premium-preview]')) button.disabled = false;
      mounts.set(element, () => {
        element.removeEventListener?.('click', click);
        for (const button of element.querySelectorAll('[data-premium-preview]')) button.disabled = true;
      });
      select('standard');
      return true;
    }

    function mount(target = doc) {
      if (!target) return 0;
      const elements = target.matches?.('[data-premium-catalog]') ? [target] : [...target.querySelectorAll?.('[data-premium-catalog]') || []];
      return elements.reduce((count, element) => count + Number(mountOne(element)), 0);
    }

    function unmount(target) {
      for (const [element, destroy] of mounts) if (!target || element === target || target.contains?.(element)) {
        destroy(); mounts.delete(element);
      }
    }

    function finishClose() {
      if (body) { unmount(body); body.innerHTML = ''; }
      const previous = returnFocus; returnFocus = null;
      if (previous?.isConnected && !previous.disabled) previous.focus?.({ preventScroll: true });
    }

    function ensureDialog() {
      if (dialog) return true;
      if (!doc?.body) return false;
      dialog = doc.createElement('dialog');
      dialog.id = 'premium-modal'; dialog.className = 'premium-dialog';
      dialog.setAttribute('aria-labelledby', 'premium-dialog-title');
      dialog.innerHTML = '<header class="premium-dialog-header"><div><span class="premium-label">戦国VSの外観アイテム・支援</span><h1 id="premium-dialog-title" tabindex="-1">プレミアム</h1></div><button type="button" class="premium-close" data-premium-close aria-label="プレミアムを閉じる">×</button></header><div class="premium-dialog-body"></div><footer class="premium-dialog-footer"><span>現在は販売準備中です</span><button type="button" class="premium-dismiss" data-premium-close>閉じる</button></footer>';
      body = dialog.querySelector('.premium-dialog-body');
      heading = dialog.querySelector('#premium-dialog-title');
      dialog.addEventListener('click', event => {
        const button = event.target?.closest?.('[data-premium-close]');
        if (button && dialog.contains(button)) close();
      });
      dialog.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        event.preventDefault(); event.stopPropagation?.(); close();
      });
      dialog.addEventListener('cancel', event => { event.preventDefault(); event.stopPropagation?.(); close(); });
      dialog.addEventListener('close', () => { if (!dialog?.open) finishClose(); });
      doc.body.append(dialog);
      return true;
    }

    function open() {
      if (!ensureDialog()) return false;
      if (dialog.open) return true;
      returnFocus = doc.activeElement;
      body.innerHTML = renderCatalog({ catalog: readCatalog(), assetPrefix: options.assetPrefix || '', idPrefix: 'premium-dialog-catalog' });
      mount(body);
      if (typeof dialog.showModal !== 'function') { finishClose(); return false; }
      dialog.showModal(); body.scrollTop = 0;
      heading?.focus?.({ preventScroll: true });
      return true;
    }

    function close() {
      if (!dialog?.open) return false;
      dialog.close();
      // Native close events may be queued; restore the underlying settings
      // control immediately too. finishClose is deliberately idempotent.
      finishClose();
      return true;
    }

    function dispose() { close(); unmount(); dialog?.remove(); dialog = body = heading = null; }
    return { open, close, mount, dispose, isOpen: () => Boolean(dialog?.open) };
  }

  return { renderCatalog, createUI };
});
