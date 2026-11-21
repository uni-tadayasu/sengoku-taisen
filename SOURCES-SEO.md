# 検索向け公開情報・通知の方針と公式出典

確認日：2026年11月21日。正規の公開ドメインは `https://www.kasai-solutions-inc.com/`、運営者・著作権者の表記は **KASAI SOLUTIONS** です。

## 対象となる公開4ページ

| ページ | 正規URL | 内容 |
| --- | --- | --- |
| 作品トップ | https://www.kasai-solutions-inc.com/ | ゲームの概要と開始入口 |
| 遊び方 | https://www.kasai-solutions-inc.com/guide/ | 操作・成長・同期・追加機能の説明 |
| 引き継ぎ・復元 | https://www.kasai-solutions-inc.com/guide/data-recovery/ | 端末変更、領主データ、権限の復元手順 |
| 作品情報 | https://www.kasai-solutions-inc.com/about/ | 作品・運営者・対応環境について |

ゲーム内の個人データや、表示切り替え用の `#town` などのフラグメントを、別の公開説明ページとしてサイトマップに増やしません。

## 公開情報をそろえる実装方針

- 公開4ページの概要、ページごとのmetadata・構造化データ・canonical、Web App Manifestの作品情報、サイトマップを、共通の `site-metadata.json` から生成します。機能説明や正規URLの修正は共通データへ反映し、出力の食い違いを防ぎます。
- 既存のタイトル画面の構成と画面内への収まりを維持します。検索向けの説明は、利用者にも読める公開HTMLへ掲載します。
- ゲームの概要とガイドは、現在の機能・利用条件と一致させます。ウォーキングの前景計測、軍師AIの実行条件、施設の連続増築なども、利用者が確認できる説明にします。
- `WebSite`、`WebPage`、ゲーム、運営組織の識別子と関係をそろえ、作品名・運営者名・URLを一貫させます。架空のレビュー、評価、件数、受賞歴は追加しません。
- 公開ページを通常の `<a href="…">` でつなぎます。検索用のキーワードを羅列せず、各ページの内容を説明するタイトル・概要を使います。
- 公開ページと理解に必要なJS・CSS・画像を取得できること、不要な `noindex` がないこと、存在しないページが適切なHTTP応答になることを確認します。

