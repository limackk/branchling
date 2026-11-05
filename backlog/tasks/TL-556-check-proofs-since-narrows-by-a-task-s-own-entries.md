---
id: TL-556
title: "check --proofs --since narrows by a task's own entries"
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
conflict_group: [proofs]  # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-04
updated: 2026-11-05
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: since-narrows
    bash: "node --test scripts/tests/proofs.test.mjs"
---

## Goal

check --proofs --since keeps only the closings whose own files or own commands the range touched, and runs the project closing entries once when anything is kept.

## Context

In scripts/check-backlog-proofs.mjs, touchedByRange is given c.entries, which includes the project entries that closingContractOf appends (TL-497). As soon as the range touches a path named in a project closing_contract entry, every proven closing is kept, so --since narrows nothing.

## Steps

1. Judge the range against a task's own entries only
2. Run the project entries once when at least one closing is kept
3. Add a fixture with a project entry naming a touched path

## Acceptance criteria

- [ ] With a project entry naming a touched path, --since keeps only the closings whose own entries the range touched. [proof: since-narrows]
