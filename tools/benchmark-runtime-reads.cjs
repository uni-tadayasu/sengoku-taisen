/* Isolated synthetic campaign. Optional argv[2] is a prior engine.js checkout. */
'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),{performance}=require('node:perf_hooks');
const {SengokuEngine:E,SENGOKU_DATA:D}=require('../engine.js');
const {fixture,officers}=require('./audit-economy.cjs');
const game=fixture(32,100);game.state.officers=officers.map(officer=>officer.id);
game.state.officerVariants=officers.flatMap(officer=>D.ranks.filter(rank=>game.canOwnOfficerVariant(officer.id,rank)).map(rank=>officer.id+':'+rank));
game.state.army=officers.slice(0,3).map(officer=>officer.id);
game.state.governors=Object.fromEntries(D.buildings.map((building,index)=>[building.id,officers[index+3].id]));
const baseline=process.argv[2]?require(path.resolve(process.argv[2])).SengokuEngine:null;
const previous=baseline?new baseline({clan:'武田家',officers,seed:4915}):null;
if(previous){previous.state=structuredClone(game.state);assert.deepEqual(game.evaluation(),previous.evaluation());assert.deepEqual(game.income(),previous.income());assert.deepEqual(game.adjacentTargets(),previous.adjacentTargets());}
function medianMs(read){for(let index=0;index<50;index++)read();const samples=[];for(let trial=0;trial<7;trial++){const start=performance.now();for(let index=0;index<400;index++)read();samples.push((performance.now()-start)/400);}return samples.sort((a,b)=>a-b)[3];}
const operations={evaluation:engine=>engine.evaluation(),income:engine=>engine.income(),syncSnapshot:engine=>engine.exportSnapshot?engine.exportSnapshot():JSON.parse(engine.exportSave()),adjacentTargets:engine=>engine.adjacentTargets(),questBriefing:engine=>D.quests.map(quest=>engine.questStatus(quest.id))};
const measurements={};
for(const [name,read]of Object.entries(operations)){
 const beforeMs=previous?medianMs(()=>read(previous)):null,afterMs=medianMs(()=>read(game));
 measurements[name]={...(previous?{beforeMs}:{}),afterMs,...(previous?{reductionPercent:100*(1-afterMs/beforeMs)}:{})};
}
console.log(JSON.stringify({scenario:{officers:officers.length,variants:game.state.officerVariants.length,castles:100,facilityLevel:32,governors:D.buildings.length,trials:7,iterationsPerTrial:400,unit:'milliseconds/read',comparison:'same normalized state; median; local Node runtime; no live players or requests'},measurements,storageBytes:{readable:Buffer.byteLength(game.exportSave()),compact:Buffer.byteLength(game.exportSave({compact:true}))}},null,2));
