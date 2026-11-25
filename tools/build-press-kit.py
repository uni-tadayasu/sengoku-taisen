#!/usr/bin/env python3
"""Package the approved public press material. No account or network access."""
from datetime import datetime
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import sys
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
EDITION = '20261126'
OUTPUT = ROOT / f'assets/promo/sengoku-vs-press-kit-{EDITION}.zip'
SITE = json.loads((ROOT / 'site-metadata.json').read_text(encoding='utf-8'))
FILES = {
    f'text/sengoku-vs-facts-ja.txt': f'assets/promo/sengoku-vs-facts-ja-{EDITION}.txt',
    f'text/sengoku-vs-posts-ja.txt': f'assets/promo/sengoku-vs-posts-ja-{EDITION}.txt',
    f'text/sengoku-vs-facts-en.txt': f'assets/promo/sengoku-vs-facts-en-{EDITION}.txt',
    f'text/sengoku-vs-video-copy-ja.txt': f'assets/promo/sengoku-vs-video-copy-ja-{EDITION}.txt',
    'brand/sengoku-vs-mark.svg': f'assets/branding/sengoku-vs-mark-{EDITION}.svg',
    'brand/sengoku-vs-icon-512.png': SITE['logo']['path'],
    'images/sengoku-vs-main.jpg': SITE['ogImage']['path'],
}
for key in ('guide', 'recovery', 'about', 'premium'):
    FILES[f'images/sengoku-vs-{key}.jpg'] = SITE['pages'][key]['socialImage']['path']
for key in ('title', 'town', 'map', 'officers'):
    FILES[f'screenshots/sengoku-vs-{key}.jpg'] = f'assets/promo/screenshots/sengoku-vs-{key}-{EDITION}.jpg'
FILES['screenshots/capture-manifest.json'] = 'assets/promo/screenshots/manifest.json'

README = f'''戦国VS / SENGOKU VS — 紹介・掲載用素材
更新日: 2026年11月26日

公式サイト: {SITE['origin']}/
ゲーム紹介: {SITE['origin']}/sengoku-vs/
素材と最新情報: {SITE['origin']}/press/
著作権表記: © KASAI SOLUTIONS

国内向けの日本語紹介文と投稿文、動画用タイトル・説明文、英語の作品概要、
1200×630pxの共有画像5種類、ブランド紋章のSVG・512px PNG、
1363×936pxの実ゲーム画面4枚を収録しています。
ゲームUIと公式ガイドは現在、日本語です。

作品紹介の際は、作品名「戦国VS」、公式URL、著作権表記を添えてください。
images/ は公式イラストによる紹介画像、screenshots/ はローカルデモの
実ゲーム画面です。実画面は清洲城から新しく開始した撮影用デモで、
実プレイヤーの記録を含みません。画面上部のデモ表示を残しています。
人物・地図・家紋などの第三者資料の出典は公式サイトの
作品概要・制作資料を参照してください。

縦型の紹介動画はファイルサイズを抑えるため別配布です。
{SITE['origin']}/assets/promo/sengoku-vs-intro-ja-{EDITION}.mp4

manifest.jsonには各ファイルのSHA-256と元の公開パスを記載しています。
'''


def build():
    blobs = {name: (ROOT / source).read_bytes() for name, source in FILES.items()}
    manifest = {'edition': EDITION, 'site': SITE['origin'], 'credit': '© KASAI SOLUTIONS',
                'files': [{'path': name, 'source': FILES[name], 'bytes': len(blob), 'sha256': sha256(blob).hexdigest()}
                          for name, blob in blobs.items()]}
    blobs['README-ja.txt'] = README.encode('utf-8')
    blobs['manifest.json'] = (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    output = BytesIO()
    with ZipFile(output, 'w', compression=ZIP_DEFLATED, compresslevel=9) as archive:
        for name, blob in sorted(blobs.items()):
            info = ZipInfo(name, datetime(2026, 11, 26).timetuple()[:6])
            info.compress_type = ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, blob, compress_type=ZIP_DEFLATED, compresslevel=9)
    return output.getvalue(), len(blobs)


if __name__ == '__main__':
    data, count = build()
    if sys.argv[1:] == ['--check']:
        if not OUTPUT.is_file() or OUTPUT.read_bytes() != data:
            raise SystemExit('Press kit differs from its approved public source files.')
        print(f'PASS press kit: {count} files, {len(data):,} bytes, matching public source material.')
    elif not sys.argv[1:]:
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT.write_bytes(data)
        print(f'Wrote {OUTPUT.relative_to(ROOT)}: {count} files, {len(data):,} bytes.')
    else:
        raise SystemExit('Usage: python3 tools/build-press-kit.py [--check]')
