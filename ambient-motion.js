/* Quiet continuous decoration. CSS owns every animation; this controller only
   admits visible surfaces after DOM/viewport changes, never on a frame loop. */
(function (global) {
  'use strict';
  const doc = global.document, root = doc?.documentElement;
  if (!root || global.SengokuAmbientMotion) return;

  const marker = 'data-ambient-visible', limit = 1000;
  const shells = '.edition-mast,.edition-cover,.edition-story,.edition-foot,.edition-print,.brand,.brand-crest,.clan-panel,.chronicle-rail,.chronicle-ledger,.page-heading,.town-scene-heading,.town-castle-heading,.roaming-heading,.court-heading,.covert-heading,.chapter-symbol,.chapter-copy,.town-scene-board,.sg-map,dialog[open],.modal-header,.modal-footer,.social-header,.social-footer,.navigation-dialog-header,.progress-header';
  const controls = 'button,summary,a.button,a.action-link,a.nav-play,.launch-guide-nav a,input:not([type="hidden"]):not([type="range"]):not([type="checkbox"]):not([type="radio"]),select,textarea,[role="button"],[role="tab"]';
  const cards = '.geographic-map-panel,.facility-planner-overview,.army-muster-overview,.research-overview,.panel,.town-panel,.town-overview,.castle-detail,.officer-card,.army-slot,.research-card,.building-card,.facility-entry,.quest-row,.tactic-card,.roaming-panel,.field-card,.covert-panel,.court-panel,.domain-briefing,.resource,.touch-header-stat,.toolbar,.town-console-nav,.settings-group,.navigation-entry-row,.social-message,.premium-product,.gacha-pack,.portrait-frame,.officer-kamon';
  const candidates = shells + ',' + controls + ',' + cards;
  const excluded = 'svg,.sg-map-marker,.hotspot,[data-layout-handle],.layout-resize-handle,[role="separator"],.loading-mon,.ui-motion-layer,.ambient-atmosphere';
  const hidden = '[hidden],[inert],[aria-hidden="true"],dialog:not([open])';
  const tracked = new Map(), active = new Set(), pending = new Set(), removers = [];
  let atmosphere, intersections, subtree, preferences, timer = 0;
  let running = false, disposed = false, suspended = false, rescan = false, saturated = false;
  let quiet, coarse;
  try { quiet = global.matchMedia?.('(prefers-reduced-motion: reduce), (forced-colors: active), (prefers-contrast: more)'); } catch (_) {}
  try { coarse = global.matchMedia?.('(pointer: coarse)'); } catch (_) {}

  function listen(target, type, fn, options) {
    target?.addEventListener?.(type, fn, options);
    removers.push(() => target?.removeEventListener?.(type, fn, options));
  }
  function listenMedia(media, fn) {
    if (media?.addEventListener) listen(media, 'change', fn);
    else if (media?.addListener) { media.addListener(fn); removers.push(() => media.removeListener(fn)); }
  }
  function allowed() {
    return !disposed && !suspended && !doc.hidden && !quiet?.matches &&
      !global.navigator?.connection?.saveData &&
      root.getAttribute('data-presentation-motion') === 'standard' &&
      root.getAttribute('data-cyber-fx') === 'full';
  }
  function connected(el) { return el?.isConnected && el.nodeType === 1; }
  function selectable(el) {
    return connected(el) && el.namespaceURI !== 'http://www.w3.org/2000/svg' &&
      el.matches(candidates) && !el.closest(excluded);
  }
  function eligible(el, dialog) {
    return selectable(el) && !el.closest(hidden) &&
      !el.matches(':disabled,[aria-disabled="true"],.is-disabled,[aria-busy="true"]') &&
      (!dialog || el === dialog || dialog.contains(el));
  }
  function unmark(el) { if (el.hasAttribute(marker)) el.removeAttribute(marker); }
  function untrack(el) {
    intersections?.unobserve(el); tracked.delete(el); active.delete(el); unmark(el);
  }
  function register(el) {
    if (!selectable(el) || tracked.has(el)) return;
    if (tracked.size >= limit) { saturated = true; return; }
    tracked.set(el, { visible: false, bucket: el.matches(shells) ? 0 : el.matches(controls) ? 1 : 2 });
    intersections.observe(el);
  }
  function discover(host) {
    if (!connected(host) || host === atmosphere || host.closest(excluded)) return;
    register(host);
    for (const el of host.querySelectorAll(candidates)) register(el);
  }
  function schedule() {
    if (!disposed && running && !timer) timer = global.setTimeout(flush, 90);
  }
  function reconcile() {
    const buckets = [[], [], []], dialogs = doc.querySelectorAll('dialog[open]');
    const dialog = doc.activeElement?.closest?.('dialog[open]') || dialogs[dialogs.length - 1];
    const cap = coarse?.matches ? 40 : 64;
    for (const [el, record] of tracked) {
      if (record.visible && eligible(el, dialog)) buckets[record.bucket].push(el);
    }
    const chosen = new Set();
    function admit(el) {
      // IntersectionObserver excludes display:none and clipped scroll content.
      // Visibility is the only remaining paint check, limited to admitted nodes.
      if (chosen.size < cap && global.getComputedStyle?.(el).visibility !== 'hidden') chosen.add(el);
    }
    for (const el of buckets[0].slice(0, 16)) admit(el);
    for (let i = 0; chosen.size < cap && i < Math.max(buckets[1].length, buckets[2].length); i++) {
      if (buckets[1][i]) admit(buckets[1][i]);
      if (buckets[2][i]) admit(buckets[2][i]);
    }
    for (const el of active) if (!chosen.has(el)) { unmark(el); active.delete(el); }
    for (const el of chosen) {
      if (el.getAttribute(marker) !== 'true') el.setAttribute(marker, 'true');
      active.add(el);
    }
  }
  function flush() {
    timer = 0;
    if (!running || disposed) return;
    for (const el of tracked.keys()) if (!selectable(el)) untrack(el);
    if (saturated && tracked.size < limit) { rescan = true; saturated = false; }
    if (rescan) { rescan = false; pending.clear(); discover(doc.body); }
    else {
      for (const host of pending) {
        let nested = false;
        for (let p = host.parentElement; p; p = p.parentElement) if (pending.has(p)) { nested = true; break; }
        if (!nested) discover(host);
      }
      pending.clear();
    }
    reconcile();
  }
  function mutations(records) {
    let changed = false;
    for (const record of records) {
      if (record.target === atmosphere || record.target.closest?.(excluded)) continue;
      if (record.type === 'attributes') {
        pending.add(record.target); changed = true;
      } else {
        for (const node of record.addedNodes) if (node.nodeType === 1 && node !== atmosphere) { pending.add(node); changed = true; }
        if (Array.from(record.removedNodes).some(node => node.nodeType === 1 && node !== atmosphere)) changed = true;
      }
    }
    if (changed) schedule();
  }
  function stop() {
    running = false;
    root.removeAttribute('data-ambient-running');
    global.clearTimeout(timer); timer = 0;
    subtree?.disconnect(); intersections?.disconnect();
    for (const el of tracked.keys()) unmark(el);
    tracked.clear(); active.clear(); pending.clear(); saturated = false; rescan = false;
  }
  function sync() {
    if (!allowed() || !doc.body) { stop(); return; }
    if (running) { schedule(); return; }
    running = true;
    if (!atmosphere?.isConnected) {
      atmosphere = doc.createElement('div'); atmosphere.className = 'ambient-atmosphere';
      atmosphere.setAttribute('aria-hidden', 'true'); atmosphere.setAttribute('inert', '');
      atmosphere.inert = true; doc.body.append(atmosphere);
    }
    root.setAttribute('data-ambient-running', 'true');
    // Older browsers keep the ambient backdrop without polling UI geometry.
    if (!intersections) return;
    subtree?.observe(doc.body, { subtree: true, childList: true, attributes: true,
      attributeFilter: ['class', 'hidden', 'open', 'inert', 'aria-hidden', 'disabled', 'aria-disabled', 'aria-busy'] });
    rescan = true; schedule();
  }
  function refresh() { if (running && intersections) rescan = true; sync(); }
  if (typeof global.IntersectionObserver === 'function') {
    intersections = new global.IntersectionObserver(entries => {
      if (!running || disposed) return;
      for (const entry of entries) {
        const record = tracked.get(entry.target);
        if (record) record.visible = entry.isIntersecting && entry.intersectionRatio > 0;
      }
      schedule();
    }, { threshold: [0, .01] });
  }
  if (typeof global.MutationObserver === 'function') {
    subtree = new global.MutationObserver(mutations);
    preferences = new global.MutationObserver(sync);
    preferences.observe(root, { attributes: true, attributeFilter: ['data-presentation-motion', 'data-cyber-fx'] });
  }
  listen(doc, 'visibilitychange', sync);
  listen(global, 'pagehide', () => { suspended = true; sync(); });
  listen(global, 'pageshow', () => { suspended = false; sync(); });
  listen(global, 'sengoku-presentation-change', sync);
  listen(global.navigator?.connection, 'change', sync);
  listenMedia(quiet, sync); listenMedia(coarse, schedule);
  if (!doc.body) listen(doc, 'DOMContentLoaded', sync, { once: true });
  global.SengokuAmbientMotion = {
    refresh,
    destroy() {
      if (disposed) return;
      disposed = true; stop(); preferences?.disconnect();
      for (const remove of removers) remove();
      atmosphere?.remove();
    }
  };
  sync();
})(typeof window !== 'undefined' ? window : globalThis);
