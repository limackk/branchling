---
id: TL-97
title: "Task role field: role requirement from the configuration dictionary"
type: task
labels: []
board: main
epic: "Agentic differentiators"
priority: P1
status: done
owner: agent:claude-code
estimate: 2h
confidence: high
created: 2026-08-31
updated: 2026-09-01
blocked_by: []
blocks: [TL-98, TL-99, TL-100]
related_docs:
  - docs/backlog-config-and-portability.md
verification:
  - id: role-end-to-end
    bash: "node --test scripts/tests/task-role.test.mjs"
  - id: field-schema
    bash: "node --test scripts/tests/task-fields.test.mjs scripts/tests/config.test.mjs"
  - id: whole-suite
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

A task gets an optional frontmatter field `role:` — a requirement saying WHO
can take it (developer, analyst, docs, reviewer…). The dictionary of roles
lives in `config.yaml` (`roles:`), the field is validated and editable in the
viewer like any other, and its changes are recorded in history. A task
without a role can be taken by anyone.

Foundation for dividing work between specialized agents and humans: the
dispatcher filters by role (TL-98), handing off a task changes the role with
a trace (TL-99), the documentation drift detector creates tasks with the docs
role (TL-100).

## Context

Came from a product decision (2026-08-31): tasks should indicate a
specialized executor, e.g. an analyst making decisions that a developer agent
should not be making.

A distinction without which this field would blur — record it in the field's
description too:

| Concept | Question | Where |
|---|---|---|
| `role` | who CAN take the task | frontmatter (this field) |
| `owner` | who holds it NOW | frontmatter (exists) |
| `actor` | who recorded the change | history (exists) |

Decisions:
- **Dictionary in the project's configuration, not in the code** (Law 3 —
  roles are project values; a team without an analyst simply does not declare
  one). A value outside the dictionary fails like any unknown dictionary
  element; does a missing `roles` key in the configuration mean the field is
  free text? NO — a missing key means the project does not use roles, and
  then a non-empty `role:` fails with a message pointing to where the
  dictionary should be declared. Silently accepting a typo would create a
  phantom role that no dispatcher could handle.
- **The field is optional and SINGLE.** Not a list of roles, not transition
  rules, not per-role states — a workflow engine is deliberately out of
  scope; processes are composed (Law 4).
- **The role gates the DISPATCHER, not an explicit take** (decision
  2026-08-31). `role:` exists so that an unattended queue does not hand an
  analyst's decision to a developer. When a human tells an agent to do a
  specific task ("do TL-1234" in Claude Code / Codex), the explicit
  instruction beats the field's hint: `take` (TL-87) and direct file editing
  work unchanged, and taking a task outside its role is RECORDED in history,
  never blocked. Enforcing roles lives exclusively in `next` selection and
  the `run` command map (TL-98). Today's single-main-agent way of working
  therefore stays untouched — roles do not get in its way.
- A new field = one change in `task-fields.mjs` (shape) + a dictionary in
  `config.mjs` — the viewer and server-side validation should derive from the
  same schema without separate changes (that is how `buildFieldSpecs` works).

## Pre-flight reading

- [docs/backlog-config-and-portability.md](../../docs/backlog-config-and-portability.md)
  §3 — the code-shape / configuration-values line, and how a new key is
  added.
- `scripts/task-fields.mjs` — `FIELD_SHAPES`, `EDITABLE_FIELDS`; the pattern
  of an existing dictionary-backed field (e.g. `priority`).
- `scripts/config.mjs` — dictionary validation and consistency between them.

## Steps

1. `roles:` key in the configuration + validation (duplicates, slug shape).
2. `role` field in `FIELD_SHAPES` as an optional enum from the dictionary;
   editing in the viewer and history recording come from the existing field
   machinery.
3. `worktrail query --role <r>` filter (including `--role ""` for tasks
   without a role).
4. `_template.md`: the field with a comment explaining the role/owner
   difference.
5. Tests: a value from the dictionary passes, one outside the dictionary
   fails, a non-empty `role:` without a declared dictionary fails with a
   helpful message, a task without a role passes everywhere.

## Acceptance criteria

- [x] A role outside the dictionary fails the build with a message naming the file and the value. [proof: role-end-to-end]
- [x] A non-empty `role:` with no `roles` key in the configuration fails, it does not pass silently. [proof: role-end-to-end]
- [x] The field is editable in the viewer, and a change writes a history entry — with no viewer code changes beyond the schema. [proof: field-schema]
- [x] `query --role` filters; a task without a role does not disappear from general views. [proof: role-end-to-end]
- [x] No role name appears in the code (a test in the spirit of the DEFAULTS genericity guard). [proof: field-schema]
- [x] `worktrail take TL-NNNN` on a task whose role differs from the caller's declared role PASSES, and the event in `history/` records that the take was outside the role. This criterion came from [TL-87](TL-87-worktrail-next-atomowy-przydzial-taska-dla-agenta.md), where `take` was created: there was nothing to prove there yet, because the `role:` field did not exist yet. `take` deliberately does not have and will not get a role gate — the dispatcher gates it (TL-98), and an explicit human instruction outranks it. [proof: role-end-to-end]

## Log

Append-only. Format: `YYYY-MM-DD status — who — note`.

- 2026-08-31 pending — agent:claude — task created from the decision on
  subagent roles; foundation for TL-98/1509/1510.
- 2026-08-31 revised — agent:claude — recorded the rule "the role gates the
  dispatcher, not an explicit take": the main agent's direct mode stays
  unchanged, taking outside the role is recorded.
