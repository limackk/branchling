---
id: TL-650
title: "The reserved reason unknown means what AGENTS.md says it means"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-1
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 1h
confidence: medium                 # how much you trust the estimate
created: 2026-11-07
updated: 2026-11-09
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: unknown-reason-agrees
    bash: "node --test scripts/tests/unknown-reason-meaning.test.mjs"
---

## Goal

AGENTS.md describes the reserved reason `unknown` the way the tool records it, or the tool stops recording it where the description says it cannot occur. Either way the description and the history agree.

## Context

AGENTS.md says that two reason values are reserved and must never be typed by hand, and describes `unknown` as "a change that was observed, not made by the tool". But `normalizeReason()` in scripts/task-fields.mjs records `unknown` for ANY write made without a reason, including writes the tool makes itself. On 2026-11-07 every claim by `next` in this repository recorded {"source":"next","reason":"unknown"}. A reader who follows AGENTS.md would read such a claim as a change somebody made outside the tool. Decide which is right: either `unknown` means "no reason stated" and AGENTS.md says that, or a write the tool makes without a reason gets a different, honest value.

## Steps

1. Settle which meaning holds, using TL-105's record and scripts/history.mjs.
2. Fix AGENTS.md, or the recording, accordingly.
3. Test that a claim by `next` without --reason records what the documentation says it records.

## Acceptance criteria

- [x] the recorded meaning of unknown matches its description [proof: unknown-reason-agrees]
