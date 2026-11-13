---
id: TL-729
title: "run --plan --json names a waiting wave as a field"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-2
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-13
updated: 2026-11-13
blocked_by: [TL-707]  # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: run-json-plan-waiting
    bash: "node --test scripts/tests/run-plan-waiting.test.mjs"
---

## Goal

`run --plan --json` carries the waiting wave `next` reported as a structured field — its refusal kind, the waiting wave and the ids it waits on — and not only inside the `stopped` sentence.

## Context

TL-707 made `run --plan` act on the refusal kinds `next --plan` returns (`wave-claimed-elsewhere`, `wave-awaits-merge`, from TL-683): `planStop` in scripts/run-loop.mjs now names the kind and the ids in the `stopped` sentence, and `--wait` polls only a wave `next` called waiting. The `run` JSON envelope still has no field for it, so a supervisor that runs `run --plan --json` without `--wait` and must decide between relaunching later and stopping has to parse prose to learn the kind. TL-491 set the precedent for the other waiting state: `heldInOtherTrees` is `{count, ids}` beside the sentence. The answer `next` printed already carries everything needed (`refusalKind`, `plan.claimedElsewhere`, `plan.awaitingMerge`, `plan.waitingBehind`, `plan.spill`); `run` keeps it in the exit-3 branch of its loop and discards it.

## Steps

1. In scripts/run-loop.mjs, keep the last exit-3 answer's waiting state (from `planWaiting(answer)` and `answer.plan`) and print it in the `run` envelope as `planWaiting: {kind, wave, name, claimedElsewhere, awaitingMerge, waitingBehind}`, null when the run did not stop on a waiting wave or ran without --plan
2. Declare the key in the `run` kind of scripts/json-envelope.mjs with a comment that says when it is null
3. Extend scripts/tests/run-plan-waiting.test.mjs: a claimed wave and a merge-awaiting wave fill the field, a nothing-to-take wave and a run without --plan leave it null

## Acceptance criteria

- [x] run --plan --json names a waiting wave's kind and ids as a field, and null otherwise [proof: run-json-plan-waiting]
