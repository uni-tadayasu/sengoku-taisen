#!/usr/bin/env python3
"""Verify every emitted font, CSS allocation and original variation mapping.

Without original paths this checks integrity, cmap/CSS allocation and UVS
coverage. Pass all three original paths to additionally compare every retained
glyph outline and horizontal/vertical advance with the hash-pinned originals.
"""
import argparse
from hashlib import sha256
import json
import re

from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.ttLib import TTFont

from font_pipeline import HERE, ROOT, SOURCE, expand, coverage_hash, load_font, variations, source_arguments, source_bytes


def digest_outline(glyphs, name):
    pen = DecomposingRecordingPen(glyphs)
    glyphs[name].draw(pen)
    def canonical(value):
        if isinstance(value, (tuple, list)):
            return [canonical(item) for item in value]
        if isinstance(value, float) and value.is_integer():
            return int(value)
        return value
    return sha256(json.dumps(canonical(pen.value), separators=(',', ':')).encode()).hexdigest()


def css_faces(css):
    result = []
    for block in re.findall(r'@font-face\s*\{([^}]+)\}', css):
        family = re.search(r'font-family:\s*"([^"]+)"', block).group(1)
        filename = re.search(r'src:\s*url\("assets/fonts/soft-brush/([^"/]+)"\)', block).group(1)
        points = expand(re.search(r'unicode-range:([^;]+)', block).group(1))
        assert points, 'Empty CSS face'
        result.append((family, filename, points))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source_arguments(parser)
    parser.add_argument('--write-summary', action='store_true')
    args = parser.parse_args()
    provided = [bool(getattr(args, key)) for key in SOURCE]
    assert not any(provided) or all(provided), 'Pass all three originals or none'
    originals = {key:load_font(key,data) for key,data in source_bytes(args).items()} if all(provided) else {}
    original_sets = {key:font.getGlyphSet() for key,font in originals.items()}
    original_maps = {key:font.getBestCmap() for key,font in originals.items()}
    original_uv = variations(originals['noto']) if originals else None
    original_digests = {}
    manifest = json.loads((HERE/'manifest.json').read_text())
    assert manifest['sourceDefinitionSha256'] == sha256((HERE/'source.json').read_bytes()).hexdigest()
    declared_uv = {tuple(pair) for pair in json.loads((HERE/'variation-sequences.json').read_text())['sequences']}
    assert len(declared_uv) == manifest['variationSequences'] == 14787
    css = (ROOT/'typography-gyosho.css').read_text()
    faces = css_faces(css)
    assert '@import' not in css
    assert 'https://' not in css and 'http://' not in css
    assert '[data-sengoku-variant-glyph]' in css and '[data-sengoku-variant-field]' in css
    assert 'font-synthesis: none !important' in css and 'text-shadow: none !important' in css
    rows = {row['file']:row for row in manifest['files']}
    assert len(rows) == len(manifest['files'])
    seen_source = {key:set() for key in SOURCE}
    seen_uv = set()
    outline_checks = 0
    glyph_checks = 0
    for filename, row in rows.items():
        data = (HERE/filename).read_bytes()
        assert data[:4] == b'wOF2', filename
        assert len(data) == row['bytes'] and sha256(data).hexdigest() == row['sha256'], filename
        assert row['sha256'][:12] in filename, filename
        current = TTFont(HERE/filename)
        cmap = current.getBestCmap()
        points = set(cmap)
        expected = expand(row['unicodeRange'])
        assert points == expected and len(points) == row['codepointCount'], filename + ': cmap coverage'
        assert not (points & seen_source[row['source']]), filename + ': duplicate source allocation'
        seen_source[row['source']].update(points)
        uv = variations(current)
        assert len(uv) == row['variationCount'], filename
        assert not (set(uv) & seen_uv), filename + ': duplicate UVS'
        assert all(base in points for base,selector in uv), filename + ': detached UVS'
        seen_uv.update(uv)
        assert row['source'] == 'noto' or not uv
        if originals:
            key = row['source']
            original = originals[key]
            assert current['head'].unitsPerEm == original['head'].unitsPerEm
            for cp,glyph in cmap.items():
                assert glyph == original_maps[key][cp], filename + ': remapped codepoint'
            for pair,glyph in uv.items():
                assert pair in original_uv and glyph == original_uv[pair], filename + ': altered UVS'
            glyphs = current.getGlyphSet()
            for glyph in current.getGlyphOrder():
                assert glyph in original_sets[key], filename + ': invented glyph'
                cache_key = key,glyph
                if cache_key not in original_digests:
                    original_digests[cache_key] = digest_outline(original_sets[key],glyph)
                assert digest_outline(glyphs,glyph) == original_digests[cache_key], filename + ': altered outline ' + glyph
                assert current['hmtx'][glyph] == original['hmtx'][glyph], filename + ': altered horizontal metrics'
                if 'vmtx' in original:
                    assert 'vmtx' in current and current['vmtx'][glyph] == original['vmtx'][glyph], filename + ': altered vertical metrics'
                outline_checks += 1
            glyph_checks += len(current.getGlyphOrder())
    assert seen_uv == declared_uv
    if originals:
        assert seen_uv == set(original_uv)
    allocated = {manifest['family']:set(),manifest['variantFamily']:set()}
    requested_by_source = {key:set() for key in SOURCE}
    referenced = set()
    for family,filename,points in faces:
        assert family in allocated and filename in rows
        assert points <= expand(rows[filename]['unicodeRange']), filename + ': CSS claims missing glyph'
        assert not (points & allocated[family]), filename + ': overlapping CSS allocation'
        allocated[family].update(points)
        referenced.add(filename)
        if family == manifest['family']:
            requested_by_source[rows[filename]['source']].update(points)
        else:
            assert rows[filename]['source'] == 'noto'
    assert referenced == set(rows), 'Unreferenced or missing asset'
    # Noto is a shared second-choice family for normal text and first-choice
    # family for explicit variants. Its coverage may overlap brush coverage.
    brush = allocated[manifest['family']]
    fallback = allocated[manifest['variantFamily']]
    normal = brush | fallback
    requested_by_source['noto'] = fallback - brush
    assert len(normal) == manifest['combinedCodepoints']
    assert coverage_hash(normal) == manifest['combinedCoverageSha256']
    variant_bases = {base for base,selector in declared_uv}
    assert variant_bases <= fallback
    for key,points in requested_by_source.items():
        expected = manifest['sources'][key]
        assert len(points) == expected['assignedCodepoints']
        assert coverage_hash(points) == expected['assignedCoverageSha256']
        if originals:
            assert len(original_maps[key]) == expected['codepointCount']
            assert coverage_hash(original_maps[key]) == expected['coverageSha256']
    if originals:
        assert normal == set().union(*(set(cmap) for cmap in original_maps.values()))
        assert requested_by_source['yuji'] == set(original_maps['yuji'])
        assert requested_by_source['klee'] == set(original_maps['klee'])-set(original_maps['yuji'])
        assert requested_by_source['noto'] == set(original_maps['noto'])-set(original_maps['yuji'])-set(original_maps['klee'])
    assert sum(row['bytes'] for row in rows.values()) == manifest['totalBytes']
    summary = {
        'result':'PASS','mode':'original-outline-comparison' if originals else 'structural-integrity',
        'files':len(rows),'fontBytes':manifest['totalBytes'],'cssBytes':len(css.encode()),
        'largestFileBytes':max(row['bytes'] for row in rows.values()),
        'normalUnicodeCodepoints':len(normal),'variationSequences':len(seen_uv),
        'ideographicVariationSequences':sum(selector >= 0xE0100 for base,selector in seen_uv),
        'standardizedVariationSequences':sum(0xFE00 <= selector <= 0xFE0F for base,selector in seen_uv),
        'variationBases':len(variant_bases),'retainedGlyphChecks':glyph_checks,
        'outlineAndMetricsComparisons':outline_checks,'uniqueOriginalGlyphComparisons':len(original_digests),
        'sourceSha256':{key:entry['sha256'] for key,entry in SOURCE.items()},
        'fontToolsVersion':manifest['fontToolsVersion'],'brotliVersion':manifest['brotliVersion'],
        'claims':'Selected original outlines and all encoded characters are preserved. Different fonts share some characters; their normal priority is Yuji, Klee, Noto. All original Noto cmap-14 sequences remain exact.'
    }
    if args.write_summary:
        (HERE/'verification-summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(summary,ensure_ascii=False),flush=True)


if __name__ == '__main__':
    main()
