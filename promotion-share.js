/* User-initiated copying and native sharing. No trackers or remote SDKs. */
(function () {
  'use strict';
  const defaultCopiedMessage = 'コピーしました。紹介したい場所に貼り付けてください。';
  function focusWithoutScroll(element) {
    try { element.focus({preventScroll:true}); }
    catch { try { element.focus(); } catch {} }
  }
  for (const button of document.querySelectorAll('[data-copy-target]')) {
    const copiedMessage = button.dataset.copySuccess || defaultCopiedMessage;
    const field = document.getElementById(button.dataset.copyTarget);
    if (!field || !['INPUT', 'TEXTAREA'].includes(field.tagName)) continue;
    const block = button.closest('.press-copy-block, .promotion-copy-block');
    const status = block?.querySelector('.promotion-copy-status');
    if (status && field.id) {
      status.id ||= field.id + '-status';
      field.setAttribute('aria-describedby', status.id);
    }
    button.hidden = false;
    button.addEventListener('click', async () => {
      button.disabled = true;
      if (status) status.textContent = '';
      let restoreButtonFocus = false;
      try {
        if (!navigator.clipboard?.writeText) throw Error('Clipboard unavailable');
        await navigator.clipboard.writeText(field.value);
        if (status) status.textContent = copiedMessage;
        restoreButtonFocus = true;
      } catch {
        focusWithoutScroll(field);
        let selected = false;
        try { field.select(); selected = true; } catch {}
        try {
          if (field.setSelectionRange) {
            field.setSelectionRange(0, field.value.length);
            selected = true;
          }
        } catch {}
        let copied = false;
        // Do not copy an unrelated selection if this field could not be selected.
        if (selected) try { copied = document.execCommand?.('copy') === true; } catch {}
        if (status) status.textContent = copied ? copiedMessage : selected
          ? '文章を選択しました。端末のコピー操作で保存してください。'
          : '自動コピーできませんでした。欄内の文章を選択してコピーしてください。';
        restoreButtonFocus = copied;
      } finally {
        button.disabled = false;
        // Disabled controls cannot receive focus; restore it only after enabling.
        if (restoreButtonFocus) focusWithoutScroll(button);
      }
    });
  }
  for (const panel of document.querySelectorAll('[data-share-url]')) {
    const button = panel.querySelector('[data-share-native]');
    if (!button || typeof navigator.share !== 'function') continue;
    const data = {title:panel.dataset.shareTitle, text:panel.dataset.shareText, url:panel.dataset.shareUrl};
    try {
      if (typeof navigator.canShare === 'function' && !navigator.canShare(data)) continue;
    } catch { continue; }
    const status = panel.querySelector('.promotion-share-status');
    button.hidden = false;
    button.addEventListener('click', async () => {
      button.disabled = true;
      if (status) status.textContent = '';
      try {
        await navigator.share(data);
        if (status) status.textContent = '端末の共有機能へ渡しました。送信先の画面でご確認ください。';
      } catch (error) {
        if (status) status.textContent = error?.name === 'AbortError' ? '' : '共有画面を開けませんでした。URLのコピーをご利用ください。';
      } finally {
        button.disabled = false;
        focusWithoutScroll(button);
      }
    });
  }
})();
