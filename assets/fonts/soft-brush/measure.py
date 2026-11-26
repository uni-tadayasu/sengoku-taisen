#!/usr/bin/env python3
"""Calculate cold-cache font-file payloads; this is not a network timing test."""
import argparse
import gzip
import json

from font_pipeline import HERE, ROOT, expand
from verify import css_faces


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write-summary', action='store_true')
    args = parser.parse_args()
    manifest = json.loads((HERE/'manifest.json').read_text())
    rows = {row['file']:row for row in manifest['files']}
    faces = css_faces((ROOT/'typography-gyosho.css').read_text())
    maps = {manifest['family']:{},manifest['variantFamily']:{}}
    for family,filename,points in faces:
        maps[family].update({cp:filename for cp in points})
    samples = json.loads((HERE/'samples.json').read_text())
    old = json.loads((ROOT/'assets/fonts/kouzan-gyosho/manifest.json').read_text())
    old_map = {cp:row['file'] for row in old['files'] for cp in row['codepoints']}
    old_files = {row['file']:row for row in old['files']}
    result = {
        'measurement':'theoretical cold-cache WOFF2 payload; actual local file sizes, not observed HTTP transfer or latency',
        'excludes':'CSS/HTML/JS, response headers, browser/system fallbacks and cache reuse; browsers may load additional files for text not in the sample',
        'variantSampleAssumption':'The complete variants sample is an explicitly marked existing text parent, matching the conservative field/label CSS behavior.',
        'assetBytes':manifest['totalBytes'],'assetFiles':len(rows),
        'largestFileBytes':max(row['bytes'] for row in rows.values()),
        'cssBytes':(ROOT/'typography-gyosho.css').stat().st_size,
        'cssGzipBytes':len(gzip.compress((ROOT/'typography-gyosho.css').read_bytes(),mtime=0)),
        'samples':{}
    }
    for name,text in samples.items():
        if name == 'description':
            continue
        families = [manifest['variantFamily'],manifest['family']] if name == 'variants' else [manifest['family'],manifest['variantFamily']]
        requested = set()
        missing = set()
        for cp in map(ord,text):
            if 0xE0100 <= cp <= 0xE01EF or 0xFE00 <= cp <= 0xFE0F:
                continue  # UVS mappings travel in the base's existing subset.
            filename = next((maps[family][cp] for family in families if cp in maps[family]),None)
            if filename:
                requested.add(filename)
            elif not chr(cp).isspace():
                missing.add(cp)
        baseline = {old_map[cp] for cp in map(ord,text) if cp in old_map}
        before = sum(old_files[name]['bytes'] for name in baseline)
        after = sum(rows[name]['bytes'] for name in requested)
        result['samples'][name] = {
            'fontBytes':after,'fontFiles':len(requested),'files':sorted(requested),
            'legacyFontBytes':before,'legacyFontFiles':len(baseline),
            'payloadReductionPercent':round((1-after/before)*100,2) if before else None,
            'uncoveredCodepoints':['U+%04X' % cp for cp in sorted(missing)],
            'legacyComparisonLimit':'The old font did not support every character/sequence. This comparison sums its covered-character files and does not claim equal old coverage.'
        }
    if args.write_summary:
        (HERE/'payload-summary.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(result,ensure_ascii=False,indent=2))


if __name__ == '__main__':
    main()
