# 検索向け公開情報・通知の方針と公式出典

確認日：2026年11月21日。正規の公開ドメインは `https://www.kasai-solutions-inc.com/`、運営者・著作権者の表記は **KASAI SOLUTIONS** です。

## v3.13.0 の有料版案内

販売準備中の `/premium/` を公開ページへ追加します。外観アイテムとサポーターの予定内容・税込予定価格を紹介し、全商品を購入不可で表示します。self canonical、OGP、Twitter Card、パンくず、更新日を公開ページに合わせ、サイトマップとIndexNowの対象は6ページに統一します。販売中であると誤認させないよう、予定価格を `Offer` として構造化データへ出力しません。

## v3.12.2 の共有URL・旧ゲーム情報の整理

戦国VS固有の `/sengoku-vs/` を公開5ページへ追加し、canonical・og:url・サイトマップをこのページ自身のURLにそろえます。ゲーム本体と保存・同期の場所は既存トップURLです。旧トップURLに保存されているXのカードとは別の取得先を用意する対応であり、Xのキャッシュ消去完了を意味しません。

旧サイトのOG画像 `/assets/ogp-handheld.png`、関連の旧画像、`/monsters/`・`/moves/` は現在の配信元に存在せず404です。これらのURLはrobots.txtで遮断せず、検索クローラーが削除状態を取得できるようにします。未使用の旧タイトル素材 `assets/title-keyvisual.webp` は配信元から削除しました。

現行OGPは `assets/branding/sengoku-vs-ogp-20261121.jpg`。旧 `assets/ogp.jpg` も同じ戦国VS画像です。ファビコン・ホーム画面用画像・JSON-LDの画像は `site-metadata.json` で管理します。

## v3.9.7 の更新内容（記録）

公開内容の更新日は2026年11月21日、アセットのリリース識別子は `3.9.7-20261121` です。作品名は **戦国VS / SENGOKU VS**、正規ドメインと既存の保存形式・保存キーは維持します。

| 公開情報 | 今回反映する内容 |
| --- | --- |
| トップのタイトル・概要・共有プレビュー | 城下町育成、武将編成、CPU戦役と領主同士の対人戦、ゲーム内の郵便、端末同期 |
| 初心者向けの育成手順 | 天守は城下町から増築、城郭は天下地図から拡張。画面上のボタン名、資源・指令・時間、施設だけの連続予約、役職別条件と成長上限を独立した節で案内 |
| 遊び方の対人戦 | 江戸・駿府は城郭上限64の報酬戦、二条・大坂・名古屋は上限48の占領戦、通常城は上限32の限定襲撃。開始城には大都市5城を選べないことも維持 |
| 遊び方のシステムメール | 共通フィールドの確定した合戦について双方へ各1通。勝敗・被攻撃・戦利品と報酬・占領、本拠移転時の旧城と新城を「交流→郵便」で確認。報酬は戦闘時に反映済みで、この通知に受取操作はない |
| 引き継ぎ・復元 | 同じ領主で接続した後、本拠が変わっている場合は対人戦による移転の通知も確認 |
| 作品情報 | 対人戦と自動通知の概要、詳しいルールへの通常の内部リンク |
| 検索用アイコン | 既存192×192 PNGを再利用。faviconのURLにはリリースごとのクエリを付けず固定 |

機能説明は [共通フィールドの表示](field.js)、[ゲームの状態と成長上限](engine.js)、[サーバーの合戦確定・通知](server/index.js) と照合します。自動メールの説明対象は共通フィールドの対人戦です。天下地図のCPU戦は既存の戦報と履歴で確認します。個々の領主の私信や合戦通知そのものを公開ページに載せることはありません。

## 対象となる公開6ページ

| ページ | 正規URL | 内容 |
| --- | --- | --- |
| 作品トップ | https://www.kasai-solutions-inc.com/ | ゲームの概要と開始入口 |
| 紹介・共有 | https://www.kasai-solutions-inc.com/sengoku-vs/ | 戦国VS固有の共有URLと作品紹介 |
| 有料版・支援 | https://www.kasai-solutions-inc.com/premium/ | 外観アイテム・サポーターの予定内容（販売準備中） |
| 遊び方 | https://www.kasai-solutions-inc.com/guide/ | 操作・成長・同期・追加機能の説明 |
| 引き継ぎ・復元 | https://www.kasai-solutions-inc.com/guide/data-recovery/ | 端末変更、領主データ、権限の復元手順 |
| 作品情報 | https://www.kasai-solutions-inc.com/about/ | 作品・運営者・対応環境について |

ゲーム内の個人データや、表示切り替え用の `#town` などのフラグメントを、別の公開説明ページとしてサイトマップに増やしません。

## 公開情報をそろえる実装方針

- 公開5ページの概要、ページごとのmetadata・構造化データ・canonical、Web App Manifestの作品情報、サイトマップを、共通の `site-metadata.json` から生成します。機能説明や正規URLの修正は共通データへ反映し、出力の食い違いを防ぎます。
- 既存のタイトル画面の構成と画面内への収まりを維持します。検索向けの説明は、利用者にも読める公開HTMLへ掲載します。
- ゲームの概要とガイドは、現在の機能・利用条件と一致させます。ウォーキングの前景計測、軍師AIの実行条件、施設の連続増築なども、利用者が確認できる説明にします。
- `WebSite`、`WebPage`、ゲーム、運営組織の識別子と関係をそろえ、作品名・運営者名・URLを一貫させます。架空のレビュー、評価、件数、受賞歴は追加しません。
- 公開ページを通常の `<a href="…">` でつなぎます。検索用のキーワードを羅列せず、各ページの内容を説明するタイトル・概要を使います。
- 公開ページと理解に必要なJS・CSS・画像を取得できること、不要な `noindex` がないこと、存在しないページが適切なHTTP応答になることを確認します。

