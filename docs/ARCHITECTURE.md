# Architecture

```
 phone (PWA) ──┐                       ┌── Google Sheet "Events / Settings / read-me"
               ├──► Apps Script web app ┤        (owner's private Drive)
 Siri shortcut ┘     (one URL, secret key)
```

## One set of rules, three places
`src/server/core.ts` is the whole API: `log`, `asleep`, `awake`, `update`, `delete`, `restore`, `list`,
`status`, `settings`, `ping`. It works on a `Store` interface:
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

Staying current (the other parent's entries must show up by themselves):
- The server keeps a **data revision** (a script property `REV`, bumped under the lock on every real write; not by reads,
  duplicates, no-ops or rejected writes). `poll` returns only that number, `list` returns the revision it was read at.
- While the app is open and visible it sends a `poll` every 10 s and downloads the list only when the revision differs from
  the one it holds; a full refresh still runs every 60 s (catches edits made by hand in the sheet).
- Coming back to the foreground (visibilitychange, focus, pageshow) or regaining the network triggers an immediate refresh.
- Nothing is sent while the app is hidden (saves battery and Apps Script quota).
- A refresh requested while another is running is remembered and runs right after it (never dropped).
- A refresh older than 30 s is declared dead (iOS can freeze requests while a phone sleeps) and stops blocking new ones;
  its late answer is ignored (sequence token). A refresh answer that raced with a send is discarded.

## Security
Every request carries a secret key (a script property). The web app is anonymous-accessible (Siri cannot sign
in), so the key is the protection. The key and server address travel only inside the "setup code" and into the
shortcut files created locally on the owner's Mac. The test server accepts a key derived in CI.

## Pipeline (`.github/workflows/pipeline.yml`)
Tests, privacy check, build, e2e → deploy test server (clasp) → live test → (main) deploy production server and
publish the site to `gh-pages`. Reports (sanitized) go to the `ci-status` branch because the build sandbox
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
- **Recent list** (`recentRows` in `Home.tsx`): sleeps appear as two moments, "נרדם" and "התעורר"; same-minute rows keep entry order
  (newest entered first). History shows one row per event.
- **Home is a fixed screen.** `.main.fixed` has no scrolling and no overscroll, the button grid shrinks (never scrolls) on short
  screens, and only the recent-events list (last 10, about 3.5 rows visible) scrolls in its own box. iOS let a scrollable Home get dragged
  out of place and stay stuck. Every other tab scrolls normally; each tab has its own scroll container (`key={tab}`).
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
- **Sync:** see "Sync engine" above (poll every 10 s with a data revision, full refresh every 60 s, refresh on resume).

## Server deployment details
- `scripts/deploy-server.ts` creates the sheet and bound script on first run (ids saved on `ci-status:envs/`), pushes the bundle with clasp, and
  keeps ONE web app deployment up to date so the address never changes.
- The bundle embeds the deployment's `/exec` address (`EXEC_URL`, only inside the private Apps Script project). `printInstallCode()` therefore
  prints a working code; `ScriptApp.getService().getUrl()` returns the editor-only `/dev` address and must not be used for codes.
- Entry points (`doPost`, `doGet`, `setup`, `rotateKey`, `printInstallCode`) are emitted as plain top-level functions by the build, because the
  Apps Script editor lists only statically declared functions.
- `REV` (script property) is the data revision used by `poll`. `API_KEY` is the shared secret. Both live only in the script properties.

## Tests (what each layer is for)
- `tests/` (Vitest, ~219): time rules vs ICU, domain logic, server rules, the built Apps Script bundle running in a fake Google runtime
  (`gas-fake.ts`), the sync engine, shortcut files (executed by a small interpreter), the Mac signing script, the privacy guard.
- `e2e/` (Playwright, ~107): real browser at phone size against `scripts/mock-server.ts`; includes raw touch drags (`Input.dispatchTouchEvent`),
  two phones syncing with no manual trigger, offline behavior, night mode, layout at several heights. CI runs the suite twice, the second time
  against a slow server (`MOCK_DELAY`), which finds timing bugs.
- `scripts/live-test.ts` runs against the real deployed TEST server (real Google, real sheet) in CI.
- Habit that found real bugs: after adding a regression test, temporarily break the fix and confirm the test fails.
