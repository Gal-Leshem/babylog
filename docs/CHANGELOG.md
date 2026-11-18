# Change log

Everything that changed since the first build, in order, with the reason. Product decisions by the owner are marked **(owner)**.
No names, addresses or secrets in this file (the repository is public).

## Night 1: the whole MVP (Saturday)
- Stages 0-8 built and tested: shared logic (Israel time rules, feed merging, sleep state, daily summary, Siri sentences), the server API
  (`src/server/core.ts`) over a `Store` interface with a Google-Sheet implementation, the Apps Script wrapper, the Preact app (home, history,
  edit, add-after-the-fact, summary, settings, first-run install, night mode, offline queue), Siri shortcut generator and Mac signing script,
  Hebrew install guide, privacy guard, CI pipeline (tests, privacy check, e2e, server deploy via clasp, Pages publish, sanitized reports on
  the `ci-status` branch because the build sandbox cannot read Actions logs).
- Found and fixed while building: clasp needs the credential FILE path (`-A file`), not a folder; restore-after-delete needed in-memory
  tombstones in the engine; settings form fields were overwritten by a late sync and first-run setup did not hand the real settings to the engine
  (both found only because the e2e suite was also run against a slow server; CI now does that on every push).
- Privacy decisions **(owner)**: public repository; no names anywhere in code, docs, commits or logs; the only visible item is the account name
  in the site address; a word list kept as a repository secret is checked against the tree, the build output and the git history.

## Sunday: first contact with real Google and real phones
- Apps Script editor showed "No function": entry points were attached to `globalThis`. Now emitted as top-level function declarations (test guards it).
- Setup codes contained the editor-only `/dev` address, which cannot work from a phone. The deploy now embeds the deployment's `/exec` address
  in the bundle; the app and the signing script refuse `/dev` addresses and accept an `/exec` override. `rotateKey` produces a corrected code.
- First real test against Google passed (`LIVE TEST PASSED`, 14 checks) after the owner ran `setup` once in each script.
- Layout on iPhone: home content could be dragged out of place and stay stuck (iOS elastic overscroll). Home is now a fixed screen; each tab has
  its own scroll container; the recent list (last 10 events) scrolls inside its own box; `#app` is `position: fixed` (no vh/dvh); content starts
  22px lower on every screen (iOS fades content under the status bar). Tests drag with raw touch events and were checked against the old layout.
- Real bug found through a flaky CI check: `KindButton` was defined inside `Home`, so every re-render rebuilt all buttons and a tap straddling a
  re-render could be lost. Now a plain function; a test marks the DOM nodes and fails on the old code.
- Auto-update **(owner request)**: entries made on the other phone did not appear until the owner logged something. Server data revision
  (`REV`, `poll` action, API 0.2.0); the open app polls every 10 s and downloads the list only when the revision changed; full refresh every 60 s;
  immediate refresh on resume/focus/pageshow/online; silent while hidden; a stuck request no longer blocks later ones; a refresh requested while
  another runs is remembered (CI caught that gap).
- Add-after-the-fact form **(owner)**: the "now" quick button was replaced by "10 minutes ago"; the chosen "X minutes ago" button stays lit until
  the time or date is changed by hand; the date is written in Hebrew and a tap opens the phone's own date picker (a custom calendar was built and
  then removed at the owner's request); wording "פיפי" / "קקי" / "פיפי + קקי" instead of "רטוב" / "צואה" (`KIND_LABEL`, one source).
- Siri via the Mac signing script: built and tested in simulation, not used for now **(owner)**.
- Commit identity: new commits are authored as `Claude <noreply@anthropic.com>` (a session hook flags other committer emails as Unverified).
  The first ten commits still carry a generic identity; re-authoring them needs a force-push that has not been approved.

## Monday: backlog
- `docs/BACKLOG.md` added: a fixes track (owner feedback, always first) and a features track, proposed from a scan of similar apps and
  parents' reviews; the owner picks the order. Items already covered by the app and things iPhone web apps cannot do are listed separately.
