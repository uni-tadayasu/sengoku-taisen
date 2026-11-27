# プレミアム商品の実装と運用

## Ver.5.10.0（2026年11月27日）

販売カタログv4は既存8商品と `reroll-pass-30d` の9商品です。月額780円サポーターは、公開時に有効な支払済み期間と以降の支払済み期間ごとに装飾3種から1点を選択できます。選択済みの装飾は通常の解約後も保持します。返金・支払い取消などで根拠となる支払いが失効した場合は、その支払いに基づく特典を利用できません。

再抽選パスは税込480円／実時間30日間・自動更新なし。単発1枚につき1回、1日最大3回、日本時間05:00更新、未使用回数は繰り越しません。通常招集300勾玉の支払い後、同じ確率で引き直した候補と最初の候補の1枚を確定します。追加勾玉は不要、10連全体は対象外、高ランク保証なしです。武将の獲得結果に影響するため、外観専用の商品と区別します。

ログイン報酬は領主登録・接続を必要とし、課金の有無を問いません。朝05–12時／昼12–18時／夜18–翌05時に各30、1日最大90勾玉です。夜の枠は0時で増えません。所持上限1億では枠を消費せず、空きが30未満なら実際に増えた量を表示します。

### 新しいAPIと記録

| API | 内容 |
| --- | --- |
| `GET /premium?catalog=4` | 9商品の購入可否、再抽選パスの期限・残数、支払済み期間の装飾候補 |
| `POST /premium/supporter-choice?catalog=4` | `{periodId, productId, requestId}` で支払済み期間の1点を確定 |
| `GET /rewards` | 現在の時間帯・受取済み枠・再抽選残数・未確定の招集 |
| `POST /rewards/login` | 時間帯ボーナスの原子的な受取 |
| `POST /gacha/draw` | 1回／10回のサーバー抽選。パスの残回数がある単発は選択待ち |
| `POST /gacha/reroll` | 未確定の1枚を1回だけ再抽選 |
| `POST /gacha/choose` | 元の候補か再抽選候補の1枚を獲得、重複変換も1回 |
| `POST /premium/events` | 本人のショップ閲覧・購入開始の記録 |
| `GET /admin/premium/metrics?days=60` | 運営専用の売上確認・購入率・更新率・無料／課金別の再訪指標 |

ゲームの資産を変更するPOSTは `deviceId`・`expectedRevision`・`requestId` を要し、保存更新と受付台帳を同じD1トランザクションで確定します。同じ受付番号は同じ結果を返します。未確定の招集と購入権利をlocalStorageで付与しません。

新しいD1移行は `0040_paid_rewards.sql` と、接続プレイヤーの日次活動を記録する後続の `0041` です。既存の購入・通知・装備データを保持して拡張します。環境変数 `SENGOKU_REROLL_PAYMENT_LINK_ID`・`SENGOKU_REROLL_PAYMENT_LINK_URL`・`SENGOKU_REROLL_PRICE_ID`・`SENGOKU_REROLL_PRODUCT_ID` が未設定の場合、パスの購入を停止します。既存の署名鍵・既存価格・契約管理を維持します。

### 売上と継続を確認する

交流の間 → 運営 → 購入の確認から、14・30・60・90日間の指標を確認します。初期表示は60日間です。通常のショップ閲覧・購入操作の件数と、同じ領主を重複させないアカウント数を分けて表示します。

- **全商品の確認済み支払額**: 9商品を対象に、署名検証済みの決済と商品・領主の対応が一致した支払いを集計します。税込JPYの金額を決済ごとに一度だけ加算し、商品別の内訳も表示します。返金・取消・保留などで現在有効と確認できない決済は別枠で示します。返金額や決済手数料を完全に控除した純売上ではありません。
- **閲覧後の購入率**: 対象期間中にショップを閲覧した接続アカウントのうち、閲覧後に支払いを確認できたアカウントの割合です。購入ボタンを押しただけでは購入済みに数えません。
- **サポーターの翌期間更新率**: 支払い済み利用期間の終了後、7日間の観測を終えた期間を分母とし、同じ契約の連続した次の期間をその猶予内に支払った割合を表示します。利用期間がまだ終わっていない契約は分母に入りません。
- **無料・課金別の翌日／30日後再訪率**: この計測を導入してから初めて認証済みゲーム操作を観測した接続領主を起点とし、起点時点の支払い状態で分類を固定します。登録直後の新規プレイヤー数とは異なります。後日の購入・返金で過去の分類を入れ替えず、日本時間05:00区切りで翌日または30日後にも活動した割合を示します。

