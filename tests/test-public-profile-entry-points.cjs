'use strict';
const assert=require('node:assert/strict');
const {setup}=require('./helpers/dom-model.cjs');
const {leaderboardMarkup}=require('../events.js');
const Residency=require('../residency.js');
const {doc,host}=setup();
global.document=doc;
require('../public-profile.js');

const lord={playerId:'u_ranked_lord',name:'<城主>',clan:'織田家',rank:1,wins:2,points:24};
for(const [surface,markup] of [
  ['城の領主・家臣名簿',Residency.personHtml(lord)],
  ['合戦の戦功ランキング',leaderboardMarkup([lord],{status:'active'})]
]){
  host.innerHTML=markup;
  const links=host.querySelectorAll('[data-public-profile]');
  assert.equal(links.length,1,surface);
  const link=links[0];
  assert.equal(link.tagName,'BUTTON',surface);
  assert.equal(link.getAttribute('type'),'button',surface);
  assert.equal(link.dataset.publicProfile,lord.playerId,surface);
  assert.match(link.getAttribute('aria-label'),/城主.*公開プロフィール/,surface);
  assert(link.textContent.includes(lord.name),surface);
  assert(!link.querySelector('button'),surface);
  assert(!markup.includes('<城主>'),surface);
}
assert(!Residency.personHtml(null).includes('data-public-profile'));
assert(!leaderboardMarkup([],{status:'active'}).includes('data-public-profile'));
assert(!Residency.personHtml({...lord,playerId:'invalid'}).includes('data-public-profile'));
console.log('PASS actual castle household and event ranking nameplates open the correct public account without nested controls or markup injection.');
