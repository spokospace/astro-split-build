import { test } from 'node:test';
import assert from 'node:assert/strict';
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
