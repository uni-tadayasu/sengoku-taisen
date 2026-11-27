'use strict';

// Extend the existing vector flag collection with three reusable motifs and
// twelve seasonal palettes. No remote assets or generated bitmap art is used.
const fs = require('node:fs');
const path = require('node:path');
const catalog = require('../premium-catalog.js');
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
if (args.length && (args.length !== 1 || args[0] !== '--check')) throw Error('Usage: node tools/build-supporter-art.cjs [--check]');
const checkOnly = args[0] === '--check';
const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const output = new Map();

function motifArt(motif, palette) {
  const metal = 'url(#metal)';
  if (motif === 'flower') {
    const petals = Array.from({ length: 8 }, (_, i) => `<path d="M320 377C274 347 285 298 320 269C355 298 366 347 320 377Z" transform="rotate(${45 * i} 320 377)"/>`).join('');
    return `<g fill="${metal}" stroke="${palette.background}" stroke-width="3">${petals}</g>
      <path d="M320 319 378 377 320 435 262 377Z" fill="${palette.background}" stroke="${metal}" stroke-width="5"/>
      <path d="M320 341 356 377 320 413 284 377Z" fill="${metal}"/>
      <circle cx="320" cy="377" r="13" fill="${palette.accent}" stroke="${metal}" stroke-width="3"/>
      <g fill="none" stroke="${metal}" stroke-width="4"><path d="M260 592C270 552 304 548 320 573C336 548 370 552 380 592M276 612C285 580 307 584 320 603C333 584 355 580 364 612M320 573V653"/><path d="M320 634C291 645 284 625 285 615C310 612 319 620 320 634ZM320 634C349 645 356 625 355 615C330 612 321 620 320 634Z"/></g>`;
  }
  if (motif === 'moon') {
    return `<circle cx="320" cy="368" r="105" fill="${metal}"/>
      <circle cx="351" cy="344" r="91" fill="${palette.background}"/>
      <circle cx="372" cy="318" r="22" fill="${metal}"/>
      <path d="M217 431C250 406 280 406 312 431S375 456 423 419M231 452C265 428 295 432 324 451S378 471 409 450" fill="none" stroke="${metal}" stroke-width="5" stroke-linecap="round"/>
      <g fill="none" stroke="${metal}" stroke-width="4"><path d="M257 598C278 578 297 578 320 598S362 618 383 598M257 621C278 601 297 601 320 621S362 641 383 621M281 643C294 635 307 635 320 643S346 651 359 643"/></g>
      <circle cx="320" cy="558" r="9" fill="${metal}"/>`;
  }
  const points = [[251,310],[286,333],[313,360],[343,383],[371,430],[407,421],[415,379]];
  const stars = points.map(([x,y], i) => `<circle cx="${x}" cy="${y}" r="${i === 3 ? 12 : 8}" fill="${metal}" stroke="${palette.background}" stroke-width="2"/>`).join('');
  return `<path d="M320 266 412 315 412 422 320 478 228 422 228 315Z" fill="none" stroke="${metal}" stroke-width="3"/>
    <path d="M320 286 394 327 394 411 320 455 246 411 246 327Z" fill="none" stroke="${metal}" stroke-width="1" opacity=".6"/>
    <path d="M251 310 286 333 313 360 343 383 371 430 407 421 415 379 343 383" fill="none" stroke="${metal}" stroke-width="4"/>${stars}
    <path d="m320 551 10 29 29 10-29 10-10 29-10-29-29-10 29-10Z" fill="${metal}"/>
    <path d="m281 626 39 26 39-26m-78 13 39 26 39-26" fill="none" stroke="${metal}" stroke-width="3"/>`;
}

