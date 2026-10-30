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

import { scanPages } from './scan-pages.js';
import { escapeRegExp, trimSlashes } from './text.js';

/**
 * The asset reference check as a page check for `scanPages`.
 * @param {{ dir: string }} options `dir` is the assets directory relative to
 *   outDir (Astro's `build.assets`, `_astro` by default).
 * @returns {import('./scan-pages.js').PageCheck} finishing with
 *   `{ refCount, pageCount, missing: Map<string, string> }`; `missing` maps each
 *   unresolved reference to the first page (as a URL path) that pointed at it.
 *   Under a base ("/docs/"), a reference must carry it: "/_astro/x.js" would
 *   404 there, so it is missing even when dist/_astro/x.js exists.
 */
export const assetRefsCheck = ({ dir }) => ({ files, pages, basePath }) => {
  // A root-relative URL path that ends in <dir>/<file> ("/_astro/App.js",
  // "/docs/_astro/App.js"), ignoring any ?query the runtime appends (Astro
  // retries a failed island import as `...js?astro-retry=1`). It must start
  // the value: the lookbehind skips "https://cdn.example/_astro/…" and
  // "//cdn.example/_astro/…", which are another host's files.
  const refPattern = new RegExp(
    `(?<![\\w:./-])/(?:[\\w.~%-]+/)*?${escapeRegExp(trimSlashes(dir))}/[A-Za-z0-9._-]+\\.[A-Za-z0-9]+`,
    'g'
  );

  // One asset is referenced by hundreds of pages; remember the first page that
  // pointed at each missing file so the report names a page to reproduce with,
  // without repeating the same broken bundle hundreds of times.
  const missing = new Map();
  let refCount = 0;

  return {
    page(file, html) {
      for (const [ref] of html.matchAll(refPattern)) {
        refCount++;
        if (missing.has(ref)) continue;
        if (!ref.startsWith(basePath) || !files.has(ref.slice(basePath.length))) missing.set(ref, file);
      }
    },
    finish: () => ({ refCount, pageCount: pages.length, missing }),
  };
};

/**
 * Check the asset references of every page of `outDir` on their own; see
 * `assetRefsCheck` for the result.
 * @param {{ outDir: string, dir: string, base?: string }} options
 */
export function verifyAssetRefs({ outDir, dir, base }) {
  const [result] = scanPages({ outDir, base, checks: [assetRefsCheck({ dir })] });
  return result;
}

/** The report lines for a non-empty `missing` map, one entry per asset. */
export function formatMissingRefs(missing) {
  return [...missing].map(([ref, page]) => `  ✗ ${ref}\n      referenced by /${page}`).join('\n');
}
