'use strict';

// Regression checks for copy/share recovery on browsers that deny native APIs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../promotion-share.js'), 'utf8');
function fixture(options = {}) {
  const calls = { copy: 0, native: 0, clipboard: [], focused: null };
  const copyStatus = { textContent: '', id: '' }, shareStatus = { textContent: '' };
  const button = {
    dataset: { copyTarget: 'game-share-url', copySuccess: options.copySuccess }, hidden: true, disabled: false,
    closest: () => ({ querySelector: () => copyStatus }),
    addEventListener: (type, fn) => { button[type] = fn; },
    focus: () => { if (!button.disabled) calls.focused = button; }
  };
  const field = {
    id: 'game-share-url', tagName: 'INPUT', value: options.fieldValue || 'https://www.kasai-solutions-inc.com/sengoku-vs/',
    setAttribute: () => {}, focus: () => { calls.focused = field; },
    select: () => { if (options.selectFails) throw Error('Selection unavailable'); },
    setSelectionRange: () => { if (options.rangeFails) throw Error('Selection range unavailable'); }
  };
  const native = {
    hidden: true, disabled: false,
    addEventListener: (type, fn) => { native[type] = fn; },
    focus: () => { if (!native.disabled) calls.focused = native; }
  };
  const panel = {
    dataset: { shareTitle: '戦国VS', shareText: '一城から、天下へ。', shareUrl: field.value },
    querySelector: selector => selector === '[data-share-native]' ? native : shareStatus
  };
  const navigator = {};
  if (!options.clipboardMissing) navigator.clipboard = { writeText: async text => {
    if (options.clipboardDenied) throw Error('Clipboard permission denied');
    calls.clipboard.push(text);
  } };
  if (!options.shareMissing) navigator.share = async data => {
    calls.native++;
    calls.shareData = data;
    if (options.shareError) throw Object.assign(Error('Share closed'), {name: options.shareError});
  };
  if ('canShare' in options) navigator.canShare = () => options.canShare;
  const document = {
    querySelectorAll: selector => selector === '[data-copy-target]' ? [button] : [panel],
    getElementById: () => field,
    execCommand: () => { calls.copy++; return options.legacyCopy !== false; }
  };
  vm.runInNewContext(source, { navigator, document });
  return { calls, button, field, copyStatus, native, shareStatus };
}

(async () => {
  let h = fixture();
  await h.button.click();
  assert.deepEqual(h.calls.clipboard, [h.field.value]);
  assert.equal(h.calls.copy, 0);
  assert.equal(h.calls.focused, h.button, 'Native copy must return to the button without focusing the URL field');
  assert.equal(h.button.disabled, false);

  h = fixture({ clipboardDenied: true });
  await h.button.click();
  assert.equal(h.calls.copy, 1);
  assert.equal(h.calls.focused, h.button, 'Restore keyboard focus after the copy button is enabled');
  assert.match(h.copyStatus.textContent, /コピーしました/);

  h = fixture({ clipboardMissing: true, rangeFails: true });
  await h.button.click();
  assert.equal(h.calls.copy, 1, 'A failed range API must not discard a successful normal selection');
  assert.match(h.copyStatus.textContent, /コピーしました/);

  h = fixture({ clipboardMissing: true, selectFails: true, rangeFails: true });
  await h.button.click();
  assert.equal(h.calls.copy, 0, 'An old unrelated page selection must never be copied');
  assert.match(h.copyStatus.textContent, /自動コピーできません/);
  assert.equal(h.button.disabled, false);

  h = fixture({ clipboardDenied: true, legacyCopy: false });
  await h.button.click();
  assert.equal(h.calls.focused, h.field, 'Keep the selected text available for manual copy');
  assert.match(h.copyStatus.textContent, /端末のコピー操作/);

  // An RSS address must remain copyable even when ordinary page text is locked.
  const news = fs.readFileSync(path.join(__dirname, '../news/index.html'), 'utf8');
  const rssField = news.match(/<input\b[^>]*id="news-feed-address"[^>]*>/)?.[0];
  assert(rssField && /\breadonly\b/.test(rssField) && /\btype="text"/.test(rssField));
  const rssUrl = rssField.match(/\bvalue="([^"]+)"/)?.[1];
  const rssButton = news.match(/<button\b[^>]*data-copy-target="news-feed-address"[^>]*>/)?.[0];
  const rssMessage = rssButton?.match(/\bdata-copy-success="([^"]+)"/)?.[1];
  assert.equal(rssUrl, 'https://www.kasai-solutions-inc.com/news/feed.xml');
  assert(rssMessage && news.includes('promotion-share.js'));
  assert(require('../selection-lock.js').allowsSelection({localName:'input', type:'text'}));
  for (const clipboardDenied of [false, true]) {
    h = fixture({ fieldValue: rssUrl, copySuccess: rssMessage, clipboardDenied });
    await h.button.click();
    assert.equal(h.copyStatus.textContent, rssMessage);
    assert.equal(h.button.disabled, false);
  }

  assert.equal(fixture({ shareMissing: true }).native.hidden, true);
  assert.equal(fixture({ canShare: false }).native.hidden, true, 'Do not offer a rejected native share payload');
  h = fixture({ canShare: true });
  assert.equal(h.native.hidden, false);
  await h.native.click();
  assert.equal(h.calls.native, 1);
  assert.equal(h.calls.shareData.url, h.field.value);
  assert.match(h.shareStatus.textContent, /送信先の画面でご確認/);

  for (const name of ['AbortError', 'NotAllowedError']) {
    h = fixture({ shareError: name });
    await h.native.click();
    assert.equal(h.native.disabled, false, 'A cancelled or denied share must be retryable');
    assert.equal(h.calls.focused, h.native, 'Return keyboard focus when the native share dialog closes');
    if (name === 'AbortError') assert.equal(h.shareStatus.textContent, '');
    else assert.match(h.shareStatus.textContent, /URLのコピー/);
  }
  console.log('PASS promotion copy/share: native copy, permission denial, legacy selection, manual recovery, native support and cancelled/denied sharing.');
})().catch(error => { console.error(error); process.exitCode = 1; });
