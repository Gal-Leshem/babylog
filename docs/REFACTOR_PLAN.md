# Refactor plan: sync speed, performance, quality of life

Status: **proposal, nothing built yet.** Written from a full read of the code (November 2026) so that any model or person can
implement it phase by phase. Every phase is shippable on its own and follows the normal routine (small step, regression test proven
to fail without the change, unit + browser tests incl. `MOCK_DELAY=250`, dev, green CI, main, live check). Privacy rule as everywhere.

## 1. Diagnosis: where the time goes

The app itself is fast: a tap is applied locally at once (`Engine.dispatch`), the bundle is about 100 KB and precached, the cached
data paints before any network. What feels slow is **the number and the weight of the round trips to Apps Script**. Every request to
an Apps Script web app pays a fixed price (POST, a redirect to another Google host, script start-up): roughly one second or more
before our code does anything. That floor cannot be removed while the server is Apps Script, so the plan is: **fewer requests, and
less sheet work inside each one.** Exact numbers are not known yet (phase 0 measures them on the real server).

Findings, most important first:

| # | Where | What happens today | Cost |
|---|-------|--------------------|------|
| D1 | `engine.ts` `flush()` | Queued operations are sent one request each, in sequence, and **every flush ends with a full `list`** | A single tap = 2 slow requests; 3 offline taps = 4. The "מסנכרן" banner stays for all of it |
| D2 | `engine.ts` `pollOnce()` | `poll` first, then a separate `list` when the revision changed | The other parent's entry costs 2 round trips after a wait of up to 10 s |
| D3 | `engine.ts` `lastRev` | Kept in memory only | Every app start downloads the full 14-day list even when nothing changed |
| D4 | `engine.ts` `start()` / `refresh()` | On open, `start()`, `pageshow` and `focus` all ask for a refresh; on return, `visibilitychange` and `focus`. The second request is remembered (`refreshQueued`) and runs a **second full `list`** right after the first | Every open / return = 2 full lists (the second one useless) |
| D5 | `api.ts` / app lifecycle | A tap followed by locking the phone or leaving the app can kill the request; the operation waits in the queue until the app is opened again | The other parent does not see the entry for minutes or hours. Probably the worst real-life delay |
| D6 | `core.ts` `list` + `gas.ts` `all()` | `list` reads the **whole** Events sheet (every row ever written), then filters by date | Grows every day (about 25 rows a day); already hundreds of milliseconds, seconds within a year |
| D7 | `gas.ts` `deps()` / `SheetStore` | `SpreadsheetApp.getActive()` runs for every request, `poll` included; script properties are read one by one (`API_KEY`, `REV` read twice in `bump`) | `poll` is heavier than it needs to be; a few extra service calls per write |
| D8 | `core.ts` `logEvent` + `gas.ts` | One `log` = TextFinder over the id column (duplicate check) + read of the last 500 rows + (medicine) Settings and Medicines sheets + `appendRow` + `flush` + revision bump | 5 to 8 Google service calls per tap |
| D9 | `core.ts` `list` | Settings (two sheets) and the sheet URL are read on every `list` | Extra service calls on the hottest read |
| D10 | `engine.ts` `compute()` / `setStatus()` | Every status change (idle / syncing) copies all events into a new `MemoryStore` and replays the queue; `persist()` serializes the whole state | Small today (a few hundred events); cheap to avoid |
| D11 | `App.tsx` `Banner` | A coloured strip appears at the top after every tap for as long as D1 lasts, and shifts the whole Home layout down | Makes the app *feel* slow even when the tap was instant |

Not problems (leave alone): bundle size, Preact rendering, the service worker, the local-first design (server rules run on the phone
through the same `handle()`), idempotent ids, the offline queue. The architecture is sound; this is a **targeted refactor of the sync
path**, not a rewrite.

## 2. Target design in one paragraph

