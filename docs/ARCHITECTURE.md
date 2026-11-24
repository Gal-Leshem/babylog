# Architecture

```
 phone (PWA) ──┐                       ┌── Google Sheet "Events / Settings / read-me"
               ├──► Apps Script web app ┤        (owner's private Drive)
 Siri shortcut ┘     (one URL, secret key)
```

## One set of rules, three places
`src/server/core.ts` is the whole API: `log`, `asleep`, `awake`, `update`, `delete`, `restore`, `list`,
`status`, `next` (Siri: which side next), `settings`, `ping`, `poll`, and `sync` (what the app uses: see "Sync engine"). It works on a `Store` interface:
- `SheetStore` (`gas.ts`) in production,
- `MemoryStore` in tests, in the mock server, and **inside the app**.

The app runs the same `handle()` locally on its cached data (`src/app/engine.ts`), so every tap shows
immediately, works offline, and is replayed to the server in order. Siri phrases are produced by the
server (`src/shared/speech.ts`) and only spoken by the shortcuts.

## Data model
One row per event (columns in `src/server/readme.ts`, also written to the sheet's read-me tab for AI
tools). An edit keeps the event as it was before it in the appended column `prev` (JSON of type, detail, start, end, note;
owner: one step back), so the edit form can put it back later, from either phone; the toast after saving an edit has "בטל". Sleep is one row with start and end. Deletes are soft. Times are Israel time, stored as real
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
- Changes since your version (API 0.5.0, owner, after reading the sync log): with every bump the server also writes, in the same
  property call, a journal of the recent changes (`JOURNAL`, `src/server/journal.ts`): each event changed in revisions `base` to
  `head`, in its newest state (an event changed twice is kept once), and whether the settings changed; the oldest drop out to
  keep it under 8 KB (a property holds about 9 KB, Hebrew takes two bytes a letter). A phone sends `delta: true` with its
  revision; when the journal ends at the current revision and reaches back to the phone's, the answer is `changes` (plus
  `settings` only when they changed) instead of the list: no sheet is opened and the answer is a few hundred bytes. Anything the
  journal cannot vouch for (too far behind, an unknown revision, a journal that does not end at `REV`, a write that did not say
  what it changed) gets the full list as before. The phone puts each change into its copy (`putServerEvent`; a deleted one drops
  out of the view like a local delete) and marks new ones from the other phone as news. Older apps do not send `delta` and get
  the list; an older server ignores it.
- The engine runs one exchange at a time (`Engine.sync`). A request made meanwhile is remembered and runs right after (never
  dropped); taps made meanwhile travel together in the next request. An exchange older than 30 s is declared dead (iOS can freeze
  requests while a phone sleeps) and its late answer is ignored (sequence token); what it carried is sent again, which is safe
  because every operation has an id. The answer's events replace the phone's guesses (server time stamps).
- While the app is open and visible: a check every 5 s for two minutes after it was opened, returned to or used to log
  something, then every 15 s (`pollDelay`); a forced full list after 5 minutes open since the last full list, opening or
  return (safety net; looked at every 30 s, and a look that comes far too late means timers were frozen while hidden and counts
  as a return, so a return is never followed by a second, full download); an immediate check on
  return to the foreground (visibilitychange, focus, pageshow: the several events of one return within 0.4 s count as one) and
  when the network returns. Nothing is sent while the app is hidden.
- First attempt or retry: an operation that leaves the phone for the first time travels with `fresh: true` and is marked `sent`
  in the stored queue before the request goes. For a fresh operation the server skips the whole-sheet id lookup (0.3 to 0.5 s)
  and only checks the recent rows it reads anyway; a retry says when it was queued (`queuedAt`) and is looked up in the
  recent rows, with a whole-sheet search only when they do not reach back before that time; Siri and older apps get the full
  lookup on a sheet longer than the recent rows. Within one request a row
  found or read once is not searched again (`SheetStore.rows`). An edit or delete looks for its event in the recent rows first
  (`lookUp` in `core.ts`) and searches the whole sheet only for an older one.
