'use strict';

// Static product information shares the same renderer as the in-game dialog.
const catalog = require('../premium-catalog.js');
const { renderCatalog } = require('../premium.js');
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

function renderPremiumPage({ site, metadataHtml, jsonLd, iconHtml, header }) {
  const page = site.pages.premium, release = esc(site.release);
  const asset = name => `../${name}?v=${release}`;
  const modified = String(page.dateModified || site.dateModified || '');
  const modifiedLabel = modified.replace(/^(\d{4})-(\d{2})-(\d{2})$/, (_, year, month, day) => `${year}年${Number(month)}月${Number(day)}日`);
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
    <section class="premium-page-hero" aria-labelledby="page-title"><div><p class="eyebrow">外観コレクション・継続支援</p><h1 id="page-title">戦国VS プレミアム</h1><p>金の旗を掲げ、月明かりの城下を眺める。育てた一城を、あなたの好きな装いに。</p><p class="premium-hero-note">買い切りの外観は480円・980円。月額支援は780円（税込）です。</p><a class="action-link" href="#premium-page-preview-heading">外観を試す</a></div><figure class="premium-page-visual"><img src="../assets/premium/moonlit-castle-v1.webp" alt="月と城の灯り、水面の反射を描いた月影の城下の完成背景" width="1536" height="1024" decoding="async" fetchpriority="high"><figcaption>月影の城下 · ゲームに適用できる完成背景</figcaption></figure></section>
    ${renderCatalog({ catalog, surface: 'public', assetPrefix: '../', gamePrefix: '../', idPrefix: 'premium-page' })}
    <nav class="premium-page-return" aria-label="ゲームの案内"><a class="action-link" href="../">戦国VSを遊ぶ</a><a href="../guide/">遊び方を読む</a><a href="../about/">ゲーム概要</a></nav>
  </main>
  <footer class="site-footer"><div class="footer-inner page-width"><p class="footer-brand">戦国VS <span>城と群雄の戦記</span></p><nav class="footer-nav" aria-label="フッターの案内"><a href="../sengoku-vs/">ゲーム紹介</a><a href="../guide/">遊び方</a><a href="../about/">ゲーム概要・出典</a><a href="../guide/data-recovery/">データ復元</a></nav><p class="copyright">© ${esc(site.publisher || 'KASAI SOLUTIONS')}</p><p class="footer-note">購入と装備は、ゲーム内で領主を確認してから。</p><p class="premium-updated">更新日：<time datetime="${esc(modified)}">${esc(modifiedLabel)}</time></p></div></footer>
</body>
</html>
`;
}

module.exports = renderPremiumPage;
