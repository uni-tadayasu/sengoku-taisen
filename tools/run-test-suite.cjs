#!/usr/bin/env node
/* © KASAI SOLUTIONS — runs every test file of one group in its own process.
 *
 * The targeted CI jobs list individual checks; this runner also executes the
 * remaining files so older regression tests cannot drift out of date unseen.
 *
 *   node tools/run-test-suite.cjs tests            browser, engine and page tests
 *   node tools/run-test-suite.cjs server --jobs 4  Worker API tests (Node 24 in CI)
 *
 * Exit status is non-zero when any file fails or exceeds its time limit.
 */
'use strict';
const {spawn} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const group = args.find(arg => !arg.startsWith('--'));
const option = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const jobs = Math.max(1, Math.min(16, Number.parseInt(option('--jobs') || '1', 10) || 1));
const timeoutMs = Math.max(10, Number.parseInt(option('--timeout') || '300', 10) || 300) * 1000;
const filter = option('--filter') || '';

// Shared fixtures that other tests import; they are not test entry points.
const helpers = new Set(['server/test-support.mjs', 'server/test-court-support.mjs']);
// Optional arguments that let a server test exercise the browser validators too.
const extraArgs = {'server/test-shogunate.mjs': ['shogunate.js']};
// Real-browser checks run only where Playwright is installed (it is not a
// pinned dependency); elsewhere they are reported as skipped, not passed.
const browserTests = new Set(['tests/test-roaming-dom.cjs']);
const hasPlaywright = (() => { try { require.resolve('playwright', {paths: [root, process.cwd()]}); return true; } catch (_) { return false; } })();
const groups = {
  tests: () => fs.readdirSync(path.join(root, 'tests')).filter(name => /^test-.+\.(?:cjs|mjs|js|py)$/.test(name)).map(name => 'tests/' + name),
  server: () => fs.readdirSync(path.join(root, 'server')).filter(name => /^test-.+\.mjs$/.test(name)).map(name => 'server/' + name)
};

if (!Object.hasOwn(groups, group)) {
  console.error('Usage: node tools/run-test-suite.cjs <tests|server> [--jobs N] [--timeout seconds] [--filter text]');
  process.exit(2);
}

const listed = groups[group]().filter(file => !helpers.has(file) && file.includes(filter)).sort();
const skipped = hasPlaywright ? [] : listed.filter(file => browserTests.has(file));
const files = listed.filter(file => !skipped.includes(file));
for (const file of skipped) console.log(`SKIP ${file} (Playwright is not installed)`);
if (!files.length) {
  if (skipped.length) process.exit(0);
  console.error(`No ${group} test files matched.`);
  process.exit(2);
}

function run(file) {
  return new Promise(resolve => {
    const started = Date.now();
    const command = file.endsWith('.py') ? 'python3' : process.execPath;
    const child = spawn(command, [file, ...(extraArgs[file] || [])], {cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe']});
    let output = '';
    const collect = chunk => { output = (output + chunk).slice(-20000); };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.on('close', code => {
      clearTimeout(timer);
      resolve({file, ok: code === 0 && !timedOut, code, timedOut, seconds: (Date.now() - started) / 1000, output});
    });
  });
}

(async () => {
  const queue = files.slice(), results = [];
  async function worker() {
    while (queue.length) {
      const result = await run(queue.shift());
      results.push(result);
      console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.file} (${result.seconds.toFixed(1)}s${result.timedOut ? ', timed out' : ''})`);
    }
  }
  await Promise.all(Array.from({length: Math.min(jobs, files.length)}, worker));
  const failed = results.filter(result => !result.ok).sort((a, b) => a.file.localeCompare(b.file));
  for (const result of failed) {
    console.log(`\n----- ${result.file} (exit ${result.timedOut ? 'timeout' : result.code}) -----\n${result.output.trim().split('\n').slice(-40).join('\n')}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} ${group} test files passed${skipped.length ? `, ${skipped.length} skipped` : ''}.`);
  process.exitCode = failed.length ? 1 : 0;
})();
