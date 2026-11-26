#!/usr/bin/env python3
"""Export the castle-and-command-fan brand from its approved painted master.

Requires Inkscape on PATH and Pillow. Run from any directory:
    python3 tools/build-brand-icons.py
To import a new approved PNG master into this edition, run:
    python3 tools/build-brand-icons.py --master /path/to/approved-master.png
The original PNG is preserved; exports only resize or apply an icon safe zone.
Native SVG paths provide a companion mark for the smallest favicons and badges.
Maskable artwork fits inside the centered 80%-diameter safe circle.
No game-play family crests are changed by this script.
"""
import argparse
from hashlib import sha256
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'assets' / 'branding'
RESPONSIVE = ROOT / 'assets' / 'responsive'
EDITION = '20261127-jade'
MASTER = DEST / f'sengoku-vs-master-{EDITION}.png'
INK = '#050b1d'
GOLD = '#f7c45a'
JADE = '#14c99b'

# The same roof and fan silhouettes appear in the painted master. At the tab
# sizes, positive/negative space carries the motif in place of metal texture.
OCTAGON = 'M149 17H363L495 149V363L363 495H149L17 363V149Z'
ROOFS = (
    'M145 122Q186 136 256 76Q326 136 367 122Q354 153 321 152H191Q158 153 145 122Z '
    'M110 179Q145 194 176 169H336Q368 194 402 179Q393 214 357 215H155Q119 213 110 179Z '
    'M70 246Q109 265 148 232H364Q403 265 442 246Q432 287 378 289H134Q81 287 70 246Z'
)
FAN = (
    'M77 368Q107 341 142 337L217 432Z M147 329Q183 303 214 318L239 425Z '
    'M219 316Q255 304 294 316L271 423H242Z M301 318Q337 307 365 328L284 433Z '
    'M369 337Q405 341 436 368L294 443Z M219 453Q226 428 256 428Q286 428 294 453Z'
)
WINDOWS = 'M226 157h10v9h-10z M251 157h10v9h-10z M276 157h10v9h-10z M215 217h12v12h-12z M250 217h12v12h-12z M285 217h12v12h-12z'


def svg(*, small=False, mono=False):
    gold = '#000' if mono else GOLD if small else 'url(#gilt)'
    background = '' if mono else f'<rect width="512" height="512" rx="46" fill="{INK}"/><circle cx="256" cy="182" r="136" fill="{JADE if small else "url(#stone)"}"/>'
    highlights = '' if mono or small else '<path d="M56 111l52-52m296 0 52 52M195 495h122" stroke="#54ecc4" stroke-width="16"/>'
    windows = '' if small or mono else f'<path d="{WINDOWS}" fill="{GOLD}"/>'
    definitions = '' if small or mono else '''<defs>
  <linearGradient id="gilt" x2=".35" y2="1"><stop stop-color="#fff0a7"/><stop offset=".48" stop-color="#efb643"/><stop offset="1" stop-color="#a87220"/></linearGradient>
  <radialGradient id="stone"><stop stop-color="#22d39b"/><stop offset="1" stop-color="#10816d"/></radialGradient></defs>'''
    eaves = '' if mono else f'<path d="{ROOFS}" fill="{INK}" stroke="{INK}" stroke-width="{12 if small else 6}"/>'
    backdrop = '  ' + definitions + background + '\n' if definitions or background else ''
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-labelledby="brand-title brand-desc">
  <title id="brand-title">戦国VS</title><desc id="brand-desc">翡翠色の月を背に、金の三層天守と軍扇を八角の額に収めた紋章。</desc>
{backdrop}  <path d="{OCTAGON}" fill="none" stroke="{gold}" stroke-width="{21 if small else 13}" stroke-linejoin="round"/>
  {highlights}{eaves}<path d="{ROOFS}" fill="{gold}"/><path d="{FAN}" fill="{gold}"/>{windows}
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
    if image.mode == 'RGBA' and image.getextrema()[3] == (255, 255):
        image = image.convert('RGB').quantize(colors=256, method=Image.Quantize.MEDIANCUT)
    image.save(path, format='PNG', optimize=True)


def responsive(image, path):
    # The offline shell includes the 48/96px marks. At these display sizes,
    # high-quality WebP preserves the crest while keeping its six images below
    # the existing 100 KiB installation budget.
    image.save(path, format='WEBP', method=6, quality=91)


def name(kind, size=None, suffix='png'):
    return DEST / f'sengoku-vs-{kind}{"-" + str(size) if size else ""}-{EDITION}.{suffix}'


