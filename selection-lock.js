/* Only text selection is intercepted. Pointer, touch, double-click, keyboard,
   clipboard and browser zoom events retain their existing handlers/defaults. */
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
})(typeof window !== 'undefined' ? window : globalThis);
