// Kyoto's shared political control never subjects an authenticated retired
// sovereign. The retirement ledger and its completed succession receipt are
// authoritative; client titles, lineage labels and imported saves are not.
const S=(db,sql,...args)=>db.prepare(sql).bind(...args);
const ID=/^u_[A-Za-z0-9_]{1,96}$/;

export function shogunateIndependenceSql(userIdSql){
 return `(EXISTS(SELECT 1 FROM court_retired_emperors si_retired
  JOIN court_succession_requests si_succession ON si_succession.commit_token=si_retired.succession_id
   AND si_succession.actor_id=si_retired.user_id AND si_succession.target_id=si_retired.successor_id
  WHERE si_retired.user_id=${userIdSql})
  AND ${userIdSql}<>COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'')
  AND NOT EXISTS(SELECT 1 FROM court_kyoto_offices si_current WHERE si_current.user_id=${userIdSql} AND si_current.office_id='emperor'))`;
}

export async function readShogunateIndependence(db,userId){
 if(!ID.test(userId||''))return false;
 const row=await S(db,`SELECT ${shogunateIndependenceSql('si_user.id')} AS independent FROM users si_user WHERE si_user.id=?`,userId).first();
 return !!row?.independent;
}

// Negotiated service can predate both a retirement and a government's opening.
// Recheck the pair whenever it is admitted or projected so an old relation
// cannot make a retired sovereign a subject of a newly opened shogunate.
export function shogunateServiceAllowedSql(lordIdSql,subjectIdSql){
 return `NOT (${shogunateIndependenceSql(subjectIdSql)} AND EXISTS(SELECT 1 FROM shogunate_rights si_government WHERE si_government.user_id=${lordIdSql} AND si_government.opened_at IS NOT NULL))`;
}

// A bounded query covers the field's already selected players. Deliberately
// preserve the global palace controller for everyone else while clearing any
// stale per-player relation, including after a return to the shared palace.
export async function applyPalaceControl(db,people,control){
 const idOf=value=>value?.playerId||value?.userId||value?.id;
 const ids=[...new Set(people.map(idOf).filter(id=>ID.test(id||'')))],independent=new Set();
 for(let offset=0;offset<ids.length;offset+=80){
  const page=ids.slice(offset,offset+80),found=await S(db,`SELECT si_user.id FROM users si_user WHERE si_user.id IN (${page.map(()=>'?').join(',')}) AND ${shogunateIndependenceSql('si_user.id')}`,...page).all();
  for(const row of found.results||[])independent.add(row.id);
 }
 for(const person of people){
  const exempt=independent.has(idOf(person));
  person.shogunateIndependent=exempt;
  if(exempt)person.palaceControl=null;
  else if((person.targetCastleId||person.homeCastleId)==='kyoto_gosho')person.palaceControl=control;
 }
 return people;
}
