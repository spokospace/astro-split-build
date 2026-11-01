import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'fs';
import { join } from 'path';
import { mergeTargets } from '../src/merge.js';
import { listTree, recordingLogger, tempProject, writeTree } from './helpers.js';

const targets = [
  { name: 'en', root: true },
  { name: 'pl', subdir: 'pl' },
  { name: 'de', subdir: 'de' },
];

const merge = (dir, overrides = {}) => {
  const recorded = recordingLogger();
  mergeTargets({
    targets,
    tempDir: join(dir, 'tmp'),
    outDir: join(dir, 'dist'),
    sharedDirs: ['_spoko'],
    logger: recorded.logger,
    ...overrides,
  });
  return recorded.lines;
};

test('root whole, other targets by subdir, shared dirs from every target (#742)', (t) => {
  const { dir, cleanup } = tempProject();
  t.after(cleanup);
  writeTree(join(dir, 'tmp'), {
    'en/index.html': 'en',
    'en/_spoko/App.EN.js': '',
    'pl/index.html': 'pl build root page, not kept',
    'pl/pl/index.html': 'pl',
    'pl/_spoko/App.EN.js': '',
    'pl/_spoko/Tire.PLONLY.js': '',
    'de/de/index.html': 'de',
    'de/_spoko/App.EN.js': '',
  });
  const lines = merge(dir);
  assert.deepEqual(listTree(join(dir, 'dist')), [
    '_spoko/App.EN.js',
    '_spoko/Tire.PLONLY.js',
    'de/index.html',
    'index.html',
    'pl/index.html',
  ]);
  assert.deepEqual(lines.log.slice(0, 2), ['📦 Step 1/3: Copying EN → dist/...', '✅ EN copied to root']);
  assert.ok(lines.log.includes('✅ PL _spoko/ merged into dist/_spoko/'));
});

test('a missing non-root subdir warns, even in quiet mode', (t) => {
  const { dir, cleanup } = tempProject();
  t.after(cleanup);
  writeTree(join(dir, 'tmp'), { 'en/index.html': 'en', 'pl/pl/index.html': 'pl' });
  const lines = merge(dir, { quiet: true });
  assert.deepEqual(lines.warn, ['⚠️  DE build not found']);
  assert.deepEqual(lines.log, []);
  assert.deepEqual(listTree(join(dir, 'dist')), ['index.html', 'pl/index.html']);
});

test('strict turns a missing subdir into MISSING_TARGET_OUTPUT', (t) => {
  const { dir, cleanup } = tempProject();
  t.after(cleanup);
  writeTree(join(dir, 'tmp'), { 'en/index.html': 'en', 'pl/pl/index.html': 'pl' });
  assert.throws(() => merge(dir, { strict: true }), { code: 'MISSING_TARGET_OUTPUT', target: 'de' });
});

test('a missing root build always fails', (t) => {
  const { dir, cleanup } = tempProject();
  t.after(cleanup);
  writeTree(join(dir, 'tmp'), { 'pl/pl/index.html': 'pl' });
  assert.throws(() => merge(dir), { code: 'MISSING_TARGET_OUTPUT', target: 'en' });
});

test('a copy that keeps failing is COPY_FAILED', (t) => {
  const { dir, cleanup } = tempProject();
  t.after(cleanup);
  writeTree(join(dir, 'tmp'), { 'en/index.html': 'en' });
  assert.throws(
    () => merge(dir, { sleep: () => {}, copy: () => { throw new Error('disk gone'); } }),
    (err) => err.code === 'COPY_FAILED' && /disk gone/.test(err.message)
  );
});

// Two builds, each with a sitemap of its own locale and a public/ copy.
const perBuildSitemaps = {
  'en/index.html': 'en',
  'en/404.html': '<script src="/_spoko/a.EN.js">',
  'en/sitemap-0.xml': '<loc>/</loc>',
  'en/favicon.svg': '<svg/>',
  'en/made.pdf': 'created 19:34',
  'en/_spoko/a.EN.js': '',
  'pl/pl/index.html': 'pl',
  'pl/404.html': '<script src="/_spoko/a.PL.js">',
  'pl/sitemap-0.xml': '<loc>/pl/</loc>',
  'pl/rss.xml': '<rss/>',
  'pl/favicon.svg': '<svg/>',
  'pl/made.pdf': 'created 19:32',
  'pl/_spoko/a.PL.js': '',
  'de/de/index.html': 'de',
  'de/favicon.svg': '<svg/>',
};

test('a dropped file that differs from the root build, or that it lacks, warns, even in quiet mode', (t) => {
  const { dir, cleanup } = tempProject();
  t.after(cleanup);
  writeTree(join(dir, 'tmp'), perBuildSitemaps);
  const lines = merge(dir, { quiet: true });
  assert.deepEqual(lines.warn, [
    "⚠️  PL build: 2 file(s) outside pl/ are not in the merged output: rss.xml (EN has none), sitemap-0.xml (not the size of EN's)",
    '   Generate such files after the merge (hooks.afterMerge), or list the ones dropped on purpose in ignoreDropped.',
  ]);
  // The 404 page differs in its bundle name only, the favicon not at all, the
  // PDF in its timestamp only (same size), and
  // the subdir and the shared dir are merged: none of them is reported.
  assert.equal(listTree(join(dir, 'dist')).includes('rss.xml'), false);
});

test('a page the root build lacks is reported, pages it has are not', (t) => {
  const { dir, cleanup } = tempProject();
  t.after(cleanup);
  writeTree(join(dir, 'tmp'), { 'en/index.html': 'en', 'pl/index.html': 'pl', 'pl/pl/index.html': 'pl', 'pl/about/index.html': 'about', 'de/de/index.html': 'de' });
  const lines = merge(dir);
  assert.match(lines.warn[0], /^⚠️  PL build: 1 file\(s\) outside pl\/ .*: about\/index\.html \(EN has none\)$/);
});

test('ignoreDropped silences a file or a whole directory', (t) => {
  const { dir, cleanup } = tempProject();
  t.after(cleanup);
  writeTree(join(dir, 'tmp'), { ...perBuildSitemaps, 'pl/feeds/a.xml': '', 'pl/feeds/b.xml': '' });
  const lines = merge(dir, { ignoreDropped: ['rss.xml', 'sitemap-0.xml', 'feeds/'] });
  assert.deepEqual(lines.warn, []);
});

test('a long list of dropped files is cut short', (t) => {
  const { dir, cleanup } = tempProject();
  t.after(cleanup);
  const extra = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`pl/feed-${String(i).padStart(2, '0')}.xml`, '']));
  writeTree(join(dir, 'tmp'), { 'en/index.html': 'en', 'pl/pl/index.html': 'pl', 'de/de/index.html': 'de', ...extra });
  const lines = merge(dir);
  assert.match(lines.warn[0], /12 file\(s\) .*feed-09\.xml \(EN has none\), and 2 more$/);
});

test('strict turns a dropped file into DROPPED_FILES, before anything is copied', (t) => {
  const { dir, cleanup } = tempProject();
  t.after(cleanup);
  writeTree(join(dir, 'tmp'), perBuildSitemaps);
  assert.throws(() => merge(dir, { strict: true }), {
    code: 'DROPPED_FILES',
    dropped: [{ target: 'pl', files: [{ file: 'rss.xml', reason: 'missing' }, { file: 'sitemap-0.xml', reason: 'differs' }] }],
  });
  assert.equal(existsSync(join(dir, 'dist')), false);
});
