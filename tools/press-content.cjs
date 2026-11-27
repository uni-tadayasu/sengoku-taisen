'use strict';

// Public editorial material only. No account, analytics or posting action runs here.
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const { captureManifest, screenCaptures, trailer, firstSteps, jadeTrailer, jadePlayer } = require('./promotion-content.cjs');
const copy = {
  "short": "戦国VSは、城下町を育て、256人の武将を編成し、城をめぐる合戦を楽しむ戦国ブラウザゲーム。軍師の助言を読み、一城から天下統一へ。PC・スマホ・タブレットで、インストールせず基本プレイ無料で始められます。",
  "standard": "戦国VSは、内政・武将編成・攻城戦を楽しむ基本プレイ無料の戦国戦略シミュレーションです。124の開始候補から一城を選び、田畑や商家を育てて領国の力を蓄えます。256人の武将、129の城と拠点、64種類の施設を収録。個人の戦役ではCPU勢力と戦い、領主を登録すると同盟・書状・交易などの交流にも参加できます。軍師AIが戦況に合う準備や戦法を提案。PC・スマホ・タブレットのブラウザで遊べます。有料商品は外観アイテムと月額支援で、戦力を優遇する特典はありません。",
  "media": "「戦国VS（SENGOKU VS）」は、KASAI SOLUTIONSが制作する日本語の戦国戦略シミュレーションです。「一城から、天下へ。」を合言葉に、城下町の内政、武将の登用と軍団編成、城をめぐる合戦を楽しめます。PC・スマートフォン・タブレットのブラウザから、アプリをインストールせず基本プレイ無料で始められます。\n\n収録内容は256人の武将、129の城と拠点、64種類の城下町施設。124の開始候補から本拠を選び、田畑や商家で資源を生産し、普請・研究・募兵へ配分します。軍師AIは現在の戦況から戦法や出陣兵数を提案。「次の一手」のヒントも、領国の状態に合う準備を案内します。\n\n個人の戦役ではCPU勢力の城を攻略し、領主を登録すると共通フィールドで対人戦・同盟・書状・交易へ参加できます。同じ領主へ連携すれば、PCとスマホなどの端末間で進行を引き継げます。操作する端末は同時に1台です。\n\n有料商品は旗印や城下町の外観、勲章、月額サポーターのバッジです。武将の能力、兵力、生産量や指令回復を優遇する特典はありません。人物・城・勢力配置は、史実を題材にしたゲーム独自の設定です。",
  "x": "【開発・運営より】\n一城から、天下へ。『戦国VS』は、城下町づくり・武将編成・合戦を楽しむブラウザゲームです。PC・スマホ対応、基本プレイ無料・インストール不要。\nhttps://www.kasai-solutions-inc.com/sengoku-vs/\n#戦国VS #ブラウザゲーム\n© KASAI SOLUTIONS",
  "line": "開発・運営している「戦国VS」を紹介します。城下町を育て、武将を集めて編成し、城をめぐる合戦を楽しむゲームです。\n\nPC・スマホのブラウザで、インストールせず基本プレイ無料で遊べます。ひとりでCPU勢力との戦役を進めることも、領主を登録して同盟や交易を楽しむこともできます。有料の外観アイテム・月額支援は任意です。\n\n戦国や国づくりが好きなら、まずは紹介ページをのぞいてみてください。\nhttps://www.kasai-solutions-inc.com/sengoku-vs/\n© KASAI SOLUTIONS",
  "community": "KASAI SOLUTIONSより、制作・運営している日本語ブラウザゲーム「戦国VS」を紹介します。\n\n田畑や商家を育てる内政、武将の登用・軍団編成、城をめぐる合戦を組み合わせた戦国戦略シミュレーションです。個人の戦役ではCPU勢力と戦い、領主を登録すると対人戦・同盟・書状・交易も利用できます。256人の武将、129の城と拠点、64種類の施設を収録しています。\n\nPC・スマホ・タブレットに対応し、インストール不要で基本プレイ無料。有料商品は外観と月額支援で、戦力や資産の優遇はありません。初めての方には「次の一手」のヒントと、出陣前の軍師AIの助言があります。\n\n作品紹介・遊び方はこちらです。\nhttps://www.kasai-solutions-inc.com/sengoku-vs/\n© KASAI SOLUTIONS",
  "english": "SENGOKU VS is a Japanese-language browser strategy game by KASAI SOLUTIONS. Develop a castle town, recruit and organize officers, and choose how to expand your territory. Play a personal campaign against computer-controlled factions, or register a lord to join online battles, alliances, letters, and trading. Basic play is free, with optional cosmetic items and a monthly supporter badge. The game runs in desktop, smartphone, and tablet browsers; no app installation is needed. The game UI and official guides are currently in Japanese."
};
const characters = value => Array.from(value.replace(/\r?\n/g, '')).length;

