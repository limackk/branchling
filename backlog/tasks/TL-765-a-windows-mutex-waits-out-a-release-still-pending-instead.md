---
id: TL-765
title: "A Windows mutex waits out a release still pending instead of failing"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 1h
confidence: medium                 # how much you trust the estimate
created: 2026-11-21
updated: 2026-11-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: mutex-pending
    bash: "node --test scripts/tests/mutex-takeover.test.mjs scripts/tests/history-attribution-concurrency.test.mjs"
---

## Goal

Two writers contending for one mutex on Windows wait for each other instead of failing with EPERM. history-attribution-concurrency.test.mjs ('every claimant saw the change as unclaimed…') is red on the Windows job, and any two concurrent writing commands on Windows can hit the same refusal.

## Context

Run 44324012719, windows-latest: `EPERM: operation not permitted, open '…\state\mutex\76df4921bd2542b7.mutex'`. On Windows a file unlinked while another process still has it open stays 'delete pending' until the last handle closes, and every open or link of the name fails with EPERM meanwhile. In withMutex (scripts/lock.mjs) createExclusively turns a link EPERM into an open(wx), which fails with EPERM too and throws; readHolder throws it as well. The test did not change since it was green on 89de6a58, so it is a race that sometimes passes. withMutex now treats a win32 EPERM at those two points as a release in progress, waiting with the same jitter and deadline as for a live holder; releasePending() is the predicate, and opts.platform is a seam like opts.now. Rejected: treating EPERM as a release everywhere — on POSIX it means a permission problem that waiting will not cure. Not covered, filed separately: the same pattern in acquireLock's reservation and in mutation-slot.mjs.

## Steps

1. Wrap the create, the contended hook and the read of the holder in withMutex in a try that waits on releasePending(e, opts.platform).
2. Export releasePending from scripts/lock.mjs.
3. Add a test that raises EPERM at the contended point under win32 and enters, and a positive control that it is thrown under linux and past the deadline.

## Acceptance criteria

- [x] an EPERM while a release is pending is waited out on Windows and thrown elsewhere, and the concurrency tests still hold [proof: mutex-pending]
