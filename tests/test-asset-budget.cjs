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
assert(totalBytes <= 2950000, `Initial bundles exceed the 2,950,000 byte budget: ${totalBytes}`);
assert(totalGzipBytes <= 850000, `Initial bundles exceed the 850,000 gzip byte budget: ${totalGzipBytes}`);
const html = fs.readFileSync(path.join(root,'index.html'),'utf8');
for (const file of Object.keys(groups)) assert(html.includes(file+'?v='), 'Budget must cover the shipped entry: '+file);
console.log(JSON.stringify({entryBundles:rows,totalBytes,totalGzipBytes,rawBudget:2950000,gzipBudget:850000}));
