---
name: features
description: BabyLog app features, fixes and wording - screens, Home, History, Summary/insights/questions, medicines, bottles, sleep, toasts, forms, night mode, Settings, Hebrew wording, Siri phrases. Load before changing anything a parent sees, before proposing a new feature, and when the owner pastes the in-app feedback list or sends a screenshot or screen recording.
---

# Features and fixes

The app is complete and used daily on two iPhones; every change starts from the owner's feedback. Read first: `docs/BACKLOG.md`
(what is planned and the owner's choices), the UI rules in `docs/ARCHITECTURE.md` ("App structure and UI rules"), and the
newest sections of `docs/CHANGELOG.md`.

## Owns
- fallback: every file no other domain skill owns (screens, shared logic, styles, wording, shortcuts, tests, and the shared
  pipeline and test tools such as `.github/workflows/pipeline.yml` and `scripts/mock-server.ts`: for those also read
  "Learned across domains" in `CLAUDE.md`)
- `src/app/screens/`
- `src/shared/`
- `src/app/words.ts`
- `src/app/labels.ts`
- `src/app/questions.ts`
- `src/app/actions.ts`
- `src/app/styles.css`
- `src/app/theme.ts`
- `src/app/statusbar.ts`
- `scripts/shortcuts/`
- `docs/BACKLOG.md`
- `src/app/App.tsx` (tabs, toast view, sheets; `SyncMark` in it is performance's)
- `src/app/state.ts` (toast, prefs, usage counts; the engine wiring is performance's)
- `src/app/usage.ts`
- `src/app/config.ts`
- `src/app/overlay.ts`
- `src/server/core.ts` (event validation, settings parsing, `usage`, Siri `status` / `next`)
- `src/server/gas.ts` (the Settings rows, the "שימוש" tab)
- `src/server/readme.ts`
- `src/app/screens/Privacy.tsx` (the privacy and terms wording the owner approved)

Shared: `src/app/screens/SyncLog.tsx` with performance, `src/app/screens/Feedback.tsx` ("משפחות נוספות") with families,
`src/server/core.ts` / `src/server/gas.ts` with both (request path: performance; admin and family parts: families). A change there
is reviewed against every skill that owns the file.

## How a feature is made (owner's rule)
1. Research, then a proposal; for anything visual, mockups as screenshots of the real app (day, night, 360 x 560).
2. Wait for the owner's decisions; write them in `docs/BACKLOG.md` marked **(owner)** before building.
3. Build in small steps, each with a regression test proven to fail without it (see the routine in `CLAUDE.md`).
4. A fix from daily use goes before any feature (Track 1 in `docs/BACKLOG.md`).

## Rules that must not break (each came from a real bug; details in `docs/ARCHITECTURE.md`)
- Home is a fixed, non-scrolling screen; only the recent list scrolls in its own box; the button grid shrinks, never scrolls.
- Never define a component inside a component (lost taps on re-render).
- No `vh` / `dvh`; `#app` is `position: fixed; inset: 0`; content starts `--top-gap` below the safe area.
- Buttons at least 56 px at every supported height; check heights 852, 700 and 560.
- Words about the baby come from `src/app/words.ts` (boy / girl); never write "נרדם" / "ישן" directly in a screen.
- Diaper wording "פיפי" / "קקי" / "פיפי + קקי" from `KIND_LABEL` in `src/app/labels.ts` only.
- Mixed Hebrew / Latin text inside `<bdi>`; ranges in words, never "a–b".
- At night nothing bright at the top (iOS samples the page for the status bar colour); every emoji in an element with class
  `ico`, `hi`, `ti` or `emo` (red night tint).
- The night theme rule lives twice (`src/app/theme.ts` and the inline script in `index.html`): change both together.
- No in-app calendar; the system date and time pickers only.
- No medical advice: medicine numbers are only what the parents entered; insights compare only with this family's own data
  (medians and the middle half, never means; minimum data per card).
- The look stays as it is: no new icon set or visual polish unless the owner asks.
- Keep Home calm: new things go to other screens or into existing tiles unless the owner asks otherwise.
- A new event type or detail format: no new sheet column if the detail can carry it (bottles: `formula:120:30`); an older app
  must show it without crashing (an unknown type falls back to a wrong label in `kindOf`, never a crash).
- A sheet that opens over the tab bar is drawn through `overlay()` (`src/app/overlay.ts`, a portal under body): on iOS the
  scroll container's `-webkit-overflow-scrolling: touch` makes a stacking context that hides it behind the tabs.
- Opening a form or window hides the toast first (`hideToast` in the opener, not in an effect), so its buttons are reachable.
- Time of day in words is "בסביבות השעה HH:MM"; a gap carries its unit ("2:50 שעות", "45 דק׳"); a Latin term inside Hebrew
  is isolated (`\u2068...\u2069` in strings, `<bdi>` in markup) or a parenthesis after it flips.
- Usage counters (`src/shared/usage.ts`): add new names at the end of `LABELS`; never rename one (the phone drops unknown
  names, the server skips them, the sheet appends a column by itself). Every question id must also be in `USAGE_QUESTIONS`
  (a type check fails otherwise).
- Numbers that summarise mixed things are split, not averaged together (bottle size per kind: 60 ml top-ups and 120 ml formula
  made "90 ml", a bottle nobody gave).

## Owner decisions in force (newest first; history in `docs/CHANGELOG.md`, F15-F18 rounds in `docs/BACKLOG.md`)
- Age: explanations in "תובנות" that mention an age stay; nothing disappears by itself with the age (the parents hide it).
- Age above Summary / "תובנות" and a quiet line at the top of Home's recent list on each whole month (girl / boy wording).
- Bottles (F18), all live:
  - Settings card "🍼 האכלה" for both phones: nursing / expressed / formula switches (one stays on), default ml per kind.
  - Home: "בקבוק" is the third button in the feed row, on the LEFT of the nursing buttons; with three in a row the icon stays
    above the label (checked at 393 / 375 / 360 wide). One kind: one tap logs it; both: the window (kinds, default, -/+ 10,
    no quick amounts). Without nursing: a button per kind instead of the nursing buttons.
  - Every bottle starts from its kind's default. Toast: -20 / -10 / +10 / +20 and "היה לפני", stays while used. After 5 equal
    bottles off the default: offer to update it ("לא עכשיו" remembered per phone and amount).
  - Edit form: "הוכן" and "כמה נשאר" both with -/+ 10, left from 0, "נאכל" computed. Lists show what was eaten.
  - One feeding = a bottle within the merge window of a nursing or a bottle; the next side and left / right from nursing only.
  - Summary rows with bottles: "האכלות", "הנקות" (only with nursing), "בקבוקים", "מ״ל בבקבוקים"; nursing only keeps
    "הנקות (האכלות)". The week: no bottle count; one ml card, split formula / expressed when both were given.
  - Questions: "מתוכן X עם בקבוק" only with nursing AND bottles (sensitive: not every mother can nurse); "כמה מההאכלות עם
    בקבוק?" only by hand; sides and cluster only with nursing; "היום חריג" counts bottle ml only without nursing.
  - Out of scope: pumping, stash, discard timers, volume targets, a mixed bottle, solids.
- Summary gap between feeds is the median ("רווח רגיל בין האכלות"), never a mean.
- Questions (F16) replaced insight cards: a question shows by itself once it has enough data (off until then), each parent
  turns any on or off on their own phone; one turned on early shows how much is missing. Every card has "מה זה אומר?" with
  the "אם משהו מדאיג" line and the not-medical note.
- Usage measurement (F15, option A): counts per parent per day, question states, cards seen, sent once a day, no extra request.
- Deleting on the wake-up side of a sleep deletes only the wake-up; toasts "רישום השינה נמחק" / "רישום ההתעוררות נמחק".
- Feedback list: the owner pastes it when they want; never ask for it; recognise items by their #number.
- The owner's private notes (for example from a clinic visit) are used only for structure: never stored in the repo, docs or
  memory.

## Learned (traps met while working here; add one line per new trap: what happened -> the rule)
- A passing "does not move" test proves nothing until the drag helper is shown to move something (raw CDP touch events only).
- A browser test must wait for the state it means, not for a text shown one step earlier.
- Seeding early-morning times ("00:05") needs `pinPageDay(page)` first, or the test fails just after midnight.
- A test that reads today's Summary and seeds `nowLocal(-N)` fails for the first N minutes after midnight (bottles, CI at
  01:15) -> any test about "today" pins the day and seeds fixed times; prove it by running the old test just after midnight.
- `npx prettier` reformatted whole files -> never run it; edit only the lines you mean.
- A sheet behind the tab bar on iPhone could not be reproduced in Chromium -> test that the sheet is not inside `.main` and
  that `elementFromPoint` at its button hits the button.
- The phone stored question states but did not read them back -> unit-test the round trip of anything stored (`src/app/usage.ts`).
- The fake Google runtime had no 26-column limit, the real sheet has -> model real limits in `tests/gas-fake.ts` before trusting it.
- Playwright `toBeVisible` ignores opacity: a toast that "went" is invisible but present -> check `data-gone`, not visibility.
- Side-by-side icon and label broke "הנקה שמאל" on a small iPhone installed as an app (375 x 667), not only at 560 -> check
  layout at widths 393 / 375 / 360 too.
- A longer word in a Home tile wrapped it and squeezed the buttons at 560 -> keep tile values to one line (an emoji, not a word).
- Three-digit numbers overflowed half-width bar cards at 360 -> such a card spans the full width.
- A test titled "14 days by default" passed with any default against an empty store -> a test that claims a default seeds data
  on both sides of the boundary.
- Mockups: a temporary `e2e/zz-*.spec.ts` that injects markup into the real app and screenshots to the scratchpad; delete it after.
- Mock server `delay` of 10 s or more makes regular checks time out -> slow only the taps with `opsDelay`.

## Verify
`npm test`, `npm run typecheck`, `npm run build && npx playwright test --trace off` (one Playwright run at a time), and for layout
or timing also `MOCK_DELAY=250` and the three heights. Screenshots of the change to the owner: day, night, 560.

## Open (keep current; details in `docs/PROGRESS.md` "Where we are")
- F17 visit journal: parked at low priority by the owner, open decisions in `docs/BACKLOG.md`; mockups before building.
- F11 Siri shortcuts: built and signed; the owner's test on the phones is on hold (owner).
- F8: which questions get used (usage counts per question in the "שימוש" tab).

Last reviewed: 26 November 2026 (enriched by the features session's handoff: owns, rules, decisions, traps).
