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
