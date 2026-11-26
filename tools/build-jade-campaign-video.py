#!/usr/bin/env python3
"""Build the bilingual jade-campaign short from official game art and demo captures.

Run with Python, Pillow, Noto CJK fonts and ffmpeg. The demo captures were made
on v5.0.5. Screen scenes are deliberately marked as archival screenshots.
"""
from functools import lru_cache
from pathlib import Path
import subprocess
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'assets'
DEST = ASSETS / 'promo'
STEM = 'sengoku-vs-jade-campaign-ja-en-20261127'
W, H, FPS = 720, 1280, 24
INK, GOLD, JADE, WHITE = '#091728', '#f5d38a', '#98f4d5', '#f4f1e9'
SCENES = [
    dict(seconds=5, art='chronicle/town-jade.webp', focus=.55,
         ja=['月夜の城下から、', '天下地図へ。'],
         en=['From a moonlit castle', 'to the campaign map.']),
    dict(seconds=5, art='chronicle/archive-jade.webp', focus=.62,
         ja=['黒漆に浮かぶ、', '翡翠の山河。'],
         en=['Jade mountains rise', 'from a gilded map.']),
    dict(seconds=6, art='chronicle/archive-jade.webp', focus=.49,
         screen='map', crop=(245, 474, 938, 876),
         ja=['天下地図で', '城の位置を読む。'],
         en=['Survey the castles', 'on the campaign map.']),
    dict(seconds=6, art='chronicle/war-jade.webp', focus=.68,
         screen='officers', crop=(244, 240, 971, 782),
         ja=['武将を選び、', '軍団を整える。'],
         en=['Choose your officers.', 'Build your army.']),
    dict(seconds=6, art='responsive/neon-command-1536.webp', focus=.78,
         ja=['戦国VS', 'ブラウザで基本プレイ無料。'],
         en=['SENGOKU VS', 'Play free in your browser.']),
]
LENGTH = sum(scene['seconds'] for scene in SCENES)


@lru_cache()
def font(size, serif=False, bold=False):
    name = 'Noto' + ('Serif' if serif else 'Sans') + 'CJK-' + ('Bold' if bold else 'Regular') + '.ttc'
    return ImageFont.truetype('/usr/share/fonts/opentype/noto/' + name, size)


def label(draw, value, x, y, size, color=WHITE, serif=False, bold=False):
    face = font(size, serif, bold)
    if x + draw.textlength(value, font=face) > W - 38:
        raise ValueError('Caption outside safe area: ' + value)
    draw.text((x, y), value, font=face, fill=color, anchor='lt')


def scene_layers(scene, closing):
    # Retain the original art's detail and proportions in the upper picture.
    with Image.open(ASSETS / scene['art']) as source:
        art = ImageOps.fit(source.convert('RGB'), (900, 970), Image.Resampling.LANCZOS,
                           centering=(scene['focus'], .44))
    overlay = Image.new('RGBA', (W, H))
    draw = ImageDraw.Draw(overlay)
    # Darken the masthead and dissolve the illustration into the lower caption.
    for y in range(805):
        alpha = max(0, 100 - y * .63, (y - 550) * 1.0)
        if scene.get('screen'):
            alpha = max(124, alpha)
        draw.line((0, y, W, y), fill=(9, 23, 40, min(255, round(alpha))))
    with Image.open(ASSETS / 'branding/sengoku-vs-icon-192-20261127-jade.png') as src:
        icon = src.convert('RGBA').resize((60, 60), Image.Resampling.LANCZOS)
    overlay.alpha_composite(icon, (44, 88))
    label(draw, 'SENGOKU VS', 120, 101, 28, GOLD, bold=True)
    label(draw, '© KASAI SOLUTIONS', 46, 1145, 21, '#b6c9c8')

    if 'screen' in scene:
        # Crop the actual map and officer panels without painting over the UI.
        filename = DEST / 'screenshots' / f"sengoku-vs-{scene['screen']}-20261126.jpg"
        with Image.open(filename) as capture:
            panel = capture.convert('RGB').crop(scene['crop'])
        panel.thumbnail((640, 502), Image.Resampling.LANCZOS)
        x = (W - panel.width) // 2
        y = 469 - panel.height // 2
        draw.rectangle((x-3, y-3, x+panel.width+2, y+panel.height+2), fill=GOLD)
        overlay.paste(panel, (x, y))
        caption = 'デモ画面  ·  DEMO SCREENSHOT  v5.0.5'
    else:
        caption = '公式イラスト  ·  OFFICIAL ARTWORK'
    label(draw, caption, 46, 720, 21, JADE, bold=True)
    draw.line((46, 764, 112, 764), fill=GOLD, width=3)
    draw.line((112, 764, 632, 764), fill='#4c676e', width=1)

    if closing:
        label(draw, scene['ja'][0], 42, 795, 79, GOLD, serif=True, bold=True)
        label(draw, scene['ja'][1], 47, 899, 37, WHITE, bold=True)
        label(draw, scene['en'][1], 48, 956, 30, JADE)
        label(draw, 'www.kasai-solutions-inc.com', 48, 1021, 35, WHITE, bold=True)
        label(draw, '日本語ゲーム  ·  English guide at /en/', 48, 1084, 23, JADE)
    else:
        for i, line in enumerate(scene['ja']):
            label(draw, line, 43, 792 + i*71, 59, GOLD if i == 0 else WHITE, serif=True, bold=True)
        for i, line in enumerate(scene['en']):
            label(draw, line, 47, 976 + i*43, 32, JADE)
    return art, overlay


