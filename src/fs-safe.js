// Filesystem helpers that survive shared-hosting filesystems.
//
// Moved verbatim from catalog.polo.blue's scripts/build-split.js, where each
// of these was a fix for a production deploy that failed (#569, #570).

import { execFileSync } from 'child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'fs';

// rmSync on shared-hosting NFS-like filesystems races: Node attempts rmdir
// on a parent before all recursive children have actually been unlinked
// (deploys see "ENOTEMPTY: directory not empty, rmdir 'dist/pl'"). Node
// supports retry options for exactly this case; rimraf upstream defaults
// to 10/100. Use those everywhere we wipe a tree.
export const rmTreeOptions = { recursive: true, force: true, maxRetries: 10, retryDelay: 100 };

export const rmTree = (path) => {
  if (existsSync(path)) rmSync(path, rmTreeOptions);
};

// `cpSync` has no equivalent maxRetries option, and on the same hosting it
// races during `cpSync dist → .build-temp/<locale>` — files written aren't
// immediately visible to the readdir() inside the next consumer, surfacing
// as `directory iterator cannot open directory: No such file or directory`
// (SIGABRT from libuv/libstdc++ during merge cpSync). Mitigation: prefer
// `cp -rf` on POSIX (battle-tested for this exact failure mode), with a
// retry on top, and a small FS-settle sleep after each large write.
// Pure-Node synchronous sleep — `Atomics.wait` on a dummy SharedArrayBuffer
// blocks the thread for the given duration without shelling out (`sleep` is
// missing on Windows and inconsistent on fractional seconds elsewhere).
export const sleepSyncMs = (ms) =>
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export const formatCpError = (err) => {
  // execFileSync surfaces process diagnostics on `err.stderr`/`err.stdout`
  // (Buffer | string). Trim and merge whichever is non-empty into the log
  // so flaky-FS deploys leave actionable breadcrumbs.
  const stderr = err?.stderr?.toString().trim();
  const stdout = err?.stdout?.toString().trim();
  const detail = stderr || stdout;
  const base = err?.message || String(err);
  return detail ? `${base}\n    ↳ ${detail}` : base;
};

// `cp` missing on PATH (minimal containers) flips the helper to the Node
// fallback for the remainder of the run — re-probing per call would just
// fail the same way and pollute logs.
let useNodeCpFallback = process.platform === 'win32';

const nativeCp = (src, dst) => {
  // `cp -rf -- src/. dst` — the `--` end-of-options marker guards against
  // a checkout path that starts with `-` being parsed as an option by cp.
  mkdirSync(dst, { recursive: true });
  execFileSync('cp', ['-rf', '--', `${src}/.`, dst], { stdio: 'pipe' });
};

const nodeCp = (src, dst) => {
  // `cpSync` creates `dst` itself and copies the *contents* of `src` into
  // it on both POSIX and Windows. Used on Windows always, and as a fallback
  // on POSIX when `cp` isn't on PATH (minimal container / restricted env).
  cpSync(src, dst, { recursive: true, force: true });
};

/**
 * Copy the contents of `src` into `dst`, retrying with a growing pause.
 *
 * `copy`, `sleep` and `logger` exist for tests; real callers pass nothing
 * and get `cp -rf` (POSIX) or `fs.cpSync` (Windows / no `cp`).
 */
export const cpTreeWithRetry = (src, dst, { copy, sleep = sleepSyncMs, logger = console, maxAttempts = 5 } = {}) => {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (copy) {
        copy(src, dst);
      } else if (useNodeCpFallback) {
        nodeCp(src, dst);
      } else {
        nativeCp(src, dst);
      }
      return;
    } catch (err) {
      if (!copy && !useNodeCpFallback && err?.code === 'ENOENT' && /cp/i.test(err?.path || '')) {
        logger.warn('⚠️  POSIX `cp` not found on PATH — falling back to fs.cpSync for the rest of the build.');
        useNodeCpFallback = true;
        // Don't burn an attempt on the env-detection failure — the fallback
        // is a different code path, so the user-visible retry budget should
        // start fresh from this iteration.
        attempt--;
        continue;
      }
      if (attempt === maxAttempts) throw err;
      logger.warn(`⚠️  cp ${src} → ${dst} failed (attempt ${attempt}/${maxAttempts}): ${formatCpError(err)}`);
      sleep(500 * attempt);
    }
  }
};
