---
id: TL-485
title: "A way to stop branchling run after the current task"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 4h
confidence: medium                 # how much you trust the estimate
created: 2026-10-26
updated: 2026-10-26
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: run
    bash: "node --test scripts/tests/run.test.mjs"
  - id: suite
    bash: "npm test"
---

## Goal

A person can ask a running `branchling run` to finish the task it is on and then stop, without killing it mid-task and without the run claiming anything new.

## Context

Reported from a downstream repository on 2026-10-26 (branchling 0.1.0). Today the choices are to kill the run mid-task (the claim stays `in_progress`, the agent's work stays uncommitted) or to let it drain the queue. The external workaround is fragile: a watcher froze the loop (`SIGSTOP`) when it spawned `branchling next` after the current task, planning to kill it once `next` returned; but `next` runs under `spawnSync`, so after exiting it stays a zombie until the frozen parent reaps it. The watcher waited for the pid forever, the loop sat frozen for about 50 minutes holding a task `next` had already claimed, and that claim had to be released by hand.

## Steps

1. Choose the request's shape: a stop file in the state directory keyed like the lock, a `branchling run --stop` from another shell that writes it, and/or SIGTERM/SIGINT handled as 'finish this task, then stop' (a second signal stops at once).
2. Check the request before each `next`; once seen, claim nothing new.
3. Report `stopped: asked to stop after <ID>` on the terminal and under `--json`.
4. Document it in `branchling run --help` and `instructions autonomous-loop`.
5. Add a test in scripts/tests/run.test.mjs: a stop request during the first task's agent ends the run after that task with nothing else claimed.

## Acceptance criteria

- [x] a stop request ends the run after the current task and claims nothing new [proof: run]
- [x] the whole suite stays green [proof: suite]
