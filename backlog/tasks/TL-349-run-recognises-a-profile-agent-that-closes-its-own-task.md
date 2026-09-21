---
id: TL-349
title: "Run recognises a profile agent that closes its own task"
type: bug
labels: [run, agents, observability]
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-07
updated: 2026-09-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  # REWRITTEN BEFORE THE WORK STARTED. The first block named
  # `scripts/tests/run-agent-profiles.test.mjs`, a path that does not exist —
  # `node --test` ignores a missing file silently, so the entry passed green
  # against an unchanged tree and proved nothing about this defect. The entry
  # below names the file that reproduces it: it fails on today's code with
  # `tally.closed 0 !== 1`, because a profile publishes its own actor and the
  # accounting compared the closing actor against the loop's alone.
  - id: profile-closes-own-task
    bash: "node --test scripts/tests/run-profile-closes-own-task.test.mjs"
  - id: run-suite
    bash: "node --test scripts/tests/run.test.mjs scripts/tests/run-closed-by-agent.test.mjs scripts/tests/run-terminal-refusal.test.mjs scripts/tests/run-stuck-status.test.mjs scripts/tests/run-generalist-profile.test.mjs"
---

## Goal

When an agent invoked by `run` closes its assigned task itself, the run report
must count the result as `closed-by-agent`, not return an `already closed`
refusal or call it `closed-elsewhere`.

## Context

The real profile run for TL-225 on 2026-09-07 reproduced this path. The Codex
agent ran `branchling done TL-225 --actor agent:codex` and committed the result.
After it returned, `workOne()` called `done` again. The command refused because
the task was already done, and `TERMINAL_REFUSALS` returned early before the
outer accounting could call `writeStatus()` and apply TL-200's
`closed-by-agent` recognition.

The task is correctly closed; the defect is the run outcome and JSON report.
Do not change the agent's right to close work, and do not overwrite an archived
task. Move the existing actor-aware accounting to the path that observes the
already-closed refusal, with a positive control for a different actor.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/run-loop.mjs` — inspect `workOne`, `TERMINAL_REFUSALS`,
   `archivedBy` and the existing TL-200 accounting.
2. `scripts/tests/run.test.mjs` — add an end-to-end control for an agent that
   closes its own task and a collision closed by another actor.
3. `scripts/tests/run-agent-profiles.test.mjs` — preserve profile execution
   and the local provenance report.

## Steps

1. Reproduce the already-closed response after an agent-owned close in a test.
2. Read the closing actor from append-only history without modifying the task.
3. Return `closed-by-agent` and increment the closed tally only when it equals
   the run actor; retain `closed-elsewhere` for every other actor or no witness.
4. Verify text and `--json` report shapes.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [x] A profile agent that closes its own task is reported as
  `closed-by-agent` and counted as closed. [proof: profile-closes-own-task]
- [x] A task closed by another actor remains `closed-elsewhere` and is never
  overwritten. [proof: profile-closes-own-task]
- [x] The run does not invoke task verification a second time after observing
  the agent-owned archived status. [proof: profile-closes-own-task]
- [x] The scalar hand, the stuck-status write and the terminal-refusal map
  still end their tasks where they did. [proof: run-suite]
