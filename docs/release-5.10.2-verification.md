# Ver.5.10.2 — 位階に応じた兵糧の追加生産

## 仕様

現在の領主の総合評価から位階を計算し、無位は0%、従八位は2%、以降は1段階ごとに2ポイント、正一位は32%を兵糧生産へ加算します。購入の有無にかかわらず適用します。武将のレア度や朝廷の官職そのものを加算率として扱いません。

`追加生産 = floor(位階加算前の兵糧総生産 × 加算率 / 100)`

田畑・城・奉行・研究・氏族・家臣・支拠点の既存効果を含む生産へ一度だけ加え、その後に維持費・給与・余剰生産の調整・修復費を計算します。所持兵糧、合戦報酬、贈り物、交易、同盟資産の預入と返却にはかかりません。昇格・降格と生産施設の成長に追従します。

## 表示と同期

- 総合評価・位階画面に現在の加算率、毎月の追加量、次位階の加算率、全17段階の表を表示。
- 収支の兵糧「生産」に含まれる「うち位階加算」を表示。内訳をもう一度足すことはありません。
- ブラウザとWorkerは同一のゲームエンジンを使用。公開APIに `rankRiceProduction: true` を追加。
- 保存形式は維持。旧版で精算した残高と端数を保持し、新版で進む未精算時間へ新しい生産量を適用。
- 開いたままの旧版ページは新版へ切り替わるまで旧計算で動くため、公開後の更新確認が必要です。

## 検証

本番プレイヤーへの試験操作を行わず、ローカルエンジン・Worker・SQLiteで確認しています。

| 対象 | 確認内容 |
| --- | --- |
| 新規の兵糧バフテスト | 実際の進行で全17位階、境界・上限・不正値・昇降格、他資源と維持費、偽の保存称号、奉行配置予測、時刻の按分と再読込・再送 |
| 経済・給与・修復・募兵 | 既存の維持費と余剰調整、赤字時の減兵、給与、修復予測、資源計画を確認 |
| Worker経済 | 16群・140ローカルHTTP呼び出し。旧版の確定残高保持、次の12秒への1回加算、建設再送の重複防止、同盟兵糧の預入・返却を確認 |
| Worker維持費・同期・評価 | 維持費13群・144呼び出し、同期93呼び出し、評価10群・116呼び出し |
| Worker公開バンドル | 41モジュールから構築した実バンドルで33呼び出し・12機能経路を確認 |
| UI | 位階8群・経済12群。既存ノードの更新と、非表示パネル・別領主の状態を確認 |
| ブラウザ | デスクトップと390×844の画面で、位階加算と収支の値が一致。390px幅のダイアログはclientWidthとscrollWidthがともに349px |
| 公開資料 | 日英の紹介、ガイド、17段階表、更新情報、RSS、配布用テキスト・素材ZIPを同じバージョンへ同期 |

評価の回帰検証で、壊れた保存JSONを持つ領主の勲章候補読取が例外になる既存経路も確認しました。JSON参照を `json_valid` の条件分岐で保護し、その保存を変更せず未確認として扱います。

## 主な検証コマンド

```sh
node tests/test-rank-rice-production.cjs
node tests/test-player-evaluation-ui.cjs
node tests/test-economy-ui.cjs
node server/test-economy-balance.mjs
node server/test-maintenance.mjs
node server/test-evaluation.mjs
node server/test-sync.mjs
npm run build
npm run check:build
npm run test:entry
npm run test:interface
node tests/test-asset-budget.cjs
node tests/test-minified-runtime.cjs
node tests/test-seo.cjs
node tests/test-public-pages.cjs
python3 tests/test-news-feed.py
```

初期配布容量の上限は変更していません。新規UIの説明・重複CSSを整理して既存の容量予算に収めます。
