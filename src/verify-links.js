// Assert every internal link a built page carries points at a page that was
// built, and that hreflang alternates link back to each other.
//
// Why: the URLs a site generates and the URLs it links to come from different
// code (route generators vs. link helpers, language switchers, hreflang maps).
// When they drift apart nothing fails: the build succeeds, the linking page
// returns 200, and the dead link is only found by a crawler. catalog.polo.blue
// shipped four such bugs at once (#764–#767): a category with one child linked
// but never built, alternates in the wrong language, a localized slug map that
// overwrote its own entries. This is the check underneath all of them.
//
// Internal means: a root-relative or page-relative href, or an absolute URL on
// `site`. Anchors, mailto:/tel:/javascript:, other origins and the assets
// directory (that one is `verifyAssetRefs`) are skipped; the query and the
// fragment are ignored.

import { scanPages } from './scan-pages.js';
import { detach, trimSlashes } from './text.js';

const SKIPPED_SCHEMES = /^(?:mailto|tel|sms|javascript|data|blob):/i;

// One pass over the page: markup that never renders as a link (scripts,
// styles, templates, comments — a JSON blob in a script can still contain
// "<a href=...>" text), or a start tag with its quoted attribute values
// consumed whole. A tooltip or island prop can carry markup in an attribute
// (data-tooltip="<a href=&quot;https://…&quot;>"), and matching only <a ...>
// would read that as a link of the page.
const MARKUP = /<(script|style|template)\b[\s\S]*?<\/\1\s*>|<!--[\s\S]*?-->|<([a-z][\w:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/gi;
const LINK_TAGS = new Set(['a', 'link']);
const ATTR = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

const ENTITIES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
const fromCodePoint = (point, match) => (point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match);
const decodeEntities = (text) =>
  !text.includes('&')
    ? text
    : text.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (match, dec, hex, name) => {
        if (dec) return fromCodePoint(Number(dec), match);
        if (hex) return fromCodePoint(parseInt(hex, 16), match);
        return ENTITIES[name.toLowerCase()] ?? match;
      });

const parseAttrs = (source) => {
  const attrs = {};
  for (const [, name, double, single, bare] of source.matchAll(ATTR)) {
    attrs[name.toLowerCase()] = double ?? single ?? bare ?? '';
  }
  return attrs;
};

/**
 * The URL path a built HTML file is served at: "a/b/index.html" → "/a/b/", or
 * "/docs/a/b/" under the base "/docs/".
 * @param {string} file relative to outDir, forward slashes
 * @param {string} [basePath]
 * @returns {string}
 */
export const pageUrlPath = (file, basePath = '/') => `${basePath}${file}`.replace(/(^|\/)index\.html$/, '$1');

/** @typedef {{ href: string, kind: 'a' | 'canonical' | 'hreflang', hreflang?: string }} PageLink */

/**
 * @typedef {object} InternalLinksResult
 * @property {number} linkCount
 * @property {number} pageCount
 * @property {Map<string, { count: number, pages: string[] }>} missing each URL
 *   path that resolves to no file → how often it was linked and the first few
 *   pages that linked it
 * @property {{ page: string, hreflang: string, target: string }[]} nonReciprocal
 *   alternates whose target exists but does not list the page back
 * @property {{ page: string, hreflang: string, targets: string[] }[]} conflicting
 *   pages that give one hreflang two different URLs
 */

/**
 * The links of one page: every `<a href>`, the canonical, and the hreflang
 * alternates (with their lowercased `hreflang`). Exported for tests.
 * @param {string} html
 * @returns {PageLink[]}
 */
export function extractLinks(html) {
  /** @type {PageLink[]} */
  const links = [];
  for (const [, , rawTag, source] of html.matchAll(MARKUP)) {
    if (!rawTag) continue;
    const tag = rawTag.toLowerCase();
    if (!LINK_TAGS.has(tag)) continue;
    const attrs = parseAttrs(source);
    if (!attrs.href) continue;
    const href = decodeEntities(attrs.href);
    if (tag === 'a') {
      links.push({ href, kind: 'a' });
      continue;
    }
    const rel = (attrs.rel ?? '').toLowerCase().split(/\s+/);
    if (rel.includes('canonical')) {
      links.push({ href, kind: 'canonical' });
    } else if (rel.includes('alternate') && attrs.hreflang) {
      links.push({ href, kind: 'hreflang', hreflang: decodeEntities(attrs.hreflang).toLowerCase() });
    }
  }
  return links;
}

/**
 * @typedef {object} InternalLinksOptions
 * @property {string} site
 * @property {string} [assetsDir]
 * @property {Map<string, string>} [redirects]
 */

/**
 * The internal link check as a page check for `scanPages`.
 * @param {InternalLinksOptions} options
 *   `site` is the production origin (Astro's `site`); absolute links on it are
 *   internal. The scan's `basePath` (Astro's `base`, "/" by default) is where
 *   outDir is served: links carry it, and a same-origin link outside it is
 *   another site's and skipped. `redirects` maps URL
 *   paths the server redirects (as served, with `base`; with or without the
 *   trailing slash) to their targets: an `<a>` to one resolves when the
 *   redirect ends on a built page or another origin. A canonical or an
 *   hreflang alternate must name the built page itself. Paths in the result
 *   are as served, with `base`.
 * @returns {import('./scan-pages.js').PageCheck<InternalLinksResult>}
 */
export const internalLinksCheck = ({ site, assetsDir, redirects = new Map() }) => ({ files, pages, basePath }) => {
  const origin = new URL(site).origin;
  const assetsPrefix = assetsDir ? `${basePath}${trimSlashes(assetsDir)}/` : null;
  // "/docs" names the base itself, like "/docs/".
  const baseItself = basePath.slice(0, -1);
  const underBase = (path) => basePath === '/' || path.startsWith(basePath) || path === baseItself;

  /**
   * The output file a URL path (from toInternalPath, so under the base) is
   * served from, or null. A Set lookup, not a stat per link.
   */
  const resolveFile = (path) => {
    const bare = path.slice(basePath.length).replace(/^\/+/, '');
    if (bare === '' || bare.endsWith('/')) return files.has(`${bare}index.html`) ? `${bare}index.html` : null;
    for (const candidate of [bare, `${bare}.html`, `${bare}/index.html`]) {
      if (files.has(candidate)) return candidate;
    }
    return null;
  };

  /** The internal URL path of `href` as seen from `pageUrl`, or null for links this check skips. */
  const toInternalPath = (href, pageUrl) => {
    const trimmed = href.trim();
    if (trimmed === '' || trimmed.startsWith('#') || SKIPPED_SCHEMES.test(trimmed)) return null;
    let url;
    try {
      url = new URL(trimmed, pageUrl);
    } catch {
      return null;
    }
    if (url.origin !== origin) return null;
    let path;
    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      path = url.pathname;
    }
    if (!underBase(path)) return null;
    if (assetsPrefix && path.startsWith(assetsPrefix)) return null;
    return path;
  };

  // Navigation, footer and product links repeat on every page: parse each
  // href that doesn't depend on the page (root-relative or absolute) once.
  const pathCache = new Map();
  const internalPathOf = (href, pageUrl) => {
    const pageIndependent = href.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(href);
    if (!pageIndependent) return toInternalPath(href, pageUrl);
    if (!pathCache.has(href)) pathCache.set(detach(href), toInternalPath(href, pageUrl));
    return pathCache.get(href);
  };

  const redirectOf = (path) =>
    redirects.get(path) ?? redirects.get(path.replace(/(.)\/$/, '$1')) ?? redirects.get(`${path.replace(/\/$/, '')}/`);

  const viaRedirect = new Map();
  /** Whether a link to `path` ends on a built page or another origin, through at most 5 redirects. */
  const resolvesViaRedirect = (path) => {
    if (viaRedirect.has(path)) return viaRedirect.get(path);
    let current = path;
    let resolved = false;
    for (let hop = 0; hop < 5; hop++) {
      const target = redirectOf(current);
      if (target === undefined) break;
      const next = toInternalPath(target, new URL(current, origin));
      if (next === null || resolveFile(next)) {
        resolved = true;
        break;
      }
      current = next;
    }
    viaRedirect.set(path, resolved);
    return resolved;
  };

  const missing = new Map();
  const conflicting = [];
  // page URL path → Map(hreflang → target URL path), for the reciprocity pass.
  const clusters = new Map();
  // Paths already found to be built: most links point at a few thousand pages.
  const built = new Set();
  let linkCount = 0;

  const page = (file, html) => {
    const pagePath = pageUrlPath(file, basePath);
    const pageUrl = new URL(pagePath, origin);
    const cluster = new Map();

    for (const { href, kind, hreflang } of extractLinks(html)) {
      const path = internalPathOf(href, pageUrl);
      if (path === null) continue;
      linkCount++;

      if (built.has(path) || resolveFile(path)) {
        built.add(path);
      } else if (!(kind === 'a' && resolvesViaRedirect(path))) {
        const entry = missing.get(path) ?? { count: 0, pages: [] };
        entry.count++;
        if (entry.pages.length < 3 && !entry.pages.includes(pagePath)) entry.pages.push(pagePath);
        missing.set(path, entry);
      }

      if (kind !== 'hreflang') continue;
      // Keyed by the page the alternate resolves to, so "/x" and "/x/" name
      // the same page in the reciprocity pass.
      const targetFile = resolveFile(path);
      const target = targetFile ? pageUrlPath(targetFile, basePath) : path;
      const previous = cluster.get(hreflang);
      if (previous === undefined) {
        // Clusters live until the reciprocity pass: a key cut from the page
        // would keep every page with alternates in memory.
        cluster.set(detach(hreflang), target);
      } else if (previous !== target) {
        const known = conflicting.find((c) => c.page === pagePath && c.hreflang === hreflang);
        if (known) known.targets.push(target);
        else conflicting.push({ page: pagePath, hreflang, targets: [previous, target] });
      }
    }
    if (cluster.size > 0) clusters.set(pagePath, cluster);
  };

  const finish = () => {
    // A → B for some hreflang means B must list A for some hreflang (x-default
    // included). Targets that don't exist are already in `missing`.
    const nonReciprocal = [];
    for (const [pagePath, cluster] of clusters) {
      for (const [hreflang, target] of cluster) {
        if (target === pagePath || !resolveFile(target)) continue;
        const back = clusters.get(target);
        if (back && [...back.values()].includes(pagePath)) continue;
        nonReciprocal.push({ page: pagePath, hreflang, target });
      }
    }
    return { linkCount, pageCount: pages.length, missing, nonReciprocal, conflicting };
  };

  return { page, finish };
};

