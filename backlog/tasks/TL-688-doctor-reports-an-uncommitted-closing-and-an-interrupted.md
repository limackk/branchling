---
id: TL-688
title: "doctor reports an uncommitted closing and an interrupted merge"
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
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-10
updated: 2026-11-10
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: doctor-interrupted
    bash: "node --test scripts/tests/doctor.test.mjs"
---

## Goal

`branchling doctor` (and the `resume` briefing) warns when a task file says done but its closing is not committed, and when the checkout has an interrupted merge (MERGE_HEAD present).

## Context

When a supervised-loop session died, a task could be left closed by `done` but never committed (TL-643 on 2026-11-08 14:43, finished by hand: check, doctor, suite, commit, merge), and once a coordinator died mid-merge with MERGE_HEAD set. Nothing in the tool reported either; a person found them by reading git status. doctor's checks live in scripts/doctor.mjs, the briefing in scripts/resume-task.mjs.

## Steps

1. doctor: a WARN row listing task files whose status is an archived status and that differ from HEAD (closing not committed), with the remedy to commit them
2. doctor: a WARN row when .git/MERGE_HEAD (via git rev-parse --git-path) exists, naming `git merge --continue` / `--abort`
3. resume <ID>: mention an uncommitted closing of that task
4. Tests for each, with a positive control on a clean tree

## Acceptance criteria

- [ ] doctor warns about an uncommitted closing and an interrupted merge, and is silent on a clean tree [proof: doctor-interrupted]
