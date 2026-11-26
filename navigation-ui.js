/* Find a destination without changing the game's command or save pathways. */
(function (global) {
  'use strict';
  const PREFERENCE_KEY = 'sengoku-navigation-preferences-v1';
  const FAVORITE_LIMIT = 6, RECENT_LIMIT = 5;
  const DEFAULT_DOCK = ['view:town', 'view:map', 'view:army'];
  const PURPOSES = [
    ['develop', '城を育てる', '城と内政', ''],
    ['battle', '合戦へ出る', '合戦と天下', '戦い'],
    ['army', '武将を整える', '武将と軍団', ''],
    ['records', '任務・報酬を探す', '交流・記録', '報酬']
  ];
  const GROUPS = ['城と内政', '合戦と天下', '武将と軍団', '交流・記録', '設定・案内', 'その他'];
  const DETAILS = {
    'view:town': ['城と内政', '施設の増築と本拠の成長', 'まち 城下 施設 建設 建築 増築 育成 レベル上げ 資源 金銭 お金 兵糧 木材 石材 収入 支出 収支 経済 修復 修理 耐久 給料 給与'],
    'view:facilities': ['城と内政', '施設の一覧・検索・増築と奉行の任命', 'ふしん 施設 建築 整備 強化 レベルアップ 生産 軍備 奉行 城下町 給料 給与 月給 俸禄 修復 修理 耐久'],
    'action:resource-planner': ['城と内政', '複数の普請・研究と残す備蓄をまとめて試算', 'しげん けいかく 予算 見積もり 目標 貯める あと 何分 待ち時間 不足 収支 生産 金銭 兵糧 木材 石材 施設 研究 備蓄 びちく 残す 複数 合計 まとめて 計画'],
    'action:defense-ledger': ['城と内政', '城・支拠点の耐久、守備兵、修復に使う資材を確認', 'しゅうふく しゅうり 修復 修理 守備 防衛 耐久 損傷 資材 木材 石材 不足 回復 陥落 復旧 支城 支拠点 台帳'],
    'view:research': ['城と内政', '技術を研究して国力を高める', 'けんきゅう 内政 育成 レベル上げ 資源 強化 技術'],
    'view:court': ['城と内政', '京都御所への参内と朝廷との交流', 'きょうと ごしょ 位階 朝廷 参内 貢献'],
    'view:map': ['合戦と天下', '注目城を登録し、城・支城の攻略を考える', '注目城 お気に入り 城を登録 再訪 ちず マップ 天下 統一 城攻め 支城 戦い CPU 軍師 ぐんし AI 予備兵 温存 残す 兵糧 外交 同盟 交渉'],
    'view:field': ['合戦と天下', 'ほかの領主の本拠と対人戦', 'フィールド オンライン 対人 戦い PvP プレイヤー 領主 城'],
    'view:roaming': ['合戦と天下', '野良兵との合戦と報酬', 'のら 野良兵 NPC CPU 戦う 戦い 報酬 軍師 ぐんし AI'],
    'view:covert': ['合戦と天下', '派遣・偵察の進行と帰還を確認', 'はけん 偵察 部隊 兵士 迎撃 反撃 移動 移動時間 行軍 行軍中 時間 到着 到着時間 帰還 帰還中 帰還時間 帰城 帰り 帰って 援軍 駐屯 撤収'],
    'action:events': ['合戦と天下', '開催中のイベント・戦功・報酬', 'イベント 期間 合戦 戦い 関ヶ原 関ケ原 報酬 軍師 ぐんし AI'],
    'action:alliance-strategy': ['合戦と天下', '同盟の作戦と集結軍', 'どうめい ギルド 協力 集結 ラリー 援軍 移動 移動時間 到着 到着時間 時間'],
    'action:conquest': ['合戦と天下', '同盟で挑む共有の天下統一', 'きょうゆう 天下 統一 大会 シーズン ギルド'],
    'view:officers': ['武将と軍団', '武将の能力・比較・絞り込み・招集', 'ぶしょう 武将 育成 レベル上げ 一覧 名鑑 ソート フィルター ガチャ 招集 治療 負傷 回復 体力 比較 見比べ'],
    'view:army': ['武将と軍団', '出陣する武将と兵力を整える', 'ぐんだん 編成 軍団 兵士 募兵 訓練 パーティー'],
    'view:crests': ['武将と軍団', '各勢力の家紋を確認', 'かもん 家紋 勢力'],
    'view:council': ['交流・記録', '軍師AI・任務・領国の戦記', 'ぐんぎ 作戦 軍師 ぐんし AI 任務 戦記 履歴 ログ'],
    'action:command-activity': ['交流・記録', '普請・研究・進軍・帰還の予定をまとめて確認', '行動 予定表 予定 時間 残り 完成 着工 待ち 予約 建設 研究 到着 帰還 援軍 集結'],
    'action:campaign-records': ['交流・記録', '戦記を探し、出陣戦績と武将の編成を比較', 'せんき 戦績 出陣 兵損 勝率 勝敗 比較 対戦履歴 検索 記録 履歴 ログ 報告 過去 合戦 内政 武将 任務 報酬 テキスト 書き出し'],
    'action:progress': ['交流・記録', '任務・武将の熟練・編成保存・分析', '成長 せいちょう 任務 経験 熟練 保存 分析 報酬'],
    'action:shogunate': ['交流・記録', '天下統一の功績と幕府の開設', 'ばくふ 幕府 将軍 征夷大将軍 天下 統一 開設 報酬'],
    'action:hints': ['設定・案内', '今の領国に合った次の一手', 'ヒント 次 わからない 何 進め方 おすすめ'],
    'action:premium': ['設定・案内', '有料版と外観・支援の案内', 'プレミアム 購入 課金 外観 支援 有料'],
    'action:settings': ['設定・案内', 'セーブ・読込・音・表示の設定', 'せってい 保存 セーブ 音 BGM ミュート データ バックアップ 読込 音量 音楽 消音 読み上げ 通知 表示 アニメーション 軽量'],
    'action:check-update': ['設定・案内', '新版があるか確認し、保存して更新する', 'こうしん 更新 新版 最新 バージョン'],
    'action:title-screen': ['設定・案内', '開始画面へ戻る', 'タイトル 最初 ホーム 戻る'],
    'utility:layout': ['設定・案内', 'PCの画面配置を調整', 'レイアウト 画面 サイズ 大きさ 幅 高さ 縮小 拡大 配置 領域'],
    'utility:social': ['交流・記録', '領主登録・チャット・同盟・書状・同期', 'こうりゅう 交流 登録 チャット 同盟 ギルド 手紙 書状 メール 通話 同期 引き継ぎ 引継ぎ 復元']
  };
  const ICONS = {
    menu: 'M4 5h16M4 12h16M4 19h16',
    search: 'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14m5-2 6 6',
    close: 'm6 6 12 12M6 18 18 6',
    star: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z',
    clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M12 6v6l4 2',
    book: 'M4 3h13a3 3 0 0 1 3 3v15H6a3 3 0 0 1 0-6h14M4 3v15M8 7h8M8 11h6',
    arrow: 'm9 5 7 7-7 7',
    external: 'M14 3h7v7M21 3l-9 9M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5'
  };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const svg = name => '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + (ICONS[name] || ICONS.menu) + '"/></svg>';
  function normalizeQuery(value) {
    return String(value ?? '').normalize('NFKC').toLocaleLowerCase('ja').replace(/[\u30a1-\u30f6]/g, char => String.fromCharCode(char.charCodeAt(0) - 0x60)).trim();
  }
  function filterEntries(entries, query) {
    const normalized = normalizeQuery(query), terms = normalized.split(/\s+/).filter(Boolean);
    if (!terms.length) return entries.slice();
    // Search stays literal: matching words rank visible labels before descriptions
    // and synonyms. It never infers a command or replaces the canonical route.
    return entries.map((entry, index) => {
      const [label, description, keywords, group] = [entry.label, entry.description, entry.keywords, entry.group].map(normalizeQuery);
      if (!terms.every(term => [label, description, keywords, group].some(field => field.includes(term)))) return null;
      const score = (label === normalized ? 1200 : label.startsWith(normalized) ? 600 : label.includes(normalized) ? 400 : 0) +
        terms.reduce((sum, term) => sum + (label.includes(term) ? 80 : description.includes(term) ? 30 : keywords.includes(term) ? 12 : 6), 0);
      return { entry, index, score };
    }).filter(Boolean).sort((a, b) => b.score - a.score || a.index - b.index).map(result => result.entry);
  }
  function highlightMatch(value, query) {
    const text = String(value ?? ''), normalized = normalizeQuery(text);
    const terms = normalizeQuery(query).split(/\s+/).filter(Boolean);
    // NFKC may expand a compatibility character. Avoid an incorrect highlight
    // when the original string no longer shares the normalized offsets.
    if (!terms.length || normalized.length !== text.length) return esc(text);
    const ranges = [];
    for (const term of terms) {
      let from = 0, index;
      while ((index = normalized.indexOf(term, from)) !== -1) { ranges.push([index, index + term.length]); from = index + term.length; }
    }
    ranges.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const range of ranges) {
      const last = merged[merged.length - 1];
      if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]); else merged.push(range);
    }
    let result = '', from = 0;
    for (const [start, end] of merged) { result += esc(text.slice(from, start)) + '<mark>' + esc(text.slice(start, end)) + '</mark>'; from = end; }
    return result + esc(text.slice(from));
  }
  function preferenceKeys(value, limit) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter(key => typeof key === 'string' && /^(?:view|action|utility|help):[a-z][a-z0-9-]{0,63}$/.test(key)))].slice(0, limit);
  }
  function createNavigationUI(win = global) {
    const doc = win.document, root = doc?.documentElement;
    if (!doc || !root) return null;
    const nav = doc.getElementById('navigation'), app = doc.getElementById('app');
    const sidebar = app?.querySelector('.sidebar'), bottom = app?.querySelector('.sidebar-bottom');
    if (!nav || !app || !sidebar || !bottom) return null;
    const dialog = doc.createElement('dialog');
    if (typeof dialog.showModal !== 'function') return null;
    let initialized = false, frame = 0, returnFocus = null, restoreFocus = true, entries = [], signature = '', pendingNavigation = null;
    let favorites = [], recent = [], dockKeys = [...DEFAULT_DOCK], railSignature = '', dockOptionsSignature = '', categorySignature = '';
    let rememberedScroll = 0, composing = false, filterScope = null;
    let savedFilters = new Map();
    let backdropPointer = false;
    try {
      const saved = JSON.parse(win.localStorage?.getItem(PREFERENCE_KEY) || 'null');
      favorites = preferenceKeys(saved?.favorites, FAVORITE_LIMIT); recent = preferenceKeys(saved?.recent, RECENT_LIMIT);
      const savedDock = preferenceKeys(saved?.dock, DEFAULT_DOCK.length).filter(key => !key.startsWith('help:'));
      if (savedDock.length === DEFAULT_DOCK.length) dockKeys = savedDock;
    } catch (_) { /* Unavailable or malformed preferences must never block navigation. */ }
    const removers = [], observers = [], quickButtons = new Map();
    const raf = win.requestAnimationFrame?.bind(win) || (fn => win.setTimeout(fn, 16));
    const caf = win.cancelAnimationFrame?.bind(win) || win.clearTimeout?.bind(win);
    const listen = (node, type, fn, options) => { node?.addEventListener(type, fn, options); removers.push(() => node?.removeEventListener(type, fn, options)); };
    const hasClass = (node, name) => node?.classList?.contains(name) === true;
    const setAttr = (node, name, value) => { if (value == null) node.removeAttribute(name); else if (node.getAttribute(name) !== String(value)) node.setAttribute(name, String(value)); };
    const touch = () => Number(win.navigator?.maxTouchPoints) > 0 || win.matchMedia?.('(any-pointer: coarse)').matches === true;
    function otherDialog(ignoreLoading = false) {
      return [...doc.querySelectorAll('dialog'), ...doc.querySelectorAll('[role="dialog"]')].some(node => node !== dialog && !(ignoreLoading && node.id === 'game-loading') && (node.open === true || node.getAttribute('aria-modal') === 'true' && !node.hidden && node.getClientRects().length > 0));
    }
    function unavailable() {
      return doc.hidden || app.inert || win.SENGOKU_AT_TITLE === true || hasClass(doc.body, 'at-title') || hasClass(doc.body, 'is-loading') || otherDialog() || Boolean(doc.getElementById('layout-resize-toolbar') && !doc.getElementById('layout-resize-toolbar').hidden);
    }
    function finishNavigation() {
      if (!pendingNavigation) return;
      const main = doc.getElementById('main'), loading = doc.getElementById('game-loading');
      if (!main || main.getAttribute('data-view') !== pendingNavigation.view || doc.hidden || app.inert || win.SENGOKU_AT_TITLE === true || hasClass(doc.body, 'at-title') || dialog.open || otherDialog(true) || Boolean(doc.getElementById('layout-resize-toolbar') && !doc.getElementById('layout-resize-toolbar').hidden)) {
        pendingNavigation = null; return;
      }
      // The existing loading observer will call refresh when its work ends.
      // Never poll, and never let a later render replay this scroll/focus.
      if (hasClass(doc.body, 'is-loading') || loading?.open) return;
      pendingNavigation = null;
      if (!hasClass(root, 'sengoku-desktop-fit')) main.scrollIntoView({ block: 'start', behavior: 'instant' });
      main.focus({ preventScroll: true });
    }
    function cancelPendingNavigation() { pendingNavigation = null; }
    function sourceLabel(node) {
      const label = [...node.children].find(child => child.tagName === 'SPAN' && !hasClass(child, 'nav-count') && !child.hasAttribute('data-icon'));
      return (label?.textContent || node.getAttribute('aria-label') || node.textContent || '').trim().slice(0, 80);
    }
    function sourceHidden(node) { return node.hidden || Boolean(node.closest('[hidden], [aria-hidden="true"]')); }
    function item(key, source, label) {
      const details = DETAILS[key] || ['その他', 'この機能を開く', ''];
      return { key, source, label: label || sourceLabel(source), group: details[0], description: details[1], keywords: details[2], disabled: source.disabled === true, current: hasClass(source, 'active') || source.getAttribute('aria-current') === 'page', icon: source.querySelector('svg')?.outerHTML || svg('menu') };
    }
    function collect() {
      const list = [], seen = new Set();
      const add = entry => { if (entry.label && !seen.has(entry.key)) { seen.add(entry.key); list.push(entry); } };
      for (const node of nav.querySelectorAll('button')) {
        if (sourceHidden(node)) continue;
        const view = node.getAttribute('data-view'), action = node.getAttribute('data-action');
        if (view || action) add(item(view ? 'view:' + view : 'action:' + action, node));
      }
      for (const node of bottom.children) {
        if (node.tagName !== 'BUTTON' || sourceHidden(node) || !hasClass(node, 'nav-item')) continue;
        const action = node.getAttribute('data-action');
        if (action) add(item('action:' + action, node));
        else if (hasClass(node, 'layout-editor-button')) add(item('utility:layout', node));
      }
      const social = doc.querySelector('.social-launcher');
      if (social && !sourceHidden(social)) add(item('utility:social', social, '交流'));
      add({ key: 'help:guide', label: '遊び方', group: '設定・案内', description: '端末ごとの操作と遊び方を別タブで確認', keywords: '操作 ガイド スマホ PC タブレット 初心者 はじめて', href: 'guide/', icon: svg('book') });
      add({ key: 'help:invite', label: '友人に戦国VSを紹介', group: '交流・記録', description: '日本語・英語の公式紹介文とURLを別タブで開く', keywords: '友達 ともだち 招待 海外 英語 シェア 共有 SNS X LINE Discord invite share', href: 'sengoku-vs/#share', icon: svg('external') });
      add({ key: 'help:recovery', label: '引き継ぎ・復元', group: '設定・案内', description: '端末変更とデータの復元を別タブで確認', keywords: '引継ぎ データ 同期 セーブ 復旧 スマホ パソコン バックアップ', href: 'guide/data-recovery/', icon: svg('book') });
      return list;
    }
    const trigger = doc.createElement('button');
    trigger.type = 'button'; trigger.className = 'nav-item navigation-menu-trigger';
    trigger.setAttribute('aria-haspopup', 'dialog'); trigger.setAttribute('aria-controls', 'navigation-dialog'); trigger.setAttribute('aria-expanded', 'false');
    trigger.innerHTML = svg('search') + '<span class="navigation-trigger-copy"><b>すべてのメニュー</b><small>機能名から探す</small></span><kbd aria-hidden="true">Ctrl K</kbd>';
    const favoritesRail = doc.createElement('section');
    favoritesRail.className = 'navigation-favorites-rail'; favoritesRail.hidden = true;
    favoritesRail.setAttribute('aria-label', 'お気に入りの機能');
    const dock = doc.createElement('div'); dock.className = 'navigation-quick-dock';
    for (const [slot, [key, label]] of [['view:town', '城下町'], ['view:map', '天下地図'], ['view:army', '軍団編成'], ['menu', 'メニュー']].entries()) {
      const button = doc.createElement('button'); button.type = 'button'; button.className = 'nav-item navigation-quick';
      button.setAttribute('data-navigation-quick', key);
      button.innerHTML = svg('menu') + '<span>' + label + '</span>';
      if (key === 'menu') { button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('aria-controls', 'navigation-dialog'); button.setAttribute('aria-expanded', 'false'); }
      quickButtons.set(key === 'menu' ? 'menu' : slot, button); dock.appendChild(button);
    }
    dialog.id = 'navigation-dialog'; dialog.className = 'navigation-dialog'; dialog.setAttribute('aria-labelledby', 'navigation-title');
    dialog.innerHTML = '<header class="navigation-dialog-header"><div><h2 id="navigation-title">すべてのメニュー</h2><p class="navigation-current-location" id="navigation-current-location"></p></div><button type="button" class="navigation-close" data-navigation-close aria-label="メニューを閉じる">' + svg('close') + '</button></header>' +
      '<div class="navigation-search-row"><label class="navigation-search"><span class="social-sr-only">メニューを検索</span>' + svg('search') + '<input id="navigation-query" type="search" placeholder="機能名や目的で検索" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go" aria-controls="navigation-results" aria-describedby="navigation-result-status"></label><button type="button" class="navigation-clear" data-navigation-clear aria-label="検索を消去">消去</button></div>' +
      '<div class="navigation-summary"><label class="navigation-category"><span class="social-sr-only">メニューの分類</span><select id="navigation-category" aria-controls="navigation-results"></select></label><button type="button" class="navigation-filter-reset" data-navigation-reset>全条件をクリア</button><p id="navigation-result-status" class="navigation-result-status" role="status" aria-live="polite"></p></div>' +
      '<div class="navigation-purpose-row" role="group" aria-label="目的から機能を探す">' + PURPOSES.map(([id,label]) => '<button type="button" data-navigation-purpose="' + id + '">' + label + '</button>').join('') + '</div>' +
      '<details class="navigation-dock-editor"><summary>下のメニューをカスタマイズ</summary><div class="navigation-dock-settings"><p>スマホ・タブレットの下部に、よく使う機能を3つ置けます。</p><div class="navigation-dock-selects">' + DEFAULT_DOCK.map((_,slot) => '<label><span>左から' + (slot + 1) + '番目</span><select data-navigation-slot="' + slot + '" aria-label="下のメニュー 左から' + (slot + 1) + '番目"></select></label>').join('') + '</div><button type="button" class="navigation-dock-reset" data-navigation-reset-dock>初期配置に戻す</button></div></details>' +
      '<div id="navigation-results" class="navigation-results"></div>' +
      '<footer class="navigation-dialog-footer"><span class="navigation-keyboard-hint">↑ ↓ で選択 · Enter で開く</span><span class="navigation-keyboard-hint">Ctrl / ⌘ K · Esc で閉じる</span></footer>';
    const search = dialog.querySelector('#navigation-query'), results = dialog.querySelector('#navigation-results');
    const category = dialog.querySelector('#navigation-category');
    const currentLocation = dialog.querySelector('#navigation-current-location');
    const status = dialog.querySelector('#navigation-result-status'), clearButton = dialog.querySelector('[data-navigation-clear]');
    const resetButton = dialog.querySelector('[data-navigation-reset]'), purposes = dialog.querySelector('.navigation-purpose-row');
    const slotSelects = [...dialog.querySelectorAll('[data-navigation-slot]')];
    function availableKeys(keys, current = entries) { return keys.filter(key => current.some(entry => entry.key === key)); }
    function renderCategories() {
      const counts = GROUPS.map(group => [group, entries.filter(entry => entry.group === group).length]).filter(([, count]) => count);
      const next = JSON.stringify(counts);
      if (categorySignature === next) return;
      categorySignature = next;
      const selected = category.value;
      category.innerHTML = '<option value="">全分類 · ' + entries.length + '項目</option>' + counts.map(([group, count]) => '<option value="' + esc(group) + '">' + esc(group) + ' · ' + count + '</option>').join('');
      category.value = counts.some(([group]) => group === selected) ? selected : '';
    }
    function renderCurrentLocation() {
      const current = entries.find(entry => entry.current && entry.key.startsWith('view:'));
      const text = current ? '現在の画面：' + current.label : '目的の機能へ、すぐに移動';
      if (currentLocation.textContent !== text) currentLocation.textContent = text;
    }
    function persistPreferences() {
      try {
        if (!win.localStorage) return false;
        win.localStorage.setItem(PREFERENCE_KEY, JSON.stringify({ favorites, recent, dock: dockKeys })); return true;
      } catch (_) { return false; }
    }
    function resolvedDock(current = entries) {
      const allowed = new Set(current.filter(entry => entry.source).map(entry => entry.key));
      const used = new Set();
      return dockKeys.map((key, index) => {
        const resolved = [key, DEFAULT_DOCK[index], ...DEFAULT_DOCK, ...allowed].find(value => allowed.has(value) && !used.has(value));
        if (resolved) used.add(resolved);
        return resolved || null;
      });
    }
    function renderDockEditor() {
      const options = entries.filter(entry => entry.source);
      const next = JSON.stringify(options.map(entry => [entry.key, entry.label, entry.disabled]));
      if (next !== dockOptionsSignature) {
        dockOptionsSignature = next;
        const markup = options.map(entry => '<option value="' + esc(entry.key) + '"' + (entry.disabled ? ' disabled' : '') + '>' + esc(entry.label) + '</option>').join('');
        for (const select of slotSelects) select.innerHTML = markup;
      }
      const resolved = resolvedDock();
      slotSelects.forEach((select, index) => { if (select.value !== resolved[index]) select.value = resolved[index] || ''; });
    }
    function setDockSlot(slot, key) {
      if (!initialized || unavailable() || !Number.isInteger(slot) || slot < 0 || slot >= DEFAULT_DOCK.length) return false;
      entries = collect();
      if (!entries.some(entry => entry.key === key && entry.source && !entry.disabled)) return false;
      const next = resolvedDock(), previous = next[slot], occupied = next.indexOf(key);
      if (previous === key) return true;
      if (occupied !== -1) next[occupied] = previous;
      next[slot] = key;
      if (next.some(value => !value)) return false;
      dockKeys = next;
      const stored = persistPreferences(); refresh(); renderDockEditor();
      status.textContent = '下のメニューを変更しました。' + (stored ? ' この端末で使えます。' : ' この起動中のみ有効です。端末に保存できませんでした。');
      return true;
    }
    function resetDock() {
      if (!initialized || unavailable()) return false;
      dockKeys = [...DEFAULT_DOCK];
      const stored = persistPreferences(); refresh(); renderDockEditor();
      status.textContent = '下のメニューを初期配置に戻しました。' + (stored ? '' : ' この起動中のみ有効です。');
      return true;
    }
    function resetFilters() {
      search.value = ''; category.value = ''; rememberedScroll = 0;
      renderResults(true);
    }
    function renderFavoritesRail() {
      const pinned = availableKeys(favorites).map(key => entries.find(entry => entry.key === key));
      favoritesRail.hidden = !pinned.length;
      const next = JSON.stringify(pinned.map(entry => [entry.key, entry.label, entry.current, entry.disabled]));
      if (next === railSignature) return;
      railSignature = next;
      const focusKey = favoritesRail.contains?.(doc.activeElement) ? doc.activeElement.getAttribute('data-navigation-favorite') : null;
      favoritesRail.innerHTML = '<div class="navigation-favorites-rail-heading"><span>' + svg('star') + 'お気に入り</span><button type="button" data-navigation-edit-favorites aria-label="お気に入りを編集">編集</button></div><div class="navigation-favorites-rail-list">' + pinned.map(entry => {
        const content = entry.icon + '<span>' + esc(entry.label) + '</span>';
        const attrs = ' class="navigation-favorite-shortcut' + (entry.current ? ' is-current' : '') + '" data-navigation-favorite="' + esc(entry.key) + '" title="' + esc(entry.label + ' · ' + entry.description) + '"' + (entry.current ? ' aria-current="page"' : '');
        return entry.href ? '<a' + attrs + ' href="' + entry.href + '" target="_blank" rel="noopener">' + content + '</a>' : '<button type="button"' + attrs + (entry.disabled ? ' disabled' : '') + '>' + content + '</button>';
      }).join('') + '</div>';
      if (focusKey) {
        const target = [...favoritesRail.querySelectorAll('[data-navigation-favorite]')].find(node => node.getAttribute('data-navigation-favorite') === focusKey);
        (target || trigger).focus({ preventScroll: true });
      }
    }
    function remember(key) {
      if (recent[0] === key || !collect().some(entry => entry.key === key)) return;
      recent = [key, ...recent.filter(value => value !== key)].slice(0, RECENT_LIMIT);
      persistPreferences();
    }
    function entryMarkup(entry, scope = 'all') {
      const pinned = favorites.includes(entry.key);
      const query = scope === 'search' ? search.value : '';
      const content = '<span class="navigation-entry-icon">' + entry.icon + '</span><span class="navigation-entry-copy">' +
        (scope === 'search' ? '<span class="navigation-entry-category">' + esc(entry.group) + '</span>' : '') +
        '<b>' + highlightMatch(entry.label, query) + '</b><small>' + highlightMatch(entry.description, query) + '</small></span>' +
        (entry.current ? '<span class="navigation-current">表示中</span>' : '') +
        '<span class="navigation-entry-arrow" aria-hidden="true">' + svg(entry.href ? 'external' : 'arrow') + '</span>';
      const destination = entry.href ? '<a class="navigation-entry" data-navigation-help="' + esc(entry.key) + '" href="' + entry.href + '" target="_blank" rel="noopener">' + content + '</a>' : '<button type="button" class="navigation-entry' + (entry.current ? ' is-current' : '') + '" data-navigation-target="' + esc(entry.key) + '"' + (entry.disabled ? ' disabled' : '') + (entry.current ? ' aria-current="page"' : '') + '>' + content + '</button>';
      return '<div class="navigation-entry-row" data-navigation-scope="' + scope + '">' + destination + '<button type="button" class="navigation-pin' + (pinned ? ' is-pinned' : '') + '" data-navigation-pin="' + esc(entry.key) + '" aria-pressed="' + pinned + '" aria-label="' + esc(entry.label) + 'をお気に入り' + (pinned ? 'から外す' : 'に追加') + '" title="' + (pinned ? 'お気に入りから外す' : 'お気に入りに追加') + '">' + svg('star') + '</button></div>';
    }
    function searchFilterScope() {
      const bridge = win.SengokuBridge, state = bridge?.getState?.();
      const campaign = state?.walking?.campaignId;
      if (!campaign || campaign === 'legacy_v1' || bridge.hasStarted?.() === false) return '';
      const access = win.SengokuSocial?.getExpansionContext?.() || {};
      if (access.pending || access.banned || (access.playerId && access.user?.id !== access.playerId)) return '';
      return 'sengoku-navigation-search-v1:' + JSON.stringify([access.playerId || '', campaign]) + ':';
    }
    function filterKey(query, group) { return JSON.stringify([normalizeQuery(query), group]); }
    function readSavedFilters(force = false) {
      const next = searchFilterScope();
      if (!force && next === filterScope) return;
      if (filterScope !== null && next !== filterScope) {
        search.value = ''; category.value = ''; rememberedScroll = 0; composing = false;
      }
      filterScope = next; savedFilters = new Map();
      if (!next) return;
      try {
        const store = win.localStorage;
        for (let i = 0; i < store.length; i++) {
          const key = store.key(i);
          if (!key?.startsWith(next)) continue;
          const id = key.slice(next.length);
          let pair;
          try { pair = JSON.parse(store.getItem(key)); } catch (_) { continue; }
          if (!Array.isArray(pair) || pair.length !== 2) continue;
          const [query, group] = pair;
          if (typeof query !== 'string' || query.length > 80 || (!group && !query.trim()) ||
            (group !== '' && !GROUPS.includes(group)) || filterKey(query, group) !== id) continue;
          savedFilters.set(id, { query, group });
        }
      } catch (_) { /* Keep live search usable when local storage is unavailable. */ }
    }
    function savedFilterMarkup() {
      if (!filterScope) return '';
      const query = search.value.trim(), group = category.value;
      if (query || group) {
        const saved = savedFilters.has(filterKey(query, group));
        return '<button type="button" class="navigation-filter-save" data-filter-save' + (saved ? ' disabled' : '') + '>' +
          (saved ? '検索条件を保存済み' : 'この検索条件を保存') + '</button>';
      }
      if (!savedFilters.size) return '';
      const rows = [...savedFilters].sort(([a], [b]) => a.localeCompare(b, 'ja')).map(([id, row]) => {
        const label = [row.group, row.query].filter(Boolean).join(' · ');
        return '<div class="navigation-filter-row"><button type="button" data-filter-recall="' + esc(id) + '">' +
          esc(label) + '</button><button type="button" data-filter-remove="' + esc(id) + '" aria-label="' +
          esc(label + 'の検索条件を削除') + '">削除</button></div>';
      });
      return '<section class="navigation-group" aria-label="保存した検索条件"><h3>保存した検索条件</h3><div class="navigation-filter-list">' + rows.join('') + '</div></section>';
    }
    function editSearchFilter(button) {
      if (!dialog.open || unavailable() || composing || !results.contains(button)) return;
      const scope = filterScope;
      readSavedFilters(true);
      if (!scope || scope !== filterScope) { renderResults(true); return; }
      const query = search.value.trim(), group = category.value;
      const id = button.getAttribute('data-filter-recall') || button.getAttribute('data-filter-remove');
      const row = savedFilters.get(id);
      let message;
      entries = collect(); renderCategories();
      if (button.hasAttribute('data-filter-recall')) {
        if (!row || (row.group && !entries.some(entry => entry.group === row.group))) {
          renderResults(); status.textContent = '現在のメニューではこの検索条件を使えません。'; return;
        }
        search.value = row.query; category.value = row.group; renderResults(true);
        const first = [...results.querySelectorAll('[data-navigation-target], [data-navigation-help]')].find(node => !node.disabled);
        (touch() ? first || resetButton : search).focus({ preventScroll: true }); return;
      }
      try {
        if (button.hasAttribute('data-filter-remove') && row) {
          win.localStorage.removeItem(scope + id); savedFilters.delete(id); message = '検索条件を削除しました。';
        } else if (button.hasAttribute('data-filter-save') && (query || group) && group === category.value) {
          if (query.length > 80) { status.textContent = '検索条件は80文字以内で保存できます。'; return; }
          // Each condition has its own key, so separate tabs never replace an unrelated condition.
          const key = filterKey(query, group);
          win.localStorage.setItem(scope + key, JSON.stringify([query, group]));
          savedFilters.set(key, {query, group}); message = '検索条件を保存しました。全条件をクリアすると一覧から呼び出せます。';
        } else { renderResults(); return; }
      } catch (_) { status.textContent = '端末の検索条件を更新できませんでした。'; return; }
      renderResults(); status.textContent = message;
      (touch() ? results.querySelector('[data-filter-recall]') || dialog.querySelector('[data-navigation-close]') : search).focus({ preventScroll: true });
    }
    function renderResults(resetScroll = false) {
      readSavedFilters();
      if (composing) return;
      const groupEntries = category.value ? entries.filter(entry => entry.group === category.value) : entries;
      const matches = filterEntries(groupEntries, search.value);
      const visibleFavorites = availableKeys(favorites), visibleRecent = availableKeys(recent).filter(key => !visibleFavorites.includes(key));
      const next = JSON.stringify([filterScope, [...savedFilters], search.value, category.value, visibleFavorites, visibleRecent, matches.map(entry => [entry.key, entry.label, entry.disabled, entry.current])]);
      if (next === signature) return;
      signature = next;
      const focused = doc.activeElement;
      const focusAttribute = ['data-navigation-pin','data-navigation-target','data-navigation-help','data-filter-recall','data-filter-remove'].find(attribute => focused?.hasAttribute?.(attribute));
      const focusKey = focusAttribute && focused.getAttribute(focusAttribute);
      const focusScope = focused?.closest?.('[data-navigation-scope]')?.getAttribute('data-navigation-scope');
      const scroll = resetScroll ? 0 : results.scrollTop;
      status.textContent = search.value.trim() || category.value ? matches.length + '件見つかりました' : '全' + entries.length + '項目 · 星でお気に入りに追加';
      clearButton.disabled = !search.value;
      resetButton.disabled = !search.value && !category.value;
      dialog.classList.toggle('is-filtered', Boolean(search.value.trim() || category.value));
      purposes.hidden = Boolean(search.value.trim() || category.value);
      const groups = [savedFilterMarkup()];
      if (!search.value.trim() && !category.value && visibleFavorites.length) {
        const cards = visibleFavorites.map(key => entryMarkup(entries.find(entry => entry.key === key), 'favorites')).join('');
        groups.push('<section class="navigation-group navigation-favorites" aria-label="お気に入り"><div class="navigation-group-heading"><h3>' + svg('star') + 'お気に入り</h3><small>' + visibleFavorites.length + ' / ' + FAVORITE_LIMIT + '</small></div><div class="navigation-entry-grid">' + cards + '</div></section>');
      }
      if (!search.value.trim() && !category.value && visibleRecent.length) {
        const recentLinks = visibleRecent.map(key => {
          const entry = entries.find(row => row.key === key);
          const label = entry.icon + '<span>' + esc(entry.label) + '</span>';
          return entry.href ? '<a class="navigation-recent-link" data-navigation-help="' + esc(key) + '" href="' + entry.href + '" target="_blank" rel="noopener">' + label + '</a>' :
            '<button type="button" class="navigation-recent-link" data-navigation-target="' + esc(key) + '"' + (entry.disabled ? ' disabled' : '') + '>' + label + '</button>';
        }).join('');
        groups.push('<section class="navigation-group navigation-recent" aria-label="最近開いた機能" data-navigation-scope="recent"><div class="navigation-group-heading"><h3>' + svg('clock') + '最近開いた機能</h3><button type="button" class="navigation-clear-recent" data-navigation-clear-recent>履歴を消去</button></div><div class="navigation-recent-list">' + recentLinks + '</div></section>');
      }
      const hasQuery = Boolean(normalizeQuery(search.value));
      const otherMatches = category.value ? filterEntries(entries, search.value).length - matches.length : 0;
      const empty = '<div class="navigation-empty">' + svg('search') + '<b>見つかりませんでした</b><p>' +
        (otherMatches ? 'ほかの分類に、条件に合う機能があります。' : '短い言葉や、やりたいことで探してみてください。') + '</p>' +
        (otherMatches ? '<button type="button" class="navigation-search-recovery" data-navigation-clear-category>すべての分類で' + otherMatches + '件を見る</button>' :
          '<div class="navigation-search-suggestions" aria-label="検索の例">' + ['施設', '派遣', '武将', '保存'].map(query => '<button type="button" data-navigation-suggestion="' + query + '">' + query + '</button>').join('') + '</div>') +
        '<button type="button" class="navigation-empty-reset" data-navigation-reset>すべてのメニューを表示</button></div>';
      const resultMarkup = !matches.length ? empty : hasQuery ? '<section class="navigation-group navigation-search-matches" aria-label="検索結果"><div class="navigation-group-heading"><h3>検索結果</h3><small>機能名との一致を優先</small></div><div class="navigation-entry-grid">' + matches.map(entry => entryMarkup(entry, 'search')).join('') + '</div></section>' : GROUPS.map(group => {
        const rows = matches.filter(entry => entry.group === group); if (!rows.length) return '';
        return '<section class="navigation-group"><h3>' + group + '<span class="navigation-group-count">' + rows.length + '</span></h3><div class="navigation-entry-grid">' + rows.map(entry => entryMarkup(entry)).join('') + '</div></section>';
      }).join('');
      results.innerHTML = groups.join('') + resultMarkup;
      if (focusKey) {
        const candidates = [...results.querySelectorAll('[' + focusAttribute + ']')].filter(node => node.getAttribute(focusAttribute) === focusKey);
        (candidates.find(node => node.closest('[data-navigation-scope]')?.getAttribute('data-navigation-scope') === focusScope) || candidates[0] || search).focus({ preventScroll: true });
      }
      results.scrollTop = scroll;
    }
    function toggleFavorite(key) {
      if (!initialized || unavailable()) return false;
      entries = collect();
      const entry = entries.find(row => row.key === key); if (!entry) return false;
      favorites = availableKeys(favorites);
      const pinned = favorites.includes(key);
      if (!pinned && favorites.length >= FAVORITE_LIMIT) { status.textContent = 'お気に入りは6件までです。登録済みの星を押して外してから追加してください。'; return false; }
      favorites = pinned ? favorites.filter(value => value !== key) : [...favorites, key];
      const stored = persistPreferences(); renderResults(); renderFavoritesRail();
      status.textContent = entry.label + 'をお気に入り' + (pinned ? 'から外しました。' : 'に追加しました。') + (stored ? '' : ' この起動中のみ有効です。端末に保存できませんでした。');
      return true;
    }
    function clearRecent() {
      if (!initialized || unavailable()) return false;
      recent = []; const stored = persistPreferences(); renderResults(); renderFavoritesRail();
      status.textContent = '最近開いた機能の履歴を消去しました。' + (stored ? '' : ' 端末への保存はできませんでした。');
      return true;
    }
    function expanded(value) { setAttr(trigger, 'aria-expanded', value); setAttr(quickButtons.get('menu'), 'aria-expanded', value); }
    function close(restore = true) { restoreFocus = restore; expanded(false); if (dialog.open) { rememberedScroll = results.scrollTop; dialog.close(); } }
    function refresh() {
      frame = 0; if (!initialized) return;
      entries = collect();
      renderFavoritesRail();
      renderCurrentLocation();
      const resolved = resolvedDock();
      for (const [slot, button] of quickButtons) {
        if (slot === 'menu') continue;
        const key = resolved[slot];
        setAttr(button, 'data-navigation-quick', key || 'unavailable');
        const entry = entries.find(entry => entry.key === key);
        button.disabled = !entry || entry.disabled;
        button.classList.toggle('active', entry?.current === true);
        setAttr(button, 'aria-current', entry?.current ? 'page' : null);
        const markup = (entry?.icon || svg('menu')) + '<span>' + esc(entry?.label || '未使用') + '</span>';
        if (button.innerHTML !== markup) button.innerHTML = markup;
      }
      if (dialog.open) { if (unavailable()) close(false); else { renderCategories(); renderResults(); renderDockEditor(); } }
      finishNavigation();
    }
    function schedule() { if (initialized && !frame) frame = raf(refresh); }
    function open(from) {
      if (!initialized || unavailable()) return false;
      if (dialog.open) return true;
      entries = collect(); returnFocus = from || doc.activeElement; restoreFocus = true;
      readSavedFilters(true); renderCategories(); renderCurrentLocation();
      const scroll = rememberedScroll;
      signature = ''; renderResults(); renderDockEditor();
      dialog.showModal(); expanded(true); results.scrollTop = scroll;
      (touch() ? dialog.querySelector('[data-navigation-close]') : search).focus({ preventScroll: true });
      return true;
    }
    function activate(key) {
      if (unavailable()) return false;
      const entry = collect().find(entry => entry.key === key);
      if (!entry?.source?.isConnected || entry.disabled) return false;
      const ledgerReturn = key === 'action:defense-ledger' ? (dialog.open ? returnFocus : doc.activeElement) : null;
      close(false); pendingNavigation = key.startsWith('view:') ? { view: key.slice(5) } : null;
      if (key === 'action:defense-ledger') {
        // The canonical sidebar control may be hidden on a phone. Give the
        // new dialog a visible launcher to restore when the ledger closes.
        const visibleMenu = hasClass(root, 'sengoku-desktop-fit') ? trigger : quickButtons.get('menu');
        const target = ledgerReturn?.isConnected && ledgerReturn.getClientRects?.().length && !ledgerReturn.closest('dialog') && ledgerReturn !== doc.body ? ledgerReturn : visibleMenu;
        target.focus({ preventScroll: true });
      }
      entry.source.click();
      // Record an accepted destination only after its canonical control runs.
      // No command, account data or game save is stored in these preferences.
      if (!key.startsWith('view:') || doc.getElementById('main')?.getAttribute('data-view') === key.slice(5)) remember(key);
      schedule();
      return true;
    }
    function keydown(event) {
      if (event.defaultPrevented || event.repeat || event.isComposing || event.altKey || event.shiftKey || !(event.ctrlKey || event.metaKey) || String(event.key).toLowerCase() !== 'k') return;
      const target = event.target;
      if (target?.isContentEditable || target?.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]') || unavailable()) return;
      event.preventDefault(); open(target);
    }
    function destroy() {
      close(false); initialized = false; pendingNavigation = null; if (frame) caf?.(frame); frame = 0;
      for (const observer of observers) observer.disconnect();
      for (const remove of removers.splice(0)) remove();
      root.classList.remove('sengoku-navigation-ready'); trigger.remove(); favoritesRail.remove(); dock.remove(); dialog.remove();
    }
    listen(trigger, 'click', () => open(trigger));
    listen(favoritesRail, 'click', event => {
      const button = event.target.closest('[data-navigation-favorite]');
      if (button && !button.disabled) {
        const key = button.getAttribute('data-navigation-favorite');
        if (button.tagName === 'A') remember(key); else activate(key);
      } else if (event.target.closest('[data-navigation-edit-favorites]')) open(event.target.closest('[data-navigation-edit-favorites]'));
    });
    listen(dialog, 'pointerdown', event => { backdropPointer = event.target === dialog; });
    listen(dock, 'click', event => { const button = event.target.closest('[data-navigation-quick]'); if (!button || button.disabled) return; const key = button.getAttribute('data-navigation-quick'); if (key === 'menu') open(button); else activate(key); });
    listen(dialog, 'click', event => {
      if (event.target === dialog && backdropPointer) {
        const rect = dialog.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
      }
      backdropPointer = false;
      const filterButton = event.target.closest('[data-filter-save], [data-filter-recall], [data-filter-remove]');
      if (filterButton) { editSearchFilter(filterButton); return; }
      const pin = event.target.closest('[data-navigation-pin]');
      if (pin) { toggleFavorite(pin.getAttribute('data-navigation-pin')); return; }
      const target = event.target.closest('[data-navigation-target]');
      if (target && !target.disabled) activate(target.getAttribute('data-navigation-target'));
      else if (event.target.closest('[data-navigation-close]')) close();
      else if (event.target.closest('[data-navigation-reset-dock]')) resetDock();
      else if (event.target.closest('[data-navigation-reset]')) { resetFilters(); search.focus({ preventScroll: true }); }
      else if (event.target.closest('[data-navigation-clear-category]')) { category.value = ''; renderResults(true); search.focus({ preventScroll: true }); }
      else if (event.target.closest('[data-navigation-suggestion]')) {
        search.value = event.target.closest('[data-navigation-suggestion]').getAttribute('data-navigation-suggestion');
        category.value = ''; renderResults(true); search.focus({ preventScroll: true });
      }
      else if (event.target.closest('[data-navigation-purpose]')) {
        const purpose = PURPOSES.find(([id]) => id === event.target.closest('[data-navigation-purpose]').getAttribute('data-navigation-purpose'));
        if (purpose) { category.value = purpose[2]; search.value = purpose[3]; renderResults(true); category.focus({ preventScroll: true }); }
      }
      else if (event.target.closest('[data-navigation-clear]')) { search.value = ''; renderResults(true); search.focus({ preventScroll: true }); }
      else if (event.target.closest('[data-navigation-clear-recent]')) { clearRecent(); search.focus({ preventScroll: true }); }
      else if (event.target.closest('[data-navigation-help]')) { remember(event.target.closest('[data-navigation-help]').getAttribute('data-navigation-help')); close(); }
    });
    listen(dialog, 'close', () => {
      // A queued close event must not undo a menu reopened in the meantime.
      if (dialog.open) return;
      composing = false; expanded(false);
      if (restoreFocus && !otherDialog() && !unavailable()) {
        const visibleMenu = hasClass(root, 'sengoku-desktop-fit') ? trigger : quickButtons.get('menu');
        const target = returnFocus?.isConnected && returnFocus.getClientRects?.().length ? returnFocus : visibleMenu;
        target.focus({ preventScroll: true });
      }
      returnFocus = null;
    });
    listen(dialog, 'cancel', () => { rememberedScroll = results.scrollTop; });
    listen(results, 'scroll', () => { if (dialog.open) rememberedScroll = results.scrollTop; }, { passive: true });
    listen(search, 'compositionstart', () => { composing = true; });
    listen(search, 'compositionend', () => { composing = false; if (dialog.open) renderResults(true); });
    listen(search, 'input', event => { if (!composing && !event.isComposing) renderResults(true); });
    listen(win, 'storage', event => {
      if (dialog.open && filterScope && (event.key === null || event.key?.startsWith(filterScope))) {
        readSavedFilters(true); renderResults();
      }
    });
    for (const select of slotSelects) listen(select, 'change', () => { if (!setDockSlot(Number(select.getAttribute('data-navigation-slot')), select.value)) renderDockEditor(); });
    // Search results support keyboard travel without changing the native Tab order.
    listen(dialog, 'keydown', event => {
      if (!dialog.open || composing || event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey) return;
      const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
      if ((event.key === 'Enter' || keys.includes(event.key)) && otherDialog()) return;
      const active = doc.activeElement;
      if (event.key === 'Enter' && active === search && !event.repeat && !event.shiftKey) {
        const query = normalizeQuery(search.value);
        if (!query) return;
        const current = collect(), matches = filterEntries(category.value ? current.filter(entry => entry.group === category.value) : current, query);
        const exact = matches.filter(entry => normalizeQuery(entry.label) === query);
        const target = exact.length === 1 ? exact[0] : matches.length === 1 ? matches[0] : null;
        // Only an unambiguous, live in-game destination accepts Enter from search.
        // External guides keep their normal link activation and ambiguous input
        // stays in the field. In particular an IME confirmation never navigates.
        if (target?.source && !target.disabled && activate(target.key)) event.preventDefault();
        return;
      }
      if (!keys.includes(event.key) || (active !== search && !active?.hasAttribute?.('data-navigation-target') && !active?.hasAttribute?.('data-navigation-help'))) return;
      if (active === search && !['ArrowDown', 'ArrowUp'].includes(event.key)) return;
      const targets = [...results.querySelectorAll('[data-navigation-target], [data-navigation-help]')].filter(node => !node.disabled);
      if (!targets.length) return;
      event.preventDefault();
      let index = targets.indexOf(active);
      if (event.key === 'Home') index = 0;
      else if (event.key === 'End') index = targets.length - 1;
      else if (active === search) index = event.key === 'ArrowDown' ? 0 : targets.length - 1;
      else index = Math.max(0, Math.min(targets.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
      targets[index].focus({ preventScroll: true });
      targets[index].scrollIntoView?.({ block: 'nearest' });
    });
    listen(category, 'change', () => renderResults(true));
    for (const event of ['wheel', 'touchmove', 'pointerdown']) listen(doc, event, cancelPendingNavigation, { capture: true, passive: true });
    listen(doc, 'keydown', event => { if (!['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) cancelPendingNavigation(); }, { capture: true });
    listen(doc, 'focusin', event => { const surface = event.target.closest?.('dialog, [role="dialog"]'); if (surface && surface.id !== 'game-loading') cancelPendingNavigation(); }, { capture: true });
    listen(doc, 'visibilitychange', () => { if (doc.hidden) cancelPendingNavigation(); });
    listen(doc, 'keydown', keydown);
    listen(doc, 'click', event => {
      const source = event.target.closest?.('button');
      if (!source || source.disabled) return;
      const entry = collect().find(row => row.source === source);
      if (entry && (!entry.key.startsWith('view:') || doc.getElementById('main')?.getAttribute('data-view') === entry.key.slice(5))) remember(entry.key);
    });
    listen(win, 'resize', schedule, { passive: true });
    listen(win, 'pageshow', schedule);
    nav.parentElement.insertBefore(trigger, nav); nav.parentElement.insertBefore(favoritesRail, nav); bottom.appendChild(dock); doc.body.appendChild(dialog);
    initialized = true; refresh(); root.classList.add('sengoku-navigation-ready');
    if (win.MutationObserver) {
      const navigationObserver = new win.MutationObserver(schedule);
      navigationObserver.observe(nav, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'aria-current', 'disabled', 'hidden'] }); observers.push(navigationObserver);
      const bodyObserver = new win.MutationObserver(schedule);
      bodyObserver.observe(doc.body, { attributes: true, attributeFilter: ['class'] }); observers.push(bodyObserver);
      const utilityObserver = new win.MutationObserver(schedule);
      utilityObserver.observe(bottom, { childList: true }); observers.push(utilityObserver);
    }
    return { open, close, refresh, activate, destroy, toggleFavorite, clearRecent, setDockSlot, resetDock, getDock: () => resolvedDock(collect()), isOpen: () => dialog.open, getPreferences: () => ({ favorites: availableKeys(favorites, collect()), recent: availableKeys(recent, collect()) }), getEntries: () => collect().map(({ source, icon, ...entry }) => entry) };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { createNavigationUI, normalizeQuery, filterEntries, highlightMatch };
  if (!global.document || global.SengokuNavigation) return;
  const start = () => { if (!global.SengokuNavigation) global.SengokuNavigation = createNavigationUI(global); };
  if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})(typeof window !== 'undefined' ? window : globalThis);
