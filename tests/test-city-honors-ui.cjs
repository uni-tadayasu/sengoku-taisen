'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const award=id=>({id,cityName:'untrusted label',title:'untrusted title'});
function setup(){
 const nodes=[],listeners=new Map(),draft={value:'返信を変換中',selectionStart:2,selectionEnd:5},scroll={scrollTop:127};
 const document={activeElement:draft,addEventListener:(name,fn)=>listeners.set(name,fn),querySelectorAll:selector=>selector==='[data-city-honors-player]'?nodes:[]};
 const scope={document,URL,console,SENGOKU_API_BASE:'https://example.invalid/api/v1'};scope.window=scope;vm.createContext(scope);vm.runInContext(read('avatar.js'),scope);
 const api=scope.SengokuCityHonors,avatar=scope.SengokuAvatar;
 function node(id){const html=api.slot(id),key=/data-city-honors-key="([^"]*)"/.exec(html)?.[1]||'';let inner=html.slice(html.indexOf('>')+1,-7),writes=0;const el={dataset:{cityHonorsPlayer:id,cityHonorsKey:key},get innerHTML(){return inner;},set innerHTML(value){inner=value;writes++;},get writes(){return writes;}};nodes.push(el);return el;}
 return{scope,api,avatar,node,draft,scroll,listeners};
}
const tests=[];const test=(name,run)=>tests.push({name,run});
test('only accepted public API honors award a badge, with fixed safe artwork and labels',()=>{
 const h=setup();assert(!h.api.slot({id:'u_lord',cityHonors:[award('edo')]}).includes('<img'));
 h.avatar.observe({save:{id:'u_lord',cityHonors:[award('edo')]},state:{id:'u_lord',cityHonors:[award('osaka')]},appearance:{id:'u_lord',cityHonors:[award('nagoya')]}});
 assert.equal(h.api.resolve('u_lord').length,0);
 h.avatar.observe({player:{id:'u_lord',cityHonors:[award('osaka'),award('edo'),award('edo'),award('../bad'),award('__proto__')]}});
 const html=h.api.slot('u_lord');assert.equal((html.match(/data-city-honor=/g)||[]).length,2);assert(html.includes('assets/city-honors/edo-v1.webp'));assert(html.includes('assets/city-honors/osaka-v1.webp'));assert(html.includes('alt="都市勲章：江戸城の城主"'));assert(!html.includes('untrusted'));assert(!html.includes('../bad'));
 assert.equal(h.api.text('u_lord'),'江戸城の城主・大坂城の城主');
});
test('ordinary, flat battle/mail identities and anonymous voice sessions resolve independently',()=>{
 const h=setup(),fields=[['playerId','playerCityHonors'],['ownerId','ownerCityHonors'],['authorId','authorCityHonors'],['targetPlayerId','targetCityHonors'],['attackerPlayerId','attackerCityHonors'],['defenderPlayerId','defenderCityHonors'],['actorPlayerId','actorCityHonors'],['lordPlayerId','lordCityHonors'],['previousLordPlayerId','previousLordCityHonors']];
 h.avatar.observe({rows:fields.map(([idKey,valueKey],i)=>({[idKey]:'u_person_'+i,[valueKey]:[award('nagoya')]})),participants:[{sessionId:'vc_'+'a'.repeat(32),cityHonors:[award('kyoto_gosho')]}]});
 fields.forEach((_,i)=>assert(h.api.slot('u_person_'+i).includes('nagoya-v1.webp')));
 assert(h.api.slot('vc_'+'a'.repeat(32)).includes('京都御所の領主'));assert(!h.api.slot('some_other_id'));
});
test('ownership loss clears every mounted badge without touching a draft, focus or scrolling',()=>{
 const h=setup();h.avatar.observe({id:'u_lord',cityHonors:[award('edo')]});const first=h.node('u_lord'),second=h.node('u_lord'),other=h.node('u_other'),focus=h.scope.document.activeElement,before=JSON.stringify([h.draft,h.scroll]);
 h.avatar.observe({id:'u_lord',name:'partial response'});assert.equal(first.writes,0);
 h.avatar.observe({playerEvaluations:[{playerId:'u_lord',cityHonors:[]}]});assert.equal(first.innerHTML,'');assert.equal(second.innerHTML,'');assert.equal(other.writes,0);assert.equal(h.api.resolve('u_lord').length,0);assert.equal(h.scope.document.activeElement,focus);assert.equal(JSON.stringify([h.draft,h.scroll]),before);
});
test('older responses cannot restore revoked honors or remove newer ownership',()=>{
 const h=setup(),old=h.avatar.beginRequest(),newer=h.avatar.beginRequest();h.avatar.observe({id:'u_lord',cityHonors:[]},{requestSequence:newer});h.avatar.observe({id:'u_lord',cityHonors:[award('edo')]},{requestSequence:old});assert.equal(h.api.resolve('u_lord').length,0);
 const newest=h.avatar.beginRequest();h.avatar.observe({id:'u_lord',cityHonors:[award('nijo')]},{requestSequence:newest});h.avatar.observe({id:'u_lord',cityHonors:[]},{requestSequence:newer});assert.equal(h.api.text('u_lord'),'二条御所の城主');
 h.api.clear();h.avatar.observe({id:'u_lord',cityHonors:[award('edo')]},{requestSequence:newest});assert.equal(h.api.resolve('u_lord').length,0);
});
test('unchanged polls preserve mounted artwork and its image fallback state',()=>{
 const h=setup();h.avatar.observe({id:'u_lord',cityHonors:[award('edo')]});const row=h.node('u_lord'),before=row.innerHTML;h.avatar.observe({id:'u_lord',cityHonors:[award('edo')]});assert.equal(row.writes,0);assert.equal(row.innerHTML,before);
 let role='',label='';const image={alt:'都市勲章：江戸城の城主',matches:selector=>selector==='.city-honor img',parentElement:{setAttribute:(key,value)=>{if(key==='role')role=value;if(key==='aria-label')label=value;}}};h.listeners.get('error')({target:image});assert.equal(image.hidden,true);assert.equal(role,'img');assert.equal(label,image.alt);
});
test('field identities put honors after the portrait and before the name, preserving paid and court badges',()=>{
 const h=setup();h.scope.SengokuPremiumRuntime={nameMarkup:name=>'<b data-premium-product="phoenix-medallion">'+name+'</b>'};h.scope.SengokuPublicCourt={slot:()=>'<i data-court-seal="sun">天皇</i>'};vm.runInContext(read('field.js'),h.scope);h.avatar.observe({id:'u_lord',cityHonors:[award('edo')]});
 const html=h.scope.SengokuField.publicRow({playerId:'u_lord',name:'領主の名前',homeCastleId:'edo',homeCastleName:'江戸城',level:3,defenseTroops:1000});
 assert(html.indexOf('data-player-avatar')<html.indexOf('data-city-honors-player'));assert(html.indexOf('data-city-honors-player')<html.indexOf('data-premium-player'));assert(html.includes('data-premium-product="phoenix-medallion"'));assert(html.includes('data-court-seal="sun"'));
});
test('the Kagoshima crest accepts only observed public honors and uses fixed SVG artwork and accessible text',()=>{
 const h=setup(),id='u_deputy',crest='assets/branding/kagoshima-immortal-crest.svg';
 assert(!h.api.slot({id,isDeputy:true,cityHonors:[award('kagoshima')]}).includes('<img'));
 h.avatar.observe({save:{state:{id,isDeputy:true,cityHonors:[award('kagoshima')]}},entitlements:{id,cityHonors:[award('kagoshima')]},appearance:{id,cityHonors:[award('kagoshima')]}});
 assert.equal(h.api.resolve(id).length,0);
 h.avatar.observe({player:{id,cityHonors:[award('kagoshima'),award('kagoshima')]}});
 const markup=h.api.slot(id);assert.equal((markup.match(/data-city-honor=/g)||[]).length,1);
 assert(markup.includes('src="'+crest+'"'));assert(markup.includes('alt="鹿児島城 不死身の紋章"'));assert(!markup.includes('untrusted'));
 assert.equal(h.api.text(id),'鹿児島城 不死身の紋章');assert(h.api.slot(id,{cityId:'kagoshima'}).includes(crest));assert(!h.api.slot(id,{cityId:'kyoto_gosho'}).includes(crest));
 h.avatar.observe({id:'u_staff',cityHonors:[award('kyoto_gosho')]});assert(!h.api.slot('u_staff').includes(crest));
 h.scope.SengokuPremiumRuntime={nameMarkup:name=>'<b>'+name+'</b>'};vm.runInContext(read('field.js'),h.scope);
 const row=h.scope.SengokuField.publicRow({playerId:id,name:'鹿児島の領主',homeCastleId:'kagoshima',homeCastleName:'鹿児島城',level:4,defenseTroops:1000});
 assert(row.indexOf('data-player-avatar')<row.indexOf('data-city-honors-player'));assert(row.indexOf(crest)<row.indexOf('data-premium-player'));
});
test('a revoked Kagoshima crest disappears in place and an older response cannot restore it',()=>{
 const h=setup(),id='u_deputy';h.avatar.observe({id,cityHonors:[award('kagoshima')]});const first=h.node(id),second=h.node(id),focus=h.scope.document.activeElement,before=JSON.stringify([h.draft,h.scroll]);
 const old=h.avatar.beginRequest(),current=h.avatar.beginRequest();h.avatar.observe({id,cityHonors:[]},{requestSequence:current});
 assert.equal(first.innerHTML,'');assert.equal(second.innerHTML,'');
 h.avatar.observe({id,cityHonors:[award('kagoshima')]},{requestSequence:old});assert.equal(first.innerHTML,'');assert.equal(h.api.resolve(id).length,0);
 assert.equal(h.scope.document.activeElement,focus);assert.equal(JSON.stringify([h.draft,h.scroll]),before);
});
test('the ordinary-base crest is issued only by observed public data with fixed artwork and text',()=>{
 const h=setup(),id='u_castle_member',crest='assets/branding/castle-lord-crest.svg';
 assert(!h.api.slot({id,homeCastleId:'inuyama',householdRole:'lord',isAdmin:false,isDeputy:false,cityHonors:[award('castle_lord')]}).includes('<img'));
 h.avatar.observe({save:{state:{id,home:'inuyama',cityHonors:[award('castle_lord')]}},state:{id,cityHonors:[award('castle_lord')]},appearance:{id,cityHonors:[award('castle_lord')]},entitlements:{id,cityHonors:[award('castle_lord')]}});
 assert.equal(h.api.resolve(id).length,0,'private saves, roles and purchases cannot award the public crest');
 h.avatar.observe({player:{id,cityHonors:[award('castle_lord'),award('castle_lord'),award('../castle-lord'),award('__proto__')]}});
 const html=h.api.slot(id);assert.equal((html.match(/data-city-honor=/g)||[]).length,1);
 assert(html.includes('src="'+crest+'"'));assert(html.includes('alt="城主の紋章"'));assert(!html.includes('untrusted'));assert(!html.includes('../castle-lord'));
 assert.equal(h.api.text(id),'城主の紋章');
 h.avatar.observe({playerEvaluations:[{playerId:'u_castle_retainer',cityHonors:[award('castle_lord')]}],messages:[{authorId:'u_castle_author',authorCityHonors:[award('castle_lord')]}],participants:[{sessionId:'vc_'+'b'.repeat(32),cityHonors:[award('castle_lord')]}]});
 for(const player of ['u_castle_retainer','u_castle_author','vc_'+'b'.repeat(32)])assert(h.api.slot(player).includes(crest),'every public identity format shares the crest');
});
test('ordinary crests appear between the avatar and name and coexist with city, paid and court honors',()=>{
 const h=setup(),id='u_castle_lord',crest='assets/branding/castle-lord-crest.svg';
 h.scope.SengokuPremiumRuntime={nameMarkup:name=>'<b data-premium-product="phoenix-medallion">'+name+'</b>'};
 h.scope.SengokuPublicCourt={slot:()=>'<i data-court-seal="pine">左大臣</i>'};
 vm.runInContext(read('field.js'),h.scope);
 h.avatar.observe({id,cityHonors:[award('nagoya'),award('castle_lord')]});
 const person={playerId:id,name:'城下町の領主',homeCastleId:'inuyama',homeCastleName:'犬山城',level:3,defenseTroops:1000};
 const row=h.scope.SengokuField.publicRow(person);
 assert(row.indexOf('data-player-avatar')<row.indexOf(crest));assert(row.indexOf(crest)<row.indexOf('data-premium-player'));
 assert(row.includes('assets/city-honors/nagoya-v1.webp'));assert(row.indexOf(crest)<row.indexOf('assets/city-honors/nagoya-v1.webp'));
 assert(row.includes('data-premium-product="phoenix-medallion"'));assert(row.includes('data-court-seal="pine"'));
 const ordinary=h.api.slot(id,{cityId:'inuyama'});assert(ordinary.includes(crest));assert(!ordinary.includes('nagoya-v1.webp'));
 const major=h.api.slot(id,{cityId:'nagoya'});assert(major.includes(crest));assert(major.includes('nagoya-v1.webp'));
 const map=h.scope.SengokuField.castleAppearance(person,{marker:true});assert(map.includes(crest),'a scoped ordinary castle map marker retains the crest');
 assert(map.indexOf('data-player-avatar')<map.indexOf(crest));
 const cityMap=h.scope.SengokuField.castleAppearance({...person,targetCastleId:'nagoya'},{marker:true});
 assert(cityMap.includes(crest));assert(!cityMap.includes('nagoya-v1.webp'),'compact markers retain one primary crest without overflowing; full rows keep all medals');
 const compact=h.node(id);compact.dataset.cityHonorsCity='nagoya';compact.dataset.cityHonorsCompact='true';h.api.refresh();
 assert(compact.innerHTML.includes(crest));assert(!compact.innerHTML.includes('nagoya-v1.webp'));
 h.avatar.observe({id,cityHonors:[award('nagoya')]});assert(compact.innerHTML.includes('nagoya-v1.webp'));assert(!compact.innerHTML.includes(crest));
});
test('ordinary crests update in every mounted name when roles change without stale restoration or draft loss',()=>{
 const h=setup(),id='u_changing_member',crest='assets/branding/castle-lord-crest.svg';
 h.avatar.observe({id,cityHonors:[award('castle_lord')]});const first=h.node(id),second=h.node(id),focus=h.scope.document.activeElement,before=JSON.stringify([h.draft,h.scroll]);
 const old=h.avatar.beginRequest(),appointed=h.avatar.beginRequest();h.avatar.observe({id,cityHonors:[award('kagoshima')]},{requestSequence:appointed});
 for(const node of [first,second]){assert(!node.innerHTML.includes(crest));assert(node.innerHTML.includes('kagoshima-immortal-crest.svg'));}
 h.avatar.observe({id,cityHonors:[award('castle_lord')]},{requestSequence:old});assert(!first.innerHTML.includes(crest));assert.equal(h.api.text(id),'鹿児島城 不死身の紋章');
 const returned=h.avatar.beginRequest();h.avatar.observe({id,cityHonors:[award('castle_lord')]},{requestSequence:returned});
 for(const node of [first,second]){assert(node.innerHTML.includes(crest));assert(!node.innerHTML.includes('kagoshima-immortal-crest.svg'));}
 const revoked=h.avatar.beginRequest();h.avatar.observe({id,cityHonors:[]},{requestSequence:revoked});
 h.avatar.observe({id,cityHonors:[award('castle_lord')]},{requestSequence:returned});assert.equal(first.innerHTML,'');assert.equal(second.innerHTML,'');
 assert.equal(h.scope.document.activeElement,focus);assert.equal(JSON.stringify([h.draft,h.scroll]),before);
});
for(const {name,run}of tests){run();console.log('PASS '+name);}console.log(`${tests.length} city-honor checks passed; synthetic identities only.`);
