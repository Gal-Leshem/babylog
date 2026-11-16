# Backlog

Two tracks run side by side: **fixes** (bugs and small annoyances the owner reports from daily use; they always go first) and
**features** (one at a time, in the order the owner picks). Every item still follows the normal routine: small step, regression test,
dev, green CI, main, live version check. Sizes: S = one session, M = one or two sessions, L = several.
No names or private details here (public repository).

## Track 1: fixes and quality of life
Add items here as the owner reports them (date, what was seen, screenshot/recording studied). Move done items to `CHANGELOG.md`.
- (empty: nothing open)

Owner-only steps still open (from `PROGRESS.md`): install on the second parent's phone; optionally `rotateKey` once more and reinstall the code on both phones.

## Track 2: features (proposed order; the owner decides)
Based on a scan of similar apps (Huckleberry, Baby Tracker, Nara, Baby Daybook, Glow, Baby Connect, Sprout, BabyBuddy, an Israeli
Hebrew tracker) and parents' reviews, November 2026. What parents value most: fast logging, "when was the last feed and which side",
reliable partner sync at night, and an app that is not overwhelming. Most complaints: paywalls, partner devices out of sync, lost data,
cluttered screens. BabyLog already covers the core (one tap, next side, who logged it, two-phone sync, black night mode, the sheet as an
export that cannot be lost), so the list below adds only what fits a small private two-parent app. Keep Home calm: new things go to
other screens or into the existing tiles unless the owner asks otherwise.

### Next (small, high value)
| # | Feature | Why | Size | Notes |
|---|---------|-----|------|-------|
| F1 | Double-entry guard between parents | Both parents logging the same feed or diaper at night is a top sync complaint elsewhere | S | When a tap repeats the same kind the other parent logged in the last few minutes, the toast says so ("כבר נרשם ע״י ... לפני 2 דק׳") with undo. No blocking dialog. |
| F2 | "Since last diaper / last poop" | Asked for in every tracker; useful for newborn checks (enough wet diapers) | S | Fits as a line in an existing tile or on Summary; Home must not grow or scroll. |
| F3 | Diaper and feed counts so far today, on Home | Answers "is it enough today?" without opening Summary | S | One short line; test at heights 852/700/560. |
| F4 | Dim red "nursery" night theme (option next to black) | Less light in a dark room; niche apps sell on it | S | Setting choice only; contrast must stay readable. |

### Then (medium; may change the sheet)
| # | Feature | Why | Size | Notes |
|---|---------|-----|------|-------|
| F5 | Optional nursing duration (start / stop, like sleep) | Most trackers time feeds; useful for the pediatrician | M | Feed row gets an end time; one tap still logs as today. Screen stays on while timing (Wake Lock, newer iOS only). Owner decision: is duration wanted at all? |
| F6 | Bottle / expressed milk with amount (ml) | Common as soon as a bottle is introduced | M | New type, amount column in the sheet, Summary total per day. |
| F7 | Medicine and temperature | Fever and dosing come up in the first months; "when is the next dose allowed" | M | New types (name, dose, temperature); a "next dose not before" line. No reminders (see "not possible"). |
| F8 | 7-day trends | Feeds, diapers and sleep per day for the last week; spot changes at a glance | M | Simple bars on Summary, no chart library. |
| F9 | Report for the pediatrician | Daily averages for the last 7 / 14 days on one page | M | Printable page (share / print to PDF from the phone). |
| F10 | Growth: weight, length, head | Parents note clinic measurements; percentile vs. WHO tables | M-L | WHO tables are static data in the app. Lower priority for a newborn. |

### Later or needs a decision
- F11 Siri / Shortcuts quick logging (already built and paused by the owner): revisit with one manual shortcut, the Action Button or Back Tap.
- F12 Wake windows / next nap estimate: only meaningful from about two months; often criticized as inaccurate elsewhere.
- F13 Push notifications ("the other parent logged a feed", vitamin D reminder): iPhone home-screen apps can receive web push, but
  someone must send it; that needs a small extra server with signing keys. Not planned unless the owner accepts that.

### Not possible or not wanted
- Home-screen / lock-screen widgets, Live Activities, Apple Watch app, haptic feedback, local scheduled reminders: not available to
  iPhone web apps.
- In-app calendar (owner's decision), ads, accounts, anything that sends data anywhere except the owner's sheet.
