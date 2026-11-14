# Progress and handoff notes

Read this first when resuming. Updated and pushed after every stage.
Privacy rule for this public repo: never write real names, emails, phone models,
the baby's name, script/deployment IDs or URLs of the live server in any file or commit message.

## How to resume
1. `git clone` the repo, `npm ci`.
2. Check the checklist below; continue with the first unchecked stage.
3. `npm test` and `npm run typecheck` must pass before every push.
4. Push to `dev` first; fast-forward `main` only when the stage is green.
5. CI results cannot be read through the cloud sandbox proxy (GitHub Actions API is blocked).
   The pipeline publishes a sanitized status file to the `ci-status` branch; read that instead:
   `git fetch origin ci-status && git show origin/ci-status:status.json`.

## Environment constraints (cloud sandbox)
- Outbound network works for Google and GitHub Pages hosts; GitHub Actions API paths do not.
- No Google credentials live in the sandbox. The clasp credential exists only as the GitHub
  secret `CLASPRC_JSON`; the privacy word list only as `PRIVACY_DENYLIST`. All server
  deployment therefore happens inside GitHub Actions.
- Git identity: generic (`BabyLog Dev`, noreply address). Commits end with the attribution
  trailer requested by the session.

## Stage checklist (see ARCHITECTURE.md for the design)
- [x] Stage 0: repo connected, push access verified, secrets stored by the owner
- [x] Stage 1: project skeleton, PWA shell, CI pipeline (tests, privacy guard, report branch). First Pages deploy: see Log
- [x] Stage 2: shared domain logic with unit tests (time zone, feed merge, sleep state, summaries, Siri phrases)
- [x] Stage 3: server core + Apps Script wrapper, tested against a fake Google runtime; TEST sheet+script created and deployed by the pipeline. Live test is PENDING until the owner approves the script once (run `setup`).
- [x] Stage 4: app home screen (status bar, buttons, undo, lock, offline queue, night mode)
- [x] Stage 5: backfill form, history, edit, soft delete
- [x] Stage 6: daily summary and settings
- [ ] Stage 7: Siri shortcut generator, signing script for the Mac, install guide
- [ ] Stage 8: "read me" sheet tab, AI test questions, owner guides

## Owner actions still pending (cannot be done by the agent)
- Enable GitHub Pages once: repository Settings > Pages > Source: Deploy from a branch > `gh-pages` / root. (The pipeline publishes to that branch; the sandbox cannot call the Pages API.)
- Approve sheet permissions for both servers: open each script, run `setup`, approve (about 3 min).
- Install the app on both phones and paste the setup code printed by `setup`.
- On the Mac: run the single shortcuts signing command, AirDrop the files.

## Log
- Stage 0 done: repository empty at start; push works after the GitHub app was installed on the repo.
- Stage 1-3 done on branch `dev` (87 unit tests green in CI, privacy check green, TEST server deployed).
  Findings worth remembering: clasp `-A` needs the credential FILE path, not a folder; bound scripts cannot be
  found by title (their id is stored on `ci-status:envs/<env>.json`); the report sanitizer redacts word-list
  hits as substrings (e.g. inside ordinary words), which is intended.
- Live test prints PENDING (HTTP 403) before the owner has run `setup` once. After approval it must say LIVE TEST PASSED.
- Stages 4-6 done: sync engine (`src/app/engine.ts`) runs the shared server logic locally for instant,
  offline-capable updates; screens in `src/app/screens`. 118 unit tests + 33 end-to-end tests (Playwright,
  mock server `scripts/mock-server.ts`) pass locally. Bug found by e2e: restore-after-delete needed
  in-memory tombstones in the engine (fixed, unit-tested). Summary e2e tests pin the app clock (`page.clock`)
  so they do not depend on the time of day.
- Dev tip: `npm run build && npx playwright test --trace off` runs e2e; the config starts preview + mock servers.
