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
function fixture(file = 'guide/index.html', { mobile = false } = {}) {
  const { doc } = setup(), frames = new Map(), handlers = new Map(), documentHandlers = new Map(); let sequence = 0, measurements = 0;
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  doc.body.className = 'public-luxury';
  doc.body.innerHTML = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)[1];
  doc.documentElement = { clientHeight: 800, scrollHeight: 10000 };
  doc.getElementById = id => doc.querySelector('#' + id);
  const media = { matches: mobile, addEventListener() {} };
  const win = { scrollY: 0, layoutShift: 0, matchMedia: () => media, addEventListener: (type, fn) => { if (!handlers.has(type)) handlers.set(type, []); handlers.get(type).push(fn); } };
  doc.addEventListener = (type, fn) => { if (!documentHandlers.has(type)) documentHandlers.set(type, []); documentHandlers.get(type).push(fn); };
  const links = [...doc.querySelectorAll('.toc-chapters a')], destinations = links.map(link => doc.getElementById(link.hash.slice(1))).filter(Boolean);
  destinations.forEach((target, index) => { target.getBoundingClientRect = () => { measurements++; return { top: 600 + index * 300 + win.layoutShift - win.scrollY }; }; });
  const originalArticle = doc.querySelector('.article')?.innerHTML;
  const raf = fn => { frames.set(++sequence, fn); return sequence; };
  const run = () => vm.runInNewContext(source, { document: doc, window: win, requestAnimationFrame: raf });
  const drain = () => { let count = 0; while (frames.size) { assert(count++ < 5, 'Reader must not run a recurring animation loop'); const [id, fn] = frames.entries().next().value; frames.delete(id); fn(); } };
  const dispatch = type => { for (const fn of handlers.get(type) || []) fn(); };
  const dispatchDocument = (type, detail = {}) => { const event = { type, target: doc.body, preventDefault() { this.defaultPrevented = true; }, ...detail }; for (const fn of documentHandlers.get(type) || []) fn(event); return event; };
  const search = value => { const input = doc.getElementById('public-chapter-query'); input.value = value; input.dispatchEvent({ type: 'input' }); };
  run(); drain();
  return { doc, win, links, destinations, frames, originalArticle, drain, dispatch, dispatchDocument, search, run, measurements: () => measurements, get: selector => doc.querySelector(selector) };
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
test('search clears without replacing the input and keyboard navigation respects Japanese composition', () => {
  const f = fixture(), input = f.get('#public-chapter-query'), clear = f.get('.public-search-clear');
  assert(clear.disabled); input.focus(); f.search('兵士'); assert(!clear.disabled);
  const first = f.links.find(link => !link.closest('li').hidden);
  input.dispatchEvent({ type: 'keydown', key: 'ArrowDown', isComposing: true }); assert.equal(f.doc.activeElement, input);
  input.dispatchEvent({ type: 'keydown', key: 'ArrowDown' }); assert.equal(f.doc.activeElement, first);
  clear.dispatchEvent({ type: 'click' }); assert.equal(input.value, ''); assert.equal(f.doc.activeElement, input); assert(clear.disabled);
  f.search('見つからないzzzz'); input.dispatchEvent({ type: 'keydown', key: 'Escape' });
  assert.equal(input.value, ''); assert(f.links.every(link => !link.closest('li').hidden)); assert(f.get('.public-search-empty').hidden);
  assert.equal(f.get('#public-chapter-query'), input); assert.equal(f.get('.article').innerHTML, f.originalArticle);
});
test('chapter search waits for Japanese composition and applies the committed query only once', () => {
  const f = fixture(), input = f.get('#public-chapter-query'), list = f.get('#public-chapter-list'); input.focus();
  const initialStatus = f.get('.public-search-status').textContent;
  input.value = '兵'; input.dispatchEvent({ type: 'input', isComposing: true });
  assert(f.links.every(link => !link.closest('li').hidden)); assert.equal(f.get('.public-search-status').textContent, initialStatus); assert.equal(f.frames.size, 0);
  input.value = '兵士'; input.dispatchEvent({ type: 'compositionend' });
  assert.equal(f.links.filter(link => !link.closest('li').hidden).length, 2); assert.equal(f.frames.size, 1); f.drain();
  const measurements = f.measurements(); list.scrollTop = 77;
  input.dispatchEvent({ type: 'input', isComposing: false });
  assert.equal(f.frames.size, 0); assert.equal(f.measurements(), measurements); assert.equal(list.scrollTop, 77, 'The trailing input event must preserve the reader’s place');
  assert.equal(f.doc.activeElement, input);
  f.search('ｐｃ'); f.drain(); list.scrollTop = 53; f.search(' PC ');
  assert.equal(f.frames.size, 0); assert.equal(list.scrollTop, 53, 'Equivalent normalized queries do not repeat the search');
  f.get('.public-search-clear').dispatchEvent({ type: 'click' }); assert(f.links.every(link => !link.closest('li').hidden)); assert.equal(input.value, '');
});
test('scrolling reuses chapter geometry and a later layout change refreshes the current chapter', () => {
  const f = fixture(), initialMeasurements = f.measurements();
  assert.equal(initialMeasurements, f.links.length);
  f.win.scrollY = 1000; f.dispatch('scroll'); f.drain();
  assert.equal(f.get('.public-current-chapter a').textContent, f.links[2].textContent);
  assert.equal(f.get('.public-current-chapter a').href, f.links[2].hash);
  for (let index = 0; index < 20; index++) f.dispatch('scroll'); f.drain();
  assert.equal(f.measurements(), initialMeasurements, 'Scrolling must not measure every chapter again');
  f.win.layoutShift = 1000; f.dispatchDocument('load'); f.drain();
  assert.equal(f.measurements(), initialMeasurements * 2);
  assert(f.links.every(link => !link.hasAttribute('aria-current')));
  f.run(); f.drain();
  assert.equal(f.doc.querySelectorAll('.public-chapter-search').length, 1, 'Reinitialization cannot duplicate controls');
});
test('compact public navigation closes with outside click, keyboard escape and focus leaving the header', () => {
  const f = fixture('sengoku-vs/index.html', { mobile: true }), menu = f.get('.public-nav-toggle');
  menu.dispatchEvent({ type: 'click' }); assert.equal(menu.getAttribute('aria-expanded'), 'true');
  f.dispatchDocument('click', { target: f.get('#content') }); assert.equal(menu.getAttribute('aria-expanded'), 'false');
  menu.dispatchEvent({ type: 'click' });
  const event = f.dispatchDocument('keydown', { key: 'Escape' });
  assert(event.defaultPrevented); assert.equal(menu.getAttribute('aria-expanded'), 'false'); assert.equal(f.doc.activeElement, menu);
  menu.dispatchEvent({ type: 'click' }); f.dispatchDocument('focusin', { target: f.get('.footer-brand') });
  assert.equal(menu.getAttribute('aria-expanded'), 'false');
});
test('each guide chapter leads to its real next chapter and the final chapter ends at the index', () => {
  for (const file of ['guide/index.html', 'guide/data-recovery/index.html', 'about/index.html']) {
    const f = fixture(file), sections = f.doc.querySelectorAll('.article-section');
    for (let index = 0; index < sections.length; index++) {
      const next = sections[index].querySelector('.section-next');
      if (index === sections.length - 1) assert.equal(next, null);
      else {
        const target = sections[index + 1], link = f.links.find(item => item.hash === '#' + target.id);
        assert(next); assert(link); assert.equal(next.href, link.hash); assert.equal(next.querySelector('strong').textContent, link.textContent);
      }
    }
  }
});
console.log(passed + ' public reader checks passed.');
