# 検索向け公開情報・通知の方針と公式出典

## 2026年11月26日：ブランド画像・サイト概要・国内向け紹介素材の更新

正規の公開ドメインは `https://www.kasai-solutions-inc.com/`、作品名は **戦国VS / SENGOKU VS**、運営者・著作権者は **KASAI SOLUTIONS** です。現在の公開用データは `site-metadata.json` を正とします。以下に残すバージョン別の記録は、各変更時点の履歴であり、現行の商品状態・ゲーム仕様・画像パスを指定するものではありません。

### v5.0.5：紹介・掲載用素材と共有導線

国内の新規プレイヤーへ作品を紹介するため、公開用ソースに `/press/` を追加しました。リリース識別子は `5.0.5-20261126`、バージョンは `5.0.5` です。この文書にはコードと配布素材の変更を記録し、配信結果はGitHub ActionsのPagesデプロイ履歴で確認します。

| ページ | 正規URLのパス | 内容 |
| --- | --- | --- |
| ゲーム本体 | `/` | 作品の概要と開始入口 |
| 紹介・共有 | `/sengoku-vs/` | 遊びの紹介、よくある質問、利用者が操作する共有導線 |
| プレミアム・支援 | `/premium/` | 任意の外観アイテムと月額支援の案内 |
| 遊び方 | `/guide/` | 操作、内政、合戦、交流などの説明 |
| 引き継ぎ・復元 | `/guide/data-recovery/` | 保存、端末変更、領主データの引き継ぎ手順 |
| 作品概要 | `/about/` | 作品データ、運営者、対応環境、制作資料 |
| 紹介・掲載用素材 | `/press/` | 紹介文、公式画像、動画、配布テキスト |

7ページの自己参照canonical、ページ情報、通常の内部リンク、サイトマップを共通データからそろえます。`/press/` の本文は `tools/press-content.cjs` にあり、紹介文、作品データ、素材へのリンクはJavaScriptを実行せずに読めます。コピー機能と端末の共有機能は `promotion-share.js` で補助し、X・LINEの共有リンクを含め、利用者の操作から開始します。自動投稿や「共有済み」とみなす処理はありません。

`assets/promo/` に日本語の作品概要・紹介文と投稿文、動画用タイトル・説明文、英語のfact sheet、実ゲーム画面4枚を用意し、公式画像・紋章・TXTとともにZIPへ収録しました。実ゲーム画面は隔離したローカルデモの1363×936px JPEGで、撮影条件とファイル情報を [撮影記録](assets/promo/screenshots/manifest.json) に保存しています。別配布の24秒の縦型動画は、公式イラストを使用した紹介であることを画面内に明示し、制作根拠を [VIDEO-PRODUCTION.md](assets/promo/VIDEO-PRODUCTION.md) と[実測情報・素材一覧](assets/promo/sengoku-vs-intro-ja-20261126.json)に保存しています。素材作成と公開ページへの組み込みは、外部のSNS投稿や掲載申請の完了を意味しません。外部SNSへの投稿・ゲーム紹介サイトへの掲載申請は未送信です。

ゲームUIと公式ガイドは日本語です。`/press/#press-english` と英語TXTは海外の紹介者が作品を理解するための補助資料であり、英語版ゲームや独立した英語ページとして扱いません。英語対応を示す `hreflang` や別のcanonicalは追加しません。

### アイコンと共有画像

- 墨色、金の城と軍扇、朱の旭日を使う紋章に統一。favicon は小さな表示用の SVG と 32px PNG、検索・高密度表示用の 192px PNG を指定します。ルートの `favicon.ico` は **16・32・48・96・192px** の実画像を収録します。
- ホーム画面用は通常の **192・512px PNG** と **180px Apple touch icon**。Android等の形状変更に備え、背景が不透明な専用 **512px maskable icon** を分けて用意します。主要な図案は中央の半径40%の安全円内へ収めます。Safari pinned tab 用は単色 SVG と明示色を使用します。
- favicon のURLにはゲームバージョンのクエリを付けません。今回の図案変更を区切りに `20261126` のパスへ切り替え、以降、図案が変わらないリリースでは同じURLを使います。ルートの `favicon.ico` と `apple-touch-icon.png` も現行図案にそろえます。
- OGPは **1200×630px JPEG**。トップ・ゲーム紹介は共通の作品画像、遊び方・引き継ぎ・作品概要・プレミアムには内容別の共有画像を設定します。`og:image`、`twitter:image`、画像のMIME型・実寸・代替テキストを対応させます。各画像はプロジェクトの配信予算として1MiB未満にします。

