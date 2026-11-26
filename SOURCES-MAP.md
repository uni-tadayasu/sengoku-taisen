# 天下地図：地理資料・出典・精度

この地図は、公開された実地理データと城郭・史跡の代表点を使って作成しています。海岸線や山地を手描きしたもの、生成画像による地形ではありません。アプリケーションの著作権表記は **KASAI SOLUTIONS** です。以下の第三者データの出典・利用条件は、その表記とは別に適用されます。

## 地形と表示の考え方

- 海岸線は Natural Earth 1:10m（縮尺1:10,000,000）の元データから日本を抽出しました。追加の形状簡略化は行っていません。109の島・陸域ポリゴン、6,952頂点を含みます。
- 山地は国土地理院のPNG標高タイルから標高値を読み出し、同院の陰影起伏図と合成しました。標高に応じた段彩であり、衛星写真や土地被覆の色そのものではありません。
- ラスターはWeb Mercator / EPSG:3857、ズームレベル8のタイル位置をそのまま保ちます。5888×5120ピクセル。標高の元資料がDEM10B等であっても、この全国表示用画像を10m画素の画像と称するものではありません。
- 県境は現代の47都道府県を位置把握の参考として示すものです。戦国時代の国境・領地境界ではありません。勢力や所有状態はゲームの状態を表します。
- 海岸線・標高は現代の資料です。埋立てや河川改修を戻した1560年当時の地形を復元したものではありません。
- 拠点の129点は公開資料中の史跡・城郭・施設の代表点です。本丸や天守の測量中心を意味せず、表示される小数桁数が測量精度を保証するものではありません。出典で確認できた位置を使用し、旧ゲーム画面の相対座標から地理座標を逆算していません。
- 拡大時も城・海岸線・地形の同じ経緯度が重なるよう、投影を統一しています。島を見栄えのために本土へ移す加工は行っていません。

## 1. 海岸線・参考県境：Natural Earth

**Made with Natural Earth.**

