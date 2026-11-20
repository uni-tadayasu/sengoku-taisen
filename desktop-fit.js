/* Fit the complete desktop game to the visible browser area, including browser zoom.
 * Layout measurements use offset/scroll sizes, never the already transformed rectangle.
 * Touch devices retain the game's ordinary responsive document flow.
 */
(function(global){
'use strict';
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
function computeFit(naturalWidth,naturalHeight,availableWidth,availableHeight,maxScale=1){
  const width=Math.max(1,Number(naturalWidth)||1),height=Math.max(1,Number(naturalHeight)||1),aw=Math.max(1,Number(availableWidth)||1),ah=Math.max(1,Number(availableHeight)||1);
  const scale=Math.min(maxScale,aw/width,ah/height);
  return{scale,width:width*scale,height:height*scale,left:Math.max(0,(aw-width*scale)/2),top:Math.max(0,(ah-height*scale)/2)};
}
function planViewport(width,height,announcementHeight=0){
  const viewportWidth=Math.max(1,width),viewportHeight=Math.max(1,height),top=clamp(announcementHeight,0,Math.max(0,viewportHeight-1));
  const availableWidth=Math.max(1,viewportWidth-8),availableHeight=Math.max(1,viewportHeight-top-4),layoutWidth=Math.max(1100,Math.min(2000,availableWidth));
  const layoutHeight=Math.max(720,Math.min(1400,availableHeight*layoutWidth/availableWidth));
  return{viewportWidth,viewportHeight,top,availableWidth,availableHeight,layoutWidth,layoutHeight,mapHeight:clamp(layoutHeight-390,280,620),townHeight:clamp(layoutHeight-455,255,470)};
}
const root=global.document?.documentElement,doc=global.document;
let initialized=false,destroyed=false,pending=0,resizeObserver=null,mutationObserver=null,media=null,status={active:false},listeners=[];
const raf=callback=>global.requestAnimationFrame?global.requestAnimationFrame(callback):global.setTimeout(callback,16);
const caf=id=>global.cancelAnimationFrame?global.cancelAnimationFrame(id):global.clearTimeout(id);
function setVar(name,value){if(root.style.getPropertyValue(name)!==value)root.style.setProperty(name,value);}
function setStyle(node,name,value){if(node&&node.style[name]!==value)node.style[name]=value;}
function measure(node){return{width:Math.max(1,node.offsetWidth||0,node.scrollWidth||0),height:Math.max(1,node.offsetHeight||0,node.scrollHeight||0)};}
function listen(node,event,handler,options){if(!node?.addEventListener)return;node.addEventListener(event,handler,options);listeners.push(()=>node.removeEventListener(event,handler,options));}
function applyTransform(node,fit,offsetX=0,offsetY=0){
  setStyle(node,'left',(offsetX+fit.left).toFixed(3)+'px');setStyle(node,'top',(offsetY+fit.top).toFixed(3)+'px');setStyle(node,'transform','scale('+fit.scale.toFixed(7)+')');
}
function fitDialog(dialog,viewport,offsetX=0,offsetY=0){
  if(!dialog.open||dialog.hidden||dialog.classList.contains('game-loading'))return;
  if(dialog.classList.contains('social-dialog')){
    // The finite form has natural height at a stable 940px desktop width. Its
    // history panes remain bounded in CSS. An absolute confirmation must also
    // contribute to the fitted extent so its actions cannot fall below the view.
    const confirmation=dialog.querySelector('.social-confirm-card');
    setStyle(dialog,'minHeight',confirmation?(measure(confirmation).height+48)+'px':'');
    const body=dialog.querySelector('.social-body');if(body?.scrollTop)body.scrollTop=0;
  }
  const actual=measure(dialog),fit=computeFit(actual.width,actual.height,viewport.viewportWidth-24,viewport.viewportHeight-24);
  applyTransform(dialog,fit,offsetX+12,offsetY+12);dialog.dataset.desktopScale=fit.scale.toFixed(3);
}
function update(){
  pending=0;if(destroyed||!root||!doc.body)return;
  const active=Boolean(media?.matches);root.classList.toggle('sengoku-desktop-fit',active);
  if(!active){
    if(status.active){for(const node of doc.querySelectorAll('#app,.launch-card,dialog[data-desktop-scale]')){setStyle(node,'left','');setStyle(node,'top','');setStyle(node,'transform','');if(node.classList?.contains('social-dialog'))setStyle(node,'minHeight','');delete node.dataset.desktopScale;}}
    status={active:false};return;
  }
  const viewport=global.visualViewport,viewportWidth=Math.min(global.innerWidth||Infinity,viewport?.width||Infinity),viewportHeight=Math.min(global.innerHeight||Infinity,viewport?.height||Infinity);
  if(!Number.isFinite(viewportWidth)||!Number.isFinite(viewportHeight)||viewportWidth<=0||viewportHeight<=0)return;
  const offsetX=viewport?.offsetLeft||0,offsetY=viewport?.offsetTop||0,atTitle=doc.body.classList.contains('at-title');
  const announcement=doc.getElementById('announcement-bar'),announcementHeight=!atTitle&&announcement&&!announcement.hidden?announcement.offsetHeight:0;
  const plan=planViewport(viewportWidth,viewportHeight,announcementHeight);
  for(const [name,value]of Object.entries({'viewport-width':plan.viewportWidth,'viewport-height':plan.viewportHeight,'layout-width':plan.layoutWidth,'layout-height':plan.layoutHeight,'map-height':plan.mapHeight,'town-height':plan.townHeight}))setVar('--desktop-'+name,value.toFixed(3)+'px');
  let appFit=null,actual=null;
  const app=doc.getElementById('app');
  if(app&&!atTitle){actual=measure(app);appFit=computeFit(actual.width,actual.height,plan.availableWidth,plan.availableHeight);applyTransform(app,appFit,offsetX+4,offsetY+plan.top+2);app.dataset.desktopScale=appFit.scale.toFixed(3);}
  const launch=doc.querySelector('.launch-card');
  if(launch&&atTitle){const size=measure(launch),fit=computeFit(size.width,size.height,viewportWidth-32,viewportHeight-28);applyTransform(launch,fit,offsetX+16,offsetY+14);}
  for(const dialog of doc.querySelectorAll('dialog[open]'))fitDialog(dialog,plan,offsetX,offsetY);
  status={active:true,...plan,scale:appFit?.scale||null,naturalWidth:actual?.width||null,naturalHeight:actual?.height||null,visibleWidth:appFit?.width||null,visibleHeight:appFit?.height||null,atTitle};
}
function refresh(){if(!root||destroyed)return;if(!initialized)start();if(!pending)pending=raf(update);}
function start(){
  if(initialized||destroyed||!doc.body)return;initialized=true;
  media=global.matchMedia?.('(hover: hover) and (pointer: fine)');
  listen(media,'change',refresh);listen(global,'resize',refresh);listen(global,'orientationchange',refresh);listen(global.visualViewport,'resize',refresh);listen(global.visualViewport,'scroll',refresh);listen(doc,'visibilitychange',refresh);
  listen(doc,'load',event=>{if(event.target?.tagName==='IMG')refresh();},true);
  if(global.ResizeObserver){resizeObserver=new global.ResizeObserver(refresh);for(const node of doc.querySelectorAll('#app,#main,.sidebar,#announcement-bar,.launch-card,#modal-content'))resizeObserver.observe(node);}
  if(global.MutationObserver){mutationObserver=new global.MutationObserver(records=>{
    if(records.some(record=>{
      const node=record.target.nodeType===1?record.target:record.target.parentElement;
      return !node?.closest?.('.sg-map,#calendar,#resources,[data-job-clock],[data-job-progress],#month-countdown,#month-progress');
    }))refresh();
  });mutationObserver.observe(doc.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','hidden','open','data-view']});}
  doc.fonts?.ready?.then(refresh).catch(()=>{});refresh();
}
function destroy(){
  destroyed=true;if(pending)caf(pending);pending=0;for(const remove of listeners)remove();listeners=[];resizeObserver?.disconnect();mutationObserver?.disconnect();root?.classList.remove('sengoku-desktop-fit');
  for(const node of doc?.querySelectorAll?.('#app,.launch-card,dialog[data-desktop-scale]')||[]){setStyle(node,'left','');setStyle(node,'top','');setStyle(node,'transform','');if(node.classList?.contains('social-dialog'))setStyle(node,'minHeight','');delete node.dataset.desktopScale;}
  status={active:false};
}
const api={refresh,getStatus:()=>({...status}),destroy,computeFit,planViewport};
global.SengokuDesktopFit=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
if(doc){if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',start,{once:true});else start();}
})(typeof window!=='undefined'?window:globalThis);
