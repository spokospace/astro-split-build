import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'path';
import { formatMissingRefs, verifyAssetRefs } from '../src/verify-assets.js';
import { tempProject, writeTree } from './helpers.js';

test('every reference resolves', (t) => {
  const { dir, cleanup } = tempProject();
  t.after(cleanup);
  writeTree(dir, {
    'index.html': '<script src="/_spoko/App.AAAA.js"></script><link href="/_spoko/main.BBBB.css">',
    'pl/index.html': '<script src="/_spoko/App.AAAA.js?astro-retry=1"></script>',
    '_spoko/App.AAAA.js': '',
    '_spoko/main.BBBB.css': '',
  });
  const result = verifyAssetRefs({ outDir: dir, dir: '_spoko' });
  assert.equal(result.refCount, 3);
  assert.equal(result.pageCount, 2);
  assert.equal(result.missing.size, 0);
});

test('a missing reference is reported once, with the first page as a URL path', (t) => {
  const { dir, cleanup } = tempProject();
  t.after(cleanup);
  writeTree(dir, {
    'pl/kalkulator/index.html': '<script src="/_spoko/Tire.WFBO.js"></script>',
    'pl/other/index.html': '<script src="/_spoko/Tire.WFBO.js"></script>',
    '_spoko/Tire.Ci7N.js': '',
  });
  const { missing } = verifyAssetRefs({ outDir: dir, dir: '_spoko' });
  assert.equal(missing.size, 1);
  const [[ref, page]] = missing;
  assert.equal(ref, '/_spoko/Tire.WFBO.js');
  assert.match(page, /^pl\/(kalkulator|other)\/index\.html$/);
  assert.match(formatMissingRefs(missing), /✗ \/_spoko\/Tire\.WFBO\.js\n {6}referenced by \/pl\//);
});

test('another host\'s asset is not a reference into outDir', (t) => {
  const { dir, cleanup } = tempProject();
  t.after(cleanup);
  writeTree(dir, {
    'index.html': '<script src="https://cdn.example/_spoko/App.js"></script><link href="//cdn.example/_spoko/a.css">',
  });
  const result = verifyAssetRefs({ outDir: dir, dir: '_spoko' });
  assert.equal(result.refCount, 0);
});

test('under a base, a reference must carry it', (t) => {
  const { dir, cleanup } = tempProject();
  t.after(cleanup);
  writeTree(dir, {
    'index.html': '<script src="/docs/_spoko/App.js"></script><link href="/_spoko/main.css">',
    '_spoko/App.js': '',
    '_spoko/main.css': '',
  });
  const { refCount, missing } = verifyAssetRefs({ outDir: dir, dir: '_spoko', base: '/docs' });
  assert.equal(refCount, 2);
  // Served under /docs/, "/_spoko/main.css" is another path and 404s.
  assert.deepEqual([...missing.keys()], ['/_spoko/main.css']);
});

test('a missing outDir is OUT_DIR_MISSING', (t) => {
  const { dir, cleanup } = tempProject();
  t.after(cleanup);
  assert.throws(() => verifyAssetRefs({ outDir: join(dir, 'dist'), dir: '_spoko' }), { code: 'OUT_DIR_MISSING' });
});
