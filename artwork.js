/* 戦国VS：8,224点の原画を、表示するセルだけ遅延読込する。 */
(function(global){
'use strict';
const ranks=['D','C','B','A','S','SS','SSS','U'];
const roster=global.SENGOKU_OFFICERS||[], data=global.SENGOKU_DATA||{};
const officers=new Map(roster.map((o,i)=>[o.id,{...o,index:i}]));
const castles=new Map((data.castles||[]).map((c,index)=>[c.id,{...c,index}]));
const facilities=new Map((data.buildings||[]).map((b,index)=>[b.id,{...b,index}]));
const portraitFacilities=new Set((data.buildings||[]).slice(0,32).map(b=>b.id));
// Artwork revisions are independent of game releases so stale HTTP/SW caches
// cannot keep the former plain-background facility sheets after this update.
const facilityArtRevision='chronicle-480';
const officerArtRevision='chronicle-480';
const previewDir='assets/art-previews/', previewRevision='atlas-20261123';
const previewUrl=name=>previewDir+name+'.webp?v='+previewRevision;
const numberTag=value=>String(value).padStart(2,'0');
const frames=Object.fromEntries(ranks.map(r=>[r,`assets/frames/rank-${r}.svg?v=4.9.10-20261123`]));
const operatorPortrait={id:'of_b0616adde162',rank:'U',url:'assets/operator-ieyasu-u.webp?v=ieyasu-anime-u-20261123'};
const deputyPortrait={id:'of_45e0f4cb36ad',rank:'U',revision:'shimazu-relief-u-20261127',file:'deputy-shimazu-yoshihisa-u-relief'};
// A castle's identity belongs to the location, not the viewer's operator role.
// Every mode shares these files; level changes keep the historical Goromon gate.
function castleScene(id,daypart='day'){
 if(id!=='kagoshima')return null;
 daypart=['morning','day','night'].includes(daypart)?daypart:'day';
 const label={morning:'朝',day:'昼',night:'夜'}[daypart],path='assets/responsive/kagoshima-town-'+daypart+'-';
 return{id,daypart,label,special:true,name:'鹿児島城（鶴丸城）',width:1536,height:864,
  src:path+'1536.webp',small:path+'400.webp',native:path+'720.webp',
  srcset:[400,720,1080,1536].map(width=>path+width+'.webp '+width+'w').join(', '),
  alt:label+'の鹿児島城（鶴丸城）。御楼門、石橋、水堀と石垣、城山を背にした御殿と城下町の特別イラスト'};
}
function castlePanorama(id,className='',daypart='day'){
 const art=castleScene(id,daypart);if(!art)return'';
 return `<figure class="special-castle-panorama ${esc(className)}" data-castle-scene="${art.id}"><img src="${art.small}" srcset="${art.srcset}" sizes="(max-width: 760px) 90vw, 640px" width="${art.width}" height="${art.height}" alt="${esc(art.alt)}" loading="lazy" decoding="async" draggable="false"><figcaption>鹿児島城（鶴丸城） · ${art.label}の特別絵巻</figcaption></figure>`;
}
const cache=new Map(),loaded=new Set(),paintRequests=new WeakMap(),observedPaints=new WeakSet(),deferredTitle=new Set(),decorationRoots=new Set();let observer,scheduled=false;
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
function sheetCell(name,index,columns,rows){
 return {url:previewUrl(name),x:(index%columns)/(columns-1)*100,y:Math.floor(index/columns)/(rows-1)*100,size:columns*100+'% '+rows*100+'%'};
}
function castleGrowthInfo(id,{castleLevel=1,keepLevel,home=false}={}){
 const limit=id==='kyoto_gosho'?128:id==='edo'?64:(data.majorCityIds||['nijo','osaka','nagoya']).includes(id)?48:32;
 const numeric=value=>(typeof value==='number'||typeof value==='string'&&value.trim())&&Number.isFinite(Number(value))?Number(value):NaN;
 const castle=Math.max(1,Math.min(limit,Math.round(numeric(castleLevel)||1))),rawKeep=numeric(keepLevel);
 const keep=home&&Number.isInteger(rawKeep)&&rawKeep>=1?Math.min(32,rawKeep):null,level=Math.max(castle,keep||1),source=keep>castle?'天守':'城郭';
 // Presentation only: neither completed level is promoted to the other.
 return{castleLevel:castle,keepLevel:keep,level,source,label:source+' Lv.'+level,summary:(home?(keep===null?'天守 未取得':'天守 Lv.'+keep)+' · ':'')+'城郭 Lv.'+castle};
}
function tileInfo(kind,id,variant){
 if(kind==='officer'){
  const o=officers.get(id);if(!o)return null;const rank=ranks.includes(variant)?variant:o.rank;
  const cell=o.index%32,small=sheetCell('officers-'+rank+'-'+numberTag(Math.floor(o.index/32)+1),cell,8,4);
  const native=rank===o.rank?sheetCell('officer-base-'+numberTag(Math.floor(o.index/4)+1),o.index%4,2,2):null;
  return{small,native,portraitShape:true,url:`assets/illustrations/officers-${rank}-${String(Math.floor(o.index/32)+1).padStart(2,'0')}.webp?v=${officerArtRevision}`,x:(cell%8)/7*100,y:Math.floor(cell/8)/3*100,name:o.name,rank};
 }
 const item=(kind==='castle'?castles:facilities).get(id);if(!item)return null;
 const limit=kind!=='castle'?32:id==='kyoto_gosho'?128:id==='edo'?64:(data.majorCityIds||['edo','kyoto_gosho','nijo','osaka','nagoya']).includes(id)?48:32;
 const level=Math.max(1,Math.min(limit,Math.round(Number(variant)||1))),artLevel=Math.min(32,level),cell=artLevel-1;
 const special=kind==='castle'&&castleScene(id);
 if(special)return{special:true,small:{url:special.small,x:50,y:50,size:'cover'},native:{url:special.native,x:50,y:50,size:'cover'},url:special.src,x:50,y:50,name:special.name,level,artLevel,finalStage:level>32};
 const index=item.index,isCastle=kind==='castle',portraitCell=!isCastle&&portraitFacilities.has(id);
 const small=isCastle?sheetCell('castles-'+numberTag(artLevel),index,16,9):
  sheetCell('facilities-'+numberTag(artLevel)+'-'+(Math.floor(index/32)+1),index%32,8,4);
 const native=artLevel===1||(!isCastle&&artLevel===2&&index<8)?
  sheetCell(kind+'-start-'+artLevel+'-'+numberTag(Math.floor(index/4)+1),index%4,2,2):null;
 if(!isCastle){small.frame=[8,4,index%32,80,portraitCell?107:80].join(',');if(native)native.frame=[2,2,index%4,portraitCell?3:1,portraitCell?4:1].join(',');}
 return{small,native,frame:isCastle?null:[8,4,cell,portraitCell?3:1,portraitCell?4:1].join(','),portraitShape:portraitCell,url:`assets/${kind==='castle'?'castles':'facilities'}/${id}.webp${kind==='facility'?'?v='+facilityArtRevision:''}`,x:(cell%8)/7*100,y:Math.floor(cell/8)/3*100,name:item.name,level,artLevel,finalStage:level>32,portraitCell:kind==='facility'&&portraitFacilities.has(id)};
}
function tile(kind,id,className='',variant=1){const t=tileInfo(kind,id,variant);if(!t)return'';
 if(t.special)return `<span class="painted-art castle-painting special-castle-painting ${esc(className)}" data-castle-art="${esc(id)}" data-art-url="${esc(t.url)}" data-art-small="${esc(t.small.url)}" data-small-width="400" data-small-height="225" data-art-native="${esc(t.native.url)}" data-native-width="720" data-native-height="405" data-art-x="50" data-art-y="50" role="img" aria-label="${esc(t.name)} Lv.${t.level}・御楼門と城下町の特別絵巻" aria-busy="true"><span class="art-surface" aria-hidden="true"></span><span class="art-loading" aria-hidden="true">${icon('town')}</span></span>`;
 const sources=Object.entries({small:t.small,native:t.native}).filter(([,sheet])=>sheet);
 const attributes=sources.map(([name,sheet])=>`data-art-${name}="${esc(sheet.url)}"${sheet.frame?` data-${name}-frame="${sheet.frame}"`:''}`).join(' ');
 const positions=sources.map(([name,sheet])=>`--${name}-x:${sheet.x}%;--${name}-y:${sheet.y}%;--${name}-size:${sheet.size}`).join(';');
 return `<span class="painted-art ${kind}-painting${t.portraitCell?' portrait-cell':''} ${esc(className)}" data-art-url="${esc(t.url)}" data-art-x="${t.x}" data-art-y="${t.y}"${t.frame?` data-art-frame="${t.frame}"`:''} ${attributes} data-small-width="80" data-small-height="${t.portraitShape?107:80}" style="--tile-x:${t.x}%;--tile-y:${t.y}%;${positions}" role="img" aria-label="${esc(t.name)} ${t.level?'Lv.'+t.level+(t.finalStage?'・最終形態':''):t.rank+'ランク'}のオリジナルイラスト" aria-busy="true"><span class="art-surface" aria-hidden="true"></span><span class="art-loading" aria-hidden="true">${icon(kind==='officer'?'officers':kind==='castle'?'town':'facilities')}</span></span>`;
}
function portrait(o){
 if(!o)return'';
 const rank=ranks.includes(o.rank)?o.rank:'D',special=o.id===operatorPortrait.id&&rank===operatorPortrait.rank;
 // The engine supplies this flag only for the current, verified deputy's view.
 // An ordinary Shimazu U, another officer, or another rank keeps its atlas art.
 const deputy=o.deputyExclusive===true&&o.id===deputyPortrait.id&&o.rank===deputyPortrait.rank;
 let painting;
 if(deputy){
  const art=deputyPortrait,preview=width=>`${previewDir}${art.file}-${width}.webp?v=${art.revision}`;
  painting=`<span class="painted-art painted-portrait deputy-portrait" data-art-url="assets/${art.file}.webp?v=${art.revision}" data-art-small="${preview(160)}" data-small-width="160" data-small-height="160" data-art-native="${preview(384)}" data-native-width="384" data-native-height="384" data-art-x="50" data-art-y="50" role="img" aria-label="総大将 島津義久 Uランクのレリーフ加工特別イラスト" aria-busy="true"><span class="art-surface" aria-hidden="true"></span><span class="art-loading" aria-hidden="true">${icon('officers')}</span></span>`;
 }else if(special){
  painting=`<span class="painted-art painted-portrait operator-portrait" data-art-url="${operatorPortrait.url}" data-art-small="${previewUrl('operator-ieyasu-u-160')}" data-small-width="160" data-small-height="240" data-art-native="${previewUrl('operator-ieyasu-u-384')}" data-native-width="384" data-native-height="576" data-art-x="50" data-art-y="50" role="img" aria-label="束帯姿の晩年の${esc(o.name||officers.get(o.id)?.name||'德川家康')} Uランクの特別肖像" aria-busy="true"><span class="art-surface" aria-hidden="true"></span><span class="art-loading" aria-hidden="true">${icon('officers')}</span></span>`;
 }else painting=tile('officer',o.id,'painted-portrait',rank);
 return `<span class="portrait-frame${deputy?' deputy-relief-frame':''}" data-rank="${rank}">${painting}<img class="rank-frame" src="${frames[rank]}" alt="" aria-hidden="true" loading="lazy"><b class="portrait-rank-badge" aria-hidden="true">${rank}</b></span>`;
}
function load(url){
 if(cache.has(url))return cache.get(url);
 const image=new Image();
 const promise=new Promise((resolve,reject)=>{
  const ready=()=>{loaded.add(url);resolve(url);};
  image.decoding='async';
  image.onload=()=>{if(typeof image.decode==='function')image.decode().then(ready,ready);else ready();};
  image.onerror=()=>{cache.delete(url);reject(Error('画像を読み込めませんでした'));};
 });
 cache.set(url,promise);image.src=url;
 return promise;
}
// Fill a facility frame with one atlas cell. The SVG viewport clips before
// scaling, so cover cropping cannot expose neighbouring cells or side mounts.
function facilityFrame(value){
 const values=String(value||'').split(',').map(Number);if(values.length!==5)return null;
 const [columns,rows,index,width,height]=values;
 if(!values.every(Number.isSafeInteger)||columns<1||rows<1||columns>32||rows>32||index<0||index>=columns*rows||width<1||height<1||width>1024||height>1024)return null;
 return{x:(index%columns)*width,y:Math.floor(index/columns)*height,width,height,atlasWidth:columns*width,atlasHeight:rows*height};
}
function paintFacility(el,source){
 if(!el.dataset.artFrame)return false;
 const frame=facilityFrame(source.kind==='small'?el.dataset.smallFrame:source.kind==='native'?el.dataset.nativeFrame:el.dataset.artFrame);
 const surface=el.querySelector(':scope > .art-surface');if(!frame||!surface)return false;
 const signature=source.url+'|'+[frame.x,frame.y,frame.width,frame.height,frame.atlasWidth,frame.atlasHeight].join(',');
 if(surface.dataset?.facilityFrame===signature&&surface.querySelector?.('.facility-art-viewport'))return true;
 surface.style.backgroundImage='none';
 surface.innerHTML=`<svg class="facility-art-viewport" viewBox="${frame.x} ${frame.y} ${frame.width} ${frame.height}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false"><image href="${esc(source.url)}" x="0" y="0" width="${frame.atlasWidth}" height="${frame.atlasHeight}" preserveAspectRatio="none"/></svg>`;
 if(surface.dataset)surface.dataset.facilityFrame=signature;
 return true;
}
function displaySource(el,rect){
 const d=el.dataset;
 if(!d.artUrl)return {url:d.ghostUrl,kind:'ghost'};
 const original={url:d.artUrl,kind:'original'};
 if(loaded.has(d.artUrl)||!d.artSmall||!rect?.width||!rect.height)return original;
 const density=global.devicePixelRatio||1;
 const frame=facilityFrame(d.artFrame),aspect=frame?frame.width/frame.height:null;
 const width=(aspect?Math.max(rect.width,rect.height*aspect):rect.width)*density;
 const height=(aspect?Math.max(rect.height,rect.width/aspect):rect.height)*density;
 const nativeFits=d.artNative&&(!d.nativeWidth||(width<=Number(d.nativeWidth)&&height<=Number(d.nativeHeight)));
 if(nativeFits&&loaded.has(d.artNative))return {url:d.artNative,kind:'native'};
 if(width<=Number(d.smallWidth)&&height<=Number(d.smallHeight))return {url:d.artSmall,kind:'small'};
 return nativeFits?{url:d.artNative,kind:'native'}:original;
}
function observePaint(el){
 if(observer){if(!observedPaints.has(el)){observedPaints.add(el);observer.observe(el);}return;}
 if(!canPaint(el))return;
 if(!global.innerWidth||!global.innerHeight){reveal(el);return;}
 const rect=el.getBoundingClientRect();
 if(rect.width&&rect.height&&rect.bottom>0&&rect.top<global.innerHeight+96&&rect.right>0&&rect.left<global.innerWidth)reveal(el,rect);
}
function unobservePaint(el){
 if(observer&&observedPaints.has(el)){observer.unobserve(el);observedPaints.delete(el);}
}
function canPaint(el){
 if(document.hidden||el.isConnected===false)return false;
 // A closed dialog can keep hundreds of cards in the DOM. Do not measure or
 // upgrade those images while another screen is open.
 if(el.closest?.('[hidden],[inert],dialog:not([open])'))return false;
 return !global.SENGOKU_AT_TITLE||el.closest('#launch-screen, #public-lord-profile, #community-modal [data-own-commander]');
}
function reveal(el,rect){
 if(!canPaint(el))return;
 const selected=displaySource(el,rect||el.getBoundingClientRect?.()),url=selected.url;
 if(!url)return;
 if(el.dataset.artReady&&el.dataset.artSource===url){paintFacility(el,selected);return;}
 const active=paintRequests.get(el);
 if(el.dataset.artLoading&&active?.url===url)return active.done;
 const request={url},canonical=el.dataset.artUrl||el.dataset.ghostUrl;
 paintRequests.set(el,request);el.dataset.artLoading='1';
 const current=()=>el.isConnected&&paintRequests.get(el)===request&&(el.dataset.artUrl||el.dataset.ghostUrl)===canonical&&
  (selected.kind!=='small'||el.dataset.artSmall===url)&&(selected.kind!=='native'||el.dataset.artNative===url);
 const paint=source=>{
  if(source.kind==='ghost')el.style.setProperty('--item-art',`url("${source.url}")`);
  else if(!paintFacility(el,source))(el.querySelector(':scope > .art-surface')||el).style.backgroundImage=`url("${source.url}")`;
  el.dataset.artSource=source.url;el.dataset.artSheet=source.kind;
  el.dataset.artReady='1';el.classList.add('art-ready');el.classList.remove('art-error');el.setAttribute('aria-busy','false');
 };
 // A thumbnail already decoded in the gallery can paint a new detail dialog
 // immediately, while its native painting is loading. This adds no download.
 if(!el.dataset.artReady&&selected.kind!=='small'&&loaded.has(el.dataset.artSmall))paint({url:el.dataset.artSmall,kind:'small'});
 request.done=(async()=>{
  let source=selected;
  try{
   // A rare rank or later level has no native group. Paint its smaller sheet
   // first. If the player switches pages during that load, skip the large sheet.
   const preview=el.dataset.artSmall;
   if(source.kind==='original'&&preview&&!cache.has(canonical)){
    try{await load(preview);}catch(_){}
    if(!current())return;
    if(!canPaint(el)){observePaint(el);return;}
    if(loaded.has(preview)&&el.dataset.artSmall===preview)paint({url:preview,kind:'small'});
    if(observer){
     const bounds=el.getBoundingClientRect();
     if(!canPaint(el)||!bounds.width||!bounds.height||bounds.bottom<=-96||bounds.top>=global.innerHeight+96||bounds.right<=0||bounds.left>=global.innerWidth){
      observePaint(el);return;
     }
    }
   }
   try{await load(source.url);}catch(error){
    if(source.url===canonical||!current())throw error;
    if(!canPaint(el)){observePaint(el);return;}
    source={url:canonical,kind:'original'};await load(canonical);
   }
   if(current()){if(canPaint(el))paint(source);else observePaint(el);}
  }catch(_){if(current()){if(canPaint(el)){el.classList.add('art-error');el.setAttribute('aria-busy','false');}else observePaint(el);}}
  finally{if(paintRequests.get(el)===request){paintRequests.delete(el);delete el.dataset.artLoading;}}
 })();
 return request.done;
}

const backgrounds={court:0,town:1,map:2,field:2,officers:3,army:4,roaming:4,trade:5,research:6,council:7,facilities:8,gacha:9,settings:10,save:10,music:11,mail:12};
function decorateBackground(el,type){
 const index=Object.hasOwn(backgrounds,type)?backgrounds[type]:backgrounds.council;
 el.dataset.ghostTheme='1';
 el.dataset.ghostUrl=previewUrl('controls');
 el.style.setProperty('--item-x',(index%4)/3*100+'%');
 el.style.setProperty('--item-y',Math.floor(index/4)/3*100+'%');
 el.style.setProperty('--item-size','400% 400%');
 el.style.setProperty('--button-art-size','400% 400%');
 observePaint(el);
}
const buttonSelector='button,[role="button"],[role="tab"],[role="switch"],input[type="button"],input[type="submit"],input[type="reset"],summary,a.button,a.action-link,a.nav-play,.decision-list a';
function buttonArtwork(el){
 if(el.dataset.buttonArtEnhanced)return;
 el.dataset.buttonArtEnhanced='1';
 // Use the existing lazy image observer. Hundreds of unopened roster or
 // facility controls must not eagerly download all illustration atlases.
 if(!el.dataset.ghostUrl){
  const action=String(el.dataset.artTheme||el.dataset.view||el.dataset.action||el.dataset.roamingAction||el.dataset.tradeAction||el.dataset.socialAction||'council');
  let type=action;
  if(el.hasAttribute('data-roaming-action')||/roaming|attack|battle|tactic|army|troop|train/.test(action))type='army';
  else if(el.hasAttribute('data-trade-action')||/trade/.test(action))type='trade';
  else if(/gacha|draw|rank/.test(action))type='gacha';
  else if(/officer|recruit/.test(action))type='officers';
  else if(/music|sound|mute/.test(action))type='music';
  else if(/save|export|import|sync|recovery|settings/.test(action))type='save';
  else if(/mail|letter|message|friend/.test(action))type='mail';
  else if(/castle|building|upgrade|town/.test(action))type='town';
  decorateBackground(el,type);
 }
}
// A one-character control already has its own visible symbol. Adding a second
// icon pushes close/step controls outside their fixed hit area.
function hasSymbolLabel(el){return /^[×✕✖+＋−－–‹›«»←→…⋯]$/.test((el.textContent||'').trim());}
// The game fills explicit icon slots on render. Keep them reserved even before their SVG is mounted.
function hasArtworkIcon(el){return Boolean(el.querySelector('svg,img,.painted-art,.portrait-frame,[data-icon]'));}
function matching(root,selector){
 const nodes=Array.from(root.querySelectorAll(selector));
 if(root.nodeType===1&&root.matches(selector))nodes.unshift(root);
 return nodes;
}
function decorate(root=document){
 if(root===document){scheduled=false;decorationRoots.clear();}
 matching(root,'[data-art-url]:not([data-art-observed])').forEach(el=>{el.dataset.artObserved='1';observePaint(el);});
 // Dialogs may reuse detached controls. Their decoration is already present,
 // but an unfinished background still needs a fresh visibility subscription.
 matching(root,'[data-ghost-url]').forEach(el=>{if(!el.dataset.artReady||el.dataset.artSource!==el.dataset.ghostUrl)observePaint(el);});
 const selector='.button,.text-link,.launch-enter,.nav-item,.resource,.building-card,.facility-entry,.territory-row,.research-card,.quest-row,.tactic-card,.music-track,.settings-stack>.button,.social-tabs button,.social-list-card,.social-mail-row,.social-profile-section,.social-gift,.clan-choice,.gacha-banner,.title-feature,.panel,.notice,.officer-content';
 matching(root,selector).forEach(el=>{if(el.dataset.artEnhanced)return;el.dataset.artEnhanced='1';el.classList.add('illustrated-item');
  let type=el.dataset.artTheme||el.dataset.view||el.dataset.action||'council';if(type.includes('gacha')||type.includes('draw'))type='gacha';if(type.includes('music')||type==='sound')type='music';if(type.includes('save')||type.includes('export')||type.includes('import'))type='save';
  decorateBackground(el,type);
  if(el.matches('button')&&!hasSymbolLabel(el)&&!hasArtworkIcon(el)&&!el.classList.contains('territory-row'))el.insertAdjacentHTML('afterbegin',icon(type));
 });
 matching(root,buttonSelector).forEach(buttonArtwork);
 matching(root,'button,.title-feature').forEach(el=>{if(!hasSymbolLabel(el)&&!hasArtworkIcon(el)){let type=el.dataset.artTheme||el.dataset.view||el.dataset.action||'default';if(type.includes('gacha')||type.includes('draw'))type='gacha';else if(type.includes('music')||type.includes('sound'))type='music';else if(type.includes('rank'))type='rank';else if(type.includes('officer')||type.includes('recruit'))type='officers';else if(type.includes('castle')||type.includes('building')||type.includes('upgrade'))type='town';else if(type.includes('save')||type.includes('export')||type.includes('import'))type='save';el.insertAdjacentHTML('afterbegin',icon(type));}});
 matching(root,'.section-heading h2,.panel-heading h2,.social-profile-section h3').forEach(el=>{if(!el.querySelector('svg'))el.insertAdjacentHTML('afterbegin',icon(el.closest('.social-profile-section')?'save':'council'));});
}
function flushDecorations(){
 if(!scheduled)return;
 scheduled=false;const roots=[...decorationRoots];decorationRoots.clear();
 for(const root of roots)if(root===document||root.isConnected)decorate(root);
}
function schedule(root=document){
 if(!root?.querySelectorAll||root!==document&&!root.isConnected)return;
 // A replacement row only needs its own artwork. Preserve the broad explicit
 // decorate() API, but never rescan a roster because one button gained an icon.
 if(!decorationRoots.has(document)){
  let covered=false;
  for(const pending of decorationRoots){if(pending===root||pending.contains?.(root)){covered=true;break;}}
  if(!covered){for(const pending of decorationRoots)if(root===document||root.contains?.(pending))decorationRoots.delete(pending);decorationRoots.add(root);}
 }
 if(scheduled)return;scheduled=true;requestAnimationFrame(flushDecorations);
}
function releaseDetachedPaints(root){
 // Stable DOM reconciliation moves connected nodes between parents. Preserve
 // those subscriptions, and only release trees that are really gone.
 if(root.isConnected)return;
 for(const el of matching(root,'[data-art-observed],[data-ghost-url]')){
  unobservePaint(el);deferredTitle.delete(el);
  delete el.dataset.artObserved;
 }
}
function artworkMutations(records){
 for(const record of records){
  const changed=[...record.addedNodes,...record.removedNodes].some(node=>node.nodeType===1);
  if(!changed)continue;
  const target=record.target;
  if(target?.closest?.('.ui-motion-layer'))continue;
  for(const node of record.removedNodes)if(node.nodeType===1)releaseDetachedPaints(node);
  if(target?.matches?.('button,.title-feature,.section-heading h2,.panel-heading h2,.social-profile-section h3'))schedule(target);
  for(const node of record.addedNodes)if(node.nodeType===1&&!node.matches?.('.ui-motion-layer,.ui-motion-clip,.ui-motion-wave'))schedule(node);
 }
}
function visiblePaints({skipReadyControls=false}={}){
 const h=global.innerHeight,w=global.innerWidth;
 return Array.from(document.querySelectorAll('[data-art-url],[data-ghost-url]')).flatMap(el=>{
  if(!canPaint(el))return [];
  // Control backgrounds keep the same decoded atlas at every size. A click
  // must not force layout reads for all already-painted buttons and panels.
  if(skipReadyControls&&!el.dataset.artUrl&&el.dataset.artReady&&el.dataset.artSource===el.dataset.ghostUrl)return [];
  const rect=el.getBoundingClientRect();
  return rect.width&&rect.height&&rect.bottom>0&&rect.top<h&&rect.right>0&&rect.left<w?[{el,rect}]:[];
 });
}
async function readyCurrent(onProgress){
 if(document.hidden)return;
 flushDecorations();
 if(!global.SENGOKU_AT_TITLE){
  for(const el of deferredTitle){
   if(el.isConnected&&observer){unobservePaint(el);observePaint(el);}
  }
  deferredTitle.clear();
 }
 const groups=new Map();
 for(const {el,rect}of visiblePaints({skipReadyControls:true})){
  const {url}=displaySource(el,rect);if(!url)continue;
  if(!groups.has(url))groups.set(url,[]);
  groups.get(url).push(reveal(el,rect));
 }
 let done=0;
 await Promise.allSettled([...groups.values()].map(group=>Promise.allSettled(group).then(()=>onProgress?.(++done,groups.size))));
}
function init(){
 if('IntersectionObserver'in global)observer=new IntersectionObserver(entries=>entries.forEach(entry=>{
  const el=entry.target;
  if(!el.isConnected){unobservePaint(el);deferredTitle.delete(el);return;}
  if(!entry.isIntersecting){deferredTitle.delete(el);return;}
  if(!canPaint(el)){deferredTitle.add(el);return;}
  deferredTitle.delete(el);reveal(el,entry.boundingClientRect);unobservePaint(el);
 }),{rootMargin:'96px'});
 let resizeFrame;
 const repaintVisible=()=>{
  if(document.hidden||resizeFrame)return;
  resizeFrame=requestAnimationFrame(()=>{resizeFrame=null;if(!document.hidden)visiblePaints({skipReadyControls:true}).forEach(({el,rect})=>reveal(el,rect));});
 };
 global.addEventListener?.('resize',repaintVisible);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)repaintVisible();});
 if(!observer)global.addEventListener?.('scroll',repaintVisible,{capture:true,passive:true});
 new MutationObserver(artworkMutations).observe(document.body,{childList:true,subtree:true});decorate();}
global.SengokuArt={portrait,castle:(id,c='',level=1)=>tile('castle',id,c,level),castleScene,castlePanorama,castleGrowthInfo,facility:(id,c='',level=1)=>tile('facility',id,c,level),icon,tileInfo,facilityFrame,load,readyCurrent,decorate,schedule,totalIllustrations:8224};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})(window);
