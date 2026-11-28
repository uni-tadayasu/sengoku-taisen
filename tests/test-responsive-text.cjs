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
function scopedRules(query) {
  const source = withoutComments(css), result = [];
  for (const match of source.matchAll(query)) {
    const start = match.index + match[0].length;
    let depth = 1, end = start;
    while (end < source.length && depth) {
      if (source[end] === '{') depth++;
      if (source[end] === '}') depth--;
      end++;
    }
    assert.equal(depth, 0, 'Unclosed conditional rule: ' + match[0]);
    result.push(...parseRules(source.slice(start, end - 1)));
  }
  assert(result.length, 'Missing conditional rules: ' + query);
  return result;
}
const rulesInMaxWidth = width => scopedRules(new RegExp('@media\\s*\\(max-width:\\s*' + width + 'px\\)\\s*\\{', 'g'));
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
  assert.deepEqual(manifest['game-layout.bundle.css'].slice(-4), ['responsive-text.css', 'tablet-layout.css', 'tablet-landscape.css', 'territory-owners.css']);
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
  const chooser = read('conquest.js');
  assert.match(chooser, /<div class="cq-search">.*?<label for="cq-search">/);
  assert.match(chooser, /<div class="cq-search-controls"><input id="cq-search".*?<button type="button"[^>]*data-cq="search-list"/);
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
  property('html.sengoku-navigation-ready:not(.sengoku-desktop-fit)', '--compact-dock-button-min', '4.5rem');
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

test('phone breakpoints reserve brush-label height and a separate community slot', () => {
  const compactRoot = 'html.sengoku-navigation-ready:not(.sengoku-desktop-fit)';
  const phone = rulesInMaxWidth(700), narrow = rulesInMaxWidth(360);
  // The six-button row needs 72px buttons at a 16px root on the narrowest
  // phones. The shared dock reservation must scale with that text minimum.
  property(compactRoot, '--compact-dock-button-min', '4.75rem', phone);
  property(compactRoot, '--compact-dock-height', 'calc(var(--compact-dock-button-min) + .8125rem)', phone);
  property(compactRoot, '--compact-dock-button-min', '4.5rem', narrow);
  for (const selector of [compactRoot + ' #app.chronicle-shell .sidebar-bottom .navigation-quick', compactRoot + ' body:not(.at-title) .social-launcher']) {
    property(selector, 'height', 'auto', phone);
    property(selector, 'min-height', 'var(--compact-dock-button-min)', phone);
    property(selector, 'grid-template-rows', '20px max-content', phone);
  }
  const dockSelector = compactRoot + ' #app.chronicle-shell .sidebar-bottom';
  property(dockSelector, 'grid-template-columns', 'repeat(2,minmax(0,1fr)) minmax(0,1.6fr) repeat(3,minmax(0,1fr))', parseRules(read('navigation-ui.css')));
  assert(!narrow.some(rule => rule.selectors.includes(dockSelector) && rule.declarations['grid-template-columns']), 'Narrow text rules must retain the six-slot dock and its reserved community slot');
});

test('the ledger can reflow with its available width and has a fallback for oversized amounts', () => {
  const ledger = '#app.chronicle-shell .chronicle-ledger';
  const container = ledger + ' .header-balances';
  const card = container + ' :is(#resources,#touch-header-status) > button';
  const containerName = declarations(container).container.split('/')[0].trim();
  const condition = new RegExp('@container\\s+' + containerName + '\\s*\\(max-width:[^)]+\\)\\s*\\{', 'g');
  const columns = scopedRules(condition)
    .filter(rule => rule.selectors.includes(card))
    .map(rule => compact(rule.declarations['grid-column'] || ''));
  property(container, 'grid-template-columns', 'repeat(6,minmax(0,1fr))');
  for (const match of css.matchAll(condition)) {
    const width = match[0].match(/max-width:\s*(\d+)px/);
    assert(width && Number(width[1]) < 744, 'A 768px tablet with 12px gutters must show all six counters in one row at every game text setting');
  }
  assert(columns.some(value => /^span[2-5]$/.test(value)), 'Six counters should share fewer columns when the ledger narrows');
  assert(columns.includes('1/-1'), 'A very narrow ledger must allow a whole row per counter');
  property(card, 'container-type', 'inline-size');
  for (const selector of [ledger + ' #resources .resource-amount', ledger + ' #touch-header-status .touch-header-stat-value']) {
    const sizing = declarations(selector);
    assert.match(sizing['font-size'], /\dcqi\b/, 'Counter text must size against its own card');
    property(selector, 'white-space', 'normal');
    property(selector, 'overflow-wrap', 'anywhere');
  }
  property(ledger + ' #resources .resource-amount > span', 'display', 'block');
  property(ledger + ' #resources .resource-gain', 'display', 'block');
});

