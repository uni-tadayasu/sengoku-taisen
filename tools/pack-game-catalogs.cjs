'use strict';

// Keep the readable game catalogs as the source of truth. Share their repeated keys and
// string values in the shipped script, then recreate the same ordinary objects.
const assignments = {
  'officers-data.js': /(window\.SENGOKU_OFFICERS\s*=\s*)(\[[\s\S]*?\])\s*;/,
  'kamon.js': /(const catalog\s*=\s*)(\[[\s\S]*?\])\s*;/
};

function packGameCatalog(file, source) {
  const assignment = assignments[file];
  if (!assignment) return source;
  return source.replace(assignment, (original, prefix, literal) => {
    let rows;
    try { rows = JSON.parse(literal); } catch { return original; }
    if (!rows.length) return original;
    const keys = Object.keys(rows[0]);
    if (rows.some(row => JSON.stringify(Object.keys(row)) !== JSON.stringify(keys))) return original;
    const encoded = rows.map(() => []);
    const dictionaries = [];
    const fields = [];
    const byteCount = value => Buffer.byteLength(JSON.stringify(value));
    for (const key of keys) {
      const values = rows.map(row => row[key]);
      const column = encoded[0].length;
      const unique = [...new Set(values)];
      let access = 'row[' + column + ']';
      let stored = values;
      if (values.every(value => typeof value === 'string')) {
        const lookup = new Map(unique.map((value, index) => [value, index]));
        const indices = values.map(value => lookup.get(value));
        if (byteCount(unique) + byteCount(indices) + 24 < byteCount(values)) {
          access = 'dictionaries[' + dictionaries.length + '][' + access + ']';
          dictionaries.push(unique);
          stored = indices;
        }
      }
      stored.forEach((value, index) => encoded[index].push(value));
      fields.push(JSON.stringify(key) + ':' + access);
    }
    return prefix + '(function(){const dictionaries=' + JSON.stringify(dictionaries) +
      ';return ' + JSON.stringify(encoded) + '.map(row=>({' + fields.join(',') + '}));})();';
  });
}
module.exports = {packGameCatalog};
