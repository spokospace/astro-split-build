import { toPosixPath } from './walk.js';

/**
 * A copy of `text` that doesn't point into a larger string. V8 keeps a
 * substring of 13 or more characters as a view of its parent, so a substring
 * of a page stored in a Map that outlives the page keeps the whole page (a few
 * hundred KB) in memory. Use it for keys and values kept across pages.
 * @param {string} text
 * @returns {string}
 */
export const detach = (text) => JSON.parse(JSON.stringify(text));

/**
 * `text` with every RegExp metacharacter escaped, to match it literally.
 * @param {string} text
 * @returns {string}
 */
export const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * `path` with forward slashes and no leading or trailing slash.
 * @param {string} path
 * @returns {string}
 */
export const trimSlashes = (path) => toPosixPath(path).replace(/^\/+|\/+$/g, '');

/**
 * A base path with a leading and a trailing slash: "/docs" → "/docs/", none → "/".
 * @param {string | undefined} base
 * @returns {string}
 */
export const toBasePath = (base) => {
  const trimmed = trimSlashes(base ?? '');
  return trimmed === '' ? '/' : `/${trimmed}/`;
};
