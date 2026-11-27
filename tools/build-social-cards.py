#!/usr/bin/env python3
"""Typeset the five public Sengoku VS share cards from the website's artwork.

Run with Pillow, fontTools (WOFF2/Brotli) and the DejaVu fonts installed:
    python3 tools/build-social-cards.py
"""
import json
import shutil
from functools import lru_cache
from io import BytesIO
from pathlib import Path

from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / 'assets'
BRANDING = ROOT / 'assets' / 'branding'
BRUSH = ROOT / 'assets' / 'fonts' / 'kouzan-gyosho'
FONT_FILES = json.loads((BRUSH / 'manifest.json').read_text())['files']
EDITION = '20261127'
WIDTH, HEIGHT = 1200, 630
JADE = '#9af5da'
CREST = BRANDING / 'sengoku-vs-icon-192-20261127-jade.png'
# Framing follows the subject of the illustration. The caption has a consistent
# left margin while right-hand detail remains visible in small timeline previews.
CARDS = (
    ('ogp', 'responsive/neon-command-raden-1536.webp', '一城から、天下へ。', .32),
    ('guide', 'chronicle/war-jade.webp', '攻略ガイド', .50),
    ('recovery', 'chronicle/archive-jade.webp', '引き継ぎ・復元', .50),
    ('about', 'chronicle/court-jade.webp', '作品概要', .50),
    ('premium', 'chronicle/town-jade.webp', 'プレミアム', .50),
)


@lru_cache()
def brush_font(filename, size):
    with TTFont(BRUSH / filename) as font:
        font.flavor = None
        data = BytesIO()
        font.save(data)
    return ImageFont.truetype(BytesIO(data.getvalue()), size)


def brush_line(image, position, text, size):
    x, baseline = position
    draw = ImageDraw.Draw(image)
    for character in text:
        filename = next(item['file'] for item in FONT_FILES if ord(character) in item['codepoints'])
        font = brush_font(filename, size)
        draw.text((x, baseline), character, font=font, fill=255, anchor='ls', stroke_width=1)
        x += font.getlength(character)
    return x


def seal():
    with Image.open(CREST) as original:
        mark = original.convert('RGB').resize((88, 88), Image.Resampling.LANCZOS)
    mask = Image.new('L', mark.size)
    ImageDraw.Draw(mask).polygon([(26, 3), (62, 3), (84, 25), (84, 62),
                                  (62, 84), (26, 84), (3, 62), (3, 26)], fill=255)
    return mark, mask


def draw_card(source, caption, focus):
    with Image.open(ART / source) as original:
        canvas = ImageOps.fit(original.convert('RGB'), (WIDTH, HEIGHT),
                              Image.Resampling.LANCZOS, centering=(.5, focus))
    # The fade leaves the painting visible and gives all five cards the same
    # high-contrast reading surface, including the busiest nighttime scenes.
    opacity = Image.new('L', (WIDTH, 1))
    opacity.putdata([round(232 * (1 - min(1, max(0, (x - 280) / 620))) ** 1.4)
                     for x in range(WIDTH)])
    canvas.paste((9, 16, 28), (0, 0, WIDTH, HEIGHT), opacity.resize(canvas.size))
    draw = ImageDraw.Draw(canvas)
    mark, mask = seal()
    canvas.paste(mark, (59, 68), mask)
    latin = ImageFont.truetype('DejaVuSansMono.ttf', 25)
    draw.text((168, 114), 'S E N G O K U  V S', font=latin, fill=JADE, anchor='lm')
    draw.line((67, 171, 503, 171), fill='#857a5b', width=1)
    draw.line((67, 171, 112, 171), fill=JADE, width=3)

    title = Image.new('L', canvas.size)
    end = brush_line(title, (61, 364), '戦国', 146)
    ImageDraw.Draw(title).text((end + 7, 351), 'VS', anchor='ls', fill=255,
                               font=ImageFont.truetype('DejaVuSerif-Bold.ttf', 109))
    foil = Image.new('RGB', (1, HEIGHT))
    levels = [min(1, max(0, (y - 215) / 150)) for y in range(HEIGHT)]
    foil.putdata([(255, 244 - round(54 * t), 198 - round(91 * t)) for t in levels])
    canvas.paste(foil.resize(canvas.size), mask=title)
    chapter = Image.new('L', canvas.size)
    brush_line(chapter, (66, 447), caption, 49 if len(caption) > 8 else 58)
    canvas.paste((250, 247, 224), mask=chapter)

    # Short clipped-corner rules echo the octagonal castle seal.
    for line in [[(26, 122), (26, 49), (46, 29), (121, 29)],
                 [(WIDTH - 25, HEIGHT - 109), (WIDTH - 25, HEIGHT - 47),
                  (WIDTH - 44, HEIGHT - 28), (WIDTH - 114, HEIGHT - 28)]]:
        draw.line(line, fill='#c5a569', width=2)
    return canvas


def main():
    for key, source, caption, focus in CARDS:
        edition = 'v5911' if key == 'ogp' else EDITION
        path = BRANDING / f'sengoku-vs-{key}-{edition}.jpg'
        card = draw_card(source, caption, focus)
        card.save(path, format='JPEG', quality=82, optimize=True, progressive=True, subsampling=2)
        print(f'{key}: {path.relative_to(ROOT)} ({path.stat().st_size:,} bytes)')
        if key == 'ogp':
            for legacy in ('ogp.jpg', 'ogp-sengoku-vs.jpg'):
                shutil.copyfile(path, ROOT / 'assets' / legacy)


if __name__ == '__main__':
    main()
