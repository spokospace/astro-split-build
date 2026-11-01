// Writes the README diagrams, each in a light and a dark version:
// art/pipeline-{light,dark}.svg and art/single-pass-{light,dark}.svg.
// Run with `node art/diagrams.mjs` after changing anything here.

import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';

const THEMES = {
  light: {
    text: '#1f2328',
    muted: '#59636e',
    line: '#8c959f',
    build: { fill: '#f6edfd', stroke: '#bc52ee', title: '#6b1f8f' },
    merge: { fill: '#eceeff', stroke: '#3245ff', title: '#1a2390' },
    pass: { fill: '#e6f4ea', stroke: '#1a7f37', title: '#116329' },
    keep: { fill: '#f6f8fa', stroke: '#8c959f', title: '#424a53' },
    before: '#afb8c1',
    after: '#3245ff',
  },
  dark: {
    text: '#e6edf3',
    muted: '#9198a1',
    line: '#6e7681',
    build: { fill: '#2b1a3a', stroke: '#bc52ee', title: '#ecc8fb' },
    merge: { fill: '#171c4d', stroke: '#6b78ff', title: '#ced3ff' },
    pass: { fill: '#0f2d1a', stroke: '#3fb950', title: '#aff5b4' },
    keep: { fill: '#21262d', stroke: '#6e7681', title: '#d1d9e0' },
    before: '#59636e',
    after: '#6b78ff',
  },
};

const FONT = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif`;

const svg = (width, height, title, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" font-family="${FONT}">
<title>${title}</title>
${body}
</svg>
`;

const text = (x, y, content, { size = 13, fill, weight = 400, anchor = 'start' }) =>
  `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" dominant-baseline="central">${content}</text>`;

/** A box with a title and a subtitle, centred. */
const box = (x, y, width, height, kind, title, subtitle) => {
  const cx = x + width / 2;
  return [
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="8" fill="${kind.fill}" stroke="${kind.stroke}" stroke-width="1"/>`,
    text(cx, y + height / 2 - 10, title, { size: 15, weight: 600, fill: kind.title, anchor: 'middle' }),
    text(cx, y + height / 2 + 12, subtitle, { fill: kind.title, anchor: 'middle' }),
  ].join('\n');
};

/** A straight arrow; the head is drawn as a path so it needs no marker id. */
const arrow = (x1, y1, x2, y2, color) => {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const head = (side) => {
    const a = angle + side * (Math.PI - 0.5);
    return `${(x2 + 8 * Math.cos(a)).toFixed(1)} ${(y2 + 8 * Math.sin(a)).toFixed(1)}`;
  };
  return [
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="1.5"/>`,
    `<path d="M${head(1)} L${x2} ${y2} L${head(-1)}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  ].join('\n');
};

const pipeline = (t) => {
  const builds = [
    ['astro build: en', 'copied whole, as the root'],
    ['astro build: pl', 'only its pl/ is kept'],
    ['astro build: de', 'only its de/ is kept'],
  ];
  const body = [
    text(380, 18, 'One locale per run, one run after another: each build holds a third of the site', {
      fill: t.muted,
      anchor: 'middle',
    }),
    ...builds.map(([title, subtitle], i) => box(20 + i * 260, 40, 200, 64, t.build, title, subtitle)),
    arrow(222, 72, 276, 72, t.line),
    arrow(482, 72, 536, 72, t.line),
    ...[120, 380, 640].map((x) => arrow(x, 106, x, 142, t.line)),
    box(20, 146, 720, 64, t.merge, 'Merge into one dist/', 'en at the root, pl/ and de/ under it, every _astro/ bundle of every build kept'),
    arrow(380, 212, 380, 248, t.line),
    box(20, 252, 720, 64, t.merge, 'Check every page in one pass', 'bundles, internal links, canonicals, hreflang both ways, your own page checks'),
    arrow(195, 318, 195, 354, t.line),
    arrow(565, 318, 565, 354, t.line),
    box(20, 358, 350, 64, t.pass, 'Every check passes', 'exit 0: deploy the merged dist/'),
    box(390, 358, 350, 64, t.keep, 'A check fails', 'exit 1: the previous release stays live'),
  ].join('\n');
  return svg(760, 440, 'astro-split-build: build each locale in turn, merge, check every page, then deploy or keep the previous release', body);
};

const singlePass = (t) => {
  const max = 400;
  const bar = (y, value, before, color, label) => {
    const width = Math.max(4, Math.round((value / before) * max));
    return [
      `<rect x="150" y="${y}" width="${width}" height="26" rx="4" fill="${color}"/>`,
      text(150 + width + 10, y + 13, label, { fill: t.text }),
    ].join('\n');
  };
  const body = [
    text(20, 18, 'Checks of the merged output on catalog.polo.blue: 8,600+ pages, 2.3 GB of HTML', { fill: t.muted }),
    text(20, 85, 'Time', { size: 15, weight: 600, fill: t.text }),
    bar(56, 26.2, 26.2, t.before, 'a walk per check: 26.2 s'),
    bar(88, 13.6, 26.2, t.after, 'one pass: 13.6 s'),
    text(20, 181, 'Peak memory', { size: 15, weight: 600, fill: t.text }),
    bar(152, 2900, 2900, t.before, 'a walk per check: 2.9 GB'),
    bar(184, 118, 2900, t.after, 'one pass: 118 MB'),
  ].join('\n');
  return svg(760, 230, 'Checks of the merged output: 26.2 s and 2.9 GB peak memory with a walk per check, 13.6 s and 118 MB in one pass', body);
};

const dir = fileURLToPath(new URL('.', import.meta.url));
for (const [name, theme] of Object.entries(THEMES)) {
  writeFileSync(`${dir}pipeline-${name}.svg`, pipeline(theme));
  writeFileSync(`${dir}single-pass-${name}.svg`, singlePass(theme));
}
