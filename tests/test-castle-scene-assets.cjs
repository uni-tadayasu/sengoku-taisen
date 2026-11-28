'use strict';
// Release gate: run without arguments once all 128 scenes have been generated.
// --partial validates completed manifest entries but explicitly reports missing scenes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { SENGOKU_DATA: data } = require('../engine.js');
const catalog = require('../premium-catalog.js');
const root = path.resolve(__dirname, '..');
const partial = process.argv.includes('--partial');
assert(process.argv.slice(2).every(arg => arg === '--partial'), 'Only --partial is supported');
const widths = [400, 720, 1080, 1536];
const heights = new Map([[400, 225], [720, 405], [1080, 608], [1536, 864]]);
const phases = ['morning', 'day', 'night'];
const read = file => fs.readFileSync(path.join(root, file));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

// SHA-256 values from the existing Kagoshima art in c08d66e, before this feature.
// Keep all three originals and their responsive encodings byte-for-byte intact.
const kagoshimaHashes = {
  'morning-400': 'd3e5074f39d56424b98f2f10ffe5c97c1402476ae49fa94e1cf226f203ad2c55',
  'morning-720': '801a78611d6245e741014f8382482748dbe2a399b5d9f01884f78eeea2e70fb8',
  'morning-1080': '260f07dfc31a4ea9a4b8ea53b9e1fe4573423b84623956e354dac369fecda190',
  'morning-1536': '997c4ab5fccec1f4161c25c58b1f656e2d0432ea295d53b01c8b14a6efdc1e19',
  'day-400': 'e39bcbab2f483a10096932677e86d4df10575ca459e362cdb7cc0a6bc41c7888',
  'day-720': '93c324f65e56aaafe8eacba092f803d77a3ba9cfce1f0e005d64720eaae8cfed',
  'day-1080': '4c2f0001d6019668be6f1f4858d7e29f37678032ac1fda48ee5e8506a3101509',
  'day-1536': 'dce96f247e15b3d9043b3263e8dcb32b872821b6e1e45553765c1820c0787937',
  'night-400': '1ce50e9158af078b8924170718e98f60647de88bb6b95c9571e59bfcc9df8377',
  'night-720': '541cef5de3cba16f7871567ead882a990d21afd7db7c308529df680dfcfd6583',
  'night-1080': '78e542cc100654a390acde2866354969408711ea3632e604e94273e1a6c673cc',
  'night-1536': '3bb3ba99150de9c4917f7b594d7a2608c6d200d72ae883095192fa1ad3347c32'
};

function dimensions(bytes, file) {
  assert(bytes.length >= 20, 'Truncated WebP: ' + file);
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF', file);
  assert.equal(bytes.toString('ascii', 8, 12), 'WEBP', file);
  assert.equal(bytes.readUInt32LE(4) + 8, bytes.length, 'Incomplete RIFF payload: ' + file);
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const tag = bytes.toString('ascii', offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4), start = offset + 8;
    assert(start + length <= bytes.length, 'Truncated WebP chunk: ' + file);
    if (tag === 'VP8X') {
      assert(length >= 10, file);
      return [bytes.readUIntLE(start + 4, 3) + 1, bytes.readUIntLE(start + 7, 3) + 1];
    }
    if (tag === 'VP8 ') {
      assert(length >= 10, file);
      assert.equal(bytes.subarray(start + 3, start + 6).toString('hex'), '9d012a', file);
      return [bytes.readUInt16LE(start + 6) & 16383, bytes.readUInt16LE(start + 8) & 16383];
    }
    if (tag === 'VP8L') {
      assert(length >= 5, file); assert.equal(bytes[start], 0x2f, file);
      const bits = bytes.readUInt32LE(start + 1);
      return [(bits & 16383) + 1, ((bits >>> 14) & 16383) + 1];
    }
    offset = start + length + length % 2;
  }
  throw Error('Missing WebP image dimensions: ' + file);
}

const castles = new Map(data.castles.map(castle => [castle.id, castle]));
assert.equal(castles.size, 129);
const targetIds = [...castles.keys()].filter(id => id !== 'kagoshima').sort();
assert.equal(targetIds.length, 128);
const options = catalog.getCastleScenes();
assert.equal(new Set(options.map(item => item.id)).size, 129, 'Duplicate or missing preview options');
assert.deepEqual(options.map(item => item.id).sort(), [...castles.keys()].sort());
for (const item of options) {
  const castle = castles.get(item.id);
  assert.equal(item.name, castle.name, item.id + ' preview name');
  assert.equal(item.region, castle.region, item.id + ' preview region');
  assert.equal(item.included, item.id === 'kagoshima' || data.majorCityIds.includes(item.id), item.id);
}
assert.equal(options.filter(item => !item.included).length, 123);
console.log('PASS all 129 castle IDs, names, regions and preview availability match the game');

const context = { SENGOKU_DATA: data, document: { readyState: 'loading', addEventListener() {} } };
context.window = context;
vm.runInNewContext(read('artwork.js').toString(), context);
const appearance = { town: 'castle-heritage', ownedProducts: ['castle-heritage'] };
const sourcesFor = (id, phase = 'day') => widths.map(width => `${id === 'kagoshima' ? 'assets/responsive/kagoshima-town-' + phase : 'assets/castle-scenes/' + id}-${width}.webp`);
const preservedOriginals = new Set();
for (const phase of phases) {
  const scene = context.SengokuArt.castleScene('kagoshima', phase);
  const files = sourcesFor('kagoshima', phase);
  assert.equal(scene.src, files[3]);
  assert.equal(scene.srcset, files.map((file, i) => `${file} ${widths[i]}w`).join(', '));
  for (const [i, file] of files.entries()) {
    const bytes = read(file), digest = hash(bytes);
    assert.deepEqual(dimensions(bytes, file), [widths[i], heights.get(widths[i])]);
    assert.equal(digest, kagoshimaHashes[`${phase}-${widths[i]}`], 'Existing Kagoshima illustration changed: ' + file);
    if (widths[i] === 1536) preservedOriginals.add(digest);
  }
}
console.log('PASS Kagoshima retains all 12 original responsive images and three time-of-day scenes');

