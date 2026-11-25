/* 戦国VS: four supplied menu/daypart recordings, sixteen original written scores,
   and an offline Web Audio performance of those sixteen scores. */
(function (global) {
  'use strict';

  // Written phrases use eight straight or twelve compound subdivisions per
  // measure. A dash sustains the previous note and a dot leaves a breath.
  const SCORES = [
    {
      id:"town-dawn", name:"霞ヶ浦の渡し", scene:"town", tempo:82, root:60,
      lead:"flute", reply:"pluck", groove:"river", chords:"0M -5M 2m -7M -3m -5M -7sus 0M",
      description:"舟を漕ぐ箏の反復に朝の笛が乗り、渡し場に弦の響きが広がる。",
      tune:[
        ". . 4 - 2 0 7 -", "9 - - 7 5 - 0 -", "2 - 5 9 12 - 9 -", "11 - 7 - . 2 4 -",
        "12 - 7 9 . 4 7 -", "5 9 12 - 14 - 9 -", "7 - . 2 11 9 7 2", "4 2 0 - - - . ."]
    },
    {
      id:"castle-evening", name:"石垣の夕照", scene:"town", tempo:69, root:58,
      lead:"strings", reply:"flute", groove:"still", chords:"0m -2sus -4M 3M -5m -4M -2M 0m",
      description:"独奏チェロから始まり、対岸の笛とヴィオラが城影に長い弧を描く。",
      tune:[
        "3 - 5 7 - - . .", "2 - - . 5 - 7 -", "8 - 3 - . 7 8 -", "10 - 7 3 - - . .",
        "12 - - 10 8 - 5 -", "7 8 - - . 12 10 -", "5 - 2 - - 3 2 -", "7 3 0 - - - . ."]
    },
    {
      id:"fields-green", name:"水車と稲穂", scene:"town", tempo:99, root:62,
      lead:"pluck", reply:"flute", groove:"harvest", chords:"0M -3m -5M -7M 2m -5M -7M 0M",
      description:"水車が転がす三連の拍子。笛と箏が短い旋律を渡し、実りの祝いへ入る。",
      tune:[
        "0 - 4 7 . 4 2 - 0 4 - 7", "9 - . 12 9 7 4 - . 2 - .", "5 9 - 12 . 9 5 - 2 0 - .", "7 - - 2 - . 4 2 0 2 - .",
        "2 - 5 9 12 14 9 - - 5 9 -", "12 9 5 9 - . 14 - 12 9 - .", "11 7 2 7 - 9 11 - 14 11 7 -", "4 - 7 2 4 2 0 - - . . ."]
    },
    {
      id:"market-breeze", name:"染物横町の手拍子", scene:"town", tempo:112, root:64,
      lead:"shamisen", reply:"bell", groove:"market", chords:"0m -5m -2M 0m 3M -4M -2M 0open",
      description:"染物の店先を抜ける三味線。木片、鈴、小鼓の裏拍が一つずつ加わる。",
      tune:[
        ". 3 2 . 0 7 3 .", "5 0 . 5 8 . 5 7", ". 2 5 . 10 7 . 5", "3 0 3 7 . 3 2 .",
        "7 10 . 15 10 7 . 3", "8 . 12 8 . 7 3 5", "2 5 . 10 7 2 5 .", "3 2 7 . 0 - . ."]
    },
    {
      id:"world-march", name:"旌旗越ゆる稜線", scene:"world", tempo:88, root:60,
      lead:"brass", reply:"flute", groove:"procession", chords:"0m -2M -4M 3M -5m 3M -2sus 0open",
      description:"山の稜線をまたぐ二本の角笛。低弦の行進を背に、遠い谷から笛が返す。",
      tune:[
        "7 - 0 - - 3 7 10", "5 - . 2 5 - 7 -", "8 - 12 8 3 - 7 -", "10 7 3 - - . 5 -",
        "5 8 12 - 17 - 12 8", "15 - - 14 10 7 3 -", "10 - 5 - 2 5 7 -", "3 - 7 2 0 - - ."]
    },
    {
      id:"mountain-road", name:"鳴らぬ峠の鈴", scene:"world", tempo:74, root:61,
      lead:"flute", reply:"bell", groove:"mist", chords:"0open -5m 1M 0open -4M -5open 1M 0open",
      description:"霧の山道に独奏尺八と同じ鈴の反響。低い木管だけが足取りに寄り添う。",
      tune:[
        ". 1 - - 0 - . 5", "7 - 5 1 - - . .", "8 7 - . 5 1 - -", "0 - . . 7 - - .",
        "8 - . . 12 8 - 7", "5 - 7 - . 1 5 -", "13 - 12 8 - 5 1 -", "7 1 0 - - . . ."]
    },
    {
      id:"officers-oath", name:"磨いた柄の記憶", scene:"officers", tempo:85, root:59,
      lead:"flute", reply:"strings", groove:"oath", chords:"0m 3M -4M -2sus -5m -4M -2M 0m",
      description:"低い笛が語る武将の来し方。弓をそろえた弦と琵琶風の撥弦が誓いを支える。",
      tune:[
        ". 0 3 5 7 - 3 -", "10 - 7 3 . 7 10 -", "8 - . 3 0 3 7 -", "5 2 - - . 5 2 -",
        "5 8 10 - 12 - 8 -", "15 - 12 8 3 - . 7", "10 7 2 - 5 7 2 -", "3 - . 2 0 - - ."]
    },
    {
      id:"council-lantern", name:"軍扇の裏", scene:"chronicle", tempo:90, root:55,
      lead:"shamisen", reply:"sho", groove:"lantern", chords:"0open 1M 0m -5open -4M 0m 1M 0open",
      description:"箏の低音が指令の間を刻み、三味線と木管が軍議の問いと返答を分け合う。",
      tune:[
        ". 0 . 7 3 . 0 1", "5 . 1 . . 8 5 1", "7 3 . . 0 . 3 7", "5 . 0 . . 5 7 .",
        "8 . 12 8 . 7 3 .", "7 . 10 . 3 . 7 10", "13 . 8 . 5 1 . 5", "7 3 . 0 - . . ."]
    },
    {
      id:"army-banner", name:"六拍の陣立て", scene:"army", tempo:109, root:57,
      lead:"brass", reply:"shamisen", groove:"banner", chords:"0open -5m -2M 0m -4M 3M -2M 0open",
      description:"三連の陣太鼓に二隊の金管が応える。小鼓の折り返しで旗持ちが歩をそろえる。",
      tune:[
        "0 - . 7 - 0 3 - 7 10 - .", "5 - 0 8 - 5 12 - . 8 5 -", "2 - 5 10 - 7 5 2 . 5 - .", "7 - . 3 - . 0 - - . 3 7",
        "8 - 12 15 - . 12 8 - 3 8 -", "10 - 15 14 - 10 7 - . 3 7 -", "14 10 7 2 - 5 7 5 2 5 - .", "7 - 3 0 - - . 0 . . . ."]
    },
    {
      id:"research-stars", name:"北辰のものさし", scene:"research", tempo:79, root:63,
      lead:"bell", reply:"flute", groove:"stars", chords:"0M -3m 2m -7M -5M 0M -7sus 0M",
      description:"夜の天文台に鉄琴が一音ずつ座標を打つ。ハープと遠い笛が星を結んでいく。",
      tune:[
        ". 7 - 4 11 - . 14", "9 - . 4 7 - 9 -", "5 - 9 14 - . 12 -", "11 - 7 - 2 - . .",
        "12 - . 5 9 12 - 17", "16 - 11 7 4 - - .", ". 14 9 - 7 - 2 -", "4 - 7 2 0 - . ."]
    },
    {
      id:"battle-storm", name:"紅蓮三段", scene:"battle", tempo:128, root:61,
      lead:"shamisen", reply:"brass", groove:"gallop", chords:"0m -2M 0m -4M -5m 3M -2sus 0m",
      description:"三段に分かれた撥音が駆け抜ける。重い陣太鼓に短い弦と金管の返しが切り込む。",
      tune:[
        "7 0 3 . 7 10 3 0", "5 2 . 10 7 5 2 5", "3 7 . 12 7 3 10 7", "8 3 0 8 . 12 8 .",
        "5 8 12 5 . 17 12 8", "7 10 15 10 14 . 10 7", "2 7 10 14 10 7 . 5", "3 7 2 . 0 - . ."]
    },
    {
      id:"battle-siege", name:"櫓門の鉄槌", scene:"battle", tempo:96, root:55,
      lead:"brass", reply:"strings", groove:"siege", chords:"0open -5m 1M 0m -4M 1M -5open 0open",
      description:"低いトロンボーンが門前で響く。太鼓は打つ手を交替し、包囲の終盤に全弦が迫る。",
      tune:[
        ". 0 - 7 . 0 3 -", "5 - - . 8 5 0 -", "1 - 5 - 8 5 1 .", "3 - 7 3 0 - . .",
        "8 - 3 8 12 - 15 -", "13 - - . 8 - 5 1", "7 5 . 0 5 7 1 -", "0 - . 7 0 - - ."]
    },
    {
      id:"victory-horizon", name:"白金の凱旋門", scene:"victory", tempo:116, root:60,
      lead:"brass", reply:"flute", groove:"fan", chords:"0M -7M -3m -5M 2m -5M -7M 0M",
      description:"三連の号角が凱旋の橋へ踏み出す。鈴、ティンパニ、応答する高弦が勝鬨を迎える。",
      tune:[
        "4 - 7 12 - 4 7 - . 12 16 -", "11 7 - 2 - . 7 11 14 11 - .", "9 - 12 16 12 9 4 - . 7 9 -", "5 - 9 12 - - 9 - . 5 7 -",
        "14 - . 9 14 17 14 - 12 9 5 -", "12 17 - 21 - 17 14 12 9 5 - .", "11 14 19 14 - 11 7 9 11 14 11 7", "12 - 7 4 2 4 0 - - . . ."]
    },
    {
      id:"defeat-moon", name:"渡せなかった書状", scene:"defeat", tempo:66, root:57,
      lead:"strings", reply:"flute", groove:"lunar", chords:"0m -5m -4M -2sus 3M -4M -5open 0open",
      description:"独奏チェロが下書きの一節を繰り返す。尺八の短い返事から、最後に開放弦だけが残る。",
      tune:[
        ". 3 - 0 - - . .", "5 - - . 0 3 5 -", "8 - 7 3 0 - . .", "2 - - - . . 5 2",
        "3 7 - 10 - - . 7", "8 - . 3 7 - 8 -", "5 - . 2 7 - 5 2", "0 - - - - . . ."]
    },
    {
      id:"winter-silence", name:"氷柱の茶室", scene:"town", tempo:72, root:60,
      lead:"bell", reply:"strings", groove:"snow", chords:"0m -2sus -4M -5m 3M -4M -2sus 0open",
      description:"一粒ずつ落ちる鈴に箏のかすかな倍音が寄り添う。雪の茶室を少人数の室内楽で描く。",
      tune:[
        ". . 3 - . 7 - -", "5 - . . 2 - . .", "8 - . 3 0 - - .", "5 - 7 - . . . .",
        "10 - . . 15 - 10 -", "12 8 - . 3 - . .", "2 - . 7 5 - 2 -", "7 - . 0 - - . ."]
    },
    {
      id:"unification", name:"天つ風、四海を渡る", scene:"menu", tempo:93, root:62,
      lead:"flute", reply:"brass", groove:"horizon", chords:"0M -7M -5M -3m 2m -5M -7sus 0M",
      description:"四海を渡る笛の旋律に、箏と弦の波が押し寄せる。遠くの角笛を大太鼓が迎える終曲。",
      tune:[
        ". 4 7 - 12 - 9 7", "2 - 7 11 14 - 7 -", "9 - 5 2 . 5 9 12", "16 - 12 9 4 - . .",
        "5 - 9 14 17 - 14 9", "12 - - 9 5 9 12 -", "7 9 14 - 11 - 7 2", "4 - 7 2 0 - - ."]
    },
  ].map(score => ({...score, bars:32, beats:4}));
  const SUPPLIED_TRACKS = Object.freeze([
    {id:'shitaku',name:'支度',scene:'title',duration:57.6,description:'ゲーム開始前のトップメニューと、本拠を選んでいる間のBGM。'},
    {id:'asakatsu',name:'朝活',scene:'morning',duration:202.52,description:'朝 05:00〜11:59。端末の時刻に合わせて流れる朝のBGM。'},
    {id:'hirukatsu',name:'昼活',scene:'day',duration:359.88,description:'昼 12:00〜17:59。端末の時刻に合わせて流れる昼のBGM。'},
    {id:'yorukatsu',name:'夜活',scene:'night',duration:170,description:'夜 18:00〜翌04:59。端末の時刻に合わせて流れる夜のBGM。'}
  ].map(track=>Object.freeze({...track,title:track.name,recordingOnly:true,
    recording:'assets/music/'+track.id+'.mp3',durationSeconds:Math.round(track.duration),sampleRate:48000})));
  const TRACKS = Object.freeze([...SUPPLIED_TRACKS,...SCORES.map(t => Object.freeze({
    id:t.id,name:t.name,title:t.name,scene:t.scene,tempo:t.tempo,bars:t.bars,
    recording:'assets/music/'+t.id+'.mp3?v=4.9.10-20261123',
    beatsPerBar:t.beats,duration:t.bars*t.beats*60/t.tempo,
    durationSeconds:Math.round(t.bars*t.beats*60/t.tempo),description:t.description
  }))]);
  const trackById = new Map(TRACKS.map(track=>[track.id,track]));
  const byId = new Map(SCORES.map(t=>[t.id,t]));
  const compiled = new Map();
  const clamp = (n,a,b)=>Math.max(a,Math.min(b,n));
  const frequency = midi => 440*Math.pow(2,(midi-69)/12);
  // The device's local wall clock controls music, independently of the game's
  // calendar and server time. Local setHours also follows timezone/DST changes.
  function daypartTrackId(date=new Date()){
    const hour=date.getHours();
    return hour>=5&&hour<12?'asakatsu':hour>=12&&hour<18?'hirukatsu':'yorukatsu';
  }
  function automaticTrackId(scene='game',date){return scene==='title'?'shitaku':daypartTrackId(date);}
  function nextDaypartDelay(date=new Date()){
    const next=new Date(date.getTime()),hour=date.getHours();
    if(hour<5)next.setHours(5,0,0,0);
    else if(hour<12)next.setHours(12,0,0,0);
    else if(hour<18)next.setHours(18,0,0,0);
    else{next.setDate(next.getDate()+1);next.setHours(5,0,0,0);}
    return Math.max(0,next.getTime()-date.getTime());
  }
  // These sections are composed into the score, not produced by changing volume.
  // The middle break removes the rhythmic bed; the theme returns in a wider
  // register before a distinct climax and a tonic cadence back into the loop.
  const FORM = Object.freeze([
    {id:'intro',name:'序奏',energy:.48},
    {id:'build',name:'高まり',energy:.68},
    {id:'theme',name:'主題',energy:.88},
    {id:'break',name:'静寂',energy:.40},
    {id:'rise',name:'再起',energy:.80},
    {id:'climax',name:'大合奏',energy:1.08},
    {id:'coda',name:'結び',energy:.63}
  ].map(section=>Object.freeze(section)));
  const VOICE_LIMIT=40, SOURCE_LIMIT=88;
  const SOURCE_COST=Object.freeze({pluck:1,shamisen:1,flute:4,sho:2,strings:2,brass:2,choir:2,kane:3,tsuzumi:1,bell:3,bass:2,taiko:1,odaiko:1,wood:1,cymbal:1,hat:1});
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
  // Eight-step accompaniment and sixteen-step percussion parts. Digits are
  // chord voices from low to high. Spaces in drum notation divide the beats.
  const GROOVES = {
    river:      {keys:'0..213.2', bass:'0...2...', kit:'t... .... d... ..w.', sway:.045},
    still:      {keys:'0.....21', bass:'0.......', kit:'', sway:.018},
    harvest:    {keys:'0.123.13', bass:'0..2...1', kit:'t..w ..d. t..d ..w.', sway:.095},
    market:     {keys:'1.20.103', bass:'0.2..021', kit:'.w.d T.w. .d.. t.wd', sway:.070},
    procession: {keys:'0...12.2', bass:'0.2.0..2', kit:'B... w..d t... ...d', sway:.015},
    mist:       {keys:'0....1..', bass:'0.......', kit:'.... ..d. .... ....', sway:.030},
    oath:       {keys:'0..21.32', bass:'0...21..', kit:'T... .d.. .... w...', sway:.020},
    lantern:    {keys:'0.10..2.', bass:'0..2..0.', kit:'.w.. ..d. w... .d..', sway:.014},
    banner:     {keys:'0.2.02.1', bass:'0.02.0.2', kit:'B.d. .w.d T..w .d.d', sway:.005},
    stars:      {keys:'0..2341.', bass:'0...2...', kit:'', sway:.028},
    gallop:     {keys:'021.32.1', bass:'0.20.20.', kit:'B.dd T.d. B.dT .dd.', sway:0},
    siege:      {keys:'0.0..21.', bass:'0....2..', kit:'B... T... ..dT ....', sway:0},
    fan:        {keys:'0..2.134', bass:'0.2...12', kit:'B..d ..w. T.dd ...d', sway:.010},
    lunar:      {keys:'0.....1.', bass:'0.......', kit:'', sway:.018},
    snow:       {keys:'0....3.2', bass:'0.......', kit:'', sway:.032},
    horizon:    {keys:'0.2.3142', bass:'0..2..1.', kit:'T..d .... t... ..d.', sway:.027}
  };
  const CHORDS = {M:[0,4,7,12,16], m:[0,3,7,12,15], sus:[0,5,7,12,14], open:[0,7,12,14,19]};
  const DRUMS = {B:'odaiko',T:'taiko',t:'taiko',d:'tsuzumi',w:'wood'};
  const DRUM_LEVEL = {B:.80,T:.65,t:.43,d:.34,w:.34};

  // Each definition has the fundamental, stick noise decay and the
  // inharmonic membrane modes [ratio, amplitude, decay in seconds].
  const DRUM_MODELS={
    odaiko:[52,.019,[[1,.65,.36],[1.52,.28,.32],[1.97,.23,.24],[2.63,.13,.17],[3.72,.10,.12],[5.61,.09,.070]]],
    taiko:[86,.014,[[1,.66,.21],[1.58,.30,.20],[2.16,.20,.14],[2.82,.16,.095],[4.19,.10,.064],[6.7,.055,.042]]],
    tsuzumi:[238,.010,[[1,.60,.072],[1.63,.28,.053],[2.25,.24,.049],[3.36,.16,.039],[5.41,.11,.028]]],
    wood:[640,.006,[[1,.50,.024],[1.47,.30,.019],[2.70,.19,.014],[4.11,.11,.010]]]
  };

  function readMeasure(measure) {
    const phrase=[];
    const steps=measure.split(' '),unit=4/steps.length;
    for(const [position,token] of steps.entries()){
      if(token==='-')phrase[phrase.length-1].length+=unit;
      else phrase.push({position:position*unit,length:unit,semitone:token==='.'?null:Number(token)});
    }
    return phrase.filter(note=>note.semitone!==null);
  }

  function compile(t){
    if(compiled.has(t.id))return compiled.get(t.id);
    const events=[],groove=GROOVES[t.groove],melodies=t.tune.map(readMeasure);
    const harmony=t.chords.split(' ').map(symbol=>{
      const [,offset,quality]=symbol.match(/^(-?\d+)(M|m|sus|open)$/);
      return CHORDS[quality].map(interval=>t.root+Number(offset)+interval);
    });
    const martial=['battle','army','victory'].includes(t.scene);
    const reflective=['still','mist','lunar','snow','stars'].includes(t.groove);
    // The battle and fanfare cues get to their main statement in two bars.
    // The reflective cues hold their central duet and take longer to recover.
    const boundaries=martial?[0,2,7,15,19,23,30,32]:reflective?[0,4,8,16,21,25,30,32]:[0,3,8,16,20,24,30,32];
    const sections=FORM.map((section,index)=>({...section,startBar:boundaries[index],endBar:boundaries[index+1]}));
    const kit=groove.kit.replace(/ /g,'');
    const compound=t.tune[0].split(' ').length===12;
    for(let bar=0;bar<t.bars;bar++){
      const section=sections.find(s=>bar>=s.startBar&&bar<s.endBar);
      const intro=section.id==='intro',rest=section.id==='break',rise=section.id==='rise';
      const full=section.id==='climax',close=section.id==='coda',main=section.id==='theme';
      const local=bar-section.startBar;
      let measure=main?local%8:(rest||full?(local+4)%8:local%4);
      if(close)measure=6+local;
      const chord=harmony[measure],tune=melodies[measure];
      const downbeat=bar*t.beats;
      const energy=section.energy*(martial&&intro?1.48:1);
      function place(beat,type,midi,length,level,pan,part){
        // Offset the right hand and the back half of each beat ever so slightly.
        // Absolute bar boundaries stay fixed over subsequent loops.
        const offbeat=compound?0:Math.abs(beat%1-.5)<.01?groove.sway:0;
        const onset=downbeat+beat+offbeat+(part==='ostinato'?.013:0);
        const event={beat:onset,type,duration:length,velocity:clamp(level*energy,0,.92),pan,part,
          priority:PART_PRIORITY[part],section:section.id};
        if(midi!==null)event.midi=midi;
        events.push(event);
      }
      const lead=rest?(t.reply==='brass'?'flute':t.reply):t.lead;
      const phrasing=(lead==='shamisen'||lead==='pluck')?.82:.94;
      for(const [i,note] of tune.entries()){
        if((rest&&i%2===1)||(intro&&reflective&&local===0&&i>0))continue;
        const length=rest?Math.min(note.length+.40,4-note.position):note.length*phrasing;
        const pitch=t.root+note.semitone+(rest&&lead==='strings'?-12:0)+(rise&&local>=2&&t.groove==='gallop'?12:0);
        const accent=(i===0?.84:.7)+(i%3===2?.05:0);
        place(note.position,lead,pitch,length,accent,lead==='shamisen'?-.12:.05,'lead');
        // The penultimate melody note at the height of the cue has a short
        // approach ornament. Leave room for breaths at phrase endings.
        if(full&&i===tune.length-2&&note.position>.24&&note.semitone>2&&lead==='flute')
          place(note.position-.18,lead,pitch-2,.14,.30,.05,'ornament');
      }
      if(!rest||local%2===0){
        const pattern=intro||rest||close?'0.......':groove.bass;
        for(let step=0;step<8;step++){
          if(pattern[step]==='.')continue;
          const midi=chord[Number(pattern[step])]-24;
          place(step/2,'bass',midi,reflective||rest?3.5:martial?.50:1.1,.75,0,'bass');
        }
      }
      // One answering hand in the introduction; interlocking left/right
      // plucks in the faster parts. In the break a single note is left ringing.
      const keyboard=rest?'0.......':intro?'0...2...':groove.keys;
      for(let step=0;step<8;step++){
        if(keyboard[step]==='.'||(close&&local===1&&step>3))continue;
        const instrument=martial&&step%2===0?'shamisen':'pluck';
        const position=step/2+(compound&&step%2?1/6:0);
        place(position,instrument,chord[Number(keyboard[step])]-12,reflective?1.55:.64,
          .38+((step+bar)%3)*.034,step%2===0?-.44:.34,'ostinato');
      }
      // The held thirds move with the bass instead of lingering over the
      // next harmony. Avoid scoring the same note in both registers.
      if(!rest&&(!intro||local===0)){
        place(.025,'strings',chord[1]-12,full||reflective?3.25:2.35,.33,-.29,'harmony');
        if(main||full||close)place(.065,'strings',chord[2],2.7,.25,.30,'harmony');
      }
      if((rest&&local===0)||(full&&local%2===0)){
        place(.10,'choir',chord[2],rest?3.4:2.85,.25,.26,'harmony');
        if(full)place(.13,'choir',chord[0],2.75,.21,-.19,'harmony');
      }
      // A separate answer fits the space around each cadence, taking over
      // from the lead for a beat or echoing the end with wider orchestration.
      if((main&&local%2===1)||rise||full){
        const answering=t.reply;
        const high=answering==='flute'||answering==='bell'?12:0;
        place(1.34,answering,chord[local%2?2:1]+high,.79,full?.54:.39,-.31,'answer');
        if(full||local%2===1)place(2.68,answering,chord[local%2?0:2]+high,.87,.43,.26,'answer');
      }
      if((full||rise)&&martial){
        for(const beat of [.5,1.5,2.5,3.5])
          place(beat,'strings',chord[beat<2?0:2]-12,.30,.46,-.37,'ostinato');
        if(full&&t.lead!=='brass')place(.05,'brass',chord[2],1.48,.54,.21,'answer');
      }else if(full&&!martial&&local%2===1){
        place(.16,'sho',chord[0],3.1,.27,.19,'harmony');
        place(3.12,'bell',chord[2]+12,.64,.23,.46,'ornament');
      }
      if((bar===0||full&&local===0)&&(!martial||t.scene==='victory'))
        place(0,'kane',chord[2],1.7,.24,.38,'ornament');
      if((rise||full)&&(!reflective||t.groove==='stars')&&local%2===0){
        // A cascading response in the upper strings, against the sustained
        // middle voices. It joins only at phrase boundaries.
        [0,1,2,3].forEach((voice,index)=>place(2.20+index/3,'pluck',chord[voice],.40,.31+index*.055,.44-index*.16,'ornament'));
      }
      if(kit){
        for(let step=0;step<kit.length;step++){
          const stroke=kit[step];if(stroke==='.')continue;
          if(rest||intro&&!martial){if(step!==0||local%2===1)continue;}
          if(close&&(local===1?step>0:step>8))continue;
          place(step/4,DRUMS[stroke],null,.32,DRUM_LEVEL[stroke],stroke==='w'?-.32:stroke==='d'?.30:0,'percussion');
        }
        if((main||rise||full)&&bar===section.endBar-1){
          for(let i=0;i<4;i++)place(3+i*.25,'tsuzumi',null,.25,.23+i*.08,i%2?.32:-.28,'percussion');
        }
        if(full&&local===0)place(0,'cymbal',null,1.4,.34,.26,'percussion');
      }
    }
    events.sort((a,b)=>a.beat-b.beat||b.priority-a.priority);
    const strokeCounts=new Map();
    for(const event of events){
      if(!DRUM_MODELS[event.type])continue;
      const count=strokeCounts.get(event.type)||0;
      event.alternate=count%2;
      strokeCounts.set(event.type,count+1);
    }
    const secondsPerBeat=60/t.tempo,duration=t.bars*t.beats*secondsPerBeat;
    const result={events,secondsPerBeat,duration,sections,peak:scorePeak(events,secondsPerBeat,duration)};
    compiled.set(t.id,result);
    return result;
  }
  class SengokuMusic {
    constructor({volume=10,scene='game',onTrackChange=null,onPlaybackError=null,onPlaybackBlocked=null,onStateChange=null}={}) {
      this._volume=clamp(Number(volume)||0,0,100);this._scene=scene==='title'?'title':'game';
      this._onTrackChange=onTrackChange;this._onPlaybackError=onPlaybackError;this._onPlaybackBlocked=onPlaybackBlocked;this._onStateChange=onStateChange;
      this._context=null;this._master=null;this._compressor=null;this._reverb=null;
      this._currentId=null;this._session=null;this._playing=false;this._auto=true;
      this._timer=null;this._pauseTimer=null;this._token=0;this._resumePosition=0;this._disposed=false;
      this._daypartTimer=null;this._daypartSync=null;
      this._noise=null;this._drumCache=new Map();this._pluckCache=new Map();this._waveCache=new Map();this._sessions=new Set();
      this._voices=new Set();this._sourceCount=0;this._droppedVoices=0;
      this._audioElement=null;this._streamDestination=null;this._audioSession=null;
      this._previousSessionType=null;this._ownsAudioSession=false;this._outputToken=0;this._pageActive=true;this._voiceActive=false;
      this._visibilityHandler=()=>this._onVisibility();
      this._pageHideHandler=()=>{this._pageActive=false;this._cancelPendingResume();this._clearScheduler();this._clearDaypartTimer();this._suspendOutput();};
      this._pageShowHandler=()=>{this._pageActive=true;return this._onVisibility();};
      this._contextStateHandler=()=>{
        if(this._context?.state==='running'&&this._playing&&!this._hidden()){this._schedule();this._armDaypartTimer();}
        else{this._clearScheduler();this._clearDaypartTimer();}
        this._notifyState();
      };
      this._audioSessionHandler=()=>{
        // Let the browser finish calls/other exclusive audio before resuming.
        // Repeated resume() calls here would steal audio focus back from it.
        if(this._audioSession?.state==='interrupted'){
          this._cancelPendingResume();
          this._clearScheduler();this._clearDaypartTimer();
          if(this._session?.recording)this._smoothGain(this._session.recording.gain.gain,0,.035);
        }else if(this._audioSession?.state==='active'){
          return this._onVisibility();
        }
      };
      if(typeof document!=='undefined')document.addEventListener('visibilitychange',this._visibilityHandler);
      global.addEventListener?.('pagehide',this._pageHideHandler);
      global.addEventListener?.('pageshow',this._pageShowHandler);
    }
    get currentId(){return this._currentId;}
    get playing(){return this._playing;}
    get auto(){return this._auto;}
    get volume(){return this._volume;}
    get scene(){return this._scene;}
    get resuming(){return Boolean(this._daypartSync);}
    get audible(){return Boolean(this._playing&&this._volume>0&&!this._hidden()&&this._context?.state==='running'&&this._audioSession?.state!=='interrupted'&&this._session&&(!trackById.get(this._currentId)?.recordingOnly||this._session.recording));}
    _notifyState(){if(typeof this._onStateChange==='function')this._onStateChange();}
    _cancelPendingResume(){if(this._daypartSync){++this._token;this._daypartSync=null;this._notifyState();}}
    setScene(value){
      const scene=value==='title'?'title':'game';if(scene===this._scene)return;
      this._scene=scene;this._clearDaypartTimer();
      if(this._daypartSync){++this._token;this._daypartSync=null;}
      this._armDaypartTimer();
    }
    setAuto(value){
      const automatic=Boolean(value);if(automatic===this._auto)return;
      this._auto=automatic;this._clearDaypartTimer();
      if(!automatic&&this._daypartSync){++this._token;this._daypartSync=null;}
      this._armDaypartTimer();
    }
    setVoiceActive(value){
      const active=value===true;if(active===this._voiceActive)return Promise.resolve();
      this._voiceActive=active;
      // Release the music playback category before microphone capture. Keep the
      // user's playback intent and volume, so ending a call resumes the score.
      if(active){this._cancelPendingResume();this._clearScheduler();this._clearDaypartTimer();clearTimeout(this._pauseTimer);this._pauseTimer=null;return this._suspendOutput();}
      return this._onVisibility();
    }
    setVolume(value){
      this._volume=clamp(Number(value)||0,0,100);
      if(this._context&&this._master)this._smoothGain(this._master.gain,this._playing?this._volume/100*.65:0,.08);
      if(!this._playing||!this._context)return;
      if(!this._volume){this._cancelPendingResume();this._clearScheduler();this._clearDaypartTimer();this._suspendOutput();}
      else if(!this._hidden())this._onVisibility();
    }
    _hidden(){return this._voiceActive||!this._pageActive||(typeof document!=='undefined'&&document.hidden);}
    _clearDaypartTimer(){clearTimeout(this._daypartTimer);this._daypartTimer=null;}
    _canAutoSync(){return this._auto&&this._playing&&this._volume>0&&!this._hidden()&&!this._disposed&&this._audioSession?.state!=='interrupted';}
    _armDaypartTimer(){
      this._clearDaypartTimer();
      if(!this._canAutoSync()||this._scene==='title')return;
      // Check at the boundary, with at most one quiet wall-clock check per
      // minute so a changed device clock/timezone does not leave a stale track.
      const delay=Math.min(60000,nextDaypartDelay()+25);
      this._daypartTimer=setTimeout(()=>{
        this._daypartTimer=null;
        if(!this._canAutoSync())return;
        const change=this._syncDaypartTrack();
        if(change)change.catch(error=>this._playbackFailed(error));
        else this._armDaypartTimer();
      },delay);
    }
    _syncDaypartTrack(forceResume=false){
      if(!this._playing||!this._volume||this._hidden()||this._disposed||this._audioSession?.state==='interrupted'||!this._auto&&!forceResume)return null;
      const id=this._auto?automaticTrackId(this._scene):this._currentId;if(id===this._currentId&&!forceResume)return null;
      if(this._daypartSync?.id===id)return this._daypartSync.promise;
      const pending={id,promise:null};this._daypartSync=pending;
      this._notifyState();
      pending.promise=this.attemptPlayback(id).then(outcome=>{
        if(outcome==='waiting')this._playbackFailed(Object.assign(new Error('音声の再生は操作を待っています。'),{name:'NotAllowedError'}));
        else if(outcome==='playing'&&!this._hidden()&&this._volume&&this._audioSession?.state!=='interrupted'){
          if(this._session?.recording)this._smoothGain(this._session.recording.gain.gain,1,.10);
          this._notifyState();
        }
      }).finally(()=>{if(this._daypartSync===pending){this._daypartSync=null;this._notifyState();}});
      return pending.promise;
    }
    _playbackFailed(error){
      if(this._disposed)return;
      this.pause();
      if(error?.name==='NotAllowedError'){
        if(typeof this._onPlaybackBlocked==='function')this._onPlaybackBlocked(error);
      }else if(typeof this._onPlaybackError==='function')this._onPlaybackError(error);
    }
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
    async attemptPlayback(id=this._auto?automaticTrackId(this._scene):this._currentId||SCORES[0].id){
      // Some autoplay policies keep resume() pending instead of rejecting it.
      // A single bounded attempt exposes that state without claiming playback
      // or allowing a late promise to override a later stop/track selection.
      let timer;
      // Even a same-track resume needs its own epoch: an earlier pending
      // attempt's deadline must never pause a newer successful gesture retry.
      ++this._token;
      const attempt=this.play(id),token=this._token;
      try{
        const outcome=await Promise.race([
          attempt.then(()=> 'settled'),
          new Promise(resolve=>{timer=setTimeout(()=>resolve('pending'),1000);})
        ]);
        if(outcome==='pending'){
          if(token!==this._token||this._disposed||!this._volume||this._hidden()||this._audioSession?.state==='interrupted')return 'cancelled';
          this.pause();await this._suspendOutput();return 'waiting';
        }
        return this._playing&&this._currentId===id?'playing':'cancelled';
      }catch(error){if(error?.name==='NotAllowedError')return 'waiting';throw error;}
      finally{clearTimeout(timer);}
    }
    async play(id=this._auto?automaticTrackId(this._scene):this._currentId||SCORES[0].id){
      if(this._disposed)throw new Error('Music player has been disposed.');
      if(!trackById.has(id))throw new RangeError(`Unknown music track: ${id}`);
      if(this._playing&&this._currentId===id){
        const token=this._token;
        try {if(await this._resumeOutput()){this._schedule();this._armDaypartTimer();}}
        catch(error){if(token!==this._token||this._disposed)return;this.pause();throw error;}
        return;
      }
      const token=++this._token;
      this._clearDaypartTimer();
      clearTimeout(this._pauseTimer);this._pauseTimer=null;
      this._ensureContext();
      try {if(!this._hidden()&&this._volume)await this._resumeOutput();}
      catch(error){if(token!==this._token||this._disposed)return;this.pause();throw error;}
      if(token!==this._token||this._disposed)return;
      this._clearScheduler();
      const same=id===this._currentId,position=same?this._resumePosition:0;
      this._retire(this._session,.25);
      this._currentId=id;this._playing=true;this._resumePosition=0;
      const track=trackById.get(id),score=track.recordingOnly
        ?{events:[],secondsPerBeat:1,duration:track.duration,sections:[]}
        :compile(byId.get(id)),ctx=this._context;
      const bus=ctx.createGain(),roomBus=ctx.createGain();bus.gain.value=0;roomBus.gain.value=0;bus.connect(this._compressor);roomBus.connect(this._reverb);
      const session={id,bus,roomBus,score,voices:new Set(),recording:null,recordingTried:false,active:true,start:ctx.currentTime+.055-position,position,eventIndex:0,cycle:0};
      while(session.eventIndex<score.events.length&&score.events[session.eventIndex].beat*score.secondsPerBeat<position)session.eventIndex++;
      this._session=session;this._sessions.add(session);
      bus.gain.linearRampToValueAtTime(1,ctx.currentTime+.25);
      roomBus.gain.linearRampToValueAtTime(1,ctx.currentTime+.25);
      this._smoothGain(this._master.gain,this._volume/100*.65,.1);
      if(!this._hidden()&&this._volume)this._schedule();
      else await this._suspendOutput();
      this._armDaypartTimer();
      if(typeof this._onTrackChange==='function')this._onTrackChange(TRACKS.find(t=>t.id===id));
      this._notifyState();
    }
    pause(){
      ++this._token;this._playing=false;this._daypartSync=null;this._clearScheduler();this._clearDaypartTimer();
      this._notifyState();
      clearTimeout(this._pauseTimer);this._pauseTimer=null;
      const ctx=this._context;if(!ctx)return;
      if(this._session)this._resumePosition=trackById.get(this._session.id).recordingOnly&&!this._session.recording
        ?this._session.position:Math.max(0,(ctx.currentTime-this._session.start)%this._session.score.duration);
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
      if(this._hidden()||!this._volume) {
        this._cancelPendingResume();
        this._clearScheduler();this._clearDaypartTimer();clearTimeout(this._pauseTimer);this._pauseTimer=null;
        await this._suspendOutput();
      } else if(this._playing) {
        try {
          // A first foregrounding can be the browser's first real autoplay
          // attempt. Apply the same finite wait and gesture handoff as startup.
          const change=this._syncDaypartTrack(true);if(change)await change;
        }catch(error){this._playbackFailed(error);}
      }
    }
    async _loadRecording(session){
      const ctx=this._context,track=trackById.get(session.id);
      if(!track)return;
      const abort=typeof AbortController==='function'?new AbortController():null;
      session.recordingRequest=abort;
      try{
        if(!global.fetch||!ctx.decodeAudioData)throw new Error('音源を再生できません。対応するブラウザでお試しください。');
        const response=await global.fetch(track.recording,{credentials:'same-origin',signal:abort?.signal});
        if(!session.active)return;
        if(!response.ok)throw new Error('音源を読み込めませんでした。通信を確認して、再生ボタンでお試しください。');
        const bytes=await response.arrayBuffer();
        if(!session.active||this._disposed)return;
        const buffer=await ctx.decodeAudioData(bytes);
        if(!session.active||this._disposed||this._session!==session)return;
        // The MP3 contains encoder delay/padding metadata. Browser decoding
        // removes these samples so loop points describe the written bars.
        const seconds=track.recordingOnly?buffer.duration:Math.min(buffer.duration,track.duration);
        if(!Number.isFinite(seconds)||seconds<1)throw new Error('音源の読み込みを完了できませんでした。再生ボタンでお試しください。');
        const source=ctx.createBufferSource(),gain=ctx.createGain(),now=ctx.currentTime;
        source.buffer=buffer;source.loop=true;source.loopStart=0;source.loopEnd=seconds;
        // Supplied recordings have no substitute synthesized score. Preserve
        // their complete decoded audio and start at the saved position only
        // once loading is complete, without skipping the opening while loading.
        if(track.recordingOnly){session.score.duration=seconds;session.start=now+.025-session.position;}
        const start=Math.max(now+.025,session.start),offset=Math.max(0,start-session.start)%seconds;
        gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(this._audioSession?.state==='interrupted'?0:1,start+.18);
        source.connect(gain);gain.connect(this._master);
        source.onended=()=>{
          source.disconnect();gain.disconnect();source.buffer=null;
          if(session.recording?.source===source)session.recording=null;
          if(!session.active&&!session.voices.size)this._releaseSession(session);
        };
        source.start(start,offset);
        session.recording={source,gain};
        this._smoothGain(session.bus.gain,0,.18);
        this._smoothGain(session.roomBus.gain,0,.18);
        this._clearScheduler();
        this._notifyState();
      }catch(error){
        if(track.recordingOnly&&session.active&&this._session===session&&!this._disposed)this._playbackFailed(error);
        // Offline with no cached master, an interrupted request, or an old
        // decoder retain the local performance only for the sixteen scores.
      }finally{if(session.recordingRequest===abort)session.recordingRequest=null;}
    }
    _schedule(){
      this._clearScheduler();
      if(!this._playing||!this._volume||this._hidden()||this._disposed||!this._session||this._context?.state!=='running'||this._audioSession?.state==='interrupted')return;
      const s=this._session,ctx=this._context,horizon=ctx.currentTime+.18,events=s.score.events;
      if(!s.recordingTried){s.recordingTried=true;this._loadRecording(s);}
      if(s.recording)return;
      if(!events.length)return;
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
      session.active=false;session.recordingRequest?.abort();
      if(session.recording){
        this._smoothGain(session.recording.gain.gain,0,fade);
        try{session.recording.source.stop(this._context.currentTime+fade+.025);}catch(_){}
      }
      this._smoothGain(session.bus.gain,0,fade);
      if(session.roomBus)this._smoothGain(session.roomBus.gain,0,fade);
      const stop=this._context.currentTime+fade+.025;
      for(const voice of session.voices){voice.endTime=Math.min(voice.endTime,stop);for(const source of voice.sources){try{source.stop(stop);}catch(_){}}}
      if(!session.voices.size&&!session.recording)this._releaseSession(session);
    }
    _releaseSession(session){
      if(session.recording){
        const {source,gain}=session.recording;source.onended=null;
        try{source.stop();source.disconnect();gain.disconnect();source.buffer=null;}catch(_){}
        session.recording=null;
      }
      try{session.bus.disconnect();session.roomBus?.disconnect();}catch(_){}
      this._sessions.delete(session);
    }
    _disconnectVoice(voice){
      if(voice.closed)return;voice.closed=true;
      for(const node of [...voice.sources,...voice.nodes]){try{node.disconnect();}catch(_){}}
      this._voices.delete(voice);this._sourceCount=Math.max(0,this._sourceCount-voice.sources.length);
      voice.session.voices.delete(voice);
      if(!voice.session.active&&!voice.session.voices.size&&!voice.session.recording)this._releaseSession(voice.session);
    }
    _pruneVoices(now){
      // Normally onended performs this work. Also prune by audio time after a
      // throttled tab resumes; delayed callbacks must not consume the budget.
      for(const voice of this._voices)if(voice.endTime<=now)this._disconnectVoice(voice);
    }
    _ensembleWave(kind,midi){
      const ctx=this._context;if(!ctx.createPeriodicWave)return null;
      const key=kind+':'+midi;if(this._waveCache.has(key))return this._waveCache.get(key);
      const real=new Float32Array(49),imag=new Float32Array(49),hz=frequency(midi);
      const bell=(value,center,width)=>Math.exp(-.5*Math.pow((value-center)/width,2));
      for(let harmonic=1;harmonic<imag.length;harmonic++){
        let amplitude;
        if(kind==='choir'){
          const at=hz*harmonic;
          amplitude=(.75*bell(at,710,170)+.48*bell(at,1200,230)+.18*bell(at,2500,410)+.12/harmonic)/Math.pow(harmonic,.45);
          if(at>ctx.sampleRate*.45)amplitude=0;
        }else{
          const at=hz*harmonic;
          // A bowed body has broad wood resonances. The horn's bell gives
          // its upper mids a different focus at each position in its range.
          const body=kind==='brass'
            ? .42+.70*bell(at,860,430)+.37*bell(at,1800,620)
            : .33+.86*bell(at,440,160)+.51*bell(at,1040,350)+.40*bell(at,2450,510);
          amplitude=body*Math.exp(-harmonic/23)/Math.pow(harmonic,kind==='brass'?.79:.93);
          if(at>ctx.sampleRate*.45)amplitude=0;
        }
        imag[harmonic]=amplitude;
      }
      const wave=ctx.createPeriodicWave(real,imag);
      if(this._waveCache.size>=40)this._waveCache.delete(this._waveCache.keys().next().value);
      this._waveCache.set(key,wave);return wave;
    }
    _pluckBuffer(midi,kind='pluck'){
      const key=kind+':'+midi;
      if(this._pluckCache.has(key))return this._pluckCache.get(key);
      const rate=Math.min(this._context.sampleRate,32000),hz=frequency(midi),lute=kind==='shamisen';
      const buffer=this._context.createBuffer(1,Math.ceil(rate*(lute?1.85:2.55)),rate);
      const out=buffer.getChannelData(0);
      // A triangular displacement locates the plectrum on the string. A
      // fractionally tuned delay line damps its high partials on each round.
      const period=rate/hz+.5,size=Math.max(4,Math.floor(period)),fraction=period-size;
      const ring=new Float32Array(size),pluckAt=lute?.12:.21;
      let seed=midi*431+37,previous=0,dc=0,soundboard=0,prior=0;
      for(let i=0;i<size;i++){
        const phase=i/size;
        seed=(Math.imul(seed,1664525)+1013904223)>>>0;
        ring[i]=.92*((phase<pluckAt?phase/pluckAt:(1-phase)/(1-pluckAt))-.5)
          +(seed/4294967296-.5)*(lute?.32:.12);
      }
      const radius=Math.exp(-1/(rate*.038)),center=lute?740:330;
      const first=2*radius*Math.cos(2*Math.PI*center/rate),second=radius*radius;
      const loss=lute?.991:.996,bodyDrive=Math.sin(2*Math.PI*center/rate)*.022;
      let pos=0,bridge=0;
      for(let i=0;i<out.length;i++){
        const raw=ring[pos],next=ring[(pos+1)%size];
        const average=(raw+next)*.5;
        ring[pos]=loss*((1-fraction)*average+fraction*previous);
        previous=average;
        pos=(pos+1)%size;
        dc+=.007*(raw-dc);
        const string=raw-dc;
        // The lute's buzzing bridge clips the positive displacement. Its
        // soundboard continues to ring briefly after each change of direction.
        const buzz=lute?Math.max(0,string-.12)*.39:0;
        const strike=string+buzz-bridge;
        bridge=string+buzz;
        const resonant=first*soundboard-second*prior+bodyDrive*strike;
        prior=soundboard;soundboard=resonant;
        const body=bridge*1.28+soundboard*.5;
        out[i]=Math.min(1,i/(rate*.0025),(out.length-i)/(rate*.018))*Math.tanh(body);
      }
      if(this._pluckCache.size>=64)this._pluckCache.delete(this._pluckCache.keys().next().value);
      this._pluckCache.set(key,buffer);
      return buffer;
    }
    _drumBuffer(kind,alternate){
      const key=kind+':'+alternate;
      if(this._drumCache.has(key))return this._drumCache.get(key);
      const [fundamental,snap,modes]=DRUM_MODELS[kind],rate=Math.min(24000,this._context.sampleRate);
      const length=Math.ceil(voiceLifetime(kind,.32)*rate),buffer=this._context.createBuffer(1,length,rate);
      const out=buffer.getChannelData(0),tuning=alternate?1.024:.989;
      let seed=kind.length*919+alternate*1613,grain=0,oldNoise=0,attack=1;
      const attackDecay=Math.exp(-1/(snap*rate));
      for(let i=0;i<length;i++){
        seed=(Math.imul(seed,1664525)+1013904223)>>>0;
        const noise=seed/2147483648-1;
        grain+=.37*((noise-oldNoise)-grain);oldNoise=noise;
        out[i]=attack*grain*.46;
        attack*=attackDecay;
      }
      for(const [ratio,amplitude,decay] of modes){
        const omega=2*Math.PI*fundamental*tuning*ratio/rate,radius=Math.exp(-1/(rate*decay));
        const first=2*radius*Math.cos(omega),second=radius*radius;
        let previous=0,older=-Math.sin(omega)*amplitude*(alternate&&ratio>2?.86:1);
        for(let i=0;i<length;i++){
          const sample=first*previous-second*older;
          out[i]+=sample;older=previous;previous=sample;
        }
      }
      for(let i=0;i<length;i++)
        out[i]=Math.tanh(out[i]*1.23)*Math.min(1,i/(rate*.002),(length-i)/(rate*.012));
      this._drumCache.set(key,buffer);
      return buffer;
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
      if(pan.pan)pan.pan.value=clamp(event.pan||0,-.72,.72);nodes.push(pan);envelope.connect(pan);pan.connect(event.part==='effect'&&session.recording?this._compressor:session.bus);
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
        const hz=frequency(event.midi),osc=addOsc('sine',hz*(event.part==='ornament'?.972:.989));
        addOsc('sine',hz*2,.23);addOsc('sine',hz*3,.075);
        const breath=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),gain=ctx.createGain();breath.buffer=this._noise;breath.loop=true;filter.type='bandpass';filter.frequency.value=Math.min(hz*2.7,ctx.sampleRate*.43);gain.gain.setValueAtTime(.14,time);gain.gain.linearRampToValueAtTime(.046,time+Math.min(.07,end*.32));
        breath.connect(filter);filter.connect(gain);gain.connect(envelope);sources.push(breath);nodes.push(filter,gain);
        osc.frequency.linearRampToValueAtTime(hz,time+.045);
        // A breath attack and delayed, shallow vibrato make held phrases sing.
        for(let step=1;step<=Math.ceil(end/.11);step++){
          const offset=Math.min(end,.11*step),depth=clamp((offset-.18)/.4,0,1)*.0036;
          osc.frequency.linearRampToValueAtTime(hz*(1+Math.sin(offset*31)*depth),time+offset);
        }
        swell(velocity*.25,.048,.13);
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
          swell(velocity*.25,event.part==='lead'?.047:.074,.14);
        }else if(kind==='choir')swell(velocity*.13,.32,.40);
        else swell(velocity*.23,event.part==='ostinato'?.024:event.part==='lead'?.075:.21,.22);
      }else if(event.type==='sho'){
        const hz=frequency(event.midi);addOsc('sine',hz);addOsc('triangle',hz*2,.24);swell(velocity*.18,.30,.30);
      }else if(event.type==='kane'){
        const hz=frequency(event.midi)*2;addOsc('sine',hz);addOsc('sine',hz*2.756,.19);addOsc('sine',hz*5.404,.045);
        envelope.gain.setValueAtTime(.0001,time);envelope.gain.linearRampToValueAtTime(velocity*.10,time+.003);envelope.gain.exponentialRampToValueAtTime(.0001,time+2.8);
      }else if(['tsuzumi','taiko','odaiko','wood'].includes(event.type)){
        const source=ctx.createBufferSource();
        source.buffer=this._drumBuffer(event.type,event.alternate||0);
        source.connect(envelope);sources.push(source);
        envelope.gain.setValueAtTime(velocity*(event.type==='wood'?.21:.48),time);
      }else if(event.type==='bell'){
        const hz=frequency(event.midi);addOsc('sine',hz);addOsc('sine',hz*2.01,.20);addOsc('sine',hz*3.98,.045);
        envelope.gain.setValueAtTime(.0001,time);envelope.gain.linearRampToValueAtTime(velocity*.16,time+.008);envelope.gain.exponentialRampToValueAtTime(.0001,time+end+1);
      }else if(event.type==='bass'){
        addOsc('sine',frequency(event.midi));addOsc('triangle',frequency(event.midi)*2,.09);
        envelope.gain.setValueAtTime(0,time);envelope.gain.linearRampToValueAtTime(velocity*.25,time+.03);envelope.gain.exponentialRampToValueAtTime(.0001,time+end);
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
      if(this._disposed)return;this._disposed=true;++this._token;this._playing=false;this._daypartSync=null;
      this._clearScheduler();this._clearDaypartTimer();clearTimeout(this._pauseTimer);this._pauseTimer=null;
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
      this._sessions.clear();this._drumCache.clear();this._pluckCache.clear();this._waveCache.clear();this._session=null;this._noise=null;
      if(this._reverb)this._reverb.buffer=null;
    }
    // Read-only score summaries permit deterministic integrity checks without audio.
    static inspect(id){
      const track=trackById.get(id);
      if(track?.recordingOnly)return {id,recordingOnly:true,duration:track.duration,eventCount:0,sections:[],instruments:[],events:[]};
      const t=byId.get(id);if(!t)throw new RangeError('Unknown track');const s=compile(t);
      return {id,duration:s.duration,eventCount:s.events.length,sections:s.sections.map(section=>({...section})),estimatedPeak:{...s.peak},voiceBudget:{voices:VOICE_LIMIT,sources:SOURCE_LIMIT},instruments:[...new Set(s.events.map(event=>event.type))],events:s.events.map(e=>({...e}))};
    }
    static daypartTrackId(date){return daypartTrackId(date);}
    static automaticTrackId(scene,date){return automaticTrackId(scene,date);}
    static nextDaypartDelay(date){return nextDaypartDelay(date);}
  }
  global.SENGOKU_MUSIC_TRACKS=TRACKS;
  global.SengokuMusic=SengokuMusic;
})(typeof window!=='undefined'?window:globalThis);
