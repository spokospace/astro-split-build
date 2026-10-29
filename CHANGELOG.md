# Changelog

## Unreleased

- The split build core is extracted from catalog.polo.blue's `scripts/build-split.js`: sequential target builds, FS-race-safe save and merge, shared asset dirs merged from every target, and a broken asset reference check. It ships with the `splitBuild()` API, the `astro-split-build` CLI and node:test coverage.
- The page checks read the merged output in one pass: `scanPages()` lists `outDir` once and reads each page once for every check. The asset reference and internal link checks are page checks (`assetRefsCheck`, `internalLinksCheck`), and the new `pageChecks` option adds your own, failing with `PAGE_CHECK_FAILED`.
- The internal link check no longer keeps every page in memory during the scan: hreflang and href keys it stores were substrings that pinned their whole page (catalog.polo.blue: 2.1 GB RSS down to 118 MB).
