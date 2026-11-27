/* One short sound for an intentional interface activation, using the game's
   existing independent effects bus and its volume/call/visibility controls. */
(function(global){
 'use strict';
 const controls='button,a[href],summary,input[type="button"],input[type="submit"],input[type="reset"],input[type="image"],input[type="checkbox"],input[type="radio"],[role="button"],[role="tab"],[role="switch"],[role="checkbox"],[role="radio"],[data-action],[data-view]:not(#main),[data-social],[data-social-tab],[data-field-action],[data-map-action]';
 const customKeys='[role="button"],[role="tab"],[role="switch"],[role="checkbox"],[role="radio"]';
 const excluded='[hidden],[inert],[aria-hidden="true"],[aria-disabled="true"],[data-sound-preview],[data-ui-sound="off"]';
 // Final mutations announce their actual receipt or rejection. Their controls
 // delegate to the result path so an asynchronous operation doesn't sound twice.
 const resultAction=/^(?:upgrade(?:-castle|-branch|-branch-facility)?|research|claim-quest|draw-officers|gacha-skip|recruit-(?:officer|troops)|(?:assign|remove)-(?:army|governor|branch-commander)|auto-(?:governors|assign-branch-commanders)|army-plan-apply|train|scout|diplomacy|attack(?:-branch)?|build-branch(?:-facility)?|repair-branch)$/;
 const commandAttribute=/^data-(?:action|social|tutorial|trade|alliance|cq|hints|events|moderation|garrison|(?:court|field|covert|roaming|rm|chat|letter|progress|walking|events|moderation|strategy|voice)-action)$/;
 const toolCommand=/^data-(?:budget|command|travel|records|watch|defense|cq|filter|navigation|premium|alliance|garrison)-([a-z-]+)$/;
 const routes=[
  ['close',/(^|-)(back|close|cancel|dismiss|pause|logout)(-|$)/],
  ['map',/(^|-)(map|castle-focus|targets)(-|$)|^select-castle$/],
  ['battle',/battle|retaliat|^prepare-attack$|^attack$/],
  ['dispatch',/dispatch|marches|recall|reinforce|transport|^launch$/],
  ['assign',/appoint|governor|assignment|pick-army|select-office|army-plan-lock/],
  ['recruit',/recruit|gacha|hire/],
  ['build',/^building$|^level-guide(?:-castle)?$|^facility-(?:refresh|layout)$|^build-/],
  ['trade',/trade|treasury|withdraw|^exchange$/],
  ['message',/letter|mail|thread|^reply$|mention|friend-request|^send$|^invite$/],
  ['adjust',/volume|^art-level-step$|^branch-troop-max$|^adjust$/],
  ['toggle',/sound|music|fullscreen|toggle|^play-track$|^filter-pin$/],
  ['navigate',/(^|-)(page|next|previous|more|older|latest|section|tab|inbox|home|guide|tutorial|go|screen|view)(-|$)|^navigate$/],
  ['select',/(^|-)(select|choose|filter|choice|target|tactic|destination|recipient|reset|balanced|max)(-|$)|^catalog-state$/],
  ['confirm',/(^|-)(confirm|apply|commit|submit|accept|approve|start|save|export|import|sync)(-|$)/],
  ['open',/open|detail|^officer$|settings|help|hints|about|planner|preview|premium|community|new-game|walking|progress|info|^strategy$/]
 ];
 function interaction(control){
  const data=control.dataset,explicit=data.uiSound;
  if(explicit)return explicit;
  const action=data.action||'';
  if(resultAction.test(action)||data.roamingAction==='submit'||data.covertAction==='submit'||data.social==='mail-claim'||['confirm','retry'].includes(data.trade)||['claim','retry','exchange'].includes(data.progressAction)||control.matches('[type="submit"]')&&control.closest('#social-chat-form'))return null;
  if(control.matches('.sg-map-marker[data-map-marker]'))return null; // Hit selection completes in the map's gesture handler.
  if(control.matches('[data-map-action],[data-cq-castle],.castle-node,[data-watch-visit]'))return 'map';
  if(control.matches('[data-view],[data-navigation-target],[data-navigation-help],[data-social-tab],[role="tab"]'))return 'navigate';
  if(control.matches('#launch-enter,.navigation-menu-trigger'))return 'open';
  if(control.matches('.navigation-close,.modal-close'))return 'close';
  if(control.matches('summary'))return control.parentElement?.open?'close':'open';
  if(control.matches('[type="range"]'))return 'adjust';
  if(control.matches('select,[type="radio"],[role="radio"],[data-officer-filter],[data-premium-preview],[data-premium-filter]'))return 'select';
  if(control.matches('[type="checkbox"],[role="checkbox"],[role="switch"],.ledger-disclosure,[data-navigation-favorite],[data-navigation-pin]'))return 'toggle';
  const attributes=Array.from(control.attributes||[]);
  const tool=attributes.find(attr=>toolCommand.test(attr.name));
  const command=action||attributes.find(attr=>commandAttribute.test(attr.name))?.value||tool?.name.match(toolCommand)?.[1]||'';
  const kind=routes.find(([,pattern])=>pattern.test(command))?.[0];
  if(kind)return kind;
  if(control.matches('a[href]'))return 'navigate';
  if(data.trade!==undefined)return 'trade';
  if(data.letterAction!==undefined||data.chatAction!==undefined)return 'message';
  if(control.matches('[type="submit"]')){
   if(control.closest('[data-letter-form],[data-court-form="chat"],[data-court-form="reply"],[data-court-form="audience"],[data-alliance-form="invite"]'))return 'message';
   if(control.closest('[data-trade-form]'))return 'trade';
   if(control.closest('[data-alliance-form="assignment"]'))return 'assign';
   if(control.closest('[data-alliance-form="reinforce"]'))return 'dispatch';
   return 'confirm';
  }
  if(control.hasAttribute('aria-expanded'))return control.getAttribute('aria-expanded')==='true'?'close':'open';
  return control.hasAttribute('aria-pressed')?'toggle':'tap';
 }
 function create({document:doc=global.document,play=type=>global.SengokuBridge?.playInterfaceSound?.(type),now=()=>global.performance?.now?.()??Date.now()}={}){
  const seen=new WeakSet(),removers=[];let disposed=false,held=null,recentCustom=null,changing=null,wheel=null;
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
    if(!available(control))return null;
    return control;
   }
   return null;
  }
  function available(node){return node?.isConnected!==false&&!node.disabled&&!node.hasAttribute('disabled')&&!node.matches(':disabled,.is-disabled')&&!node.closest(excluded)&&node.closest('dialog')?.open!==false;}
  function trusted(event){return !disposed&&doc?.hidden!==true&&event?.isTrusted===true&&!event.isComposing&&event.keyCode!==229;}
  function sound(event,type){
   if(!type||seen.has(event))return;seen.add(event);
   try{const result=play(type);result?.catch?.(()=>{});}catch(_){}
  }
  function click(event){
   if(!trusted(event)||event.button!==undefined&&event.button!==0)return;
   const control=target(event);if(!control)return;
   const keyboard=event.detail===0&&!event.pointerType;
   if(keyboard&&held?.node===control){if(held.sounded||held.repeat){recentCustom=null;return;}held.sounded=true;}
   // Some custom widgets synthesize a click after handling Enter/Space. Their
   // trusted key already sounded; their untrusted .click() is ignored outright.
   if(keyboard&&recentCustom?.node===control&&now()-recentCustom.at<250){recentCustom=null;return;}
   sound(event,interaction(control));
  }
  function keydown(event){
   if(!trusted(event)||event.ctrlKey||event.altKey||event.metaKey)return;
   const field=event.target?.closest?.('select,input[type="range"]');
   if(field&&available(field)&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','PageUp','PageDown','Home','End'].includes(event.key)){
    if(!event.repeat)changing={node:field,key:event.key,changed:false};return;
   }
   const control=target(event);if(!control)return;
   if(control.matches('[role="tab"]')&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){if(!event.repeat)sound(event,'navigate');return;}
   if(!['Enter',' '].includes(event.key))return;
   if(event.repeat){if(held?.node===control)held.repeat=true;return;}
   held={node:control,key:event.key,sounded:false,repeat:false};recentCustom=null;
   // Native controls already generate one trusted click for keyboard use.
   // SVG markers and custom ARIA controls need their existing key activation.
   if(control.matches('button,a[href],input,summary')||!control.matches(customKeys))return;
   held.sounded=true;recentCustom={node:control,at:now()};sound(event,interaction(control));
  }
  function change(event){
   const field=event.target;
   if(!trusted(event)||!field?.matches?.('select,input[type="range"]')||!available(field))return;
   if(changing?.node===field){changing.changed=true;return;}
   sound(event,interaction(field));
  }
  function keyup(event){
   if(!trusted(event))return;
   if(changing?.key===event.key){if(changing.changed&&available(changing.node))sound(event,interaction(changing.node));changing=null;}
   if(held?.key===event.key)held=null;
  }
  function shortcut(event,type){if(trusted(event)&&!event.repeat)sound(event,type);}
  function mapGesture(event,node){
   if(!trusted(event)||!node||!available(node)||event.repeat||event.altKey||event.metaKey)return;
   if(event.type==='wheel'){const at=now(),same=wheel?.node===node&&at-wheel.at<200;wheel={node,at};if(same)return;}
   sound(event,'map');
  }
  function reset(){held=null;recentCustom=null;changing=null;wheel=null;}
  function pointerdown(event){if(trusted(event))reset();}
  function visibility(){if(doc?.hidden)reset();}
  function cancel(event){
   const dialog=event.target;
   if(trusted(event)&&dialog?.matches?.('dialog[open]')&&!dialog.matches('#game-loading')&&!dialog.querySelector('[data-action="gacha-skip"]')&&available(dialog))sound(event,'close');
  }
  function listen(type,handler){doc?.addEventListener?.(type,handler,true);removers.push(()=>doc?.removeEventListener?.(type,handler,true));}
  // Capture observes buttons even when their own handler closes/removes a
  // dialog or stops bubbling. It never changes the event, focus or game action.
  for(const [type,handler]of [['click',click],['keydown',keydown],['keyup',keyup],['change',change],['cancel',cancel],['pointerdown',pointerdown],['visibilitychange',visibility]])listen(type,handler);
  return{mapGesture,shortcut,dispose(){if(disposed)return;disposed=true;reset();for(const remove of removers)remove();}};
 }
 const api={create};
 if(!global.SengokuUISounds){if(global.document)Object.assign(api,create());global.SengokuUISounds=api;}
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
