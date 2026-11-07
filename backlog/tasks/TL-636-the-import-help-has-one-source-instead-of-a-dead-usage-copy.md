---
id: TL-636
title: "The import help has one source instead of a dead USAGE copy"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: [import]  # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-07
updated: 2026-11-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: single-copy
    bash: "test \"$(cat scripts/*.mjs | grep -c 'iteration or release an issue was committed to')\" = 1"
  - id: help-still-complete
    bash: "node scripts/cli.mjs import --help | grep -qi milestone && node scripts/cli.mjs import --help | grep -qi assignees"
  - id: import-tests
    bash: "node --test scripts/tests/import-github.test.mjs"
---

## Goal

The help that `branchling import --help` prints has one source, so the omission list a reader sees cannot drift from a second copy nobody prints.

## Context

`scripts/import-github.mjs` exports `USAGE` (around line 83), but nothing reads it: `import --help` prints the `usage` text in the `import` entry of the command table in `scripts/cli.mjs` (around line 974), and the module's direct-run path calls `main()` without ever printing `USAGE`. The two texts already differ in wording (the module's copy explains why label mapping is an argument; the table's copy describes the one-off nature). TL-577 had to add the milestone sentence to both to keep them aligned; the next change to one will not reach the other. Options: delete `USAGE` and keep the command table as the single source, or have the command table take its text from the module. Choose one; do not keep two copies.

## Steps

1. Decide which text is the source and fold any sentence that exists only in the other copy into it.
2. Remove the second copy, or make the command table read the exported constant.
3. Run the import tests and check that `import --help` still names every omission.

## Acceptance criteria

- [ ] The import's omission text exists in exactly one place under scripts/. [proof: single-copy]
- [ ] `import --help` still names milestones and the conversation omissions. [proof: help-still-complete]
- [ ] The import's behaviour is unchanged. [proof: import-tests]