/**
 * Check the internal links of every page of `outDir` on their own; see
 * `internalLinksCheck` for the options and the result.
 * @param {InternalLinksOptions & { outDir: string, base?: string }} options
 * @returns {InternalLinksResult}
 */
export function verifyInternalLinks({ outDir, base, ...options }) {
  const [result] = scanPages({ outDir, base, checks: [internalLinksCheck(options)] });
  return result;
}

/**
 * Whether `verifyInternalLinks` found anything to report.
 * @param {Pick<InternalLinksResult, 'missing' | 'nonReciprocal' | 'conflicting'>} result
 * @returns {boolean}
 */
export const hasLinkProblems = ({ missing, nonReciprocal, conflicting }) =>
  missing.size > 0 || nonReciprocal.length > 0 || conflicting.length > 0;

/**
 * The report for a `verifyInternalLinks` result: missing targets (most-linked
 * first), then non-reciprocal and conflicting hreflang, each capped at `limit`
 * entries so a systemic bug doesn't print ten thousand lines.
 * @param {Pick<InternalLinksResult, 'missing' | 'nonReciprocal' | 'conflicting'>} result
 * @param {{ limit?: number }} [options]
 * @returns {string}
 */
export function formatLinkReport({ missing, nonReciprocal, conflicting }, { limit = 50 } = {}) {
  const sections = [];
  const capped = (lines) =>
    (lines.length > limit ? [...lines.slice(0, limit), `  … and ${lines.length - limit} more`] : lines).join('\n');

  if (missing.size > 0) {
    const sorted = [...missing].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]));
    const lines = sorted.map(([path, { count, pages }]) => {
      const more = count > pages.length ? ` (${count} links in all)` : '';
      return `  ✗ ${path}\n      linked from ${pages.join(', ')}${more}`;
    });
    sections.push(`${missing.size} linked URL(s) were not built:\n${capped(lines)}`);
  }
  if (nonReciprocal.length > 0) {
    const lines = nonReciprocal.map(
      ({ page, hreflang, target }) => `  ✗ ${page} → ${target} (hreflang="${hreflang}") is not linked back`
    );
    sections.push(`${nonReciprocal.length} hreflang alternate(s) are not reciprocal:\n${capped(lines)}`);
  }
  if (conflicting.length > 0) {
    const lines = conflicting.map(
      ({ page, hreflang, targets }) => `  ✗ ${page} gives hreflang="${hreflang}" ${targets.length} URLs: ${targets.join(', ')}`
    );
    sections.push(`${conflicting.length} page(s) give one locale more than one URL:\n${capped(lines)}`);
  }
  return sections.join('\n\n');
}
