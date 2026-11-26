'use strict';

// Public introduction only: the game and its saved progress remain at the root.
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const { renderTrailer, renderScreenshots, videoSchema } = require('./promotion-content.cjs');

function renderSharePage({ site, metadataHtml, jsonLd, iconHtml, header, footer, artwork }) {
  const page = site.pages.share, release = esc(site.release);
  const asset = name => `../${name}?v=${release}`;
  // Only fixed campaign labels travel with a shared link. No player ID, account
  // code, current URL parameters or browser state is copied into an invitation.
  const campaignURL = (source, medium = 'referral', content = 'social') => {
    const url = new URL(site.origin + page.path);
    url.search = new URLSearchParams({utm_source:source, utm_medium:medium, utm_campaign:'player_invite', utm_content:content});
    return url.href;
  };
  const invitePresets = [
    {id:'social', label:'SNSで紹介', source:'share_text', text:'一城から、天下へ。城下町づくり・武将編成・合戦を楽しむ「戦国VS」。PC・スマホで基本プレイ無料、インストール不要。'},
    {id:'friend', label:'友だちを誘う', source:'friend', xText:'一緒に一城から始めてみませんか？城下町を育て、武将を率いる「戦国VS」。PC・スマホで基本プレイ無料、インストール不要。ひとりのCPU戦役から試せます。', text:'城下町を育てて、武将を率いて天下を目指す「戦国VS」。一緒に一城から始めてみませんか？PC・スマホのブラウザで基本プレイ無料。まずは「端末だけで遊ぶ」で試せて、領主登録後は同盟や交易も楽しめます。'},
    {id:'discord', label:'Discordに紹介', source:'discord', xText:'城下町を育て、武将を編成して攻城戦へ。「戦国VS」はPC・スマホで遊べる基本プレイ無料のブラウザ戦略ゲーム。領主登録後は同盟や交易も楽しめます。', text:'【ゲーム紹介】戦国ブラウザゲーム「戦国VS」。内政・武将編成・攻城戦を楽しめます。PC・スマホ・タブレット対応、基本プレイ無料。個人戦役はCPU戦、領主登録後は同盟や交易も利用できます。\n有料の外観アイテム・月額支援は任意です。遊び方・ゲーム画面はこちら。'}
  ];
  const shareURL = campaignURL('copy_link');
  const nativeURL = campaignURL('native_share');
  const shareText = invitePresets[0].text;
  const xLink = preset => 'https://twitter.com/intent/tweet?' + new URLSearchParams({text:preset.xText || preset.text, url:campaignURL('x','social',preset.id), hashtags:'戦国VS,ブラウザゲーム'});
  const lineLink = preset => 'https://social-plugins.line.me/lineit/share?' + new URLSearchParams({url:campaignURL('line','social',preset.id), text:preset.text});
  const messageFor = preset => preset.text + '\n' + campaignURL(preset.source, 'referral', preset.id);
  const xURL = xLink(invitePresets[0]);
  const lineURL = lineLink(invitePresets[0]);
  const p = { file: name => '../' + name, dir: name => name ? '../' + name + '/' : '../' };
  const schema = JSON.parse(jsonLd);
  schema['@graph'].push(videoSchema(site));
  const videoJsonLd = JSON.stringify(schema).replace(/</g, '\\u003c');
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
  <script type="application/ld+json">${videoJsonLd}</script>
  <link rel="stylesheet" href="${asset('button-artwork.css')}">
  <link rel="stylesheet" href="${asset('public-luxury.css')}">
  <link rel="stylesheet" href="${asset('brand-discovery.css')}">
  <link rel="stylesheet" href="${asset('promotion.css')}">
  <script defer src="${asset('promotion-share.js')}"></script>
  <script defer src="${asset('public-luxury.js')}"></script>
</head>
<body class="public-luxury" data-page="share">
  <a class="skip-link" href="#content">本文へ移動</a>
  ${header}
  <main id="content" class="page-width">
    <nav aria-label="パンくず"><ol class="breadcrumbs"><li><a href="../">戦国VS</a></li><li><span aria-current="page">戦国VSの紹介</span></li></ol></nav>
    <section class="hero share-hero chapter-hero folio-hero" aria-labelledby="page-title">
      ${artwork}
      <div class="hero-copy">
        <p class="eyebrow">公式ゲーム紹介</p>
        <h1 id="page-title">戦国VS</h1>
        <p class="share-tagline">${esc(site.tagline || '一城の志が、天下を動かす。')}</p>
        <p class="hero-lead">好きな城を選び、町を育て、武将を率いて次の一城へ。内政・軍団編成・攻城戦を楽しむ、日本語の戦国戦略シミュレーションです。軍師の助言を読み、自分の采配で領国を広げていきます。</p>
        <div class="hero-actions"><a class="action-link" href="../">基本プレイ無料で始める</a><a class="text-link" href="#intro-video">24秒の紹介動画を見る</a></div>
        <p class="discovery-availability"><span class="availability-item">基本プレイ無料</span><span class="availability-divider" aria-hidden="true">/</span><span class="availability-item">インストール不要</span></p>
        <p class="share-platform">PC・スマホ・タブレットのブラウザに対応。<br>有料の外観アイテム・月額支援もあります。<a href="#before-you-play">始める前のQ&amp;A</a></p>
      </div>
    </section>

    <nav class="promotion-section-nav" aria-label="戦国VSの紹介を探す"><a href="#game-screens">ゲーム画面</a><a href="#first-castle">始め方</a><a href="#share-journey-title">できること</a><a href="#share">友だちに紹介</a></nav>

    <nav class="folio-index" aria-label="収録内容から探す">
      <a href="../about/#collection"><strong>256</strong><span>人の武将</span></a>
      <a href="../guide/#maps"><strong>129</strong><span>の城と拠点</span></a>
      <a href="../guide/#construction"><strong>64</strong><span>種類の城下町施設</span></a>
    </nav>
    <section class="discovery-opening" aria-labelledby="discovery-opening-title">
      <div><p class="section-kicker">遊び方を選ぶ</p><h2 id="discovery-opening-title">ひとりの戦役も、領主との交流も。</h2></div>
      <p>個人の戦役では、天下地図のCPU勢力と城を争います。領主を登録すると、共通フィールドでの対人戦、同盟、書状、交易へ。初めてなら「端末だけで遊ぶ」から、一城を育てるところから始められます。</p>
    </section>
    <section id="first-castle" class="promotion-first-castle" aria-labelledby="first-castle-title"><div class="promotion-section-heading"><div><p class="section-kicker">はじめての方へ</p><h2 id="first-castle-title">最初の一歩は、城を選ぶだけ。</h2></div><a href="../guide/#first-steps">詳しい遊び方を読む</a></div><ol class="promotion-first-steps"><li><span>本拠を選ぶ</span><p>「城を選んで始める」で好きな一城へ。ひとりで試すなら「端末だけで遊ぶ」を選べます。</p></li><li><span>町と軍団を整える</span><p>田畑や商家を育て、武将を編成。迷ったら「次の一手」で、今できる準備を確認します。</p></li><li><span>次の城へ出陣する</span><p>天下地図で隣の城を選び、軍師の助言を読んで出陣。まずはCPU勢力との戦役から。</p></li></ol></section>
    ${renderTrailer(p, { showScreenshots: true })}
    ${renderScreenshots(p)}
    <section class="share-journey" aria-labelledby="share-journey-title">
      <div class="share-section-heading"><p class="section-kicker">育てる・備える・進む</p><h2 id="share-journey-title">戦国VSでできること</h2></div>
      <ol class="share-feature-list">
        <li><img class="feature-art" width="1200" height="500" src="../assets/chronicle/town-jade.webp" srcset="../assets/responsive/town-jade-240.webp 240w, ../assets/responsive/town-jade-400.webp 400w, ../assets/responsive/town-jade-640.webp 640w, ../assets/responsive/town-jade-960.webp 960w, ../assets/responsive/town-jade-1200.webp 1200w" sizes="(max-width: 650px) calc(100vw - 24px), (max-width: 900px) 40vw, (min-width: 1460px) 425px, 30vw" alt="月夜の城下町で、運河に映る灯籠と金色の天守を望む橋を人馬が渡る" loading="lazy" decoding="async"><div><h3>城下町を育て、城を強く。</h3><p>田畑で兵糧を、商業施設で金銭を蓄え、木材や石材を使って施設を増築。城郭のレベルを上げ、奉行を配置し、技術を研究しながら、領国を支える力を少しずつ整えていきます。</p><a class="share-detail-link" href="../guide/#construction">城下町と普請の遊び方</a></div></li>
        <li><img class="feature-art" width="1200" height="500" src="../assets/chronicle/war-jade.webp" srcset="../assets/responsive/war-jade-240.webp 240w, ../assets/responsive/war-jade-400.webp 400w, ../assets/responsive/war-jade-640.webp 640w, ../assets/responsive/war-jade-960.webp 960w, ../assets/responsive/war-jade-1200.webp 1200w" sizes="(max-width: 650px) calc(100vw - 24px), (max-width: 900px) 40vw, (min-width: 1460px) 425px, 30vw" alt="金の紋を染めた旗を従え、朝日の峠を白馬で進む朱の衣の騎手" loading="lazy" decoding="async"><div><h3>武将を迎え、自分の軍団を編成。</h3><p>武将ごとの能力や特技を見て、軍団と内政の役目を選びます。兵を集め、訓練で士気を整え、天下地図で隣接するCPU勢力の城へ。戦況と軍師AIの提案を確認し、戦法と兵数を決める采配が、次の戦役につながります。大都市拠点を確保すれば、部隊の雇用・偵察・駐留で遠方にも備えられます。</p><a class="share-detail-link" href="../guide/#officers">武将と軍団の遊び方</a><a class="share-detail-link" href="../guide/#covert">派遣部隊の使い方</a></div></li>
        <li><img class="feature-art" width="1200" height="500" src="../assets/chronicle/court-jade.webp" srcset="../assets/responsive/court-jade-240.webp 240w, ../assets/responsive/court-jade-400.webp 400w, ../assets/responsive/court-jade-640.webp 640w, ../assets/responsive/court-jade-960.webp 960w, ../assets/responsive/court-jade-1200.webp 1200w" sizes="(max-width: 650px) calc(100vw - 24px), (max-width: 900px) 40vw, (min-width: 1460px) 425px, 30vw" alt="翡翠色の格子と金屏風を備えた御殿で、使者二人が庭の水辺を背に向かい合う" loading="lazy" decoding="async"><div><h3>ほかの領主と、戦記を重ねる。</h3><p>共通フィールドでは領主同士の対人戦を、同盟や書状では交流を楽しめます。交易では、相手へ渡す資産と受け取りたい対価を示して申出を送り、承認を経て交換。領主との関わりも、国づくりの一部になります。</p><a class="share-detail-link" href="../guide/#trade">領主との交易の遊び方</a></div></li>
      </ol>
    </section>

    <section class="share-support" aria-labelledby="share-battles-title">
      <div class="share-section-heading"><h2 id="share-battles-title">軍師の助言と合戦の報酬</h2></div>
      <div class="share-support-copy">
        <section><h3>戦況に合う提案を、軍師から。</h3><p>城攻め・野良兵戦・対人戦・期間限定合戦など、すべての戦闘で軍師の助言を確認できます。戦法や出陣条件を比べ、提案を準備に反映してから出陣。天下地図のCPU城では、作戦文に沿った自動進軍にも対応しています。</p><a class="share-detail-link" href="../guide/#strategy">軍師AIの提案と自動進軍</a></section>
        <section><h3>戦いの報酬から、幕府の開設へ。</h3><p>期間限定合戦では、一戦ごとの報酬と戦功の達成報酬を獲得できます。対象の合戦で天下統一の条件を満たすと、幕府を開く権利を獲得。「幕府の記録」に幕府名と征夷大将軍の称号が残ります。</p><a class="share-detail-link" href="../guide/#timed-events">イベントの報酬を確認する</a><a class="share-detail-link" href="../guide/#shogunate">天下統一と幕府の開設</a></section>
      </div>
    </section>

    <section class="share-support" aria-labelledby="share-support-title">
      <div class="share-section-heading"><h2 id="share-support-title">進め方とデータの引き継ぎ</h2></div>
      <div class="share-support-copy">
        <section><h3>迷ったときは「ヒント」へ。</h3><p>資産や兵力、施設の状況に合う「次の一手」を、理由とともに確認できます。城下町や画面の「ヒント」から候補を開き、気になる項目の画面へ。何から育てるか迷ったときも、今できる準備を見つけられます。</p><a class="share-detail-link" href="../guide/#next-hints">ヒントの使い方</a></section>
        <section><h3>同じ領主で、次の端末へ。</h3><p>領主を登録・連携すると、進行をPC・スマホ・タブレットで同期できます。端末を変えるときや続きを遊ぶときは、データ復元の案内を読み、同じ領主へ接続してください。積み重ねた城と武将の記録から、次の一手を始められます。</p><a class="share-detail-link" href="../guide/data-recovery/">引き継ぎ・復元の案内</a></section>
      </div>
    </section>

    <section id="before-you-play" class="share-support discovery-faq" aria-labelledby="discovery-faq-title">
      <div class="share-section-heading"><p class="section-kicker">始める前に</p><h2 id="discovery-faq-title">戦国VSのよくある質問</h2></div>
      <div class="discovery-questions">
        <section><h3>無料でどこまで遊べますか？</h3><div><p>城下町の育成、武将編成、合戦の基本プレイは無料です。有料商品は旗印や城下町の外観、勲章、月額サポーターのバッジで、武将の能力や兵力を強化したり、資産を増やしたりする特典はありません。</p><a class="share-detail-link" href="../premium/">外観の見本・料金・月額支援を見る</a></div></section>
        <section><h3>アプリのインストールは必要ですか？</h3><div><p>インストールせず、このサイトから遊べます。PCはマウス、スマホ・タブレットはタップで操作できます。ゲームにはJavaScriptを、領主間の交流や同期にはインターネット接続を使います。</p><a class="share-detail-link" href="../guide/#device-controls">端末ごとの操作方法を読む</a></div></section>
        <section><h3>ひとりでも遊べますか？</h3><div><p>個人の戦役ではCPU勢力の城を攻略できます。初回は「端末だけで遊ぶ」を選べます。ほかの領主と合戦・同盟・交易を楽しむときは、領主を登録して共通フィールドへ進みます。</p><a class="share-detail-link" href="../guide/#first-steps">最初の城選びと進め方を読む</a></div></section>
        <section><h3>戦略ゲームが初めてでも始められますか？</h3><div><p>城下町の「次の一手」やメニューの「ヒント」で、今の領国に合う行動と理由を確認できます。軍師AIは戦況を比べ、出陣前の戦法や兵数を提案します。まずは田畑・商家と軍団を整えてみましょう。</p><a class="share-detail-link" href="../guide/#next-hints">ヒントと準備の進め方を読む</a></div></section>
        <section><h3>PCとスマホで続きを遊べますか？</h3><div><p>領主を登録・連携すれば、同じ領主の進行を端末間で同期できます。新しい端末では接続コードや統合バックアップで引き継ぎます。操作する端末は同時に1台です。</p><a class="share-detail-link" href="../guide/data-recovery/">データの引き継ぎ・復元方法を読む</a></div></section>
      </div>
    </section>

    <section id="share" class="promotion-panel" aria-labelledby="share-title" data-share-url="${esc(nativeURL)}" data-share-title="戦国VS｜一城から、天下へ。" data-share-text="${esc(shareText)}">
      <div class="promotion-heading"><p class="section-kicker">戦国好きの友だちへ</p><h2 id="share-title">この一城を、誰かに紹介する。</h2><p>気になったら、遊び方や無料の範囲がわかる紹介ページを共有できます。</p></div>
      <div class="promotion-copy-block"><label for="game-share-url">公式の紹介ページ</label><div class="promotion-url-row"><input id="game-share-url" type="url" value="${esc(shareURL)}" readonly spellcheck="false"><button type="button" class="promotion-copy-button" data-copy-target="game-share-url" hidden>URLをコピー</button></div><p class="promotion-copy-status" role="status" aria-live="polite"></p></div>
      <div class="promotion-invite-presets" data-share-presets hidden role="group" aria-label="紹介文の用途"><p>紹介する相手に合わせて、文章を選べます。</p><div class="promotion-preset-options">${invitePresets.map((preset, index) => `<button type="button" data-share-preset="${preset.id}" data-share-text="${esc(preset.text)}" data-share-copy="${esc(messageFor(preset))}" data-share-native-url="${esc(campaignURL('native_share','referral',preset.id))}" data-share-x="${esc(xLink(preset))}" data-share-line="${esc(lineLink(preset))}" aria-pressed="${index === 0}" aria-controls="game-share-message">${preset.label}</button>`).join('')}</div></div>
      <div class="promotion-copy-block"><label for="game-share-message">紹介文とURLをまとめてコピー</label><textarea id="game-share-message" data-share-message class="press-copy-text" rows="5" readonly spellcheck="false">${esc(messageFor(invitePresets[0]))}</textarea><button type="button" class="promotion-copy-button" data-copy-target="game-share-message" hidden>紹介文をコピー</button><p class="promotion-copy-status" role="status" aria-live="polite"></p></div>
      <div class="promotion-actions"><a data-share-x href="${esc(xURL)}" target="_blank" rel="noopener noreferrer">Xで紹介</a><a data-share-line href="${esc(lineURL)}" target="_blank" rel="noopener noreferrer">LINEで送る</a><button type="button" data-share-native hidden>端末の共有を開く</button></div>
      <p class="promotion-share-status" role="status" aria-live="polite"></p>
      <p class="promotion-invite-note">紹介文は送信先で編集できます。Xでは短い紹介文が開きます。Discordなどのコミュニティでは、ゲーム紹介が認められている場所でご利用ください。リンクを開くだけで同盟への参加や領主登録が行われることはありません。</p>
      <div class="promotion-press-link"><div><h3>記事・動画で紹介したい方へ</h3><p>公式画像、紋章、短い動画、日本語と英語の作品情報を用意しました。</p></div><a href="../press/">紹介・掲載用素材を見る</a></div>
    </section>
    <section class="closing share-closing" aria-labelledby="share-closing-title"><div><h2 id="share-closing-title">あなたの一城から、始めましょう。</h2><p>城下町を育て、群雄とともに、次の戦記へ。</p></div><a class="action-link" href="../">戦国VSを遊ぶ</a></section>
  </main>
  ${footer}
</body>
</html>
`;
}

module.exports = renderSharePage;
