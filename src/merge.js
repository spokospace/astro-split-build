// Merge the saved target builds in tempDir/<name>/ into one outDir.
//
// The root target is copied whole. Every other target contributes only its
// own subdir (tempDir/pl/pl/ → outDir/pl/): the rest of a non-root build is a
// duplicate of the root's shared files, and copying it would overwrite them.
//
// The exception is `sharedDirs`, the content-hashed asset directories. Taking
// only `<subdir>/` out of the non-root builds used to leave outDir with the
// root's bundles alone. That is invisible while every build emits identical
// files — the names are content hashes, so equal content means an equal
// name — and it breaks the moment one target's chunk differs: catalog.polo.blue
// shipped /pl/kalkulator-felg-i-opon/ referencing a TireCalculator chunk that
// only the PL build had, so the Polish tire calculator never hydrated (#742).
//
// Merging rather than replacing is safe for the same reason: a filename
// collision in a shared dir means the bytes are identical.

import { existsSync } from 'fs';
import { join } from 'path';
import { createInfo, defaultLogger } from './config.js';
import { SplitBuildError } from './errors.js';
import { cpTreeWithRetry } from './fs-safe.js';

const label = (target) => target.name.toUpperCase();

/**
 * @param {object} options
 * @param {import('./index.js').SplitBuildTarget[]} options.targets
 * @param {string} options.tempDir
 * @param {string} options.outDir
 * @param {string} [options.outDirLabel] how outDir is named in log lines
 * @param {string[]} [options.sharedDirs]
 * @param {boolean} [options.strict] a missing non-root subdir fails instead of warning
 * @param {boolean} [options.quiet]
 * @param {Pick<import('./index.js').SplitBuildLogger, 'log' | 'warn'>} [options.logger]
 * @param {(src: string, dst: string) => void} [options.copy] test seam
 * @param {(ms: number) => void} [options.sleep] test seam for the retry pause
 */
export function mergeTargets({
  targets,
  tempDir,
  outDir,
  outDirLabel = 'dist',
  sharedDirs = [],
  strict = false,
  quiet = false,
  logger = defaultLogger,
  copy,
  sleep,
}) {
  const info = createInfo(logger, quiet);
  const cp = (src, dst) => {
    try {
      cpTreeWithRetry(src, dst, { copy, sleep, logger });
    } catch (err) {
      throw new SplitBuildError('COPY_FAILED', `copying ${src} → ${dst} failed: ${err?.message || err}`, { cause: err });
    }
  };

  const root = targets.find((target) => target.root);
  const others = targets.filter((target) => !target.root);
  const total = targets.length;

  const rootSource = join(tempDir, root.name);
  if (!existsSync(rootSource)) {
    throw new SplitBuildError('MISSING_TARGET_OUTPUT', `${label(root)} build not found at ${rootSource}`, { target: root.name });
  }
  info(`📦 Step 1/${total}: Copying ${label(root)} → ${outDirLabel}/...`);
  cp(rootSource, outDir);
  info(`✅ ${label(root)} copied to root`);

  others.forEach((target, index) => {
    info(`📦 Step ${index + 2}/${total}: Copying ${label(target)} → ${outDirLabel}/${target.subdir}/...`);
    const source = join(tempDir, target.name, target.subdir);
    if (!existsSync(source)) {
      if (strict) {
        throw new SplitBuildError('MISSING_TARGET_OUTPUT', `${label(target)} build not found at ${source}`, { target: target.name });
      }
      // Warns even in quiet mode: a locale silently missing from a deploy is
      // exactly what the quiet log must still show.
      logger.warn(`⚠️  ${label(target)} build not found`);
      return;
    }
    cp(source, join(outDir, target.subdir));
    info(`✅ ${label(target)} copied to /${target.subdir}`);
  });

  // The root build's shared dirs already came along with the whole-tree copy.
  for (const target of others) {
    for (const dir of sharedDirs) {
      const source = join(tempDir, target.name, dir);
      if (!existsSync(source)) continue;
      cp(source, join(outDir, dir));
      info(`✅ ${label(target)} ${dir}/ merged into ${outDirLabel}/${dir}/`);
    }
  }
}
