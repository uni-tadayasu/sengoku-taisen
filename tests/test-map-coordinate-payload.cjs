'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = filename => fs.readFileSync(path.join(root, filename), 'utf8');
const scope = {};
vm.runInNewContext(read('map-data.js'), scope);
const map = JSON.parse(JSON.stringify(scope.SENGOKU_GEOGRAPHY));
const source = name => JSON.parse(read('assets/map/' + name));

let vertices = 0;
function compareCoordinates(before, after) {
  assert.equal(after.length, before.length);
  if (typeof before[0] === 'number') {
    for (let i = 0; i < before.length; i++) {
      assert(Math.abs(before[i] - after[i]) <= 0.000000500001);
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
console.log('PASS ' + vertices + ' source vertices retain their order, structure and precision bound. All ' + Object.keys(castles).length + ' castle records match exactly.');
