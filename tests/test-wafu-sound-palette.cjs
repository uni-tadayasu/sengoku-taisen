'use strict';
const assert = require('node:assert/strict');
const actions = ['tap','navigate','open','close','toggle','adjust','map','select','build','recruit','assign','dispatch','trade','message','battle','confirm','success','reward','victory','defeat','error'];

(async () => {
  const {fixture} = await import('./helpers/music-fixture.mjs');
  const catalog = Array.from(fixture().context.SengokuSoundEffects.catalog);
  assert.deepEqual(catalog.map(([type]) => type).sort(), [...actions].sort(), 'Audition catalog must expose each current action exactly once');
  assert(catalog.every(([, label]) => typeof label === 'string' && label.trim()));
  const levels = fixture(), levelPlayer = new levels.context.SengokuSoundEffects({volume:10});
  assert(await levelPlayer.play('tap'));
  const shapers = levels.nodes.filter(node => node.kind === 'waveshaper');
  assert.equal(shapers.length, 1, 'One stage must handle all simultaneous notes');
  const curve = shapers[0].curve;
  assert.equal(Object.prototype.toString.call(curve), '[object Float32Array]');
  assert.equal(curve.length, 1025);
  assert.equal(curve[512], 0);
  for (let i = 0; i < curve.length; i++) {
    const x = 2 * i / (curve.length - 1) - 1, value = curve[i];
    assert(Number.isFinite(value) && Math.abs(value) < .475);
    if (i) assert(value >= curve[i-1], 'Increasing input level must not decrease output');
    assert(Math.abs(value + curve[curve.length-1-i]) < 1e-6);
    if (Math.abs(x) <= .36) assert(Math.abs(value-x) < 1e-6, 'Quiet effects must pass unchanged');
  }
  const limit = curve.at(-1);
  assert(limit > .47, 'Avoid attenuating the whole palette instead of just its loud peaks');
  for (let volume = 0; volume <= 100; volume++) {
    levelPlayer.setVolume(volume);
    const gain = levelPlayer._gain.gain.value;
    assert.equal(gain, volume/100*.65);
    assert(limit * gain <= .309 * volume/100);
  }
  levels.setNow(Date.now()+1000);
  assert(await levelPlayer.play('reward'));
  assert.equal(levels.nodes.filter(node => node.kind === 'waveshaper').length, 1);
  await levelPlayer.dispose();
  assert(levels.nodes.every(node => !node.connections.length));
  // Older implementations without WaveShaper use a linear output gain.
  // Bound the sum of the actual oscillator envelopes even when twelve
  // note attacks line up in phase, with no lowpass resonance in this path.
  const oldBrowser = fixture({waveShaper:false, now:1000});
  const fallback = new oldBrowser.context.SengokuSoundEffects({volume:100});
  let loudestStrike = 0;
  for (const [i, type] of actions.entries()) {
    oldBrowser.setNow(1000 + i*1000);
    oldBrowser.contexts[0]?.advance(i);
    assert(await fallback.play(type));
    assert.equal(fallback._mix.kind, 'gain');
    assert.strictEqual(fallback._mix.connections[0], fallback._gain);
    for (const voice of fallback._voices) {
      let sum = 0;
      for (const osc of voice.sources) {
        const env = osc.connections[0];
        assert.strictEqual(env.connections[0], fallback._mix);
        sum += Math.max(...env.gain.events.map(([value]) => value));
      }
      loudestStrike = Math.max(loudestStrike, sum);
    }
  }
  const fallbackBound = loudestStrike*12*fallback._mix.gain.value*fallback._gain.gain.value;
  assert(fallbackBound > 0 && fallbackBound < .293);
  assert.equal(oldBrowser.nodes.filter(node => node.kind === 'filter' || node.kind === 'waveshaper').length, 0);
  await fallback.dispose();
  assert(oldBrowser.nodes.every(node => !node.connections.length));
  const signatures = new Map();
  let peakSources = 0, longest = 0, strongestGain = 0, swept = 0, layered = 0, arpeggiated = 0;
  for (const type of actions) {
    const audio = fixture({recordings:true});
    const player = new audio.context.SengokuSoundEffects({volume:100});
    assert.equal(audio.contexts.length, 0, type + ' must wait for an explicit activation');
    assert.equal(await player.play(type), true, type);
    const sources = [...audio.sources];
    assert(sources.length > 0, type);
    assert.equal(audio.files.length, 0, type + ' must synthesize without downloads');
    const schedule = sources.map(source => {
      assert.equal(source.kind, 'oscillator', type);
      assert(source.started >= 0 && source.stopped > source.started && source.stopped < 1, type + ' has an unbounded source');
      assert(source.frequency.events.length && source.frequency.events.every(([pitch, at]) =>
        pitch > 0 && Number.isFinite(pitch) && at >= source.started && at <= source.stopped), type + ' frequency schedule');
      const gains = [], filters = [];
      let node = source, shaped = false;
      while (node !== player._gain) {
        assert.equal(node.connections.length, 1, type + ' must use the independent effects bus');
        node = node.connections[0];
        if (node.kind === 'waveshaper') { shaped = true; assert.strictEqual(node.connections[0], player._gain); }
        else if (node.kind === 'filter') filters.push([node.type, node.frequency.events]);
        else { assert.equal(node.kind, 'gain', type + ' unexpected routing node'); if (node !== player._gain) gains.push(node.gain); }
      }
      assert(shaped, type + ' must pass through the output ceiling');
      const envelope = gains.find(param => param.events.length >= 3);
      assert(envelope, type + ' needs an audible attack and release');
      const levels = envelope.events.map(([value]) => value);
      const peak = Math.max(...levels);
      strongestGain = Math.max(strongestGain, peak);
      assert(peak > levels[0] && peak > levels.at(-1), type + ' must decay before disconnect');
      return [source.type, source.started, source.stopped, source.frequency.events, gains.map(gain => gain.events.length ? gain.events : gain.value), filters];
    });
    const signature = JSON.stringify(schedule);
    assert(!signatures.has(signature), type + ' unexpectedly shares the entire sound of ' + signatures.get(signature));
    signatures.set(signature, type);
    const starts = new Set(sources.map(source => source.started)), end = Math.max(...sources.map(source => source.stopped));
    peakSources = Math.max(peakSources, sources.length);
    longest = Math.max(longest, end);
    if (starts.size > 1) arpeggiated++;
    if (starts.size < sources.length) layered++;
    if (sources.some(source => new Set(source.frequency.events.map(([value]) => value)).size > 1)) swept++;
    if (type === 'tap') { assert.equal(player._voices.size, 1); assert(sources.length <= 3 && end < .12); }
    audio.contexts[0].advance(end + .01);
    assert.equal(audio.sources.size, 0, type);
    assert.equal(player._voices.size, 0, type);
    assert.equal(audio.contexts[0].state, 'suspended', type + ' must leave no idle running audio');
    await player.dispose();
    assert(audio.nodes.every(node => !node.connections.length), type + ' leaked a connection');
  }
  assert(Math.abs(strongestGain-.292) < 1e-6, 'Keep the calibrated strike level before the shared ceiling');
  assert(layered && swept && arpeggiated, 'The palette must retain layered tones, pitch bends and separately articulated notes');
  // Both a pending browser resume and an already-running context can see
  // a generic click before the asynchronous action result reaches the bus.
  const direct = fixture(), directPlayer = new direct.context.SengokuSoundEffects({volume:20});
  const pitches = audio => [...audio.sources].filter(source => source.connections.length).map(source => [source.type, source.frequency.events]);
  assert(await directPlayer.play('success'));
  const success = pitches(direct);
  let resume;
  const delayed = fixture({resumeImpl() {
    return new Promise(resolve => { resume = () => { this.state = 'running'; resolve(); }; });
  }});
  const deferredPlayer = new delayed.context.SengokuSoundEffects({volume:20});
  const pendingTap = deferredPlayer.play('tap'), pendingResult = deferredPlayer.play('success');
  assert.strictEqual(pendingTap, pendingResult);
  assert.equal(delayed.sources.size, 0);
  resume();
  assert(await pendingResult);
  assert.deepEqual(pitches(delayed), pitches(direct), 'Unlock should emit only the latest action outcome');
  const running = fixture({now:1000}), livePlayer = new running.context.SengokuSoundEffects({volume:20});
  assert(await livePlayer.play('tap'));
  const replaced = [...running.sources];
  assert(await livePlayer.play('success'));
  assert(replaced.every(source => source.stopped === 0 && !source.connections.length));
  assert.deepEqual(pitches(running), success);
  assert.equal(await livePlayer.play('success'), false);
  assert.equal(await livePlayer.play('confirm'), false);
  running.setNow(1071); running.contexts[0].advance(.071);
  assert(await livePlayer.play('confirm'));
  await Promise.all([directPlayer.dispose(),deferredPlayer.dispose(),livePlayer.dispose()]);
  const burst = fixture({now:1000}), player = new burst.context.SengokuSoundEffects({volume:20});
  let concurrentVoices = 0, concurrentSources = 0;
  for (let i = 0; i < 60; i++) {
    const time = i * .071;
    burst.setNow(1000 + 71 * i);
    burst.contexts[0]?.advance(time);
    await player.play(['reward','battle','dispatch'][i % 3]);
    concurrentVoices = Math.max(concurrentVoices, player._voices.size);
    concurrentSources = Math.max(concurrentSources, burst.sources.size);
    assert(player._voices.size <= 12, 'Repeated accepted motifs must reserve every scheduled voice');
  }
  burst.contexts[0].advance(6);
  assert.equal(burst.sources.size, 0);
  assert.equal(player._voices.size, 0);
  await player.dispose();
  console.log('PASS 21 distinct auditionable action sounds including battle victory, independent gain, bounded tap, cleanup and no download.');
  console.log(JSON.stringify({peakSources, longestMs:Math.round(longest*1000), swept, layered, arpeggiated, concurrentVoices, concurrentSources, fullScaleCeiling:limit*.65, fallbackBound}));
})().catch(error => { console.error(error); process.exitCode = 1; });
