<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/spokospace/astro-split-build/main/art/cover-dark.jpg">
  <img alt="astro-split-build: build a multi-locale Astro site one locale at a time, merge the builds, and fail on broken bundles, links and hreflang" src="https://raw.githubusercontent.com/spokospace/astro-split-build/main/art/cover-light.jpg">
</picture>

# astro-split-build

[![npm](https://img.shields.io/npm/v/astro-split-build)](https://www.npmjs.com/package/astro-split-build) [![CI](https://github.com/spokospace/astro-split-build/actions/workflows/ci.yml/badge.svg)](https://github.com/spokospace/astro-split-build/actions/workflows/ci.yml)

Build a large multi-locale static site **one target at a time**, merge the outputs into one directory, and **fail the build if any page points at a bundle or a page that isn't there**.

## The problem

A single `astro build` of every locale of a big site (catalog.polo.blue has 8,600+ pages, 2.3 GB of HTML, in three languages) can run out of memory or hit `EMFILE: too many open files`, both on shared hosting and on Windows. Building each locale separately keeps every run small. But a naive merge of the outputs has two traps:

1. **Lost bundles.** Each build emits its own content-hashed JS/CSS. If you keep only `pl/` from the Polish build, any chunk that hashed differently there is gone. The page still returns 200, its island just never hydrates. This happened in production.
2. **Flaky filesystems.** On NFS-like shared hosting, a recursive `rm` races (`ENOTEMPTY`), and a large copy is not immediately visible to the next `readdir` (`ENOENT` mid-iteration).

This package does the sequencing, the merge, the retries and the reference checks. Your build tool still does the rendering.

Small sites don't need it: if one `astro build` of every locale fits in memory, keep it. The checks are useful on their own, though. `verifyAssetRefs`, `verifyInternalLinks` and `scanPages` run against any finished static build (see [Lower-level exports](#lower-level-exports)).

## Install

```bash
npm install --save-dev astro-split-build
```

It needs Node 20 or newer and has no dependencies. The version is 0.x: the API can still change between minor versions, and the [changelog](CHANGELOG.md) says how.

## Usage

```js
// split-build.config.js
/** @type {import('astro-split-build').SplitBuildOptions} */
export default {
  targets: [
    { name: 'en', root: true },     // copied whole into outDir
    { name: 'pl', subdir: 'pl' },   // only <build>/pl/ is kept
    { name: 'de', subdir: 'de' },
  ],
  command: 'astro build',
  env: (target) => ({ BUILD_LOCALE: target.name }),
  sharedDirs: ['_astro'],           // merged from every target
  verifyAssets: { dir: '_astro' },  // fail on a reference that doesn't resolve
  verifyLinks: { site: 'https://example.com' }, // fail on a link to a page that wasn't built
};
```

```bash
astro-split-build --config split-build.config.js
```

Without `--config`, the CLI loads `split-build.config.js` from the current directory. It exits 0 when every target built and every check passed, 1 otherwise. Put it in your `build` script.

Or from your own script:

```js
import { splitBuild } from 'astro-split-build';

const { targets, totalSeconds } = await splitBuild(config);
```

### TypeScript

The package is plain JavaScript and ships `.d.ts` files, so the config and every export are typed: `SplitBuildOptions`, `PageCheck<Result>`, `PageCheckReport`, `AssetRefsResult`, `InternalLinksResult`, `SplitBuildErrorCode` and the rest. The `@type` comment above types a plain `.js` config in your editor. A page check written in TypeScript:

```ts
import type { PageCheck, PageCheckReport } from 'astro-split-build';

export const noLoremIpsum: PageCheck<PageCheckReport> = ({ pages }) => {
  const problems: string[] = [];
  return {
    page(file, html) {
      if (html.includes('Lorem ipsum')) problems.push(`${file} still has placeholder text`);
    },
    finish: () => ({ problems, summary: `no placeholder text in ${pages.length} page(s)` }),
  };
};
```

### With Astro

The build reads its target from the environment and renders only that locale's pages:

```astro
---
// src/pages/[...slug].astro
export async function getStaticPaths() {
  const locale = process.env.BUILD_LOCALE;
  const pages = await loadPages();
  return pages
    .filter((page) => !locale || page.locale === locale)
    .map((page) => ({ params: { slug: page.slug }, props: { page } }));
}
---
```

The merge expects the layout of Astro's i18n routing with `prefixDefaultLocale: false`: the default locale at the root of `dist/`, every other locale under its own prefix (`dist/pl/`, `dist/de/`). The root target is the default locale; each other target's `subdir` is its prefix.

Set `sharedDirs` and `verifyAssets.dir` to your `build.assets` directory (`_astro` unless you changed it). If the site is served under a `base` (for example `/docs`), set the same `base` in the config.

[`examples/astro-i18n`](examples/astro-i18n) is a complete six-page site in three locales, with a custom page check. It also builds under a base (`SITE_BASE=/docs npm run build`).

## Options

| Option | Default | Meaning |
|--------|---------|---------|
| `targets` | required | `{ name, root?, subdir? }[]`. Exactly one target has `root: true`; every other target needs a relative `subdir`. Names are letters, digits, `-` and `_`. |
| `command` | required | Run once per target through the shell, in `cwd`. It must write a fresh build to `outDir`, as `astro build` does. |
| `env` | `{}` | An object, or a function of the target, merged over `process.env` for that target's command. |
| `cwd` | `process.cwd()` | Base for `outDir`, `tempDir` and the command. |
| `outDir` | `dist` | Where the command builds, and where the merged result ends up. |
| `tempDir` | `.build-temp` | Where each target's build is saved between runs. Must not overlap `outDir`. Neither may be `cwd` or one of its parents, since both are wiped. |
| `sharedDirs` | `[]` | Content-hashed directories merged from every target. A filename collision means identical bytes, so overwriting is safe. |
| `verifyAssets` | `false` | `{ dir }` checks every `/<dir>/<file>` reference in every `.html` file of the merged output. |
| `verifyLinks` | `false` | `{ site, redirects? }` checks every internal `<a href>`, `<link rel=canonical>` and `<link rel=alternate hreflang>` of the merged output: each must resolve to a file in `outDir` (`/x/` → `x/index.html`, also `x.html` and direct files), hreflang alternates must link back, and one page may not give one hreflang two URLs. Internal means root- or page-relative, or absolute on `site`; anchors, queries, other origins, `mailto:`-style schemes and `verifyAssets.dir` are skipped. `redirects` (a `Map` of old path → target, or a function returning one, called after the merge) lets an `<a>` resolve through a server-side redirect when the redirect ends on a built page; a canonical or alternate must name the built page itself. |
| `base` | `/` | The path the site is served under (Astro's `base`, e.g. `/docs`). Links and asset references carry it, `outDir` doesn't: `/docs/pl/` is `outDir/pl/index.html`. An asset reference without it is reported missing, a same-origin link outside it is skipped as another site's, and redirect and reported paths include it. Page checks get it as `basePath` (`/docs/`). |
| `pageChecks` | `[]` | `{ name, check }[]`: your own checks of the merged pages, run in the same pass as `verifyAssets` and `verifyLinks`. See [Page checks](#page-checks). |
| `hooks.before(ctx)` | none | Before anything is wiped, for example to generate images the builds read. |
| `hooks.afterTarget(target, ctx)` | none | After a target's build, before it is saved. `ctx.targetDir` is `outDir` for the root target and `outDir/<subdir>` otherwise. What you write there is part of the saved build, for example a Pagefind index. |
| `hooks.afterMerge(ctx)` | none | After the merge and the page checks, before `tempDir` is removed. |
| `strict` | `false` | A non-root target whose `subdir` is missing fails the run instead of warning. |
| `quiet` | `false` | One line per target, with the command's own output captured. Warnings still print. |
| `settleMs` | `500` | Pause after each save, for filesystems that lag behind their writes. |
| `logger` | console | `{ log, warn, error, write }`. |

Targets always build one after another. There is no concurrency option, because parallel builds bring back the limits this exists to avoid.

## Page checks

After the merge, `verifyAssets`, `verifyLinks` and every entry of `pageChecks` read the pages in **one pass**: `outDir` is listed once and each `.html` file is read once, whatever the number of checks. A big site's output is gigabytes of HTML, so a separate walk per check adds up.

A check is a function of the scan's context that returns what to do with each page and what to report at the end:

```js
const noLoremIpsum = ({ outDir, files, pages, basePath }) => {
  // files: every output file, relative to outDir with forward slashes; pages: the sorted .html ones;
  // basePath: the `base` option with both slashes ("/" or "/docs/")
  const problems = [];
  return {
    page(file, html) {
      if (html.includes('Lorem ipsum')) problems.push(`${file} still has placeholder text`);
    },
    finish: () => ({ problems, summary: `no placeholder text in ${pages.length} page(s)` }),
  };
};

export default {
  // ...
  pageChecks: [{ name: 'Placeholder text', check: noLoremIpsum }],
};
```

A non-empty `problems` fails the run with `PAGE_CHECK_FAILED`; otherwise `summary` is logged. `scanPages({ outDir, checks })` runs the same scan on a finished build, and `assetRefsCheck` and `internalLinksCheck` are the built-in checks in that form.

## Failures

Every intended failure is a `SplitBuildError` with a `code`:

| `code` | When | Extra fields |
|--------|------|--------------|
| `INVALID_CONFIG` | Before any file is touched | none |
| `BUILD_FAILED` | A target's command exited non-zero. In quiet mode the message ends with its last output lines. | `target`, `status` |
| `HOOK_FAILED` | A hook threw | `hook`, `target` |
| `COPY_FAILED` | A save or merge copy still failed after 5 attempts | none |
| `MISSING_TARGET_OUTPUT` | The root build is missing, or a subdir is missing with `strict` | `target` |
| `OUT_DIR_MISSING` | `scanPages` (and so `verifyAssetRefs` or `verifyInternalLinks`) found no `outDir` | `outDir` |
| `BROKEN_ASSET_REFS` | A page references an asset that is not in the merged output | `missing: Map<ref, page>` |
| `BROKEN_INTERNAL_LINKS` | A page links a URL that was not built, an hreflang alternate is not reciprocal, or a page gives one hreflang two URLs | `missing: Map<path, { count, pages }>`, `nonReciprocal`, `conflicting` |
| `PAGE_CHECK_FAILED` | An entry of `pageChecks` reported problems | `check` (its name), `problems` |

On failure `tempDir` is kept, so the saved builds can be inspected. **`outDir` may be partial**, because the merge wipes it first. Deploy only on a zero exit code, and swap releases rather than serving `outDir` in place.

The CLI exits `1` on any failure.

## Lower-level exports

`mergeTargets`, `scanPages`, `toPosixPath`, `detach` (copy a substring of a page before keeping it across pages, so the page itself can be freed), `escapeRegExp`, `assetRefsCheck`, `verifyAssetRefs`, `formatMissingRefs`, `internalLinksCheck`, `verifyInternalLinks`, `formatLinkReport`, `hasLinkProblems`, `extractLinks`, `cpTreeWithRetry`, `rmTree` and `walkDist` are exported for scripts that need one step on its own, for example a standalone check of a finished build.
