# Backlog

Two tracks run side by side: **fixes** (bugs and small annoyances the owner reports from daily use; they always go first) and
**features** (one at a time, in the order the owner picks). Every item still follows the normal routine: small step, regression test,
dev, green CI, main, live version check. Sizes: S = one session, M = one or two sessions, L = several.
No names or private details here (public repository).

## Track 1: fixes and quality of life
Add items here as the owner reports them (date, what was seen, screenshot/recording studied). Move done items to `CHANGELOG.md`.
- In progress **(owner, November 2026)**: (a) done: "undo edit". (b) done: "earlier" buttons in the toast. (c) done: the sleep improvements (forgotten wake-up, length, since when, overlap). (d) done: the wording ("שעת ההתעוררות לפני שעת ההירדמות").
- Slow sync and performance **(owner report)**: diagnosis and a phased plan in `docs/REFACTOR_PLAN.md` (owner: the full plan).
  Phases 0 and 1 are done; the order of the rest is in `PROGRESS.md`. Phase 5 (look and feel): screenshots to the owner first.

- Feedback from the app **(owner, November 2026)**: built (Settings > מתקדם > "🐞 משוב"). The owner pastes the list into a
  session now and then; later, if wanted: a 🐞 shortcut elsewhere, a screenshot with an item, or statuses.

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
| F7 | ~~Medicines (more than one)~~ done | Fever and dosing come up in the first months; "when is the next dose allowed" | M | All four stages live; spec below. |
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

### F7 agreed spec (owner, November 2026)
- **Where:** medicines are managed in Settings ("תרופות" opens a medicines screen). Both parents can do everything. No reminders.
- **Vitamin D** is built in and always there: it cannot be archived. The Home button reads "ויטמין D" while it is the only medicine and
  "תרופות" once others are active; the tile then shows one line: "הכל ניתן" / "חסר: <name>" / "הבאה מ-HH:MM" (warning colour while
  something is missing today).
- **Schedules:** once a day; X times a day (optional minimum gap); every X hours (gap = X); as needed (optional minimum gap, optional
  maximum per day). Clock times are not used for warnings (babies do not keep a clock). "Today" = midnight to midnight.
- **Course** (optional): X doses or X days, counted from the first dose given; missed doses do not count (a dose course simply runs
  longer). When the target is reached the row says so and offers "archive" or "extend by X doses / days". A medicine ends only when it
  is archived by hand. Archived medicines keep their history and can be restored; full delete only before any dose was logged.
- **Window** (Home button when more than vitamin D is active): one big row per active medicine with name, dose, who gave it and when,
  and course progress ("מנה 5 מתוך 14" / "יום 3 מתוך 7"); a tap logs it; the window stays open to mark several; close button and tap
  outside; undo for mistakes. Opening it refreshes from the server first.
- **Warnings** (the only case with an extra tap): too early (within the minimum gap / every-X-hours), today's doses already given
  (once a day, or X times a day reached, or the as-needed daily maximum), course already complete. Shown as a highlighted line in the
  window and as a confirmation after the tap. Applies to vitamin D too (a second dose on the same day asks first), also as the only button.
- **No medical advice:** every field starts empty; a fixed line on the medicines screen: "המינונים והמרווחים לפי הנחיית הרופא או העלון".
- **Other screens:** add-after-the-fact / edit pick a medicine (no warnings for past entries); history shows the medicine's name and
  the filter becomes "ויטמין D ותרופות"; the day summary gets a row per active medicine. Siri unchanged.
- **Changes (owner, later the same day):** vitamin D is added by default but can be archived (after a year it is not needed); a dose
  is an amount plus a unit picked from a wheel (מ״ל, מ״ג, טיפות, יחב״ל, כדור, ...); a course can also run "until a date" (e.g. vitamin
  D until the first birthday), with the same archive-or-extend choice when it ends; the medicine form keeps "חזרה להגדרות" and the
  Settings tab always returns to Settings; Settings is split into sections with icons.
- **Icons (owner):** every medicine has an icon picked from a palette of cheerful ones plus standard ones for those who prefer them
  (☀️ for vitamin D by default, 🧸 included); a new medicine gets an icon no other active medicine uses. Home button: one active
  medicine shows its own icon and name (one tap logs it); several show their icons side by side above "תרופות" (more than three: 🧸);
  none: the button leaves Home.
- **Stages** (each shipped on its own): 1 medicines list in the sheet and server + the Settings screen (Home unchanged) **done**;
  2 Home button, window and tile, without warnings **done** (with the owner's changes to vitamin D, units, icons and "until a date"); 3 warnings and confirmation **done**; 4 history, summary and add-after-the-fact **done**. F7 is complete; next changes come from use.

### Later or needs a decision
- F11 Siri / Shortcuts quick logging **(owner, November 2026: wanted, for logging hands-free while nursing)**: built in English and
  Hebrew with alternative names, an asking shortcut ("יומן תינוק" / "Baby log") and "which side next"; answers in the phone's Siri
  language. Signed on the owner's Mac (58 shortcuts); waiting for the owner's test on the phones.
  Later: more phrasings as the parents find them (duplicate and rename on the phone, or add them to `builder.ts`).
- F12 Wake windows / next nap estimate: only meaningful from about two months; often criticized as inaccurate elsewhere.
- F14 Other families **(owner, November 2026: friends asked; a first step toward a product)**: full plan in
  `docs/MULTI_FAMILY_PLAN.md` (inventory of single-family assumptions, three directions, recommended direction B: one shared
  server with a sheet per family, data in the family's Drive or with the owner; stages; decisions for the owner). Waiting for the
  owner's decisions (section 8 of the plan) before anything is built.
- F13 Push notifications ("the other parent logged a feed", vitamin D reminder): iPhone home-screen apps can receive web push, but
  someone must send it; that needs a small extra server with signing keys. Not planned unless the owner accepts that.

### From the owner's ideas (feedback #2, November 2026)
- **F15 Usage measurement (owner: wanted, with conditions)**: per parent (not per family); no cost to the app's speed (if there
  is any doubt, no measurement); the founder sees everyone's numbers, families included. **Option A built** (counts per parent,
  phone and day in each family's "שימוש" tab; every family's sheet is in the owner's Drive). **Option B, for the families
  session: ask the owner before building** (owner, November 2026): read every family's usage inside the app, under "משפחות
  נוספות" next to their feedback, with each family's admin code (`ADMIN_ACTIONS` would gain a read of the "שימוש" tab), and
  copy all of it at once. Not built; the owner wants to be asked about it.
- **F16 Questions instead of insight cards (owner: liked)**: every insight is a question with a short answer, grouped by topic
  (feeding, sleep, diapers, general, visit); each parent picks the questions that interest them ("בחירת שאלות", "לא להציג
  יותר"), and a "הציעו שאלה" link sends a suggestion through the feedback. Mockups next.
- **F17 Visit journal (owner: valuable)**: visits to the clinic / pediatrician with measurements, notes and "questions for the
  next visit", plus a one-page report for the visit (F9). The owner may send what he wrote at the last visit, as an example of
  the fields (never copied into the repository).
- Age-based "things to watch": postponed **(owner)**. The date of birth is in Settings (done).

### Not possible or not wanted
- Home-screen / lock-screen widgets, Live Activities, Apple Watch app, haptic feedback, local scheduled reminders: not available to
  iPhone web apps.
- In-app calendar (owner's decision), ads, accounts, anything that sends data anywhere except the owner's sheet.
