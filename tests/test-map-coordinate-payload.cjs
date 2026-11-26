'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {gzipSync} = require('node:zlib');

const root = path.join(__dirname, '..');
const read = filename => fs.readFileSync(path.join(root, filename), 'utf8');
const scope = {};
const shipped = read('map-data.js');
vm.runInNewContext(shipped, scope);
const map = JSON.parse(JSON.stringify(scope.SENGOKU_GEOGRAPHY));
const source = name => JSON.parse(read('assets/map/' + name));

let vertices = 0;
function compareCoordinates(before, after) {
  assert.equal(after.length, before.length);
  if (typeof before[0] === 'number') {
    for (let i = 0; i < before.length; i++) {
      assert.equal(after[i], Number(before[i].toFixed(6)));
    }
    vertices++;
  } else {
    before.forEach((child, i) => compareCoordinates(child, after[i]));
  }
}
for (const [key, filename] of Object.entries({
  land: 'japan-land-10m.geojson',
  prefectures: 'japan-prefectures-10m.geojson',
  boundaries: 'japan-prefecture-boundaries-10m.geojson',
  rivers: 'japan-rivers-10m.geojson',
  lakes: 'japan-lakes-10m.geojson'
})) {
  const original = source(filename);
  assert.equal(map[key].features.length, original.features.length);
  original.features.forEach((feature, i) => {
    const delivered = map[key].features[i];
    assert.deepEqual(delivered.properties, feature.properties);
    assert.equal(delivered.geometry.type, feature.geometry.type);
    compareCoordinates(feature.geometry.coordinates, delivered.geometry.coordinates);
  });
}
const originalCastles = source('castle-coordinates.json');
const castles = Array.isArray(originalCastles) ? Object.fromEntries(originalCastles.map(c => [c.id, c])) : originalCastles;
assert.deepEqual(map.castles, castles);
console.log('PASS ' + vertices + ' source vertices retain their order, structure and six-decimal coordinates. All ' + Object.keys(castles).length + ' castle records match exactly.');


// Compare the actual objects before JSON cloning so shared wire references
// cannot accidentally become shared mutable points in the game.
const points = new Set();
function uniquePoints(coordinates) {
  if (typeof coordinates[0] === 'number') {
    assert(!points.has(coordinates), 'Each GeoJSON point must own its array');
    points.add(coordinates);
  } else {
    coordinates.forEach(uniquePoints);
  }
}
for (const name of ['land', 'prefectures', 'boundaries', 'rivers', 'lakes']) {
  for (const feature of scope.SENGOKU_GEOGRAPHY[name].features) uniquePoints(feature.geometry.coordinates);
}
assert.equal(points.size, vertices);
const unpacked = JSON.stringify(map);
assert(Buffer.byteLength(shipped) < Buffer.byteLength(unpacked) * 0.35);
assert(gzipSync(shipped).length < gzipSync(unpacked).length * 0.4);
console.log('PASS packed geography remains smaller on the wire and every point is independently mutable.');
