---
id: TL-447
title: "Former-name guard survives a shrinking open backlog"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:codex-subagent
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1h
confidence: medium                 # how much you trust the estimate
created: 2026-09-26
updated: 2026-09-26
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: former-name-guard
    bash: "node --test scripts/tests/former-name.test.mjs"
  - id: full-suite
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

The former-name guard can pass when the backlog legitimately has ten or fewer open tasks, while still proving that it scanned the real task directory and can detect a retired product name.

## Context

The full suite run for TL-431 on 2026-09-26 passed 1972 of 1973 tests. The only failure was scripts/tests/former-name.test.mjs, whose path positive control requires more than ten open tasks. The backlog now has ten, so normal progress made the guard red even though the scan found the correct directory. Searches for former-name and open tasks found no existing task. The existing synthetic offence fixture proves the name detector can fire, but the real-tree path needs an evergreen positive control that does not assume unfinished work remains forever. Pre-flight: read scripts/tests/former-name.test.mjs to understand the open-task scan and its two current controls; read the zero-sample rule in AGENTS.md so the replacement still proves the real task directory was scanned.

## Steps

1. Replace the lower bound on open tasks with a deterministic positive control for the real backlog path that remains valid when every task is closed.
2. Keep the open-task language guard and its synthetic offence control intact.
3. Add a negative mutation or equivalent focused proof that the path control fails when the scan is pointed at no real task files.
4. Run the focused test and the full suite.

## Acceptance criteria

- [x] The guard accepts the current shrinking backlog while retaining positive controls for both the real scan and retired-name detection. [proof: former-name-guard]
- [x] The evergreen positive control composes with every repository guard. [proof: full-suite]
