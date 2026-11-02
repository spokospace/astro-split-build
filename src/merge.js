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
//
// What a non-root build has outside its subdir and the shared dirs is dropped,
// and most of it is the root's again: public/, and the default locale's static
// routes (the 404 page) that every build renders. Not all of it, though: a
// sitemap or a feed generated per build lists only that build's locale, so the
// merged site ships the root's version and every other locale is missing from
// it, with nothing failing. Those files are reported (`findDroppedFiles`).
//
// They are compared by size, not by bytes: another locale's sitemap or feed is
// never the root's length, while a file rendered again with a timestamp in it
// (a generated PDF) is, and holds nothing the merge loses. Reading every
// public/ copy twice per build to tell them apart would cost hundreds of MB.

import { existsSync, statSync } from 'fs';
import { join, normalize, relative } from 'path';
import { createInfo, defaultLogger } from './config.js';
import { SplitBuildError } from './errors.js';
import { cpTreeWithRetry } from './fs-safe.js';
import { isUnder, trimSlashes } from './text.js';
import { toPosixPath, walkDist } from './walk.js';

const label = (target) => target.name.toUpperCase();

// How many dropped files a warning names before it says "and N more".
const LISTED_DROPPED = 10;

/**
 * Files of a non-root build that the merge drops although the root build has
 * no copy of the same size: `reason` is 'missing' (the root build has no such
 * file) or 'differs'. Pages are only reported when missing: the root's static
 * pages rendered again by another build differ in their bundle names, not in
 * content that would be lost.
 * @param {object} options
 * @param {string} options.rootDir the root target's saved build
 * @param {string} options.buildDir this target's saved build
 * @param {string[]} [options.exclude] forward-slash paths (a file or a directory) not to report:
 *   the subdir and sharedDirs, which the merge keeps, and what is dropped on purpose
 * @returns {{ file: string, reason: 'missing' | 'differs' }[]}
 */
export function findDroppedFiles({ rootDir, buildDir, exclude = [] }) {
  /** @type {{ file: string, reason: 'missing' | 'differs' }[]} */
  const dropped = [];
  walkDist(buildDir, (entry, full) => {
    const file = toPosixPath(relative(buildDir, full));
    if (exclude.some((dir) => isUnder(file, dir))) return false;
    if (entry.isDirectory()) return 'recurse';
    const rootFile = statSync(join(rootDir, file), { throwIfNoEntry: false });
    if (!rootFile) dropped.push({ file, reason: 'missing' });
    else if (!file.endsWith('.html') && rootFile.size !== statSync(full).size) dropped.push({ file, reason: 'differs' });
    return false;
  });
  return dropped.sort((a, b) => a.file.localeCompare(b.file));
}

const describeDropped = (target, root, dropped) => {
  const why = (reason) => (reason === 'missing' ? `${label(root)} has none` : `${label(root)}'s copy, of another size, is kept`);
  const listed = dropped.slice(0, LISTED_DROPPED).map(({ file, reason }) => `${file} (${why(reason)})`);
  const more = dropped.length > LISTED_DROPPED ? `, and ${dropped.length - LISTED_DROPPED} more` : '';
  return `${label(target)} build: ${dropped.length} file(s) outside ${target.subdir}/ are dropped in the merge: ${listed.join(', ')}${more}`;
};

/**
 * @param {object} options
 * @param {import('./index.js').SplitBuildTarget[]} options.targets
 * @param {string} options.tempDir
 * @param {string} options.outDir
 * @param {string} [options.outDirLabel] how outDir is named in log lines
 * @param {string[]} [options.sharedDirs]
 * @param {string[]} [options.ignoreDropped] paths a non-root build may lose in the merge without a report
 * @param {boolean} [options.strict] a missing non-root subdir or a dropped file fails instead of warning
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
  ignoreDropped = [],
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

  // Before anything is copied, so that strict fails without the copies.
  const asPath = (path) => trimSlashes(normalize(path));
  const kept = [...sharedDirs, ...ignoreDropped].map(asPath);
  const droppedByTarget = others
    .filter((target) => existsSync(join(tempDir, target.name)))
    .map((target) => ({
      target,
      dropped: findDroppedFiles({
        rootDir: rootSource,
        buildDir: join(tempDir, target.name),
        exclude: [asPath(target.subdir), ...kept],
      }),
    }))
    .filter(({ dropped }) => dropped.length > 0);
  const droppedMessages = droppedByTarget.map(({ target, dropped }) => describeDropped(target, root, dropped));
  const droppedHint = 'Generate such files after the merge (hooks.afterMerge), or list the ones dropped on purpose in ignoreDropped.';
  if (strict && droppedByTarget.length > 0) {
    throw new SplitBuildError('DROPPED_FILES', `${droppedMessages.join('\n')}\n${droppedHint}`, {
      dropped: droppedByTarget.map(({ target, dropped }) => ({ target: target.name, files: dropped })),
    });
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

  // Warns even in quiet mode, as a missing subdir does: the merge succeeded,
  // and nothing else would show that a locale lost these files.
  if (droppedMessages.length === 0) return;
  for (const message of droppedMessages) logger.warn(`⚠️  ${message}`);
  logger.warn(`   ${droppedHint}`);
}
