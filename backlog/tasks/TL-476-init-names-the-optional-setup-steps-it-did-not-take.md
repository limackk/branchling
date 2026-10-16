---
id: TL-476
title: "Init names the optional setup steps it did not take"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-10-16
updated: 2026-10-16
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: init-next-steps
    bash: "node --test scripts/tests/init-next-steps.test.mjs"
---

## Goal

The closing lines of `branchling init` name the optional setup steps it did not take, so a new project does not stop at a backlog with no skill and no gates.

## Context

On 2026-10-16 `branchling init --dir backlog` in a fresh repository ended with a single `next:` line pointing at the viewer. It did not mention `branchling skills install` (or `init --skills`) when the skill was not installed, nor `branchling hooks print`, which is the documented way to put the guards on commit. A user who does not already know the tool has no way to discover either from the init output. Only the steps actually skipped should be listed; `hooks` stays print-first, as its help explains.

## Steps

1. In scripts/init-backlog.mjs, after the summary, list each skipped optional step with its command
2. Leave the output unchanged for a step that was taken
3. Assert the listed steps in a test for both the default and the --skills invocation

## Acceptance criteria

- [ ] init names `skills install` only when the skill was not installed and always names `hooks print` [proof: init-next-steps]
