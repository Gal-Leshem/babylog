# Plan: opening BabyLog to other families

Status: **proposal, nothing built.** Written November 2026 from a full read of the code, at the owner's request ("friends asked to use
the app; each couple gets a key and their own log in their own Google Drive, on my app; optionally the data could live with me instead;
a first step toward making it a product"). Replaces the short note F14 in `BACKLOG.md`. Each stage below ships on its own and follows the
normal routine (regression test proven to fail without the change, unit + browser tests, dev, green CI, main, live check).
Privacy rule as everywhere: no names, addresses, ids or keys of any family in this repository.

## 0. Current proposal: one server per family (supersedes the shared server of section 4 for now)
After reading the risks the owner set the priorities: **the owner's own family must not be affected at all (performance above all)**,
**security: nothing may leak between families**, and at most two or three more families for now. That changes the best shape of B:
instead of one shared script that tells families apart by key, **every family gets its own copy of today's server**: its own sheet
with its own bound Apps Script, its own web app address, its own key, its own script properties and its own lock, all created and
updated by the pipeline with the owner's account, exactly as the test and production servers are today.
- The owner's server and sheet stay exactly as they are: same code path (`getActive()`, no family lookup, no `openById`), same
  address, same key, same Siri files. A family's request never reaches the owner's script, so it cannot slow it or take its lock.
- Isolation by construction: different address, key, sheet and script. No code decides "which family is this", so no bug in such
  code can open another family's data.
- Almost no server change: the same bundle is deployed N times. Joining uses today's `BL1.` code and today's install screen (names,
  baby, "who am I").
- Shared by all, because they are one Google account: the daily limits (50,000 property operations, 30 executions at the same time).
  Owner plus three families is roughly 6,000 operations a day, far below; the limit is per day and only means errors until the next
  day, so the pilot measures it.
- Deploy order: test server and live test (as today) → the owner's production (as today) → the families' servers in a separate job
  after it, so a family's deploy can never delay or break the owner's.
- Cost per family for the owner: once, open the new script and run `setup` (Google asks the account owner to approve each new script
  once; about three minutes), then send the printed code to the family privately.
