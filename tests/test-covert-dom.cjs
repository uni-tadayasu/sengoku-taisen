/* Mounted private dispatch UI with the production artwork decorator and an
 * isolated DOM fixture. No browser, live API, account or campaign is used. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {SengokuEngine:E,SENGOKU_DATA}=require('../engine.js');
const stable=require('../stable-dom.js'),{setup}=require('./helpers/dom-model.cjs');
const source=fs.readFileSync(process.env.COVERT_TEST_SOURCE||path.join(__dirname,'../covert.js'),'utf8');
const artwork=fs.readFileSync(path.join(__dirname,'../artwork.js'),'utf8');
const clone=value=>JSON.parse(JSON.stringify(value)),tests=[],test=(name,run)=>tests.push([name,run]);
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{resolve,promise};};
async function settle(){for(let i=0;i<20;i++)await Promise.resolve();}
async function fixture(options={}){
 const {host,doc,$}=setup(),frames=[],loads=[],game=new E({isAdmin:true,seed:25}),paintCalls={decorate:0};
 game.state.covert.reserves.edo=80;game.state.castles.nijo.owner=game.state.clan;
 let status={ownerId:'lord-a',linked:options.linked!==false,writable:true,readable:true,online:true,stamp:'one'},time=1000,readHook=null,reads=0;
 let value=game.covertStatus();
 const target=value.targets.find(t=>t.castleId==='odawara');
 value.reports=['a','b'].map(id=>({id:'report-'+id,sourceCastleId:'edo',target:{...target,name:'調査 '+id},observedElapsedMs:0,snapshot:{troops:40,resources:{gold:200}}}));
 value.stations=['a','b'].map(id=>({id:'station-'+id,sourceCastleId:'edo',unitType:'ninja',count:10,target:{...target,name:'常駐 '+id},createdElapsedMs:0}));
 value.incidents=['a','b'].map(id=>({id:'incident-'+id,sourceCastleId:'edo',kind:'field',occurredElapsedMs:0,available:true,expiresElapsedMs:null,stationIds:['station-a','station-b']}));
 game.covertStatus=()=>clone(value);
 const window={document:doc,SENGOKU_DATA,SengokuStableDOM:stable,matchMedia:()=>({matches:true})};
 class Image{set src(url){loads.push(url);this.onload?.();}}
 const context=vm.createContext({window,document:doc,Image,requestAnimationFrame:fn=>frames.push(fn),console});
 vm.runInContext(artwork,context,{filename:'artwork.js'});const original=window.SengokuArt.decorate;
 window.SengokuArt.decorate=()=>{paintCalls.decorate++;original();};
 vm.runInContext(source,context,{filename:'covert.js'});
 const mounted=window.SengokuCovert.mount(host,{getGame:()=>game,getStatus:()=>status,now:()=>time,storage:{getItem:()=>null},load:()=>{reads++;return readHook?readHook():Promise.resolve({ok:true,covert:clone(value)});}});
 async function flush(){for(let i=0;i<4;i++){while(frames.length)frames.shift()();await settle();}}
 await flush();window.SengokuArt.decorate();await flush();
 return{doc,host,$,game,mounted,window,paintCalls,loads,flush,
  get value(){return value;},set value(v){value=v;},get status(){return status;},set status(v){status=v;},get reads(){return reads;},advance:ms=>time+=ms,set readHook(fn){readHook=fn;},
  click:selector=>{$(selector).dispatchEvent({type:'click'});},change:(id,next)=>{const input=$('#'+id);input.value=next;input.dispatchEvent({type:'change'});},
  dispose:()=>mounted.dispose()};
}
function observedPaint(nodes){return nodes.map(node=>({node,ready:node.getAttribute('data-art-ready'),busy:node.getAttribute('aria-busy'),classes:node.getAttribute('class'),surface:node.querySelector('.art-surface'),background:node.querySelector('.art-surface')?.style.backgroundImage,ghost:node.style.getPropertyValue('--item-art')}));}

test('resource ticks keep real decorated artwork, metadata, controls, open reports and caret',async()=>{
 const f=await fixture({linked:false}),{doc,host,$,mounted}=f,help=$('.covert-help'),report=$('[data-covert-key="report-report-a"]'),input=$('#covert-search'),source=$('.covert-source-art'),svg=$('[data-covert-action="reload"]').querySelector('svg');
 assert(source&&source.classList.contains('art-ready'));assert(help.querySelector('summary').classList.contains('art-ready'));
 const paint=observedPaint(host.querySelectorAll('[data-art-ready]')),removed=[],mutations=[];assert(paint.length>20,'production decorator enhanced visible controls');
 help.open=true;report.open=true;input.focus();input.value='入力途中';input.setSelectionRange(1,3);host.scrollTop=320;report.scrollTop=42;
 doc.onRemove=node=>removed.push(node);doc.onAttributeChange=change=>mutations.push(change);const decorated=f.paintCalls.decorate,loaded=f.loads.length;
 for(let i=0;i<60;i++){f.game.state.resources.gold++;f.game.state.resources.rice++;mounted.refresh();}
 const losses=mutations.filter(m=>['aria-busy','data-art-ready','data-art-observed','data-button-art-enhanced'].includes(m.name)&&m.after===null||m.name==='class'&&String(m.before).includes('art-ready')&&!String(m.after).includes('art-ready'));
 assert.equal(losses.length,0,'background updates must not strip production paint metadata: '+losses.map(m=>m.node.localName+':'+m.name).join(', '));
 assert.equal(removed.length,0);assert.equal(f.paintCalls.decorate,decorated,'data-only ticks do not rerun the full artwork decorator');assert.equal(f.loads.length,loaded);
 for(const p of paint){assert(p.node.isConnected);assert.equal(p.node.getAttribute('data-art-ready'),p.ready);assert.equal(p.node.getAttribute('aria-busy'),p.busy);assert.equal(p.node.getAttribute('class'),p.classes);assert.strictEqual(p.node.querySelector('.art-surface'),p.surface);assert.equal(p.node.querySelector('.art-surface')?.style.backgroundImage,p.background);assert.equal(p.node.style.getPropertyValue('--item-art'),p.ghost);}
 assert.strictEqual($('#covert-search'),input);assert.strictEqual(doc.activeElement,input);assert.equal(input.value,'入力途中');assert.equal(input.selectionStart,1);assert.equal(input.selectionEnd,3);assert.equal(host.scrollTop,320);assert.equal(report.scrollTop,42);assert.equal(help.open,true);assert.equal(report.open,true);assert.strictEqual($('[data-covert-action="reload"]').querySelector('svg'),svg);
 f.dispose();
});

test('45-second background reads do not change mounted refresh labels or disabled state',async()=>{
 const f=await fixture(),button=f.$('[data-covert-action="reload"]'),label=button.textContent,attrs=clone(button.attributes),paused=deferred();
 f.readHook=()=>paused.promise;f.advance(45001);f.mounted.refresh();await settle();
 assert.equal(f.reads,2);assert.equal(f.mounted.controller.snapshot().loading,false);assert.equal(button.textContent,label);assert.equal(button.disabled,false);assert.deepEqual(button.attributes,attrs);
 paused.resolve({ok:true,covert:clone(f.value)});await f.flush();assert.strictEqual(f.$('[data-covert-action="reload"]'),button);assert.equal(button.textContent,label);assert.deepEqual(button.attributes,attrs);
 const manual=deferred();f.readHook=()=>manual.promise;f.click('[data-covert-action="reload"]');assert.equal(button.disabled,true);assert.match(button.textContent,/確認中/);manual.resolve({ok:true,covert:clone(f.value)});await f.flush();assert.equal(button.disabled,false);assert.equal(button.textContent,label);f.dispose();
});

test('Max, All, native selects and changed source artwork remain authoritative',async()=>{
 const f=await fixture(),{$,mounted}=f,hire=$('#covert-hire-count'),count=$('#covert-count');
 f.click('[data-covert-action="hire-max"]');assert.equal(hire.value,String(mounted.controller.snapshot().hireMax));hire.value='uncommitted';f.click('[data-covert-action="hire-max"]');assert.equal(hire.value,String(mounted.controller.snapshot().hireMax));
 f.click('[data-covert-action="dispatch-all"]');assert.equal(count.value,'80');count.value='uncommitted';f.click('[data-covert-action="dispatch-all"]');assert.equal(count.value,'80');
 const select=$('#covert-mode');f.change('covert-mode','station');assert.strictEqual($('#covert-mode'),select);assert.equal(select.value,'station');assert.equal(mounted.controller.snapshot().mode,'station');
 const art=$('.covert-source-art'),surface=art.querySelector('.art-surface'),paint=surface.style.backgroundImage;f.change('covert-source','nijo');assert.equal($('#covert-source').value,'nijo');assert.strictEqual($('.covert-source-art'),art);assert.strictEqual(art.querySelector('.art-surface'),surface);assert.equal(surface.style.backgroundImage,paint,'old surface remains painted while new source loads');assert.equal(art.getAttribute('data-art-url'),'assets/castles/nijo.webp');await f.flush();assert.equal(surface.style.backgroundImage,`url("${art.dataset.artNative}")`);assert.equal(art.dataset.artSheet,'native');assert.equal(art.getAttribute('data-art-ready'),'1');
 mounted.controller.update('hireInput','10');f.click('[data-covert-action="prepare-hire"]');assert.strictEqual(f.doc.activeElement,$('.covert-confirm'));f.click('[data-covert-action="cancel"]');assert.strictEqual(f.doc.activeElement,$('[data-covert-action="prepare-hire"]'));f.dispose();
});

test('keyed reports and stations keep their own details, selection and listeners through reorder and removal',async()=>{
 const f=await fixture(),a=f.$('[data-covert-key="report-report-a"]'),b=f.$('[data-covert-key="report-report-b"]'),station=f.$('[data-covert-key="station-station-b"]'),incident=f.$('#covert-incident-station-b');let clicks=0;
 a.open=true;b.open=false;b.addEventListener('click',()=>clicks++);f.change('covert-incident-station-b','incident-b');
 f.value.reports.reverse();f.value.stations.reverse();await f.mounted.controller.reload({background:true});
 assert.strictEqual(f.$('.covert-report'),b);assert.strictEqual(f.$('.covert-station'),station);assert.strictEqual(f.$('#covert-incident-station-b'),incident);assert.equal(incident.value,'incident-b');assert.equal(a.open,true);assert.equal(b.open,false);b.dispatchEvent({type:'click'});assert.equal(clicks,1);
 f.value.reports=f.value.reports.filter(r=>r.id==='report-b');f.value.stations=f.value.stations.filter(s=>s.id==='station-b');await f.mounted.controller.reload({background:true});assert.equal(a.isConnected,false);assert.strictEqual(f.$('.covert-report'),b);assert.equal(b.open,false);assert.strictEqual(f.$('#covert-incident-station-b'),incident);assert.equal(incident.value,'incident-b');f.dispose();
});

test('a changed account context clears old private details, native drafts and focus',async()=>{
 const f=await fixture({linked:false}),report=f.$('.covert-report'),input=f.$('#covert-search');report.open=true;f.$('.covert-help').open=true;input.value='private draft';input.focus();
 f.value.reports=[];f.value.stations=[];f.status={...f.status,ownerId:'lord-b',stamp:'two'};f.mounted.refresh();
 assert.equal(report.isConnected,false);assert.equal(input.isConnected,false);assert.equal(f.$('.covert-report'),null);assert.notStrictEqual(f.$('#covert-search'),input);assert.equal(f.$('#covert-search').value,'');assert.equal(f.$('.covert-help').open,false);assert.strictEqual(f.doc.activeElement,f.doc.body);f.dispose();
});

(async()=>{let failed=0;for(const[name,run]of tests){try{await run();console.log('PASS '+name);}catch(error){failed++;console.error('FAIL '+name+'\n'+error.stack);}}console.log(`${tests.length-failed}/${tests.length} mounted covert DOM scenarios passed with production artwork; no live writes.`);if(failed)process.exitCode=1;})().catch(error=>{console.error(error);process.exitCode=1;});
