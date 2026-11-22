/* Presentation preferences only. Separate from game saves, audio and account data. */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'sengoku-presentation-v1';
  const validMotion = value => value === 'standard' || value === 'quiet';
  function readMotionPreference(storage) {
    try {
      const value = JSON.parse(storage?.getItem(STORAGE_KEY) || 'null');
      return value && typeof value === 'object' && !Array.isArray(value) && validMotion(value.motion) ? value.motion : 'standard';
    } catch (_) { return 'standard'; }
  }
  function createPresentation(win = global) {
    const doc = win.document, root = doc?.documentElement;
    if (!root) return null;
    let storage = null, media = null, disposed = false;
    try { storage = win.localStorage; } catch (_) {}
    try { media = win.matchMedia?.('(prefers-reduced-motion: reduce)') || null; } catch (_) {}
    let preference = readMotionPreference(storage);
    const systemReduced = () => media?.matches === true;
    const effective = () => systemReduced() || preference === 'quiet' ? 'quiet' : 'standard';
    const note = () => systemReduced()
      ? '端末の設定に合わせて、現在は演出を控えめにしています。'
      : '控えめでは光の動きや画面の切り替え演出を抑えます。端末の設定を優先します。';
    function updateControls() {
      for (const control of doc.querySelectorAll?.('[data-presentation-select]') || []) {
        if (control.value !== preference) control.value = preference;
      }
      for (const target of doc.querySelectorAll?.('[data-presentation-note]') || []) {
        if (target.textContent !== note()) target.textContent = note();
      }
    }
    function apply(announce = false) {
      const motion = effective();
      root.setAttribute('data-presentation-motion', motion);
      updateControls();
      if (announce && typeof win.CustomEvent === 'function') {
        win.dispatchEvent?.(new win.CustomEvent('sengoku-presentation-change', {
          detail: { motion, preference, reducedBySystem: systemReduced() }
        }));
      }
    }
    function setMotion(value) {
      if (disposed || !validMotion(value)) return false;
      const changed = value !== preference;
      preference = value;
      try { storage?.setItem(STORAGE_KEY, JSON.stringify({ motion: preference })); } catch (_) {}
      apply(changed);
      return true;
    }
    function settingsMarkup() {
      return '<section class="presentation-settings" aria-labelledby="presentation-motion-label">' +
        '<div class="presentation-setting-row"><label id="presentation-motion-label" for="presentation-motion">表示演出</label>' +
        '<select id="presentation-motion" class="select" data-presentation-select aria-describedby="presentation-motion-note">' +
        '<option value="standard"' + (preference === 'standard' ? ' selected' : '') + '>標準</option>' +
        '<option value="quiet"' + (preference === 'quiet' ? ' selected' : '') + '>控えめ</option></select></div>' +
        '<p id="presentation-motion-note" data-presentation-note>' + note() + '</p></section>';
    }
    function change(event) {
      if (event.target?.matches?.('[data-presentation-select]')) setMotion(event.target.value);
    }
    function systemChange() { if (!disposed) apply(true); }
    doc.addEventListener?.('change', change);
    if (media?.addEventListener) media.addEventListener('change', systemChange);
    else media?.addListener?.(systemChange);
    apply();
    return {
      settingsMarkup, setMotion,
      getPreference: () => preference,
      getEffectiveMotion: effective,
      destroy() {
        if (disposed) return;
        disposed = true;
        doc.removeEventListener?.('change', change);
        if (media?.removeEventListener) media.removeEventListener('change', systemChange);
        else media?.removeListener?.(systemChange);
      }
    };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { STORAGE_KEY, readMotionPreference, createPresentation };
  if (global.document && !global.SengokuPresentation) global.SengokuPresentation = createPresentation(global);
})(typeof window !== 'undefined' ? window : globalThis);
