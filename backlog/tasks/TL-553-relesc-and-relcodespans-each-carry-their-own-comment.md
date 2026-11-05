---
id: TL-553
title: "relEsc and relCodeSpans each carry their own comment"
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
conflict_group: [viewer]  # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 30m
confidence: medium                 # how much you trust the estimate
created: 2026-11-04
updated: 2026-11-05
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: comments-placed
    bash: "grep -B3 'function relEsc' scripts/viewer-release.mjs | grep -q 'HTML escaping'"
---

## Goal

In scripts/viewer-release.mjs each of relEsc() and relCodeSpans() has its own doc comment directly above it.

## Context

TL-520 inserted relCodeSpans() between relEsc() and its doc comment ('HTML escaping, local on purpose'), so each function now appears to carry the other's comment.

## Steps

1. Move the comment back above relEsc() and give relCodeSpans() its own

## Acceptance criteria

- [ ] The HTML escaping comment sits directly above relEsc(). [proof: comments-placed]
