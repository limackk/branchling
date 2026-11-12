---
id: TL-690
title: "new --body-file says the file is the JSON task document"
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
created: 2026-11-10
updated: 2026-11-12
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: new-body-file-json
    bash: "node --test scripts/tests/new-body-file.test.mjs"
---

## Goal

The help line for `new --body-file` states that the file holds the JSON task document, and a non-JSON file is refused with a message naming the expected shape.

## Context

On 2026-11-09 an agent passed a markdown body to `new --body-file` and got `not valid JSON: Unexpected token '#'`; the flag's name suggests a markdown body. The help text is in scripts/cli.mjs around line 920.

## Steps

1. Reword the help line to say JSON task document
2. Make the not-valid-JSON refusal show the expected keys (goal, verification, …)
3. Test the refusal text

## Acceptance criteria

- [x] a non-JSON --body-file is refused naming the JSON shape [proof: new-body-file-json]
