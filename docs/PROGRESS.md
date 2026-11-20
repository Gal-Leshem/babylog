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
- Tests: about 323 unit (Vitest) and 169 browser (Playwright, 4 workers in parallel, each with its own mock server); CI runs the
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
- Fourth session: the owner's sync log read (findings and the recommendation below); "changes since your version" built (API
  0.5.0); the toast closes one second after a used button (with that button lit), the wake-up offer turns into the wake-up
  toast, toast 3 s (5 s while asleep).

## Where we are: slow catching up after opening (fix 1 built; the owner checks the log on the phone)
- The owner sees that the app is sometimes slow to catch up when it is opened, and ONLY when the other parent entered something.
- The sync log (Settings > מתקדם > "יומן סנכרון" > "העתקה"; last 60 exchanges per phone, so copy soon after a slow opening:
  checks every 5 s fill it in a few minutes) was read in the fourth session. Findings (three openings with news, two days):
  - Opening with news: 2.5 to 4.0 s to data on screen. Opening with nothing new: 1.7 to 2.2 s. A check while open: 1.0 to 1.5 s
    (that is Google plus the phone's network: our code takes about 0 ms). The first request after the phone was idle is 0.5 to
    1.5 s slower even when nothing changed (phone network waking, new connections): no server change can remove that.
  - The extra cost of news: the server 0.7 to 1.2 s (only 0.1 s of it is reading rows; the rest is untimed sheet calls in the
    list path: `getSheetByName`, `getLastRow` twice, `getUrl`; the spreadsheet really loads on the first of them, `open` itself
    shows 0) plus a 40 KB answer (the whole 14 days, ~175 events) that travels 0.5 to 1.5 s longer than a tiny one.
  - Not seen: waiting for an earlier frozen request, timeouts, the rare 41 s stall (CI saw it once in Google opening the sheet).
  - Side findings: a "היה לפני" move is an `update` that searches the whole sheet (find 0.4 to 2.6 s; 6.7 s for three ops);
    right after a return that fetched the list a second full list came 3 s later (probably the 5-minute full refresh falling
    due); taps that waited behind a running sync are labelled "בדיקה" in the log instead of "רישום".
- The owner chose fix 1; it is built (API 0.5.0, see `ARCHITECTURE.md` "Changes since your version"). Next: the owner opens the
  app after the other parent logged and copies the sync log: such an opening should say "שינויים בלבד" with a server part near
  0 and a total close to an opening with nothing new. Items 2 (small extras) were approved and built.
- Second log read: openings with news 2.3 to 2.5 s, server part 0.0; re-sent entries no longer search the whole sheet. A
  medicine done for today fades (30%, grey) on the button and shows a ✓ in the window; the title stays "תרופות" (owner).
- Siri commands in Hebrew and English (owner: options A + B; owner's Siri English, the other parent's Hebrew; a MacBook is
  available): built (see BACKLOG F11 and INSTALL.he.md section 4). Waiting for the owner: the 5-minute check on the Hebrew phone
  (locked phone, Hebrew name recognised, how long it takes), then running `sign.sh` on the Mac and AirDrop. Not verified on a
  real iPhone yet: Show Result being spoken by Siri, the menu answered by voice in Hebrew, network from a locked phone.
- Owner bug (toast tap went through to the screen under it) fixed with a tap shield; the "could not get back" part was not
  reproduced: ask for a screenshot if it happens again.
- Recommendation given to the owner (for reference):
  1. **Changes since your version** (main fix, built): the server keeps the last few dozen changed events in script properties (the
     fast store already read on every request; limits 9 KB per value, 500 KB in all); a phone a little behind gets only those
     (a few hundred bytes, no sheet at all); too far behind, unknown revision or anything odd: the full list as today. Expected:
     an opening with news costs about what an opening without news costs (about 1.5 to 2.2 s instead of 2.5 to 4.0). Size M
     (server + engine + tests + live test), risk medium (guarded by the fallback to the full list).
  2. Small extras: look in the tail rows before searching the sheet for an `update` (the "היה לפני" moves); do not fetch the list
     twice right after an opening; label queued taps correctly in the log.
  3. Not recommended now: CacheService (still sends the 40 KB and only saves the 0.1 s read), keeping the server warm (the
     log shows no Google cold start pattern that the phone's own wake-up does not explain), a second request when the first is
     slow (nothing stalled in the log; keep for later), a read copy outside Google or leaving Apps Script (would remove the
     remaining 1 to 1.5 s floor, but a third party holds the data; only if the owner finds the floor itself too slow).
- Other open items with the owner: confirm the status bar follows a day/night change without closing the app (the page reloads
  by itself); which insight cards get used (reshape F8 later).

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
   "LIVE TEST PASSED" and "prod server deployed" lines. It stops at the first failure without going further.

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
- Siri shortcuts (wanted again, November 2026): run `sign.sh` on the MacBook once the build is live, AirDrop each parent the folder of their Siri language (owner English, the other parent Hebrew).

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
- About two dozen browser tests seed "today 00:xx" times, which are in the future during the first hour after midnight (Israel
  time): they fail then, locally and in CI. Run the suite and push outside 00:00-01:10 (or make those tests use yesterday).
- Run one Playwright run at a time: inside a run the workers have their own mock servers (ports 8787-8790), but two runs would
  share them and reset each other.
- Test new behavior at several phone heights (852, 700, 560) and against `MOCK_DELAY=250`.
- `dev` and `main` runs write the same report files on `ci-status`, so the current file may belong to the other branch. Find a commit's
  report by its own commit on `ci-status` (`git log origin/ci-status --format='%h %s' | grep "report: server <sha>"`, then
  `git show <that>:reports/server.json`) and wait for the `dev` test AND server reports before pushing to `main`.

## Open risks (cannot be tested in the sandbox)
- Whether `shortcuts sign` accepts the generated files and iOS imports them (only simulated). Whether a network shortcut runs on a locked phone.
- Whether Gemini can read a sheet shared from another account. Behavior of the system date/time pickers on every iOS version (they follow the phone's language).
- The iOS 26 status bar tint (sampled from the page) cannot be reproduced in Chromium; the owner confirms on the phone.
- iOS elastic scrolling cannot be reproduced in Chromium; the fix removes the scrollable area on Home instead.

## Resume prompt (paste into a new session with the repository attached)
```
You are continuing BabyLog, a shared baby-tracking PWA for two parents (Hebrew, RTL). It is live and in daily use on two iPhones. The repository is attached.

First read, in this order: docs/PROGRESS.md (handoff: status, the open topic, how to resume, environment, owner-only steps, rules), docs/BACKLOG.md, docs/CHANGELOG.md (every change so far and why), docs/ARCHITECTURE.md (design as built, UI rules, deployment, tests), and docs/REFACTOR_PLAN.md (the sync refactor and its measurements). Then follow "How to resume" in PROGRESS.md: git identity and fetch refspec, npm ci, unit and browser tests, pipeline status (a commit's own reports on the ci-status branch).

Then tell me briefly in Hebrew whether everything is green (or what is not), and pick up the open topic.

The open topic: the app is sometimes slow to catch up when it is opened, and only when the other parent entered something. I will paste the sync log from the phone (Settings > מתקדם > יומן סנכרון > העתקה). Before that, tell me:
1. Roughly how many log lines, and of which kind (how many openings after the other parent entered something, how many ordinary ones, over how many days and from which phone), you need for the log to be worth analysing, and what exactly to do on the phones to produce them.
2. What you will look at in the log to tell the causes apart (sheet work vs Google start-up and network vs a request that waited for an earlier one).
Then do fresh research for further solutions that may fit (on Apps Script, on the phone side, or a change of where the data lives), besides the two already proposed in PROGRESS.md ("changes since your version" kept in script properties, and CacheService) and the other candidates listed there. Present the options with what each would fix, its cost and its risk, and your recommendation. When I send the log, analyse it and recommend. Build nothing until I decide.

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
- For a new feature: research first, propose, and wait for my decisions before building.

Report to me in Hebrew: what changed, how it was verified, and what I need to do on the phones (usually: close the app fully and reopen; Settings > מתקדם shows the new version).
```
