import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'path';
import { extractLinks, formatLinkReport, hasLinkProblems, verifyInternalLinks } from '../src/verify-links.js';
import { tempProject, writeTree } from './helpers.js';

const SITE = 'https://example.com';

const page = (head, body = '') => `<html><head>${head}</head><body>${body}</body></html>`;
const alternates = (links) =>
  Object.entries(links)
    .map(([hreflang, href]) => `<link rel="alternate" hreflang="${hreflang}" href="${href}">`)
    .join('');

const verify = (t, files, options = {}) => {
  const { dir, cleanup } = tempProject();
  t.after(cleanup);
  writeTree(dir, files);
  return verifyInternalLinks({ outDir: dir, site: SITE, assetsDir: '_assets', ...options });
};

test('root-relative, page-relative and same-origin absolute links resolve', (t) => {
  const result = verify(t, {
    'index.html': page(
      `<link rel="canonical" href="${SITE}/">`,
      '<a href="/parts/">x</a><a href="parts/wheel/?q=1#top">x</a><a href="/feed.xml">x</a><a href="/about">x</a>'
    ),
    'parts/index.html': page('', '<a href="../">up</a><a href="wheel/">x</a>'),
    'parts/wheel/index.html': page(''),
    'about.html': page(''),
    'feed.xml': '',
  });
  assert.equal(result.pageCount, 4);
  assert.equal(result.linkCount, 7);
  assert.equal(hasLinkProblems(result), false);
});

test('external, anchor, scheme and asset links are skipped', (t) => {
  const result = verify(t, {
    'index.html': page(
      '<link rel="stylesheet" href="/_assets/main.css"><link rel="alternate" type="application/rss+xml" href="/missing.xml">',
      '<a href="#top">x</a><a href="mailto:a@b.c">x</a><a href="tel:123">x</a><a href="javascript:void 0">x</a>' +
        '<a href="https://other.example/x/">x</a><a href="//cdn.example/x/">x</a><a href="/_assets/App.js">x</a>' +
        '<script>const html = "<a href=\'/in-script/\'>";</script><!-- <a href="/in-comment/"> -->'
    ),
  });
  assert.equal(result.linkCount, 0);
  assert.equal(hasLinkProblems(result), false);
});

test('a missing target is reported once, with the pages that link it and a total', (t) => {
  const result = verify(t, {
    'a/index.html': page('', '<a href="/gone/">x</a><a href="/gone/">again</a>'),
    'b/index.html': page('', `<a href="${SITE}/gone/">x</a>`),
    'c/index.html': page('', '<a href="/gone/?page=2">x</a>'),
    'd/index.html': page('', '<a href="/gone/">x</a>'),
  });
  assert.equal(result.missing.size, 1);
  const entry = result.missing.get('/gone/');
  assert.equal(entry.count, 5);
  assert.equal(entry.pages.length, 3);
  assert.match(formatLinkReport(result), /1 linked URL\(s\) were not built:\n {2}✗ \/gone\/\n {6}linked from \/[a-d]\/, \/[a-d]\/, \/[a-d]\/ \(5 links in all\)/);
});

test('an encoded path resolves against the decoded file name', (t) => {
  const result = verify(t, {
    'index.html': page('', '<a href="/z%C3%BCge/">x</a><a href="/a&amp;b/">x</a>'),
    'züge/index.html': page(''),
    'a&b/index.html': page(''),
  });
  assert.equal(result.missing.size, 0);
});

test('reciprocal hreflang clusters pass', (t) => {
  const cluster = alternates({ en: '/wheel/', pl: `${SITE}/pl/kolo/`, 'x-default': '/wheel/' });
  const result = verify(t, {
    'wheel/index.html': page(cluster),
    'pl/kolo/index.html': page(cluster),
  });
  assert.equal(hasLinkProblems(result), false);
});

test('an alternate that does not link back is non-reciprocal', (t) => {
  const result = verify(t, {
    'wheel/index.html': page(alternates({ en: '/wheel/', pl: '/pl/kolo/' })),
    // The PL page points its EN alternate somewhere else (the #765 shape).
    'pl/kolo/index.html': page(alternates({ en: '/kolo/', pl: '/pl/kolo/' })),
    'kolo/index.html': page(''),
  });
  assert.equal(result.missing.size, 0);
  assert.deepEqual(result.nonReciprocal, [
    { page: '/pl/kolo/', hreflang: 'en', target: '/kolo/' },
    { page: '/wheel/', hreflang: 'pl', target: '/pl/kolo/' },
  ]);
  assert.match(formatLinkReport(result), /✗ \/wheel\/ → \/pl\/kolo\/ \(hreflang="pl"\) is not linked back/);
});

test('an alternate without its trailing slash still names the same page', (t) => {
  const result = verify(t, {
    'wheel/index.html': page(alternates({ en: '/wheel/', pl: '/pl/kolo/' })),
    'pl/kolo/index.html': page(alternates({ en: `${SITE}/wheel`, pl: '/pl/kolo' })),
  });
  assert.deepEqual(result.nonReciprocal, []);
  assert.deepEqual(result.conflicting, []);
});