function banner(product) {
  const p = product.palette;
  const trim = 'url(#metal)';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="960" viewBox="0 0 640 960" role="img" aria-labelledby="title description">
  <title id="title">${esc(product.previewLabel)}</title><desc id="description">${esc(product.art.alt)}。季節の配色は12か月で巡ります。</desc>
  <defs>
    <linearGradient id="metal" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${p.text}"/><stop offset=".23" stop-color="${p.border}"/><stop offset=".46" stop-color="${p.text}"/><stop offset=".7" stop-color="${p.accent}"/><stop offset="1" stop-color="${p.border}"/></linearGradient>
    <linearGradient id="silk"><stop stop-color="${p.background}"/><stop offset=".18" stop-color="${p.accent}"/><stop offset=".46" stop-color="${p.background}"/><stop offset=".82" stop-color="${p.accent}"/><stop offset="1" stop-color="${p.background}"/></linearGradient>
    <pattern id="brocade" width="48" height="48" patternUnits="userSpaceOnUse"><path d="m24 0 24 24-24 24L0 24Z" fill="none" stroke="${p.border}" stroke-opacity=".2"/><path d="m24 15 9 9-9 9-9-9Z" fill="${p.border}" fill-opacity=".11"/></pattern>
    <filter id="shadow" x="-25%" y="-10%" width="155%" height="130%"><feGaussianBlur in="SourceAlpha" stdDeviation="7" result="blur"/><feOffset in="blur" dx="6" dy="10" result="offset"/><feFlood flood-color="#071019" flood-opacity=".5" result="color"/><feComposite in="color" in2="offset" operator="in" result="shadow"/><feMerge><feMergeNode in="shadow"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <g filter="url(#shadow)">
    <rect x="82" y="65" width="18" height="846" rx="8" fill="${trim}"/><path d="M91 23 108 51 91 72 74 51Z" fill="${trim}"/>
    <path d="M100 92H536V765L427 742 320 827 211 742 100 765Z" fill="url(#silk)" stroke="${trim}" stroke-width="9"/>
    <path d="M114 110H522V744L427 723 320 806 211 723 114 744Z" fill="url(#brocade)" stroke="${trim}" stroke-width="2"/>
    <path d="M132 129H504V719L427 702 320 781 211 702 132 719Z" fill="none" stroke="${trim}" stroke-width="1" opacity=".7"/>
    <rect x="64" y="80" width="510" height="18" rx="7" fill="${trim}"/><circle cx="65" cy="89" r="13" fill="${trim}"/><circle cx="574" cy="89" r="13" fill="${trim}"/>
    <path d="M166 165H474M166 181H474" stroke="${trim}" stroke-width="3"/>
    <path d="m166 150 14 15-14 16m308-31-14 15 14 16" fill="none" stroke="${trim}" stroke-width="3"/>
    <circle cx="320" cy="377" r="155" fill="${p.background}" fill-opacity=".79" stroke="${trim}" stroke-width="9"/>
    <circle cx="320" cy="377" r="141" fill="none" stroke="${trim}" stroke-width="2"/>
    ${motifArt(product.motif, p)}
    <path d="M176 681h65m-32-12v25m190-13h65m-32-12v25" fill="none" stroke="${trim}" stroke-width="3"/>
    ${[[211,752],[320,836],[427,752]].map(([x,y]) => `<path d="M${x} ${y}v29" stroke="${trim}" stroke-width="5"/><circle cx="${x}" cy="${y+31}" r="9" fill="${trim}"/><path d="m${x-8} ${y+40}-5 43 13-6 13 6-5-43Z" fill="${trim}"/>`).join('')}
  </g>
</svg>
`;
}

for (let month = 1; month <= 12; month++) {
  for (const product of catalog.getSupporterChoices(`2026${String(month).padStart(2, '0')}`)) output.set(product.art.src, banner(product));
}
output.set('assets/premium/reroll-pass-30d-v1.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 640 640" role="img" aria-labelledby="title description">
  <title id="title">武将再抽選パス・30日</title><desc id="description">翡翠色の武将札二枚と、一度の再抽選を示す金色の矢印。</desc>
  <defs><linearGradient id="jade" x2="1" y2="1"><stop stop-color="#326b65"/><stop offset=".5" stop-color="#143d3b"/><stop offset="1" stop-color="#0d272d"/></linearGradient><linearGradient id="gold" x2="1" y2="1"><stop stop-color="#fff0c0"/><stop offset=".4" stop-color="#d7b56a"/><stop offset=".65" stop-color="#a47b38"/><stop offset="1" stop-color="#f5dda0"/></linearGradient><filter id="shadow" x="-30%" y="-20%" width="160%" height="150%"><feGaussianBlur in="SourceAlpha" stdDeviation="10" result="blur"/><feOffset in="blur" dx="6" dy="9" result="offset"/><feFlood flood-color="#071019" flood-opacity=".6" result="color"/><feComposite in="color" in2="offset" operator="in" result="shadow"/><feMerge><feMergeNode in="shadow"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
  <circle cx="320" cy="320" r="270" fill="#122e32" stroke="url(#gold)" stroke-width="6"/><circle cx="320" cy="320" r="253" fill="none" stroke="#bfcfba" stroke-opacity=".35" stroke-width="2"/>
  <g filter="url(#shadow)"><g transform="rotate(-12 240 324)"><rect x="120" y="166" width="234" height="326" rx="16" fill="url(#jade)" stroke="url(#gold)" stroke-width="8"/><rect x="135" y="182" width="204" height="294" rx="9" fill="none" stroke="#d5cfa7" stroke-opacity=".6" stroke-width="2"/><path d="M192 332c7-59 31-91 45-91s38 32 45 91l-45 34Z" fill="url(#gold)"/><path d="M176 310h122l-15 31h-92Z" fill="url(#gold)"/><path d="m191 270-20-26 24 6m84 20 20-26-24 6" fill="none" stroke="url(#gold)" stroke-width="9"/><path d="M190 403h94M208 424h58" stroke="url(#gold)" stroke-width="5"/></g>
  <g transform="rotate(10 398 324)"><rect x="282" y="162" width="234" height="326" rx="16" fill="url(#jade)" stroke="url(#gold)" stroke-width="8"/><rect x="297" y="178" width="204" height="294" rx="9" fill="none" stroke="#d5cfa7" stroke-opacity=".6" stroke-width="2"/><path d="M354 326c7-59 31-91 45-91s38 32 45 91l-45 34Z" fill="url(#gold)"/><path d="M338 304h122l-15 31h-92Z" fill="url(#gold)"/><path d="M370 246c-24-21-28-43-26-62m84 62c24-21 28-43 26-62" fill="none" stroke="url(#gold)" stroke-width="9"/><path d="M352 397h94M370 418h58" stroke="url(#gold)" stroke-width="5"/></g></g>
  <path d="M153 126c98-75 235-65 318 12" fill="none" stroke="url(#gold)" stroke-width="14" stroke-linecap="round"/><path d="m442 102 39 47-60-4" fill="url(#gold)"/>
  <path d="M486 517c-95 72-234 68-319-13" fill="none" stroke="url(#gold)" stroke-width="14" stroke-linecap="round"/><path d="m194 544-38-49 61 6" fill="url(#gold)"/>
</svg>
`);

let changed = 0;
const stale = [];
for (const [relative, contents] of output) {
  const file = path.join(root, relative);
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === contents) continue;
  if (checkOnly) { stale.push(relative); continue; }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  changed++;
}
if (stale.length) throw Error('Premium vector artwork differs from source: ' + stale.join(', '));
console.log(checkOnly ? `PASS ${output.size} premium SVG assets match their source.` : `Generated ${output.size} premium SVG assets; ${changed} changed.`);
