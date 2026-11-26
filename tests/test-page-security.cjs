'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {pageSecurity} = require('../tools/page-security.cjs');
const root = path.join(__dirname, '..');
const site = require('../site-metadata.json');
const config = fs.readFileSync(path.join(root, 'config.js'), 'utf8');
const api = new URL(config.match(/SENGOKU_API_BASE\s*=\s*['"]([^'"]+)/)[1]).origin;
const pages = Object.values(site.pages).map(page => page.path.slice(1) + 'index.html');
for (const file of [...pages, '404.html', 'tools/music-audition.html']) {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  const promotion = ['sengoku-vs/index.html', 'en/index.html'].includes(file);
  assert.equal(pageSecurity(config)(html, file === 'index.html', {promotion}), html, file + ' has current policy');
  const [tag, value] = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/i);
  assert(html.indexOf(tag) < html.search(/<(?:link|style|script)\b/i), file + ' protects first resource');
  const rules = new Map(value.split('; ').map(rule => {
    const [key, ...entries] = rule.split(' ');
    return [key, entries];
  }));
  assert.deepEqual(rules.get('script-src'), ["'self'", 'file:']);
  for (const key of ['base-uri', 'object-src', 'form-action', 'frame-src', 'script-src-attr']) {
    assert.deepEqual(rules.get(key), ["'none'"]);
  }
  assert.equal(rules.get('connect-src').includes(api), file === 'index.html' || promotion);
  assert.equal(rules.get('img-src').includes(api), file === 'index.html');
  assert.match(html, /<meta name="referrer" content="no-referrer">/);
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const [, attributes, body] = match;
    if (/type="application\/ld\+json"/i.test(attributes)) JSON.parse(body);
    else {
      const source = attributes.match(/\bsrc="([^"]+)"/)?.[1];
      assert(source && !body.trim(), file + ' executable scripts are external');
      assert.equal(new URL(source, site.origin + '/' + file).origin, site.origin);
    }
  }
}
console.log('PASS generated CSP, local scripts, scoped API and referrer policies for every game, guide and audition entry.');
