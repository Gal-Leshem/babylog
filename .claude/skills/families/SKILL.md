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
- `docs/MULTI_FAMILY_PLAN.md`
- `docs/INSTALL.he.md`

Shared: in `src/server/core.ts` / `src/server/gas.ts` this skill means `familyServer`, `checkAdmin`, `ADMIN_KEY`, `usageTotals`
(the request path belongs to performance); in `src/app/screens/Feedback.tsx` the "משפחות נוספות" part (the rest is features).

## Rules that must not break (owner's priorities, in order)
1. The owner's own family is not affected at all, performance above all: same code path, address, key and Siri files.
2. Nothing can leak between families: own address, key, sheet, script and lock per family; every script keeps the narrowest
   permission (`spreadsheets.currentonly`). No code ever decides "which family is this".
3. The `families` job runs only after `prod`, in its own concurrency group: a family's deploy never delays or breaks the owner's.
- Family ids are random (`npx tsx scripts/families.ts new`), never names; nothing about a family (name, address, key) in the repo.
- On a family server: no sheet link in any answer; the family's key gets `send_only` for reading feedback; the admin key may only
  `ping`, `feedbackList`, `feedbackClear` (with `ids`) and `usageTotals` (`ADMIN_ACTIONS` in `src/server/core.ts`).
- The owner's phone keeps the family servers (label, address, admin key) on the phone only (`bl.families.v1`).
- Every family runs the same bundle as production: a server change for one is a change for all (and for the owner).

## Owner decisions in force
- One server per family (section 0), at most two or three families for now; only the owner invites; free for friends.
- Sheets start in the owner's Drive; "move the sheet to my Drive" prepared but hidden.
- Families only send feedback; the owner reads and deletes from the owner's phone; no e-mail.
- Siri for families later.

## Waiting for the owner (ask, do not build)
- F15 option B: read every family's usage in the app with the admin code (`ADMIN_ACTIONS` would gain a read of "שימוש").
- An explicit "קראתי ומסכים/ה" at install for a new family, and a lawyer's reading of the privacy page before a wider opening.

## Learned (add one line per new trap: what happened -> the rule)
- Before the owner runs `setup` in a new family's script, Google answers with a plain HTTP 403: the deploy reports it as
  "waiting for the owner's setup", not as a failure.
- Apps Script keeps 200 versions a script: an unchanged bundle is not deployed again (`scripts/deploy-skip.ts`); "limit of 200
  versions" means the owner deletes old versions by hand.
- The quota estimate was first written as requests + 3 x operations + 2 per phone and corrected the same day against the
  server with the performance skill's numbers: check such formulas against measured calls before shipping.
- Family browser tests start a second mock server; it must close its connections (see the performance skill).

## Verify
`tests/families.test.ts`, `tests/quota.test.ts`, the built `--family` bundle in `tests/gas.test.ts`, `e2e/families.spec.ts`.
After shipping: `scripts/ship.sh` prints one line per family ("answers from this build" or "waiting for the owner's setup").

## Open
- First family live (November 2026): hear how it goes; its feedback reaches the owner's phone through the admin code.

Last reviewed: 26 November 2026 (skill created from the docs; to be enriched by the families session's handoff).
