import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOptions } from '../src/config.js';

const valid = {
  targets: [{ name: 'en', root: true }, { name: 'pl', subdir: 'pl' }],
  command: 'astro build',
  cwd: '/project',
};

const rejects = (overrides, pattern) =>
  assert.throws(
    () => normalizeOptions({ ...valid, ...overrides }),
    (err) => err.code === 'INVALID_CONFIG' && pattern.test(err.message)
  );

test('accepts a minimal config and fills defaults', () => {
  const o = normalizeOptions(valid);
  assert.match(o.outDir, /dist$/);
  assert.match(o.tempDir, /\.build-temp$/);
  assert.deepEqual(o.sharedDirs, []);
  assert.equal(o.verifyAssets, false);
  assert.equal(o.verifyLinks, false);
  assert.deepEqual(o.pageChecks, []);
  assert.deepEqual(o.env({ name: 'en' }), {});
  assert.equal(o.settleMs, 500);
});

test('env may be a function of the target', () => {
  const o = normalizeOptions({ ...valid, env: (t) => ({ BUILD_LOCALE: t.name }) });
  assert.deepEqual(o.env({ name: 'pl' }), { BUILD_LOCALE: 'pl' });
});

test('refuses empty or malformed targets', () => {
  rejects({ targets: [] }, /non-empty/);
  rejects({ targets: [{ name: '../x', root: true }] }, /name/);
  rejects({ targets: [{ name: 'en', root: true }, { name: 'en', subdir: 'en' }] }, /duplicate/);
});

test('needs exactly one root target', () => {
  rejects({ targets: [{ name: 'pl', subdir: 'pl' }] }, /exactly one/);
  rejects({ targets: [{ name: 'en', root: true }, { name: 'pl', root: true }] }, /exactly one/);
});

test('a non-root target needs a contained relative subdir', () => {
  rejects({ targets: [{ name: 'en', root: true }, { name: 'pl' }] }, /subdir/);
  rejects({ targets: [{ name: 'en', root: true }, { name: 'pl', subdir: '../pl' }] }, /subdir/);
  rejects({ targets: [{ name: 'en', root: true }, { name: 'pl', subdir: '/abs' }] }, /subdir/);
});

test('refuses outDir and tempDir that overlap', () => {
  rejects({ outDir: 'dist', tempDir: 'dist' }, /neither inside/);
  rejects({ outDir: 'dist', tempDir: 'dist/tmp' }, /neither inside/);
  rejects({ outDir: 'tmp/dist', tempDir: 'tmp' }, /neither inside/);
});

test('refuses an outDir or tempDir that is cwd or one of its parents', () => {
  rejects({ outDir: '.' }, /outDir must not be cwd/);
  rejects({ outDir: '..', tempDir: '../../tmp' }, /outDir must not be cwd/);
  rejects({ tempDir: '/' }, /tempDir must not be cwd/);
  assert.doesNotThrow(() => normalizeOptions({ ...valid, tempDir: '../build-temp' }));
});

test('refuses targets that would collide on disk', () => {
  rejects({ targets: [{ name: 'en', root: true }, { name: 'EN', subdir: 'x' }] }, /duplicate/);
  rejects({ targets: [{ name: 'en', root: true }, { name: 'pl', subdir: 'pl' }, { name: 'pl2', subdir: 'pl/' }] }, /share the subdir/);
});

test('validates command, env, sharedDirs, verifyAssets, verifyLinks, base, pageChecks and hooks', () => {
  rejects({ pageChecks: {} }, /pageChecks/);
  rejects({ pageChecks: [{ name: '', check: () => ({}) }] }, /pageChecks/);
  rejects({ pageChecks: [{ name: 'x', check: 'nope' }] }, /pageChecks/);
  rejects({ command: '' }, /command/);
  rejects({ env: null }, /env/);
  rejects({ sharedDirs: ['../x'] }, /sharedDirs/);
  rejects({ verifyAssets: { dir: '' } }, /verifyAssets/);
  rejects({ verifyLinks: { site: 'catalog.polo.blue' } }, /verifyLinks/);
  assert.deepEqual(normalizeOptions({ ...valid, verifyLinks: { site: 'https://x.dev' } }).verifyLinks, { site: 'https://x.dev', redirects: undefined });
  assert.equal(normalizeOptions({ ...valid, base: '/docs' }).base, '/docs');
  rejects({ base: 'docs' }, /base/);
  rejects({ verifyLinks: { site: 'https://x.dev', redirects: {} } }, /verifyLinks/);
  rejects({ hooks: { before: 'nope' } }, /hooks\.before/);
});
