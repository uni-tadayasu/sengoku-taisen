'use strict';
// Guard the actual shipped entry, including compression, against accidental
// growth. These byte budgets do not claim a device-specific loading time.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {gzipSync} = require('node:zlib');
const root = path.resolve(__dirname, '..');
const groups = require('../tools/game-entry.json');
const rows = Object.keys(groups).map(file => {
  const bytes = fs.readFileSync(path.join(root,file));
  return {file,bytes:bytes.length,gzipBytes:gzipSync(bytes).length};
});
const totalBytes = rows.reduce((sum,row)=>sum+row.bytes,0);
const totalGzipBytes = rows.reduce((sum,row)=>sum+row.gzipBytes,0);
// v5.6 adds formation comparison, multi-goal plans, the operations board,
// independent effects volume, aspect-preserving facility artwork, the cyber
// theme and locally hosted calligraphic font declarations.
// Allow their measured footprint explicitly while keeping a bounded entry;
// runtime work reductions are measured separately, not inferred from bytes.
const rawBudget=3160000,gzipBudget=910000;
assert(totalBytes <= rawBudget, `Initial bundles exceed the ${rawBudget} byte budget: ${totalBytes}`);
assert(totalGzipBytes <= gzipBudget, `Initial bundles exceed the ${gzipBudget} gzip byte budget: ${totalGzipBytes}`);
const html = fs.readFileSync(path.join(root,'index.html'),'utf8');
for (const file of Object.keys(groups)) assert(html.includes(file+'?v='), 'Budget must cover the shipped entry: '+file);
console.log(JSON.stringify({entryBundles:rows,totalBytes,totalGzipBytes,rawBudget,gzipBudget}));