- [Natural Earth 1:10m Cultural Vectors](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/)
- [Admin 0 Countries 5.1.1 元ZIP](https://naturalearth.s3.amazonaws.com/10m_cultural/ne_10m_admin_0_countries.zip)
- [Admin 1 States / Provinces 5.1.1 元ZIP](https://naturalearth.s3.amazonaws.com/10m_cultural/ne_10m_admin_1_states_provinces.zip)
- [Natural Earth 利用条件：Public Domain](https://www.naturalearthdata.com/about/terms-of-use/)

元ShapefileのWGS84座標を読み出し、日本を選択してGeoJSONへ変換しました。海岸線は国別陸域の境界、県境は隣接する県ポリゴン間で共有される辺を抽出・接続した86本の線です。国別データと県別データは別々の原資料であり、細部の一致を新しく保証するものではありません。Natural Earthの標準的な境界定義を使用しています。

配布ファイル：`assets/map/japan-land-10m.geojson`、`japan-prefectures-10m.geojson`、`japan-prefecture-boundaries-10m.geojson`。ダウンロード元ZIPのSHA-256は `natural-earth-source-manifest.json` に記録しています。

## 2. 標高・陰影：国土地理院

**地理院タイル（国土地理院）を加工して作成**

- [地理院タイル一覧](https://maps.gsi.go.jp/development/ichiran.html)
- [標高タイル詳細仕様](https://maps.gsi.go.jp/development/demtile.html)
- [陰影起伏図の説明](https://www.gsi.go.jp/bousaichiri/hillshademap.html)
- [国土地理院・出典の記載](https://www.gsi.go.jp/LAW/2930-meizi.html)
- [国土地理院コンテンツ利用規約](https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html)

使用エンドポイント：`https://cyberjapandata.gsi.go.jp/xyz/dem_png/8/{x}/{y}.png` と `https://cyberjapandata.gsi.go.jp/xyz/hillshademap/8/{x}/{y}.png`。日本の陸域に関係する130タイルを調べ、標高データのある89タイルを組み合わせています。海上などデータが提供されない箇所は透明とし、架空の地形で埋めていません。

RGBから公式仕様の24ビット符号値を復号し、0.01mの数値単位で標高を得て、標高別の緑〜灰色の段彩と既存の陰影を合成しました。段彩・陰影強度・画像圧縮は本アプリ向けの加工です。国土地理院がこのゲームの地図を制作・承認したという意味ではありません。

配布ファイル：`assets/map/japan-terrain-gsi-z8.webp`（段彩＋陰影）および `japan-hillshade-gsi-z8.webp`（単色陰影）。タイル範囲・個別URL・SHA-256・取得日時・画像寸法は `gsi-terrain-manifest.json` に記録しています。地形画像の範囲は西122.34375°、南23.24134610238614°、東154.6875°、北46.07323062540836°です。

## 3. 河川・湖：Natural Earth

- [Natural Earth 1:10m Physical Vectors](https://www.naturalearthdata.com/downloads/10m-physical-vectors/)
- [河川元GeoJSON](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_10m_rivers_lake_centerlines.geojson)
- [湖元GeoJSON](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_10m_lakes.geojson)

石狩川・利根川・最上川と琵琶湖を元資料から選択しました。日本全国のすべての河川・湖沼を網羅する表示ではありません。`japan-rivers-10m.geojson`、`japan-lakes-10m.geojson` に実際の線・面データを収めています。元ファイルのGit blobは、河川 `61a0d7137a6ff1113cc259525e7479c63d5fec86`、湖 `e48ec603e0943b62f8c81960fb990bb6bab4a4a8` です。

## 4. 城郭・史跡位置

129件の内訳は、国土地理院100件、CODH21件、自治体・公的研究機関・公式観光案内等8件です。機械可読の全レコードは `assets/map/castle-coordinates.json` にあり、位置・代表点の説明・資料URL・資料名・提供機関・補足・取得日を保持しています。

### 必要なクレジット

- 国土地理院の地点検索結果を加工して使用。[地理院地図](https://maps.gsi.go.jp/)。検索結果の名称と地域を照合し、現代の地図上の史跡代表点を採用しました。
- **『日本歴史地名大系』施設・地点項目データセット（CODH作成） doi:10.20676/00000456**。[データセット](https://geoshape.ex.nii.ac.jp/nrct-poi/)。CC BY 4.0。ゲーム内名称との対応づけ・項目選択を行っています。
- **福井県 観光情報（オープンデータプラットフォーム）**。[データカタログ](https://ckan.odp.jig.jp/dataset/jp-fukui-280-odp)、[元CSV](https://data.odp.jig.jp/viewcsv/jp/fukui/280.csv)。CC BY 2.1 JP。丸岡城・大野城の観光施設代表点を使用しています。
- そのほかの自治体・公式機関の個別案内は、以下の各城に直接リンクしています。資料ごとの位置の性格はJSONの `accuracy`、`note`、`sourceTitle` を参照してください。

### 城ごとの座標と出典

| ID | 城 | 緯度 | 経度 | 提供機関・出典 |
|---|---|---:|---:|---|
| kyoto_gosho | 京都御所 | 35.024098 | 135.762144 | [人文学オープンデータ共同利用センター（CODH）](https://geoshape.ex.nii.ac.jp/nrct-poi/resource/27/270000202000.html) |
| ishikawa | 石川城 | 40.548768 | 140.544087 | [人文学オープンデータ共同利用センター（CODH）](https://geoshape.ex.nii.ac.jp/nrct-poi/resource/02/020000180300.html) |
| sannohe | 三戸城 | 40.382058 | 141.263205 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E5%9F%8E%E5%B1%B1%E5%85%AC%E5%9C%92) |
| minato | 湊城 | 39.757255 | 140.071032 | [東北観光推進機構](https://www.tohokukanko.jp/attractions/detail_1007034.html) |
| kakunodate | 角館城 | 39.607026 | 140.563680 | [秋田県教育庁](https://common3.pref.akita.lg.jp/heritage-map/ruins/detail.html?ruins_id=3503) |
| yamagata | 山形城 | 38.255186 | 140.328369 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E5%B1%B1%E5%BD%A2%E5%9F%8E) |
| yonezawa | 米沢城 | 37.909312 | 140.101526 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E4%B8%8A%E6%9D%89%E7%A5%9E%E7%A4%BE) |
| kurokawa | 黒川城 | 37.486583 | 139.931099 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E9%B6%B4%E3%83%B6%E5%9F%8E) |
| odaka | 小高城 | 37.568151 | 140.990557 | [人文学オープンデータ共同利用センター（CODH）](https://geoshape.ex.nii.ac.jp/nrct-poi/resource/07/070000077000.html) |
| ota | 太田城 | 36.546132 | 140.519759 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E5%A4%AA%E7%94%B0%E5%B0%8F%E5%AD%A6%E6%A0%A1) |
| utsunomiya | 宇都宮城 | 36.554456 | 139.885762 | [人文学オープンデータ共同利用センター（CODH）](https://geoshape.ex.nii.ac.jp/nrct-poi/resource/09/090000131400.html) |
| mayabashi | 厩橋城 | 36.390688 | 139.060453 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E7%BE%A4%E9%A6%AC%E7%9C%8C%E5%BA%81) |
| oshi | 忍城 | 36.137861 | 139.453283 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E8%A1%8C%E7%94%B0%E5%B8%82%E9%83%B7%E5%9C%9F%E5%8D%9A%E7%89%A9%E9%A4%A8) |
| odawara | 小田原城 | 35.251334 | 139.154094 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E5%B0%8F%E7%94%B0%E5%8E%9F%E5%9F%8E) |
| kasugayama | 春日山城 | 37.146705 | 138.205951 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E6%98%A5%E6%97%A5%E5%B1%B1%E5%9F%8E) |
| ueda | 上田城 | 36.403724 | 138.241714 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E4%B8%8A%E7%94%B0%E5%9F%8E) |
| tsutsujigasaki | 躑躅ヶ崎館 | 35.686478 | 138.577091 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E6%AD%A6%E7%94%B0%E6%B0%8F%E9%A4%A8%E8%B7%A1) |
| nanao | 七尾城 | 37.008480 | 136.984045 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E4%B8%83%E5%B0%BE%E5%9F%8E) |
| kanazawa | 金沢御坊 | 36.565484 | 136.657562 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E9%87%91%E6%B2%A2%E5%9F%8E) |
| ichijodani | 一乗谷城 | 35.999513 | 136.295063 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E4%B8%80%E4%B9%97%E8%B0%B7%E6%9C%9D%E5%80%89%E6%B0%8F%E9%81%BA%E8%B7%A1) |
| sunpu | 駿府城 | 34.980047 | 138.381659 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E9%A7%BF%E5%BA%9C%E5%9F%8E) |
| hikuma | 引馬城 | 34.713332 | 137.728532 | [浜松市観光・シティプロモーション課](https://adeac.jp/hamamatsu-city/catalog/mp001460-2022) |
| okazaki | 岡崎城 | 34.957045 | 137.159747 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E5%B2%A1%E5%B4%8E%E5%85%AC%E5%9C%92) |
| kiyosu | 清洲城 | 35.220008 | 136.841775 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E6%B8%85%E6%B4%B2%E5%9F%8E) |
| inabayama | 稲葉山城 | 35.436474 | 136.782030 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E5%B2%90%E9%98%9C%E5%9F%8E) |
| odani | 小谷城 | 35.459095 | 136.277457 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E5%B0%8F%E8%B0%B7%E5%9F%8E) |
| kannonji | 観音寺城 | 35.145611 | 136.157805 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E8%A6%B3%E9%9F%B3%E5%AF%BA%E5%9F%8E) |
| sakamoto | 坂本城 | 35.058380 | 135.878762 | [人文学オープンデータ共同利用センター（CODH）](https://geoshape.ex.nii.ac.jp/nrct-poi/resource/25/250000065100.html) |
| nijo | 二条御所 | 35.019972 | 135.757861 | [京都市](https://www2.city.kyoto.lg.jp/somu/rekishi/fm/ishibumi/html/ka012.html) |
| akutagawa | 芥川山城 | 34.881000 | 135.588300 | [奈良文化財研究所](https://heritagemap.nabunken.go.jp/statistic/9860-%E8%8A%A5%E5%B7%9D%E5%B1%B1%E5%9F%8E.html) |
| takaya | 高屋城 | 34.548790 | 135.609849 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E5%AE%89%E9%96%91%E5%A4%A9%E7%9A%87%E9%99%B5) |
| tottori | 鳥取城 | 35.508439 | 134.240315 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E9%B3%A5%E5%8F%96%E5%9F%8E) |
| gassan | 月山富田城 | 35.360896 | 133.185826 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E5%AF%8C%E7%94%B0%E5%9F%8E%E8%B7%A1) |
| okayama | 岡山城 | 34.663753 | 133.936128 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E5%B2%A1%E5%B1%B1%E5%9F%8E) |
| yoshida | 吉田郡山城 | 34.674111 | 132.709900 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E9%83%A1%E5%B1%B1%E5%9F%8E%E8%B7%A1) |
| yamaguchi | 山口館 | 34.183981 | 131.480415 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E5%A4%A7%E5%86%85%E6%B0%8F%E9%A4%A8) |
| takamatsu | 備中高松城 | 34.692509 | 133.822278 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E9%AB%98%E6%9D%BE%E5%9F%8E%E8%B7%A1) |
| oko | 岡豊城 | 33.595346 | 133.623050 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E5%B2%A1%E8%B1%8A%E5%9F%8E) |
| yuzuki | 湯築城 | 33.847928 | 132.786111 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E6%B9%AF%E7%AF%89%E5%9F%8E) |
| shozui | 勝瑞城 | 34.130716 | 134.521308 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E5%8B%9D%E7%91%9E%E5%9F%8E) |
| sogo | 十河城 | 34.260771 | 134.105549 | [人文学オープンデータ共同利用センター（CODH）](https://geoshape.ex.nii.ac.jp/nrct-poi/resource/38/380000068500.html) |
| akizuki | 秋月城 | 33.466778 | 130.695361 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E7%A7%8B%E6%9C%88%E4%B8%AD%E5%AD%A6%E6%A0%A1) |
| tachibana | 立花城 | 33.679774 | 130.468278 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E7%AB%8B%E8%8A%B1%E5%B1%B1) |
| funai | 府内館 | 33.228980 | 131.619469 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E5%A4%A7%E5%8F%8B%E6%B0%8F%E9%81%BA%E8%B7%A1) |
| saga | 佐賀城 | 33.245454 | 130.302830 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E4%BD%90%E8%B3%80%E5%9F%8E) |
| hitoyoshi | 人吉城 | 32.211467 | 130.766583 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E4%BA%BA%E5%90%89%E5%9F%8E) |
| kumamoto | 隈本城 | 32.801153 | 130.700086 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E7%9C%8C%E7%AB%8B%E7%AC%AC%E4%B8%80%E9%AB%98%E7%AD%89%E5%AD%A6%E6%A0%A1) |
| obi | 飫肥城 | 31.628622 | 131.350481 | [人文学オープンデータ共同利用センター（CODH）](https://geoshape.ex.nii.ac.jp/nrct-poi/resource/46/460000108100.html) |
| uchijo | 内城 | 31.606568 | 130.562885 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E5%A4%A7%E9%BE%8D%E5%B0%8F%E5%AD%A6%E6%A0%A1) |
| hirosaki | 弘前城 | 40.608735 | 140.465280 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E5%BC%98%E5%89%8D%E5%9F%8E) |
| nejo | 根城 | 40.506221 | 141.460243 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E6%A0%B9%E5%9F%8E) |
| morioka | 盛岡城 | 39.700656 | 141.150433 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E7%9B%9B%E5%B2%A1%E5%9F%8E) |
| sendai | 仙台城 | 38.253098 | 140.856232 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E4%BB%99%E5%8F%B0%E5%9F%8E) |
| kubota | 久保田城 | 39.723771 | 140.124447 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E5%8D%83%E7%A7%8B%E5%85%AC%E5%9C%92) |
| nihonmatsu | 二本松城 | 37.602132 | 140.428418 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E9%9C%9E%E3%83%B6%E5%9F%8E%E5%85%AC%E5%9C%92) |
| shirakawa | 白河小峰城 | 37.134798 | 140.213432 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E5%B0%8F%E5%B3%B0%E5%9F%8E) |
| kunohe | 九戸城 | 40.267408 | 141.304637 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E4%B9%9D%E6%88%B8%E5%9F%8E) |
| miharu | 三春城 | 37.442553 | 140.496402 | [人文学オープンデータ共同利用センター（CODH）](https://geoshape.ex.nii.ac.jp/nrct-poi/resource/07/070000185900.html) |
| mukaihaguroyama | 向羽黒山城 | 37.444540 | 139.896377 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E5%90%91%E7%BE%BD%E9%BB%92%E5%B1%B1%E5%9F%8E) |
| mito | 水戸城 | 36.372165 | 140.483263 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E6%B0%B4%E6%88%B8%E7%AC%AC%E4%B8%80%E9%AB%98%E7%AD%89%E5%AD%A6%E6%A0%A1) |
| minowa | 箕輪城 | 36.404827 | 138.951091 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E7%AE%95%E8%BC%AA%E5%9F%8E) |
| nitta_kanayama | 新田金山城 | 36.317035 | 139.378301 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E9%87%91%E5%B1%B1%E5%9F%8E) |
| hachigata | 鉢形城 | 36.109370 | 139.196558 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E9%89%A2%E5%BD%A2%E5%9F%8E) |
| kawagoe | 川越城 | 35.924396 | 139.491683 | [人文学オープンデータ共同利用センター（CODH）](https://geoshape.ex.nii.ac.jp/nrct-poi/resource/11/110000103200.html) |
| edo | 江戸城 | 35.686691 | 139.750197 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E6%B1%9F%E6%88%B8%E5%9F%8E) |
| hachioji | 八王子城 | 35.652227 | 139.251821 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E5%85%AB%E7%8E%8B%E5%AD%90%E5%9F%8E) |
| motosakura | 本佐倉城 | 35.728012 | 140.259492 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E6%9C%AC%E4%BD%90%E5%80%89%E5%9F%8E) |
| otaki | 大多喜城 | 35.285885 | 140.239408 | [人文学オープンデータ共同利用センター（CODH）](https://geoshape.ex.nii.ac.jp/nrct-poi/resource/12/120000312500.html) |
| numata | 沼田城 | 36.648477 | 139.040046 | [人文学オープンデータ共同利用センター（CODH）](https://geoshape.ex.nii.ac.jp/nrct-poi/resource/10/100000036700.html) |
| kofu | 甲府城 | 35.664965 | 138.569890 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E7%94%B2%E5%BA%9C%E5%9F%8E) |
| kaizu | 海津城 | 36.565782 | 138.196061 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E6%9D%BE%E4%BB%A3%E5%9F%8E) |
| komoro | 小諸城 | 36.327162 | 138.417462 | [人文学オープンデータ共同利用センター（CODH）](https://geoshape.ex.nii.ac.jp/nrct-poi/resource/20/200000050400.html) |
| matsumoto | 松本城 | 36.238413 | 137.969372 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E6%9D%BE%E6%9C%AC%E5%9F%8E) |
| takato | 高遠城 | 35.832827 | 138.062668 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E9%AB%98%E9%81%A0%E5%9F%8E) |
| shibata | 新発田城 | 37.954781 | 139.326015 | [人文学オープンデータ共同利用センター（CODH）](https://geoshape.ex.nii.ac.jp/nrct-poi/resource/15/150000493200.html) |
| murakami | 村上城 | 38.221997 | 139.485859 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E6%9D%91%E4%B8%8A%E5%9F%8E) |
| shinpu | 新府城 | 35.735468 | 138.425547 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E6%96%B0%E5%BA%9C%E5%9F%8E) |
| toyama | 富山城 | 36.693094 | 137.208905 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E5%AF%8C%E5%B1%B1%E5%9F%8E) |
| takaoka | 高岡城 | 36.751462 | 137.020829 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E9%AB%98%E5%B2%A1%E5%9F%8E) |
| maruoka | 丸岡城 | 36.152363 | 136.272113 | [福井県](https://ckan.odp.jig.jp/dataset/jp-fukui-280-odp) |
| echizen_ono | 越前大野城 | 35.986617 | 136.483098 | [福井県](https://ckan.odp.jig.jp/dataset/jp-fukui-280-odp) |
| kuniyoshi | 佐柿国吉城 | 35.613355 | 135.966246 | [人文学オープンデータ共同利用センター（CODH）](https://geoshape.ex.nii.ac.jp/nrct-poi/resource/18/180000257600.html) |
| iwamura | 岩村城 | 35.359958 | 137.451322 | [人文学オープンデータ共同利用センター（CODH）](https://geoshape.ex.nii.ac.jp/nrct-poi/resource/21/210000307500.html) |
| yamanaka | 山中城 | 35.157761 | 138.992953 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E5%B1%B1%E4%B8%AD%E5%9F%8E) |
| kakegawa | 掛川城 | 34.776906 | 138.015145 | [人文学オープンデータ共同利用センター（CODH）](https://geoshape.ex.nii.ac.jp/nrct-poi/resource/22/220000295200.html) |
| inuyama | 犬山城 | 35.388349 | 136.939494 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E7%8A%AC%E5%B1%B1%E5%9F%8E) |
| nagoya | 名古屋城 | 35.184750 | 136.899688 | [人文学オープンデータ共同利用センター（CODH）](https://geoshape.ex.nii.ac.jp/nrct-poi/resource/23/230000054600.html) |
| nagashino | 長篠城 | 34.922830 | 137.559965 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E9%95%B7%E7%AF%A0%E5%9F%8E) |
| gujo_hachiman | 郡上八幡城 | 35.753116 | 136.961761 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E9%83%A1%E4%B8%8A%E5%85%AB%E5%B9%A1%E5%9F%8E) |
| naegi | 苗木城 | 35.513016 | 137.484570 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E8%8B%97%E6%9C%A8%E5%9F%8E) |
| ogaki | 大垣城 | 35.361779 | 136.616076 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E5%A4%A7%E5%9E%A3%E5%9F%8E) |
| takatenjin | 高天神城 | 34.697812 | 138.035070 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E9%AB%98%E5%A4%A9%E7%A5%9E%E5%9F%8E) |
| iga_ueno | 伊賀上野城 | 34.770453 | 136.128378 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E4%B8%8A%E9%87%8E%E5%9F%8E) |
| matsusaka | 松阪城 | 34.578785 | 136.525235 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E6%9D%BE%E9%98%AA%E5%9F%8E) |
| hikone | 彦根城 | 35.275941 | 136.250563 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E5%BD%A6%E6%A0%B9%E5%9F%8E) |
| azuchi | 安土城 | 35.155367 | 136.139654 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E5%AE%89%E5%9C%9F%E5%9F%8E) |
| osaka | 大坂城 | 34.686866 | 135.524009 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E5%A4%A7%E5%9D%82%E5%9F%8E) |
| himeji | 姫路城 | 34.837532 | 134.690944 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E5%A7%AB%E8%B7%AF%E5%9F%8E) |
| takeda_castle | 竹田城 | 35.299984 | 134.829204 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E7%AB%B9%E7%94%B0%E5%9F%8E) |
| takatori | 高取城 | 34.428712 | 135.827461 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E9%AB%98%E5%8F%96%E5%9F%8E) |
| wakayama | 和歌山城 | 34.227796 | 135.173008 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E5%92%8C%E6%AD%8C%E5%B1%B1%E5%9F%8E) |
| fukuchiyama | 福知山城 | 35.296870 | 135.129709 | [人文学オープンデータ共同利用センター（CODH）](https://geoshape.ex.nii.ac.jp/nrct-poi/resource/26/260000171300.html) |
| kishiwada | 岸和田城 | 34.458635 | 135.370785 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E5%B2%B8%E5%92%8C%E7%94%B0%E5%9F%8E) |
| yamato_koriyama | 大和郡山城 | 34.652505 | 135.777878 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E9%83%A1%E5%B1%B1%E5%9F%8E) |
| sumoto | 洲本城 | 34.337556 | 134.902405 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E6%B4%B2%E6%9C%AC%E5%9F%8E) |
| bitchu_matsuyama | 備中松山城 | 34.809128 | 133.622269 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E5%82%99%E4%B8%AD%E6%9D%BE%E5%B1%B1%E5%9F%8E) |
| tsuyama | 津山城 | 35.065028 | 134.005123 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E6%B4%A5%E5%B1%B1%E5%9F%8E) |
| hiroshima | 広島城 | 34.401337 | 132.459605 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E5%BA%83%E5%B3%B6%E5%9F%8E) |
| iwakuni | 岩国城 | 34.177770 | 132.174233 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E5%B2%A9%E5%9B%BD%E5%9F%8E) |
| hagi | 萩城 | 34.417852 | 131.383368 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E8%90%A9%E5%9F%8E) |
| matsue | 松江城 | 35.475964 | 133.049708 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E6%9D%BE%E6%B1%9F%E5%9F%8E) |
| yonago | 米子城 | 35.424497 | 133.323679 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E7%B1%B3%E5%AD%90%E5%9F%8E) |
| mihara | 三原城 | 34.406564 | 133.082609 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E4%B8%89%E5%8E%9F%E5%9F%8E) |
| shintakayama | 新高山城 | 34.420166 | 132.975814 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E6%96%B0%E9%AB%98%E5%B1%B1%E5%9F%8E) |
| tsuwano | 津和野城 | 34.459953 | 131.760617 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E6%B4%A5%E5%92%8C%E9%87%8E%E5%9F%8E) |
| tokushima | 徳島城 | 34.074491 | 134.553340 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E5%BE%B3%E5%B3%B6%E5%9F%8E) |
| sanuki_takamatsu | 高松城 | 34.350179 | 134.051644 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E9%AB%98%E6%9D%BE%E5%9F%8E) |
| marugame | 丸亀城 | 34.286268 | 133.800970 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E4%B8%B8%E4%BA%80%E5%9F%8E) |
| imabari | 今治城 | 34.063448 | 133.006735 | [人文学オープンデータ共同利用センター（CODH）](https://geoshape.ex.nii.ac.jp/nrct-poi/resource/39/390000087300.html) |
| uwajima | 宇和島城 | 33.220713 | 132.564428 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E5%AE%87%E5%92%8C%E5%B3%B6%E5%9F%8E) |
| kochi | 高知城 | 33.563984 | 133.531156 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E9%AB%98%E7%9F%A5%E5%9F%8E) |
| kokura | 小倉城 | 33.885349 | 130.873413 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E5%B0%8F%E5%80%89%E5%9F%8E) |
| fukuoka | 福岡城 | 33.584402 | 130.382191 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E7%A6%8F%E5%B2%A1%E5%9F%8E) |
| nakatsu | 中津城 | 33.606587 | 131.186435 | [大分県中津市](https://www.city-nakatsu.jp/doc/2013100100011/) |
| oka | 岡城 | 32.969012 | 131.405163 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E5%B2%A1%E5%9F%8E) |
| hizen_nagoya | 名護屋城 | 33.529930 | 129.869365 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E5%90%8D%E8%AD%B7%E5%B1%8B%E5%9F%8E) |
| hirado | 平戸城 | 33.368508 | 129.557468 | [国土地理院](https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E5%B9%B3%E6%88%B8%E5%9F%8E) |
| shimabara | 島原城 | 32.790087 | 130.366972 | [人文学オープンデータ共同利用センター（CODH）](https://geoshape.ex.nii.ac.jp/nrct-poi/resource/43/430000117700.html) |
| kagoshima | 鹿児島城 | 31.598100 | 130.552129 | [人文学オープンデータ共同利用センター（CODH）](https://geoshape.ex.nii.ac.jp/nrct-poi/resource/47/470000034700.html) |

## 再生成と確認

`assets/map/rebuild-vectors.py` は公式のNatural Earth元ZIPから陸域・県ポリゴンを再生成します。`rebuild-relief.py` は国土地理院タイルを取得して段彩・陰影WebPを作成します（Python、NumPy、Pillow）。`rebuild-map-data.py` は同じフォルダのGeoJSON・城位置JSONをまとめ、サイト直下の `map-data.js` に自己完結のブラウザ用データを出力します。配信用データでは海岸線・都道府県・河川・湖沼の各頂点を小数点以下6桁に丸め、元のGeoJSONと城の代表点は元精度で保持します。海岸線・県境などで共通する頂点は配信用の座標表に一度だけ収録し、地図を開く時に元の順序・形状のGeoJSONへ復元します。通常の閲覧にはこれらのPythonスクリプトや外部地図サービスとの通信は不要です。

緯度経度の範囲、128件のID一意性、ゲーム内の城名対応、ポリゴンの閉鎖、非有限値の不在、47県のレコード、画像寸法・投影範囲を確認しています。オンライン地図のライブタイルに依存せず、配布版でも同じ地形と位置を利用できます。
