/* One short sound for an intentional interface activation, using the game's
   existing independent effects bus and its volume/call/visibility controls. */
(function(global){
 'use strict';
 const controls='button,a[href],summary,input[type="button"],input[type="submit"],input[type="reset"],input[type="image"],input[type="checkbox"],input[type="radio"],[role="button"],[role="tab"],[role="switch"],[role="checkbox"],[role="radio"],[data-action],[data-view]:not(#main),[data-social],[data-social-tab],[data-field-action],[data-map-action]';
 const customKeys='[role="button"],[role="tab"],[role="switch"],[role="checkbox"],[role="radio"]';
 const excluded='[hidden],[inert],[aria-hidden="true"],[aria-disabled="true"],[data-sound-preview],[data-ui-sound="off"]';
 function create({document:doc=global.document,play=()=>global.SengokuBridge?.playInterfaceSound?.(),now=()=>global.performance?.now?.()??Date.now()}={}){
  const seen=new WeakSet(),removers=[];let disposed=false,held=null,recentCustom=null;
  function target(event){
   // A composed path also covers a future button inside a shadow root; normal
   // SVG icons and text nodes resolve to their one nearest control.
   const path=event.composedPath?.()||[event.target];
   for(const candidate of path){
    const node=candidate?.nodeType===1?candidate:candidate?.parentElement;if(!node?.closest)continue;
    const field=node.closest('input,select,textarea,[contenteditable]');
    if(field){
     const tag=String(field.localName||field.tagName||'').toLowerCase();
     if(tag==='select'||tag==='textarea'||field.hasAttribute('contenteditable')&&field.getAttribute('contenteditable')!=='false'||tag==='input'&&!['button','submit','reset','image','checkbox','radio'].includes((field.getAttribute('type')||'text').toLowerCase()))return null;
    }
    const control=node.closest(controls);
    if(!control)continue;
    if(control.isConnected===false||control.disabled===true||control.hasAttribute('disabled')||control.matches(':disabled,.is-disabled')||control.closest(excluded)||control.closest('dialog')?.open===false)return null;
    return control;
   }
   return null;
  }
  function trusted(event){return !disposed&&doc?.hidden!==true&&event?.isTrusted===true;}
  function sound(event){
   if(seen.has(event))return;seen.add(event);
   try{const result=play('tap');result?.catch?.(()=>{});}catch(_){}
  }
  function click(event){
   if(!trusted(event)||event.button!==undefined&&event.button!==0)return;
   const control=target(event);if(!control)return;
   const keyboard=event.detail===0&&!event.pointerType;
   if(keyboard&&held?.node===control){if(held.sounded||held.repeat){recentCustom=null;return;}held.sounded=true;}
   // Some custom widgets synthesize a click after handling Enter/Space. Their
   // trusted key already sounded; their untrusted .click() is ignored outright.
   if(keyboard&&recentCustom?.node===control&&now()-recentCustom.at<250){recentCustom=null;return;}
   sound(event);
  }
  function keydown(event){
   if(!trusted(event)||event.isComposing||event.ctrlKey||event.altKey||event.metaKey||!['Enter',' '].includes(event.key))return;
   const control=target(event);if(!control)return;
   if(event.repeat){if(held?.node===control)held.repeat=true;return;}
   held={node:control,key:event.key,sounded:false,repeat:false};recentCustom=null;
   // Native controls already generate one trusted click for keyboard use.
   // SVG markers and custom ARIA controls need their existing key activation.
   if(control.matches('button,a[href],input,summary')||!control.matches(customKeys))return;
   held.sounded=true;recentCustom={node:control,at:now()};sound(event);
  }
  function keyup(event){if(trusted(event)&&held?.key===event.key)held=null;}
  function reset(){held=null;recentCustom=null;}
  function pointerdown(event){if(trusted(event))reset();}
  function visibility(){if(doc?.hidden)reset();}
  function listen(type,handler){doc?.addEventListener?.(type,handler,true);removers.push(()=>doc?.removeEventListener?.(type,handler,true));}
  // Capture observes buttons even when their own handler closes/removes a
  // dialog or stops bubbling. It never changes the event, focus or game action.
  for(const [type,handler]of [['click',click],['keydown',keydown],['keyup',keyup],['pointerdown',pointerdown],['visibilitychange',visibility]])listen(type,handler);
  return{dispose(){if(disposed)return;disposed=true;reset();for(const remove of removers)remove();}};
 }
 const api={create};
 if(!global.SengokuUISounds){if(global.document)Object.assign(api,create());global.SengokuUISounds=api;}
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
