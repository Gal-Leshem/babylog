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
   The pipeline publishes sanitized per-job reports to the `ci-status` branch. Read them with
   `scripts/read-ci.sh [test|server|pages]` (set `VERBOSE=1` for every log section).
   A report's `sha` must equal `git rev-parse --short=7 HEAD` before you trust it (reports lag the push by 1-3 minutes).
6. Waiting: poll with a loop of short `sleep 5` steps (foreground command limit is 5 minutes; a single long sleep is blocked).
7. Local e2e: `npm run build && npx playwright test --trace off`. Also run once with `MOCK_DELAY=200` on a manually started
   mock server (`MOCK_DELAY=200 PORT=8787 npx tsx scripts/mock-server.ts`) to catch timing bugs; CI does this too.
8. Commit trailer: `Co-Authored-By` + `Claude-Session` lines as requested by the session reminder; git identity stays generic.

## Environment constraints (cloud sandbox)
- Outbound network works for Google and GitHub Pages hosts; GitHub Actions API paths do not.
- No Google credentials live in the sandbox. The clasp credential exists only as the GitHub
  secret `CLASPRC_JSON`; the privacy word list only as `PRIVACY_DENYLIST`. All server
  deployment therefore happens inside GitHub Actions.
- Git identity: generic (`BabyLog Dev`, noreply address). Commits end with the attribution
  trailer requested by the session.

## Current state (snapshot, update at every stage)
- Branches `dev` and `main` are identical; last commit: "Fix settings form races found under slow connections".
- Tests: 144 unit (Vitest) + 45 browser (Playwright), also run against a slow server in CI. All green in CI on `dev`.
- `main` pipeline: tests OK, production server deployed (its script id is in `ci-status:envs/prod.json`), test server deployed.
- Pages job on `main` reports FAILURE only at the last step ("verify live site"): the `gh-pages` branch is published, but GitHub
  Pages is not enabled. The pipeline's own attempt to enable it is refused (`Resource not accessible by integration`), and the
  sandbox API proxy refuses the Pages endpoints too. Only the owner can enable it (see Owner actions). Nothing else is wrong.
- Live test against the real TEST server (Apps Script web app + real sheet): LIVE TEST PASSED (14 checks) after the owner ran `setup`.
  Remaining owner steps: run `rotateKey` in the production script (BabyLog) once for a corrected `/exec` setup code, install on phones, shortcuts.
- Nothing is left to build for the agreed MVP. Remaining work is verification with the owner and polish (see Ideas).

- Owner reported (Sun morning) that Pages is enabled (site answers HTTP 200) and that `setup` was run in the script editor;
  verifying via the live test, which only exercises the TEST server (PASSED = approved there).

## Stage checklist (see ARCHITECTURE.md for the design)
- [x] Stage 0: repo connected, push access verified, secrets stored by the owner
- [x] Stage 1: project skeleton, PWA shell, CI pipeline (tests, privacy guard, report branch). First Pages deploy: see Log
- [x] Stage 2: shared domain logic with unit tests (time zone, feed merge, sleep state, summaries, Siri phrases)
- [x] Stage 3: server core + Apps Script wrapper, tested against a fake Google runtime; TEST sheet+script created and deployed by the pipeline. Live test is PENDING until the owner approves the script once (run `setup`).
- [x] Stage 4: app home screen (status bar, buttons, undo, lock, offline queue, night mode)
- [x] Stage 5: backfill form, history, edit, soft delete
- [x] Stage 6: daily summary and settings
- [x] Stage 7: Siri shortcut generator (`scripts/shortcuts`), Mac signing script, install guide `docs/INSTALL.he.md`. NOT verified on a real device: see Open risks
- [x] Stage 8: "read me" sheet tab (in `setup()`), AI test questions and owner guide (in `docs/INSTALL.he.md`)

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
- Stages 7-8 done: shortcuts are self-contained (address/key/name are filled in locally by `sign.sh` on the owner's
  Mac, so nothing secret or personal is in the repo or on the site). 143 unit tests + 45 e2e tests pass locally and in CI.
