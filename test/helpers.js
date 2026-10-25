import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, relative, sep } from 'path';

/** A fresh temp directory, removed by the returned cleanup function. */
export function tempProject() {
  const dir = mkdtempSync(join(tmpdir(), 'split-build-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Write `files` ({ 'a/b.html': 'content' }) under `root`. */
export function writeTree(root, files) {
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
}

/** Every file under `root`, as sorted forward-slash relative paths. */
export function listTree(root) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(relative(root, full).split(sep).join('/'));
    }
  };
  walk(root);
  return out.sort();
}

/** A logger that records instead of printing. */
export function recordingLogger() {
  const lines = { log: [], warn: [], error: [], write: [] };
  const logger = Object.fromEntries(
    Object.keys(lines).map((level) => [level, (...args) => lines[level].push(args.join(' '))])
  );
  return { logger, lines };
}
