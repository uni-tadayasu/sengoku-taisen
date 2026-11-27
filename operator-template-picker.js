(function (global) {
  'use strict';

  const doc = global.document;
  const context = () => global.SengokuSocial?.getPromotionContext?.();
  const normalize = text => text.normalize('NFKC').toLocaleLowerCase('ja');
  const identityKey = value => [value.playerId, value.epoch, value.accountEpoch, value.privilegeEpoch].join('/');

  function fields(form) {
    return {
      body: form.querySelector('textarea'),
      subject: form.querySelector('input[name="title"], #court-audience-title')
    };
  }

  function writeDraft(field, value) {
    field.value = value;
    field.dispatchEvent(new global.Event('input', {bubbles: true}));
  }

  function openPicker(button) {
    const owner = context(), form = button.form, catalog = global.SengokuOperatorMessageTemplates;
    if (!owner?.isAdmin || !form || button.disabled || !catalog?.length) return;
    const initial = fields(form);
    if (!initial.body || initial.body.disabled || initial.subject?.disabled) return;

    const ownerKey = identityKey(owner), dialog = doc.createElement('dialog');
    dialog.id = 'operator-template-dialog';
    dialog.setAttribute('aria-labelledby', 'operator-template-heading');
    dialog.innerHTML = `
      <div class="operator-template-shell">
        <header><h2 id="operator-template-heading">運営用 文書テンプレート</h2><button class="button small" type="button" data-template-close>閉じる</button></header>
        <div class="operator-template-filters">
          <label>検索<input id="operator-template-query" type="search" placeholder="件名・本文から探す" autocomplete="off"></label>
          <label>分類<select id="operator-template-category"></select></label>
        </div>
        <label>テンプレート <span data-template-count role="status"></span><select id="operator-template-list"></select></label>
        <div class="operator-template-preview"><h3 data-template-title></h3><p data-template-preview></p></div>
        <p class="operator-template-hint" data-template-hint>【 】内を実際の内容に書き換えてから送信してください。</p>
        <p role="status" data-template-error hidden></p>
        <button type="button" class="button gold" data-template-apply></button>
      </div>`;
    const find = selector => dialog.querySelector(selector);
    const category = find('#operator-template-category'), query = find('#operator-template-query');
    const list = find('#operator-template-list'), apply = find('[data-template-apply]');
    const preview = find('[data-template-preview]'), hint = find('[data-template-hint]'), error = find('[data-template-error]');
    category.add(new global.Option('すべての分類', ''));
    for (const name of new Set(catalog.map(row => row.category))) category.add(new global.Option(name, name));
    const targetLabel = initial.subject ? '件名と本文' : '本文';
    apply.textContent = initial.body.value || initial.subject?.value ? targetLabel + 'を置き換える' : targetLabel + 'に使う';

    function renderPreview() {
      const row = catalog.find(item => item.id === list.value);
      find('[data-template-title]').textContent = row?.title || '該当する文書がありません';
      preview.textContent = row?.body || '分類や検索する言葉を変えてください。';
      hint.hidden = !row?.body.includes('【');
      apply.disabled = !row;
    }
    function filter() {
      const previous = list.value, term = normalize(query.value.trim());
      const matches = catalog.filter(row => (!category.value || row.category === category.value) &&
        (!term || normalize(row.title + ' ' + row.body).includes(term)));
      list.replaceChildren(...matches.map(row => new global.Option(row.title, row.id)));
      if (matches.some(row => row.id === previous)) list.value = previous;
      list.disabled = !matches.length;
      find('[data-template-count]').textContent = matches.length + ' / ' + catalog.length + '件';
      renderPreview();
    }

    let focusTarget = button;
    query.addEventListener('input', filter);
    category.addEventListener('change', filter);
    list.addEventListener('change', renderPreview);
    find('[data-template-close]').addEventListener('click', () => dialog.close());
    dialog.addEventListener('keydown', event => { if (event.key === 'Escape') event.stopPropagation(); });
    dialog.addEventListener('close', () => {
      dialog.remove();
      if (focusTarget?.isConnected) focusTarget.focus({preventScroll: true});
    }, {once: true});
    apply.addEventListener('click', () => {
      const current = context(), targets = fields(form), row = catalog.find(item => item.id === list.value);
      if (!current?.isAdmin || identityKey(current) !== ownerKey || !button.isConnected || !form.isConnected ||
          button.disabled || form.closest('dialog:not([open]),[hidden],[inert]') || !targets.body ||
          targets.body.disabled || targets.subject?.disabled) {
        error.textContent = '入力画面か運営権限が更新されました。画面を閉じて宛先をご確認ください。';
        error.hidden = false;
        apply.disabled = true;
        return;
      }
      if (!row) return;
      // Dispatch ordinary input events so letters, chat and court retain their own draft state.
      if (targets.subject) writeDraft(targets.subject, row.title);
      const body = targets.body.id ? doc.getElementById(targets.body.id) : targets.body;
      if (!body?.isConnected) return;
      writeDraft(body, row.body);
      focusTarget = body.id ? doc.getElementById(body.id) : body;
      const first = /【[^】]+】/u.exec(row.body);
      focusTarget?.setSelectionRange(first?.index ?? row.body.length, first ? first.index + first[0].length : row.body.length);
      dialog.close();
    });
    filter();
    doc.body.append(dialog);
    dialog.showModal();
    query.focus({preventScroll: true});
  }

  global.SengokuOpenOperatorTemplatePicker = openPicker;
})(typeof window !== 'undefined' ? window : globalThis);
