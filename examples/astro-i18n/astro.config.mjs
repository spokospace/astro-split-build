import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://example.com',
  // SITE_BASE=/docs serves the site under /docs/; split-build.config.js
  // passes the same base to its checks.
  base: process.env.SITE_BASE,
  // English at the root, the other locales under /pl/ and /de/: the layout
  // split-build.config.js describes with one root target and two subdirs.
  i18n: {
    locales: ['en', 'pl', 'de'],
    defaultLocale: 'en',
    routing: { prefixDefaultLocale: false },
  },
  // Emit the CSS as a hashed file instead of inlining it, so every page
  // references a bundle in _astro/ and verifyAssets has something to check.
  build: { inlineStylesheets: 'never' },
});
