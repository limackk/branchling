---
id: TL-545
title: "A --dir that is not a backlog is a message, not a stack"
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
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-03
updated: 2026-11-03
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: not-a-backlog
    bash: "node --test scripts/tests/not-a-backlog-dir.test.mjs"
---

## Goal

A --dir or BACKLOG_DIR naming a directory that is not a backlog prints a readable refusal from every command, never a Node stack trace.

## Context

resolveBacklogDir in scripts/paths.mjs throws NotABacklogError for an explicit directory that does not look like a backlog (since TL-541). resolveBacklogDirOrExit handles only BacklogNotFoundError and re-throws the rest, so show, query, plan and every other command using it print a stack trace for `--dir /tmp`. check --json handles both since TL-541. The exit code (1 today, by crash) must be decided: the code comment calls it a usage error, which would be 2.

## Steps

1. Handle NotABacklogError in resolveBacklogDirOrExit with failure() and a deliberate exit code
2. Check the commands that call resolveBacklogDir directly and print e.message

## Acceptance criteria

- [ ] Commands given a --dir that is not a backlog print a refusal without a stack trace. [proof: not-a-backlog]
