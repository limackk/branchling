---
id: TL-512
title: "query names tasks of external targets as unobservable"
type: task
labels: []
board: main
epic: "Release tracking across environments"
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
priority: P3
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-02
updated: 2026-11-02
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: [docs/release-tracking.md]
verification:                      # HOW to check the task is really done
  - id: query-unobservable-tests
    bash: "node --test scripts/tests/release-multi-repo.test.mjs"
---


## Goal

`query --json` and `query --env` / `--not-env` say that a task belongs to a deploy target in another repository, instead of giving it an empty deployment that reads like "no commits, not deployed".

## Context

TL-507 added `repository:` and `labels:` to a `deploy_targets` entry (`scripts/deploy-targets.mjs`): such a target's tasks are the ones carrying its labels, and `release status`, the gate (`scripts/release-gaps.mjs`) and the viewer's Release view name them as unobservable. `query` was outside that task's scope and still reads them through `taskDeployment()` / `taskDeploymentJson()` in `scripts/environments.mjs`, which only knows targets observed from commits. So `query --text X --json` gives a frontend task `deploy: {commits: 0, targets: []}`, and `query --status done --not-env production` matches nothing for it (`stageMatches()` returns `none`) without saying why.

## Steps

1. Give `taskDeploymentJson()` (or the `query` layer around it) the task's external targets from `externalTargetsOf()`, e.g. an `unobservable: [{target, repository}]` field.
2. Decide what `--env` / `--not-env` answer for such a task and print the reason; update the `--json` contract row in docs/manual.md.
3. Add tests to scripts/tests/release-multi-repo.test.mjs, with a positive control.

## Acceptance criteria

- [ ] `query --json` names a task of a target in another repository as unobservable there, and an unlabelled task is unaffected. [proof: query-unobservable-tests]
