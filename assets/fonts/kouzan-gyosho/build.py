#!/usr/bin/env python3
"""Build all real glyphs of the official public-domain Kouzan Gyosho font.

Requires Python 3, fontTools and Brotli. Accept an optional downloaded ZIP path;
otherwise download the official ZIP and verify the pinned SHA-256 in source.json.
"""
from collections import Counter
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import sys
import urllib.request
import zipfile

from fontTools import subset
from fontTools.ttLib import TTFont

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
SOURCE = json.loads((HERE / 'source.json').read_text())
raw = Path(sys.argv[1]).read_bytes() if len(sys.argv) > 1 else urllib.request.urlopen(SOURCE['download']).read()
assert sha256(raw).hexdigest() == SOURCE['archiveSha256'], 'Official source archive has changed; review it before rebuilding.'
with zipfile.ZipFile(BytesIO(raw)) as archive:
    original = archive.read(next(name for name in archive.namelist() if name.lower().endswith('.ttf')))
assert sha256(original).hexdigest() == SOURCE['fontSha256']
font = TTFont(BytesIO(original), recalcTimestamp=False)
cmap = font.getBestCmap()
# The old font advertises thousands of empty placeholders. Do not hide text
# with them: unsupported names must fall through to the system font instead.
covered = {cp for cp, name in cmap.items() if font['glyf'][name].numberOfContours or cp in (0x20, 0xa0, 0x3000)}
index = (ROOT / 'index.html').read_text()
corpus = (ROOT / 'app.js').read_text() + (ROOT / 'command-center.js').read_text() + (ROOT / 'travel-ui.js').read_text()
common = {ord(c) for c, _ in Counter(c for c in corpus if 0x3400 <= ord(c) <= 0x9fff).most_common(220)}
core = covered & ({ord(c) for c in index} | common | set(range(0x20, 0x7f)) | set(range(0x3000, 0x3100)) | set(range(0xff00, 0xfff0)))
remaining = sorted(covered - core)
groups = [('core', sorted(core))] + [('range-%02d' % (i // 400 + 1), remaining[i:i + 400]) for i in range(0, len(remaining), 400)]
assert len(groups) <= 24

def ranges(points):
    result = []
    for cp in points:
        if result and cp == result[-1][1] + 1:
            result[-1][1] = cp
        else:
            result.append([cp, cp])
    return ','.join('U+%X' % a if a == b else 'U+%X-%X' % (a, b) for a, b in result)

faces, entries = [], []
for name, points in groups:
    output = HERE / ('kouzan-gyosho-' + name + '.woff2')
    current = TTFont(BytesIO(original), recalcTimestamp=False)
    # The legacy TTF contains an invalid gasp padding block and obsolete AAT
    # substitutions. Neither changes the horizontal outlines served here.
    for tag in ('gasp', 'mort'):
        if tag in current:
            del current[tag]
    options = subset.Options()
    options.flavor = 'woff2'
    options.name_IDs = ['*']
    options.name_languages = ['*']
    options.notdef_glyph = True
    options.notdef_outline = True
    work = subset.Subsetter(options=options)
    work.populate(unicodes=points)
    work.subset(current)
    # Legacy cmap aliases may survive glyph closure; make the web mapping
    # exactly match the declared, nonoverlapping Unicode range.
    allowed = set(points)
    for table in current['cmap'].tables:
        if table.isUnicode() and hasattr(table, 'cmap'):
            table.cmap = {cp: glyph for cp, glyph in table.cmap.items() if cp in allowed}
    current.flavor = 'woff2'
    current.save(output)
    contents = output.read_bytes()
    # Keep the frequent-character face disjoint. Other faces can cover their
    # contiguous block's absent glyphs; the cmap then falls back normally.
    range_text = ranges(points if name == 'core' else sorted(set(range(points[0], points[-1] + 1)) - core))
    faces.append('@font-face{font-family:"Sengoku Gyosho";font-style:normal;font-weight:400;font-display:swap;src:url("assets/fonts/kouzan-gyosho/' + output.name + '") format("woff2");unicode-range:' + range_text + ';}')
    entries.append({'file': output.name, 'bytes': len(contents), 'sha256': sha256(contents).hexdigest(), 'codepoints': points, 'unicodeRange': range_text})

manifest = {'font': '衡山毛筆フォント行書', 'family': 'Sengoku Gyosho', 'upstreamVersion': '2.1', 'source': 'source.json', 'realCodepoints': len(covered), 'blankPlaceholdersExcluded': len(cmap) - len(covered), 'files': entries, 'totalBytes': sum(row['bytes'] for row in entries)}
(HERE / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
css_file = ROOT / 'typography-gyosho.css'
marker = '/* Legible gyosho typography. */'
rules = css_file.read_text().split(marker, 1)[1]
css_file.write_text('/* Local public-domain Kouzan Gyosho subsets. See assets/fonts/kouzan-gyosho/SOURCE.md. */\n' + '\n'.join(faces) + '\n\n' + marker + rules)
print(json.dumps({'files': len(entries), 'codepoints': len(covered), 'coreBytes': entries[0]['bytes'], 'totalBytes': manifest['totalBytes']}, ensure_ascii=False))
