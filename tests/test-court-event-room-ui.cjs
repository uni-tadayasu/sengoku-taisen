'use strict';
// Private workshop fixtures only: no live account, event or publication is changed.
const assert = require('node:assert/strict');
const Room = require('../court-event-room.js'), Events = require('../events.js'), stable = require('../stable-dom.js');
const { setup: dom } = require('./helpers/dom-model.cjs');
const { catalogEventFixture, storageFixture } = require('./test-events-ui.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
const NOW = Date.parse('2026-11-27T03:00:00Z'), OWNER = 'u_' + '1'.repeat(32), OTHER = 'u_' + '2'.repeat(32);
const tests = [], test = (name, run) => tests.push([name, run]);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
async function until(check) { for (let i = 0; i < 100; i++) { if (check()) return; await Promise.resolve(); } assert(check(), 'async checkpoint'); }
const context = extra => ({ epoch: 1, accountEpoch: 1, privilegeEpoch: 1, playerId: OWNER, user: { id: OWNER, name: '朝廷の担当領主', isAdmin: false, isStaff: false }, isCourtRegent: true, ...extra });
const templates = () => Array.from({ length: 20 }, (_, index) => ({ id: 'template_' + index, name: ['はじめての川辺合戦', '城攻めの指南', '天下統一への道'][index % 3] + ' ' + (index + 1), category: ['beginner', 'siege', 'unification'][index % 3], description: '三つの戦場を通して采配と戦術を学ぶ、朝廷の合戦企画。', battleId: 'history:kawanakajima', battleName: '川中島の戦い', durationDays: index % 7 + 1, difficulty: ['beginner', 'standard', 'advanced'][index % 3], themeId: 'river' }));
const source = extra => ({ generator: 'game-ai-v1', mode: 'template', templateId: 'template_0', templateName: 'はじめての川辺合戦 1', prompt: '', difficulty: 'beginner', matchedKeywords: [], reasons: ['川辺の戦場で正攻法と奇襲を学ぶ構成です。'], ...extra });
function roomEvent(extra = {}) { return { ...catalogEventFixture('history:kawanakajima', { id: 'ev_' + 'a'.repeat(32), status: 'draft', startsAt: null, endsAt: null, createdAt: new Date(NOW).toISOString() }), revision: 0, creator: { id: OWNER, name: '朝廷の担当領主' }, source: source(), ...extra }; }
function fixture({ who = context(), events = [roomEvent()], storage = storageFixture() } = {}) {
  let access = copy(who), hook = null, clock = NOW, serial = 0, writes = 0;
  const calls = [], frames = [], receipts = new Map(), server = { templates: templates(), events: copy(events), extraActive: null, draftLimit: 30, hasMore: false };
  const directory = () => ({ ok: true, canManage: true, serverNow: new Date(clock).toISOString(), templates: copy(server.templates), events: copy(server.events), hasMore: server.hasMore, draftLimit: server.draftLimit, draftCount: server.events.filter(e => e.status === 'draft').length, activeEvent: server.extraActive || (() => { const e = server.events.find(row => row.status === 'active' && Date.parse(row.endsAt) > clock); return e ? { id: e.id, name: e.name, endsAt: e.endsAt } : null; })(), generator: { id: 'game-ai-v1', label: 'ゲームAI', description: 'ゲーム内の合戦から要望に合う構成を作成します。' } });
  async function respond(route, options = {}) {
    if (options.method !== 'POST') {
      if (route === '/court/events') return directory();
      const e = server.events.find(row => '/court/events/' + row.id === route); assert(e, route);
      return { ok: true, canManage: true, serverNow: new Date(clock).toISOString(), event: copy(e) };
    }
    const data = options.data, prior = receipts.get(data.requestId);
    if (prior) return { ok: true, canManage: true, serverNow: new Date(clock).toISOString(), idempotent: true, event: copy(server.events.find(e => e.id === prior.eventId)), receipt: copy(prior) };
    let event, action;
    if (route === '/court/events/generate') {
      action = 'generate'; assert(['template', 'ai'].includes(data.generationMode));
      const template = server.templates.find(t => t.id === data.templateId) || server.templates[0];
      event = roomEvent({ id: 'ev_' + String(++writes).padStart(32, '0'), durationDays: data.durationDays, source: source({ mode: data.generationMode, templateId: template.id, templateName: template.name, prompt: String(data.prompt || '').normalize('NFC').replace(/\s+/g, ' ').trim() }) });
      event.plan.durationDays = data.durationDays; server.events.unshift(event);
    } else {
      action = route.split('/').at(-1); event = server.events.find(e => route === '/court/events/' + e.id + '/' + action); assert(event, route);
      if (data.expectedRevision !== event.revision) throw Object.assign(Error('ほかの担当者が更新しました。最新の状態で確認してください。'), { status: 409, code: 'COURT_EVENT_REVISION_CONFLICT' });
      if (action === 'publish') { assert.equal(event.status, 'draft'); event.status = 'active'; event.startsAt = new Date(clock).toISOString(); event.endsAt = new Date(clock + event.durationDays * 86400000).toISOString(); }
      else if (action === 'end') { assert.equal(event.status, 'active'); event.status = 'ended'; event.endedAt = new Date(clock).toISOString(); }
      else if (action === 'discard') { assert.equal(event.status, 'draft'); event.status = 'discarded'; }
      else assert.fail(action);
      event.revision++; writes++;
    }
    const receipt = { action, eventId: event.id, revision: event.revision }; receipts.set(data.requestId, copy(receipt));
    return { ok: true, canManage: true, serverNow: new Date(clock).toISOString(), idempotent: false, event: copy(event), receipt };
  }
  const options = { autoPoll: false, now: () => clock, uuid: () => 'room_request_' + ++serial, storage, cleanEvent: Events.cleanEvent, getContext: () => copy(access), request: (route, args = {}) => { calls.push({ route, ...copy(args), owner: access.playerId }); return hook ? hook(route, args) : respond(route, args); }, onChange: s => frames.push(s) };
  const controller = Room.createController(options);
  return { controller, options, server, calls, frames, receipts, storage, directory, respond, posts: () => calls.filter(row => row.method === 'POST'), set who(value) { access = copy(value); }, get who() { return copy(access); }, set hook(value) { hook = value; }, advance: ms => clock += ms };
}

test('only a server-authorized official sees twenty templates; ordinary Regents need no staff flag', async () => {
  const h = fixture(); assert.equal(h.who.user.isStaff, false); assert(await h.controller.open());
  const s = h.controller.snapshot(); assert(s.authorized); assert.equal(s.directory.templates.length, 20); assert.match(Room.markup(s), /ゲームAIに相談/); assert.equal(h.posts().length, 0);
  const denied = fixture(); denied.hook = () => Promise.reject(Object.assign(Error('担当者専用です'), { status: 403 })); assert.equal(await denied.controller.open(), false); assert.equal(denied.controller.snapshot().directory, null); assert.doesNotMatch(Room.markup(denied.controller.snapshot()), /data-cer-action="generate"/);
});
test('guests, pending identities and banned accounts cannot read the private room', async () => {
  for (const who of [context({ user: null }), context({ pending: true }), context({ banned: true }), context({ user: { id: OTHER } })]) { const h = fixture({ who }); assert.equal(await h.controller.open(), false); assert.equal(h.calls.length, 0); }
});
test('template generation creates only a shared draft and preserves the exact selected template and duration', async () => {
  const h = fixture({ events: [] }); await h.controller.open(); h.controller.chooseTemplate('template_8'); h.controller.update('durationDays', 7); assert(await h.controller.submit('generate')); await until(() => !h.controller.snapshot().loading);
  const post = h.posts()[0]; assert.equal(post.route, '/court/events/generate'); assert.deepEqual(post.data, { generationMode: 'template', templateId: 'template_8', durationDays: 7, requestId: 'room_request_1' }); assert.equal(h.controller.snapshot().event.status, 'draft'); assert.equal(h.posts().length, 1); assert.match(Room.markup(h.controller.snapshot()), /戦場・参加ルール・報酬を確認/); assert.match(Room.markup(h.controller.snapshot()), /累計戦功の褒賞/);
});
test('AI accepts a multiline brief with explicit one-to-seven-day duration and exposes its private rationale', async () => {
  const h = fixture(); await h.controller.open(); h.controller.update('mode', 'ai'); h.controller.update('templateId', ''); h.controller.update('prompt', '初心者向けの川辺。\n奇襲を学びたい。'); h.controller.update('durationDays', 4); assert(await h.controller.submit('generate')); const post = h.posts()[0]; assert.equal(post.data.generationMode, 'ai'); assert.equal(post.data.prompt, '初心者向けの川辺。\n奇襲を学びたい。'); assert(!Object.hasOwn(post.data, 'templateId')); assert.match(Room.markup(h.controller.snapshot()), /ゲームAIの企画/); assert.match(Room.markup(h.controller.snapshot()), /制作時の要望/); assert.equal(h.controller.update('durationDays', 8), false);
});
test('the 600-character brief boundary counts Unicode code points and survives durable recovery', async () => {
  const h = fixture(); await h.controller.open(); h.controller.update('mode', 'ai'); h.controller.update('prompt', '🏯'.repeat(601)); assert.equal(Array.from(h.controller.snapshot().prompt).length, 600); const pause = deferred(); h.hook = (route, args) => args.method === 'POST' ? pause.promise : h.respond(route, args); const writing = h.controller.submit('generate'); pause.reject(Error('lost')); await writing; const restored = Room.createController(h.options); assert.equal(restored.snapshot().prompt, ''); await restored.open(); assert.equal(restored.snapshot().prompt, '🏯'.repeat(600)); h.hook = null; assert(await restored.submit()); assert.equal(Array.from(restored.snapshot().event.source.prompt).length, 600);
});
test('switching history filters clears a draft preview when there are no matching events', async () => {
  const h = fixture(); await h.controller.open(); h.controller.update('pane', 'shared'); assert(h.controller.snapshot().event); h.controller.update('filter', 'history'); assert.equal(h.controller.snapshot().event, null); assert.doesNotMatch(Room.markup(h.controller.snapshot()), /公開内容を確認/); h.controller.update('filter', 'draft'); assert.equal(h.controller.snapshot().event.id, h.server.events[0].id);
});
test('empty AI briefs, unknown templates and exhausted shared draft slots cannot send', async () => {
  const h = fixture(); await h.controller.open(); h.controller.update('mode', 'ai'); assert.equal(await h.controller.submit('generate'), false); assert.equal(h.controller.chooseTemplate('missing'), false); h.controller.update('mode', 'template'); h.server.draftLimit = 1; await h.controller.refresh(); assert.equal(await h.controller.submit('generate'), false); assert.equal(h.posts().length, 0);
});
test('publish, end and discard require an explicit action-specific confirmation with the reviewed revision', async () => {
  const h = fixture(); await h.controller.open(); await h.controller.selectEvent(h.server.events[0].id); assert.equal(await h.controller.submit('publish'), false); assert(h.controller.prepare('publish')); assert.equal(h.posts().length, 0); assert.equal(await h.controller.submit('end'), false); assert(await h.controller.submit('publish')); assert.equal(h.posts()[0].data.expectedRevision, 0); assert.equal(h.controller.snapshot().event.status, 'active');
  await until(() => !h.controller.snapshot().loading); assert(h.controller.prepare('end')); assert(await h.controller.submit('end')); assert.equal(h.posts()[1].data.expectedRevision, 1); assert.equal(h.controller.snapshot().event.status, 'ended');
  const discard = fixture(); await discard.controller.open(); assert(discard.controller.prepare('discard')); assert(await discard.controller.submit('discard')); assert.equal(discard.controller.snapshot().event.status, 'discarded');
});
test('another active event blocks publication while keeping the private draft usable', async () => {
  const h = fixture(); h.server.extraActive = { id: 'ev_' + 'f'.repeat(32), name: '別の担当者が開催した合戦', endsAt: new Date(NOW + 3600000).toISOString() }; await h.controller.open(); h.controller.update('pane', 'shared'); assert.equal(h.controller.prepare('publish'), false); assert(h.controller.prepare('discard')); assert.match(Room.markup(h.controller.snapshot()), /別の担当者が開催した合戦/); assert.equal(h.posts().length, 0);
});
test('changed event revisions disable an existing confirmation before a write', async () => {
  const h = fixture(); await h.controller.open(); h.controller.update('pane', 'shared'); h.controller.prepare('publish'); h.server.events[0].revision++; await h.controller.refresh({ quiet: true }); const { host, $ } = dom(); host.innerHTML = Room.markup(h.controller.snapshot()); assert($('[data-cer-action="commit"]').disabled); assert.match(host.textContent, /ほかの担当者が記録を更新/); assert.equal(await h.controller.submit('publish'), false); assert.equal(h.posts().length, 0);
});
test('a server conflict clears a definitive intent, refreshes the room and preserves the reason', async () => {
  const h = fixture(); await h.controller.open(); h.controller.prepare('publish'); h.server.events[0].revision++; assert.equal(await h.controller.submit('publish'), false); await until(() => !h.controller.snapshot().loading); const s = h.controller.snapshot(); assert.equal(s.pending, null); assert.equal(s.confirmation, null); assert.equal(s.event.revision, 1); assert.match(s.error, /ほかの担当者/);
});
test('an uncertain generation keeps exactly one durable payload and blocks edits, selection and duplicate sends', async () => {
  const h = fixture(), pause = deferred(); await h.controller.open(); h.controller.update('mode', 'ai'); h.controller.update('prompt', '秘密の夜戦案'); h.hook = (route, args) => args.method === 'POST' ? pause.promise : h.respond(route, args); const first = h.controller.submit('generate'); assert.equal(await h.controller.submit('generate'), false); assert.equal(h.controller.update('prompt', '別の案'), false); assert.equal(h.controller.chooseTemplate('template_3'), false); assert.equal(await h.controller.selectEvent(h.server.events[0].id), false); pause.reject(Error('応答がありません')); assert.equal(await first, false); assert(h.controller.snapshot().pending); const payload = copy(h.posts()[0].data); h.hook = null; assert(await h.controller.submit()); assert.deepEqual(h.posts()[1].data, payload); assert.equal(h.controller.snapshot().pending, null);
});
test('committed generation survives a lost response and reload without making a second draft', async () => {
  const h = fixture({ events: [] }); await h.controller.open(); h.controller.update('mode', 'ai'); h.controller.update('prompt', '川辺の戦い\n入門編'); h.controller.update('durationDays', 6); let lost = false; h.hook = async (route, args) => { const result = await h.respond(route, args); if (args.method === 'POST' && !lost) { lost = true; throw Error('response lost'); } return result; }; assert.equal(await h.controller.submit('generate'), false); h.controller.close(); const restored = Room.createController(h.options); assert.equal(restored.snapshot().prompt, ''); await restored.open(); assert.equal(restored.snapshot().prompt, '川辺の戦い\n入門編'); assert.equal(restored.snapshot().durationDays, 6); assert.equal(h.posts().length, 1); assert(await restored.submit()); assert.equal(h.server.events.length, 1); assert.deepEqual(h.posts()[0].data, h.posts()[1].data); assert.match(restored.snapshot().message, /記録を確認/);
});
test('immutable receipt replay accepts a later ended record without claiming it is currently published', async () => {
  const h = fixture(); await h.controller.open(); h.controller.prepare('publish'); let lost = false; h.hook = async (route, args) => { const result = await h.respond(route, args); if (args.method === 'POST' && !lost) { lost = true; throw Error('lost'); } return result; }; await h.controller.submit('publish'); const event = h.server.events[0]; event.status = 'ended'; event.endedAt = new Date(NOW + 1000).toISOString(); event.revision++; assert(await h.controller.submit()); assert.equal(h.controller.snapshot().event.status, 'ended'); assert.match(h.controller.snapshot().message, /記録を確認/); assert.doesNotMatch(h.controller.snapshot().message, /参加できます/);
});
test('malformed receipts and mismatched generated plans retain the durable uncertainty', async () => {
  for (const mutate of [r => { r.receipt.action = 'discard'; }, r => { r.receipt.revision = 9; }, r => { r.event.source.mode = 'ai'; }, r => { r.event.source.templateId = 'template_19'; }, r => { r.event.source.prompt = '別の操作の企画文'; }, r => { r.event.durationDays = 2; r.event.plan.durationDays = 2; }]) { const h = fixture(); await h.controller.open(); h.hook = async (route, args) => { const r = await h.respond(route, args); if (args.method === 'POST') mutate(r); return r; }; assert.equal(await h.controller.submit('generate'), false); assert(h.controller.snapshot().pending); assert.equal(h.controller.snapshot().message, ''); }
});
test('unavailable or silently failing durable storage prevents every write', async () => {
  for (const silent of [true, false]) { const storage = storageFixture(); storage.setItem = () => { if (!silent) throw Error('blocked'); }; const h = fixture({ storage }); await h.controller.open(); assert.equal(await h.controller.submit('generate'), false); assert.equal(h.posts().length, 0); assert.match(h.controller.snapshot().error, /blocked|保存/); }
});
test('same-account Regent revocation clears the private room and brief immediately without another HTTP request', async () => {
  const h = fixture(); await h.controller.open(); h.controller.update('mode', 'ai'); h.controller.update('prompt', '秘密の制作案'); const count = h.calls.length; h.who = { ...h.who, isCourtRegent: false }; h.controller.refreshAccess(); const s = h.controller.snapshot(); assert.equal(h.calls.length, count); assert.equal(s.open, false); assert.equal(s.directory, null); assert.equal(s.event, null); assert.equal(s.prompt, ''); assert.equal(s.authorized, false);
});
test('a delayed private read cannot repopulate data after Regent revocation', async () => {
  const h = fixture(), pause = deferred(); await h.controller.open(); h.hook = () => pause.promise; const read = h.controller.refresh({ quiet: true }); h.who = { ...h.who, isCourtRegent: false }; h.controller.refreshAccess(); pause.resolve(h.directory()); assert.equal(await read, false); assert.equal(h.controller.snapshot().directory, null); assert.equal(h.controller.snapshot().open, false);
});
test('an exact-term access conflict purges private data on directory reads, detail reads and writes', async () => {
  for (const operation of ['directory', 'detail', 'write']) {
    const h = fixture(); await h.controller.open(); h.controller.update('mode', 'ai'); h.controller.update('prompt', '担当期間中の秘密の制作案'); h.hook = () => Promise.reject(Object.assign(Error('朝廷の担当権限が変わりました。'), { status: 409, code: 'COURT_EVENT_ACCESS_CHANGED' }));
    if (operation === 'directory') assert.equal(await h.controller.refresh({ quiet: true }), false);
    else if (operation === 'detail') assert.equal(await h.controller.selectEvent(h.server.events[0].id), false);
    else assert.equal(await h.controller.submit('generate'), false);
    const s = h.controller.snapshot(); assert.equal(s.authorized, false); assert.equal(s.directory, null); assert.equal(s.event, null); assert.equal(s.prompt, ''); assert.equal(s.confirmation, null); assert.doesNotMatch(Room.markup(s), /秘密の制作案|川中島の戦い|data-cer-action="generate"/);
  }
});
test('late writes from another account cannot leak the first owner result or clear their recovery record', async () => {
  const h = fixture(), pause = deferred(); await h.controller.open(); h.hook = (route, args) => args.method === 'POST' ? pause.promise : h.respond(route, args); const writing = h.controller.submit('generate'), record = copy(h.posts()[0]); h.who = context({ playerId: OTHER, user: { id: OTHER, name: '別の領主' } }); h.controller.refreshAccess(); pause.resolve(await h.respond(record.route, record)); assert.equal(await writing, false); const s = h.controller.snapshot(); assert.equal(s.pending, null); assert.equal(s.event, null); assert.equal(s.message, ''); assert(h.storage.getItem('sengoku-court-events-pending-v1:' + OWNER));
});
test('a newer selected detail wins over a delayed earlier event response', async () => {
  const second = roomEvent({ id: 'ev_' + 'b'.repeat(32), creator: { id: OTHER, name: '別の担当者' } }), h = fixture({ events: [roomEvent(), second] }), pause = deferred(); await h.controller.open(); h.hook = (route, args) => route === '/court/events/' + h.server.events[0].id ? pause.promise : h.respond(route, args); const first = h.controller.selectEvent(h.server.events[0].id); await h.controller.selectEvent(second.id); pause.resolve({ ok: true, canManage: true, serverNow: new Date(NOW).toISOString(), event: h.server.events[0] }); assert.equal(await first, false); assert.equal(h.controller.snapshot().event.id, second.id);
});
test('quiet directory refresh retains an unfinished brief, selected template and duration', async () => {
  const h = fixture(); await h.controller.open(); h.controller.chooseTemplate('template_11'); h.controller.update('mode', 'ai'); h.controller.update('prompt', '入力途中の要望'); h.controller.update('durationDays', 7); await h.controller.refresh({ quiet: true }); const s = h.controller.snapshot(); assert.equal(s.prompt, '入力途中の要望'); assert.equal(s.templateId, 'template_11'); assert.equal(s.durationDays, 7); assert.equal(s.mode, 'ai');
});
test('strict directories reject missing templates, duplicate events and malformed plans and escape private content', async () => {
  const h = fixture(); for (const mutate of [d => d.templates.pop(), d => d.events.push(copy(d.events[0])), d => { d.canManage = false; }, d => { d.events[0].revision = '0'; }, d => { d.events[0].plan.stages = []; }, d => { d.events[0].source.prompt = 4; }]) { const d = h.directory(); mutate(d); assert.throws(() => Room.cleanDirectory(d, Events.cleanEvent)); }
  h.server.templates[0].name = '<script>template</script>'; h.server.events[0].creator.name = '<img src=x>'; h.server.events[0].source.prompt = '<private>'; await h.controller.open(); assert.match(Room.markup(h.controller.snapshot()), /&lt;script&gt;/); h.controller.update('pane', 'shared'); const html = Room.markup(h.controller.snapshot()); assert.match(html, /&lt;img src=x&gt;/); assert.match(html, /&lt;private&gt;/); assert.doesNotMatch(html, /<img src=x>|<script>/);
});
test('mounted UI preserves the prompt node, IME selection, focus and scroll during a quiet refresh', async () => {
  const h = fixture(), { doc, host } = dom(); global.SengokuStableDOM = stable; const trigger = doc.createElement('button'); host.append(trigger); trigger.focus(); const ui = Room.createUI({ ...h.options, document: doc });
  try { await ui.open(); const get = selector => doc.querySelector(selector); get('[data-cer-value="ai"]').dispatchEvent({ type: 'click' }); const prompt = get('#cer-prompt'); prompt.focus(); prompt.value = '変換途中の制作案'; prompt.setSelectionRange(2, 6); prompt.dispatchEvent({ type: 'input' }); const main = get('.cer-main'); main.scrollTop = 260; await ui.controller.refresh({ quiet: true }); assert.strictEqual(get('#cer-prompt'), prompt); assert.strictEqual(doc.activeElement, prompt); assert.equal(prompt.selectionStart, 2); assert.equal(prompt.selectionEnd, 6); assert.equal(main.scrollTop, 260); ui.close(); assert.strictEqual(doc.activeElement, trigger); }
  finally { ui.dispose(); delete global.SengokuStableDOM; }
});
test('mounted publication confirmation focuses and scrolls once; subsequent updates stay still', async () => {
  const h = fixture(), { doc } = dom(); global.SengokuStableDOM = stable; const ui = Room.createUI({ ...h.options, document: doc });
  try { await ui.open(); ui.controller.update('pane', 'shared'); const button = doc.querySelector('[data-cer-value="publish"]'); button.dispatchEvent({ type: 'click' }); const confirm = doc.querySelector('.cer-confirm'); assert.strictEqual(doc.activeElement, confirm); assert.equal(confirm.scrollIntoViewCalls, 1); const main = doc.querySelector('.cer-main'); main.scrollTop = 300; await ui.controller.refresh({ quiet: true }); assert.strictEqual(doc.querySelector('.cer-confirm'), confirm); assert.equal(main.scrollTop, 300); assert.equal(confirm.scrollIntoViewCalls, 1); assert.equal(h.posts().length, 0); }
  finally { ui.dispose(); delete global.SengokuStableDOM; }
});
test('mounted account revocation closes the dialog and removes all private markup', async () => {
  const h = fixture(), { doc } = dom(), ui = Room.createUI({ ...h.options, document: doc }); await ui.open(); assert(doc.querySelector('.court-events-dialog').open); h.who = { ...h.who, isCourtRegent: false }; ui.refreshAccess(); assert.equal(doc.querySelector('.court-events-dialog').open, false); assert.equal(doc.querySelector('.cer-main').textContent, ''); ui.dispose();
});

async function run() { let failed = 0; for (const [name, body] of tests) { try { await body(); console.log('PASS', name); } catch (error) { failed++; console.error('FAIL', name, error.stack || error); } } console.log(`${tests.length - failed}/${tests.length} court event room UI checks passed. No live requests.`); if (failed) process.exitCode = 1; }
if (require.main === module) run();
module.exports = { fixture, roomEvent, templates, source, NOW, OWNER, OTHER };
