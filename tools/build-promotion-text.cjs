'use strict';

// Keep downloadable copy aligned with the visible press page and verified media.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const site = require('../site-metadata.json');
const { copy } = require('./press-content.cjs');
const { releases } = require('./news-content.cjs');
const latestRelease = releases.find(item => item.version === site.version) || releases[0];
const { trailer, firstSteps, jadeTrailer } = require('./promotion-content.cjs');
const args = process.argv.slice(2);
if (args.length && (args.length !== 1 || args[0] !== '--check')) {
  console.error('Usage: node tools/build-promotion-text.cjs [--check]');
  process.exit(1);
}
const checkOnly = args[0] === '--check';
const outputs = new Map();
const characters = value => Array.from(value.replace(/\r?\n/g, '')).length;
const updatedDate = site.dateModified;
const updatedDateJapanese = updatedDate.replace(/^(\d{4})-(\d{2})-(\d{2})$/, (_, year, month, day) => `${year}年${Number(month)}月${Number(day)}日`);
// Keep the existing download URLs stable while updating their contents.
const output = (name, text) => outputs.set('assets/promo/' + name + '-20261126.txt', text.trim() + '\n');
const newsLinks = site.pages.news ? `\n更新情報: ${site.origin}${site.pages.news.path}\n更新情報のRSS: ${site.origin}${site.pages.news.path}feed.xml` : '';
const videoLinksJapanese = `最新の紹介動画: ${jadeTrailer.title}（${jadeTrailer.seconds}秒・日本語／英語字幕）\n${jadeTrailer.url}\n公式イラストと実ゲーム画面を使った紹介です。\n\nはじめての3手（${firstSteps.seconds}秒・日本語）\n${firstSteps.url}\n過去バージョンの撮影用デモの実ゲーム静止画を使った紹介です。プレイ録画ではありません。\n\n絵巻で見る戦国VS（24秒・日本語）\n${trailer.url}\n公式イラストを使った作品紹介です。`;
const publicLinks = `公式サイト: ${site.origin}/\nゲーム紹介: ${site.origin}/sengoku-vs/\n英語の紹介・始め方: ${site.origin}/en/\n紹介・掲載用素材: ${site.origin}/press/\n公開済み紹介動画:\n${videoLinksJapanese}\n\n遊び方: ${site.origin}/guide/\n引き継ぎ: ${site.origin}/guide/data-recovery/${newsLinks}`;

output('sengoku-vs-facts-ja', `戦国VS（SENGOKU VS） 紹介・掲載用 基本情報
更新日: ${updatedDateJapanese}
公開版: Ver.${site.version}
最新更新: ${latestRelease.title}
${latestRelease.summary}

キャッチコピー: 一城から、天下へ。
制作・運営: KASAI SOLUTIONS
著作権表記: © KASAI SOLUTIONS
ジャンル: 戦国戦略シミュレーション・ブラウザゲーム
${publicLinks}

対応端末: PC・スマートフォン・タブレットのブラウザ。アプリのインストール不要。
表示言語: ゲームUIと詳細ガイドは日本語です。SENGOKU VSは作品名の英字表記で、英語の紹介・開始ガイドも利用できます。
料金: 基本プレイ無料。外観アイテム、月額サポーター、30日間の武将再抽選パスは任意です。
有料商品の内容: 旗印・城下町の外観・勲章、月額サポーター、武将再抽選パス。外観アイテムとサポーター特典は装飾です。武将再抽選パスは480円（税込）で実時間30日間、1人招集を1日3回まで引き直し、元と新しい武将から1人を選べるため、武将の獲得結果に影響します。勾玉そのものの販売はありません。月額サポーターは780円（税込）で、支払済み期間ごとに装飾3種から1種を選び、解約後も所持・装備できます。
料金・商品: ${site.origin}/premium/
収録内容: 256人の武将と24人の公家、129の城と拠点、64種類の城下町施設。
遊び方: 個人の戦役ではCPU勢力と対戦。領主を登録すると共通フィールドの対人戦・同盟・書状・交易を利用できます。
引き継ぎ: 同じ領主へ登録・連携して端末間で進行を同期。操作する端末は同時に1台です。
作品設定: 史実を題材にしたゲーム独自の人物能力・勢力配置・成長ルールを使用しています。

${[['短い紹介',copy.short],['標準の紹介',copy.standard],['メディア向けの紹介',copy.media]].map(([label,text]) => `${label}（${characters(text)}字・改行除く）\n${text}`).join('\n\n')}

紹介素材の利用について
作品紹介の際は、作品名「戦国VS」、公式URL ${site.origin}/ 、© KASAI SOLUTIONSを添えてください。
人物・地図・家紋など第三者資料の出典は、作品概要と制作資料をご確認ください。
${site.origin}/about/

© KASAI SOLUTIONS`);

