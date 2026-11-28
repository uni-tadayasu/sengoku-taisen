// Decide speech register from the actual addressed audience. Raw roles and save
// data stay inside the Worker; callers receive only the final text and a write guard.
import {PUBLIC_COURT_TITLES,resolvePublicCourtOffices} from './public-court.js';
import {honorificText} from './honorific-text.js';

const offices=['',...PUBLIC_COURT_TITLES.map(row=>row.title),'太政大臣','摂政','天皇'];
// Both imperial titles receive the same courtesy. This ordering never grants
// the retired Emperor access to the reigning Emperor's approval functions.
const tier=person=>person.courtOffice?.title==='上皇'?offices.indexOf('天皇'):Math.max(0,offices.indexOf(person.courtOffice?.title||''));
const PUBLIC_PEER_LIMIT=32;
const officials="SELECT value AS id FROM settings WHERE key='adminUserId' UNION SELECT user_id AS id FROM staff_members UNION SELECT user_id AS id FROM court_retained_memberships UNION SELECT g.user_id AS id FROM court_regent g WHERE g.id=1 AND NOT EXISTS(SELECT 1 FROM court_retired_emperors r WHERE r.user_id=g.user_id)";
// The public room reaches all current titles, including the external
// appointments. The delegated regent can also answer private court audiences;
// retired Emperors and ordinary external titles do not receive those powers.
const publicOfficeHolders='SELECT id FROM ('+officials+') UNION SELECT user_id AS id FROM court_external_offices UNION SELECT user_id AS id FROM court_retired_emperors';
const active=id=>`NOT EXISTS(SELECT 1 FROM player_bans ban WHERE ban.user_id=${id} AND ban.active=1)`;

function recipients(audience,senderId){
 switch(audience.kind){
  case 'person': return {sql:'SELECT ? AS id',args:[audience.id]};
  case 'officials': return {sql:officials,args:[]};
  case 'operations': return {sql:"SELECT value AS id FROM settings WHERE key='adminUserId' UNION SELECT user_id AS id FROM staff_members UNION SELECT user_id AS id FROM deputy_operator_state WHERE id=1",args:[]};
  case 'guild':
  case 'guild-officers': {
   const managers=audience.kind==='guild-officers'?" AND (g.owner_id=gm.user_id OR EXISTS(SELECT 1 FROM guild_officers go WHERE go.guild_id=g.id AND go.user_id=gm.user_id))":'';
   const outside=audience.sender?' UNION SELECT ? AS id':'';
   return {sql:`SELECT gm.user_id AS id FROM guild_members gm JOIN guilds g ON g.id=gm.guild_id WHERE gm.guild_id=?${managers}${outside}`,args:audience.sender?[audience.id,audience.sender]:[audience.id]};
  }
  case 'public': {
   // A public room also reaches offline players. Read at most one more than
   // the peer limit from the save index, never decode the whole population.
   const ordinary=`SELECT ps.user_id AS id FROM player_saves ps WHERE ps.user_id<>? AND ps.save_json IS NOT NULL AND ${active('ps.user_id')} AND ps.user_id NOT IN (SELECT id FROM (${publicOfficeHolders}) WHERE id IS NOT NULL) ORDER BY ps.user_id LIMIT ${PUBLIC_PEER_LIMIT+1}`;
   // D1 permits five terms in one compound SELECT. Group the office sources
   // so adding ordinary readers and the sender below stays
   // within that limit, while UNION still deduplicates overlapping roles.
   return {sql:`SELECT id FROM (${publicOfficeHolders}) UNION SELECT id FROM (${ordinary})`,args:[senderId]};
  }
  default: throw new Error('Unknown message audience');
 }
}

