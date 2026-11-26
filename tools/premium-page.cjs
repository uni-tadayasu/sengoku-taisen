'use strict';

// Static product information shares the same renderer as the in-game dialog.
const catalog = require('../premium-catalog.js');
const { renderCatalog } = require('../premium.js');
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

function renderPremiumPage({ site, metadataHtml, jsonLd, iconHtml, header, footer, artwork }) {
  const page = site.pages.premium, release = esc(site.release);
  const asset = name => `../${name}?v=${release}`;
  const prices = catalog.getProducts().map(product => {
    const subscription = product.kind === 'subscription';
    return `<a href="#premium-page-${esc(product.id)}-name"><strong>${esc(product.priceYen.toLocaleString('ja-JP'))}<span>${subscription ? '円 / 月' : '円'}</span></strong><span>${esc(product.name)}・税込</span></a>`;
  }).join('');

  return `<!doctype html>
<html lang="${esc(site.language || 'ja')}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(page.title)}</title>
  ${metadataHtml}
  <meta name="theme-color" content="#111b25">
  ${iconHtml}
  <link rel="stylesheet" href="${asset('guide.css')}">
  <link rel="stylesheet" href="${asset('premium.css')}">
  <link rel="stylesheet" href="${asset('interaction-motion.css')}">
  <script defer src="${asset('interaction-motion.js')}"></script>
  <link rel="stylesheet" href="${asset('selection-lock.css')}">
  <script defer src="${asset('selection-lock.js')}"></script>
  <link rel="stylesheet" href="${asset('image-protect.css')}">
  <script defer src="${asset('image-protect.js')}"></script>
  <script defer src="${asset('premium-catalog.js')}"></script>
  <script defer src="${asset('premium.js')}"></script>
  <script type="application/ld+json">${jsonLd}</script>
  <link rel="stylesheet" href="${asset('button-artwork.css')}">
  <link rel="stylesheet" href="${asset('public-luxury.css')}">
  <script defer src="${asset('public-luxury.js')}"></script>
</head>
<body class="public-luxury" data-page="premium">
  <a class="skip-link" href="#content">本文へ移動</a>
  ${header}
  <main id="content" class="page-width premium-page-main">
    <nav aria-label="パンくず"><ol class="breadcrumbs"><li><a href="../">戦国VS</a></li><li><span aria-current="page">有料版・支援</span></li></ol></nav>
    <section class="premium-page-hero hero chapter-hero folio-hero" aria-labelledby="page-title">${artwork}<div class="hero-copy"><p class="eyebrow">外観コレクション・継続支援</p><h1 id="page-title">戦国VS プレミアム</h1><p class="hero-lead">紅蓮・白銀の旗印、鳳凰の勲章、桜と雪の城下町が新登場。全8商品の装いを、このページで見比べられます。城育成・武将編成・合戦の基本プレイは無料です。</p><div class="hero-actions"><a class="action-link" href="#premium-page-preview-heading">外観を試す</a><a class="text-link" href="#premium-page-products-heading">商品と料金を見る</a></div></div></section>
    <nav class="folio-index premium-editions" aria-label="商品の価格（税込）">${prices}</nav>
    ${renderCatalog({ catalog, surface: 'public', assetPrefix: '../', gamePrefix: '../', idPrefix: 'premium-page' })}
    <nav class="premium-page-return" aria-label="ゲームの案内"><a class="action-link" href="../">戦国VSを遊ぶ</a><a href="../guide/">遊び方を読む</a><a href="../about/">ゲーム概要</a></nav>
  </main>
  ${footer}
</body>
</html>
`;
}

module.exports = renderPremiumPage;
