---
id: TL-742
title: "The closed refusal of body names the reopen command"
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
created: 2026-11-14
updated: 2026-11-14
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: body-closed-route
    bash: "node --test scripts/tests/body-task.test.mjs"
---

## Goal

The closed-task refusal of `body` names the command that withdraws the closing, as the refusals of `take` and `handoff` do.

## Context

`scripts/body-task.mjs` (around line 214) refuses a closed task with the prose "A closed task is a record of what was decided; reopen it deliberately before rewriting it." and names no command. TL-714 made the `closed` refusal of `take` print `take <ID> --reopen --reason "…" --actor <actor>` as a `next:` route, and TL-737 did the same for the `closed-unmerged` refusal of `take` and the `closed` refusal of `handoff` (scripts/handoff-task.mjs). `body` is the remaining refusal of that kind that speaks only in prose.

## Steps

1. Add the `take <ID> --reopen --reason "…" --actor <actor>` route as a `next:` entry of the closed refusal in body-task.mjs
2. Render it through `failure()` and append it to the `--json` details, as take and handoff do
3. A test runs `body` on a closed task, finds the route in stderr and in the envelope, and runs it as printed: the task is reopened

## Acceptance criteria

- [ ] The closed refusal of body prints the reopen command, and running it as printed reopens the task [proof: body-closed-route]
