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
  return {form, open: () => onDocumentClick({target: button})};
}

(async () => {
  runScript('operator-template-launcher.js');
  const picker = context.window.SengokuOperatorTemplatePicker;
  assert.equal(picker.launcher(), '');
  assert.equal(requested.length, 0, 'Ordinary visitors do not request operator resources');
  owner.isAdmin = true;
  const mail = composer(true);
  let opening = mail.open();
  assert.equal(requested.length, 3);
  const catalogResource = requested.find(resource => resource.src?.startsWith('operator-message-templates.js?'));
  assert(catalogResource);
  for (const resource of requested) {
    assert((resource.src || resource.href).endsWith('?v=test-release'));
    finish(resource, resource === catalogResource);
  }
  await opening;
  assert.equal($('#operator-template-dialog'), null, 'Failed resource loads leave the draft intact');
  opening = mail.open();
  assert.equal(requested.length, 4, 'Retry only the failed resource');
  owner.privilegeEpoch++;
  finish(requested.at(-1));
  await opening;
  assert.equal($('#operator-template-dialog'), null, 'An earlier click cannot open a new account or privilege context');

  const catalog = context.window.SengokuOperatorMessageTemplates;
  assert.equal(catalog.length, 100);
  for (const key of ['id', 'title', 'body']) assert.equal(new Set(catalog.map(row => row[key])).size, 100, key);
  assert(catalog.every(row => row.category.trim() && row.title.trim() && row.body.trim()));
  assert(catalog.every(row => row.body.length <= 200 && row.title.length <= 60), 'All drafts fit the shortest supported fields');

  for (const [composerView, row] of [[mail, catalog[0]], [composer(false), catalog.at(-1)]]) {
    const {form, open} = composerView;
    const changed = [];
    form.addEventListener('input', event => changed.push(event.target));
    form.addEventListener('submit', () => assert.fail('Template insertion submitted the message'));
    await open();
    $('[data-template-close]').dispatchEvent({type: 'click'});
    assert.equal(form.querySelector('textarea').value, '元の本文');
    await open();
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
  const revoked = composer(false);
  await revoked.open();
  owner.isAdmin = false;
  $('[data-template-apply]').dispatchEvent({type: 'click'});
  assert($('[data-template-apply]').disabled);
  assert.equal(revoked.form.querySelector('textarea').value, '元の本文');
  assert.equal(requested.length, 4, 'Successful assets are reused across composers');
  console.log('PASS all 100 operator templates, lazy retry, account changes, preview and manual draft insertion.');
})().catch(error => { console.error(error); process.exitCode = 1; });