- Bug **(owner report)**: a sleep added after the fact did not flip the home button to "התעורר". The form opened with "עדיין ישן" off and
  the wake time set to the moment the form was opened, so the sleep was saved as already over. Now a new sleep starts as "still asleep";
  only when a sleep is already open (the added one must be over) does the form ask for the wake time. Two browser tests, both proven to
  fail without the fix. Owner decisions: no nursing duration for now; keep the app uncluttered; next look at F4 (red night theme) and
  F8 (trends and pattern insights, research and a proposal first).
- F4 **(owner pick)**: optional dim red night colour, chosen per phone in Settings ("צבע מצב לילה": ענבר / אדום עמום); amber stays the
  default and night mode itself (auto / always / never) is unchanged. Colour emoji are tinted red with a CSS filter on their own spans
  (`.ico`, `.hi`, `.ti`, `.emo`), otherwise they were the brightest things on a dark screen. The test checks every visible colour is
  red-dominant and dim; it fails without the red palette. Found on the way: on opening at night the app first paints in day colours and
  the buttons fade to dark (a short white flash); logged as a fix in `BACKLOG.md`.
- Fix: no flash of day colours when the app opens at night. A small inline script in `index.html` sets the theme and night colour from the
  stored preferences before the first paint; the rule lives in `src/app/theme.ts` and a unit test runs the inline script for every hour,
  mode and system setting to keep the two identical. Browser test: with the app code blocked, the page is already black at 23:00.
- F8 decisions **(owner)**: inside "סיכום", a switch between the current "סיכום" and a new "תובנות" view (usage will decide what stays);
  timeline right to left from 06:00 to 06:00; no comparison with official diaper numbers; build all three insights (feed gaps day/night,
  poop after a feed, longest night stretch) plus an indication of how many stretches of 3 hours or more there are.
- F8 part 1: the summary tab has a switch "סיכום" / "תובנות" (remembered per phone; "סיכום" stays the default). "תובנות" shows up to four
  cards from the last 7 full days: usual gap between feeds by day and by night; poop after a feed (usual delay); diaper change after a feed;
  the longest night stretch, when it usually starts, how many stretches of 3 hours or more a night has, and last night's long stretches.
  Medians and the middle half, never means; each card appears only with enough data; "after a feed" cards appear only when clearly more
  often than chance. Ranges are written in words ("בין 2:00 ל-2:35"): a dash between numbers reads backwards in right-to-left text.
  Calculations in `src/shared/insights.ts` (16 unit tests, one proven to fail when the chance check is removed); two browser tests.
- F8 part 2: under the cards, a timeline with one row per day from 06:00 to 06:00 (today on top, running until now; time runs right to
  left like the text; sleep blocks, feed ticks, pee and poop dots) and four small daily count cards for the same 7 full days (feeds, pee
  including "both", poop including "both", hours of sleep), oldest day on the right. Pure CSS, no chart library. Unit tests for the rows,
  a browser test that measures a sleep's position from the right edge and the bar order.
- CI fix: two pipeline reports were lost (a `dev` server report each time `dev` and `main` finished together). Both runs write the same
  `reports/<job>.json`, the retry's rebase conflicted, was aborted and gave up. `scripts/status-branch.sh publish` now restarts from the
  newest branch and puts its own files on top; every run keeps its own commit, the latest report wins. Test with two clones racing
  (`tests/status-branch.test.ts`), failing on the old script.
- Timeline **(owner request)**: pee and poop dots were hard to tell apart. Pee is now a yellow ring, poop a brown filled dot (own colours
  per theme, `--pee` / `--poop`; the shapes keep them apart in the red theme); "פיפי + קקי" is drawn as poop (legend says so). Browser test
  checks shape, colour difference and the "both" mapping; it failed on the old dots.
- Research only **(owner request)**: how other apps handle more than one medicine; summary and recommendation in `BACKLOG.md` (F7).
- Timeline **(owner request)**: "פיפי + קקי" now has its own mark, the pee ring with the poop dot inside (instead of a plain poop dot).
- F7 spec **(owner)** recorded in `BACKLOG.md`; feedback given before any development.
- F7 spec agreed **(owner)**: see `BACKLOG.md` "F7 agreed spec" (four stages).
- F7 stage 1: Settings > "תרופות" > "ניהול תרופות" lists vitamin D (built in, always active) and the other medicines; add / edit
  (name, dose, once a day / X times a day / every X hours / as needed, optional minimum gap and daily maximum, optional course of X doses
  or X days), archive, restore, delete only before any dose. Fixed line "המינונים והמרווחים לפי הנחיית הרופא או העלון." Hours accept
  "4.5" and "4,5". Server API 0.3.0: "Medicines" sheet tab, per-medicine saves, dose events of type `medicine`. Home does not change yet.
  Tests: server rules, the Apps Script bundle (sheet rows, guide refresh), old saved settings, three browser tests.
