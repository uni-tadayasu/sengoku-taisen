/* User-initiated copying and native sharing. No trackers or remote SDKs. */
(function () {
  'use strict';
  const english = document.documentElement?.lang === 'en';
  const messages = english ? {
    copied: 'Copied. Paste it wherever you want to share.',
    selected: 'Text selected. Use your device’s copy command.',
    unavailable: 'Automatic copy is unavailable. Select the text and copy it.',
    shared: 'Opened your device’s share sheet. Check the destination app.',
    shareFailed: 'Could not open the share sheet. Use Copy link instead.'
  } : {
    copied: 'コピーしました。紹介したい場所に貼り付けてください。',
    selected: '文章を選択しました。端末のコピー操作で保存してください。',
    unavailable: '自動コピーできませんでした。欄内の文章を選択してコピーしてください。',
    shared: '端末の共有機能へ渡しました。送信先の画面でご確認ください。',
    shareFailed: '共有画面を開けませんでした。URLのコピーをご利用ください。'
  };
  function focusWithoutScroll(element) {
    try { element.focus({preventScroll:true}); }
    catch { try { element.focus(); } catch {} }
  }
  for (const button of document.querySelectorAll('[data-copy-target]')) {
    const copiedMessage = button.dataset.copySuccess || messages.copied;
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
          ? messages.selected : messages.unavailable;
        restoreButtonFocus = copied;
      } finally {
        button.disabled = false;
        // Disabled controls cannot receive focus; restore it only after enabling.
        if (restoreButtonFocus) focusWithoutScroll(button);
      }
    });
  }
  for (const panel of document.querySelectorAll('[data-share-url]')) {
    const presets = panel.querySelector('[data-share-presets]');
    if (presets && typeof presets.querySelectorAll === 'function') {
      const choices = [...presets.querySelectorAll('[data-share-preset]')];
      const message = panel.querySelector('[data-share-message]');
      const xLink = panel.querySelector('a[data-share-x]');
      const lineLink = panel.querySelector('a[data-share-line]');
      if (message?.tagName === 'TEXTAREA' && choices.length) {
        presets.hidden = false;
        for (const choice of choices) choice.addEventListener('click', () => {
          message.value = choice.dataset.shareCopy;
          panel.dataset.shareText = choice.dataset.shareText;
          panel.dataset.shareUrl = choice.dataset.shareNativeUrl;
          if (xLink) xLink.href = choice.dataset.shareX;
          if (lineLink) lineLink.href = choice.dataset.shareLine;
          for (const other of choices) other.setAttribute('aria-pressed', String(other === choice));
          const status = message.closest('.promotion-copy-block')?.querySelector('.promotion-copy-status');
          if (status) status.textContent = choice.textContent.trim() + 'の文章に切り替えました。';
          const shareStatus = panel.querySelector('.promotion-share-status');
          if (shareStatus) shareStatus.textContent = '';
        });
      }
    }
    const button = panel.querySelector('[data-share-native]');
    if (!button || typeof navigator.share !== 'function') continue;
    // Read the selected invitation when the user opens the share sheet, not
    // when the page loads; otherwise the native share silently uses old copy.
    const shareData = () => ({title:panel.dataset.shareTitle, text:panel.dataset.shareText, url:panel.dataset.shareUrl});
    try {
      if (typeof navigator.canShare === 'function' && !navigator.canShare(shareData())) continue;
    } catch { continue; }
    const status = panel.querySelector('.promotion-share-status');
    button.hidden = false;
    button.addEventListener('click', async () => {
      button.disabled = true;
      if (status) status.textContent = '';
      try {
        await navigator.share(shareData());
        if (status) status.textContent = messages.shared;
      } catch (error) {
        if (status) status.textContent = error?.name === 'AbortError' ? '' : messages.shareFailed;
      } finally {
        button.disabled = false;
        focusWithoutScroll(button);
      }
    });
  }
})();
