'use strict';

// Keep the authored tables readable. Their distribution copies store related values
// together so transport compression sees names, descriptions and numbers side by side.
const assignments = {
  'officers-data.js': /(window\.SENGOKU_OFFICERS\s*=\s*)(\[[\s\S]*?\])\s*;/g,
  'kamon.js': /(const (?:catalog|sources)\s*=\s*)(\[[\s\S]*?\])\s*;/g,
  'engine.js': /(const EXTRA_FACILITIES\s*=\s*)(\[[\s\S]*?\])\s*;/g
};

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const byteCount = value => Buffer.byteLength(JSON.stringify(value));

function commonKeys(values) {
  if (!values.length || !values.every(isRecord)) return null;
  const keys = Object.keys(values[0]);
  if (!keys.length || keys.includes('__proto__')) return null;
  const shape = JSON.stringify(keys);
  return values.every(value => JSON.stringify(Object.keys(value)) === shape) ? keys : null;
}

function packGameCatalog(file, source) {
  const assignment = assignments[file];
  if (!assignment) return source;
  return source.replace(assignment, (original, prefix, literal) => {
    let rows;
    try { rows = JSON.parse(literal); } catch { return original; }
    const keys = commonKeys(rows);
    if (!keys) return original;

    const columns = [];
    const dictionaries = [];
    const scalarColumns = new Map();
    const fields = [];
    for (const key of keys) {
      const values = rows.map(row => row[key]);
      // Only immutable scalar values may share columns. Each row's nested data
      // must retain its own identity even when it contains the same values.
      const scalar = values.every(value => value === null || typeof value !== 'object');
      const signature = scalar ? JSON.stringify(values) : null;
      let access = scalarColumns.get(signature);
      if (!access) {
        const element = 'columns[' + columns.length + '][i]';
        let stored = values;
        access = element;
        if (values.every(value => typeof value === 'string')) {
          const unique = [...new Set(values)];
          const lookup = new Map(unique.map((value, index) => [value, index]));
          const indices = values.map(value => lookup.get(value));
          if (byteCount(unique) + byteCount(indices) + 24 < byteCount(values)) {
            access = 'dictionaries[' + dictionaries.length + '][' + element + ']';
            dictionaries.push(unique);
            stored = indices;
          }
        } else {
          const nestedKeys = commonKeys(values);
          if (nestedKeys) {
            stored = values.map(value => Object.values(value));
            access = '{' + nestedKeys.map((name, index) =>
              JSON.stringify(name) + ':' + element + '[' + index + ']').join(',') + '}';
          }
        }
        columns.push(stored);
        if (scalar) scalarColumns.set(signature, access);
      }
      fields.push(JSON.stringify(key) + ':' + access);
    }
    return prefix + '(function(){const dictionaries=' + JSON.stringify(dictionaries) +
      ',columns=' + JSON.stringify(columns) + ';return columns[0].map((value,i)=>({' +
      fields.join(',') + '}));})();';
  });
}
module.exports = {packGameCatalog};
