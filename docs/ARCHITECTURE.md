# Architecture

```
 phone (PWA) ──┐                       ┌── Google Sheet "Events / Settings / read-me"
               ├──► Apps Script web app ┤        (owner's private Drive)
 Siri shortcut ┘     (one URL, secret key)
```

## One set of rules, three places
`src/server/core.ts` is the whole API: `log`, `asleep`, `awake`, `update`, `delete`, `restore`, `list`,
`status`, `settings`, `ping`, `poll`, and `sync` (what the app uses: see "Sync engine"). It works on a `Store` interface:
- `SheetStore` (`gas.ts`) in production,
- `MemoryStore` in tests, in the mock server, and **inside the app**.

The app runs the same `handle()` locally on its cached data (`src/app/engine.ts`), so every tap shows
immediately, works offline, and is replayed to the server in order. Siri phrases are produced by the
server (`src/shared/speech.ts`) and only spoken by the shortcuts.

## Data model
One row per event (columns in `src/server/readme.ts`, also written to the sheet's read-me tab for AI
tools). Sleep is one row with start and end. Deletes are soft. Times are Israel time, stored as real
sheet dates. Requests carry a client-generated `id`, which makes retries idempotent.

Medicines (F7, API 0.3.0): every medicine is defined in Settings and kept in the sheet's "Medicines" tab, one readable row each
(`src/shared/medicines.ts`: name, icon, dose amount and unit, schedule daily / times / interval / prn with its numbers, optional course of
X doses / X days / until a date, active or archived; new columns are only ever appended). Vitamin D is the reserved id `vitamin_d`:
added with defaults when the sheet has no row for it (`withVitaminD`: active, once a day, ☀️), then edited like any medicine (schedule
included), can be archived but not removed, and its doses keep the event type `vitamin_d`. They travel inside `settings.medicines`; `settings` with `set.medicines` saves
them one by one by id (so two phones editing different medicines never overwrite each other); a removal is refused once a dose exists
(archive instead). A dose is an event of type `medicine` whose detail is the medicine's id (refused for an unknown id). Settings saved by an
older app or sent by an older server get an empty list (`withDefaults` in the engine). The "קרא אותי" guide is rewritten when the
Medicines tab is first created, so an existing sheet explains the new data without running `setup` again.

## Sync engine
Operations queue in `localStorage`; the view is `server copy + queue replayed`. Refused operations are dropped with a
visible message; connection problems retry with back-off.

One round trip (`sync`, API 0.4.0; plan and reasons in `REFACTOR_PLAN.md`):
- The app talks to the server with ONE request type. `sync` carries the phone's waiting operations (up to 25, in order) and the
  **data revision** the phone holds; the server applies the operations under one lock (one answer each; a refused one does not stop
  the rest, an unexpected failure does) and answers `unchanged` when nobody else wrote since that revision (no data is read at all
  when there were no operations), otherwise the list for the last 14 days. So a tap is one request, a check is one tiny request,
  and the other parent's news arrive in the same request that asked.
- The revision is a script property `REV`, bumped under the lock on every real write (not by reads, duplicates, no-ops or refused
  writes). The phone stores the revision with its copy of the data (`rev` in `bl.state.v1`), so opening the app with nothing new
  is one tiny request.
- The engine runs one exchange at a time (`Engine.sync`). A request made meanwhile is remembered and runs right after (never
  dropped); taps made meanwhile travel together in the next request. An exchange older than 30 s is declared dead (iOS can freeze
  requests while a phone sleeps) and its late answer is ignored (sequence token); what it carried is sent again, which is safe
  because every operation has an id. The answer's events replace the phone's guesses (server time stamps).
- While the app is open and visible: a check every 10 s, a forced full list every 5 minutes (safety net), an immediate check on
  return to the foreground (visibilitychange, focus, pageshow: the several events of one return within 0.4 s count as one) and
  when the network returns. Nothing is sent while the app is hidden.
- First attempt or retry: an operation that leaves the phone for the first time travels with `fresh: true` and is marked `sent`
  in the stored queue before the request goes. For a fresh operation the server skips the whole-sheet id lookup (0.3 to 0.5 s)
  and only checks the recent rows it reads anyway; a retry, Siri and older apps get the full lookup. Within one request a row
  found once is not searched again (`SheetStore.rows`).
- Leaving the app: requests that carry operations use `keepalive`; when the app is hidden or closed with operations that no
  request is carrying, `Engine.leave()` hands them to the browser (`navigator.sendBeacon`). No answer is read: they stay queued
  and the next sync sends them again as retries, recognised by their ids. (Whether iOS always completes these is not testable
  here; the live test proves the server records a write whose answer is never fetched.)
