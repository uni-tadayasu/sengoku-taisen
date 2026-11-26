'use strict';

// Test the invitation the recipient actually receives, including fallback state.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const render = require('../tools/share-page.cjs');
const site = require('../site-metadata.json');
const script = fs.readFileSync(require.resolve('../promotion-share.js'), 'utf8');
const html = render({site, metadataHtml:'', jsonLd:'{"@graph":[]}', iconHtml:'', header:'', footer:'', artwork:''});
const decode = text => text.replace(/&(?:amp|lt|gt|quot|#39);/g, entity => ({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"}[entity]));
const attrs = tag => Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, key, value]) => [key, decode(value)]));
const dataset = attributes => Object.fromEntries(Object.entries(attributes).filter(([key])=>key.startsWith('data-')).map(([key,value])=>[key.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase()),value]));
const presetTags = [...html.matchAll(/<button\b[^>]*data-share-preset=[^>]*>([^<]+)<\/button>/g)];
assert.equal(presetTags.length, 3);
const presets = presetTags.map(match => ({attributes:attrs(match[0]), label:match[1]}));
const sharePanel = attrs(html.match(/<section\b[^>]*id="share"[^>]*>/)[0]);
const copiedURL = attrs(html.match(/<input\b[^>]*id="game-share-url"[^>]*>/)[0]).value;
const assertInvite = (value, source, content) => {
  const url = new URL(value);
  assert.equal(url.origin + url.pathname, site.origin + site.pages.share.path);
  assert.equal(url.hash, '');
  assert.deepEqual([...url.searchParams.keys()].sort(), ['utm_campaign','utm_content','utm_medium','utm_source']);
  assert.equal(url.searchParams.get('utm_campaign'),'player_invite');
  assert.equal(url.searchParams.get('utm_source'),source);
  assert.equal(url.searchParams.get('utm_content'),content);
};
assertInvite(copiedURL, 'copy_link', 'social');
for (const preset of presets) {
  const a = preset.attributes, id = a['data-share-preset'];
  assertInvite(a['data-share-native-url'], 'native_share', id);
  const copyURL = a['data-share-copy'].split('\n').at(-1);
  assertInvite(copyURL, {social:'share_text',friend:'friend',discord:'discord'}[id], id);
  const x = new URL(a['data-share-x']);
  assert.equal(x.origin + x.pathname, 'https://twitter.com/intent/tweet');
  assertInvite(x.searchParams.get('url'), 'x', id);
  // Conservative estimate: every non-ASCII character costs two, plus shortened
  // URL, separators and the hashtags. Each intent leaves room below 280.
  const weighted = text => Array.from(text).reduce((n,char)=>n+(char.codePointAt(0)>127?2:1),0);
  assert(weighted(x.searchParams.get('text')) + weighted(x.searchParams.get('hashtags').replaceAll(',', ' #')) + 26 <= 280, 'X copy is too long: '+id);
  const line = new URL(a['data-share-line']);
  assert.equal(line.origin + line.pathname, 'https://social-plugins.line.me/lineit/share');
  assertInvite(line.searchParams.get('url'), 'line', id);
}
assert(html.includes('data-share-presets hidden'), 'Unusable selectors must stay hidden when JavaScript is disabled');
assert(html.includes(presets[0].attributes['data-share-copy'].replaceAll('&','&amp;')), 'A default invitation must be present without JavaScript');

function fixture({shareMissing=false, shareError}={}) {
  const copyStatus={textContent:''}, status={textContent:''};
  const message={tagName:'TEXTAREA',value:'original',closest:()=>({querySelector:()=>copyStatus})};
  const x={href:'original'}, line={href:'original'};
  const choices=presets.map(preset=>({
    dataset:dataset(preset.attributes),textContent:preset.label,
    addEventListener(type,fn){this[type]=fn;},
    setAttribute(key,value){this[key]=value;}
  }));
  const selector={hidden:true,querySelectorAll:()=>choices};
  const native={hidden:true,disabled:false,addEventListener(type,fn){this[type]=fn;},focus(){}};
  const panel={dataset:dataset(sharePanel),querySelector(query){return ({'[data-share-presets]':selector,'[data-share-message]':message,'a[data-share-x]':x,'a[data-share-line]':line,'[data-share-native]':native,'.promotion-share-status':status})[query];}};
  const received=[];
  const navigator=shareMissing?{}:{canShare:()=>true,share:async data=>{received.push(data);if(shareError)throw Object.assign(Error('share error'),{name:shareError});}};
  const document={querySelectorAll:query=>query==='[data-share-url]'?[panel]:[]};
  vm.runInNewContext(script,{navigator,document});
  return {choices,message,x,line,selector,native,panel,copyStatus,status,received};
}
(async()=>{
  const h=fixture();
  assert.equal(h.selector.hidden,false);
  h.choices[2].click();
  assert.equal(h.message.value,presets[2].attributes['data-share-copy']);
  assert.equal(h.choices[2]['aria-pressed'],'true');
  assert.equal(h.choices[0]['aria-pressed'],'false');
  assert.match(h.copyStatus.textContent,/Discord/);
  assert.equal(h.x.href,presets[2].attributes['data-share-x']);
  assert.equal(h.line.href,presets[2].attributes['data-share-line']);
  await h.native.click();
  assert.equal(h.received[0].text,presets[2].attributes['data-share-text']);
  assert.equal(h.received[0].url,presets[2].attributes['data-share-native-url']);
  assert(!h.status.textContent.includes('送信しました'), 'Share sheet completion is not proof of a delivered message');
  const noNative=fixture({shareMissing:true});
  noNative.choices[1].click();
  assert.equal(noNative.message.value,presets[1].attributes['data-share-copy']);
  assert.equal(noNative.native.hidden,true);
  const cancelled=fixture({shareError:'AbortError'});
  cancelled.choices[1].click();
  await cancelled.native.click();
  assert.equal(cancelled.status.textContent,'');
  assert.equal(cancelled.native.disabled,false);
  console.log('PASS invitation presets, campaign-only URLs, short X intents, live native payload, no-JS copy and cancelled-share recovery.');
})().catch(error=>{console.error(error);process.exitCode=1;});
