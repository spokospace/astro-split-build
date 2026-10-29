// Build a large static site one target at a time and merge the outputs.
//
// A single build of every locale of a big multilingual site can exhaust
// memory or open-file limits. Building each target separately (the build reads
// which one from its env, e.g. BUILD_LOCALE) keeps each run small. The price
// is a merge step that must not lose files, and a check that the merged pages
// still point at bundles and pages that exist. Targets build strictly one after another:
// running them in parallel brings back the very limits this avoids.

import { execSync } from 'child_process';
import { mkdirSync } from 'fs';
import { join, relative } from 'path';
import { SplitBuildError } from './errors.js';
import { createInfo, normalizeOptions } from './config.js';
import { cpTreeWithRetry, rmTree, sleepSyncMs } from './fs-safe.js';
import { mergeTargets } from './merge.js';
import { formatMissingRefs, verifyAssetRefs } from './verify-assets.js';
import { formatLinkReport, hasLinkProblems, verifyInternalLinks } from './verify-links.js';
import { toPosixPath } from './walk.js';

export { SplitBuildError } from './errors.js';
export { mergeTargets } from './merge.js';
export { formatMissingRefs, verifyAssetRefs } from './verify-assets.js';
export { extractLinks, formatLinkReport, hasLinkProblems, verifyInternalLinks } from './verify-links.js';
export { cpTreeWithRetry, rmTree } from './fs-safe.js';
export { walkDist } from './walk.js';

/**
 * @typedef {object} SplitBuildTarget
 * @property {string} name letters, digits, "-" or "_"; also the temp dir name
 * @property {boolean} [root] the one target copied whole into outDir
 * @property {string} [subdir] the part of a non-root build that is kept
 */

/**
 * @typedef {object} SplitBuildContext
 * @property {string} cwd
 * @property {string} outDir
 * @property {string} tempDir
 * @property {boolean} quiet
 * @property {object} logger
 * @property {string} [targetDir] afterTarget only: outDir for the root target, outDir/<subdir> otherwise
 */

/**
 * @typedef {object} SplitBuildOptions
 * @property {SplitBuildTarget[]} targets
 * @property {string} command run once per target, through the shell
 * @property {Record<string, string> | ((target: SplitBuildTarget) => Record<string, string>)} [env]
 * @property {string} [cwd]
 * @property {string} [outDir] default "dist"; the command must write a fresh build here
 * @property {string} [tempDir] default ".build-temp"
 * @property {string[]} [sharedDirs] content-hashed dirs merged from every target
 * @property {false | { dir: string }} [verifyAssets]
 * @property {false | { site: string, redirects?: Map<string, string> | (() => Map<string, string>) }} [verifyLinks]
 * @property {{ before?: Function, afterTarget?: Function, afterMerge?: Function }} [hooks]
 * @property {boolean} [strict] a missing non-root subdir fails instead of warning
 * @property {boolean} [quiet]
 * @property {number} [settleMs] pause after each save, for filesystems that lag
 * @property {object} [logger] { log, warn, error, write }
 */

const separator = '='.repeat(60);

const toLabel = (cwd, path) => toPosixPath(relative(cwd, path)) || '.';

const tail = (output, lines = 20) =>
  output?.toString().trim().split('\n').slice(-lines).join('\n') || '';

/**
 * @param {SplitBuildOptions} options
 * @returns {Promise<{ targets: { name: string, seconds: number }[], totalSeconds: number }>}
 */
