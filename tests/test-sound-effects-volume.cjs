'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {setup}=require('./helpers/dom-model.cjs');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
const settingsKey='sengoku-tento-settings-v1',saveKey='sengoku-tento-save-v2';
function fn(name){const match=new RegExp('^  (?:async )?function '+name+'\\(','m').exec(source);assert(match,name);const start=match.index,lineEnd=source.indexOf('\n',start),end=source.slice(start,lineEnd).endsWith('}')?lineEnd:source.indexOf('\n  }',start)+4;return source.slice(start,end);}
let checks=0;async function test(name,run){await run();checks++;console.log('PASS '+name);}
(async()=>{
 const {fixture}=await import('./helpers/music-fixture.mjs');
 const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
 function app(preferences){
  const audio=fixture(),{doc,host}=setup(),handlers=new Map(),storage=new Map([[saveKey,'original campaign']]),writes=[];if(preferences!==undefined)storage.set(settingsKey,JSON.stringify(preferences));
  doc.hidden=false;doc.addEventListener=(type,fn)=>{if(!handlers.has(type))handlers.set(type,[]);handlers.get(type).push(fn);};
  const game={isAdmin:false,isStaff:false,state:{difficulty:'normal',resources:{gold:777},command:2}},c={document:doc,window:{SengokuSoundEffects:audio.context.SengokuSoundEffects,SENGOKU_MUSIC_TRACKS:[]},localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>{storage.set(key,value);writes.push([key,value]);}},settingsKey,game,state:()=>game.state,saveWarning:'',syncAccess:{linked:false},activeModal:'',startPending:false,currentView:'town',esc:String,num:String,icon:()=>'',musicStatusText:()=>'',refreshMusicPlayback:()=>{},$:selector=>doc.querySelector(selector),updateCatalogSearch:()=>false,updateBranchTroopDraft:()=>false,
   modal(title,description,body,footer,kind){c.activeModal=kind;host.innerHTML=body+footer;},mutationActions:new Set(),requireWritable:()=>true};
  vm.createContext(c);const stateLine=source.split('\n').find(line=>line.startsWith('  let music=null,voiceAudioActive=false')).replace('let music=','var music=');
  const init=source.slice(source.indexOf('  let settings={'),source.indexOf('  try{const raw=localStorage.getItem(saveKey)'));
  const clickStart=source.indexOf("  document.addEventListener('click',async event=>"),click=source.slice(clickStart,source.indexOf("\n  document.addEventListener('submit'",clickStart));
  const input=source.split('\n').find(line=>line.startsWith("  document.addEventListener('input',"));
  vm.runInContext(stateLine+'\n'+init+'\nthis.settings=settings;\n'+['safeSettings','settingsModal','applyEffectsVolume','playNote','previewSoundEffect','setVoiceActive'].map(fn).join('\n')+'\n'+click+'\n'+input,c);
  return{c,audio,doc,host,game,storage,writes,async input(value){const node=doc.querySelector('#effects-volume');node.value=String(value);for(const cb of handlers.get('input')||[])await cb({target:node});},async preview(){const node=doc.querySelector('[data-sound-preview]');for(const cb of handlers.get('click')||[])await cb({target:node,isTrusted:true});},async dispose(){await c.soundEffects?.dispose();}};
 }
 await test('fresh effects default to 10 while old saved music mute and zero volume remain silent',()=>{
  assert.equal(app().c.settings.effectsVolume,10);
  for(const [preferences,expected] of [[{audioPreferenceVersion:1,sound:false,volume:35},0],[{audioPreferenceVersion:1,sound:true,volume:0},0],[{audioPreferenceVersion:1,sound:true,volume:31},31],[{audioPreferenceVersion:1,sound:false,volume:35,effectsVolume:42},42]])assert.equal(app(preferences).c.settings.effectsVolume,expected);
 });
 await test('saved effect values normalize to safe percentages and cannot inject settings markup',()=>{
  for(const [value,expected] of [[0,0],[100,100],[-8,0],[150,100],[34.6,35],[' 41 ',41],['',10],[null,10],[true,10],['"><img src=x>',10]]){const f=app({audioPreferenceVersion:1,sound:true,volume:10,effectsVolume:value});assert.equal(f.c.settings.effectsVolume,expected);f.c.settingsModal();assert.equal(f.doc.querySelector('img'),null);assert.equal(f.doc.querySelector('#effects-volume').value,String(expected));}
 });
 await test('settings expose independent labeled controls and moving SFX saves no game data or starts audio',async()=>{
  const f=app({audioPreferenceVersion:1,sound:false,volume:31,effectsVolume:10}),before=JSON.stringify(f.game.state);f.c.settingsModal();const slider=f.doc.querySelector('#effects-volume');slider.focus();
  assert.equal(slider.getAttribute('aria-label'),'サウンド（効果音）の音量');assert.equal(f.doc.querySelector('#volume').value,'31');
  await f.input(65);assert.equal(f.c.settings.effectsVolume,65);assert.equal(f.c.settings.volume,31);assert.equal(f.c.settings.sound,false);assert.equal(f.c.soundEffects,null);assert.equal(f.audio.contexts.length,0);assert.equal(f.doc.activeElement,slider);assert.equal(f.doc.querySelector('#settings-effects-volume-value').textContent,'65%');
  const saved=JSON.parse(f.storage.get(settingsKey));assert.equal(saved.effectsVolume,65);assert.equal(saved.volume,31);assert.equal(f.storage.get(saveKey),'original campaign');assert.equal(JSON.stringify(f.game.state),before);assert(f.writes.every(([key])=>key===settingsKey));assert.equal(app(saved).c.settings.effectsVolume,65);
 });
 await test('audition works with BGM stopped, stays on the effect gain, and 0 immediately mutes active sounds',async()=>{
  const f=app({audioPreferenceVersion:1,sound:false,volume:0,effectsVolume:20});f.c.settingsModal();await f.preview();assert.equal(f.c.music,null);assert.equal(f.audio.contexts.length,1);assert.equal(f.c.soundEffects._voices.size,2);assert.match(f.doc.querySelector('[data-sound-feedback]').textContent,/再生しました/);assert.equal(f.c.soundEffects._gain.gain.value,.13);assert.equal(f.c.settings.sound,false);assert.equal(f.c.settings.volume,0);
  await f.input(0);assert.equal(f.c.soundEffects._voices.size,0);assert.equal(f.c.soundEffects._gain.gain.value,0);assert(f.doc.querySelector('[data-sound-preview]').disabled);assert.match(f.doc.querySelector('#settings-effects-volume-value').textContent,/消音/);const before=f.audio.nodes.length;await f.preview();assert.equal(f.audio.nodes.length,before);await f.dispose();
 });
 await test('the selected audition sends the intended instrument score to the independent bus',async()=>{
  const f=app({audioPreferenceVersion:1,sound:false,volume:0,effectsVolume:20});f.c.settingsModal();
  const chooser=f.doc.querySelector('#effects-preview-type');assert.equal(chooser.value,'confirm');
  assert.equal(chooser.options.length,21);chooser.value='battle';await f.preview();
  const direct=fixture(),effects=new direct.context.SengokuSoundEffects({volume:20});
  assert(await effects.play('battle'));
  const sources=audio=>[...audio.sources].map(n=>[n.type,n.started,n.stopped,n.frequency.events]);
  assert.deepEqual(sources(f.audio),sources(direct));
  assert.match(f.doc.querySelector('[data-sound-feedback]').textContent,/合戦が始まる/);assert.equal(f.c.music,null);
  await effects.dispose();await f.dispose();
 });
 await test('audition stays silent while hidden or in a call and never writes preferences or saves',async()=>{
  const f=app({audioPreferenceVersion:1,sound:false,volume:31,effectsVolume:19});
  const gameBefore=JSON.stringify(f.game.state),prefsBefore=f.storage.get(settingsKey);
  f.c.settingsModal();f.doc.querySelector('#effects-preview-type').value='victory';
  f.c.setVoiceActive(true);await f.preview();
  assert.match(f.doc.querySelector('[data-sound-feedback]').textContent,/通話中/);
  f.c.setVoiceActive(false);f.doc.hidden=true;await f.preview();
  assert.match(f.doc.querySelector('[data-sound-feedback]').textContent,/別タブ/);
  assert.equal(f.audio.contexts.length,0);
  assert.equal(f.storage.get(settingsKey),prefsBefore);
  assert.equal(f.storage.get(saveKey),'original campaign');
  assert.equal(JSON.stringify(f.game.state),gameBefore);
  assert.equal(f.writes.length,0);
  await f.dispose();
 });
 await test('effect volume changes only its own gain and never changes BGM playback, gain or selected track',async()=>{
  const x=fixture(),music=new x.Music({volume:10}),effects=new x.context.SengokuSoundEffects({volume:10});music.setAuto(false);await music.play('town-dawn');const master=music._master.gain.value,track=music.currentId;await effects.play();assert.notEqual(effects._context,music._context);assert.equal(effects._gain.connections[0],effects._context.destination);
  effects.setVolume(80);assert.equal(effects._gain.gain.value,.52);assert.equal(music.volume,10);assert.equal(music.currentId,track);assert.equal(music._master.gain.value,master);music.pause();x.setNow(Date.now()+1000);assert.equal(await effects.play(),true);effects.setVolume(0);assert.equal(music.playing,false);await effects.dispose();await music.dispose();
 });
 await test('hidden pages, calls and pagehide stop effects without auto-playing on return',async()=>{
  for(const reason of ['hidden','voice','pagehide']){const x=fixture(),p=new x.context.SengokuSoundEffects({volume:15});await p.play();assert(p._voices.size>0);if(reason==='hidden'){x.document.hidden=true;await x.listeners.get('visibilitychange')();}if(reason==='voice')await p.setVoiceActive(true);if(reason==='pagehide')await x.windowListeners.get('pagehide')();assert.equal(p._voices.size,0);const before=x.nodes.length;assert.equal(await p.play(),false);assert.equal(x.nodes.length,before);
   x.document.hidden=false;await p.setVoiceActive(false);if(reason==='pagehide')await x.windowListeners.get('pageshow')();assert.equal(p._voices.size,0);assert.equal(p._context.state,'suspended');await p.dispose();assert.equal(x.listeners.size,0);assert.equal(x.windowListeners.size,0);}
 });
 await test('rejected or delayed browser unlock never queues a surprise sound and later explicit retry works',async()=>{
  const x=fixture(),p=new x.context.SengokuSoundEffects({volume:10});p._ensureContext();p._context.resumeImpl=()=>Promise.reject(Object.assign(Error('Blocked'),{name:'NotAllowedError'}));assert.equal(await p.play(),false);assert.equal(p._voices.size,0);
  let resume;p._context.resumeImpl=()=>new Promise(resolve=>{resume=()=>{p._context.state='running';resolve();};});const pending=p.play();p.setVolume(0);resume();assert.equal(await pending,false);assert.equal(p._voices.size,0);assert.equal(p._context.state,'suspended');
  p.setVolume(20);p._context.resumeImpl=null;assert.equal(await p.play(),true);await p.dispose();
 });
 await test('an indefinitely pending browser unlock returns after one second and cannot emit a late effect',async()=>{
  const x=fixture(),p=new x.context.SengokuSoundEffects({volume:10});p._ensureContext();let resolve;p._context.resumeImpl=()=>new Promise(done=>{resolve=()=>{p._context.state='running';done();};});
  const pending=p.play();x.runTimer(1000);assert.equal(await pending,false);assert.equal(p._voices.size,0);resolve();await flush();assert.equal(p._context.state,'suspended');assert.equal(p._voices.size,0);assert.equal(x.timers.size,0);await p.dispose();
 });
 await test('rapid effects are bounded and sources disconnect after the final note',async()=>{
  const x=fixture(),p=new x.context.SengokuSoundEffects({volume:10});
  const accepted=await Promise.all(Array.from({length:100},()=>p.play('confirm')));
  assert.equal(accepted.filter(Boolean).length,1);
  assert.equal(p._voices.size,2);
  const solo=fixture(),reference=new solo.context.SengokuSoundEffects({volume:10});
  assert(await reference.play('confirm'));
  assert.equal(x.sources.size,solo.sources.size,'Burst must allocate exactly one two-note confirmation');
  await reference.dispose();p._context.advance(1);assert.equal(p._voices.size,0);assert.equal(p._context.state,'suspended');await p.dispose();assert(x.nodes.every(node=>node.connections.length===0));assert.equal(x.timers.size,0);
 });
 console.log(`${checks} independent sound effects volume, routing and preference checks passed.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