const manifestPath = 'docs/castle-scenes-20261128.json';
const manifest = JSON.parse(read(manifestPath));
assert.equal(manifest.version, 1);
assert.deepEqual(manifest.preserved, ['kagoshima']);
assert(Array.isArray(manifest.entries), 'Manifest entries are required');
const entries = new Map();
for (const entry of manifest.entries) {
  assert(targetIds.includes(entry.id), 'Unexpected manifest castle: ' + entry.id);
  assert(!entries.has(entry.id), 'Duplicate manifest castle: ' + entry.id);
  entries.set(entry.id, entry);
}
const expectedFiles = targetIds.flatMap(id => sourcesFor(id));
const actualFiles = fs.readdirSync(path.join(root, 'assets/castle-scenes')).filter(name => name.endsWith('.webp')).map(name => 'assets/castle-scenes/' + name).sort();
for (const file of actualFiles) assert(expectedFiles.includes(file), 'Unexpected castle scene variant: ' + file);
const originals = new Map(), generatedSources = new Set(), sourceHashes = new Set();
let checkedFiles = 0, checkedBytes = 0;
for (const id of targetIds) {
  const scene = context.SengokuArt.castleScene(id, 'day', appearance), files = sourcesFor(id);
  assert.equal(scene.name, castles.get(id).name);
  assert.equal(scene.src, files[3]); assert.equal(scene.small, files[0]); assert.equal(scene.native, files[1]);
  assert.equal(scene.srcset, files.map((file, i) => `${file} ${widths[i]}w`).join(', '));
  for (const phase of phases) assert.equal(context.SengokuArt.castleScene(id, phase, appearance).src, files[3], id + ' shares one original across lighting variants');
  const entry = entries.get(id);
  if (!entry) continue;
  assert(typeof entry.prompt === 'string' && entry.prompt.trim(), id + ' needs a generation prompt');
  assert(typeof entry.source === 'string' && entry.source, id + ' needs source provenance');
  assert(!generatedSources.has(entry.source), 'Reused source image: ' + id); generatedSources.add(entry.source);
  for (const key of ['name', 'province', 'region', 'majorCity']) if (Object.hasOwn(entry, key)) assert.equal(entry[key], castles.get(id)[key], id + ' manifest ' + key);
  if (Object.hasOwn(entry, 'sourceSha256')) {
    assert.match(entry.sourceSha256, /^[a-f0-9]{64}$/);
    assert(!sourceHashes.has(entry.sourceSha256), 'Duplicate original source digest: ' + id); sourceHashes.add(entry.sourceSha256);
  }
  assert(Array.isArray(entry.assets), id + ' needs asset metadata');
  assert.deepEqual(entry.assets.map(asset => asset.path).sort(), [...files].sort(), id + ' requires exactly four responsive assets');
  for (const asset of entry.assets) {
    const width = widths[files.indexOf(asset.path)], bytes = read(asset.path), digest = hash(bytes);
    assert.deepEqual(dimensions(bytes, asset.path), [width, heights.get(width)], 'Wrong encoded dimensions: ' + asset.path);
    assert.equal(asset.width, width, asset.path + ' manifest width');
    assert.equal(asset.height, heights.get(width), asset.path + ' manifest height');
    assert.equal(asset.bytes, bytes.length, asset.path + ' manifest byte size');
    if (Object.hasOwn(asset, 'sha256')) assert.equal(asset.sha256, digest, asset.path + ' manifest digest');
    if (width === 1536) {
      assert(!originals.has(digest), `Duplicate 1536 illustration: ${id} and ${originals.get(digest)}`);
      assert(!preservedOriginals.has(digest), 'New scene reuses Kagoshima: ' + id);
      originals.set(digest, id);
    }
    checkedFiles++; checkedBytes += bytes.length;
  }
}
assert.equal(originals.size, entries.size, 'Every completed castle has one unique full-resolution scene');
console.log(`PASS ${entries.size} completed castles: ${checkedFiles} WebPs, encoded sizes, unique originals and matching manifest records`);

const missingIds = targetIds.filter(id => !entries.has(id));
const missingFiles = expectedFiles.filter(file => !fs.existsSync(path.join(root, file)));
console.log(JSON.stringify({ mode: partial ? 'partial' : 'release', expectedCastles: 128, completedCastles: entries.size, checkedFiles, checkedBytes, preservedFiles: 12, missingCastles: missingIds.length, missingFiles: missingFiles.length, complete: !missingIds.length && !missingFiles.length }));
if (partial) {
  if (missingIds.length) console.log(`PARTIAL ONLY: ${missingIds.length} castle scenes remain. This is not a release pass.`);
} else {
  assert.equal(missingIds.length, 0, 'Incomplete castle scene manifest (' + missingIds.length + ' missing): ' + missingIds.slice(0, 12).join(', '));
  assert.deepEqual(actualFiles, [...expectedFiles].sort(), 'All 128 castles require all four encoded widths');
  assert.equal(checkedFiles, 512);
  console.log('PASS release collection: all 128 distinct castles × 4 sizes, plus preserved Kagoshima');
}
