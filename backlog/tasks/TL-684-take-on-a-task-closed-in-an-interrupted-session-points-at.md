---
id: TL-684
title: "take on a task closed in an interrupted session points at resume"
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
created: 2026-11-10
updated: 2026-11-10
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: take-closed-resume
    bash: "node --test scripts/tests/take-closed-resume.test.mjs"
---

## Goal

`take <ID>` on a task that this actor closed in an unmerged tree names `branchling resume <ID>` in its refusal instead of only telling the caller to reopen it.

## Context

After a supervised-loop session died between `done` and the commit, the resumed loops ran `take` on their own task (TL-645, TL-650 on 2026-11-09 12:48; TL-636 at 17:12; TL-548 on 2026-11-05) and got `✗ branchling take: TL-645 is closed (status: done)` with `Reopen it deliberately — a closed task is a decision, not a free slot.` (scripts/take-task.mjs around line 210). They then read the task file and worked off-tool. `branchling resume` exists for this case (TL-151, TL-272) but was used zero times in those runs, because nothing pointed at it.

## Steps

1. When the closing record's actor is the caller and the closing commit is not on the default branch (or not committed at all), add `→ branchling resume <ID>` to the refusal with a distinct refusalKind
2. Leave the refusal for a task closed by someone else, or closed on main, as it is
3. Test both cases

## Acceptance criteria

- [ ] take on an own, unmerged closing names resume; any other closed task keeps the reopen refusal [proof: take-closed-resume]