- Up to about ten families this is simpler and safer than a shared server; past that, section 4 (one shared server) or direction C.
- Data location (owner's decision): every family starts with its sheet in the owner's Drive; "move the sheet to my Drive"
  (ownership transfer) is prepared but hidden, to be offered later.
- Feedback (owner's decision: families only send, the owner reads and deletes, no e-mail): each family's items stay in its own
  sheet's "משוב" tab, and the owner's phone reads and deletes them by asking each family's server with an admin key (a second
  property, `ADMIN_KEY`, that allows only the feedback list and its deletion, never the log). Reason: every script keeps the
  narrowest Google permission it has today (`spreadsheets.currentonly`: only its own sheet). A shared feedback sheet would need the
  permission to open any sheet of the owner's account, so a family's script could then reach the owner's log. With a family's key
  the server accepts "send" only. The owner's phone keeps the list of family servers (address + admin key) on the phone itself.

Stages for this shape:
| Stage | What | Size |
|-------|------|------|
| 1 | Pipeline: a list of family slugs (random, never names) in the repository; the deploy creates and updates one sheet + script per family after production, in its own job; ids saved like today's on `ci-status`; unit tests for the deploy logic. Nothing changes for the owner | S-M |
| 2 | First friendly family: the owner runs `setup` in its script, sends the code; app texts made family-neutral; a short Hebrew family guide; a privacy page; the sheet link hidden for families; the ownership-transfer button prepared behind a switch | S |
| 3 | Feedback: families only send; the owner's phone lists, copies and deletes the items of every family through each server's admin key | S |
| 4 | Pilot with two or three families; measure the shared limits and the owner's own timings (sync log) before and after | ongoing |

## 1. What "like the owner" means
A family should get, with no technical steps: the app on both phones, one-tap logging, two-phone sync, their own Google Sheet they can
open and connect to an AI assistant, the medicines and insights screens, feedback from inside the app, and (later) Siri.
The owner should get: control over who joins (an invitation code), one deployment that updates everybody, the feedback of all
families in one place, and no extra work per family after the invitation.

## 2. What assumes a single family today (inventory)
The client app is almost family-neutral already: it talks to whatever address and key its setup code names, keeps its copy on the
phone, and takes names, the baby's sex and the medicines from the sheet. The single-family assumptions are on the server side and in
the setup path.

| Area | Today | What must change |
|------|-------|------------------|
| Server | One Apps Script project bound to one sheet (`SpreadsheetApp.getActive()` in `gas.ts`); deployed by the pipeline with the owner's credential | The server must find the family from the key and open that family's sheet (`openById`) |
| Key | One secret in the script property `API_KEY`, shared by both phones and the Siri files; `rotateKey()` / `printInstallCode()` run by hand in the editor | A family id plus a secret per family; only a hash of each secret is stored; invite, rotate and disable without the editor |
| Per-family state | `REV`, `JOURNAL` (8 KB), `SETTINGS_REV`, `SETTINGS_JSON`, `FEEDBACK_SEQ` in script properties; every request reads all properties in one call | Script properties hold at most 500 KB in all and are limited to 50,000 reads/writes a day on a free account (section 5): per-family state has to move (cache + the family's own sheet) |
| Lock | One script lock (`LockService.getScriptLock()`) around every write | Fine for tens of families (writes take 0.3 to 1 s); keep, and measure. Apps Script has no per-family lock |
| Setup | `setup()` creates tabs and the key; the app's install screen asks for a `BL1.` code and the names | Invitation code → a short wizard in the app (baby, sex, parents, where the data lives) → the server creates the sheet. The second parent joins with a code from the first parent's Settings |
| Feedback | Items go to the family's own "משוב" tab; the owner pastes the list into a session; "clear" empties it | Items from every family go to one inbox the owner reads; each family sees only its own items and their status; only the owner clears or marks them |
| Siri | 58 shortcuts signed on the owner's Mac with the URL and key inside (`sign.sh`) | Families have no Mac and no repository: see section 4.6 |
| Install guide | `INSTALL.he.md` is for the owner (GitHub Pages, Apps Script, `setup`) | A three-step family guide; the owner's guide becomes the operator's guide |
| Site address | GitHub Pages under the owner's account name | Fine for friends. A product needs its own domain and name (section 7) |
| Time zone, language | Israel time (`TZ_NAME`) and Hebrew everywhere | Fine for Israeli families. Other countries are a separate, large change (later) |
| Pipeline and tests | Test and prod servers, a live test against the test server with a fixed CI key | The live test also proves that one family's key can never reach another family's data |
| Privacy guard | A word list of the owner's private words | Unchanged; other families' data must never appear in reports or logs (the reports already carry no data) |

## 3. Three directions

### A. Every family runs its own copy ("self-hosted")
How: a template sheet with the script inside, shared as a "make a copy" link. Each family copies it, opens the script editor, runs
`setup`, deploys a web app (Execute as me, Anyone), clicks through Google's "unverified app" warning, and pastes the printed code into
the app. Data: theirs alone; nobody else, the owner included, can reach it. Owner infrastructure: none.
- Good: full privacy; Google limits are per family; no responsibility for others' data; small change to the code.
- Bad: about ten technical steps per family with a scary warning; every server update has to be installed by each family by hand
  (or the copy loads the server code from the site at run time, which is fragile and gives the owner's site the power to run code in
  every family's account); no central feedback without extra work; support load grows with every family.
- Fits: two or three technical friends. Does not lead to a product.

### B. One shared server, a sheet per family ("multi-family Apps Script") — recommended now
How: the owner's existing production Apps Script becomes multi-family. A registry (a tab in an admin sheet in the service account)
lists the families: id, status, sheet id, where the data lives, a hash of the secret, created, last seen. Each request carries the
family id and secret; the server checks them, opens that family's sheet and runs the same `handle()` from `core.ts` (unchanged) over a
`SheetStore` for that sheet. The owner's own family stays family number 1 on the sheet bound to the script, and its current `BL1.` key
keeps working, so the owner's phones and the 58 signed Siri shortcuts need no change at all.
Where the data lives, chosen per family in the wizard (the owner's request):
- **"בגוגל דרייב שלכם"** (default): the server creates the family's sheet and hands its ownership to the Google account the family
  names (Google sends them a request; they accept it once in Drive). The file then sits in their Drive, counts against their storage,
  they can open it, export it, connect an AI assistant, or delete it. The service keeps editor access, which the app needs to work.
  If they do not accept, the file simply stays shared with them. To be checked in a spike: ownership transfer between two free Google
  accounts from Apps Script (Drive API "pending owner"); fallback: share the file with them as an editor only.
- **"אצל BabyLog"**: the sheet stays in the service's Drive; the family gives no e-mail address (fastest start); the Settings link
  to the sheet is hidden (or view-only on request). The owner holds the data and is responsible for it.
Honest note for both modes: like any cloud app, the server (and so the owner) can technically read what passes through it. Only
direction A keeps the owner out completely.
- Good: reuses about 95% of today's code and the whole pipeline; one deployment updates everybody; the setup for a family is an
  invitation code and a few fields; central feedback is easy; the owner's daily use is untouched; costs nothing.
- Bad: speed stays what it is now (1.5 to 2.5 s for an opening with news; the Apps Script floor); Google's limits are those of ONE
  account for all families (section 5); everything runs under one Google account (if it is suspended, every family stops, though the
  sheets stay); responsibility for other families' data (section 7).
- Fits: friends and friends of friends, up to a few dozen families on a free account, a few hundred after the state moves out of
  script properties and on a Workspace account.

### C. A real backend with "Sign in with Google" ("product")
How: a small server outside Google (for example Cloudflare Workers or Google Cloud Run, both TypeScript) with a small database for
the registry, revisions and invitations. The same `core.ts` runs there unchanged over a new `Store` that talks to the Google Sheets
REST API. A family signs in with Google once and grants only the "files this app created" permission (`drive.file`); the server
creates their sheet in their Drive and keeps a refresh token to write to it. "With BabyLog" mode stores the data in the database
instead. Requires a domain, a privacy policy and terms, and Google's consent-screen (brand) review.
- Good: fastest (a server answers in about 0.2 to 0.5 s instead of Apps Script's floor); a clean "your Drive" story with no ownership
  transfer; sign-up without a code if wanted; scales to thousands; room for payments, usage numbers and an admin dashboard later.
- Bad: the largest piece of work (several sessions); the owner runs a real service: holds tokens to families' files, pays a little
  (free tiers cover hundreds of families; about $5 a month beyond), answers for uptime and security.
- Fits: a product. The phones do not care: the app protocol (`sync`, the key in every request) stays the same, so moving from B to C
  later is a server swap plus one automatic move on each phone (section 4.8).

### Comparison
| | A: own copy | B: shared Apps Script | C: real backend |
|---|---|---|---|
| Steps for a family | ~10, technical, a warning screen | invitation code + 4 fields (+ accept the file in Drive) | Sign in with Google + 4 fields |
| Data | theirs only | their Drive (owned by them) or the owner's Drive | their Drive (app files only) or the owner's database |
| Owner can technically see data | no | yes | yes |
| Updates | per family, by hand | once, for all | once, for all |
| Central feedback | extra work | easy | easy |
| Speed | as today | as today | faster |
| Capacity | unlimited | tens (free account) to hundreds | thousands |
| Owner cost | 0 | 0 (Workspace about $7 a month if needed) | ~0 to $5 a month + domain |
| Work | S | M (about 4 sessions) | L (about 8 or more) |

**Recommendation:** B now, built so that C can replace the server later without touching the phones. Keep A as an answer for a
friend who insists that nobody can see the data.

## 4. Direction B in detail

### 4.1 Families and keys
- A family code `BL2.` + base64url `{u: server address, f: family id, k: secret}`. The family id is short and random (e.g. `f7k3q9`),
  never a name. The secret is 32 random characters; the registry keeps only its SHA-256 (`Utilities.computeDigest`), so neither a
  leaked admin sheet nor a report reveals keys. `BL1.` (no family id) means family number 1, the owner's, exactly as today.
- Every request carries `fam` beside `key` (the app adds it in `callApi` and `sendAway`; the Siri files add it too). An unknown or
  disabled family and a wrong key all answer `unauthorized`, after the same work, so the answer does not reveal which families exist.
  Wrong keys are counted per family in the cache; after many in a short time the family is refused for a few minutes.
- Rotate per family (old code stops on both phones and in Siri; both phones get the new code from the one that rotated, or the owner
  sends it), disable / enable per family (owner), and "leave and delete" (family; section 4.5).
- Later, if wanted: a key per phone, so a lost phone can be cut off without a new code for the other parent.

### 4.2 Per-family state out of script properties
Script properties are read in one call per request and are capped (500 KB in all, 50,000 operations a day on a free account), so
with many families they become the bottleneck. New families keep their state like this; family number 1 stays on script properties
until the pilot proves the new way, then moves too:
- **Revision**: a value that only grows (time in ms plus a counter), so a lost cache can never make an old revision look new. Hot copy
  in `CacheService` (one cache read per request instead of the properties call); durable copy in the family's own sheet (developer
  metadata or a hidden `_state` tab), written together with the data under the lock.
- **Journal of recent changes** (`journal.ts`): in the cache only. If the cache drops it, the next phone gets the full list, which is
  the existing, tested fallback.
- **Settings copy**: in the cache, keyed by the settings version, as today with properties.
- **Feedback numbers**: one global sequence in the admin sheet (section 4.4).
- **Registry lookups**: cached per family id for a few minutes; disabling a family clears its entry.
`gas.ts` gets a small `FamilyState` interface (revision, journal, settings copy) with two implementations: script properties (family 1,
today's behaviour) and cache + sheet (everyone else). `core.ts` does not change.

### 4.3 Joining
1. The owner creates an invitation in an admin screen on the owner's phone (Settings > מתקדם > "משפחות", visible only with the admin
   code): a short code such as `BLI-7K3Q-9XPA`, single use, valid for 14 days, with an optional label only the owner sees ("from work").
   Shared with a ready-made message: the site address, the code, and the three steps.
2. The family opens the site in Safari, adds it to the home screen, opens it from the icon, and types the invitation code (a
   home-screen app does not keep a link's contents, so the code is short and typeable).
3. Wizard: baby's name, boy / girl, the two parents' names, "who am I", and where the data lives ("בגוגל דרייב שלכם" with a Google
   address, or "אצל BabyLog"). One screen each, same look as today's install screen.
4. The server marks the invitation used, creates the family and its sheet from the same tabs `setup()` makes today (Events, Settings,
   Medicines with vitamin D, קרא אותי), starts the ownership transfer when asked, and returns the family code. The app configures
   itself with it; nothing to copy.
5. Settings > "הורה נוסף" shows the family code as text and as a QR code, with "share" (WhatsApp, Messages). The second parent opens
   the site, adds it to the home screen and pastes or scans the code; the names are already filled in, as today.
The current `BL1.` path stays for the owner and for direction A.

### 4.4 Feedback
- Every family's items go to one "Feedback" tab in the admin sheet: global number, created, family id, the family's own label if the
  owner gave one, parent name, kind, text, app version, optional sync log, status (new / seen / done / won't do), the owner's reply.
- In the app a family sees its own items with their status and the owner's reply; the owner (admin) sees all of them, filtered by
  family or status, and "copy" keeps working for pasting into a session (numbers stay unique, so repeats are still recognised).
- "Clear" becomes the owner's "mark as done" (items are kept); families cannot delete. The family's own "משוב" tab is no longer used;
  family 1's existing items are moved once.
- Text in the screen says that feedback goes to the app's maker, with the sync log only when ticked.

### 4.5 Privacy, data and leaving
- A short in-app page "פרטיות ותנאים" (where the data is, who can see it, what the maker sees: feedback only, plus the technical
  access the server needs; no ads, no selling, no medical advice), shown in the wizard with a checkbox.
- Settings > "מחיקת המשפחה" (both parents can; two confirmations): the family is disabled; in "your Drive" mode the service's access is
  removed and the file stays theirs; in "with BabyLog" mode the sheet goes to the service's trash, then is deleted after 30 days. Export
  first: "download a copy" (the sheet as Excel / CSV through a Drive export link, or a JSON from the server).
- Nothing about families goes into the repository, CI reports or logs: the reports already contain no data; the live test uses a test
  family on the test server only.
- Use a separate Google account for the service if possible (decision 2): the files of other families then never sit in the owner's
  personal Drive, the ownership-transfer e-mails come from a neutral name, and the limits are not shared with the owner's own use.

### 4.6 Siri for families
1. First: the owner runs `sign.sh` with the family's code on the Mac and sends the folder privately (works today; the code now holds
   `fam`; the builder adds it to every request). Costs the owner a few minutes per family and again after a key rotation.
2. Then (spike on a real phone): one generic set of signed shortcuts hosted on the site with no key inside, each asking for the family
   code once when it is added (Shortcuts "import questions"). A smaller set for families (about 8: the asking "יומן תינוק" plus the most
   used) so the code is pasted only a few times. Whether import questions survive signing and work on current iOS is unknown.

### 4.7 What changes in the app
- `config.ts`: `BL2.` codes (`fam`); `api.ts`: `fam` in every request.
- `Install.tsx`: the invitation path and the wizard (new screens, same style), next to the existing code path.
- `Settings.tsx`: "הורה נוסף" (code + QR), "פרטיות ותנאים", "מחיקת המשפחה", the admin section for the owner; the sheet link hidden in
  "with BabyLog" mode.
- `Feedback.tsx`: status and replies; "mark done" instead of "clear" for the owner.
- Wording that talks about "the server's Setup" goes; everything else (Home, History, Summary, Insights, Medicines) is unchanged.

### 4.8 Moving a family to another server later
The server can answer any request with `moved: {code}`; the app then reconfigures itself with the new code and goes on (the queue is
kept, every operation has an id, so nothing is lost or doubled). This makes a later move to direction C, or to a dedicated service
account, invisible to the parents. Siri files would still have to be replaced.

### 4.9 Tests
- Unit: the registry, code parsing, hashing, the `FamilyState` implementations (a lost cache falls back correctly; the revision never
  goes back), invitation rules (single use, expiry), feedback statuses.
- The Apps Script bundle in the fake Google runtime (`gas-fake.ts`) with two families: **a key of family A never reads or writes
  family B** (with the fix broken once to prove the test), `BL1.` still reaches family 1, a disabled family is refused.
- Browser: the invitation wizard at heights 852 / 700 / 560, day and night; the partner code; a `moved` answer; feedback status.
  The mock server becomes multi-family.
- Live test on the test server: creates a test family from a test invitation, logs, syncs, checks isolation from the test family 1.

## 5. Limits and capacity (direction B)
Google's published limits for Apps Script (they can change without notice): 50,000 property reads/writes a day on a free account
(500,000 on Workspace), 30 executions at the same time per user, 6 minutes per execution.
Estimate per family: a parent opens the app about 20 times a day; each opening checks every 5 s for two minutes, then every 15 s:
roughly 500 requests a day per phone, 1,000 to 1,500 per family. Today each request reads the properties once, so a free account
would run out at about 35 to 50 families, sharing the budget with the owner's test server and CI. With the state in the cache (4.2)
the properties are touched only by family 1 and the limit stops mattering. 30 executions at once is about 30 requests a second at
today's server times: enough for hundreds of families. The real numbers come from the pilot (server timings are already in every answer).

## 6. Stages
| Stage | What | Size |
|-------|------|------|
| 0 | Owner decisions (section 8) and four spikes: ownership transfer between free accounts from Apps Script; `openById` time per request; `CacheService` behaviour under load; a signed shortcut with an import question on a real phone | S |
| 1 | Server: registry, `BL2.` codes with hashed secrets, `FamilyState` (cache + sheet), sheet per family, isolation tests, test server and live test with two families. Family 1 unchanged | M |
| 2 | Joining: invitations and the admin section on the owner's phone, the wizard, data location (both modes), partner code with QR | M |
| 3 | Feedback inbox with statuses and replies; family 1's items moved | S |
| 4 | Family guide in Hebrew, privacy page, "delete the family" and export, Siri by owner signing | S |
| 5 | Pilot with two or three friendly families for two to three weeks; measure quotas and timings; fix what they report | ongoing |
| 6 | Later, if it becomes a product: direction C (section 7) | L |

## 7. Toward a product (direction C and the rest)
- Server: TypeScript on Cloudflare Workers or Cloud Run, `core.ts` as is, a Sheets REST `Store`, a small database for the registry,
  revisions, journals and invitations; Google sign-in with only `drive.file`; families moved over with `moved`.
- Name, domain (a custom domain on GitHub Pages at first), an e-mail for support, a privacy policy and terms; Google consent-screen
  brand review (needs the domain and the policy).
- Law: information about a baby's health (medicines) counts as especially sensitive under Israel's privacy law (amended in 2025);
  before opening beyond friends or charging money, a lawyer should look at the policy, security and what is stored where.
- Payments, usage numbers per family, an admin dashboard, other time zones and languages: only when there is demand.
- What stays impossible for a home-screen web app on iPhone (widgets, Live Activities, local reminders) stays impossible; a native app
  would be a different project.

## 8. Decisions for the owner
Taken (owner, November 2026):
1. Direction **B** for now. Families owning their data later: yes, through "move the sheet to my Drive" (below) and direction C.
2. The service runs on the owner's **current Google account** (family 1 unchanged; no migration).
4. **Only the owner invites.**
6. **Siri for families later** (Siri itself is not yet tried on the phones).

Taken later the same day: 3. option "everyone starts with BabyLog", the move-to-my-Drive button prepared for later; 5. the proposed
inbox, no e-mail for now; and, after reading the risks, one server per family (section 0).

Earlier wording of the open points:
3. Data location, refined proposal: every family starts "with BabyLog" (no e-mail, no transfer to accept: the shortest start), and
   Settings offers "העברת הגיליון לדרייב שלי" at any time (ownership transfer; the service keeps editor access). The alternatives:
   the family chooses in the wizard; the owner chooses per invitation; one mode only.
5. Feedback, proposed: one inbox in the admin sheet for every family (family 1 included); a family sends and sees "נשלח, תודה",
   nothing more (no status, no list); the owner reads, copies and deletes in the admin section on the owner's phone (numbers are never
   reused); optionally an e-mail to the owner for each new item (`MailApp`, a few lines). Simpler alternatives: e-mail only (no
   inbox, no list in the app; loses the copy-for-a-session list) or a WhatsApp message (no server; the owner's number would have to
   live outside the repository).
7. Free for friends; payment is for later.

## 9. Open risks
- Ownership transfer between free Google accounts from a script, and how clear Google's e-mail is to a non-technical parent.
- `openById` on every request may add time compared with today's bound sheet (measure in stage 0; the bound sheet stays for family 1).
- One script lock for every family's writes: fine at tens of families; at hundreds, writes of different families wait for each other.
- All families depend on one Google account and on Apps Script staying open to anonymous web apps.
- Shortcuts import questions with signed files: unknown until tried on a phone.
