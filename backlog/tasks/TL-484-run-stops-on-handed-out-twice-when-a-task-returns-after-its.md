---
id: TL-484
title: "run stops on handed out twice when a task returns after its new blocker closed"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 3h
confidence: medium                 # how much you trust the estimate
created: 2026-10-26
updated: 2026-10-26
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: run
    bash: "node --test scripts/tests/run.test.mjs"
  - id: suite
    bash: "npm test"
---

## Goal

`branchling run` no longer stops on its spin guard when a task comes back because the run itself closed the new blocker the agent gave it, and a run stopped by the guard says the queue still has work.

## Context

Reported from a downstream repository on 2026-10-26 (branchling 0.1.0). The run stopped with `stopped: AI-536 was handed out twice — the loop stopped rather than spin, and gave the claim back` and sat idle for about 8 hours with work left. Sequence from the task's history, one run, one actor, no roles: (1) `next` hands out AI-536 (`blocked → in_progress`, every task it named is closed); (2) the agent finds a new obstacle, opens AI-540 and parks AI-536 in `blocked` with `blocked_by: [AI-538, AI-540]`; (3) the same run takes AI-540 and closes it; (4) `next` hands AI-536 out again (`blocked → in_progress`, every task it named is closed (AI-538, AI-540)); (5) the guard in scripts/run-loop.mjs keys on `id@role`, sees `AI-536@` twice, gives the claim back to `blocked` and ends the run. The task is left `blocked` with every blocker closed.

The guard exists for a dispatcher that hands out the same task with nothing changed (TL-271, TL-282). Here the tree moved between the two hand-outs: a new blocker was added and then closed. Keying on `(id, role)` alone cannot tell the two apart.

## Steps

1. Read the spin guard in scripts/run-loop.mjs and TL-271, TL-282 for why it keys on (id, role).
2. Make the key include what a legitimate return changes, e.g. the task's `blocked_by` at hand-out or the id of the history entry that discharged its block, so the same task with nothing changed still stops the run.
3. If the guard still stops, name in the report that the queue holds other eligible tasks.
4. Add a test in scripts/tests/run.test.mjs reproducing the five-step sequence with a fake agent: the run continues and closes the task on its second hand-out; and keep the existing test where an unchanged task stops the run.

## Acceptance criteria

- [x] a task returning after its new blocker closed is worked again, and an unchanged repeat still stops the run [proof: run]
- [x] the whole suite stays green [proof: suite]
