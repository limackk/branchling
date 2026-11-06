---
id: TL-602
title: "The guide deletion control also removes wrapped invocations"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-06
updated: 2026-11-06
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: wrapped-deletion-control
    bash: "grep -q '\"resume\"' scripts/tests/instructions-coverage.test.mjs && node --test scripts/tests/instructions-coverage.test.mjs"
---

## Goal

The line-deletion control in scripts/tests/instructions-coverage.test.mjs deletes every guide invocation TL-589 added, including one wrapped across two source lines, so its claim that each added line is proven covers `resume` too.

## Context

TL-589 added a control that removes each newly added guide line from scripts/instructions.mjs and asserts the coverage guard then reports exactly that command. The needle is a single-line regular expression (`{{tool}} <command>`), and the `added` list at scripts/tests/instructions-coverage.test.mjs:183 leaves out `resume`, because its only invocation wraps `{{tool}}` and `resume <ID>` across scripts/instructions.mjs:736-737. The Wave B review removed that invocation by hand and the guard reported exactly ['resume'], so coverage holds today; what is missing is the automated control, and the implementer's report that every added line had been deleted overstated it. Any later guide line that wraps an invocation would slip past the control the same way.

## Steps

1. Make the deletion control match an invocation whose tool placeholder and command name sit on adjacent lines (for example by deleting the line pair, or by matching on the joined text with line offsets), rather than a single line.
2. Add `resume` to the `added` list and confirm the control reports exactly ['resume'] when its invocation is removed.
3. Add a positive control: a fixture guide text with a wrapped invocation that the deletion helper must remove.

## Acceptance criteria

- [ ] The deletion control includes `resume`, handles an invocation wrapped across lines, and the coverage test passes [proof: wrapped-deletion-control]