Googleのfavicon仕様は、正方形、最低8px、48pxより大きい画像の推奨、取得可能な画像と安定したURLを定めています。Google検索での表示は保証されません。[Google：検索結果のfavicon](https://developers.google.com/search/docs/appearance/favicon-in-search)

maskableの安全領域は中央を中心とする半径2/5の円です。通常アイコンと専用maskableを分け、図案の欠けと端末側の白い背景の付加を避けます。[W3C Web Application Manifest：Icon masks and safe zone](https://www.w3.org/TR/appmanifest/#icon-masks)、[web.dev：maskable icons](https://web.dev/articles/maskable-icon)

Open Graphは画像の型・寸法を補助プロパティで示し、画像がある場合は内容を説明する `og:image:alt` の指定を勧めています。[Open Graph protocol](https://ogp.me/)

### サイト概要と検索情報

公開用ソースの7ページのタイトル・概要・本文、canonical、OGP・Twitter Card、JSON-LD、Web App Manifestとサイトマップを同じ公開用データにそろえます。遊び方や作品の説明はJavaScriptを実行しなくても読めるHTML本文として掲載し、通常の内部リンクで到達できるようにします。

サイト名はホームページの `WebSite` 構造化データと画面上の **戦国VS** に統一します。ページ別タイトルと概要は実際の内容を説明し、レビュー件数・星・受賞歴・検索機能など、存在しない情報は追加しません。ゲームの構造化データは内容理解を助けるためのもので、Software Appのリッチリザルトの掲載を約束するものではありません。[Google：サイト名](https://developers.google.com/search/docs/appearance/site-names)、[タイトルリンク](https://developers.google.com/search/docs/appearance/title-link)、[スニペット](https://developers.google.com/search/docs/appearance/snippet)、[構造化データの共通要件](https://developers.google.com/search/docs/appearance/structured-data/sd-policies)

サイトマップには正規URLを載せ、更新日は実際に主要な内容を更新した日とします。ゲーム内の資産変動や単なるビルド時刻で `lastmod` を更新しません。[Google：サイトマップの作成](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)、[canonicalの指定](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)

### 公開前の検証と更新後の扱い

`node tools/build-public-pages.cjs --check` で公開文書と生成元の一致を確認します。`tests/test-seo.cjs` は画像実体と宣言寸法、SVGの自己完結性、ICOの5サイズ、maskableの不透明性、ページ別情報と構造化データ、モックによるIndexNow通信を検証します。公開リンク、レスポンシブ画像、現在のブランドのキャッシュ、オフライン用アセットと公開ページの制約は既存テストで確認し、`.github/workflows/brand-seo.yml` から同じ検証を実行します。CIから検索エンジンへ通知は送りません。

公開の完了、検索エンジンへの更新通知、検索結果への反映はそれぞれ確認対象が異なります。この文書自体はSearch Consoleへの申請完了・インデックス登録・SNSキャッシュ更新を示しません。検索結果の名称・概要・faviconは再取得と再処理を経て反映されるため、指定文字列の採用・順位・即時反映は保証しません。[Google：再クロールのリクエスト](https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl)

## 過去の実装記録

以下は2026年11月22日までに記録した設計経緯です。現行の仕様・価格・画像は上の更新項目と公開用データを参照してください。

## v3.22.0 の京都御所・参内と謁見・支拠点

公開ガイドの `#court` に、従五位（35,000点）からの参内、談話、本人と担当者だけが確認できる謁見、京都御所から江戸城への役職条件を追加しました。城郭上限は京都御所128・江戸64・二条／大坂／名古屋48・通常城32、地図は129拠点、開始候補は124城へそろえています。ページの概要・構造化データ・アプリの説明も公開内容に合わせ、役職者の個人ID・非公開の会話・管理名簿は含めません。canonicalとサイトマップの6ページ構成は維持します。

公開ガイドの `#branches` には、江戸4か所・Lv.8、二条／大坂／名古屋各2か所・Lv.24、京都御所は支拠点なしという条件、東西南北の建設、全支拠点を先に落とす攻略順、陥落後の修復を追加しました。作品紹介と概要にも大都市の支拠点攻略を反映しています。

## v3.19.0 の派遣部隊・レスポンシブ更新

公開されている機能に合わせ、トップ・作品紹介・共有ページ・遊び方の概要を更新します。遊び方には、通常のHTML本文と目次リンクで「派遣部隊」の節を追加し、雇用・偵察・駐留・撤収・反撃の条件を案内します。個別プレイヤーの偵察報告・部隊配置・非公開の識別情報を公開説明や構造化データへ出力しません。

同じURLとHTMLを使い、画面幅に応じてメニューや操作欄を配置します。スマートフォンでも案内本文と主要リンクを維持します。参照：[Googleのモバイルサイトとモバイルファーストインデックス](https://developers.google.com/search/docs/crawling-indexing/mobile/mobile-sites-mobile-first-indexing)。

`site-metadata.json` の作品情報・ページ別概要・正規URLを基に、公開6ページのタイトル・meta description・OGP・Twitter Card・JSON-LDとサイトマップを再生成します。共有ページも実際の本文を更新したため更新日を2026年11月22日へ進め、内容の変わらないページにビルド時刻だけを付けません。`#covert` は既存ガイドの節へのリンクで、独立した索引ページとしてサイトマップには追加しません。

公開ソースの変更、検索エンジンへの通知、検索結果への反映はそれぞれ別の段階です。タイトルの採用・検索順位・反映時期は保証しません。以下の旧版見出しは過去の設計記録です。

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

## 当時の公開6ページ（旧記録）

| ページ | 正規URL | 内容 |
| --- | --- | --- |
| 作品トップ | https://www.kasai-solutions-inc.com/ | ゲームの概要と開始入口 |
| 紹介・共有 | https://www.kasai-solutions-inc.com/sengoku-vs/ | 戦国VS固有の共有URLと作品紹介 |
| 有料版・支援 | https://www.kasai-solutions-inc.com/premium/ | 外観アイテム・サポーターの予定内容（販売準備中） |
| 遊び方 | https://www.kasai-solutions-inc.com/guide/ | 操作・成長・同期・追加機能の説明 |
| 引き継ぎ・復元 | https://www.kasai-solutions-inc.com/guide/data-recovery/ | 端末変更、領主データ、権限の復元手順 |
| 作品情報 | https://www.kasai-solutions-inc.com/about/ | 作品・運営者・対応環境について |

ゲーム内の個人データや、表示切り替え用の `#town` などのフラグメントを、別の公開説明ページとしてサイトマップに増やしません。

## 公開情報をそろえる実装方針（旧記録）

- 公開6ページの概要、ページごとのmetadata・構造化データ・canonical、Web App Manifestの作品情報、サイトマップを、共通の `site-metadata.json` から生成します。機能説明や正規URLの修正は共通データへ反映し、出力の食い違いを防ぎます。
- 既存のタイトル画面の構成と画面内への収まりを維持します。検索向けの説明は、利用者にも読める公開HTMLへ掲載します。
- ゲームの概要とガイドは、現在の機能・利用条件と一致させます。ウォーキングの前景計測、軍師AIの実行条件、施設の連続増築なども、利用者が確認できる説明にします。
- `WebSite`、`WebPage`、ゲーム、運営組織の識別子と関係をそろえ、作品名・運営者名・URLを一貫させます。架空のレビュー、評価、件数、受賞歴は追加しません。
- 公開ページを通常の `<a href="…">` でつなぎます。検索用のキーワードを羅列せず、各ページの内容を説明するタイトル・概要を使います。
- 公開ページと理解に必要なJS・CSS・画像を取得できること、不要な `noindex` がないこと、存在しないページが適切なHTTP応答になることを確認します。

GoogleはJavaScriptを実行できますが、クロール・レンダリング・索引登録には別の段階があります。初期HTMLで説明を読める構成と、通常のリンクを優先する根拠は [JavaScript SEOの基本](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics) と [クロール可能なリンク](https://developers.google.com/search/docs/crawling-indexing/links-crawlable) によります。

トップには従来の2行の紹介とゲーム開始入口を保ち、詳しいルールはログイン不要のガイド・作品情報の通常本文へ掲載します。読み込みダイアログ、非表示のゲーム画面、構造化データだけに説明を置きません。見出しと目次から、報酬戦・占領戦およびシステムメールの説明へ移動できます。

タイトルはページごとに簡潔にし、概要はそのページの本文を要約します。検索結果のタイトルや説明文は検索エンジン側で生成され、指定文字列の採用や表示長を保証しません。参照：[タイトルリンク](https://developers.google.com/search/docs/appearance/title-link)、[スニペットとmeta description](https://developers.google.com/search/docs/appearance/snippet)。

faviconは `assets/branding/sengoku-vs-icon-192-20261121.png` の戦国VSの正方形アイコンを使用します。Googleは48×48pxより大きいアイコンを推奨し、URLを頻繁に変えないよう案内しています。ゲームのリリースごとには画像URLを変更せず、公開6ページと404で同じアイコンを指します。参照：[検索結果のfavicon](https://developers.google.com/search/docs/appearance/favicon-in-search)。

## 共通方針：更新日と正規URL

以下は現行の公開用ソースにも適用する方針です。現在のページ数・配布素材は冒頭のv5.0.5の記録を参照してください。

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

先行するブランド・サイト概要更新では、`/press/` 追加前の6URLを通知し、**HTTP 200の受理応答を確認済み**です。これは変更通知の受領を示し、クロール完了・索引登録・検索順位を確認した結果ではありません。今回のv5.0.5では自動再通知を行わず、7URLの新しい通知は未送信です。

既存の [IndexNow通知CLI](tools/notify-indexnow.mjs) は、**既定では送信しないdry-run**です。現在の対象は冒頭に示す7URLです。引数なしの実行はローカル設定・検証ファイル・サイトマップだけを調べ、ネットワーク通信を行いません。公開文書の生成・ZIPの作成・CIから検索通知を送る処理はありません。

`--submit` を明示した場合だけ、公開された検証キーファイル、サイトマップ、公開7ページを取得します。HTTP 200、HTML形式、自己参照canonical、検索除外指定がないことを確認してから、`https://api.indexnow.org/indexnow` へ7URLをまとめて1回POSTします。ホストと対象URLは固定し、転送先には追従せず、失敗時の自動再送もしません。

この事前確認は、公開ページの本文やリリース版まで照合するものではありません。実行者は新しい本文が公開済みであることを別途確認する必要があります。HTTP 200は受領、202は受領してキー検証待ち、429や通信失敗は別の結果として扱います。前回の6URLの受理を、今回追加した `/press/` の通知結果として流用しません。

キーは提出するURLと同じホスト上で検証できる必要があります。IndexNowはBingなどの参加検索エンジンへの変更通知です。Googleへの通知としては扱いません。HTTP 200等の受理結果と、クロール・索引登録・検索結果への掲載は別です。実施時の応答を確認し、未送信・受理・掲載確認の状態を区別します。

参照：[Bingの導入案内](https://www.bing.com/indexnow/getstarted)、[IndexNowの仕様](https://www.indexnow.org/documentation)、[参加先・送信・制限のFAQ](https://www.indexnow.org/faq)。

### 使用しない申請方法

- Google Indexing APIは、`JobPosting` または `VideoObject` 内の `BroadcastEvent` を持つページ向けです。このゲームの一般公開ページには使用しません。[公式の適用条件](https://developers.google.com/search/apis/indexing-api/v3/using-api)
- Googleの旧サイトマップpingエンドポイントは廃止済みです。そこへの送信を申請完了として扱いません。[廃止の公式案内](https://developers.google.com/search/blog/2023/06/sitemaps-lastmod-ping)

## 検証と記録の範囲

生成後の検証では、共通データと公開HTML・metadata・構造化データ・canonical・Manifest・サイトマップの一致、通常リンク、更新日を確認します。公開後には、対象URLと必要なファイルの取得結果を別途確認します。これらは検索エンジン側の索引登録、検索順位、リッチリザルト掲載の保証ではありません。

`tests/test-seo.cjs` は公開データの一致とモック通信によるIndexNowの挙動を確認します。`tests/test-public-pages.cjs` は生成HTMLを読み、内部リンク・節リンク・公開アセット・Googlebot/Bingbotからのクロール可否・404の検索除外を確認します。自動メールや成長上限の説明は、JavaScriptを実行しないHTML本文にあることも検証します。

`site:` 検索は補助的な観測です。一致結果が見つからなくても未登録とは断定せず、GoogleのURL検査やBing Webmaster Toolsでの状態確認と区別します。参照：[Googleのsite検索演算子と制限](https://developers.google.com/search/docs/monitor-debug/search-operators/all-search-site)。


## Ver.5.1.0の公開後通知（2026年11月26日09:38 JST）

本番反映後に `node tools/notify-indexnow.mjs --submit` を1回実行し、7つの正規URLの更新通知がHTTP 200で受理された。確認キー・サイトマップ・7公開ページの事前検証も成功した。結果は `received`、`keyValidationPending: false`、`indexingVerified: false`。Google向けの索引登録依頼や検索掲載の確認ではない。
