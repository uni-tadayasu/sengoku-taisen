'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {setup}=require('./helpers/dom-model.cjs');
const records=require('../campaign-records.js');

function test(name,run) {run();console.log('PASS '+name);}
function report(name,won,type,index,changes={}) {
  return {id:type+':'+index,name,won,turn:index+1,attack:2600,defense:1700,lost:84,chance:76,
    summary:'保存時の結果',army:['a','b'],...changes};
}
function fixture(reports) {
  const {doc}=setup(),blobs=[],downloads=[],events={};
  const game={state:{clan:'織田家',home:'kiyosu',log:[{text:'清洲で普請',kind:'build',turn:8}],progress:{reports}},
    officer:id=>({name:{a:'織田信長',b:'明智光秀'}[id]||id})};
  const win={document:doc,addEventListener:(name,fn)=>{events[name]=fn;},removeEventListener:name=>{delete events[name];},
    URL:{createObjectURL(blob){blobs.push(blob);return 'blob:report';},revokeObjectURL(){}},
    Blob:class{constructor(parts){this.text=parts.join('');}},setTimeout:fn=>fn()};
  const create=doc.createElement.bind(doc);
  doc.createElement=name=>{const node=create(name);if(name==='a')node.click=()=>downloads.push(node.download);return node;};
  vm.runInNewContext(fs.readFileSync(require.resolve('../campaign-records.js'),'utf8'),{window:win});
  const api=win.SengokuCampaignRecords;api.open({getGame:()=>game,formatDate:turn=>'月 '+turn});
  const q=selector=>doc.querySelector(selector);
  const click=selector=>q(selector).dispatchEvent({type:'click'});
  const change=(selector,value,type='change')=>{const el=q(selector);el.value=value;el.dispatchEvent({type});};
  return {game,q,click,change,api,doc,blobs,downloads,events};
}

const officerScope={window:{}};
vm.runInNewContext(fs.readFileSync(require.resolve('../officers-data.js'),'utf8'),officerScope);
const officers=JSON.parse(JSON.stringify(officerScope.window.SENGOKU_OFFICERS));
const {SengokuEngine:Engine}=require('../engine.js');

