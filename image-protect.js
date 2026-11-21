/* Discourage the browser's normal image-save gestures. This is not DRM. */
(function(){
'use strict';
const protectedSelector='[role="img"],img,svg image,canvas,.painted-art,.art-frame,.town-art,.town-board,.town-scene,.launch-art,.launch-visual,.launch-image,[data-art-url],[data-art-kind],[data-image-protected]';
const isImage=target=>target?.closest?.(protectedSelector);
function protect(root){if(root?.matches?.('img'))root.draggable=false;root?.querySelectorAll?.('img').forEach(img=>{if(img.getAttribute('draggable')!=='false')img.draggable=false;});}
document.addEventListener('contextmenu',event=>{if(isImage(event.target))event.preventDefault();});
document.addEventListener('dragstart',event=>{if(isImage(event.target))event.preventDefault();});
function init(){protect(document);new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node.nodeType===1)protect(node);}).observe(document.body,{childList:true,subtree:true});}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
