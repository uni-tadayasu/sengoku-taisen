import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fixture } from './helpers/music-fixture.mjs';

const {setup}=createRequire(import.meta.url)('./helpers/dom-model.cjs');
const appSource=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const local=(hour,minute=0,second=0,millisecond=0)=>new Date(2026,10,26,hour,minute,second,millisecond);
const flush=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
const make=(hour,minute=0,second=0,options={})=>fixture({recordings:true,media:true,decodeDuration:600,now:local(hour,minute,second),...options});
async function recording(f,index=f.files.length-1){
  assert(f.files[index],'the selected recording is requested');
  f.files[index].resolve({ok:true,arrayBuffer:async()=>new ArrayBuffer(4)});
  await flush();
}
async function clockCheck(f,date){
  const timer=[...f.timers].find(([,timer])=>timer.ms!==50&&timer.ms!==280);
  assert(timer,'audible automatic playback has a clock check');
  assert(timer[1].ms>0&&timer[1].ms<=60000,'a device-clock change is reconsidered within one minute');
  f.setNow(date);f.timers.delete(timer[0]);await timer[1].fn();await flush();
}
function liveSessions(player){return [...player._sessions].filter(session=>session.active);}
function appFixture(hour,minute=0,second=0,options={}){
  const f=make(hour,minute,second,options),c=f.context,calls=[],{doc:controls}=setup();
  f.document.querySelectorAll=()=>[];f.document.querySelector=()=>null;
  Object.assign(c,{
    settings:{sound:false,volume:31,musicMode:'auto',track:''},currentView:'town',musicPage:1,activeModal:'',startPending:false,SENGOKU_AT_TITLE:false,
    state:()=>({turn:1}),safeSettings:()=>calls.push('save-preferences'),renderHeader:()=>calls.push('render-header'),
    toast:(...args)=>calls.push(['toast',...args]),modal:()=>calls.push('music-modal'),pageControls:()=>'',esc:String,
    mutationActions:new Set(),requireWritable:()=>true,$:()=>null,updateCatalogSearch:()=>false,updateBranchTroopDraft:()=>false
  });
  const stateLine=appSource.split('\n').find(line=>line.startsWith('  let music=null,voiceAudioActive=false'));
  const start=appSource.indexOf('  function setVoiceActive(value)'),clickStart=appSource.indexOf("  document.addEventListener('click',async event=>");
  assert(start>=0&&clickStart>start,'production music helpers are loaded');
  const clickEnd=appSource.indexOf("\n  document.addEventListener('submit'",clickStart);
  const input=appSource.split('\n').find(line=>line.startsWith("  document.addEventListener('input',"));
  vm.runInContext(stateLine+'\n'+appSource.slice(start,clickStart)+appSource.slice(clickStart,clickEnd)+'\n'+input+'\nthis.musicPlayer=()=>music;',c);
  const press=async(action,id='')=>{
    const node=controls.createElement('button');node.setAttribute('data-action',action);node.setAttribute('data-id',id);
    await f.listeners.get('click')({type:'click',isTrusted:true,target:node,button:0});await flush();
  };
  const volume=async value=>{
    const node=controls.createElement('input');node.setAttribute('id','volume');node.setAttribute('type','range');node.value=String(value);
    await f.listeners.get('input')({type:'input',isTrusted:true,target:node});await flush();
  };
  return {...f,c,appCalls:calls,press,volume};
}
function startupFixture(options={}){
  const f=appFixture(8,0,0,options),storage=new Map(),writes=[];
  if(options.preferences!==undefined)storage.set('sengoku-tento-settings-v1',JSON.stringify(options.preferences));
  Object.assign(f.c,{
    settingsKey:'sengoku-tento-settings-v1',SENGOKU_AT_TITLE:true,startPending:true,
    localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>{storage.set(key,value);writes.push([key,value]);}}
  });
  const init=appSource.slice(appSource.indexOf('  let settings={'),appSource.indexOf('  try{const raw=localStorage.getItem(saveKey)'));
  const save=appSource.split('\n').find(line=>line.startsWith('  function safeSettings('));
  vm.runInContext(init+'\nthis.settings=settings;\n'+save,f.c);
  return {...f,storage,writes};
}
async function activation(f,trusted=true){
  const target={tagName:'DIV',isContentEditable:false,closest:()=>null,matches:()=>false};
  const event={type:'click',isTrusted:trusted,target,button:0};
  if(f.listeners.has('click'))await f.listeners.get('click')(event);
  if(f.windowListeners.has('click'))await f.windowListeners.get('click')(event);
  await flush();
}
let passed=0;
async function test(name,run){await run();passed++;console.log('PASS '+name);}

