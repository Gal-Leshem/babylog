# BabyLog

A small shared baby log for two parents: nursing, diapers, sleep and vitamin D, recorded with one tap
in an installable web app (PWA) or by voice with Siri shortcuts. The data lives in the owner's own
Google Sheet; there is no other server.

- `src/shared` time zone rules, event model, calculations, Siri phrases (used by app and server)
- `src/server` the API (`core.ts`), sheet storage and entry points for Google Apps Script
- `src/app` the Preact app: sync engine, screens, styles
- `scripts` build, deploy, privacy check, CI helpers, shortcut generator and Mac signing script
- `tests` unit tests (Vitest); `e2e` browser tests (Playwright, against a mock server)
- `docs` architecture, install guide (Hebrew), progress notes, change log, backlog

See `docs/ARCHITECTURE.md`. Install guide for the owner: `docs/INSTALL.he.md`.

## Privacy

This repository is public. It must never contain names, e-mail addresses, device models, secrets or
live server addresses. The pipeline enforces this with a word list kept as a repository secret
(`scripts/privacy-check.ts`). Names live only in the private sheet and on the phones.

## Development

```bash
npm ci
npm test            # unit tests
npm run typecheck
npm run build       # app + shortcut templates into dist/
npx playwright test --trace off   # end-to-end tests (needs a build first)
```

Branches: push to `dev`, fast-forward `main` when green. `main` deploys the production server and the site.