- Pipeline finding: Google reports the web app deployments as ANYONE_ANONYMOUS / USER_DEPLOYING, but anonymous calls
  still get HTTP 403 "Access Denied" until the owner runs `setup` once (assumed cause, unconfirmed). The live test
  reports PENDING until then; after approval it must report LIVE TEST PASSED.
- Pages: publishing to `gh-pages` works; the site stays 404 until the owner enables Pages (Settings > Pages > gh-pages).
  The workflow's enable attempt is refused with the default Actions token, so this cannot be automated without a personal token.
- npm audit: 0 vulnerabilities in shipped (production) dependencies. The 2 "high" findings are in dev tooling (clasp -> zod) that runs only in CI.
- Bug found by the owner on first contact: the Apps Script editor showed "No function" because the entry points were attached to
  `globalThis` at run time. The editor only lists top-level `function` declarations, so `build-server.ts` now appends them
  (tested in `tests/gas.test.ts`). Lesson: the fake Google runtime cannot catch editor-level behaviour, only runtime behaviour.
- Bug found by the owner (second contact): `setup()` printed a setup code with the editor's private `/dev` address, which cannot work
  from phones. Fix: `deploy-server.ts` now looks up the web app deployment first and embeds its `/exec` address into the bundle
  (`EXEC_URL` -> `__EXEC_URL__`, private to the Apps Script project, never in the repo); on the very first deploy it creates the
  deployment, rebuilds and redeploys. The app and `sign.sh` refuse `/dev` addresses with an explanation and accept an `/exec` override.
  Owner must run `rotateKey` once after this version is deployed to get a corrected code (also retires the key pasted in chat).
- Owner decisions (Sunday): no Siri shortcuts via the Mac signing script for now (leave `scripts/shortcuts` in place, unused).
  If Siri is wanted later, a single manual shortcut on the phone is the fallback (see INSTALL.he.md, "אם משהו לא עובד").
- Owner reported a scrolling problem on the home screen on a real iPhone (list at the bottom not scrollable). Not reproducible in
  Chromium at heights 560-852. Hardened the layout: `#app` is `position: fixed; inset: 0` (no vh/dvh), `.main` scrolls with
  touch momentum, the button grid has a minimum height so small screens scroll instead of squashing (`e2e/scroll.spec.ts`).
  If it persists, ask for a screenshot from the phone; suspects: standalone-mode viewport height, status bar style.
- Second report with a screen recording (iPhone): Home content got dragged up and stayed stuck (iOS elastic overscroll on a container
  that should not scroll); Settings scrolled fine. Fix: Home is a FIXED screen (`.main.fixed`: overflow hidden, no overscroll, grid shrinks
  instead of scrolling); each tab has its own scroll container (`key={tab}`, no shared scroll offset); the recent list on Home shows
  the last 10 events in its own scrollable box (about 3.5 rows visible). Tests drag with raw CDP touch events (`e2e/scroll.spec.ts`;
  `Input.synthesizeScrollGesture` with touch does nothing in headless Chromium, mouse wheel and `dispatchTouchEvent` work).
  Mutation-checked: the old scrollable home layout fails the short-screen test.
- Owner feedback after that fix: home scrolls fine on the phone. Content now starts lower on every screen (`--top-gap: 22px` on `.main`,
  on top of the safe-area inset) because iOS fades content right under the status bar; history gets the same scroll container as
  settings (test drags starting on a row, bottom padding so the last row clears the tab bar). Vitamin D row got more weight (0.8fr)
  so every button stays at least 56px tall even at a 560px-high screen.
