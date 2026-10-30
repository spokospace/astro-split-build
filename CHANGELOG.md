# Changelog

## Unreleased

- TypeScript declarations (`types/`), generated from the JSDoc on publish. The config, the results and the page checks are typed: `SplitBuildOptions`, `PageCheck<Result>`, `PageCheckReport`, `AssetRefsResult`, `InternalLinksResult`, `SplitBuildErrorCode`, the hook and logger signatures. No runtime change, and still no dependencies.
- `toPosixPath` is exported.
- `SplitBuildError`'s documented codes include `BROKEN_INTERNAL_LINKS` and `PAGE_CHECK_FAILED`, which it already threw.

## 0.1.0

First public release.

- `splitBuild()` and the `astro-split-build` CLI build each target in turn, save the builds, merge them into one `outDir` (the root target whole, the others' `subdir` only, `sharedDirs` from every target) and survive the filesystem races of shared hosting (retried copies and removals).
- One pass over the merged pages runs every check: `verifyAssets` (every `/<dir>/<file>` reference exists), `verifyLinks` (internal links, canonicals and hreflang alternates resolve, alternates are reciprocal) and your own `pageChecks`. `scanPages()`, `assetRefsCheck`, `internalLinksCheck`, `verifyAssetRefs` and `verifyInternalLinks` run the same checks on a finished build.
- `base` checks a site served under a base path (Astro's `base`), where links and asset references carry the base and `outDir` doesn't. Every page check sees it as `basePath`.
- An asset reference is a root-relative URL path ending in `/<dir>/<file>`: `https://cdn.example/_astro/…` is another host's file and is not checked.
- `strict` fails the run when a non-root target produced no `subdir`.
- `examples/astro-i18n`: a three-locale Astro site built with the package, with and without a base.

Extracted from [catalog.polo.blue](https://catalog.polo.blue), whose production builds (8,600+ pages in three locales) run on it.
