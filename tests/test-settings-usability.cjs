'use strict';
// Exercise the production settings renderer and delegated actions without a
// browser. This checks preference and save boundaries, not visual layout.
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const { setup } = require('./helpers/dom-model.cjs');
const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
const settingsKey = 'sengoku-tento-settings-v1', saveKey = 'sengoku-tento-save-v2';
function fn(name) {
  const match = new RegExp('^  (?:async )?function ' + name + '\\(', 'm').exec(source);
  assert(match, name);
  const start = match.index, lineEnd = source.indexOf('\n', start);
  const end = source.slice(start, lineEnd).endsWith('}') ? lineEnd : source.indexOf('\n  }', start) + 4;
  assert(end > start, name); return source.slice(start, end);
}
const init = source.slice(source.indexOf('  let settings={'), source.indexOf('  try{const raw=localStorage.getItem(saveKey)'));
const clickStart = source.indexOf("  document.addEventListener('click',async event=>");
const click = source.slice(clickStart, source.indexOf("\n  document.addEventListener('submit'", clickStart));
const eventLine = type => source.split('\n').find(line => line.startsWith("  document.addEventListener('" + type + "',"));
const actions = ['close', 'export-complete-backup', 'export-save', 'export-sync-backup', 'help', 'import-save', 'install', 'music', 'music-resume', 'new-game', 'notifications', 'open-gacha', 'open-recovery', 'open-sync', 'premium', 'progress', 'sound-settings', 'walking'];
function fixture({ preferences = {}, rawPreferences, role = 'player', linked = false, warning = '' } = {}) {
  const { doc, host } = setup(), handlers = new Map(), calls = [], writes = [];
  const savedGame = '{"campaign":"keep-original-save","turn":71}';
  const storage = new Map([[saveKey, savedGame], [settingsKey, rawPreferences ?? JSON.stringify({audioPreferenceVersion:1,sound:false,...preferences})]]);
  doc.addEventListener = (type, callback) => { if (!handlers.has(type)) handlers.set(type, []); handlers.get(type).push(callback); };
  const record = name => (...args) => { calls.push([name, ...args]); };
  const game = { isAdmin: role === 'admin', isStaff: role === 'staff', state: { difficulty: 'normal', magatama: 420, turn: 71, clan: '織田家', resources: { gold: 12345 } } };
  const file = doc.createElement('input'); file.id = 'save-import'; file.click = record('file-picker'); doc.body.append(file);
  const c = {
    document: doc, $: selector => doc.querySelector(selector), game, state: () => game.state, settingsKey,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => { writes.push([key, value]); storage.set(key, value); } },
    window: {
      SENGOKU_MUSIC_TRACKS: [{ id: 'town-theme', scene: 'town' }, { id: 'manual-theme', scene: 'army' }],
      SengokuPresentation: { settingsMarkup: () => '<label for="presentation-detail">演出</label><select id="presentation-detail"><option>標準</option></select>' },
      SengokuSocial: { open: record('social'), exportRecoveryBackup: record('complete-backup') },
      SengokuWalking: { open: record('walking') }, SengokuPremium: { open: record('premium') }
    },
    syncAccess: { linked }, saveWarning: warning, currentView: 'town', activeModal: '', officerSection: 'archive',
    music: null, voiceAudioActive: false, writable: true, startPending: false,
    requireWritable: () => c.writable,
    esc: value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character])),
    num: value => Math.floor(Number(value) || 0).toLocaleString('ja-JP'), icon: () => '<span aria-hidden="true"></span>',
    modal(title, description, body, footer, kind) { c.activeModal = kind; c.lastModal = { title, description, body, footer, kind }; host.innerHTML = body + footer; },
    closeModal() { c.activeModal = ''; calls.push(['close']); }, stopStrategy: record('stop-strategy'),
    renderHeader: record('render-header'), render: record('render'), toast: record('toast'),
    exportSave: record('export-save'), exportSyncBackup: record('export-sync-backup'),
    musicModal: record('music-modal'), helpModal: record('help'), newGameModal: record('new-game-confirmation'),
    openExpansion: record('expansion'), install: record('install'), go: record('go'),
    restoreAdminAssets() { calls.push(['restore-admin-assets']); return { ok: true, message: '復元を確認しました。' }; },
    updateCatalogSearch: () => false, updateBranchTroopDraft: () => false,
    SengokuMusic: class {
      constructor(options) { this.playing = false; calls.push(['audio-created', options.volume]); }
      static daypartTrackId() { return 'town-theme'; }
      static automaticTrackId() { return 'town-theme'; }
      get audible() { return this.playing; }
      setAuto(value) { calls.push(['automatic', value]); }
      setScene(value) { calls.push(['scene', value]); }
      setVoiceActive(value) { calls.push(['voice-state', value]); }
      async play(id) { calls.push(['play', id]); this.currentId = id; this.playing = true; }
      async attemptPlayback(id) { await this.play(id); return 'playing'; }
      pause() { calls.push(['pause']); this.playing = false; }
      setVolume(value) { calls.push(['volume', value]); }
    }
  };
  vm.createContext(c);
  const musicState=source.split('\n').find(line=>line.startsWith('  let music=null,voiceAudioActive=false')).replace('let music=','var music=');
  vm.runInContext(init + '\nthis.settings = settings;\n' + musicState + '\n' + source.split('\n').find(line => line.startsWith('  const mutationActions=')) + '\n' +
    ['safeSettings', 'settingsModal', 'musicScene', 'musicStatusText', 'removeMusicGesture', 'refreshMusicPlayback', 'musicPlaybackBlocked', 'musicPlaybackFailed', 'ensureAudio', 'sceneTrack', 'requestMusicPlayback', 'trustedGestureMusic', 'applyMusicVolume', 'startMusic', 'syncMusic', 'stopMusic', 'toggleSound'].map(fn).join('\n') + '\n' + click + '\n' + eventLine('input') + '\n' + eventLine('change'), c);
  const dispatch = async (type, target, detail = {}) => { for (const handler of handlers.get(type) || []) await handler({ target, ...detail }); };
  const press = async action => { const node = doc.querySelector('[data-action="' + action + '"]'); assert(node, action); await dispatch('click', node.querySelector('strong') || node); };
  return { c, doc, host, game, calls, writes, storage, savedGame, dispatch, press };
}
let passed = 0;
async function test(name, run) { await run(); passed++; console.log('PASS ' + name); }
(async () => {
  await test('stored volume is compatible with old numeric preferences and safely normalizes damaged values', () => {
    const values = [[0, 0], [100, 100], [-5, 0], [205, 100], [31.7, 32], ['41.6', 42], [' 70 ', 70], ['', 10], ['   ', 10], ['NaN', 10], ['Infinity', 10], [true, 10], [false, 10], [null, 10], [[], 10], [{}, 10], ['"><img src=x onerror=alert(1)>', 10]];
    for (const [volume, expected] of values) {
      const f = fixture({ preferences: { volume, sound: true, tips: false, musicMode: 'manual', track: 'manual-theme', townFacilitiesExpanded: true } });
      assert.equal(f.c.settings.volume, expected); assert.equal(f.c.settings.sound, true);
      assert.equal(f.c.settings.tips, false); assert.equal(f.c.settings.musicMode, 'manual'); assert.equal(f.c.settings.track, 'manual-theme'); assert.equal(f.c.settings.townFacilitiesExpanded, true);
      f.c.settingsModal(); assert.equal(f.doc.querySelector('#volume').value, String(expected)); assert.equal(f.doc.querySelector('img'), null);
      assert.equal(f.writes.length, 0, 'Opening settings must not rewrite old preferences or a campaign');
      assert.equal(f.storage.get(saveKey), f.savedGame);
    }
    assert.equal(fixture({ rawPreferences: '{broken-json' }).c.settings.volume, 10);
  });
  await test('the one-time audio migration unmutes old preferences but preserves later explicit mute and manual selection', () => {
    for(const [volume,expected] of [[0,10],[44,44]]){
      const f=fixture({rawPreferences:JSON.stringify({sound:false,volume,musicMode:'manual',track:'manual-theme'})});
      assert.equal(f.c.settings.sound,true);assert.equal(f.c.settings.volume,expected);assert.equal(f.c.settings.audioPreferenceVersion,1);
      assert.equal(f.c.settings.musicMode,'manual');assert.equal(f.c.settings.track,'manual-theme');
      const migrated=JSON.parse(f.storage.get(settingsKey));assert.equal(migrated.audioPreferenceVersion,1,'migration is persisted even before playback succeeds');
      assert.equal(f.storage.get(saveKey),f.savedGame);assert(f.writes.every(([key])=>key===settingsKey));
      f.c.settings.sound=false;f.c.settings.volume=0;f.c.safeSettings();
      const next=fixture({rawPreferences:f.storage.get(settingsKey)});
      assert.equal(next.c.settings.sound,false);assert.equal(next.c.settings.volume,0);assert.equal(next.c.settings.musicMode,'manual');assert.equal(next.c.settings.track,'manual-theme');assert.equal(next.writes.length,0);
    }
  });
  await test('grouped settings retain every existing action and protect the administrator-only route', () => {
    for (const role of ['player', 'staff', 'admin']) {
      const f = fixture({ role, warning: '<img src=x onerror=alert(1)>保存の確認' }), before = JSON.stringify(f.game.state);
      f.c.settingsModal();
      const actual = f.doc.querySelectorAll('[data-action]').map(node => node.dataset.action).sort();
      assert.deepEqual(actual, [...actions, ...(role === 'admin' ? ['restore-admin-assets'] : [])].sort());
      assert.equal(f.doc.querySelectorAll('.settings-group').length, 4);
      assert.deepEqual(f.doc.querySelectorAll('.settings-group').filter(node => node.open).map(node => node.id), ['settings-appearance']);
      assert(f.doc.querySelector('#presentation-detail')); assert.equal(f.doc.querySelector('#tips').value, 'on');
      assert.equal(f.doc.querySelector('[data-action="music-resume"]').hasAttribute('hidden'),true,'stopped audio does not show a policy retry control');
      assert.equal(f.doc.querySelector('[role="alert"]').textContent, '<img src=x onerror=alert(1)>保存の確認'); assert.equal(f.doc.querySelector('img'), null);
      assert.equal(JSON.stringify(f.game.state), before); assert.equal(f.writes.length, 0); assert.equal(f.calls.length, 0, 'Settings must not autoplay audio');
    }
    const linked = fixture({ linked: true }); linked.c.settingsModal(); assert.match(linked.host.textContent, /同時に操作できる端末は1台/);
  });
  await test('volume feedback and audio update in place while only preferences are saved', async () => {
    const f = fixture(), before = JSON.stringify(f.game.state); f.c.settingsModal();
    const input = f.doc.querySelector('#volume'), output = f.doc.querySelector('#settings-volume-value'); input.focus();
    input.value = '37'; await f.dispatch('input', input);
    assert.equal(f.c.music, null, 'Moving volume alone must not create an audio player'); assert.equal(output.textContent, '37%');
    f.c.ensureAudio();
    for (const value of [0, 63, 100]) {
      input.value = String(value); await f.dispatch('input', input);
      assert.equal(output.textContent, value + '%'); assert.deepEqual(f.calls.at(-1), ['volume', value]);
      assert.equal(JSON.parse(f.storage.get(settingsKey)).volume, value);
      assert.strictEqual(f.doc.querySelector('#volume'), input); assert.strictEqual(f.doc.activeElement, input);
    }
    assert.equal(JSON.stringify(f.game.state), before); assert.equal(f.storage.get(saveKey), f.savedGame); assert(f.writes.every(([key]) => key === settingsKey));
  });
  await test('explicit BGM controls honor saved volume and manual track without changing the campaign', async () => {
    const f = fixture({ preferences: { volume: 44, sound: false, musicMode: 'manual', track: 'manual-theme' } }), before = JSON.stringify(f.game.state);
    f.c.settingsModal(); await f.press('sound-settings');
    assert.equal(f.c.settings.sound, true); assert(f.calls.some(call => call[0] === 'audio-created' && call[1] === 44)); assert(f.calls.some(call => call[0] === 'play' && call[1] === 'manual-theme'));
    assert.match(f.doc.querySelector('[data-action="sound-settings"]').textContent, /再生中/);
    await f.press('sound-settings'); assert.equal(f.c.settings.sound, false); assert(f.calls.some(call => call[0] === 'pause'));
    const tips = f.doc.querySelector('#tips'); tips.value = 'off'; await f.dispatch('change', tips);
    assert.equal(JSON.parse(f.storage.get(settingsKey)).tips, false); assert(f.calls.some(call => call[0] === 'render'));
    assert.equal(JSON.stringify(f.game.state), before); assert.equal(f.storage.get(saveKey), f.savedGame);
  });
  await test('a policy-blocked preference is shown as waiting with a working explicit resume control', async () => {
    const f=fixture({preferences:{sound:true,volume:44,musicMode:'manual',track:'manual-theme'}});
    f.c.musicWaitingForGesture=true;f.c.settingsModal();
    assert.match(f.doc.querySelector('[data-action="sound-settings"]').textContent,/再生待機/);
    assert.equal(f.doc.querySelector('[data-action="music-resume"]').hasAttribute('hidden'),false);assert.equal(f.calls.length,0);
    await f.press('music-resume');
    assert.equal(f.c.settings.sound,true);assert.equal(f.c.music.playing,true);assert.equal(f.c.music.currentId,'manual-theme');
    assert.match(f.doc.querySelector('[data-action="sound-settings"]').textContent,/再生中/);
    assert.equal(f.doc.querySelector('[data-action="music-resume"]').hidden,true);assert.equal(f.storage.get(saveKey),f.savedGame);
  });
  await test('all save and utility actions keep their established routes and import/new-game remain review steps', async () => {
    const expected = {
      'export-complete-backup': [['complete-backup']], 'export-save': [['export-save']], 'export-sync-backup': [['export-sync-backup']],
      'import-save': [['stop-strategy'], ['file-picker']], 'open-recovery': [['stop-strategy'], ['close'], ['social', 'recovery']],
      'open-sync': [['close'], ['social', 'sync']], notifications: [['expansion', 'notifications']], progress: [['expansion', 'progress', 'recap']],
      walking: [['close'], ['walking']], premium: [['premium']], install: [['install']], 'open-gacha': [['go', 'officers']],
      music: [['music-modal']], help: [['help']], close: [['close']], 'new-game': [['new-game-confirmation']]
    };
    for (const [action, calls] of Object.entries(expected)) {
      const f = fixture({ role: 'staff' }), before = JSON.stringify(f.game.state); f.c.writable = false; f.c.settingsModal(); await f.press(action);
      assert.deepEqual(f.calls, calls, action); assert.equal(f.writes.length, 0, action); assert.equal(f.storage.get(saveKey), f.savedGame, action); assert.equal(JSON.stringify(f.game.state), before, action);
      if (action === 'open-gacha') assert.equal(f.c.officerSection, 'gacha');
    }
  });
  await test('administrator restoration still requires a writable session and optional plugin failures remain contained', async () => {
    const f = fixture({ role: 'admin' }); f.c.settingsModal(); f.c.writable = false; await f.press('restore-admin-assets'); assert.deepEqual(f.calls, []);
    f.c.writable = true; await f.press('restore-admin-assets'); assert.equal(f.calls[0][0], 'restore-admin-assets'); assert.equal(f.c.lastModal.kind, 'settings');
    f.calls.length = 0; delete f.c.window.SengokuSocial.exportRecoveryBackup; await f.press('export-complete-backup'); assert.equal(f.calls.length, 1); assert.equal(f.calls[0][0], 'toast'); assert.equal(f.calls[0][2], true);
    f.calls.length = 0; delete f.c.window.SengokuPremium; await f.press('premium'); assert.equal(f.calls[0][0], 'toast'); assert.equal(f.storage.get(saveKey), f.savedGame);
  });
  console.log(passed + ' settings preference, action and save-boundary checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
