---
id: TL-610
title: "A hook that only mentions the block marker is read as foreign"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-2
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: [hooks]  # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-06
updated: 2026-11-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: marker-mention-is-foreign
    bash: "node --test scripts/tests/hooks-install.test.mjs scripts/tests/doctor.test.mjs"
---

## Goal

A hook file that only mentions the block marker inside a line is read as foreign, not as our block that never closes.

## Context

inspect() in scripts/hooks-command.mjs decides `state: "ours"` with `text.includes(BLOCK_OPEN)`, a substring test, while blockRange() matches only a line whose trimmed text equals BLOCK_OPEN. A hook that merely quotes the marker (in a comment or an echo) is therefore classified as ours with `closed: false`. `hooks install` refuses it and doctor (staleHooksRow in scripts/doctor.mjs) tells the user to replace everything from the marker onwards, which for such a file is the user's own content. Doctor and install agree, so it is consistent, but both are wrong about whose file it is. The TL-600 supervisor recorded this as a pre-existing minor issue.

## Steps

1. Make inspect() decide ownership by the same trimmed-line match blockRange() uses
2. Add a fixture to hooks-install.test.mjs with the marker inside a longer line: install treats it as a foreign hook, and doctor names it as foreign
3. Keep a positive control: a file whose line IS the marker, with no closing line, is still ours and unclosed

## Acceptance criteria

- [x] A hook that only mentions the opening marker is read as foreign, and a line that is the marker is still read as ours [proof: marker-mention-is-foreign]
