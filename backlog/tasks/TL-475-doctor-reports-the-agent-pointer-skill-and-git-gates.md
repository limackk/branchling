---
id: TL-475
title: "Doctor reports the agent pointer, skill and git gates"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-10-16
updated: 2026-10-16
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: doctor-agent-setup
    bash: "node --test scripts/tests/doctor-agent-setup.test.mjs"
---

## Goal

`branchling doctor` reports whether the agent-facing setup of the repository is in place: the instructions pointer, the packaged skill and the git gates.

## Context

On 2026-10-16 `doctor` was run in a repository created by `branchling init --dir backlog`: every row was green, yet nothing it printed covered the agent pointer block written by `ensureNudge()` (scripts/instructions.mjs), the `backlog-workflow` skill that `branchling skills install` copies into `.claude/skills/`, or the pre-commit and commit-msg gates from `branchling hooks`. A repository missing all three gets `no errors`. These are advisory rows, not errors: each is optional, and the row must name the command that installs it (`instructions --update-nudge`, `skills install`, `hooks print`). A stale pointer version (NUDGE_VERSION) is reportable the same way.

## Steps

1. Add advisory rows to scripts/doctor.mjs for the pointer, the skill and the git gates, each naming its install command
2. Report a pointer at an older NUDGE_VERSION as stale
3. Cover present, absent and stale states with fixtures

## Acceptance criteria

- [x] doctor names a missing or stale pointer, a missing skill and missing git gates, and stays silent when all three are present [proof: doctor-agent-setup]
