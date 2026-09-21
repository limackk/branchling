---
id: TL-356
title: "A worker can mutate only its assigned task"
type: task
labels: []
board: main
epic: "Controlled and observable agent execution"
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:codex
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-09-07
updated: 2026-09-07
blocked_by: [TL-355]               # ids of tasks that MUST be closed before this one starts
blocks: [TL-362]                   # ids this task will unblock
related_docs: [scripts/cli.mjs, scripts/next-task.mjs, scripts/run-loop.mjs]
verification:                      # HOW to check the task is really done
  - id: task-scope
    bash: "node --test scripts/tests/run-roles.test.mjs scripts/tests/run-follows-handoff.test.mjs scripts/tests/agent-check.test.mjs scripts/tests/worker-scope.test.mjs"
---

## Goal

A worker and every provider subagent it creates can act only on the task that
Branchling assigned. Queue ownership remains with the outer dispatcher even
when a harness uses an internal agent tree.

## Context

Prompt instructions alone cannot enforce orchestration authority across Codex,
Claude, Kimi, GLM and custom wrappers. Descendant processes inherit the worker
environment, which can carry a task scope that Branchling's own mutating
commands enforce. The worker still needs to read its task, hand that task to a
declared role, ask a question and close verified work. It must not call `next`,
`take` or `run`, or mutate a different task. Direct human CLI use remains
unchanged outside an assigned-worker environment.

## Pre-flight reading

1. `scripts/cli.mjs` — identify every writing and queue-owning command at one
   command boundary.
2. `scripts/run-loop.mjs` — add inherited worker scope to raw commands and
   profile adapters.
3. `scripts/next-task.mjs` — preserve atomic selection and reservation for the
   outer dispatcher.

## Steps

1. Define a local scope containing run, actor and assigned task identity without
   writing it into the repository.
2. Refuse queue-owning commands inside that scope and constrain task-writing
   commands to its task ID.
3. Keep valid handoff, ask, decide and done flows for the assigned task.
4. Add positive controls proving ordinary terminal users and the outer run loop
   retain their current authority.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [x] A worker or inherited child cannot claim another task or start a nested
      Branchling run. [proof: task-scope]
- [x] The assigned task can still be handed off, questioned and closed through
      the normal commands. [proof: task-scope]
- [x] A terminal command outside worker scope behaves exactly as before.
      [proof: task-scope]
- [x] A forged task ID without matching local run scope grants no authority.
      [proof: task-scope]
