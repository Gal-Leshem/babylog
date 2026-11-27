---
name: families
description: BabyLog for other families - one server per family, families.json and the families pipeline job, family builds (--family, admin key, send-only feedback), the owner's "משפחות נוספות" screen, usage totals against the shared quota, privacy page and install texts for families, adding a family. Load when the owner talks about another family, adding or removing one, their feedback or usage, or before touching any file listed below.
---

# Other families

The plan and every decision: `docs/MULTI_FAMILY_PLAN.md` (section 0 is what is built; section 8 the owner's decisions).
Adding a family, the owner's steps: `docs/INSTALL.he.md` ("משפחה נוספת").

## Owns
- `families.json`
- `scripts/families.ts`
- `scripts/deploy-families.ts`
- `src/app/families.ts`
- `src/shared/quota.ts`
- `src/server/core.ts`
- `src/server/gas.ts`
- `src/app/screens/Feedback.tsx`
- `src/app/screens/Privacy.tsx`
- `src/app/screens/Install.tsx`
- `scripts/deploy-server.ts`
- `scripts/build-server.ts`
- `scripts/deploy-skip.ts`
- `scripts/mock-server.ts`
- `.github/workflows/pipeline.yml`
- `scripts/ship.sh`
- `e2e/families.spec.ts`
- `docs/MULTI_FAMILY_PLAN.md`
- `docs/INSTALL.he.md`

Shared: in `src/server/core.ts` / `src/server/gas.ts` this skill means `familyServer`, `checkAdmin`, `ADMIN_KEY`, `usageTotals`
(the request path belongs to performance); in `src/app/screens/Feedback.tsx` the "משפחות נוספות" and "עומס על השרתים" parts
(the rest is features); in `Install.tsx` the install texts, the home-screen hint and the storage warning (`storageWorks` lives in
`src/app/storage.ts`); in `deploy-server.ts` / `build-server.ts` the `family <id>` / `--family` path; in the pipeline the
`families` job and `ship.sh`'s wait for it; in `mock-server.ts` `__control?family=1` and the admin key.

## Rules that must not break (owner's priorities, in order)
1. The owner's own family is not affected at all, performance above all: same code path, address, key and Siri files.
2. Nothing can leak between families: own address, key, sheet, script and lock per family; every script keeps the narrowest
   permission (`spreadsheets.currentonly`). No code ever decides "which family is this".
3. The `families` job runs only after `prod`, in its own concurrency group: a family's deploy never delays or breaks the owner's.
- Family ids are random (`npx tsx scripts/families.ts new`), never names; nothing about a family (name, address, key) in the repo.
- On a family server: no sheet link in any answer; the family's key gets `send_only` for reading feedback; the admin key may only
  `ping`, `feedbackList`, `feedbackClear` (with `ids`), `usageTotals` and `usageDays` (`ADMIN_ACTIONS` in
  `src/server/core.ts`; change this line together with "Owner decisions in force").
- The owner's phone keeps the family servers (label, address, admin key) on the phone only (`bl.families.v1`).
- Every family runs the same bundle as production: a server change for one is a change for all (and for the owner).

## Owner decisions in force
- One server per family (section 0), at most two or three families for now; only the owner invites; free for friends.
- Everything runs on the owner's personal Google account for now (the owner accepted it; a separate account only if it grows).
- Sheets start in the owner's Drive. "Move the sheet to my Drive" (ownership transfer) is wanted later but NOT built yet: build
  it hidden when asked; ownership transfer between two free accounts from a script is untested.
- Families only send feedback; the owner reads and deletes from the owner's phone; no e-mail. The admin section also shows on
  the other parent's phone in the owner's family (owner: fine).
- The admin key may read numbers only: `usageTotals` (requests, operations, phones per day) and, since 27 Nov, `usageDays`
  (every phone's counts and question states per day, F15 option B) with parents as "הורה 1" / "הורה 2" and phones as numbers;
  never names, phone ids or texts. The owner copies all servers' 14 days at once ("העתקת נתוני שימוש").
- Consent checkbox at install: on hold, needs more legal research first (owner, 27 Nov; `docs/BACKLOG.md`).
- "Move the sheet to my Drive": not now, only when a family asks (owner, 27 Nov).
- No family test server: the owner skipped a test family; behaviour is proven by tests, the real creation by the first family.
- Siri for families later (Siri itself is not yet tried on the owner's phones).

## Waiting for the owner (ask, do not build)
- An explicit "קראתי ומסכים/ה" at install for a new family: on hold until the owner's legal research; a lawyer's reading of the
  privacy page before a wider opening.
- A "disabled" state (the pipeline switches a family's server off without deleting its data): offered, not wanted for 2 to 3 families.

## Adding a family, end to end (and where it fails)
1. `npx tsx scripts/families.ts new`, commit, push, ship. The `families` job (main only, after prod) creates "BabyLog <id>" in the
   owner's Drive and reports "waiting for the owner's setup (HTTP 403 ...)". A "rejected (fetch first)" line on `ci-status` there
   is a harmless publish race (it retries); check `envs/family-<id>.json` exists on `ci-status`.
2. The owner runs `setup` once in that script (unverified-app warning, Advanced, Allow). The log prints the family code (`BL1.`)
   and the admin code (`BLA.`, owner only).
3. The sandbox cannot re-run a workflow: the next push to `main` re-checks the server. Before the family gets the code, the
   families line must say "answers from this build" (or "unchanged, answers from build X"). If it still answers 401/403 after
   `setup`: a manual "New deployment" (Web app, Execute as Me, Anyone) in that script, as once for the owner's own server.
4. The owner adds the admin code on his phone; sends the family the ready message from `INSTALL.he.md` and the code separately.
5. The family enters the code in the app opened FROM THE ICON (not in the browser).
Removing: drop the id from `families.json` (no more deploys), the owner deletes the sheet and script from Drive (data gone;
30 days in the trash). An unused server costs nothing (Apps Script runs only on requests).

## Learned (add one line per new trap: what happened -> the rule)
- Before the owner runs `setup` in a new family's script, Google answers with a plain HTTP 403: the deploy reports it as
  "waiting for the owner's setup", not as a failure.
- Apps Script keeps 200 versions a script: an unchanged bundle is not deployed again (`scripts/deploy-skip.ts`); "limit of 200
  versions" means the owner deletes old versions by hand.
- The quota estimate was first written as requests + 3 x operations + 2 per phone and corrected the same day against the
  server with the performance skill's numbers: check such formulas against measured calls before shipping.
- Family browser tests start a second mock server; it must close its connections (see the performance skill).
- A family parent who sent feedback before the screen's list answer arrived saw the owner's "נשלח (#1)" and the list (found only
  against the slow mock) -> on a family server the answer to `feedback` itself carries `sendOnly`; screen modes learnt from one
  answer must also be told by every other answer that can come first.
- A family saw the setup screen on every opening: the code had been entered only in Chrome, and a home-screen app on iPhone has
  its own storage, apart from every browser (and with Safari's "Block All Cookies" it cannot save at all) -> the install screen
  says "enter it in the app from the icon", a blocked phone gets a banner naming the setting, and the family message says it.
  Ask for a screen recording first; it showed the difference at once.
- `decodeAdminCode` / `decodeSetupCode` refuse keys shorter than 8 characters: test keys must be at least that long.
- `usageTotals` shows numbers only from the day after the phones run the counting version (they send whole past days).
- "14 days" of `usageDays` first ended today and so held 13 days of data (phones send only whole past days) -> a usage range
  read from the "שימוש" tab ends yesterday.
- The labels the owner gives families on the phone may be real names, and they head the copied texts ("== label ==") -> never
  copy a pasted feedback or usage text's labels into the repository; write "a family".

## Verify
`tests/families.test.ts`, `tests/quota.test.ts`, the built `--family` bundle in `tests/gas.test.ts`, `e2e/families.spec.ts`.
After shipping: `scripts/ship.sh` prints one line per family ("answers from this build" or "waiting for the owner's setup").

## Open
- First family live (November 2026): hear how it goes; its feedback reaches the owner's phone through the admin code.

Last reviewed: 27 November 2026 (F15 option B built; consent and moving the sheet decided: not now).
