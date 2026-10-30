# astro-split-build example: Astro i18n

A six-page Astro site in English, Polish and German, built one locale at a time.

```bash
npm install
npm run build
```

`npm run build` runs `astro-split-build --config split-build.config.js`, which:

1. runs `astro build` three times, with `BUILD_LOCALE` set to `en`, `pl` and `de` in turn;
2. merges the three builds into `dist/`: English at the root, then `pl/` and `de/`;
3. checks the merged pages in one pass:
   - every `/_astro/…` bundle a page references exists;
   - every internal link, canonical and hreflang alternate resolves to a built page, and the alternates link back;
   - every page has a `<title>`, a custom check defined in the config.

The locale filter is in `src/pages/[...path].astro`'s `getStaticPaths()`. `astro dev` ignores it and renders every locale.
