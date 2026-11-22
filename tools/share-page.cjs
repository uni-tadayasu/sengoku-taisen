'use strict';

// Public introduction only: the game and its saved progress remain at the root.
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

function renderSharePage({ site, metadataHtml, jsonLd, iconHtml, header, artwork }) {
  const page = site.pages.share, release = esc(site.release);
  const asset = name => `../${name}?v=${release}`;
  const modified = String(page.dateModified || site.dateModified || '');
  const modifiedLabel = modified.replace(/^(\d{4})-(\d{2})-(\d{2})$/, (_, year, month, day) => `${year}年${Number(month)}月${Number(day)}日`);
  return `<!doctype html>
<html lang="${esc(site.language || 'ja')}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${esc(page.title)}</title>
  ${metadataHtml}
  <meta name="theme-color" content="#111b25">
  ${iconHtml}
  <link rel="stylesheet" href="${asset('guide.css')}">
  <link rel="stylesheet" href="${asset('share.css')}">
  <link rel="stylesheet" href="${asset('interaction-motion.css')}">
  <script defer src="${asset('interaction-motion.js')}"></script>
  <link rel="stylesheet" href="${asset('selection-lock.css')}">
  <script defer src="${asset('selection-lock.js')}"></script>
  <link rel="stylesheet" href="${asset('image-protect.css')}">
  <script defer src="${asset('image-protect.js')}"></script>
  <script type="application/ld+json">${jsonLd}</script>
  <link rel="stylesheet" href="${asset('button-artwork.css')}">
  <link rel="stylesheet" href="${asset('public-luxury.css')}">
  <script defer src="${asset('public-luxury.js')}"></script>
</head>
<body class="public-luxury" data-page="share">
  <a class="skip-link" href="#content">本文へ移動</a>
  ${header}
  <main id="content" class="page-width">
    <nav aria-label="パンくず"><ol class="breadcrumbs"><li><a href="../">戦国VS</a></li><li><span aria-current="page">戦国VSの紹介</span></li></ol></nav>
    <section class="hero share-hero chapter-hero" aria-labelledby="page-title">
      ${artwork}
      <div class="hero-copy">
        <p class="eyebrow">ゲーム紹介</p>
        <h1 id="page-title">戦国VS</h1>
        <p class="share-tagline">${esc(site.tagline || '一城の志が、天下を動かす。')}</p>
        <p class="hero-lead">選んだ一城から、あなたの戦記が始まります。田畑や商家を育てて国力を蓄え、武将を迎えて軍団を編成。内政と戦役を重ねながら、自分の領国を育てる戦国ブラウザゲームです。</p>
        <div class="hero-actions"><a class="action-link" href="../">戦国VSを遊ぶ</a><a class="text-link" href="../guide/">遊び方を読む</a></div>
        <p class="share-platform">PC・スマホ・タブレットのブラウザで遊べます。<a href="../guide/#device-controls">端末ごとの操作方法</a></p>
      </div>
    </section>

    <section class="share-journey" aria-labelledby="share-journey-title">
      <div class="share-section-heading"><p class="section-kicker">育てる・備える・進む</p><h2 id="share-journey-title">戦国VSでできること</h2></div>
      <ol class="share-feature-list">
        <li><img class="feature-art" width="1200" height="500" src="../assets/campaign/town.webp" alt="朝日が差す川沿いの城下町と木橋" loading="lazy" decoding="async"><div><h3>城下町を育て、城を強く。</h3><p>田畑で兵糧を、商業施設で金銭を蓄え、木材や石材を使って施設を増築。城郭のレベルを上げ、奉行を配置し、技術を研究しながら、領国を支える力を少しずつ整えていきます。</p><a class="share-detail-link" href="../guide/#construction">城下町と普請の遊び方</a></div></li>
        <li><img class="feature-art" width="1200" height="500" src="../assets/campaign/war.webp" alt="峠を進む騎馬武者と風になびく軍旗" loading="lazy" decoding="async"><div><h3>武将を迎え、自分の軍団を編成。</h3><p>武将ごとの能力や特技を見て、軍団と内政の役目を選びます。兵を集め、訓練で士気を整え、天下地図で隣接するCPU勢力の城へ。戦況と軍師AIの提案を確認し、戦法と兵数を決める采配が、次の戦役につながります。大都市拠点を確保すれば、部隊の雇用・偵察・駐留で遠方にも備えられます。</p><a class="share-detail-link" href="../guide/#officers">武将と軍団の遊び方</a><a class="share-detail-link" href="../guide/#covert">派遣部隊の使い方</a></div></li>
        <li><img class="feature-art" width="1200" height="500" src="../assets/campaign/court.webp" alt="御殿の縁側で向かい合う使者" loading="lazy" decoding="async"><div><h3>ほかの領主と、戦記を重ねる。</h3><p>共通フィールドでは領主同士の対人戦を、同盟や書状では交流を楽しめます。交易では、相手へ渡す資産と受け取りたい対価を示して申出を送り、承認を経て交換。領主との関わりも、国づくりの一部になります。</p><a class="share-detail-link" href="../guide/#trade">領主との交易の遊び方</a></div></li>
      </ol>
    </section>

    <section class="share-support" aria-labelledby="share-battles-title">
      <div class="share-section-heading"><p class="section-kicker">軍師と備え、天下を目指す</p><h2 id="share-battles-title">合戦の一手を、次の達成へ。</h2></div>
      <div class="share-support-copy">
        <section><h3>戦況に合う提案を、軍師から。</h3><p>城攻め・野良兵戦・対人戦・期間限定合戦など、すべての戦闘で軍師の助言を確認できます。戦法や出陣条件を比べ、提案を準備に反映してから出陣。天下地図のCPU城では、作戦文に沿った自動進軍にも対応しています。</p><a class="share-detail-link" href="../guide/#strategy">軍師AIの提案と自動進軍</a></section>
        <section><h3>戦いの報酬から、幕府の開設へ。</h3><p>190件の戦い一覧を使って設計された期間限定合戦では、一戦ごとの報酬と戦功の達成報酬を獲得できます。対象の合戦で天下統一の条件を満たすと、幕府を開く権利を獲得。「幕府の記録」に幕府名と征夷大将軍の称号が残ります。</p><a class="share-detail-link" href="../guide/#timed-events">イベントの報酬を確認する</a><a class="share-detail-link" href="../guide/#shogunate">天下統一と幕府の開設</a></section>
      </div>
    </section>

    <section class="share-support" aria-labelledby="share-support-title">
      <div class="share-section-heading"><p class="section-kicker">あなたの歩幅で進める</p><h2 id="share-support-title">次の一手を確かめながら。</h2></div>
      <div class="share-support-copy">
        <section><h3>迷ったときは「ヒント」へ。</h3><p>資産や兵力、施設の状況に合う「次の一手」を、理由とともに確認できます。城下町や画面の「ヒント」から候補を開き、気になる項目の画面へ。何から育てるか迷ったときも、今できる準備を見つけられます。</p><a class="share-detail-link" href="../guide/#next-hints">ヒントの使い方</a></section>
        <section><h3>同じ領主で、次の端末へ。</h3><p>領主を登録・連携すると、進行をPC・スマホ・タブレットで同期できます。端末を変えるときや続きを遊ぶときは、データ復元の案内を読み、同じ領主へ接続してください。積み重ねた城と武将の記録から、次の一手を始められます。</p><a class="share-detail-link" href="../guide/data-recovery/">引き継ぎ・復元の案内</a></section>
      </div>
    </section>

    <section class="closing share-closing" aria-labelledby="share-closing-title"><div><h2 id="share-closing-title">あなたの一城から、始めましょう。</h2><p>城下町を育て、群雄とともに、次の戦記へ。</p></div><a class="action-link" href="../">戦国VSを遊ぶ</a></section>
  </main>
  <footer class="site-footer"><div class="footer-inner page-width"><p class="footer-brand">戦国VS <span>城と群雄の戦記</span></p><nav class="footer-nav" aria-label="フッターの案内"><a href="../guide/">遊び方</a><a href="../about/">ゲーム概要・出典</a><a href="../premium/">有料版・支援</a><a href="../guide/data-recovery/">データ復元</a></nav><p class="copyright">© ${esc(site.publisher || 'KASAI SOLUTIONS')}</p><p class="footer-note">地図・人物・家紋の資料はゲーム概要に記載しています。</p><p class="share-updated">更新日：<time datetime="${esc(modified)}">${esc(modifiedLabel)}</time></p></div></footer>
</body>
</html>
`;
}

module.exports = renderSharePage;
