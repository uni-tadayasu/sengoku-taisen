// Included in map-data.js at build time. A printable delta stream uses five
// data bits per character, one continuation bit and zigzag-encoded signs.
function readDeltas(encoded) {
  const values = [];
  let position = 0;
  while (position < encoded.length) {
    let value = 0, shift = 0, chunk;
    do {
      chunk = encoded.charCodeAt(position++) - 63;
      value |= (chunk & 31) << shift;
      shift += 5;
    } while (chunk >= 32);
    values.push((value >>> 1) ^ -(value & 1));
  }
  return values;
}

function unpackGeography(geography, encodedVertices) {
  const deltas = readDeltas(encodedVertices);
  const vertices = [];
  let longitude = 0, latitude = 0;
  for (let i = 0; i < deltas.length; i += 2) {
    longitude += deltas[i];
    latitude += deltas[i + 1];
    vertices.push([longitude / 1000000, latitude / 1000000]);
  }

  function restore(node) {
    if (Array.isArray(node)) return node.map(restore);
    if (typeof node === 'number') return vertices[node].slice();
    let index = 0;
    return readDeltas(node).map(delta => {
      index += delta;
      // GeoJSON coordinates remain independently mutable, including where two
      // prefectures share a border or a ring's first and last points match.
      return vertices[index].slice();
    });
  }

  for (const layer of ['land', 'prefectures', 'boundaries', 'rivers', 'lakes']) {
    for (const feature of geography[layer].features) {
      feature.geometry.coordinates = restore(feature.geometry.coordinates);
    }
  }
  return geography;
}
