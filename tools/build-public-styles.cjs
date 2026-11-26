'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {transformSync} = require('esbuild');
const {compactCss} = require('./compact-css.cjs');

function buildPublicStyles(root, outputs) {
  const groups = {
    'public-theme.bundle.css': ['typography-gyosho.css', 'public-citadel.css'],
    'public-reading.bundle.css': ['image-protect.css', 'button-artwork.css', 'public-luxury.css']
  };
  const urls = {};
  for (const [filename, sources] of Object.entries(groups)) {
    const source = sources.map(name => fs.readFileSync(path.join(root, name), 'utf8')).join('\n');
    const result = transformSync(source, {
      loader: 'css', sourcefile: filename, target: ['chrome90', 'firefox90', 'safari15'],
      minify: true, charset: 'utf8', legalComments: 'inline'
    });
    if (result.warnings.length) throw Error(result.warnings.map(w => w.text).join('\n'));
    const css = compactCss(result.code);
    outputs.set(filename, css);
    urls[filename] = filename + '?v=' + createHash('sha256').update(css).digest('hex').slice(0,12);
  }
  return urls;
}
module.exports = {buildPublicStyles};
