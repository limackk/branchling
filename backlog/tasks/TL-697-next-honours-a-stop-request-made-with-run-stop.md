---
id: TL-697
title: "next honours a stop request made with run --stop"
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
  - id: next-stop-request
    bash: "node --test scripts/tests/next-stop-request.test.mjs"
---

## Goal

`branchling next` (with or without --plan) claims nothing while a stop request written by `branchling run --stop` is in force, and says so with its own refusal kind, so any loop built on `next` can be told to finish its current task and stop.

## Context

TL-485 added `branchling run --stop`: a request in the state directory (scripts/run-stop.mjs, requestStop / stopRequestedSince) that the `run` loop checks before each `next` (scripts/run-loop.mjs around line 2086). Only `run` reads it. Supervised loops built outside `run` — e.g. a workflow whose supervisors call `next --plan` directly — cannot be stopped gracefully: on 2026-11-10 "finish the current task, then stop" had to be done by killing the orchestration once the watched tasks merged, which interrupted the coordinator in the middle of a merge (finished by hand) after two loops had already claimed new tasks that then had to be set aside as WIP commits. stopRequestedSince() takes the run's start time; `next` is one-shot and has none, so the request needs a lifetime of its own (until cleared, or an expiry).

## Steps

1. Give a stop request a lifetime independent of a run start (e.g. it holds until `run --stop --clear` or `next --resume-dispatch`, or until a stated expiry), keeping `run`'s behaviour unchanged
2. Check it in next-task.mjs before claiming; refuse with refusalKind `stop-requested` and exit 3, naming who asked and when, and how to clear it
3. Document it in `next --help`, `run --help` and `instructions autonomous-loop`; test that next claims nothing while a request holds and claims again after it is cleared

## Acceptance criteria

- [ ] next claims nothing while a stop request holds and claims again once it is cleared [proof: next-stop-request]
