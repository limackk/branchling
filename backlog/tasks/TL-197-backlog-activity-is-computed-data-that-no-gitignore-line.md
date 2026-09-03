---
id: TL-197
title: "The aggregate that is supposed to travel with the project never left this tree"
type: task
labels: [hygiene]
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 30m
confidence: high
created: 2026-09-03
updated: 2026-09-03
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs:
  - .gitignore
verification:
  # NOT "the directory is ignored" — that was this task's original premise and it
  # was wrong. The rollup is meant to be versioned; what must stay ignored is the
  # raw log beside it.
  - id: raw-log-stays-out
    bash: "cd backlog && git check-ignore -q -- activity/TASK-1.jsonl && echo 'the raw activity log is ignored — OK'"
  - id: aggregate-travels
    bash: "cd backlog && git check-ignore -q -- activity/rollup/TL-100.json && { echo 'the aggregate is ignored — it cannot reach a report on another machine'; exit 1; }; echo 'the aggregate is versioned — OK'"
  - id: none-left-behind
    bash: "N=$(git status --porcelain -uall -- backlog/activity/rollup | grep -c \"^??\" || true); test \"$N\" = \"0\" && echo 'every rollup is tracked — OK' || { echo \"$N rollup file(s) written and never committed\"; exit 1; }"
---

## Goal

Every per-task rollup under `backlog/activity/rollup/` is tracked, because the
aggregate is what a report is built from and it is supposed to travel with the
project.

## Context

**This task was filed on 2026-09-03 with the opposite thesis and it was wrong.**
It said the rollup was computed data that law 2 lets you delete, that it was the
only such artefact missing from `.gitignore`, and that the fix was to ignore it.
Its own step 1 said to confirm first that nothing reads it expecting it to be
shared — and that check is what disproved the task.

What the tree actually says, measured on 2026-09-03:

| Where | What it says |
|---|---|
| `scripts/activity.mjs:153` | "raw data stays with the person, **the aggregate travels with the project and goes through review**, because estimate calibration is a fact about the project" |
| `scripts/git-rules.mjs` | `activity/*.jsonl` is ignored; "the per-task AGGREGATE under `activity/rollup/` is deliberately NOT matched by this pattern and stays versioned" |
| `scripts/init-backlog.mjs` | writes exactly that block into the `.gitignore` of every repository `branchling init` touches |
| `backlog/.gitignore:22` | this repository already has that rule — the raw log IS ignored |
| `git ls-files` | 10 rollups tracked, **34 written and never committed** |

So the rule is right, it is applied, and `doctor` is honestly green. The defect
is narrower and duller than the one filed: the files are written as a side
effect of the activity hook, nobody stages them, and 34 of 44 never made it into
a commit. Ignoring them would have made that permanent and turned a bug into
policy.

**Why it matters at all.** `calibration.mjs` (TL-29) builds "what was estimated
against what it measurably cost" from these files. A rollup that stays in one
working tree makes that report a fact about one machine — and, worse, an
incomplete report looks exactly like a complete one.

**The original worry was not baseless, just misdirected.** A per-task file does
not conflict the way `INDEX.yaml` does: `writeRollup`'s own comment says a
branch touches only its own tasks' files, so a conflict there is a real
conflict. And the privacy concern belongs to `activity/*.jsonl`, the raw
calendar, which is ignored — the aggregate is minutes and a session count.

## Pre-flight reading

1. `scripts/git-rules.mjs` — `IGNORE_RULES` and `VIEW_PATHS`, the rule and what
   `doctor` checks against it.
2. `scripts/activity.mjs` around `rollupPath` — the split this task got backwards.

## Steps

1. `git add backlog/activity/rollup/` — the 34 files that were written and never
   committed.
2. Confirm the raw log stays ignored and the aggregate stays out of the ignore
   rules. Both directions matter; this task got them the wrong way round once.

## Acceptance criteria

- [x] `activity/*.jsonl` is ignored — the working calendar does not travel.
      [proof: raw-log-stays-out]
- [x] `activity/rollup/*.json` is NOT ignored — the aggregate does.
      [proof: aggregate-travels]
- [x] `git status -uall` offers no rollup file that was written and never
      committed. [proof: none-left-behind]
