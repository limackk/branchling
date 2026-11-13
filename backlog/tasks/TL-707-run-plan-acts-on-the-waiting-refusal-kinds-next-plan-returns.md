---
id: TL-707
title: "run --plan acts on the waiting refusal kinds next --plan returns"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P1                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-1
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-11
updated: 2026-11-13
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: [TL-729, TL-730, TL-731, TL-734]  # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: run-wave-waiting
    bash: "node --test scripts/tests/run-plan-waiting.test.mjs"
---

## Goal

`run --plan` reads the waiting refusal kinds `next --plan` now returns, and can pass `--spill` through to it.

## Context

TL-683 gave `next --plan` two refusal kinds besides `nothing-to-take`: `wave-claimed-elsewhere` and `wave-awaits-merge` (scripts/next-task.mjs, `waveWaiting`), plus an opt-in `--spill` that draws from the next wave while the active one waits on other trees. `run` (scripts/run-loop.mjs) still infers the same state on its own: `planStop` builds its sentence from `plan.open`/`plan.scheduled`, and the `--wait` branch decides `inFlight` from `answer.plan.open > 0` and `heldInOtherTrees`, never from `answer.refusalKind`. `run` also validates its own flags, so `run --plan --spill` cannot reach `next`. Two sources for one judgement can drift apart: a wave `next` calls `nothing-to-take` (a task held back by a role or a protected status) is still treated as in flight by `run --wait` and polled until `--wait-max`.

## Steps

1. In scripts/run-loop.mjs, decide `inFlight` under `--plan` from `answer.refusalKind` being `wave-claimed-elsewhere` or `wave-awaits-merge`, and let `planStop` name the kind and the ids in `answer.plan.claimedElsewhere` / `answer.plan.awaitingMerge`
2. Accept `--spill` on `run` (only with `--plan`), declare it in `run --help`, and pass it through to `next`
3. Test with fixture trees: a waiting wave under `--wait` is polled, a `nothing-to-take` wave ends the run at once, and `--spill` reaches `next`

## Acceptance criteria

- [x] run --plan acts on next's waiting refusal kinds and passes --spill through [proof: run-wave-waiting]