function audienceSnapshot(audience,senderId){
 const recipientsQuery=recipients(audience,senderId);
 // Captures changes during an asynchronous conversion or between querying the
 // public rank and storing it, including a new guild member or a demotion.
 const seats=`SELECT u.id,ps.revision AS saveRevision,CASE WHEN s.value=u.id THEN 1 ELSE 0 END AS chancellor,
   sm.appointed_at,sm.term_id,leader.appointment_token,b.active,b.transition_token,b.updated_at AS backupUpdated,
   COALESCE((SELECT merit FROM court_rank_progress p WHERE p.user_id=u.id),0) AS merit,
   (SELECT term_id FROM court_retained_memberships cm WHERE cm.user_id=u.id) AS retainedTerm,
   (SELECT r.succession_id FROM court_retired_emperors r WHERE r.user_id=u.id) AS retirement,
   (SELECT g.appointment_token FROM court_regent g WHERE g.id=1 AND g.user_id=u.id) AS regency
   FROM users u JOIN (${recipientsQuery.sql} UNION SELECT ? AS id) people ON people.id=u.id
   LEFT JOIN player_saves ps ON ps.user_id=u.id LEFT JOIN staff_members sm ON sm.user_id=u.id
   LEFT JOIN court_leader leader ON leader.user_id=u.id LEFT JOIN settings s ON s.key='adminUserId'
   LEFT JOIN staff_campaign_backups b ON b.user_id=u.id WHERE ${active('u.id')} ORDER BY u.id`;
 const sql=`SELECT json_array((SELECT revision FROM world_clock WHERE id='world-v1'),
   (SELECT value FROM settings WHERE key='cyclePolicyStart'),(SELECT revision FROM staff_base WHERE id='kyoto_gosho'),
   json_group_array(json_array(id,saveRevision,chancellor,appointed_at,term_id,appointment_token,active,transition_token,backupUpdated,merit,retirement,regency,retainedTerm)),
   COALESCE((SELECT revision FROM court_office_state WHERE id=1),0),
   COALESCE((SELECT revision FROM court_regency_state WHERE id=1),0)) AS version FROM (${seats})`;
 return {sql,args:[...recipientsQuery.args,senderId]};
}

export async function messageRegister(db,sender,audience,now,rankPlayers,fail){
 const versionQuery=audienceSnapshot(audience,sender.id);
 const {version}=await db.prepare(versionQuery.sql).bind(...versionQuery.args).first();
 const records=JSON.parse(version)[3];
 const people=records.map(([id])=>({playerId:id,evaluation:null}));
 await resolvePublicCourtOffices(db,people,now);
 const author=people.find(p=>p.playerId===sender.id);
 if(!author)fail(409,'MESSAGE_AUDIENCE_CHANGED','宛先の状況が変わりました。もう一度送信してください。');
 const authorTier=tier(author),others=people.filter(p=>p!==author);
 let polite=others.some(p=>tier(p)>authorTier);
 if(!polite){
  const peers=others.filter(p=>tier(p)===authorTier);
  if(audience.kind==='public'&&authorTier===0&&peers.length>PUBLIC_PEER_LIMIT)polite=true;
  else if(peers.length){
   // Every guild is capped at 50 members. Free-text broadcasts compare one
   // office tier only, so low-ranking readers never cause downward rewriting.
   const ranks=await rankPlayers([sender.id,...peers.map(p=>p.playerId)]);
   const own=ranks.get(sender.id);
   if(own==null||peers.some(p=>ranks.get(p.playerId)==null))fail(409,'MESSAGE_RANK_UNAVAILABLE','位階を確認できませんでした。時間を置いて再送してください。');
   polite=peers.some(p=>ranks.get(p.playerId)>own);
  }
 }
 const guard={sql:`(${versionQuery.sql})=?`,args:[...versionQuery.args,version]};
 return {guard,async write(text,field='body',max=Infinity){
  if(!polite||!text)return text;
  const converted=await honorificText(text,{field});
  if(Array.from(converted).length>max)fail(400,'POLITE_TEXT_TOO_LONG',`敬語に整えた後の文章が${max}文字を超えます。本文を短くして再送してください。`);
  return converted;
 }};
}
