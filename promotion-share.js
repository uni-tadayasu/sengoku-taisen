/* User-initiated copying and native sharing. No trackers or remote SDKs. */
(function () {
  'use strict';
  for (const button of document.querySelectorAll('[data-copy-target]')) {
    const field = document.getElementById(button.dataset.copyTarget);
    if (!field || !['INPUT', 'TEXTAREA'].includes(field.tagName)) continue;
    const block = button.closest('.press-copy-block, .promotion-copy-block');
    const status = block?.querySelector('.promotion-copy-status');
    button.hidden = false;
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        if (!navigator.clipboard?.writeText) throw Error('Clipboard unavailable');
        await navigator.clipboard.writeText(field.value);
        if (status) status.textContent = 'コピーしました。紹介したい場所に貼り付けてください。';
      } catch {
        field.focus();
        field.select();
        if (status) status.textContent = '文章を選択しました。端末のコピー操作で保存してください。';
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