未接続の端末内プレイは再訪指標に含みません。導入前の活動は補完せず、観測日数が足りない指標や対象者がいない指標は未観測として表示します。記録のない値を0%に置き換えたり、計測結果を宣伝による純増人数として扱ったりしません。

### 5.10.0のStripe設定（2026年11月27日）

本番アカウントの再抽選パスは次の設定です。値は作成後にStripeから読み返して照合しています。

| 項目 | 値 |
| --- | --- |
| Product | `prod_sengokuvs_20261127_reroll_pass_30d` |
| Price | `price_1UgHJfL3ZjL9QUmfpOBNju65` |
| Payment Link | `plink_1UgHJvL3ZjL9QUmf0CxykmVN` |
| 料金 | `jpy` / `unit_amount: 480` / `tax_behavior: inclusive` |
| 形式 | `one_time` / `recurring: null` / 数量1固定 |
| 税区分 | `txcd_10201001`（期限付きのダウンロード型ビデオゲーム利用権） |
| 税計算 | Stripe Tax有効。既存の日本の税務登録を維持 |

日本の住所条件を使った請求プレビューは総額480円・内税44円、`taxability_reason: standard_rated`、`automatic_tax.status: complete`でした。このプレビューでは実決済・顧客作成を行っていません。未登録の国・地域では、税務登録を追加するまでStripe Taxは税を徴収しません。税務登録を増やす場合の公式手順: <https://docs.stripe.com/tax/set-up>。

サポーターの商品説明だけを新しい装飾選択特典へ更新し、既存の月額Price `price_1UeEiFL3ZjL9QUmfkthlf1SJ` の780円・1か月自動更新を維持しました。既存Webhookの署名鍵・URL・API version・23イベントの設定は変更していません。新しい決済の実支払いから本番権利反映までの通し試験は行っていません。

以下の2026年11月22日の節は旧3商品の公開記録です。現在の販売数・特典は上記と `premium-catalog.js` を参照してください。

## 設定・公開の状況（2026年11月22日 JST）

フロントエンドはVer.3.16.0、実APIはSites version 25です。3商品の価格・購入URL・完成アート・外観管理・署名通知に加え、未装備の購入商品を他の領主にも示す印、公開する役職情報の整理、同じ領主IDのまま名前を変更する機能を実装しました。

