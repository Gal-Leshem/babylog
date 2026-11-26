---
name: performance
description: BabyLog sync speed, server cost and measurement - the sync engine (queue, polling pace, beacon, delta/journal), the Apps Script request path (properties, lock, sheet reads), the daily Google quota, the sync log and the live test TIMING table, the script cache proposal. Load when the owner pastes a sync log, reports slowness, asks about load or capacity, or before touching engine.ts, api.ts, journal.ts or the request path of gas.ts / core.ts.
---

# Performance

The history and every measurement live in `docs/REFACTOR_PLAN.md` (section 7: the live test's numbers per phase; section 8: one
dated section per sync log the owner pasted). Read the newest parts of both before proposing anything. The design as built:
"Sync engine" in `docs/ARCHITECTURE.md`.

## Owns
- `src/app/engine.ts`
- `src/app/api.ts`
- `src/app/synclog.ts`
- `src/app/update.ts`
- `src/app/screens/SyncLog.tsx`
- `src/server/journal.ts`
- `src/server/gas.ts`
- `src/server/core.ts`
- `scripts/live-test.ts`
- `scripts/mock-server.ts`
- `tests/synclog.test.ts`
- `e2e/pace.spec.ts`
- `e2e/update.spec.ts`
- `docs/REFACTOR_PLAN.md`

Shared: `src/server/core.ts` and `src/server/gas.ts` with families (admin key, `--family`, `usageTotals`); in `src/server/core.ts`
this skill means the `sync` / `list` paths. `src/app/screens/SyncLog.tsx` with features (wording). `SyncMark` in `src/app/App.tsx`,
`src/app/main.tsx` (the update reload) and `countRequest` in `src/app/state.ts` are features files changed with their consent.
`src/shared/quota.ts` belongs to families; its estimate formula comes from here (tell families when the request path changes it).

## Rules that must not break
- One exchange at a time (`Engine.sync`); a request made meanwhile is remembered and runs right after, never dropped. The one
  exception: the regular timer check when the exchange it waited for has just succeeded.
