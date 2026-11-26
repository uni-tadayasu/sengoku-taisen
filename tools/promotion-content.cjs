'use strict';

// Public media only. YouTube delivery was verified on 2026-11-26;
// this module never publishes, embeds a remote player, or contacts a tracker.
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const trailer = Object.freeze({
  url: 'https://www.youtube.com/watch?v=NWzewQEJyz0',
  publishedAt: '2026-11-26T05:53:29+09:00',
  video: 'assets/promo/sengoku-vs-intro-ja-20261126.mp4',
  poster: 'assets/promo/sengoku-vs-intro-ja-20261126-poster.jpg',
  captions: 'assets/promo/sengoku-vs-intro-ja-20261126.vtt',
  title: '戦国VS｜一城から、天下へ。24秒の作品紹介',
  description: '城下町づくり、武将編成、合戦を楽しむ日本語ブラウザゲーム「戦国VS」を、公式イラストで紹介する24秒の動画です。'
});

const firstSteps = Object.freeze({
  url: 'https://www.youtube.com/watch?v=j7TEhAidQjw',
  video: 'assets/promo/sengoku-vs-first-steps-ja-20261126.mp4',
  poster: 'assets/promo/sengoku-vs-first-steps-ja-20261126-poster.jpg',
  captions: 'assets/promo/sengoku-vs-first-steps-ja-20261126.vtt',
  metadata: 'assets/promo/sengoku-vs-first-steps-ja-20261126.json',
  production: 'assets/promo/FIRST-STEPS-PRODUCTION.md',
  seconds: 36,
  bytes: 5683022,
  title: '戦国VS｜はじめての3手',
  description: '撮影用デモの実ゲーム静止画を使い、城下町の育成・武将編成・天下地図からの出陣という最初の流れを伝える36秒の紹介です。'
});

const jadePath = 'assets/promo/sengoku-vs-jade-campaign-ja-en-20261127';
const jadeTrailer = Object.freeze({
  video: jadePath + '.mp4', poster: jadePath + '-poster.jpg',
  japaneseCaptions: jadePath + '-ja.vtt', englishCaptions: jadePath + '-en.vtt',
  title: '月夜の城下から、天下地図へ', englishTitle: 'From a moonlit castle to the campaign map',
  description: '翡翠の天守紋と月夜の城下町を描いた公式イラストから、武将と天下地図のゲーム画面へ。日本語と英語で戦国VSを紹介する短編映像です。',
  seconds: 28
});

function jadePlayer(file, language) {
  const english = language === 'en';
  return `<figure class="promotion-trailer-media"><video class="press-video" controls preload="none" playsinline width="720" height="1280" poster="${esc(file(jadeTrailer.poster))}" aria-label="${esc(english ? jadeTrailer.englishTitle : jadeTrailer.title)}">
      <source src="${esc(file(jadeTrailer.video))}" type="video/mp4">
      <track kind="captions" src="${esc(file(jadeTrailer.japaneseCaptions))}" srclang="ja" label="日本語">
      <track kind="captions" src="${esc(file(jadeTrailer.englishCaptions))}" srclang="en" label="English">
      <p><a href="${esc(file(jadeTrailer.video))}">${english ? 'Open the MP4' : '動画を開く（MP4）'}</a></p>
    </video><figcaption>${english ? jadeTrailer.seconds + ' seconds · Japanese and English captions' : jadeTrailer.seconds + '秒・日本語／English字幕'}</figcaption></figure>`;
}

function videoSchema(site) {
  return {
    '@type': 'VideoObject',
    '@id': site.origin + '/sengoku-vs/#jade-trailer',
    name: '戦国VS｜' + jadeTrailer.title, description: jadeTrailer.description,
    thumbnailUrl: site.origin + '/' + jadeTrailer.poster, uploadDate: '2026-11-27',
    duration: 'PT' + jadeTrailer.seconds + 'S', contentUrl: site.origin + '/' + jadeTrailer.video,
    encodingFormat: 'video/mp4', inLanguage: ['ja', 'en'],
    publisher: { '@id': site.origin + '/#organization' }, about: { '@id': site.origin + '/#game' }
  };
}

function renderScreenshots(p) {
  const shots = [
    ['town', '城下町', '育てた町の姿と、領国のいまを一望。', '名古屋城の城下町。施設と本拠の状況を表示した実ゲーム画面'],
    ['map', '天下地図', '山河の向こうへ、次の一城を選ぶ。', '東海地方の城と地形、選択した城の情報を表示した実ゲーム画面'],
    ['officers', '武将名鑑', '能力と役目を見比べ、采配を決める。', '武将の肖像と能力、任命先を表示した実ゲーム画面']
  ];
  return `<section id="game-screens" class="promotion-screens" aria-labelledby="game-screens-title"><div class="promotion-section-heading"><div><p class="section-kicker">実際のゲーム画面</p><h2 id="game-screens-title">この画面から、天下を目指す。</h2></div><a href="${esc(p.dir('press'))}#press-media">紹介用の素材を見る</a></div><div class="promotion-screen-grid">${shots.map(([key, title, description, alt]) => {
    const path = p.file(`assets/promo/screenshots/sengoku-vs-${key}-20261126.jpg`);
    return `<figure><a href="${esc(path)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(title)}の画面を大きく見る（新しいタブ）"><img src="${esc(path)}" width="1363" height="936" alt="${esc(alt)}" loading="lazy" decoding="async"></a><figcaption><h3>${esc(title)}</h3><p>${esc(description)}</p><a href="${esc(path)}" target="_blank" rel="noopener noreferrer">画面を大きく見る</a></figcaption></figure>`;
  }).join('')}</div><p class="promotion-screens-note">2026年11月26日に撮影用デモ進行を使用した実ゲーム画面です。城下町は5.1.0の名古屋城で、公開御触書を表示しています。画面の表示は更新により変わる場合があります。</p></section>`;
}

// Invitation destinations come only from the site's build metadata; game URLs
// and save data never enter a shared message.
function invitationURL(site, page, source, medium = 'referral', content = 'social') {
  const url = new URL(site.pages[page].path, site.origin);
  url.search = new URLSearchParams({utm_source: source, utm_medium: medium, utm_campaign: 'player_invite', utm_content: content});
  return url.href;
}

module.exports = { invitationURL, trailer, firstSteps, jadeTrailer, jadePlayer, videoSchema, renderScreenshots };
