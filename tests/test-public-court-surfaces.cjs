const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const court=require('../public-court.js'),field=require('../field.js'),voice=require('../voice.js');
const person={id:'u_current',playerId:'u_current',name:'<現在の領主>',courtOffice:{title:'左大臣',kind:'official'},homeCastleId:'nagoya',homeCastleName:'名古屋城',targetCastleId:'nagoya',targetCastleName:'名古屋城',keepLevel:8,level:8,clan:'織田家',online:true,self:false,attackable:false};
court.update({players:[person]});
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function actualHelper(file,name,args){const source=fs.readFileSync(require.resolve('../'+file),'utf8').split('\n').find(line=>line.startsWith('function '+name+'(')||line.startsWith('const '+name+'='));assert(source,'actual name helper '+file);const scope={global:globalThis,esc:escape,s:{user:null},evaluationBadge:()=>'',evaluationKey:()=>'',args};vm.runInNewContext(source+';output='+name+'(...args);',scope);return scope.output;}
let count=0;function check(name,html){assert(html.includes('data-court-player="u_current"'),name);assert(html.includes('左大臣'),name);assert(html.includes('public-court-icon'),name);assert(html.includes('src="assets/court-badges/pine-relief.webp"'),name);assert(html.includes('data-court-seal="pine"'),name);assert(!html.includes('太政官'),name);assert(!html.includes('<現在の領主>'),name);count++;console.log('PASS '+name);}
check('social profile, friends and chat share the current office slot',actualHelper('social.js','playerName',[person.name,null,person.id]));
check('letter recipients and authors share the current office slot',actualHelper('letters.js','playerName',[person.name,null,null,person.id]));
check('field cards expose the office without changing the target',field.publicRow(person,{identity:{id:'u_reader'},rules:{}}));
check('field map markers expose the selected lord office',field.castleAppearance(person,{marker:true}));
const selectedMarker=field.markerAppearance({name:'名古屋城',displayTargetId:field.targetKey(person),players:[person]});
assert(selectedMarker.label.includes('［左大臣］'),'A compact field marker keeps the full office name in its accessible label');
check('trade peers carry the same noninteractive office marker',actualHelper('trade.js','peerMarkup',[person]));
const sessionId='vc_'+'c'.repeat(32);court.update({participants:[{sessionId,name:person.name,courtOffice:person.courtOffice}]});const html=voice.markup({phase:'idle',context:{authenticated:true,guildId:'g_one'},rooms:{guild:{room:{name:'同盟'},participants:[{sessionId,name:person.name,muted:true}]}},peerStates:{},supported:true,busy:false},{channel:'guild'});assert(html.includes('左大臣'));assert(html.includes('data-court-player="'+sessionId+'"'));assert(!html.includes(person.id));count++;console.log('PASS voice shows current office while retaining session-only public identity');
const succession={castleId:'nagoya',castleName:'名古屋城',lordPlayerId:person.playerId,lordName:person.name,lordCourtOffice:person.courtOffice,previousLordPlayerId:'u_former',previousLordName:'前の領主',previousLordCourtOffice:{title:'右大臣',kind:'official'}};
court.update({succession});
const battle={id:'battle',won:true,battleMode:'raid',castleId:'nagoya',castleName:'名古屋城',attackerPlayerId:'u_attacker',defenderPlayerId:'u_former',attackerName:'攻撃側',defenderName:'前の領主',troops:100,attackerLost:10,defenderLost:{troops:20},succession};
for(const [name,report] of [['field battle succession',field.battleReportHtml(battle,'u_attacker')],['covert retaliation succession',require('../covert.js').resultMarkup({action:'retaliate',target:{kind:'player',castleId:'nagoya',playerId:'u_former',playerName:'前の領主',name:'名古屋城'},battle})]]){
 check(name,report);assert(report.includes('data-court-seal="feather"'));assert(report.includes('data-court-player="u_former"'));
}
court.clear();assert(!actualHelper('social.js','playerName',[person.name,null,person.id]).includes('左大臣'));console.log(`${count} actual public name surface scenarios passed.`);
