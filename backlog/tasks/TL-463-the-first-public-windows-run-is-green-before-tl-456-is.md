---
id: TL-463
title: "The first public Windows run is green before TL-456 is vouched"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-10-15
updated: 2026-10-15
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: [TL-455]                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: the-name                   # optional; a criterion below points at this id
    bash: "command to run"
---

## Goal

The Windows job added by TL-456 completes the full suite green on GitHub
Actions, or the commands that cannot work there are named as unsupported, so
that TL-456's manual `windows-run` entry can be vouched for honestly.

## Context

TL-456 added `windows-latest` (Node 22) to `.github/workflows/test.yml` and
reached `awaiting_vouch` without a public run, because nothing had been
pushed since 2026-09-22. The first public Windows run is job `test
(windows-latest, 22)` in run 38738911603 (commit f11b5b6, 2026-10-15): 177 failing
tests. Early ones include `new` reading a document on stdin, two concurrent
`new` calls in separate worktrees, `next` skipping a task claimed on another
branch, and the provider-neutral adapter tests. Fetch the job log with
`gh api repos/limackk/branchling/actions/jobs/<job id>/logs` and group the
failures by cause before fixing any one of them; 177 failures are unlikely to
be 177 defects.

Do NOT vouch for TL-456 until this task is closed. TL-461 and TL-462 also fail
on Windows; settle them first so this log contains only Windows causes.

## Steps

1. Group the Windows failures by cause (paths, line endings, shell, process
   signals, file locking).
2. Fix each cause, or declare the affected command unsupported on Windows in
   the README and the matrix, per TL-456's goal.
3. Push and confirm the Windows job is green.

## Acceptance criteria

- [ ] The newest Windows job on main concluded success. [proof: windows-run]
