/* The listening room renders the same score and instruments used in the game. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const tracks = window.SENGOKU_MUSIC_TRACKS;
  for (const track of tracks) { const option = document.createElement('option'); option.value = track.id; option.textContent = track.name; $('track').append(option); }
  $('track').value = 'battle-storm';
  const scenes = {town:'城下町',world:'天下地図',officers:'武将',chronicle:'軍議',army:'軍団',research:'研究',battle:'合戦',victory:'勝利',defeat:'敗戦',menu:'天下統一'};
  let previousURL = null;
  function resetSelection() {
    const track = tracks.find(item => item.id === $('track').value);
    const minutes = Math.floor(track.durationSeconds / 60);
    const seconds = String(track.durationSeconds % 60).padStart(2, '0');
    $('track-name').textContent = track.name;
    $('track-description').textContent = track.description;
    $('track-meta').textContent = scenes[track.scene] + '　·　全曲 ' + minutes + ':' + seconds;
    $('audio').pause();
    $('audio').removeAttribute('src');
    $('audio').load();
    $('audio').hidden = true;
    $('download').hidden = true;
    $('download').removeAttribute('href');
    if (previousURL) URL.revokeObjectURL(previousURL);
    previousURL = null;
    $('progress').hidden = true;
    $('render').hidden = false;
    $('status').textContent = '聴きたい曲と再生範囲を選べます。';
    $('metrics').textContent = '再生の準備が終わると表示されます。';
  }
  for (const control of [$('track'), $('excerpt')]) control.addEventListener('change', resetSelection);
  resetSelection();
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
    $('render').disabled = true; $('track').disabled = true; $('excerpt').disabled = true;
    $('progress').hidden = false; $('progress').value = 0; $('audio').pause();
    $('status').textContent = '演奏を準備しています…';
    let player = null;
    try {
      const track = tracks.find(item => item.id === $('track').value), score = window.SengokuMusic.inspect(track.id);
      const full = $('excerpt').value === 'full', perBeat = 60 / track.tempo;
      const from = full ? 0 : score.sections.find(section => section.id === 'climax').startBar * 4 * perBeat;
      const to = full ? score.duration : score.sections.find(section => section.id === 'climax').endBar * 4 * perBeat;
      const length = to - from + 3.2, ctx = new Offline(2, Math.ceil(length * 32000), 32000);
      // The offline graph feeds only the WAV, without acquiring audio focus.
      const Native = window.AudioContext;
      player = new window.SengokuMusic({volume: 100});
      player._connectOutput = context => player._master.connect(context.destination);
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
      $('progress').value = 100; $('render').hidden = true;
      $('audio').setAttribute('aria-label', track.name + 'の再生');
      $('status').textContent = track.name + 'の再生準備ができました。';
      if (!document.hidden) {
        try {
          await $('audio').play();
          $('status').textContent = track.name + (full ? '（全曲）' : '（聴きどころ）');
        } catch (_) { $('status').textContent = '下の再生ボタンでお聴きください。'; }
        $('audio').focus({preventScroll:true});
      }
      const db = value => value > 0 ? (20 * Math.log10(value)).toFixed(1) + ' dBFS' : '無音';
      $('metrics').textContent = [track.name, (full ? '全曲' : '大合奏の抜粋') + ' · ' + length.toFixed(1) + '秒 · 32 kHz / stereo', 'Peak: ' + db(output.peak) + ' · RMS: ' + db(output.rms), 'Clipped samples: ' + output.clipping, '最大同時発音: ' + peakVoices + ' voices / ' + peakSources + ' sources', '予算超過による省略: ' + player._droppedVoices + ' notes', '構成: ' + score.sections.map(section => section.name).join(' → ')].join('\n');
    } catch (error) {
      $('status').textContent = '試聴音声を作成できませんでした。' + (error.message || '');
    } finally {
      if (player) await player.dispose();
      $('render').disabled = false; $('track').disabled = false; $('excerpt').disabled = false; $('progress').hidden = true;
    }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) $('audio').pause(); });
  window.addEventListener('pagehide', event => { if (!event.persisted && previousURL) URL.revokeObjectURL(previousURL); });
})();
