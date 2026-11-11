---
id: TL-671
title: "resume never offers the reserved actor unknown as a remedy"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-3
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-09
updated: 2026-11-11
blocked_by: [TL-628]  # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: resume-unknown-owner-has-a-path
    bash: "node --test scripts/tests/resume-unknown-owner.test.mjs"
---

## Goal

`resume` never answers a task held by the reserved actor `unknown` with a remedy that the next invocation refuses.

## Context

`isClaim()` in scripts/resume-task.mjs treats any value `isValidActor()` accepts as a claim, and `isValidActor()` accepts `unknown` on purpose (history readers and `reconcile()` need it). A task whose `owner:` is `unknown` (written before TL-628 by `take --actor unknown`, or by a hand edit that reconcile recorded) is therefore held by `unknown`: `resume` refuses every other actor, and its remedy line says to resume as `unknown` with `--actor unknown`. Since TL-628 every writing command, `resume` included, refuses a stated `unknown` through `statedActorRefusal()` in scripts/task-fields.mjs, so that remedy is now a usage error and the successor has no path at all. The header comment above `isClaim()` already names this class of defect: a word the predicate lets through but the actor check rejects leaves the successor with nothing to do. Not settled here: whether an owner `unknown` counts as unheld (any successor may resume) or as held with a different remedy (`take --takeover`, `release`); that is the decision this task makes, with its reason.

## Steps

1. Decide how `resume` treats `owner: unknown` and a history `owner` row whose `to` is `unknown`
2. Change `isClaim()` or the refusal remedy so every remedy `resume` prints is one the next invocation accepts
3. Test it through the CLI on a fixture whose task file carries `owner: unknown`

## Acceptance criteria

- [x] resume on a task owned by unknown either proceeds or refuses with a remedy that is not itself refused as a usage error [proof: resume-unknown-owner-has-a-path]
