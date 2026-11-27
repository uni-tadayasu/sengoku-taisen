'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {setup, Node} = require('./helpers/dom-model.cjs');

const {doc, host} = setup();
const $ = selector => doc.querySelector(selector);
const requested = [];
const owner = {isAdmin: false, playerId: 'operator', epoch: 1, accountEpoch: 1, privilegeEpoch: 1};
let onDocumentClick;
// Native select.add and form ownership are outside the shared rendering fixture.
Node.prototype.add = Node.prototype.appendChild;
doc.getElementById = id => $('#' + id);
doc.addEventListener = (type, listener) => { if (type === 'click') onDocumentClick = listener; };
doc.head = {append: element => requested.push(element)};
host.innerHTML = '<link rel="manifest" href="manifest.webmanifest?v=test-release">';
const context = vm.createContext({window: {
  document: doc,
  SengokuSocial: {getPromotionContext: () => ({...owner})},
  Event: function(type, init) { Object.assign(this, init, {type}); },
  Option: function(label, value) {
    const node = doc.createElement('option');
    node.textContent = label;
    node.setAttribute('value', value);
    return node;
  }
}});
function runScript(file) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, {filename: file});
}
function finish(element, fail = false) {
  if (fail) return element.onerror();
  if (element.src) runScript(element.src.split('?')[0]);
  element.onload();
}
function composer(includeSubject) {
  const form = doc.createElement('form');
  form.innerHTML = '<input name="recipient" value="指定領主"><input name="gift" value="99">' +
    (includeSubject ? '<input name="title" value="元の件名">' : '') +
    '<textarea id="message">元の本文</textarea>' + context.window.SengokuOperatorTemplatePicker.launcher();
  host.append(form);
  const button = form.querySelector('[data-operator-template]');
  button.form = form;
  return {form, button, open: () => onDocumentClick({target: button})};
}

(async () => {
  runScript('operator-template-launcher.js');
  const picker = context.window.SengokuOperatorTemplatePicker;
  assert.equal(picker.launcher(), '');
  assert.equal(requested.length, 0, 'Ordinary visitors do not request operator resources');
  owner.isAdmin = true;
  const mail = composer(true);
  // Artwork decorates every button and leaves aria-busy="false" after painting.
  mail.button.setAttribute('aria-busy', 'false');
  let opening = mail.open();
  assert.equal(requested.length, 3, 'A painted button still starts loading its templates');
  const catalogResource = requested.find(resource => resource.src?.startsWith('operator-message-templates.js?'));
  assert(catalogResource);
  for (const resource of requested) {
    assert((resource.src || resource.href).endsWith('?v=test-release'));
    finish(resource, resource === catalogResource);
  }
  await opening;
  assert.equal($('#operator-template-dialog'), null, 'Failed resource loads leave the draft intact');
  assert.equal(mail.form.querySelector('textarea').value, '元の本文');
  assert.equal(mail.form.querySelector('[name="title"]').value, '元の件名');
  assert.equal(mail.button.textContent, 'テンプレート読込失敗・再試行');
  // A background image may be loading independently of the template resources.
  mail.button.setAttribute('aria-busy', 'true');
  opening = mail.open();
  assert.equal(requested.length, 4, 'Background artwork does not block retrying the failed resource');
  owner.privilegeEpoch++;
  // Artwork finishing must not clear the template request's own pending state.
  // Otherwise the second click captures the new privilege epoch and opens a
  // picker even though the original request must be discarded below.
  mail.button.setAttribute('aria-busy', 'false');
  const repeatedClick = mail.open();
  finish(requested.at(-1));
  await Promise.all([opening, repeatedClick]);
  assert.equal(Boolean($('#operator-template-dialog')), false, 'Repeated clicks while loading cannot bypass a changed account or privilege context');

  const catalog = context.window.SengokuOperatorMessageTemplates;
  assert.equal(catalog.length, 100);
  for (const key of ['id', 'title', 'body']) assert.equal(new Set(catalog.map(row => row[key])).size, 100, key);
  assert(catalog.every(row => row.category.trim() && row.title.trim() && row.body.trim()));
  assert(catalog.every(row => row.body.length <= 200 && row.title.length <= 60), 'All drafts fit the shortest supported fields');

  for (const [composerView, row] of [[mail, catalog[0]], [composer(false), catalog.at(-1)]]) {
    const {form, button, open} = composerView;
    const changed = [];
    form.addEventListener('input', event => changed.push(event.target));
    form.addEventListener('submit', () => assert.fail('Template insertion submitted the message'));
    button.setAttribute('aria-busy', 'false');
    await open();
    assert($('#operator-template-dialog')?.open, 'A painted button opens the picker');
    $('[data-template-close]').dispatchEvent({type: 'click'});
    assert.equal(form.querySelector('textarea').value, '元の本文');
    button.setAttribute('aria-busy', 'true');
    await open();
    assert($('#operator-template-dialog')?.open, 'The picker reopens while button artwork is loading');
    const category = $('#operator-template-category'), search = $('#operator-template-query');
    category.value = row.category;
    category.dispatchEvent({type: 'change'});
    search.value = row.title;
    search.dispatchEvent({type: 'input'});
    assert.equal($('#operator-template-list').value, row.id);
    assert.equal($('[data-template-preview]').textContent, row.body);
    $('[data-template-apply]').dispatchEvent({type: 'click'});
    const body = form.querySelector('textarea'), title = form.querySelector('[name="title"]');
    assert.equal(body.value, row.body);
    if (title) assert.equal(title.value, row.title);
    assert.deepEqual(changed, title ? [title, body] : [body]);
    assert.equal(form.querySelector('[name="recipient"]').value, '指定領主');
    assert.equal(form.querySelector('[name="gift"]').value, '99');
    assert.equal(doc.activeElement, body);
    form.remove();
  }
  owner.isAdmin = false;
  owner.canOperate = true;
  owner.privilegeEpoch++;
  assert(picker.available(), 'A deputy can open message templates without being the principal');
  const deputy = composer(true);
  await deputy.open();
  assert($('#operator-template-dialog')?.open);
  $('[data-template-apply]').dispatchEvent({type: 'click'});
  assert.notEqual(deputy.form.querySelector('textarea').value, '元の本文');
  assert.equal(owner.isAdmin, false);
  deputy.form.remove();
  const revoked = composer(false);
  await revoked.open();
  owner.canOperate = false;
  owner.isAdmin = false;
  owner.privilegeEpoch++;
  $('[data-template-apply]').dispatchEvent({type: 'click'});
  assert($('[data-template-apply]').disabled);
  assert.equal(revoked.form.querySelector('textarea').value, '元の本文');
  assert.equal(requested.length, 4, 'Successful assets are reused across composers');
  console.log('PASS all 100 operator templates, artwork loading conflicts, repeated clicks, lazy retry, account changes, preview and manual draft insertion.');
})().catch(error => { console.error(error); process.exitCode = 1; });
