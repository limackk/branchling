---
id: TL-317
title: "An active task exposes a durable progress heartbeat"
type: task
labels: []
board: main
epic: "Agent execution reliability"
priority: P1
status: cancelled                  # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-09-07
updated: 2026-09-08
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []
verification:                      # HOW to check the task is really done
  - id: focused-tests
    bash: "node --test scripts/tests/task-heartbeat.test.mjs scripts/tests/watch.test.mjs"
  - id: activity-tests
    bash: "node --test scripts/tests/activity-command.test.mjs scripts/tests/session-report.test.mjs"
---

## Goal

Make an agent's active task distinguishable from a task that was merely claimed
and then abandoned. A person watching the queue must see the most recent
declared work step and its age without being told that an idle process is
working.

## Context

During TL-315 an agent answered a status question and ended its turn while its
task remained `in_progress`. The task file truthfully recorded ownership but
could not say whether the session had continued, stopped or was waiting for an
external decision. The resulting silence looked like work in progress.

This is not solved by a daemon or a fabricated timer. A heartbeat must be an
explicit, durable event written by an active worker; elapsed time then measures
the age of that evidence, not an inference about a process. It belongs in local
session/activity state, not in repository task data, because it describes one
machine's live execution rather than work that travels through review.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/watch.mjs` — display the signal without screen flicker or a second
   task-state implementation.
2. `scripts/activity-command.mjs` and `scripts/session-report.mjs` — reuse the
   local activity/session boundary and reporting vocabulary.
3. `scripts/lock.mjs` — keep mutable session state outside worktrees.

## Steps

1. Define a minimal local heartbeat record: task id, actor, timestamp and a
   bounded human-readable step. Do not accept task content, credentials or an
   arbitrary log stream.
2. Add a callable write command that validates the currently held task and
   records one heartbeat atomically; it must be reachable from flags for agent
   harnesses and scripts.
3. Add `watch` output for the current task's last step and age, with an explicit
   stale marker after a documented threshold. Missing evidence says "no heartbeat",
   not "stalled" or "working".
4. Ensure handoff, closure and a newer task state cannot be overwritten or read
   as a current heartbeat. Expiry is presentation, never a status transition.
5. Add positive-control tests for a fresh heartbeat, an aged heartbeat, a missing
   heartbeat, a wrong actor/task refusal and output without secrets.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [ ] A caller can write and read an explicit heartbeat for its active task, and
  it is local state rather than a task-file mutation. [proof: focused-tests]
- [ ] `watch` names the latest step and evidence age, and distinguishes missing,
  fresh and stale evidence without claiming a process is alive. [proof: focused-tests]
- [ ] Activity and session reports retain their current contracts. [proof: activity-tests]
