/* Presentation preferences only. Separate from game saves, audio and account data. */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'sengoku-presentation-v1';
  const validMotion = value => value === 'standard' || value === 'quiet';
  const validTextSize = value => value === 'standard' || value === 'large';
  function readPresentationPreferences(storage) {
    try {
      const value = JSON.parse(storage?.getItem(STORAGE_KEY) || 'null');
      if (value && typeof value === 'object' && !Array.isArray(value)) return {
        motion: validMotion(value.motion) ? value.motion : 'standard',
        textSize: validTextSize(value.textSize) ? value.textSize : 'standard'
      };
    } catch (_) { /* A display preference must never prevent opening the game. */ }
    return { motion: 'standard', textSize: 'standard' };
  }
  function readMotionPreference(storage) { return readPresentationPreferences(storage).motion; }
  function createPresentation(win = global) {
    const doc = win.document, root = doc?.documentElement;
    if (!root) return null;
    let storage = null, media = null, disposed = false;
    try { storage = win.localStorage; } catch (_) {}
    try { media = win.matchMedia?.('(prefers-reduced-motion: reduce)') || null; } catch (_) {}
    const initial = readPresentationPreferences(storage);
    let preference = initial.motion, textSize = initial.textSize;
    const systemReduced = () => media?.matches === true;
    const effective = () => systemReduced() || preference === 'quiet' ? 'quiet' : 'standard';
    const note = () => systemReduced()
      ? '端末の設定に合わせて、現在は演出を控えめにしています。'
      : '控えめでは光の動きや画面の切り替え演出を抑えます。端末の設定を優先します。';
    function updateControls() {
      for (const control of doc.querySelectorAll?.('[data-presentation-select]') || []) {
        if (control.value !== preference) control.value = preference;
      }
      for (const control of doc.querySelectorAll?.('[data-presentation-text-select]') || []) {
        if (control.value !== textSize) control.value = textSize;
      }
      for (const target of doc.querySelectorAll?.('[data-presentation-note]') || []) {
        if (target.textContent !== note()) target.textContent = note();
      }
    }
    function apply(announce = false) {
      const motion = effective();
      root.setAttribute('data-presentation-motion', motion);
      root.setAttribute('data-presentation-text', textSize);
      updateControls();
      if (announce && typeof win.CustomEvent === 'function') {
        win.dispatchEvent?.(new win.CustomEvent('sengoku-presentation-change', {
          detail: { motion, preference, reducedBySystem: systemReduced() }
        }));
      }
    }
    function persist() {
      try { storage?.setItem(STORAGE_KEY, JSON.stringify({ motion: preference, textSize })); } catch (_) {}
    }
    function setMotion(value) {
      if (disposed || !validMotion(value)) return false;
      const changed = value !== preference;
      preference = value;
      persist();
      apply(changed);
      return true;
    }
    function setTextSize(value) {
      if (disposed || !validTextSize(value)) return false;
      const changed = textSize !== value;
      textSize = value; persist(); apply();
      if (changed && typeof win.CustomEvent === 'function') {
        win.dispatchEvent?.(new win.CustomEvent('sengoku-text-size-change', { detail: { textSize } }));
      }
      return true;
    }
    function settingsMarkup() {
      return '<section class="presentation-settings" aria-label="表示の設定">' +
        '<div class="presentation-setting-row"><label id="presentation-motion-label" for="presentation-motion">表示演出</label>' +
        '<select id="presentation-motion" class="select" data-presentation-select aria-describedby="presentation-motion-note">' +
        '<option value="standard"' + (preference === 'standard' ? ' selected' : '') + '>標準</option>' +
        '<option value="quiet"' + (preference === 'quiet' ? ' selected' : '') + '>控えめ</option></select></div>' +
        '<p id="presentation-motion-note" data-presentation-note>' + note() + '</p>' +
        '<div class="presentation-setting-row presentation-text-row"><label id="presentation-text-label" for="presentation-text-size">文字の大きさ</label>' +
        '<select id="presentation-text-size" class="select" data-presentation-text-select aria-describedby="presentation-text-note">' +
        '<option value="standard"' + (textSize === 'standard' ? ' selected' : '') + '>標準</option>' +
        '<option value="large"' + (textSize === 'large' ? ' selected' : '') + '>大きめ</option></select></div>' +
        '<p id="presentation-text-note">本文や説明を読みやすい大きさに切り替えます。この端末の表示設定です。</p></section>';
    }
    function change(event) {
      if (event.target?.matches?.('[data-presentation-select]')) setMotion(event.target.value);
      else if (event.target?.matches?.('[data-presentation-text-select]')) setTextSize(event.target.value);
    }
    function systemChange() { if (!disposed) apply(true); }
    doc.addEventListener?.('change', change);
    if (media?.addEventListener) media.addEventListener('change', systemChange);
    else media?.addListener?.(systemChange);
    apply();
    return {
      settingsMarkup, setMotion, setTextSize,
      getPreference: () => preference,
      getEffectiveMotion: effective,
      getTextSize: () => textSize,
      destroy() {
        if (disposed) return;
        disposed = true;
        doc.removeEventListener?.('change', change);
        if (media?.removeEventListener) media.removeEventListener('change', systemChange);
        else media?.removeListener?.(systemChange);
      }
    };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { STORAGE_KEY, readMotionPreference, readPresentationPreferences, createPresentation };
  if (global.document && !global.SengokuPresentation) global.SengokuPresentation = createPresentation(global);
})(typeof window !== 'undefined' ? window : globalThis);
