'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {setup}=require('./helpers/dom-model.cjs');
const {create}=require('../ui-sounds.js');
const drain=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function fixture(play){
 const {doc,host}=setup(),listeners=new Map(),sounds=[];let time=1000;
 doc.hidden=false;
 doc.addEventListener=(type,fn,capture)=>{assert.equal(capture,true);if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);};
 doc.removeEventListener=(type,fn,capture)=>{assert.equal(capture,true);listeners.get(type)?.delete(fn);};
 const options={document:doc,now:()=>time,play:type=>{sounds.push(type);return play?.(type);}},ui=create(options);
 function emit(type,target,extra={}){const event={type,target,isTrusted:true,button:0,detail:type==='click'?1:0,...extra};for(const fn of listeners.get(type)||[])fn(event);return event;}
 return{doc,host,listeners,sounds,ui,options,emit,advance:ms=>{time+=ms;},query:s=>doc.querySelector(s)};
}
let checks=0;async function test(name,run){await run();checks++;console.log('PASS '+name);}
(async()=>{
 await test('mouse and touch button activations produce one sound and do not change the event or focus',()=>{
  const f=fixture();f.host.innerHTML='<button id="open"><svg><g><path></path></g></svg><span>開く</span></button>';
  const button=f.query('#open'),icon=f.query('path');button.focus();
  const pointer=f.emit('pointerdown',icon,{pointerType:'mouse'});assert.equal(f.sounds.length,0);
  const click=f.emit('click',icon);assert.deepEqual(f.sounds,['tap']);assert.equal(click.defaultPrevented,undefined);assert.equal(f.doc.activeElement,button);
  f.emit('pointerdown',icon,{pointerType:'touch'});f.emit('click',icon,{pointerType:'touch'});assert.equal(f.sounds.length,2);
  for(const listener of f.listeners.get('click'))listener(click);assert.equal(f.sounds.length,2,'one event object cannot sound twice');
  assert.equal(pointer.defaultPrevented,undefined);f.ui.dispose();
 });
 await test('dynamic dialogs, navigation, ARIA controls, summaries and button inputs are covered',()=>{
  const f=fixture();
  for(const markup of ['<button>確定</button>','<a href="#army">軍団</a>','<a href="guide/">案内</a>','<div role="button" tabindex="0">選ぶ</div>','<div role="tab">資源</div>','<span role="switch">切替</span>','<input type="button">','<input type="submit">','<input type="reset">','<input type="image">','<input type="checkbox">','<input type="radio">','<summary>詳細</summary>','<article data-action="officer">武将</article>','<span data-view="research">研究</span>','<span data-social="friends">友人</span>','<span data-map-action="zoom">拡大</span>']){
   f.host.innerHTML='<dialog open>'+markup+'</dialog>';const control=f.host.firstElementChild.firstElementChild,before=f.sounds.length;f.emit('click',control);assert.equal(f.sounds.length,before+1,markup);
  }
  f.ui.dispose();
 });
 await test('disabled, hidden, inert, closed and explicitly quiet controls are silent',()=>{
  const f=fixture();
  for(const markup of ['<button disabled>保留</button>','<div aria-disabled="true"><button>保留</button></div>','<div hidden><button>隠す</button></div>','<div inert><button>保留</button></div>','<div aria-hidden="true"><button>隠す</button></div>','<dialog><button>閉じた画面</button></dialog>','<button class="is-disabled">保留</button>','<button data-ui-sound="off">専用音</button>','<button data-sound-preview>音を試す</button>']){
   f.host.innerHTML=markup;f.emit('click',f.query('button'));assert.equal(f.sounds.length,0,markup);
  }
  f.host.innerHTML='<button>離れた画面</button>';const detached=f.query('button');detached.remove();f.emit('click',detached);assert.equal(f.sounds.length,0);
  f.host.innerHTML='<button>別タブ</button>';f.doc.hidden=true;f.emit('click',f.query('button'));assert.equal(f.sounds.length,0);f.ui.dispose();
 });
 await test('sliders, typing, file pickers and editable children never produce repeated sounds',()=>{
  const f=fixture();
  for(const markup of ['<input type="range">','<input type="number">','<input type="text">','<input type="search">','<input type="file">','<input>','<select><option>選択</option></select>','<textarea>文章</textarea>','<span contenteditable="true">編集</span>']){
   f.host.innerHTML='<article data-action="officer">'+markup+'</article>';const control=f.host.firstElementChild.firstElementChild;
   f.emit('click',control);for(let i=0;i<100;i++)f.emit('input',control);f.emit('keydown',control,{key:'Enter'});assert.equal(f.sounds.length,0,markup);
  }
  f.ui.dispose();
 });
 await test('synthetic clicks, non-primary buttons and pointer movement do not sound',()=>{
  const f=fixture();f.host.innerHTML='<button>操作</button>';const button=f.query('button');
  f.emit('click',button,{isTrusted:false});f.emit('click',button,{button:1});f.emit('click',button,{button:2});
  for(const type of ['pointerdown','pointermove','pointerup','pointercancel'])f.emit(type,button,{pointerType:'touch'});
  assert.equal(f.sounds.length,0);f.emit('click',button,{detail:2});assert.equal(f.sounds.length,1,'a real second click remains an activation');f.ui.dispose();
 });
 await test('native Enter and Space sound only their generated click, and held keys do not repeat audio',()=>{
  const f=fixture();f.host.innerHTML='<button>決定</button>';const button=f.query('button');
  f.emit('keydown',button,{key:'Enter'});assert.equal(f.sounds.length,0);f.emit('click',button,{detail:0});assert.equal(f.sounds.length,1);
  for(let i=0;i<3;i++){f.emit('keydown',button,{key:'Enter',repeat:true});f.emit('click',button,{detail:0});}assert.equal(f.sounds.length,1);
  f.emit('keyup',button,{key:'Enter'});f.emit('keydown',button,{key:' '});assert.equal(f.sounds.length,1);f.emit('keyup',button,{key:' '});f.emit('click',button,{detail:0});assert.equal(f.sounds.length,2);
  f.emit('click',button,{detail:0});assert.equal(f.sounds.length,3,'an assistive activation without a held key works');f.ui.dispose();
 });
 await test('custom SVG keyboard activation sounds once even when its handler synthesizes a click',()=>{
  const f=fixture();f.host.innerHTML='<svg><g role="button" tabindex="0"><circle></circle></g></svg>';const marker=f.query('g');
  f.emit('keydown',marker,{key:'Enter'});assert.equal(f.sounds.length,1);
  f.emit('click',marker,{detail:0,isTrusted:false});f.emit('click',marker,{detail:0});assert.equal(f.sounds.length,1);
  f.emit('keydown',marker,{key:'Enter',repeat:true});f.emit('keyup',marker,{key:'Enter'});
  f.emit('keydown',marker,{key:' '});f.emit('keyup',marker,{key:' '});f.emit('click',marker,{detail:0});assert.equal(f.sounds.length,2);
  f.emit('pointerdown',marker,{pointerType:'touch'});f.emit('click',marker,{detail:0,pointerType:'touch'});assert.equal(f.sounds.length,3);
  for(const extra of [{isComposing:true},{ctrlKey:true},{altKey:true},{metaKey:true},{isTrusted:false}])f.emit('keydown',marker,{key:'Enter',...extra});assert.equal(f.sounds.length,3);f.ui.dispose();
 });
 await test('nested markup and shadow composed paths resolve only the intended control',()=>{
  const f=fixture();f.host.innerHTML='<div data-action="wrapper"><button><span>決定</span></button></div>';
  f.emit('click',f.query('span'));assert.equal(f.sounds.length,1);
  f.emit('click',f.host,{composedPath:()=>[f.query('span'),f.query('button'),f.host,f.doc]});assert.equal(f.sounds.length,2);f.ui.dispose();
 });
 await test('missing or rejected audio remains nonblocking, and disposing removes every listener',async()=>{
  for(const player of [()=>undefined,()=>{throw Error('not supported');},()=>Promise.reject(Error('blocked'))]){
   const f=fixture(player);f.host.innerHTML='<button>操作</button>';assert.doesNotThrow(()=>f.emit('click',f.query('button')));await drain();assert.equal(f.sounds.length,1);f.ui.dispose();f.ui.dispose();assert([...f.listeners.values()].every(set=>set.size===0));f.emit('click',f.query('button'));assert.equal(f.sounds.length,1);
  }
 });
 await test('loading the interface module twice cannot install duplicate global listeners',()=>{
  const f=fixture();f.ui.dispose();const source=fs.readFileSync(require.resolve('../ui-sounds.js'),'utf8'),scope={document:f.doc,SengokuBridge:{playInterfaceSound:()=>f.sounds.push('tap')},performance:{now:()=>1000}};scope.window=scope;
  vm.runInNewContext(source,scope);vm.runInNewContext(source,scope);assert.equal(f.listeners.get('click').size,1);f.host.innerHTML='<button>一度だけ</button>';f.emit('click',f.query('button'));assert.deepEqual(f.sounds,['tap']);scope.SengokuUISounds.dispose();
 });
 const {fixture:audioFixture}=await import('./helpers/music-fixture.mjs');
 await test('tap is one short independent sound; same-click confirmation cannot double-play it',async()=>{
  const audio=audioFixture(),effects=new audio.context.SengokuSoundEffects({volume:20}),f=fixture(type=>effects.play(type));f.host.innerHTML='<button>普請</button>';f.emit('click',f.query('button'));const confirmation=effects.play('confirm');await drain();
  assert.equal(await confirmation,false);assert.equal(effects._voices.size,1);assert.equal(audio.sources.size,3);assert([...audio.sources].every(source=>source.stopped-source.started<.12));assert.equal(effects._gain.gain.value,.13);
  effects._context.advance(1);assert.equal(effects._voices.size,0);assert.equal(effects._context.state,'suspended');f.ui.dispose();await effects.dispose();
 });
 await test('audition remains one confirmation and tap obeys mute, calls, visibility and delayed permission',async()=>{
  const audio=audioFixture(),effects=new audio.context.SengokuSoundEffects({volume:10}),f=fixture(type=>effects.play(type));f.host.innerHTML='<button data-sound-preview>音を試す</button><button id="normal">操作</button>';
  f.emit('click',f.query('[data-sound-preview]'));assert.equal(f.sounds.length,0);assert.equal(await effects.play('confirm'),true);assert.equal(effects._voices.size,2);effects._context.advance(1);
  audio.setNow(Date.now()+2000);effects.setVolume(0);f.emit('click',f.query('#normal'));await drain();assert.equal(effects._voices.size,0);
  effects.setVolume(10);await effects.setVoiceActive(true);f.emit('click',f.query('#normal'));await drain();assert.equal(effects._voices.size,0);await effects.setVoiceActive(false);
  audio.document.hidden=true;f.emit('click',f.query('#normal'));await drain();assert.equal(effects._voices.size,0);audio.document.hidden=false;
  let resume;effects._context.resumeImpl=()=>new Promise(resolve=>{resume=()=>{effects._context.state='running';resolve();};});f.emit('click',f.query('#normal'));effects.setVolume(0);resume();await drain();assert.equal(effects._voices.size,0);assert.equal(effects._context.state,'suspended');f.ui.dispose();await effects.dispose();
 });
 console.log(`${checks} delegated button sound and independent audio checks passed; no network, campaign changes or new audio downloads.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
