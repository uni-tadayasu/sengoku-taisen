# 戦国VS 改修の継続記録

最終整理: 2026-11-27（日本時間）、v5.9.0の更新単位。

## 依頼と進め方

対象は `uni-tadayasu/sengoku-taisen`。ゲームを大きく改修し、検証を終えた単位ごとにPRを公開する。ユーザーの追加指定は「PCの右クリックメニューを無効にする」「チャットの上限が来たら新しいチャットで再開する」。現在の作業枠は2026-11-27 06:20 JSTから最大4時間であり、チャットを変えても時間枠を自動延長しない。

新しいチャットは、この記録に加えて、GitHubの最新main・開いているPR・Actionsを読み直すこと。過去の会話やこの文書の作成時点を最新状態と決めつけない。

## 公開先

- ゲーム: https://www.kasai-solutions-inc.com/
- リポジトリ: https://github.com/uni-tadayasu/sengoku-taisen
- 更新情報: https://www.kasai-solutions-inc.com/news/
- フロントエンドはGitHub Pages。既存APIは `config.js` に定義されている。今回のv5.8.1・v5.9.0はAPI/DBの変更を含まない。

## 終えた更新

### v5.8.1

PR #45（https://github.com/uni-tadayasu/sengoku-taisen/pull/45）をmainへマージ。マージcommitは `5323f2c406531dddd925d22c5a83d89ecb6f155e`。ActionsとPages配信が成功し、配信中のindex・selection-lock・core/interface bundle・swの内容一致をHTTP取得で確認した。

- PCマウスの右クリックメニューをゲーム本文・入力欄・ダイアログで抑止。
- 非表示の体力・耐久ゲージの計算を省き、復帰時に最新値を表示。
- 背景タブや閉じた詳細で大型画像の追加取得を保留。
- 詳細: [v5.8.1検証記録](release-5.8.1-verification.md)。

### この更新単位: v5.9.0

- 予定表から施設・城・支城・研究へ直接移動。検索・絞り込み・読書位置を保持。
- 資源計画から試算対象へ直接移動し、未保存入力を先に保存。
- 施設詳細で指令・資源・天守・普請枠の不足を説明。
- 編成セットの採用直前に能力・任命・編成を再照合。
- マップの城のまとまりを保ちながら不要な距離比較を削減。
- 詳細: [v5.9.0検証記録](release-5.9.0-verification.md)。PRの作成・マージ・配信状況はGitHubで確認する。

## 次に引き継ぐ作業

1. **複数タブの保存競合修正**。旧タブの遅延PUT・GET・pagehide・通常保存が、新しい操作端末のprimary保存と未送信復旧記録を巻き戻す経路を修正中。操作端末の確認済み所有権、引継ぎ直前の最新pending読直し、外部API応答からのlease期限延長防止が対象。共有storageだけのmockではなく実app.save/applyCloudSaveを含む12ケースと、同期protocol97チェックで検証した。独立レビュー済みだが、v5.9.0には含めていない。次のPRに統合して再検証する。
2. **施設の現在/完成後の効果比較**。全64施設の指定レベルの読み取り専用投影を使う。予約がある場合は次に手配する段階、最高段階まで予約済みなら予約完了後と比較。兵数・指令上限、奉行補正、維持費との関係を正しく表示する。未公開の作業である。
3. **領有城数の任務判定の軽量化**。questStatusで件数だけ必要な場合に城の詳細モデルを生成しない。実際の任務判定と保存内容を保持し、処理回数で効果を測る。

## 実装と検証の要点

- 既存の保存と役職を保持。管理者・スタッフ・京都御所の共同普請・一般領主の権限差を尊重する。
- 通常の同期途中に説明文を毎秒出したり、画面の位置を揺らしたりしない。
- `engine.js` を変更する場合は `server/game-engine.js` と同一内容を保つ。既存API互換の読み取り追加と、Workerの本番デプロイは別に判断する。
- `npm ci --ignore-scripts --no-audit --no-fund`、`npm run build`、`npm run check:build`、`npm run test:entry`、`npm run test:interface` を使用。関連するserver/engine検証は変更範囲に応じて追加する。
- `tests/test-asset-budget.cjs` と `tests/test-minified-runtime.cjs` で配信量とソース/生成bundleの継続性を検証。新機能の配信量を実測して記録し、速度やFPSの改善を処理回数から推測して断言しない。
- バージョンはsite-metadata.json、package/lock、index、swで揃える。公開文書・RSS・検索index・press kitはビルドで再生成する。
- ブラウザ確認は実プレイヤーの保存を使わず、メモリー内保存と外部APIを遮断した試遊データで行う。PC・320/390px・タブレット・横向きの閉じる操作、スクロール、主要導線を確認する。
- PRのCI通過後、対象head SHAを指定してマージし、Pagesの成功と配信内容の一致まで確認する。成果を公開したら、この記録も次の更新で追記する。

## 既知の基準版テスト差分

v5.8.0の元コードでも、`test-ui-helpers.cjs` のU家康の表示名、`test-staff-base-ui.cjs` の徳川/德川の期待文字列で不一致があることを別担当が再現した。今回の操作改善による新規失敗と混同しない。全テストが無条件に通ったとは報告せず、実行した検証と結果を分けて記録する。
