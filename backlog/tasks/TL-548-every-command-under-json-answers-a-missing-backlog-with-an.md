---
id: TL-548
title: "Every command under --json answers a missing backlog with an envelope"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-1
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: [json-envelope]  # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 4h
confidence: medium                 # how much you trust the estimate
created: 2026-11-04
updated: 2026-11-05
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: json-no-backlog
    bash: "node --test scripts/tests/json-no-backlog-envelope.test.mjs"
---

## Goal

Every command run with --json where there is no backlog, or where --dir or BACKLOG_DIR names a directory that is not one, prints an envelope of its own kind with ok:false and refusalKind no-backlog on stdout.

## Context

Since TL-546 the state exits 1 everywhere, but the shape differs: set, release, declare and deploy record print an envelope with refusalKind no-backlog, while take, next, ask, decide, handoff, body, run, deploy status, import, seed, audit, docs-drift and pr-summary print the refusal on stderr and leave stdout empty. A consumer such as branchling-ui calling `take --json` has no envelope to branch on and cannot tell this state from a crash. scripts/json-envelope.mjs holds the envelope kinds; docs/external-consumers.md documents them. isBacklogDirRefusal() in scripts/paths.mjs recognises both foreseen states.

## Steps

1. List every command that accepts --json and what it prints for the two states
2. Answer both states with the command's own envelope kind, ok:false and refusalKind no-backlog
3. Document the refusal kind in docs/external-consumers.md
4. Add a sweep over the command table with --json for both states

## Acceptance criteria

- [x] Every --json command answers no backlog and a named non-backlog directory with its own envelope kind, ok:false and refusalKind no-backlog. [proof: json-no-backlog]
