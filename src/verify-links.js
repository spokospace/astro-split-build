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

import { existsSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import { SplitBuildError } from './errors.js';
import { toPosixPath, walkDist } from './walk.js';

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

/** The URL path a built HTML file is served at: "a/b/index.html" → "/a/b/". */
export const pageUrlPath = (file) => `/${file}`.replace(/(^|\/)index\.html$/, '$1');

/**
 * The links of one page: every `<a href>`, the canonical, and the hreflang
 * alternates (with their lowercased `hreflang`). Exported for tests.
 * @returns {{ href: string, kind: 'a' | 'canonical' | 'hreflang', hreflang?: string }[]}
 */
export function extractLinks(html) {
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
 * @param {{ outDir: string, site: string, assetsDir?: string, redirects?: Map<string, string> }} options
 *   `site` is the production origin (Astro's `site`); absolute links on it are
 *   internal. `redirects` maps URL paths the server redirects (with or without
 *   the trailing slash) to their targets: an `<a>` to one resolves when the
 *   redirect ends on a built page or another origin. A canonical or an
 *   hreflang alternate must name the built page itself.
 * @returns {{
 *   linkCount: number,
 *   pageCount: number,
 *   missing: Map<string, { count: number, pages: string[] }>,
 *   nonReciprocal: { page: string, hreflang: string, target: string }[],
 *   conflicting: { page: string, hreflang: string, targets: string[] }[],
 * }}
 *   `missing` maps each URL path that resolves to no file to how often it was
 *   linked and the first few pages that linked it; `nonReciprocal` lists
 *   alternates whose target exists but does not list the page back;
 *   `conflicting` lists pages that give one hreflang two different URLs.
 */
export function verifyInternalLinks({ outDir, site, assetsDir, redirects = new Map() }) {
  if (!existsSync(outDir)) {
    throw new SplitBuildError('OUT_DIR_MISSING', `${outDir} not found — run a build first.`, { outDir });
  }
  const origin = new URL(site).origin;
  const assetsPrefix = assetsDir ? `/${toPosixPath(assetsDir).replace(/^\/+|\/+$/g, '')}/` : null;

  // One walk lists every output file; resolving a link is then a Set lookup,
  // not a stat per link (a full build has millions of links).
  const files = new Set(
    walkDist(outDir, (entry) => (entry.isDirectory() ? 'recurse' : 'collect')).map((full) =>
      toPosixPath(relative(outDir, full))
    )
  );
  // Sorted, so the report reads the same on every filesystem.
  const htmlFiles = [...files].filter((file) => file.endsWith('.html')).sort();

  /** The output file a URL path is served from, or null. */
  const resolveFile = (path) => {
    const bare = path.replace(/^\/+/, '');
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
    if (assetsPrefix && path.startsWith(assetsPrefix)) return null;
    return path;
  };

  // Navigation, footer and product links repeat on every page: parse each
  // href that doesn't depend on the page (root-relative or absolute) once.
  const pathCache = new Map();
  const internalPathOf = (href, pageUrl) => {
    const pageIndependent = href.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(href);
    if (!pageIndependent) return toInternalPath(href, pageUrl);
    if (!pathCache.has(href)) pathCache.set(href, toInternalPath(href, pageUrl));
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

  for (const file of htmlFiles) {
    const pagePath = pageUrlPath(file);
    const pageUrl = new URL(pagePath, origin);
    const cluster = new Map();

    for (const { href, kind, hreflang } of extractLinks(readFileSync(join(outDir, file), 'utf8'))) {
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
      const file = resolveFile(path);
      const target = file ? pageUrlPath(file) : path;
      const previous = cluster.get(hreflang);
      if (previous === undefined) {
        cluster.set(hreflang, target);
      } else if (previous !== target) {
        const known = conflicting.find((c) => c.page === pagePath && c.hreflang === hreflang);
        if (known) known.targets.push(target);
        else conflicting.push({ page: pagePath, hreflang, targets: [previous, target] });
      }
    }
    if (cluster.size > 0) clusters.set(pagePath, cluster);
  }

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

  return { linkCount, pageCount: htmlFiles.length, missing, nonReciprocal, conflicting };
}

/** Whether `verifyInternalLinks` found anything to report. */
export const hasLinkProblems = ({ missing, nonReciprocal, conflicting }) =>
  missing.size > 0 || nonReciprocal.length > 0 || conflicting.length > 0;

/**
 * The report for a `verifyInternalLinks` result: missing targets (most-linked
 * first), then non-reciprocal and conflicting hreflang, each capped at `limit`
 * entries so a systemic bug doesn't print ten thousand lines.
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
