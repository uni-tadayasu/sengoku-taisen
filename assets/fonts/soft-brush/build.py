#!/usr/bin/env python3
"""Build immutable, disjoint brush/font-variant subsets from pinned originals.

The standard family uses Yuji first, Klee only for its missing characters, then
Noto for the remaining Unicode coverage. Noto subsets also retain all original
UVSes, each with its base character, for an explicitly selected variant family.
No UI, save, name, or variation sequence is normalized or rewritten here.
"""
import argparse
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from hashlib import sha256
from io import BytesIO
import json

import brotli
import fontTools
from fontTools import subset

from font_pipeline import HERE, ROOT, SOURCE, load_font, variations, ranges, expand, coverage_hash, source_arguments, source_bytes

BRUSH_FAMILY = 'Sengoku Soft Brush'
VARIANT_FAMILY = 'Sengoku Exact Variants'
CHUNK_SIZE = 384
NOTO_CHUNK_SIZE = 512


def init_worker(originals):
    global RAW
    RAW = originals


def encode(task):
    source, group, points, selectors = task
    current = load_font(source, RAW[source])
    options = subset.Options()
    options.flavor = 'woff2'
    options.name_IDs = ['*']
    options.name_languages = ['*']
    options.glyph_names = True
    options.layout_features = ['*']
    options.notdef_glyph = True
    options.notdef_outline = True
    work = subset.Subsetter(options=options)
    # FontTools 4.61.1 requires selectors to be requested explicitly. Selecting
    # each base together with every original selector preserves default and
    # non-default cmap-14 entries without inventing an association.
    work.populate(unicodes=sorted(set(points) | set(selectors)))
    work.subset(current)
    allowed = set(points)
    for table in current['cmap'].tables:
        if table.format != 14 and table.isUnicode() and hasattr(table, 'cmap'):
            table.cmap = {cp: glyph for cp, glyph in table.cmap.items() if cp in allowed}
    family = 'Sengoku ' + {'yuji':'Yuji', 'klee':'Klee Complement', 'noto':'Exact Variant'}[source] + ' Subset'
    for record in list(current['name'].names):
        if record.nameID in (1, 2, 4, 6, 16, 17):
            text = {1:family, 2:'Regular', 4:family + ' Regular',
                    6:family.replace(' ', '') + '-Regular', 16:family, 17:'Regular'}[record.nameID]
            current['name'].setName(text, record.nameID, record.platformID, record.platEncID, record.langID)
    current.flavor = 'woff2'
    output = BytesIO()
    current.save(output)
    data = output.getvalue()
    digest = sha256(data).hexdigest()
    filename = source + '-' + group + '-' + digest[:12] + '.woff2'
    target = HERE / filename
    if target.exists():
        assert target.read_bytes() == data, 'An immutable font URL must not change'
    else:
        target.write_bytes(data)
    return {'source':source, 'group':group, 'file':filename, 'bytes':len(data),
            'sha256':digest, 'unicodeRange':ranges(points), 'codepointCount':len(points),
            'variationCount':len(variations(current))}


