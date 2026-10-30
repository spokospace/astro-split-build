// Recursive directory traversal for built output. `withFileTypes` returns
// Dirent objects so we don't pay a stat() per entry — relevant when walking
// the thousands of HTML files of a full build.

import { readdirSync } from 'fs';
import { join, sep } from 'path';

/**
 * `path` with forward slashes, for log lines and URL paths on Windows too.
 * @param {string} path
 * @returns {string}
 */
export const toPosixPath = (path) => path.split(sep).join('/');

/**
 * Walk `dir` recursively, invoking `onEntry` for each Dirent. The callback
 * returns one of: 'recurse' (descend into directory), 'collect' (push the
 * full path into the result array), or any falsy value (skip). This lets
 * callers express "skip these subtree names at depth N", "match these file
 * names", etc. without baking traversal rules into the helper.
 * @param {string} dir
 * @param {(entry: import('fs').Dirent, full: string, depth: number) => 'recurse' | 'collect' | false | null | undefined} onEntry
 * @param {number} [depth]
 * @returns {string[]} the collected full paths
 */
export function walkDist(dir, onEntry, depth = 0) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    // Missing directory is a normal "nothing to walk" signal (e.g. scanning
    // dist/de on a single-locale build). Permission / transient-IO errors
    // are different — bubble them so a guardrail script doesn't silently
    // pretend an unreadable subtree is empty.
    if (err && err.code === 'ENOENT') return [];
    throw err;
  }
  const out = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    const action = onEntry(entry, full, depth);
    if (action === 'recurse' && entry.isDirectory()) {
      out.push(...walkDist(full, onEntry, depth + 1));
    } else if (action === 'collect') {
      out.push(full);
    }
  }
  return out;
}
