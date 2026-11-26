#!/usr/bin/env python3
"""Render the original castle-and-command-fan brand mark.

Requires Inkscape on PATH and Pillow. Run from any directory:
    python3 tools/build-brand-icons.py
Native SVG paths are the design source; all raster exports are deterministic.
PNG favicons contain a simplified mark at 16/32/48 pixels.
Maskable artwork fits inside the centered 80%-diameter safe circle.
No game-play family crests are changed by this script.
"""
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'assets' / 'branding'
RESPONSIVE = ROOT / 'assets' / 'responsive'
EDITION = '20261126'
INK = '#131b22'
GOLD = '#e7c37b'
RED = '#ae4634'
# A castle above an open command fan. The broad open shapes remain distinct at
# tab size, while the large master uses softly lit gold instead of fine texture.
MARK = '''
  <circle cx="256" cy="176" r="66" fill="{red}"/>
  <g fill="{gold}">
    <path d="M173 208 Q221 188 256 144 Q291 188 339 208 L296 202 L296 228 L216 228 L216 202 Z"/>
    <path d="M137 270 Q205 248 256 211 Q307 248 375 270 L318 264 L318 293 L194 293 L194 264 Z"/>
    <path d="M124 317 Q191 301 256 271 Q321 301 388 317 Q325 328 256 357 Q187 328 124 317 Z"/>
    <path d="M153 345 Q198 348 242 370 L251 393 Q197 378 153 345 Z"/>
    <path d="M359 345 Q314 348 270 370 L261 393 Q315 378 359 345 Z"/>
  </g>
  {windows}
  <path d="M256 359 L270 380 L256 400 L242 380 Z" fill="{red}"/>
'''
WINDOWS = '<path d="M249 190h14v17h-14z M229 249h15v20h-15z M268 249h15v20h-15z" fill="#131b22"/>'
DEFS = '''<defs>
    <linearGradient id="ink" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#24323b"/><stop offset=".54" stop-color="#141d25"/><stop offset="1" stop-color="#0c131a"/></linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2=".3" y2="1"><stop stop-color="#fff0bf"/><stop offset=".45" stop-color="#e5c17b"/><stop offset="1" stop-color="#b58a4b"/></linearGradient>
  </defs>'''


def svg(*, simple=False, maskable=False, apple=False, mono=False):
    if mono:
        mark = MARK.format(red='#000', gold='#000', windows='')
        return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><title>戦国VSの城と軍扇の紋章</title><circle cx="256" cy="256" r="204" fill="none" stroke="#000" stroke-width="13"/>{mark}</svg>\n'''
    # The maskable ring's outer edge is at r=194 (37.9% of 512), within
    # the mandatory 40% safe radius. Everything meaningful fits inside it.
    radius = 186 if maskable else 211
    transform = ' transform="translate(25.6 25.6) scale(.9)"' if maskable else ''
    red = RED if simple else '#b44c37'
    gold = GOLD if simple else 'url(#gold)'
    windows = '' if simple else WINDOWS
    mark = MARK.format(red=red, gold=gold, windows=windows)
    border = '' if simple or maskable else '<rect x="11" y="11" width="490" height="490" rx="91" fill="none" stroke="#c9a362" stroke-opacity=".45" stroke-width="2"/>'
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-labelledby="brand-title brand-desc">
  <title id="brand-title">戦国VS</title>
  <desc id="brand-desc">墨色の地に、金の城と軍扇、朱の旭日を配した戦国VSの紋章。</desc>
  {'' if simple else DEFS}
  <rect width="512" height="512" rx="{0 if maskable or apple else 100}" fill="{INK if simple else 'url(#ink)'}"/>
  {border}
  <circle cx="256" cy="256" r="{radius}" fill="none" stroke="{gold}" stroke-width="{16 if simple else 9}"/>
  <g{transform}>{mark}</g>
</svg>\n'''


