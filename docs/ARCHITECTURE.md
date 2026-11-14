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
Operations queue in `localStorage`; the view is `server copy + queue replayed`. Refresh happens on open,
every minute, and when the connection returns; a refresh answer that raced with a send is discarded.
Refused operations are dropped with a visible message; connection problems retry with back-off.

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
