/* Chat replies and explicit mention recipients. Drafts stay in session memory. */
(function (global) {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const normalize = value => String(value || '').normalize('NFKC').toLocaleLowerCase('ja');
  const short = (value, limit = 120) => Array.from(String(value || '')).slice(0, limit).join('');
  const validId = value => ['string', 'number'].includes(typeof value) && String(value).length > 0 && String(value).length <= 180;
  function people(rows) {
    const result = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
      const userId = row?.userId ?? row?.id;
      if (!validId(userId) || typeof row.name !== 'string' || !row.name.trim()) continue;
      result.set(String(userId), { userId: String(userId), name: short(row.name, 24) });
    }
    return [...result.values()];
  }
  function mentionToken(text, cursor) {
    const end = Number.isInteger(cursor) ? Math.max(0, Math.min(cursor, String(text).length)) : String(text).length;
    const before = String(text).slice(0, end), match = /(?:^|[\s（(])@([^@\s]{0,24})$/u.exec(before);
    return match ? { start: end - match[1].length - 1, end, query: match[1] } : null;
  }
  function textMarkup(text, mentions) {
    const value = String(text ?? ''), names = [...new Set(people(mentions).map(p => '@' + p.name))].sort((a, b) => b.length - a.length);
    if (!names.length) return esc(value);
    const pattern = new RegExp(names.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gu');
    let start = 0, html = '';
    for (const match of value.matchAll(pattern)) {
      html += esc(value.slice(start, match.index)) + '<mark class="social-chat-mention-text">' + esc(match[0]) + '</mark>';
      start = match.index + match[0].length;
    }
    return html + esc(value.slice(start));
  }
  function messageDetails(message, actorId) {
    const reply = message?.replyTo;
    let html = '';
    if (reply?.unavailable) html += '<div class="social-chat-quote is-unavailable">返信先の発言は表示できません</div>';
    else if (reply && Number.isSafeInteger(Number(reply.id))) html += `<button type="button" class="social-chat-quote" data-chat-action="jump" data-chat-message="${Number(reply.id)}"><strong>${esc(reply.name || '領主')}への返信</strong><span>${esc(short(reply.text))}${reply.truncated ? '…' : ''}</span></button>`;
    const mentions = people(message?.mentions);
    if (mentions.length) html += `<div class="social-chat-message-mentions" aria-label="メンションの宛先">${mentions.map(p => `<span class="social-chat-mention-chip${String(p.userId) === String(actorId) ? ' is-self' : ''}" title="領主ID: ${esc(p.userId)}">@${esc(p.name)}${String(p.userId) === String(actorId) ? ' · あなた宛て' : ''}</span>`).join('')}</div>`;
    return html;
  }
  function create(options) {
    const drafts = new Map();
    let root = null, bound = null, attachedInput = null, candidates = [], active = 0, menuToken = null, composing = false, searchTimer = null, searchGeneration = 0, searchIdentity = '';
    const find = selector => root?.querySelector?.(selector);
    const context = () => options.context?.() || null;
    const capabilities = () => options.capabilities?.() || {};
    function draft(c = context()) {
      if (!c) return null;
      if (!drafts.has(c.key)) drafts.set(c.key, { key: c.key, channel: c.channel, text: '', mentions: [], reply: null, revision: 0 });
      return drafts.get(c.key);
    }
    function focusInput() { const input = find('#social-chat-input'); try { input?.focus({preventScroll:true}); } catch { input?.focus(); } }
    function form() {
      const state = draft();
      return `<form id="social-chat-form" class="social-chat-form social-chat-enhanced"><div id="social-chat-compose-context" class="social-chat-compose-context" hidden><div id="social-chat-reply-preview" hidden></div><div id="social-chat-selected-mentions" class="social-chat-selected-mentions" hidden></div></div><div class="social-chat-compose-tools"><button type="button" class="social-chat-tool" data-chat-action="mention-open"${capabilities().chatMentions ? '' : ' hidden'} aria-label="領主をメンションする">@ メンション</button><small id="social-chat-register">上位の領主へは敬語で送信します。</small><span id="social-chat-count" aria-live="off">${(state?.text || '').length}/300</span></div><label class="social-sr-only" for="social-chat-input">メッセージ</label><textarea id="social-chat-input" name="text" rows="2" maxlength="300" placeholder="メッセージを入力。@で宛先を選択" aria-describedby="social-chat-register social-chat-help" aria-autocomplete="list" aria-controls="social-chat-mention-list" aria-expanded="false" required>${esc(state?.text || '')}</textarea><div id="social-chat-mention-menu" class="social-chat-mention-menu" hidden><div class="social-chat-mention-heading"><span>メンションする領主を選択</span><button type="button" class="social-chat-tool" data-chat-action="mention-close" aria-label="メンション候補を閉じる">閉じる</button></div><div id="social-chat-mention-list" role="listbox" aria-label="メンション候補"></div><small id="social-chat-mention-status" role="status"></small></div><div class="social-chat-form-bottom"><span id="social-chat-help">送信ボタンで送信。パソコンではEnterで送信、Shift+Enterで改行。</span><button type="submit" class="social-button primary">送信</button></div></form>`;
    }
    function setHTML(node, value) { if (node && node.innerHTML !== value) node.innerHTML = value; }
    function updateDecorations() {
      const state = draft(); if (!state) return;
      const preview = find('#social-chat-reply-preview'), selected = find('#social-chat-selected-mentions'), count = find('#social-chat-count'), composeContext = find('#social-chat-compose-context');
      if (composeContext) composeContext.hidden = !state.reply && !state.mentions.length;
      if (preview) {
        preview.hidden = !state.reply;
        setHTML(preview, state.reply ? `<div class="social-chat-reply-draft" role="group" aria-label="返信先：${esc(state.reply.name)}" title="${esc(state.reply.name)}への返信：${esc(short(state.reply.text))}"><div><strong>${esc(state.reply.name)}への返信</strong><span>${esc(short(state.reply.text))}</span></div><button type="button" class="social-chat-tool" data-chat-action="reply-clear" aria-label="${esc(state.reply.name)}への返信を解除">解除</button></div>` : '');
      }
      if (selected) {
        selected.hidden = !state.mentions.length;
        setHTML(selected, state.mentions.map(p => `<button type="button" class="social-chat-recipient" data-chat-action="mention-remove" data-chat-user="${esc(p.userId)}" aria-label="${esc(p.name)}へのメンションを解除">@${esc(p.name)} <span aria-hidden="true">×</span></button>`).join(''));
      }
      if (count) count.textContent = state.text.length + '/300';
      const input = find('#social-chat-input'); if (input) global.SengokuVariants?.instance?.refresh?.(input);
      const mentionButton = find('[data-chat-action="mention-open"]'); if (mentionButton) mentionButton.hidden = !capabilities().chatMentions;
    }
    function syncText() {
      const state = draft(), input = find('#social-chat-input'); if (!state || !input) return;
      if (state.text !== input.value) { state.text = input.value; state.revision++; }
      const retained = state.mentions.filter(p => state.text.includes('@' + p.name));
      if (retained.length !== state.mentions.length) { state.mentions = retained; state.revision++; }
      updateDecorations();
    }
    function closeMenu() {
      clearTimeout(searchTimer); searchTimer = null; searchGeneration++; searchIdentity = ''; candidates = []; menuToken = null; active = 0;
      const menu = find('#social-chat-mention-menu'), input = find('#social-chat-input'); if (menu) menu.hidden = true;
      input?.setAttribute?.('aria-expanded', 'false'); input?.removeAttribute?.('aria-activedescendant');
    }
    function renderCandidates(status = '') {
      const menu = find('#social-chat-mention-menu'), list = find('#social-chat-mention-list'), input = find('#social-chat-input');
      if (!menu || !list || !input || !menuToken) return;
      menu.hidden = false; input.setAttribute('aria-expanded', 'true');
      active = Math.max(0, Math.min(active, candidates.length - 1));
      setHTML(list, candidates.map((p, i) => `<button type="button" id="social-chat-mention-${i}" class="social-chat-mention-option" role="option" aria-selected="${i === active}" data-chat-action="mention-pick" data-chat-user="${esc(p.userId)}"><strong>@${esc(p.name)}</strong><small>${esc(p.userId)}</small></button>`).join(''));
      if (candidates.length) input.setAttribute('aria-activedescendant', 'social-chat-mention-' + active); else input.removeAttribute('aria-activedescendant');
      const note = find('#social-chat-mention-status'); if (note) note.textContent = status || (candidates.length ? '上下キーで選択・Enterで決定・Escで閉じる' : '候補がありません。名前を入力して探してください。');
      positionMenu();
    }
    function positionMenu() {
      const menu = find('#social-chat-mention-menu'), input = find('#social-chat-input');
      if (!menu || menu.hidden || !root?.getBoundingClientRect || !input?.getBoundingClientRect) return;
      const box = root.getBoundingClientRect(), field = input.getBoundingClientRect(), available = field.top - box.top - 18;
      const width = Math.max(0, Math.min(box.width - 24, field.width + 90));
      Object.assign(menu.style, { left: Math.max(12, Math.min(field.left - box.left, box.width - width - 12)) + 'px', right: 'auto', width: width + 'px', maxHeight: Math.min(260, Math.max(96, available >= 96 ? available : box.height - 24)) + 'px' });
      if (available >= 96) { menu.style.bottom = Math.max(12, box.height - (field.top - box.top) + 6) + 'px'; menu.style.top = 'auto'; }
      else { menu.style.top = '12px'; menu.style.bottom = 'auto'; }
    }
    function suggestions({ search = true } = {}) {
      const c = context(), input = find('#social-chat-input'), state = draft();
      if (!c || !input || !state || composing || !capabilities().chatMentions) { closeMenu(); return; }
      const token = mentionToken(input.value, input.selectionStart);
      if (!token) { closeMenu(); return; }
      const identity = c.key + ':' + token.start + ':' + token.query;
      const changed = identity !== searchIdentity;
      if (changed) { clearTimeout(searchTimer); searchGeneration++; searchIdentity = identity; active = 0; }
      menuToken = token;
      const matches = rows => people(rows).filter(p => p.userId !== String(c.actorId) && !state.mentions.some(m => m.userId === p.userId) && normalize(p.name + ' ' + p.userId).includes(normalize(token.query))).slice(0, 8);
      if (changed || !candidates.length) candidates = matches(options.candidates?.(c) || []);
      renderCandidates();
      if (search && changed && c.channel === 'world' && token.query && options.search) {
        const generation = searchGeneration;
        searchTimer = setTimeout(async () => {
          searchTimer = null;
          try {
            const rows = await options.search(token.query);
            if (generation !== searchGeneration || context()?.key !== c.key || searchIdentity !== identity) return;
            candidates = matches([...(options.candidates?.(c) || []), ...rows]); renderCandidates();
          } catch { if (generation === searchGeneration) renderCandidates(candidates.length ? '' : '候補を取得できませんでした。会話中の領主を選ぶか、もう一度入力してください。'); }
        }, 220);
      }
    }
    function choose(userId) {
      const state = draft(), input = find('#social-chat-input'), person = candidates.find(p => p.userId === String(userId));
      if (!state || !input || !person || !menuToken) return;
      if (state.mentions.length >= 8) { options.notice?.('一度にメンションできるのは8人までです。', true); return; }
      const token = mentionToken(input.value, input.selectionStart); if (!token || token.start !== menuToken.start) { closeMenu(); return; }
      const inserted = '@' + person.name + ' ', next = input.value.slice(0, token.start) + inserted + input.value.slice(token.end);
      if (next.length > 300) { options.notice?.('メンションを含めて300文字以内にしてください。', true); return; }
      state.text = next; state.mentions.push(person); state.revision++; input.value = next; closeMenu(); updateDecorations(); focusInput();
      input.setSelectionRange?.(token.start + inserted.length, token.start + inserted.length);
    }
    function click(event) {
      const button = event.target?.closest?.('[data-chat-action]');
      if (!button) { if (event.target?.id !== 'social-chat-input' && !event.target?.closest?.('#social-chat-mention-menu')) closeMenu(); return; }
      if (!root?.contains?.(button)) return;
      const action = button.dataset.chatAction, state = draft(), input = find('#social-chat-input');
      if (!state) return;
      if (action === 'reply') {
        if (!capabilities().chatReplies) return;
        const message = options.message?.(button.dataset.chatMessage); if (!message) return;
        state.reply = { id: Number(message.id), userId: String(message.userId), name: String(message.name || '領主'), text: String(message.text || '') }; state.revision++; updateDecorations(); closeMenu(); focusInput();
      } else if (action === 'reply-clear') { state.reply = null; state.revision++; updateDecorations(); focusInput(); }
      else if (action === 'mention-remove') { state.mentions = state.mentions.filter(p => p.userId !== button.dataset.chatUser); state.revision++; updateDecorations(); focusInput(); }
      else if (action === 'mention-close') { closeMenu(); focusInput(); }
      else if (action === 'mention-pick') choose(button.dataset.chatUser);
      else if (action === 'mention-open' && input && capabilities().chatMentions) {
        const start = input.selectionStart ?? input.value.length, end = input.selectionEnd ?? start;
        const prefix = start && !/\s/.test(input.value[start - 1]) ? ' @' : '@';
        if (input.value.length - (end - start) + prefix.length > 300) return;
        input.value = input.value.slice(0, start) + prefix + input.value.slice(end); input.setSelectionRange?.(start + prefix.length, start + prefix.length); syncText(); focusInput(); suggestions();
      } else if (action === 'jump') {
        const target = find('#social-chat-message-' + Number(button.dataset.chatMessage));
        if (target) { target.scrollIntoView?.({block:'nearest', behavior:'auto'}); target.focus?.({preventScroll:true}); }
        else options.notice?.('返信先は現在の履歴表示範囲外です。引用の内容を確認できます。');
      }
    }
    function keydown(event) {
      if (event.target?.id !== 'social-chat-input') return false;
      if (event.isComposing || event.keyCode === 229 || composing) return event.key === 'Enter';
      if (!menuToken || find('#social-chat-mention-menu')?.hidden) return false;
      if (['ArrowDown', 'ArrowUp'].includes(event.key) && candidates.length) { event.preventDefault(); active = (active + (event.key === 'ArrowDown' ? 1 : -1) + candidates.length) % candidates.length; renderCandidates(); find('#social-chat-mention-' + active)?.scrollIntoView?.({block:'nearest', behavior:'auto'}); return true; }
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (candidates[active]) choose(candidates[active].userId); return true; }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation?.(); closeMenu(); return true; }
      return false;
    }
    function attach(dialog) {
      root = dialog;
      const currentInput = find('#social-chat-input');
      if (currentInput !== attachedInput) { composing = false; attachedInput = currentInput; }
      if (dialog && dialog !== bound) {
        bound = dialog;
        dialog.addEventListener?.('click', click);
        // Keep the software keyboard and compact composer in place while a
        // pointer chooses an option. Keyboard users can still Tab to buttons.
        dialog.addEventListener?.('pointerdown', event => {
          const button = event.target?.closest?.('#social-chat-mention-menu button');
          if (button && root?.contains?.(button) && root.ownerDocument?.activeElement === find('#social-chat-input')) event.preventDefault();
        });
        dialog.addEventListener?.('input', event => { if (event.target.id === 'social-chat-input') { syncText(); if (!event.isComposing) suggestions(); } });
        dialog.addEventListener?.('compositionstart', event => { if (event.target.id === 'social-chat-input') { composing = true; closeMenu(); } });
        dialog.addEventListener?.('compositionend', event => { if (event.target.id === 'social-chat-input') { composing = false; syncText(); suggestions(); } });
        dialog.addEventListener?.('keyup', event => { if (event.target.id === 'social-chat-input' && ['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) suggestions(); });
        global.addEventListener?.('resize', positionMenu, {passive:true});
        global.visualViewport?.addEventListener?.('resize', positionMenu, {passive:true});
      }
      // Keep the picker inside the modal but outside the clipped mobile chat
      // column, so the software keyboard cannot hide its options or close button.
      const currentMenu = find('#social-chat-form')?.querySelector?.('#social-chat-mention-menu');
      if (currentMenu && root?.appendChild) {
        for (const menu of root.querySelectorAll?.('#social-chat-mention-menu') || []) if (menu !== currentMenu) menu.remove?.();
        root.appendChild(currentMenu);
      }
      closeMenu(); updateDecorations();
    }
    function prepare(text) {
      const c = context(), state = draft(); if (!c || !state) return null;
      syncText(); const trimmed = String(text ?? state.text).trim(); if (!trimmed) return null;
      if (state.reply && !capabilities().chatReplies || state.mentions.length && !capabilities().chatMentions) throw Error('返信・メンションの対応状態を確認してから、もう一度送信してください。');
      return { key: c.key, revision: state.revision, text: trimmed, sourceText: state.text, replyToId: state.reply?.id || null, mentionIds: state.mentions.map(p => p.userId) };
    }
    function sent(snapshot) {
      const state = drafts.get(snapshot?.key);
      if (!state || state.revision !== snapshot.revision || state.text !== snapshot.sourceText) return;
      state.text = ''; state.reply = null; state.mentions = []; state.revision++;
      if (context()?.key !== snapshot.key) return;
      const input = find('#social-chat-input'); if (input) input.value = ''; closeMenu(); updateDecorations();
    }
    function clear(scope) { for (const [key, state] of drafts) if (!scope || state.channel === scope) drafts.delete(key); closeMenu(); }
    function destroy() { clear(); global.removeEventListener?.('resize', positionMenu); global.visualViewport?.removeEventListener?.('resize', positionMenu); root = null; }
    return { form, attach, keydown, prepare, sent, clear, destroy, closeMenu, updateDecorations, click };
  }
  const api = { create, people, mentionToken, textMarkup, messageDetails };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.SengokuChatUI = api;
})(typeof window !== 'undefined' ? window : globalThis);
