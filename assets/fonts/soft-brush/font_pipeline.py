"""Shared, offline-capable source and range helpers for the font pipeline."""
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import urllib.request

from fontTools.ttLib import TTFont

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
SOURCE = json.loads((HERE / 'source.json').read_text())['sources']


def source_arguments(parser):
    for key in SOURCE:
        parser.add_argument('--' + key, type=Path, help='Already downloaded, hash-verified ' + SOURCE[key]['family'])


def source_bytes(arguments, download=False):
    result = {}
    for key, entry in SOURCE.items():
        path = getattr(arguments, key, None)
        if path:
            data = path.read_bytes()
        elif download:
            with urllib.request.urlopen(entry['download'], timeout=60) as response:
                data = response.read()
        else:
            raise SystemExit('Pass --' + key + ' with the original font when comparing outlines.')
        assert len(data) == entry['bytes'], key + ': original byte count changed'
        assert sha256(data).hexdigest() == entry['sha256'], key + ': original SHA-256 changed'
        result[key] = data
    return result


def load_font(key, data):
    return TTFont(BytesIO(data), fontNumber=SOURCE[key].get('fontNumber', -1), recalcTimestamp=False)


def variations(font):
    result = {}
    for table in font['cmap'].tables:
        if table.format == 14:
            for selector, entries in table.uvsDict.items():
                for base, glyph in entries:
                    key = (base, selector)
                    assert key not in result or result[key] == glyph
                    result[key] = glyph
    return result


def ranges(points):
    result = []
    for point in sorted(points):
        if result and point == result[-1][1] + 1:
            result[-1][1] = point
        else:
            result.append([point, point])
    return ','.join('U+%X' % first if first == last else 'U+%X-%X' % (first, last) for first, last in result)


def expand(value):
    result = set()
    for token in value.split(','):
        if not token:
            continue
        bounds = [int(piece, 16) for piece in token[2:].split('-')]
        result.update(range(bounds[0], bounds[-1] + 1))
    return result


def coverage_hash(points):
    return sha256(','.join(map(str, sorted(points))).encode()).hexdigest()
