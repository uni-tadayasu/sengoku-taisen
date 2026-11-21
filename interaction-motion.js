/* Input feedback only: observes gestures without changing game actions or focus. */
(function (global) {
'use strict';
const doc = global.document;
if (!doc || global.SengokuMotion) return;
const controls = 'button,a[href],summary,input:not([type="hidden"]),select,textarea,[role="button"],[role="tab"],[role="checkbox"],[role="radio"],[data-action],[data-view]:not(#main),[data-social],[data-social-tab],[data-field-action],[data-map-action]';
const excluded = '[inert],[hidden],[aria-hidden="true"],[aria-disabled="true"],[data-layout-handle],.layout-resize-handle,[role="separator"]';
const pressed = new Set(), waves = new Set(), layers = new Map(), entries = new Map(), pending = new Map(), removers = [];
const raf = global.requestAnimationFrame?.bind(global) || (fn => global.setTimeout(fn, 16));
const caf = global.cancelAnimationFrame?.bind(global) || global.clearTimeout.bind(global);
const now = () => global.performance?.now?.() || Date.now();
let gesture = null, keyPress = null, lastPointer = null, lastKey = null, frame = 0, observer, confirmObserver;
let initialized = false, destroyed = false, media, main, loader, lastView, atTitle, loading;
const dialogs = new Map();
function listen(target, type, fn, options) {
  target?.addEventListener?.(type, fn, options);
  removers.push(() => target?.removeEventListener?.(type, fn, options));
}
function reduced() { return Boolean(media?.matches); }
function eligible(el) {
  return Boolean(el?.isConnected && !el.closest(excluded) && !el.matches(':disabled,.is-disabled'));
}
function control(target) {
  const el = (target?.nodeType === 1 ? target : target?.parentElement)?.closest?.(controls);
  return eligible(el) ? el : null;
}
function pressable(el) {
  return !el.matches('select,textarea,input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]),[contenteditable="true"]');
}
function press(el, value) {
  if (!el) return;
  if (value) { pressed.add(el); el.setAttribute('data-ui-pressed', 'true'); }
  else { pressed.delete(el); el.removeAttribute('data-ui-pressed'); }
}
function cancelGesture() { if (gesture) { gesture.cancelled = true; press(gesture.el, false); } }
function removeWave(record) {
  if (!waves.delete(record)) return;
  global.clearTimeout(record.timer); record.animation?.cancel(); record.clip.remove();
  if (!record.layer.childElementCount) { record.layer.remove(); layers.delete(record.host); }
}
function wave(el, point) {
  if (destroyed || reduced() || doc.hidden || !eligible(el) || !pressable(el) || !el.animate) return;
  const rect = el.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return;
  while (waves.size >= 6) removeWave(waves.values().next().value);
  const host = el.closest('dialog[open]') || doc.body;
  let layer = layers.get(host);
  if (!layer?.isConnected) {
    layer = doc.createElement('div'); layer.className = 'ui-motion-layer';
    layer.setAttribute('aria-hidden', 'true'); layer.inert = true; host.append(layer); layers.set(host, layer);
  }
  const origin = layer.getBoundingClientRect(), style = global.getComputedStyle(el);
  const clip = doc.createElement('span'), ink = doc.createElement('span');
  clip.className = 'ui-motion-clip'; ink.className = 'ui-motion-wave';
  const x = Math.max(0, Math.min(rect.width, point ? point.x - rect.left : rect.width / 2));
  const y = Math.max(0, Math.min(rect.height, point ? point.y - rect.top : rect.height / 2));
  const radius = Math.max(12, Math.hypot(Math.max(x, rect.width - x), Math.max(y, rect.height - y)));
  Object.assign(clip.style, { left: `${rect.left - origin.left}px`, top: `${rect.top - origin.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, borderRadius: style.borderRadius });
  clip.style.setProperty('--wave-rgb', style.getPropertyValue('--motion-rgb').trim() || '241, 203, 130');
  Object.assign(ink.style, { left: `${x - radius}px`, top: `${y - radius}px`, width: `${radius * 2}px`, height: `${radius * 2}px` });
  clip.append(ink); layer.append(clip);
  const record = { clip, layer, host, animation: null, timer: 0 }; waves.add(record);
  try {
    record.animation = ink.animate([{ transform: 'scale(.08)', opacity: .9 }, { transform: 'scale(1)', opacity: 0 }], { duration: 430, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'both' });
    record.animation.onfinish = record.animation.oncancel = () => removeWave(record);
    record.timer = global.setTimeout(() => removeWave(record), 700);
  } catch (_) { removeWave(record); }
}
function pointerDown(event) {
  if (event.isPrimary === false) { cancelGesture(); return; }
  if (event.button !== 0) return;
  cancelGesture(); gesture = null;
  const el = control(event.target); if (!el || !pressable(el)) return;
  gesture = { el, id: event.pointerId, x: event.clientX, y: event.clientY, cancelled: false };
  press(el, true);
}
function pointerMove(event) {
  if (gesture?.id === event.pointerId && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 5) cancelGesture();
}
function pointerUp(event) {
  if (!gesture || gesture.id !== event.pointerId) return;
  pointerMove(event);
  const g = gesture; gesture = null; press(g.el, false);
  const rect = g.el.getBoundingClientRect();
  const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
  lastPointer = { el: g.el, at: now(), cancelled: g.cancelled || !inside };
  if (!lastPointer.cancelled) wave(g.el, { x: event.clientX, y: event.clientY });
}
function pointerCancel(event) {
  if (gesture?.id !== event.pointerId) return;
  cancelGesture(); lastPointer = { el: gesture.el, at: now(), cancelled: true }; gesture = null;
}
function keyDown(event) {
  if (event.repeat || event.isComposing || !['Enter', ' '].includes(event.key)) return;
  const el = control(event.target);
  if (!el || !pressable(el) || (event.key === ' ' && el.matches('a[href]'))) return;
  if (keyPress) press(keyPress.el, false);
  keyPress = { el, key: event.key, clicked: false }; press(el, true);
}
function keyUp(event) {
  if (!keyPress || event.key !== keyPress.key) return;
  const key = keyPress; keyPress = null; press(key.el, false);
  if (!key.clicked) wave(key.el);
  lastKey = { el: key.el, at: now() };
}
function schedule() { if (!frame && !destroyed) frame = raf(flush); }
function queue(target, mode = 'children') { if (!destroyed && !reduced()) { pending.set(target, mode); schedule(); } }
function visible(el) {
  if (!eligible(el) || el.closest('dialog:not([open])')) return false;
  const r = el.getBoundingClientRect(), s = global.getComputedStyle(el);
  return r.width > 1 && r.height > 1 && r.bottom > 0 && r.right > 0 && r.top < global.innerHeight && r.left < global.innerWidth && s.visibility !== 'hidden' && s.display !== 'none';
}
function removeEntry(el, record) {
  if (entries.get(el) !== record) return;
  entries.delete(el); global.clearTimeout(record.timer); record.animation?.cancel();
}
function enter(el, index) {
  if (!el.animate || !visible(el)) return;
  if (entries.has(el)) removeEntry(el, entries.get(el));
  const style = global.getComputedStyle(el), opacity = Number(style.opacity) || 1;
  const from = { opacity: opacity * .38 }, to = { opacity };
  const safe = el.matches('.page-heading,.realtime-strip,.toolbar,.section-heading,.hero-copy,.hero-figure,.modal-header,.modal-footer,.social-header,.social-tabs,.social-footer');
  if (safe && style.transform === 'none' && !['fixed', 'absolute', 'sticky'].includes(style.position) && (!style.translate || ['none', '0px', '0px 0px'].includes(style.translate))) { from.translate = '0 8px'; to.translate = '0 0'; }
  const record = { animation: null, timer: 0 }; entries.set(el, record);
  try {
    record.animation = el.animate([from, to], { duration: 300, delay: Math.min(index, 7) * 24, easing: 'cubic-bezier(.2,.75,.25,1)', fill: 'backwards' });
    record.animation.onfinish = record.animation.oncancel = () => removeEntry(el, record);
    record.timer = global.setTimeout(() => removeEntry(el, record), 650);
  } catch (_) { removeEntry(el, record); }
}
function flush() {
  frame = 0;
  if (destroyed || reduced() || doc.hidden) { pending.clear(); return; }
  if (doc.body.classList.contains('is-loading') || loader?.open) return;
  const nodes = new Set();
  for (const [target, mode] of pending) {
    const root = typeof target === 'string' ? doc.querySelector(target) : target;
    if (!root || !visible(root)) continue;
    const candidates = mode === 'single' ? [root] : mode === 'dialog' ? root.querySelectorAll('#modal-content > *,:scope > .social-header,:scope > .social-tabs,:scope > .social-body,:scope > .social-footer') : root.children;
    for (const el of candidates) if (!el.matches('summary,.ui-motion-layer,script,style') && visible(el)) { nodes.add(el); if (nodes.size >= 8) break; }
    if (nodes.size >= 8) break;
  }
  pending.clear(); let index = 0;
  for (const el of nodes) if (![...nodes].some(parent => parent !== el && parent.contains(el))) enter(el, index++);
}
function queueAction(el) {
  const action = el.dataset.action, field = el.dataset.fieldAction, social = el.dataset.social;
  if (el.dataset.socialTab && el.getAttribute('aria-selected') !== 'true') queue('#social-dialog-body');
  if (['admin-section', 'friend-select', 'mail-open', 'mail-back', 'recovery-clear'].includes(social)) queue('#social-dialog-body');
  if (['tab', 'select-player', 'report', 'confirm-attack', 'cancel-attack', 'relationship-page', 'battle-page'].includes(field)) queue('[data-field-detail]');
  if (['page', 'clear-castle'].includes(field)) queue('[data-field-players]');
  if (['officer-section', 'open-gacha'].includes(action)) queue('#main');
  const result = { 'officer-page': '#officer-results', 'officer-filter': '#officer-results', 'crest-page': '#crest-results', 'facility-page': '#facility-results', 'territory-page': '#territory-results', 'quest-page': '.council-grid', 'log-page': '.council-grid' }[action];
  if (result) queue(result);
  if (['officer-rank-detail', 'choice-page', 'music-page', 'gacha-odds-page', 'art-level-step'].includes(action)) queue('#modal .modal-body');
}
function click(event) {
  const el = control(event.target); if (!el) return;
  const pointerDuplicate = event.detail !== 0 && lastPointer?.el === el && now() - lastPointer.at < 800;
  const keyDuplicate = event.detail === 0 && lastKey?.el === el && now() - lastKey.at < 350;
  if (!pointerDuplicate && !keyDuplicate) wave(el, event.detail && Number.isFinite(event.clientX) ? { x: event.clientX, y: event.clientY } : null);
  if (keyPress?.el === el) keyPress.clicked = true;
  queueAction(el);
}
function change(event) {
  const el = control(event.target); if (!el) return;
  if (['officer-rank', 'officer-clan', 'officer-sort'].includes(el.id)) queue('#officer-results');
  if (el.id === 'facility-category') queue('#facility-results');
  if (el.id === 'map-region') queue('#territory-results');
  if (el.dataset.fieldInput === 'filter') queue('[data-field-players]');
}
function checkState() {
  if (main?.dataset.view !== lastView) { lastView = main?.dataset.view; queue('#main'); }
  const title = doc.body.classList.contains('at-title');
  if (title !== atTitle) { atTitle = title; queue(title ? '#launch-screen' : '#main'); }
  const busy = doc.body.classList.contains('is-loading') || Boolean(loader?.open);
  if (loading && !busy) schedule(); loading = busy;
  for (const [dialog, wasOpen] of dialogs) {
    if (dialog.open && !wasOpen) queue(dialog, 'dialog');
    if (!dialog.open && wasOpen) for (const record of [...waves]) if (record.host === dialog) removeWave(record);
    dialogs.set(dialog, dialog.open);
  }
}
function clear() {
  cancelGesture(); gesture = null;
  if (keyPress) press(keyPress.el, false); keyPress = null; lastPointer = lastKey = null;
  for (const el of [...pressed]) press(el, false);
  for (const record of [...waves]) removeWave(record);
  for (const [el, record] of [...entries]) removeEntry(el, record);
  pending.clear(); if (frame) caf(frame); frame = 0;
}
function init() {
  if (initialized || destroyed || !doc.body) return; initialized = true;
  media = global.matchMedia?.('(prefers-reduced-motion: reduce)');
  main = doc.getElementById('main'); loader = doc.getElementById('game-loading'); lastView = main?.dataset.view;
  atTitle = doc.body.classList.contains('at-title'); loading = doc.body.classList.contains('is-loading') || Boolean(loader?.open);
  for (const [type, fn] of Object.entries({ pointerdown: pointerDown, pointermove: pointerMove, pointerup: pointerUp, pointercancel: pointerCancel, lostpointercapture: pointerCancel, click, keydown: keyDown, keyup: keyUp, change })) listen(doc, type, fn, { capture: true, passive: true });
  listen(doc, 'toggle', event => { if (event.target.tagName === 'DETAILS' && event.target.open) queue(event.target); }, true);
  listen(global, 'blur', clear); listen(global, 'pagehide', clear);
  listen(doc, 'visibilitychange', () => { if (doc.hidden) clear(); });
  if (media?.addEventListener) listen(media, 'change', clear);
  else if (media?.addListener) { media.addListener(clear); removers.push(() => media.removeListener(clear)); }
  if (global.MutationObserver) {
    observer = new global.MutationObserver(checkState);
    observer.observe(doc.body, { attributes: true, attributeFilter: ['class'] });
    if (main) observer.observe(main, { attributes: true, attributeFilter: ['data-view'] });
    if (loader) observer.observe(loader, { attributes: true, attributeFilter: ['open', 'hidden'] });
    for (const dialog of doc.querySelectorAll('dialog:not(#game-loading)')) { dialogs.set(dialog, dialog.open); observer.observe(dialog, { attributes: true, attributeFilter: ['open'] }); }
    const host = doc.getElementById('social-confirm-host');
    if (host) { confirmObserver = new global.MutationObserver(() => { const card = host.querySelector('.social-confirm-card'); if (card) queue(card, 'single'); }); confirmObserver.observe(host, { childList: true }); }
  }
  if (doc.body.dataset.page) queue('.hero');
}
function destroy() { if (destroyed) return; destroyed = true; clear(); observer?.disconnect(); confirmObserver?.disconnect(); for (const remove of removers.splice(0)) remove(); }
global.SengokuMotion = { destroy };
if (doc.readyState === 'loading') listen(doc, 'DOMContentLoaded', init, { once: true }); else init();
})(window);
