/* Guard page selection and desktop context menus. Normal pointer, keyboard,
   clipboard and zoom controls keep their existing handlers/defaults. */
(function (global) {
  'use strict';
  const nonTextInputs = new Set(['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'hidden', 'image']);
  function allowsSelection(target) {
    const element = target?.nodeType === 3 ? target.parentElement : target;
    for (let node = element; node; node = node.parentElement) {
      const tag = String(node.localName || node.tagName || '').toLowerCase();
      if (['textarea', 'select', 'option', 'optgroup'].includes(tag)) return true;
      if (tag === 'input') return !nonTextInputs.has(String(node.type || 'text').toLowerCase());
      const editable = node.getAttribute?.('contenteditable');
      if (editable != null) {
        const value = String(editable).toLowerCase();
        if (value === 'false') return false;
        if (['', 'true', 'plaintext-only'].includes(value)) return true;
      }
    }
    return element?.isContentEditable === true;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { allowsSelection };
  const doc = global.document;
  if (!doc || global.SengokuSelectionLock) return;
  global.SengokuSelectionLock = { allowsSelection };
  doc.addEventListener('selectstart', event => {
    // composedPath preserves the actual input/editor for open shadow roots;
    // text nodes and inherited contenteditable boundaries are handled above.
    const target = event.composedPath?.()[0] || event.target;
    if (!allowsSelection(target) && event.cancelable !== false) event.preventDefault();
  }, { capture: true, passive: false });
  doc.addEventListener('contextmenu', event => {
    // A real mouse also works on touch-capable PCs. Keep touch-only text
    // editing menus available; artwork has its own gesture protection.
    if (event.pointerType === 'touch') return;
    const mouse = event.pointerType === 'mouse' || event.button === 2;
    const desktop = global.matchMedia?.('(any-pointer: fine)')?.matches
      ?? !global.navigator?.maxTouchPoints;
    if ((mouse || desktop) && event.cancelable !== false) event.preventDefault();
  }, { capture: true, passive: false });
})(typeof window !== 'undefined' ? window : globalThis);
