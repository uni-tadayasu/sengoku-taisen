/* Independently drawn native SVG crests. Historical attribution and limitations: SOURCES-KAMON.md. */
(function(root){
  'use strict';
  const catalog = [
  {
    "id": "awaya",
    "clan": "粟屋家",
    "name": "花菱に扇",
    "motif": "flowerfan",
    "kind": "kamon",
    "status": "traditional",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "若狭国吉城の粟屋勝久系統に合わせ、扇に花菱を置く意匠を採用。",
    "sourceIds": [
      "awaya"
    ],
    "url": "assets/kamon/awaya.svg"
  },
  {
    "id": "ando",
    "clan": "安東家",
    "name": "檜扇に違い鷲の羽",
    "motif": "featherfan",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "安東氏の後裔・秋田家の資料に見える秋田扇を参照。羽根と扇骨は小型表示用の略図。",
    "sourceIds": [
      "ando"
    ],
    "url": "assets/kamon/ando.svg"
  },
  {
    "id": "date",
    "clan": "伊達家",
    "name": "竹に雀（仙台笹）",
    "motif": "date",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "仙台伊達氏の代表紋。伊達氏には他にも九曜・引両・桐などの紋が伝わる。",
    "sourceIds": [
      "date-zuihoden",
      "meihaku"
    ],
    "url": "assets/kamon/date.svg"
  },
  {
    "id": "ito",
    "clan": "伊東家",
    "name": "庵木瓜",
    "motif": "iori",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "日向伊東家の資料に見える、庵形と木瓜を組み合わせた紋。",
    "sourceIds": [
      "ito"
    ],
    "url": "assets/kamon/ito.svg"
  },
  {
    "id": "ii",
    "clan": "井伊家",
    "name": "丸に橘",
    "motif": "citrus",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "彦根井伊家の代表紋。花・実・葉の細線を整理した略図。",
    "sourceIds": [
      "meihaku"
    ],
    "url": "assets/kamon/ii.svg"
  },
  {
    "id": "ukita",
    "clan": "宇喜多家",
    "name": "剣片喰",
    "motif": "kenclover",
    "kind": "kamon",
    "status": "traditional",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "宇喜多秀家に結び付けられる代表紋を採用。児文字など別の紋も伝わる。",
    "sourceIds": [
      "ukita"
    ],
    "url": "assets/kamon/ukita.svg"
  },
  {
    "id": "utsunomiya",
    "clan": "宇都宮家",
    "name": "左三つ巴",
    "motif": "tomoe",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "栃木県の軍旗資料に見える巴紋を参照。",
    "sourceIds": [
      "utsunomiya"
    ],
    "url": "assets/kamon/utsunomiya.svg"
  },
  {
    "id": "toyama",
    "clan": "遠山家",
    "name": "丸に二つ引両",
    "motif": "bars2",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "遠山氏に伝わる二つ引両を採用。地域・分家ごとの使用物の厳密な復刻ではない。",
    "sourceIds": [
      "toyama"
    ],
    "url": "assets/kamon/toyama.svg"
  },
  {
    "id": "endo",
    "clan": "遠藤家",
    "name": "十曜",
    "motif": "stars10",
    "kind": "kamon",
    "status": "traditional",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "郡上遠藤氏の伝承紋の一つを採用。亀甲・月星など複数の使用紋が伝わる。",
    "sourceIds": [
      "endo"
    ],
    "url": "assets/kamon/endo.svg"
  },
  {
    "id": "okudaira",
    "clan": "奥平家",
    "name": "奥平唐団扇",
    "motif": "gunbai",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "奥平氏の代表的な団扇紋を輪郭中心に描いた略図。",
    "sourceIds": [
      "meihaku"
    ],
    "url": "assets/kamon/okudaira.svg"
  },
  {
    "id": "kato",
    "clan": "加藤家",
    "name": "蛇の目",
    "motif": "snakeeye",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "加藤清正・嘉明の両系統が混在するゲーム設定のため、加藤氏の代表紋の一つを採用。",
    "sourceIds": [
      "meihaku"
    ],
    "url": "assets/kamon/kato.svg"
  },
  {
    "id": "kono",
    "clan": "河野家",
    "name": "折敷に三文字",
    "motif": "oshiki3",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "伊予河野氏の意匠。折敷の内側に三文字を置く形を幾何学的に整理。",
    "sourceIds": [
      "kono"
    ],
    "url": "assets/kamon/kono.svg"
  },
  {
    "id": "gamo",
    "clan": "蒲生家",
    "name": "対い鶴",
    "motif": "cranes",
    "kind": "kamon",
    "status": "traditional",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "蒲生氏郷に伝わる対い鶴を採用。鶴の姿勢や羽根の細部は略図。",
    "sourceIds": [
      "gamo"
    ],
    "url": "assets/kamon/gamo.svg"
  },
  {
    "id": "kanto-group",
    "clan": "関東諸家",
    "name": "関東連旗の群章",
    "motif": "group0",
    "kind": "group",
    "status": "unverified",
    "description": "複数勢力を表すゲーム独自の群章。",
    "note": "複数の家をまとめたゲーム内勢力。三本の旗を組み合わせた創作群章で、史実の家紋ではない。",
    "sourceIds": [],
    "url": "assets/kamon/kanto-group.svg"
  },
  {
    "id": "yoshimi",
    "clan": "吉見家",
    "name": "丸に二つ引両",
    "motif": "bars2",
    "kind": "kamon",
    "status": "traditional",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "津和野・石見系の吉見氏として整理。同姓の別系統の紋を一律に割り当てない。",
    "sourceIds": [
      "yoshimi"
    ],
    "url": "assets/kamon/yoshimi.svg"
  },
  {
    "id": "kikkawa",
    "clan": "吉川家",
    "name": "丸に三つ引",
    "motif": "bars3",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "吉川氏の代表的な引両紋。",
    "sourceIds": [
      "meihaku"
    ],
    "url": "assets/kamon/kikkawa.svg"
  },
  {
    "id": "kinki-group",
    "clan": "近畿諸家",
    "name": "近畿連旗の群章",
    "motif": "group1",
    "kind": "group",
    "status": "unverified",
    "description": "複数勢力を表すゲーム独自の群章。",
    "note": "複数の家をまとめたゲーム内勢力。創作群章で、史実の家紋ではない。",
    "sourceIds": [],
    "url": "assets/kamon/kinki-group.svg"
  },
  {
    "id": "kanamori",
    "clan": "金森家",
    "name": "梅鉢（表梅鉢）",
    "motif": "plum",
    "kind": "kamon",
    "status": "traditional",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "金森長近・可重の時期を想定して表梅鉢を採用。後代の裏梅鉢とは区別。",
    "sourceIds": [
      "kanamori"
    ],
    "url": "assets/kamon/kanamori.svg"
  },
  {
    "id": "kunohe",
    "clan": "九戸家",
    "name": "九曜",
    "motif": "stars9",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "九戸村の案内資料に見える九戸氏の代表紋。",
    "sourceIds": [
      "kunohe"
    ],
    "url": "assets/kamon/kunohe.svg"
  },
  {
    "id": "kyushu-group",
    "clan": "九州諸家",
    "name": "九州連旗の群章",
    "motif": "group2",
    "kind": "group",
    "status": "unverified",
    "description": "複数勢力を表すゲーム独自の群章。",
    "note": "複数の家をまとめたゲーム内勢力。創作群章で、史実の家紋ではない。",
    "sourceIds": [],
    "url": "assets/kamon/kyushu-group.svg"
  },
  {
    "id": "yuki",
    "clan": "結城家",
    "name": "左三つ巴",
    "motif": "tomoe",
    "kind": "kamon",
    "status": "traditional",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "白河小峰城の結城氏を想定。結城氏には竹に雀など複数の紋が伝わる。",
    "sourceIds": [
      "shirakawayuki"
    ],
    "url": "assets/kamon/yuki.svg"
  },
  {
    "id": "tozawa",
    "clan": "戸沢家",
    "name": "九曜",
    "motif": "stars9",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "新庄まつりで伝承される戸沢家の九曜紋を参照。",
    "sourceIds": [
      "tozawa"
    ],
    "url": "assets/kamon/tozawa.svg"
  },
  {
    "id": "kuroda",
    "clan": "黒田家",
    "name": "黒田藤",
    "motif": "wisteria",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "黒田氏の藤紋を小型表示用に整理。個々の花房や葉の配置は略図。",
    "sourceIds": [
      "meihaku"
    ],
    "url": "assets/kamon/kuroda.svg"
  },
  {
    "id": "imagawa",
    "clan": "今川家",
    "name": "二つ引両",
    "motif": "bars2",
    "kind": "kamon",
    "status": "traditional",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "足利一門の今川氏に伝わる引両紋を採用。赤鳥など他の紋もある。",
    "sourceIds": [
      "imagawa"
    ],
    "url": "assets/kamon/imagawa.svg"
  },
  {
    "id": "satake",
    "clan": "佐竹家",
    "name": "扇に月丸",
    "motif": "sunfan",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "佐竹氏の扇紋。扇骨の細線は小型表示用に整理。",
    "sourceIds": [
      "meihaku"
    ],
    "url": "assets/kamon/satake.svg"
  },
  {
    "id": "mogami",
    "clan": "最上家",
    "name": "丸に二つ引両",
    "motif": "bars2",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "山形市の資料に見える最上氏の引両紋。",
    "sourceIds": [
      "mogami"
    ],
    "url": "assets/kamon/mogami.svg"
  },
  {
    "id": "saito",
    "clan": "斎藤家",
    "name": "二頭波",
    "motif": "wave",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "斎藤道三に結び付けられる波紋を採用。波頭は独自に描き起こした略図。",
    "sourceIds": [
      "meihaku"
    ],
    "url": "assets/kamon/saito.svg"
  },
  {
    "id": "hosokawa",
    "clan": "細川家",
    "name": "九曜",
    "motif": "stars9",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "九曜を用いた諸家の一つとして資料に記された細川氏の代表紋。",
    "sourceIds": [
      "tozawa"
    ],
    "url": "assets/kamon/hosokawa.svg"
  },
  {
    "id": "local-group",
    "clan": "在地衆",
    "name": "在地連旗の群章",
    "motif": "group6",
    "kind": "group",
    "status": "unverified",
    "description": "複数勢力を表すゲーム独自の群章。",
    "note": "ゲーム内の在地勢力を表す創作群章。特定の史実上の家紋を表さない。",
    "sourceIds": [],
    "url": "assets/kamon/local-group.svg"
  },
  {
    "id": "miyoshi",
    "clan": "三好家",
    "name": "三階菱に釘抜",
    "motif": "miyoshi",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "三階菱と釘抜を組み合わせた三好氏の代表紋。釘抜は抜き形で表現。",
    "sourceIds": [
      "miyoshi"
    ],
    "url": "assets/kamon/miyoshi.svg"
  },
  {
    "id": "mimura",
    "clan": "三村家",
    "name": "剣片喰",
    "motif": "kenclover",
    "kind": "kamon",
    "status": "traditional",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "備中三村氏の伝承紋として採用。",
    "sourceIds": [
      "mimura"
    ],
    "url": "assets/kamon/mimura.svg"
  },
  {
    "id": "yamauchi",
    "clan": "山内家",
    "name": "丸に土佐柏",
    "motif": "oak3",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "土佐山内氏の柏紋。葉脈は省略した略図。",
    "sourceIds": [
      "meihaku"
    ],
    "url": "assets/kamon/yamauchi.svg"
  },
  {
    "id": "yamana",
    "clan": "山名家",
    "name": "二つ引両",
    "motif": "bars2",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "山名氏の代表紋。使用物による外丸の有無などの差はある。",
    "sourceIds": [
      "meihaku"
    ],
    "url": "assets/kamon/yamana.svg"
  },
  {
    "id": "ujiie",
    "clan": "氏家家",
    "name": "左三つ巴",
    "motif": "tomoe",
    "kind": "kamon",
    "status": "traditional",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "氏家卜全に結び付けられる巴紋を採用。",
    "sourceIds": [
      "ujiie"
    ],
    "url": "assets/kamon/ujiie.svg"
  },
  {
    "id": "shibata-katsuie",
    "clan": "柴田家",
    "name": "二つ雁金",
    "motif": "geese",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "柴田勝家の代表紋。鳥の姿勢は画面で識別しやすい略図。",
    "sourceIds": [
      "meihaku"
    ],
    "url": "assets/kamon/shibata-katsuie.svg"
  },
  {
    "id": "akizuki",
    "clan": "秋月家",
    "name": "剣菱（替紋）",
    "motif": "kenbishi",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "県立図書館が挙げる秋月氏の替紋・旗紋を採用。本紋の三つ撫子と混同しない。",
    "sourceIds": [
      "akizuki"
    ],
    "url": "assets/kamon/akizuki.svg"
  },
  {
    "id": "sogo",
    "clan": "十河家",
    "name": "檜扇",
    "motif": "fanstand",
    "kind": "kamon",
    "status": "traditional",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "十河氏に伝わる扇紋を採用。扇台を添えたゲーム用の略図で、現存軍旗の復刻ではない。",
    "sourceIds": [
      "sogo"
    ],
    "url": "assets/kamon/sogo.svg"
  },
  {
    "id": "ogasawara",
    "clan": "小笠原家",
    "name": "三階菱",
    "motif": "threeDiamonds",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "小笠原氏の代表的な三階菱。",
    "sourceIds": [
      "meihaku"
    ],
    "url": "assets/kamon/ogasawara.svg"
  },
  {
    "id": "koide",
    "clan": "小出家",
    "name": "丸に額",
    "motif": "plaque",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "岸和田市の小出家甲冑資料に見える額紋を参照。",
    "sourceIds": [
      "koide"
    ],
    "url": "assets/kamon/koide.svg"
  },
  {
    "id": "kobayakawa",
    "clan": "小早川家",
    "name": "左三つ巴",
    "motif": "tomoe",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "小早川氏の代表紋。小早川秀秋の違い鎌など、人物ごとの別紋は共通章に反映していない。",
    "sourceIds": [
      "meihaku"
    ],
    "url": "assets/kamon/kobayakawa.svg"
  },
  {
    "id": "matsuura",
    "clan": "松浦家",
    "name": "三つ星",
    "motif": "stars3",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "平戸松浦氏の星紋。梶葉紋も伝わる。",
    "sourceIds": [
      "matsuura",
      "matsuura-flag"
    ],
    "url": "assets/kamon/matsuura.svg"
  },
  {
    "id": "matsunaga",
    "clan": "松永家",
    "name": "蔦",
    "motif": "ivy",
    "kind": "kamon",
    "status": "traditional",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "松永久秀に結び付けられる蔦紋の略図。",
    "sourceIds": [
      "matsunaga"
    ],
    "url": "assets/kamon/matsunaga.svg"
  },
  {
    "id": "matsukura",
    "clan": "松倉家",
    "name": "九曜",
    "motif": "stars9",
    "kind": "kamon",
    "status": "traditional",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "島原城の松倉氏の紋として紹介される九曜を採用。",
    "sourceIds": [
      "matsukura"
    ],
    "url": "assets/kamon/matsukura.svg"
  },
  {
    "id": "uesugi",
    "clan": "上杉家",
    "name": "竹に二羽飛び雀（上杉笹）",
    "motif": "uesugi",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "飛び雀を配した上杉笹の略図。伊達家の竹に雀とは鳥の羽の姿勢を変えている。",
    "sourceIds": [
      "meihaku",
      "date-zuihoden"
    ],
    "url": "assets/kamon/uesugi.svg"
  },
  {
    "id": "jo",
    "clan": "城家",
    "name": "並び鷹の羽（参考意匠）",
    "motif": "parallelfeathers",
    "kind": "reference",
    "status": "unverified",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "隈本城の城親賢系統に関する二次資料を参照。一次資料による図様の照合が未了のため参考意匠として表示。",
    "sourceIds": [
      "jo"
    ],
    "url": "assets/kamon/jo.svg"
  },
  {
    "id": "oda",
    "clan": "織田家",
    "name": "織田木瓜",
    "motif": "oda",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "五つの外郭を持つ織田木瓜の略図。歴代の使用物による葉・花弁の細部差は統合。",
    "sourceIds": [
      "oda-gifu",
      "meihaku"
    ],
    "url": "assets/kamon/oda.svg"
  },
  {
    "id": "shibata",
    "clan": "新発田家",
    "name": "四つ目結（参考意匠）",
    "motif": "tiltmeyui",
    "kind": "reference",
    "status": "unverified",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "伝世軍旗の紹介を参考に四つ目結を採用。重家に三つ星を挙げる資料もあり図様の同定は未確定。溝口家の五階菱とは区別。",
    "sourceIds": [
      "shibata-flag",
      "shibata-stars"
    ],
    "url": "assets/kamon/shibata.svg"
  },
  {
    "id": "mori-ranmaru",
    "clan": "森家",
    "name": "鶴丸",
    "motif": "crane",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "森氏に伝わる鶴丸を、翼と首の輪郭中心に描いた略図。",
    "sourceIds": [
      "meihaku"
    ],
    "url": "assets/kamon/mori-ranmaru.svg"
  },
  {
    "id": "sanada",
    "clan": "真田家",
    "name": "六連銭",
    "motif": "sanada",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "真田氏の代表的な六連銭。各銭の刻字は省略。",
    "sourceIds": [
      "meihaku"
    ],
    "url": "assets/kamon/sanada.svg"
  },
  {
    "id": "jinbo",
    "clan": "神保家",
    "name": "丸に竪二つ引",
    "motif": "vertical2",
    "kind": "kamon",
    "status": "traditional",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "越中神保氏の伝承紋として採用。",
    "sourceIds": [
      "jinbo"
    ],
    "url": "assets/kamon/jinbo.svg"
  },
  {
    "id": "nishina",
    "clan": "仁科家",
    "name": "揚羽蝶",
    "motif": "butterfly",
    "kind": "kamon",
    "status": "traditional",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "信濃仁科氏に伝わる蝶紋を採用。個々の人物の使用物を復刻したものではない。",
    "sourceIds": [
      "nishina"
    ],
    "url": "assets/kamon/nishina.svg"
  },
  {
    "id": "narita",
    "clan": "成田家",
    "name": "月に三つ引両",
    "motif": "moonbars",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "『日本紋章学』に記された成田氏の月・三引両を参照した略図。",
    "sourceIds": [
      "mon1926"
    ],
    "url": "assets/kamon/narita.svg"
  },
  {
    "id": "shimizu",
    "clan": "清水家",
    "name": "三つ巴",
    "motif": "tomoe",
    "kind": "kamon",
    "status": "traditional",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "備中清水宗治に伝わる巴紋。紹介資料で左右の図様に相違があるため名称は三つ巴とし、本図では左巴を採用。",
    "sourceIds": [
      "shimizu"
    ],
    "url": "assets/kamon/shimizu.svg"
  },
  {
    "id": "ikoma",
    "clan": "生駒家",
    "name": "半車（生駒車）",
    "motif": "halfWheel",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "生駒家の半車紋を参照。車輪と下部の線を整理した略図。",
    "sourceIds": [
      "ikoma"
    ],
    "url": "assets/kamon/ikoma.svg"
  },
  {
    "id": "akamatsu",
    "clan": "赤松家",
    "name": "二つ引両に三つ巴",
    "motif": "tomoeBars",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "赤松氏の引両と巴を組み合わせた意匠を参照。",
    "sourceIds": [
      "akamatsu",
      "mon1926"
    ],
    "url": "assets/kamon/akamatsu.svg"
  },
  {
    "id": "sengoku",
    "clan": "仙石家",
    "name": "永楽銭",
    "motif": "coin",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "仙石氏の永楽銭紋。永樂通寳の四文字は画面表示用の字形で、鋳銭の刻字の復刻ではない。",
    "sourceIds": [
      "meihaku"
    ],
    "url": "assets/kamon/sengoku.svg"
  },
  {
    "id": "chiba",
    "clan": "千葉家",
    "name": "月星",
    "motif": "moonstar",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "千葉氏の月星紋。大きい円を月、小さい円を星として表す形を採用。",
    "sourceIds": [
      "chiba"
    ],
    "url": "assets/kamon/chiba.svg"
  },
  {
    "id": "azai",
    "clan": "浅井家",
    "name": "三つ盛り亀甲に花菱",
    "motif": "kikko",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "三つの亀甲の中に花菱を置く浅井氏の代表紋。",
    "sourceIds": [
      "meihaku"
    ],
    "url": "assets/kamon/azai.svg"
  },
  {
    "id": "asano",
    "clan": "浅野家",
    "name": "違い鷹の羽",
    "motif": "feathers",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "浅野氏の代表紋。羽根の細部は略図。",
    "sourceIds": [
      "meihaku"
    ],
    "url": "assets/kamon/asano.svg"
  },
  {
    "id": "maeda",
    "clan": "前田家",
    "name": "加賀梅鉢",
    "motif": "kenplum",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "加賀前田氏の梅鉢紋。花の間の線を小型表示に合わせて整理。",
    "sourceIds": [
      "meihaku"
    ],
    "url": "assets/kamon/maeda.svg"
  },
  {
    "id": "soma",
    "clan": "相馬家",
    "name": "繋ぎ馬",
    "motif": "horse",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "相馬氏の馬紋。九曜など他の紋も伝わる。",
    "sourceIds": [
      "soma"
    ],
    "url": "assets/kamon/soma.svg"
  },
  {
    "id": "sagara",
    "clan": "相良家",
    "name": "長剣梅鉢",
    "motif": "kenplum",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "相良氏に伝わる家紋の一つ。相良瓜など別の紋もある。",
    "sourceIds": [
      "meihaku"
    ],
    "url": "assets/kamon/sagara.svg"
  },
  {
    "id": "ashikaga",
    "clan": "足利家",
    "name": "二つ引両",
    "motif": "bars2",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "足利氏の代表紋として二つ引両を採用。",
    "sourceIds": [
      "meihaku"
    ],
    "url": "assets/kamon/ashikaga.svg"
  },
  {
    "id": "murakami",
    "clan": "村上家",
    "name": "丸に上の字",
    "motif": "upglyph",
    "kind": "kamon",
    "status": "traditional",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "瀬戸内の村上武吉系統に合わせた文字紋。家名の頭文字を代用した創作章ではない。",
    "sourceIds": [
      "murakami"
    ],
    "url": "assets/kamon/murakami.svg"
  },
  {
    "id": "ota",
    "clan": "太田家",
    "name": "太田桔梗",
    "motif": "kikyo",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "太田氏の桔梗紋。外郭・花弁は略図。",
    "sourceIds": [
      "meihaku"
    ],
    "url": "assets/kamon/ota.svg"
  },
  {
    "id": "ouchi",
    "clan": "大内家",
    "name": "大内菱",
    "motif": "oueuchi",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "大内氏の唐花菱系の装飾を参照。中世の大内菱には複数の形があり、本図は花弁と菱形外郭を組み合わせた略図。",
    "sourceIds": [
      "ouchi",
      "ouchi-research"
    ],
    "url": "assets/kamon/ouchi.svg"
  },
  {
    "id": "otomo",
    "clan": "大友家",
    "name": "抱き杏葉",
    "motif": "gyoyo",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "大友氏の杏葉紋。馬具に由来する輪郭を整理。",
    "sourceIds": [
      "meihaku"
    ],
    "url": "assets/kamon/otomo.svg"
  },
  {
    "id": "ikeda",
    "clan": "池田家",
    "name": "揚羽蝶",
    "motif": "butterfly",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "池田氏の代表的な蝶紋。翅の細線は省略。",
    "sourceIds": [
      "meihaku"
    ],
    "url": "assets/kamon/ikeda.svg"
  },
  {
    "id": "chugoku-group",
    "clan": "中国諸家",
    "name": "中国連旗の群章",
    "motif": "group3",
    "kind": "group",
    "status": "unverified",
    "description": "複数勢力を表すゲーム独自の群章。",
    "note": "複数の家をまとめたゲーム内勢力。創作群章で、史実の家紋ではない。",
    "sourceIds": [],
    "url": "assets/kamon/chugoku-group.svg"
  },
  {
    "id": "nakagawa",
    "clan": "中川家",
    "name": "中川柏",
    "motif": "oak2",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "中川氏の柏紋に関する研究を参照。枝葉の上下や細部には使用資料による差がある。",
    "sourceIds": [
      "nakagawa"
    ],
    "url": "assets/kamon/nakagawa.svg"
  },
  {
    "id": "nakamura",
    "clan": "中村家",
    "name": "星梅鉢",
    "motif": "plum",
    "kind": "kamon",
    "status": "traditional",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "中村一氏系統の伝承紋を採用。米子城の中村一忠を同系統として整理。",
    "sourceIds": [
      "nakamura"
    ],
    "url": "assets/kamon/nakamura.svg"
  },
  {
    "id": "asakura",
    "clan": "朝倉家",
    "name": "三つ盛り木瓜",
    "motif": "asakura",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "三つの木瓜を組み合わせた朝倉氏の代表紋。",
    "sourceIds": [
      "meihaku"
    ],
    "url": "assets/kamon/asakura.svg"
  },
  {
    "id": "asahina",
    "clan": "朝比奈家",
    "name": "左三つ巴",
    "motif": "tomoe",
    "kind": "kamon",
    "status": "traditional",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "朝比奈泰朝らの朝比奈氏に伝わる巴紋を採用。",
    "sourceIds": [
      "asahina",
      "mon1926"
    ],
    "url": "assets/kamon/asahina.svg"
  },
  {
    "id": "chosokabe",
    "clan": "長宗我部家",
    "name": "七つ片喰",
    "motif": "clover7",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "七組の片喰を配する長宗我部氏の代表紋。",
    "sourceIds": [
      "meihaku"
    ],
    "url": "assets/kamon/chosokabe.svg"
  },
  {
    "id": "nagano",
    "clan": "長野家",
    "name": "檜扇",
    "motif": "fan",
    "kind": "kamon",
    "status": "traditional",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "上野長野業正の伝承紋を参照。扇骨は表示用に整理。",
    "sourceIds": [
      "nagano"
    ],
    "url": "assets/kamon/nagano.svg"
  },
  {
    "id": "tsugaru",
    "clan": "津軽家",
    "name": "卍（旗印）",
    "motif": "manji",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "弘前市が津軽氏の旗印として紹介する卍を採用。津軽家の甲冑には牡丹の丸紋も確認できる。寺社・家紋に使われる日本の伝統的な紋様として表示。",
    "sourceIds": [
      "tsugaru",
      "tsugaru-armor"
    ],
    "url": "assets/kamon/tsugaru.svg"
  },
  {
    "id": "tamura",
    "clan": "田村家",
    "name": "田村茗荷",
    "motif": "buds",
    "kind": "kamon",
    "status": "traditional",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "田村氏に伝わる茗荷紋の略図。",
    "sourceIds": [
      "tamura"
    ],
    "url": "assets/kamon/tamura.svg"
  },
  {
    "id": "shimazu",
    "clan": "島津家",
    "name": "丸に十文字",
    "motif": "shimazu",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "島津氏の代表的な十文字紋。",
    "sourceIds": [
      "meihaku"
    ],
    "url": "assets/kamon/shimazu.svg"
  },
  {
    "id": "tohoku-group",
    "clan": "東北諸家",
    "name": "東北連旗の群章",
    "motif": "group4",
    "kind": "group",
    "status": "unverified",
    "description": "複数勢力を表すゲーム独自の群章。",
    "note": "複数の家をまとめたゲーム内勢力。創作群章で、史実の家紋ではない。",
    "sourceIds": [],
    "url": "assets/kamon/tohoku-group.svg"
  },
  {
    "id": "tsutsui",
    "clan": "筒井家",
    "name": "梅鉢",
    "motif": "plum",
    "kind": "kamon",
    "status": "traditional",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "筒井順慶に結び付けられる梅鉢紋を採用。",
    "sourceIds": [
      "jo"
    ],
    "url": "assets/kamon/tsutsui.svg"
  },
  {
    "id": "todo",
    "clan": "藤堂家",
    "name": "蔦",
    "motif": "ivy",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "藤堂氏の代表的な蔦紋。",
    "sourceIds": [
      "meihaku"
    ],
    "url": "assets/kamon/todo.svg"
  },
  {
    "id": "tokugawa",
    "clan": "徳川家",
    "name": "三つ葉葵",
    "motif": "aoi",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "徳川氏の代表紋。葵葉の葉脈や外丸は画面表示用に整理した略図で、時期ごとの細部差は統合。",
    "sourceIds": [
      "meihaku"
    ],
    "url": "assets/kamon/tokugawa.svg"
  },
  {
    "id": "nabeshima",
    "clan": "鍋島家",
    "name": "花杏葉",
    "motif": "gyoyoflower",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "鍋島氏の杏葉紋を参照した略図。",
    "sourceIds": [
      "meihaku"
    ],
    "url": "assets/kamon/nabeshima.svg"
  },
  {
    "id": "nanbu",
    "clan": "南部家",
    "name": "対い鶴",
    "motif": "cranes",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "南部氏の代表的な対い鶴。鶴の姿勢・月や星の細部には資料ごとの相違がある。",
    "sourceIds": [
      "meihaku"
    ],
    "url": "assets/kamon/nanbu.svg"
  },
  {
    "id": "amago",
    "clan": "尼子家",
    "name": "平四つ目結",
    "motif": "meyui",
    "kind": "kamon",
    "status": "traditional",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "尼子氏に結び付けられる四つ目結を採用。同族・分家による傾きや配置の違いはある。",
    "sourceIds": [
      "amago"
    ],
    "url": "assets/kamon/amago.svg"
  },
  {
    "id": "hatakeyama",
    "clan": "畠山家",
    "name": "二つ引両",
    "motif": "bars2",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "図書館の照会資料で確認できる畠山氏の代表紋。",
    "sourceIds": [
      "hatakeyama"
    ],
    "url": "assets/kamon/hatakeyama.svg"
  },
  {
    "id": "iio",
    "clan": "飯尾家",
    "name": "鉸具に雁金",
    "motif": "buckleGeese",
    "kind": "kamon",
    "status": "traditional",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "遠江飯尾連竜系統に結び付けられる鉸具・雁金の組み合わせを参照。",
    "sourceIds": [
      "iio",
      "mon1926"
    ],
    "url": "assets/kamon/iio.svg"
  },
  {
    "id": "takeda",
    "clan": "武田家",
    "name": "四割菱（武田菱）",
    "motif": "takeda",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "武田氏の代表紋。四つの菱形の間隔を小型表示用に確保。",
    "sourceIds": [
      "meihaku"
    ],
    "url": "assets/kamon/takeda.svg"
  },
  {
    "id": "fukushima",
    "clan": "福島家",
    "name": "福島沢瀉",
    "motif": "omodaka",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "福島正則に伝わる沢瀉紋。葉と茎の細部は略図。",
    "sourceIds": [
      "meihaku"
    ],
    "url": "assets/kamon/fukushima.svg"
  },
  {
    "id": "hachisuka",
    "clan": "蜂須賀家",
    "name": "丸に左卍",
    "motif": "marumanji",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "蜂須賀氏の代表紋。日本の伝統的な家紋・仏教紋様として表示。",
    "sourceIds": [
      "meihaku"
    ],
    "url": "assets/kamon/hachisuka.svg"
  },
  {
    "id": "toyotomi",
    "clan": "豊臣家",
    "name": "五七桐",
    "motif": "kiri",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "豊臣氏の代表的な桐紋。桐の花房や葉脈は略図。",
    "sourceIds": [
      "meihaku"
    ],
    "url": "assets/kamon/toyotomi.svg"
  },
  {
    "id": "hojo",
    "clan": "北条家",
    "name": "三つ鱗",
    "motif": "hojo",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "後北条氏の代表紋。三つの鱗の間を小型表示用にわずかに離している。",
    "sourceIds": [
      "meihaku"
    ],
    "url": "assets/kamon/hojo.svg"
  },
  {
    "id": "hokuriku-group",
    "clan": "北陸諸家",
    "name": "北陸連旗の群章",
    "motif": "group5",
    "kind": "group",
    "status": "unverified",
    "description": "複数勢力を表すゲーム独自の群章。",
    "note": "複数の家や人物をまとめたゲーム内勢力。創作群章で、史実の家紋ではない。",
    "sourceIds": [],
    "url": "assets/kamon/hokuriku-group.svg"
  },
  {
    "id": "horio",
    "clan": "堀尾家",
    "name": "分銅",
    "motif": "fundo",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "松江城の堀尾氏に関する分銅紋の資料を参照。",
    "sourceIds": [
      "horio"
    ],
    "url": "assets/kamon/horio.svg"
  },
  {
    "id": "hongwanji",
    "clan": "本願寺勢",
    "name": "下り藤",
    "motif": "downwisteria",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "本願寺の宗門紋を参照。宗主の紋章には時代による変化があり、戦国期の一向一揆全体に共通の軍旗だったとは断定しない。",
    "sourceIds": [
      "hongwanji",
      "hongwanji-history"
    ],
    "url": "assets/kamon/hongwanji.svg"
  },
  {
    "id": "honjo",
    "clan": "本庄家",
    "name": "五七桐",
    "motif": "kiri",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "越後本庄氏の五七桐を参照。上杉笹など他の紋も伝わる。",
    "sourceIds": [
      "honjo"
    ],
    "url": "assets/kamon/honjo.svg"
  },
  {
    "id": "honda",
    "clan": "本多家",
    "name": "丸に立ち葵",
    "motif": "tachiaoi",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "本多氏の立ち葵紋を参照した略図。徳川氏の三つ葉葵とは茎葉の構成を区別。",
    "sourceIds": [
      "meihaku"
    ],
    "url": "assets/kamon/honda.svg"
  },
  {
    "id": "akechi",
    "clan": "明智家",
    "name": "桔梗",
    "motif": "kikyo",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "明智氏の代表的な桔梗紋。画面では他の家紋と同じ金色で表示。",
    "sourceIds": [
      "meihaku"
    ],
    "url": "assets/kamon/akechi.svg"
  },
  {
    "id": "mori",
    "clan": "毛利家",
    "name": "一文字三星",
    "motif": "mori",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "毛利氏の代表紋。三つの星と一文字の構成を保持。",
    "sourceIds": [
      "meihaku"
    ],
    "url": "assets/kamon/mori.svg"
  },
  {
    "id": "yura",
    "clan": "由良家",
    "name": "大中黒（新田一つ引）",
    "motif": "bar1",
    "kind": "kamon",
    "status": "traditional",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "新田氏の系統とされる由良氏の代表意匠として採用。個別人物の遺品を復刻したものではない。",
    "sourceIds": [
      "yura"
    ],
    "url": "assets/kamon/yura.svg"
  },
  {
    "id": "satomi",
    "clan": "里見家",
    "name": "丸に二つ引",
    "motif": "bars2",
    "kind": "kamon",
    "status": "traditional",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "安房里見義堯の系統に伝わる引両紋。",
    "sourceIds": [
      "jo"
    ],
    "url": "assets/kamon/satomi.svg"
  },
  {
    "id": "tachibana",
    "clan": "立花家",
    "name": "祇園守",
    "motif": "gion",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "立花氏の代表的な祇園守を、小型表示用に幾何学的に整理。",
    "sourceIds": [
      "meihaku"
    ],
    "url": "assets/kamon/tachibana.svg"
  },
  {
    "id": "ryuzoji",
    "clan": "龍造寺家",
    "name": "十二日足",
    "motif": "twelveSun",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "十二本の光芒を持つ龍造寺氏の日足紋。",
    "sourceIds": [
      "meihaku"
    ],
    "url": "assets/kamon/ryuzoji.svg"
  },
  {
    "id": "suzuki",
    "clan": "鈴木家",
    "name": "八咫烏",
    "motif": "crow",
    "kind": "kamon",
    "status": "traditional",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "雑賀鈴木重秀の系統に結び付けられる三本足の烏の意匠を採用。",
    "sourceIds": [
      "suzuki"
    ],
    "url": "assets/kamon/suzuki.svg"
  },
  {
    "id": "rokkaku",
    "clan": "六角家",
    "name": "隅立て四つ目結",
    "motif": "tiltmeyui",
    "kind": "kamon",
    "status": "traditional",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "佐々木六角氏の伝承紋として採用。",
    "sourceIds": [
      "rokkaku"
    ],
    "url": "assets/kamon/rokkaku.svg"
  },
  {
    "id": "wakisaka",
    "clan": "脇坂家",
    "name": "輪違い",
    "motif": "rings",
    "kind": "kamon",
    "status": "documented",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "脇坂氏の甲冑などに見える二輪の組み合わせを参照。",
    "sourceIds": [
      "wakisaka"
    ],
    "url": "assets/kamon/wakisaka.svg"
  },
  {
    "id": "ashina",
    "clan": "蘆名家",
    "name": "丸に三つ引",
    "motif": "bars3",
    "kind": "kamon",
    "status": "traditional",
    "description": "史料・伝承に見える名称をもとに独自に描いたゲーム用の略図。",
    "note": "会津蘆名氏に伝わる三つ引紋を採用。",
    "sourceIds": [
      "ashina"
    ],
    "url": "assets/kamon/ashina.svg"
  }
];
  const sources = [
  {
    "id": "meihaku",
    "title": "名古屋刀剣博物館：家紋の種類と武将の家紋",
    "url": "https://www.meihaku.jp/family-crest-illust/",
    "kind": "museum"
  },
  {
    "id": "oda-gifu",
    "title": "岐阜市：織田家の家紋・織田木瓜",
    "url": "https://www.city.gifu.lg.jp/kankoubunka/kankou/1013050/1005149/1017450/1017465/1020522.html",
    "kind": "municipality"
  },
  {
    "id": "date-zuihoden",
    "title": "瑞鳳殿：伊達家の家紋に関する解説",
    "url": "https://www.zuihoden.com/document/qa/others/",
    "kind": "museum"
  },
  {
    "id": "awaya",
    "title": "城びと：国吉城と粟屋勝久の花菱に扇",
    "url": "https://shirobito.jp/article/994",
    "kind": "secondary"
  },
  {
    "id": "ando",
    "title": "三春町歴史民俗資料館：秋田家の家紋",
    "url": "https://www2.town.miharu.fukushima.jp/soshiki/19/kamon.html",
    "kind": "museum"
  },
  {
    "id": "utsunomiya",
    "title": "とちぎデジタルミュージアム：宇都宮氏三つ巴紋軍旗",
    "url": "https://www.digitalmuseum.pref.tochigi.lg.jp/museweb/detail?cls=collect3b&pkey=%E6%96%87%E8%B3%87-000105",
    "kind": "museum"
  },
  {
    "id": "toyama",
    "title": "飯田市：遠山の霜月祭りと遠山氏の二つ引両",
    "url": "https://www.city.iida.lg.jp/site/bunkazai/shimotsukimatsuri.html",
    "kind": "municipality"
  },
  {
    "id": "ukita",
    "title": "肥前名護屋城・陣跡：宇喜多秀家",
    "url": "https://www.ainetmakoto.jp/nagoyajyo-karatsu/busho.php?id=85&nav=1",
    "kind": "secondary"
  },
  {
    "id": "endo",
    "title": "千葉氏の一族：遠藤氏の系譜と家紋",
    "url": "https://www.chibasi.net/endou.htm",
    "kind": "secondary"
  },
  {
    "id": "kono",
    "title": "三春町歴史民俗資料館：折敷に三文字と河野氏",
    "url": "https://www.town.miharu.fukushima.jp/soshiki/19/rekimincolumn31.html",
    "kind": "museum"
  },
  {
    "id": "gamo",
    "title": "肥前名護屋城・陣跡：蒲生氏郷",
    "url": "https://www.ainetmakoto.jp/nagoyajyo-karatsu/busho.php?id=2&nav=1",
    "kind": "secondary"
  },
  {
    "id": "yoshimi",
    "title": "民俗と家紋：吉見氏の家紋",
    "url": "https://folklore2017.com/871.htm",
    "kind": "secondary"
  },
  {
    "id": "kanamori",
    "title": "金森戦記：金森氏の家紋・表梅鉢と裏梅鉢",
    "url": "https://kanamorisennki.sakura.ne.jp/jinnbutudenn-new/kamonn.html",
    "kind": "secondary"
  },
  {
    "id": "kunohe",
    "title": "九戸村：九戸城・九戸政実の案内図",
    "url": "https://www.vill.kunohe.iwate.jp/brand/map/kunohe-map.pdf",
    "kind": "municipality"
  },
  {
    "id": "shirakawayuki",
    "title": "家系図調査：福島県の結城氏と家紋",
    "url": "https://kakeisi.com/survey/survey_fukusima.html",
    "kind": "secondary"
  },
  {
    "id": "tozawa",
    "title": "新庄まつり：戸沢家の家紋・九曜紋",
    "url": "https://shinjo-matsuri.jp/db/mikoshi/emblem",
    "kind": "official-culture"
  },
  {
    "id": "imagawa",
    "title": "家紋の広場：引両紋を用いた諸家",
    "url": "https://www.rifnet.or.jp/kamon/cate_list.php?k_cate=y01_m",
    "kind": "secondary"
  },
  {
    "id": "mogami",
    "title": "山形市：最上氏の家紋",
    "url": "https://www.city.yamagata-yamagata.lg.jp/bunkasports/geijyutsu/1006703/1013262.html",
    "kind": "municipality"
  },
  {
    "id": "miyoshi",
    "title": "四條畷市：三好長慶と三階菱の紋",
    "url": "https://www.city.shijonawate.lg.jp/uploaded/attachment/9581.pdf",
    "kind": "municipality"
  },
  {
    "id": "mimura",
    "title": "八光堂：片喰紋を用いた諸家",
    "url": "https://hakko-daiodo.com/kamon-c/cate2/katabami/katabami-mon.html",
    "kind": "secondary"
  },
  {
    "id": "ujiie",
    "title": "民俗と家紋：氏家氏と左三つ巴",
    "url": "https://folklore2017.com/kamon/kamon2/0824.htm",
    "kind": "secondary"
  },
  {
    "id": "akizuki",
    "title": "宮崎県立図書館・国立国会図書館レファレンス：秋月氏の家紋",
    "url": "https://crd.ndl.go.jp/reference/entry/index.php?id=1000048641&page=ref_view",
    "kind": "library"
  },
  {
    "id": "sogo",
    "title": "高松経済新聞：十河氏の家紋と檜扇",
    "url": "https://takamatsu.keizai.biz/column/22/",
    "kind": "secondary"
  },
  {
    "id": "koide",
    "title": "岸和田市：小出家の甲冑と額紋",
    "url": "https://www.city.kishiwada.lg.jp/page/70-kyoudo-siryou.html",
    "kind": "municipality"
  },
  {
    "id": "matsuura",
    "title": "松浦史料博物館：松浦家の歴史",
    "url": "https://www.matsura.or.jp/rekishi/nenpyo/",
    "kind": "museum"
  },
  {
    "id": "matsuura-flag",
    "title": "長崎県文化財データベース：松浦家の旗指物",
    "url": "https://www.pref.nagasaki.jp/bunkadb/index.php/view/299",
    "kind": "municipality"
  },
  {
    "id": "matsunaga",
    "title": "いろは家紋：松永久秀と蔦",
    "url": "https://irohakamon.com/sengoku/kamon_matsunagahisahide.html",
    "kind": "secondary"
  },
  {
    "id": "matsukura",
    "title": "攻城団：島原城御城印の松倉九曜紋",
    "url": "https://kojodan.jp/collection/gojyoin/item/135/",
    "kind": "secondary"
  },
  {
    "id": "jo",
    "title": "いろは家紋：戦国武将と家紋一覧（城親賢）",
    "url": "https://irohakamon.com/sengoku/",
    "kind": "secondary"
  },
  {
    "id": "shibata-flag",
    "title": "佐々木家資料紹介：新発田氏の軍旗と四つ目結",
    "url": "https://sasaki.la.coocan.jp/sasakike/sasakike_03.html",
    "kind": "secondary"
  },
  {
    "id": "shibata-stars",
    "title": "いろは家紋：三つ星（新発田重家）",
    "url": "https://irohakamon.com/kamon/hoshi/mitsuboshi.html",
    "kind": "secondary"
  },
  {
    "id": "jinbo",
    "title": "いろは家紋：丸に竪二つ引（神保氏）",
    "url": "https://irohakamon.com/kamon/hikiryou/marunitatefutatsuhiki.html",
    "kind": "secondary"
  },
  {
    "id": "nishina",
    "title": "戦国ジャーナル：仁科盛信と仁科氏の揚羽蝶",
    "url": "https://sengoku-journal.com/busho/nishina-morinobu",
    "kind": "secondary"
  },
  {
    "id": "mon1926",
    "title": "沼田頼輔『日本紋章学』（1926年、国立国会図書館所蔵資料の画像）",
    "url": "https://upload.wikimedia.org/wikipedia/commons/5/50/NDL980775_%E6%97%A5%E6%9C%AC%E7%B4%8B%E7%AB%A0%E5%AD%A6_part1.pdf",
    "kind": "historical-book"
  },
  {
    "id": "shimizu",
    "title": "備中高松城・清水宗治の紹介：清水家の巴紋",
    "url": "https://www.bitchu.jp/muneharu/muneharu/right.html",
    "kind": "local-history"
  },
  {
    "id": "ikoma",
    "title": "由利本荘市：生駒家の半車紋を付した獅子頭",
    "url": "https://www.city.yurihonjo.lg.jp/1001503/1002098/1002113/1002128/1003572.html",
    "kind": "municipality"
  },
  {
    "id": "akamatsu",
    "title": "兵庫県立歴史博物館：赤松円心と城山城",
    "url": "https://rekihaku.pref.hyogo.lg.jp/digital_museum/akamatsu/",
    "kind": "museum"
  },
  {
    "id": "chiba",
    "title": "習志野市：千葉氏と月星紋",
    "url": "https://www.city.narashino.lg.jp/citypromotion/shizen/walk/sansaku/h8/sansaku014.html",
    "kind": "municipality"
  },
  {
    "id": "soma",
    "title": "守谷中央図書館・ADEAC：相馬氏の家紋",
    "url": "https://adeac.jp/moriya-lib/texthtml/d100050/mp000010-100050/ht000700",
    "kind": "library"
  },
  {
    "id": "murakami",
    "title": "家紋データベース：村上武吉の丸に上の字",
    "url": "https://kamondb.com/samurai-mu/",
    "kind": "secondary"
  },
  {
    "id": "ouchi",
    "title": "山口県の文化財：大内菱を付した資料",
    "url": "https://bunkazai.pref.yamaguchi.lg.jp/sp/bunkazai/summary.asp?mid=90033",
    "kind": "municipality"
  },
  {
    "id": "nakagawa",
    "title": "甲子園短期大学紀要：中川氏の柏紋について",
    "url": "https://www.jstage.jst.go.jp/article/koshient/16/0/16_23/_pdf",
    "kind": "research"
  },
  {
    "id": "nakamura",
    "title": "いろは家紋：星梅鉢（中村一氏）",
    "url": "https://irohakamon.com/kamon/ume/hoshiumebachi.html",
    "kind": "secondary"
  },
  {
    "id": "asahina",
    "title": "民俗と家紋：朝比奈氏の巴紋",
    "url": "https://folklore2017.com/20000/19916.htm",
    "kind": "secondary"
  },
  {
    "id": "nagano",
    "title": "いろは家紋：檜扇（長野業正）",
    "url": "https://irohakamon.com/kamon/ougi/hiougi.html",
    "kind": "secondary"
  },
  {
    "id": "tamura",
    "title": "一族のルーツ：田村茗荷",
    "url": "https://ichizoku-roots.com/kamon/tamura-myoga",
    "kind": "secondary"
  },
  {
    "id": "ito",
    "title": "日南市・飫肥城歴史資料館：伊東家の庵木瓜紋",
    "url": "https://www.city.nichinan.lg.jp/museum/shishiteibunnkazai/bijutsukougeishina/5/4140.html",
    "kind": "museum"
  },
  {
    "id": "hatakeyama",
    "title": "石川県立図書館・国立国会図書館レファレンス：畠山家の家紋",
    "url": "https://crd.ndl.go.jp/reference/entry/index.php?id=1000190069&page=ref_view",
    "kind": "library"
  },
  {
    "id": "iio",
    "title": "いびすぺでぃあ：飯尾連竜と鉸具に雁金",
    "url": "https://ibispedia.com/kamon",
    "kind": "secondary"
  },
  {
    "id": "horio",
    "title": "松江市：松江城の分銅紋瓦と堀尾氏",
    "url": "https://www.city.matsue.lg.jp/material/files/group/34/chosa_colmn17.pdf",
    "kind": "municipality"
  },
  {
    "id": "hongwanji",
    "title": "本願寺：宗門の紋章の規程",
    "url": "https://www.hongwanji.or.jp/info/reiki_int/reiki_honbun/x034RG00000162.html",
    "kind": "official-religious"
  },
  {
    "id": "hongwanji-history",
    "title": "浄土真宗本願寺派総合研究所：本願寺宗主の紋章の変遷",
    "url": "https://j-soken.jp/files/jssk/jssk_10_11.pdf",
    "kind": "research"
  },
  {
    "id": "honjo",
    "title": "村上市観光協会：本庄氏と五七桐",
    "url": "https://www.sake3.com/mukashinomukashi/25",
    "kind": "official-culture"
  },
  {
    "id": "suzuki",
    "title": "いろは家紋：八咫烏（雑賀鈴木氏）",
    "url": "https://irohakamon.com/kamon/karasu/yatagarasu.html",
    "kind": "secondary"
  },
  {
    "id": "rokkaku",
    "title": "八光堂：隅立て四つ目結と六角氏",
    "url": "https://hakko-daiodo.com/kamon-c/cate0/yotsume/yotsume3.html",
    "kind": "secondary"
  },
  {
    "id": "wakisaka",
    "title": "兵庫県立歴史博物館：脇坂家の甲冑と輪違い",
    "url": "https://rekihaku.pref.hyogo.lg.jp/digital_museum/bugu-kacchuu/kc_commentary3/",
    "kind": "museum"
  },
  {
    "id": "ashina",
    "title": "民俗と家紋：蘆名氏の三つ引",
    "url": "https://folklore2017.com/kamon/027.htm",
    "kind": "secondary"
  },
  {
    "id": "tsugaru",
    "title": "弘前市：津軽氏の旗印と市章",
    "url": "https://www.city.hirosaki.aomori.jp/gaiyou/shisho/shisho.html",
    "kind": "municipality"
  },
  {
    "id": "tsugaru-armor",
    "title": "弘前市：津軽信政着用具足と牡丹の丸紋",
    "url": "https://www.city.hirosaki.aomori.jp/gaiyou/bunkazai/ken/ken30.html",
    "kind": "municipality"
  },
  {
    "id": "ouchi-research",
    "title": "鹿島美術研究・年報第28号別冊：大内菱の形状の変遷",
    "url": "https://grant-kajima-fa.jp/ebook/contents/book_r028/pageindices/index16.html",
    "kind": "research"
  },
  {
    "id": "yura",
    "title": "民俗と家紋：由良氏の系統と大中黒",
    "url": "https://folklore2017.com/10000/80000/80060.htm",
    "kind": "secondary"
  },
  {
    "id": "amago",
    "title": "民俗と家紋：尼子氏と平四つ目結",
    "url": "https://folklore2017.com/kamon/kamon2/1007.htm",
    "kind": "secondary"
  }
];
  const fallback = {"id": "unaffiliated", "clan": "未登録の勢力", "name": "連旗の参考章", "motif": "group6", "kind": "reference", "status": "unverified", "description": "未登録の勢力を識別するための創作章。", "note": "史実の家紋を確認できないため、ゲーム独自の連旗章を表示。", "sourceIds": [], "url": "assets/kamon/unaffiliated.svg"};
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  for (const item of catalog) { Object.freeze(item.sourceIds); Object.freeze(item); }
  for (const source of sources) Object.freeze(source);
  Object.freeze(catalog); Object.freeze(sources); Object.freeze(fallback.sourceIds); Object.freeze(fallback);
  const byClan=new Map(catalog.map(item=>[item.clan,item]));
  const aliases={'德川家':'徳川家','德川':'徳川家','芦名家':'蘆名家','芦名':'蘆名家','本願寺':'本願寺勢','在地勢力':'在地衆'};
  function get(clan){
    const raw=typeof clan==='string'?clan.trim():'';
    const key=aliases[raw]||raw;
    return byClan.get(key)||byClan.get(key+'家')||fallback;
  }
  function render(clan,options={}){
    options=options&&typeof options==='object'?options:{};
    const entry=get(clan),value=Number(options.size),size=Number.isFinite(value)&&value>0?Math.max(12,Math.min(512,Math.round(value))):40;
    const raw=typeof clan==='string'?clan.trim():'';
    const clanLabel=raw==='德川家'||raw==='德川'?'德川家':entry===fallback?(raw||entry.clan):entry.clan;
    const label=clanLabel+'：'+entry.name;
    const classes=['sengoku-kamon',options.label?'sengoku-kamon--label':'',String(options.className||'').replace(/[^a-zA-Z0-9_ -]/g,'')].filter(Boolean).join(' ');
    return '<span class="'+esc(classes)+'" style="--kamon-size:'+size+'px" role="img" aria-label="'+esc(label)+'" title="'+esc(label)+'"><img src="'+entry.url+'" width="'+size+'" height="'+size+'" alt="" loading="lazy" decoding="async" draggable="false">'+(options.label?'<span class="sengoku-kamon__caption"><b>'+esc(clanLabel)+'</b><small>'+esc(entry.name)+'</small></span>':'')+'</span>';
  }
  const api=Object.freeze({url:clan=>get(clan).url,render,get,entries:()=>catalog.slice(),getSources:()=>sources.slice(),version:1});
  root.SengokuKamon=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