- Older days (History, Summary) are fetched with `list` and merged; a slower answer is dropped if the local copy changed meanwhile.
- A server from before `sync` answers `unknown_action`: the engine then talks the old way for that session (one request per
  operation, `poll`, `list`). The old actions stay on the server for Siri shortcuts and for phones still running an older app.
- Timing: the real server adds `ms` (its own time) to every answer and, with `debug: true`, `t` (milliseconds and calls per kind of
  work: open, read, find, write, settings, props, lock). The app shows the last exchange under Settings > מתקדם; the live test prints
  a `TIMING` table into the server report.

## Security
Every request carries a secret key (a script property). The web app is anonymous-accessible (Siri cannot sign
in), so the key is the protection. The key and server address travel only inside the "setup code" and into the
shortcut files created locally on the owner's Mac. The test server accepts a key derived in CI.

## Pipeline (`.github/workflows/pipeline.yml`)
Tests, privacy check, build, e2e → deploy test server (clasp) → live test → (main) deploy production server and
publish the site to `gh-pages`. The server job runs one at a time across branches (`concurrency: test-server`): `dev` and `main`
share the one test server, and two live tests at once fail each other. Reports (sanitized) go to the `ci-status` branch because the build sandbox
cannot read Actions logs: `scripts/read-ci.sh`.

## Shortcuts
`scripts/shortcuts/builder.ts` generates self-contained shortcut templates with placeholders;
`scripts/shortcuts/sign.sh` (run on a Mac) fills in the owner's address/key/name, converts and signs them.
Tests execute the generated files with a small interpreter (`tests/shortcut-interp.ts`) against the real server logic.

## App structure and UI rules (keep these; each one came from a real bug)
- **Screens** (`src/app/screens`): Home, History, Summary, Settings, plus the Install (first run) screen and the add/edit form (a bottom sheet).
- **Tabs:** tapping the current tab again starts its screen over (`key` = tab + a counter), e.g. back to Settings from the medicines screen.
- **Settings** is split into section cards with an icon and a title (`section()` in `Settings.tsx`): family, medicines, display and
  behaviour, advanced.
- **Medicines on Home** (`Home.tsx`, `MedsWindow.tsx`, `medicineToday` in `src/shared/medicines.ts`): the button and tile follow the
  active medicines (none: neither is shown and the grid drops a row; one: one tap logs it; several: a window to mark doses). Status
  uses only what was given, the gap and the daily count, never clock times. Mixed Hebrew/Latin parts are wrapped in `<bdi>`.
  Before a dose that the parents' limits say "not now" (`doseWarnings`), `ConfirmDose` asks; this is the only extra tap anywhere.
- **Recent list** columns: icon 40px, label, time 48px, name 76px (cut with "…"), so the time never moves with a name.
- **Recent list** (`recentRows` in `Home.tsx`): sleeps appear as two moments, "נרדם" and "התעורר"; same-minute rows keep entry order
  (newest entered first). History shows one row per event.
- **Home is a fixed screen.** `.main.fixed` has no scrolling and no overscroll, the button grid shrinks (never scrolls) on short
  screens, and only the recent-events list (last 10, about 3.5 rows visible) scrolls in its own box. iOS let a scrollable Home get dragged
  out of place and stay stuck. Every other tab scrolls normally; each tab has its own scroll container (`key={tab}`).
- **Status bar colour:** iOS 26 ignores `theme-color` and samples the page: keep `#app` with an explicit background (black at night)
  and nothing bright at the top at night (banners are dark there).
- **Layout units:** `#app` is `position: fixed; inset: 0`; never use `vh`/`dvh` (wrong inside iOS home-screen apps). Content starts
  `--top-gap` (22px) below the top safe area because iOS fades content under the status bar.
- **Never define a component inside another component.** `KindButton` once lived inside `Home`, so every re-render rebuilt all buttons and a
  tap straddling a re-render could be lost. Use plain functions that return JSX, or top-level components.
- **Event icons in lists** (`.ri` recent list, `.hi` history): a 40px column, one line, centred, so one icon and two ("💧💩") line up.
  History's time column (`.ht`) is 112px, one line, centred, so a sleep's range fits.
- **Buttons:** at least 56px tall at any supported screen height; a tap locks all buttons for 1.5 s (double-tap protection) and shows a
  5 s undo toast.