- Test tooling: the mock server dropped nothing that arrived before a reset, so under `MOCK_DELAY` a save still on its way landed in the
  next test (seen as a flaky medicines test). Requests from before a reset are now discarded.
- Live test (real Google test server): also saves a medicine, logs a dose, checks that removal is refused while the dose exists, and
  cleans both up (exercises the real "Medicines" sheet calls).
- Recent list and History **(owner screenshot)**: "💧💩" wrapped onto two lines in the 24px icon column and made its row taller, and a
  single icon looked off-centre. The icon column is now 40px, icons stay on one line and are centred (`.ri`, `.hi`); the label keeps the
  rest. Browser test measures row heights and centring in both lists (failed with a 17px taller row before).
- Settings **(owner)**: four sections, each a card with its own icon and title: 👤 אני והמשפחה (who am I, names), 💊 תרופות,
  🌙 תצוגה והתנהגות (night mode, night colour, merge window with its own save), 🛠️ מתקדם (sync, sheet link, disconnect, version).
  The medicine form has "חזרה להגדרות"; tapping the current tab again starts its screen over (Settings from anywhere inside it).
  Tests for the sections and both ways back (the tab test fails without the re-tap behaviour).
- Medicines, owner changes **(owner)**: vitamin D is now a medicine like the others (reserved id `vitamin_d`, its doses keep type
  `vitamin_d`): present by default, editable (dose, icon, course), always once a day, can be archived, never deleted. Every medicine has
  an icon (cheerful palette with 🧸, plus standard 💊🧴🥄🩹🌡️; a new one gets an icon no active medicine uses). A dose is an amount
  plus a unit from a wheel (`<select>`: מ״ל, מ״ג, מק״ג, טיפות, יחב״ל, כדור, כמוסה, פתילה, שקית, כפית, מנה, לחיצה). A course can
  also run until a date (the last day counts). When a course is over, its row says so and offers "הארכה" (edit) or archive. Sheet:
  new columns icon, dose_unit, course_until appended at the end (rows from the first version still read). Tests: unit tests for course
  progress, icons, vitamin D defaults; server and sheet tests; five browser tests.
- F7 stage 2 **(owner spec)**: Home follows the active medicines. None: no medicine button and no medicine tile (two tiles; the
  other buttons take the space). One: its own icon and name, one tap logs it (undo toast; vitamin D as before). Several: their icons
  side by side above "תרופות" (more than three: 🧸); a tap opens the medicines window: a big row per active medicine (icon, name,
  dose, given today when and by whom, next allowed time, course progress); a tap logs a dose and the window stays open; "סיום" and a
  tap outside close it; "ביטול הסימונים" takes back everything marked in it; opening it refreshes from the server first. The tile
  shows what is missing today ("חסר: ...", warning colour), else the next allowed time, else "הכל ניתן". Medicine doses show the
  medicine's name and icon in the lists; the History filter is "ויטמין D ותרופות"; editing a dose keeps its medicine. Names, doses
  and parts of status lines are isolated (`<bdi>`) so right-to-left text cannot reorder them. Tests: unit tests for today's status;
  nine browser tests incl. refresh on open (fails without it) and layout at 852/700/560.
- Wording **(owner)**: no "קורס" (not used in Hebrew); "משך מתן התרופה" instead.
- Renaming a medicine or changing its icon already shows in everything logged before (a dose stores only the medicine's id; labels
  are looked up when shown); a browser test pins it **(owner question)**.
- Recent list **(owner report)**: a sleep is now two rows, "נרדם" at its start and "התעורר" at its end (an open sleep only
  "נרדם"); History keeps one "שינה" row. Rows in the same minute show the one entered last first. Tapping either opens the sleep.
