# Handoff: read this first when resuming

Last updated with the commit that contains this file. Keep it short and current; history lives in `CHANGELOG.md`, design in `ARCHITECTURE.md`.
**Privacy rule for this public repo:** never write real names, e-mail addresses, device models, the baby's name, script/deployment ids, keys
or live server addresses into any file, commit message or log.

## What this project is
A shared baby log for two parents: one-tap logging of nursing, diapers, sleep and vitamin D in an installable web app (PWA, Hebrew, RTL),
data in the owner's private Google Sheet, server = Google Apps Script web app, hosting = GitHub Pages, everything deployed by GitHub Actions.

## Status snapshot
- Live: site on GitHub Pages (`version.json` shows the served commit), production + test Apps Script servers deployed by the pipeline.
- Tests: about 222 unit (Vitest) and 109 browser (Playwright); CI runs the browser suite twice (normal and against a slow mock server).
  The CI live test (real Google server, real sheet) reports `LIVE TEST PASSED`.
- `dev` and `main` are identical except while a change is on its way: push to `dev`, wait for green CI, then fast-forward `main`.
- The MVP is complete and in use by the owner. The owner reviews on real iPhones and sends feedback; every change so far came from that.
- What comes next: `docs/BACKLOG.md` (track 1: fixes from the owner's feedback, always first; track 2: features in the order the owner picks).

## How to resume (first 10 minutes in a new session)
1. Attach the repository with push access (`add_repo`), clone it, `npm ci` (Chromium and Playwright are preinstalled in the sandbox).
2. `git config user.name Claude && git config user.email noreply@anthropic.com`
   `git config remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*' && git fetch origin` (otherwise a session hook mis-counts unpushed commits).
3. Read `docs/CHANGELOG.md`, `docs/ARCHITECTURE.md` and `docs/BACKLOG.md`. Run `npm test`, `npm run typecheck`, `npm run build && npx playwright test --trace off`.
4. Check the latest pipeline results: `scripts/read-ci.sh` (test | server | pages). Trust a report only if its `sha` equals `git rev-parse --short=7 HEAD`.
5. Work on `dev`; commit with the attribution trailers the session asks for; `git push origin HEAD:refs/heads/dev`; wait for CI; then push the same
   commit to `main`; confirm `https://<account>.github.io/babylog/version.json` serves it.

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
  share the sheet (Viewer) with the second parent's Google account only if she wants to read it or use her AI assistant on it;
  optionally run `rotateKey` once more when everything works (the setup code was pasted into a chat during setup), then reinstall the code on both phones.
- Not wanted for now: Siri shortcuts via the Mac signing script (`scripts/shortcuts` stays, unused). Fallback: one manual shortcut on the phone.

## Rules and lessons (each came from a real bug; details in ARCHITECTURE.md)
- Never define a component inside a component; never use vh/dvh; Home must never be scrollable; each tab has its own scroll container.
- When a trigger can arrive during work in progress, queue it; do not drop it.
- Apps Script: entry points must be top-level `function` declarations; never print the editor `/dev` address in a setup code.
- A passing "does not move" test proves nothing until the drag helper is shown to move something (raw CDP touch events work; synthesized touch gestures do not).
- After pushing to `main`, check that the `main` server report says "prod server deployed" (the site can be published while the
  server job failed: pages wait only for the tests).
- Run one Playwright run at a time: parallel runs share the mock server and reset each other.
- Test new behavior at several phone heights (852, 700, 560) and against `MOCK_DELAY=250`.
- `dev` and `main` runs write the same report files on `ci-status`, so the current file may belong to the other branch. Find a commit's
  report by its own commit on `ci-status` (`git log origin/ci-status --format='%h %s' | grep "report: server <sha>"`, then
  `git show <that>:reports/server.json`) and wait for the `dev` server report (live test) before pushing to `main`.

## Open risks (cannot be tested in the sandbox)
- Whether `shortcuts sign` accepts the generated files and iOS imports them (only simulated). Whether a network shortcut runs on a locked phone.
- Whether Gemini can read a sheet shared from another account. Behavior of the system date/time pickers on every iOS version (they follow the phone's language).
- The iOS 26 status bar tint (sampled from the page) cannot be reproduced in Chromium; the owner confirms on the phone.
- iOS elastic scrolling cannot be reproduced in Chromium; the fix removes the scrollable area on Home instead.

## Resume prompt (paste into a new session with the repository attached; the same text is in the owner's status document)
```
You are continuing BabyLog, a shared baby-tracking PWA for two parents (Hebrew, RTL). It is live and in daily use. The repository is attached.

First read, in this order: docs/PROGRESS.md (handoff: status, how to resume, environment, owner-only steps, rules), docs/CHANGELOG.md (every change so far and why), docs/ARCHITECTURE.md (design as built, UI rules, deployment, tests). Then follow "How to resume" in PROGRESS.md: git identity and fetch refspec, npm ci, unit and browser tests, pipeline status via scripts/read-ci.sh. Tell me briefly in Hebrew whether everything is green (or what is not), then wait for my next request.

Standing approvals: push to dev and main, deploy to GitHub Pages, deploy the Apps Script servers through GitHub Actions with the stored credential.
Not approved: force-push or rewriting history; changing repository settings, secrets or collaborators.

Hard rules:
- The repository is public. Never write names, e-mail addresses, device models, the baby's name, keys, script or deployment ids, or the live server address into code, docs, commit messages or logs.
- Every change: small step -> a regression test that fails without the fix (break the fix once to prove it) -> unit and browser tests locally (also with MOCK_DELAY=250 for anything timing-related, and at heights 852/700/560 for layout) -> push to dev -> wait for green CI (about 8 minutes; poll in short loops, foreground commands stop at 5 minutes) -> push the same commit to main -> confirm the live site's version.json serves it.
- After each change update docs/CHANGELOG.md and docs/PROGRESS.md, and docs/ARCHITECTURE.md when the design changes.
- Keep the UI rules in ARCHITECTURE.md: Home is a fixed, non-scrolling screen; no components defined inside components; no vh/dvh; buttons at least 56px; wording פיפי / קקי / פיפי + קקי; no in-app calendar.
- When I send a screenshot or a screen recording, study it (extract frames from video) before changing layout code.

Report to me in Hebrew: what changed, how it was verified, and what I need to do on the phones (usually: close the app fully and reopen; Settings shows the new version).
```