test('the clock, balances and controls share one header row on a landscape tablet', () => {
  const wide = scopedRules(/@container\s+ledger\s*\(min-width:\s*810px\)\s*\{/g);
  const group = 'html #app.chronicle-shell header.topbar.chronicle-ledger .header-balances';
  property(group, 'grid-column', '2', wide);
  property(group, 'grid-row', '1', wide);
  property(group, 'grid-template-columns', 'repeat(4,minmax(0,1fr)) minmax(0,.55fr) minmax(0,1fr)', wide);
  const header = parseRules(read('chronicle-game.css'));
  property('#app #calendar', 'grid-row', '1', header);
  property('#app.chronicle-shell .topbar.chronicle-ledger .header-actions', 'grid-column', '3', header);
  property('#app.chronicle-shell .topbar.chronicle-ledger .header-actions', 'grid-row', '1', header);
});

// A focused used-value check for the shared tablet dialog. These three modal
// selectors have the same (1,2,1) specificity, so manifest order decides their
// width/left cascade. This deliberately is not a browser layout implementation.
const { viewportBox } = require('../social-viewport.js');
const { tabletPortraitMode, tabletLandscapeMode } = require('../desktop-fit.js');
const polishRules = parseRules(read('responsive-polish.css'));
const tabletRules = parseRules(read('tablet-layout.css'));
const landscapeRules = parseRules(read('tablet-landscape.css'));
const tabletScope = 'html:is(.sengoku-tablet-portrait, .sengoku-tablet-landscape)';
const sharedDialog = polishRules.filter(rule => rule.declarations['--dialog-width'] && rule.selectors.some(selector => selector.includes('#modal.modal')));
assert.equal(sharedDialog.length, 1, 'The shared dialog geometry must have one source');
const tabletDialog = declarations(tabletScope + ' #modal.modal', tabletRules);
const landscapeDialog = declarations('html.sengoku-tablet-landscape #modal.modal', landscapeRules);
const wideDialog = declarations('#modal:is(.start-castle-modal,.level-guide-modal,.officer-comparison-modal,.army-planner-modal)', polishRules);
// All geometry fixtures below are wider than 701px. The later :root media rule
// therefore applies, but the tablet root's (0,1,1) specificity beats :root.
const tabletVariables = { ...declarations(':root', polishRules), ...declarations(tabletScope, tabletRules) };

function pixels(value, variables, environment, viewport, depth = 0) {
  assert(depth < 20, 'Cyclic dialog custom property: ' + value);
  let expression = String(value);
  for (let match; (match = /\b(var|env)\(/.exec(expression));) {
    const start = match.index + match[0].length;
    let end = start, nesting = 1;
    while (end < expression.length && nesting) {
      if (expression[end] === '(') nesting++;
      if (expression[end] === ')') nesting--;
      end++;
    }
    assert.equal(nesting, 0, 'Unclosed CSS function: ' + expression);
    const [name, ...fallback] = splitSelectors(expression.slice(start, end - 1));
    const replacement = (match[1] === 'var' ? variables : environment)[name] ?? (fallback.length ? fallback.join(',') : undefined);
    assert.notEqual(replacement, undefined, 'Missing CSS value: ' + name);
    expression = expression.slice(0, match.index) + '(' + pixels(replacement, variables, environment, viewport, depth + 1) + ')' + expression.slice(end);
  }
  expression = expression.replace(/(\d*\.?\d+)(px|d?vw|d?vh|%)/g, (_, number, unit) => String(Number(number) * (unit === 'px' ? 1 : /vh$/.test(unit) ? viewport.height / 100 : viewport.width / 100)))
    .replace(/\bcalc\(/g, '(').replace(/\b(min|max)\(/g, 'Math.$1(');
  // Only numeric arithmetic and the two explicitly allowed math functions can
  // reach Function; declarations cannot execute JavaScript from a stylesheet.
  assert.match(expression.replace(/\bMath\.(?:min|max)/g, ''), /^[\d\s.,()+*/-]+$/, 'Unsupported CSS length: ' + value);
  const result = Function('"use strict"; return (' + expression + ');')();
  assert(Number.isFinite(result), 'Non-finite CSS length: ' + value);
  return result;
}

function tabletModalBounds(width, height, { visualViewport, safeLeft = 0, safeRight = 0, wide = false, beforeViewport = false, legacy = false } = {}) {
  const landscape = tabletLandscapeMode(width, height, 5, true);
  assert(landscape || tabletPortraitMode(width, height, 5, true), 'Fixture must select a tablet layout');
  let tablet = tabletDialog, horizontal = landscapeDialog;
  if (legacy) {
    // Negative control: restore only the two old CSS declarations in memory.
    // This leaves the actual production files and shared centering untouched.
    tablet = { ...tabletDialog, width: 'calc(100% - 24px)', 'max-width': '1080px' };
    horizontal = { ...landscapeDialog, 'max-width': '1280px' };
    delete tablet['--dialog-preferred-width'];
    delete horizontal['--dialog-preferred-width'];
  }
  const box = viewportBox(width, height, visualViewport);
  const style = { ...(wide ? wideDialog : {}), ...sharedDialog[0].declarations, ...tablet, ...(landscape ? horizontal : {}) };
  const variables = { ...tabletVariables, ...style };
  if (!beforeViewport) for (const [name, value] of Object.entries(box)) variables['--social-viewport-' + name] = value + 'px';
  const environment = { 'safe-area-inset-left': safeLeft + 'px', 'safe-area-inset-right': safeRight + 'px' };
  const length = value => pixels(value, variables, environment, { width, height });
  const actualWidth = Math.max(length(style['min-width'] || '0'), Math.min(length(style.width), length(style['max-width'])));
  return { box, left: length(style.left), width: actualWidth, sharedWidth: length(variables['--dialog-width']), gutterLeft: length(variables['--compact-gutter-left']), gutterRight: length(variables['--compact-gutter-right']) };
}

function assertDialogFits(bounds, label) {
  const { box, left, width, sharedWidth, gutterLeft, gutterRight } = bounds;
  const detail = label + ' ' + JSON.stringify(bounds);
  assert(Math.abs(width - sharedWidth) < .001, 'Width and centering must use the same dimension: ' + detail);
  assert(left >= box.left + gutterLeft - .001, 'Dialog crossed the left safe gutter: ' + detail);
  assert(left + width <= box.left + box.width - gutterRight + .001, 'Dialog crossed the right safe gutter: ' + detail);
  const available = box.width - gutterLeft - gutterRight;
  assert(Math.abs(left - (box.left + gutterLeft + (available - width) / 2)) < .001, 'Dialog is no longer centered: ' + detail);
}

const tabletSizes = [[1024, 768], [1180, 820], [1194, 834], [1280, 800], [1366, 1024], [768, 1024], [820, 1180], [1024, 1366]];
test('tablet modal width and centering share the final cascade in both orientations', () => {
  const sources = manifest['game-layout.bundle.css'];
  assert(sources.indexOf('responsive-polish.css') < sources.indexOf('tablet-layout.css'));
  assert(sources.indexOf('tablet-layout.css') < sources.indexOf('tablet-landscape.css'));
  for (const [width, height] of tabletSizes) for (const wide of [false, true]) {
    const bounds = tabletModalBounds(width, height, { wide });
    assertDialogFits(bounds, width + '×' + height + (wide ? ' wide' : ' ordinary'));
    assert.equal(bounds.gutterLeft, 12, 'The scoped tablet root beats the 22px :root media rule');
  }
});

test('tablet dialogs fit a shifted visual viewport and asymmetric safe insets', () => {
  for (const [width, height] of tabletSizes) for (const scale of [1, 1.25, 2]) {
    const visualViewport = { width: width / scale - 48, height: height / scale, offsetLeft: 31, offsetTop: 17, scale };
    assertDialogFits(tabletModalBounds(width, height, { visualViewport, safeLeft: 44, safeRight: 28 }), width + '×' + height + ' viewport scale ' + scale);
  }
});

test('tablet dialogs recompute geometry through portrait landscape portrait and before viewport startup', () => {
  for (const [width, height] of [[768, 1024], [820, 1180], [1024, 1366]]) {
    const sequence = [[width, height], [height, width], [width, height]].map(([w, h]) => tabletModalBounds(w, h));
    sequence.forEach((bounds, step) => assertDialogFits(bounds, width + 'px rotation step ' + step));
    assert.deepEqual(sequence[2], sequence[0], 'Rotation must restore the portrait dimensions');
    assertDialogFits(tabletModalBounds(height, width, { beforeViewport: true }), 'CSS fallback before viewport controller');
  }
});

test('geometry regression detects the former tablet width-only override', () => {
  for (const [width, height] of tabletSizes.filter(([w, h]) => w > h)) {
    const broken = tabletModalBounds(width, height, { legacy: true });
    assert(broken.left + broken.width > broken.box.left + broken.box.width, 'Negative control must reproduce the reported right overflow');
    assert.throws(() => assertDialogFits(broken, 'legacy ' + width + '×' + height), /Width and centering must use the same dimension/);
  }
});

console.log(count + ' responsive text and dialog geometry checks passed. Rendered bounds require browser QA.');
