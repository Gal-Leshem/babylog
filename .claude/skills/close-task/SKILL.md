---
name: close-task
description: The closing step of every BabyLog task - after the change is shipped (or stopped), update docs/CHANGELOG.md, docs/PROGRESS.md and the domain skills so the next task and the next conversation start from what was learned. Run it at the end of every task, including fixes, investigations and tasks handed to an agent or to another session; a task is not done until it ran.
---

# Closing a task

Why this step exists: the work runs in one conversation that calls domain skills and agents. Four things get lost unless they
are written down here, every time:
- a long conversation is compacted and forgets details (so the state lives in files, not in the conversation);
- knowledge found while working dies with the conversation (so it goes into the skill that owns the area);
- an agent returns only a summary (so its findings are checked before anything is kept);
- a skill goes stale when the code changes under it (so the touched skills are re-read and corrected on every close).

## Steps
1. **Done means verified.** The routine in `CLAUDE.md` ran (regression test proven to fail without the change, unit and
   browser tests, `dev`, `scripts/ship.sh`, live site, "LIVE TEST PASSED", "prod server deployed"), or the report says plainly
   what was not done and why.
2. **See what the task touched:** `git fetch origin && npx tsx scripts/skills-check.ts origin/main` (use the base the task
   started from). It fails on a path a guide names that no longer exists, lists the domain skills that own the changed files,
   and says whether the guides and `docs/CHANGELOG.md` were edited.
3. **`docs/CHANGELOG.md`:** one entry in the current section: what changed, why, **(owner)** on the owner's decisions, how it
   was tested ("failed without it"), and anything left for later. Keep both sides on a merge conflict.
4. **Each skill the check listed:** re-read it against the change, then:
   - correct every line the change made untrue (a rule, a number, a file, a decision); delete what no longer applies;
   - add the owner's new decisions under "Owner decisions in force" (newest first; history stays in the changelog);
   - add one line under "Learned" for each trap met in this task: what happened -> the rule that avoids it. Only traps that
     cost time or would have caused a bug, not a diary;
   - where the skill was missing something you had to find out, or misled you, fix that now: this is how the skills improve;
   - update "Open" and the "Last reviewed" line (date and the task in a few words).
   A lesson lives in one place: a domain rule in its skill, a design fact in `docs/ARCHITECTURE.md`, a rule for every task in
   `CLAUDE.md` ("Learned across domains"); the others point to it.
5. **What agents brought:** every finding kept from an agent's report (its "Learned" lines, numbers, causes) was checked by you
   first: rerun the command, read the lines it cites, or reproduce. Unchecked findings are dropped or written as "not verified".
   If an agent's brief or report was missing something, improve the agent's file in `.claude/agents/`.
6. **`docs/PROGRESS.md`:** "Where we are" says the state after this task (what is live, what waits for the owner, what is next),
   so a new or compacted conversation can continue from the files alone. Remove what is finished. Update `docs/BACKLOG.md` when
   plans changed, `docs/ARCHITECTURE.md` when the design changed.
7. **Keep the guides small:** a skill above about 150 lines moves history to the changelog or the plan documents and keeps only
   rules, decisions in force, traps and open items.
8. **Commit the guides with the change** (same commit, or a follow-up commit `Guides: ...` before the ship), run
   `npx tsx scripts/skills-check.ts` once more (it must pass: `npm test` runs the same check in CI).
9. **Report to the owner** (Hebrew): what changed, how it was verified, what to do on the phones, and one line on what the
   guides learned ("עדכון סקילים: ...") or "no new lessons".

## Pausing a task instead of finishing it
Before switching to something else, write its state into `docs/PROGRESS.md` "Where we are" (what is done, what is next, the
branch or commit, open questions for the owner). Never leave a half-done task only in the conversation.