GoogleはJavaScriptを実行できますが、クロール・レンダリング・索引登録には別の段階があります。初期HTMLで説明を読める構成と、通常のリンクを優先する根拠は [JavaScript SEOの基本](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics) と [クロール可能なリンク](https://developers.google.com/search/docs/crawling-indexing/links-crawlable) によります。

## 更新日と正規URL

ページの `dateModified` とサイトマップの `lastmod` は、本文、構造化データ、主要リンクなどの実際の内容更新に合わせます。ビルドを実行しただけで全ページの日付を更新しません。ゲーム時計や個人資産の変化を、公開説明ページの更新日にはしません。変更日を確実に特定できない場合は、推測の日付を入れず `lastmod` を省略できます。

Googleは正確な `lastmod` を利用し、`priority` と `changefreq` は使用しません。参照：[サイトマップの作成と送信](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)、[lastmodの扱いと旧pingの廃止](https://developers.google.com/search/blog/2023/06/sitemaps-lastmod-ping)。

内部リンク、自己参照canonical、サイトマップ、構造化データの公開URLは、同じHTTPS・wwwドメインに統一します。旧ドメインや別ホストを管理できる場合は、対応する新URLへの恒久リダイレクトを検討します。`robots.txt` による拒否は正規化の代わりになりません。リダイレクトやSearch Consoleのアドレス変更手続きは、実際の設定・所有権を確認してから実施し、この文書で完了済みとは扱いません。

参照：[canonicalの指定](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)、[サイト移転の手順](https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes)。

## 構造化データと検索での表示

トップページの `WebSite` に作品のサイト名と正規URLを示し、画面上の名称とそろえます。別名を示す場合は実際の名称を使います。Googleのサイト名機能はRich Results Testの対象ではないため、構文検証とURL検査を使い分けます。参照：[検索結果のサイト名](https://developers.google.com/search/docs/appearance/site-names)。

ゲームの構造化データは作品の内容を正しく説明するために使用します。GoogleのSoftware Appリッチリザルトは `VideoGame` 単独では対象にならず、対応するアプリ型との併記などの条件があります。また、名前・価格のほか、実在する評価またはレビューが必要です。評価未収集の状態を架空の星や件数で埋めず、リッチリザルトの掲載を約束しません。

参照：[SoftwareApplicationの要件](https://developers.google.com/search/docs/appearance/structured-data/software-app)、[構造化データの共通ガイドライン](https://developers.google.com/search/docs/appearance/structured-data/sd-policies)。

## 検索エンジンへの通知と現在の実施条件

### Google Search Console

本更新の時点で、Search Consoleの所有確認トークン・操作権限は未接続です。所有権確認、管理画面からのサイトマップ送信、URL検査による登録リクエストは**未申請**として扱います。

ドメインプロパティの確認にはDNSの操作が必要です。URLプレフィックスの確認には、Googleが該当ユーザーへ発行したHTMLファイルやメタタグなど、選択した方式の実際の確認情報を使います。確認用トークンを推測して代用しません。既存の所有者から権限を付与される方法もあります。

接続後は公開URLを検査し、必要に応じて主要ページのインデックス登録をリクエストします。この操作にはプロパティの所有者またはフルユーザー権限が必要です。ページをまとめて通知する場合はサイトマップを使用します。同じURLへの繰り返し申請でクロールが早まるわけではありません。

参照：[所有権の確認](https://support.google.com/webmasters/answer/9008080?hl=en)、[Googleへの再クロール依頼](https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl)。

### Bing等へのIndexNow

IndexNowは公開ホストに置く検証用キーファイルと、**既定では送信しないdry-runのCLI**を用意する方針です。今回の変更対象は上記4URLです。**送信は公開成功後の別工程**とし、公開された検証ファイル・URL・変更対象を確認してから、実際に変更されたURLだけを通知します。この文書は送信完了や受理を先取りして記録するものではありません。

キーは提出するURLと同じホスト上で検証できる必要があります。IndexNowはBingなどの参加検索エンジンへの変更通知です。Googleへの通知としては扱いません。HTTP 200等の受理結果と、クロール・索引登録・検索結果への掲載は別です。実施時の応答を確認し、未送信・受理・掲載確認の状態を区別します。

参照：[Bingの導入案内](https://www.bing.com/indexnow/getstarted)、[IndexNowの仕様](https://www.indexnow.org/documentation)、[参加先・送信・制限のFAQ](https://www.indexnow.org/faq)。

### 使用しない申請方法

- Google Indexing APIは、`JobPosting` または `VideoObject` 内の `BroadcastEvent` を持つページ向けです。このゲームの一般公開ページには使用しません。[公式の適用条件](https://developers.google.com/search/apis/indexing-api/v3/using-api)
- Googleの旧サイトマップpingエンドポイントは廃止済みです。そこへの送信を申請完了として扱いません。[廃止の公式案内](https://developers.google.com/search/blog/2023/06/sitemaps-lastmod-ping)

## 検証と記録の範囲

生成後の検証では、共通データと公開HTML・metadata・構造化データ・canonical・Manifest・サイトマップの一致、通常リンク、更新日を確認します。公開後には、対象URLと必要なファイルの取得結果を別途確認します。これらは検索エンジン側の索引登録、検索順位、リッチリザルト掲載の保証ではありません。

`site:` 検索は補助的な観測です。一致結果が見つからなくても未登録とは断定せず、GoogleのURL検査やBing Webmaster Toolsでの状態確認と区別します。参照：[Googleのsite検索演算子と制限](https://developers.google.com/search/docs/monitor-debug/search-operators/all-search-site)。
