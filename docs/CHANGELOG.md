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
- Lesson: never run two Playwright runs at once; they share one mock server and reset each other (looked like random failures).

## Habits that paid off
- After adding a regression test, break the fix temporarily and confirm the test fails.
- Run the browser suite against a slow server; timing bugs only show there.
- Read real screenshots / the owner's screen recordings before changing layout code.