Stripeの接続認証を再確認し、LiveのWebhook `we_1UeFufL3ZjL9QUmfA3vQjPP4` を保存しました。状態は `enabled`、API versionは `2026-09-30.endive`、対象は23イベントです。契約管理Portal `bpc_1UeFsLL3ZjL9QUmfCKVGnsnG` も保存済みで、[契約管理URL](https://billing.stripe.com/p/login/4gM3cw92Q6NP4gj1Ia9MY00)を設定しました。解約は契約期間末に適用し、返金按分は行わない設定です。

Sitesの環境設定 revision 3に署名鍵をsecretとして保存し、`SENGOKU_PREMIUM_ENABLED=true` と契約管理URLを設定しています。署名通知・購入連携はversion 24で公開確認済みです。version 25は同じ環境設定を保持し、領主アイコンと位階を購入確認にも表示するための人物情報を追加しています。今回の更新で決済設定・署名鍵・購入先は変更していません。

既存3商品のStripe画像・説明を完成アートに更新し、Payment Linkの決済完了後の戻り先を `https://www.kasai-solutions-inc.com/?premium=<商品ID>` に設定しています。価格・税込設定・商品構成を維持し、公開APIは `status:"ready"`・`version:"3.16.0"`・`features.premium:true` を返します。契約管理ページの表示は3.14.0の公開時に確認しました。

実決済と本番Stripeイベントの受信は未実施です。購入から有料権利の反映までの本番確認は、ローカルの署名付きfixtureによる検証とは区別しています。

## 商品

| ID | 商品 | 価格 | 形式 | 適用先 |
| --- | --- | --- | --- | --- |
| `gold-banner` | 金彩の旗印 | 480円 | 買い切り | 城下町の旗、本人の金彩名札 |
| `moonlit-castle` | 月影の城下 | 980円 | 買い切り | 城下町の専用夜景、本拠の月明かりの装飾 |
| `supporter` | 戦国VSサポーター | 780円／月 | 月額自動更新 | 利用期間中のサポーターバッジ |

2026年11月21日に、既存Stripe Payment Linkの有効状態・JPY金額・quantity=1・買い切り／month interval_count=1を照合。Stripe Taxは既存の有効設定を保持し、`tax_behavior=unspecified` はアカウントの `inferred_by_currency` によりJPY税込として扱う設定です。新しい商品・価格の作成や税務登録の変更はしていません。

| ID | Payment Link | Price |
| --- | --- | --- |
| `gold-banner` | `plink_1UeEdvL3ZjL9QUmfKwCpWsEI` | `price_1UeEcRL3ZjL9QUmf6snR2y5b` |
| `moonlit-castle` | `plink_1UeEg9L3ZjL9QUmf0Jiw1Inq` | `price_1UeEfwL3ZjL9QUmfMZSVlcyg` |
| `supporter` | `plink_1UeEiNL3ZjL9QUmf5805BE1t` | `price_1UeEiFL3ZjL9QUmfkthlf1SJ` |

購入URLはユーザー指定の3件をカタログとサーバーの許可リストで固定しています。ゲームの戦力・資産・指令・勾玉・施設レベルには特典を付与しません。既存の運営用 `entitlements` は有料商品の所有情報とは別です。

## 購入から装備まで

1. 公開 `/premium/` の「ゲームで購入する」は `/?premium=<商品ID>` を開きます。直接の無紐付け決済には進めません。
2. ゲーム内で登録領主と購入済み状態を確認します。登録がない場合は「交流の間」へ案内します。
3. 商品、税込料金、受け取る領主名・ID、月額の場合は自動更新を確認します。
4. 認証済み `POST /premium/checkout` が領主に固定した推測困難な `client_reference_id` を発行し、許可済みPayment Linkへ付けます。生の領主IDや認証tokenはStripe URLへ入れません。
5. Stripeからの署名付き支払い通知をサーバーが検証し、有料権利の台帳へ記録します。
6. 「購入状態を再確認」または画面復帰時の再確認後、「ゲームに適用」で外観を切り替えます。「通常に戻す」で解除できます。
7. サポーターの契約・決済手段・解約はStripeの契約管理へ進みます。購入時のメールアドレスによる認証を利用します。

URLの成功パラメーター、プレビュー、ブラウザ保存、インポートしたゲームセーブは購入証明として扱いません。装備状態もサーバーに保存し、同じ領主の別端末へ引き継ぎます。プレビューは装備を変更しません。

## フロントエンド

- `premium-catalog.js`: 表示用の商品、正式価格、実アート、購入URLの厳密な許可リスト。
- `premium.js` / `premium.css`: 公開ページとゲーム内ダイアログ。本人・料金の確認、購入済み・装備・期限の表示。
- `premium-runtime.js`: 認証APIのadapter。所有情報はメモリーにのみ保持し、ゲームセーブやlocalStorageに書きません。本人変更・古い応答・装備更新との競合を破棄します。
- `premium-admin.js` / `premium-admin.css`: 運営の「購入の確認」。保留の照合、理由入力、確認後の解除、操作記録。スタッフや一般領主は利用できません。
- `premium-appearance.css`: 本人名札、バッジ、城下町の旗、本拠の月明かり装飾。
- `app.js`, `social.js`, `field.js`: 確認済み外観を実ゲームへ適用。チャットの変更判定には外観も含みます。
- `assets/premium/`: 透過PNGの原本と配信用WebP。制作記録は `PREMIUM_ART.md`。

サポーターの期限はサーバー時刻と経過時間から判定します。ゲーム速度、ゲーム内年月、端末の時計変更で期間が延長されることはありません。確認不能・BAN・接続解除では特典の表示と購入を停止し、次に接続できた際に再確認します。

## サーバーとデプロイ

本リポジトリの `server/` はAPIソースの参照用コピーです。GitHub Pagesへの反映だけでは、実際のWorkerやD1は更新されません。

実APIは既存のSitesプロジェクト `appgprj_6b0062efeeb88191b65f81b63db926dc` です。URLは `https://sengoku-tento.hisa-0128-1996.chatgpt.site`。既存DB・認証・公開範囲を維持し、有料商品用の追加マイグレーションを適用します。

| API | 内容 |
| --- | --- |
| `GET /api/v1/premium` | 本人の所有・装備・期限・購入可否 |
| `POST /api/v1/premium/checkout` | `{productId}` から本人用決済URLを発行 |
| `PUT /api/v1/premium/appearance` | `{slot,productId}`。解除は `productId:null` |
| `GET /api/v1/admin/premium/reviews` | 運営専用の保留一覧 |
| `POST /api/v1/admin/premium/reviews` | 確認対象の版・イベント・理由・操作番号を指定した保留解除 |
| `POST /api/v1/premium/stripe/webhook` | Stripe署名付き通知専用。ゲームのBearerやwriter leaseは不要 |

public DTOへ公開する外観情報は、検証済みの `appearance:{nameplate,town,badge,ownedProducts}` です。`ownedProducts` は `gold-banner`、`moonlit-castle`、`supporter` のうち現在有効な商品IDを返し、装備していない購入商品も含みます。請求書、決済ID、顧客情報を公開DTOに混ぜません。

領主名の共通レンダーは、装備による名札の装飾とは別に商品ごとの小さな印を表示します。通常のチャット・接続一覧・フレンド・同盟・ランキングに加え、書状の差出人、交易相手、地図の城主、戦歴の攻撃側・防御側、実績の領主も対象です。過去の記録は保存済みの決済情報や外観を信用せず、読み取り時の購入権利を表示します。新着のないチャット・書状の差分にも `playerEvaluations[].appearance` を返し、開いたままの過去投稿を更新します。

保留・返金・BAN・月額期限切れでは対象商品の印を除き、BAN解除後はその時点で有効な商品だけ再表示します。運営・スタッフという役割に購入商品の印を付与しません。公開の名前表示には役割のバッジを付けず、一般向けAPIから他者の運営・スタッフ属性を除去します。認証済みの本人情報と認可された管理操作は維持します。領主名を変更しても購入権利の紐付けは同じ領主IDのままです。

### 環境設定

| 設定 | 種類 | 用途 |
| --- | --- | --- |
| `STRIPE_WEBHOOK_SECRET` | secret | このAPI宛のStripe webhook endpoint署名鍵 |
| `SENGOKU_PREMIUM_ENABLED` | env | 本販売の有効化。明示的な `true` の場合のみ購入可 |
| `SENGOKU_STRIPE_PORTAL_URL` | env | 契約管理の `https://billing.stripe.com/…` URL |

署名鍵はSitesの環境変数にsecretとして保存します。リポジトリ、クライアント、ログ、文書へ実値を記載しません。環境変数変更はその後のデプロイに反映します。設定不足のまま購入ボタンだけを有効にしないでください。

### 署名通知と台帳

WebhookはStripeのsnapshot形式、API version `2026-09-30.endive` を対象にします。署名の時刻許容と生bodyのHMACを検証し、test/live取り違え、不正署名、過大bodyを拒否します。決済通知はイベントIDと関連決済オブジェクトIDで冪等に記録し、通知の順序を前提にしません。

買い切りは本人用参照・許可済みPayment Link・JPY総額・mode・支払い済み状態を照合します。Checkout Sessionの標準snapshotにline_itemsは含まれないため、Price IDは事前照合したPayment Linkの設定を通して固定しています。これらのリンクの明細を別商品へ変更しないでください。

月額はInvoiceとInvoice PaymentのStripe決済相関、対象Price、数量、非proration、各lineのサービス期間を検証します。`invoice.paid` だけでは手動入金も含むため、単独で特典を延長しません。ゲーム内の1か月や一律30日を足す処理はありません。

返金・争議・早期不正警告が支払い通知より先に届いても、後の古い支払い通知で復活しないよう遮断記録を保持します。警告や争議は返金確定とは区別し、安全側に利用を保留します。取消予約は既払い期間を削らず、利用期間終了を確認して失効します。

### 運用上の再照合

この構成は署名付きsnapshotを使用し、実行環境に広いStripe秘密APIキーを置きません。未知の明細、足りない相関、無紐付けの直接購入は自動で任意の領主に割り当てません。該当通知とStripe Dashboardを照合し、正しいイベントを再配信してください。争議解消・警告解除後は、交流の間 → 運営 → 購入の確認から対象を照合します。Stripeで確認した理由（8〜500字）を入力して解除内容を確認すると、対象の版とイベントが一致した場合だけ保留を解除し、監査記録を残します。返金確定・争議の敗訴・決済不一致は解除できません。通信失敗の再送は同じ操作番号を使い、後から新しい警告が届いた場合は改めて確認が必要です。

直接共有された購入URLには領主の参照がありません。ユーザー向けの導線としては、ゲーム内の「有料版・支援」を案内してください。複数回の購入が起きた場合も、それぞれの支払い記録を保持し、1件の返金で別の有効な購入まで消さない設計です。

固定Payment Linkは一度発行したURLをStripe側で再利用できます。ゲームは購入済み商品や未終了のサポーター契約への新規購入を止めますが、保存済みURLや別タブからの再決済まで無効化する構成ではありません。二重契約が発生した場合はStripe Dashboardで個々の契約と支払いを照合し、解約・返金の要否を判断してください。

## 検証

```sh
node tests/test-premium.cjs
node tests/test-premium-runtime.cjs
node tests/test-premium-admin.cjs
node tests/test-social-ui.cjs
node tests/test-field.cjs
node tests/test-player-evaluation-ui.cjs
node tests/test-ui-continuity.cjs
node tools/build-public-pages.cjs
node tests/test-public-pages.cjs
node tests/test-release-assets.cjs
```

backendの `scripts/test-premium.mjs` は署名付きfixtureをin-memory D1へ送って検証します。実購入、実課金、実顧客の作成はテストに含めません。2026年11月22日 JST時点では、署名鍵・契約管理URL・販売有効化フラグの保存と再デプロイが完了しています。本番の実決済・通知受信・権利反映の確認は未実施であり、fixtureによる検証とは別に記録します。必要な環境設定が不足する場合は、購入ボタンは待機します。

## Stripeの仕様資料

- [Payment LinksのURLパラメーター](https://docs.stripe.com/payment-links/url-parameters)
- [Webhookの順序と重複](https://docs.stripe.com/webhooks)
- [Checkout Session](https://docs.stripe.com/api/checkout/sessions/object?api-version=2026-09-30.endive)
- [Invoice](https://docs.stripe.com/api/invoices/object?api-version=2026-09-30.endive)
- [Invoice Payment](https://docs.stripe.com/api/invoice-payment/object?api-version=2026-09-30.endive)
- [Invoice Line Item](https://docs.stripe.com/api/invoice-line-item/object?api-version=2026-09-30.endive)
- [価格の税込・税別設定](https://docs.stripe.com/tax/products-prices-tax-codes-tax-behavior)
