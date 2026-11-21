/* 戦国大戦: 16 original procedural scores. No samples, quotations, or external dependencies. */
(function (global) {
  'use strict';

  const SCALES = {
    yo:[0,2,5,7,9], in:[0,1,5,7,8], hira:[0,2,3,7,8],
    major:[0,2,4,7,9], minor:[0,3,5,7,10]
  };
  // Each pair is [scale degree, beat length]; null is a deliberate rest.
  // Every track has its own four-bar theme, harmonic route, orchestration and rhythm.
  const SCORES = [
    {id:'town-dawn',name:'暁の城下',scene:'town',tempo:84,root:62,scale:'yo',bars:32,beats:4,
      chords:[0,3,1,4,0,2,3,0],style:'flow',lead:'flute',density:.8,drums:'light',
      description:'琴の分散和音と穏やかな笛。朝の城下町に流れる開幕の調べ。',
      phrases:[[[0,1],[2,.5],[3,.5],[4,1],[2,1]],[[1,.5],[2,.5],[3,1],[1,1],[null,1]],[[0,.5],[1,.5],[2,1],[5,1],[4,1]],[[3,1],[2,.5],[1,.5],[0,2]]]},
    {id:'castle-evening',name:'夕映えの天守',scene:'town',tempo:72,root:57,scale:'hira',bars:32,beats:4,
      chords:[0,2,4,1,0,3,2,0],style:'sparse',lead:'flute',density:.5,drums:'none',
      description:'長い笛の音と余韻を残す琴。夕暮れの城郭を思わせる静かな曲。',
      phrases:[[[4,1.5],[2,.5],[1,1],[null,1]],[[0,2],[2,1],[3,1]],[[5,1],[4,.5],[3,.5],[2,1.5],[null,.5]],[[1,1],[0,3]]]},
    {id:'fields-green',name:'豊穣の風',scene:'town',tempo:92,root:60,scale:'major',bars:32,beats:4,
      chords:[0,3,4,1,2,3,4,0],style:'bounce',lead:'pluck',density:.9,drums:'light',
      description:'跳ねる琴と柔らかな鼓。田畑の発展と豊かな実りを描く軽快な旋律。',
      phrases:[[[0,.5],[2,.5],[4,1],[3,.5],[2,.5],[1,1]],[[2,.5],[3,.5],[5,.5],[4,.5],[2,1],[null,1]],[[1,.5],[2,.5],[3,1],[4,.5],[5,.5],[3,1]],[[2,1],[1,.5],[2,.5],[0,1.5],[null,.5]]]},
    {id:'market-breeze',name:'楽市のにぎわい',scene:'town',tempo:104,root:65,scale:'yo',bars:32,beats:4,
      chords:[0,4,2,3,1,4,3,0],style:'syncopated',lead:'pluck',density:1,drums:'wood',
      description:'小気味よい木音と細やかな琴。商いが行き交う城下町の曲。',
      phrases:[[[2,.5],[null,.5],[3,.5],[4,.5],[5,1],[3,1]],[[4,.5],[2,.5],[1,.5],[null,.5],[2,.5],[3,.5],[0,1]],[[3,.5],[4,.5],[6,1],[5,.5],[4,.5],[2,1]],[[1,.5],[3,.5],[2,1],[0,1],[null,1]]]},
    {id:'world-march',name:'山河を越えて',scene:'world',tempo:96,root:55,scale:'minor',bars:32,beats:4,
      chords:[0,3,2,4,0,1,4,0],style:'march',lead:'flute',density:.9,drums:'march',
      description:'踏みしめる太鼓と広がりのある笛。天下を目指す道のりの行軍曲。',
      phrases:[[[0,1],[0,.5],[2,.5],[3,1],[5,1]],[[4,1],[3,.5],[2,.5],[1,1],[null,1]],[[2,1],[3,.5],[4,.5],[5,1],[7,1]],[[5,1],[3,1],[2,.5],[1,.5],[0,1]]]},
    {id:'mountain-road',name:'霧深き峠',scene:'world',tempo:78,root:62,scale:'in',bars:32,beats:4,
      chords:[0,1,3,4,2,1,4,0],style:'sparse',lead:'flute',density:.6,drums:'pulse',
      description:'陰影のある音階と遠く響く鼓。山道を進む緊張と静寂。',
      phrases:[[[0,1.5],[1,.5],[3,1],[null,1]],[[4,1],[3,.5],[1,.5],[0,1],[null,1]],[[2,.5],[3,.5],[4,1.5],[6,.5],[5,1]],[[3,1],[1,1],[0,2]]]},
    {id:'officers-oath',name:'武士の誓い',scene:'officers',tempo:88,root:60,scale:'minor',bars:32,beats:4,
      chords:[0,2,3,4,1,3,4,0],style:'arpeggio',lead:'flute',density:.8,drums:'light',
      description:'落ち着いた琴に凛とした笛が重なる、武将たちの志を描く旋律。',
      phrases:[[[3,1],[2,.5],[0,.5],[2,1],[4,1]],[[5,1.5],[4,.5],[3,1],[null,1]],[[2,.5],[3,.5],[5,1],[6,.5],[5,.5],[4,1]],[[3,1],[1,1],[0,1.5],[null,.5]]]},
    {id:'council-lantern',name:'軍議の灯',scene:'chronicle',tempo:82,root:57,scale:'hira',bars:32,beats:4,
      chords:[0,4,1,3,2,4,1,0],style:'pulse',lead:'pluck',density:.65,drums:'wood',
      description:'低い弦の反復と控えめな打音。策を巡らせる夜の軍議の調べ。',
      phrases:[[[0,.5],[null,.5],[2,1],[1,.5],[0,.5],[3,1]],[[4,1],[2,1],[1,.5],[null,.5],[0,1]],[[1,.5],[2,.5],[4,1],[5,.5],[4,.5],[3,1]],[[2,1.5],[1,.5],[0,2]]]},
    {id:'army-banner',name:'旗印のもとに',scene:'army',tempo:108,root:55,scale:'yo',bars:32,beats:4,
      chords:[0,3,4,2,0,4,1,0],style:'march',lead:'pluck',density:1,drums:'march',
      description:'力強い太鼓と刻む弦。兵を集め、旗のもとに進軍する曲。',
      phrases:[[[0,.5],[0,.5],[3,1],[4,.5],[3,.5],[5,1]],[[2,.5],[3,.5],[4,1],[2,1],[0,1]],[[3,.5],[3,.5],[5,1],[7,.5],[6,.5],[5,1]],[[4,1],[3,.5],[2,.5],[0,1],[null,1]]]},
    {id:'research-stars',name:'星読みの書',scene:'research',tempo:76,root:64,scale:'major',bars:32,beats:4,
      chords:[0,2,1,4,3,2,4,0],style:'arpeggio',lead:'bell',density:.7,drums:'none',
      description:'澄んだ鐘と細い琴の糸。新たな技術を探る静かな探究の曲。',
      phrases:[[[2,1],[4,.5],[5,.5],[7,1],[4,1]],[[3,1.5],[1,.5],[2,1],[null,1]],[[4,.5],[5,.5],[7,1],[6,1],[3,1]],[[2,1],[1,1],[0,2]]]},
    {id:'battle-storm',name:'烈風の陣',scene:'battle',tempo:116,root:57,scale:'minor',bars:32,beats:4,
      chords:[0,4,3,2,0,3,1,4],style:'drive',lead:'pluck',density:1,drums:'battle',
      description:'疾走する琴と鋭い太鼓。野戦の機先を争う激しい戦の曲。',
      phrases:[[[0,.5],[2,.5],[3,.5],[2,.5],[5,.5],[4,.5],[3,1]],[[4,.5],[5,.5],[7,1],[5,.5],[4,.5],[2,1]],[[3,.5],[4,.5],[5,.5],[7,.5],[8,1],[5,1]],[[4,.5],[3,.5],[2,.5],[1,.5],[0,1],[null,1]]]},
    {id:'battle-siege',name:'城門を衝く',scene:'battle',tempo:100,root:50,scale:'hira',bars:32,beats:4,
      chords:[0,1,4,3,0,2,1,4],style:'drive',lead:'flute',density:1,drums:'siege',
      description:'重い太鼓と低音のうねり。城壁に迫る軍勢の緊張を描く攻城曲。',
      phrases:[[[0,1],[2,.5],[1,.5],[0,1],[3,1]],[[4,1],[5,.5],[4,.5],[2,1],[null,1]],[[3,.5],[4,.5],[6,1],[5,.5],[3,.5],[4,1]],[[2,1],[1,.5],[0,.5],[0,2]]]},
    {id:'victory-horizon',name:'勝鬨、空高く',scene:'victory',tempo:106,root:62,scale:'major',bars:32,beats:4,
      chords:[0,3,2,4,1,3,4,0],style:'bright',lead:'flute',density:.95,drums:'march',
      description:'明るく上昇する笛と祝祭の琴。勝利の喜びを穏やかにたたえる曲。',
      phrases:[[[0,.5],[2,.5],[4,1],[5,1],[7,1]],[[6,1],[5,.5],[4,.5],[3,1],[null,1]],[[4,.5],[5,.5],[7,1],[9,.5],[8,.5],[7,1]],[[5,1],[4,.5],[2,.5],[0,2]]]},
    {id:'defeat-moon',name:'月下の再起',scene:'defeat',tempo:68,root:57,scale:'in',bars:32,beats:4,
      chords:[0,3,1,4,2,1,3,0],style:'sparse',lead:'flute',density:.4,drums:'none',
      description:'途切れがちな笛と静かな琴。敗戦を越え、再起を誓う夜の曲。',
      phrases:[[[4,1.5],[3,.5],[1,1],[null,1]],[[2,2],[0,1],[null,1]],[[1,1],[3,1],[4,1.5],[null,.5]],[[2,1],[1,1],[0,2]]]},
    {id:'winter-silence',name:'雪待つ山里',scene:'town',tempo:70,root:65,scale:'hira',bars:32,beats:4,
      chords:[0,2,4,3,1,4,2,0],style:'sparse',lead:'bell',density:.45,drums:'none',
      description:'雪のように落ちる小さな鐘と、薄く漂う笛。冬の内政に寄り添う曲。',
      phrases:[[[5,1],[4,1],[2,1.5],[null,.5]],[[3,1],[1,1],[0,1],[null,1]],[[4,1.5],[5,.5],[3,1],[1,1]],[[2,2],[0,2]]]},
    {id:'unification',name:'天下、一つの空',scene:'menu',tempo:90,root:60,scale:'yo',bars:32,beats:4,
      chords:[0,3,1,4,2,3,4,0],style:'bright',lead:'flute',density:1,drums:'light',
      description:'幾つもの旋律が一つになる大らかな終曲。統一された山河に響く調べ。',
      phrases:[[[0,1],[3,.5],[4,.5],[5,1],[7,1]],[[5,1],[4,.5],[3,.5],[2,1],[null,1]],[[3,.5],[4,.5],[5,1],[8,1],[7,1]],[[5,1],[3,1],[2,.5],[1,.5],[0,1]]]}
  ];
  const TRACKS = Object.freeze(SCORES.map(t => Object.freeze({
    id:t.id,name:t.name,title:t.name,scene:t.scene,tempo:t.tempo,bars:t.bars,
    beatsPerBar:t.beats,duration:t.bars*t.beats*60/t.tempo,
    durationSeconds:Math.round(t.bars*t.beats*60/t.tempo),description:t.description
  })));
  const byId = new Map(SCORES.map(t=>[t.id,t]));
  const compiled = new Map();
  const clamp = (n,a,b)=>Math.max(a,Math.min(b,n));
  const frequency = midi => 440*Math.pow(2,(midi-69)/12);
  const degreeNote = (t,d,oct=0) => {
    const scale=SCALES[t.scale], step=Math.floor(d/scale.length);
    return t.root + scale[((d%scale.length)+scale.length)%scale.length] + step*12 + oct*12;
  };
  function compile(t) {
    if(compiled.has(t.id)) return compiled.get(t.id);
    const events=[];
    function note(beat,type,degree,duration,velocity,pan=0,octave=0) {
      if(degree===null) return;
      events.push({beat,type,midi:degreeNote(t,degree,octave),duration,velocity,pan});
    }
    function drum(beat,type,velocity) {events.push({beat,type,duration:.3,velocity,pan:type==='wood'?.22:-.08});}
    for(let bar=0;bar<t.bars;bar++) {
      const start=bar*t.beats,section=Math.floor(bar/8),chord=t.chords[bar%t.chords.length];
      const intro=section===0&&bar<4,ending=bar===t.bars-1;
      const theme=t.phrases[(bar + (section===2?2:0))%t.phrases.length];
      let beat=0;
      for(let i=0;i<theme.length;i++) {
        const [degree,duration]=theme[i];
        const shift=section===2&&bar%4<2?2:0;
        const actual=degree===null?null:degree+shift;
        const lead=intro?'pluck':(['market-breeze','army-banner','battle-storm','council-lantern'].includes(t.id)&&t.lead==='pluck'?'shamisen':t.lead);
        const volume=(intro?.34:.52)*(section===2?1.06:1);
        note(start+beat,lead,actual,duration*.88,volume,i%2===0?-.12:.1,lead==='bell'?0:0);
        // Deliberate answering phrase in B section; avoids identical loops.
        if(!intro&&degree!==null&&duration>=1&&i===0&&bar%4===3){note(start+beat-.08+0.12,lead,actual+1,.11,.24,-.1);}
        if(section===2&&duration>=1&&degree!==null&&i%2===0) {
          note(start+beat+.5,'pluck',degree-2,Math.min(.45,duration-.1),.22,.38,0);
        }
        beat+=duration;
      }
      note(start,'bass',chord,ending?3.7:2.5,.43,-.05,-2);
      if(t.style!=='sparse'&&bar%2===0)note(start+2,'bass',chord+3,1.65,.27,.05,-2);
      const patterns={
        sparse:[0,2.5],flow:[0,1.5,2,3.5],bounce:[0,.75,1.5,2,2.75,3.5],
        syncopated:[0,.75,1.5,2.5,3.25,3.75],march:[0,1,2,3],
        arpeggio:[0,.5,1,1.5,2,2.5,3,3.5],pulse:[0,1.5,2,3],
        drive:[0,.5,1,1.5,2,2.5,3,3.5],bright:[0,.5,1.5,2,2.5,3.5]
      };
      const pattern=patterns[t.style],harmony=[0,2,4,2,3,4,2,1];
      pattern.forEach((offset,index)=>{
        if(intro&&index%2) return;
        const deg=chord+harmony[(index+bar%2)%harmony.length];
        note(start+offset,((t.style==='drive'||t.style==='march')&&index%2===1)?'shamisen':'pluck',deg,.8+(.3*(bar%3)),.20*t.density,index%2?-.4:.3,-1);
      });
      // Sho-like sustained harmonies, alternating shamisen replies and koto glissandi.
      if(!intro&&bar%2===0){for(const [j,d] of [0,2,4].entries())note(start+.03*j,'sho',chord+d,6.8,.10*t.density,-.3+j*.3,-1);}
      if(!intro&&bar%4===1&&t.drums!=='none'){note(start+1.75,'shamisen',chord+5,.35,.19,-.42,0);note(start+2.5,'shamisen',chord+4,.45,.16,.38,0);}
      if(bar%8===7&&t.style!=='sparse'){for(let j=0;j<5;j++)note(start+3.35+j*.1,'pluck',chord+j,.38,.13+j*.015,-.5+j*.2,0);}
      if(!intro&&bar%8===0)note(start,'kane',chord+5,2,.17,.44,0);
      // Long quiet flute harmony expands only during the third eight-bar section.
      if(section===2&&bar%2===0&&t.lead!=='flute')note(start,'flute',chord+5,3.2,.15,-.28,0);
      if((section===1||section===3)&&bar%4===0&&t.style!=='drive')note(start+3,'bell',chord+5,1.3,.13,.4,0);
      if(t.drums!=='none'&&!intro) {
        const strength=t.drums==='battle'||t.drums==='siege'?.54:.34;
        drum(start,'taiko',strength);
        if(t.drums!=='pulse')drum(start+2,'taiko',strength*.72);
        if(['march','battle','siege'].includes(t.drums)) {
          drum(start+1,'wood',.23);drum(start+3,'wood',.27);
        }
        if(bar%2===1&&['march','battle','siege','light'].includes(t.drums)){drum(start+1.75,'tsuzumi',.18);drum(start+3.5,'tsuzumi',.23);}
        if(t.drums==='wood'||t.drums==='light') {
          drum(start+1.5,'wood',.15);drum(start+3.5,'wood',.12);
        }
        if(t.drums==='battle') {
          drum(start+.75,'hat',.15);drum(start+1.5,'hat',.14);drum(start+2.75,'hat',.15);drum(start+3.5,'wood',.24);
        }
        if(t.drums==='siege') {drum(start+2.5,'taiko',.3);drum(start+3.5,'hat',.15);}
        if(bar%8===7&&t.drums!=='light') {drum(start+3.25,'wood',.17);drum(start+3.75,'wood',.2);}
      }
    }
    events.sort((a,b)=>a.beat-b.beat);
    const result={events,secondsPerBeat:60/t.tempo,duration:t.bars*t.beats*60/t.tempo};
    compiled.set(t.id,result);return result;
  }

  class SengokuMusic {
    constructor({volume=10,onTrackChange=null}={}) {
      this._volume=clamp(Number(volume)||0,0,100);this._onTrackChange=onTrackChange;
      this._context=null;this._master=null;this._compressor=null;this._reverb=null;
      this._currentId=null;this._session=null;this._playing=false;this._auto=true;
      this._timer=null;this._pauseTimer=null;this._token=0;this._resumePosition=0;this._disposed=false;
      this._noise=null;this._pluckCache=new Map();this._sessions=new Set();
      this._audioElement=null;this._streamDestination=null;this._audioSession=null;
      this._previousSessionType=null;this._ownsAudioSession=false;this._outputToken=0;this._pageActive=true;
      this._visibilityHandler=()=>this._onVisibility();
      this._pageHideHandler=()=>{this._pageActive=false;this._clearScheduler();this._suspendOutput();};
      this._pageShowHandler=()=>{this._pageActive=true;return this._onVisibility();};
      this._contextStateHandler=()=>{
        if(this._context?.state==='running'&&this._playing&&!this._hidden())this._schedule();
        else this._clearScheduler();
      };
      this._audioSessionHandler=()=>{
        // Let the browser finish calls/other exclusive audio before resuming.
        // Repeated resume() calls here would steal audio focus back from it.
        if(this._audioSession?.state==='interrupted')this._clearScheduler();
        else if(this._audioSession?.state==='active'){if(this._playing)this._preparePlaybackSession();this._contextStateHandler();}
      };
      if(typeof document!=='undefined')document.addEventListener('visibilitychange',this._visibilityHandler);
      global.addEventListener?.('pagehide',this._pageHideHandler);
      global.addEventListener?.('pageshow',this._pageShowHandler);
    }
    get currentId(){return this._currentId;}
    get playing(){return this._playing;}
    get auto(){return this._auto;}
    get volume(){return this._volume;}
    setAuto(value){this._auto=Boolean(value);}
    setVolume(value){
      this._volume=clamp(Number(value)||0,0,100);
      if(this._context&&this._master)this._smoothGain(this._master.gain,this._playing?this._volume/100*.65:0,.08);
      if(!this._playing||!this._context)return;
      if(!this._volume){this._clearScheduler();this._suspendOutput();}
      else if(!this._hidden())this._resumeOutput().then(ok=>{if(ok)this._schedule();}).catch(()=>{});
    }
    _hidden(){return !this._pageActive||(typeof document!=='undefined'&&document.hidden);}
    _smoothGain(param,value,time){
      const now=this._context.currentTime;
      if(typeof param.cancelAndHoldAtTime==='function')param.cancelAndHoldAtTime(now);
      else {param.cancelScheduledValues(now);param.setValueAtTime(param.value,now);}
      param.linearRampToValueAtTime(value,now+time);
    }
    _preparePlaybackSession(){
      // A Web Audio context defaults to ambient on iOS. Music is playback:
      // this category permits sound with the Ring/Silent switch on supported
      // browsers, while still respecting system volume and autoplay policy.
      try {
        const session=global.navigator?.audioSession;
        if(!session||typeof session.type!=='string')return false;
        if(this._audioSession!==session){
          this._audioSession?.removeEventListener?.('statechange',this._audioSessionHandler);
          this._audioSession=session;
          session.addEventListener?.('statechange',this._audioSessionHandler);
        }
        if(this._volume>0&&!this._hidden()&&!this._ownsAudioSession&&session.state!=='interrupted'){
          const previous=session.type;
          session.type='playback';
          if(session.type!=='playback')return false;
          this._previousSessionType=previous;this._ownsAudioSession=true;
        }
        return true;
      } catch(_){return false;}
    }
    _releasePlaybackSession(){
      if(!this._ownsAudioSession)return;
      this._ownsAudioSession=false;
      try {if(this._audioSession?.type==='playback')this._audioSession.type=this._previousSessionType||'auto';}catch(_){}
      this._previousSessionType=null;
    }
    _connectOutput(ctx){
      if(this._preparePlaybackSession()){this._master.connect(ctx.destination);return;}
      // Older browsers can use a media playback sink for the actual score.
      // There is no silent unlock file, microphone capture or duplicate output.
      if(typeof ctx.createMediaStreamDestination==='function'&&global.document?.createElement){
        let sink,element;
        try {
          element=global.document.createElement('audio');
          if(!('srcObject' in element))throw new Error('MediaStream playback unavailable');
          sink=ctx.createMediaStreamDestination();element.srcObject=sink.stream;
          element.autoplay=false;element.controls=false;element.preload='none';
          element.setAttribute('playsinline','');element.setAttribute('webkit-playsinline','');
          this._master.connect(sink);this._streamDestination=sink;this._audioElement=element;
          return;
        } catch(_){
          try {element?.pause();if(element)element.srcObject=null;sink?.disconnect();}catch(_){}
          for(const track of sink?.stream?.getTracks?.()||[])track.stop();
        }
      }
      this._master.connect(ctx.destination);
    }
    async _resumeOutput(){
      const token=++this._outputToken;
      if(this._disposed||!this._context||this._hidden()||!this._volume)return false;
      this._preparePlaybackSession();
      if(this._audioSession?.state==='interrupted')return false;
      // Invoke both before the first await, in the initiating tap/click.
      // A media play() delayed until after resume() can lose user activation.
      try {
        const resume=this._context.resume();
        let play;try {play=this._audioElement?.play();}catch(error){play=Promise.reject(error);}
        await Promise.all([resume,play]);
        if(token!==this._outputToken||this._disposed||this._hidden()||!this._volume)return false;
        return true;
      } catch(error){
        if(token!==this._outputToken||this._disposed)return false;
        this._clearScheduler();this._suspendOutput();throw error;
      }
    }
    _suspendOutput(){
      ++this._outputToken;
      try {this._audioElement?.pause();}catch(_){}
      this._releasePlaybackSession();
      return this._context?.suspend().catch(()=>{});
    }
    _ensureContext(){
      if(this._context)return;
      const AC=global.AudioContext||global.webkitAudioContext;
      if(!AC)throw new Error('このブラウザではWeb Audioを利用できません。');
      const ctx=this._context=new AC({latencyHint:'playback'});
      ctx.addEventListener?.('statechange',this._contextStateHandler);
      this._master=ctx.createGain();this._master.gain.value=0;
      this._compressor=ctx.createDynamicsCompressor();
      this._compressor.threshold.value=-18;this._compressor.knee.value=14;
      this._compressor.ratio.value=3;this._compressor.attack.value=.012;this._compressor.release.value=.25;
      this._compressor.connect(this._master);this._connectOutput(ctx);
      this._reverb=ctx.createConvolver();
      const impulse=ctx.createBuffer(2,Math.ceil(ctx.sampleRate*1.25),ctx.sampleRate);
      let seed=6289;
      for(let channel=0;channel<2;channel++) {
        const data=impulse.getChannelData(channel);
        for(let i=0;i<data.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;data[i]=((seed/4294967296)*2-1)*Math.pow(1-i/data.length,3)*.36;}
      }
      this._reverb.buffer=impulse;
      const wet=ctx.createGain();wet.gain.value=.17;this._reverb.connect(wet);wet.connect(this._compressor);this._wet=wet;
      this._noise=ctx.createBuffer(1,Math.ceil(ctx.sampleRate),ctx.sampleRate);
      const data=this._noise.getChannelData(0);seed=9127;
      for(let i=0;i<data.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;data[i]=((seed/4294967296)*2-1);}
    }
    async play(id=this._currentId||TRACKS[0].id){
      if(this._disposed)throw new Error('Music player has been disposed.');
      if(!byId.has(id))throw new RangeError(`Unknown music track: ${id}`);
      if(this._playing&&this._currentId===id){
        const token=this._token;
        try {if(await this._resumeOutput())this._schedule();}
        catch(error){if(token!==this._token||this._disposed)return;this.pause();throw error;}
        return;
      }
      const token=++this._token;
      clearTimeout(this._pauseTimer);this._pauseTimer=null;
      this._ensureContext();
      try {if(!this._hidden()&&this._volume)await this._resumeOutput();}
      catch(error){if(token!==this._token||this._disposed)return;this.pause();throw error;}
      if(token!==this._token||this._disposed)return;
      this._clearScheduler();
      const same=id===this._currentId,position=same?this._resumePosition:0;
      this._retire(this._session,.25);
      this._currentId=id;this._playing=true;this._resumePosition=0;
      const score=compile(byId.get(id)),ctx=this._context;
      const bus=ctx.createGain();bus.gain.value=0;bus.connect(this._compressor);bus.connect(this._reverb);
      const session={bus,score,voices:new Set(),active:true,start:ctx.currentTime+.055-position,eventIndex:0,cycle:0};
      while(session.eventIndex<score.events.length&&score.events[session.eventIndex].beat*score.secondsPerBeat<position)session.eventIndex++;
      this._session=session;this._sessions.add(session);
      bus.gain.linearRampToValueAtTime(1,ctx.currentTime+.25);
      this._smoothGain(this._master.gain,this._volume/100*.65,.1);
      if(!this._hidden()&&this._volume)this._schedule();
      else await this._suspendOutput();
      if(typeof this._onTrackChange==='function')this._onTrackChange(TRACKS.find(t=>t.id===id));
    }
    pause(){
      ++this._token;this._playing=false;this._clearScheduler();
      clearTimeout(this._pauseTimer);this._pauseTimer=null;
      const ctx=this._context;if(!ctx)return;
      if(this._session)this._resumePosition=Math.max(0,(ctx.currentTime-this._session.start)%this._session.score.duration);
      this._retire(this._session,.25);this._session=null;
      this._smoothGain(this._master.gain,0,.25);
      if(this._hidden()){this._suspendOutput();return;}
      // Pause the playback sink now, and release the category after the short
      // Web Audio fade. This also cancels a pending media play() promptly.
      ++this._outputToken;try {this._audioElement?.pause();}catch(_){}
      this._pauseTimer=setTimeout(()=>{this._pauseTimer=null;if(!this._playing&&!this._disposed)this._suspendOutput();},280);
    }
    _clearScheduler(){clearTimeout(this._timer);this._timer=null;}
    async _onVisibility(){
      if(!this._context||this._disposed)return;
      if(this._hidden()) {
        this._clearScheduler();clearTimeout(this._pauseTimer);this._pauseTimer=null;
        await this._suspendOutput();
      } else if(this._playing) {
        const token=this._token;
        try {const ok=await this._resumeOutput();if(ok&&token===this._token&&this._playing&&!this._hidden())this._schedule();}
        catch(_){if(token===this._token)this._clearScheduler();}
      }
    }
    _schedule(){
      this._clearScheduler();
      if(!this._playing||!this._volume||this._hidden()||this._disposed||!this._session||this._context?.state!=='running'||this._audioSession?.state==='interrupted')return;
      const s=this._session,ctx=this._context,horizon=ctx.currentTime+.18,events=s.score.events;
      let guard=0;
      while(guard++<512) {
        if(s.eventIndex>=events.length){s.eventIndex=0;s.cycle++;}
        const event=events[s.eventIndex],time=s.start+s.cycle*s.score.duration+event.beat*s.score.secondsPerBeat;
        if(time>horizon)break;
        if(time>=ctx.currentTime-.025)this._voice(s,event,Math.max(time,ctx.currentTime+.003),event.duration*s.score.secondsPerBeat);
        s.eventIndex++;
      }
      this._timer=setTimeout(()=>this._schedule(),50);
    }
    _retire(session,fade){
      if(!session||!session.active)return;
      session.active=false;this._smoothGain(session.bus.gain,0,fade);
      const stop=this._context.currentTime+fade+.025;
      for(const voice of session.voices)for(const source of voice.sources){try{source.stop(stop);}catch(_){}}
      if(!session.voices.size){session.bus.disconnect();this._sessions.delete(session);}
    }
    _pluckBuffer(midi,kind='pluck'){
      const key=kind+':'+Math.round(midi*100);if(this._pluckCache.has(key))return this._pluckCache.get(key);
      const ctx=this._context,rate=ctx.sampleRate,hz=frequency(midi),length=Math.ceil(rate*(kind==='shamisen'?1.7:2.2));
      const buffer=ctx.createBuffer(1,length,rate),out=buffer.getChannelData(0);
      const size=Math.max(4,Math.round(rate/hz)),ring=new Float32Array(size);
      let seed=(Math.round(midi*100)*7919+(kind==='shamisen'?73:23))>>>0;
      for(let i=0;i<size;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;ring[i]=(seed/4294967296*2-1)*(kind==='shamisen'?.85:.65);}
      let at=0;
      for(let i=0;i<length;i++) {
        const value=ring[at],next=ring[(at+1)%size];
        ring[at]=(kind==='shamisen'?.493:.497)*(value+next);at=(at+1)%size;
        const sawari=kind==='shamisen'?Math.sin(i/rate*hz*3)*Math.exp(-i/(rate*.07))*.12:0;
        out[i]=(value+sawari)*Math.min(1,i/(rate*.004));
      }
      if(this._pluckCache.size>=64)this._pluckCache.delete(this._pluckCache.keys().next().value);
      this._pluckCache.set(key,buffer);return buffer;
    }
    _voice(session,event,time,duration){
      const ctx=this._context,sources=[],nodes=[],end=Math.max(.08,Math.min(4,duration));
      const envelope=ctx.createGain();nodes.push(envelope);envelope.gain.value=0;
      const pan=ctx.createStereoPanner?ctx.createStereoPanner():ctx.createGain();
      if(pan.pan)pan.pan.value=clamp(event.pan||0,-1,1);nodes.push(pan);envelope.connect(pan);pan.connect(session.bus);
      let actualEnd=end+.12;
      const velocity=clamp(event.velocity||.3,0,1);
      const addOsc=(type,hz,gain=1)=>{
        const osc=ctx.createOscillator();osc.type=type;osc.frequency.setValueAtTime(hz,time);
        if(gain!==1){const g=ctx.createGain();g.gain.value=gain;nodes.push(g);osc.connect(g);g.connect(envelope);}else osc.connect(envelope);
        sources.push(osc);return osc;
      };
      if(event.type==='pluck'||event.type==='shamisen') {
        const source=ctx.createBufferSource();source.buffer=this._pluckBuffer(event.midi,event.type);source.connect(envelope);sources.push(source);
        envelope.gain.setValueAtTime(0,time);envelope.gain.linearRampToValueAtTime(velocity*(event.type==='shamisen'?.48:.58),time+.004);
        envelope.gain.exponentialRampToValueAtTime(.0001,time+Math.min(2.4,end+.7));actualEnd=Math.min(2.5,end+.8);
      } else if(event.type==='flute') {
        const hz=frequency(event.midi),osc=addOsc('sine',hz);addOsc('sine',hz*2,.12);addOsc('sine',hz*3,.035);
        const breath=ctx.createBufferSource(),breathFilter=ctx.createBiquadFilter(),breathGain=ctx.createGain();breath.buffer=this._noise;breath.loop=true;breathFilter.type='bandpass';breathFilter.frequency.value=hz*3;breathGain.gain.value=.035;breath.connect(breathFilter);breathFilter.connect(breathGain);breathGain.connect(envelope);sources.push(breath);nodes.push(breathFilter,breathGain);
        // A small oscillator bend approximates breath without samples or harsh noise.
        osc.frequency.linearRampToValueAtTime(hz*1.002,time+.16);
        osc.frequency.linearRampToValueAtTime(hz*.998,time+Math.max(.2,end*.6));
        envelope.gain.setValueAtTime(0,time);envelope.gain.linearRampToValueAtTime(velocity*.16,time+.075);
        envelope.gain.setValueAtTime(velocity*.14,time+Math.max(.08,end-.12));envelope.gain.linearRampToValueAtTime(0,time+end+.15);actualEnd=end+.18;
      } else if(event.type==='sho') {
        const hz=frequency(event.midi);addOsc('sine',hz);addOsc('triangle',hz*2,.22);
        envelope.gain.setValueAtTime(0,time);envelope.gain.linearRampToValueAtTime(velocity*.19,time+.3);
        envelope.gain.setValueAtTime(velocity*.16,time+Math.max(.31,end-.3));envelope.gain.linearRampToValueAtTime(0,time+end+.4);actualEnd=end+.43;
      } else if(event.type==='kane') {
        const hz=frequency(event.midi)*2;addOsc('sine',hz);addOsc('sine',hz*2.756,.19);addOsc('sine',hz*5.404,.045);
        envelope.gain.setValueAtTime(.0001,time);envelope.gain.linearRampToValueAtTime(velocity*.10,time+.003);envelope.gain.exponentialRampToValueAtTime(.0001,time+2.8);actualEnd=2.85;
      } else if(event.type==='tsuzumi') {
        const drum=addOsc('sine',260);drum.frequency.exponentialRampToValueAtTime(170,time+.045);drum.frequency.exponentialRampToValueAtTime(230,time+.13);
        addOsc('sine',515,.11);envelope.gain.setValueAtTime(.0001,time);envelope.gain.linearRampToValueAtTime(velocity*.27,time+.003);envelope.gain.exponentialRampToValueAtTime(.0001,time+.21);actualEnd=.23;
      } else if(event.type==='bell') {
        const hz=frequency(event.midi);addOsc('sine',hz);addOsc('sine',hz*2.01,.20);addOsc('sine',hz*3.98,.045);
        envelope.gain.setValueAtTime(.0001,time);envelope.gain.linearRampToValueAtTime(velocity*.16,time+.008);
        envelope.gain.exponentialRampToValueAtTime(.0001,time+end+1);actualEnd=end+1.05;
      } else if(event.type==='bass') {
        addOsc('sine',frequency(event.midi));addOsc('triangle',frequency(event.midi)*2,.09);
        envelope.gain.setValueAtTime(0,time);envelope.gain.linearRampToValueAtTime(velocity*.25,time+.03);
        envelope.gain.exponentialRampToValueAtTime(.0001,time+end);actualEnd=end+.04;
      } else if(event.type==='taiko') {
        const drum=addOsc('sine',105);drum.frequency.exponentialRampToValueAtTime(45,time+.22);
        envelope.gain.setValueAtTime(.0001,time);envelope.gain.linearRampToValueAtTime(velocity*.31,time+.006);
        envelope.gain.exponentialRampToValueAtTime(.0001,time+.55);actualEnd=.58;
      } else if(event.type==='wood') {
        const osc=addOsc('sine',680);osc.frequency.exponentialRampToValueAtTime(410,time+.04);addOsc('sine',980,.23);
        envelope.gain.setValueAtTime(.0001,time);envelope.gain.linearRampToValueAtTime(velocity*.18,time+.002);
        envelope.gain.exponentialRampToValueAtTime(.0001,time+.075);actualEnd=.085;
      } else {
        const source=ctx.createBufferSource(),filter=ctx.createBiquadFilter();source.buffer=this._noise;
        filter.type='highpass';filter.frequency.value=4300;nodes.push(filter);source.connect(filter);filter.connect(envelope);sources.push(source);
        envelope.gain.setValueAtTime(velocity*.045,time);envelope.gain.exponentialRampToValueAtTime(.0001,time+.07);actualEnd=.08;
      }
      const voice={sources,nodes};session.voices.add(voice);let remaining=sources.length;
      for(const source of sources) {
        source.onended=()=>{
          if(--remaining>0)return;
          for(const node of [...sources,...nodes]){try{node.disconnect();}catch(_){}}
          session.voices.delete(voice);
          if(!session.active&&!session.voices.size){try{session.bus.disconnect();}catch(_){}this._sessions.delete(session);}
        };
        source.start(time);source.stop(time+actualEnd);
      }
    }
    playEffect(type='confirm') {
      // Effects use only an already user-started music context; never unlock audio.
      if(!this._playing||!this._context||this._hidden()||!this._session)return;
      const t=this._context.currentTime+.005;
      const notes=type==='victory'?[72,76,79]:type==='error'?[55,53]:[74,79];
      notes.forEach((midi,i)=>this._voice(this._session,{type:'bell',midi,velocity:.17,pan:0},t+i*.075,.12));
    }
    async dispose(){
      if(this._disposed)return;this._disposed=true;++this._token;this._playing=false;
      this._clearScheduler();clearTimeout(this._pauseTimer);this._pauseTimer=null;
      if(typeof document!=='undefined')document.removeEventListener('visibilitychange',this._visibilityHandler);
      global.removeEventListener?.('pagehide',this._pageHideHandler);
      global.removeEventListener?.('pageshow',this._pageShowHandler);
      this._audioSession?.removeEventListener?.('statechange',this._audioSessionHandler);
      this._releasePlaybackSession();++this._outputToken;
      if(this._audioElement){this._audioElement.pause();this._audioElement.srcObject=null;this._audioElement=null;}
      for(const track of this._streamDestination?.stream?.getTracks?.()||[])track.stop();
      this._streamDestination?.disconnect();this._streamDestination=null;
      if(this._context){this._context.removeEventListener?.('statechange',this._contextStateHandler);for(const s of this._sessions)this._retire(s,0);await this._context.close().catch(()=>{});}
      this._sessions.clear();this._pluckCache.clear();this._session=null;
    }
    // Read-only score summaries permit deterministic integrity checks without audio.
    static inspect(id){
      const t=byId.get(id);if(!t)throw new RangeError('Unknown track');const s=compile(t);
      return {id,duration:s.duration,eventCount:s.events.length,events:s.events.map(e=>({...e}))};
    }
  }
  global.SENGOKU_MUSIC_TRACKS=TRACKS;
  global.SengokuMusic=SengokuMusic;
})(typeof window!=='undefined'?window:globalThis);