- Feed or diaper while marked asleep **(owner question, our call)**: nothing changes by itself (night feeds and changes often happen in
  sleep, and an automatic wake would cut the sleep stretches); the confirmation adds "עדיין מסומן שישן" and an "התעורר" button.
  Toasts can carry a second button for this. Tests fail on the old code.
- F7 stage 3 **(owner spec)**: warnings before a dose, from the parents' own settings only (`doseWarnings`): once a day already
  given, X times a day reached, the as-needed daily maximum reached, too early for the gap / every X hours, the medicine's period is
  over. The window shows them as a highlighted line on the row; tapping such a row (or the single medicine button, vitamin D included)
  opens a confirmation ("לרשום בכל זאת" / "ביטול") with the last dose's time and who gave it. Never blocks. Warnings carry no names
  (a name inside a sentence reorders right-to-left text); the last dose is a separate, isolated line. Unit tests for every warning;
  browser tests for the window, the single button and vitamin D (cancel logs nothing, confirm logs).
- History **(owner screenshot)**: a sleep's range ("17:30–18:23") wrapped onto two lines in the 92px time column and stretched the
  row. The time column is 112px, one line, centred (checked at 375px wide). Browser test: the range is one line, centred, and the
  sleep row is as tall as a feed row (failed before).
- Vitamin D **(owner)**: an ordinary medicine in every way, its schedule too; "once a day" is only how it starts (the default made
  with a new account). The server's "already given today" hint shows only while vitamin D is once a day. Test: twice a day, the second
  dose needs no confirmation, the third asks.
- F7 stage 4 **(owner spec)**: the add-after-the-fact / edit form offers every active medicine as its own chip (vitamin D included;
  an archived medicine stays choosable for its own entries; no warnings for something that already happened); a dose can be moved
  between medicines. The daily summary has a row per medicine that is active or was given on one of the two days: once a day shows
  "ניתן" / "לא ניתן", other schedules the number of doses. Browser tests for both.
- Backlog **(owner idea)**: F14, other families with their own sheet in their own Google account (possible later).
- CI incident: on `main` the live test's request to the Google test server got no answer (header timeout), so the production server
  was not deployed although the same commit had passed on `dev` and the site was published (pages only wait for the tests). The live
  test now gives each request 90 s and sends it again up to three times on a timeout or lost connection (safe: writes carry ids and
  are recorded once). The following commit redeployed the production server.
- Recent list **(owner screenshot)**: the time moved with the length of the parent's name (the name column sized to its text). The
  time (48px) and the name (76px, cut with "…") have fixed columns now; checked at 375 and 393 px. Browser test: the time is at the
  same place in rows with a one-letter name and a long one (failed before).
- Night status bar **(owner screenshot: gold bar at night)**: iOS 26 ignores `theme-color` and tints the status bar from the page (the
  background of a full-screen fixed element, or a coloured element at the top); our `#app` had no background and the "מסנכרן" banner
  was a bright warning-coloured strip at the top after every tap. `#app` now has the page background (black at night) and at night
  banners are dark with coloured text and a thin line. Cannot be reproduced in Chromium: the test checks the colours that iOS samples.
- Medicine tile and window **(owner)**: a medicine given several times a day shows how many of how many ("1 מתוך 2"; every X hours
  counts 24/X a day); once a day keeps "ניתן היום" / "עדיין לא"; as needed shows how many today. The window says
  "היום 1 מתוך 2 · אחרון 08:10" for those. Unit tests for the wording; browser checks on the tile (vitamin D twice a day) and the
  window (every 8 hours).
- Lesson: never run two Playwright runs at once; they share one mock server and reset each other (looked like random failures).
- Owner answers: night status bar confirmed black on the phone; no total on the medicines tile for now.
- Plan only **(owner request)**: `docs/REFACTOR_PLAN.md`, a code review of the sync path with a phased refactor plan (one `sync`
  round trip instead of several, cheaper sheet reads, sending while the app is being left, a quiet sync indicator, look and feel
  options). Nothing built.
- Owner decisions on the plan: all three waits hurt, opening the app after the other parent logged something most; the sheet is
  never edited by hand; stay on Apps Script for now (a move is decided later); the full plan, not a minimal one; look: polish plus
  an own icon set.