def render(source, size):
    with tempfile.TemporaryDirectory(prefix='sengoku-brand-') as folder:
        src = Path(folder) / 'source.svg'
        dst = Path(folder) / 'icon.png'
        src.write_text(source, encoding='utf-8')
        subprocess.run(['inkscape', str(src), '--export-type=png', f'--export-filename={dst}',
                        f'--export-width={size}', f'--export-height={size}'], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        with Image.open(dst) as original:
            return original.convert('RGBA').copy()


def png(image, path):
    image.save(path, format='PNG', optimize=True)


def name(kind, size=None, suffix='png'):
    return DEST / f'sengoku-vs-{kind}{"-" + str(size) if size else ""}-{EDITION}.{suffix}'


def main():
    if not shutil.which('inkscape'):
        raise SystemExit('Inkscape is required to render the native SVG master.')
    DEST.mkdir(exist_ok=True)
    RESPONSIVE.mkdir(exist_ok=True)
    master = svg()
    name('mark', suffix='svg').write_text(master, encoding='utf-8')
    name('favicon', suffix='svg').write_text(svg(simple=True), encoding='utf-8')
    name('pinned-tab', suffix='svg').write_text(svg(mono=True), encoding='utf-8')
    # Android notification badges use the alpha mask, not the full app tile.
    badge = render(svg(mono=True).replace('#000', '#fff'), 384).resize((96, 96), Image.Resampling.LANCZOS)
    png(badge, name('badge', 96))
    (ROOT / 'assets' / 'crest.svg').write_text(master, encoding='utf-8')
    renders = {}
    for size in (16, 32, 48, 96, 192, 512):
        rendered = render(svg(simple=size <= 48), size * 4).resize((size, size), Image.Resampling.LANCZOS)
        kind = 'favicon' if size <= 96 else 'icon'
        png(rendered, name(kind, size))
        renders[size] = rendered
    # Keep one permanent, crawlable PNG URL for search results. It must always
    # match the current 96px ICO frame, without release dates or query strings.
    shutil.copyfile(name('favicon', 96), ROOT / 'favicon.png')
    apple = render(svg(apple=True), 720).resize((180, 180), Image.Resampling.LANCZOS).convert('RGB')
    png(apple, name('apple-touch-icon', 180))
    png(apple, ROOT / 'apple-touch-icon.png')
    maskable = render(svg(maskable=True), 1024).resize((512, 512), Image.Resampling.LANCZOS).convert('RGB')
    png(maskable, name('maskable', 512))
    # ICO entries use PNG payloads and exactly match the individual exports.
    entries = []
    for size in (16, 32, 48, 96, 192):
        entries.append((size, name('favicon' if size <= 96 else 'icon', size).read_bytes()))
    header = struct.pack('<HHH', 0, 1, len(entries))
    offset = 6 + 16 * len(entries)
    directory = b''
    payload = b''
    for size, data in entries:
        directory += struct.pack('<BBBBHHII', size, size, 0, 0, 1, 32, len(data), offset)
        payload += data
        offset += len(data)
    (ROOT / 'favicon.ico').write_bytes(header + directory + payload)
    for size in (48, 96, 144):
        image = render(svg(simple=size <= 48), size * 4).resize((size, size), Image.Resampling.LANCZOS)
        image.save(RESPONSIVE / f'brand-{size}.webp', format='WEBP', lossless=True, method=6)
        shutil.copyfile(RESPONSIVE / f'brand-{size}.webp', RESPONSIVE / f'brand-{EDITION}-{size}.webp')
    for size in (96, 192):
        image = renders[size]
        image.save(RESPONSIVE / f'emblem-{size}.webp', format='WEBP', lossless=True, method=6)
        shutil.copyfile(RESPONSIVE / f'emblem-{size}.webp', RESPONSIVE / f'emblem-{EDITION}-{size}.webp')
    renders[512].save(ROOT / 'assets' / 'emblem.webp', format='WEBP', lossless=True, method=6)
    # Keep fallback/legacy image URLs consistent for installed home-screen apps.
    for filename, image in [('icon-192.png', renders[192]), ('icon-512.png', renders[512]),
                            ('favicon-32.png', renders[32]), ('apple-touch-icon.png', apple),
                            ('sengoku-taisen-icon-192.png', renders[192]), ('sengoku-taisen-icon-512.png', renders[512]),
                            ('sengoku-taisen-favicon-32.png', renders[32])]:
        png(image, ROOT / 'assets' / filename)
    print(f'Brand edition {EDITION}: SVG, PNG, ICO, Apple, maskable and responsive exports written.')


if __name__ == '__main__':
    main()
