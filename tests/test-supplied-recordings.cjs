'use strict';

// Guard the verified supplied audio against missing files, accidental
// recomposition, or a catalogue/manifest mismatch in later releases.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.join(__dirname, '..');
require('../music.js');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'assets/music/daypart-masters.json'), 'utf8'));
const expected = { shitaku: '支度', asakatsu: '朝活', hirukatsu: '昼活', yorukatsu: '夜活' };
assert.deepEqual(Object.keys(manifest.tracks).sort(), Object.keys(expected).sort());
for (const [id, name] of Object.entries(expected)) {
  const record = manifest.tracks[id];
  const track = global.SENGOKU_MUSIC_TRACKS.find(item => item.id === id);
  assert(track, id + ' is selectable');
  assert.equal(track.name, name);
  assert.equal(track.recordingOnly, true);
  assert.equal(record.title, name);
  assert.equal(record.path, 'assets/music/' + id + '.mp3');
  assert.equal(track.recording, record.path);
  assert.equal(track.duration, record.decodedDuration);
  const audio = fs.readFileSync(path.join(root, record.path));
  assert.equal(audio.length, record.bytes, id + ' has the verified file length');
  assert.equal(createHash('sha256').update(audio).digest('hex'), record.sha256, id + ' retains the verified original audio');
  const proof = record.preservation;
  assert.equal(proof.audioPacketSha256, proof.sourceAudioPacketSha256);
  assert.equal(proof.decodedPcmSha256, proof.sourceDecodedPcmSha256);
  assert.equal(proof.fullDecodeSucceeded, true);
  assert.equal(proof.decodeErrors, 0);
  console.log('PASS ' + name + ': verified audio, catalogue and provenance agree (' + audio.length + ' bytes).');
}
