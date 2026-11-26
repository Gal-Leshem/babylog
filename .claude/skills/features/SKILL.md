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

Shared: `src/app/screens/SyncLog.tsx` with performance, `src/app/screens/Feedback.tsx` ("משפחות נוספות") with families. A change
there is reviewed against both skills.

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
  must show it without crashing.

## Owner decisions in force (newest first; history in `docs/CHANGELOG.md`)
- Bottles (F18): one feeding = a bottle within the merge window of a nursing; the week's ml card splits formula / expressed
  when both were given; no bottle count in the week; the bottle window has no quick amounts, only the default with -/+ 10.
- Age above Summary and a line on Home on each whole month (girl / boy wording).
- Questions (F16) replaced insight cards: every question on by default; "עוד אין מספיק נתונים" with how much is missing.
- Feedback list: the owner pastes it when they want; never ask for it; recognise items by their #number.

## Learned (traps met while working here; add one line per new trap: what happened -> the rule)
- A passing "does not move" test proves nothing until the drag helper is shown to move something (raw CDP touch events only).
- A browser test must wait for the state it means, not for a text shown one step earlier.
- Seeding early-morning times ("00:05") needs `pinPageDay(page)` first, or the test fails just after midnight.

## Verify
`npm test`, `npm run typecheck`, `npm run build && npx playwright test --trace off` (one Playwright run at a time), and for layout
or timing also `MOCK_DELAY=250` and the three heights. Screenshots of the change to the owner: day, night, 560.

## Open (keep current; details in `docs/PROGRESS.md` "Where we are")
- F17 visit journal: parked at low priority, open decisions in `docs/BACKLOG.md`.
- F8: which questions get used (usage counts per question in the "שימוש" tab).

Last reviewed: 26 November 2026 (skill created from the docs; to be enriched by the features session's handoff).
