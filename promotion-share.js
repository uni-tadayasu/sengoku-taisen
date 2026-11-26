/* User-initiated copying and native sharing. No trackers or remote SDKs. */
(function () {
  'use strict';
  for (const button of document.querySelectorAll('[data-copy-target]')) {
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
      try {
        if (!navigator.clipboard?.writeText) throw Error('Clipboard unavailable');
        await navigator.clipboard.writeText(field.value);
        if (status) status.textContent = 'コピーしました。紹介したい場所に貼り付けてください。';
      } catch {
        field.focus({preventScroll:true});
        field.select();
        field.setSelectionRange?.(0, field.value.length);
        let copied = false;
        try { copied = document.execCommand?.('copy') === true; } catch {}
        if (status) status.textContent = copied ? 'コピーしました。紹介したい場所に貼り付けてください。' : '文章を選択しました。端末のコピー操作で保存してください。';
        if (copied) button.focus({preventScroll:true});
      } finally {
        button.disabled = false;
      }
    });
  }
  for (const panel of document.querySelectorAll('[data-share-url]')) {
    const button = panel.querySelector('[data-share-native]');
    if (!button || typeof navigator.share !== 'function') continue;
    const status = panel.querySelector('.promotion-share-status');
    button.hidden = false;
    button.addEventListener('click', async () => {
      button.disabled = true;
      if (status) status.textContent = '';
      try {
        await navigator.share({title:panel.dataset.shareTitle, text:panel.dataset.shareText, url:panel.dataset.shareUrl});
        if (status) status.textContent = '端末の共有機能へ渡しました。送信先の画面でご確認ください。';
      } catch (error) {
        if (status) status.textContent = error?.name === 'AbortError' ? '' : '共有画面を開けませんでした。URLのコピーをご利用ください。';
      } finally {
        button.disabled = false;
      }
    });
  }
})();
