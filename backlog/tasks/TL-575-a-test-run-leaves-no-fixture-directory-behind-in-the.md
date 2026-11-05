---
id: TL-575
title: "A test run leaves no fixture directory behind in the temporary directory"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 1d                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-05
updated: 2026-11-05
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: suite-leaves-tmpdir-empty
    bash: "d=$(mktemp -d) && TMPDIR=\"$d\" node --test scripts/tests/*.test.mjs > /dev/null; rc=$?; left=$(ls -A \"$d\" | wc -l); rm -rf \"$d\"; echo \"left behind: $left\"; [ \"$rc\" -eq 0 ] && [ \"$left\" -eq 0 ]"
---

## Goal

One run of `node --test scripts/tests/*.test.mjs` leaves the temporary
directory exactly as it found it. Every fixture a test creates under
`os.tmpdir()` (the `branchling-*` directories, many of them git repositories)
is removed when that test ends, whether it passes or fails.

## Context

On 2026-11-05 four parallel implementation loops each ran the full suite
several times per task (in `done`, in the supervisor's gate and in the
coordinator's post-merge check). The volume ran out of inodes, not bytes:
9,830,400 of 9,830,400 used, with about 110,000 `branchling-*` directories
left at the top of `/tmp`. Every shell command then failed with ENOSPC, and the
end of the run (three loop recoveries and the final report) could not execute.
After the leftovers were deleted, ONE further suite run consumed about 116,000
inodes and returned none of them.

Measured in the tree on that day: 217 test files call `mkdtempSync`, and 101 of
them contain no `rmSync`, `after(` or `afterEach` at all. Some of the remaining
116 clean up only on the success path. Three modules outside the tests also
call `mkdtempSync` (`scripts/adapter-conformance.mjs`,
`scripts/check-backlog-proofs.mjs`, `scripts/done-task.mjs`); whether each of
those removes what it creates is part of this task, because `done` runs on
every close.

The leak is invisible on a single developer run and decisive under a fleet:
the cost scales with suite runs, and the loops multiply suite runs by design.

Rejected: cleaning `/tmp` from a global teardown. It would also delete
fixtures belonging to a concurrent run in another worktree, and it hides
which test leaks instead of fixing it.

## Pre-flight reading

1. `scripts/tests/_repo.mjs` — the shared test helpers; a fixture helper with
   built-in cleanup belongs beside them.
2. `grep -L "rmSync\|after(" $(grep -l mkdtempSync scripts/tests/*.mjs)` — the
   files with no cleanup at all, as a starting list.
3. `scripts/done-task.mjs`, `scripts/check-backlog-proofs.mjs`,
   `scripts/adapter-conformance.mjs` — the production callers of `mkdtempSync`.

## Steps

1. Add one fixture helper that creates the directory and registers its removal
   with the test's `t.after` (or the suite's `after`), so cleanup runs on
   failure too.
2. Move every test that creates a temporary directory onto it, or give it an
   equivalent cleanup in a `finally`/`after`.
3. Make the three production callers remove their temporary directories on
   every exit path.
4. Run the verification entry; it runs the suite with a private `TMPDIR` and
   counts what remains.

## Acceptance criteria

- [ ] A full suite run with a fresh `TMPDIR` passes and leaves that directory
      empty. [proof: suite-leaves-tmpdir-empty]
