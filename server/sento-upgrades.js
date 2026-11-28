// Keep historical personal growth and paid queues intact when a ruler moves
// to Sento, while refusing new construction outside its current 12 / 20 rules.
import './game-runtime.js';

export function assertSentoUpgradeTransition(before,after,user,fail){
 if(!user.is_sento||user.is_admin)return;
 const rules=globalThis.SENGOKU_DATA.sentoRules,ids=new Set(rules.facilityIds),limit=rules.limit;
 const old=before?.state||before||{},next=after?.state||after||{},paid=new Map();
 const sameCampaign=!!old.walking?.campaignId&&old.walking.campaignId===next.walking?.campaignId;
 if(sameCampaign)for(const job of old.jobs||[])if(job.kind==='building')paid.set(job.id+':'+job.targetLevel,job);
 const ceiling=new Map(Object.entries(old.buildings||{}));
 for(const job of paid.values())ceiling.set(job.id,Math.max(ceiling.get(job.id)||0,job.targetLevel));
 const reject=()=>fail(409,'SENTO_UPGRADE_LIMIT','仙洞御所の強化は12種類・各Lv.20までです。最新版を開き、最新の保存を読み込んでください。');
 for(const [id,level] of Object.entries(next.buildings||{}))if(level>Math.max(ids.has(id)?limit:0,ceiling.get(id)||0))reject();
 for(const job of next.jobs||[])if(job.kind==='building'&&(!ids.has(job.id)||job.targetLevel>limit)&&!paid.has(job.id+':'+job.targetLevel))reject();
}
