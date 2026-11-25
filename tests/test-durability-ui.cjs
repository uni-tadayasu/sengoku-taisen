'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {SengokuEngine:E,SENGOKU_DATA:D}=require('../engine.js'),ui=require('../durability.js'),{setup}=require('./helpers/dom-model.cjs');
const scope={window:{}};vm.runInNewContext(fs.readFileSync(require.resolve('../officers-data.js'),'utf8'),scope);
const roster=JSON.parse(JSON.stringify(scope.window.SENGOKU_OFFICERS));
const fresh=()=>new E({officers:roster,seed:4918});
let count=0;function test(name,run){run();count++;console.log('PASS '+name);}

test('every castle has a numeric accessible meter, and invalid snapshots are omitted',()=>{
 const game=fresh(),{host}=setup(),before=JSON.stringify(game.state);
 for(const castle of D.castles){const view=game.castle(castle.id);host.innerHTML=ui.markup(view.durability,{kind:'castle',id:castle.id,live:true});const bar=host.querySelector('[role="meter"]');assert(bar,castle.id);assert.equal(bar.getAttribute('aria-valuenow'),String(view.durability.current));assert.equal(bar.getAttribute('aria-valuemax'),String(view.durability.max));assert.equal(host.querySelector('[data-durability-live]').getAttribute('data-durability-id'),castle.id);}
 for(const invalid of [null,{}, {current:NaN,max:100},{current:10,max:Infinity},{current:1,max:-1}])assert.equal(ui.markup(invalid),'');
 assert.equal(JSON.stringify(game.state),before);
 const markup=ui.markup({current:20,max:100},{label:'<img src=x onerror=alert(1)>',kind:'castle',id:'\"onclick=bad',live:true});assert(!markup.includes('<img'));assert(markup.includes('&lt;img'));assert(markup.includes('&quot;onclick=bad'));
});

test('recovery changes only visible numbers and meters, preserves drafts, and projects each base once',()=>{
 const game=fresh(),id=game.state.home,{host,doc}=setup(),full=game.castle(id).durability;
 game.state.castles[id].durability={version:1,current:full.max*.25,max:full.max,updatedElapsedMs:0};
 game.state.worldClock={id:'offline-world-v1',elapsedMs:0,revision:0};
 host.innerHTML='<input id="draft"><div id="first">'+ui.markup(game.castle(id).durability,{kind:'castle',id,live:true})+'</div><div id="second">'+ui.markup(game.castle(id).durability,{kind:'castle',id,live:true,compact:true})+'</div><dialog>'+ui.markup(game.castle('edo').durability,{kind:'castle',id:'edo',live:true})+'</dialog><div hidden>'+ui.markup(game.castle('nijo').durability,{kind:'castle',id:'nijo',live:true})+'</div>';
 host.querySelector('dialog').open=false;
 const input=host.querySelector('#draft'),bar=host.querySelector('[role="meter"]'),nodes=host.querySelectorAll('*');input.value='次の編成';input.setSelectionRange(1,3,'backward');input.focus();host.scrollTop=219;
 const original=game.castle.bind(game),called=[];game.castle=key=>{called.push(key);return original(key);};
 game.state.worldClock.elapsedMs=60000;game.state.turn=1;game.settleMonthlyRepairs();const before=JSON.stringify(game.state);ui.refresh(host,game);
 assert.deepEqual(called,[id]);assert.equal(JSON.stringify(game.state),before);assert.equal(bar.getAttribute('aria-valuenow'),String(full.max*.35));
 assert.equal(host.querySelector('#first [data-durability-current]').textContent,(full.max*.35).toLocaleString('ja-JP'));assert.equal(host.querySelector('#second [data-durability-current]').textContent,(full.max*.35).toLocaleString('ja-JP'));
 assert(nodes.every(node=>node.isConnected));assert.strictEqual(doc.activeElement,input);assert.equal(input.value,'次の編成');assert.deepEqual([input.selectionStart,input.selectionEnd,input.selectionDirection],[1,3,'backward']);assert.equal(host.scrollTop,219);assert.strictEqual(host.querySelector('[role="meter"]'),bar);
 let changes=0;doc.onRemove=()=>changes++;doc.onAttributeChange=()=>changes++;ui.refresh(host,game);assert.equal(changes,0,'unchanged snapshots must not rewrite the DOM');
});

test('fallen and unfinished branches display zero and do not advertise automatic repair',()=>{
 const game=fresh(),{host}=setup();game.state.castles.nijo.owner=game.state.clan;game.state.branches=[{id:'nijo_north',parentCastleId:'nijo',direction:'north',level:2,fallen:true},{id:'nijo_south',parentCastleId:'nijo',direction:'south',level:0,fallen:false}];
 const fallen=game.branch('nijo_north'),unbuilt=game.branch('nijo_south');host.innerHTML=ui.markup(fallen.durability,{kind:'branch',id:fallen.id,live:true});assert.equal(host.querySelector('[role="meter"]').getAttribute('aria-valuenow'),'0');assert.match(host.textContent,/復旧工事/);assert(!host.textContent.includes('自動修復'));
 host.innerHTML=ui.markup(unbuilt.durability);assert.match(host.textContent,/未完成/);assert.equal(host.querySelector('[role="meter"]').getAttribute('aria-valuenow'),'0');assert(Number(host.querySelector('[role="meter"]').getAttribute('aria-valuemax'))>0);
});

test('battle reports distinguish damage and post-capture restoration',()=>{
 const {host}=setup(),game=fresh(),view=game.castle(game.state.home).durability;
 const failed=E.durabilityAfterBattle(view,{won:false,ratio:.5,elapsedMs:0});host.innerHTML=ui.battleMarkup(failed);assert.match(host.textContent,/戦闘前/);assert.match(host.textContent,/損傷/);assert.match(host.textContent,/戦闘後/);assert(!host.textContent.includes('25%'));
 const captured=E.durabilityAfterBattle(view,{won:true,ratio:2,captured:true,elapsedMs:0});host.innerHTML=ui.battleMarkup(captured);assert.match(host.textContent,/25%/);assert(host.textContent.includes(Math.floor(captured.after).toLocaleString('ja-JP')));
 assert.equal(ui.battleMarkup({before:NaN,after:0,damage:0,max:100}),'');
});

test('paid repair labels show material prices and full bases show no recurring fee',()=>{
 const {host}=setup(),game=fresh(),id=game.state.home,full=game.castle(id).durability;
 game.state.castles[id].durability={version:1,current:full.max/2,max:full.max,updatedElapsedMs:0};
 host.innerHTML=ui.markup(game.castle(id).durability);assert.match(host.textContent,/月替わり/);assert.match(host.textContent,/木材50・石材40/);assert.match(ui.explanation(),/回復100につき木材5・石材4/);
 delete game.state.castles[id].durability;host.innerHTML=ui.markup(game.castle(id).durability);assert.match(host.textContent,/修復費なし/);
});

console.log(count+' durability UI checks passed with real engine values and DOM preservation.');

