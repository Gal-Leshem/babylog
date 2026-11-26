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
- `docs/REFACTOR_PLAN.md`

Shared: `src/server/core.ts` and `src/server/gas.ts` with families (admin key, `--family`); in `src/server/core.ts` this skill means
the `sync` / `list` paths. `src/app/screens/SyncLog.tsx` with features (wording).

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
- A check with nothing new: about 0.6 s total, server 25 to 120 ms (one properties call); the phone's network floor 1.0 to 1.8 s.
- A tap: server 1.0 to 3.5 s, the duplicate check and the write are the variable parts.
- Daily quota shared by every server (one Google account): 50,000 properties calls. Estimate per server = requests + 2 x
  operations (`src/shared/quota.ts`). Capacity: about 20 to 35 families at 75% (about 10 if heavy users).
- An hour open untouched: about 126 requests (pace: 5 s for 2 minutes after a use, then 15 s, 30 s after 10 minutes, 60 s after 30).
- Script cache stage 0: a cache read costs about what a properties read costs (8 to 103 ms vs 5 to 65 ms).

## Owner decisions in force
- Script cache: stage 0 (measure only, `cacheProbe`) built; recommend stage 1 or not only after the owner's next sync log and the
  first request counts per family. Stage 1 = `src/server/gas.ts` only, with a fake cache that can evict and fail.
- Options kept for later, only if the owner asks: a second request when the first is slow; a read copy outside Google.

## Reading a sync log the owner pasted
Hand it to the `perf-analyst` agent with the newest section 8 of `docs/REFACTOR_PLAN.md` as the baseline; check its numbers
against the log yourself before writing a new dated section 8 entry (what it shows, where the time went, comparison, proposals,
then the owner's decisions).

## Learned (add one line per new trap: what happened -> the rule)
- Run the browser suite also with `MOCK_DELAY=250`: timing bugs only show against a slow server.
- A test that slows every request can let a regular check time out first; slow only the requests with entries (`opsDelay` on the mock).
- A test that moves the clock must stop the server answering meanwhile, or a check in between makes the data fresh.
- The mock server must end open connections when it closes (a browser's spare connection held a test 29 s).
- Right after a deploy Google can answer from the previous version: the live test waits for three answers from this build.

## Verify
Engine tests in `tests/engine.test.ts`; the built bundle in the fake Google runtime (`tests/gas.test.ts`, `tests/gas-fake.ts`):
count calls, not only results; browser tests count requests per tap / per open (`/__calls` on the mock). After shipping, the
`TIMING` table in the `main` server report.

Last reviewed: 26 November 2026 (skill created from the docs; to be enriched by the performance session's handoff).
