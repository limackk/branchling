---
id: TL-555
title: "Whether task-graph.mjs stays is decided"
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
executor: human  # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 1h
confidence: medium                 # how much you trust the estimate
created: 2026-11-04
updated: 2026-11-04
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: graph-decided
    bash: "node scripts/cli.mjs check --proofs --since HEAD~1"
---

## Goal

A person decides whether scripts/task-graph.mjs is deleted, kept with a caller, or brought back behind a history view, and the four proofs that run it are handled accordingly.

## Context

After TL-530 the shipped viewer no longer calls scripts/task-graph.mjs. It is kept only so that the closing proofs of TL-116, TL-280, TL-311 and TL-414 can be re-run by check --proofs. Deleting it turns those proofs red unless they are retired; keeping it keeps code without a product caller.

## Steps

1. Decide: delete the module and retire the four proofs, or give it a caller
2. Carry out the decision without check --proofs turning red

## Acceptance criteria

- [ ] check --proofs stays green after the decision is carried out. [proof: graph-decided]
