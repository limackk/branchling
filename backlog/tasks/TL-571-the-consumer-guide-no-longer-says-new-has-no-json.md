---
id: TL-571
title: "The consumer guide no longer says new has no --json"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P1                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-05
updated: 2026-11-05
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: no-stale-claim
    bash: "! grep -n 'has no `--json` at all' docs/external-consumers.md | grep -q '`new`'"
---

## Goal

docs/external-consumers.md no longer claims that `new` has no `--json`. Under the heading "Outside the envelope today." (about line 127) the paragraph says "`new` has no `--json` at all; an interface that creates a task reads the new id with `query --json` after `new` returns." TL-550 added `new --json` (kind `task-new`, registered in scripts/json-envelope.mjs and listed in the same document's kinds table a few lines above), so the paragraph contradicts the table and steers a consumer to an unnecessary second call. Done when the paragraph is removed or rewritten to name only commands that really answer outside the envelope, and nothing in docs/external-consumers.md says `new` lacks `--json`.

## Acceptance criteria

- [ ] The consumer guide no longer says new has no --json. [proof: no-stale-claim]