One request type, `sync`, does everything a phone needs: it carries the phone's pending operations (zero or more) and the data
revision the phone holds; the server applies the operations under one lock and answers either "nothing else changed" (a few bytes, no
sheet read at all when there were no operations) or the fresh list. The phone persists its revision, sends when leaving the app
(`keepalive`), coalesces duplicate triggers, and polls a little faster because a poll is now cheap. The server opens the spreadsheet
only when it must and reads only the tail of the Events sheet. Expected effect: a tap goes from 2 round trips to 1; opening the app
with nothing new goes from 2 full lists to 1 tiny request; the other parent's entry arrives in 1 round trip after a shorter wait;
`list` stops growing with the sheet. The old actions stay (Siri shortcuts and phones still running an older cached app use them).

## 3. Phases

### Phase 0: measure first (S)
Purpose: real numbers before and after, from the real Google server, without guessing.
- Server (`core.ts` `handle`): add `ms` (server time spent in the request) to every answer. In `gas.ts`, optional finer timings
  (`t: {open, read, write, props}`) collected by a tiny timer in `SheetStore`, returned only when the request has `debug: true`.
- `scripts/live-test.ts`: time each call (total and server `ms`), print a sanitized table: `poll`, `list` (14 days), `log`, `update`,
  cold first call vs warm. No addresses or ids in the output (the report is public).
- App: keep the last 20 sync timings in memory; Settings > מתקדם shows "סנכרון אחרון: 1.4 ש׳ (מתוכן שרת 0.5)". Helps the owner report.
- Acceptance: the `dev` server report contains the timing table. Record the numbers in `CHANGELOG.md` as the baseline.
- Decide from the numbers: if server `ms` is small next to the total, the floor dominates and phase 1 matters most (fewer requests);
  if `list` or `log` server time is large, phase 2 matters as much.

### Phase 1: one round trip (`sync` action) (M) — the biggest win
Protocol (`src/shared/protocol.ts`, API 0.4.0):
```
request : { action: 'sync', rev?: string, from: string, to: string, ops?: ApiRequest[] }   // ops: write actions only, max 25
response: { ok: true, rev, serverNow, ms,
            results?: ApiResponse[],          // one per op, same order; stops after the first server_error
            unchanged?: true }                // OR: events, settings, sheetUrl (exactly what `list` returns)
```
Server (`core.ts`):
- Split today's write actions into a lock-free inner function `applyWrite(o, deps, now): ApiResponse` (log, asleep, awake, update,
  delete, restore, settings-set); `write()` and the `settings` case keep wrapping it for the old single actions.
- `sync`: when `ops` is non-empty, take the lock once; read `revBefore`; run each op through `applyWrite` inside its own try/catch
  (a refused op gives its error result and the loop continues, exactly like today's client loop; an unexpected exception gives
  `server_error` for that op and stops); bump the revision once per op that changed something (one property write: `REV += n`).
  Reject anything in `ops` that is not a write action (`bad_request`).