await test('the four supplied recordings coexist with all sixteen composed tracks',()=>{
  const f=make(8),expected=[['shitaku','支度',57.6],['asakatsu','朝活',202.52],['hirukatsu','昼活',359.88],['yorukatsu','夜活',170]];
  assert.equal(f.Tracks.length,20);assert.equal(new Set(f.Tracks.map(track=>track.id)).size,20);
  assert.equal(f.Tracks.filter(track=>!track.recordingOnly).length,16);
  assert.equal(f.Tracks.filter(track=>track.recordingOnly).length,4);
  for(const [id,name,duration] of expected){
    const track=f.Tracks.find(track=>track.id===id);assert(track,id);assert.equal(track.name,name);
    assert.equal(track.recordingOnly,true);assert(Number.isFinite(track.duration)&&track.duration>0);if(duration!==undefined)assert.equal(track.duration,duration);
    assert.equal(track.recording,'assets/music/'+id+'.mp3','stable recording URL remains eligible in later service-worker releases');
    const score=f.Music.inspect(id);assert.equal(score.eventCount,0);assert.equal(score.events.length,0);assert.equal(score.sections.length,0);
  }
});

await test('05:00, 12:00 and 18:00 use the device local clock, including midnight and a non-UTC timezone',()=>{
  const {Music}=make(8),originalTZ=process.env.TZ;
  try{
    for(const timezone of ['UTC','Asia/Tokyo']){
      process.env.TZ=timezone;
      const cases=[[0,0,0,0,'yorukatsu'],[4,59,59,999,'yorukatsu'],[5,0,0,0,'asakatsu'],[11,59,59,999,'asakatsu'],[12,0,0,0,'hirukatsu'],[17,59,59,999,'hirukatsu'],[18,0,0,0,'yorukatsu'],[23,59,59,999,'yorukatsu']];
      for(const [hour,minute,second,ms,id] of cases)assert.equal(Music.daypartTrackId(local(hour,minute,second,ms)),id,timezone+' '+hour+':'+minute);
      assert.equal(Music.nextDaypartDelay(local(4,59,59,999)),1);
      assert.equal(Music.nextDaypartDelay(local(11,59,59,999)),1);
      assert.equal(Music.nextDaypartDelay(local(17,59,59,999)),1);
      assert.equal(Music.nextDaypartDelay(local(18)),11*60*60*1000,'night crosses the calendar boundary');
    }
  }finally{if(originalTZ===undefined)delete process.env.TZ;else process.env.TZ=originalTZ;}
});

await test('all four town appearances follow the BGM clock in place even when sound is off',()=>{
  const f=make(4,59,59),{host,$,doc}=setup(),c=f.context;
  host.innerHTML='<div class="town-scene"><img class="town-scene-backdrop" alt=""><div class="town-scene-board"><img class="town-scene-image"><button id="town-marker">施設</button></div></div><span data-town-phase-label></span>';
  let equipped=null;
  c.$=$;c.currentView='town';
  c.SengokuPremiumRuntime={getAppearance:()=>({town:equipped})};
  vm.runInContext(fs.readFileSync(new URL('../premium-catalog.js',import.meta.url),'utf8'),c);
  vm.runInContext(appSource.slice(appSource.indexOf('  function townSceneArt('),appSource.indexOf('  function premiumTownBanner(')),c);
  const marker=$('#town-marker'),front=$('.town-scene-image'),back=$('.town-scene-backdrop');
  marker.focus();
  for(const [theme,original] of [['castle-town-raden','night'],['moonlit-castle','night'],['sakura-town','day'],['snow-town','morning']]){
    equipped=theme==='castle-town-raden'?null:theme;
    c.refreshTownArt(true); // Equipment can switch within the same time of day.
    for(const [hour,phase,label] of [[5,'morning','朝'],[12,'day','昼'],[18,'night','夜']]){
      f.setNow(local(hour));c.refreshTownArt();
      const stem=theme+(phase===original?'':'-'+phase);
      assert.equal(f.Music.daypart(),phase);
      assert.equal($('.town-scene').dataset.townDaypart,phase);
      assert.equal($('[data-town-phase-label]').textContent,label);
      assert.match(front.alt,new RegExp(label));
      assert.equal(back.getAttribute('alt'),'');
      const srcset=[400,720,1080,1536].map(width=>'assets/responsive/'+stem+'-'+width+'.webp '+width+'w').join(', ');
      assert.equal(front.getAttribute('srcset'),srcset);
      assert.equal(back.getAttribute('srcset'),srcset);
      for(const candidate of srcset.split(', ')){
        const [file]=candidate.split(' ');
        assert(fs.existsSync(new URL('../'+file,import.meta.url)),file);
      }
      assert.equal(front.getAttribute('src'),back.getAttribute('src'));
      assert.equal($('.town-scene-image'),front);
      assert.equal(doc.activeElement,marker);
    }
  }
  f.document.hidden=true;f.setNow(local(5));c.refreshTownArt();
  assert.equal($('.town-scene').dataset.townDaypart,'night');
  f.document.hidden=false;c.refreshTownArt();
  assert.equal($('.town-scene').dataset.townDaypart,'morning');
  assert.equal(f.contexts.length,0);
});

