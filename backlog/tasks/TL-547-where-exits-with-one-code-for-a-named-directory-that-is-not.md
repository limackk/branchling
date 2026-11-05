---
id: TL-547
title: "where exits with one code for a named directory that is not a backlog"
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
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 1h
confidence: medium                 # how much you trust the estimate
created: 2026-11-04
updated: 2026-11-04
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: where-exit
    bash: "node --test scripts/tests/where-exit-codes.test.mjs scripts/tests/not-a-backlog-dir.test.mjs"
---

## Goal

`where` exits with the same code whether --dir or BACKLOG_DIR names a directory that is not a backlog, and its header states the codes the code returns.

## Context

scripts/where-command.mjs main() returns `report.backlog || !cli.dir ? 0 : 1`: a directory named through BACKLOG_DIR that is not a backlog exits 0, the same directory through --dir exits 1, and the header comment says `1 no backlog found` while the code returns 0 when none is found. TL-546 made every other command exit 1 for this state; scripts/tests/not-a-backlog-dir.test.mjs exempts `where` through its REPORTERS list until this is settled. `where` is a reporter, so 0 with a report may be right for none found; the question is whether BACKLOG_DIR counts as naming a directory, as it does in resolveBacklogDir().

## Steps

1. Decide the exit code for none found, --dir and BACKLOG_DIR, treating BACKLOG_DIR as resolveBacklogDir() does
2. Make main() and the header comment agree
3. Pin the three cases in a test and remove `where` from REPORTERS in not-a-backlog-dir.test.mjs

## Acceptance criteria

- [ ] where exits with the decided code for none, --dir and BACKLOG_DIR, and is no longer exempt from the not-a-backlog sweep. [proof: where-exit]
