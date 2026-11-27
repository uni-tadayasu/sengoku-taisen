(function (global) {
  'use strict';
  const doc = global.document, resources = new Map();
  const context = () => global.SengokuSocial?.getPromotionContext?.();
  const available = () => context()?.isAdmin === true;
  const label = '文書テンプレート';
  function launcher() {
    return available()
      ? '<button type="button" class="button small operator-template-launcher" data-operator-template aria-haspopup="dialog">文書テンプレート</button>'
      : '';
  }
  function load(file) {
    if (resources.has(file)) return resources.get(file);
    const promise = new Promise((resolve, reject) => {
      const css = file.endsWith('.css'), element = doc.createElement(css ? 'link' : 'script');
      const manifest = doc.querySelector('link[rel="manifest"]')?.getAttribute('href') || '';
      const url = file + (manifest.match(/\?v=[\w.-]+$/)?.[0] || '');
      element.onload = () => {
        if (!css) element.remove();
        const ready = css || (file === 'operator-message-templates.js'
          ? global.SengokuOperatorMessageTemplates?.length > 0
          : typeof global.SengokuOpenOperatorTemplatePicker === 'function');
        if (ready) resolve(); else reject(new Error(file));
      };
      element.onerror = () => { element.remove(); reject(new Error(file)); };
      if (css) { element.rel = 'stylesheet'; element.href = url; }
      else element.src = url;
      doc.head.append(element);
    }).catch(error => { resources.delete(file); throw error; });
    resources.set(file, promise);
    return promise;
  }
  doc?.addEventListener('click', async event => {
    const button = event.target.closest?.('[data-operator-template]');
    if (!button || button.disabled || button.hasAttribute('aria-busy') || doc.getElementById('operator-template-dialog')) return;
    const owner = context();
    if (!owner?.isAdmin) return;
    button.setAttribute('aria-busy', 'true');
    button.textContent = 'テンプレート読込中…';
    try {
      await Promise.all([load('operator-template-picker.css'), load('operator-message-templates.js'), load('operator-template-picker.js')]);
      const current = context();
      button.textContent = label;
      if (current?.isAdmin && current.playerId === owner.playerId && current.epoch === owner.epoch &&
          current.accountEpoch === owner.accountEpoch && current.privilegeEpoch === owner.privilegeEpoch &&
          button.isConnected && !button.disabled && !button.closest('dialog:not([open]),[hidden],[inert]') &&
          !doc.getElementById('operator-template-dialog')) global.SengokuOpenOperatorTemplatePicker(button);
    } catch {
      button.textContent = 'テンプレート読込失敗・再試行';
    } finally { button.removeAttribute('aria-busy'); }
  });
  global.SengokuOperatorTemplatePicker = {launcher, available};
})(typeof window !== 'undefined' ? window : globalThis);
