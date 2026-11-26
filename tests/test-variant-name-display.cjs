'use strict';
// Exercise the shipped rendering boundaries with synthetic, exact Unicode names.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const variants=require('../variant-text.js'),kamon=require('../kamon.js'),map=require('../world-map.js');
const read=name=>fs.readFileSync(require.resolve('../'+name),'utf8');
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const officer={id:'of_b0616adde162',name:'德川家康',clan:'德川家',rank:'U'};
const context={console,URL,URLSearchParams,AbortController,setTimeout,clearTimeout,
 document:{readyState:'loading',addEventListener(){},removeEventListener(){},querySelectorAll:()=>[]},
 localStorage:{getItem:()=>null,setItem(){},removeItem(){}},SengokuVariants:variants,SengokuKamon:kamon,SENGOKU_OFFICERS:[officer]};
context.window=context;vm.createContext(context);
vm.runInContext(read('social.js').replace('global.SengokuSocial={open','global.__displayTest={s,profileView,socialAvatar,guildIcon};global.SengokuSocial={open'),context);
let count=0;const test=(name,run)=>{run();count++;console.log('PASS '+name);};
const examples=[['葛\u{E0100}西','葛\u{E0100}'],['𠮷良','𠮷'],['か\u3099城','か\u3099'],['👩\u200d👩\u200d👧\u200d👦家','👩\u200d👩\u200d👧\u200d👦'],['神城','神'],['<家','&lt;']];

test('social fallbacks keep the first grapheme and never turn a supplied name into markup',()=>{
 for(const [name,initial]of examples){assert(context.__displayTest.socialAvatar({name}).endsWith('>'+initial+'</span>'));assert(context.__displayTest.guildIcon({name}).endsWith('>'+initial+'</span>'));}
});

vm.runInContext(read('avatar.js'),context);vm.runInContext(read('alliance-icon.js'),context);
test('player and alliance initials retain IVS, supplementary ideographs and combining sequences',()=>{
 for(const [name,initial]of examples){
  const avatar=context.SengokuAvatar.markup({id:'u_variant',name}),alliance=context.SengokuAllianceIcon.markup({id:'g_variant',name});
  assert(avatar.includes('class="social-avatar-initial" aria-hidden="true">'+initial+'</span>'));assert(alliance.includes('class="social-alliance-initial" aria-hidden="true">'+initial+'</span>'));
  assert(avatar.includes('data-player-avatar-name="'+esc(name)+'"'));assert(alliance.includes('data-guild-icon-name="'+esc(name)+'"'));
 }
 const helper=context.SengokuVariants;delete context.SengokuVariants;
 assert(context.SengokuAvatar.markup({id:'u_standalone',name:'𠮷良'}).includes('>𠮷</span>'));context.SengokuVariants=helper;
});

test('the crest asset alias stays compatible while visible and accessible family names stay exact',()=>{
 assert.equal(kamon.url('德川家'),kamon.url('徳川家'));
 assert.equal(kamon.get('德川家').clan,'徳川家');
 const html=kamon.render('德川家',{label:true});assert(html.includes('aria-label="德川家：'));assert(html.includes('<b>德川家</b>'));assert(!html.includes('徳川家：'));
 const label=map.markerPresentation({name:'葛\u{E0100}西城',owner:'德川家',level:1}).label;assert(label.startsWith('葛\u{E0100}西城 德川家 '));
});

vm.runInContext(read('artwork.js'),context);
vm.runInContext(read('public-profile.js').replace('global.SengokuLordProfile={open','global.__publicVariantDetail=detail;global.SengokuLordProfile={open'),context);
test('officer artwork, public profiles and the owner profile retain source names and affiliations',()=>{
 assert.equal(context.SengokuArt.tileInfo('officer',officer.id,'U').name,officer.name);
 assert(context.SengokuArt.portrait(officer).includes('晩年の德川家康 Uランク'));
 const commander={officerId:officer.id,rank:'U'},person={id:'u_variant',name:'神葛\u{E0100}城',clan:'德川家',commander};
 assert(context.SengokuLordProfile.commanderCard(commander).includes('>德川家康</p>'));
 const detail=context.__publicVariantDetail(person);assert(detail.includes('>德川家</p>'));assert(detail.includes(esc(person.name)));
 context.__displayTest.s.user=person;context.__displayTest.s.identity={id:person.id};const own=context.__displayTest.profileView();assert(own.includes('>德川家 · '));assert(own.includes('value="'+esc(person.name)+'"'));
});

const app=read('app.js'),functions=['clanCrest','officerCrest'].map(name=>{const line=app.split('\n').find(row=>row.startsWith('  function '+name+'('));assert(line,'Missing live app renderer '+name);return line;}).join('\n');
context.esc=esc;context.data={ranks:['D','C','B','A','S','SS','SSS','U']};vm.runInContext(functions,context);
test('gameplay crests expose original officer text and preserve an unregistered family initial',()=>{
 const html=context.officerCrest(officer);assert(html.includes('aria-label="德川家康・德川家の家紋・Uランク"'));assert(html.includes('title="德川家康 · 德川家 · U"'));
 const crest=context.SengokuKamon;delete context.SengokuKamon;assert(context.clanCrest('葛\u{E0100}西家').endsWith('>葛\u{E0100}</span>'));delete context.SengokuVariants;assert(context.clanCrest('𠮷良家').endsWith('>𠮷</span>'));context.SengokuKamon=crest;context.SengokuVariants=variants;
});

console.log(`${count} exact-name rendering groups passed. No network requests or persistent writes.`);