def chunks(points, size):
    ordered = sorted(points)
    return [ordered[offset:offset+size] for offset in range(0, len(ordered), size)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source_arguments(parser)
    parser.add_argument('--workers', type=int, default=2)
    parser.add_argument('--refresh-allocation', action='store_true', help='Allocate a new common set from current public UI source; otherwise reproduce the existing manifest allocation')
    parser.add_argument('--reuse-assets', action='store_true', help='Validate existing immutable assets and regenerate only metadata/CSS')
    parser.add_argument('--reuse-unchanged', action='store_true', help='During an intentional allocation refresh, verify and keep unchanged subsets')
    args = parser.parse_args()
    raw = source_bytes(args, download=True)
    fonts = {key:load_font(key, data) for key, data in raw.items()}
    maps = {key:font.getBestCmap() for key, font in fonts.items()}
    covered = {key:set(cmap) for key, cmap in maps.items()}
    uv = variations(fonts['noto'])
    assert len(uv) == 14787, 'Review an unexpected change in the pinned variation repertoire'
    variant_bases = {base for base, selector in uv}
    selectors = {selector for base, selector in uv}
    assert variant_bases <= covered['noto']
    assigned = {'yuji':covered['yuji'], 'klee':covered['klee']-covered['yuji']}
    assigned['noto'] = covered['noto']-assigned['yuji']-assigned['klee']

    samples = json.loads((HERE / 'samples.json').read_text())
    primary = ['index.html','boot.js','app.js','command-center.js','navigation-ui.js','music.js']
    text = {name:(ROOT/name).read_text() for name in primary}
    application_paths = sorted(path for path in ROOT.glob('*.js') if not path.name.endswith('.bundle.js') and path.name not in ('sw.js','map-data.js','kamon.js'))
    application_text = ''.join(path.read_text() for path in application_paths)
    counts = Counter(map(ord, ''.join(text.values()) + samples['town']))
    required = set(map(ord, text['index.html'] + text['boot.js'] + samples['town']))
    required |= set(range(0x20, 0x7f)) | set(range(0x3000, 0x3100))
    common = {cp for cp, count in sorted(counts.items(), key=lambda row:(-row[1], row[0]))[:850]}
    core = assigned['yuji'] & (required | common)
    used = set(core)
    launch = core & (set(map(ord,text['index.html']+text['boot.js']+samples['title'])) | set(range(0x20,0x7f)))
    tasks = [('yuji','launch',sorted(launch),[]),('yuji','core',sorted(core-launch),[])]
    ui = (assigned['yuji'] & set(map(ord, application_text))) - used
    for index, points in enumerate(chunks(ui, CHUNK_SIZE), 1):
        tasks.append(('yuji','interface-%02d' % index,points,[]))
        used.update(points)
    for index, points in enumerate(chunks(assigned['yuji'] - used, CHUNK_SIZE), 1):
        tasks.append(('yuji','rare-%02d' % index,points,[]))

    complement_core = assigned['klee'] & (required | set(map(ord, '𠮷髙﨑德邉邊葛辻禰')))
    if complement_core:
        tasks.append(('klee','names',sorted(complement_core),[]))
    for index, points in enumerate(chunks(assigned['klee'] - complement_core, CHUNK_SIZE), 1):
        tasks.append(('klee','rare-%02d' % index,points,[]))

    # A Noto file can be shared between the missing-Unicode and IVS families.
    # Only Unicode bases participate in CSS range allocation: variation
    # selectors have no standalone painted glyph and stay in cmap format 14.
    noto_points = assigned['noto'] | variant_bases
    priority = noto_points & (required | set(map(ord, samples['variants']+'葛德髙﨑𠮷辻邉邊禰神祢崎吉高渡')))
    if priority:
        tasks.append(('noto','variants-core',sorted(priority),sorted(selectors)))
    for index, points in enumerate(chunks(noto_points-priority, NOTO_CHUNK_SIZE), 1):
        tasks.append(('noto','range-%03d' % index,points,sorted(selectors)))

    partition_inputs = [{'file':str(path.relative_to(ROOT)),'sha256':sha256(path.read_bytes()).hexdigest()} for path in sorted(set(application_paths)|{ROOT/name for name in primary})]
    previous = json.loads((HERE/'manifest.json').read_text()) if (HERE/'manifest.json').exists() else None
    if previous and not args.refresh_allocation:
        assert previous['sourceDefinitionSha256'] == sha256((HERE/'source.json').read_bytes()).hexdigest(), 'Review changed originals before refreshing allocation'
        tasks = [(row['source'],row['group'],sorted(expand(row['unicodeRange'])),sorted(selectors) if row['source']=='noto' else []) for row in previous['files']]
        partition_inputs = previous['partitionInputs']
    if args.reuse_assets:
        assert previous and not args.refresh_allocation, '--reuse-assets requires the existing frozen allocation'
        entries = previous['files']
        for row in entries:
            data = (HERE/row['file']).read_bytes()
            assert len(data) == row['bytes'] and sha256(data).hexdigest() == row['sha256']
    else:
        reusable = {}
        if args.reuse_unchanged:
            assert previous and args.refresh_allocation, '--reuse-unchanged requires an intentional allocation refresh'
            assert previous['sourceDefinitionSha256'] == sha256((HERE/'source.json').read_bytes()).hexdigest(), 'Changed originals must be rebuilt, not reused'
            assert previous['fontToolsVersion'] == fontTools.__version__ and previous['brotliVersion'] == brotli.__version__
            for row in previous['files']:
                data = (HERE/row['file']).read_bytes()
                assert len(data) == row['bytes'] and sha256(data).hexdigest() == row['sha256']
                reusable[(row['source'],row['group'],row['unicodeRange'])] = row
        changed = [task for task in tasks if (task[0],task[1],ranges(task[2])) not in reusable]
        with ProcessPoolExecutor(max_workers=max(1,min(4,args.workers)),initializer=init_worker,initargs=(raw,)) as pool:
            encoded = iter(pool.map(encode,changed))
            entries = [reusable.get((task[0],task[1],ranges(task[2]))) or next(encoded) for task in tasks]
    faces = []
    for row in entries:
        points = expand(row['unicodeRange'])
        # One Noto face per URL serves both roles: after the brush family for
        # missing characters, before it for explicitly marked variant text.
        # This avoids duplicating two large, mostly complementary range lists.
        family = VARIANT_FAMILY if row['source'] == 'noto' else BRUSH_FAMILY
        faces.append('@font-face{font-family:"' + family + '";font-style:normal;font-weight:400;font-display:swap;src:url("assets/fonts/soft-brush/' + row['file'] + '") format("woff2");unicode-range:' + ranges(points) + ';}')
    manifest = {'format':1,'family':BRUSH_FAMILY,'variantFamily':VARIANT_FAMILY,'normalFallbackFamily':VARIANT_FAMILY,
                'fontToolsVersion':fontTools.__version__,'brotliVersion':brotli.__version__,
                'sourceDefinitionSha256':sha256((HERE/'source.json').read_bytes()).hexdigest(),
                'sources':{key:{'codepointCount':len(covered[key]),'coverageSha256':coverage_hash(covered[key]),
                                'assignedCodepoints':len(assigned[key]),'assignedCoverageSha256':coverage_hash(assigned[key])} for key in SOURCE},
                'combinedCodepoints':len(set().union(*covered.values())),
                'combinedCoverageSha256':coverage_hash(set().union(*covered.values())),
                'variationSequences':len(uv),'variationBases':len(variant_bases),'files':entries,
                'totalBytes':sum(row['bytes'] for row in entries),
                'partitionInputs':partition_inputs}
    (HERE/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    # This is the sole explicit sequence list. Font manifests keep only counts
    # and ranges; the browser can consult the pair list without duplicated glyph
    # inventories or human names. The mapped outlines remain in the WOFF2s.
    (HERE/'variation-sequences.json').write_text(json.dumps({'format':1,'source':'noto','sequences':sorted([base,selector] for base,selector in uv)},separators=(',',':'))+'\n')
    css = '/* Gentle local brush typography and exact Unicode variants. See assets/fonts/soft-brush/SOURCE.md. */\n'+'\n'.join(faces)+'\n\n'+(HERE/'style.css').read_text()
    (ROOT/'typography-gyosho.css').write_text(css)
    summary = {'files':len(entries),'totalBytes':manifest['totalBytes'],'largestFileBytes':max(row['bytes'] for row in entries),
               'normalCodepoints':manifest['combinedCodepoints'],'variationSequences':len(uv),'cssBytes':len(css.encode())}
    print(json.dumps(summary,ensure_ascii=False),flush=True)


if __name__ == '__main__':
    main()
