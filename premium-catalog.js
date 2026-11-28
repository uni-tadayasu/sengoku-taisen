/* 戦国VS — product information only. Ownership comes from the account service. */
(function (root) {
  'use strict';
  const CONFIG = Object.freeze({ currency: 'JPY', locale: 'ja-JP', checkoutRequiresAccount: true });
  // Twelve seasonal palettes are shared by all years. Each paid billing period
  // grants one choice; the calendar month determines the three displayed styles.
  const SUPPORTER_THEMES = Object.freeze([
    ['初霞', '#152a3d', '#b4cee0', '#759cba', '#f3f8ff'],
    ['梅香', '#391e34', '#e7b0cb', '#96516f', '#fff0f5'],
    ['花雲', '#40232d', '#e8b5b7', '#ad6876', '#fff2e6'],
    ['若葉', '#18372d', '#c3d49a', '#4d8d6b', '#f5f8df'],
    ['青嵐', '#143a3e', '#a6d7cc', '#3d8f92', '#eafbf1'],
    ['雨翠', '#1c2945', '#b4bde8', '#6977aa', '#f1f3ff'],
    ['星涼', '#172944', '#dbd7a8', '#416e9e', '#fffce3'],
    ['夏宵', '#3b233a', '#efc584', '#976076', '#fff5df'],
    ['月白', '#253549', '#e3dcbb', '#7d93a7', '#ffffef'],
    ['紅葉', '#44251e', '#e8bc83', '#ac6745', '#fff2d8'],
    ['霜華', '#243947', '#c3e0e3', '#628b9b', '#f1fcff'],
    ['雪灯', '#203530', '#e9d7b0', '#648d7e', '#fff9eb']
  ].map(([name, background, border, accent, text]) => Object.freeze({ name, background, border, accent, text })));
  const SUPPORTER_MOTIFS = Object.freeze({
    flower: Object.freeze({ name: '花菱の旗印', description: '重なり合う花菱と細い唐草で仕立てた旗印' }),
    moon: Object.freeze({ name: '月輪の旗印', description: '満ちる月と重なる波紋で仕立てた旗印' }),
    star: Object.freeze({ name: '七星の旗印', description: '七つの星と幾何学の組紐で仕立てた旗印' })
  });
  const PRODUCTS = Object.freeze([
    {
      id: 'gold-banner', name: '金彩の旗印', kind: 'cosmetic', slot: 'nameplate', priceYen: 480, billingPeriod: 'one_time',
      summary: '深い藍の絹に金の花を織り込んだ旗印と、重厚な金彩の名札。あなたの一城を、凛とした装いに。',
      benefits: ['金刺繍と房飾りを描いた旗印', '領主名を彩る金箔調の名札', '通常の外観へいつでも切り替え'],
      previewKey: 'gold-banner', previewLabel: '金彩の旗印', previewDescription: '金の花刺繍を施した藍の旗と、金彩の名札の表示例です。名札には、接続中の領主名が表示されます。',
      art: { src: 'assets/premium/gold-banner-v1.webp', width: 1024, height: 1536, alt: '金色の花と葉の刺繍、房飾りを備えた濃紺の旗印' },
      availability: 'available', taxIncluded: true, priceIsTentative: false, transferable: false, gameplayBenefits: false
    },
    {
      id: 'moonlit-castle', name: '月影の城下', kind: 'cosmetic', slot: 'town', priceYen: 980, billingPeriod: 'one_time',
      summary: '藍の空に月が昇り、城の窓と灯籠が水面を照らす。育てた城下町を、穏やかな夜の景色へ。',
      benefits: ['月明かりと暖かな灯りを描いた城下町の背景', '施設の位置が変わらない、いつもの操作感', '通常の昼景と月夜をいつでも切り替え'],
      previewKey: 'moonlit-castle', previewLabel: '月影の城下', previewDescription: '月明かり、窓の灯り、川面の反射まで描いた完成背景です。施設の配置と操作は通常の城下町と同じです。',
      art: { src: 'assets/premium/moonlit-castle-v1.webp', width: 1536, height: 1024, alt: '月明かりの藍の空と、城や商家の暖かな灯りが川面に映る城下町' },
      availability: 'available', taxIncluded: true, priceIsTentative: false, transferable: false, gameplayBenefits: false
    },
    {
      id: 'supporter', name: '戦国VSサポーター', kind: 'subscription', slot: 'badge', priceYen: 780, billingPeriod: 'month',
      summary: '月額780円で戦国VSを継続支援。利用中のバッジに加え、支払いが完了した各利用期間に、季節の旗印と名札を3種から1種選べます。',
      benefits: ['支払済みの各利用期間につき、装飾3種から1種を確定で選択', '選んだ旗印と名札は解約後も所持・装備可能', '利用期間中に表示できるサポーターバッジ', '12か月の季節配色が毎年巡る、外観のみの特典'],
      monthlyChoice: { count: 1, options: 3, permanent: true, paletteCycleMonths: 12 },
      previewKey: 'supporter', previewLabel: 'サポーターバッジ', previewDescription: '黄金の花輪と藍の宝石を組み合わせた、支援の証です。名札横のバッジは実際の32px表示の見本です。',
      art: { src: 'assets/premium/supporter-badge-v1.webp', width: 1254, height: 1254, alt: '藍の宝石を黄金の花と葉で囲んだサポーターメダリオン' },
      availability: 'available', taxIncluded: true, priceIsTentative: false, transferable: false, gameplayBenefits: false
    },
    {
      id: 'reroll-pass-30d', name: '武将再抽選パス・30日', kind: 'pass', priceYen: 480, billingPeriod: 'one_time', durationDays: 30,
      summary: '購入反映から実時間30日間、勾玉で1人招集した武将を1日3回まで再抽選。元の武将と新しい武将を見比べて、1人を選べます。',
      benefits: ['1人招集を対象に、1日3回まで再抽選', '元の武将・再抽選した武将のどちらか1人を選択', '同じ招集結果の再抽選は1回まで。10人招集は対象外', '日本時間05:00に回数更新。未使用回数の繰越なし', '実時間30日で終了・自動更新なし・有効中の追加購入不可'],
      rerollRules: { dailyLimit: 3, resetTimeZone: 'Asia/Tokyo', resetHour: 5, drawSize: 1, rerollsPerDraw: 1, chooseOriginalOrNew: true, carryOver: false, autoRenew: false },
      previewKey: 'reroll-pass-30d', previewLabel: '武将再抽選パス', previewDescription: '1人招集の結果を1回だけ引き直し、元の武将と新しい武将から選ぶパスです。武将の獲得結果に影響する有料特典です。勾玉そのものは販売しません。',
      art: { src: 'assets/premium/reroll-pass-30d-v1.svg', width: 640, height: 640, alt: '二枚の武将札をめぐる翡翠と金の矢印を描いた再抽選パスの意匠' },
      availability: 'available', taxIncluded: true, priceIsTentative: false, transferable: false, gameplayBenefits: true
    },
    {
      "id": "vermilion-banner",
      "name": "紅蓮の旗印",
      "slot": "nameplate",
      "priceYen": 580,
      "summary": "朱漆の赤に、金の火輪と翼を重ねた旗印。赤銅の縁を施した領主名で、出陣の気概を表します。",
      "benefits": [
        "朱と金で仕立てた火輪の旗印",
        "深紅と金の専用名札",
        "城下の旗と領主名表示に反映"
      ],
      "previewDescription": "朱の旗印と、深紅・金の名札の表示例です。施設配置や能力は変わりません。",
      "kind": "cosmetic",
      "billingPeriod": "one_time",
      "previewKey": "vermilion-banner",
      "previewLabel": "紅蓮の旗印",
      "art": {
        "src": "assets/premium/vermilion-banner-v1.svg",
        "width": 640,
        "height": 960,
        "alt": "朱漆色の旗に金の火輪と翼を描いた紅蓮の旗印"
      },
      "availability": "available",
      "taxIncluded": true,
      "priceIsTentative": false,
      "transferable": false,
      "gameplayBenefits": false
    },
    {
      "id": "silver-banner",
      "name": "白銀の旗印",
      "slot": "nameplate",
      "priceYen": 580,
      "summary": "凛とした藍の地に、銀の月輪と結晶を配した旗印。白銀の輝きをまとい、領主名を端正に彩ります。",
      "benefits": [
        "月輪と結晶の白銀の旗印",
        "藍と銀の専用名札",
        "城下の旗と領主名表示に反映"
      ],
      "previewDescription": "藍と銀の旗印と、白銀の名札の表示例です。金彩・紅蓮の旗印と選んで切り替えられます。",
      "kind": "cosmetic",
      "billingPeriod": "one_time",
      "previewKey": "silver-banner",
      "previewLabel": "白銀の旗印",
      "art": {
        "src": "assets/premium/silver-banner-v1.svg",
        "width": 640,
        "height": 960,
        "alt": "深藍の旗に銀の月輪と結晶を配した白銀の旗印"
      },
      "availability": "available",
      "taxIncluded": true,
      "priceIsTentative": false,
      "transferable": false,
      "gameplayBenefits": false
    },
    {
      "id": "phoenix-medallion",
      "name": "鳳凰の勲章",
      "slot": "badge",
      "priceYen": 780,
      "summary": "左右に翼を広げた鳳凰と、朱の宝玉を重ねた勲章。領主名の横に飾れる、買い切りの装飾バッジです。",
      "benefits": [
        "黄金の鳳凰と朱の宝玉の専用勲章",
        "領主名の横に表示する装飾バッジ",
        "月額契約なしで所持・装備"
      ],
      "previewDescription": "黄金の鳳凰の勲章を領主名の横に表示します。サポーターバッジとは同じ枠で切り替えます。",
      "kind": "cosmetic",
      "billingPeriod": "one_time",
      "previewKey": "phoenix-medallion",
      "previewLabel": "鳳凰の勲章",
      "art": {
        "src": "assets/premium/phoenix-medallion-v1.svg",
        "width": 640,
        "height": 640,
        "alt": "金の翼を広げた鳳凰と朱の宝玉の勲章"
      },
      "availability": "available",
      "taxIncluded": true,
      "priceIsTentative": false,
      "transferable": false,
      "gameplayBenefits": false
    },
    {
      "id": "sakura-town",
      "name": "桜雲の城下",
      "slot": "town",
      "priceYen": 980,
      "summary": "城を包む淡い桜と、春の光にきらめく川。育てた城下町を、桜雲がたなびく春景色に着せ替えます。",
      "benefits": [
        "桜をまとった専用の城下町背景",
        "施設の位置を保ったまま景色を切り替え",
        "通常・月影・他の所持背景と選択可能"
      ],
      "previewDescription": "通常の城下と同じ施設配置を保った、桜の季節の専用背景です。生産量や合戦の性能は変わりません。",
      "kind": "cosmetic",
      "billingPeriod": "one_time",
      "previewKey": "sakura-town",
      "previewLabel": "桜雲の城下",
      "art": {
        "src": "assets/premium/sakura-town-v1.webp",
        "width": 1536,
        "height": 1024,
        "alt": "城郭と川沿いの桜が春の光を受ける桜雲の城下町"
      },
      "availability": "available",
      "taxIncluded": true,
      "priceIsTentative": false,
      "transferable": false,
      "gameplayBenefits": false
    },
    {
      "id": "snow-town",
      "name": "雪華の城下",
      "slot": "town",
      "priceYen": 980,
      "summary": "白雪をいただく屋根と山並み、澄んだ冬の空気。日々の内政を、静かな雪景色の城下町で楽しめます。",
      "benefits": [
        "雪をまとった専用の城下町背景",
        "施設の位置を保ったまま景色を切り替え",
        "通常・月影・他の所持背景と選択可能"
      ],
      "previewDescription": "通常の城下と同じ施設配置を保った、雪景色の専用背景です。施設の選択や増築はいつも通り操作できます。",
      "kind": "cosmetic",
      "billingPeriod": "one_time",
      "previewKey": "snow-town",
      "previewLabel": "雪華の城下",
      "art": {
        "src": "assets/premium/snow-town-v1.webp",
        "width": 1536,
        "height": 1024,
        "alt": "屋根と山並みに白雪をまとった静かな雪華の城下町"
      },
      "availability": "available",
      "taxIncluded": true,
      "priceIsTentative": false,
      "transferable": false,
      "gameplayBenefits": false
    },
    {
      "id": "castle-heritage",
      "name": "名城絵巻・全城対応",
      "kind": "cosmetic",
      "slot": "town",
      "priceYen": 980,
      "billingPeriod": "one_time",
      "summary": "あなたの城を、その城ならではの景観へ。一般123城の専用イラストをまとめて使える買い切り外観です。城下町・天下地図・出陣・公開プロフィールにも反映され、他のプレイヤーからも同じ景観が見えます。",
      "benefits": [
        "一般123城それぞれの専用イラストに対応",
        "同じ領主の所有城に合わせて自動で景観を選択",
        "城下町・天下地図・城詳細・出陣・公開プロフィールへ反映",
        "一度の購入で利用期限なし。本拠移転後も買い直し不要",
          "「ゲームに適用」で装備し、通常表示にも戻せます"
      ],
      "previewKey": "castle-heritage",
      "previewLabel": "名城絵巻・全城対応",
      "previewDescription": "城を選ぶと、その城専用の完成イラストを確認できます。見本の選択だけでは所持・装備状態は変わりません。",
      "art": {
        "src": "assets/castle-scenes/himeji-720.webp",
        "width": 1536,
        "height": 864,
        "alt": "白漆喰の連立天守と石垣、城下町を描いた姫路城の専用絵巻"
      },
      "availability": "available",
      "taxIncluded": true,
      "priceIsTentative": false,
      "transferable": false,
      "gameplayBenefits": false
    }
  ].map(product => Object.freeze({ ...product, art: Object.freeze(product.art), benefits: Object.freeze(product.benefits) })));
  const destinations = Object.freeze({
    'gold-banner': 'https://buy.stripe.com/fZu6oI3Iwdcd5kn4Um9MY04',
    'moonlit-castle': 'https://buy.stripe.com/dRmdRa6UI2xz6or1Ia9MY05',
    supporter: 'https://buy.stripe.com/7sY8wQdj6dcdbILaeG9MY06',
    'reroll-pass-30d': 'https://buy.stripe.com/cNi4gAgvi8VX4gj2Me9MY0c',
    'vermilion-banner': 'https://buy.stripe.com/aFa8wQ3Iw5JL1479aC9MY07',
    'silver-banner': 'https://buy.stripe.com/aFacN65QE4FHeUXaeG9MY08',
    'phoenix-medallion': 'https://buy.stripe.com/8x2aEY5QE5JL00386y9MY09',
    'sakura-town': 'https://buy.stripe.com/3cI6oIfre5JLeUX5Yq9MY0a',
    'snow-town': 'https://buy.stripe.com/28EaEYfrec893cfeuW9MY0b',
    'castle-heritage': 'https://buy.stripe.com/eVq7sM3IwgopcMP72u9MY0d'
  });
  const castleScenes = Object.freeze([{"id":"ishikawa","name":"石川城","region":"東北","included":false},{"id":"sannohe","name":"三戸城","region":"東北","included":false},{"id":"minato","name":"湊城","region":"東北","included":false},{"id":"kakunodate","name":"角館城","region":"東北","included":false},{"id":"yamagata","name":"山形城","region":"東北","included":false},{"id":"yonezawa","name":"米沢城","region":"東北","included":false},{"id":"kurokawa","name":"黒川城","region":"東北","included":false},{"id":"odaka","name":"小高城","region":"東北","included":false},{"id":"ota","name":"太田城","region":"関東","included":false},{"id":"utsunomiya","name":"宇都宮城","region":"関東","included":false},{"id":"mayabashi","name":"厩橋城","region":"関東","included":false},{"id":"oshi","name":"忍城","region":"関東","included":false},{"id":"odawara","name":"小田原城","region":"関東","included":false},{"id":"kasugayama","name":"春日山城","region":"甲信越","included":false},{"id":"ueda","name":"上田城","region":"甲信越","included":false},{"id":"tsutsujigasaki","name":"躑躅ヶ崎館","region":"甲信越","included":false},{"id":"nanao","name":"七尾城","region":"北陸","included":false},{"id":"kanazawa","name":"金沢御坊","region":"北陸","included":false},{"id":"ichijodani","name":"一乗谷城","region":"北陸","included":false},{"id":"sunpu","name":"駿府城","region":"東海","included":false},{"id":"hikuma","name":"引馬城","region":"東海","included":false},{"id":"okazaki","name":"岡崎城","region":"東海","included":false},{"id":"kiyosu","name":"清洲城","region":"東海","included":false},{"id":"inabayama","name":"稲葉山城","region":"東海","included":false},{"id":"odani","name":"小谷城","region":"近畿","included":false},{"id":"kannonji","name":"観音寺城","region":"近畿","included":false},{"id":"sakamoto","name":"坂本城","region":"近畿","included":false},{"id":"nijo","name":"二条御所","region":"近畿","included":true},{"id":"akutagawa","name":"芥川山城","region":"近畿","included":false},{"id":"takaya","name":"高屋城","region":"近畿","included":false},{"id":"tottori","name":"鳥取城","region":"中国","included":false},{"id":"gassan","name":"月山富田城","region":"中国","included":false},{"id":"okayama","name":"岡山城","region":"中国","included":false},{"id":"yoshida","name":"吉田郡山城","region":"中国","included":false},{"id":"yamaguchi","name":"山口館","region":"中国","included":false},{"id":"takamatsu","name":"備中高松城","region":"中国","included":false},{"id":"oko","name":"岡豊城","region":"四国","included":false},{"id":"yuzuki","name":"湯築城","region":"四国","included":false},{"id":"shozui","name":"勝瑞城","region":"四国","included":false},{"id":"sogo","name":"十河城","region":"四国","included":false},{"id":"akizuki","name":"秋月城","region":"九州","included":false},{"id":"tachibana","name":"立花城","region":"九州","included":false},{"id":"funai","name":"府内館","region":"九州","included":false},{"id":"saga","name":"佐賀城","region":"九州","included":false},{"id":"hitoyoshi","name":"人吉城","region":"九州","included":false},{"id":"kumamoto","name":"隈本城","region":"九州","included":false},{"id":"obi","name":"飫肥城","region":"九州","included":false},{"id":"uchijo","name":"内城","region":"九州","included":false},{"id":"hirosaki","name":"弘前城","region":"東北","included":false},{"id":"nejo","name":"根城","region":"東北","included":false},{"id":"morioka","name":"盛岡城","region":"東北","included":false},{"id":"sendai","name":"仙台城","region":"東北","included":false},{"id":"kubota","name":"久保田城","region":"東北","included":false},{"id":"nihonmatsu","name":"二本松城","region":"東北","included":false},{"id":"shirakawa","name":"白河小峰城","region":"東北","included":false},{"id":"kunohe","name":"九戸城","region":"東北","included":false},{"id":"miharu","name":"三春城","region":"東北","included":false},{"id":"mukaihaguroyama","name":"向羽黒山城","region":"東北","included":false},{"id":"mito","name":"水戸城","region":"関東","included":false},{"id":"minowa","name":"箕輪城","region":"関東","included":false},{"id":"nitta_kanayama","name":"新田金山城","region":"関東","included":false},{"id":"hachigata","name":"鉢形城","region":"関東","included":false},{"id":"kawagoe","name":"川越城","region":"関東","included":false},{"id":"edo","name":"江戸城","region":"関東","included":true},{"id":"hachioji","name":"八王子城","region":"関東","included":false},{"id":"motosakura","name":"本佐倉城","region":"関東","included":false},{"id":"otaki","name":"大多喜城","region":"関東","included":false},{"id":"numata","name":"沼田城","region":"関東","included":false},{"id":"kofu","name":"甲府城","region":"甲信越","included":false},{"id":"kaizu","name":"海津城","region":"甲信越","included":false},{"id":"komoro","name":"小諸城","region":"甲信越","included":false},{"id":"matsumoto","name":"松本城","region":"甲信越","included":false},{"id":"takato","name":"高遠城","region":"甲信越","included":false},{"id":"shibata","name":"新発田城","region":"甲信越","included":false},{"id":"murakami","name":"村上城","region":"甲信越","included":false},{"id":"shinpu","name":"新府城","region":"甲信越","included":false},{"id":"toyama","name":"富山城","region":"北陸","included":false},{"id":"takaoka","name":"高岡城","region":"北陸","included":false},{"id":"maruoka","name":"丸岡城","region":"北陸","included":false},{"id":"echizen_ono","name":"越前大野城","region":"北陸","included":false},{"id":"kuniyoshi","name":"佐柿国吉城","region":"北陸","included":false},{"id":"iwamura","name":"岩村城","region":"東海","included":false},{"id":"yamanaka","name":"山中城","region":"東海","included":false},{"id":"kakegawa","name":"掛川城","region":"東海","included":false},{"id":"inuyama","name":"犬山城","region":"東海","included":false},{"id":"nagoya","name":"名古屋城","region":"東海","included":true},{"id":"nagashino","name":"長篠城","region":"東海","included":false},{"id":"gujo_hachiman","name":"郡上八幡城","region":"東海","included":false},{"id":"naegi","name":"苗木城","region":"東海","included":false},{"id":"ogaki","name":"大垣城","region":"東海","included":false},{"id":"takatenjin","name":"高天神城","region":"東海","included":false},{"id":"iga_ueno","name":"伊賀上野城","region":"近畿","included":false},{"id":"matsusaka","name":"松阪城","region":"近畿","included":false},{"id":"hikone","name":"彦根城","region":"近畿","included":false},{"id":"azuchi","name":"安土城","region":"近畿","included":false},{"id":"osaka","name":"大坂城","region":"近畿","included":true},{"id":"himeji","name":"姫路城","region":"近畿","included":false},{"id":"takeda_castle","name":"竹田城","region":"近畿","included":false},{"id":"takatori","name":"高取城","region":"近畿","included":false},{"id":"wakayama","name":"和歌山城","region":"近畿","included":false},{"id":"fukuchiyama","name":"福知山城","region":"近畿","included":false},{"id":"kishiwada","name":"岸和田城","region":"近畿","included":false},{"id":"yamato_koriyama","name":"大和郡山城","region":"近畿","included":false},{"id":"sumoto","name":"洲本城","region":"近畿","included":false},{"id":"bitchu_matsuyama","name":"備中松山城","region":"中国","included":false},{"id":"tsuyama","name":"津山城","region":"中国","included":false},{"id":"hiroshima","name":"広島城","region":"中国","included":false},{"id":"iwakuni","name":"岩国城","region":"中国","included":false},{"id":"hagi","name":"萩城","region":"中国","included":false},{"id":"matsue","name":"松江城","region":"中国","included":false},{"id":"yonago","name":"米子城","region":"中国","included":false},{"id":"mihara","name":"三原城","region":"中国","included":false},{"id":"shintakayama","name":"新高山城","region":"中国","included":false},{"id":"tsuwano","name":"津和野城","region":"中国","included":false},{"id":"tokushima","name":"徳島城","region":"四国","included":false},{"id":"sanuki_takamatsu","name":"高松城","region":"四国","included":false},{"id":"marugame","name":"丸亀城","region":"四国","included":false},{"id":"imabari","name":"今治城","region":"四国","included":false},{"id":"uwajima","name":"宇和島城","region":"四国","included":false},{"id":"kochi","name":"高知城","region":"四国","included":false},{"id":"kokura","name":"小倉城","region":"九州","included":false},{"id":"fukuoka","name":"福岡城","region":"九州","included":false},{"id":"nakatsu","name":"中津城","region":"九州","included":false},{"id":"oka","name":"岡城","region":"九州","included":false},{"id":"hizen_nagoya","name":"名護屋城","region":"九州","included":false},{"id":"hirado","name":"平戸城","region":"九州","included":false},{"id":"shimabara","name":"島原城","region":"九州","included":false},{"id":"kagoshima","name":"鹿児島城","region":"九州","included":true},{"id":"kyoto_gosho","name":"京都御所","region":"近畿","included":true}].map(item => Object.freeze(item)));
  const getCastleScenes = () => castleScenes.map(item => ({ ...item }));
  const find = id => typeof id === 'string' ? PRODUCTS.find(product => product.id === id) : undefined;
  const copy = product => ({ ...product, art: { ...product.art }, benefits: [...product.benefits], ...(product.monthlyChoice ? { monthlyChoice: { ...product.monthlyChoice } } : {}), ...(product.rerollRules ? { rerollRules: { ...product.rerollRules } } : {}), ...(product.palette ? { palette: { ...product.palette } } : {}) });
  function getSupporterChoices(periodKey) {
    const match = typeof periodKey === 'string' && /^(\d{4})(0[1-9]|1[0-2])$/.exec(periodKey);
    if (!match || Number(match[1]) < 2026) return [];
    const theme = SUPPORTER_THEMES[Number(match[2]) - 1];
    return Object.entries(SUPPORTER_MOTIFS).map(([motif, detail]) => ({
      id: `supporter-${periodKey}-${motif}`, name: `${match[1]}年${Number(match[2])}月・${theme.name} ${detail.name}`,
      kind: 'reward', slot: 'nameplate', billingPeriod: 'reward', acquisition: 'supporter_monthly_choice', periodKey, motif,
      summary: `${detail.description}。${Number(match[2])}月の「${theme.name}」配色で、領主名も彩ります。`,
      benefits: ['支払済みの対象期間の選択権で確定入手', '選択後は解約しても所持・装備可能', '武将の能力・兵力・資源への効果はありません'],
      previewKey: `supporter-${periodKey}-${motif}`, previewLabel: `${theme.name} ${detail.name}`,
      previewDescription: '旗印と名札の外観です。季節の配色は12か月で巡り、翌年も同じ意匠を使用します。',
      art: { src: `assets/premium/supporter-${match[2]}-${motif}-v1.svg`, width: 640, height: 960, alt: `${theme.name}の配色による${detail.description}` },
      palette: { background: theme.background, border: theme.border, accent: theme.accent, text: theme.text },
      availability: 'reward', transferable: false, gameplayBenefits: false, permanent: true
    }));
  }
  function getSupporterReward(id) {
    const match = typeof id === 'string' && /^supporter-(\d{4}(?:0[1-9]|1[0-2]))-(flower|moon|star)$/.exec(id);
    return match ? getSupporterChoices(match[1]).find(product => product.id === id) || null : null;
  }
  const getProducts = () => PRODUCTS.map(copy);
  const getProduct = id => { const product = find(id); return product ? copy(product) : getSupporterReward(id); };

  // Display information and caller-provided configuration never authorize a
  // bare payment link. The runtime obtains the account-bound destination.
  function getPurchaseState(productOrId) {
    const id = typeof productOrId === 'string' ? productOrId : productOrId?.id;
    return { productId: typeof id === 'string' ? id : '', status: find(id) ? 'account_required' : 'unavailable', enabled: false, label: find(id) ? 'ゲームで購入する' : '商品を確認できません', url: '', reason: find(id) ? 'runtime_required' : 'unknown_product' };
  }

  function checkoutURL(productId, value) {
    if (!find(productId) || typeof value !== 'string' || !value.startsWith('https://') || /[\s\\\u0000-\u001f\u007f]/u.test(value)) return '';
    try {
      const url = new URL(value), expected = new URL(destinations[productId]);
      const keys = [...url.searchParams.keys()], reference = url.searchParams.get('client_reference_id');
      if (url.origin !== expected.origin || url.pathname !== expected.pathname || url.username || url.password || url.hash || keys.length !== 1 || keys[0] !== 'client_reference_id' || !/^[a-zA-Z0-9_-]{24,200}$/.test(reference || '')) return '';
      return url.href;
    } catch { return ''; }
  }

  const api = Object.freeze({ version: 5, getCastleScenes, config: CONFIG, getConfig: () => ({ ...CONFIG }), getProducts, getProduct, getSupporterChoices, getSupporterReward, getPurchaseState, checkoutURL });
  root.SengokuPremiumCatalog = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