await test('the shipped town renderer resolves a missing phase argument at game entry',()=>{
  const bundle=fs.readFileSync(new URL('../game-interface.bundle.js',import.meta.url),'utf8');
  // The build keeps named functions. Execute the shipped helper itself, including
  // code generated for optional calls, without mounting the entire game shell.
  const start=bundle.indexOf('function townSceneArt('),end=bundle.indexOf('function refreshTownArt(',start);
  assert(start>=0&&end>start,'shipped town scene helpers are present');
  const f=make(5),c=f.context;
  let equipped=null;
  c.SengokuPremiumRuntime={getAppearance:()=>({town:equipped})};
  vm.runInContext(fs.readFileSync(new URL('../premium-catalog.js',import.meta.url),'utf8'),c);
  vm.runInContext(bundle.slice(start,end),c,{filename:'shipped-town-scene.js'});
  for(const [hour,phase,skin,stem] of [
    [5,'morning',null,'castle-town-raden-morning'],
    [12,'day','moonlit-castle','moonlit-castle-day'],
    [18,'night','sakura-town','sakura-town-night'],
    [6,'morning','snow-town','snow-town']
  ]){
    f.setNow(local(hour));equipped=skin;
    const art=c.townSceneArt();
    assert.equal(art.daypart,phase);
    assert(art.srcset.includes('assets/responsive/'+stem+'-400.webp 400w'));
  }
});

await test('an idle player does not start from a mode, clock or restoration event alone',async()=>{
  const f=make(4,59,59),player=new f.Music();player.setAuto(true);
  f.setNow(local(12));await f.listeners.get('visibilitychange')();await f.windowListeners.get('pageshow')();
  assert.equal(player.playing,false);assert.equal(f.contexts.length,0);assert.equal(f.files.length,0);assert.equal(f.timers.size,0);
  await player.dispose();
});

await test('all three live boundaries switch once and retire the preceding recording',async()=>{
  for(const [hour,from,to] of [[4,'yorukatsu','asakatsu'],[11,'asakatsu','hirukatsu'],[17,'hirukatsu','yorukatsu']]){
    const f=make(hour,59,59),changed=[],player=new f.Music({onTrackChange:track=>changed.push(track.id)});
    await player.play();await recording(f);assert.equal(player.currentId,from);assert.equal(player._session.recording.source.loop,true);
    assert.equal([...f.timers.values()][0].due,Number(local(hour+1,0,0,25)),'next live check is due at the boundary');
    const old=player._session,oldSource=old.recording.source;
    await clockCheck(f,local(hour+1,0,0,25));assert.equal(player.currentId,to);assert.equal(f.files.length,2);await recording(f);
    assert.deepEqual(changed,[from,to]);assert.equal(old.active,false);assert.equal(liveSessions(player).length,1);
    assert.equal(player._session.recording.source.loopEnd,600,'loop uses the full decoded file, not a rounded catalogue duration or generated score');
    player._context.advance(1);assert.equal(oldSource.buffer,null);assert.equal(oldSource.connections.length,0);assert.equal(player._sessions.size,1);
    assert.equal(f.mediaElements.length,1,'track changes retain a single output sink');
    await player.dispose();assert.equal(f.timers.size,0);
  }
});

await test('clock polls and screen changes keep the same recording and playback position',async()=>{
  const f=appFixture(9);await f.press('sound');await recording(f);const player=f.c.musicPlayer(),session=player._session;
  player._context.advance(8);const start=session.start,playCount=f.mediaElements[0].playCount;
  for(const view of ['map','army','research','town']){f.c.currentView=view;f.c.syncMusic(view==='army'?'battle':undefined);await flush();}
  await clockCheck(f,local(9,1));
  assert.strictEqual(player._session,session);assert.equal(session.start,start);assert.equal(f.files.length,1);assert.equal(f.mediaElements[0].playCount,playCount);
  assert.equal(player.currentId,'asakatsu');assert.equal(f.contexts.length,1);await player.dispose();
});

await test('visibility and page restoration catch up after a throttled background period without duplicate recordings',async()=>{
  const f=make(11,59,59),player=new f.Music();await player.play();await recording(f);
  f.document.hidden=true;await f.listeners.get('visibilitychange')();assert.equal(f.timers.size,0);assert.equal(player._context.state,'suspended');
  f.setNow(local(18,1));f.document.hidden=false;
  await Promise.all([f.listeners.get('visibilitychange')(),f.windowListeners.get('pageshow')()]);await flush();
  assert.equal(player.currentId,'yorukatsu');assert.equal(f.files.length,2);await recording(f);
  assert.equal(liveSessions(player).length,1);assert.equal(f.mediaElements.length,1);assert.equal(player._context.state,'running');await player.dispose();
});

