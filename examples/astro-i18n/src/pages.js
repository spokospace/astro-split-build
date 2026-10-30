// Every page of the example site, in every locale. `key` ties the
// translations of one page together for the language switcher and hreflang.
// English lives at the root (path without a locale prefix).

export const pages = [
  { key: 'home', locale: 'en', path: '', title: 'Welcome', body: 'A small site in three languages, built one language at a time.' },
  { key: 'home', locale: 'pl', path: 'pl', title: 'Witaj', body: 'Mała strona w trzech językach, budowana po jednym języku naraz.' },
  { key: 'home', locale: 'de', path: 'de', title: 'Willkommen', body: 'Eine kleine Website in drei Sprachen, Sprache für Sprache gebaut.' },
  { key: 'about', locale: 'en', path: 'about', title: 'About', body: 'Each language is a separate astro build; the outputs are merged into one dist/.' },
  { key: 'about', locale: 'pl', path: 'pl/o-nas', title: 'O nas', body: 'Każdy język to osobny astro build; wyniki są scalane w jeden dist/.' },
  { key: 'about', locale: 'de', path: 'de/ueber-uns', title: 'Über uns', body: 'Jede Sprache ist ein eigener astro build; die Ergebnisse werden in ein dist/ zusammengeführt.' },
];

// Astro's `base` ("/" by default, "/docs" with SITE_BASE=/docs), without the trailing slash.
const base = import.meta.env.BASE_URL.replace(/\/$/, '');

/** The URL path of a page: "/" for the English home, "/pl/o-nas/" for a translation, both under the base. */
export const urlOf = (page) => (page.path ? `${base}/${page.path}/` : `${base}/`);

/** The same page in every locale, the page itself included. */
export const translationsOf = (page) => pages.filter((other) => other.key === page.key);

/** The pages of one locale, for the navigation. */
export const pagesIn = (locale) => pages.filter((page) => page.locale === locale);
