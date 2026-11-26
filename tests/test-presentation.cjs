'use strict';
const assert = require('node:assert/strict');
const { STORAGE_KEY, readMotionPreference, readPresentationPreferences, createPresentation } = require('../presentation.js');
function fixture({ raw = null, systemQuiet = false, blockedRead = false, blockedWrite = false, legacyMedia = false } = {}) {
  const attributes = new Map(), handlers = new Map(), changes = [], writes = [];
  let saved = raw, mediaHandler = null;
  const control = { value: 'standard', matches: selector => selector === '[data-presentation-select]' };
  const textControl = { value: 'standard', matches: selector => selector === '[data-presentation-text-select]' };
  const note = { textContent: '' };
  const media = { matches: systemQuiet };
  if (legacyMedia) { media.addListener = fn => { mediaHandler = fn; }; media.removeListener = fn => { if (mediaHandler === fn) mediaHandler = null; }; }
  else { media.addEventListener = (type, fn) => { mediaHandler = fn; }; media.removeEventListener = (type, fn) => { if (mediaHandler === fn) mediaHandler = null; }; }
  const storage = {
    getItem(key) { assert.equal(key, STORAGE_KEY); if (blockedRead) throw Error('SecurityError'); return saved; },
    setItem(key, value) { assert.equal(key, STORAGE_KEY); if (blockedWrite) throw Error('QuotaExceededError'); saved = value; writes.push({ key, value }); }
  };
  const win = {
    document: {
      documentElement: { setAttribute: (key, value) => attributes.set(key, value) },
      querySelectorAll: selector => selector === '[data-presentation-select]' ? [control] : selector === '[data-presentation-text-select]' ? [textControl] : selector === '[data-presentation-note]' ? [note] : [],
      addEventListener: (type, fn) => handlers.set(type, fn),
      removeEventListener: (type, fn) => { if (handlers.get(type) === fn) handlers.delete(type); }
    },
    localStorage: storage,
    matchMedia: query => { assert.equal(query, '(prefers-reduced-motion: reduce)'); return media; },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    dispatchEvent: event => changes.push(event)
  };
  return {
    win, attributes, changes, writes, control, textControl, note,
    system(value) { media.matches = value; mediaHandler?.({ matches: value }); },
    select(value) { control.value = value; handlers.get('change')?.({ target: control }); },
    selectText(value) { textControl.value = value; handlers.get('change')?.({ target: textControl }); },
    getSaved: () => saved,
    hasMediaListener: () => Boolean(mediaHandler),
    hasChangeListener: () => handlers.has('change')
  };
}
let passed = 0;
function test(name, run) { run(); passed++; console.log('PASS ' + name); }
test('missing, malformed and unsupported stored settings use the standard preference', () => {
  for (const raw of [null, '', '{', 'null', '42', '"quiet"', '[{"motion":"quiet"}]', '{}', '{"motion":"slow"}', '{"motion":true}']) {
    assert.equal(readMotionPreference({ getItem: () => raw }), 'standard');
  }
  assert.equal(readMotionPreference({ getItem: () => '{"motion":"quiet"}' }), 'quiet');
});
test('quiet selection applies immediately, emits a change, and persists separately for reload', () => {
  const f = fixture(), api = createPresentation(f.win);
  assert.equal(f.attributes.get('data-presentation-motion'), 'standard');
  assert.equal(f.changes.length, 0);
  f.select('quiet');
  assert.equal(api.getPreference(), 'quiet');
  assert.equal(api.getEffectiveMotion(), 'quiet');
  assert.equal(f.attributes.get('data-presentation-motion'), 'quiet');
  assert.equal(f.changes.length, 1);
  assert.equal(f.changes[0].type, 'sengoku-presentation-change');
  assert.deepEqual(f.changes[0].detail, { motion: 'quiet', preference: 'quiet', reducedBySystem: false });
  assert.deepEqual(JSON.parse(f.getSaved()), { motion: 'quiet', textSize: 'standard' });
  const reloaded = createPresentation(fixture({ raw: f.getSaved() }).win);
  assert.equal(reloaded.getEffectiveMotion(), 'quiet');
  assert.equal(f.writes[0].key, 'sengoku-presentation-v1');
  api.setMotion('quiet'); assert.equal(f.changes.length, 1, 'unchanged selection does not replay motion clearing');
  assert.equal(api.setMotion('unsupported'), false); assert.equal(api.getPreference(), 'quiet');
});
test('system reduced motion overrides standard and live system changes keep the chosen preference', () => {
  const f = fixture({ systemQuiet: true }), api = createPresentation(f.win);
  assert.equal(api.getPreference(), 'standard');
  assert.equal(api.getEffectiveMotion(), 'quiet');
  assert.equal(f.control.value, 'standard');
  assert.match(f.note.textContent, /端末の設定/);
  api.setMotion('standard');
  assert.equal(f.attributes.get('data-presentation-motion'), 'quiet');
  f.system(false); assert.equal(api.getEffectiveMotion(), 'standard');
  assert.equal(f.attributes.get('data-presentation-motion'), 'standard');
  api.setMotion('quiet');
  f.system(true); f.system(false);
  assert.equal(api.getEffectiveMotion(), 'quiet', 'user preference remains quiet after the OS changes back');
  assert.equal(api.getPreference(), 'quiet');
});
test('blocked storage never prevents immediate local presentation changes', () => {
  const f = fixture({ blockedRead: true, blockedWrite: true }), api = createPresentation(f.win);
  assert.equal(api.getPreference(), 'standard');
  assert.doesNotThrow(() => f.select('quiet'));
  assert.equal(f.attributes.get('data-presentation-motion'), 'quiet');
  const accessorBlocked = fixture(); Object.defineProperty(accessorBlocked.win, 'localStorage', { get() { throw Error('SecurityError'); } });
  const blocked = createPresentation(accessorBlocked.win);
  assert.doesNotThrow(() => blocked.setMotion('quiet'));
  assert.equal(blocked.getEffectiveMotion(), 'quiet');
});
test('rendered settings expose a label, selected value and accessible explanation', () => {
  const f = fixture({ raw: '{"motion":"quiet"}' }), api = createPresentation(f.win);
  const markup = api.settingsMarkup();
  assert.match(markup, /for="presentation-motion">表示演出<\/label>/);
  assert.match(markup, /aria-describedby="presentation-motion-note"/);
  assert.match(markup, /<option value="quiet" selected>控えめ<\/option>/);
  assert.match(markup, /<option value="standard">標準<\/option>/);
});
test('legacy media listeners are supported and disposing stops further updates', () => {
  const f = fixture({ legacyMedia: true }), api = createPresentation(f.win);
  f.system(true); assert.equal(f.attributes.get('data-presentation-motion'), 'quiet');
  api.destroy(); api.destroy();
  assert.equal(f.hasMediaListener(), false); assert.equal(f.hasChangeListener(), false);
  assert.equal(api.setMotion('quiet'), false);
  assert.equal(api.setTextSize('large'), false);
  const count = f.changes.length; f.system(false); assert.equal(f.changes.length, count);
});
test('legacy motion preferences retain their meaning without an automatic storage rewrite', () => {
  const f = fixture({ raw: '{"motion":"quiet"}' }), api = createPresentation(f.win);
  assert.equal(api.getPreference(), 'quiet'); assert.equal(api.getTextSize(), 'standard');
  assert.equal(f.attributes.get('data-presentation-text'), 'standard');
  assert.equal(f.writes.length, 0);
  assert.deepEqual(readPresentationPreferences({getItem:()=>'{"motion":"quiet","textSize":"unknown"}'}), {motion:'quiet',textSize:'standard'});
  assert.deepEqual(readPresentationPreferences({getItem:()=>'{"motion":"unknown","textSize":"large"}'}), {motion:'standard',textSize:'large'});
});
test('text size applies immediately, reloads independently, and never resets a motion choice', () => {
  const f = fixture({ raw: '{"motion":"quiet"}' }), api = createPresentation(f.win);
  f.selectText('large');
  assert.equal(api.getTextSize(), 'large'); assert.equal(api.getPreference(), 'quiet');
  assert.equal(f.attributes.get('data-presentation-text'), 'large');
  assert.equal(f.textControl.value, 'large');
  assert.deepEqual(JSON.parse(f.getSaved()), {motion:'quiet',textSize:'large'});
  assert.equal(f.changes.length, 1); assert.equal(f.changes[0].type, 'sengoku-text-size-change');
  assert.deepEqual(f.changes[0].detail, {textSize:'large'});
  api.setTextSize('large'); assert.equal(f.changes.length, 1);
  api.setMotion('standard'); assert.deepEqual(JSON.parse(f.getSaved()), {motion:'standard',textSize:'large'});
  const reloaded=createPresentation(fixture({raw:f.getSaved()}).win);
  assert.equal(reloaded.getTextSize(),'large'); assert.equal(reloaded.getPreference(),'standard');
  assert.equal(api.setTextSize('extra-large'),false); assert.equal(api.getTextSize(),'large');
  f.selectText('standard'); assert.equal(f.attributes.get('data-presentation-text'),'standard');
  assert.equal(api.getPreference(),'standard');
});
test('large text remains independent of system reduced motion and unavailable storage', () => {
  const f=fixture({raw:'{"motion":"standard","textSize":"large"}',systemQuiet:true}),api=createPresentation(f.win);
  assert.equal(api.getEffectiveMotion(),'quiet'); assert.equal(api.getTextSize(),'large');
  f.system(false); assert.equal(api.getEffectiveMotion(),'standard'); assert.equal(api.getTextSize(),'large');
  assert.equal(f.attributes.get('data-presentation-text'),'large'); assert.equal(f.writes.length,0);
  const blocked=fixture({blockedRead:true,blockedWrite:true}),local=createPresentation(blocked.win);
  assert.doesNotThrow(()=>blocked.selectText('large'));assert.equal(local.getTextSize(),'large');
  assert.equal(blocked.attributes.get('data-presentation-text'),'large');
  assert.equal(local.getEffectiveMotion(),'standard');
});
test('text settings have an explicit label and retain the selected option when reopened', () => {
  const api=createPresentation(fixture({raw:'{"motion":"quiet","textSize":"large"}'}).win),markup=api.settingsMarkup();
  assert.match(markup,/for="presentation-text-size">文字の大きさ<\/label>/);
  assert.match(markup,/data-presentation-text-select aria-describedby="presentation-text-note"/);
  assert.match(markup,/<option value="large" selected>大きめ<\/option>/);
  assert.match(markup,/<option value="quiet" selected>控えめ<\/option>/);
});
console.log(passed + ' presentation preference checks passed.');
