import assert from 'node:assert/strict';
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';

export const post=(player,body,expected=200)=>({method:'POST',token:player?.token,body,expected});
export const row=(h,player)=>h.sql.prepare('SELECT * FROM player_saves WHERE user_id=?').get(player.user.id);
export const save=(h,player)=>JSON.parse(row(h,player).save_json);
export const count=(h,table)=>h.sql.prepare('SELECT COUNT(*) AS n FROM '+table).get().n;
export async function fixture(h,name,{admin=false,staff=false,score=null,holdings=[],startCastle}={}){
 const player=await h.session(name);player.deviceId='court-device-'+player.user.id;
 if(admin){await h.api('/admin/claim',post(player,{key:h.env.SENGOKU_ADMIN_KEY}));h.operator=player;}
 const lease=(await h.api('/sync/lease',post(player,{deviceId:player.deviceId}))).data;
 const game=new GameEngine({officers:GAME_OFFICERS,seed:17,isAdmin:admin,startCastle});game.applyWorldClock(lease.clock);
 game.state.resources={gold:900000,rice:900000,wood:900000,stone:900000};game.state.troops=10000;game.state.buildings.keep=16;
 for(const id of holdings)game.state.castles[id].owner=game.state.clan;
 if(score!==null){for(const key of Object.keys(game.state.buildings))game.state.buildings[key]=16;for(const key of Object.keys(game.state.tech))game.state.tech[key]=5;game.state.prestige=0;game.state.stats.wins=0;const base=GameEngine.publicEvaluation(game.state,{officers:GAME_OFFICERS}).score;game.state.prestige=(score-base)*2;assert(game.state.prestige>=0&&game.state.prestige<=20000);assert.equal(GameEngine.publicEvaluation(game.state,{officers:GAME_OFFICERS}).score,score);}
 game.state.command=game.commandMax();
 await h.api('/sync',{method:'PUT',token:player.token,body:{deviceId:player.deviceId,revision:lease.revision,save:JSON.parse(game.exportSave())}});
 if(staff){assert(h.operator);await h.api('/admin/staff',post(h.operator,{targetPlayerId:player.user.id,action:'appoint',requestId:crypto.randomUUID()}));await h.api('/sync?deviceId='+player.deviceId,{token:player.token});}
 return player;
}
// Historical court tests focus on their own capability, not the separate
// earned lineage workflow. Crown fixtures now explicitly have royal ancestry.
export function makeImperial(h,player){
 const name='試験'+player.user.id.slice(-12)+'宮';
 h.sql.prepare(`INSERT INTO court_lineages(user_id,house_id,original_clan,imperial_house_name,imperial_house_key,revision,created_at,updated_at)
  VALUES(?,'konoe','織田家',?,?,1,?,?) ON CONFLICT(user_id) DO UPDATE SET
  imperial_house_name=COALESCE(court_lineages.imperial_house_name,excluded.imperial_house_name),
  imperial_house_key=COALESCE(court_lineages.imperial_house_key,excluded.imperial_house_key)`).run(player.user.id,name,name,h.now,h.now);
}
export const appoint=(h,player,expected=200,requestId=crypto.randomUUID())=>{if(player&&expected===200)makeImperial(h,player);return h.api('/admin/court/leader',post(h.operator,{requestId,targetPlayerId:player?.user.id??null},expected));};
export async function nominateSuccessor(h,emperor,target){
 makeImperial(h,target);
 const directory=(await h.api('/court/succession',{token:emperor.token})).data,candidate=directory.candidates.find(person=>person.id===target.user.id);
 assert(candidate,'The successor must be a current Kyoto member');
 return(await h.api('/court/succession',post(emperor,{requestId:crypto.randomUUID(),targetPlayerId:target.user.id,targetTermId:candidate.termId,sourceAppointmentToken:directory.sourceAppointmentToken}))).data;
}
export async function certifySuccessor(h,admin,nomination){
 return(await h.api('/admin/court/succession/'+nomination.id+'/approve',post(admin,{requestId:crypto.randomUUID(),expectedRevision:nomination.revision}))).data;
}
export function updateSave(h,player,change){const value=save(h,player);change(value.state);h.sql.prepare('UPDATE player_saves SET save_json=?,revision=revision+1 WHERE user_id=?').run(JSON.stringify(value),player.user.id);}
