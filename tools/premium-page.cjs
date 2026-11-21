'use strict';

// Static product information shares the same renderer as the in-game dialog.
const catalog = require('../premium-catalog.js');
const { renderCatalog } = require('../premium.js');
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

function renderPremiumPage({ site, metadataHtml, jsonLd, iconHtml }) {
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
  <meta name="theme-color" content="#0c141f">
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
</head>
<body data-page="premium">
  <a class="skip-link" href="#content">本文へ移動</a>
  <header class="site-header"><div class="site-header-inner page-width"><a class="site-brand" href="../" aria-label="戦国VS ゲームのトップへ"><img src="../${esc(site.favicon.path)}" alt="" width="44" height="44"><span><b>戦国VS</b><small>SENGOKU VS</small></span></a><nav class="header-navigation" aria-label="サイトの案内"><a href="../sengoku-vs/">ゲーム紹介</a><a href="../guide/">遊び方</a><a href="./" aria-current="page">プレミアム</a><a class="nav-play" href="../">ゲームを開く</a></nav></div></header>
  <main id="content" class="page-width premium-page-main">
    <nav aria-label="パンくず"><ol class="breadcrumbs"><li><a href="../">戦国VS</a></li><li><span aria-current="page">有料版・支援</span></li></ol></nav>
    <section class="premium-page-hero" aria-labelledby="page-title"><div><p class="eyebrow">外観アイテム・月額支援のご案内</p><h1 id="page-title">戦国VS プレミアム</h1><p>あなたの一城を彩る、新しい楽しみを。予定している商品と外観イメージをご紹介します。</p></div><figure class="premium-page-visual"><img src="../assets/title-sengoku-vs.webp" alt="武将と城郭を描いた、戦国VSのタイトルイラスト" width="1774" height="887" decoding="async" fetchpriority="high"></figure></section>
    ${renderCatalog({ catalog, assetPrefix: '../', idPrefix: 'premium-page' })}
    <nav class="premium-page-return" aria-label="ゲームの案内"><a class="action-link" href="../">戦国VSを遊ぶ</a><a href="../guide/">遊び方を読む</a><a href="../about/">ゲーム概要</a></nav>
  </main>
  <footer class="site-footer"><div class="footer-inner page-width"><p class="footer-brand">戦国VS <span>城と群雄の戦記</span></p><nav class="footer-nav" aria-label="フッターの案内"><a href="../sengoku-vs/">ゲーム紹介</a><a href="../guide/">遊び方</a><a href="../about/">ゲーム概要・出典</a><a href="../guide/data-recovery/">データ復元</a></nav><p class="copyright">© ${esc(site.publisher || 'KASAI SOLUTIONS')}</p><p class="footer-note">外観と支援の予定内容をご案内しています。</p><p class="premium-updated">更新日：<time datetime="${esc(modified)}">${esc(modifiedLabel)}</time></p></div></footer>
</body>
</html>
`;
}

module.exports = renderPremiumPage;