- Leaving the app: requests that carry operations use `keepalive`; when the app is hidden or closed with operations that no
  request is carrying, `Engine.leave()` hands them to the browser (`navigator.sendBeacon`). No answer is read: they stay queued
  and the next sync sends them again as retries, recognised by their ids. (Whether iOS always completes these is not testable
  here; the live test proves the server records a write whose answer is never fetched.)
- Older days (History, Summary) are fetched with `list` and merged; a slower answer is dropped if the local copy changed meanwhile.
- A server from before `sync` answers `unknown_action`: the engine then talks the old way for that session (one request per
  operation, `poll`, `list`). The old actions stay on the server for Siri shortcuts and for phones still running an older app.
- The list reads only the tail of the Events sheet (`rowsSince` in `core.ts`: the last 1,500 rows, when the oldest of them was
  created at least two days before the range; otherwise, and for older days, everything). Known limit: a sleep left open for
  longer than the tail reaches back is no longer reported as open.
- Retries after a failure wait 3, 6, 12, 30, 60 s, each up to a fifth longer at random (two phones do not come back in step).
- The view (`events`, `allEvents`, `settings` in the engine's state) is rebuilt only when data changed; a check that found nothing
  new or a status change hands the screens the very same objects, so `useMemo` on them works (Insights, the recent list).
  At start the stored copy drops days from before the usual window (History fetches an older day again when it is opened).
- Feedback (owner): `feedback` / `feedbackList` / `feedbackClear` are sent directly (`Engine.ask`, not queued and not inside
  `sync`) from Settings > מתקדם > "🐞 משוב" (`Feedback.tsx`). Items live in the sheet's "משוב" tab (number, created, who, kind
  in Hebrew, text, version, sync log, id); the number comes from the script property `FEEDBACK_SEQ` under the lock and is never
  reset (clearing empties the rows' contents and keeps the titles); the uuid `id` makes a retry harmless. Not log data: the
  revision does not move.
- Sync log (`SyncLogEntry`, `bl.synclog.v1`, last 60, per phone): every exchange with why it ran, its time, the server's part
  and breakdown (`debug: true` on every sync), size, and for an opening or return the time until the data was on screen. Shown
  in Settings > מתקדם > "יומן סנכרון" (`SyncLog.tsx`).
- Timing: the real server adds `ms` (its own time) to every answer and, with `debug: true`, `t` (milliseconds and calls per kind of
  work: open, read, find, write, settings, props, lock). The app shows the last exchange under Settings > מתקדם; the live test prints
  a `TIMING` table into the server report.

- Family servers (`--family` build, `familyServer` in `Deps`): no sheet link in any answer; the family's key gets `send_only` for
  `feedbackList` / `feedbackClear`; the admin key (`ADMIN_KEY`, `checkAdmin`) may only `ping`, `feedbackList` and `feedbackClear`
  (with `ids`: only those items). The owner's phone keeps the family servers it reads (`bl.families.v1`: private label, address,
  admin key) and shows them under "משפחות נוספות" in the feedback screen; the feedback screen learns "send only" from the
  answer to its list.

## Security
Every request carries a secret key (a script property). The web app is anonymous-accessible (Siri cannot sign
in), so the key is the protection. Each family's server has its own address, key, sheet and script, and keeps the narrowest
Google permission (`spreadsheets.currentonly`: only its own sheet), so nothing can reach from one family to another. The key and server address travel only inside the "setup code" and into the
shortcut files created locally on the owner's Mac. The test server accepts a key derived in CI.

## Pipeline (`.github/workflows/pipeline.yml`)
Three things run side by side: `test` (typecheck, unit, builds, privacy check, browser suite twice), `server` (deploy the test
server with clasp, live test against real Google: not production, so it does not wait for the tests) and, on `main`, `pages`
(after `test`). On `main`, `prod` deploys the production server only after BOTH `test` and `server` passed. Every logged step
ends with "took Ns" in its report. The server job runs one at a time across branches (`concurrency: test-server`): `dev` and
`main` share the one test server, and two live tests at once fail each other. The Playwright browser download is cached per
Playwright version. Reports (sanitized) go to the `ci-status` branch because the build sandbox
cannot read Actions logs: `scripts/read-ci.sh`.
Family servers (other families, `MULTI_FAMILY_PLAN.md` section 0): on `main`, the job `families` runs only after `prod`, in its own
concurrency group, and deploys one server per id in `families.json` (`scripts/deploy-families.ts`, each through `deploy-server.ts
family <id>`: a production build in its own sheet and script, titled `BabyLog <id>`, ids saved on `ci-status` as
`envs/family-<id>.json`). It then pings each server without a key and reports "answers from this build" or "waiting for the
owner's setup" (a new script answers only after the owner ran `setup` once). A family's failure never touches the owner's server.
Ids are random (`npx tsx scripts/families.ts new`), never names.