await test('manual selection survives time changes and returning to automatic mode selects the current period',async()=>{
  const f=appFixture(11,59,59);await f.press('play-track','battle-storm');await recording(f);const player=f.c.musicPlayer(),manual=player._session;
  assert.equal(f.c.settings.musicMode,'manual');assert.equal(player.auto,false);
  f.setNow(local(18));f.c.currentView='map';f.c.syncMusic();await f.listeners.get('visibilitychange')();await flush();
  assert.equal(player.currentId,'battle-storm');assert.strictEqual(player._session,manual);assert.equal(f.files.length,1);
  await f.press('music-auto');assert.equal(player.currentId,'yorukatsu');assert.equal(player.auto,true);assert.equal(f.files.length,2);await recording(f);
  await player.dispose();
});

await test('stopping in either mode prevents clock, visibility and auto-mode selection from restarting playback',async()=>{
  for(const mode of ['auto','manual']){
    const f=appFixture(11,59,59);await f.press(mode==='auto'?'sound':'play-track','battle-storm');await recording(f);const player=f.c.musicPlayer();
    await f.press('music-stop');f.runTimer(280);const plays=f.mediaElements[0].playCount;
    f.setNow(local(18));await f.listeners.get('visibilitychange')();await f.windowListeners.get('pageshow')();await f.press('music-auto');f.c.syncMusic('battle');await flush();
    assert.equal(f.c.settings.sound,false);assert.equal(player.playing,false);assert.equal(f.files.length,1);assert.equal(f.mediaElements[0].playCount,plays);assert.equal(f.timers.size,0);
    await player.dispose();
  }
});

await test('zero volume postpones a boundary switch until unmuted and preserves the chosen volume',async()=>{
  const f=make(11,59,59),player=new f.Music({volume:37});await player.play();await recording(f);player.setVolume(0);await flush();
  assert.equal(f.timers.size,0);const plays=f.mediaElements[0].playCount;
  f.setNow(local(18));await f.listeners.get('visibilitychange')();assert.equal(f.mediaElements[0].playCount,plays);assert.equal(f.files.length,1);
  player.setVolume(37);await flush();assert.equal(player.currentId,'yorukatsu');assert.equal(player.volume,37);assert.equal(f.files.length,2);await recording(f);
  assert.equal(player._context.state,'running');await player.dispose();
});

await test('voice calls suppress clock changes and resume the correct period only if playback is still requested',async()=>{
  const f=make(11,59,59,{session:true}),player=new f.Music({volume:23});await player.play();await recording(f);await player.setVoiceActive(true);
  assert.equal(f.audioSession.type,'auto');assert.equal(f.timers.size,0);const resumes=f.calls.filter(call=>call==='context.resume').length;
  f.setNow(local(18));await f.listeners.get('visibilitychange')();assert.equal(f.calls.filter(call=>call==='context.resume').length,resumes);assert.equal(f.files.length,1);
  await player.setVoiceActive(false);await flush();assert.equal(player.currentId,'yorukatsu');assert.equal(player.volume,23);assert.equal(f.files.length,2);await recording(f);
  await player.setVoiceActive(true);player.pause();f.setNow(local(5));await player.setVoiceActive(false);await flush();
  assert.equal(player.playing,false);assert.equal(player._context.state,'suspended');assert.equal(f.files.length,2);assert.equal(f.timers.size,0);await player.dispose();
});

await test('platform interruptions do not fight for audio focus at a boundary',async()=>{
  const f=make(11,59,59,{session:true}),player=new f.Music();await player.play();await recording(f);
  f.audioSession.state='interrupted';player._context.state='interrupted';f.audioListeners.get('statechange')();player._context.listeners.get('statechange')();
  const resumes=f.calls.filter(call=>call==='context.resume').length;assert.equal(f.timers.size,0);f.setNow(local(12));
  await f.listeners.get('visibilitychange')();assert.equal(f.calls.filter(call=>call==='context.resume').length,resumes);assert.equal(f.files.length,1);
  f.audioSession.state='active';player._context.state='running';await f.audioListeners.get('statechange')();await flush();
  assert.equal(player.currentId,'hirukatsu');assert.equal(f.files.length,2);await recording(f);await player.dispose();
});

await test('a refused user start remains stopped through boundary and restore events and can be retried explicitly',async()=>{
  const f=appFixture(11,59,59),player=f.c.ensureAudio();player._ensureContext();
  f.mediaElements[0].playImpl=()=>Promise.reject(Object.assign(new Error('Tap required'),{name:'NotAllowedError'}));
  await f.press('sound');assert.equal(f.c.settings.sound,true);assert.equal(player.playing,false);assert.equal(f.files.length,0);
  if([...f.timers.values()].some(timer=>timer.ms===280))f.runTimer(280);
  const plays=f.mediaElements[0].playCount;f.setNow(local(12));await f.listeners.get('visibilitychange')();await f.windowListeners.get('pageshow')();f.c.syncMusic();await flush();
  assert.equal(f.mediaElements[0].playCount,plays);assert.equal(f.files.length,0);assert.equal(f.timers.size,0);
  f.mediaElements[0].playImpl=null;await f.press('music-resume');await recording(f);assert.equal(player.currentId,'hirukatsu');assert.equal(f.c.settings.sound,true);await player.dispose();
});

