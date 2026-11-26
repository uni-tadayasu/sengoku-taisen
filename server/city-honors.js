// Public, non-purchasable distinctions for the current holders of the game's
// five major cities. They never grant authority or alter combat/save data.
const statement=(db,sql,...args)=>db.prepare(sql).bind(...args);
const validId=value=>typeof value==='string'&&/^u_[A-Za-z0-9_]{1,96}$/.test(value);
export const CITY_HONORS=Object.freeze([
 {id:'edo',cityName:'江戸城',title:'江戸城の勲章'},
 {id:'kyoto_gosho',cityName:'京都御所',title:'京都御所の勲章'},
 {id:'nijo',cityName:'二条御所',title:'二条御所の勲章'},
 {id:'osaka',cityName:'大坂城',title:'大坂城の勲章'},
 {id:'nagoya',cityName:'名古屋城',title:'名古屋城の勲章'}
].map(Object.freeze));
const SKIP=new Set(['save','state','entitlements','staffBase','appearance','courtOffice','cityHonors']);
const FIELDS=[
 ['playerId','playerName','playerCityHonors'],
 ['ownerId','ownerName','ownerCityHonors'],
 ['authorId','authorName','authorCityHonors'],
 ['targetPlayerId','targetName','targetCityHonors'],
 ['attackerPlayerId','attackerName','attackerCityHonors'],
 ['defenderPlayerId','defenderName','defenderCityHonors'],
 ['actorPlayerId','actorName','actorCityHonors'],
 ['lordPlayerId','lordName','lordCityHonors'],
 ['previousLordPlayerId','previousLordName','previousLordCityHonors']
];

export async function resolvePublicCityHonors(db,payload,now,{getWorldClock,eventCastleCandidates}){
 const refs=[],ids=new Set(),voiceRefs=[];
 const add=(value,id,key)=>{if(validId(id)){refs.push({value,id,key});ids.add(id);}};
 function visit(value){
  if(!value||typeof value!=='object')return;
  const id=value.playerId||value.userId||value.id;
  if(typeof value.name==='string'||value.playerId&&Object.hasOwn(value,'evaluation'))add(value,id,'cityHonors');
  if(typeof value.name==='string'&&/^vc_[a-f0-9]{32}$/.test(value.sessionId||''))voiceRefs.push(value);
  for(const [idKey,nameKey,key]of FIELDS)if(typeof value[nameKey]==='string')add(value,value[idKey],key);
  for(const [key,child]of Object.entries(value))if(!SKIP.has(key))visit(child);
 }
 visit(payload);
 // Construction authors are authenticated shared-base data, unlike names
 // inside personal saves. Do not inspect or decorate the latter.
 for(const job of Array.isArray(payload?.staffBase?.jobs)?payload.staffBase.jobs:[]){
  if(typeof job?.startedBy?.name==='string')add(job.startedBy,job.startedBy.id,'cityHonors');
 }
 // Preserve voice participants' existing session-only privacy boundary.
 if(voiceRefs.length){
  const sessions=[...new Set(voiceRefs.map(value=>value.sessionId))],mapping=new Map();
  for(let offset=0;offset<sessions.length;offset+=80){
   const page=sessions.slice(offset,offset+80),found=await statement(db,`SELECT id,user_id FROM voice_sessions WHERE id IN (${page.map(()=>'?').join(',')}) AND lease_until>?`,...page,now).all();
   for(const row of found.results||[])mapping.set(row.id,row.user_id);
  }
  for(const value of voiceRefs){value.cityHonors=[];if(mapping.has(value.sessionId))add(value,mapping.get(value.sessionId),'cityHonors');}
 }
 if(!ids.size)return payload;
 const clock=await getWorldClock(db,now),selected=[...ids],queries=[];
 for(let offset=0;offset<selected.length;offset+=80){
  const page=selected.slice(offset,offset+80),args=[...page,now,now];
  const branches=[
   `SELECT u.id AS player_id,'edo' AS city_id FROM users u
    WHERE u.id IN(SELECT id FROM visible) AND u.id=(SELECT value FROM settings WHERE key='adminUserId')
    AND NOT EXISTS(SELECT 1 FROM player_bans b WHERE b.user_id=u.id AND b.active=1)`,
   `SELECT u.id AS player_id,'kyoto_gosho' AS city_id FROM users u
    JOIN staff_members sm ON sm.user_id=u.id JOIN court_leader l ON l.id=1 AND l.user_id=u.id
    AND l.term_id=COALESCE(sm.term_id,'legacy:'||sm.appointed_at)
    WHERE u.id IN(SELECT id FROM visible) AND sm.appointed_at<=? AND l.updated_at<=?
    AND u.id<>COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'')
    AND NOT EXISTS(SELECT 1 FROM player_bans b WHERE b.user_id=u.id AND b.active=1)`
  ];
  // Reuse the shared field's canonical ownership predicate. A captured outpost
  // expires at the world-cycle boundary; a surviving personal home does not.
  // Existing shared-city co-holders remain eligible without inventing a new
  // exclusive throne, and client-supplied labels/roles are never consulted.
  for(const city of CITY_HONORS.slice(2)){
   const candidate=eventCastleCandidates(city.id,clock);
   branches.push(`SELECT u.id AS player_id,'${city.id}' AS city_id ${candidate.source} AND u.id IN(SELECT id FROM visible)`);
   args.push(candidate.cycle,...candidate.params);
  }
  queries.push(statement(db,`/* public-city-honors */ WITH visible(id) AS (VALUES ${page.map(()=>'(?)').join(',')}) ${branches.join(' UNION ALL ')}`,...args));
 }
 const result=await db.batch(queries),owned=new Map();
 for(const batch of result)for(const row of batch.results||[]){
  if(!owned.has(row.player_id))owned.set(row.player_id,new Set());
  owned.get(row.player_id).add(row.city_id);
 }
 // Always return [] for a former holder so all viewers can remove a stale
 // medal after capture, appointment change, account suspension or cycle reset.
 for(const ref of refs)ref.value[ref.key]=CITY_HONORS.filter(city=>owned.get(ref.id)?.has(city.id)).map(city=>({...city}));
 return payload;
}
