---
id: TL-557
title: "One task's own proofs can be audited without the project entries"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-2
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: [proofs]  # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-04
updated: 2026-11-05
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: own-proofs
    bash: "node --test scripts/tests/proofs-own-only.test.mjs"
---

## Goal

There is a documented way to re-run one task's own proofs without the project closing entries, and the loop instructions name it.

## Context

Since TL-497, check --proofs runs the project closing_contract, which in this repository is the whole test suite. An agent working under a 'targeted tests only' rule, as in parallel loops, can start a full-suite run by accident through it (it happened during TL-496).

## Steps

1. Add an option such as --task <id> --own-only to the proofs audit
2. Name it in `instructions autonomous-loop` and task-execution
3. Test that it runs no project entry

## Acceptance criteria

- [x] The own-only audit of one task runs that task's entries and no project entry. [proof: own-proofs]