await test('a rejected boundary switch stops the player and does not repeatedly retry without a user action',async()=>{
  const f=appFixture(11,59,59);await f.press('sound');await recording(f);const player=f.c.musicPlayer();
  f.mediaElements[0].playImpl=()=>Promise.reject(Object.assign(new Error('Tap required'),{name:'NotAllowedError'}));
  await clockCheck(f,local(12));assert.equal(player.playing,false);assert.equal(f.c.settings.sound,true);assert.equal(f.files.length,1);
  if([...f.timers.values()].some(timer=>timer.ms===280))f.runTimer(280);
  const plays=f.mediaElements[0].playCount;f.setNow(local(18));await f.listeners.get('visibilitychange')();await f.windowListeners.get('pageshow')();await flush();
  assert.equal(f.mediaElements[0].playCount,plays);assert.equal(f.timers.size,0);await player.dispose();
});

await test('a pending automatic resume cannot restart music after the user stops it',async()=>{
  const f=appFixture(11,59,59);await f.press('sound');await recording(f);const player=f.c.musicPlayer();let resolve;
  f.mediaElements[0].playImpl=()=>new Promise(done=>{resolve=done;});
  await clockCheck(f,local(12));assert(resolve,'the automatic switch has a pending browser play request');
  await f.press('music-stop');f.runTimer(280);resolve();await flush();
  assert.equal(player.playing,false);assert.equal(f.c.settings.sound,false);assert.equal(player._session,null);assert.equal(f.files.length,1);assert.equal(f.timers.size,0);
  assert.equal(f.mediaElements[0].paused,true);await player.dispose();
});

await test('late failures from replaced automatic recordings cannot stop a newly selected manual track',async()=>{
  const f=appFixture(11,59,59);await f.press('sound');const player=f.c.musicPlayer(),morning=f.files[0];
  await clockCheck(f,local(12));const day=f.files[1];assert(morning.signal.aborted);
  await f.press('play-track','battle-storm');assert(day.signal.aborted);assert.equal(player.auto,false);
  morning.resolve({ok:false});day.resolve({ok:false});await flush();
  assert.equal(player.currentId,'battle-storm');assert.equal(player.playing,true);assert.equal(f.c.settings.sound,true);assert.equal(f.c.settings.musicMode,'manual');
  await recording(f);assert.equal(liveSessions(player).length,1);assert.equal(f.timers.size,0);assert(!f.appCalls.some(call=>Array.isArray(call)&&call[0]==='toast'));
  await player.dispose();
});

await test('failed supplied audio stays silent instead of playing an unrelated generated score',async()=>{
  const f=appFixture(8);await f.press('sound');const player=f.c.musicPlayer();f.files[0].resolve({ok:false});await flush();
  assert.equal(player.playing,false);assert.equal(f.c.settings.sound,true);assert.equal(player._voices.size,0);assert(!f.nodes.some(node=>node.kind==='oscillator'));
  if([...f.timers.values()].some(timer=>timer.ms===280))f.runTimer(280);
  f.setNow(local(12));await f.listeners.get('visibilitychange')();await flush();assert.equal(f.files.length,1);assert.equal(f.timers.size,0);await player.dispose();
});

await test('title and initial castle selection keep Shitaku, then campaign entry and return select the correct recording',async()=>{
  const f=appFixture(13);f.c.SENGOKU_AT_TITLE=true;f.c.startPending=true;
  await f.press('sound');await recording(f);const player=f.c.musicPlayer(),titleSession=player._session;
  assert.equal(player.currentId,'shitaku');assert.equal(f.timers.size,0,'the title track does not need daypart timers');
  f.c.SENGOKU_AT_TITLE=false;f.c.syncMusic();await flush();
  assert.equal(player.currentId,'shitaku');assert.strictEqual(player._session,titleSession);assert.equal(f.files.length,1,'castle selection is still preparation');
  f.c.startPending=false;f.c.syncMusic();await flush();assert.equal(player.currentId,'hirukatsu');assert.equal(f.files.length,2);await recording(f);
  f.c.SENGOKU_AT_TITLE=true;f.c.syncMusic();await flush();assert.equal(player.currentId,'shitaku');assert.equal(f.files.length,3);await recording(f);
  assert.equal(liveSessions(player).length,1);assert.equal(f.mediaElements.length,1);assert.equal(f.timers.size,0);
  f.c.SENGOKU_AT_TITLE=false;f.c.syncMusic();await flush();assert.equal(player.currentId,'hirukatsu','a saved campaign resumes directly into its current daypart');
  await player.dispose();
});

