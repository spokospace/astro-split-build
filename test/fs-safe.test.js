import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { cpTreeWithRetry, formatCpError, rmTree } from '../src/fs-safe.js';
import { recordingLogger, tempProject, writeTree } from './helpers.js';

test('rmTree removes a nested tree and ignores a missing one', (t) => {
  const { dir, cleanup } = tempProject();
  t.after(cleanup);
  writeTree(dir, { 'a/b/c.txt': 'x', 'a/d.txt': 'y' });
  rmTree(join(dir, 'a'));
  assert.equal(existsSync(join(dir, 'a')), false);
  assert.doesNotThrow(() => rmTree(join(dir, 'a')));
});

test('cpTreeWithRetry copies the contents of src into dst', (t) => {
  const { dir, cleanup } = tempProject();
  t.after(cleanup);
  writeTree(dir, { 'src/x/y.txt': 'hello' });
  cpTreeWithRetry(join(dir, 'src'), join(dir, 'dst'));
  assert.equal(readFileSync(join(dir, 'dst/x/y.txt'), 'utf8'), 'hello');
});

test('cpTreeWithRetry retries a failing copy with a growing pause', () => {
  const { logger, lines } = recordingLogger();
  const pauses = [];
  let calls = 0;
  cpTreeWithRetry('a', 'b', {
    logger,
    sleep: (ms) => pauses.push(ms),
    copy: () => {
      calls++;
      if (calls < 3) throw new Error('ENOENT mid-iteration');
    },
  });
  assert.equal(calls, 3);
  assert.deepEqual(pauses, [500, 1000]);
  assert.equal(lines.warn.length, 2);
  assert.match(lines.warn[0], /attempt 1\/5/);
});

test('cpTreeWithRetry gives up after the last attempt', () => {
  const { logger } = recordingLogger();
  assert.throws(
    () => cpTreeWithRetry('a', 'b', { logger, sleep: () => {}, maxAttempts: 2, copy: () => { throw new Error('boom'); } }),
    /boom/
  );
});

test('formatCpError appends process stderr when present', () => {
  assert.equal(formatCpError(new Error('failed')), 'failed');
  const err = Object.assign(new Error('failed'), { stderr: Buffer.from('cp: cannot stat\n') });
  assert.equal(formatCpError(err), 'failed\n    ↳ cp: cannot stat');
});