def load_master(source):
    """Read the supplied square master without redrawing or sharpening it."""
    if not source.is_file():
        raise SystemExit(f'Approved brand master is missing: {source}')
    with Image.open(source) as original:
        if original.format != 'PNG':
            raise SystemExit('The approved master must be a PNG, preserved as supplied.')
        original = ImageOps.exif_transpose(original)
        if original.width != original.height or original.width < 512:
            raise SystemExit('The approved master must be square and at least 512px.')
        return original.convert('RGBA').copy()


def opaque(image):
    background = Image.new('RGBA', image.size, INK)
    background.alpha_composite(image)
    return background.convert('RGB')


def painted(master, size):
    return master.resize((size, size), Image.Resampling.LANCZOS)


def maskable(master, size=512):
    # The complete octagon, including its four inset diagonal tips, fits in
    # the central 80%-diameter safe circle at a 65% square side length.
    side = round(size * .65)
    result = Image.new('RGB', (size, size), INK)
    result.paste(painted(opaque(master), side), ((size - side) // 2,) * 2)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--master', type=Path, default=MASTER,
                        help='Approved square PNG; imported without changing its bytes.')
    options = parser.parse_args()
    source = options.master.resolve()
    painted_master = load_master(source)
    if not shutil.which('inkscape'):
        raise SystemExit('Inkscape is required to render the native SVG master.')
    DEST.mkdir(exist_ok=True)
    RESPONSIVE.mkdir(exist_ok=True)
    if source != MASTER.resolve():
        shutil.copyfile(source, MASTER)
    name('favicon', suffix='svg').write_text(svg(small=True), encoding='utf-8')
    name('pinned-tab', suffix='svg').write_text(svg(mono=True), encoding='utf-8')
    # Android notification badges use the alpha mask, not the full app tile.
    badge = render(svg(mono=True).replace('#000', '#fff'), 384).resize((96, 96), Image.Resampling.LANCZOS)
    png(badge, name('badge', 96))
    renders = {}
    for size in (16, 32, 48, 96, 192, 512):
        rendered = (render(svg(small=True), size * 4).resize((size, size), Image.Resampling.LANCZOS)
                    if size <= 32 else painted(painted_master, size))
        kind = 'favicon' if size <= 96 else 'icon'
        png(rendered, name(kind, size))
        renders[size] = rendered
    # Native paths provide an independently scalable and compact wordless mark
    # for public links, printed press artwork and the crest compatibility URL.
    master_svg = svg()
    name('mark', suffix='svg').write_text(master_svg, encoding='utf-8')
    (ROOT / 'assets' / 'crest.svg').write_text(master_svg, encoding='utf-8')
    # Keep one permanent, crawlable PNG URL for search results. It must always
    # match the current 96px ICO frame, without release dates or query strings.
    shutil.copyfile(name('favicon', 96), ROOT / 'favicon.png')
    apple = painted(opaque(painted_master), 180)
    png(apple, name('apple-touch-icon', 180))
    png(apple, ROOT / 'apple-touch-icon.png')
    png(maskable(painted_master), name('maskable', 512))
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
        image = painted(painted_master, size)
        responsive(image, RESPONSIVE / f'brand-{size}.webp')
        shutil.copyfile(RESPONSIVE / f'brand-{size}.webp', RESPONSIVE / f'brand-{EDITION}-{size}.webp')
    for size in (96, 192):
        image = renders[size]
        responsive(image, RESPONSIVE / f'emblem-{size}.webp')
        shutil.copyfile(RESPONSIVE / f'emblem-{size}.webp', RESPONSIVE / f'emblem-{EDITION}-{size}.webp')
    responsive(renders[512], ROOT / 'assets' / 'emblem.webp')
    # Keep fallback/legacy image URLs consistent for installed home-screen apps.
    for filename, image in [('icon-192.png', renders[192]), ('icon-512.png', renders[512]),
                            ('favicon-32.png', renders[32]), ('apple-touch-icon.png', apple),
                            ('sengoku-taisen-icon-192.png', renders[192]), ('sengoku-taisen-icon-512.png', renders[512]),
                            ('sengoku-taisen-favicon-32.png', renders[32])]:
        png(image, ROOT / 'assets' / filename)
    print(f'Brand edition {EDITION}: SVG, PNG, ICO, Apple, maskable and responsive exports written.')
    print(f'Approved master: {MASTER.relative_to(ROOT)} · SHA-256 {sha256(MASTER.read_bytes()).hexdigest()}')


if __name__ == '__main__':
    main()
