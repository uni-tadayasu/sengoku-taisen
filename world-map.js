/* 戦国VS — actual coastlines, Web Mercator geography and castle coordinates.
 * Geographic data is supplied by map-data.js; no schematic fallback is drawn.
 */
(function(global){
'use strict';
const RAD=Math.PI/180,EARTH=6378137,ORIGIN_LON=135,ORIGIN_LAT=36;
const merc=lat=>Math.log(Math.tan(Math.PI/4+Math.max(-85.05112878,Math.min(85.05112878,lat))*RAD/2))/RAD;
const ORIGIN_Y=merc(ORIGIN_LAT),savedViews=new Map(),mounted=new WeakMap(),activeKeys=new Map(),pathCache=new WeakMap();
let sequence=0;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const rounded=value=>Math.round(value*1000)/1000;
function project(lon,lat){return[(Number(lon)-ORIGIN_LON)*100,-(merc(Number(lat))-ORIGIN_Y)*100];}
function unproject(x,y){return[Number(x)/100+ORIGIN_LON,(2*Math.atan(Math.exp((ORIGIN_Y-Number(y)/100)*RAD))-Math.PI/2)/RAD];}
function projectBounds(bounds){
  if(!Array.isArray(bounds)||bounds.length!==4||!bounds.every(finite))return null;
  const nw=project(bounds[0],bounds[3]),se=project(bounds[2],bounds[1]);
  return{x:nw[0],y:nw[1],width:se[0]-nw[0],height:se[1]-nw[1]};
}
function geometryPath(input){
  if(!input||typeof input!=='object')return'';
  if(pathCache.has(input))return pathCache.get(input);
  const line=(coordinates,close=false)=>{
    if(!Array.isArray(coordinates))return'';
    const points=coordinates.filter(p=>Array.isArray(p)&&finite(p[0])&&finite(p[1])).map(p=>project(p[0],p[1]));
    return points.length<2?'':points.map((p,i)=>(i?'L':'M')+rounded(p[0])+','+rounded(p[1])).join('')+(close?'Z':'');
  };
  let result='';
  if(input.type==='FeatureCollection')result=(input.features||[]).map(geometryPath).join('');
  else if(input.type==='Feature')result=geometryPath(input.geometry);
  else if(input.type==='GeometryCollection')result=(input.geometries||[]).map(geometryPath).join('');
  else if(input.type==='Polygon')result=(input.coordinates||[]).map(ring=>line(ring,true)).join('');
  else if(input.type==='MultiPolygon')result=(input.coordinates||[]).flatMap(polygon=>polygon.map(ring=>line(ring,true))).join('');
  else if(input.type==='LineString')result=line(input.coordinates);
  else if(input.type==='MultiLineString')result=(input.coordinates||[]).map(coords=>line(coords)).join('');
  pathCache.set(input,result);return result;
}
function fitBounds(bounds,width,height,padding=48){
  const w=Math.max(1,width),h=Math.max(1,height),innerW=Math.max(1,w-padding*2),innerH=Math.max(1,h-padding*2);
  const scale=Math.max(Math.max(bounds.width,1)/innerW,Math.max(bounds.height,1)/innerH);
  return{x:bounds.x+bounds.width/2-scale*w/2,y:bounds.y+bounds.height/2-scale*h/2,width:scale*w,height:scale*h};
}
function zoomAt(view,factor,anchor,width,height){
  const x=anchor[0]/Math.max(1,width),y=anchor[1]/Math.max(1,height),w=view.width*factor,h=view.height*factor;
  return{x:view.x+view.width*x-w*x,y:view.y+view.height*y-h*y,width:w,height:h};
}
function pointsBounds(points,minSpan=30){
  if(!points.length)return null;
  const xs=points.map(p=>p.x),ys=points.map(p=>p.y),left=Math.min(...xs),right=Math.max(...xs),top=Math.min(...ys),bottom=Math.max(...ys);
  return{x:(left+right)/2-Math.max(minSpan,right-left)/2,y:(top+bottom)/2-Math.max(minSpan,bottom-top)/2,width:Math.max(minSpan,right-left),height:Math.max(minSpan,bottom-top)};
}
function castlePoints(castles,coordinates,options={}){
  const index=Array.isArray(coordinates)?Object.fromEntries(coordinates.map(p=>[p.id,p])):coordinates||{};
  return(castles||[]).flatMap(castle=>{
    const source=index[castle.id]||castle.geo||castle.coordinates||castle;
    const lon=Number(Array.isArray(source)?source[0]:source.lon??source.lng??source.longitude),lat=Number(Array.isArray(source)?source[1]:source.lat??source.latitude);
    if(!Number.isFinite(lon)||!Number.isFinite(lat)||lon<120||lon>151||lat<20||lat>48)return[];
    const [x,y]=project(lon,lat),own=castle.owner===options.clan,ally=(options.treaties?.[castle.owner]||0)>(options.turn||0);
    const restrictedLabel=['edo','sunpu'].includes(castle.id)?'選択不可':'';
    const restricted=castle.id==='edo'&&options.isAdmin!==true||castle.id==='sunpu'&&(options.isStaff!==true||options.isAdmin===true);
    return[{...castle,lon,lat,x,y,own,ally,selected:castle.id===options.selectedId,home:castle.id===options.homeId,restrictedLabel,disabled:castle.disabled===true||restricted&&options.allowRestrictedSelection!==true,accuracy:source.accuracy||castle.accuracy||'',sourceURL:source.sourceURL||source.sourceUrl||''}];
  });
}
function layoutMarkers(points,view,width,height,{distance=27,labels=true,markerSize=20}={}){
  const symbolSize=Math.max(20,Math.min(80,Number(markerSize)||20));
  const visible=points.map(point=>({...point,sx:(point.x-view.x)/view.width*width,sy:(point.y-view.y)/view.height*height})).filter(p=>p.sx>-30&&p.sx<width+30&&p.sy>-30&&p.sy<height+30);
  // Complete-link groups have a bounded on-screen diameter. A chain of nearby
  // castles must never merge distant provinces into a single nation-wide cluster.
  const groups=[];
  for(const point of [...visible].sort((a,b)=>a.sx-b.sx||a.sy-b.sy||a.id.localeCompare(b.id))){
    if(point.selected||point.home||distance<=0){groups.push([point]);continue;}
    let best=null,bestDistance=Infinity;
    for(const group of groups){
      if(group[0].selected||group[0].home||!group.every(member=>Math.hypot(member.sx-point.sx,member.sy-point.sy)<distance))continue;
      const cx=group.reduce((n,p)=>n+p.sx,0)/group.length,cy=group.reduce((n,p)=>n+p.sy,0)/group.length,d=Math.hypot(point.sx-cx,point.sy-cy);
      if(d<bestDistance){best=group;bestDistance=d;}
    }
    if(best)best.push(point);else groups.push([point]);
  }
  const markers=groups.map(group=>{
    if(group.length===1)return{...group[0],key:group[0].id,points:group,cluster:false,priority:group[0].selected?100:group[0].home?90:group[0].own?60:group[0].reachable?40:20};
    const ids=group.map(p=>p.id).sort();return{key:'group-'+ids.join('-'),points:group,cluster:true,sx:group.reduce((n,p)=>n+p.sx,0)/group.length,sy:group.reduce((n,p)=>n+p.sy,0)/group.length,own:group.some(p=>p.own),reachable:group.some(p=>p.reachable),priority:30,bounds:pointsBounds(group)};
  }).sort((a,b)=>b.priority-a.priority||a.key.localeCompare(b.key));
  const occupied=markers.map(m=>{const size=m.cluster?36:symbolSize;return{x:m.sx-size/2,y:m.sy-size/2,width:size,height:size};});
  const overlaps=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
  for(const marker of markers){
    if(marker.cluster||!labels&&!marker.selected&&!marker.home)continue;
    const w=Math.min(196,Math.max(44,Array.from(marker.name||'').length*13+14)),h=25;
    const half=symbolSize/2,choices=[{x:marker.sx+half+5,y:marker.sy-h/2,width:w,height:h},{x:marker.sx-w-half-5,y:marker.sy-h/2,width:w,height:h},{x:marker.sx-w/2,y:marker.sy-half-h-2,width:w,height:h},{x:marker.sx-w/2,y:marker.sy+half+9,width:w,height:h}];
    let box=choices.find(r=>r.x>8&&r.x+r.width<width-8&&r.y>54&&r.y+r.height<height-66&&!occupied.some(o=>overlaps(r,o)));
    // Home/selection may relax edge margins, but large artwork and existing
    // labels must stay clear. Preserve the original compact-symbol fallback.
    if(!box&&(marker.selected||marker.home))box=choices.find(r=>r.x>3&&r.x+r.width<width-3&&r.y>4&&r.y+r.height<height-4&&(symbolSize<=20||!occupied.some(o=>overlaps(r,o))));
    if(box){marker.label={x:box.x-marker.sx,y:box.y-marker.sy,width:box.width,height:box.height};occupied.push(box);}
  }
  return markers;
}
function scaleForView(view,pixels){
  const [,lat]=unproject(view.x+view.width/2,view.y+view.height/2),metersPerPixel=view.width/Math.max(1,pixels)/100*EARTH*RAD*Math.cos(lat*RAD);
  const wanted=metersPerPixel*100,power=10**Math.floor(Math.log10(Math.max(1,wanted)));
  const meters=[1,2,5,10].map(value=>value*power).filter(value=>value<=wanted).at(-1)||power;
  return{meters,pixels:meters/metersPerPixel,label:meters>=1000?(meters/1000).toLocaleString('ja-JP')+' km':Math.round(meters)+' m',latitude:lat};
}
const iconPaths={plus:'M12 5v14M5 12h14',minus:'M5 12h14',fit:'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5',home:'m3 11 9-8 9 8M5 9v12h14V9M10 21v-7h4v7',castle:'M3 20h18M5 20V10l7-5 7 5v10M3 10h18M9 5l3-3 3 3M9 14h6M10 20v-3h4v3',layers:'m3 7 9-5 9 5-9 5-9-5Zm0 5 9 5 9-5M3 17l9 5 9-5',route:'M4 5a2 2 0 1 0 0 .01M20 19a2 2 0 1 0 0 .01M6 5h9a4 4 0 0 1 0 8H9a3 3 0 0 0 0 6h9',label:'M3 5h18M12 5v15M8 20h8',focus:'M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5M12 8v8M8 12h8',north:'m12 2 7 18-7-4-7 4 7-18Z'};
const icon=name=>`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${iconPaths[name]||iconPaths.castle}"/></svg>`;
function markerPresentation(marker,options={}){
  let appearance=null;
  // Presentation is supplied by a trusted local view; public text must be
  // escaped by that renderer. Views without an appearance callback keep
  // their original symbols.
  try{if(!marker.cluster&&typeof options.markerAppearance==='function')appearance=options.markerAppearance(marker);}catch(_){}
  const custom=Boolean(appearance&&typeof appearance.html==='string'&&appearance.html);
  const label=marker.cluster?`${marker.points.length}${options.countUnit||'城'}の地域を拡大：${marker.points.map(p=>p.name).join('、')}`:`${marker.name} ${marker.owner==='德川家'?'徳川家':marker.owner||''} ${marker.home?'本拠 ':''}${marker.disabled?(marker.restrictedLabel||'専用拠点')+' ':''}${marker.reachable?'進軍可能 ':''}Lv.${marker.level||1}`;
  return{custom,html:custom?appearance.html:marker.cluster?`<b>${marker.points.length}</b>`:marker.home?icon('home'):icon('castle'),label:custom&&typeof appearance.label==='string'?appearance.label:label};
}
function safeUrl(value){return typeof value==='string'&&/^(?:https?:\/\/|(?:\.\/)?assets\/|data:image\/)/i.test(value)?value:'';}
function mount(container,options={}){
  if(!container||typeof container.querySelector!=='function')return null;
  const previous=mounted.get(container);if(previous){previous.update(options);return previous;}
  const key=options.stateKey||'campaign-map';activeKeys.get(key)?.destroy();
  let opts={region:'all',clan:'',isAdmin:false,isStaff:false,turn:0,...options},geography=opts.geography||global.SENGOKU_GEOGRAPHY;
  const coordinates=()=>opts.coordinates||global.SENGOKU_CASTLE_COORDS||geography?.castles||{};
  const countryBounds=projectBounds(geography?.bounds||[122,24,149,46]),landPath=geometryPath(geography?.land);
  if(!landPath){container.innerHTML='<div class="sg-map-unavailable"><strong>地形データを読み込めませんでした</strong><p>ページを再読み込みしてください。拠点一覧からは城を選べます。</p></div>';return null;}
  const id='sengoku-geography-'+(++sequence),stored=savedViews.get(key);
  let width=800,height=600,baseView=fitBounds(countryBounds,width,height,28),view={...baseView},points=[],markersByKey=new Map(),frame=0,animation=0,destroyed=false,region=opts.region;
  let labels=stored?.labels!==false,routes=stored?.routes===true,terrain=stored?.terrain!==false,pointers=new Map(),gesture=null,dragged=false,clickUntil=0;
  let firstSize=true,tooltipKey=null,lastView=stored?.camera||null;
  const sourceList=(geography.sources||[]).map(source=>{const url=safeUrl(source.url||source.href);return url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(source.label||source.name||'地図出典')}</a>`:'';}).filter(Boolean).join('<span>·</span>');
  const terrainEntries=Array.isArray(geography.terrain)?geography.terrain:geography.terrain?.images||geography.terrain?.layers||[geography.terrain].filter(Boolean);
  const terrainHtml=terrainEntries.map(layer=>{
    const projection=String(layer.projection?.type||layer.projection||'mercator').toLowerCase(),url=safeUrl(layer.url||layer.src);
    const bounds=projectBounds(layer.bounds);if(!url||!bounds||!['mercator','webmercator','web-mercator','epsg:3857'].includes(projection))return'';
    return`<image data-terrain-kind="${layer.kind==='color'?'color':'hillshade'}" href="${esc(url)}" x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" preserveAspectRatio="none"/>`;
  }).join('');
  const button=(action,title,symbol,pressed)=>`<button type="button" class="sg-map-control" data-map-action="${action}" title="${title}" aria-label="${title}"${pressed===undefined?'':` aria-pressed="${pressed}"`}>${icon(symbol)}</button>`;
  container.classList.add('sg-map-host');
  container.innerHTML=`<div class="sg-map"><div class="sg-map-surface" tabindex="0" role="group" aria-label="${esc(opts.surfaceLabel||'日本の実地形と城の地図。矢印キーで移動、プラス・マイナスで拡大縮小、Homeで本拠へ。')}"><svg class="sg-map-geography" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${id}-sea" x1="0" y1="0" x2=".7" y2="1"><stop stop-color="#153b49"/><stop offset=".55" stop-color="#0b2739"/><stop offset="1" stop-color="#061b2e"/></linearGradient><linearGradient id="${id}-land" x1="0" y1="0" x2=".4" y2="1"><stop stop-color="#82906c"/><stop offset=".5" stop-color="#708366"/><stop offset="1" stop-color="#526f55"/></linearGradient><clipPath id="${id}-clip"><path d="${landPath}" fill-rule="evenodd"/></clipPath></defs><rect data-map-ocean fill="url(#${id}-sea)"/><g data-map-grid class="sg-map-grid"></g><path class="sg-map-coast-shadow" d="${landPath}" fill-rule="evenodd"/><path class="sg-map-land" d="${landPath}" fill="url(#${id}-land)" fill-rule="evenodd"/><g class="sg-map-relief" data-map-terrain clip-path="url(#${id}-clip)">${terrainHtml}</g><path class="sg-map-prefectures" d="${geometryPath(geography.boundaries||geography.prefectures)}"/><path class="sg-map-lakes" d="${geometryPath(geography.lakes)}"/><path class="sg-map-rivers" d="${geometryPath(geography.rivers)}"/><path class="sg-map-coastline" d="${geometryPath(geography.coastline)||landPath}" fill-rule="evenodd"/><g data-map-routes class="sg-map-routes"></g><g data-map-seas class="sg-map-seas"></g></svg><div class="sg-map-markers" data-map-markers></div></div><div class="sg-map-heading"><span class="sg-map-heading-label">${esc(opts.eyebrow||'JAPAN · TERRAIN MAP')}</span><strong>${esc(opts.title||'日本列島')}<span data-map-region></span></strong><span class="sg-map-heading-detail" data-map-count></span></div><div class="sg-map-north" title="北が上の地図">${icon('north')}<span>N</span></div><div class="sg-map-zoom">${button('zoom-in','地図を拡大','plus')}${button('zoom-out','地図を縮小','minus')}<span class="sg-map-control-divider"></span>${button('home','本拠を中心に表示','home')}${button('selected',opts.selectedLabel||'選択した城を中心に表示','focus')}${button('nation','日本列島の全景','fit')}</div><div class="sg-map-layers" role="group" aria-label="地図の表示">${button('terrain','地形の陰影を表示','layers',terrain)}${button('labels',opts.labelsLabel||'城名を表示','label',labels)}${button('routes','ゲームの進軍経路を表示','route',routes)}</div><div class="sg-map-tooltip" data-map-tooltip hidden></div><div class="sg-map-bottom"><div class="sg-map-legend"><span class="sg-map-legend-own">${esc(opts.legend?.own||'自領')}</span><span class="sg-map-legend-ally">${esc(opts.legend?.ally||'同盟')}</span><span class="sg-map-legend-reachable">${esc(opts.legend?.reachable||'進軍可能')}</span><span class="sg-map-legend-other">${esc(opts.legend?.other||'他勢力')}</span></div><div class="sg-map-scale"><span data-map-scale-label></span><i data-map-scale-bar></i></div></div><div class="sg-map-footer"><span class="sg-map-instruction">ドラッグで移動 · スクロール／ピンチで拡大</span><span data-map-position></span><span class="sg-map-sources">${sourceList}</span></div><span class="sg-map-sr" data-map-live role="status" aria-live="polite"></span></div>`;
  const surface=container.querySelector('.sg-map-surface'),svg=container.querySelector('.sg-map-geography'),markerLayer=container.querySelector('[data-map-markers]'),tooltip=container.querySelector('[data-map-tooltip]'),ocean=container.querySelector('[data-map-ocean]');
  const listeners=[];
  function listen(node,type,handler,settings){node.addEventListener(type,handler,settings);listeners.push(()=>node.removeEventListener(type,handler,settings));}
  const raf=global.requestAnimationFrame?.bind(global)||(fn=>global.setTimeout(fn,16)),caf=global.cancelAnimationFrame?.bind(global)||global.clearTimeout.bind(global);
  function remember(){savedViews.set(key,{camera:{x:view.x+view.width/2,y:view.y+view.height/2,zoom:baseView.width/view.width},labels,routes,terrain,region:opts.region});}
  function constrain(candidate){
    const zoom=clamp(baseView.width/candidate.width,1,128),w=baseView.width/zoom,h=w*height/width;
    const cx=clamp(candidate.x+candidate.width/2,countryBounds.x-w*.25,countryBounds.x+countryBounds.width+w*.25),cy=clamp(candidate.y+candidate.height/2,countryBounds.y-h*.2,countryBounds.y+countryBounds.height+h*.2);
    return{x:cx-w/2,y:cy-h/2,width:w,height:h};
  }
  function setView(next,{animate=false}={}){
    if(destroyed)return;if(animation)caf(animation);animation=0;
    const target=constrain(next),reduced=global.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if(!animate||reduced){view=target;schedule();remember();return;}
    const start={...view},began=global.performance?.now?.()||Date.now();
    const step=stamp=>{if(destroyed)return;const t=clamp(((stamp||Date.now())-began)/240,0,1),ease=1-(1-t)**3;view=Object.fromEntries(Object.keys(start).map(k=>[k,start[k]+(target[k]-start[k])*ease]));render();if(t<1)animation=raf(step);else{animation=0;remember();}};
    animation=raf(step);
  }
  function zoom(factor,anchor=[width/2,height/2],animate=false){setView(zoomAt(view,factor,anchor,width,height),{animate});}
  function fit(target='nation',animate=true){
    let bounds;
    if(target==='home'||target==='selected'){
      const point=points.find(p=>p.id===(target==='home'?opts.homeId:opts.selectedId));if(!point)return false;
      const zoomLevel=Number.isFinite(opts.focusZoom)?clamp(opts.focusZoom,1,128):Math.max(14,Math.min(40,baseView.width/view.width));bounds={x:point.x-baseView.width/zoomLevel/2,y:point.y-baseView.height/zoomLevel/2,width:baseView.width/zoomLevel,height:baseView.height/zoomLevel};
      setView(bounds,{animate});return true;
    }
    if(target==='region')bounds=pointsBounds(points.filter(p=>opts.region==='all'||p.region===opts.region));
    else if(target==='castles')bounds=pointsBounds(points);
    else bounds=countryBounds;
    if(!bounds)return false;setView(fitBounds(bounds,width,height,target==='nation'?28:66),{animate});return true;
  }
  function hideTooltip(){tooltip.hidden=true;tooltipKey=null;}
  function showTooltip(marker){
    if(dragged||destroyed)return;tooltipKey=marker.key;
    let crest='';if(!marker.cluster&&typeof opts.crestFor==='function'){const url=safeUrl(opts.crestFor(marker.owner));if(url)crest=`<img class="sg-map-tooltip-crest" src="${esc(url)}" alt="">`;}
    let custom=null;try{if(!marker.cluster&&typeof opts.markerTooltip==='function')custom=opts.markerTooltip(marker);}catch(_){}
    if(custom&&typeof custom==='object')tooltip.innerHTML=`<strong>${esc(custom.title||marker.name)}</strong>${custom.description?`<p>${esc(custom.description)}</p>`:''}${custom.detail?`<small>${esc(custom.detail)}</small>`:''}`;
    else tooltip.innerHTML=marker.cluster?`<strong>${marker.points.length}${esc(opts.countUnit||'城')}がこの地域にあります</strong><p>${esc(marker.points.slice(0,5).map(p=>p.name).join('・'))}${marker.points.length>5?' ほか':''}</p><small>クリック・タップで拡大</small>`:`<div class="sg-map-tooltip-heading">${crest}<div><strong>${esc(marker.name)}</strong><p>${esc(marker.owner==='德川家'?'徳川家':marker.owner||'')} · Lv.${Number(marker.level)||1}${marker.disabled?' · '+esc(marker.restrictedLabel):''}</p></div></div><small>${Number(marker.troops||0).toLocaleString('ja-JP')}兵 · ${marker.lat.toFixed(4)}°N ${marker.lon.toFixed(4)}°E</small>`;
    tooltip.hidden=false;const box=tooltip.getBoundingClientRect(),surfaceBounds=surface.getBoundingClientRect(),sx=width/Math.max(1,surfaceBounds.width),sy=height/Math.max(1,surfaceBounds.height),x=clamp(marker.sx+16,8,Math.max(8,width-box.width*sx-8)),y=clamp(marker.sy+24,64,Math.max(64,height-box.height*sy-70));tooltip.style.left=x+'px';tooltip.style.top=y+'px';
  }
  function selectMarker(marker){
    if(!marker||destroyed)return;
    if(marker.cluster){hideTooltip();setView(fitBounds(marker.bounds,width,height,100),{animate:true});return;}
    if(marker.disabled){container.querySelector('[data-map-live]').textContent=marker.name+'は'+(marker.restrictedLabel||'専用拠点')+'です。';return;}
    opts.selectedId=marker.id;opts.onSelect?.(marker.id);
    if(!destroyed){points=castlePoints(opts.castles,coordinates(),opts);schedule();}
  }
  function renderMarkers(){
    const active=opts.region==='all'?points:points.filter(p=>p.region===opts.region||p.selected||p.home);
    const markerSize=Math.max(20,Math.min(80,Number(opts.markerSize)||20));
    const layout=layoutMarkers(active,view,width,height,{labels,markerSize,distance:baseView.width/view.width>38?0:Math.max(27,markerSize+4)}),keys=new Set();
    for(const marker of layout){
      keys.add(marker.key);let entry=markersByKey.get(marker.key);
      if(!entry){const button=global.document.createElement('button');button.type='button';button.className='sg-map-marker';button.dataset.mapMarker=marker.key;button.innerHTML='<span class="sg-map-marker-symbol"></span><span class="sg-map-marker-label"></span>';markerLayer.appendChild(button);entry={node:button,marker};markersByKey.set(marker.key,entry);}
      entry.marker=marker;const button=entry.node,symbol=button.firstElementChild,label=button.lastElementChild;
      button.style.left=marker.sx+'px';button.style.top=marker.sy+'px';button.style.zIndex=String(marker.priority);
      button.className='sg-map-marker '+(marker.cluster?'is-cluster ':'')+(marker.own?'is-own ':marker.ally?'is-ally ':'is-other ')+(marker.reachable?'is-reachable ':'')+(marker.selected?'is-selected ':'')+(marker.home?'is-home ':'')+(marker.disabled?'is-disabled':'');
      const presentation=markerPresentation(marker,opts);if(presentation.custom)button.className+=' has-custom-art';
      button.disabled=Boolean(marker.disabled);button.setAttribute('aria-label',presentation.label);
      if(!marker.cluster)button.setAttribute('aria-pressed',String(marker.selected));else button.removeAttribute('aria-pressed');
      // Artwork loading adds attributes and a background to the live DOM.
      // Compare the source markup so panning/refreshing does not restart it.
      if(entry.symbolContent!==presentation.html){symbol.innerHTML=presentation.html;entry.symbolContent=presentation.html;}
      label.hidden=!marker.label;
      if(marker.label){label.textContent=marker.name;label.style.left=`calc(50% + ${marker.label.x}px)`;label.style.top=`calc(50% + ${marker.label.y}px)`;}
    }
    for(const [key,entry]of markersByKey)if(!keys.has(key)){if(global.document.activeElement===entry.node)surface.focus({preventScroll:true});entry.node.remove();markersByKey.delete(key);}
    if(tooltipKey){const entry=markersByKey.get(tooltipKey);if(entry)showTooltip(entry.marker);else hideTooltip();}
  }
  function render(){
    if(destroyed)return;frame=0;svg.setAttribute('viewBox',`${view.x} ${view.y} ${view.width} ${view.height}`);
    for(const [name,value]of Object.entries({x:view.x,y:view.y,width:view.width,height:view.height}))ocean.setAttribute(name,value);
    container.querySelector('[data-map-terrain]').style.display=terrain?'':'none';
    const zoom=baseView.width/view.width,nw=unproject(view.x,view.y),se=unproject(view.x+view.width,view.y+view.height),step=zoom>10?.5:zoom>3?1:2,grid=[];
    for(let lon=Math.ceil(nw[0]/step)*step;lon<se[0]&&grid.length<100;lon+=step){const x=project(lon,36)[0];grid.push(`M${x},${view.y}V${view.y+view.height}`);}
    for(let lat=Math.ceil(se[1]/step)*step;lat<nw[1]&&grid.length<100;lat+=step){const y=project(135,lat)[1];grid.push(`M${view.x},${y}H${view.x+view.width}`);}
    container.querySelector('[data-map-grid]').innerHTML=`<path d="${grid.join('')}"/>`;
    const routeLines=[],pointIndex=new Map(points.map(p=>[p.id,p]));
    if(routes)for(const point of points)for(const neighborId of point.neighbors||[]){const other=pointIndex.get(neighborId);if(!other||point.id>=other.id||point.disabled||other.disabled)continue;if(opts.region!=='all'&&point.region!==opts.region&&other.region!==opts.region)continue;routeLines.push(`<path class="${point.own||other.own?'is-own':''}" d="M${point.x},${point.y}L${other.x},${other.y}"/>`);}
    container.querySelector('[data-map-routes]').innerHTML=routeLines.join('');
    const seas=[[134.3,39.1,'日 本 海'],[143.1,33.1,'太 平 洋'],[126.4,29.2,'東 シ ナ 海'],[144.3,45.5,'オホーツク海']];
    container.querySelector('[data-map-seas]').innerHTML=seas.map(([lon,lat,name])=>{const [x,y]=project(lon,lat);return`<text x="${x}" y="${y}" font-size="${view.width/width*(name.length>6?14:18)}" text-anchor="middle">${name}</text>`;}).join('');
    renderMarkers();const scale=scaleForView(view,width);container.querySelector('[data-map-scale-label]').textContent=scale.label;container.querySelector('[data-map-scale-bar]').style.width=scale.pixels+'px';
    container.querySelector('[data-map-region]').textContent=opts.region==='all'?'':` / ${opts.region}`;
    const valid=points.filter(p=>opts.region==='all'||p.region===opts.region).length,total=(opts.castles||[]).filter(p=>opts.region==='all'||p.region===opts.region).length;
    container.querySelector('[data-map-count]').textContent=opts.countLabel||`${valid}${opts.countUnit||'城'}の実位置${valid<total?` · ${total-valid}${opts.countUnit||'城'}は位置を確認中`:''}${terrainHtml?' · 標高データによる陰影':''}`;
    for(const action of ['labels','routes','terrain'])container.querySelector(`[data-map-action="${action}"]`).setAttribute('aria-pressed',String(action==='labels'?labels:action==='routes'?routes:terrain));
    container.querySelector('[data-map-action="terrain"]').disabled=!terrainHtml;
    container.querySelector('[data-map-action="routes"]').hidden=opts.hideRoutes===true;
    container.querySelector('[data-map-action="zoom-out"]').disabled=zoom<=1.001;
    container.querySelector('[data-map-action="zoom-in"]').disabled=zoom>=127.99;
  }
  function schedule(){if(!frame&&!destroyed)frame=raf(render);}
  function resize(){
    if(destroyed)return;const bounds=surface.getBoundingClientRect();if(bounds.width<1||bounds.height<1)return;
    const camera=firstSize?lastView:{x:view.x+view.width/2,y:view.y+view.height/2,zoom:baseView.width/view.width};width=surface.clientWidth||bounds.width;height=surface.clientHeight||bounds.height;baseView=fitBounds(countryBounds,width,height,28);
    container.querySelector('.sg-map').classList.toggle('is-compact',height<420);
    if(camera){const w=baseView.width/clamp(camera.zoom,1,128),h=w*height/width;view=constrain({x:camera.x-w/2,y:camera.y-h/2,width:w,height:h});}
    else{view={...baseView};fit(opts.region!=='all'?'region':['castles','home','selected'].includes(opts.initialView)?opts.initialView:'nation',false);}
    firstSize=false;render();remember();
  }
  function relative(event){const rect=surface.getBoundingClientRect();return[(event.clientX-rect.left)*width/Math.max(1,rect.width),(event.clientY-rect.top)*height/Math.max(1,rect.height)];}
  function pointerDown(event){
    if(event.button!==undefined&&event.button!==0)return;
    if(animation)caf(animation);animation=0;hideTooltip();
    const [x,y]=relative(event),marker=event.target.closest?.('[data-map-marker]');pointers.set(event.pointerId,{x,y,startX:x,startY:y,marker:marker?.dataset.mapMarker});
    if(pointers.size===1){dragged=false;gesture=null;}
    if(pointers.size===2){const [a,b]=[...pointers.values()],center=[(a.x+b.x)/2,(a.y+b.y)/2];gesture={distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),view:{...view},world:[view.x+center[0]/width*view.width,view.y+center[1]/height*view.height]};dragged=true;}
    surface.setPointerCapture?.(event.pointerId);event.preventDefault();
  }
  function pointerMove(event){
    const [x,y]=relative(event),previous=pointers.get(event.pointerId);
    if(!previous){const [lon,lat]=unproject(view.x+x/width*view.width,view.y+y/height*view.height);container.querySelector('[data-map-position]').textContent=`${lat.toFixed(3)}° N  ${lon.toFixed(3)}° E`;return;}
    pointers.set(event.pointerId,{...previous,x,y});
    if(pointers.size>=2&&gesture){const [a,b]=[...pointers.values()],distance=Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),factor=gesture.distance/distance,w=gesture.view.width*factor,h=gesture.view.height*factor,center=[(a.x+b.x)/2,(a.y+b.y)/2];setView({x:gesture.world[0]-center[0]/width*w,y:gesture.world[1]-center[1]/height*h,width:w,height:h});}
    else if(pointers.size===1){if(Math.hypot(x-previous.startX,y-previous.startY)>5)dragged=true;if(dragged){surface.classList.add('is-dragging');setView({...view,x:view.x-(x-previous.x)/width*view.width,y:view.y-(y-previous.y)/height*view.height});}}
    event.preventDefault();
  }
  function pointerUp(event){
    const pointer=pointers.get(event.pointerId);if(!pointer)return;
    const clicked=!dragged&&pointers.size===1&&event.type!=='pointercancel';pointers.delete(event.pointerId);surface.releasePointerCapture?.(event.pointerId);gesture=null;
    if(!pointers.size){surface.classList.remove('is-dragging');clickUntil=Date.now()+350;if(clicked&&pointer.marker)selectMarker(markersByKey.get(pointer.marker)?.marker);}
    else for(const [id,p]of pointers)pointers.set(id,{...p,startX:p.x,startY:p.y});
    event.preventDefault();
  }
  listen(surface,'pointerdown',pointerDown);listen(surface,'pointermove',pointerMove);listen(surface,'pointerup',pointerUp);listen(surface,'pointercancel',pointerUp);
  listen(surface,'wheel',event=>{event.preventDefault();hideTooltip();const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?height:1);zoom(Math.exp(clamp(delta,-400,400)*.0018),relative(event));},{passive:false});
  listen(surface,'keydown',event=>{
    if(event.target.closest?.('[data-map-marker]'))return;
    const pan=70,keys={ArrowLeft:[-pan,0],ArrowRight:[pan,0],ArrowUp:[0,-pan],ArrowDown:[0,pan]};
    if(keys[event.key]){event.preventDefault();const [x,y]=keys[event.key];setView({...view,x:view.x+x/width*view.width,y:view.y+y/height*view.height});}
    else if(['+','=','-','0','Home'].includes(event.key)){event.preventDefault();if(event.key==='Home')fit('home');else if(event.key==='0')fit('nation');else zoom(event.key==='-'?1.45:1/1.45,[width/2,height/2],true);}
  });
  listen(container,'click',event=>{
    const control=event.target.closest?.('[data-map-action]');
    if(control){event.stopPropagation();const action=control.dataset.mapAction;hideTooltip();if(action==='zoom-in')zoom(1/1.55,[width/2,height/2],true);else if(action==='zoom-out')zoom(1.55,[width/2,height/2],true);else if(action==='labels'){labels=!labels;render();remember();}else if(action==='routes'){routes=!routes;render();remember();}else if(action==='terrain'){terrain=!terrain;render();remember();}else fit(action);return;}
    const node=event.target.closest?.('[data-map-marker]');if(node&&(event.detail===0||Date.now()>clickUntil)){event.stopPropagation();selectMarker(markersByKey.get(node.dataset.mapMarker)?.marker);}
  });
  listen(markerLayer,'pointerover',event=>{const node=event.target.closest?.('[data-map-marker]');if(node&&!pointers.size){const entry=markersByKey.get(node.dataset.mapMarker);if(entry)showTooltip(entry.marker);}});
  listen(markerLayer,'focusin',event=>{const entry=markersByKey.get(event.target.dataset.mapMarker);if(entry)showTooltip(entry.marker);});
  listen(markerLayer,'pointerout',event=>{if(!event.relatedTarget||!event.target.closest?.('[data-map-marker]')?.contains(event.relatedTarget))hideTooltip();});
  listen(markerLayer,'focusout',hideTooltip);listen(surface,'pointerleave',()=>{if(!pointers.size)hideTooltip();});
  const resizeObserver=global.ResizeObserver?new global.ResizeObserver(resize):null;if(resizeObserver)resizeObserver.observe(surface);else listen(global,'resize',resize);
  const controller={
    update(next={}){if(destroyed)return;const priorRegion=opts.region;opts={...opts,...next};points=castlePoints(opts.castles,coordinates(),opts);if(opts.region!==priorRegion){region=opts.region;fit(opts.region==='all'?'castles':'region',false);}else schedule();},
    fit,zoomIn:()=>zoom(1/1.55,[width/2,height/2],true),zoomOut:()=>zoom(1.55,[width/2,height/2],true),
    getView:()=>({...view,zoom:baseView.width/view.width}),
    destroy(){if(destroyed)return;remember();destroyed=true;for(const remove of listeners)remove();resizeObserver?.disconnect();if(frame)caf(frame);if(animation)caf(animation);pointers.clear();mounted.delete(container);if(activeKeys.get(key)===controller)activeKeys.delete(key);}
  };
  points=castlePoints(opts.castles,coordinates(),opts);mounted.set(container,controller);activeKeys.set(key,controller);
  if(stored&&stored.region!==opts.region)lastView=null;
  resize();return controller;
}
const api={mount,project,unproject,projectBounds,geometryPath,fitBounds,zoomAt,castlePoints,layoutMarkers,markerPresentation,scaleForView};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
global.SengokuWorldMap=api;
})(typeof window!=='undefined'?window:globalThis);
