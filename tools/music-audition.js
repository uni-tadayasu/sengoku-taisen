/* Developer audition: renders the actual production score and synthesis graph. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const tracks = window.SENGOKU_MUSIC_TRACKS;
  for (const track of tracks) { const option = document.createElement('option'); option.value = track.id; option.textContent = track.name; $('track').append(option); }
  $('track').value = 'battle-storm';
  let previousURL = null;
  function wav(buffer) {
    const frames = buffer.length, channels = buffer.numberOfChannels;
    const bytes = new ArrayBuffer(44 + frames * channels * 2), view = new DataView(bytes);
    const text = (at, value) => [...value].forEach((char, index) => view.setUint8(at + index, char.charCodeAt(0)));
    text(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
    view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * channels * 2, true);
    view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, bytes.byteLength - 44, true);
    const data = Array.from({length: channels}, (_, index) => buffer.getChannelData(index));
    let peak = 0, squares = 0, invalid = 0, clipping = 0, at = 44;
    for (let frame = 0; frame < frames; frame++) for (let channel = 0; channel < channels; channel++) {
      const sample = data[channel][frame];
      if (!Number.isFinite(sample)) invalid++;
      peak = Math.max(peak, Math.abs(sample)); squares += sample * sample; if (Math.abs(sample) >= 1) clipping++;
      const bounded = Number.isFinite(sample) ? Math.max(-1, Math.min(1, sample)) : 0;
      view.setInt16(at, Math.round(bounded * (bounded < 0 ? 32768 : 32767)), true); at += 2;
    }
    return {blob: new Blob([bytes], {type:'audio/wav'}), peak, rms: Math.sqrt(squares / (frames * channels)), invalid, clipping};
  }
  $('render').addEventListener('click', async () => {
    const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!Offline) { $('status').textContent = 'このブラウザは端末内での試聴音声作成に対応していません。'; return; }
    $('render').disabled = true; $('progress').hidden = false; $('progress').value = 0; $('audio').pause();
    $('status').textContent = '試聴用に演奏を合成しています。';
    let player = null;
    try {
      const track = tracks.find(item => item.id === $('track').value), score = window.SengokuMusic.inspect(track.id);
      const full = $('excerpt').value === 'full', perBeat = 60 / track.tempo;
      const from = full ? 0 : score.sections.find(section => section.id === 'climax').startBar * 4 * perBeat;
      const to = full ? score.duration : score.sections.find(section => section.id === 'climax').endBar * 4 * perBeat;
      const length = to - from + 3.2, ctx = new Offline(2, Math.ceil(length * 32000), 32000);
      // Only this standalone developer page substitutes a context. Nothing from
      // app.js, identity, persistence, or network APIs is loaded here.
      const Native = window.AudioContext;
      player = new window.SengokuMusic({volume: 100});
      player._preparePlaybackSession = () => false;
      ctx.close = async () => {}; // OfflineAudioContext has no live device to close.
      try { window.AudioContext = function () { return ctx; }; player._ensureContext(); }
      finally { window.AudioContext = Native; }
      player._master.gain.value = .65;
      const bus = ctx.createGain(), roomBus = ctx.createGain(); bus.connect(player._compressor); roomBus.connect(player._reverb);
      const session = {bus, roomBus, voices:new Set(), active:true}; player._sessions.add(session);
      const events = score.events.filter(event => event.beat * perBeat >= from && event.beat * perBeat < to);
      let index = 0, peakVoices = 0, peakSources = 0, renderError = null;
      function schedule(until) {
        player._pruneVoices(ctx.currentTime);
        while (index < events.length && events[index].beat * perBeat - from <= until) {
          const event = events[index++]; player._voice(session, event, Math.max(ctx.currentTime, event.beat * perBeat - from), event.duration * perBeat);
          peakVoices = Math.max(peakVoices, player._voices.size); peakSources = Math.max(peakSources, player._sourceCount);
        }
      }
      schedule(.2);
      const suspended = [];
      for (let at = .2; at < length - .2; at += .2) {
        suspended.push(ctx.suspend(at).then(async () => {
          try { schedule(ctx.currentTime + .2); $('progress').value = Math.min(99, ctx.currentTime / length * 100); }
          catch (error) { renderError = error; }
          await ctx.resume();
        }));
      }
      const buffer = await ctx.startRendering(); await Promise.all(suspended); if (renderError) throw renderError;
      const output = wav(buffer); if (output.invalid) throw Error('音声に不正なサンプルがあります。');
      if (previousURL) URL.revokeObjectURL(previousURL); previousURL = URL.createObjectURL(output.blob);
      $('audio').src = previousURL; $('audio').volume = .3; $('audio').hidden = false;
      $('download').href = previousURL; $('download').download = track.id + (full ? '-full' : '-climax') + '.wav'; $('download').hidden = false;
      $('progress').value = 100; $('status').textContent = '試聴音声を作成しました。再生ボタンで確認できます。';
      const db = value => value > 0 ? (20 * Math.log10(value)).toFixed(1) + ' dBFS' : '無音';
      $('metrics').textContent = [track.name, (full ? '全曲' : '大合奏の抜粋') + ' · ' + length.toFixed(1) + '秒 · 32 kHz / stereo', 'Peak: ' + db(output.peak) + ' · RMS: ' + db(output.rms), 'Clipped samples: ' + output.clipping, '最大同時発音: ' + peakVoices + ' voices / ' + peakSources + ' sources', '予算超過による省略: ' + player._droppedVoices + ' notes', '構成: ' + score.sections.map(section => section.name).join(' → ')].join('\n');
    } catch (error) {
      $('status').textContent = '試聴音声を作成できませんでした。' + (error.message || '');
    } finally {
      if (player) await player.dispose(); $('render').disabled = false;
    }
  });
  window.addEventListener('pagehide', () => { if (previousURL) URL.revokeObjectURL(previousURL); });
})();
