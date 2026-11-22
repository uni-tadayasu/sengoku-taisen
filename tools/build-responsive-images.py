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


if __name__ == '__main__':
    DEST.mkdir(exist_ok=True)
    variants('cover', 'chronicle/cover-small.webp', (480, 840), 82)
    variants('cover', 'chronicle/cover.webp', (1200, 1536), 82)
    for chapter in ('war', 'town', 'archive', 'court'):
        variants(chapter, f'chronicle/{chapter}.webp', (240, 400, 640, 960, 1200))
        variants(f'{chapter}-panel', f'chronicle/{chapter}.webp', (400, 640, 900), crop_width=900)
    variants('music', 'chronicle/music.webp', (240, 440, 720, 900), 82)
    variants('brand', 'branding/sengoku-vs-icon-192-20261122.png', (48, 96, 144), 88)
    variants('emblem', 'emblem.webp', (96, 192), 86)
    variants('castle-town', 'castle-town.webp', (400, 720, 1080, 1536))
    variants('moonlit-castle', 'premium/moonlit-castle-v1.png', (400, 720, 1080, 1536))
    variants('gold-banner', 'premium/gold-banner-v1.png', (160, 320, 512, 768), 82)
    variants('supporter-badge', 'premium/supporter-badge-v1.png', (48, 96, 224, 448, 640), 83)
