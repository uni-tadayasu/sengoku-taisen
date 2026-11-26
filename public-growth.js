/* Anonymous introduction-page event counts. No cookies, account identifiers,
   saved game data, full URLs, referrers or third-party analytics SDKs. */
(function () {
  'use strict';
  try {
    const script = document.currentScript;
    const page = new URL(window.location.href);
    const pageKey = new Map([
      ['/sengoku-vs/', 'ja'], ['/sengoku-vs/index.html', 'ja'],
      ['/en/', 'en'], ['/en/index.html', 'en']
    ]).get(page.pathname);
    // Never report local previews, downloads or the game itself.
    if (!pageKey || page.protocol !== 'https:' || typeof window.fetch !== 'function') return;
    const api = new URL(script?.dataset?.api || '');
    if (api.protocol !== 'https:' || api.username || api.password || api.search || api.hash ||
        !['/', '/api/v1', '/api/v1/', '/api/v1/promotion/event'].includes(api.pathname)) return;
    const endpoint = new URL('/api/v1/promotion/event', api.origin).href;
    const allowedSources = new Set(['direct', 'x', 'line', 'youtube', 'press', 'friend', 'discord', 'copy_link', 'share_text', 'native_share', 'english', 'other']);
    let source = (page.searchParams.get('utm_source') || '').trim().toLowerCase();
    if (source === 'twitter') source = 'x';
    source = source ? allowedSources.has(source) ? source : 'other' : 'direct';
    const sent = new Set();

    function optedOut() {
      try {
        const dnt = [navigator.doNotTrack, navigator.msDoNotTrack, window.doNotTrack];
        return navigator.globalPrivacyControl === true || dnt.some(value => /^(?:1|yes)$/i.test(String(value || '')));
      } catch { return true; }
    }

    function report(event) {
      if (optedOut() || sent.has(event)) return;
      const key = 'sengoku-promotion-v1:' + pageKey + ':' + event;
      try { if (window.sessionStorage.getItem(key) === '1') return; } catch {}
      sent.add(event);
      // Session storage is a per-tab duplicate guard, not a visitor identifier.
      // If it is denied, this page's in-memory guard still prevents repeats.
      try { window.sessionStorage.setItem(key, '1'); } catch {}
      try {
        const request = window.fetch(endpoint, {
          method: 'POST', mode: 'cors', credentials: 'omit', redirect: 'error',
          referrerPolicy: 'no-referrer', referrer: '', cache: 'no-store', keepalive: true,
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({event, source})
        });
        // Reporting must never delay navigation or surface a gameplay error.
        if (request && typeof request.catch === 'function') request.catch(function () {});
      } catch {}
    }

    if (optedOut()) return;
    report('landing');
    document.addEventListener('click', function (event) {
      if (event.defaultPrevented || event.isTrusted === false || (event.button != null && event.button !== 0)) return;
      try {
        const link = event.target?.closest?.('a[href]');
        if (!link || link.hasAttribute('download')) return;
        const destination = new URL(link.getAttribute('href'), page.href);
        if (destination.origin !== page.origin || !['/', '/index.html'].includes(destination.pathname)) return;
        report('play_click');
      } catch {}
    }, {passive: true});
  } catch {
    // Unsupported APIs or a missing/invalid configuration leave the page intact.
  }
})();
