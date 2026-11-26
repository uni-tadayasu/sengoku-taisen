'use strict';

// A separate English introduction to the Japanese game. No gameplay translation
// is implied. Read common release/asset metadata so the page follows the build.
const path = require('node:path');
const {trailer, firstSteps, jadeTrailer, jadePlayer, invitationURL} = require('./promotion-content.cjs');
const root = path.resolve(__dirname, '..');
const site = require('../site-metadata.json');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const absolute = value => new URL(value.replace(/^\//, ''), site.origin + '/').href;
const asset = value => '../' + value;
const release = encodeURIComponent(site.release);

function renderEnglishPage({metadataHtml, jsonLd, iconHtml} = {}) {
  // The main public-page build supplies the same metadata, brand and game
  // identities as every Japanese page; only this WebPage is in English.
  if (![metadataHtml, jsonLd, iconHtml].every(value => typeof value === 'string' && value)) {
    throw Error('English page rendering requires the shared public-page metadata');
  }
  const page = site.pages.english;
  const modified = page.dateModified;
  const invite = (source, medium) => invitationURL(site, 'english', source, medium, 'english');
  const invitation = 'Start with one castle in Sengoku Japan. Build its town, recruit officers and choose which castle to challenge next in SENGOKU VS. Basic play is free in your browser. The game is in Japanese, with an English starting guide.';
  const xURL = 'https://twitter.com/intent/tweet?' + new URLSearchParams({text: invitation, url: invite('x', 'social')});
  const screenshots = [
    ['town','Develop your castle town','Manage facilities and the resources that support your realm.','Nagoya Castle town with buildings, resources and commands in the Japanese game interface'],
    ['officers','Choose your officers','Compare abilities and assign officers to your army or town.','Officer portraits and abilities shown in the Japanese game interface'],
    ['map','Plan your next campaign','Read the terrain, inspect a castle and prepare your forces.','The campaign map showing castles and terrain in Japan’s Tokai region']
  ];
  const html = `<!doctype html>
<html lang="${esc(page.language)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${esc(page.title)}</title>
  ${metadataHtml}
  <meta name="theme-color" content="${esc(site.themeColor)}">
  ${iconHtml}
  <link rel="stylesheet" href="../guide.css?v=${release}">
  <link rel="stylesheet" href="../public-luxury.css?v=${release}">
  <link rel="stylesheet" href="../english-introduction.css?v=${release}">
  <link rel="stylesheet" href="../promotion.css?v=${release}">
  <script defer src="../promotion-share.js?v=${release}"></script>
  <link rel="stylesheet" href="../selection-lock.css?v=${release}">
  <script defer src="../selection-lock.js?v=${release}"></script>
  <link rel="alternate" type="application/rss+xml" title="SENGOKU VS updates (Japanese)" href="${absolute('news/feed.xml')}">
  <script type="application/ld+json">${jsonLd}</script>
</head>
<body class="public-luxury english-introduction" data-page="english">
  <a class="skip-link" href="#content">Skip to content</a>
  <header class="site-header"><div class="site-header-inner page-width">
    <a class="site-brand" href="../" aria-label="Open SENGOKU VS, the Japanese game"><img src="../${esc(site.favicon.path)}" width="44" height="44" alt=""><span><b lang="ja">戦国VS</b><small>SENGOKU VS</small></span></a>
    <nav class="header-navigation" aria-label="Main navigation"><a href="#how-to-start">How to start</a><a href="#screenshots">Screenshots</a><a href="#trailer">Trailer</a><a href="#before-you-play">FAQ</a><a href="../sengoku-vs/" lang="ja" hreflang="ja">日本語</a><a class="nav-play" href="../">Play in Japanese</a></nav>
  </div></header>
  <main id="content" class="page-width">
    <nav aria-label="Breadcrumb"><ol class="breadcrumbs"><li><a href="../">SENGOKU VS</a></li><li><span aria-current="page">English introduction</span></li></ol></nav>
    <section class="english-hero" aria-labelledby="page-title">
      <div class="english-hero-copy"><p class="section-kicker">A strategy game set in Sengoku Japan</p><h1 id="page-title">SENGOKU <span>VS</span></h1><p class="english-tagline">From one castle, build your realm.</p><p>Choose your home castle, develop its town and lead your officers into the next campaign. Read your adviser’s suggestions, balance your resources and decide where to advance.</p><div class="english-actions"><a class="action-link" href="../">Play in Japanese</a><a href="#how-to-start">Read the starting guide</a><a href="#share">Invite a friend</a></div><p class="english-language-note"><strong>The game is in Japanese.</strong> This page explains the first steps in English. The game interface and full guides are currently Japanese only.</p><ul class="english-availability"><li>Basic play is free</li><li>No app installation</li><li>Desktop, phone &amp; tablet</li></ul></div>
      <figure class="english-hero-art"><picture><source media="(max-width: 650px)" srcset="../assets/responsive/war-jade-400.webp 400w, ../assets/responsive/war-jade-640.webp 640w, ../assets/responsive/war-jade-960.webp 960w" sizes="calc(100vw - 32px)"><img src="${esc(asset(page.artwork.path))}" srcset="../assets/responsive/war-jade-panel-400.webp 400w, ../assets/responsive/war-jade-panel-640.webp 640w, ../assets/responsive/war-jade-panel-900.webp 900w" sizes="(max-width: 900px) 46vw, 620px" width="${page.artwork.width}" height="${page.artwork.height}" alt="${esc(page.artwork.alt)}" fetchpriority="high" decoding="async"></picture><figcaption>Official illustration · see actual game screens below</figcaption></figure>
    </section>
    <dl class="english-content-counts" aria-label="Game content"><div><dt>Officers</dt><dd>256</dd></div><div><dt>Castles &amp; locations</dt><dd>129</dd></div><div><dt>Facility types</dt><dd>64</dd></div></dl>

    <section id="screenshots" class="english-section" aria-labelledby="screenshots-title"><div class="english-section-heading"><div><p class="section-kicker">Inside the game</p><h2 id="screenshots-title">Build, prepare and advance.</h2></div><a href="../press/#press-media">Official media kit (Japanese)</a></div><div class="english-screenshots">${screenshots.map(([id, heading, body, alt]) => `<figure><a href="../assets/promo/screenshots/sengoku-vs-${id}-20261126.jpg" target="_blank" rel="noopener noreferrer" aria-label="View full-size screenshot: ${esc(heading)} (new tab)"><img src="../assets/promo/screenshots/sengoku-vs-${id}-20261126.jpg" width="1363" height="936" alt="${esc(alt)}" loading="lazy" decoding="async"></a><figcaption><h3>${esc(heading)}</h3><p>${esc(body)}</p></figcaption></figure>`).join('')}</div><p class="english-caption">Actual game screens captured with demo progress on November 26, 2026. The castle-town image shows Nagoya Castle in version 5.1.0; other screens were captured in version 5.0.5. The interface may change with updates.</p></section>

    <section id="how-to-start" class="english-section english-start" aria-labelledby="start-title"><div><p class="section-kicker">Your first castle</p><h2 id="start-title">A few Japanese labels to get you started.</h2><p>For a first look, you can start a personal campaign on your device without registering a lord. It pits you against computer-controlled factions. Keep your progress in the same browser, or register and link a lord to use cloud saves and other devices.</p><a href="../guide/#first-steps">Full starting guide (Japanese)</a></div><ol class="english-steps"><li><h3>Open the game and choose local play</h3><p>Select <span lang="ja" class="english-ui-label">城を選んで始める</span> (“Choose a castle and start”), then choose <span lang="ja" class="english-ui-label">端末だけで遊ぶ</span> (“Play only on this device”) on the starting screen.</p></li><li><h3>Choose your castle and start</h3><p>Choose your clan and difficulty, then a home castle from 124 starting choices. Confirm with <span lang="ja" class="english-ui-label">端末だけで始める</span> (“Start on this device”). This starts local progress without lord registration.</p></li><li><h3>Develop the town and assign officers</h3><p>Use farms and shops to support your supplies and money. Recruit officers and form an army. Open <span lang="ja" class="english-ui-label">次の一手</span> (“Next move”) or <span lang="ja" class="english-ui-label">ヒント</span> (“Hints”) for suggestions based on your realm.</p></li><li><h3>Prepare your next campaign</h3><p>Open <span lang="ja" class="english-ui-label">天下地図</span> (“Campaign map”), choose a neighboring castle and inspect the situation. Review the adviser’s suggestions, troop numbers and tactics before launching an attack.</p></li></ol></section>

    <section class="english-section english-modes" aria-labelledby="modes-title"><div class="english-section-heading"><div><p class="section-kicker">Choose how to play</p><h2 id="modes-title">A personal campaign, or a shared world.</h2></div></div><div class="english-mode-columns"><article><h3>Personal campaign</h3><p>Build up your realm and fight computer-controlled factions on your own campaign map. “Play only on this device” lets you begin without registering a lord. Progress is saved in that browser.</p></article><article><h3>Online features</h3><p>Register a lord to use the shared field, player battles, alliances, letters and trading. Link the same lord when switching devices. One device controls the saved progress at a time; online features and synchronization require an internet connection.</p></article></div></section>

    <section id="trailer" class="english-section english-trailer" aria-labelledby="trailer-title">
      <div><h2 id="trailer-title">${esc(jadeTrailer.englishTitle)}</h2>
        <p>See the jade castle crest and the lantern-lit town in the official artwork, then look inside the game at the officers and campaign map. The interface is in Japanese.</p>
        <p>On YouTube, watch the <a href="${esc(trailer.url)}">illustrated introduction (24 seconds)</a> or <a href="${esc(firstSteps.url)}">your first three moves (36 seconds)</a>. Both earlier videos are in Japanese.</p>
      </div>${jadePlayer(asset, 'en')}
    </section>

    <section id="before-you-play" class="english-section english-faq" aria-labelledby="faq-title"><div><p class="section-kicker">Before you play</p><h2 id="faq-title">What to expect.</h2></div><div class="english-faq-items"><details open><summary>What can I play for free?</summary><p>Castle-town development, officer management and the core battles are free to play. Optional purchases are cosmetic banners, town appearances, medals and a monthly supporter badge. These purchases do not improve officer abilities, troop strength, resource production or command recovery. <a href="../premium/">See the items and prices (Japanese)</a>.</p></details><details><summary>Is the game available in English?</summary><p>The game interface and full guides are currently in Japanese. This English page is an introduction and starting guide; it does not change the game’s language. The Japanese button labels above help you recognize the first steps.</p></details><details><summary>Do I need an app or an account?</summary><p>No app installation is needed. Open the game in a desktop, smartphone or tablet browser with JavaScript enabled. “Play only on this device” starts a personal campaign without registering a lord. Register and link a lord for online interaction and synchronization.</p></details><details><summary>How do I keep my progress?</summary><p>Local progress is saved in the browser where you began. Clearing browser data or changing browsers can remove access to it. Use the in-game save and backup options; register and link the same lord for cloud synchronization. Before changing devices, read the <a href="../guide/data-recovery/">backup and recovery guide (Japanese)</a>. Do not start a new campaign to restore an existing one.</p></details><details><summary>Can I write about or share the game?</summary><p>The <a href="../press/#press-english">English fact sheet</a> and <a href="../press/#press-media">official media kit</a> include artwork, real game screenshots and the short trailer. When introducing the game, include “SENGOKU VS (戦国VS),” the official website and “© KASAI SOLUTIONS.” The artwork and fictional game rules are inspired by historical people and places; the full credits are on the <a href="../about/#copyright">About page (Japanese)</a>.</p></details></div></section>

    <section id="share" class="promotion-panel" aria-labelledby="invite-title" data-share-title="SENGOKU VS" data-share-text="${esc(invitation)}" data-share-url="${esc(invite('native_share'))}">
      <div class="promotion-heading"><h2 id="invite-title">Invite a friend to SENGOKU VS</h2><p>This invitation opens the English starting guide. You can also <a href="../sengoku-vs/#share" hreflang="ja">share the Japanese introduction</a>.</p></div>
      <div class="promotion-copy-block"><label for="english-invite-url">English guide link</label><div class="promotion-url-row"><input id="english-invite-url" type="url" value="${esc(invite('copy_link'))}" readonly spellcheck="false"><button type="button" class="promotion-copy-button" data-copy-target="english-invite-url" hidden>Copy link</button></div><p class="promotion-copy-status" role="status"></p></div>
      <div class="promotion-copy-block"><label for="english-invite-message">Message to share</label><textarea id="english-invite-message" class="press-copy-text" rows="4" readonly spellcheck="false">${esc(invitation + '\n' + invite('friend'))}</textarea><button type="button" class="promotion-copy-button" data-copy-target="english-invite-message" hidden>Copy invitation</button><p class="promotion-copy-status" role="status"></p></div>
      <div class="promotion-actions"><a href="${esc(xURL)}" target="_blank" rel="noopener noreferrer">Share on X</a><button type="button" data-share-native hidden>Share on this device</button></div>
      <p class="promotion-share-status" role="status"></p>
    </section>

    <section class="english-closing" aria-labelledby="closing-title"><div><p class="section-kicker">Your story starts with one castle</p><h2 id="closing-title">Choose where your realm begins.</h2><p>Basic play is free. Japanese interface. Optional cosmetic purchases and monthly support.</p></div><a class="action-link" href="../">Play in Japanese</a></section>
  </main>
  <footer class="site-footer"><div class="footer-inner page-width"><a class="footer-brand" href="../">SENGOKU VS <span lang="ja">戦国VS</span></a><nav class="footer-nav" aria-label="Footer navigation"><a href="../sengoku-vs/" lang="ja" hreflang="ja">日本語の紹介</a><a href="./" lang="en" hreflang="en" aria-current="page">English</a><a href="../guide/">Guide (Japanese)</a><a href="../news/">Updates (Japanese)</a><a href="../press/#press-english">English fact sheet</a></nav><p class="copyright">© ${esc(site.publisher)}</p><p class="english-caption">Introduction updated <time datetime="${esc(modified)}">${esc(modified)}</time> · Game UI and full guides are in Japanese.</p></div></footer>
</body>
</html>
`;
  return html;
}

function buildEnglishPage({check = false} = {}) {
  // Keep the former direct command useful without creating a second build path
  // that could disagree about metadata, sitemap inclusion or content policies.
  require('node:child_process').execFileSync(process.execPath,
    [path.join(root, 'tools/build-public-pages.cjs'), ...(check ? ['--check'] : [])], {stdio:'inherit'});
}

if (require.main === module) buildEnglishPage({check:process.argv.includes('--check')});
module.exports = {renderEnglishPage, buildEnglishPage};