function copyBlock(id, label, text, rows) {
  return `<div class="press-copy-block"><h3><label for="${id}">${esc(label)}</label></h3><textarea id="${id}" class="press-copy-text" rows="${rows}" readonly spellcheck="false">${esc(text)}</textarea><button type="button" class="promotion-copy-button" data-copy-target="${id}" hidden>紹介文をコピー</button><p class="promotion-copy-status" role="status" aria-live="polite"></p></div>`;
}

function renderPressContent(p, { section, table, site }) {
  const origin = site.origin;
  const link = (file, label) => `<a href="${esc(p.file(file))}" download>${esc(label)}</a>`;
  const media = [
    ['ゲーム紹介', site.ogImage],
    ['攻略ガイド', site.pages.guide.socialImage],
    ['引き継ぎ・復元', site.pages.recovery.socialImage],
    ['作品概要', site.pages.about.socialImage],
    ['プレミアム', site.pages.premium.socialImage]
  ];
  const screenshots = [
    ['town', '城下町', '螺鈿の灯る清洲城の城下町。施設と本拠の状況が見える実ゲーム画面'],
    ['map', '天下地図', '日本の城と地形、選択した城の情報が見える実ゲーム画面'],
    ['officers', '武将名鑑', '所持武将の肖像・能力・任命先を確認する実ゲーム画面'],
    ['title', 'タイトル', '戦国VSのタイトルと開始ボタンが見える実ゲーム画面']
  ];
  return [
    section('press-facts', '作品の基本情報', '戦国VSの紹介に使える情報', `
      <p class="lead-paragraph">ゲーム紹介の記事、動画・配信の案内、SNSでの紹介に使える、公式の情報と素材をまとめました。短い説明から詳しい紹介文まで、このページで確認できます。</p>
      <div class="press-current-release"><span>現在の公開版</span><strong>Ver.${esc(site.version)}</strong><span>更新 <time datetime="${esc(site.dateModified)}">${esc(site.dateModified)}</time></span><a href="${esc(p.dir(''))}">ゲームを開く</a></div>
      <p>主な変更は<a href="${esc(p.dir('news'))}">公式の更新情報</a>にまとめています。記事・配信の準備に、<a href="${esc(p.file('news/feed.xml'))}" type="application/rss+xml">RSSで新しいお知らせを受け取る</a>こともできます。</p>
      ${table('戦国VSの掲載用基本情報', ['項目', '内容'], [
        ['作品名', '戦国VS（SENGOKU VS）'],
        ['キャッチコピー', '一城から、天下へ。'],
        ['制作・運営／著作権表記', 'KASAI SOLUTIONS／© KASAI SOLUTIONS'],
        ['ジャンル', '戦国戦略シミュレーション・ブラウザゲーム'],
        ['公式URL', `<a href="${esc(origin)}/">${esc(origin)}/</a>`],
        ['紹介ページ', `<a href="${esc(p.dir('sengoku-vs'))}">${esc(origin)}/sengoku-vs/</a>`],
        ['公開済み紹介動画', `<a href="${esc(jadeTrailer.url)}" target="_blank" rel="noopener noreferrer">${esc(jadeTrailer.title)}</a>（${jadeTrailer.seconds}秒・日本語／英語字幕、公式イラストと実ゲーム画面）<br><a href="${esc(firstSteps.url)}" target="_blank" rel="noopener noreferrer">はじめての3手</a>（${firstSteps.seconds}秒・日本語、過去バージョンの実ゲーム静止画）<br><a href="${esc(trailer.url)}" target="_blank" rel="noopener noreferrer">絵巻で見る戦国VS</a>（24秒・日本語、公式イラスト）`],
        ['対応端末', 'PC・スマートフォン・タブレットのブラウザ。アプリのインストールは不要です。'],
        ['表示言語', '日本語。英語表記の作品名はSENGOKU VSです。ゲームUIと公式ガイドは日本語です。'],
        ['料金', `基本プレイ無料。別売りの外観アイテムと月額支援は任意です。<a href="${esc(p.dir('premium'))}">商品・料金の案内</a>`],
        ['収録内容', '256人の武将／129の城と拠点／64種類の城下町施設'],
        ['遊び方', '個人の戦役ではCPU勢力と対戦。領主を登録すると共通フィールドの対人戦・同盟・書状・交易を利用できます。'],
        ['引き継ぎ', `同じ領主へ登録・連携すると端末間で進行を同期できます。操作は同時に1台。<a href="${esc(p.dir('guide/data-recovery'))}">引き継ぎ手順</a>`]
      ])}
      <p>有料商品は旗印・城下町の外観・勲章・サポーターバッジです。武将の能力、兵力、生産量や指令回復を優遇する特典はありません。人物・城・勢力配置は史実を題材にしたゲーム独自の設定です。</p>
      <ul class="press-downloads"><li>${link('assets/promo/sengoku-vs-facts-ja-20261126.txt', '基本情報・紹介文を保存（日本語TXT）')}</li><li>${link('assets/promo/sengoku-vs-press-kit-20261126.zip', '紹介用素材をまとめて保存（ZIP）')}</li></ul>
    `),
    section('press-media', '画像・ロゴ・動画', '掲載に使える公式素材', `
      <p>作品紹介の際は、作品名<strong>「戦国VS」</strong>、公式URL<strong>${esc(origin)}/</strong>、<strong>© KASAI SOLUTIONS</strong>を添えてください。人物・地図・家紋など第三者資料の出典は、<a href="${esc(p.dir('about'))}">作品概要と制作資料</a>で確認できます。</p>
      <h3>実際のゲーム画面</h3>
      <p>戦国VS Ver.${captureManifest.release}を、清洲城の撮影用デモ進行でプレイした実際の画面です。城下町・天下地図・武将名鑑・タイトルの4枚を用意しました。各画像は${screenCaptures.title.width}×${screenCaptures.title.height}pxのJPEGです。</p>
      <ul class="press-media-grid press-screenshot-grid">${screenshots.map(([key, label, alt]) => {
        const {path, width, height} = screenCaptures[key];
        return `<li><figure><img src="${esc(p.file(path))}" alt="${esc(alt)}" width="${width}" height="${height}" loading="lazy" decoding="async"><figcaption><strong>${esc(label)}</strong><span>撮影用デモ進行の実画面 · JPEG</span></figcaption></figure>${link(path, `${label}の実画面を保存（JPEG）`)}</li>`;
      }).join('')}</ul>
      <h3>共有用画像</h3>
      <p>5種類とも1200×630pxのJPEGです。イラストを用いた紹介画像で、ゲームの操作画面を撮影したスクリーンショットとは異なります。</p>
      <ul class="press-media-grid">${media.map(([label, image]) => `<li><figure><img src="${esc(p.file(image.path))}" alt="${esc(image.alt)}" width="${image.width}" height="${image.height}" loading="lazy" decoding="async"><figcaption><strong>${esc(label)}</strong><span>JPEG · ${image.width}×${image.height}px</span></figcaption></figure>${link(image.path, `${label}の画像を保存（JPEG）`)}</li>`).join('')}</ul>
      <h3>ブランド紋章</h3>
      <div class="press-logo"><img src="${esc(p.file(site.logo.path))}" alt="翡翠色の月を背に、金の三層天守と軍扇を八角に収めた戦国VSの紋章" width="128" height="128" loading="lazy" decoding="async"><ul class="press-downloads"><li>${link(site.logo.vectorPath, '紋章のベクター画像を保存（SVG）')}</li><li>${link(site.logo.path, '紋章の画像を保存（512×512px PNG）')}</li></ul></div>
      <section class="promotion-trailer" id="press-jade-trailer" aria-labelledby="press-jade-trailer-title">
        <div class="promotion-trailer-copy"><h3 id="press-jade-trailer-title">${esc(jadeTrailer.title)}</h3><p>${esc(jadeTrailer.description)}</p>
          <ul class="press-downloads"><li>${link(jadeTrailer.video, '日本語・英語の縦型動画を保存（MP4）')}</li><li>${link(jadeTrailer.poster, '表紙を保存（JPEG）')}</li><li>${link(jadeTrailer.japaneseCaptions, '日本語字幕を保存（VTT）')}</li><li>${link(jadeTrailer.englishCaptions, 'Download English captions (VTT)')}</li></ul>
        </div>${jadePlayer(p.file, 'ja')}
      </section>
      <h3 id="press-trailer">絵巻で見る戦国VS（24秒）</h3>
      <ul class="press-downloads"><li><a href="${esc(trailer.url)}">YouTubeで見る</a></li><li>${link(trailer.video, '24秒の紹介動画を保存（MP4）')}</li><li>${link('assets/promo/sengoku-vs-video-copy-ja-20261126.txt', '動画用のタイトル・説明文を保存（TXT）')}</li></ul>
      <h3 id="press-first-steps">はじめての3手（36秒）</h3>
      <p>${esc(firstSteps.description)} 城下町は5.1.0、武将・地図は5.0.5の画面です。</p>
      <ul class="press-downloads"><li><a href="${esc(firstSteps.url)}">YouTubeで見る</a></li><li>${link(firstSteps.video, '36秒の紹介動画を保存（MP4）')}</li><li>${link(firstSteps.poster, 'はじめての3手のポスターを保存（JPEG）')}</li><li>${link(firstSteps.captions, 'はじめての3手の日本語字幕を保存（VTT）')}</li><li>${link(firstSteps.metadata, '動画仕様・素材情報を保存（JSON）')}</li><li>${link(firstSteps.production, '制作内容・確認結果を保存（Markdown）')}</li></ul>
      <p>36秒の動画とポスター・字幕・素材情報は、<a href="${esc(p.file('assets/promo/sengoku-vs-press-kit-20261126.zip'))}" download>紹介用素材ZIP</a>にも収録しています。</p>
    `),
    section('press-copy', '紹介文・投稿文', '掲載先に合わせて使える日本語の紹介文', `
      <p>紹介文はそのまま読むほか、欄内の文章を選択してコピーできます。文字数は改行を除いた目安です。テキストファイルにも同じ文を収録しています。</p>
      ${copyBlock('press-copy-short', `短い紹介（${characters(copy.short)}字）`, copy.short, 4)}
      ${copyBlock('press-copy-standard', `標準の紹介（${characters(copy.standard)}字）`, copy.standard, 8)}
      ${copyBlock('press-copy-media', `メディア向けの紹介（${characters(copy.media)}字）`, copy.media, 16)}
      <h3>開発・運営者向けの投稿例</h3>
      <p>以下は、開発・運営の立場を明らかにして紹介する文例です。掲載先の投稿ルールに沿って使ってください。</p>
      ${copyBlock('press-post-x', 'X向け・1投稿', copy.x, 8)}
      ${copyBlock('press-post-line', 'LINEで友人へ紹介する文', copy.line, 11)}
      ${copyBlock('press-post-community', 'ゲームコミュニティへの自己紹介文', copy.community, 14)}
      <ul class="press-downloads"><li>${link('assets/promo/sengoku-vs-facts-ja-20261126.txt', '基本情報・紹介文を保存（日本語TXT）')}</li><li>${link('assets/promo/sengoku-vs-posts-ja-20261126.txt', '投稿文3種を保存（日本語TXT）')}</li></ul>
    `),
    section('press-english', 'For international readers', 'English fact sheet', `
      <p class="press-language-note">海外向けに、作品の基本情報を英語でまとめています。ゲームUIと公式ガイドは現在、日本語です。</p>
      <div class="press-english" lang="en">
        <p class="lead-paragraph">${esc(copy.english)}</p>
        ${table('SENGOKU VS at a glance', ['Item', 'Information'], [
          ['Title', 'SENGOKU VS (戦国VS)'],
          ['Developer and publisher', 'KASAI SOLUTIONS'],
          ['Genre', 'Browser strategy game inspired by Japan’s Sengoku period'],
          ['Language', 'Japanese. The game UI and official guides are currently in Japanese.'],
          ['Platforms', 'Desktop, smartphone, and tablet web browsers. No app installation required.'],
          ['Price model', 'Basic play is free. Optional cosmetics and a monthly supporter badge do not provide combat or resource advantages.'],
          ['Content', '256 officers, 129 castles and locations, and 64 facility types'],
          ['Play modes', 'Personal campaigns against computer-controlled factions; online battles, alliances, letters, and trading after registering a lord.'],
          ['Official website', `<a href="${esc(origin)}/">${esc(origin)}/</a>`],
          ['Copyright credit', '© KASAI SOLUTIONS']
        ])}
        <p>Historical people and places inspire the game; character abilities, faction placement, and progression use the game’s own rules. Please include the title, official website, and copyright credit when introducing the game. Third-party source credits are listed on the <a href="${esc(p.dir('about'))}">About page (Japanese)</a>.</p>
      </div>
      <ul class="press-downloads"><li>${link('assets/promo/sengoku-vs-facts-en-20261126.txt', 'English fact sheetを保存（TXT）')}</li></ul>
    `)
  ].join('\n');
}

module.exports = renderPressContent;
module.exports.copy = Object.freeze(copy);