test('actual engine attack survives a save round trip and uses the recorded army and strengths',()=>{
  const g=new Engine({officers,seed:1});const castle=g.adjacentTargets()[0],army=g.state.army.slice();
  g.state.troops=100000;g.state.resources.rice=999999;
  const preview=g.battleAnalysis(castle.id,'balanced',100000);
  const battle=g.attack(castle.id,'balanced',100000);assert.ok(battle.ok);
  const loaded=Engine.fromSave(g.exportSave(),officers),save=JSON.stringify(loaded.state);
  const [r]=records.battleSnapshot(loaded);
  assert.equal(r.battleType,'攻城戦');assert.equal(r.name,castle.name);assert.equal(r.attack,preview.attackPower);
  assert.equal(r.defense,preview.defensePower);assert.equal(r.chance,preview.winChance);assert.equal(r.lost,battle.battle.ourLost);
  assert.deepEqual(r.army,army.map(id=>g.officer(id).name));assert.equal(JSON.stringify(loaded.state),save);
});
test('a marching attack displays the odds recorded at battle resolution after the enemy reinforces',()=>{
  const g=new Engine({officers,seed:1});
  const target=g.adjacentTargets().find(c=>g.previewBattle(c.id,'balanced',1000).ok);
  assert.ok(target);g.state.castles[target.id].troops=300;
  const departure=g.previewBattle(target.id,'balanced',1000);
  const march=g.departAttack(target.id,'balanced',1000);
  assert.ok(march.accepted);
  g.state.castles[target.id].troops=50000;
  for(let remaining=march.march.travel.durationMs/1000;remaining>0;remaining-=5)g.tick(Math.min(5,remaining));
  assert.equal(g.state.march,null);
  const [row]=records.battleSnapshot(g);
  assert.ok(row.chance<departure.winChance);
  assert.equal(row.chance,g.state.progress.reports[0].chance);
  const f=fixture(g.state.progress.reports);
  f.click('[data-records-view="battles"]');
  assert.ok(f.q('[data-records-list]').textContent.includes('合戦時の見込み'+row.chance+'%'));
  f.click('[data-records-export]');
  assert.ok(f.blobs[0].text.includes('合戦時の見込み：'+row.chance+'%'));
});
test('legacy, unknown and incomplete reports keep unknown metrics distinct from zero',()=>{
  assert.deepEqual(records.battleSnapshot({state:{}}),[]);
  const f=fixture([null,{won:'yes'},report('山城',true,'newKind',0,{lost:null,turn:null,army:['旧武将'],chance:200}),
    report('砦',false,'attackBranch',1,{lost:0})]);
  f.click('[data-records-view="battles"]');
  assert.match(f.q('[data-records-battle-summary]').textContent,/勝利 1戦 ／ 敗北 1戦 ／ 実績勝率 50% ／ 自軍兵損 0人（記録のある1戦）/);
  assert.match(f.q('[data-records-list]').textContent,/時点不明/);assert.match(f.q('[data-records-list]').textContent,/未記録/);
  assert.match(f.q('[data-records-list]').textContent,/旧武将/);assert.match(f.q('[data-records-list]').textContent,/支拠点戦/);
});
test('field, officer and outcome filters operate on bounded reports, compose with IME and export every matching battle',()=>{
  const input='[data-records-query]',group='[data-records-group]';
  const sample=Array.from({length:35},(_,i)=>report('カナ城 '+i,i%3!==0,'attack',i,{lost:i+1}));
  const f=fixture(sample),before=JSON.stringify(f.game.state);
  f.change(input,'清洲','input');f.change(group,'development');f.q('[data-records-scroll]').scrollTop=120;
  f.click('[data-records-view="battles"]');
  assert.equal(f.q('[data-records-list]').childNodes.length,20);
  assert.match(f.q('[data-records-count]').textContent,/30戦/);assert.match(f.q('[data-records-battle-summary]').textContent,/実績勝率 67%/);
  f.q(input).value='ｶﾅ 織田';f.q(input).dispatchEvent({type:'input',isComposing:true});assert.equal(f.q(input).value,'ｶﾅ 織田');
  f.q(input).dispatchEvent({type:'compositionend'});f.change(group,'won');
  assert.match(f.q('[data-records-count]').textContent,/検索結果 20戦/);assert.match(f.q('[data-records-battle-summary]').textContent,/勝利 20戦 ／ 敗北 0戦/);
  f.click('[data-records-export]');assert.equal(f.downloads[0],'sengoku-battle-reports.txt');
  assert.equal((f.blobs[0].text.match(/【/g)||[]).length,20);assert.match(f.blobs[0].text,/出陣した武将：織田信長・明智光秀/);
  f.click('[data-records-view="journal"]');assert.equal(f.q(input).value,'清洲');assert.equal(f.q(group).value,'development');assert.equal(f.q('[data-records-scroll]').scrollTop,120);
  f.click('[data-records-view="battles"]');assert.equal(f.q(input).value,'ｶﾅ 織田');assert.equal(f.q(group).value,'won');
  assert.deepEqual(JSON.stringify(f.game.state),before);
});
test('two battle columns can be swapped, persist by record across explicit refresh and handle evicted reports',()=>{
  const f=fixture([report('西の城',true,'attack',0),report('東の砦',false,'attackBranch',1),report('野良兵',true,'battleRoaming',2,{chance:100})]);
  f.click('[data-records-view="battles"]');
  const a='[data-records-pick="0"]',b='[data-records-pick="1"]',table='[data-records-comparison]';
  f.change(a,'1');assert.equal(f.q(b).value,'0');
  f.change(b,'2');assert.match(f.q(table).textContent,/東の砦野良兵/);assert.match(f.q(table).textContent,/76%勝利見込み/);
  f.game.state.progress.reports.unshift(report('新しい城',true,'attack',3));f.events['sengoku:game-saved']({});
  assert.equal(f.q(a).value,'1');f.click('[data-records-refresh]');assert.equal(f.q(a).value,'2');assert.equal(f.q(b).value,'3');
  f.game.state.progress.reports.splice(2,1);f.click('[data-records-refresh]');
  assert.equal(f.q(a).value,'0');assert.equal(f.q(b).value,'2');
  f.change('[data-records-query]','野良兵','input');assert.ok(f.q('[data-records-compare]').hidden);
  f.change('[data-records-query]','存在しない戦場','input');assert.ok(f.q('[data-records-overview]').hidden);
  assert.ok(f.q('[data-records-export]').disabled);
});
test('report content is escaped in cards, choices and comparison and is cleared when the game scope changes',()=>{
  const f=fixture([report('<img src=x>',false,'attack',0,{army:['<b>武将</b>']}),report('城',true,'attack',1)]);
  f.click('[data-records-view="battles"]');assert.equal(f.q('.campaign-battle img'),null);
  assert.match(f.q('[data-records-comparison]').textContent,/<img src=x>/);assert.equal(f.q('[data-records-comparison] img'),null);
  f.game.state.home='other';f.events['sengoku:game-saved']({});
  assert.equal(f.q('.campaign-records-dialog').open,false);
  for(const selector of ['[data-records-comparison]','[data-records-pick]','[data-records-list]','[data-records-battle-summary]'])assert.equal(f.q(selector).textContent,'');
});
test('older saves without reports keep journal access and offer an explicit empty state',()=>{
  const f=fixture();f.click('[data-records-view="battles"]');
  assert.match(f.q('[data-records-empty]').textContent,/出陣戦績はまだありません/);
  assert.ok(f.q('[data-records-overview]').hidden);
  f.click('[data-records-view="journal"]');assert.match(f.q('[data-records-list]').textContent,/清洲で普請/);
});
