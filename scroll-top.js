/* Return the visible game content to its beginning, including the PC town pane. */
(function(global){
 'use strict';
 const doc=global.document;if(!doc||global.SengokuScrollTop)return;
 let button=null,frame=0,observer=null,started=false;
 const removers=[],threshold=240,selectors=['#main','#town-console','#castle-detail'];
 const listen=(node,type,fn,options)=>{node?.addEventListener?.(type,fn,options);removers.push(()=>node?.removeEventListener?.(type,fn,options));};
 const raf=global.requestAnimationFrame?.bind(global)||((fn)=>global.setTimeout(fn,16));
 const caf=global.cancelAnimationFrame?.bind(global)||global.clearTimeout.bind(global);
 function blocked(){return doc.hidden||global.SENGOKU_AT_TITLE===true||doc.body?.classList.contains('at-title')||Boolean(doc.querySelector('dialog[open]'));}
 function targets(){
  const roots=[doc.scrollingElement,...selectors.map(selector=>doc.querySelector(selector))];
  return [...new Set(roots.filter(Boolean))].filter(node=>node===doc.scrollingElement||node.isConnected&&node.clientHeight>0&&node.getClientRects().length>0);
 }
 function update(){
  frame=0;if(!button)return;
  button.hidden=blocked()||!targets().some(node=>node.scrollTop>=threshold);
  if(button.hidden)return;
  // Only avoid controls which actually overlap this corner. The desktop
  // sidebar is on the opposite side; the touch dock spans the whole width.
  const height=global.innerHeight,width=global.innerWidth;
  let bottom=20;
  for(const selector of ['.sidebar-bottom','.social-launcher','.game-footer']){
   const node=doc.querySelector(selector);if(!node||!node.getClientRects().length)continue;
   const rect=node.getBoundingClientRect();
   if(rect.right>width-180&&rect.left<width-16&&rect.top>=height/2&&rect.top<height&&rect.bottom>height-180)bottom=Math.max(bottom,height-rect.top+12);
  }
  button.style.setProperty('--scroll-top-bottom',Math.ceil(bottom)+'px');
 }
 function refresh(){if(started&&!frame)frame=raf(update);}
 function toTop(){
  if(!button||button.hidden||blocked())return;
  const behavior=global.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'instant':'smooth';
  for(const node of targets()){
   if(node.scrollTop<=0)continue;
   if(node===doc.scrollingElement)global.scrollTo({top:0,left:global.scrollX||0,behavior});
   else if(node.scrollTo)node.scrollTo({top:0,left:node.scrollLeft||0,behavior});
   else node.scrollTop=0;
  }
  doc.querySelector('#main')?.focus?.({preventScroll:true});refresh();
 }
 function start(){
  if(started||!doc.body)return;started=true;
  button=doc.createElement('button');button.type='button';button.id='scroll-to-top';button.className='scroll-top-button';button.hidden=true;
  button.setAttribute('aria-label','一番上に戻る');button.setAttribute('aria-controls','main');
  button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14M12 20V8m-6 6 6-6 6 6"/></svg><span>一番上へ</span>';
  doc.body.appendChild(button);listen(button,'click',toTop);
  listen(doc,'scroll',refresh,{capture:true,passive:true});listen(doc,'click',refresh);listen(doc,'visibilitychange',refresh);
  listen(global,'resize',refresh,{passive:true});listen(global,'pageshow',refresh);listen(global.visualViewport,'resize',refresh,{passive:true});
  if(global.MutationObserver){observer=new global.MutationObserver(records=>{if(records.some(record=>record.type==='attributes'||record.target===doc.body||record.target===doc.querySelector('#main')))refresh();});observer.observe(doc.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open']});}
  refresh();
 }
 function destroy(){started=false;if(frame)caf(frame);frame=0;observer?.disconnect();observer=null;for(const remove of removers.splice(0))remove();button?.remove();button=null;}
 global.SengokuScrollTop={refresh,destroy};
 if(doc.readyState==='loading')listen(doc,'DOMContentLoaded',start,{once:true});else start();
})(window);
