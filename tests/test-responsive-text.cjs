'use strict';
// Structural guardrails for the production cascade. Browser QA separately
// measures rendered bounds; these checks prevent the known clipping contracts
// from returning when another stylesheet or component is added.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { transformSync } = require('esbuild');
const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const css = read('responsive-text.css');
const manifest = JSON.parse(read('tools/game-entry.json'));
const withoutComments = value => value.replace(/\/\*[\s\S]*?\*\//g, '');
const compact = value => value.replace(/\s+/g, '').replace(/;$/, '');
function splitSelectors(value) {
  let depth = 0, start = 0;
  const result = [];
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '(' || value[i] === '[') depth++;
    if (value[i] === ')' || value[i] === ']') depth--;
    if (value[i] === ',' && !depth) { result.push(value.slice(start, i).trim()); start = i + 1; }
  }
  result.push(value.slice(start).trim());
  return result;
}
const parseRules = source => [...withoutComments(source).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(match => ({
  selectors: splitSelectors(match[1]),
  declarations: Object.fromEntries(match[2].split(';').filter(value => value.includes(':')).map(value => {
    const colon = value.indexOf(':');
    return [value.slice(0, colon).trim(), value.slice(colon + 1).trim()];
  }))
}));
const rules = parseRules(css);
function rulesInMaxWidth(width) {
  const source = withoutComments(css), result = [];
  const query = new RegExp('@media\\s*\\(max-width:\\s*' + width + 'px\\)\\s*\\{', 'g');
  for (const match of source.matchAll(query)) {
    const start = match.index + match[0].length;
    let depth = 1, end = start;
    while (end < source.length && depth) {
      if (source[end] === '{') depth++;
      if (source[end] === '}') depth--;
      end++;
    }
    assert.equal(depth, 0, 'Unclosed max-width media block: ' + width);
    result.push(...parseRules(source.slice(start, end - 1)));
  }
  assert(result.length, 'Missing max-width media block: ' + width);
  return result;
}
function declarations(selector, scope = rules) {
  const matched = scope.filter(rule => rule.selectors.some(value => compact(value) === compact(selector)));
  assert(matched.length, 'Missing production rule: ' + selector);
  return Object.assign({}, ...matched.map(rule => rule.declarations));
}
function property(selector, name, expected, scope = rules) {
  assert.equal(compact(declarations(selector, scope)[name] || ''), compact(expected), selector + ' / ' + name);
}
let count = 0;
function test(name, run) { run(); count++; console.log('PASS ' + name); }

test('content corrections load after every legacy game layout and compile cleanly', () => {
  assert.equal(manifest['game-layout.bundle.css'].at(-1), 'responsive-text.css');
  const result = transformSync(css, { loader: 'css', minify: true, target: ['es2020'] });
  assert.equal(result.warnings.length, 0);
  assert(result.code.includes('overflow-wrap:anywhere'));
});

test('bounded scrolling collections keep natural-height rows instead of shrinking cards', () => {
  for (const selector of ['.sengoku-desktop-fit .world-layout-real .castle-detail', '.officer-choice-list', '.court-message-list', '.court-thread-list', '.cq-castle-list']) {
    property(selector, 'grid-auto-rows', 'max-content');
    property(selector, 'align-content', 'start');
    assert(!('height' in declarations(selector)), selector + ' must retain its own scroll viewport');
    assert(!('overflow' in declarations(selector)), selector + ' must retain its own scroll viewport');
  }
  assert.match(read('court.css'), /\.court-message-list\{[^}]*overflow:auto/);
  assert.match(read('conquest.css'), /\.cq-castle-list\{[^}]*overflow:auto/);
});

test('building descriptions and the player heading cannot return to ellipsis', () => {
  for (const selector of ['#app #main .building-card p', '#app #main .town-lord-identity :is(.player-evaluation-name,.sengoku-premium-name)']) {
    property(selector, 'white-space', 'normal');
    property(selector, 'overflow', 'visible');
    property(selector, 'text-overflow', 'clip');
    property(selector, 'overflow-wrap', 'anywhere');
  }
  assert(read('app.js').includes('class="town-lord-identity"'));
  assert(read('app.js').includes('class="building-card'));
});

test('ledger and recruitment table cells preserve all balance digits at narrow widths', () => {
  property('#app #main .economy-row', 'grid-template-columns', 'minmax(0,1fr) minmax(0,1.15fr)');
  for (const selector of ['#app #main .economy-row :is(dt,dd)', '#app #main .economy-breakdown :is(dt,dd)', '#app #main .recruit-preview :is(th,td)', '#modal .facility-maintenance :is(th,td)']) {
    property(selector, 'min-width', '0');
    property(selector, 'white-space', 'normal');
    property(selector, 'overflow-wrap', 'anywhere');
  }
  assert.match(read('economy.css'), /#main \.recruit-preview table\s*\{[^}]*table-layout:\s*fixed/);
  assert.match(read('economy.css'), /#modal \.facility-maintenance table\s*\{[^}]*table-layout:\s*fixed/);
});

test('territorial search controls can shrink inside the clipped geography frame', () => {
  property('.cq-shell :is(label,input,select,textarea)', 'min-width', '0');
  property('.cq-shell :is(label,input,select,textarea)', 'max-width', '100%');
  property('.cq-shell .cq-search', 'grid-template-columns', 'minmax(0,1fr)');
  assert.match(css, /@media\s*\(max-width:\s*480px\)[\s\S]*?\.cq-shell \.cq-search\s*\{\s*grid-template-columns:\s*minmax\(0,1fr\)/);
  assert(read('conquest.js').includes('<div class="cq-search"><label>'));
});

test('recruiting results and major army/research totals cannot conceal long values', () => {
  for (const selector of ['#app #main .army-muster-overview strong', '#app #main .research-overview-metrics strong', '#app #main .gacha-balance b', '#app #main .gacha-source b', '#modal .gacha-result-label', '#modal .governor-result-summary b']) {
    property(selector, 'min-width', '0');
    property(selector, 'white-space', 'normal');
    property(selector, 'overflow-wrap', 'anywhere');
  }
  property('#app #main .gacha-source', 'flex-wrap', 'wrap');
  assert(read('app.js').includes('NEW · 新家臣・新絵巻'));
});

test('operational count cards adapt to panel width and enlarged root text', () => {
  for (const selector of ['.cq-shell .cq-metrics', '.events-progress', '.events-adviser-stats', '.moderation-counts']) {
    property(selector, 'grid-template-columns', 'repeat(auto-fit,minmax(min(100%,9rem),1fr))');
  }
  property(':is(.events-progress,.events-adviser-stats,.moderation-counts) :is(dt,dd,small)', 'overflow-wrap', 'anywhere');
});

test('phone settings place labels above full-width selects and preserve slider space', () => {
  property('#modal .settings-hub .settings-row > .select', 'max-width', '100%');
  property('#modal .settings-hub .settings-row > #tips', 'width', '100%');
  property('#modal .settings-hub .settings-volume', 'grid-template-columns', 'minmax(0,1fr) 4ch');
  property('#modal .settings-hub .settings-volume > label', 'grid-column', '1 / -1');
  assert.match(read('app.js'), /class="settings-row settings-volume"><label[^>]+>[^<]+<\/label><input[^>]+type="range"[^>]+><output/);
});

test('action labels and territory totals remain available without changing map surfaces', () => {
  property('#launch-screen #launch-enter.edition-enter', 'height', 'auto');
  property('#launch-screen #launch-enter.edition-enter', 'min-width', '0');
  property('#launch-screen #launch-enter [data-enter-label]', 'min-width', '0');
  property('#launch-screen #launch-enter [data-enter-label]', 'white-space', 'normal');
  property('#launch-screen #launch-enter [data-enter-label]', 'overflow-wrap', 'anywhere');
  const dock = 'html.sengoku-navigation-ready:not(.sengoku-desktop-fit) #app.chronicle-shell .sidebar-bottom .navigation-quick';
  property(dock, 'height', 'auto');
  property(dock, 'min-height', 'var(--compact-dock-button-min)');
  property(dock, 'grid-template-rows', '20px max-content');
  property('html.sengoku-navigation-ready:not(.sengoku-desktop-fit)', '--compact-dock-button-min', '4.25rem');
  property('html.sengoku-navigation-ready:not(.sengoku-desktop-fit)', '--compact-dock-height', 'calc(var(--compact-dock-button-min) + .8125rem)');
  assert(read('responsive-polish.css').includes('padding-bottom: calc(var(--compact-dock-height) + 20px + env(safe-area-inset-bottom, 0px))'));
  for (const selector of ['#app #main .button', '#modal .button', '.cq-shell .cq-button', '.events-dialog .events-button', '.moderation-dialog .moderation-button']) {
    property(selector, 'min-width', '0');
    property(selector, 'max-width', '100%');
    property(selector, 'white-space', 'normal');
    property(selector, 'overflow-wrap', 'anywhere');
  }
  property('#app #main .territory-row', 'flex-wrap', 'wrap');
  property('#app #main .territory-numbers > .base-durability', 'min-width', '0');
  assert.match(read('conquest.css'), /\.cq-table\{[^}]*min-width:430px/);
  assert.match(read('conquest.css'), /\.cq-table-wrap\{[^}]*overflow:auto/);
  const selectors = rules.flatMap(rule => rule.selectors).join('\n');
  assert(!/\.cq-map\b|\.cq-marker\b|\.sg-map\b|\.hotspot\b|\.painted-portrait\b|\.letters-preview\b|\[data-job-clock\]/.test(selectors));
  for (const rule of rules) {
    assert(!/hidden|clip/.test(rule.declarations.overflow || ''), 'New content rules must not conceal overflow');
    assert((!('height' in rule.declarations) || rule.declarations.height === 'auto') && !('max-height' in rule.declarations), 'Text rules must not force card heights');
    assert(!('display' in rule.declarations) || rule.declarations.display !== 'none', 'Text rules must not hide existing controls');
  }
});

test('phone breakpoints reserve brush-label height, a separate community slot and full resource totals', () => {
  const compactRoot = 'html.sengoku-navigation-ready:not(.sengoku-desktop-fit)';
  const phone = rulesInMaxWidth(700), narrow = rulesInMaxWidth(360), resources = rulesInMaxWidth(480);
  // The new brush face needs 68px buttons at a 16px root on the narrowest
  // phones. The shared dock reservation must scale with that text minimum.
  property(compactRoot, '--compact-dock-button-min', '4.75rem', phone);
  property(compactRoot, '--compact-dock-height', 'calc(var(--compact-dock-button-min) + .8125rem)', phone);
  property(compactRoot, '--compact-dock-button-min', '4.25rem', narrow);
  for (const selector of [compactRoot + ' #app.chronicle-shell .sidebar-bottom .navigation-quick', compactRoot + ' body:not(.at-title) .social-launcher']) {
    property(selector, 'height', 'auto', phone);
    property(selector, 'min-height', 'var(--compact-dock-button-min)', phone);
    property(selector, 'grid-template-rows', '20px max-content', phone);
  }
  property(compactRoot + ' #app.chronicle-shell .sidebar-bottom', 'grid-template-columns', 'repeat(3,minmax(0,1fr)) minmax(0,1.3fr) var(--compact-dock-slot)', narrow);
  for (const selector of ['html:not(.sengoku-desktop-fit) #app.chronicle-shell .topbar #resources .resource', 'html:not(.sengoku-desktop-fit) #app.chronicle-shell .topbar #touch-header-status > button']) {
    property(selector, 'grid-column', 'span 3', resources);
  }
});

console.log(count + ' responsive text structure checks passed. Rendered bounds require browser QA.');