- Every operation has a client id, so a retry or a beacon is always safe; a first attempt travels with `fresh: true`.
- An exchange older than 30 s is dead (iOS freezes requests while asleep); its late answer is ignored by a sequence token.
- Nothing is sent while the app is hidden, except the operations handed to `navigator.sendBeacon` on leaving.
- A new app version never reloads the page while it is on screen (it aborted the return's check: about 2 s an opening).
- Server: all script properties read with ONE call per request (`P()`); taking the lock drops that snapshot, so `REV` and the
  settings version are read fresh under the lock; writes stay exactly as safe as that.
- `REV` moves only on a real write; the journal (`JOURNAL`) stays under 8 KB; anything the journal cannot vouch for gets the full list.
- One Events tab lookup and row count per request (`sheet` in the timing).
- API changes (`src/shared/protocol.ts`) and anything that could slow the owner's own app are told to the owner before shipping.
- Every family server runs the same bundle: a server change reaches all of them; say so in the report.

## The numbers to compare with (update when a new log or table changes them)
- CI live test (no mobile network): a check with nothing new about 0.6 to 0.8 s total, server 25 to 120 ms (one properties
  call); after a foreign write with changes only, the same; with the full list 1.0 to 1.4 s (server 0.3 to 0.7).
- The owner's phone (log 3, 26 Nov): checks 1.0 to 1.8 s (server 0.0 to 0.1): the phone's network floor is about 1.1 s; the first
  request after the phone was idle 0.5 to 1.5 s slower; openings with news 2.3 to 2.5 s (log 2), without news 1.3 to 2.8 s.
- A tap: phone log 3: 2.4 to 5.9 s total, server 1.1 to 4.2 s of which 0.5 to 2.8 s was untimed then (now timed as `sheet`);
  CI after the fix: server 0.8 to 1.3 s, `sheet` (Events tab lookup + row count, where the spreadsheet loads) 0.24 to 0.83 s.
- Daily quota shared by every server (one Google account): 50,000 properties calls. Estimate per server = requests + 2 x
  operations (`src/shared/quota.ts`). Capacity: about 20 to 35 families at 75% (about 10 if heavy users).
- An hour open untouched: about 126 requests (pace: 5 s for 2 minutes after a use, then 15 s, 30 s after 10 minutes, 60 s after 30).
- Script cache stage 0 (`cacheProbe` rows in TIMING): a properties read 8 to 103 ms (about 40), a cache read that hits 5 to 65 ms
  (about 35), a miss 7 to 71, writing three values 42 to 148: no speed change for a check; a write would add about 0.1 s.
- A request that carries entries costs 3 properties calls in all (read, read under the lock, one write of `REV` + journal),
  however many entries; the usage beacon is one request (counted in `sync.requests`).

## Owner decisions in force
- Script cache: stage 0 (measure only, `cacheProbe`) built; recommend stage 1 or not only after the owner's next sync log and the
  first request counts per family ("עומס על השרתים (אתמול)" in the owner's feedback screen). Recommended threshold: more than
  about 10 families planned, or a family above about 2,000 calls a day. Stage 1 = `src/server/gas.ts` only (design and risks in
  `docs/REFACTOR_PLAN.md` section 8, "Proposal: the script cache"), with a fake cache that can evict and fail.
- Pace (owner chose the full option): 5 s for 2 min after open / return / tap, 15 s, 30 s after 10 min untouched, 60 s after 30;
  a touch checks at once when the last check is older than 15 s and brings back 15 s.
- Sync mark (owner): "מתעדכן… · עודכן לאחרונה HH:MM" when the last update is over a minute old; "עדכני לשעה HH:MM" (no dot) while
  the pace is slower than 15 s; one line at 360 x 560, muted colour at night (features' conditions).
- Open, not decided: slowing the 5-minute full list in an untouched app (offered to the owner, no answer yet).
- Options kept for later, only if the owner asks: a second request when the first is slow; a read copy outside Google.
- Docs-only changes go to `dev` without `ship.sh`: every push to `main` is a new app version that the phones reload into.
- The owner wants the final report of each piece of work in Hebrew under the heading "סיכום", apart from progress notes.

## Reading a sync log the owner pasted
Hand it to the `perf-analyst` agent with the newest section 8 of `docs/REFACTOR_PLAN.md` as the baseline; check its numbers
against the log yourself before writing a new dated section 8 entry (what it shows, where the time went, comparison, proposals,
then the owner's decisions).
The next log (first after 26 Nov) should show: the share of "לשונית ושורות" in a tap's server time and whether "לא מדוד" is
gone; no "חזרה · אין חיבור" followed by "פתיחה" after a deploy; "נגיעה במסך" entries; checks 30 / 60 s apart in an untouched app
and no check right after a tap; then the cache recommendation with the request counts.

## Learned (add one line per new trap: what happened -> the rule)
- A return logged "אין חיבור" followed within 2 s by "פתיחה" was the page reloading for a new version, not the network -> check
  the `report: pages` times on `ci-status` before blaming the network.
- A server time far above its timed parts was untimed sheet calls (the spreadsheet loads on the first one) -> time every Google
  call; the log shows the rest as "לא מדוד".
- A check gives up after 10 s, a request with entries after 20 s -> a mock delay of 10 s or more makes checks end "no connection".
- `page.clock.runFor` in one big jump fired a real request's own time limit -> advance in 1 s steps with a short real wait.
- Pausing the page clock before a reload left the sync mark unrendered in the test -> stop the server answering instead.
- The touch check's 0.4 s delay equals the coalescing window -> it also checks that no exchange started since the touch.
- A no-change check is not stored (they come every few seconds) -> its time is stored on leaving, or "עודכן לאחרונה" lies.
- Run the browser suite also with `MOCK_DELAY=250`: timing bugs only show against a slow server.
- A test that slows every request can let a regular check time out first; slow only the requests with entries (`opsDelay` on the mock).
- A test that moves the clock must stop the server answering meanwhile, or a check in between makes the data fresh.
- The mock server must end open connections when it closes (a browser's spare connection held a test 29 s).
- Right after a deploy Google can answer from the previous version: the live test waits for three answers from this build.

## Verify
Engine tests in `tests/engine.test.ts`; the built bundle in the fake Google runtime (`tests/gas.test.ts`, `tests/gas-fake.ts`):
count calls, not only results; browser tests count requests per tap / per open (`/__calls` on the mock). After shipping, the
`TIMING` table in the `main` server report.

Last reviewed: 26 November 2026 (enriched by the performance session's handoff).
