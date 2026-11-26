'use strict';

// Editorial release notes only. The feed is generated with the public pages;
// it does not schedule work, post to social accounts, or access player data.
const releases = require('./news-releases.json');
const { trailer } = require('./promotion-content.cjs');
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const releaseId = release => 'v' + release.version.replaceAll('.', '-');

function validateReleases(site) {
  const seen = new Set();
  for (const release of releases) {
    if (!/^\d+\.\d+\.\d+$/.test(release.version) || seen.has(release.version)) throw Error('Release notes need unique semantic versions');
    seen.add(release.version);
    const date = new Date(release.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(release.date) || Number.isNaN(+date) || date.toISOString().slice(0, 10) !== release.date || release.date > site.dateModified) throw Error('Release notes need a verified update date');
    if (!release.title || !release.summary || !Array.isArray(release.changes) || !release.changes.length) throw Error('Release notes need useful public content');
    for (const item of release.changes) if (!item.title || !item.text) throw Error('Release changes need a title and description');
    for (const link of release.links || []) if (!link.label || !/^\/(?:[a-z0-9-]+\/)*(?:#[a-z0-9-]+)?$/.test(link.path)) throw Error('Release links must point to public site pages');
  }
  if (!releases.length) throw Error('At least one verified release is required');
  for (let index = 1; index < releases.length; index++) if (releases[index].date > releases[index - 1].date) throw Error('Release notes must be newest first');
}

function renderNewsContent(p, { section, site }) {
  validateReleases(site);
  return [
    ...releases.map(release => section(releaseId(release), `Ver.${esc(release.version)} · ${esc(release.date)}`, esc(release.title), `
      <p class="lead-paragraph">${esc(release.summary)}</p>
      <dl class="release-changes">${release.changes.map(item => `<div><dt>${esc(item.title)}</dt><dd>${esc(item.text)}</dd></div>`).join('')}</dl>
      <nav class="release-links" aria-label="Ver.${esc(release.version)}の関連ガイド">${(release.links || []).map(link => `<a href="${esc(p.dir(link.path.slice(1).split('#')[0].replace(/\/$/, '')) + (link.path.includes('#') ? '#' + link.path.split('#')[1] : ''))}">${esc(link.label)}</a>`).join('')}</nav>
    `)),
    section('follow-updates', '更新を受け取る', '戦国VSの新しいお知らせを読む', `
      <p>このページで、遊び方に関わる主な変更をまとめています。更新情報をまとめて読みたい方は、下のRSSのURLをお使いのRSSリーダーへ登録してください。</p>
      <div class="news-follow"><a class="action-link" href="${esc(p.file('news/feed.xml'))}" type="application/rss+xml">更新情報のRSSを開く</a><a href="${esc(p.dir('press'))}">記事・配信で紹介するための素材</a></div>
      <div class="promotion-copy-block"><label for="news-feed-address">RSSリーダーに登録するURL</label><div class="promotion-url-row"><input id="news-feed-address" type="text" inputmode="url" value="${esc(site.origin)}/news/feed.xml" readonly spellcheck="false" autocomplete="off"><button class="promotion-copy-button" type="button" data-copy-target="news-feed-address" data-copy-success="RSSのURLをコピーしました。お使いのRSSリーダーに貼り付けてください。" hidden>RSSのURLをコピー</button></div><p class="promotion-copy-status" role="status" aria-live="polite"></p></div>
      <h3>24秒の作品紹介</h3>
      <p>初めての方には、城下町づくり・武将編成・合戦の雰囲気を伝える、公式イラストの紹介動画を用意しています。実際の操作画面は<a href="${esc(p.dir('sengoku-vs'))}#game-screens">ゲーム紹介のスクリーンショット</a>で確認できます。</p>
      <p><a href="${esc(trailer.url)}" target="_blank" rel="noopener noreferrer">YouTubeで戦国VSの紹介動画を見る</a></p>
    `)
  ].join('\n');
}

function renderRss(site) {
  validateReleases(site);
  const page = site.origin + site.pages.news.path;
  const items = releases.map(release => {
    const url = page + '#' + releaseId(release);
    const description = [release.summary, ...release.changes.map(item => item.title + '：' + item.text)].join('\n\n');
    // The source records a verified calendar date, not a guessed release time.
    // Dublin Core preserves that precision; RSS pubDate is optional.
    return `    <item>\n      <title>${esc('Ver.' + release.version + '｜' + release.title)}</title>\n      <link>${esc(url)}</link>\n      <guid isPermaLink="true">${esc(url)}</guid>\n      <dc:date>${esc(release.date)}</dc:date>\n      <description>${esc(description)}</description>\n    </item>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">\n  <channel>\n    <title>${esc(site.name)} 公式更新情報</title>\n    <link>${esc(page)}</link>\n    <description>戦国VSの遊び方・操作画面・追加機能に関わる主な更新をお知らせします。</description>\n    <language>ja</language>\n    <copyright>© ${esc(site.publisher)}</copyright>\n    <ttl>60</ttl>\n    <atom:link href="${esc(site.origin)}/news/feed.xml" rel="self" type="application/rss+xml"/>\n${items.join('\n')}\n  </channel>\n</rss>\n`;
}

module.exports = { releases, releaseId, renderNewsContent, renderRss, validateReleases };