await test('title playback survives time boundaries and background restoration without restarting its recording',async()=>{
  const f=appFixture(11,59,59);f.c.SENGOKU_AT_TITLE=true;await f.press('sound');await recording(f);
  const player=f.c.musicPlayer(),session=player._session;player._context.advance(9);const start=session.start;
  for(const time of [local(12),local(18),local(5)]){f.setNow(time);f.c.syncMusic();await flush();assert.equal(player.currentId,'shitaku');assert.equal(f.timers.size,0);}
  f.document.hidden=true;await f.listeners.get('visibilitychange')();f.setNow(local(23));f.document.hidden=false;
  await Promise.all([f.listeners.get('visibilitychange')(),f.windowListeners.get('pageshow')()]);await flush();
  assert.strictEqual(player._session,session);assert.equal(session.start,start);assert.equal(f.files.length,1);assert.equal(player.currentId,'shitaku');
  await f.press('music-stop');f.runTimer(280);const plays=f.mediaElements[0].playCount;
  f.setNow(local(5));await f.listeners.get('visibilitychange')();await f.windowListeners.get('pageshow')();f.c.syncMusic();await flush();
  assert.equal(player.playing,false);assert.equal(f.mediaElements[0].playCount,plays);assert.equal(f.files.length,1);assert.equal(f.timers.size,0);await player.dispose();
});

await test('title and game transitions preserve manual choice and remain silent at zero volume',async()=>{
  const f=appFixture(10);f.c.SENGOKU_AT_TITLE=true;await f.press('play-track','battle-storm');await recording(f);
  const player=f.c.musicPlayer(),manual=player._session;
  for(const title of [false,true]){f.c.SENGOKU_AT_TITLE=title;f.c.syncMusic();await flush();assert.strictEqual(player._session,manual);assert.equal(player.currentId,'battle-storm');}
  await f.press('music-auto');await recording(f);assert.equal(player.currentId,'shitaku');
  player.setVolume(0);await flush();const plays=f.mediaElements[0].playCount,requests=f.files.length;
  for(const title of [false,true]){f.c.SENGOKU_AT_TITLE=title;f.c.syncMusic();await flush();}
  await f.listeners.get('visibilitychange')();assert.equal(player._context.state,'suspended');assert.equal(f.mediaElements[0].playCount,plays);assert.equal(f.files.length,requests);assert.equal(f.timers.size,0);
  player.setVolume(31);await flush();assert.equal(player.currentId,'shitaku');assert.equal(player.volume,31);assert.equal(player._context.state,'running');
  await player.dispose();
});

await test('a fresh allowed startup requests Shitaku once with the new audible default',async()=>{
  const f=startupFixture();assert.equal(f.c.settings.sound,true);assert.equal(f.c.settings.volume,10);assert.equal(f.c.settings.audioPreferenceVersion,1);
  f.c.startMusic();await flush();const player=f.c.musicPlayer();assert(player);assert.equal(player.currentId,'shitaku');
  assert.equal(f.files.length,1);await recording(f);assert.equal(player.playing,true);assert.equal(player.audible,true);const session=player._session,plays=f.mediaElements[0].playCount;
  f.c.startMusic();await flush();assert.strictEqual(player._session,session);assert.equal(f.files.length,1);assert.equal(f.mediaElements[0].playCount,plays,'startup is idempotent');
  assert.equal(JSON.parse(f.storage.get(f.c.settingsKey)).sound,true);await player.dispose();
});

await test('saved mute and zero volume survive startup and ordinary trusted interactions',async()=>{
  for(const preferences of [{audioPreferenceVersion:1,sound:false,volume:35},{audioPreferenceVersion:1,sound:true,volume:0}]){
    const f=startupFixture({preferences});f.c.startMusic();await flush();await activation(f);
    assert.equal(f.c.settings.sound,preferences.sound);assert.equal(f.c.settings.volume,preferences.volume);assert.equal(f.files.length,0);assert.equal(f.calls.filter(call=>call==='context.resume').length,0);
    if(f.c.musicPlayer())await f.c.musicPlayer().dispose();
  }
});