- CI incident (my doing): a `dev` push while a `main` run was still going made two live tests hit the shared test server together
  (one saw the other's open sleep, one got a lock timeout); both runs failed although nothing was wrong. The server job now runs
  one at a time across branches (`concurrency: test-server`).

## Refactor of the sync path (plan: `REFACTOR_PLAN.md`)
- Phase 0, measuring: the real server reports its own time for every request (`ms`) and, on request, where it went (`t`); the
  live test prints a `TIMING` table (old actions and the new `sync`) into the server report; Settings > מתקדם shows how long the
  last sync took and how much of it was the server.
- Phase 1, one round trip (API 0.4.0): new action `sync` = the phone's waiting operations + "did anything else change since my
  revision?" in one request. Before: a tap was a `log` and then a full `list`; a check was a `poll` and then a `list`; opening the
  app downloaded the full list twice (several "I am back" events, the second one queued). Now: a tap is one request and brings no
  list unless the other parent wrote; opening the app with nothing new is one tiny request that reads no data on the server; news
  arrive in the request that asked. Taps made while a request is on its way, or offline, travel together (up to 25 a request).
  The phone keeps the revision with its data across restarts. The full safety refresh went from every minute to every 5 minutes
  (the sheet is not edited by hand). The engine's separate flush / refresh / poll paths became one exchange with the same
  guarantees (queue, never drop; dead-request rule; ids make re-sending safe). A server from before `sync` is still served the
  old way (the site can publish while a server deploy fails). `MedsWindow` and "סנכרן עכשיו" use the same exchange.
  Tests: 12 server tests, 1 through the built Apps Script bundle, 9 new and 6 adapted engine tests (three of them proven to fail
  when the feature is broken: revision not kept, server always sending the list, a failed operation dropped), 6 new browser tests
  counting requests (one per tap, one per open, one for three offline taps, old server), live test for `sync`.
- First measurements on the real server (table in `REFACTOR_PLAN.md`, section 7): the per-request floor is about 0.6 s; the
  settings / medicines read was the largest cost of a list (0.5 to 2 s), then the duplicate check (0.3 to 0.5 s per operation).
- Phase 2, part 1 (server): the settings are kept as a copy in a script property, tied to a settings version so a racing reader
  cannot leave an old copy; all properties are read with one call per request and again only under the lock. A check with nothing
  new is now exactly one call to Google; a list reads only the events. Tests through the built bundle count the calls to Google
  (two of them proven to fail: revision not re-read under the lock, copy accepted without its version).
- Phase 2, part 2 and phase 3, part 1: (a) a first attempt says `fresh`, and the server then skips the whole-sheet duplicate
  lookup (recent rows are still checked); the phone marks an operation as sent before the request leaves, so anything later is a
  retry with the full lookup; an edit or delete searches the sheet once instead of twice. (b) A tap followed by locking the phone:
  requests with entries are `keepalive`, and entries that no request is carrying when the app is hidden or closed are handed to
  the browser's beacon; coming back sends them again as retries and nothing is written twice. Tests: engine (fresh / retry across
  a restart, beacon, keepalive; proven to fail without the sent mark), server and bundle (lookups counted; proven to fail without
  the row memo), a browser test (the entry reaches the server while the app is hidden), and a live check that a write is recorded
  when its answer is never fetched.
- Measured after the settings copy (real server): a list answer 0.9 to 1.3 s in total, 0.34 s of it ours (before: 1.8 to 3.7 s).
- CI: the new browser test for the beacon failed once in CI and never locally: it went on as soon as the banner said "1 waiting",
  which is also true while the request is still on its way (then the app rightly sends no beacon). It now waits for "אין חיבור".
- Phase 3, rest, and item 2.3: the app checks every 5 s for two minutes after it was opened, returned to or used, then every 15 s
  (was a flat 10 s); retries are spread by up to a fifth; a list reads only the last 1,500 rows of the Events sheet when that
  provably covers the range (falls back to everything for older days, short or hand-sorted sheets). Tests: a 5,000-row sheet
  (same events as a full read, no full read; proven to fail without the tail read), the pace (a browser test that fails at the
  old 10 s), the spread.
