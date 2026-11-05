---
id: TL-549
title: "The exit lines in --help say that no backlog exits 1"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-4
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-04
updated: 2026-11-05
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: help-exit-lines
    bash: "node --test scripts/tests/help-exit-lines.test.mjs"
---

## Goal

Every --help text whose exit line lists 2 as usage also says that no backlog, or a named directory that is not one, exits 1, and a guard keeps the help lines in agreement with docs/external-consumers.md.

## Context

TL-546 made both resolution refusals exit 1 from every command. The `exit:` lines of the --help texts (take, next and audit, for example `0 clean · 1 findings · 2 usage`) still describe only the command's own outcomes, so a reader of --help cannot learn that 1 also means no backlog. docs/external-consumers.md is the contract a consumer reads.

## Steps

1. Find every --help exit line
2. Add the no-backlog case where it is missing
3. Add a guard comparing the help exit lines with docs/external-consumers.md

## Acceptance criteria

- [x] Every --help exit line that lists usage also covers the no-backlog case, in agreement with docs/external-consumers.md. [proof: help-exit-lines]
