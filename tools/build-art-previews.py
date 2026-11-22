#!/usr/bin/env python3
"""Build the game's small sprite sheets from the published original paintings."""
from functools import lru_cache
import json
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = json.loads((ROOT / 'assets/art-manifest.json').read_text())
DEST = ROOT / 'assets/art-previews'
TINY = 80
GROUP = 4
RANKS = ['D', 'C', 'B', 'A', 'S', 'SS', 'SSS', 'U']


@lru_cache(maxsize=10)
def sheet(path):
    with Image.open(ROOT / path) as original:
        return original.convert('RGB')


def cell(path, index, width=None):
    original = sheet(path)
    x, y = index % 8, index // 8
    # Fractional CSS tile boundaries are rounded to the closest source pixels.
    box = (round(x * original.width / 8), round(y * original.height / 4),
           round((x + 1) * original.width / 8), round((y + 1) * original.height / 4))
    image = original.crop(box)
    if width:
        height = round(width * (4 / 3 if original.width * 2 == original.height * 3 else 1))
        image = image.resize((width, height), Image.Resampling.LANCZOS)
    return image


def write_grid(dest, name, images, columns, rows, size=None, quality=78):
    width, height = size or images[0].size
    result = Image.new('RGB', (width * columns, height * rows), (24, 30, 32))
    for index, image in enumerate(images):
        # The older 1774x887 sheets contain both 221px and 222px cells.
        # Extend a 221px edge instead of resampling the original painting.
        left, top = index % columns * width, index // columns * height
        result.paste(image, (left, top))
        if image.width < width:
            result.paste(image.crop((image.width-1, 0, image.width, image.height)), (left+image.width, top))
        if image.height < height:
            result.paste(result.crop((left, top+image.height-1, left+width, top+image.height)), (left, top+image.height))
    result.save(dest / (name+'.webp'), 'WEBP', quality=quality, method=6 if quality>=90 else 4)


def officer_path(rank, index):
    return f'assets/illustrations/officers-{rank}-{index // 32 + 1:02}.webp'


def build(dest):
    source = subprocess.check_output(['node', '-e',
        "global.window=global;require('./officers-data.js');console.log(JSON.stringify(SENGOKU_OFFICERS.map(o=>o.rank)))"
    ], cwd=ROOT)
    native = json.loads(source)
    for rank in RANKS:
        for page in range(8):
            path = officer_path(rank, page * 32)
            write_grid(dest, f'officers-{rank}-{page+1:02}', [cell(path, i, TINY) for i in range(32)], 8, 4)
    for start in range(0, len(native), GROUP):
        pictures = [cell(officer_path(native[i], i), i % 32) for i in range(start, start+GROUP)]
        write_grid(dest, f'officer-base-{start//GROUP+1:02}', pictures, 2, 2, quality=90)
    for kind, folder in [('castle', 'castles'), ('facility', 'facilities')]:
        subjects = MANIFEST['subjects'][kind]
        paths = [f'assets/{folder}/{item["id"]}.webp' for item in subjects]
        # Decode each source once for all 32 thumbnail levels.
        levels = [[] for _ in range(32)]
        for path in paths:
            for index in range(32):
                levels[index].append(cell(path, index, TINY))
        for index, images in enumerate(levels):
            if kind == 'castle':
                write_grid(dest, f'castles-{index+1:02}', images, 16, 9)
            else:
                for page in range(2):
                    write_grid(dest, f'facilities-{index+1:02}-{page+1}', images[page*32:(page+1)*32], 8, 4)
        for level, selection in [(1, paths), (2, paths[:8] if kind == 'facility' else [])]:
            for start in range(0, len(selection), GROUP):
                pictures = [cell(path, level-1) for path in selection[start:start+GROUP]]
                size = (192, 256) if kind == 'facility' and start < 32 else (222, 222)
                write_grid(dest, f'{kind}-start-{level}-{start//GROUP+1:02}', pictures, 2, 2, size, quality=93 if kind == 'castle' else 90)
    # Only these thirteen paintings appear under the action, navigation and panel washes.
    names = [('castle', 'kyoto_gosho'), ('facility', 'keep'), ('castle', 'kiyosu'),
             ('officer', 'S'), ('facility', 'barracks'), ('facility', 'trade_port'),
             ('facility', 'academy'), ('facility', 'envoy_house'), ('facility', 'market'),
             ('officer', 'U'), ('facility', 'library'), ('facility', 'tea_house'),
             ('facility', 'relay_station')]
    parts = []
    for kind, subject in names:
        index = 1 if subject == 'U' else 0
        if kind == 'officer':
            path = officer_path(subject, index)
        else:
            folder = 'castles' if kind == 'castle' else 'facilities'
            path = f'assets/{folder}/{subject}.webp'
        picture = cell(path, index if kind == 'officer' else 15)
        parts.append(picture.resize((96, 96), Image.Resampling.LANCZOS))
    write_grid(dest, 'controls', parts, 4, 4)
    original = sheet('assets/operator-ieyasu-u.webp')
    for width in (160, 384):
        scaled = original.resize((width, width*3//2), Image.Resampling.LANCZOS)
        scaled.save(dest / f'operator-ieyasu-u-{width}.webp', 'WEBP', quality=90, method=6)


if __name__ == '__main__':
    with TemporaryDirectory(dir=ROOT / 'assets') as temporary:
        staged = Path(temporary)
        build(staged)
        DEST.mkdir(exist_ok=True)
        for path in sorted(staged.glob('*.webp')):
            path.replace(DEST / path.name)
    files = list(DEST.glob('*.webp'))
    print(f'{len(files)} sheets, {sum(p.stat().st_size for p in files):,} bytes')
