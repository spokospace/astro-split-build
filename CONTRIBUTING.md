# Contributing

```bash
npm test                      # the package's tests, Node alone
cd examples/astro-i18n
npm install && npm run build  # a real Astro site built with your change
SITE_BASE=/docs npm run build # the same site under a base path
```

CI runs both on every pull request.

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/): `fix:` releases a patch, `feat:` a minor version. While the package is 0.x, a breaking change (`feat!:` or a `BREAKING CHANGE:` footer) also releases a minor version, not 1.0. Every merge to `main` releases what its commits call for.
