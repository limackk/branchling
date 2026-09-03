---
id: TL-98
title: "Roles in the dispatcher and the loop: next --role, agent per role"
type: task
labels: []
board: main
epic: "Agentic distinguishers"
priority: P1
status: done
owner: agent:session
estimate: 4h
confidence: medium
created: 2026-08-31
updated: 2026-09-02
blocked_by: [TL-87, TL-96, TL-97]
blocks: [TL-113]
related_docs:
  - docs/branchling-global-tool.md
verification:
  - bash: "node --test scripts/tests/next.test.mjs scripts/tests/run.test.mjs"
---

## Goal

The dispatcher and the loop understand roles:

- `worktrail next --role developer` hands out only tasks with that role or
  with no role (`--role-strict` restricts it to exactly that role);
- in `worktrail run` the agent command becomes a map per role
  (`run_agent_commands: {developer: "…", docs: "…"}`); a task with a role
  for which the map has no entry is SKIPPED with an explicit count in the
  report — it waits for an executor of that role, e.g. a human.

Effect: a single queue serves specialized agents and humans at once, and
escalation to a human needs no mechanism at all — it is simply a missing
entry in the map.

## Context

Grew out of the decision on subagent roles (2026-08-31). This is an
extension of two existing contracts, not a new mechanism: selection in
`next` (TL-87) gets one more filter, `run`'s configuration (TL-96) turns a
scalar into a map. Stay within the boundaries of those tasks — the lock,
attribution and verification gate do not change by a single line.

Decisions:
- **The scope of role enforcement is EXCLUSIVELY this task**: `next`
  selection and `run`'s command map. `take <ID>` (TL-87) and an agent
  working directly on files of a given role do not check — taking outside
  the role is recorded in the event, not blocked (the rule from TL-97).
  Regression test: `take` on a task with any role passes without flags and
  without role configuration.
- **The default semantics of `--role r` is "r or no role"**, because a task
  with no role can by definition be taken by anyone; the strict version is
  a flag. The opposite default (exact role only) would starve tasks with no
  role whenever every executor calls with the flag.
- **Backward compatibility:** the scalar `run_agent_command` (from TL-96)
  still works as the entry for tasks with no role; both keys at once fail
  configuration validation (two answers to one question — the class of
  divergence from Law 3).
- **Skipping is not silence.** The `run` report counts skipped tasks per
  missing role ("3 tasks waiting for role analyst — no command in the map").
  A silent skip would look like an empty queue — the same class of bug as a
  silent no-op.
- Role names in the map must exist in the project's `roles` dictionary; a
  typo in the user layer fails before the loop starts.

## Pre-flight reading

- `backlog/tasks/TL-87-tasklog-next-atomowy-przydzial-taska-dla-agenta.md`
  and `backlog/tasks/TL-96-tasklog-run-petla-next-agent-close-do-pustej-kolejki.md`
  — the contracts this task extends.
- `backlog/tasks/TL-97-pole-role-taska-wymog-roli-ze-slownika-konfiguracji.md`
  — the semantics of the field and the dictionary.
- [docs/branchling-global-tool.md](../../docs/branchling-global-tool.md) §3 —
  Law 3: the command map is the user layer, the role dictionary is the
  project layer; validation of consistency between them.

## Steps

1. `next`: role filter in selection (default "role or no role",
   `--role-strict` exact); without `--role`, behavior unchanged.
2. `run` configuration validation: map vs scalar, map keys against the
   `roles` dictionary, conflict between both forms.
3. Loop: pick the command from the map by the task's role; no entry = skip
   the task, count per role, do not retry within this run.
4. `run` report: a "waiting for role" section with counts; `--json`
   likewise.
5. Tests: role filter in next (with and without strict), a run with a map of
   two roles and stub agents, a task with a role and no entry skipped and
   counted (positive control: it does NOT go to an agent of another role),
   scalar+map conflict fails.

## Acceptance criteria

- [ ] `next --role r` never hands out a task with a different, non-empty
      role.
- [ ] A task with a role and no entry in the map is not executed and is
      counted in the per-role report.
- [ ] The scalar `run_agent_command` works as before; scalar + map at once
      fails validation.
- [ ] A map key outside the `roles` dictionary fails before the loop starts.
- [ ] The behavior of `next` and `run` without roles is byte-for-byte
      unchanged (regression on existing tests).
- [ ] `take <ID>` behaves identically with and without roles — roles do not
      touch direct mode (test).

## Log

Append-only. Format: `YYYY-MM-DD status — who — note`.

- 2026-08-31 blocked — agent:claude — task created from the roles decision;
  waiting on the role field (TL-97) and the next (TL-87) and run (TL-96)
  contracts.
- 2026-08-31 revised — agent:claude — scope of role enforcement explicitly
  narrowed to next/run; take and direct mode are outside it.
- 2026-09-01 blocked — agent:claude — added dependent TL-113 (the executor
  field extends the skipping and reporting mechanics from this task).
