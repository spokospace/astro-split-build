# Changelog

## Unreleased

- The split build core is extracted from catalog.polo.blue's `scripts/build-split.js`: sequential target builds, FS-race-safe save and merge, shared asset dirs merged from every target, and a broken asset reference check. It ships with the `splitBuild()` API, the `astro-split-build` CLI and node:test coverage.
