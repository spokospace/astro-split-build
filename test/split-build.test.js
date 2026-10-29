import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'child_process';
import { existsSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { splitBuild } from '../src/index.js';
import { listTree, recordingLogger, tempProject } from './helpers.js';

const here = dirname(fileURLToPath(import.meta.url));
const fakeBuild = join(here, 'fixtures', 'fake-build.js');
const cli = join(here, '..', 'src', 'cli.js');

// The PL build emits a chunk of its own, as the PL tire calculator did in #742.
const chunks = { en: 'App.EN11', pl: 'Tire.PL22', de: 'App.EN11' };

const config = (cwd, overrides = {}) => ({
  cwd,
  targets: [
    { name: 'en', root: true },
    { name: 'pl', subdir: 'pl' },
    { name: 'de', subdir: 'de' },
  ],
  command: `node "${fakeBuild}"`,
  env: (target) => ({ FAKE_SUBDIR: target.subdir ?? '', FAKE_CHUNK: chunks[target.name] }),
  sharedDirs: ['_assets'],
  verifyAssets: { dir: '_assets' },
  settleMs: 0,
  quiet: true,
  ...overrides,
});

test('builds every target in order, runs hooks, merges and verifies', async (t) => {
  const { dir, cleanup } = tempProject();
  t.after(cleanup);
  const { logger, lines } = recordingLogger();
  const calls = [];
  const result = await splitBuild(
    config(dir, {
      logger,
      hooks: {
        before: () => calls.push('before'),
        afterTarget: (target, ctx) => {
          calls.push(`afterTarget:${target.name}`);
          // Whatever a hook writes into the target's dir is part of its saved build.
          writeFileSync(join(ctx.targetDir, 'search.json'), target.name);
        },
        afterMerge: (ctx) => calls.push(`afterMerge:${existsSync(ctx.tempDir)}`),
      },
    })
  );

  assert.deepEqual(calls, ['before', 'afterTarget:en', 'afterTarget:pl', 'afterTarget:de', 'afterMerge:true']);
  assert.deepEqual(listTree(join(dir, 'dist')), [
    '_assets/App.EN11.js',
    '_assets/Tire.PL22.js',
    'de/index.html',
    'de/search.json',
    'index.html',
    'pl/index.html',
    'pl/search.json',
    'search.json',
  ]);
  assert.equal(existsSync(join(dir, '.build-temp')), false);
  assert.deepEqual(result.targets.map((target) => target.name), ['en', 'pl', 'de']);
  assert.deepEqual(lines.write, ['📦 Building EN...', '📦 Building PL...', '📦 Building DE...']);
  assert.match(lines.log.at(-1), /Asset references: \d+ reference\(s\) across 3 page\(s\) all resolve\./);
});

test('without the shared dir merge, the PL chunk is caught as a broken reference', async (t) => {
  const { dir, cleanup } = tempProject();
  t.after(cleanup);
  const { logger, lines } = recordingLogger();
  await assert.rejects(splitBuild(config(dir, { logger, sharedDirs: [] })), (err) => {
    assert.equal(err.code, 'BROKEN_ASSET_REFS');
    assert.deepEqual([...err.missing.keys()], ['/_assets/Tire.PL22.js']);
    return true;
  });
  assert.match(lines.error[0], /referenced by \/pl\/index\.html/);
  // The temp builds stay behind for whoever debugs it.
  assert.equal(existsSync(join(dir, '.build-temp', 'pl')), true);
});

test('links between targets are checked on the merged output', async (t) => {
  const { dir, cleanup } = tempProject();
  t.after(cleanup);
  const { logger, lines } = recordingLogger();
  // The PL page links DE's page, which only exists once the targets are merged.
  const links = { pl: '/de/', de: '/pl/' };
  const env = (target) => ({ FAKE_SUBDIR: target.subdir ?? '', FAKE_CHUNK: chunks[target.name], FAKE_LINK: links[target.name] ?? '' });
  await splitBuild(config(dir, { logger, env, verifyLinks: { site: 'https://example.com' } }));
  assert.match(lines.log.at(-1), /Internal links: 2 link\(s\) across 3 page\(s\) all resolve\./);
});

test('a link to a page no target built is BROKEN_INTERNAL_LINKS', async (t) => {
  const { dir, cleanup } = tempProject();
  t.after(cleanup);
  const { logger, lines } = recordingLogger();
  const env = (target) => ({ FAKE_SUBDIR: target.subdir ?? '', FAKE_CHUNK: chunks[target.name], FAKE_LINK: target.name === 'pl' ? '/fr/' : '' });
  await assert.rejects(splitBuild(config(dir, { logger, env, verifyLinks: { site: 'https://example.com' } })), (err) => {
    assert.equal(err.code, 'BROKEN_INTERNAL_LINKS');
    assert.deepEqual([...err.missing.keys()], ['/fr/']);
    return true;
  });
  assert.match(lines.error[0], /✗ \/fr\/\n {6}linked from \/pl\//);
  assert.equal(existsSync(join(dir, '.build-temp', 'pl')), true);
});

test('a failing build stops the run with BUILD_FAILED and keeps earlier targets', async (t) => {
  const { dir, cleanup } = tempProject();
  t.after(cleanup);
  const { logger } = recordingLogger();
  const env = (target) => ({ FAKE_SUBDIR: target.subdir ?? '', FAKE_FAIL: target.name === 'pl' ? '1' : '' });
  await assert.rejects(splitBuild(config(dir, { logger, env })), (err) => {
    assert.equal(err.code, 'BUILD_FAILED');
    assert.equal(err.target, 'pl');
    assert.equal(err.status, 3);
    assert.match(err.message, /fake build failed for pl/);
    assert.match(err.message, /warning: something unrelated/);
    return true;
  });
  assert.equal(existsSync(join(dir, '.build-temp', 'en', 'index.html')), true);
});

test('a throwing hook is HOOK_FAILED naming the hook and target', async (t) => {
  const { dir, cleanup } = tempProject();
  t.after(cleanup);
  const { logger } = recordingLogger();
  const hooks = { afterTarget: (target) => { if (target.name === 'de') throw new Error('pagefind crashed'); } };
  await assert.rejects(splitBuild(config(dir, { logger, hooks })), {
    code: 'HOOK_FAILED',
    hook: 'afterTarget',
    target: 'de',
  });
});

test('the CLI runs a config module and exits 1 on failure', (t) => {
  const { dir, cleanup } = tempProject();
  t.after(cleanup);
  const configFile = join(dir, 'split-build.config.js');
  const write = (subdirEnv) =>
    writeFileSync(
      configFile,
      `export default {
        targets: [{ name: 'en', root: true }, { name: 'pl', subdir: 'pl' }],
        command: ${JSON.stringify(`node "${fakeBuild}"`)},
        env: (t) => ({ FAKE_SUBDIR: t.subdir ?? '', ${subdirEnv} }),
        sharedDirs: ['_assets'],
        verifyAssets: { dir: '_assets' },
        settleMs: 0,
        quiet: true,
      };\n`
    );

  write('');
  const output = execFileSync(process.execPath, [cli, '--config', configFile], { cwd: dir, encoding: 'utf8' });
  assert.match(output, /Split build completed/);
  assert.deepEqual(listTree(join(dir, 'dist')), ['_assets/App.AAAA.js', 'index.html', 'pl/index.html']);

  write(`FAKE_BROKEN_REF: t.name === 'pl' ? '1' : ''`);
  assert.throws(
    () => execFileSync(process.execPath, [cli, '--config', configFile], { cwd: dir, stdio: 'pipe' }),
    (err) => err.status === 1 && /missing from dist/.test(err.stderr.toString())
  );
});