output('sengoku-vs-posts-ja', `戦国VS（SENGOKU VS） 日本語投稿文
更新日: ${updatedDateJapanese}

開発・運営の立場を明らかにして紹介するための文例です。
掲載先の投稿ルールに沿って使ってください。

${[['X向け・1投稿',copy.x],['LINEで友人へ紹介する文',copy.line],['ゲームコミュニティへの自己紹介文',copy.community]].map(([label,text]) => `${label}\n${text}`).join('\n\n')}

公開済み紹介動画
${videoLinksJapanese}

紹介素材と作品情報
${site.origin}/press/${newsLinks}

© KASAI SOLUTIONS`);

output('sengoku-vs-facts-en', `SENGOKU VS — Official fact sheet
Updated: ${updatedDate}
Version: ${site.version}

${copy.english}

Title: SENGOKU VS (戦国VS)
Developer and publisher: KASAI SOLUTIONS
Genre: Browser strategy game inspired by Japan’s Sengoku period
Language: Japanese game interface and detailed guides. English introduction and starting guide available.
Platforms: Desktop, smartphone, and tablet web browsers
Price model: Basic play is free. Optional purchases include cosmetics, a ¥780/month supporter plan with one permanent cosmetic choice per paid billing period, and a ¥480 non-renewing 30-day officer reroll pass. The reroll pass affects officer acquisition; jade itself is not sold.
Content: 256 officers and 24 court nobles, 129 castles and locations, and 64 facility types
Court-rank benefit: Rice production gains 0–32% across 17 ranks. The bonus is calculated before upkeep and surplus adjustment, follows the current rank, and requires no purchase.
Play modes: Personal campaigns against computer-controlled factions; online battles, alliances, letters, and trading after registering a lord.
Official website: ${site.origin}/
English introduction and starting guide: ${site.origin}/en/
Japanese game introduction: ${site.origin}/sengoku-vs/
Press kit: ${site.origin}/press/
Latest introduction video: ${jadeTrailer.englishTitle} (${jadeTrailer.seconds} seconds, Japanese and English captions)
${jadeTrailer.url}
Your first three moves (${firstSteps.seconds} seconds, Japanese): ${firstSteps.url}
Illustrated introduction (24 seconds, Japanese): ${trailer.url}
${site.pages.news ? `Official updates: ${site.origin}${site.pages.news.path}\nUpdates RSS: ${site.origin}${site.pages.news.path}feed.xml\n` : ''}

The ${jadeTrailer.seconds}-second video combines official illustrations and actual game screens, with Japanese and English captions. The ${firstSteps.seconds}-second video uses demo-progress screenshots from earlier versions with pans and zooms; it is not gameplay footage. The 24-second video uses official illustrations. Versioned game screenshots are provided separately in the press kit. The game interface and detailed guides are in Japanese; the English starting guide explains the first steps.
Historical people and places inspire the game; character abilities, faction placement, and progression use the game’s own rules.
Please include the title, official website, and copyright credit when introducing the game.
Third-party source credits: ${site.origin}/about/

© KASAI SOLUTIONS`);

const outdated = [];
let changed = 0;
for (const [relative, contents] of outputs) {
  const file = path.join(root, relative);
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === contents) continue;
  if (checkOnly) { outdated.push(relative); continue; }
  fs.mkdirSync(path.dirname(file), {recursive:true});
  fs.writeFileSync(file, contents, 'utf8');
  changed++;
}
if (checkOnly) {
  if (outdated.length) {
    console.error('Promotion text differs from current site metadata and public copy: ' + outdated.join(', '));
    process.exitCode = 1;
  } else console.log(`PASS ${outputs.size} promotion text files match current site metadata and public copy.`);
} else console.log(`Generated ${outputs.size} promotion text files; ${changed} changed.`);
