/* Listen to the same stereo master as the game. The native player keeps
   buffering and seeking available on devices without Web Audio. */
(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const tracks=window.SENGOKU_MUSIC_TRACKS;
  if(!Array.isArray(tracks)||!tracks.length||!window.SengokuMusic){
    $('status').textContent='曲目を読み込めませんでした。通信を確認してページを開き直してください。';
    return;
  }
  const audio=$('audio'),picker=$('track'),range=$('excerpt'),button=$('render');
  const scenes={town:'城下町',world:'天下地図',officers:'武将',chronicle:'軍議',army:'軍団',research:'研究',battle:'合戦',victory:'勝利',defeat:'敗戦',menu:'天下統一'};
  let track,from=0,to=0,request=0,stopTimer=0,ready=false,recordingStats=null,statsRequest=null;
  let wavURL=null,writingWav=false,selection=0;
  const Offline=window.OfflineAudioContext||window.webkitOfflineAudioContext;
  const clock=t=>Math.floor(t/60)+':'+String(Math.round(t)%60).padStart(2,'0');
  for(const item of tracks){
    const option=document.createElement('option');option.value=item.id;option.textContent=item.name;picker.append(option);
  }
  audio.volume=.30;picker.value='battle-storm';

  function metrics(){
    const row=recordingStats?.[track.id];
    const lines=[track.name,'44.1 kHz・ステレオ・MP3 / 112 kbps','収録時間 '+clock(track.durationSeconds)];
    if(row)lines.push('統合ラウドネス '+row.lufs.toFixed(1)+' LUFS','トゥルーピーク '+row.truePeakDb.toFixed(1)+' dBTP');
    $('metrics').textContent=lines.join('\n');
  }
  document.querySelector('details').addEventListener('toggle',async event=>{
    if(!event.currentTarget.open||recordingStats||!window.fetch)return;
    if(!statsRequest)statsRequest=fetch('../assets/music/masters.json?v=4.9.4-20261123')
      .then(response=>response.ok?response.json():null).catch(()=>null);
    const manifest=await statsRequest;
    recordingStats=manifest?.tracks||null;
    metrics();
  });
  function select(){
    ++request;++selection;ready=false;clearTimeout(stopTimer);
    if(wavURL)URL.revokeObjectURL(wavURL);
    wavURL=null;writingWav=false;
    const wavLink=$('wav-save');wavLink.hidden=!Offline||!window.fetch;
    wavLink.href='#player';wavLink.removeAttribute('download');
    wavLink.textContent='選択範囲をWAVで保存';
    audio.pause();audio.removeAttribute('src');audio.load();audio.hidden=true;
    track=tracks.find(item=>item.id===picker.value);
    const excerpt=window.SengokuMusic.inspect(track.id).sections.find(section=>section.id==='climax');
    const secondsPerBar=track.beatsPerBar*60/track.tempo;
    from=range.value==='full'?0:excerpt.startBar*secondsPerBar;
    to=range.value==='full'?track.duration:excerpt.endBar*secondsPerBar;
    $('track-name').textContent=track.name;$('track-description').textContent=track.description;
    $('track-meta').textContent=scenes[track.scene]+'　·　曲の長さ '+clock(track.durationSeconds);
    $('status').textContent='';$('progress').hidden=true;
    const download=$('download');download.href='../'+track.recording;download.download=track.id+'.mp3';download.hidden=false;
    button.hidden=false;button.disabled=false;picker.disabled=false;range.disabled=false;metrics();
  }
  function stopExcerpt(){
    if(!ready||range.value==='full'||audio.paused)return;
    clearTimeout(stopTimer);
    const seconds=to-audio.currentTime;
    if(seconds>.025)stopTimer=setTimeout(stopExcerpt,1000*seconds/Math.max(.25,audio.playbackRate));
    else{
      audio.pause();audio.currentTime=from;
      $('status').textContent='聴きどころの再生が終わりました。';
    }
  }
  for(const control of [picker,range])control.addEventListener('change',select);
  audio.addEventListener('loadedmetadata',()=>{
    if(!audio.getAttribute('src'))return;
    audio.currentTime=from;ready=true;audio.hidden=false;button.hidden=true;
    $('progress').hidden=true;$('status').textContent=track.name+'　'+(range.value==='full'?'曲の全編':'聴きどころ');
  });
  audio.addEventListener('error',()=>{
    if(!audio.getAttribute('src'))return;
    ready=false;clearTimeout(stopTimer);audio.hidden=true;button.hidden=false;button.disabled=false;
    $('progress').hidden=true;$('status').textContent='音源を読み込めませんでした。通信を確認して、もう一度お試しください。';
  });
  for(const name of ['playing','ratechange','seeked','timeupdate'])audio.addEventListener(name,stopExcerpt);
  audio.addEventListener('seeking',()=>{
    if(ready&&range.value!=='full'&&(audio.currentTime+.05<from||audio.currentTime>to+.05))
      audio.currentTime=from;
  });
  audio.addEventListener('pause',()=>clearTimeout(stopTimer));
  button.addEventListener('click',async()=>{
    const pending=++request;
    button.disabled=true;$('progress').hidden=false;$('progress').removeAttribute('value');
    $('status').textContent='録音を読み込んでいます…';
    audio.src='../'+track.recording;
    try{await audio.play();}
    catch(error){
      if(pending!==request)return;
      if(error.name==='NotAllowedError'){
        $('status').textContent='下の再生ボタンでお聴きください。';audio.hidden=false;
      }
    }finally{if(pending===request)button.disabled=false;}
  });
  $('wav-save').addEventListener('click',async event=>{
    if(wavURL)return;
    event.preventDefault();
    if(writingWav)return;
    const selected=selection,link=$('wav-save');
    writingWav=true;link.textContent='WAVを準備中…';
    try{
      const response=await fetch('../'+track.recording);
      if(!response.ok)throw Error('Audio unavailable');
      const decoder=new Offline(2,1,44100),buffer=await decoder.decodeAudioData(await response.arrayBuffer());
      if(selected!==selection)return;
      const first=Math.round(from*buffer.sampleRate),last=Math.min(buffer.length,Math.round(to*buffer.sampleRate));
      const channels=buffer.numberOfChannels,size=(last-first)*channels*2,view=new DataView(new ArrayBuffer(44+size));
      const word=(index,value)=>Array.from(value).forEach((letter,i)=>view.setUint8(index+i,letter.charCodeAt(0)));
      word(0,'RIFF');view.setUint32(4,36+size,true);word(8,'WAVE');word(12,'fmt ');
      view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,channels,true);
      view.setUint32(24,buffer.sampleRate,true);view.setUint32(28,buffer.sampleRate*channels*2,true);
      view.setUint16(32,channels*2,true);view.setUint16(34,16,true);word(36,'data');view.setUint32(40,size,true);
      const samples=Array.from({length:channels},(_,channel)=>buffer.getChannelData(channel));
      let byte=44;
      for(let i=first;i<last;i++)for(const channel of samples){
        const value=Math.max(-1,Math.min(1,channel[i]));
        view.setInt16(byte,Math.round(value*(value<0?32768:32767)),true);byte+=2;
      }
      wavURL=URL.createObjectURL(new Blob([view.buffer],{type:'audio/wav'}));
      link.href=wavURL;link.download=track.id+'-'+range.value+'.wav';
      link.textContent='選択範囲をWAVで保存';link.click();
    }catch(_){if(selected===selection)$('status').textContent='WAVを準備できませんでした。選択中の曲はMP3で保存できます。';}
    finally{if(selected===selection){writingWav=false;link.textContent='選択範囲をWAVで保存';}}
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden)audio.pause();});
  window.addEventListener('pagehide',event=>{audio.pause();clearTimeout(stopTimer);if(!event.persisted&&wavURL)URL.revokeObjectURL(wavURL);});
  select();
})();
