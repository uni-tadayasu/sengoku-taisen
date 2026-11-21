/* The viewport is a layout boundary, never a scale factor for the interface.
 * Desktop retains its command deck and scrolls only content panes. Touch devices
 * use document flow, including tablets with an attached keyboard or mouse. */
(function(global){
'use strict';
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
// Compatibility helper for fitting illustrations. The UI itself never uses it.
function computeFit(naturalWidth,naturalHeight,availableWidth,availableHeight,maxScale=1){
  const width=Math.max(1,Number(naturalWidth)||1),height=Math.max(1,Number(naturalHeight)||1),aw=Math.max(1,Number(availableWidth)||1),ah=Math.max(1,Number(availableHeight)||1);
  const scale=Math.min(maxScale,aw/width,ah/height);
  return{scale,width:width*scale,height:height*scale,left:Math.max(0,(aw-width*scale)/2),top:Math.max(0,(ah-height*scale)/2)};
}
function planViewport(width,height,announcementHeight=0){
  const viewportWidth=Math.max(1,Number(width)||1),viewportHeight=Math.max(1,Number(height)||1),top=clamp(Number(announcementHeight)||0,0,Math.max(0,viewportHeight-1));
  const availableWidth=viewportWidth,availableHeight=Math.max(1,viewportHeight-top);
  return{viewportWidth,viewportHeight,top,availableWidth,availableHeight,layoutWidth:availableWidth,layoutHeight:availableHeight,mapHeight:clamp(availableHeight-370,300,850),townHeight:clamp(availableHeight-355,240,680)};
}
function desktopMode(finePointer,touchPoints=0,coarsePointer=false){return Boolean(finePointer)&&!(Number(touchPoints)>0||coarsePointer);}
const root=global.document?.documentElement,doc=global.document;
let initialized=false,destroyed=false,pending=0,resizeObserver=null,mutationObserver=null,media=null,coarseMedia=null,status={active:false,mode:'flow',scale:1},listeners=[];
const raf=callback=>global.requestAnimationFrame?global.requestAnimationFrame(callback):global.setTimeout(callback,16);
const caf=id=>global.cancelAnimationFrame?global.cancelAnimationFrame(id):global.clearTimeout(id);
function setVar(name,value){if(root.style.getPropertyValue(name)!==value)root.style.setProperty(name,value);}
function setStyle(node,name,value){if(node&&node.style[name]!==value)node.style[name]=value;}
function listen(node,event,handler,options){if(!node?.addEventListener)return;node.addEventListener(event,handler,options);listeners.push(()=>node.removeEventListener(event,handler,options));}
function clearLegacyGeometry(node){
  // Remove old whole-screen scaling during a live update or input-mode switch.
  for(const name of ['left','top','transform','minHeight'])setStyle(node,name,'');
  if(node?.dataset)delete node.dataset.desktopScale;
}
function update(){
  pending=0;if(destroyed||!root||!doc.body)return;
  const active=desktopMode(media?.matches,global.navigator?.maxTouchPoints,coarseMedia?.matches);
  root.classList.toggle('sengoku-desktop-fit',active);
  const viewport=global.visualViewport,viewportWidth=Math.min(global.innerWidth||Infinity,viewport?.width||Infinity),viewportHeight=Math.min(global.innerHeight||Infinity,viewport?.height||Infinity);
  if(!Number.isFinite(viewportWidth)||!Number.isFinite(viewportHeight)||viewportWidth<=0||viewportHeight<=0)return;
  const offsetX=viewport?.offsetLeft||0,offsetY=viewport?.offsetTop||0,atTitle=doc.body.classList.contains('at-title');
  const announcement=doc.getElementById('announcement-bar'),announcementHeight=!atTitle&&announcement&&!announcement.hidden?announcement.offsetHeight:0;
  const plan=planViewport(viewportWidth,viewportHeight,announcementHeight);
  for(const [name,value]of Object.entries({'viewport-width':plan.viewportWidth,'viewport-height':plan.viewportHeight,'layout-width':plan.layoutWidth,'layout-height':plan.layoutHeight,'map-height':plan.mapHeight,'town-height':plan.townHeight,'offset-left':offsetX,'offset-top':offsetY+plan.top}))setVar('--desktop-'+name,value.toFixed(3)+'px');
  setVar('--visible-height',plan.viewportHeight.toFixed(3)+'px');
  for(const node of doc.querySelectorAll('#app,.launch-card,dialog:not(.game-loading)'))clearLegacyGeometry(node);
  // Sticky touch headers remain in document flow. Only their measured height
  // is needed to keep focus/anchor scrolling below the visible information.
  const touchHeader=!active&&!atTitle?doc.querySelector?.('#app .topbar'):null;
  const touchHeaderHeight=Math.max(0,Number(touchHeader?.getBoundingClientRect?.().height)||0);
  setVar('--touch-header-height',touchHeaderHeight.toFixed(3)+'px');
  const app=doc.getElementById('app');if(active&&app)app.dataset.desktopScale='1.000';
  for(const dialog of doc.querySelectorAll('dialog[open]:not(.game-loading)'))if(active)dialog.dataset.desktopScale='1.000';
  status={active,mode:active?'desktop':'flow',...plan,scale:1,naturalWidth:plan.layoutWidth,naturalHeight:plan.layoutHeight,visibleWidth:plan.availableWidth,visibleHeight:plan.availableHeight,atTitle};
}
function refresh(){if(!root||destroyed)return;if(!initialized)start();if(!pending)pending=raf(update);}
function start(){
  if(initialized||destroyed||!doc.body)return;initialized=true;
  media=global.matchMedia?.('(hover: hover) and (pointer: fine)');coarseMedia=global.matchMedia?.('(any-pointer: coarse)');
  listen(media,'change',refresh);listen(coarseMedia,'change',refresh);listen(global,'resize',refresh);listen(global,'orientationchange',refresh);listen(global.visualViewport,'resize',refresh);listen(global.visualViewport,'scroll',refresh);listen(doc,'visibilitychange',refresh);listen(doc,'fullscreenchange',refresh);
  if(global.ResizeObserver){resizeObserver=new global.ResizeObserver(refresh);for(const node of doc.querySelectorAll('#announcement-bar,.topbar'))resizeObserver.observe(node);}
  if(global.MutationObserver){mutationObserver=new global.MutationObserver(records=>{
    if(records.some(record=>{
      const node=record.target.nodeType===1?record.target:record.target.parentElement;
      return !node?.closest?.('.sg-map,#calendar,#resources,#touch-header-status,[data-job-clock],[data-job-progress],#month-countdown,#month-progress');
    }))refresh();
  });mutationObserver.observe(doc.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','hidden','open','data-view']});}
  doc.fonts?.ready?.then(refresh).catch(()=>{});refresh();
}
function destroy(){
  destroyed=true;if(pending)caf(pending);pending=0;for(const remove of listeners)remove();listeners=[];resizeObserver?.disconnect();mutationObserver?.disconnect();root?.classList.remove('sengoku-desktop-fit');
  for(const node of doc?.querySelectorAll?.('#app,.launch-card,dialog[data-desktop-scale]')||[])clearLegacyGeometry(node);
  if(root)setVar('--touch-header-height','0px');
  status={active:false,mode:'flow',scale:1};
}
const api={refresh,getStatus:()=>({...status}),destroy,computeFit,planViewport,desktopMode};
global.SengokuDesktopFit=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
if(doc){if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',start,{once:true});else start();}
})(typeof window!=='undefined'?window:globalThis);