- Phase 4 (client housekeeping): the engine keeps the same events / settings objects while nothing changed (before, every status
  change and every check rebuilt them and every screen recomputed); Insights and the recent list are memoized on them; the copy
  stored on the phone drops days from before the usual window at start (it only ever grew); a new app version no longer reloads
  the page in the middle of a form or while a field has the cursor. Tests: object identity across checks and status changes,
  pruning (both proven to fail without the change), the reload rule.
- Phase 5, owner's decisions **(owner)**: the own icon set is NOT wanted (the emoji stay); the visual polish did not convince
  and is not built; wanted and built: (1) a quiet sync mark instead of the strip: in the empty space under the status bar, so
  Home no longer jumps after every tap, a dot while sending, "מתעדכן…" on opening until the first check is back, words only
  when sending is slow or there is no connection (then also when the data was last updated); (2) after a tap the same button
  rests 1.5 s, the others 0.4 s (was 1.5 s for all); (3) an entry that arrives from the other phone glows briefly in the recent
  list. Tests: the tiles do not move and the mark is transparent and untouchable at 852 / 700 / 560, the dot / slow / opening
  / offline wording, the two lock times, the glow for theirs and not for mine (five browser tests proven to fail when the
  change is undone), three engine tests. Lesson on the way: making `resume()` drop near-simultaneous calls broke "the medicines
  window refreshes when opened"; the dropping now lives in its own entry point (`returned()`), used only for app-return events.
- Status bar after a day / night change **(owner screenshots)**: with the app open, switching night mode in Settings or the
  clock reaching 21:00 / 07:00 changed the page but not the iPhone status bar (white over the night screen, black over the day
  screen); closing and reopening fixed it. iOS 26 reads the bar's colour from the page only when it loads; others report that
  theme-color and a briefly shown strip do not help. Now an iPhone home-screen app reloads the page when the theme changes, at
  a moment when nothing can be lost (not while a form is open or a field is in use), and returns to the same tab and scroll
  position; elsewhere nothing reloads. Browser tests: reload once and back to Settings at the same scroll, 21:00 with a form
  open (waits), no loop if a reload came back in the old theme (87 reloads without the guard), no reload in a browser tab; each
  proven to fail without its part. Whether iOS reads the colour again after a reload cannot be tested here: owner confirms.
  CI caught a weak test on the way (it assumed the Settings screen had to scroll to reach the button; in CI it did not): the
  test now scrolls on purpose and taps without moving the scroll.
- Faster tests and pipeline **(owner request; tests must not get weaker)**. Measured first: unit tests 6 s (left alone); the
  browser suite ran one test at a time because all tests shared one mock server: 3.6 min, and 5.3 min again against the slow
  server, plus the server job and the production deploy strictly after the tests. Changes: (1) every Playwright worker gets its
  own mock server (port 8787 + worker index) and the suite runs 4 tests at a time: 1.1 min locally (1.4 min against the slow
  server), same 129 tests, unchanged checks; stable over three runs and the slow run; two deliberate breaks (no polling, the old
  tap lock) still fail 9 tests in parallel. (2) Two fixed waits became waits for the condition (three taps in a row: a click
  waits for the button anyway; "no connection" appears by itself: up to 16 s instead of a fixed 11 s plus 5 s). Waits that check
  that something does NOT happen (hidden app, idle checks) and the drag settle times stay as they were. (3) Pipeline: the test
  server deploy and live test run alongside the tests (not production); a new `prod` job deploys production only after both
  passed; the browser download is cached; every step reports how long it took.
- Summary table **(owner)**: no separate "פיפי + קקי" row; it counts as one pee AND one poop (as "תובנות" already did), so the
  table shows only "פיפי" and "קקי"; the note under the table says so. Browser test (a "both" on each day) failed before.
- Daily counts under "תובנות" **(owner)**: after the 7 full days, a bar for today so far, set a little apart, drawn lighter
  (the day is not over) and labelled "היום" in the accent colour. Its numbers are the same as the "סיכום" table for today; the
  insight cards still use only the full days. Browser test (8 bars, today last and marked, the gap, today = the table) failed
  before.
