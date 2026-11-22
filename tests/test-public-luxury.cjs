'use strict';
// Run the real reader script against the real public-page markup. Geometry is
// controlled here; viewport wrapping remains a separate browser inspection.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { Node, setup } = require('./helpers/dom-model.cjs');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'public-luxury.js'), 'utf8');
Object.defineProperties(Node.prototype, {
  className: { get() { return this.getAttribute('class') || ''; }, set(value) { this.setAttribute('class', value); } },
  href: { get() { return this.getAttribute('href') || ''; }, set(value) { this.setAttribute('href', value); } },
  hash: { get() { const href = this.href; return href.includes('#') ? href.slice(href.indexOf('#')) : ''; } },
  hidden: { get() { return this.hasAttribute('hidden'); }, set(value) { if (value) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); } }
});
Node.prototype.before = function (node) { this.parentNode.insertBefore(node, this); };
Node.prototype.after = function (node) { this.parentNode.insertBefore(node, this.nextSibling); };
Node.prototype.prepend = function (node) { this.insertBefore(node, this.firstChild); };
const originalMatches = Node.prototype.matches;
Node.prototype.matches = function (selector, scope) {
  if (selector === 'a[href^="#"]') return this.localName === 'a' && this.href.startsWith('#');
  return originalMatches.call(this, selector, scope);
};
function fixture(file = 'guide/index.html') {
  const { doc } = setup(), frames = new Map(), handlers = new Map(); let sequence = 0;
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  doc.body.className = 'public-luxury';
  doc.body.innerHTML = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)[1];
  doc.documentElement = { clientHeight: 800, scrollHeight: 10000 };
  doc.getElementById = id => doc.querySelector('#' + id);
  const win = { scrollY: 0, addEventListener: (type, fn) => { if (!handlers.has(type)) handlers.set(type, []); handlers.get(type).push(fn); } };
  const links = [...doc.querySelectorAll('.toc-chapters a')], destinations = links.map(link => doc.getElementById(link.hash.slice(1))).filter(Boolean);
  destinations.forEach((target, index) => { target.getBoundingClientRect = () => ({ top: 600 + index * 300 - win.scrollY }); });
  const originalArticle = doc.querySelector('.article')?.innerHTML;
  const raf = fn => { frames.set(++sequence, fn); return sequence; };
  const run = () => vm.runInNewContext(source, { document: doc, window: win, requestAnimationFrame: raf });
  const drain = () => { let count = 0; while (frames.size) { assert(count++ < 5, 'Reader must not run a recurring animation loop'); const [id, fn] = frames.entries().next().value; frames.delete(id); fn(); } };
  const dispatch = type => { for (const fn of handlers.get(type) || []) fn(); };
  const search = value => { const input = doc.getElementById('public-chapter-query'); input.value = value; input.dispatchEvent({ type: 'input' }); };
  run(); drain();
  return { doc, win, links, destinations, frames, originalArticle, drain, dispatch, search, get: selector => doc.querySelector(selector) };
}
let passed = 0;
function test(name, run) { run(); passed++; console.log('PASS ' + name); }
test('all three real reading pages get labelled search and retain article content and chapter links', () => {
  for (const file of ['guide/index.html', 'guide/data-recovery/index.html', 'about/index.html']) {
    const f = fixture(file), input = f.doc.getElementById('public-chapter-query');
    assert(input, file); assert.equal(input.getAttribute('aria-controls'), 'public-chapter-list');
    assert.equal(f.get('.public-chapter-search label').getAttribute('for'), input.id);
    assert.equal(f.get('.article').innerHTML, f.originalArticle);
    assert(f.links.length > 0); assert(f.links.every(link => f.doc.getElementById(link.hash.slice(1))), 'Every filtered entry still links to its real section');
    assert.equal(f.get('.public-back-top').href, '#content');
    assert(f.doc.getElementById('content'));
  }
});
test('chapter search filters only the index, handles no results, and clearing restores all chapters', () => {
  const f = fixture();
  f.search('兵士');
  const visible = f.links.filter(link => !link.closest('li').hidden);
  assert.equal(visible.length, 2); assert(visible.every(link => /兵士/.test(link.textContent)));
  assert.equal(f.get('.toc-chapters').open, true);
  assert.match(f.get('.public-search-status').textContent, /^2件/);
  assert.equal(f.get('.article').innerHTML, f.originalArticle, 'Search must never hide or rewrite guide content');
  f.search('マナーモード');
  assert(f.links.some(link => !link.closest('li').hidden && link.href === '#questions'));
  assert.match(f.get('.public-search-status').textContent, /^本文に含まれる項目/);
  f.search('見つからないzzzz');
  assert(f.links.every(link => link.closest('li').hidden)); assert.equal(f.get('.public-search-empty').hidden, false);
  f.search('');
  assert(f.links.every(link => !link.closest('li').hidden)); assert.equal(f.get('.public-search-empty').hidden, true);
  assert.match(f.get('.public-search-status').textContent, new RegExp('全' + f.links.length + '項目'));
  f.search('ｐｃ');
  assert(f.links.some(link => !link.closest('li').hidden && link.textContent.includes('PC')), 'Full-width terms must find Latin chapter names');
});
test('scroll updates only one active chapter and clamps progress without an idle animation loop', () => {
  const f = fixture(), bar = f.get('.public-reading-progress').firstElementChild;
  assert.equal(f.links.filter(link => link.hasAttribute('aria-current')).length, 0);
  f.win.scrollY = 1000;
  for (let index = 0; index < 20; index++) f.dispatch('scroll');
  assert.equal(f.frames.size, 1, 'A burst of scrolls must share one frame'); f.drain();
  let active = f.links.filter(link => link.getAttribute('aria-current') === 'location');
  assert.equal(active.length, 1); assert.equal(active[0], f.links[2]);
  f.win.scrollY = 4600; f.dispatch('scroll'); f.drain(); assert.equal(bar.style.transform, 'scaleX(0.5000)');
  f.win.scrollY = 12000; f.dispatch('scroll'); f.drain(); assert.equal(bar.style.transform, 'scaleX(1.0000)');
  f.win.scrollY = -20; f.dispatch('scroll'); f.drain(); assert.equal(bar.style.transform, 'scaleX(0.0000)');
  assert(f.links.every(link => !link.hasAttribute('aria-current')));
  assert.equal(f.frames.size, 0);
  f.doc.documentElement.scrollHeight = 800; f.dispatch('resize'); f.drain(); assert.equal(bar.style.transform, 'scaleX(0.0000)');
});
test('nonreading public pages remain untouched by the reading controller', () => {
  for (const file of ['premium/index.html', 'sengoku-vs/index.html']) {
    const f = fixture(file);
    assert.equal(f.get('.public-chapter-search'), null); assert.equal(f.get('.public-reading-progress'), null); assert.equal(f.frames.size, 0);
  }
});
console.log(passed + ' public reader checks passed.');
