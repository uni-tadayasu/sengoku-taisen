#!/usr/bin/env python3
from hashlib import sha256
import json
from pathlib import Path
from fontTools.ttLib import TTFont

folder = Path(__file__).resolve().parent
root = folder.parents[2]
manifest = json.loads((folder / 'manifest.json').read_text())
seen = set()
css_seen = set()
for row in manifest['files']:
    path = folder / row['file']
    data = path.read_bytes()
    assert data[:4] == b'wOF2' and len(data) == row['bytes']
    assert sha256(data).hexdigest() == row['sha256']
    font = TTFont(path)
    declared = set(row['codepoints'])
    assert declared == set(font.getBestCmap()), row['file']
    assert not seen & declared, 'Unicode subsets overlap'
    seen.update(declared)
    css_points = set()
    for part in row['unicodeRange'].split(','):
        ends = [int(value, 16) for value in part[2:].split('-')]
        css_points.update(range(ends[0], ends[-1] + 1))
    assert declared <= css_points and not css_seen & css_points, 'CSS ranges overlap or omit real glyphs'
    css_seen.update(css_points)
    for cp, glyph in font.getBestCmap().items():
        assert font['glyf'][glyph].numberOfContours or cp in (0x20, 0xa0, 0x3000), 'Blank placeholder masks fallback'
assert len(seen) == manifest['realCodepoints']
assert 1 < len(manifest['files']) <= 24
assert manifest['files'][0]['bytes'] < 400000, 'Core font must remain below 400 KB'
assert sum(row['bytes'] for row in manifest['files']) == manifest['totalBytes']
assert set(map(ord, '戦国天下徳織田信長金銭兵糧木材石材あいうえおアイウエオ')) <= seen
assert ord('德') not in seen, 'An unpainted name variant must use the system fallback instead of disappearing'
css = (root / 'typography-gyosho.css').read_text()
assert 'font-display:swap' in css and 'unicode-range:' in css
assert 'https://' not in css and '@import' not in css
for row in manifest['files']:
    assert 'assets/fonts/kouzan-gyosho/' + row['file'] in css
    assert 'unicode-range:' + row['unicodeRange'] + ';' in css
assert '--font-numerals:' in css and 'tabular-nums' in css
print('PASS', len(manifest['files']), 'local WOFF2 subsets;', len(seen), 'real codepoints; no blank placeholders or overlapping ranges')
print('PASS core', manifest['files'][0]['bytes'], 'bytes; total', manifest['totalBytes'], 'bytes; local sources, fallback, numerals and source hashes')
