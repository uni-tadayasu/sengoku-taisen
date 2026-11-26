'use strict';

// Keep downloadable copy aligned with the visible press page and verified media.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const site = require('../site-metadata.json');
const { copy } = require('./press-content.cjs');
const { trailer } = require('./promotion-content.cjs');
const characters = value => Array.from(value.replace(/\r?\n/g, '')).length;
const updatedDate = site.dateModified;
const updatedDateJapanese = updatedDate.replace(/^(\d{4})-(\d{2})-(\d{2})$/, (_, year, month, day) => `${year}年${Number(month)}月${Number(day)}日`);
const output = (name, text) => fs.writeFileSync(path.join(root, 'assets/promo', name + '-20261126.txt'), text.trim() + '\n');
const newsLinks = site.pages.news ? `\n更新情報: ${site.origin}${site.pages.news.path}\n更新情報のRSS: ${site.origin}${site.pages.news.path}feed.xml` : '';
const publicLinks = `公式サイト: ${site.origin}/\nゲーム紹介: ${site.origin}/sengoku-vs/\n紹介・掲載用素材: ${site.origin}/press/\n公開済み紹介動画: ${trailer.url}\n遊び方: ${site.origin}/guide/\n引き継ぎ: ${site.origin}/guide/data-recovery/${newsLinks}`;

output('sengoku-vs-facts-ja', `戦国VS（SENGOKU VS） 紹介・掲載用 基本情報
更新日: ${updatedDateJapanese}
公開版: Ver.${site.version}

キャッチコピー: 一城から、天下へ。
制作・運営: KASAI SOLUTIONS
著作権表記: © KASAI SOLUTIONS
ジャンル: 戦国戦略シミュレーション・ブラウザゲーム
${publicLinks}

対応端末: PC・スマートフォン・タブレットのブラウザ。アプリのインストール不要。
表示言語: 日本語。SENGOKU VSは作品名の英字表記です。ゲームUIと公式ガイドは現在日本語です。
料金: 基本プレイ無料。有料の外観アイテムと月額支援は任意です。
有料商品の内容: 旗印・城下町の外観・勲章・サポーターバッジ。武将の能力、兵力、生産量、指令回復の優遇はありません。
料金・商品: ${site.origin}/premium/
収録内容: 256人の武将、129の城と拠点、64種類の城下町施設。
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
${trailer.url}

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
Language: Japanese
Platforms: Desktop, smartphone, and tablet web browsers
Price model: Basic play is free. Optional cosmetics and a monthly supporter badge do not provide combat or resource advantages.
Content: 256 officers, 129 castles and locations, and 64 facility types
Play modes: Personal campaigns against computer-controlled factions; online battles, alliances, letters, and trading after registering a lord.
Official website: ${site.origin}/
Game introduction: ${site.origin}/sengoku-vs/
Press kit: ${site.origin}/press/
Published introduction video: ${trailer.url}
${site.pages.news ? `Official updates: ${site.origin}${site.pages.news.path}\nUpdates RSS: ${site.origin}${site.pages.news.path}feed.xml\n` : ''}

The 24-second introduction uses official illustrations. Actual gameplay screenshots are provided separately in the press kit.
Historical people and places inspire the game; character abilities, faction placement, and progression use the game’s own rules.
Please include the title, official website, and copyright credit when introducing the game.
Third-party source credits: ${site.origin}/about/

© KASAI SOLUTIONS`);

console.log('Wrote Japanese fact sheet, three social post examples, and English fact sheet from the public source.');
