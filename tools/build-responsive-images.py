"""Build the display sizes of the existing site illustrations (requires Pillow)."""
from pathlib import Path
from PIL import Image

ASSETS = Path(__file__).resolve().parents[1] / 'assets'
DEST = ASSETS / 'responsive'


def variants(name, source, widths, quality=80, crop_width=None):
    with Image.open(ASSETS / source) as original:
        if crop_width:
            # The chapter panels align their contents to 55% of any horizontal overflow.
            left = round((original.width - crop_width) * .55)
            original = original.crop((left, 0, left + crop_width, original.height))
        for width in widths:
            height = round(original.height * width / original.width)
            image = original.resize((width, height), Image.Resampling.LANCZOS)
            image.save(DEST / f'{name}-{width}.webp', 'WEBP', quality=quality, method=6)


def jade_chapters():
    # The archive keeps earlier chapter files for existing links. New public
    # page and game references share the same versioned responsive variants.
    for chapter in ('war', 'town', 'archive', 'court'):
        name = f'{chapter}-jade'
        src = f'chronicle/{name}.webp'
        variants(name, src, (240, 400, 640, 960, 1200), quality=73)
        variants(f'{name}-panel', src, (400, 640, 900), quality=73, crop_width=900)
    variants('music-jade', 'chronicle/music-jade.webp', (240, 440, 720, 900), quality=76)


if __name__ == '__main__':
    DEST.mkdir(exist_ok=True)
    jade_chapters()
    variants('cover', 'chronicle/cover-small.webp', (480, 840), 82)
    variants('cover', 'chronicle/cover.webp', (1200, 1536), 82)
    for chapter in ('war', 'town', 'archive', 'court'):
        variants(chapter, f'chronicle/{chapter}.webp', (240, 400, 640, 960, 1200))
        variants(f'{chapter}-panel', f'chronicle/{chapter}.webp', (400, 640, 900), crop_width=900)
    variants('music', 'chronicle/music.webp', (240, 440, 720, 900), 82)
    # Brand and emblem variants are built by build-brand-icons.py. Its small
    # favicon design omits fine details; do not overwrite it by shrinking art.
    variants('castle-town', 'castle-town.webp', (400, 720, 1080, 1536))
    # The largest standard-town variant also serves as the fallback and master.
    variants('castle-town-raden', 'responsive/castle-town-raden-1536.webp', (400, 720, 1080), quality=73)
    variants('moonlit-castle', 'premium/moonlit-castle-v1.png', (400, 720, 1080, 1536))
    variants('sakura-town', 'premium/sakura-town-v1.webp', (400, 720, 1080, 1536))
    variants('snow-town', 'premium/snow-town-v1.webp', (400, 720, 1080, 1536))
    variants('gold-banner', 'premium/gold-banner-v1.png', (160, 320, 512, 768), 82)
    variants('supporter-badge', 'premium/supporter-badge-v1.png', (48, 96, 224, 448, 640), 83)
