/* Minimal test runner for ytdl-js */
/* eslint-disable no-console */
'use strict';

const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };
const { execFileSync } = require('child_process');
const path = require('path');

function runCLI(...args) {
  const pkg = require('../package.json');
  const binRel = pkg.bin['ytdl-js'];
  const cli = path.join(__dirname, '..', binRel);
  return execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
}

function test(name, fn) {
  try {
    fn();
    console.log('ok -', name);
  } catch (e) {
    console.error('not ok -', name);
    console.error(String(e && e.stack || e));
    process.exitCode = 1;
  }
}

// Tests
test('prints help', () => {
  const out = runCLI('--help');
  assert(/Usage: ytdl-js/.test(out), 'help did not include usage');
});

test('lists extractors', () => {
  const out = runCLI('--list-extractors');
  assert(/GenericExtractor/.test(out), 'no GenericExtractor listed');
});

test('generic extractor suitability', () => {
  const { GenericExtractor } = require('../pkg/extractors/generic');
  const ie = new GenericExtractor();
  assert(ie.suitable('https://example.com/video.mp4'), 'should be suitable for .mp4');
  assert(!ie.suitable('https://example.com/page.html'), 'should not be suitable for .html');
});

console.log('tests finished');
