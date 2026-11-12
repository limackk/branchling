---
id: TL-714
title: "A closed task rejected in review can be reopened with a reason"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-12
updated: 2026-11-12
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: reopen-closed
    bash: "node --test scripts/tests/take-reopen.test.mjs"
---

## Goal

A task closed by `done` and then rejected in review can be reopened through the CLI, with a reason, so rework does not proceed on a task the file and history still call proven.

## Context

In run wf_d662ab62-e87 (2026-11-11) a supervisor rejected TL-678 and TL-662 after `done` had already closed them in the loop's worktree: the full suite failed afterwards (colour-dependent stderr). The supervisors reported `take` refuses a closed task and `release` refuses anything not in progress, and `set` refuses `status`; the rework was done on a task still recorded `status: done` with a `proven` closing record. `scripts/take-task.mjs` (the `closed` refusal in `takeTask`) tells the caller "Reopen it deliberately" while no command performs a reopen, so the advice names an action the tool does not have. TL-150 already counts reopenings from the log, so the record shape exists; only the writing path is missing. Decide whether this is a new command or a `take --reopen --reason` flag; either way a reason is required and the history record says the closing was withdrawn.

## Steps

1. Choose the surface (new command or flag on take) and document the choice in the commit
2. Write the transition closed -> in_progress with a required reason and an owner
3. Make the `closed` refusal in takeTask name that command instead of prose

## Acceptance criteria

- [ ] A closed task can be reopened with a reason, the history records the reopening, and the closed refusal of take names the command that does it [proof: reopen-closed]
