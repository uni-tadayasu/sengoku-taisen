/* Keep compact conversations inside the visible area without recreating inputs. */
(function (global) {
  'use strict';
  function viewportBox(width, height, viewport) {
    const positive = (value, fallback) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
    const layoutWidth = positive(width, 1), layoutHeight = positive(height, 1);
    return {
      width: Math.min(layoutWidth, positive(viewport?.width, layoutWidth)),
      height: Math.min(layoutHeight, positive(viewport?.height, layoutHeight)),
      left: Math.max(0, Number(viewport?.offsetLeft) || 0),
      top: Math.max(0, Number(viewport?.offsetTop) || 0)
    };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { viewportBox };
  const doc = global.document, root = doc?.documentElement;
  if (!root || global.SengokuSocialViewport) return;
  const selector = '.social-dialog, .letters-dialog, .trade-dialog, .troop-garrison-dialog, .moderation-dialog, .hints-dialog';
  const coarse = global.matchMedia?.('(any-pointer: coarse)');
  const removers = [];
  let frame = 0, observer, destroyed = false, started = false;
  const raf = global.requestAnimationFrame?.bind(global) || (callback => global.setTimeout(callback, 16));
  const caf = global.cancelAnimationFrame?.bind(global) || global.clearTimeout.bind(global);
  function attr(node, name, value) {
    if (!node) return;
    if (value) { if (!node.hasAttribute(name)) node.setAttribute(name, ''); }
    else if (node.hasAttribute(name)) node.removeAttribute(name);
  }
  function listen(target, type, listener, options) {
    target?.addEventListener?.(type, listener, options);
    removers.push(() => target?.removeEventListener?.(type, listener, options));
  }
  function update() {
    frame = 0;
    if (destroyed) return;
    const box = viewportBox(global.innerWidth, global.innerHeight, global.visualViewport);
    for (const [name, value] of Object.entries(box)) {
      const key = '--social-viewport-' + name, next = value.toFixed(3) + 'px';
      if (root.style.getPropertyValue(key) !== next) root.style.setProperty(key, next);
    }
    const compactLayout = Number(global.navigator?.maxTouchPoints) > 0 || coarse?.matches === true || box.width <= 1024;
    for (const dialog of doc.querySelectorAll(selector)) {
      const visible = compactLayout && dialog.open;
      const compact = visible && box.height < 560;
      attr(dialog, 'data-touch-compact', compact);
      if (!dialog.matches('.social-dialog')) continue;
      const body = dialog.querySelector('.social-body');
      const chat = body?.querySelector('.social-chat');
      const form = chat?.querySelector('.social-chat-form');
      // Keep the compact composer while its Send button has focus too, so a
      // tap cannot move the button between pointerdown and click.
      const composing = Boolean(compact && form?.contains(doc.activeElement));
      attr(dialog, 'data-touch-chat', visible && Boolean(chat));
      attr(dialog, 'data-touch-composing', composing);
      attr(body, 'data-touch-chat-layout', visible && Boolean(chat) && (chat.parentElement === body || composing));
      const path = new Set();
      if (composing) for (let node = chat.parentElement; node && node !== body; node = node.parentElement) path.add(node);
      for (const node of body?.querySelectorAll('[data-touch-chat-path]') || []) if (!path.has(node)) attr(node, 'data-touch-chat-path', false);
      for (const node of path) attr(node, 'data-touch-chat-path', true);
    }
  }
  function refresh() { if (!destroyed && !frame) frame = raf(update); }
  function start() {
    if (started || destroyed || !doc.body) return;
    started = true;
    for (const type of ['resize', 'orientationchange', 'pageshow']) listen(global, type, refresh);
    listen(global.visualViewport, 'resize', refresh);
    listen(global.visualViewport, 'scroll', refresh);
    listen(coarse, 'change', refresh);
    listen(doc, 'focusin', refresh);
    listen(doc, 'focusout', refresh);
    if (global.MutationObserver) {
      observer = new global.MutationObserver(records => {
        if (records.some(record => {
          const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
          return target?.matches?.(selector) || target?.closest?.(selector) || [...record.addedNodes || []].some(node => node.nodeType === 1 && (node.matches?.(selector) || node.querySelector?.(selector)));
        })) refresh();
      });
      observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] });
    }
    refresh();
  }
  function destroy() {
    destroyed = true;
    if (frame) caf(frame);
    frame = 0;
    observer?.disconnect();
    for (const remove of removers.splice(0)) remove();
    for (const node of doc.querySelectorAll('[data-touch-compact], [data-touch-chat], [data-touch-composing], [data-touch-chat-layout], [data-touch-chat-path]')) {
      for (const name of ['data-touch-compact', 'data-touch-chat', 'data-touch-composing', 'data-touch-chat-layout', 'data-touch-chat-path']) attr(node, name, false);
    }
    for (const name of ['width', 'height', 'left', 'top']) root.style.removeProperty('--social-viewport-' + name);
  }
  global.SengokuSocialViewport = { refresh, destroy, viewportBox };
  if (doc.readyState === 'loading') listen(doc, 'DOMContentLoaded', start, { once: true }); else start();
})(typeof window !== 'undefined' ? window : globalThis);
