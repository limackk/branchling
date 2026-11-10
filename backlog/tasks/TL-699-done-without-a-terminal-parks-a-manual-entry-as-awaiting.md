---
id: TL-699
title: "done without a terminal parks a manual entry as awaiting_vouch"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
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
  - id: done-awaiting-vouch
    bash: "node --test scripts/tests/done-awaiting-vouch.test.mjs"
---

## Goal

When `done` meets an unvouched `manual:` entry with no terminal to ask at, and the project declares `awaiting_vouch_status`, the task moves to that status (recorded, with the automated entries' results) instead of staying in_progress, and the refusal names that outcome.

## Context

On 2026-11-10 a loop supervisor ran `done TL-652`; its contract had a `manual:` entry, and done refused with `a manual: entry needs a person, and there is no terminal here` (scripts/done-task.mjs around line 1049), offering only two ways on — typing `confirm` or `--confirm-manual` — both of which vouch, which an agent must not do for a person. The task merged as in_progress, held its agent wave shut, and had to be moved to the human gates wave by hand (commit 135ee9e). backlog/config.yaml declares `awaiting_vouch_status: awaiting_vouch`, and `branchling run` already uses it (scripts/run-loop.mjs, config.awaitingVouchStatus), but `done` itself does not.

## Steps

1. In the no-terminal branch, when awaitingVouchStatus is configured and every non-manual entry passed, set the task to that status with a history record (source and reason as `run` writes them) and exit with a distinct code or refusalKind
2. When it is not configured, keep the refusal but name the third way: leave it for a person, and how plan treats such a task
3. Test both configurations

## Acceptance criteria

- [ ] done with no terminal moves a task with an unvouched manual entry to the configured awaiting-vouch status [proof: done-awaiting-vouch]
