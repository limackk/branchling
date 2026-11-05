---
id: TL-498
title: "The test workflow cancels a run that a newer push to the same ref supersedes"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 1h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-10-30
updated: 2026-10-30
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: superseded
    manual: "Push two commits to one branch a minute apart and confirm in the Actions tab that the first commit's test run is cancelled while the second runs, and that a run on main is never cancelled by a pull request run."
---

## Goal

`.github/workflows/test.yml` cancels an in-progress or queued run when a newer
push to the same branch or pull request supersedes it, so the queue only holds
runs whose result somebody will read.

## Context

On 2026-10-30 fourteen pull requests were opened and merged by fast-forward
within two hours. Each one started three test runs — the branch push, the pull
request and the push to `main` — of seven jobs each, and every superseded run
stayed in the queue. The macOS runners allow few concurrent jobs, so the run on
the newest `main` commit waited more than an hour behind runs on commits that
no longer mattered.

GitHub's `concurrency:` key with `cancel-in-progress: true` and a group keyed
by workflow and ref settles this. A run on `main` should not be cancelled by a
pull request run, so the group must separate the two refs, and a release tag
run (`release.yml`) must not share the group at all.

## Pre-flight reading

1. `.github/workflows/test.yml` — the trigger and the matrix.
2. `.github/workflows/release.yml` — must stay outside the group.

## Steps

1. Add a `concurrency:` block to test.yml keyed by `${{ github.workflow }}` and
   the ref (the pull request number for pull_request events).
2. Leave pr-summary.yml and release.yml unchanged unless the same reasoning
   applies, and say why in the commit body.

## Acceptance criteria

- [ ] A newer push cancels the older run of the same ref, never one on main.
      [proof: superseded]