await test('blocked autoplay retains intent without claiming playback and retries on a trusted interaction',async()=>{
  const blocked=()=>Promise.reject(Object.assign(new Error('Autoplay blocked'),{name:'NotAllowedError'}));
  const f=startupFixture({mediaPlayImpl:blocked});f.c.startMusic();await flush();const player=f.c.musicPlayer();
  assert.equal(player.playing,false);assert.equal(player.audible,false);assert.equal(f.c.musicStatusText(),'再生待機');assert.equal(f.c.settings.sound,true);assert.equal(f.files.length,0);
  if([...f.timers.values()].some(timer=>timer.ms===280))f.runTimer(280);
  const plays=f.mediaElements[0].playCount;await activation(f,false);f.setNow(local(18));await f.listeners.get('visibilitychange')();await f.windowListeners.get('pageshow')();await flush();
  assert.equal(f.mediaElements[0].playCount,plays,'untrusted and restoration events do not retry a blocked start');
  f.mediaElements[0].playImpl=null;await activation(f,true);assert.equal(player.currentId,'shitaku');await recording(f);assert.equal(player.playing,true);assert.equal(player.audible,true);
  assert(f.writes.every(([,value])=>JSON.parse(value).sound===true),'autoplay policy never persists a false user preference');await player.dispose();
});

await test('a blocked gesture retry is bounded and the explicit resume control remains available',async()=>{
  const f=startupFixture({mediaPlayImpl:()=>Promise.reject(Object.assign(new Error('Still blocked'),{name:'NotAllowedError'}))});
  f.c.startMusic();await flush();await activation(f);const plays=f.mediaElements[0].playCount;
  await activation(f);await activation(f);assert.equal(f.mediaElements[0].playCount,plays,'ordinary interactions do not become an autoplay retry loop');
  assert.equal(f.c.settings.sound,true);assert.equal(f.c.musicPlayer().playing,false);
  f.mediaElements[0].playImpl=null;await f.press('music-resume');await recording(f);assert.equal(f.c.musicPlayer().audible,true);await f.c.musicPlayer().dispose();
});

await test('a trusted retry replaces an unresolved resume before or after its waiting deadline',async()=>{
  for(const waitForDeadline of [false,true]){
    let resolve;const f=startupFixture({resumeImpl:()=>new Promise(done=>{resolve=done;})});
    f.c.startMusic();await flush();const player=f.c.musicPlayer();assert(resolve);assert.equal(player.playing,false);assert.equal(player.audible,false);assert.notEqual(f.c.musicStatusText(),'再生中');assert.equal(f.files.length,0);
    assert.equal(f.calls.filter(call=>call==='context.resume').length,1);
    if(waitForDeadline){f.runTimer(1000);await flush();assert.equal(f.c.musicStatusText(),'再生待機');}
    assert.equal(player.playing,false);assert.equal(player.audible,false);assert.equal(f.c.settings.sound,true);
    player._context.resumeImpl=null;await activation(f);await recording(f);const session=player._session;
    assert.equal(player.audible,true);assert.equal(f.files.length,1);resolve();await flush();
    assert.strictEqual(player._session,session);assert.equal(player.audible,true);assert.equal(f.files.length,1);await player.dispose();
  }
});

await test('explicit mute or zero volume wins over a pending startup, its late resolution and later trusted clicks',async()=>{
  for(const zeroVolume of [false,true]){
    let resolve;const f=startupFixture({resumeImpl:()=>new Promise(done=>{resolve=done;})});
    f.c.startMusic();await flush();const player=f.c.musicPlayer();assert(resolve);
    if(zeroVolume)await f.volume(0);else await f.press('sound');
    assert.equal(f.c.settings.sound,zeroVolume);assert.equal(player.playing,false);if([...f.timers.values()].some(timer=>timer.ms===280))f.runTimer(280);
    const resumes=f.calls.filter(call=>call==='context.resume').length;player._context.state='running';resolve();await flush();await activation(f);
    assert.equal(player.playing,false);assert.equal(player.audible,false);assert.equal(player._session,null);assert.equal(f.files.length,0);assert.equal(f.mediaElements[0].paused,true);
    assert.equal(f.calls.filter(call=>call==='context.resume').length,resumes);const saved=JSON.parse(f.storage.get(f.c.settingsKey));assert.equal(saved.sound,zeroVolume);assert.equal(saved.audioPreferenceVersion,1);if(zeroVolume)assert.equal(saved.volume,0);await player.dispose();
  }
});

await test('raising saved zero volume starts enabled audio explicitly while a saved stop remains stopped',async()=>{
  for(const sound of [true,false]){
    const f=startupFixture({preferences:{audioPreferenceVersion:1,sound,volume:0}});f.c.startMusic();await flush();
    assert.equal(f.files.length,0);assert.equal(f.contexts.length,0);await f.volume(35);
    assert.equal(f.c.settings.volume,35);assert.equal(f.c.settings.sound,sound);
    const saved=JSON.parse(f.storage.get(f.c.settingsKey));assert.equal(saved.volume,35);assert.equal(saved.sound,sound);
    if(sound){assert.equal(f.files.length,1);await recording(f);assert.equal(f.c.musicPlayer().currentId,'shitaku');assert.equal(f.c.musicPlayer().audible,true);await f.c.musicPlayer().dispose();}
    else{assert.equal(f.files.length,0);assert.equal(f.contexts.length,0);assert.equal(f.c.musicPlayer(),null);}
  }
});

