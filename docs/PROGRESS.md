# Handoff: read this first when resuming

Last updated with the commit that contains this file. Keep it short and current; history lives in `CHANGELOG.md`, design in `ARCHITECTURE.md`.
**Privacy rule for this public repo:** never write real names, e-mail addresses, device models, the baby's name, script/deployment ids, keys
or live server addresses into any file, commit message or log.

## What this project is
A shared baby log for two parents: one-tap logging of nursing, diapers, sleep and medicines (vitamin D by default) in an installable web
app (PWA, Hebrew, RTL),
data in the owner's private Google Sheet, server = Google Apps Script web app, hosting = GitHub Pages, everything deployed by GitHub Actions.

## Status snapshot
- Live: site on GitHub Pages (`version.json` shows the served commit), production + test Apps Script servers deployed by the pipeline.
- Tests: about 333 unit (Vitest) and 181 browser (Playwright, 4 workers in parallel, each with its own mock server); CI runs the
  browser suite twice (normal and against a slow mock server). The CI live test (real Google test server, real sheet) first waits
  until the server answers from this commit's build, then reports `LIVE TEST PASSED`. A push to `dev` is green in about 4 minutes,
  `main` (with production) in about 4 more.
- `dev` and `main` are identical except while a change is on its way: push to `dev`, wait for both `dev` reports, then `main`.
- The app is complete and used daily on two iPhones; every change comes from the owner's feedback. History: `CHANGELOG.md`.
- Third working session (details in `CHANGELOG.md`): the sync refactor (`REFACTOR_PLAN.md`, done: one `sync` round trip, settings
  copy, tail read, beacon/keepalive, adaptive polling, timings), parallel tests and a faster pipeline, iPhone status bar after a
  day/night change (reload), sleep editing by moment, quick "לפני X" buttons, "היה לפני" in the toast, undo of an edit (`prev`
  column), sleep tile / forgotten wake-up / overlap warning, the baby's sex with matching wording, "הנקה הבאה" tag, toast timings,
  the wake-up offer as its own row in the toast, and a sync log.
- Fourth session (details in `CHANGELOG.md`): two sync logs read; "changes since your version" (API 0.5.0: a phone a little
  behind gets only the changes, no sheet opened); re-sent entries and "היה לפני" moves no longer search the whole sheet; no second
  full list after a return; toast: one second of feedback after a used button, 3 s (5 s asleep), a tap shield when it goes;
  medicines: quiet dashed button when everything due today is given, a faded icon per medicine given, a ✓ in the window, and
  "היה לפני" / "בטל" under a marked medicine in the window; History "24 שעות אחרונות"; feedback in the app (🐞); Siri in Hebrew
  and English (two shortcut sets, an asking shortcut, "which side next"), with two fixes to `sign.sh` found on the owner's Mac.

