/* PC display preferences are separate from lord identity and game saves. */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'sengoku-layout-v1';
  const KEYS = ['sidebar', 'header', 'townRatio', 'mapRatio', 'fieldRatio', 'townHeight', 'mapHeight', 'fieldHeight'];
  const clamp = (value, min, max) => Math.min(Math.max(Number(value) || 0, min), Math.max(min, max));
  function sanitize(input) {
    const source = input && input.version === 1 && input.values && typeof input.values === 'object' ? input.values : {};
    const result = {};
    for (const key of KEYS) if (Object.prototype.hasOwnProperty.call(source, key) && typeof source[key] === 'number' && Number.isFinite(source[key])) {
      result[key] = key.endsWith('Ratio') ? clamp(source[key], 20, 80) : clamp(source[key], 40, 1200);
    }
    return result;
  }
  function boundsFor(key, viewport, minimumHeader = 86, splitWidth = 1000, gap = 20) {
    const width = Math.max(1, viewport.width || 1), height = Math.max(1, viewport.height || 1);
    if (key === 'sidebar') {
      const min = width > 1000 ? 140 : Math.min(72, width * .24);
      return { min, max: Math.max(min, Math.min(360, width * .34, width - Math.min(340, width * .65))) };
    }
    if (key === 'header') return { min: minimumHeader, max: Math.max(minimumHeader, Math.min(240, height * .36, height - 180)) };
    if (key.endsWith('Ratio')) {
      const available = Math.max(1, splitWidth - gap), leftMin = key === 'townRatio' ? 360 : 380;
      const rightMin = key === 'townRatio' ? 250 : 280;
      const min = Math.min(80, leftMin / available * 100), max = Math.max(min, Math.min(80, (available - rightMin) / available * 100));
      return { min, max };
    }
    const min = key === 'townHeight' ? 240 : 300;
    return { min, max: Math.max(min, Math.min(1000, height * .88)) };
  }
  const doc = global.document, root = doc?.documentElement;
  if (typeof module !== 'undefined' && module.exports) module.exports = { sanitize, boundsFor, clamp };
  if (!doc || !root) return;
  if (global.SengokuLayout) return;

  let app, main, sidebar, header, button, overlay, toolbar, feedback;
  let prefs = {}, editing = false, initialized = false, pending = 0, drag = null, storageFailed = false;
  let minimumHeader = 86, headerWidth = 0, desktopWasActive = false;
  const handles = new Map(), descriptors = new Map(), observed = new Set(), removers = [];
  let resizeObserver, mainObserver, modeObserver, bodyObserver;
  const dialogObservers = new Map();
  const raf = global.requestAnimationFrame?.bind(global) || (fn => global.setTimeout(fn, 16));
  const caf = global.cancelAnimationFrame?.bind(global) || global.clearTimeout.bind(global);
  const icon = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M9 10h12M6 10v4M14 7h3"/></svg>';

  function listen(node, type, fn, options) {
    node?.addEventListener(type, fn, options);
    removers.push(() => node?.removeEventListener(type, fn, options));
  }
  function attr(node, name, value) {
    if (value == null) { if (node.hasAttribute(name)) node.removeAttribute(name); }
    else if (node.getAttribute(name) !== String(value)) node.setAttribute(name, String(value));
  }
  function style(node, name, value) { if (node.style.getPropertyValue(name) !== value) node.style.setProperty(name, value); }
  function readPreferences() { try { prefs = sanitize(JSON.parse(global.localStorage.getItem(STORAGE_KEY) || 'null')); } catch (_) { prefs = {}; } }
  function savePreferences() {
    try {
      if (Object.keys(prefs).length) global.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, values: prefs }));
      else global.localStorage.removeItem(STORAGE_KEY);
      storageFailed = false;
    } catch (_) { storageFailed = true; }
    status(storageFailed ? '配置を適用しました。このブラウザでは保存できません。' : '配置をこのブラウザに保存しました。');
  }
  function status(message) { if (feedback && feedback.textContent !== message) feedback.textContent = message; }
  function desktopActive() {
    return root.classList.contains('sengoku-desktop-fit') && !(Number(global.navigator?.maxTouchPoints) > 0) && !global.matchMedia?.('(any-pointer: coarse)').matches;
  }
  function blocked() { return doc.body.classList.contains('at-title') || doc.body.classList.contains('is-loading') || Boolean(doc.querySelector('dialog[open]')); }
  function viewport() {
    const box = app.getBoundingClientRect();
    return { width: box.width || global.innerWidth || 1, height: box.height || global.innerHeight || 1 };
  }
  function visibleRect(element) {
    if (!element || !element.isConnected) return null;
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0 ? box : null;
  }
  function readHeaderMinimum() {
    const width = app.getBoundingClientRect().width;
    if (Math.abs(width - headerWidth) < .5) return;
    headerWidth = width;
    const previous = root.getAttribute('data-layout-header');
    root.removeAttribute('data-layout-header');
    minimumHeader = Math.ceil(header.getBoundingClientRect().height);
    if (previous != null) root.setAttribute('data-layout-header', previous);
  }
  function limits(key, container) {
    const box = visibleRect(container), gap = container ? parseFloat(global.getComputedStyle(container).columnGap) || 20 : 20;
    return boundsFor(key, viewport(), minimumHeader, box?.width || 1000, gap);
  }
  function preference(key, fallback, container) {
    const bounds = limits(key, container);
    return clamp(Object.prototype.hasOwnProperty.call(prefs, key) ? prefs[key] : fallback, bounds.min, bounds.max);
  }
  function applyPreference(key, cssName, fallback, container, suffix = 'px') {
    const present = Object.prototype.hasOwnProperty.call(prefs, key);
    attr(root, 'data-layout-' + key.toLowerCase(), present ? 'true' : null);
    if (!present) { root.style.removeProperty(cssName); return; }
    style(root, cssName, preference(key, fallback, container).toFixed(2) + suffix);
  }
  function applyPreferences() {
    readHeaderMinimum();
    applyPreference('sidebar', '--layout-sidebar-width', 196);
    applyPreference('header', '--layout-header-height', minimumHeader);
    for (const [key, selector, fallback] of [
      ['townRatio', '.dashboard-grid', 70], ['mapRatio', '.world-layout-real', 70], ['fieldRatio', '.field-workspace', 70]
    ]) {
      const container = main.querySelector(selector), present = Object.prototype.hasOwnProperty.call(prefs, key), prefix = key.replace('Ratio', '');
      attr(root, 'data-layout-' + key.toLowerCase(), present ? 'true' : null);
      if (present) {
        const value = preference(key, fallback, container);
        style(root, '--layout-' + prefix + '-left', value.toFixed(3) + 'fr');
        style(root, '--layout-' + prefix + '-right', (100 - value).toFixed(3) + 'fr');
      } else {
        root.style.removeProperty('--layout-' + prefix + '-left'); root.style.removeProperty('--layout-' + prefix + '-right');
      }
    }
    for (const key of ['townHeight', 'mapHeight', 'fieldHeight']) applyPreference(key, '--layout-' + key.replace('Height', '-height'), key === 'townHeight' ? 460 : 480);
  }
  function watchLayoutNodes() {
    if (!resizeObserver) return;
    const nodes = new Set([app, main, sidebar, header, ...main.querySelectorAll('.dashboard-grid,.left-column,.right-column,.world-layout-real,.geographic-map-panel,.castle-detail,.field-workspace,.field-map-column,.field-sidebar,.town-scene')]);
    for (const node of observed) if (!nodes.has(node)) { resizeObserver.unobserve(node); observed.delete(node); }
    for (const node of nodes) if (!observed.has(node)) { resizeObserver.observe(node); observed.add(node); }
  }
  function watchDialogs() {
    if (!global.MutationObserver) return;
    for (const [node, observer] of dialogObservers) if (!node.isConnected) { observer.disconnect(); dialogObservers.delete(node); }
    for (const node of doc.querySelectorAll('dialog')) if (!dialogObservers.has(node)) {
      const observer = new global.MutationObserver(() => { if (blocked()) finishDrag(false); schedule(); });
      observer.observe(node, { attributes: true, attributeFilter: ['open', 'hidden'] }); dialogObservers.set(node, observer);
    }
  }
  function addDescriptor(key, label, orientation, value, bounds, rect, options = {}) {
    const horizontal = orientation === 'horizontal';
    if (rect.width < 18 || rect.height < 18) return;
    const descriptor = { key, label, orientation, value, bounds, ...options };
    descriptors.set(key, descriptor);
    let handle = handles.get(key);
    if (!handle) {
      handle = doc.createElement('div'); handle.className = 'layout-resize-handle';
      handle.setAttribute('role', 'separator'); handle.tabIndex = 0; handle.dataset.layoutHandle = key;
      handle.innerHTML = '<span class="layout-grip" aria-hidden="true"></span><span class="layout-grip-label" aria-hidden="true"></span>';
      overlay.append(handle); handles.set(key, handle);
    }
    handle.hidden = false;
    attr(handle, 'aria-label', label); attr(handle, 'aria-orientation', orientation);
    attr(handle, 'aria-valuemin', Math.floor(bounds.min)); attr(handle, 'aria-valuemax', Math.ceil(bounds.max));
    attr(handle, 'aria-valuenow', Math.round(value)); attr(handle, 'aria-valuetext', Math.round(value) + (key.endsWith('Ratio') ? 'パーセント' : 'ピクセル'));
    attr(handle, 'title', label + '：ドラッグ、矢印キーで調整。ダブルクリックで初期配置。');
    handle.querySelector('.layout-grip-label').textContent = label;
    style(handle, 'left', (horizontal ? rect.x : rect.x - 6).toFixed(2) + 'px');
    style(handle, 'top', (horizontal ? rect.y - 6 : rect.y).toFixed(2) + 'px');
    style(handle, 'width', (horizontal ? rect.width : 12).toFixed(2) + 'px');
    style(handle, 'height', (horizontal ? 12 : rect.height).toFixed(2) + 'px');
  }
  function positionHandles() {
    descriptors.clear(); for (const handle of handles.values()) handle.hidden = true;
    if (!editing || blocked() || !desktopActive()) return;
    const a = visibleRect(app), s = visibleRect(sidebar), h = visibleRect(header), m = visibleRect(main);
    if (!a || !s || !h || !m) return;
    // Keep the floating actions away from the bottom-edge height controls.
    const toolbarTop = Math.min(h.bottom + 12, Math.max(8, (global.innerHeight || a.bottom) - toolbar.offsetHeight - 12));
    style(toolbar, 'top', toolbarTop.toFixed(2) + 'px');
    addDescriptor('sidebar', 'メニューの幅', 'vertical', s.width, limits('sidebar'), { x: s.right, y: s.top, width: 24, height: s.height });
    addDescriptor('header', '上部の高さ', 'horizontal', h.height, limits('header'), { x: a.left + 8, y: h.bottom, width: Math.max(0, a.width - 16), height: 24 });
    for (const [key, label, containerSelector, firstSelector, secondSelector] of [
      ['townRatio', '城下町と情報欄の幅', '.dashboard-grid', '.left-column', '.right-column'],
      ['mapRatio', '地図と城情報の幅', '.world-layout-real', '.geographic-map-panel', '.castle-detail'],
      ['fieldRatio', '地図と領主情報の幅', '.field-workspace', '.field-map-column', '.field-sidebar']
    ]) {
      const container = main.querySelector(containerSelector), first = container?.querySelector(firstSelector), second = container?.querySelector(secondSelector);
      const c = visibleRect(container), l = visibleRect(first), r = visibleRect(second);
      if (!c || !l || !r || Math.abs(l.top - r.top) > 10 || r.left < l.right - 1) continue;
      const top = Math.max(m.top + 8, l.top), bottom = Math.min(m.bottom - 8, Math.max(l.bottom, r.bottom));
      if (bottom - top < 36) continue;
      const gap = Math.max(0, r.left - l.right), available = Math.max(1, c.width - gap), value = l.width / available * 100;
      addDescriptor(key, label, 'vertical', value, limits(key, container), { x: (l.right + r.left) / 2, y: top, width: 24, height: bottom - top }, { container, available });
    }
    for (const [key, label, selector] of [
      ['townHeight', '城下町の高さ', '.town-scene'], ['mapHeight', '天下地図の高さ', '.world-layout-real .geographic-map-panel'], ['fieldHeight', 'フィールドの高さ', '.field-map-panel']
    ]) {
      const element = main.querySelector(selector), box = visibleRect(element);
      if (!box || box.bottom <= m.top + 30 || box.top >= m.bottom - 30) continue;
      const left = Math.max(m.left + 8, box.left), right = Math.min(m.right - 16, box.right);
      addDescriptor(key, label, 'horizontal', box.height, limits(key), { x: left + 8, y: Math.min(box.bottom, m.bottom - 10), width: Math.max(0, right - left - 16), height: 24 });
    }
  }
  function refresh() {
    pending = 0;
    if (!initialized) return;
    const active = desktopActive();
    if (!active && drag) finishDrag(false);
    if (!active) editing = false;
    if (active) applyPreferences();
    if (desktopWasActive !== active) { desktopWasActive = active; headerWidth = 0; }
    attr(root, 'data-layout-editing', editing && active ? 'true' : null);
    button.hidden = !active;
    attr(button, 'aria-pressed', editing ? 'true' : 'false');
    const hideEditor = !active || !editing || blocked();
    overlay.hidden = hideEditor; toolbar.hidden = hideEditor;
    if (hideEditor) descriptors.clear(); else positionHandles();
    watchLayoutNodes(); watchDialogs();
  }
  function schedule() { if (initialized && !pending) pending = raf(refresh); }
  function setValue(key, value, descriptor) {
    const bounds = descriptor?.bounds || limits(key, descriptor?.container);
    prefs[key] = Math.round(clamp(value, bounds.min, bounds.max) * 100) / 100;
    applyPreferences(); global.SengokuDesktopFit?.refresh(); schedule();
  }
  function startDrag(event) {
    const handle = event.target.closest?.('[data-layout-handle]'), descriptor = handle && descriptors.get(handle.dataset.layoutHandle);
    if (!descriptor || event.button !== 0 || event.isPrimary === false || blocked() || !desktopActive()) return;
    finishDrag(false);
    drag = { handle, descriptor: { ...descriptor }, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, startValue: descriptor.value, previous: { ...prefs } };
    handle.setPointerCapture?.(event.pointerId); handle.focus({ preventScroll: true });
    attr(root, 'data-layout-dragging', descriptor.orientation); attr(handle, 'data-layout-dragging', 'true');
    event.preventDefault();
  }
  function moveDrag(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const { descriptor, startX, startY, startValue } = drag;
    const delta = descriptor.orientation === 'vertical' ? event.clientX - startX : event.clientY - startY;
    setValue(descriptor.key, startValue + (descriptor.key.endsWith('Ratio') ? delta / descriptor.available * 100 : delta), descriptor);
    event.preventDefault();
  }
  function finishDrag(commit) {
    if (!drag) return;
    const current = drag; drag = null;
    if (!commit) prefs = current.previous;
    attr(current.handle, 'data-layout-dragging', null); attr(root, 'data-layout-dragging', null);
    if (current.handle.hasPointerCapture?.(current.pointerId)) current.handle.releasePointerCapture(current.pointerId);
    if (commit) savePreferences(); else { applyPreferences(); schedule(); }
  }
  function endDrag(event) { if (drag && drag.pointerId === event.pointerId) finishDrag(true); }
  function cancelDrag(event) { if (drag && (event.pointerId == null || drag.pointerId === event.pointerId)) finishDrag(false); }
  function resetOne(key) { delete prefs[key]; applyPreferences(); savePreferences(); global.SengokuDesktopFit?.refresh(); schedule(); }
  function keyHandle(event) {
    const handle = event.target.closest?.('[data-layout-handle]'), descriptor = handle && descriptors.get(handle.dataset.layoutHandle);
    if (!descriptor || blocked()) return;
    const negative = descriptor.orientation === 'vertical' ? 'ArrowLeft' : 'ArrowUp', positive = descriptor.orientation === 'vertical' ? 'ArrowRight' : 'ArrowDown';
    const step = descriptor.key.endsWith('Ratio') ? (event.shiftKey ? 5 : 2) : (event.shiftKey ? 40 : 10);
    let next;
    if (event.key === negative) next = descriptor.value - step;
    else if (event.key === positive) next = descriptor.value + step;
    else if (event.key === 'Home') next = descriptor.bounds.min;
    else if (event.key === 'End') next = descriptor.bounds.max;
    else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); resetOne(descriptor.key); return; }
    else return;
    event.preventDefault(); setValue(descriptor.key, next, descriptor); savePreferences();
  }
  function open() {
    if (!initialized || !desktopActive() || blocked()) return false;
    editing = true; status('境界をドラッグして調整できます。矢印キーにも対応。');
    schedule(); return true;
  }
  function close() { finishDrag(true); editing = false; schedule(); button?.focus({ preventScroll: true }); }
  function reset() {
    finishDrag(false); prefs = {}; applyPreferences(); savePreferences();
    global.SengokuDesktopFit?.refresh(); schedule();
    status(storageFailed ? '初期配置に戻しました。保存はできませんでした。' : '初期配置に戻しました。');
  }
  function init() {
    if (initialized) return;
    app = doc.getElementById('app'); main = doc.getElementById('main'); sidebar = app?.querySelector('.sidebar'); header = app?.querySelector('.topbar');
    const destination = app?.querySelector('.sidebar-bottom');
    if (!app || !main || !sidebar || !header || !destination) return;
    initialized = true; readPreferences();
    button = doc.createElement('button'); button.type = 'button'; button.className = 'nav-item layout-editor-button'; button.innerHTML = icon + '<span>領域を調整</span>';
    button.setAttribute('aria-label', '領域を調整'); button.setAttribute('aria-pressed', 'false'); button.hidden = true;
    destination.insertBefore(button, destination.querySelector('.version-label'));
    overlay = doc.createElement('div'); overlay.id = 'layout-resize-overlay'; overlay.hidden = true;
    toolbar = doc.createElement('section'); toolbar.id = 'layout-resize-toolbar'; toolbar.hidden = true; toolbar.setAttribute('aria-label', '画面領域の調整');
    toolbar.innerHTML = '<div class="layout-toolbar-copy"><strong>領域を調整</strong><span id="layout-resize-status" role="status" aria-live="polite">境界をドラッグして調整できます。</span></div><div class="layout-toolbar-actions"><button type="button" data-layout-reset>初期配置</button><button type="button" data-layout-done>完了</button></div>';
    doc.body.append(overlay, toolbar); feedback = toolbar.querySelector('#layout-resize-status');
    listen(button, 'click', () => editing ? close() : open());
    listen(toolbar.querySelector('[data-layout-reset]'), 'click', reset); listen(toolbar.querySelector('[data-layout-done]'), 'click', close);
    listen(overlay, 'pointerdown', startDrag); listen(overlay, 'pointermove', moveDrag); listen(overlay, 'pointerup', endDrag); listen(overlay, 'pointercancel', cancelDrag); listen(overlay, 'lostpointercapture', cancelDrag);
    listen(overlay, 'keydown', keyHandle); listen(overlay, 'dblclick', event => { const handle = event.target.closest?.('[data-layout-handle]'); if (handle) resetOne(handle.dataset.layoutHandle); });
    listen(global, 'blur', () => finishDrag(false));
    listen(global, 'resize', () => { finishDrag(false); headerWidth = 0; schedule(); });
    listen(global.visualViewport, 'resize', () => { finishDrag(false); headerWidth = 0; schedule(); });
    listen(main, 'scroll', schedule, { passive: true }); listen(sidebar, 'scroll', schedule, { passive: true });
    listen(doc, 'visibilitychange', () => { if (doc.hidden) finishDrag(false); else schedule(); });
    listen(doc, 'keydown', event => { if (event.key === 'Escape' && editing && !blocked()) { if (drag) finishDrag(false); else close(); } });
    if (global.ResizeObserver) resizeObserver = new global.ResizeObserver(schedule);
    if (global.MutationObserver) {
      mainObserver = new global.MutationObserver(() => { finishDrag(false); schedule(); });
      mainObserver.observe(main, { childList: true, attributes: true, attributeFilter: ['data-view'] });
      modeObserver = new global.MutationObserver(schedule); modeObserver.observe(root, { attributes: true, attributeFilter: ['class'] });
      bodyObserver = new global.MutationObserver(() => { if (blocked()) finishDrag(false); schedule(); });
      bodyObserver.observe(doc.body, { childList: true, attributes: true, attributeFilter: ['class'] });
    }
    doc.fonts?.ready?.then(() => { headerWidth = 0; schedule(); }).catch(() => {});
    schedule();
  }
  function destroy() {
    finishDrag(false); initialized = false; if (pending) caf(pending); pending = 0;
    for (const remove of removers) remove(); resizeObserver?.disconnect(); mainObserver?.disconnect(); modeObserver?.disconnect(); bodyObserver?.disconnect();
    for (const observer of dialogObservers.values()) observer.disconnect(); dialogObservers.clear();
    button?.remove(); overlay?.remove(); toolbar?.remove();
    attr(root, 'data-layout-editing', null); attr(root, 'data-layout-dragging', null);
  }
  global.SengokuLayout = { open, close, reset, refresh: schedule, destroy };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})(typeof window !== 'undefined' ? window : globalThis);
