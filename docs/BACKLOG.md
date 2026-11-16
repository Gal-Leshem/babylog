# Backlog

Two tracks run side by side: **fixes** (bugs and small annoyances the owner reports from daily use; they always go first) and
**features** (one at a time, in the order the owner picks). Every item still follows the normal routine: small step, regression test,
dev, green CI, main, live version check. Sizes: S = one session, M = one or two sessions, L = several.
No names or private details here (public repository).

## Track 1: fixes and quality of life
Add items here as the owner reports them (date, what was seen, screenshot/recording studied). Move done items to `CHANGELOG.md`.
- (nothing open; the last fix, a flash of day colours when opening at night, is done: see `CHANGELOG.md`)

Owner-only steps still open (from `PROGRESS.md`): install on the second parent's phone; optionally `rotateKey` once more and reinstall the code on both phones.

## Track 2: features (proposed order; the owner decides)
Owner's choice so far: F4 (done) and F8 (done: insight cards, the 7-day timeline and daily counts under "תובנות").
The owner will watch which of "סיכום" / "תובנות" gets used and which insights help, and reshape from there. Keep the app uncluttered.
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
| F4 | ~~Dim red night theme~~ done (Settings, per phone) | Less light in a dark room | S | See `CHANGELOG.md`. |

### Then (medium; may change the sheet)
| # | Feature | Why | Size | Notes |
|---|---------|-----|------|-------|
| F5 | ~~Optional nursing duration~~ not wanted for now **(owner)** | Most trackers time feeds; useful for the pediatrician | M | Feed row gets an end time; one tap still logs as today. Screen stays on while timing (Wake Lock, newer iOS only). Owner decision: is duration wanted at all? |
| F6 | Bottle / expressed milk with amount (ml) | Common as soon as a bottle is introduced | M | New type, amount column in the sheet, Summary total per day. |
| F7 | Medicines (more than one) | Fever and dosing come up in the first months; "when is the next dose allowed" | M | Research done, design to be agreed with the owner: see "F7 research" below. |
| F8 | ~~7-day trends and insights~~ done (first version) | Patterns and the last week at a glance | M | Reshape after the owner sees which parts get used. Ideas: cluster feeding in the evening, a trend note when the last 3 days differ from the week. |
| F9 | Report for the pediatrician | Daily averages for the last 7 / 14 days on one page | M | Printable page (share / print to PDF from the phone). |
| F10 | Growth: weight, length, head | Parents note clinic measurements; percentile vs. WHO tables | M-L | WHO tables are static data in the app. Lower priority for a newborn. |

### F7 research: several medicines (November 2026, before any design)
What others do: baby trackers mostly log medicine as a plain entry behind one "health/medicine" category (no tile per medicine);
dedicated apps (Apple Health Medications, MyTherapy, Medisafe) define each medicine once with a schedule: daily, as needed (minimum gap,
optional maximum per 24 h) or a course with an end date; doses are "given" (or "skipped" for scheduled ones); finished medicines are
archived with their history; kids' fever apps show "next dose allowed at HH:MM" and a soft "daily maximum reached" note and remind
caregivers to confirm with each other. Official numbers differ between sources (NHS / AAP / Israeli HMOs), so the app must only use
numbers the parents enter and never suggest doses.
Recommended for BabyLog (calm Home, two parents, iPhone web app):
1. One "תרופות" button replaces the vitamin D button (still 7 buttons); it opens a sheet with one big row per active medicine: name,
   status ("ניתן היום 08:10 · <who>" / "עדיין לא" / "מנה הבאה מ-14:30" / "מנה 5 מתוך 14") and one-tap "ניתן עכשיו"; the Home tile
   becomes a one-line summary ("תרופות: הכל ניתן" / "מגיע: ..."). Vitamin D becomes a daily medicine; old rows map to it.
2. One tap logs the saved dose; edit for another time or dose; undo toast as today.
3. Who gave it is always shown; the soft warning ("ניתן לפני 2:10 ע״י ..., לרשום בכל זאת?") appears only within a gap / over a maximum
   the parents set; never a block; nothing when no numbers are set.
4. Courses end by themselves (archived, history kept); manual archive.
5. Leave out: stock, drug lists, interactions, dose calculators, reminders (no local notifications in iPhone web apps; push needs a
   server; a possible later alternative is a prefilled calendar event).
Data sketch: a "Medicines" list in the sheet (id, name, dose text, schedule type and its numbers, start/end, active) and dose rows as
events (type `medicine`, which medicine, time, who, dose note, given/skipped). Open questions for the owner are in the session report.

### F7 owner spec (draft, November 2026; open points under discussion)
- Medicines are managed in Settings: a button opens a medicines screen (name, dose, times, schedule; a course counted by X doses or by
  X days). A medicine always ends by hand: moved to the archive in Settings. Both parents can do everything.
- Vitamin D is always there. The Home button reads "ויטמין D" while it is the only medicine and "תרופות" once others are defined.
- With more than one medicine, the button opens a window to mark which one was given.
- For a medicine taken twice a day or every X hours: a highlighted line in the window when it is too early (minimum gap) or today's doses
  are done, and a confirmation after choosing it. This is the only case where logging takes an extra tap.
- No reminders.

### Later or needs a decision
- F11 Siri / Shortcuts quick logging (already built and paused by the owner): revisit with one manual shortcut, the Action Button or Back Tap.
- F12 Wake windows / next nap estimate: only meaningful from about two months; often criticized as inaccurate elsewhere.
- F13 Push notifications ("the other parent logged a feed", vitamin D reminder): iPhone home-screen apps can receive web push, but
  someone must send it; that needs a small extra server with signing keys. Not planned unless the owner accepts that.

### Not possible or not wanted
- Home-screen / lock-screen widgets, Live Activities, Apple Watch app, haptic feedback, local scheduled reminders: not available to
  iPhone web apps.
- In-app calendar (owner's decision), ads, accounts, anything that sends data anywhere except the owner's sheet.