await test('a first foreground resume blocked after hidden startup is recoverable by the next trusted click',async()=>{
  for(const waitForDeadline of [false,true]){
    let resolve;const f=startupFixture({resumeImpl:()=>new Promise(done=>{resolve=done;})});f.document.hidden=true;
    await f.c.startMusic();await flush();const player=f.c.musicPlayer();
    assert.equal(f.calls.filter(call=>call==='context.resume').length,0);assert.equal(player.audible,false);assert.equal(f.files.length,0);
    f.document.hidden=false;
    const foreground=Promise.all([f.listeners.get('visibilitychange')(),f.windowListeners.get('pageshow')()]);await flush();
    assert(resolve);assert.equal(f.calls.filter(call=>call==='context.resume').length,1,'coincident restoration events share one pending resume');assert.notEqual(f.c.musicStatusText(),'再生中');
    if(waitForDeadline){f.runTimer(1000);await flush();assert.equal(f.c.musicStatusText(),'再生待機');}
    player._context.resumeImpl=null;await activation(f);
    assert.equal(f.calls.filter(call=>call==='context.resume').length,2,'the first trusted click retries a pending foreground resume');
    await recording(f);const session=player._session;assert.equal(player.audible,true);assert.equal(player.currentId,'shitaku');
    // A same-track retry must invalidate the older attempt's deadline as well
    // as its eventual result, otherwise that old timer can silence success.
    if([...f.timers.values()].some(timer=>timer.ms===1000)){f.runTimer(1000);await flush();}
    assert.equal(player.audible,true);assert.strictEqual(player._session,session);
    resolve();await foreground;await flush();assert.strictEqual(player._session,session);assert.equal(player.audible,true);assert.equal(f.files.length,1);await player.dispose();
  }
});

await test('stopping during a pending first foreground resume wins over its deadline and late resolution',async()=>{
  let resolve;const f=startupFixture({resumeImpl:()=>new Promise(done=>{resolve=done;})});f.document.hidden=true;await f.c.startMusic();await flush();
  const player=f.c.musicPlayer();f.document.hidden=false;const foreground=f.listeners.get('visibilitychange')();await flush();assert(resolve);
  await f.press('music-stop');const resumes=f.calls.filter(call=>call==='context.resume').length;
  if([...f.timers.values()].some(timer=>timer.ms===1000)){f.runTimer(1000);await flush();}
  player._context.state='running';resolve();await foreground;await flush();await activation(f);
  assert.equal(f.c.settings.sound,false);assert.equal(f.c.musicStatusText(),'停止中');assert.equal(player.playing,false);assert.equal(player.audible,false);assert.equal(player._session,null);
  assert.equal(f.files.length,0);assert.equal(f.mediaElements[0].paused,true);assert.equal(f.calls.filter(call=>call==='context.resume').length,resumes);
  assert.equal(JSON.parse(f.storage.get(f.c.settingsKey)).sound,false);await player.dispose();
});

await test('a restoration deadline preserves playback intent when volume, visibility, a call or the platform suppresses audio',async()=>{
  for(const cause of ['volume','hidden','voice','interrupted']){
    let resolve,blocked=0;const f=make(8,0,0,{session:true}),player=new f.Music({onPlaybackBlocked:()=>blocked++});player.setAuto(false);
    await player.play('battle-storm');await recording(f);const session=player._session;
    player._context.resumeImpl=()=>new Promise(done=>{resolve=done;});player.setVolume(25);await flush();assert(resolve);
    if(cause==='volume')player.setVolume(0);
    if(cause==='hidden'){f.document.hidden=true;await f.listeners.get('visibilitychange')();}
    if(cause==='voice')await player.setVoiceActive(true);
    if(cause==='interrupted'){f.audioSession.state='interrupted';player._context.state='interrupted';f.audioListeners.get('statechange')();}
    f.runTimer(1000);await flush();assert.equal(player.playing,true,cause+' preserves the request to play');assert.equal(player.audible,false);assert.equal(blocked,0,'suppression is not an autoplay failure');
    player._context.resumeImpl=null;
    if(cause==='volume')player.setVolume(25);
    if(cause==='hidden'){f.document.hidden=false;await f.listeners.get('visibilitychange')();}
    if(cause==='voice')await player.setVoiceActive(false);
    if(cause==='interrupted'){f.audioSession.state='active';player._context.state='running';f.audioListeners.get('statechange')();}
    await flush();assert.equal(player.audible,true,cause+' resumes when suppression ends');assert.strictEqual(player._session,session);assert.equal(f.files.length,1);
    resolve();await flush();assert.equal(player.audible,true);await player.dispose();
  }
});

console.log(passed+' local-time selection, recording lifecycle and production UI integration checks passed.');