## Shortcuts
`scripts/shortcuts/builder.ts` generates self-contained shortcut templates with placeholders;
`scripts/shortcuts/sign.sh` (run on a Mac) fills in the owner's address/key/name, converts and signs them.
Tests execute the generated files with a small interpreter (`tests/shortcut-interp.ts`) against the real server logic.
Two languages (owner: one parent's Siri speaks English, the other's Hebrew; Siri understands one language at a time and runs a
shortcut by its name, and the Hebrew Siri has no free phrasing): every shortcut has a language, sends `lang` with its request,
and the server answers in it (`voiceHe` / `voiceEn` in `src/shared/speech.ts`; Hebrew sleep words follow the baby's sex).
Several phrasings of one request are separate shortcuts (Siri matches the name). "יומן תינוק" / "Baby log" asks first
(Choose from Menu) and then sends the chosen request. The answer is given with Show Result: Siri says it in its own voice when
started by voice, and it shows quietly when tapped. `sign.sh` makes, for each parent, an "English" and a "עברית" folder; the
Hebrew sleep shortcuts are picked by the baby's sex in the settings. Shortcuts made before (no `lang`) still get English.

## App structure and UI rules (keep these; each one came from a real bug)
- **Screens** (`src/app/screens`): Home, History, Summary, Settings, plus the Install (first run) screen and the add/edit form (a bottom sheet).
- **Tabs:** tapping the current tab again starts its screen over (`key` = tab + a counter), e.g. back to Settings from the medicines screen.
- **Settings** is split into section cards with an icon and a title (`section()` in `Settings.tsx`): family, medicines, display and
  behaviour, advanced.
- **Medicines on Home** (`Home.tsx`, `MedsWindow.tsx`, `medicineToday` in `src/shared/medicines.ts`): the button and tile follow the
  active medicines (none: neither is shown and the grid drops a row; one: one tap logs it; several: a window to mark doses). Status
  uses only what was given, the gap and the daily count, never clock times. Mixed Hebrew/Latin parts are wrapped in `<bdi>`.
  Before a dose that the parents' limits say "not now" (`doseWarnings`), `ConfirmDose` asks; this is the only extra tap anywhere.
  When every medicine with a daily amount is given today (`allDoneToday`; as-needed ones do not count) the button is quiet
  (`.big.done`: transparent, dashed, muted, "✓" beside the name, a line saying when / how many); it works as before (owner).
  Before that, each medicine done for today fades (30%, grey) on the button and shows a "✓" in place of its icon in the window
  (`doneToday`).
- **Sleep on Home** (owner): while asleep the tile says "נרדם ב-HH:MM"; a sleep open longer than the longest finished sleep of
  the last 7 days plus an hour (at least 6 hours; `forgottenWake` in `domain.ts`) turns the tile into a warning button
  "שכחתם התעוררות?" that opens the sleep on its wake-up side, ready to record it. The form warns once when a sleep overlaps
  another one (`overlappingSleep`; an open sleep lasts until now); a second tap on "לשמור בכל זאת" saves, any change asks again.
- **History** (owner): day by day (`DayNav`) or the last 24 hours with a line where the day changes (`historyView` in the
  per-phone prefs); the kind filter applies to both.
- **Medicines window:** under a medicine just marked, the same "היה לפני" minutes and "בטל" as the toast (`earlierFor` on the
  `Mark`), in its own row because the row itself is a button.
- **Recent list** columns: icon 40px, label, time 48px, name 76px (cut with "…"), so the time never moves with a name.
- **Recent list** (`recentRows` in `Home.tsx`): sleeps appear as two moments, "נרדם" and "התעורר"; same-minute rows keep entry order
  (newest entered first). History shows one row per event.
- **Home is a fixed screen.** `.main.fixed` has no scrolling and no overscroll, the button grid shrinks (never scrolls) on short
  screens, and only the recent-events list (last 10, about 3.5 rows visible) scrolls in its own box. iOS let a scrollable Home get dragged
  out of place and stay stuck. Every other tab scrolls normally; each tab has its own scroll container (`key={tab}`).
- **Sync mark** (`SyncMark` in `App.tsx`, `.syncmark`): the state of the sync is shown in the empty strip under the status bar
  (`--top-gap`), fixed, transparent and untouchable, so nothing on the screen moves and it is never a coloured band: a small
  turning dot while sending or during the first check after opening ("מתעדכן…"), words only when sending takes more than 8 s,
  and the reason when there is no connection (with "עודכן HH:MM" when the data is older than 2 minutes). Banners (in the flow)
  remain only for what needs the parent: a wrong key, a refused entry.
- **News from the other phone:** entries that arrive in a list and were not ours glow for a few seconds in the recent list
  (`arrived` in the engine's state, `.rrow.new`); never on the first load, never for an older day loaded for History.
- **Status bar colour:** iOS 26 ignores `theme-color` and samples the page: keep `#app` with an explicit background (black at night)
  and nothing bright at the top at night (banners are dark there). It samples only when the page loads: changing colours,
  theme-color or flashing a strip at the top does not make it look again (owner screenshots; also reported by others). So in an
  iPhone home-screen app (`navigator.standalone`) a day / night change while the app is open reloads the page at a safe moment
  (`statusbar.ts` + `reloadWhenSafe`: hidden, or no form open and no field in use); the tab and its scroll position come back
  (`sessionStorage`); a guard stops a second reload toward the same theme within 15 s. Browsers elsewhere switch in place.
- **Layout units:** `#app` is `position: fixed; inset: 0`; never use `vh`/`dvh` (wrong inside iOS home-screen apps). Content starts
  `--top-gap` (22px) below the top safe area because iOS fades content under the status bar.
- **Never define a component inside another component.** `KindButton` once lived inside `Home`, so every re-render rebuilt all buttons and a
  tap straddling a re-render could be lost. Use plain functions that return JSX, or top-level components.
- **Event icons in lists** (`.ri` recent list, `.hi` history): a 40px column, one line, centred, so one icon and two ("💧💩") line up.
  History's time column (`.ht`) is 112px, one line, centred, so a sleep's range fits.
- **Toast while asleep:** a feed or diaper while the baby is marked asleep shows the wake-up offer on a row of its own under
  the confirmation (`action.note` in the toast), with a filled "☀️ לסמן שהתעורר" button.
- **Toast after a one-tap log** (owner): besides "בטל" (and "התעורר" while asleep), one quiet row "היה לפני 5 · 10 · 15 · 30
  דק׳" moves the entry just logged to that many minutes before the logged time (`earlierFor` in `actions.ts`; counted from the
  logged time, so another choice replaces the first). Two taps in all. "בטל" first takes the moves back, then the entry. The
  wake-up toast also says how long the sleep was. Toasts with these buttons stay 3 s (5 s while asleep; `TAP_TOAST_MS`); the toast after adding, saving an edit or putting one back stays 4.5 s (owner).
  A used button closes the toast (owner): it stays `TOAST_DONE_MS` (1 s) with that button lit so the tap is seen to work, then goes
  (`done` in the toast state). A minute: the new time is shown and another minute can still be picked in that second. "בטל": the
  text becomes "בוטל" and nothing else can be used. "☀️ לסמן שהתעורר" replaces the toast with the wake-up toast (same buttons,
  same closing). A failed undo puts its own error toast in place instead.
  A toast whose time is up turns invisible first and its place keeps swallowing taps for `TOAST_SHIELD_MS` (0.6 s) before it
  is removed (owner bug: a tap aimed at it as it went opened what lay under it); a finger resting on it keeps it (`holdToast`,
  then 1.5 s after the finger leaves). Opening a form removes it at once (`hideToast`).
- **Buttons:** at least 56px tall at any supported screen height; after a tap the same button rests for 1.5 s (double-tap
  protection) and the others for 0.4 s (so "פיפי" and then "נרדם" is not blocked); a 5 s undo toast.
- **Sheets** (add / edit form, medicines window): the row of buttons is pinned to the bottom of the sheet (`.sheet > .actions`,
  sticky), so "שמירה" / "ביטול" are visible without scrolling at any height; opening a sheet clears the toast at that moment (it would lie over
  them; not from an effect, which could run late and also remove the toast that saving shows). "ביטול" always closes without changing anything.
- **Add-after-the-fact form:** quick buttons are "5/10/15/30 minutes ago", "an hour ago", "two hours ago" (owner: no "today" /
  "yesterday"; another day is picked in the date field). The chosen button stays lit exactly as long as the time is still the one
  it set (derived from the values, so a late event from the phone's time wheel cannot switch it off; a change by hand does).
  A sleep has two moments, "נרדם" and "התעורר", edited one at a time with their own quick buttons (`Moment` in `EventForm.tsx`);
  the form opens on the one that was tapped (recent list row; in History a finished sleep opens on waking up, an open one on
  falling asleep). "עדיין ישן" belongs to the wake-up side. The date is shown in Hebrew ("14 בנובמבר 2026", `DateField.tsx`)
  with the phone's own date input laid invisibly over it, so the system picker opens only when the date is tapped; the app draws no calendar of
  its own (the owner did not want one). The system picker itself uses the phone's language. The time field is the system one.
  Deleting a sleep (owner): the delete button follows the side shown. Wake-up side of a sleep with both moments: "מחיקת
  ההתעוררות" clears only the end (`deleteWake` in `actions.ts`; the sleep is open again; undo puts the end back; an overlap with
  another sleep asks once, a second open sleep is refused by the server rule); falling-asleep side: "מחיקת השינה" (the row);
  a wake-up on its own: "מחיקה".
  A new sleep starts as "still asleep" (the usual case: the baby fell asleep a while ago); if a sleep is already open, the form asks for
  the wake time instead.
- **Words about the baby** follow the baby's sex chosen in Settings (`babyWords` in `src/app/words.ts`; `babySex` in the
  Settings sheet; missing = boy). Never write "נרדם" / "ישן" etc. directly in a screen: take them from there.
