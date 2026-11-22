'use strict';
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
execFileSync(process.execPath, ['tools/build-game-entry.cjs', '--check'], {cwd:root});
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const src = /name="sengoku-geography" content="([^"]+)"/.exec(html)[1];
assert(!/<script\b[^>]*src="map-data\.js/i.test(html));
const groups = require('../tools/game-entry.json');
for (const name of Object.keys(groups).filter(name=>name.endsWith('.js'))) new vm.Script(fs.readFileSync(path.join(root,name),'utf8'), {filename:name});
const global = {}, scripts = [];
const document = {querySelector:()=>({content:src}), createElement:()=>({remove(){}}), head:{append:script=>scripts.push(script)}};
function view() {
  const button = {addEventListener(type,cb){this.click=cb;}};
  return {ownerDocument:document, isConnected:true, querySelector:()=>button, button};
}
const settle = ()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
  vm.runInNewContext(fs.readFileSync(path.join(root,'world-map.js'),'utf8'), {window:global});
  const prepare=global.SengokuWorldMap.prepareGeography, a=view(), b=view();
  const calls=[];
  assert.equal(prepare(a,()=>calls.push('old')),false);
  prepare(a,()=>calls.push('latest'));
  prepare(b,()=>calls.push('detached')); b.isConnected=false;
  assert.equal(scripts.length,1);assert.equal(scripts[0].src,src);
  scripts[0].onerror(); await settle();
  assert.match(a.innerHTML,/再読み込み/);
  prepare(a,()=>{calls.push('retry');prepare(a,()=>calls.push('loaded'));});
  a.button.click();assert.equal(scripts.length,2);
  prepare(a,()=>calls.push('latest on success'));
  global.SENGOKU_GEOGRAPHY={land:{}};scripts[1].onload();await settle();
  assert.deepEqual(calls,['retry','latest on success']);
  assert.equal(prepare(b,()=>calls.push('unexpected')),true);assert.equal(scripts.length,2);
  console.log('PASS bundled source parity and deferred geography single fetch, retry, latest draw and detached view.');
})().catch(error=>{console.error(error);process.exitCode=1;});
