/* 戦国VS: 16 original orchestral scores with synthesized Japanese instruments. No samples, quotations, or external dependencies. */
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
      description:'尺八を思わせる笛の主題を琴と弦が包み、朝の城下から大らかな合奏へ広がる。',
      phrases:[[[0,1],[2,.5],[3,.5],[4,1],[2,1]],[[1,.5],[2,.5],[3,1],[1,1],[null,1]],[[0,.5],[1,.5],[2,1],[5,1],[4,1]],[[3,1],[2,.5],[1,.5],[0,2]]]},
    {id:'castle-evening',name:'夕映えの天守',scene:'town',tempo:72,root:57,scale:'hira',bars:32,beats:4,
      chords:[0,2,4,1,0,3,2,0],style:'sparse',lead:'flute',density:.5,drums:'none',
      description:'余韻を残す琴と息遣いのある笛。薄い弦と合唱音色が夕暮れの城郭に重なる。',
      phrases:[[[4,1.5],[2,.5],[1,1],[null,1]],[[0,2],[2,1],[3,1]],[[5,1],[4,.5],[3,.5],[2,1.5],[null,.5]],[[1,1],[0,3]]]},
    {id:'fields-green',name:'豊穣の風',scene:'town',tempo:92,root:60,scale:'major',bars:32,beats:4,
      chords:[0,3,4,1,2,3,4,0],style:'bounce',lead:'pluck',density:.9,drums:'light',
      description:'跳ねる琴に鼓と伸びやかな弦が応える、豊かな実りを祝う軽快な主題。',
      phrases:[[[0,.5],[2,.5],[4,1],[3,.5],[2,.5],[1,1]],[[2,.5],[3,.5],[5,.5],[4,.5],[2,1],[null,1]],[[1,.5],[2,.5],[3,1],[4,.5],[5,.5],[3,1]],[[2,1],[1,.5],[2,.5],[0,1.5],[null,.5]]]},
    {id:'market-breeze',name:'楽市のにぎわい',scene:'town',tempo:104,root:65,scale:'yo',bars:32,beats:4,
      chords:[0,4,2,3,1,4,3,0],style:'syncopated',lead:'pluck',density:1,drums:'wood',
      description:'細やかな琴と三味線、左右に交わす木音。楽市の活気から華やかな合奏へ。',
      phrases:[[[2,.5],[null,.5],[3,.5],[4,.5],[5,1],[3,1]],[[4,.5],[2,.5],[1,.5],[null,.5],[2,.5],[3,.5],[0,1]],[[3,.5],[4,.5],[6,1],[5,.5],[4,.5],[2,1]],[[1,.5],[3,.5],[2,1],[0,1],[null,1]]]},
    {id:'world-march',name:'山河を越えて',scene:'world',tempo:96,root:55,scale:'minor',bars:32,beats:4,
      chords:[0,3,2,4,0,1,4,0],style:'march',lead:'flute',density:.9,drums:'march',
      description:'重太鼓の歩みに笛と弦が広がり、山河の先で金管が高らかに応える行軍曲。',
      phrases:[[[0,1],[0,.5],[2,.5],[3,1],[5,1]],[[4,1],[3,.5],[2,.5],[1,1],[null,1]],[[2,1],[3,.5],[4,.5],[5,1],[7,1]],[[5,1],[3,1],[2,.5],[1,.5],[0,1]]]},
    {id:'mountain-road',name:'霧深き峠',scene:'world',tempo:78,root:62,scale:'in',bars:32,beats:4,
      chords:[0,1,3,4,2,1,4,0],style:'sparse',lead:'flute',density:.6,drums:'pulse',
      description:'低い弦、遠い鼓、霧を分ける笛。静寂と広がりが交差する峠の調べ。',
      phrases:[[[0,1.5],[1,.5],[3,1],[null,1]],[[4,1],[3,.5],[1,.5],[0,1],[null,1]],[[2,.5],[3,.5],[4,1.5],[6,.5],[5,1]],[[3,1],[1,1],[0,2]]]},
    {id:'officers-oath',name:'武士の誓い',scene:'officers',tempo:88,root:60,scale:'minor',bars:32,beats:4,
      chords:[0,2,3,4,1,3,4,0],style:'arpeggio',lead:'flute',density:.8,drums:'light',
      description:'琴と凛とした笛の誓いを厚い弦が受け継ぎ、英傑の志を大きく描く。',
      phrases:[[[3,1],[2,.5],[0,.5],[2,1],[4,1]],[[5,1.5],[4,.5],[3,1],[null,1]],[[2,.5],[3,.5],[5,1],[6,.5],[5,.5],[4,1]],[[3,1],[1,1],[0,1.5],[null,.5]]]},
    {id:'council-lantern',name:'軍議の灯',scene:'chronicle',tempo:82,root:57,scale:'hira',bars:32,beats:4,
      chords:[0,4,1,3,2,4,1,0],style:'pulse',lead:'pluck',density:.65,drums:'wood',
      description:'低弦の反復、三味線の問い、笛の応答。夜の軍議に緊張と奥行きを添える。',
      phrases:[[[0,.5],[null,.5],[2,1],[1,.5],[0,.5],[3,1]],[[4,1],[2,1],[1,.5],[null,.5],[0,1]],[[1,.5],[2,.5],[4,1],[5,.5],[4,.5],[3,1]],[[2,1.5],[1,.5],[0,2]]]},
    {id:'army-banner',name:'旗印のもとに',scene:'army',tempo:108,root:55,scale:'yo',bars:32,beats:4,
      chords:[0,3,4,2,0,4,1,0],style:'march',lead:'pluck',density:1,drums:'march',
      description:'三味線と弦の刻みに大太鼓と金管が集結する、勇壮な軍団の行進。',
      phrases:[[[0,.5],[0,.5],[3,1],[4,.5],[3,.5],[5,1]],[[2,.5],[3,.5],[4,1],[2,1],[0,1]],[[3,.5],[3,.5],[5,1],[7,.5],[6,.5],[5,1]],[[4,1],[3,.5],[2,.5],[0,1],[null,1]]]},
    {id:'research-stars',name:'星読みの書',scene:'research',tempo:76,root:64,scale:'major',bars:32,beats:4,
      chords:[0,2,1,4,3,2,4,0],style:'arpeggio',lead:'bell',density:.7,drums:'none',
      description:'澄んだ鐘と琴の糸から、弦と合唱音色が星空のように開く探究の曲。',
      phrases:[[[2,1],[4,.5],[5,.5],[7,1],[4,1]],[[3,1.5],[1,.5],[2,1],[null,1]],[[4,.5],[5,.5],[7,1],[6,1],[3,1]],[[2,1],[1,1],[0,2]]]},
    {id:'battle-storm',name:'烈風の陣',scene:'battle',tempo:116,root:57,scale:'minor',bars:32,beats:4,
      chords:[0,4,3,2,0,3,1,4],style:'drive',lead:'pluck',density:1,drums:'battle',
      description:'疾走する三味線に重太鼓と金管が応え、静寂を挟んで烈しい大合奏へ踏み込む。',
      phrases:[[[0,.5],[2,.5],[3,.5],[2,.5],[5,.5],[4,.5],[3,1]],[[4,.5],[5,.5],[7,1],[5,.5],[4,.5],[2,1]],[[3,.5],[4,.5],[5,.5],[7,.5],[8,1],[5,1]],[[4,.5],[3,.5],[2,.5],[1,.5],[0,1],[null,1]]]},
    {id:'battle-siege',name:'城門を衝く',scene:'battle',tempo:100,root:50,scale:'hira',bars:32,beats:4,
      chords:[0,1,4,3,0,2,1,4],style:'drive',lead:'flute',density:1,drums:'siege',
      description:'低く轟く大太鼓、うねる弦、重厚な金管。城門へ迫る緊張を段階的に高める。',
      phrases:[[[0,1],[2,.5],[1,.5],[0,1],[3,1]],[[4,1],[5,.5],[4,.5],[2,1],[null,1]],[[3,.5],[4,.5],[6,1],[5,.5],[3,.5],[4,1]],[[2,1],[1,.5],[0,.5],[0,2]]]},
    {id:'victory-horizon',name:'勝鬨、空高く',scene:'victory',tempo:106,root:62,scale:'major',bars:32,beats:4,
      chords:[0,3,2,4,1,3,4,0],style:'bright',lead:'flute',density:.95,drums:'march',
      description:'上昇する笛と祝祭の琴を、金管と弦と合唱音色がたたえる晴れやかな勝鬨。',
      phrases:[[[0,.5],[2,.5],[4,1],[5,1],[7,1]],[[6,1],[5,.5],[4,.5],[3,1],[null,1]],[[4,.5],[5,.5],[7,1],[9,.5],[8,.5],[7,1]],[[5,1],[4,.5],[2,.5],[0,2]]]},
    {id:'defeat-moon',name:'月下の再起',scene:'defeat',tempo:68,root:57,scale:'in',bars:32,beats:4,
      chords:[0,3,1,4,2,1,3,0],style:'sparse',lead:'flute',density:.4,drums:'none',
      description:'途切れる笛と静かな琴から、低弦と柔らかな合唱音色へ。敗戦を越える夜の誓い。',
      phrases:[[[4,1.5],[3,.5],[1,1],[null,1]],[[2,2],[0,1],[null,1]],[[1,1],[3,1],[4,1.5],[null,.5]],[[2,1],[1,1],[0,2]]]},
    {id:'winter-silence',name:'雪待つ山里',scene:'town',tempo:70,root:65,scale:'hira',bars:32,beats:4,
      chords:[0,2,4,3,1,4,2,0],style:'sparse',lead:'bell',density:.45,drums:'none',
      description:'雪のように落ちる鐘、淡い弦の重なり。余白を大切にした冬の城下の調べ。',
      phrases:[[[5,1],[4,1],[2,1.5],[null,.5]],[[3,1],[1,1],[0,1],[null,1]],[[4,1.5],[5,.5],[3,1],[1,1]],[[2,2],[0,2]]]},
    {id:'unification',name:'天下、一つの空',scene:'menu',tempo:90,root:60,scale:'yo',bars:32,beats:4,
      chords:[0,3,1,4,2,3,4,0],style:'bright',lead:'flute',density:1,drums:'light',
      description:'琴と笛の主題を弦と金管と合唱音色が受け継ぐ、統一された山河の大らかな終曲。',
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
  // These sections are composed into the score, not produced by changing volume.
  // The middle break removes the rhythmic bed; the theme returns in a wider
  // register before a distinct climax and a tonic cadence back into the loop.
  const FORM = Object.freeze([
    {id:'intro',name:'序奏',startBar:0,endBar:4,energy:.48},
    {id:'build',name:'高まり',startBar:4,endBar:8,energy:.68},
    {id:'theme',name:'主題',startBar:8,endBar:16,energy:.88},
    {id:'break',name:'静寂',startBar:16,endBar:20,energy:.40},
    {id:'rise',name:'再起',startBar:20,endBar:24,energy:.80},
    {id:'climax',name:'大合奏',startBar:24,endBar:30,energy:1.08},
    {id:'coda',name:'結び',startBar:30,endBar:32,energy:.63}
  ].map(section=>Object.freeze(section)));
  const VOICE_LIMIT=40, SOURCE_LIMIT=88;
  const SOURCE_COST=Object.freeze({pluck:1,shamisen:1,flute:4,sho:2,strings:2,brass:2,choir:2,kane:3,tsuzumi:2,bell:3,bass:2,taiko:3,odaiko:3,wood:2,cymbal:1,hat:1});
  const PART_PRIORITY=Object.freeze({lead:9,bass:8,percussion:7,answer:6,harmony:4,ostinato:3,ornament:2,effect:10});
  const ROOM_SEND=Object.freeze({pluck:.34,shamisen:.22,flute:.52,sho:.66,strings:.48,brass:.35,choir:.70,kane:.40,tsuzumi:.16,bell:.46,bass:.08,taiko:.16,odaiko:.22,wood:.14,cymbal:.27,hat:.10});
  function voiceLifetime(type,duration){
    const end=clamp(duration,.08,6);
    return ({pluck:Math.min(2.5,end+.8),shamisen:Math.min(1.95,end+.55),flute:end+.2,sho:end+.43,strings:end+.31,brass:end+.19,choir:end+.58,kane:2.85,tsuzumi:.25,bell:end+1.05,bass:end+.06,taiko:.93,odaiko:1.67,wood:.10,cymbal:2.8,hat:.09})[type]||.09;
  }
  function scorePeak(events,secondsPerBeat,duration){
    const edges=[];
    // Include the preceding loop's releases at the new introduction.
    for(const cycle of [-1,0])for(const event of events){const at=cycle*duration+event.beat*secondsPerBeat,cost=SOURCE_COST[event.type]||1;edges.push({at,voices:1,sources:cost},{at:at+voiceLifetime(event.type,event.duration*secondsPerBeat),voices:-1,sources:-cost});}
    edges.sort((a,b)=>a.at-b.at||a.voices-b.voices);
    let voices=0,sources=0,maxVoices=0,maxSources=0;
    for(const edge of edges){voices+=edge.voices;sources+=edge.sources;if(edge.at>=0&&edge.at<duration){maxVoices=Math.max(maxVoices,voices);maxSources=Math.max(maxSources,sources);}}
    return{voices:maxVoices,sources:maxSources};
  }
  function compile(t) {
    if(compiled.has(t.id)) return compiled.get(t.id);
    const events=[],energetic=['battle','army','victory'].includes(t.scene),quiet=t.style==='sparse',siege=t.drums==='siege';
    let section=FORM[0];
    function pitch(beat,type,midi,duration,velocity,pan=0,part='harmony'){
      if(midi===null||beat<0||beat>=t.bars*t.beats)return;
      events.push({beat,type,midi,duration,velocity:clamp(velocity,0,.92),pan,part,priority:PART_PRIORITY[part],section:section.id});
    }
    function note(beat,type,degree,duration,velocity,pan=0,octave=0,part='harmony'){
      if(degree!==null)pitch(beat,type,degreeNote(t,degree,octave),duration,velocity,pan,part);
    }
    function drum(beat,type,velocity,pan=0){
      if(beat>=t.bars*t.beats)return;
      events.push({beat,type,duration:.3,velocity:clamp(velocity,0,.92),pan,part:'percussion',priority:PART_PRIORITY.percussion,section:section.id});
    }
    const patterns={sparse:[0,2.5],flow:[0,.75,1.5,2.5,3.5],bounce:[0,.75,1.5,2,2.75,3.5],syncopated:[0,.75,1.5,2.5,3.25,3.75],march:[0,.5,1,2,2.5,3],arpeggio:[0,.5,1,1.5,2,2.5,3,3.5],pulse:[0,1.5,2,3],drive:[0,.5,1,1.5,2,2.5,3,3.5],bright:[0,.5,1.5,2,2.5,3.5]};
    const chordSteps=[0,2,4,2,3,4,2,1];
    for(let bar=0;bar<t.bars;bar++){
      section=FORM.find(row=>bar>=row.startBar&&bar<row.endBar);
      const start=bar*t.beats,local=bar-section.startBar,energy=section.energy;
      const intro=section.id==='intro',breakdown=section.id==='break',climax=section.id==='climax',rise=section.id==='rise',coda=section.id==='coda';
      const chord=bar===31?0:t.chords[bar%t.chords.length],root=degreeNote(t,chord,-1),fifth=root+7;
      const theme=bar===31?[[2,1],[1,1],[0,2]]:t.phrases[(bar+(rise?2:0))%t.phrases.length];
      const lead=breakdown?(t.lead==='bell'?'bell':'flute'):(t.lead==='pluck'?'shamisen':t.lead);
      let beat=0;
      for(let i=0;i<theme.length;i++){
        const [degree,duration]=theme[i],omit=intro&&(i>1||bar%2===1&&i===1)||breakdown&&i%2===1;
        const lift=climax&&energetic&&bar%4<2?5:0;
        if(!omit)note(start+beat,lead,degree===null?null:degree+lift,Math.max(.16,duration*(breakdown?.98:.85)),(.46+(!intro&&climax?.07:0))*energy,lead==='shamisen'?-.13:.10,0,'lead');
        // The counter-line answers a held note, rather than doubling every note.
        if((climax||section.id==='theme'&&bar%4===3)&&degree!==null&&duration>=1&&i===0){
          const answer=energetic?'brass':'strings';
          note(start+beat+.5,answer,degree+2,Math.min(1.25,duration),.25*energy,-.28,-1,'answer');
        }
        if(rise&&local>=2&&degree!==null&&i===0)note(start+beat+.12,'pluck',degree+1,.13,.22,.36,0,'ornament');
        beat+=duration;
      }
      // Root and fifth remain open beneath the Japanese melodic modes.
      if(!breakdown||bar%2===0)note(start,'bass',chord,quiet||breakdown?3.5:1.8,.43*energy,0,-2,'bass');
      if(!intro&&!breakdown&&!coda&&!quiet)note(start+2,'bass',chord+(bar%2?0:3),1.7,.31*energy,0,-2,'bass');
      const pattern=intro?[0,2]:breakdown?[0,2.5]:patterns[t.style];
      pattern.forEach((offset,index)=>{
        if(coda&&bar===31&&offset>2)return;
        const degree=chord+chordSteps[(index+(bar%2))%chordSteps.length];
        const instrument=energetic&&!intro&&!breakdown&&index%2?'shamisen':'pluck';
        note(start+offset,instrument,degree,quiet?1.1:.64,.25*t.density*energy,index%2?-.43:.34,-1,'ostinato');
      });
      // Long bowed voicings enter gradually, with a separate breath in the break.
      if((!intro||bar===2)&&bar%2===0){
        const length=(coda?3.45:breakdown?5.2:6.7);
        pitch(start+.018,'strings',root,length,.22*energy,-.38,'harmony');
        if(!breakdown)pitch(start+.05,'strings',fifth,length,.18*energy,.35,'harmony');
      }
      // A soft human-vowel texture belongs to the expansive, reflective scenes.
      if((breakdown&&bar===16)||(climax&&bar%2===0)||t.scene==='menu'&&section.id==='theme'&&bar%4===0){
        pitch(start+.08,'choir',root+12,breakdown?6.4:3.1,(quiet?.16:.21)*energy,-.17,'harmony');
        if(!quiet)pitch(start+.12,'choir',fifth+12,breakdown?6.1:3.0,.16*energy,.20,'harmony');
      }
      if(!intro&&!breakdown&&bar%4===0&&!energetic)note(start+.1,'sho',chord+4,3.3,.12*energy,-.28,-1,'harmony');
      // Brass announces the returning theme and carries battle/army climaxes.
      if((energetic&&(climax||section.id==='theme'&&bar%2===0))||(t.scene==='world'||t.scene==='menu')&&climax&&bar%2===0){
        const accents=climax&&energetic?[0,2.5]:[0];
        for(const offset of accents){
          pitch(start+offset,'brass',root+12,offset?1.0:1.7,.35*energy,-.21,'answer');
          pitch(start+offset+.025,'brass',fifth+12,offset?.9:1.6,.26*energy,.22,'answer');
        }
      }
      // The string ostinato grows during the rise, not throughout the quiet pages.
      if(energetic&&(rise||climax)&&bar!==29){
        const offsets=rise&&local<2?[0,1,2,3]:[.5,1.5,2.5,3.5];
        offsets.forEach((offset,index)=>note(start+offset,'strings',chord+(index%2?3:0),.33,.20*energy,index%2?.32:-.32,0,'ostinato'));
      }
      if((bar===3||bar===7||bar===23||bar===29)&&!quiet){
        for(let j=0;j<5;j++)note(start+3.25+j*.13,'pluck',chord+j,.35,.12+j*.014,-.48+j*.22,0,'ornament');
      }
      if([0,8,24].includes(bar))note(start,'kane',chord+5,2,.15*(bar===24?1.2:1),.42,0,'ornament');
      if((section.id==='theme'||climax)&&bar%4===1&&t.lead!=='bell')note(start+3,'bell',chord+5,1.1,.10*energy,.45,0,'ornament');
      if(t.drums==='none'){
        // Snow, evening and defeat keep their silence even in the large section.
        if(climax&&bar===24)drum(start,'cymbal',.09,.2);
        continue;
      }
      if(intro||breakdown){if((energetic||t.scene==='world')&&local===0)drum(start,'odaiko',intro?.30:.22,-.08);continue;}
      const strength=(energetic?.58:.36)*energy;
      drum(start,energetic&&(climax||siege)?'odaiko':'taiko',strength,-.08);
      if(!coda||bar===30)drum(start+2,'taiko',strength*.72,.06);
      if(coda)continue;
      if(['march','battle','siege'].includes(t.drums)){
        drum(start+1,'wood',.20*energy,-.25);drum(start+3,'wood',.24*energy,.25);
      }
      if(t.drums==='wood'||t.drums==='light'){
        drum(start+1.5,'wood',.16*energy,-.27);drum(start+3.5,'wood',.13*energy,.25);
      }
      if(bar%2===1){drum(start+1.75,'tsuzumi',.19*energy,-.35);drum(start+3.5,'tsuzumi',.23*energy,.32);}
      if(t.drums==='battle'){
        for(const offset of [.75,1.5,2.75,3.5])drum(start+offset,'hat',.14*energy,offset<2?-.36:.36);
        if(climax)drum(start+2.75,'taiko',.29,.20);
      }
      if(siege){drum(start+2.5,'taiko',.32*energy,.17);drum(start+3.5,'wood',.20*energy,-.22);}
      if([7,15,23,29].includes(bar)){
        [.0,.25,.5,.75].forEach((offset,index)=>drum(start+3+offset,index===3?'taiko':'tsuzumi',(.15+index*.055)*energy,index%2?.28:-.28));
      }
      if([8,24].includes(bar))drum(start,'cymbal',climax?.23:.16,.33);
    }
    events.sort((a,b)=>a.beat-b.beat||b.priority-a.priority);
    const secondsPerBeat=60/t.tempo,duration=t.bars*t.beats*secondsPerBeat;
    const result={events,secondsPerBeat,duration,sections:FORM,peak:scorePeak(events,secondsPerBeat,duration)};
    compiled.set(t.id,result);return result;
  }

  class SengokuMusic {
    constructor({volume=10,onTrackChange=null}={}) {
      this._volume=clamp(Number(volume)||0,0,100);this._onTrackChange=onTrackChange;
      this._context=null;this._master=null;this._compressor=null;this._reverb=null;
      this._currentId=null;this._session=null;this._playing=false;this._auto=true;
      this._timer=null;this._pauseTimer=null;this._token=0;this._resumePosition=0;this._disposed=false;
      this._noise=null;this._pluckCache=new Map();this._waveCache=new Map();this._sessions=new Set();
      this._voices=new Set();this._sourceCount=0;this._droppedVoices=0;
      this._audioElement=null;this._streamDestination=null;this._audioSession=null;
      this._previousSessionType=null;this._ownsAudioSession=false;this._outputToken=0;this._pageActive=true;this._voiceActive=false;
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
    setVoiceActive(value){
      const active=value===true;if(active===this._voiceActive)return Promise.resolve();
      this._voiceActive=active;
      // Release the music playback category before microphone capture. Keep the
      // user's playback intent and volume, so ending a call resumes the score.
      if(active){this._clearScheduler();clearTimeout(this._pauseTimer);this._pauseTimer=null;return this._suspendOutput();}
      return this._onVisibility();
    }
    setVolume(value){
      this._volume=clamp(Number(value)||0,0,100);
      if(this._context&&this._master)this._smoothGain(this._master.gain,this._playing?this._volume/100*.65:0,.08);
      if(!this._playing||!this._context)return;
      if(!this._volume){this._clearScheduler();this._suspendOutput();}
      else if(!this._hidden())this._resumeOutput().then(ok=>{if(ok)this._schedule();}).catch(()=>{});
    }
    _hidden(){return this._voiceActive||!this._pageActive||(typeof document!=='undefined'&&document.hidden);}
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
      this._compressor.threshold.value=-20;this._compressor.knee.value=16;
      this._compressor.ratio.value=3.5;this._compressor.attack.value=.012;this._compressor.release.value=.30;
      this._compressor.connect(this._master);this._connectOutput(ctx);
      this._reverb=ctx.createConvolver();
      const impulse=ctx.createBuffer(2,Math.ceil(ctx.sampleRate*1.85),ctx.sampleRate);
      let seed=6289;
      for(let channel=0;channel<2;channel++) {
        const data=impulse.getChannelData(channel);
        for(let i=0;i<data.length;i++){
          seed=(Math.imul(seed,1664525)+1013904223)>>>0;
          const seconds=i/ctx.sampleRate,build=clamp((seconds-.018)/.055,0,1);
          data[i]=((seed/4294967296)*2-1)*build*Math.exp(-seconds*3.8)*.23;
        }
        // Discrete early reflections place the ensemble in a room before the
        // diffused tail. The channels differ without an ever-running delay loop.
        for(const [seconds,level] of [[.027,.21],[.051,.14],[.083,.09],[.117,.055]]){
          const at=Math.round((seconds+channel*.007)*ctx.sampleRate);if(at<data.length)data[at]+=level;
        }
      }
      this._reverb.buffer=impulse;
      this._reverbHighpass=ctx.createBiquadFilter();this._reverbHighpass.type='highpass';this._reverbHighpass.frequency.value=165;
      this._reverbLowpass=ctx.createBiquadFilter();this._reverbLowpass.type='lowpass';this._reverbLowpass.frequency.value=Math.min(5200,ctx.sampleRate*.45);
      const wet=ctx.createGain();wet.gain.value=.25;
      this._reverb.connect(this._reverbHighpass);this._reverbHighpass.connect(this._reverbLowpass);this._reverbLowpass.connect(wet);wet.connect(this._compressor);this._wet=wet;
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
      const bus=ctx.createGain(),roomBus=ctx.createGain();bus.gain.value=0;roomBus.gain.value=0;bus.connect(this._compressor);roomBus.connect(this._reverb);
      const session={bus,roomBus,score,voices:new Set(),active:true,start:ctx.currentTime+.055-position,eventIndex:0,cycle:0};
      while(session.eventIndex<score.events.length&&score.events[session.eventIndex].beat*score.secondsPerBeat<position)session.eventIndex++;
      this._session=session;this._sessions.add(session);
      bus.gain.linearRampToValueAtTime(1,ctx.currentTime+.25);
      roomBus.gain.linearRampToValueAtTime(1,ctx.currentTime+.25);
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
      this._pruneVoices(ctx.currentTime);
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
      if(session.roomBus)this._smoothGain(session.roomBus.gain,0,fade);
      const stop=this._context.currentTime+fade+.025;
      for(const voice of session.voices){voice.endTime=Math.min(voice.endTime,stop);for(const source of voice.sources){try{source.stop(stop);}catch(_){}}}
      if(!session.voices.size)this._releaseSession(session);
    }
    _releaseSession(session){
      try{session.bus.disconnect();session.roomBus?.disconnect();}catch(_){}
      this._sessions.delete(session);
    }
    _disconnectVoice(voice){
      if(voice.closed)return;voice.closed=true;
      for(const node of [...voice.sources,...voice.nodes]){try{node.disconnect();}catch(_){}}
      this._voices.delete(voice);this._sourceCount=Math.max(0,this._sourceCount-voice.sources.length);
      voice.session.voices.delete(voice);
      if(!voice.session.active&&!voice.session.voices.size)this._releaseSession(voice.session);
    }
    _pruneVoices(now){
      // Normally onended performs this work. Also prune by audio time after a
      // throttled tab resumes; delayed callbacks must not consume the budget.
      for(const voice of this._voices)if(voice.endTime<=now)this._disconnectVoice(voice);
    }
    _ensembleWave(kind,midi){
      const ctx=this._context;if(!ctx.createPeriodicWave)return null;
      const key=kind+(kind==='choir'?':'+midi:'');if(this._waveCache.has(key))return this._waveCache.get(key);
      const real=new Float32Array(49),imag=new Float32Array(49),hz=frequency(midi);
      const bell=(value,center,width)=>Math.exp(-.5*Math.pow((value-center)/width,2));
      for(let harmonic=1;harmonic<imag.length;harmonic++){
        let amplitude;
        if(kind==='choir'){
          const at=hz*harmonic;
          amplitude=(.75*bell(at,710,170)+.48*bell(at,1200,230)+.18*bell(at,2500,410)+.12/harmonic)/Math.pow(harmonic,.45);
          if(at>ctx.sampleRate*.45)amplitude=0;
        }else if(kind==='brass')amplitude=Math.exp(-harmonic/13)/Math.pow(harmonic,.82);
        else amplitude=(harmonic%2?1:.78)*Math.exp(-harmonic/23)/Math.pow(harmonic,1.22);
        imag[harmonic]=amplitude;
      }
      const wave=ctx.createPeriodicWave(real,imag);
      if(this._waveCache.size>=40)this._waveCache.delete(this._waveCache.keys().next().value);
      this._waveCache.set(key,wave);return wave;
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
      const ctx=this._context;
      if(!ctx||this._disposed||!session?.active)return false;
      this._pruneVoices(ctx.currentTime);
      const velocity=clamp(Number.isFinite(event.velocity)?event.velocity:.3,0,1);
      if(!velocity)return false;
      // Count scheduled sources as well as sounding sources. Rapid scene changes
      // and repeated effects cannot create an unbounded graph on mobile devices.
      const cost=SOURCE_COST[event.type]||1;
      if(this._voices.size>=VOICE_LIMIT||this._sourceCount+cost>SOURCE_LIMIT){this._droppedVoices++;return false;}
      const sources=[],nodes=[],end=clamp(duration,.08,6),actualEnd=voiceLifetime(event.type,duration);
      const envelope=ctx.createGain();nodes.push(envelope);envelope.gain.value=0;
      const pan=ctx.createStereoPanner?ctx.createStereoPanner():ctx.createGain();
      if(pan.pan)pan.pan.value=clamp(event.pan||0,-.72,.72);nodes.push(pan);envelope.connect(pan);pan.connect(session.bus);
      if(session.roomBus){const send=ctx.createGain();send.gain.value=ROOM_SEND[event.type]??.2;pan.connect(send);send.connect(session.roomBus);nodes.push(send);}
      const addOsc=(type,hz,gain=1,target=envelope)=>{
        const osc=ctx.createOscillator();osc.type=type;osc.frequency.setValueAtTime(hz,time);
        if(gain!==1){const g=ctx.createGain();g.gain.value=gain;nodes.push(g);osc.connect(g);g.connect(target);}else osc.connect(target);
        sources.push(osc);return osc;
      };
      const lowpass=(cutoff,target=envelope)=>{const filter=ctx.createBiquadFilter();filter.type='lowpass';filter.frequency.value=Math.min(cutoff,ctx.sampleRate*.45);filter.connect(target);nodes.push(filter);return filter;};
      const swell=(level,attack,release)=>{
        attack=Math.min(attack,end*.42);release=Math.min(release,end*.35);
        envelope.gain.setValueAtTime(0,time);envelope.gain.linearRampToValueAtTime(level,time+attack);
        envelope.gain.setValueAtTime(level*.85,time+Math.max(attack,end-release));
        envelope.gain.linearRampToValueAtTime(0,time+actualEnd-.025);
      };
      if(event.type==='pluck'||event.type==='shamisen'){
        const source=ctx.createBufferSource();source.buffer=this._pluckBuffer(event.midi,event.type);source.connect(envelope);sources.push(source);
        envelope.gain.setValueAtTime(0,time);envelope.gain.linearRampToValueAtTime(velocity*(event.type==='shamisen'?.48:.58),time+.004);
        envelope.gain.exponentialRampToValueAtTime(.0001,time+actualEnd-.035);
      }else if(event.type==='flute'){
        const hz=frequency(event.midi),osc=addOsc('sine',hz*.988);
        addOsc('sine',hz*2,.16);addOsc('sine',hz*3,.045);
        const breath=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),gain=ctx.createGain();breath.buffer=this._noise;breath.loop=true;filter.type='bandpass';filter.frequency.value=Math.min(hz*2.7,ctx.sampleRate*.43);gain.gain.value=.055;
        breath.connect(filter);filter.connect(gain);gain.connect(envelope);sources.push(breath);nodes.push(filter,gain);
        osc.frequency.linearRampToValueAtTime(hz,time+.045);
        // A breath attack and delayed, shallow vibrato make held phrases sing.
        for(let step=1;step<=Math.ceil(end/.11);step++){
          const offset=Math.min(end,.11*step),depth=clamp((offset-.18)/.4,0,1)*.0036;
          osc.frequency.linearRampToValueAtTime(hz*(1+Math.sin(offset*31)*depth),time+offset);
        }
        swell(velocity*.19,.08,.13);
      }else if(['strings','brass','choir'].includes(event.type)){
        const hz=frequency(event.midi),kind=event.type,wave=this._ensembleWave(kind,event.midi);
        const filter=kind==='choir'?null:lowpass(kind==='brass'?hz*6.5:hz*7.5);
        const target=filter||envelope,cents=kind==='strings'?4.5:kind==='choir'?3:1.8;
        for(const [side,gain] of [[-1,.54],[1,.46]]){
          const osc=addOsc(kind==='choir'?'triangle':'sawtooth',hz*Math.pow(2,side*cents/1200),gain,target);
          if(wave&&osc.setPeriodicWave)osc.setPeriodicWave(wave);
        }
        if(kind==='brass'){
          filter.frequency.setValueAtTime(Math.min(ctx.sampleRate*.43,hz*2.3),time);
          filter.frequency.linearRampToValueAtTime(Math.min(ctx.sampleRate*.43,hz*8.2),time+Math.min(.11,end*.3));
          filter.frequency.linearRampToValueAtTime(Math.min(ctx.sampleRate*.43,hz*4.5),time+end);
          swell(velocity*.19,.065,.1);
        }else if(kind==='choir')swell(velocity*.13,.32,.40);
        else swell(velocity*.17,event.part==='ostinato'?.028:.20,.22);
      }else if(event.type==='sho'){
        const hz=frequency(event.midi);addOsc('sine',hz);addOsc('triangle',hz*2,.24);swell(velocity*.18,.30,.30);
      }else if(event.type==='kane'){
        const hz=frequency(event.midi)*2;addOsc('sine',hz);addOsc('sine',hz*2.756,.19);addOsc('sine',hz*5.404,.045);
        envelope.gain.setValueAtTime(.0001,time);envelope.gain.linearRampToValueAtTime(velocity*.10,time+.003);envelope.gain.exponentialRampToValueAtTime(.0001,time+2.8);
      }else if(event.type==='tsuzumi'){
        const drum=addOsc('sine',260);drum.frequency.exponentialRampToValueAtTime(170,time+.045);drum.frequency.exponentialRampToValueAtTime(230,time+.13);
        addOsc('sine',515,.11);envelope.gain.setValueAtTime(.0001,time);envelope.gain.linearRampToValueAtTime(velocity*.27,time+.003);envelope.gain.exponentialRampToValueAtTime(.0001,time+.22);
      }else if(event.type==='bell'){
        const hz=frequency(event.midi);addOsc('sine',hz);addOsc('sine',hz*2.01,.20);addOsc('sine',hz*3.98,.045);
        envelope.gain.setValueAtTime(.0001,time);envelope.gain.linearRampToValueAtTime(velocity*.16,time+.008);envelope.gain.exponentialRampToValueAtTime(.0001,time+end+1);
      }else if(event.type==='bass'){
        addOsc('sine',frequency(event.midi));addOsc('triangle',frequency(event.midi)*2,.09);
        envelope.gain.setValueAtTime(0,time);envelope.gain.linearRampToValueAtTime(velocity*.25,time+.03);envelope.gain.exponentialRampToValueAtTime(.0001,time+end);
      }else if(event.type==='taiko'||event.type==='odaiko'){
        const large=event.type==='odaiko',body=addOsc('sine',large?80:120),rim=addOsc('sine',large?153:207,.24);
        body.frequency.exponentialRampToValueAtTime(large?37:54,time+(large?.30:.17));rim.frequency.exponentialRampToValueAtTime(large?85:121,time+.12);
        const strike=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),gain=ctx.createGain();strike.buffer=this._noise;filter.type='bandpass';filter.frequency.value=large?720:1100;
        gain.gain.setValueAtTime(.32,time);gain.gain.exponentialRampToValueAtTime(.0001,time+.075);
        strike.connect(filter);filter.connect(gain);gain.connect(envelope);sources.push(strike);nodes.push(filter,gain);
        envelope.gain.setValueAtTime(.0001,time);envelope.gain.linearRampToValueAtTime(velocity*(large?.34:.31),time+.006);envelope.gain.exponentialRampToValueAtTime(.0001,time+actualEnd-.04);
      }else if(event.type==='wood'){
        const osc=addOsc('sine',680);osc.frequency.exponentialRampToValueAtTime(410,time+.04);addOsc('sine',980,.23);
        envelope.gain.setValueAtTime(.0001,time);envelope.gain.linearRampToValueAtTime(velocity*.18,time+.002);envelope.gain.exponentialRampToValueAtTime(.0001,time+.085);
      }else{
        const source=ctx.createBufferSource(),filter=ctx.createBiquadFilter();source.buffer=this._noise;source.loop=event.type==='cymbal';
        filter.type='highpass';filter.frequency.value=Math.min(event.type==='cymbal'?1800:4300,ctx.sampleRate*.43);nodes.push(filter);source.connect(filter);filter.connect(envelope);sources.push(source);
        envelope.gain.setValueAtTime(.0001,time);envelope.gain.linearRampToValueAtTime(velocity*(event.type==='cymbal'?.10:.045),time+.004);envelope.gain.exponentialRampToValueAtTime(.0001,time+actualEnd-.015);
      }
      const voice={sources,nodes,session,endTime:time+actualEnd,closed:false};session.voices.add(voice);this._voices.add(voice);this._sourceCount+=sources.length;let remaining=sources.length;
      for(const source of sources){
        source.onended=()=>{if(--remaining===0)this._disconnectVoice(voice);};
        source.start(time);source.stop(time+actualEnd);
      }
      return true;
    }

    playEffect(type='confirm') {
      // Effects use only an already user-started music context; never unlock audio.
      if(!this._playing||!this._volume||!this._context||this._context.state!=='running'||this._hidden()||!this._session)return;
      const t=this._context.currentTime+.005;
      const notes=type==='victory'?[72,76,79]:type==='error'?[55,53]:[74,79];
      notes.forEach((midi,i)=>this._voice(this._session,{type:'bell',midi,velocity:.17,pan:0,part:'effect',priority:PART_PRIORITY.effect},t+i*.075,.12));
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
      for(const voice of [...this._voices])this._disconnectVoice(voice);
      for(const session of [...this._sessions])this._releaseSession(session);
      for(const node of [this._reverb,this._reverbHighpass,this._reverbLowpass,this._wet,this._compressor,this._master])try{node?.disconnect();}catch(_){}
      this._sessions.clear();this._pluckCache.clear();this._waveCache.clear();this._session=null;this._noise=null;
      if(this._reverb)this._reverb.buffer=null;
    }
    // Read-only score summaries permit deterministic integrity checks without audio.
    static inspect(id){
      const t=byId.get(id);if(!t)throw new RangeError('Unknown track');const s=compile(t);
      return {id,duration:s.duration,eventCount:s.events.length,sections:s.sections.map(section=>({...section})),estimatedPeak:{...s.peak},voiceBudget:{voices:VOICE_LIMIT,sources:SOURCE_LIMIT},instruments:[...new Set(s.events.map(event=>event.type))],events:s.events.map(e=>({...e}))};
    }
  }
  global.SENGOKU_MUSIC_TRACKS=TRACKS;
  global.SengokuMusic=SengokuMusic;
})(typeof window!=='undefined'?window:globalThis);