- Sleep editing **(owner report)**: only falling asleep could be set with the quick buttons, and a sleep opened from its
  "התעורר" row still showed falling asleep first. Now the form shows the sleep's two moments side by side ("נרדם 00:05" /
  "התעורר 00:40"); the one that was tapped opens, and each has its own date, time and quick buttons; switching keeps what was
  changed in the other; History opens a finished sleep on waking up (owner agreed). A wake-up before falling asleep opens the
  wake-up side with the error (wording unchanged until the owner picks one).
- Quick-time buttons **(owner report)**: the chosen "X minutes ago" sometimes did not light up. The lit state is now derived
  from the values it set, so a late report of the same time from the phone's time wheel cannot clear it. "לפני 5 דק׳" added;
  "היום" / "אתמול" removed (owner). Tests: the button order, the late-report case, the moments (opening side, separate changes,
  switching, History); each new test proven to fail without its part.
- Toast after a one-tap log **(owner)**: a quiet row "היה לפני 5 · 10 · 15 · 30 דק׳" moves the entry just logged that
  many minutes before the logged time: two taps to log something that happened a little while ago (feeds, diapers, falling
  asleep, waking up, the single medicine button). Another choice counts from the logged time again; "בטל" takes the moves back
  first, so nothing is left for the server to refuse (also offline). The wake-up toast says how long the sleep was ("ישן 0:35").
  Browser tests: the two taps, a second choice, undo after a move offline and online, sleep and wake-up with the length (proven
  to fail without the undo of the moves, and when a choice counts from the previous move).
- Taking back an edit **(owner)**: "בטל" in the toast after saving an edit puts back exactly what was there before it. One
  step back is also kept with the event in the sheet (new column `prev`, appended; its title is added to an older sheet the
  first time an edit needs it), so later, from either phone, the edit form shows "לפני העריכה האחרונה: …" with "החזר". Putting
  it back is an ordinary edit, so its own "before" is the mistaken version. Tests: server and sheet bundle (the column on an
  older sheet), browser (the toast, the line and "החזר", no line when never edited; proven to fail without the toast undo and
  without storing `prev`), live test.
- Sleep, owner-approved: the sleep tile says "נרדם ב-HH:MM" while asleep; a sleep open much longer than usual (longer than the
  week's longest plus an hour, at least 6 hours) shows "שכחתם התעוררות?" and a tap opens it on waking up, ready to record it;
  a sleep that overlaps another one asks once before saving. Unit tests for both rules; browser tests (each proven to fail
  without its part). Lesson: a deliberate break must still compile, or the test runs against the previous build and "passes".
- CI incident: the toast commit passed on `dev` but one browser test failed on `main` (slow run), so production and the site
  stayed on the previous version. The test expected "ישן כבר 0:30" right after logging "30 minutes ago"; the tile's clock
  refreshes every 15 s, so just after a minute boundary it still said 0:29. Not an app bug. That check and an older one with the
  same weakness now accept 0:29.
- CI incident (process, my doing): for the "undo edit" commit the `dev` live test failed (the real test server answered an edit
  without the kept version) and my polling loop pushed to `main` anyway, because it stopped only on a failed TEST report, not a
  failed SERVER report. On `main` the same bundle passed the live test and production was deployed, so nothing broken reached
  the phones, but the rule "green `dev` first" was broken. Cause of the failure: right after a deploy Google can still answer
  from the previous version for a while (the first deploy of the commit failed, the second, identical one passed; answers without
  the new timing field were seen after a deploy before). Fixes: every server answer carries its build (the commit), and the live
  test first waits until three answers in a row come from this commit's build (up to 3 minutes); the polling loop now requires
  BOTH `dev` reports to be "success" before pushing to `main`.
- Edit form, "ביטול" **(owner)**: it must always be there and work, also when nothing was changed, and leave without
  changing anything. On short screens the buttons were below the bottom of the form (scrolling needed), and the toast of the tap
  just made could lie over them. Now the form's buttons are pinned to the bottom of the sheet (also in the medicines window), and
  opening a form or the window clears the toast. Browser test at 852 / 700 / 560: with a toast up, "ביטול" is on screen, not
  covered, closes the form and nothing changes (failed before at 560 and on the toast). The overlap message is as the owner
  wants it.

## Habits that paid off
- After adding a regression test, break the fix temporarily and confirm the test fails.
- Run the browser suite against a slow server; timing bugs only show there.
- Read real screenshots / the owner's screen recordings before changing layout code.
