'use strict';

// Check the privacy and navigation contract, including browser API failures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const code = fs.readFileSync(path.join(__dirname, '../public-growth.js'), 'utf8');
const origin = 'https://www.kasai-solutions-inc.com';
const api = 'https://sengoku-tento.hisa-0128-1996.chatgpt.site';

function fixture(options = {}) {
  const requests = [], storage = options.storage || new Map(), handlers = new Map();
  const navigator = {...options.navigator};
  const win = {
    location: new URL(options.url || origin + '/sengoku-vs/?utm_source=x'),
    doNotTrack: options.windowDnt,
    sessionStorage: {
      getItem(key) { if (options.storageDenied) throw Error('Denied'); return storage.get(key) || null; },
      setItem(key, value) { if (options.storageDenied) throw Error('Denied'); storage.set(key, value); }
    },
    fetch(url, request) {
      requests.push({url, ...request});
      if (options.fetchThrows) throw Error('Blocked');
      return options.fetchRejects ? Promise.reject(Error('Offline')) : Promise.resolve({ok:true});
    }
  };
  if (options.fetchMissing) delete win.fetch;
  const script = options.scriptMissing ? null : {dataset:{api:options.api ?? api}};
  const document = {
    currentScript: script,
    addEventListener(type, fn, flags) { handlers.set(type, fn); assert.equal(flags.passive, true); }
  };
  vm.runInNewContext(code, {window:win, navigator, document, URL, Map, Set});
  function click(href = '../', overrides = {}) {
    let prevented = false;
    const anchor = {
      getAttribute(name) { return name === 'href' ? href : null; },
      hasAttribute(name) { return name === 'download' && overrides.download === true; }
    };
    const event = {
      button:0, isTrusted:true, defaultPrevented:false,
      target:{closest:() => anchor},
      preventDefault() { prevented = true; },
      stopPropagation() { throw Error('Must not stop navigation'); },
      ...overrides
    };
    handlers.get('click')?.(event);
    assert.equal(prevented, false, 'Measuring a click must not prevent navigation');
    assert.equal(anchor.getAttribute('href'), href, 'Destination must remain unchanged');
  }
  return {requests, storage, navigator, win, click};
}

(async () => {
  let h = fixture({url:origin + '/sengoku-vs/?utm_source=%20X%20&private_name=should-not-leave#private-fragment'});
  assert.equal(h.requests.length, 1);
  let request = h.requests[0];
  assert.deepEqual(JSON.parse(request.body), {event:'landing', source:'x'});
  assert.equal(request.url, api + '/api/v1/promotion/event');
  assert.equal(request.credentials, 'omit');
  assert.equal(request.redirect, 'error');
  assert.equal(request.referrerPolicy, 'no-referrer');
  assert.equal(request.referrer, '');
  assert.equal(request.keepalive, true);
  assert.equal(request.mode, 'cors');
  assert.equal(request.cache, 'no-store');
  assert(!JSON.stringify(request).includes('private_name'));
  assert(!JSON.stringify(request).includes('private-fragment'));
  assert.deepEqual(Object.keys(request.headers), ['Content-Type']);
  h.click('../?utm_source=press#launch-enter');
  h.click('../');
  assert.equal(h.requests.length, 2, 'Landing and one play click per page in the tab');
  assert.deepEqual(JSON.parse(h.requests[1].body), {event:'play_click', source:'x'});

  const sameTab = fixture({storage:h.storage});
  sameTab.click();
  assert.equal(sameTab.requests.length, 0, 'Reloads in the same tab must not repeat either event');
  assert([...h.storage.keys()].every(key => /^sengoku-promotion-v1:ja:(landing|play_click)$/.test(key)));
  assert([...h.storage.values()].every(value => value === '1'), 'Store only fixed duplicate flags');

  for (const source of ['direct','x','line','youtube','press','friend','discord','copy_link','share_text','native_share','english','other']) {
    h = fixture({url:origin + '/en/?utm_source=' + source});
    assert.equal(JSON.parse(h.requests[0].body).source, source);
  }
  assert.equal(JSON.parse(fixture({url:origin+'/en/'}).requests[0].body).source, 'direct');
  assert.equal(JSON.parse(fixture({url:origin+'/en/?utm_source=twitter'}).requests[0].body).source, 'x');
  assert.equal(JSON.parse(fixture({url:origin+'/en/?utm_source=personal%40example.com'}).requests[0].body).source, 'other');

  for (const settings of [
    {navigator:{globalPrivacyControl:true}}, {navigator:{doNotTrack:'1'}},
    {navigator:{doNotTrack:'yes'}}, {navigator:{msDoNotTrack:'1'}}, {windowDnt:'1'}
  ]) {
    h = fixture(settings); h.click();
    assert.equal(h.requests.length, 0, 'Honor browser privacy opt-outs');
    assert.equal(h.storage.size, 0, 'Do not write measurement flags after an opt-out');
  }
  h = fixture(); h.navigator.globalPrivacyControl = true; h.click();
  assert.equal(h.requests.length, 1, 'Honor a privacy setting changed before a play click');

  for (const options of [{storageDenied:true}, {fetchThrows:true}, {fetchRejects:true}]) {
    h = fixture(options); h.click(); h.click();
    assert.equal(h.requests.length, 2, 'Unavailable storage/network must preserve page navigation and in-memory de-duplication');
  }
  await new Promise(resolve => setImmediate(resolve)); // rejected requests were handled

  for (const options of [
    {scriptMissing:true}, {api:''}, {api:'http://example.com'}, {api:api+'/wrong'},
    {api:api+'/?token=do-not-send'}, {api:api+'/#secret'}, {api:'https://user:password@example.com/'},
    {fetchMissing:true}, {url:origin+'/'}, {url:origin+'/guide/'}, {url:origin+'/press/'},
    {url:'http://localhost:8000/en/'}, {url:'file:///tmp/en/index.html'}
  ]) {
    h = fixture(options); h.click();
    assert.equal(h.requests.length, 0, 'Do not report an unapproved page, local preview or invalid API configuration');
  }
  h = fixture({api:api+'/api/v1/promotion/event', url:origin+'/en/index.html'});
  assert.equal(h.requests.length, 1, 'Explicit endpoint and index.html page aliases work');

  h = fixture();
  for (const link of ['#screenshots','../guide/','https://example.com/','javascript:alert(1)','../assets/promo/example.jpg']) h.click(link);
  h.click('../', {download:true});
  h.click('../', {defaultPrevented:true});
  h.click('../', {isTrusted:false});
  h.click('../', {button:2});
  h.click('../', {target:null});
  assert.equal(h.requests.length, 1, 'Only a real activation of a same-origin game link counts');
  h.click('../index.html');
  assert.equal(h.requests.length, 2);
  console.log('PASS anonymous public growth: privacy opt-outs, fixed payloads, source allowlist, per-tab de-duplication, failure isolation and unmodified navigation.');
})().catch(error => { console.error(error); process.exitCode = 1; });
