// Assert every hashed asset a built page references actually exists.
//
// Why: a split build renders each target separately and merges them. When the
// merge drops one target's bundles, nothing looks wrong — the filenames are
// content hashes, so as long as every build emits identical files the page
// still finds them — until one target's chunk differs. Then that page points
// at a bundle that isn't in the output, its island never hydrates, and the
// page still returns 200, so nothing downstream notices. catalog.polo.blue
// shipped a dead Polish tire calculator for months this way (#742).
//
// A 404 on a hashed bundle is never acceptable, so callers treat a non-empty
// `missing` as a hard failure.

import { existsSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import { SplitBuildError } from './errors.js';
import { toPosixPath, walkDist } from './walk.js';

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * @param {{ outDir: string, dir: string }} options `dir` is the assets
 *   directory relative to `outDir` (Astro's `build.assets`, `_astro` by default).
 * @returns {{ refCount: number, pageCount: number, missing: Map<string, string> }}
 *   `missing` maps each unresolved reference to the first page (as a URL path)
 *   that pointed at it.
 */
export function verifyAssetRefs({ outDir, dir }) {
  if (!existsSync(outDir)) {
    throw new SplitBuildError('OUT_DIR_MISSING', `${outDir} not found — run a build first.`, { outDir });
  }

  // src/href values pointing into the assets directory, with or without a
  // leading slash, ignoring any ?query the runtime appends (Astro retries a
  // failed island import as `...js?astro-retry=1`).
  const refPattern = new RegExp(`/${escapeRegExp(dir)}/[A-Za-z0-9._-]+\\.[A-Za-z0-9]+`, 'g');

  const htmlFiles = walkDist(outDir, (entry) =>
    entry.isDirectory() ? 'recurse' : entry.name.endsWith('.html') && 'collect'
  );

  // One asset is referenced by hundreds of pages; remember the first page that
  // pointed at each missing file so the report names a page to reproduce with,
  // without repeating the same broken bundle hundreds of times.
  const missing = new Map();
  // The same few hundred bundles are referenced from every page: stat each
  // distinct reference once, not once per page.
  const resolved = new Set();
  let refCount = 0;

  for (const file of htmlFiles) {
    const html = readFileSync(file, 'utf8');
    for (const match of html.matchAll(refPattern)) {
      refCount++;
      const ref = match[0];
      if (resolved.has(ref) || missing.has(ref)) continue;
      if (existsSync(join(outDir, ref))) {
        resolved.add(ref);
        continue;
      }
      // Report the page as a URL path, so a Windows run doesn't print
      // "/pl\kalkulator-felg-i-opon\index.html".
      missing.set(ref, toPosixPath(relative(outDir, file)));
    }
  }

  return { refCount, pageCount: htmlFiles.length, missing };
}

/** The report lines for a non-empty `missing` map, one entry per asset. */
export function formatMissingRefs(missing) {
  return [...missing].map(([ref, page]) => `  ✗ ${ref}\n      referenced by /${page}`).join('\n');
}
