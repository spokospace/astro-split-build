// Read every built HTML page once and hand it to each page check.
//
// Why: a full build is thousands of pages of a few hundred KB each
// (catalog.polo.blue: 8,617 pages, 2.3 GB). When every check walks outDir and
// reads and decodes every page on its own, that work repeats once per check.
// One scan lists outDir once, reads each page once, and every check sees the
// same string.

import { existsSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import { SplitBuildError } from './errors.js';
import { toBasePath } from './text.js';
import { toPosixPath, walkDist } from './walk.js';

/**
 * @typedef {object} PageScanContext
 * @property {string} outDir
 * @property {Set<string>} files every output file, as a forward-slash path relative to outDir
 * @property {string[]} pages the HTML files among `files`, sorted
 * @property {string} basePath the URL path outDir is served at, with both
 *   slashes: "/" by default, "/docs/" for Astro's `base: '/docs'`
 */

/**
 * A page check is created once per scan with its context, sees every page
 * through `page(file, html)` (`file` relative to outDir, forward slashes) and
 * returns its result from `finish()`.
 * @typedef {(context: PageScanContext) => { page: (file: string, html: string) => void, finish: () => any }} PageCheck
 */

/**
 * Run `checks` over every HTML page of `outDir` in one pass.
 * @param {{ outDir: string, base?: string, checks: PageCheck[] }} options
 *   `base` is the path the site is served under (Astro's `base`).
 * @returns {any[]} each check's `finish()` result, in the order of `checks`
 */
export function scanPages({ outDir, base, checks }) {
  if (!existsSync(outDir)) {
    throw new SplitBuildError('OUT_DIR_MISSING', `${outDir} not found — run a build first.`, { outDir });
  }

  // One walk lists every output file, so a check that resolves references
  // does a Set lookup instead of a stat per reference.
  const files = new Set(
    walkDist(outDir, (entry) => (entry.isDirectory() ? 'recurse' : 'collect')).map((full) =>
      toPosixPath(relative(outDir, full))
    )
  );
  // Sorted, so reports read the same on every filesystem.
  const pages = [...files].filter((file) => file.endsWith('.html')).sort();

  const basePath = toBasePath(base);
  const running = checks.map((check) => check({ outDir, files, pages, basePath }));
  for (const file of pages) {
    const html = readFileSync(join(outDir, file), 'utf8');
    for (const check of running) check.page(file, html);
  }
  return running.map((check) => check.finish());
}
