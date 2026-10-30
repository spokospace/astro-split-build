// Compiled with `npm run typecheck` against the published declarations
// (types/, via the package's own "exports"), never run. It fails when the
// types a TypeScript user sees drift from what the README documents.

import {
  splitBuild,
  scanPages,
  verifyAssetRefs,
  verifyInternalLinks,
  hasLinkProblems,
  formatLinkReport,
  toPosixPath,
  SplitBuildError,
  type SplitBuildOptions,
  type PageCheck,
  type PageCheckReport,
  type AssetRefsResult,
  type InternalLinksResult,
  type SplitBuildErrorCode,
} from 'astro-split-build';

const noLoremIpsum: PageCheck<PageCheckReport> = ({ pages, basePath }) => {
  const problems: string[] = [];
  return {
    page(file, html) {
      if (html.includes('Lorem ipsum')) problems.push(`${basePath}${file}`);
    },
    finish: () => ({ problems, summary: `${pages.length} page(s)` }),
  };
};

const config: SplitBuildOptions = {
  targets: [
    { name: 'en', root: true },
    { name: 'pl', subdir: 'pl' },
  ],
  command: 'astro build',
  env: (target) => ({ BUILD_LOCALE: target.name }),
  sharedDirs: ['_astro'],
  verifyAssets: { dir: '_astro' },
  verifyLinks: { site: 'https://example.com', redirects: () => new Map([['/old/', '/new/']]) },
  base: '/docs',
  pageChecks: [{ name: 'Placeholder text', check: noLoremIpsum }],
  strict: true,
  hooks: {
    afterTarget: (target, { targetDir }) => {
      const dir: string = targetDir;
      const name: string = target.name;
    },
  },
  logger: { log: () => {} },
};

async function run(): Promise<void> {
  const { targets, totalSeconds } = await splitBuild(config);
  const first: number = targets[0].seconds + totalSeconds;

  const assets: AssetRefsResult = verifyAssetRefs({ outDir: 'dist', dir: '_astro' });
  const missingPage: string | undefined = assets.missing.get('/_astro/App.js');

  const links: InternalLinksResult = verifyInternalLinks({ outDir: 'dist', site: 'https://example.com' });
  if (hasLinkProblems(links)) console.error(formatLinkReport(links, { limit: 10 }));

  const [report]: [PageCheckReport] = scanPages({ outDir: 'dist', checks: [noLoremIpsum] });
  const problems: string[] = report.problems;
  const posix: string = toPosixPath('a\\b');

  try {
    await splitBuild(config);
  } catch (err) {
    if (err instanceof SplitBuildError) {
      const code: SplitBuildErrorCode = err.code;
    }
  }
}

// The types reject what the runtime validation rejects.
// @ts-expect-error a target needs a name
const noName: SplitBuildOptions = { targets: [{ root: true }], command: 'astro build' };
// @ts-expect-error verifyAssets takes { dir }, not a string
const badAssets: SplitBuildOptions = { targets: [{ name: 'en', root: true }], command: 'x', verifyAssets: '_astro' };
// @ts-expect-error a page check report needs problems and a summary
const badCheck: PageCheck<PageCheckReport> = () => ({ page() {}, finish: () => ({ problems: [] }) });
