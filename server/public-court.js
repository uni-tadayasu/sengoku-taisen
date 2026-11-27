// Public offices are presentation data. Authority remains in the existing
// account, staff-term and appointment guards; no role flag is projected here.
import {COURT_OFFICES} from './court-offices.js';
const statement=(db,sql,...args)=>db.prepare(sql).bind(...args);
const validId=value=>typeof value==='string'&&/^u_[A-Za-z0-9_]{1,96}$/.test(value);
const SKIP=new Set(['save','state','entitlements','staffBase','appearance','courtOffice']);
const FIELDS=[
 ['playerId','playerName','playerCourtOffice'],
 ['ownerId','ownerName','ownerCourtOffice'],
 ['authorId','authorName','authorCourtOffice'],
 ['targetPlayerId','targetName','targetCourtOffice'],
 ['attackerPlayerId','attackerName','attackerCourtOffice'],
 ['defenderPlayerId','defenderName','defenderCourtOffice'],
 ['actorPlayerId','actorName','actorCourtOffice'],
 ['lordPlayerId','lordName','lordCourtOffice'],
 ['previousLordPlayerId','previousLordName','previousLordCourtOffice']
];
export const PUBLIC_COURT_TITLES=Object.freeze(COURT_OFFICES.map(({title,minMerit})=>({title,minMerit})));

export async function resolvePublicCourtOffices(db,payload,now=Date.now()){
 const refs=[],ids=new Set(),voiceRefs=[];
 const add=(value,id,key)=>{if(validId(id)){refs.push({value,id,key});ids.add(id);}};
 function visit(value){
  if(!value||typeof value!=='object')return;
  const id=value.playerId||value.userId||value.id;
  if(typeof value.name==='string'||value.playerId&&Object.hasOwn(value,'evaluation'))add(value,id,'courtOffice');
  if(typeof value.name==='string'&&/^vc_[a-f0-9]{32}$/.test(value.sessionId||''))voiceRefs.push(value);
  for(const [idKey,nameKey,key]of FIELDS)if(typeof value[nameKey]==='string')add(value,value[idKey],key);
  for(const [key,child]of Object.entries(value))if(!SKIP.has(key))visit(child);
 }
 visit(payload);
 // Only the authenticated shared-base DTO carries verified construction authors.
 // Keep the personal campaign and other saved identities outside the projection.
 for(const job of Array.isArray(payload?.staffBase?.jobs)?payload.staffBase.jobs:[]){
  const author=job?.startedBy;
  if(typeof author?.name==='string')add(author,author.id,'courtOffice');
 }
 // Voice rooms intentionally publish session IDs instead of account IDs.
 // Resolve only the visible session's office without adding its private ID.
 if(voiceRefs.length){const sessions=[...new Set(voiceRefs.map(value=>value.sessionId))],mapping=new Map();for(let offset=0;offset<sessions.length;offset+=80){const page=sessions.slice(offset,offset+80),found=await statement(db,`SELECT id,user_id FROM voice_sessions WHERE id IN (${page.map(()=>'?').join(',')}) AND lease_until>?`,...page,now).all();for(const row of found.results||[])mapping.set(row.id,row.user_id);}for(const value of voiceRefs){value.courtOffice=null;if(mapping.has(value.sessionId))add(value,mapping.get(value.sessionId),'courtOffice');}}
 if(!ids.size)return payload;
 const selected=[...ids],queries=[];
 for(let offset=0;offset<selected.length;offset+=80){
  const page=selected.slice(offset,offset+80);
  queries.push(statement(db,`/* public-court-office */ SELECT u.id,
   CASE WHEN u.id=(SELECT value FROM settings WHERE key='adminUserId') THEN 1 ELSE 0 END AS chancellor,
   CASE WHEN sm.user_id IS NOT NULL AND sm.appointed_at<=? THEN 1 ELSE 0 END AS official,
   EXISTS(SELECT 1 FROM court_leader l WHERE l.id=1 AND l.user_id=u.id
    AND l.term_id=COALESCE(sm.term_id,'legacy:'||sm.appointed_at) AND l.updated_at<=?) AS emperor,
   COALESCE((SELECT SUM(c.points) FROM court_contributions c WHERE c.actor_id=u.id),0) AS merit,
   (SELECT a.office_id FROM court_external_offices a WHERE a.user_id=u.id AND a.appointed_at<=?) AS external_office,
   EXISTS(SELECT 1 FROM court_retired_emperors r WHERE r.user_id=u.id AND r.retired_at<=?) AS retired_emperor,
   EXISTS(SELECT 1 FROM court_regent g WHERE g.id=1 AND g.user_id=u.id AND g.appointed_at<=?
    AND NOT EXISTS(SELECT 1 FROM court_retired_emperors r WHERE r.user_id=u.id)) AS regent
   FROM users u LEFT JOIN staff_members sm ON sm.user_id=u.id
   WHERE u.id IN (${page.map(()=>'?').join(',')})
    AND NOT EXISTS(SELECT 1 FROM player_bans b WHERE b.user_id=u.id AND b.active=1)`,now,now,now,now,now,...page));
 }
 // One ordered batch supplies a consistent snapshot for every visible label.
 const result=await db.batch(queries),offices=new Map();
 for(const batch of result)for(const row of batch.results||[]){
  if(row.chancellor)offices.set(row.id,{title:'太政大臣',kind:'chancellor'});
  else if(row.official&&row.emperor)offices.set(row.id,{title:'天皇',kind:'emperor'});
  else if(row.regent)offices.set(row.id,{title:'摂政',kind:'regent'});
  else if(row.retired_emperor)offices.set(row.id,{title:'上皇',kind:'retired-emperor'});
  else if(row.official){const title=[...PUBLIC_COURT_TITLES].reverse().find(item=>Number(row.merit)>=item.minMerit).title;offices.set(row.id,{title,kind:'official',jurisdiction:'kyoto'});}
  else if(row.external_office){const office=COURT_OFFICES.find(definition=>definition.id===row.external_office);if(office)offices.set(row.id,{title:office.title,kind:'official',jurisdiction:'external'});}
 }
 for(const ref of refs)ref.value[ref.key]=offices.has(ref.id)?{...offices.get(ref.id)}:null;
 return payload;
}
