// Stand-in for `astro build` in the integration tests. Like Astro it wipes
// and rewrites ./dist on every run, writing a page under FAKE_SUBDIR (or the
// root) that references a hashed chunk named FAKE_CHUNK, plus that chunk.
// Every run also writes the shared root page, as a non-root Astro build does.
// FAKE_LINK adds a link to that URL path on the subdir page.

import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

const { FAKE_SUBDIR = '', FAKE_CHUNK = 'App.AAAA', FAKE_FAIL, FAKE_BROKEN_REF, FAKE_LINK } = process.env;

if (FAKE_FAIL) {
  // Like Vite: the real error on stdout, a warning on stderr.
  console.log(`fake build failed for ${FAKE_SUBDIR || 'root'}`);
  console.error('warning: something unrelated');
  process.exit(3);
}

const dist = join(process.cwd(), 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, '_assets'), { recursive: true });
writeFileSync(join(dist, '_assets', `${FAKE_CHUNK}.js`), `// ${FAKE_CHUNK}\n`);
writeFileSync(join(dist, 'index.html'), `<script src="/_assets/${FAKE_CHUNK}.js"></script>`);

if (FAKE_SUBDIR) {
  const page = join(dist, FAKE_SUBDIR);
  mkdirSync(page, { recursive: true });
  const ref = FAKE_BROKEN_REF ? 'Gone.ZZZZ' : FAKE_CHUNK;
  const link = FAKE_LINK ? `<a href="${FAKE_LINK}">link</a>` : '';
  writeFileSync(join(page, 'index.html'), `<script type="module" src="/_assets/${ref}.js?astro-retry=1"></script>${link}`);
}
