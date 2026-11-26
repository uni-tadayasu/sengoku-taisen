# 穏やかな筆文字と正確な異体字

通常の画面は **Yuji Syuku Regular** を基準にします。英数字、金額、フォーム、選択肢、コード表示も同じ指定です。Yuji にない文字だけ **Klee One SemiBold**、それにもない文字は **Noto Serif CJK JP Regular** が補います。Yuji と Klee を厳密な書体分類として「行書」と呼ぶものではありません。強く崩した衡山行書から、読みやすさを優先した穏やかな筆文字へ変更しています。

`葛󠄀` のように variation selector を伴う文字は、原本に収録された対応関係を持つ Noto を優先します。アプリ側が既存のテキスト要素へ付ける `data-sengoku-variant-glyph`、入力欄の `data-sengoku-variant-field` がその入口です。名前や文字列の Unicode を正規化・置換したり、文字列を別の字に書き換えたりはしません。同じ要素内の文字も Noto が持つ範囲では Noto になる場合があります。

## 出典と再配布条件

| 使用原本 | 開発元・一次資料 | 使用箇所 |
| --- | --- | --- |
| Yuji Syuku Regular | [Yuji 公式リポジトリ](https://github.com/Kinutafontfactory/Yuji) / 砧書体制作所 | 通常の本文、数字、フォーム |
| Klee One SemiBold | [Fontworks の Klee 公式リポジトリ](https://github.com/fontworks-fonts/Klee)・[日本語説明](https://github.com/fontworks-fonts/Klee/blob/master/README-JP.md) | Yuji にない文字。例: `𠮷` |
| Noto Serif CJK JP Regular 2.003 | [Noto CJK 公式リポジトリ](https://github.com/notofonts/noto-cjk) | 上記にない文字、IVS/SVS |

3書体とも **SIL Open Font License 1.1** です。原文はこのディレクトリの `OFL-Yuji.txt`、`OFL-Klee.txt`、`OFL-Noto.txt` に同梱しています。フォント内部の著作権・制作元・ライセンス情報も保持しています。Noto の日本語原本の著作権表記は `© 2017-2024 Adobe (http://www.adobe.com/).` です。派生 subset の内部 family 名は `Sengoku … Subset` へ変更しています。

配布に使う原本の commit、取得 URL、バイト数、SHA-256、TTC の face 番号は `source.json` に固定しています。Noto は `NotoSerifCJK-Regular.ttc` の **fontNumber 0**（日本語）だけを使います。システム同梱 TTC を使う場合も原本の SHA-256 が一致しなければ拒否します。ビルド時に秘密情報、アカウント情報、保存データは必要ありません。

## 配分と遅延読み込み

`manifest.json` のファイル一覧が、再生成に使う固定配分と公開ファイルの検証台帳を兼ねます。収録 Unicode は重複した巨大な文字一覧ではなく、圧縮した範囲で記録しています。通常表示での優先順位は Yuji → Klee → Noto です。Yuji と Klee の同一 family 内では文字の割り当てが重なりません。

Noto は各 variation sequence をその基底文字と必ず同じ subset に収録します。各ファイルは通常の補完と異体字優先の両方に共有され、CSS の同じ URL を重複宣言しません。通常は `Sengoku Soft Brush` を先に、異体字を含む要素は `Sengoku Exact Variants` を先に指定するだけです。

`@font-face` の `unicode-range` と実際の cmap が一致するように配分し、文字が表示されたときに必要なファイルだけを取得します。variation selector 自体は独立した見える glyph ではなく、基底文字の cmap format 14 に保持します。URL には内容の SHA-256 先頭12桁が入り、同じ URL の内容は変更しません。旧 `assets/fonts/kouzan-gyosho/` の配布済みファイルは、旧アプリからの参照とキャッシュのため残しています。

## 再生成

Python 3 と `requirements.txt` に固定した **FontTools / Brotli** を使います。Node はこのフォント変換自体には不要です。アプリ全体の bundle と公開ページを再生成する工程には、リポジトリ既定の Node 環境を使います。

```sh
python3 -m pip install -r assets/fonts/soft-brush/requirements.txt
python3 assets/fonts/soft-brush/build.py \
  --yuji /path/to/YujiSyuku-Regular.ttf \
  --klee /path/to/KleeOne-SemiBold.ttf \
  --noto /path/to/NotoSerifCJK-Regular.ttc
```

原本パスを省略すると `source.json` の commit 固定 URL から取得し、バイト数と SHA-256 を検証してから変換します。3つとも指定すれば変換はオフラインで実行できます。`--workers 1` から `4` まで並列数を選べます。タイムスタンプを更新せず、原本の outline、メトリクス、レイアウト機能を選択文字に必要な範囲で保持します。

既存の manifest がある場合は、その配分を再利用するため、後で UI の文言や出現頻度が変わっても同じフォントファイルを再生成できます。画面共通文字の配分を意図的に見直すときだけ `--refresh-allocation` を付けます。これは新しい hash URL を作る可能性があるので、古い公開ファイルの扱いはリリース工程で判断します。配分を見直す際に `--reuse-unchanged` を併用すると、変わらない subset は環境の版・hash・バイト数を検証して再利用できます。CSS と台帳だけを作り直す `--reuse-assets` も、既存 WOFF2 の hash とバイト数を検証してから再利用します。

今回の出荷配分は、原本から全112ファイルを再生成して、ファイル名・SHA-256・バイト数・収録範囲と最終 CSS が完全に一致することを確認しています。記録は `reproduction-summary.json` です。

## 原字形・異体字の検証

```sh
python3 assets/fonts/soft-brush/verify.py \
  --yuji /path/to/YujiSyuku-Regular.ttf \
  --klee /path/to/KleeOne-SemiBold.ttf \
  --noto /path/to/NotoSerifCJK-Regular.ttc \
  --write-summary
python3 assets/fonts/soft-brush/measure.py --write-summary
```

`verify.py` は固定原本との照合で、保持した全 glyph の分解後の輪郭、横・縦のメトリクス、各 Unicode の割り当てを比較します。原本の cmap format 14 の **14,787組（IVS 14,682組、SVS 105組）** は default / non-default の区別と glyph の対応も比較し、欠落・重複・別字形への置き換えを拒否します。基底文字のない variation mapping も拒否します。結果は `verification-summary.json` です。

原本の3パスを省略した `verify.py` は、公開 WOFF2 の hash・cmap・CSS と配分の整合を検査する軽い検証になります。原本との輪郭比較まで済ませたという意味にはなりません。対応 sequence の一覧は `variation-sequences.json` だけに保存し、検証 summary には件数を記録します。

3原本の Unicode 収録範囲の和集合は **44,903文字** です。3原本が同じ文字をそれぞれ収録する場合、通常表示には優先順位に従う1つの字体が選ばれます。これは3書体の全ての代替字形を常に切り替えて表示できるという意味ではありません。原本にない文字・sequence は同梱フォントでの厳密な字形を保証できません。未収録の文字は端末の書体に依存し、未対応 sequence はブラウザーが基底文字の字形として表示する場合もあります。未対応 sequence を別の対応 sequence へ変更することはありません。

## 転送量の読み方

`measure.py` は `samples.json` の公開ゲーム語彙を表示した場合に必要な WOFF2 を、生成された CSS の優先順位と収録範囲から選び、**実ファイルのバイト数を合計した理論 payload** を出します。`payload-summary.json` は実際の HTTP 計測・回線速度・ページ表示時間ではありません。HTTP ヘッダー、CSS、JavaScript、system fallback、キャッシュ再利用、画面内の他の文字は含みません。

比較対象の旧衡山フォントは今回と収録文字・異体字対応が異なります。特に短いページや異体字を多く含む名前で、必要ファイルが旧版より増える場合もあります。実ブラウザでは、初回とキャッシュ済みを分けて Network の応答サイズを測り、画面内の全ての文字と読み込み失敗の有無を確認してください。IVS は、同じ基底文字だけの場合と variant 付きの場合の描画差、および範囲指定なしで登録した同じ font と一致することも確認します。
