---
id: TL-227
title: "The claim a dispatched run makes records no role"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-03
updated: 2026-09-03
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: the-claim-carries-it
    bash: "node --test scripts/tests/history-role.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
  - id: guards-green
    bash: "node scripts/cli.mjs check"
---

## Goal

The claim a `run` makes on a task carries the role it dispatched on. Today
TL-222's field is written by `take` and by `done`, and the one path a fleet
actually uses — `next`, called by `run` — writes none.

## Context

Measured on the first pipeline run over wave 6, four tasks, `spec` hand:

```
19:07:16 status | agent:spec | role: (none) | next
19:07:16 owner  | agent:spec | role: (none) | next
```

`run` passes `--role spec --role-strict` to `next`, so the dispatcher KNEW the
role at the moment it wrote the claim, and dropped it. The whole stage left no
record of which hand held the work. TL-222 wired `take`, which a fleet does not
call: `next` reaches `takeTask()` directly at `scripts/next-task.mjs:592`.

## Steps

1. `takeTask()` already accepts `role`; `next` passes it.
2. WHICH role: the candidate's own `role:`, and only when the caller declared a
   filter that contains it. A caller that named no role was acting as nobody in
   particular, and the field stays absent.
3. A test in `scripts/tests/history-role.test.mjs` beside the `take` ones, with
   the positive control that a `next` with no `--role` still records none.

## Decisions

**Not the filter, the match.** `--role a,b` may select a task asking for `b`;
the actor was acting as `b` for that task, not as the list. Recording the filter
would put a value in the log that names no single hand.

**A roleless task selected by a role filter stamps nothing.** `next` widens
`--role r` to `r OR no role` unless `--role-strict`; a task caught by that
widening was not worked as `r`, and saying so would be a guess.
