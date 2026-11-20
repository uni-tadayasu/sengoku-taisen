/* Verify coverage against the live game data and the public rendering boundary. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { SENGOKU_DATA } = require('../engine.js');
const kamon = require('../kamon.js');
const scope = { window: {} };
vm.createContext(scope);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../officers-data.js'), 'utf8'), scope);
const expected = new Set([
  ...SENGOKU_DATA.clans.map(item => item.name),
  ...SENGOKU_DATA.castles.map(item => item.clan),
  ...scope.window.SENGOKU_OFFICERS.map(item => item.clan),
  '在地衆',
]);
const entries = kamon.entries();
assert.deepEqual(new Set(entries.map(item => item.clan)), expected, 'Every actual game affiliation must have a crest');
assert.equal(new Set(entries.map(item => item.id)).size, entries.length, 'No duplicate catalog IDs');
const sources = kamon.getSources();
const sourceIds = new Set(sources.map(source => source.id));
assert.equal(sourceIds.size, sources.length);
for (const source of sources) assert.equal(new URL(source.url).protocol, 'https:', source.id);
for (const item of entries) {
  assert(['kamon', 'group', 'reference'].includes(item.kind));
  assert(['documented', 'traditional', 'unverified'].includes(item.status));
  assert(item.note && item.description && item.name);
  for (const source of item.sourceIds) assert(sourceIds.has(source), item.clan + ': source ' + source);
  if (item.kind !== 'group') assert(item.sourceIds.length, item.clan + ': needs attribution');
  if (item.kind === 'group') {
    assert.equal(item.status, 'unverified');
    assert.match(item.note, /創作群章/);
  }
  assert.match(item.url, /^assets\/kamon\/[a-z0-9-]+\.svg$/);
  assert.equal(kamon.url(item.clan), item.url);
  const svg = fs.readFileSync(path.join(__dirname, '..', item.url), 'utf8');
  assert.match(svg, /^<svg\s/);
  assert.match(svg, /viewBox="0 0 256 256"/);
  assert(svg.includes(item.clan), item.clan + ': accessible title');
  assert.match(svg, /<desc\b/);
  assert.match(svg, /<(?:path|circle|polygon|ellipse|rect)\b/);
  assert.doesNotMatch(svg, /<(?:script|foreignObject|image|text|iframe)\b|\son[a-z]+\s*=|https?:\/\/(?!www\.w3\.org\/2000\/svg)/i, item.clan + ': self-contained SVG');
  const ids = [...svg.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, item.clan + ': duplicate mask or title IDs');
  for (const match of svg.matchAll(/url\(#([^)]*)\)/g)) assert(ids.includes(match[1]), item.clan + ': unresolved mask');
  assert.match(kamon.render(item.clan, { size: 36 }), /width="36" height="36"/);
}

// Known prominent symbols and two expressly uncertain family identifications.
for (const [clan, name] of [['徳川家', '三つ葉葵'], ['織田家', '織田木瓜'], ['武田家', '四割菱'], ['毛利家', '一文字三星'], ['島津家', '丸に十文字'], ['真田家', '六連銭']]) {
  assert(kamon.get(clan).name.includes(name), clan);
  assert.equal(kamon.get(clan).status, 'documented');
}
for (const clan of ['城家', '新発田家']) assert.equal(kamon.get(clan).kind, 'reference');
assert.match(kamon.get('津軽家').name, /旗印/);
assert(kamon.get('津軽家').sourceIds.includes('tsugaru'));
assert.equal(kamon.url('徳川'), kamon.url('徳川家'));
assert.equal(kamon.url('芦名家'), kamon.url('蘆名家'));

// Caller input cannot inject HTML, CSS declarations, or a network URL.
const dangerous = '<img src=x onerror="alert(1)">';
const html = kamon.render(dangerous, { size: '40; background:url(https://bad)', className: 'foo" onclick="alert(1)', label: true });
assert(!html.includes(dangerous));
assert(html.includes('&lt;img'));
assert.equal((html.match(/<img\b/g) || []).length, 1);
assert.doesNotMatch(html, /background:|https:\/\/bad/);
for (const tag of html.match(/<[^>]*>/g) || []) {
  for (const attribute of tag.matchAll(/\s([^\s=]+)\s*=\s*"([^"]*)"/g)) assert(!/^on/i.test(attribute[1]), 'No event handler attributes');
}
assert.match(html, /--kamon-size:40px/);
assert.match(kamon.render('徳川家', { size: 9999 }), /--kamon-size:512px/);
assert.match(kamon.render('徳川家', { size: 1 }), /--kamon-size:12px/);
assert.doesNotThrow(() => kamon.render(null, null));
assert.equal(kamon.get('未収録の氏族').status, 'unverified');
assert(fs.existsSync(path.join(__dirname, '..', kamon.url('未収録の氏族'))));
const copied = kamon.entries(); copied.length = 0;
assert.equal(kamon.entries().length, expected.size, 'A caller cannot erase the catalog');
assert(Object.isFrozen(kamon.get('徳川家')));
const sourceCopy = kamon.getSources(); sourceCopy.length = 0;
assert.equal(kamon.getSources().length, sources.length);

const browser = { window: {} }; vm.createContext(browser);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../kamon.js'), 'utf8'), browser);
assert.equal(browser.window.SengokuKamon.entries().length, expected.size, 'Plain script loading works without CommonJS');
assert(fs.readFileSync(path.join(__dirname, '../SOURCES-KAMON.md'), 'utf8').includes('精密復刻ではない'));
console.log(`PASS ${expected.size} clan affiliations, ${sources.length} sources, SVG safety/IDs, explicit uncertainty, aliases, HTML escaping, immutable catalog, and browser script loading.`);