- **Next feed:** the side to feed next has a frame and a "הנקה הבאה" tag; feed buttons are size containers, and when short
  their icon and label go side by side with the tag above (so it never covers them).
- **Wording:** diaper kinds are "פיפי", "קקי", "פיפי + קקי" (`KIND_LABEL` in `labels.ts` is the single source, also used by the summary
  table). The sheet values stay `wet` / `poop` / `both`; Siri phrases are English and unchanged.
- **Night mode** (per phone, `bl.prefs.v1` in local storage): auto (21:00-07:00 or the phone's dark mode) / always / never, and a night
  colour: amber (default) or dim red (`data-tint='red'` on `<html>`). In red, colour emoji are tinted with a CSS filter; every emoji the app
  shows must sit in an element with class `ico`, `hi`, `ti` or `emo` so the tint reaches it. The theme is applied before the first paint
  by an inline script in `index.html` (same rule as `src/app/theme.ts`, checked by `tests/theme.test.ts`); change both together.
- **Summary tab:** a switch between "סיכום" (the day table) and "תובנות" (pattern insights), remembered per phone (`summaryView`).
  Both count "פיפי + קקי" as one pee and one poop; neither shows it as a count of its own (owner).
  Insights are pure functions in `src/shared/insights.ts` over the last 7 full days (today left out): medians and the middle half
  (never means), a minimum amount of data per card (otherwise no card), "after a feed" patterns only when at least 20 points more often
  than chance, night = 19:00-07:00, a long stretch = 3 hours or more. Write ranges in words, never "a–b" (reads backwards in RTL).
  Below the cards: a timeline (`timeline()`, rows 06:00 to 06:00, positioned with `right: %` so time runs right to left) and daily count
  bars (oldest on the right; then today so far, apart and lighter, labelled "היום"; owner), plain CSS. Pee is a ring (`--pee`), poop a filled dot (`--poop`), "both" the ring with the dot inside: shape, not only colour.
- **App update:** a new version reloads the page only when nothing can be lost (`update.ts`: the app is in the background, or
  no sheet / form is open and no field has the cursor).
- **Sync:** see "Sync engine" above (one `sync` request; a check every 5 or 15 s, a full list every 5 minutes, a check on resume).

## Server deployment details
- `scripts/deploy-server.ts` creates the sheet and bound script on first run (ids saved on `ci-status:envs/`), pushes the bundle with clasp, and
  keeps ONE web app deployment up to date so the address never changes.
- The bundle embeds the deployment's `/exec` address (`EXEC_URL`, only inside the private Apps Script project). `printInstallCode()` therefore
  prints a working code; `ScriptApp.getService().getUrl()` returns the editor-only `/dev` address and must not be used for codes.
- Entry points (`doPost`, `doGet`, `setup`, `rotateKey`, `printInstallCode`) are emitted as plain top-level functions by the build, because the
  Apps Script editor lists only statically declared functions.
- The server finds its tabs by name (Events, Settings, Medicines, קרא אותי, משוב); other tabs in the sheet (e.g. added by
  another app the owner connected) are ignored. `setup()` removes only an empty first tab that is not Events (the blank tab
  Google makes in a new file), so a tab worth keeping should not be first and empty when `setup()` is run.
- `REV` (script property) is the data revision. `API_KEY` is the shared secret. Both live only in the script properties.
- Calls to Google services are the slow part of a request (measured: properties 20 to 400 ms a call, the settings tabs 0.5 to 2 s),
  so `gas.ts` reads ALL properties with one call per request (`P()`); taking the lock drops that snapshot, so the revision and the
  settings version are always read fresh under the lock. The settings are also kept as a copy in the property `SETTINGS_JSON`,
  valid only for the settings version it was read at (`SETTINGS_REV`, moved by every save), so a reader racing with a save cannot
  leave an old copy behind. The sheet stays the store; settings above 4,000 characters are not copied. A hand edit of the
  Settings / Medicines tabs is taken in by running `setup()` again (the owner does not edit by hand).

## Tests (what each layer is for)
- `tests/` (Vitest, ~272): time rules vs ICU, domain logic, server rules, the built Apps Script bundle running in a fake Google runtime
  (`gas-fake.ts`), the sync engine, shortcut files (executed by a small interpreter), the Mac signing script, the privacy guard.
- `e2e/` (Playwright, ~129): real browser at phone size against `scripts/mock-server.ts`; includes raw touch drags (`Input.dispatchTouchEvent`),
  two phones syncing with no manual trigger, the number and kind of requests per tap / per open (`/__calls` on the mock), an old server, offline behavior, night mode, layout at several heights. CI runs the suite twice, the second time
  against a slow server (`MOCK_DELAY`), which finds timing bugs.
  Tests run in parallel (4 workers, `fullyParallel`); each worker has its own mock server (port 8787 + `TEST_PARALLEL_INDEX`,
  `MOCK` in `e2e/helpers.ts`; the config starts them with `MOCK_SERVERS`), and every test resets its own server in
  `beforeEach`, so tests never see each other. `E2E_WORKERS=1` runs them one by one. Wait for a condition, not a fixed time,
  unless the test checks that something does NOT happen during a time.
  A test that seeds or types early-morning times ("00:05") calls `pinPageDay(page)` first: the page's day becomes yesterday
  from 12:00 (the clock runs, timers stay real), so those times are never in the future, while the mock server (real time)
  still accepts them. The real today would fail just after midnight, when its 00:30 is still to come.
- `scripts/live-test.ts` runs against the real deployed TEST server (real Google, real sheet) in CI. Every server answer carries
  `build` (the commit); the live test first waits until three answers in a row come from this commit's build, because right after a
  deploy Google can still answer from the previous version.
- Habit that found real bugs: after adding a regression test, temporarily break the fix and confirm the test fails.