## Where we are (open items with the owner)
1. **Siri**: the owner created the 58 signed shortcuts on the Mac (a local Claude session on the Mac ran `sign.sh`; Remote
   Control is blocked by the owner's organisation). Not yet tried on the phones. Next: the owner AirDrops English (his phone)
   and עברית (the other parent's), tries them open and locked, and reports: what worked, seconds until Siri answers, whether Face
   ID was needed, whether Hebrew names were recognised the first time. Not verified on a real iPhone yet: Show Result spoken by
   Siri, the asking shortcut answered by voice in Hebrew, network from a locked phone. More phrasings later: duplicate and rename
   on the phone, or add them to `scripts/shortcuts/builder.ts` (then run `sign.sh` again). Lessons from the Mac: Google answers a
   POST with a redirect that takes only GET (no `curl -X POST`); `shortcuts sign` needs the `.shortcut` extension.
2. **Slow catching up after opening**: done. Second log: openings with news 2.3 to 2.5 s, server part 0.0. What remains (1.5 to
   2.5 s) is the phone's network waking plus Google's routing. Options kept for later only if the owner asks: a second request
   when the first is slow; a read copy outside Google or leaving Apps Script (a third party would hold the data).
   The sync log: Settings > מתקדם > "יומן סנכרון" > "העתקה" (last 60 exchanges; copy soon after a slow opening).
3. **Feedback** in the app (Settings > מתקדם > "🐞 משוב"; the sheet's "משוב" tab; numbers never reused). Manual: the owner pastes
   the list when he wants; do not ask for it. Item #1 (History 24 hours) is done; the owner clears the list himself.
4. A tap that went through a disappearing toast (fixed with a tap shield); the "could not get back" part was never reproduced:
   ask for a screenshot if it happens again.
5. **Other families** (owner): live. One server per family (`MULTI_FAMILY_PLAN.md` section 0); the first family is in
   `families.json` (November 2026): created by the pipeline, the owner ran `setup`, the deploy reports "answers from this build",
   and the owner sent the family its code. Next: hear how it goes for them; their feedback reaches the owner's phone through the
   admin code ("משפחות נוספות"). Adding another: `INSTALL.he.md` "משפחה נוספת". Before the owner's `setup`, Google answers a
   new family server with a plain HTTP 403: the deploy reports it as "waiting for the owner's setup".
6. Smaller: which insight cards get used (F8). (The status bar after a day/night change: confirmed working by the owner.)
7. Fixes session (parallel): deleting only a wake-up ("מחיקת ההתעוררות") and the date of birth built. Open with the owner:
   F15 usage measurement option A built; F16 questions built (stages A and B, 14 questions; privacy page wording approved and live); F17 visit journal: researched twice, proposal written,
   parked at low priority (open decisions in `BACKLOG.md`). **For the families session:** F15 option B (reading every family's usage in the app with the admin code,
   `BACKLOG.md`): ask the owner about it; not built.

## How to resume (first 10 minutes in a new session)
1. Attach the repository with push access (`add_repo`), clone it, `npm ci` (Chromium and Playwright are preinstalled in the sandbox).
2. `git config user.name Claude && git config user.email noreply@anthropic.com`
   `git config remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*' && git fetch origin` (otherwise a session hook mis-counts unpushed commits).
3. Read `docs/CHANGELOG.md`, `docs/ARCHITECTURE.md` and `docs/BACKLOG.md`. Run `npm test`, `npm run typecheck`, `npm run build && npx playwright test --trace off`.
4. Check the latest pipeline results: `scripts/read-ci.sh` (test | server | pages). Trust a report only if its `sha` equals `git rev-parse --short=7 HEAD`;
   better, find a commit's own reports on `ci-status` (see the rule below).
5. Work on `dev`; commit with the attribution trailers the session asks for; `git push origin HEAD:refs/heads/dev`; then run
   `bash scripts/ship.sh <sha7>` in the background: it waits for BOTH `dev` reports to be "success", only then pushes the same commit
   to `main`, waits for the `main` test, server and prod reports and for the live site to serve the commit, and prints the
   "LIVE TEST PASSED" and "prod server deployed" lines, then waits for the family servers (job `families`) and prints one line
   per family. It stops at the first failure without going further.

## Environment and secrets (what lives where)
- GitHub repository secrets (readable only by Actions): `CLASPRC_JSON` (Google credential for clasp, personal account), `PRIVACY_DENYLIST` (forbidden words).
- Each Apps Script project has script properties `API_KEY` (shared secret) and `REV` (data revision). `ci-status` branch: `reports/*.json`
  (sanitized pipeline results) and `envs/{test,prod}.json` (script ids). `gh-pages` branch is generated: never edit it.
- Sandbox limits: the GitHub Actions/Pages API paths are blocked (use `scripts/read-ci.sh` and the live site); foreground commands stop at 5 minutes,
  so wait for CI with short polling loops (CI takes about 8 minutes: tests, slow e2e, deploys); the environment's network policy must allow Google
  and GitHub Pages hosts (the owner enabled it).
- Force-push is blocked by the environment and was not approved. A local-only branch from an earlier session (`dev-reauthored`) is gone with that sandbox; ignore it.

## Owner-only actions (status)
- Done: GitHub Pages enabled; `setup` run in both Apps Script projects; production key rotated once (`rotateKey`) and a working `/exec` setup code used;
  app installed on the owner's phone and used daily.
- Pending / optional: install on the second parent's phone (send the setup code privately, never in a group chat; names are prefilled);
  share the sheet (Viewer) with the second parent's Google account only if they want to read it or use their AI assistant on it;
  optionally run `rotateKey` once more when everything works (the setup code was pasted into a chat during setup), then reinstall the code on both phones.
- Siri shortcuts: signed on the MacBook (done); AirDrop each parent the folder of their Siri language (owner English, the other parent Hebrew), then delete the folder from the Mac.

## Rules and lessons (each came from a real bug; details in ARCHITECTURE.md)
- Never define a component inside a component; never use vh/dvh; Home must never be scrollable; each tab has its own scroll container.
- When a trigger can arrive during work in progress, queue it; do not drop it.
- Apps Script: entry points must be top-level `function` declarations; never print the editor `/dev` address in a setup code.
- Push to `main` only when BOTH the `dev` test report AND the `dev` server report are "success" (check the status field, not only
  that the reports exist); stop at the first failure.
- When breaking a fix on purpose to prove a test, check that the build still compiles: a failed build leaves the previous
  build in place and the test "passes" against it.
- A browser test must wait for the state it means, not for a text that is also shown one step earlier (the beacon test went on
  at "1 waiting", which is shown while the request is still on its way; it failed only in CI).
- A passing "does not move" test proves nothing until the drag helper is shown to move something (raw CDP touch events work; synthesized touch gestures do not).
- After pushing to `main`, check that the `prod` report says "prod server deployed" (the site can be published while the
  server job failed: pages wait only for the tests; production waits for tests AND the live test).
- Never push to `dev` while a `main` run is still going (or the other way round) unless you must: the server jobs now queue
  (`concurrency: test-server`), but only one can wait; a third push cancels the waiting one.
- Run one Playwright run at a time: inside a run the workers have their own mock servers (ports 8787-8790), but two runs would
  share them and reset each other.
- Test new behavior at several phone heights (852, 700, 560) and against `MOCK_DELAY=250`.
- `dev` and `main` runs write the same report files on `ci-status`, so the current file may belong to the other branch. Find a commit's
  report by its own commit on `ci-status` (`git log origin/ci-status --format='%h %s' | grep "report: server <sha>"`, then
  `git show <that>:reports/server.json`) and wait for the `dev` test AND server reports before pushing to `main`.

## Sessions in parallel (owner, November 2026)
The owner may run up to three sessions at once, each with its own topic: **other families** (`MULTI_FAMILY_PLAN.md`), **small
fixes and features**, and **performance** (the owner pastes the sync log; `REFACTOR_PLAN.md` is its history). All push to the
same `dev` and `main` and share one pipeline, so:
- Ownership:
  - families session: `families.json`, `scripts/families.ts`, `scripts/deploy-families.ts`, the `families` job, the family-server
    parts (`--family`, `familyServer` / `checkAdmin` in `core.ts`, `ADMIN_KEY` in `gas.ts`, "משפחות נוספות" in `Feedback.tsx`,
    `src/app/families.ts`), `MULTI_FAMILY_PLAN.md`.
  - performance session: the sync path and its measurement: `src/app/engine.ts` (sync, polling, queue, beacon), `src/app/api.ts`,
    `src/server/journal.ts`, the request / properties / sheet-reading parts of `src/server/gas.ts` and the `sync` / `list` paths of
    `src/server/core.ts`, `SyncLog.tsx`, the `TIMING` part of `scripts/live-test.ts`, `REFACTOR_PLAN.md`.
  - features session: everything else in the app (screens, insights, medicines, wording, styles).
  A session that needs another one's files tells the owner first.
  - Coordination note (features session, owner approved, 26 Nov 2026): F18 bottles adds an event type for bottles with an
    amount in ml, appended as a new last column of the Events sheet (rows from older versions still read), so it touches the
    event row read / write in `gas.ts`, `protocol.ts` and the event validation in `core.ts`; feeding "episodes" (a bottle within
    the merge window of a nursing is one feeding) change the feed counts used by the insights. Performance session: please take
    the column into account in any reading optimisation. A change that touches the server API (`protocol.ts`) or the
  pipeline, or that could slow the owner's own app, is said in the report to the owner.
- Before every push: `git fetch origin` and merge `origin/dev` into your work (never force-push, never rebase pushed commits);
  rerun the tests if the merge brought changes. Conflicts in `CHANGELOG.md` / `PROGRESS.md`: keep both sides.
- One pipeline run at a time: before pushing, check that the newest commits of `origin/dev` and `origin/main` already have their
  reports on `ci-status` (`git log origin/ci-status --format='%h %s' | grep <sha7>`: test and server for `dev`; test, server,
  prod and families for `main`). If one is missing, another session's run is still going: wait, then fetch and merge again.
- `ship.sh` pushes the given commit to `main`: run it only for a commit that contains `origin/main` (otherwise the push is refused,
  and that is correct: fetch, merge, push to `dev` again).
- A server whose bundle did not change is not deployed again (Apps Script keeps only 200 versions a script; `deploy-skip.ts`):
  reports then say "unchanged since <sha>", which is fine. If a deploy ever fails with "limit of 200 versions", the owner deletes
  old versions in that project's history by hand.

## Open risks (cannot be tested in the sandbox)
- Whether `shortcuts sign` accepts the generated files and iOS imports them (only simulated). Whether a network shortcut runs on a locked phone.
- Whether Gemini can read a sheet shared from another account. Behavior of the system date/time pickers on every iOS version (they follow the phone's language).
- The iOS 26 status bar tint (sampled from the page) cannot be reproduced in Chromium; the owner confirms on the phone.
- iOS elastic scrolling cannot be reproduced in Chromium; the fix removes the scrollable area on Home instead.

## Resume prompt (paste into a new session with the repository attached)
```
You are continuing BabyLog, a shared baby-tracking PWA for two parents (Hebrew, RTL). It is live and in daily use on two iPhones. The repository is attached.

First read, in this order: docs/PROGRESS.md (handoff: status, the open topic, how to resume, environment, owner-only steps, rules), docs/BACKLOG.md, docs/CHANGELOG.md (every change so far and why), docs/ARCHITECTURE.md (design as built, UI rules, deployment, tests), docs/MULTI_FAMILY_PLAN.md (opening the app to other families: the plan and its open decisions), and docs/REFACTOR_PLAN.md (the sync refactor and its measurements). Then follow "How to resume" in PROGRESS.md: git identity and fetch refspec, npm ci, unit and browser tests, pipeline status (a commit's own reports on the ci-status branch).

Then tell me briefly in Hebrew whether everything is green (or what is not), and what is open, in a few lines.

Feedback: do not ask for it. I may paste the feedback list from the app (Settings > מתקדם > משוב > העתקה); show it to me and let me decide what to act on. Recognise items already seen by their #number.

Open topics are listed in PROGRESS.md "Where we are". Usually I come with feedback from daily use (bugs, ideas, the feedback list, a sync log, Siri results); handle what I bring, and for anything new propose first.

Standing approvals: push to dev and main, deploy to GitHub Pages, deploy the Apps Script servers through GitHub Actions with the stored credential.
Not approved: force-push or rewriting history; changing repository settings, secrets or collaborators.

Hard rules:
- The repository is public. Never write names, e-mail addresses, device models, the baby's name, keys, script or deployment ids, or the live server address into code, docs, commit messages or logs (screenshots I send may show real names: never copy them anywhere).
- Every change: small step -> a regression test that fails without the fix (break the fix once to prove it, and check that the broken build still compiles) -> unit and browser tests locally (one Playwright run at a time; also with MOCK_DELAY=250 for anything timing-related, and at heights 852/700/560 for layout) -> push to dev -> run `bash scripts/ship.sh <sha7>` in the background (it waits for BOTH dev reports to be green before main, then for main, production and the live site, and stops at the first failure) -> confirm the live site serves the commit, the main server report says "LIVE TEST PASSED" and the prod report says "prod server deployed".
- After each change update docs/CHANGELOG.md and docs/PROGRESS.md, docs/ARCHITECTURE.md when the design changes, docs/BACKLOG.md when plans change.
- Keep the UI rules in ARCHITECTURE.md: Home is a fixed, non-scrolling screen; no components defined inside components; no vh/dvh; buttons at least 56px; wording פיפי / קקי / פיפי + קקי; words about the baby come from src/app/words.ts (boy / girl); no in-app calendar; mixed Hebrew/Latin text isolated with <bdi>; ranges written in words, not "a–b"; at night nothing bright at the top (iOS tints the status bar from the page).
- The app gives no medical advice: medicine numbers are only what the parents enter.
- The look stays as it is (own icons and a visual polish were declined); do not propose them again unless I ask.
- When I send a screenshot or a screen recording, study it (extract frames from video) before changing layout code; show me screenshots of what you changed (day, night, and at 560).
- For a new feature: research first, propose (mockups as screenshots of the real app when it is visual), and wait for my decisions before building.

Report to me in Hebrew: what changed, how it was verified, and what I need to do on the phones (usually: close the app fully and reopen; Settings > מתקדם shows the new version).
```
