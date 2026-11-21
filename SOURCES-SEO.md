# 検索向け公開ページの更新方針

確認日：2026年11月21日。対象は `https://www.kasai-solutions-inc.com/` と、公開されている遊び方・データ復元・作品情報の各ページです。

## 今回の実装

- ゲームの説明・OGP・構造化データを現在の機能と一致させる。
- 作品トップの WebPage・WebSite・VideoGame・運営組織を同じ識別子で関連付ける。架空のレビュー・評価・受賞歴は記載しない。
- 遊び方を静的なHTMLで公開し、周回報酬、拠点リセット、御触書、同期、音声の説明を更新する。
- 既存フッターの作品情報を通常のリンクとして辿れるようにする。サイト内リンク・canonical・sitemap は同じwwwドメインへ統一する。
- 公開ガイドに実際の内容更新日と WebPage の dateModified を付ける。sitemap の lastmod は内容変更に合わせて管理し、ビルドのたびに更新しない。
- ページごとのタイトル・説明、パンくず、画像の代替テキスト・寸法、モバイル表示、robots、404を維持・検証する。

## 参照した公式情報

1. [Google Search Essentials](https://developers.google.com/search/docs/essentials)
2. [Google：canonical の指定](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)
3. [Google：サイトマップの作成と送信](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
4. [Google：構造化データの一般ガイドライン](https://developers.google.com/search/docs/appearance/structured-data/sd-policies)
5. [Google：AI機能とウェブサイト](https://developers.google.com/search/docs/appearance/ai-features)
6. [Bing Webmaster Guidelines](https://www.bing.com/webmasters/help/webmaster-guidelines-30fba23a)

GoogleのAI機能にも通常の検索向け基盤が使われます。専用のAIテキストファイルや特別な構造化データを追加する要件はありません。公開内容に合う説明と、検索エンジンがアクセスできる静的ページを優先しています。

## 確認範囲

ローカルの公開ページ検証でcanonical・構造化データのJSON・ローカルリンク・サイトマップを確認します。これは検索エンジン側のインデックス登録、検索順位、リッチリザルト掲載を保証するものではありません。Search Console / Bing Webmaster Tools の所有権確認や管理画面でのサイトマップ送信は、実行済みとして扱いません。
