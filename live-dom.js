/* Live controls retain their nodes between clock ticks; text updates are not new controls. */
(function(global){
 'use strict';
 const selectors=[
  '[data-action]','[data-recruit-reason]','[data-branch-parent]',
  '#new-start-castle,#new-difficulty,.clan-choice,[data-action="choose-residency-mode"],[data-action="residency-retry"]',
  '[data-magatama-balance]','[data-cost-resource]','[data-branch-commands]',
  '[data-army-health-stat]','[data-army-health-stat-bar]','[data-job-clock]','[data-job-progress]'
 ];
 const dependencies=selector=>new Set([
  ...Array.from(selector.matchAll(/\[([\w-]+)/g),match=>match[1]),
  ...(selector.includes('#')?['id']:[]),...(selector.includes('.')?['class']:[])
 ]);
 function create(document,Observer=global.MutationObserver){
  const cache=new Map(),supported=new Map(selectors.map(selector=>[selector,dependencies(selector)]));
  let disposed=false;
  const belongs=node=>node?.isConnected!==false&&(document.body?.contains?.(node)??true);
  const matches=(node,selector)=>node?.nodeType===1&&node.matches?.(selector);
  function apply(records){
   if(disposed||!cache.size||!records?.length)return;
   const added=new Set(),attributes=new Map();let removed=false;
   for(const record of records){
    if(record.type==='attributes'){
     let names=attributes.get(record.target);if(!names){names=new Set();attributes.set(record.target,names);}names.add(record.attributeName);
    }else{
     for(const node of record.addedNodes||[])if(node.nodeType===1)added.add(node);
     if(Array.from(record.removedNodes||[]).some(node=>node.nodeType===1))removed=true;
    }
   }
   // A whole view may arrive as several nested records in one task. Visit its
   // outer tree once, while retaining connected nodes moved by StableDOM.
   const roots=[];
   for(const node of added){
    if(!belongs(node))continue;
    // A long list can contribute thousands of sibling mutation records. Walk
    // each short ancestor chain instead of comparing every inserted subtree
    // against every other subtree. Descendants of another insertion are still
    // queried exactly once through that outer insertion.
    let nested=false;for(let parent=node.parentNode;parent;parent=parent.parentNode)if(added.has(parent)){nested=true;break;}
    if(!nested)roots.push(node);
   }
   for(const [selector,nodes]of cache){
    if(removed)for(const node of nodes)if(!belongs(node))nodes.delete(node);
    for(const root of roots){if(matches(root,selector))nodes.add(root);for(const node of root.querySelectorAll?.(selector)||[])nodes.add(node);}
    const needed=supported.get(selector);
    for(const [node,names]of attributes)if(Array.from(names).some(name=>needed.has(name))){
     if(belongs(node)&&matches(node,selector))nodes.add(node);else nodes.delete(node);
    }
   }
  }
  const observer=typeof Observer==='function'?new Observer(apply):null;
  observer?.observe(document.body||document,{subtree:true,childList:true,attributes:true,attributeFilter:[...new Set([...supported.values()].flatMap(names=>[...names]))]});
  return {
   nodes(selector){
    if(disposed||!observer||!supported.has(selector))return Array.from(document.querySelectorAll(selector));
    // A render and its control refresh can run in the same JS task, before
    // MutationObserver callbacks. Consume those records synchronously as well.
    apply(observer.takeRecords?.()||[]);
    if(!cache.has(selector))cache.set(selector,new Set(document.querySelectorAll(selector)));
    return Array.from(cache.get(selector));
   },
   dispose(){disposed=true;observer?.disconnect();cache.clear();}
  };
 }
 const api={create};
 if(global.document)Object.assign(api,create(global.document));
 global.SengokuLiveDOM=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