GoogleはJavaScriptを実行できますが、クロール・レンダリング・索引登録には別の段階があります。初期HTMLで説明を読める構成と、通常のリンクを優先する根拠は [JavaScript SEOの基本](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics) と [クロール可能なリンク](https://developers.google.com/search/docs/crawling-indexing/links-crawlable) によります。

トップには従来の2行の紹介とゲーム開始入口を保ち、詳しいルールはログイン不要のガイド・作品情報の通常本文へ掲載します。読み込みダイアログ、非表示のゲーム画面、構造化データだけに説明を置きません。見出しと目次から、報酬戦・占領戦およびシステムメールの説明へ移動できます。

タイトルはページごとに簡潔にし、概要はそのページの本文を要約します。検索結果のタイトルや説明文は検索エンジン側で生成され、指定文字列の採用や表示長を保証しません。参照：[タイトルリンク](https://developers.google.com/search/docs/appearance/title-link)、[スニペットとmeta description](https://developers.google.com/search/docs/appearance/snippet)。

faviconは `assets/branding/sengoku-vs-icon-192-20261121.png` の戦国VSの正方形アイコンを使用します。Googleは48×48pxより大きいアイコンを推奨し、URLを頻繁に変えないよう案内しています。ゲームのリリースごとには画像URLを変更せず、公開5ページと404で同じアイコンを指します。参照：[検索結果のfavicon](https://developers.google.com/search/docs/appearance/favicon-in-search)。

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

この更新作業では、Search Consoleの所有権確認、管理画面からのサイトマップ送信、URL検査による登録リクエストを実施していません。公開ファイルの修正と、Search Console上の申請・掲載確認を区別します。

ドメインプロパティの確認にはDNSの操作が必要です。URLプレフィックスの確認には、Googleが該当ユーザーへ発行したHTMLファイルやメタタグなど、選択した方式の実際の確認情報を使います。確認用トークンを推測して代用しません。既存の所有者から権限を付与される方法もあります。

接続後は公開URLを検査し、必要に応じて主要ページのインデックス登録をリクエストします。この操作にはプロパティの所有者またはフルユーザー権限が必要です。ページをまとめて通知する場合はサイトマップを使用します。同じURLへの繰り返し申請でクロールが早まるわけではありません。

参照：[所有権の確認](https://support.google.com/webmasters/answer/9008080?hl=en)、[Googleへの再クロール依頼](https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl)。

### Bing等へのIndexNow

既存の [IndexNow通知CLI](tools/notify-indexnow.mjs) は、**既定では送信しないdry-run**です。引数なしの実行はローカル設定・検証ファイル・サイトマップの6URLだけを調べ、ネットワーク通信を行いません。今回の内容変更対象は上記6URLです。**公開前の検証ではdry-runのみ実施し、送信結果は公開後に別途確認します。**

`--submit` を明示した場合だけ、公開された検証キーファイル、サイトマップ、公開5ページを取得します。HTTP 200、HTML形式、自己参照canonical、検索除外指定がないことを確認してから、`https://api.indexnow.org/indexnow` へ5URLをまとめて1回POSTします。ホストと対象URLは固定し、転送先には追従せず、失敗時の自動再送もしません。

この事前確認は、公開ページの本文やリリース版まで照合するものではありません。実行者は新しい本文が公開済みであることを別途確認する必要があります。HTTP 200は受領、202は受領してキー検証待ち、429や通信失敗は別の結果として扱います。この文書は送信完了や受理を先取りして記録するものではありません。

キーは提出するURLと同じホスト上で検証できる必要があります。IndexNowはBingなどの参加検索エンジンへの変更通知です。Googleへの通知としては扱いません。HTTP 200等の受理結果と、クロール・索引登録・検索結果への掲載は別です。実施時の応答を確認し、未送信・受理・掲載確認の状態を区別します。

参照：[Bingの導入案内](https://www.bing.com/indexnow/getstarted)、[IndexNowの仕様](https://www.indexnow.org/documentation)、[参加先・送信・制限のFAQ](https://www.indexnow.org/faq)。

### 使用しない申請方法

- Google Indexing APIは、`JobPosting` または `VideoObject` 内の `BroadcastEvent` を持つページ向けです。このゲームの一般公開ページには使用しません。[公式の適用条件](https://developers.google.com/search/apis/indexing-api/v3/using-api)
- Googleの旧サイトマップpingエンドポイントは廃止済みです。そこへの送信を申請完了として扱いません。[廃止の公式案内](https://developers.google.com/search/blog/2023/06/sitemaps-lastmod-ping)

## 検証と記録の範囲

生成後の検証では、共通データと公開HTML・metadata・構造化データ・canonical・Manifest・サイトマップの一致、通常リンク、更新日を確認します。公開後には、対象URLと必要なファイルの取得結果を別途確認します。これらは検索エンジン側の索引登録、検索順位、リッチリザルト掲載の保証ではありません。

`tests/test-seo.cjs` は公開データの一致とモック通信によるIndexNowの挙動を確認します。`tests/test-public-pages.cjs` は生成HTMLを読み、内部リンク・節リンク・公開アセット・Googlebot/Bingbotからのクロール可否・404の検索除外を確認します。自動メールや成長上限の説明は、JavaScriptを実行しないHTML本文にあることも検証します。

`site:` 検索は補助的な観測です。一致結果が見つからなくても未登録とは断定せず、GoogleのURL検査やBing Webmaster Toolsでの状態確認と区別します。参照：[Googleのsite検索演算子と制限](https://developers.google.com/search/docs/monitor-debug/search-operators/all-search-site)。
