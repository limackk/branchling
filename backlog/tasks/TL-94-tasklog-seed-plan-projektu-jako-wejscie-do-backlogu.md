---
id: TL-94
title: "worktrail seed — project plan as input to the backlog"
type: task
labels: []
board: main
epic: "Agentic differentiators"
priority: P1
status: done
owner: agent:claude
estimate: 1d
confidence: medium
created: 2026-08-31
updated: 2026-09-01
blocked_by: []
blocks: [TL-95]
related_docs:
  - docs/worktrail-global-tool.md
verification:
  - id: seed-suite
    bash: "node --test scripts/tests/seed.test.mjs"
---

## Goal

`worktrail seed` takes a structured project plan on stdin (JSON: a list of
tasks with title, goal, steps, `blocked_by` dependencies, and a
`verification` block) and builds a backlog from it via the existing write
path — numbering through the `new` mechanism, frontmatter through
`task-fields.mjs`, events into `history/`. After `seed`, the backlog is ready
for autonomous loop work (TL-96): every task has executable verification and
explicit dependencies.

This is the first of three building blocks in the "one prompt → working
project" scenario; `seed` is the piece WITHOUT an LLM and must work without
any model.

## Context

Came out of a product decision (2026-08-31): the effect meant to attract
users is bootstrapping a project from a description, taken by the tool from
zero to a first working version. Splitting this into a core (this task) and
an LLM adapter (TL-95) is an application of Law 4
([docs/worktrail-global-tool.md](../../docs/worktrail-global-tool.md) §3):
every writing command has a form callable from outside, and the intelligence
arrives from outside through a stable input. The core must not depend on any
LLM host — the same principle TL-30 adopted for the cost adapter.

Scope decisions:
- **A task without executable `verification:` FAILS the entire seed**
  (validated before the first write, not halfway through). This is the only
  thing distinguishing a plan fit for autonomous work from a wish list — and
  the reason the TL-93 gate makes sense at all. A placeholder copied from the
  template also fails it.
- **Validate the whole plan before writing anything**: cycles in
  `blocked_by`, references to nonexistent plan items, duplicate titles — all
  reported at once, zero tasks on disk after an error. A partial seed is a
  state nobody asked for.
- **Numbering belongs to the tool.** The plan refers to items by local keys
  (e.g. `plan_id`), and `seed` maps them onto assigned TL-NNN numbers — the
  LLM never chooses numbers (the same rule as the ban on `max+1` in the
  skill).
- **Target directory works the same way everywhere**: `--dir` / detection; on
  an empty directory `seed` calls the existing `init`, not its own copy.
- The input format is part of the public surface — document it (field
  schema, an example), because other people's adapters will write to it.

## Pre-flight reading

- `scripts/task-id.mjs` and the `new` mechanism — number assignment; seed
  MUST reuse it, not duplicate it.
- `scripts/task-fields.mjs` — the only path for writing frontmatter.
- `_template.md` — the shape of a task and the verification placeholder that
  must be recognized.
- [docs/worktrail-global-tool.md](../../docs/worktrail-global-tool.md) §3 —
  Law 4; seed is its textbook case.

## Steps

1. Input schema: JSON with a list of items (`plan_id`, `title`, `goal`,
   `context`, `steps[]`, `blocked_by[]` by `plan_id`, `verification[]`,
   optionally `estimate`, `priority`); a parser with messages that point to
   the item and field.
2. Validate the whole plan: verifications are executable (non-empty, no
   placeholder), the dependency graph is acyclic, references resolve; all
   errors reported at once, exit code 2, zero writes.
3. Write: map `plan_id` → TL-NNN, files through the existing mechanisms,
   `__created__` into `history/` with the actor from `--actor`, `build` at
   the end.
4. `--dry-run`: shows what would be created (titles, dependencies by assigned
   numbers), without writing.
5. Tests: a valid plan, a plan with a cycle, a plan without verification
   (positive control: it MUST fail and leave the directory untouched), a
   plan into an empty directory (goes through init).

## Acceptance criteria

- [x] A plan with a task lacking executable verification writes NOTHING and
      lists all the offending items. [proof: seed-suite]
- [x] A cycle in `blocked_by` is detected before writing. [proof: seed-suite]
- [x] The tool assigns numbers; the input cannot force them. [proof: seed-suite]
- [x] After `seed` on a fresh directory, `worktrail check` passes with no
      warnings. [proof: seed-suite]
- [x] `seed` imports nothing that requires an LLM or the network. [proof: seed-suite]

## Log

Append-only. Format: `YYYY-MM-DD status — who — note`.

- 2026-08-31 pending — agent:claude — task created for the "one prompt →
  working project" scenario; core without an LLM, adapter separate (TL-95).
