---
id: TL-386
title: "Agent activity claims require live evidence"
type: task
labels: []
board: main
epic: "Evidence-gated product focus"
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:codex
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-09-09
updated: 2026-09-09
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs:
  - AGENTS.md
  - scripts/instructions.mjs
verification:                      # HOW to check the task is really done
  - id: activity-language-contract
    bash: "node --test scripts/tests/agent-activity-language.test.mjs"
---

## Goal

Repository instructions and product output distinguish a claimed task from a
provably live execution. An agent may say that work is active only while it can
name a pollable execution handle; after its turn ends it reports a checkpoint,
never continuing activity.

## Context

On 2026-09-09 an interactive assistant repeatedly ended its turn with phrases
such as "I am continuing". No goal, scheduled task, cloud task, child agent or
running process survived that response. Hours later the working tree was at the
same commit. The assistant had confused intent with execution, while Branchling
had separately confused `status: in_progress` with liveness in user-facing
language.

Ordinary interactive turns do not continue after the final response. Genuine
background work requires a runtime that owns it, such as Codex Goal mode, a
scheduled task, a cloud task or an external orchestrator. Repository task state
cannot prove process liveness and must not pretend to. Reintroducing durable
telemetry into the backlog is rejected: it recreates the product surface removed
by TL-378 and still cannot prove that a remote process is alive now.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `AGENTS.md` — define what an agent may claim about current execution.
2. `scripts/instructions.mjs` — separate task ownership from runtime liveness in
   the workflow presented to agents.
3. `README.md` — remove descriptions that call every `in_progress` task running.

## Steps

1. Define three observable states: claimed, live (with a pollable handle) and
   checkpointed (no execution continues after the response).
2. Require progress reports to name completed evidence: command/test/commit and
   timestamp; future intent is not progress.
3. Require the final response to say work is checkpointed unless Goal mode, a
   cloud task, a scheduled task or another pollable runtime remains active.
4. Update Branchling prose so `in_progress` means claimed work, never inferred
   process liveness.
5. Add a positive and negative source guard for the terminology.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [x] Instructions prohibit claims of continued work without a pollable runtime
      handle and require a checkpoint statement at turn end.
      [proof: activity-language-contract]
- [x] Product prose consistently calls `in_progress` claimed work rather than a
      running agent. [proof: activity-language-contract]
- [x] The guard fails when either misleading phrase is restored.
      [proof: activity-language-contract]