- **Add-after-the-fact form:** quick buttons are "today", "yesterday", "10/15/30 minutes ago", "an hour ago", "two hours ago". The chosen
  "X minutes ago" button stays lit until the time or date is changed by hand. The date is shown in Hebrew ("14 בנובמבר 2026", `DateField.tsx`)
  with the phone's own date input laid invisibly over it, so the system picker opens only when the date is tapped; the app draws no calendar of
  its own (the owner did not want one). The system picker itself uses the phone's language. The time field is the system one.
  A new sleep starts as "still asleep" (the usual case: the baby fell asleep a while ago); if a sleep is already open, the form asks for
  the wake time instead.
- **Wording:** diaper kinds are "פיפי", "קקי", "פיפי + קקי" (`KIND_LABEL` in `labels.ts` is the single source, also used by the summary
  table). The sheet values stay `wet` / `poop` / `both`; Siri phrases are English and unchanged.
- **Night mode** (per phone, `bl.prefs.v1` in local storage): auto (21:00-07:00 or the phone's dark mode) / always / never, and a night
  colour: amber (default) or dim red (`data-tint='red'` on `<html>`). In red, colour emoji are tinted with a CSS filter; every emoji the app
  shows must sit in an element with class `ico`, `hi`, `ti` or `emo` so the tint reaches it. The theme is applied before the first paint
  by an inline script in `index.html` (same rule as `src/app/theme.ts`, checked by `tests/theme.test.ts`); change both together.
- **Summary tab:** a switch between "סיכום" (the day table) and "תובנות" (pattern insights), remembered per phone (`summaryView`).
  Insights are pure functions in `src/shared/insights.ts` over the last 7 full days (today left out): medians and the middle half
  (never means), a minimum amount of data per card (otherwise no card), "after a feed" patterns only when at least 20 points more often
  than chance, night = 19:00-07:00, a long stretch = 3 hours or more. Write ranges in words, never "a–b" (reads backwards in RTL).
  Below the cards: a timeline (`timeline()`, rows 06:00 to 06:00, positioned with `right: %` so time runs right to left) and daily count
  bars (oldest on the right), plain CSS. Pee is a ring (`--pee`), poop a filled dot (`--poop`), "both" the ring with the dot inside: shape, not only colour.
- **Sync:** see "Sync engine" above (one `sync` request; a check every 10 s, a full list every 5 minutes, a check on resume).

## Server deployment details
- `scripts/deploy-server.ts` creates the sheet and bound script on first run (ids saved on `ci-status:envs/`), pushes the bundle with clasp, and
  keeps ONE web app deployment up to date so the address never changes.
- The bundle embeds the deployment's `/exec` address (`EXEC_URL`, only inside the private Apps Script project). `printInstallCode()` therefore
  prints a working code; `ScriptApp.getService().getUrl()` returns the editor-only `/dev` address and must not be used for codes.
- Entry points (`doPost`, `doGet`, `setup`, `rotateKey`, `printInstallCode`) are emitted as plain top-level functions by the build, because the
  Apps Script editor lists only statically declared functions.
- `REV` (script property) is the data revision. `API_KEY` is the shared secret. Both live only in the script properties.
- Calls to Google services are the slow part of a request (measured: properties 20 to 400 ms a call, the settings tabs 0.5 to 2 s),
  so `gas.ts` reads ALL properties with one call per request (`P()`); taking the lock drops that snapshot, so the revision and the
  settings version are always read fresh under the lock. The settings are also kept as a copy in the property `SETTINGS_JSON`,
  valid only for the settings version it was read at (`SETTINGS_REV`, moved by every save), so a reader racing with a save cannot
  leave an old copy behind. The sheet stays the store; settings above 4,000 characters are not copied. A hand edit of the
  Settings / Medicines tabs is taken in by running `setup()` again (the owner does not edit by hand).

## Tests (what each layer is for)
- `tests/` (Vitest, ~260): time rules vs ICU, domain logic, server rules, the built Apps Script bundle running in a fake Google runtime
  (`gas-fake.ts`), the sync engine, shortcut files (executed by a small interpreter), the Mac signing script, the privacy guard.
- `e2e/` (Playwright, ~116): real browser at phone size against `scripts/mock-server.ts`; includes raw touch drags (`Input.dispatchTouchEvent`),
  two phones syncing with no manual trigger, the number and kind of requests per tap / per open (`/__calls` on the mock), an old server, offline behavior, night mode, layout at several heights. CI runs the suite twice, the second time
  against a slow server (`MOCK_DELAY`), which finds timing bugs.
- `scripts/live-test.ts` runs against the real deployed TEST server (real Google, real sheet) in CI.
- Habit that found real bugs: after adding a regression test, temporarily break the fix and confirm the test fails.
