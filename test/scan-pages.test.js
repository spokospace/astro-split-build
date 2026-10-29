import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'path';
import { scanPages } from '../src/scan-pages.js';
import { tempProject, writeTree } from './helpers.js';

/** A check that records what it was given. */
const recorder = (seen) => (context) => {
  seen.context = context;
  seen.pages = [];
  return {
    page: (file, html) => seen.pages.push([file, html]),
    finish: () => seen.pages.length,
  };
};

test('every check sees every page, in sorted order, with its content', (t) => {
  const { dir, cleanup } = tempProject();
  t.after(cleanup);
  writeTree(dir, {
    'pl/index.html': 'PL',
    'index.html': 'EN',
    'de/a/index.html': 'DE',
    '_assets/App.js': '',
    'feed.xml': '',
  });
  const first = {};
  const second = {};
  const results = scanPages({ outDir: dir, checks: [recorder(first), recorder(second)] });

  assert.deepEqual(results, [3, 3]);
  const expected = [
    ['de/a/index.html', 'DE'],
    ['index.html', 'EN'],
    ['pl/index.html', 'PL'],
  ];
  assert.deepEqual(first.pages, expected);
  assert.deepEqual(second.pages, expected);
  assert.deepEqual(first.context.pages, ['de/a/index.html', 'index.html', 'pl/index.html']);
  assert.equal(first.context.files.has('_assets/App.js'), true);
  assert.equal(first.context.files.has('feed.xml'), true);
});

test('a missing outDir is OUT_DIR_MISSING', (t) => {
  const { dir, cleanup } = tempProject();
  t.after(cleanup);
  assert.throws(() => scanPages({ outDir: join(dir, 'dist'), checks: [] }), { code: 'OUT_DIR_MISSING' });
});
