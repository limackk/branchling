---
id: TL-222
title: "A history record says which role its actor was acting as"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-03
updated: 2026-09-03
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: role-in-the-log
    bash: "node --test scripts/tests/history-role.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
  - id: guards-green
    bash: "node scripts/cli.mjs check"
---

## Goal

A record in `backlog/history/` says which ROLE its actor was acting as, so a
queue served by several hands through `--agent-for <role>=<command>` can be read
back into stages. The field is optional and omitted when there is none.

## Context

The log answers WHO (`actor:`) and, since TL-164, from which session. It has
never answered AS WHAT. Measured on this repository after the parallel wave-4
run: 40 new entries, four cleanly separated actors — and **zero** entries
carrying any notion of role. A pipeline of specialists reconstructed from that
log can only be reconstructed by reading meaning into the actors' names, which
makes the measurement a measurement of a naming convention.

The task's own `role:` field is not the answer. `diffMeta` already reports a
change to it; that says what the task now asks for, not which hand made the
change. The two differ exactly where it matters: a `handoff` writes
`role: dev -> review` while the hand performing it is still `dev`.

## Steps

1. `entry()` in `scripts/history.mjs` takes a `role` and writes it under the
   same rule `session` follows (TL-164): omitted when absent, never `""`.
2. `recordEdit()` passes it through; `reconcile()` does not, and must not.
3. `take` passes the role declared with `--role`.
4. `done` gains `--role`, validated against `roles:` in `config.yaml`, and
   records it. Its `--help` declares the flag (TL-194's guard requires it).
5. `run` passes the role it dispatched on — to the `done` subprocess and to
   `writeStatus()`, so a parked task also says which hand tried.

## Decisions

**Only a command that MADE the change and was TOLD the role may stamp it.**
Reconciliation records changes it merely SAW. Stamping a role there would
attribute a stage to whoever happened to run the reconcile — TL-130's defect
with a new field. The last test in the contract is that control.

**`handoff` stamps nothing.** Its `--to-role` is the DESTINATION; the role the
hand performing the handoff was acting as is not stated anywhere and must not be
inferred from the value it is writing.

**No new field in the task frontmatter.** The role of an actor is a fact about
an act, not about a task, and the log is where facts about acts live.

## Verification

The contract above. `scripts/tests/history-role.test.mjs` was checked against
the unmodified code first: 4 of its 7 tests fail without the change.
