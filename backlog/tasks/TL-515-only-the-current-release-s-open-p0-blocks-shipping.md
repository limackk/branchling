---
id: TL-515
title: "Only the current release's open P0 blocks shipping"
type: task
labels: []
board: main
epic: "Release tracking across environments"
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 3h
confidence: medium                 # how much you trust the estimate
created: 2026-11-02
updated: 2026-11-02
blocked_by: [TL-513]                     # ids of tasks that MUST be closed before this one starts
blocks: [TL-516]                         # ids this task will unblock
related_docs: [docs/release-tracking.md] # paths relative to the repository root
verification:
  - id: current-release
    bash: "node --test scripts/tests/current-release.test.mjs scripts/tests/release-scope.test.mjs scripts/tests/release-gaps.test.mjs"
---

## Goal

Only the CURRENT release's open top-priority tasks block the last stage: the order of `releases:` in config.yaml is chronological, and the current release is computed as the first one not yet fully shipped.

## Context

Decided 2026-11-02 by the owner. TL-505's `planned-blocker-open` gap counts an open task at the first priority planned for ANY declared release, because releases had no order; so a project shipping 1.0 while planning 1.1 is blocked by a P0 of 1.1 and has to accept the gap wholesale in `release_gate_accept`, which also silences the blockers that matter. An explicit `current_release:` key was rejected: it is a pointer somebody must move after every release, and a forgotten move reads like a fact. The order of a list the project already maintains costs nothing and the current release is derived from it (Law 2).

'Fully shipped' means every task planned for the release that is not dropped (closed in an archived status other than the first) is in full in the last stage of every target it touched; an unknown last stage means not shipped, never shipped. If every release is shipped there is no current release and the gap has nothing to report. Releases after the current one never block. `deploy status --release` (or `release status --release` until the rename task lands) names which release is current.

## Steps

1. Document in config.yaml comments and docs/manual.md that `releases:` is chronological.
2. Compute the current release in scripts/release-status.mjs (or a helper beside releaseScope) and use it in the planned-blocker-open detector in scripts/release-gaps.mjs.
3. Show the current release in the scope report and the gate output; test it.

## Acceptance criteria

- [ ] The current release is the first not fully shipped, an open P0 of a later release does not block, one of the current release does, an unknown last stage keeps a release current, and no current release means no blocker gap. [proof: current-release]
