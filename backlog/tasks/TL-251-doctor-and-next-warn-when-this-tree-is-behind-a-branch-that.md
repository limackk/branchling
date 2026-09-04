---
id: TL-251
title: "doctor and next warn when this tree is behind a branch that closed a task"
type: task
labels: []
board: main
epic: "Harness"
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-09-04
updated: 2026-09-04
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: behind-warning
    bash: "node --test scripts/tests/behind-branch-warning.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"

---

## Goal

`branchling doctor` warns when a task is `done` on another branch or worktree
and still open in this tree, and `branchling next` says the same thing in one
line whenever it skipped at least one such task — so a tree that is behind a
branch that closed work is told so BEFORE it hands out the next task, not after
a person reads `stats`.

## Context

`stats` on 2026-09-04, in a fresh worktree off `main`:

    status differs on other branches:
        TL-211   pending  here; tl-211-wave8-pipeline: done
        TL-213   pending  here; tl-211-wave8-pipeline: done
    only on another branch, not in this tree:
        TL-244 … TL-248

`next` already skips those tasks (`heldElsewhere()` in
`scripts/next-task.mjs`) and lists them under "candidate(s) are in another
state on another branch or worktree". What it does not say is the diagnosis:
this tree is behind a branch that closed work, and the fix is a merge, not a
new task. `doctor` says nothing about it at all — it is the command whose job is
"is this backlog set up correctly", and a tree in which `next` will skip a
closed task is not.

`CLAUDE.md` carries the rule as prose ("a commit does not finish a task —
merging does", with the TL-74 incident). This task is the first output of the
TL-250 audit: a rule that is measurable is measured.

Scope: a WARNING, not a refusal. A wave branch legitimately holds closings for
hours before its merge (TL-240), and a `next` that refused would stall every
parallel worktree. The line names the branch and the count, so a reader knows
whether it is theirs.

## Pre-flight reading

1. `scripts/next-task.mjs` — `heldElsewhere()` and the `elsewhereLines` report
2. `scripts/stats-report.mjs` — `divergences()` and `describeDivergence()`,
   the existing wording to reuse, not duplicate
3. `scripts/branch-scan.mjs` — what the scan can tell about WHICH branch holds
   the closing
4. `scripts/doctor.mjs` — how a warning row is added and counted

## Steps

1. A shared helper — where `divergences()` lives — that answers: which tasks
   open here are in an archived status elsewhere, grouped by branch.
2. `doctor`: one warning row per such branch, `N task(s) closed on <branch>
   are still open here → merge or rebase before taking work`.
3. `next`: when `skippedElsewhere` holds at least one archived-elsewhere task,
   one extra dim line with the same wording; `--json` carries it as a field.
4. The test builds two worktrees in a fixture repository, closes a task in one,
   and asserts the warning in the other; the positive control is that a tree
   with no divergence prints no such line.

## Acceptance criteria

- [ ] `doctor` warns, naming the branch and count, when a task open here is
      archived elsewhere; a converged tree gets no warning. [proof: behind-warning]
- [ ] `next` prints the same diagnosis when it skipped such a task, and
      `next --json` carries it. [proof: behind-warning]
- [ ] Neither command refuses; exit codes are unchanged. [proof: suite-green]

## Decisions

Nothing decided.
