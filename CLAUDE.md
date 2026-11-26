# BabyLog: working guide for Claude

A shared baby log for two parents, live and used daily on two iPhones: a Preact PWA (Hebrew, RTL), a Google Apps Script server
over the owner's private Google Sheet, GitHub Pages, everything deployed by GitHub Actions; other families each get a server of
their own. Status, how to resume and the owner's standing approvals and hard rules: `docs/PROGRESS.md` (read it first; its
"Resume prompt" holds the full rules). Design: `docs/ARCHITECTURE.md`. History with reasons: `docs/CHANGELOG.md`.

## How the work is run (owner, 26 November 2026)
One conversation runs the development and talks with the owner. It does the work itself with the domain skills, hands bounded
work to agents, and closes every task with the `close-task` skill.

- **Domain skills** (`.claude/skills/`): load the skill of the area before working in it; a task that crosses areas loads every
  skill it touches (`npx tsx scripts/skills-check.ts` maps changed files to skills).
  - `features`: everything a parent sees: screens, wording, insights, medicines, bottles, sleep, Siri phrases (the fallback owner).
  - `performance`: the sync engine, the server's request path, the quota, sync logs and timings.
  - `families`: other families' servers, the families job, admin key, usage totals.
- **Agents** (`.claude/agents/`), for work with a clear end that needs no decision from the owner on the way:
  - `perf-analyst`: reads one sync log or TIMING table against the baseline (read-only).
  - `change-reviewer`: reviews a diff against every skill it touches before pushing (read-only).
  - `ci-investigator`: a failed pipeline run or a flaky test, reproduced locally.
  Brief an agent with the goal, what is already known, and the files; it answers in a fixed format (Answer, Evidence, Not
  verified, Learned, Files touched). Check its findings before acting on them or keeping them (`close-task` step 5).
- **A separate session** only for a large piece that spans several sessions (for example a whole stage of a plan): it loads the
  skill of its area and follows "Sessions in parallel" in `docs/PROGRESS.md`; its lessons come back through `close-task`.
- **Every task ends with `close-task`**: the changelog entry, the skills it touched re-read and corrected, the traps it met
  added to them, `docs/PROGRESS.md` current. A task is not done before that, and the report to the owner says what the guides learned.

## Keeping the conversation light
- Long searches and reads across many files go to an agent (`Explore`), so the conversation keeps conclusions, not file dumps.
- The state of the work lives in files (`docs/PROGRESS.md` "Where we are"), never only in the conversation: after a compaction
  or in a new conversation, the files alone are enough to continue. A paused task writes its state there before switching.

## The routine for every change (details in the resume prompt of `docs/PROGRESS.md`)
Small step -> a regression test that fails without the change (break the fix once to prove it; check the broken build still
compiles) -> `npm test`, `npm run typecheck`, `npm run build && npx playwright test --trace off` (also `MOCK_DELAY=250` for timing,
heights 852 / 700 / 560 for layout) -> commit -> fetch and merge `origin/dev` -> push to `dev` -> `bash scripts/ship.sh <sha7>` in the
background -> live site serves the commit, "LIVE TEST PASSED", "prod server deployed" -> `close-task`.

## Rules for every task
- The repository is public: never write names, e-mail addresses, device models, the baby's name, keys, script or deployment ids
  or server addresses into code, docs, commit messages or logs. Screenshots from the owner may show names: never copy them.
- For anything new: research, propose (screenshots of the real app when visual), wait for the owner's decisions, then build.
- Never force-push or rewrite pushed history; no changes to repository settings, secrets or collaborators.
- Commits are authored as `Claude <noreply@anthropic.com>` (`git config user.name Claude && git config user.email noreply@anthropic.com`).
- Reports to the owner are in Hebrew.

## Learned across domains (one line each: what happened -> the rule)
- One Playwright run at a time, the main conversation and agents together: every run uses the mock servers on ports 8787 to 8790,
  and two runs reset each other.
- Push to `main` only when BOTH `dev` reports (test and server) say "success" for that commit; find a commit's own reports on
  `ci-status` by its sha (the newest file may belong to the other branch).
- When breaking a fix to prove a test, check the build still compiles: a failed build leaves the old build and the test "passes".
- Wait in tests for a condition, not a fixed time, unless the test checks that something does NOT happen.
