// Validate and normalize splitBuild() options before any filesystem work.
//
// Everything here guards a destructive step later on: target names and
// subdirs become directory names under tempDir/outDir, and both of those are
// wiped with a recursive rm. A typo that made outDir point inside tempDir (or
// a subdir of "..") would delete something the caller never meant to touch,
// so the config is refused up front instead.

import { isAbsolute, normalize, relative, resolve } from 'path';
import { SplitBuildError } from './errors.js';
import { toPosixPath } from './walk.js';

const NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

const invalid = (message) => new SplitBuildError('INVALID_CONFIG', message);

// A relative path that stays inside its parent: no absolute paths, no "..".
const isContainedRelative = (path) => {
  if (typeof path !== 'string' || path === '' || isAbsolute(path)) return false;
  const parts = normalize(path).split(/[\\/]/);
  return !parts.includes('..') && parts[0] !== '.';
};

// True when `child` is `parent` or lies inside it.
const isWithin = (parent, child) => {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

export const defaultLogger = {
  log: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
  write: (text) => process.stdout.write(text),
};

/** A progress logger that stays silent in quiet mode (warnings never do). */
export const createInfo = (logger, quiet) => (message) => {
  if (!quiet) logger.log(message);
};

/**
 * @param {import('./index.js').SplitBuildOptions} options
 */
export function normalizeOptions(options) {
  if (!options || typeof options !== 'object') throw invalid('options must be an object');

  const { targets, command } = options;
  if (!Array.isArray(targets) || targets.length === 0) {
    throw invalid('targets must be a non-empty array');
  }

  const names = new Set();
  const subdirs = new Set();
  for (const target of targets) {
    if (!target || typeof target.name !== 'string' || !NAME_PATTERN.test(target.name)) {
      throw invalid(`every target needs a name of letters, digits, "-" or "_" (got ${JSON.stringify(target?.name)})`);
    }
    // Case-insensitive: the names become tempDir subdirectories, and "en" and
    // "EN" are one directory on Windows and macOS.
    const nameKey = target.name.toLowerCase();
    if (names.has(nameKey)) throw invalid(`duplicate target name "${target.name}"`);
    names.add(nameKey);
    if (target.root) continue;
    if (!isContainedRelative(target.subdir)) {
      throw invalid(`target "${target.name}" needs a relative subdir (it is not the root target)`);
    }
    const subdirKey = toPosixPath(normalize(target.subdir)).replace(/\/+$/, '').toLowerCase();
    if (subdirs.has(subdirKey)) throw invalid(`two targets share the subdir "${target.subdir}"`);
    subdirs.add(subdirKey);
  }

  const roots = targets.filter((target) => target.root);
  if (roots.length !== 1) {
    throw invalid(`exactly one target must have root: true (found ${roots.length})`);
  }

  if (typeof command !== 'string' || command.trim() === '') {
    throw invalid('command must be a non-empty string');
  }
  if (options.env !== undefined && typeof options.env !== 'function' && (typeof options.env !== 'object' || options.env === null)) {
    throw invalid('env must be an object or a function of the target');
  }

  const cwd = resolve(options.cwd ?? process.cwd());
  const outDir = resolve(cwd, options.outDir ?? 'dist');
  const tempDir = resolve(cwd, options.tempDir ?? '.build-temp');
  // Both are wiped recursively: one that is cwd itself or one of its parents
  // (".", "..", a filesystem root) would take the project with it.
  for (const [name, dir] of [['outDir', outDir], ['tempDir', tempDir]]) {
    if (isWithin(dir, cwd)) throw invalid(`${name} must not be cwd or one of its parent directories`);
  }
  if (isWithin(outDir, tempDir) || isWithin(tempDir, outDir)) {
    throw invalid('outDir and tempDir must be different directories, neither inside the other');
  }

  const sharedDirs = options.sharedDirs ?? [];
  if (!Array.isArray(sharedDirs) || !sharedDirs.every(isContainedRelative)) {
    throw invalid('sharedDirs must be an array of relative directory names');
  }

  let verifyAssets = options.verifyAssets ?? false;
  if (verifyAssets !== false) {
    if (typeof verifyAssets !== 'object' || !isContainedRelative(verifyAssets.dir)) {
      throw invalid('verifyAssets must be false or { dir: "<assets directory>" }');
    }
    verifyAssets = { dir: toPosixPath(verifyAssets.dir) };
  }

  let verifyLinks = options.verifyLinks ?? false;
  if (verifyLinks !== false) {
    const { site, redirects } = verifyLinks ?? {};
    const siteOk = URL.canParse(site) && /^https?:$/.test(new URL(site).protocol);
    const redirectsOk = redirects === undefined || redirects instanceof Map || typeof redirects === 'function';
    if (!siteOk || !redirectsOk) {
      throw invalid('verifyLinks must be false or { site: "https://…", redirects?: Map | (() => Map) }');
    }
    verifyLinks = { site, redirects };
  }

  const pageChecks = options.pageChecks ?? [];
  const pageCheckOk = (entry) => typeof entry?.name === 'string' && entry.name !== '' && typeof entry.check === 'function';
  if (!Array.isArray(pageChecks) || !pageChecks.every(pageCheckOk)) {
    throw invalid('pageChecks must be an array of { name: "…", check: (context) => ({ page, finish }) }');
  }

  const hooks = options.hooks ?? {};
  for (const name of ['before', 'afterTarget', 'afterMerge']) {
    if (hooks[name] !== undefined && typeof hooks[name] !== 'function') {
      throw invalid(`hooks.${name} must be a function`);
    }
  }

  const env = options.env ?? {};
  return {
    targets,
    command,
    env: typeof env === 'function' ? env : () => env,
    cwd,
    outDir,
    tempDir,
    sharedDirs,
    verifyAssets,
    verifyLinks,
    pageChecks,
    hooks,
    strict: options.strict === true,
    quiet: options.quiet === true,
    settleMs: options.settleMs ?? 500,
    logger: { ...defaultLogger, ...options.logger },
  };
}