export async function splitBuild(options) {
  const o = normalizeOptions(options);
  const { logger, quiet } = o;
  const info = createInfo(logger, quiet);
  const outLabel = toLabel(o.cwd, o.outDir);
  const tempLabel = toLabel(o.cwd, o.tempDir);
  const context = { cwd: o.cwd, outDir: o.outDir, tempDir: o.tempDir, quiet, logger };

  const runHook = async (name, args, target) => {
    const hook = o.hooks[name];
    if (!hook) return;
    try {
      await hook(...args);
    } catch (err) {
      const where = target ? ` for target "${target.name}"` : '';
      throw new SplitBuildError('HOOK_FAILED', `hooks.${name}${where} failed: ${err?.message || err}`, {
        hook: name,
        target: target?.name,
        cause: err,
      });
    }
  };

  await runHook('before', [context]);

  info(`🗑️  Cleaning ${tempLabel}/...`);
  rmTree(o.tempDir);
  info(`🗑️  Cleaning ${outLabel}/...`);
  rmTree(o.outDir);
  mkdirSync(o.tempDir, { recursive: true });

  const timings = [];
  for (const target of o.targets) {
    const name = target.name.toUpperCase();
    const env = o.env(target);
    const startTime = Date.now();

    if (quiet) {
      logger.write(`📦 Building ${name}...`);
    } else {
      logger.log(`\n${separator}`);
      logger.log(`📦 Building ${name}...`);
      logger.log(separator);
      const shown = Object.entries(env).map(([key, value]) => `${key}=${value}`).join(' ');
      logger.log(`⚙️  Running: ${shown ? `${shown} ` : ''}${o.command}`);
    }

    try {
      execSync(o.command, {
        cwd: o.cwd,
        stdio: quiet ? 'pipe' : 'inherit',
        // execSync's default 1 MB buffer is smaller than a big site's build log;
        // overflowing it kills the build with ENOBUFS.
        maxBuffer: 256 * 1024 * 1024,
        env: { ...process.env, ...env },
      });
    } catch (err) {
      // In quiet mode the build's own output was captured, not shown; put its
      // last lines in the error so a failed deploy log says why. Both streams:
      // Vite and Astro print some errors to stdout, warnings to stderr.
      const detail = [tail(err?.stdout), tail(err?.stderr)].filter(Boolean).join('\n');
      throw new SplitBuildError(
        'BUILD_FAILED',
        `build of target "${target.name}" failed (exit ${err?.status ?? 'unknown'})${detail ? `\n${detail}` : ''}`,
        { target: target.name, status: err?.status, cause: err }
      );
    }

    const seconds = Number(((Date.now() - startTime) / 1000).toFixed(1));
    timings.push({ name: target.name, seconds });

    const targetDir = target.root ? o.outDir : join(o.outDir, target.subdir);
    await runHook('afterTarget', [target, { ...context, targetDir }], target);

    const saveDir = join(o.tempDir, target.name);
    info(`💾 Saving ${target.name} build to ${tempLabel}/${target.name}/...`);
    try {
      cpTreeWithRetry(o.outDir, saveDir, { logger });
    } catch (err) {
      throw new SplitBuildError('COPY_FAILED', `saving target "${target.name}" failed: ${err?.message || err}`, {
        target: target.name,
        cause: err,
      });
    }
    // Give the FS a moment to settle before the next target's build wipes
    // outDir — without this the merge phase intermittently can't iterate the
    // just-written tempDir/<name>/ tree (ENOENT mid-iteration).
    if (o.settleMs > 0) sleepSyncMs(o.settleMs);

    if (quiet) {
      logger.log(` ✅ (${seconds.toFixed(1)}s)`);
    } else {
      logger.log(`✅ ${name} build saved`);
    }
  }

  info(`\n${separator}`);
  info(`🔄 Merging builds into ${outLabel}/...`);
  info(separator);
  rmTree(o.outDir);
  mergeTargets({
    targets: o.targets,
    tempDir: o.tempDir,
    outDir: o.outDir,
    outDirLabel: outLabel,
    sharedDirs: o.sharedDirs,
    strict: o.strict,
    quiet,
    logger,
  });

  // Verify the merge before the temp builds are thrown away: they are what
  // someone debugging a broken reference needs.
  if (o.verifyAssets) {
    info('\n🔍 Verifying asset references...');
    const { refCount, pageCount, missing } = verifyAssetRefs({ outDir: o.outDir, dir: o.verifyAssets.dir });
    if (missing.size > 0) {
      logger.error(
        `${missing.size} referenced asset(s) are not in ${outLabel}/${o.verifyAssets.dir}/.\n\n` +
          `${formatMissingRefs(missing)}\n\n` +
          `These pages will 404 the bundle and their islands will not hydrate.\n` +
          `Check that every target's ${o.verifyAssets.dir}/ is listed in sharedDirs.`
      );
      throw new SplitBuildError('BROKEN_ASSET_REFS', `${missing.size} referenced asset(s) are missing from ${outLabel}/`, {
        missing,
      });
    }
    logger.log(`✅ Asset references: ${refCount} reference(s) across ${pageCount} page(s) all resolve.`);
  }

  // Every target links into the others (language switcher, hreflang), so
  // only the merged output can tell whether a link resolves.
  if (o.verifyLinks) {
    info('\n🔍 Verifying internal links...');
    // A function is read only now: the redirect map may be generated into
    // the build output.
    const { redirects } = o.verifyLinks;
    const result = verifyInternalLinks({
      outDir: o.outDir,
      site: o.verifyLinks.site,
      assetsDir: o.verifyAssets ? o.verifyAssets.dir : undefined,
      redirects: typeof redirects === 'function' ? redirects() : redirects,
    });
    if (hasLinkProblems(result)) {
      logger.error(
        `${formatLinkReport(result)}\n\n` +
          `These links 404 on the built site. Fix the code that generates the link or the route.`
      );
      throw new SplitBuildError('BROKEN_INTERNAL_LINKS', `internal links in ${outLabel}/ do not resolve`, {
        missing: result.missing,
        nonReciprocal: result.nonReciprocal,
        conflicting: result.conflicting,
      });
    }
    logger.log(`✅ Internal links: ${result.linkCount} link(s) across ${result.pageCount} page(s) all resolve.`);
  }

  await runHook('afterMerge', [context]);

  info(`\n🗑️  Cleaning up ${tempLabel}/...`);
  rmTree(o.tempDir);

  const totalSeconds = Number(timings.reduce((sum, t) => sum + t.seconds, 0).toFixed(1));
  return { targets: timings, totalSeconds };
}
