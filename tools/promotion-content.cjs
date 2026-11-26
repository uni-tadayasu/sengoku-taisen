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

// First-steps video is hosted with the official press assets. It is a slideshow
// of captured demo UI, not an assertion that a new YouTube upload is live.
const firstSteps = Object.freeze({
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

function renderFirstSteps(p) {
  return `<section class="promotion-trailer" id="press-first-steps" aria-labelledby="press-first-steps-title">
    <div class="promotion-trailer-copy"><p class="section-kicker">ゲーム画面で、始め方を知る</p><h2 id="press-first-steps-title">はじめての3手を、36秒で。</h2><p>${esc(firstSteps.description)}</p><ul class="promotion-video-points"><li>田畑や商家を育てて、領国の土台をつくる</li><li>武将の能力と役目を見比べ、軍団を整える</li><li>天下地図で戦況を確認し、軍師の助言を読む</li></ul><div class="promotion-actions"><a href="${esc(p.file(firstSteps.video))}" download>36秒の動画を保存</a><a class="promotion-secondary" href="${esc(p.dir('guide'))}#first-steps">詳しい始め方を読む</a></div><p class="promotion-trailer-note">撮影用デモ進行の静止画に移動・拡大を加えた紹介です。ゲームプレイの録画ではありません。城下町は5.1.0、武将・地図は5.0.5の画面を使用しています。</p></div>
    <figure class="promotion-trailer-media"><video class="press-video" controls preload="none" playsinline poster="${esc(p.file(firstSteps.poster))}" width="720" height="1280" aria-label="${esc(firstSteps.title)}"><source src="${esc(p.file(firstSteps.video))}" type="video/mp4"><track kind="captions" src="${esc(p.file(firstSteps.captions))}" srclang="ja" label="日本語"><p><a href="${esc(p.file(firstSteps.video))}">36秒の紹介動画を開く</a></p></video><figcaption>36秒・720×1280px・約5.68MB<span>日本語文字とBGM付き・ナレーションなし</span></figcaption></figure>
  </section>`;
}

function videoSchema(site) {
  return {
    '@type': 'VideoObject',
    '@id': site.origin + '/sengoku-vs/#intro-video',
    name: trailer.title,
    description: trailer.description,
    thumbnailUrl: site.origin + '/' + trailer.poster,
    uploadDate: trailer.publishedAt,
    duration: 'PT24S',
    contentUrl: site.origin + '/' + trailer.video,
    encodingFormat: 'video/mp4',
    inLanguage: 'ja',
    sameAs: trailer.url,
    publisher: { '@id': site.origin + '/#organization' },
    about: { '@id': site.origin + '/#game' }
  };
}

function renderTrailer(p, { id = 'intro-video', title = '24秒で、戦国VSの世界へ。', showScreenshots = false } = {}) {
  return `<section class="promotion-trailer" id="${esc(id)}" aria-labelledby="${esc(id)}-title">
    <div class="promotion-trailer-copy"><p class="section-kicker">一城から始まる、あなたの戦記</p><h2 id="${esc(id)}-title">${esc(title)}</h2><p>町を育て、武将を迎え、次の城へ。国づくりから合戦へ広がる戦国VSを、短い動画で紹介します。</p><ul class="promotion-video-points"><li>城下町で、領国の土台をつくる</li><li>武将を選び、自分の軍団を組む</li><li>軍師と戦況を読み、城を攻める</li></ul><div class="promotion-actions"><a href="${esc(p.dir(''))}">基本プレイ無料で始める</a><a class="promotion-secondary" href="${esc(trailer.url)}" target="_blank" rel="noopener noreferrer">YouTubeで見る</a></div><p class="promotion-trailer-note">公式イラストを使った作品紹介です。${showScreenshots ? '<a href="#game-screens">実際のゲーム画面を見る</a>' : '操作画面は、このページの実ゲーム画面で確認できます。'}</p></div>
    <figure class="promotion-trailer-media"><video class="press-video" controls preload="none" playsinline poster="${esc(p.file(trailer.poster))}" width="720" height="1280" aria-label="${esc(trailer.title)}"><source src="${esc(p.file(trailer.video))}" type="video/mp4"><track kind="captions" src="${esc(p.file(trailer.captions))}" srclang="ja" label="日本語" default><p><a href="${esc(trailer.url)}" target="_blank" rel="noopener noreferrer">YouTubeで紹介動画を見る</a></p></video><figcaption>24秒・日本語字幕付き<span>再生ボタンを押すと動画が始まります</span></figcaption></figure>
  </section>`;
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

module.exports = { trailer, firstSteps, videoSchema, renderTrailer, renderFirstSteps, renderScreenshots };
