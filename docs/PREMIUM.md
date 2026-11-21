# プレミアム商品の実装と運用

## 初回公開の状態（2026年11月21日）

フロントエンドはVer.3.14.0、実APIはSites version 23へ更新しています。3商品の価格・購入URL・完成アート・外観管理・署名通知の処理を実装しました。

Stripeの設定保存は接続認証が完了していないため、Webhookの署名鍵と契約管理URLは未設定です。`SENGOKU_PREMIUM_ENABLED` も有効にしていません。カタログは閲覧できますが、ゲームからの購入は待機します。必要な設定を完了し、受信先を確認してから販売を有効化してください。

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

public DTOへ公開するのは検証済みの `appearance:{nameplate,town,badge}` のみです。請求書、決済ID、顧客情報を公開DTOに混ぜません。

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

backendの `scripts/test-premium.mjs` は署名付きfixtureをin-memory D1へ送って検証します。実購入、実課金、実顧客の作成はテストに含めません。公開時はbackendのマイグレーションと新APIを先に更新します。署名鍵・契約管理URLの設定と通知受信を確認した後に、販売を明示的に有効化します。設定が未完了でもカタログと外観管理UIは公開できますが、購入ボタンは待機します。

## Stripeの仕様資料

- [Payment LinksのURLパラメーター](https://docs.stripe.com/payment-links/url-parameters)
- [Webhookの順序と重複](https://docs.stripe.com/webhooks)
- [Checkout Session](https://docs.stripe.com/api/checkout/sessions/object?api-version=2026-09-30.endive)
- [Invoice](https://docs.stripe.com/api/invoices/object?api-version=2026-09-30.endive)
- [Invoice Payment](https://docs.stripe.com/api/invoice-payment/object?api-version=2026-09-30.endive)
- [Invoice Line Item](https://docs.stripe.com/api/invoice-line-item/object?api-version=2026-09-30.endive)
- [価格の税込・税別設定](https://docs.stripe.com/tax/products-prices-tax-codes-tax-behavior)