- Owner feedback: entries made on the other phone did not show up until the owner logged something (refresh was only a 60 s timer plus
  foreground events). Now: server data revision (`REV`, `poll` action, API version 0.2.0), app polls every 10 s while visible and
  refetches only on change, full refresh every 60 s, immediate refresh on resume/focus/pageshow/online, stale-refresh guard.
  Tests: unit (revision rules, `pollOnce`, stuck refresh, old servers) and `e2e/autosync.spec.ts` (two phones with no manual trigger,
  cheap polling, silence while hidden, catch-up after offline). Mutation-checked: a slow poll interval fails the first test.
  The server must be redeployed for `poll` to exist; clients fall back to full refreshes against an older server.
- Owner request: in the add-after-the-fact form the quick button "now" is replaced by "10 minutes ago" (`back-10`).
- Owner feedback (Mon): quick-time buttons did not light up; date showed English months. Now the active "X minutes ago" button is lit
  (cleared by manual time/date edits), and the form uses the in-app Hebrew calendar `DateField` (tests: `pickDate` helper in `e2e/helpers.ts`).
  `docs/ARCHITECTURE.md` was extended with the UI rules, deployment details and test strategy; keep it in step with every change.
- Owner decisions (Mon, later): no custom calendar (removed `DateField` calendar; the Hebrew label opens the system date picker on tap);
  diaper wording is "פיפי" / "קקי" instead of "רטוב" / "צואה" everywhere in the app and the guide.
- CI caught a gap in the new sync code: a refresh requested while another was running (focus / back online) was dropped until the next
  10 s poll. `refresh()` now remembers it (`refreshQueued`) and runs again right after (unit test with an answer produced before the new
  event appeared; it failed before the fix). General lesson: when a trigger can arrive during work in progress, queue it, do not drop it.
- Real bug found through a flaky CI check: `KindButton` was a component defined INSIDE `Home`, so every re-render rebuilt all
  buttons (a tap straddling a re-render could be lost). Now a plain function (`kindButton`). Regression test marks the DOM nodes and
  checks they survive re-renders; it fails on the old code. Rule: never define components inside components in this app.
- Git identity: commits are authored as `Claude <noreply@anthropic.com>` (a session hook flags other committer emails as
  Unverified). The first 9+ commits on GitHub still carry the older generic identity; rewriting them needs a force-push that the
  owner has not approved. A local branch `dev-reauthored` (not pushed) holds that rewrite; do not push it without approval.
- Mock server: `MOCK_DELAY` env var adds latency; `/__control?reset=1|offline=1|delay=ms` and `POST /__seed` exist for tests.

## Open risks to verify with the owner (cannot be tested in the cloud sandbox)
1. Live test after the owner ran `setup`: expect "LIVE TEST PASSED" (else follow the troubleshooting list in INSTALL.he.md).
2. Shortcut files: `shortcuts sign` must accept them and iOS must import them. Structure follows the open-source
   shortcuts-js reference and a documented subset (see tests/shortcut-interp.ts). If rejected, fall back to the manual recipe.
3. Whether a network shortcut runs while the phone is locked (may ask for Face ID).
4. Gemini reading a sheet shared from another account.
5. First real use of the app on iPhone Safari/PWA: install flow, safe areas, status bar, date/time pickers.

## Ideas if time remains (none required for the MVP)
- After the owner confirms the live test passes: add a scheduled weekly backup of the sheet (a copy in Drive, keep 8).
- Shortcut import failures on a real device would need a fix in `scripts/shortcuts/builder.ts`; keep `tests/shortcut-interp.ts` in step.
- Optional: a "last 7 days" chart on the summary screen (phase 2 in the spec; not part of the MVP).

## Resume prompt (paste into a new session with the babylog repository attached)
> Continue the BabyLog project. Read `docs/PROGRESS.md` and `docs/ARCHITECTURE.md` in the repository first. Follow "How to resume".
> The owner approved, for the overnight run: pushing to `dev` and `main`, deploying to GitHub Pages, creating the sheets and
> deploying the Apps Script server through GitHub Actions with the stored credential. Never put names, e-mail addresses,
> device models, secrets or live addresses into the repository, commit messages or logs. Check the latest CI reports with
> `scripts/read-ci.sh`, fix anything red, and report to the owner in Hebrew what changed and what is left for them.
