/* 戦国大戦：8,192点の原画を、表示するセルだけ遅延読込する。 */
(function(global){
'use strict';
const ranks=['D','C','B','A','S','SS','SSS','U'];
const roster=global.SENGOKU_OFFICERS||[], data=global.SENGOKU_DATA||{};
const officers=new Map(roster.map((o,i)=>[o.id,{...o,index:i}]));
const castles=new Map((data.castles||[]).map(c=>[c.id,c]));
const facilities=new Map((data.buildings||[]).map(b=>[b.id,b]));
const portraitFacilities=new Set((data.buildings||[]).slice(0,32).map(b=>b.id));
const frames=Object.fromEntries(ranks.map(r=>[r,`assets/frames/rank-${r}.svg`]));
const operatorPortrait={id:'of_b0616adde162',rank:'U',url:'assets/operator-ieyasu-u.webp?v=3.8.1-20261121'};
const cache=new Map();let observer,scheduled=false;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons={
 town:'M3 20h18M5 20V10l7-5 7 5v10M3 10h18M6 5l6-3 6 3M8 13h2v3H8m6-3h2v3h-2M10 20v-3h4v3',
 map:'m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2V5Zm6-2v16m6-14v16M5 9l2-1m4 5 2 1m4 1 2-1',
 officers:'M5 8c0-7 14-7 14 0M3 8h18l-2 4h-2v3c0 6-10 6-10 0v-3H5L3 8Zm5-5-3-2m11 2 3-2M4 22l4-4m12 4-4-4',
 army:'m5 3 14 18M19 3 5 21M3 7l5-4m8 0 5 4M4 17l5 4m6 0 5-4M9 9l6 6',
 research:'M4 4h7l1 2 1-2h7v16h-7l-1 2-1-2H4V4Zm8 2v16M7 8h2m6 0h2M7 12h2m6 0h2M7 16h2m6 0h2',
 council:'M4 20V5h16v15M2 20h20M7 8h10M7 12h10M7 16h4m5 0h1M9 2h6',
 facilities:'m3 13 9-7 9 7M5 12v9h14v-9M9 21v-6h6v6M7 8V3h3v3M17 4l2-2m1 5h3',
 gacha:'M13 3c-6-1-10 3-9 9 1 8 11 10 16 3-5 2-8 0-7-3 1-2 3-2 4-4 0-3-2-5-4-5Zm-5 5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z',
 gift:'M3 9h18v4H3V9Zm2 4v8h14v-8M12 9v12M12 9C3 9 6 1 9 4l3 5Zm0 0c9 0 6-8 3-5l-3 5',
 mail:'M3 5h18v15H3V5Zm0 1 9 7 9-7M4 19l5-6m11 6-5-6',
 settings:'m12 2 2 4 4-1 1 4 3 3-3 3-1 4-4-1-2 4-2-4-4 1-1-4-3-3 3-3 1-4 4 1 2-4Zm0 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
 save:'M4 3h13l3 3v15H4V3Zm4 0v6h8V3M8 21v-8h8v8m-6-5h4',
 music:'M8 18V6l12-3v12M8 18c0 4-6 4-6 1s6-4 6-1Zm12-3c0 4-6 4-6 1s6-4 6-1ZM8 10l12-3',
 rank:'m12 2 3 6 7 1-5 5 1 8-6-4-6 4 1-8-5-5 7-1 3-6Z',
 default:'m12 2 9 5v10l-9 5-9-5V7l9-5Zm0 5 5 3v5l-5 3-5-3v-5l5-3Z'
};
function icon(name='default'){return `<svg class="item-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[name]||icons.default}"/></svg>`;}
function tileInfo(kind,id,variant){
 if(kind==='officer'){
  const o=officers.get(id);if(!o)return null;const rank=ranks.includes(variant)?variant:o.rank;
  const cell=o.index%32;return{url:`assets/illustrations/officers-${rank}-${String(Math.floor(o.index/32)+1).padStart(2,'0')}.webp`,x:(cell%8)/7*100,y:Math.floor(cell/8)/3*100,name:o.name,rank};
 }
 const item=(kind==='castle'?castles:facilities).get(id);if(!item)return null;
 const limit=kind!=='castle'?32:['edo','sunpu'].includes(id)?64:(data.majorCityIds||['edo','sunpu','nijo','osaka','nagoya']).includes(id)?48:32;
 const level=Math.max(1,Math.min(limit,Math.round(Number(variant)||1))),artLevel=Math.min(32,level),cell=artLevel-1;
 return{url:`assets/${kind==='castle'?'castles':'facilities'}/${id}.webp`,x:(cell%8)/7*100,y:Math.floor(cell/8)/3*100,name:item.name,level,artLevel,finalStage:level>32,portraitCell:kind==='facility'&&portraitFacilities.has(id)};
}
function tile(kind,id,className='',variant=1){const t=tileInfo(kind,id,variant);if(!t)return'';
 return `<span class="painted-art ${kind}-painting${t.portraitCell?' portrait-cell':''} ${esc(className)}" data-art-url="${esc(t.url)}" data-art-x="${t.x}" data-art-y="${t.y}" style="--tile-x:${t.x}%;--tile-y:${t.y}%" role="img" aria-label="${esc(t.name)} ${t.level?'Lv.'+t.level+(t.finalStage?'・最終形態':''):t.rank+'ランク'}のオリジナルイラスト" aria-busy="true"><span class="art-surface" aria-hidden="true"></span><span class="art-loading" aria-hidden="true">${icon(kind==='officer'?'officers':kind==='castle'?'town':'facilities')}</span></span>`;
}
function portrait(o){if(!o)return'';const rank=ranks.includes(o.rank)?o.rank:'D',special=o.id===operatorPortrait.id&&rank===operatorPortrait.rank;const painting=special?`<span class="painted-art painted-portrait operator-portrait" data-art-url="${operatorPortrait.url}" data-art-x="50" data-art-y="50" role="img" aria-label="德川家康 Uランク・運営専用の特別イラスト" aria-busy="true"><span class="art-surface" aria-hidden="true"></span><span class="art-loading" aria-hidden="true">${icon('officers')}</span></span>`:tile('officer',o.id,'painted-portrait',rank);return `<span class="portrait-frame${special?' operator-portrait-frame':''}" data-rank="${rank}">${painting}<img class="rank-frame" src="${frames[rank]}" alt="" aria-hidden="true" loading="lazy">${special?'<span class="operator-art-seal">運営専用・特別絵巻</span>':''}</span>`;}
function load(url){if(cache.has(url))return cache.get(url);const promise=new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(url);img.onerror=()=>{cache.delete(url);reject(Error('画像を読み込めませんでした'));};img.src=url;});cache.set(url,promise);return promise;}
async function reveal(el){if(el.dataset.artReady||el.dataset.artLoading)return;const url=el.dataset.artUrl||el.dataset.ghostUrl;if(!url)return;if(global.SENGOKU_AT_TITLE&&!el.closest('#launch-screen'))return;el.dataset.artLoading='1';try{await load(url);if(!el.isConnected)return;if(el.dataset.ghostUrl)el.style.setProperty('--item-art',`url("${url}")`);else (el.querySelector(':scope > .art-surface')||el).style.backgroundImage=`url("${url}")`;el.dataset.artReady='1';el.classList.add('art-ready');el.setAttribute('aria-busy','false');}catch(_){el.classList.add('art-error');el.setAttribute('aria-busy','false');}finally{delete el.dataset.artLoading;}}
const backgrounds={town:['facility','keep'],map:['castle','kiyosu'],officers:['officer',roster[0]?.id,'S'],army:['facility','barracks'],research:['facility','academy'],council:['facility','envoy_house'],facilities:['facility','market'],gacha:['officer',roster[1]?.id,'U'],settings:['facility','library'],save:['facility','library'],music:['facility','tea_house'],mail:['facility','relay_station']};
function decorate(){scheduled=false;
 document.querySelectorAll('[data-art-url]:not([data-art-observed])').forEach(el=>{el.dataset.artObserved='1';observer?observer.observe(el):reveal(el);});
 const selector='.button,.text-link,.launch-enter,.nav-item,.resource,.building-card,.facility-entry,.territory-row,.research-card,.quest-row,.tactic-card,.music-track,.settings-stack>.button,.social-tabs button,.social-list-card,.social-mail-row,.social-profile-section,.social-gift,.clan-choice,.gacha-banner,.title-feature,.panel,.notice,.officer-content';
 document.querySelectorAll(selector).forEach(el=>{if(el.dataset.artEnhanced)return;el.dataset.artEnhanced='1';el.classList.add('illustrated-item');
  let type=el.dataset.artTheme||el.dataset.view||el.dataset.action||'council';if(type.includes('gacha')||type.includes('draw'))type='gacha';if(type.includes('music')||type==='sound')type='music';if(type.includes('save')||type.includes('export')||type.includes('import'))type='save';
  const art=el.querySelector('[data-art-url]');let info;
  if(art)info={url:art.dataset.artUrl,x:art.dataset.artX,y:art.dataset.artY};
  else{const args=backgrounds[type]||backgrounds.council;info=tileInfo(args[0],args[1],args[2]||16);}
  if(info){el.dataset.ghostUrl=info.url;if(observer)observer.observe(el);else reveal(el);el.style.setProperty('--item-x',info.x+'%');el.style.setProperty('--item-y',info.y+'%');}
  if(el.matches('button')&&!el.querySelector('svg,img,.painted-art')&&!el.classList.contains('territory-row'))el.insertAdjacentHTML('afterbegin',icon(type));
 });
 document.querySelectorAll('button,.title-feature').forEach(el=>{if(!el.querySelector('svg,img,.painted-art,.portrait-frame')){let type=el.dataset.artTheme||el.dataset.view||el.dataset.action||'default';if(type.includes('gacha')||type.includes('draw'))type='gacha';else if(type.includes('music')||type.includes('sound'))type='music';else if(type.includes('rank'))type='rank';else if(type.includes('officer')||type.includes('recruit'))type='officers';else if(type.includes('castle')||type.includes('building')||type.includes('upgrade'))type='town';else if(type.includes('save')||type.includes('export')||type.includes('import'))type='save';el.insertAdjacentHTML('afterbegin',icon(type));}});
 document.querySelectorAll('.section-heading h2,.panel-heading h2,.social-profile-section h3').forEach(el=>{if(!el.querySelector('svg'))el.insertAdjacentHTML('afterbegin',icon(el.closest('.social-profile-section')?'save':'council'));});
}
function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(decorate);}
function currentAssets(){const h=innerHeight,w=innerWidth;return [...new Set(Array.from(document.querySelectorAll('[data-art-url],[data-ghost-url]')).filter(el=>{const r=el.getBoundingClientRect();return r.bottom>0&&r.top<h+180&&r.right>0&&r.left<w&&r.width>0;}).map(el=>el.dataset.artUrl||el.dataset.ghostUrl))];}
async function readyCurrent(onProgress){decorate();const urls=currentAssets();let done=0;await Promise.allSettled(urls.map(url=>load(url).finally(()=>onProgress?.(++done,urls.length))));document.querySelectorAll('[data-art-url],[data-ghost-url]').forEach(el=>{if(urls.includes(el.dataset.artUrl||el.dataset.ghostUrl))reveal(el);});}
function init(){if('IntersectionObserver'in global)observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){reveal(entry.target);observer.unobserve(entry.target);}}),{rootMargin:'180px'});new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true});decorate();}
global.SengokuArt={portrait,castle:(id,c='',level=1)=>tile('castle',id,c,level),facility:(id,c='',level=1)=>tile('facility',id,c,level),icon,tileInfo,load,readyCurrent,decorate,totalIllustrations:8192};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})(window);