- Without ops: `revBefore = revAfter = store.revision()` and **nothing else is touched**.
- If `rev === revBefore` (nobody else wrote since the phone's copy): answer `unchanged: true` with `rev: revAfter` and the results.
  Otherwise answer the list for `from..to` (reuse the `list` code; read the revision before the data, as today).
- Per-request memo (wrapper around any `Store`, used by `sync`): the tail rows are read once and kept current as the ops append or
  replace, settings are read once. Three ops then cost one read and three writes instead of three of everything.
Client (`engine.ts`):
- `Persisted` gains `rev: string | null` (optional field, no storage-key change); drop the memory-only `lastRev`.
- Replace `flush()` + `refresh()` + `pollOnce()` by one `sync()` with one in-flight request and a "run again" flag (the existing rule:
  a trigger that arrives during work is queued, never dropped). It sends up to 25 queued ops (mark them `sent` in the persisted queue
  before the request leaves; see phase 3) plus `rev` and the default range.
- Applying the answer: for each result in order: ok → put `result.event` (or `result.settings`) into the server copy and drop the op;
  permanent refusal → drop the op and set `lastError` (as today); `server_error` / missing result → keep it and schedule a retry.
  Then `unchanged` → done, no list; otherwise `merge(range, events)`, settings, sheet URL. Save `rev`. Keep the stale-answer
  guards (sequence token, 30 s dead-request rule) and discard list data if new ops were queued meanwhile (but still drop the acked ops).
- `undo()`: an op is "in flight" if its id is in the current request; unchanged otherwise.
- `ensureRange()` (History / Summary for older days) keeps using `list`.
- Fallback: an answer `unknown_action` to `sync` (new app, old server: the site can publish while a server deploy failed) switches
  this session to the old path. Keep the old path in a small `legacy.ts` until both servers have run 0.4.0 for a while, then delete.
- `MedsWindow` open and "סנכרון עכשיו" call `sync()`.
Mock server and tests:
- `scripts/mock-server.ts` needs nothing new (same `handle`); `/__calls` already lists actions.
- Unit (`tests/server.test.ts`, `tests/engine.test.ts`): batch order and per-op results; a refused op in the middle; duplicate ids in
  a re-sent batch write nothing twice; `unchanged` only when the revision matches; one bump per changed op; answer lost after the
  server applied the batch → re-send is all duplicates and converges; old-server fallback.
- Browser: one tap → exactly one `sync` and no `list` (`/__calls`); three offline taps → one `sync` when back online; two phones:
  the second sees the entry after one request; everything again with `MOCK_DELAY=250`.
- Live test: `sync` with ops, `sync` unchanged, `sync` after a foreign write.
- Acceptance: a tap = 1 request; a poll with nothing new = 1 request with no spreadsheet access; timing table improved vs phase 0.

### Phase 2: a cheaper server (S to M)
All in `gas.ts` unless noted; each item is independent, order by what phase 0 showed.
1. **Lazy spreadsheet:** `SheetStore.ss` becomes a getter that calls `SpreadsheetApp.getActive()` on first use. `poll`, `ping` and an
   unchanged `sync` never open the sheet. Test in `tests/gas-bundle.test.ts` with a counter in `gas-fake.ts` (fails today).
2. **Properties once:** read `API_KEY` and `REV` with one `getProperties()` per request; `bump(n)` writes once using the value read
   under the lock.
3. **Tail read for `list` / `sync`:** rows are appended in creation order, and an event inside the last 14 days was created inside
   the last 14 days, so it sits in the tail. Read the last 1,500 rows (`recent`); if the oldest row read was *created* on or after
   `from`, or the request is for an older range, fall back to `all()`. Open sleep: keep "the open sleep is always returned" by also
   checking the tail only (an open sleep older than the tail is not realistic; fall back to `all()` when the tail has none and the
   sheet is longer). Guard against a hand-sorted sheet: if `created` is not ascending across the tail's first and last rows, use
   `all()`. Unit test with a 5,000-row fake sheet counting cells read.
4. **Duplicate check without TextFinder on a first attempt:** the client marks an op `retry: true` when it may have been sent before
   (phase 3 `sent` flag). Server: look for the id in the tail rows already read; call TextFinder only when `retry` is true and the
   tail has no match, and for `update` / `delete` of an id outside the tail. A first attempt of a fresh UUID cannot be a duplicate.
   Old single actions (Siri) keep today's behaviour.
5. **Settings only when needed:** in the list path, read Settings / Medicines once per request (memo from phase 1). Optional, only if
   phase 0 shows they matter: cache the serialized settings in `CacheService` under the revision.
6. **Manual edits in the sheet:** add a simple `onEdit` trigger (top-level function, emitted like the other entry points) that bumps
   `REV`, so hand edits reach the phones through the normal poll. Until the owner confirms on the real sheet that a hand edit shows
   up by itself, keep a forced full sync (no `rev`) every 60 s; afterwards relax it to every 5 minutes as a safety net.
7. Optional, only if `list` is still slow after 3: cache the serialized answer in `CacheService` keyed by revision and range (value
   limit 100 KB: store at most the 14-day window, skip caching when larger).
- Acceptance: live timing table: `poll` / unchanged `sync` server time near zero; `list` server time independent of sheet length.

### Phase 3: never leave a tap behind, fewer wasted requests (S)
Client only (`engine.ts`, `api.ts`).
1. **Send while leaving:** `callApi` uses `keepalive: true` for requests that carry ops (bodies are far below the 64 KB limit). On
   `visibilitychange → hidden` and `pagehide`, if the queue is non-empty and nothing is in flight, send the batch with
   `navigator.sendBeacon` (a `text/plain` Blob; the write happens on the first hop, the answer is not needed) and mark the ops
   `sent`. They stay queued; the next `sync` re-sends them with `retry: true` and the server answers "duplicate". Unit test with a
   fake beacon; browser test: tap, hide the page at once (CDP `Page.setWebLifecycleState` / visibility emulation), the server has
   the row without the app being reopened.
2. **Coalesce triggers:** `start()` funnels online / focus / pageshow / visibilitychange / the first call into one `requestSync()`
   that ignores a trigger arriving within 1.5 s of the start of a running or just-finished sync of the same kind (still queue it
   when the running one is older than that). Browser test: opening the app makes exactly one request (today two `list`).
3. **Adaptive polling:** 5 s during the first 2 minutes after the app becomes visible or after any tap, then 15 s. A poll is the
   cheap unchanged `sync` from phase 1. Constants next to `POLL_MS`; unit test with the fake timer.
4. **Retry hygiene:** after `offline`, retry on the `online` event at once (already) and keep the back-off list; add jitter of up
   to 20% so two phones do not hit the lock together.
- Acceptance: tap + immediate lock still reaches the other phone; one request per open; `autosync.spec.ts` green with `MOCK_DELAY`.

### Phase 4: client housekeeping (S)
1. `compute()`: cache the data part (`events`, `allEvents`, `settings`) and rebuild it only when `serverEvents`, `settings` or the
   queue changed; a status change only swaps the small fields. Keep object identity stable so screens can memoize.
2. `useMemo` in `Insights.tsx` (cards, timeline, daily counts keyed by `events` and the day) and `Home.tsx` (`recentRows`).
3. App update: `main.tsx` reloads as soon as a new service worker takes over; reload only when the page is hidden or no form /
   window is open (a reload in the middle of typing a note loses it).
4. No code splitting, no state library, no change of framework: nothing to gain at this size.

### Phase 5: quality of life and look (M; **owner decisions first**, mock screenshots before building)
Proposals, each independent. UI rules in `ARCHITECTURE.md` stay (fixed Home, 56 px buttons, no vh, nothing bright at the top at night).
- Q1 **Quiet sync indicator instead of the banner (fixes D11):** a small mark in a fixed place (a dot beside the Home title or on the
  tab bar): none = in sync, a thin ring = sending, a warning mark = offline / waiting. The strip appears only for offline, errors, or
  operations waiting more than about 8 s. Home no longer jumps after every tap. Tapping the mark syncs now and shows "עודכן ב-HH:MM".
- Q2 **Freshness on open:** until the first sync after opening finishes, a discreet "מתעדכן…" beside the tiles; if the last
  successful sync is older than 2 minutes and the phone is offline, tiles say "נכון ל-HH:MM". Removes the doubt "is this current?".
- Q3 **The other parent's new entries stand out:** a row that arrived from the other phone glows briefly in the recent list;
  optionally a short toast ("<name>: הנקה שמאל 03:10"). Pairs well with backlog F1 (double-entry guard).
- Q4 **Tap lock:** today any tap disables every button for 1.5 s. Proposal: 1.5 s for the same button, about 0.4 s for the others,
  so "פיפי" then "נרדם" does not feel blocked. Double-tap protection stays where it matters.
- Q5 **Visual refresh** (two directions to be shown as screenshots, owner picks or declines):
  (a) *polish only*: one spacing / radius / type scale as CSS variables, tabular digits for times, clearer hierarchy in the tiles
  (value larger, label quieter), pressed state with a short scale animation, softer cards (tone difference instead of outlines),
  sheet and toast transitions, `prefers-reduced-motion` respected;
  (b) *a* plus *own icon set*: inline SVG icons instead of emoji for the fixed actions (feed sides, diapers, sleep, tabs); they
  take the theme colour by themselves, which removes the red-theme CSS filter hack and looks the same on every iOS version.
  Medicines keep their emoji palette (the owner chose it).
  System font stays (no font download); no UI library.
- Q6 Small: tab switch and bottom-sheet transitions (View Transitions where supported), remember the History filter per session.

### Out of scope / alternatives considered
- **Leaving Apps Script** (for example a small edge worker with a database and live push, the sheet as an export): would bring
  sub-second sync and true live updates, but adds a second service with its own account and secrets, moves the data's home out of
  the owner's sheet, and rewrites the deployment. Not proposed now; revisit only if, after phases 1 to 3, the one-second floor per
  request is still a daily annoyance. Owner decision.
- Web push between phones (backlog F13) needs that kind of server as well.
- Rewriting the engine or changing the data model: not needed; the fixes above are local.

## 4. Order, size, risk

| Phase | Size | Risk | Why this order |
|-------|------|------|----------------|
| 0 measure | S | none | Baseline; tells which of 1 / 2 pays most |
| 1 `sync` | M | medium (core of the sync path; mitigated by the unit suite, the slow-server browser run, the live test and the legacy fallback) | Halves the requests for the common cases |
| 3 keepalive, coalesce, polling | S | low | Biggest real-life delay (D5); needs the `sent` flag from 1 |
| 2 server costs | S-M | low to medium (tail read assumptions; guarded by fallbacks to the full read) | Makes each remaining request cheaper |
| 4 housekeeping | S | low | Small, safe |
| 5 QoL / look | M | low (visual; needs owner review on the phones) | After the owner's decisions |

Deployment note for phases 1 and 2: server and site ship from the same commit, but phones keep the old cached app for a while and
the site can publish even when the server job failed. So: the new server must keep serving every old action, and the new app must
work against the old server (fallback). Check both directions in the browser suite (a mock flag that hides `sync`).

## 5. Owner's answers (November 2026) and what is still open
1. All three hurt; the worst is **opening the app after the other parent logged something** and waiting for it to catch up.
   Consequence: the open path is the first target. Within phase 1 build the no-ops `sync` (open / poll) first, then batching of
   ops; do item 3.2 (one request per open) together with phase 1, and items 2.1 and 2.3 (lazy sheet, tail read) right after.
2. The sheet is never edited by hand. Consequence: skip item 2.6 (`onEdit`); relax the forced full sync to every 5 minutes as soon
   as phase 1 is live.
3. Server: **stay on Apps Script for now**; a move to another server is decided later, after measuring (section 6 is
   background only). **Scope (owner): the maximal plan on the current server.** Everything in phases 0 to 5 is in scope,
   including the items marked optional (server-side caching 2.5 and 2.7, detailed timings, adaptive polling, retry jitter, client
   housekeeping, transitions). Only item 2.6 is dropped (answer 2). Order: phase 0 → phase 1 (open path first) with 3.2 → rest of
   phase 3 → all of phase 2 → phase 4 → phase 5; measure after each phase and record the numbers in `CHANGELOG.md`.
4. Look: direction (b), polish plus an own icon set. Still to confirm: Q1 to Q4 and Q6 (assumed wanted unless the owner says no;
   show screenshots before shipping each).

## 6. What a move to a second server would mean (answer to the owner's question; not planned)
- **What it is:** a small always-on API close to the phones (for example an edge worker with a small SQL database, or a hosted
  realtime database), with a live channel so an entry appears on the other phone within about a second while the app is open.
- **Speed:** a request in roughly 0.1 to 0.3 s instead of one to several seconds; opening the app catches up almost at once.
- **Running cost:** the free tiers of the common providers cover two phones many times over; expected cost zero. The risk is not
  money but dependence on one more provider's terms and free-tier limits.
- **Development:** large (several sessions). The server rules (`core.ts` over the `Store` interface) and the app's engine carry
  over; new work: a database `Store`, a deploy job and secrets for the new provider, a one-time copy of the existing rows, a live
  channel in the app, a one-way export so the Google Sheet stays readable (it would lag by minutes), new setup codes on both
  phones, the live test and docs. Siri shortcut files would need the new address.
- **What changes for the owner:** an account at the provider and one token stored as a repository secret (owner-only steps); the
  data's home is no longer only the private sheet: the baby's log sits with a third party (encrypted in transit, protected by the
  same shared key); the sheet becomes a copy. Two places can now fail instead of one.
- **Recommendation:** not now. Phases 0 to 3 are needed for any server (they fix the app's side) and are expected to bring opening
  the app to one light request. Measure after them; move only if the remaining wait is still a daily annoyance. Thanks to the
  `Store` interface the move does not get harder by waiting.
