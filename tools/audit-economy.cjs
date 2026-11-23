/* Reproducible resource-balance scenarios. No services or player saves are used. */
'use strict';
const fs=require('node:fs'),vm=require('node:vm');
const {SengokuEngine:E,SENGOKU_DATA:D}=require('../engine.js');
const scope={window:{}};vm.runInNewContext(fs.readFileSync(require.resolve('../officers-data.js'),'utf8'),scope);
const officers=JSON.parse(JSON.stringify(scope.window.SENGOKU_OFFICERS));
function fixture(level=null,castles=1){
 const game=new E({clan:'武田家',officers,seed:4915});game._cpuTurn=()=>[];game.state.governors={};
 if(level){for(const building of D.buildings)game.state.buildings[building.id]=building.requiredKeep<=level?level:0;for(const id of Object.keys(game.state.tech))game.state.tech[id]=Math.min(5,Math.floor(level/6));}
 for(const castle of D.castles){if(game.ownedCastles().length>=castles)break;if(game.canOwnCastle(castle.id))game.state.castles[castle.id].owner=game.state.clan;}
 for(const castle of game.ownedCastles()){game.state.castles[castle.id].level=level||1;game.state.castles[castle.id].troops=1200;}
 game.state.troops=level?Math.floor(game.troopCapacity()/2):3400;return game;
}
function report(){
 const monthly=[null,4,8,16,32].map(level=>{const game=fixture(level),income=game.income();return{level:level||'start',castles:1,troops:income.totalTroops,gross:income.gross,facilityUpkeep:income.facilityUpkeep,troopUpkeep:income.troopUpkeep,previousNet:income.rawNet,balancedNet:income.net,surplusAdjustment:income.surplusAdjustment};});
 const idle=[];
 for(const level of [null,8,32])for(const months of [10,60,360,480])for(const balance of ['previous','balanced']){
  const game=fixture(level),start={...game.state.resources};
  if(balance==='previous'){const actualIncome=game.income;game.income=function(){const current=actualIncome.call(this);return{...current,...current.rawNet,net:current.rawNet,surplusAdjustment:Object.fromEntries(D.resources.map(key=>[key,0]))};};}
  game._advanceRealtime(months*60);idle.push({level:level||'start',months,balance,gained:Object.fromEntries(D.resources.map(key=>[key,game.state.resources[key]-start[key]])),troops:game.maintenance().totalTroops});
 }
 const territory=[1,2,3,4,5,8,12,16].map(castles=>{const game=fixture(16,castles);return{castles,multiplier:game.upgradeCostMultiplier(),nextMarket:game.costs('market'),net:game.income().net};});
 return{assumptions:'Takeda; no governors; every unlocked facility at the stated level; technology=min(5,floor(level/6)); one castle unless specified; army at half current capacity; CPU invasions disabled to isolate the economy; normal monthly garrison growth and random events retained;1game month=60seconds at1x.',rules:E.economyRules,monthly,idle,territory};
}
if(require.main===module)console.log(JSON.stringify(report(),null,2));
module.exports={fixture,report,officers};
