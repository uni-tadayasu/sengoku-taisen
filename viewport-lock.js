/* Touch devices keep a fixed page scale; the map owns its own pinch camera.
 * Load this after the viewport meta in the head, before the game is painted. */
(function (global) {
  'use strict';
  function touchDevice(touchPoints, coarsePointer) {
    return Number(touchPoints) > 0 || coarsePointer === true;
  }
  function lockedViewport(content) {
    const parts = String(content || 'width=device-width, viewport-fit=cover').split(',')
      .map(part => part.trim()).filter(part => part && !/^(?:initial-scale|minimum-scale|maximum-scale|user-scalable)\s*=/i.test(part));
    return [...parts, 'initial-scale=1', 'minimum-scale=1', 'maximum-scale=1', 'user-scalable=no'].join(', ');
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { touchDevice, lockedViewport };
  const doc = global.document, root = doc?.documentElement;
  if (!root || global.SengokuViewportLock) return;
  const meta = doc.querySelector('meta[name="viewport"]'), originalViewport = meta?.getAttribute('content');
  const coarseMedia = global.matchMedia?.('(any-pointer: coarse)');
  const removers = [];
  let active = false, destroyed = false;
  function listen(target, name, listener, options) {
    target?.addEventListener?.(name, listener, options);
    removers.push(() => target?.removeEventListener?.(name, listener, options));
  }
  function prevent(event) { if (active && event.cancelable !== false) event.preventDefault(); }
  function refresh() {
    if (destroyed) return;
    const next = touchDevice(global.navigator?.maxTouchPoints, coarseMedia?.matches);
    if (next === active && root.classList.contains('sengoku-touch-locked') === next) return;
    active = next;
    root.classList.toggle('sengoku-touch-locked', active);
    if (meta) {
      if (active) meta.setAttribute('content', lockedViewport(originalViewport));
      else if (originalViewport == null) meta.removeAttribute('content');
      else meta.setAttribute('content', originalViewport);
    }
    global.SengokuLayout?.refresh?.();
  }
  function sameMapTouches(touches) {
    if (!touches?.length) return false;
    const map = touches[0].target?.closest?.('.sg-map-surface');
    return Boolean(map) && Array.from(touches).every(touch => touch.target?.closest?.('.sg-map-surface') === map);
  }
  function touchMove(event) {
    // A single finger still scrolls lists and dialogs. Both fingers on one
    // map surface are left to its existing Pointer Events pan/pinch handler.
    if (active && event.touches?.length > 1 && !sameMapTouches(event.touches)) prevent(event);
  }
  function wheel(event) {
    if (active && event.ctrlKey && !event.target?.closest?.('.sg-map-surface')) prevent(event);
  }
  function keydown(event) {
    if (active && (event.ctrlKey || event.metaKey) && ['+', '=', '-', '_', '0', 'Add', 'Subtract'].includes(event.key)) prevent(event);
  }
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    for (const remove of removers) remove();
    root.classList.remove('sengoku-touch-locked');
    if (meta) {
      if (originalViewport == null) meta.removeAttribute('content');
      else meta.setAttribute('content', originalViewport);
    }
    active = false;
  }
  // Safari's native page gesture must also be suppressed on the map: the
  // map zoom is implemented through Pointer Events, not browser page zoom.
  listen(doc, 'gesturestart', prevent, { passive: false });
  listen(doc, 'gesturechange', prevent, { passive: false });
  listen(doc, 'touchmove', touchMove, { passive: false });
  listen(doc, 'wheel', wheel, { passive: false });
  listen(doc, 'keydown', keydown);
  listen(coarseMedia, 'change', refresh);
  listen(global, 'pageshow', refresh);
  listen(global, 'orientationchange', refresh);
  listen(global, 'resize', refresh);
  global.SengokuViewportLock = { refresh, destroy, isActive: () => active };
  refresh();
})(typeof window !== 'undefined' ? window : globalThis);