test('an alternate that was not built is missing, not non-reciprocal', (t) => {
  const result = verify(t, {
    'wheel/index.html': page(alternates({ en: '/wheel/', de: '/de/rad/' })),
  });
  assert.deepEqual([...result.missing.keys()], ['/de/rad/']);
  assert.deepEqual(result.nonReciprocal, []);
});

test('one locale with two URLs on one page is conflicting', (t) => {
  const result = verify(t, {
    'wheel/index.html': page(alternates({ en: '/wheel/' }) + '<link rel="alternate" hreflang="EN" href="/wheel-2/">'),
    'wheel-2/index.html': page(''),
  });
  assert.deepEqual(result.conflicting, [{ page: '/wheel/', hreflang: 'en', targets: ['/wheel/', '/wheel-2/'] }]);
});

test('a link through a redirect resolves where the redirect ends', (t) => {
  const redirects = new Map([
    ['/docs/OLD_NAME/', '/docs/new-name/'],
    ['/hop', '/docs/OLD_NAME/'],
    ['/away/', 'https://other.example/x/'],
    ['/dead/', '/never-built/'],
  ]);
  const result = verify(
    t,
    {
      'index.html': page('', '<a href="/docs/OLD_NAME">x</a><a href="/hop/">x</a><a href="/away/">x</a><a href="/dead/">x</a>'),
      'docs/new-name/index.html': page(''),
    },
    { redirects }
  );
  assert.deepEqual([...result.missing.keys()], ['/dead/']);
});

test('a canonical or alternate through a redirect is still missing', (t) => {
  const result = verify(
    t,
    {
      'wheel/index.html': page(`<link rel="canonical" href="/old-wheel/">${alternates({ pl: '/pl/old-kolo/' })}`),
      'pl/kolo/index.html': page(''),
    },
    { redirects: new Map([['/old-wheel/', '/wheel/'], ['/pl/old-kolo/', '/pl/kolo/']]) }
  );
  assert.deepEqual([...result.missing.keys()].sort(), ['/old-wheel/', '/pl/old-kolo/']);
});

test('extractLinks reads canonical and hreflang only from <link>', () => {
  const links = extractLinks(
    `<link rel='canonical' href='/a/'><link rel="alternate" hreflang="DE" href="/de/a/"><link rel="preload" href="/font.woff2"><a class=x href=/b/>`
  );
  assert.deepEqual(links, [
    { href: '/a/', kind: 'canonical' },
    { href: '/de/a/', kind: 'hreflang', hreflang: 'de' },
    { href: '/b/', kind: 'a' },
  ]);
});

test('an out-of-range character reference is left as written, not thrown on', () => {
  assert.deepEqual(extractLinks('<a href="/a&#x110000;b/&#0;">x</a>'), [{ href: '/a&#x110000;b/&#0;', kind: 'a' }]);
});

test('markup inside an attribute value is not a link of the page', () => {
  // A manufacturer tooltip carries its own HTML in an attribute, with the
  // quotes encoded; reading it as markup made /<page>/"https://…" a link.
  const links = extractLinks(
    `<div data-tooltip="<div class=&quot;p-1&quot;><a href=&quot;https://www.helix.de/&quot;>helix</a></div>"><a href='/real/'>x</a></div>`
  );
  assert.deepEqual(links, [{ href: '/real/', kind: 'a' }]);
});

test('under a base, links carry the base and resolve to files at the top of outDir', (t) => {
  // Astro's base: "/docs" serves dist/pl/index.html at /docs/pl/.
  const result = verify(
    t,
    {
      'index.html': page(
        `<link rel="canonical" href="${SITE}/docs/">${alternates({ en: `${SITE}/docs/`, pl: `${SITE}/docs/pl/` })}`,
        '<a href="/docs/pl/">pl</a><a href="/docs">home</a><a href="about/">about</a><a href="/blog/">another site</a><a href="/docs/_assets/App.js">asset</a>'
      ),
      'pl/index.html': page(alternates({ en: `${SITE}/docs/`, pl: `${SITE}/docs/pl/` }), '<a href="/docs/gone/">x</a>'),
      'about/index.html': page(''),
    },
    { base: '/docs' }
  );
  assert.deepEqual([...result.missing.keys()], ['/docs/gone/']);
  assert.deepEqual(result.missing.get('/docs/gone/').pages, ['/docs/pl/']);
  assert.deepEqual(result.nonReciprocal, []);
  // canonical + 2 alternates + 3 links on the home page, 2 alternates + 1 link on /pl/.
  assert.equal(result.linkCount, 9);
});

test('without the base, the same links all miss', (t) => {
  const result = verify(t, { 'index.html': page('', '<a href="/docs/pl/">pl</a>'), 'pl/index.html': page('') });
  assert.deepEqual([...result.missing.keys()], ['/docs/pl/']);
});

test('a missing outDir is OUT_DIR_MISSING', (t) => {
  const { dir, cleanup } = tempProject();
  t.after(cleanup);
  assert.throws(() => verifyInternalLinks({ outDir: join(dir, 'dist'), site: SITE }), { code: 'OUT_DIR_MISSING' });
});