def render_frame(art, overlay, progress):
    zoom = 1 + .052 * progress
    width, height = art.width / zoom, art.height / zoom
    left, top = (art.width-width)*.48, (art.height-height)*.34
    photo = art.transform((W, 805), Image.Transform.EXTENT,
                          (left, top, left+width, top+height), Image.Resampling.BICUBIC)
    frame = Image.new('RGBA', (W, H), INK)
    frame.paste(photo, (0, 0))
    frame.alpha_composite(overlay)
    return frame.convert('RGB')


def write_captions(lang):
    time = 0
    cues = ['WEBVTT', '']
    for scene in SCENES:
        end = time + scene['seconds']
        cues.extend([f'00:00:{time:02d}.000 --> 00:00:{end:02d}.000', *scene[lang], ''])
        if end == LENGTH:
            cues[-1:-1] = ['www.kasai-solutions-inc.com',
                           '日本語ゲーム・英語の紹介は /en/' if lang == 'ja' else 'Game in Japanese. English guide at /en/.']
        time = end
    (DEST / f'{STEM}-{lang}.vtt').write_text('\n'.join(cues).rstrip() + '\n')


def main():
    layers = [scene_layers(scene, index == len(SCENES)-1) for index, scene in enumerate(SCENES)]
    render_frame(*layers[0], .36).save(DEST / f'{STEM}-poster.jpg', quality=91, optimize=True)
    for lang in ('ja', 'en'):
        write_captions(lang)
    # "軍扇の裏" is an original game recording from the repository's own score.
    command = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
               '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', 'pipe:0',
               '-ss', '12', '-i', str(ASSETS / 'music/council-lantern.mp3'),
               '-map', '0:v:0', '-map', '1:a:0', '-t', str(LENGTH),
               '-af', f'volume=0.72,afade=t=in:st=0:d=0.45,afade=t=out:st={LENGTH-1.4}:d=1.4',
               '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-maxrate', '1450k', '-bufsize', '2900k',
               '-threads', '2', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-ar', '44100',
               '-ac', '2', '-movflags', '+faststart', '-map_metadata', '-1',
               '-metadata', 'title=戦国VS｜月夜の城下から、天下地図へ。', '-metadata', 'artist=KASAI SOLUTIONS',
               '-metadata', 'copyright=© KASAI SOLUTIONS', str(DEST / f'{STEM}.mp4')]
    with subprocess.Popen(command, stdin=subprocess.PIPE) as encoder:
        previous = None
        for scene, (art, overlay) in zip(SCENES, layers):
            count = scene['seconds'] * FPS
            for n in range(count):
                frame = render_frame(art, overlay, n/(count-1))
                if previous is not None and n < 8:
                    frame = Image.blend(previous, frame, (n+1)/8)
                encoder.stdin.write(frame.tobytes())
            previous = frame
        encoder.stdin.close()
        if encoder.wait():
            raise RuntimeError('The media encoder failed.')


if __name__ == '__main__':
    main()
