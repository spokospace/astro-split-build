// Build the site one locale at a time, merge the three builds into dist/ and
// check the merged pages. Run with `npm run build`.

// A custom check in the same pass over the pages as the built-in ones: every
// page must have a non-empty <title>.
const everyPageHasATitle = ({ pages }) => {
  const problems = [];
  return {
    page(file, html) {
      if (!/<title>[^<]+<\/title>/.test(html)) problems.push(`${file} has no <title>`);
    },
    finish: () => ({ problems, summary: `all ${pages.length} page(s) have a title` }),
  };
};

export default {
  targets: [
    { name: 'en', root: true },
    { name: 'pl', subdir: 'pl' },
    { name: 'de', subdir: 'de' },
  ],
  command: 'astro build',
  // src/pages/[...path].astro renders only this locale's pages.
  env: (target) => ({ BUILD_LOCALE: target.name }),
  // Each build emits its own hashed bundles; keep all of them.
  sharedDirs: ['_astro'],
  verifyAssets: { dir: '_astro' },
  // The language switcher and the hreflang alternates link across locales,
  // so only the merged output can tell whether they resolve.
  verifyLinks: { site: 'https://example.com' },
  pageChecks: [{ name: 'Page titles', check: everyPageHasATitle }],
  // The same base as astro.config.mjs, for every check.
  base: process.env.SITE_BASE,
  // A locale whose build produced no pages fails the run instead of warning.
  strict: true,
};
