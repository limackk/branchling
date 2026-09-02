---
id: TL-113
title: "Executor field: human requirement enforced in the dispatcher"
type: task
labels: []
board: main
epic: "Agent markers"
priority: P1
status: done
owner: agent:session
estimate: 2h
created: 2026-09-01
updated: 2026-09-02
blocked_by: [TL-98]
blocks: [TL-115]
related_docs:
  - docs/backlog-human-agent-decisions.md
verification:
  - bash: "node --test scripts/tests/task-fields.test.mjs scripts/tests/next.test.mjs scripts/tests/run.test.mjs"
---

## Goal

A task gets an optional frontmatter field `executor: human` — a requirement
stating that this task (usually: this decision) must not be handed to an
agent, regardless of role. No field means anyone can take it. The dispatcher
(`next`) and the loop (`run`), when invoked by an actor from the `agent:`
namespace, SKIP such a task and count it explicitly in the report ("N tasks
waiting on a human"). An explicit `take` is not blocked, only recorded in the
history — consistent with the principle from TL-97.

## Context

Grew out of the human/agent analysis (2026-09-01, Claude session); full
decisions in [docs/backlog-human-agent-decisions.md](../../docs/backlog-human-agent-decisions.md) §2.

The key distinction this field guards: the same analyst-agent may answer a
question from the documentation, but may not make a product decision. The
human requirement is therefore a property of a SPECIFIC task (data, travels
through review — Law 1), not of a role or of a deployment.

Decisions:
- **NOT roles like `analyst-human`/`analyst-agent`.** Cartesian growth of the
  role vocabulary; the dispatcher loses "any analyst"; it conflates
  competence (role) with kind of executor. Rejected.
- **NOT just the absence of an entry in the `run_agent_commands` map**
  (escalation from TL-98). A missing entry is a fact about the USER'S
  DEPLOYMENT ("I don't have an analyst agent"), `executor: human` is a fact
  about the TASK. Two layers — Law 3, layers are disjoint.
- **The values `human|agent` are the SHAPE of the field, not the project's
  vocabulary** — they may live in code (`task-fields.mjs`), with no key in
  `config.yaml`. Actor namespaces have been just as fixed in code since
  TL-21. The value `agent` is allowed for symmetry (a task a human should not
  do by hand, e.g. a bulk migration), but the driving scenario is `human`.
- **The dispatcher does NOT need new configuration to know the caller's
  kind** — the actor namespace (`agent:` vs `local:`/`user:`) already encodes
  it. `next --actor agent:claude` skips `executor: human`; a call with no
  agent actor sees everything.
- **A skip is not silence** — the `run`/`next` report counts tasks waiting on
  a human, exactly the pattern from TL-98.
- **An explicit take overrides the field's hint** — `take TL-NNNN` by an
  agent works and is recorded in the history, not blocked. A human who tells
  an agent to do the indicated task is themselves that human decision (the
  principle "role gates the dispatcher, not an explicit take" from TL-97).

## Pre-flight reading

- [docs/backlog-human-agent-decisions.md](../../docs/backlog-human-agent-decisions.md)
  — the full three-axis model and the rejected alternatives.
- `backlog/tasks/TL-97-pole-role-taska-wymog-roli-ze-slownika-konfiguracji.md`
  and `backlog/tasks/TL-98-role-w-dyspozytorze-i-petli-next-role-agent-per-rola.md`
  — the contracts this task extends; the semantics of skipping and counting.
- `scripts/task-fields.mjs` — `FIELD_SHAPES`; the pattern for an enum field
  with a fixed shape (no config vocabulary).
- [docs/backlog-field-editing-history.md](../../docs/backlog-field-editing-history.md)
  §2 — actor namespaces.

## Steps

1. `executor` field in `FIELD_SHAPES` as an optional enum `human|agent` with
   a fixed shape; editing in the viewer and history logging come for free
   from the existing field mechanics.
2. `next`: an actor from the `agent:` namespace does not get `executor: human`
   tasks (and conversely for `executor: agent` with a non-agent actor); skips
   counted in the report and in `--json`.
3. `run`: the same skip in the loop, a "waiting on a human" report section
   next to "waiting on a role" from TL-98.
4. Filter `worktrail query --executor human` (including `--executor ""` for
   tasks without the field).
5. `_template.md`: the field with a comment distinguishing `executor` from
   `role`.
6. Tests: skipping and counting (positive control: the task does NOT reach
   the agent), `take` works unchanged with recording, behavior without the
   field byte-for-byte unchanged on existing tests.

## Acceptance criteria

- [ ] `next --actor agent:*` never hands out an `executor: human` task;
      the report counts the skipped ones.
- [ ] `take <ID>` behaves identically with and without the field — a take
      that bypasses the requirement is recorded in the history, not blocked.
- [ ] The field is editable in the viewer, and the change writes a history
      entry — with no viewer code changes beyond the schema.
- [ ] `query --executor` filters; a task without the field does not vanish
      from views.
- [ ] `next`/`run` behavior with no `executor` field is byte-for-byte
      unchanged (regression on existing tests).

## Log

Append-only. Format: `YYYY-MM-DD status — who — note`.

- 2026-09-01 blocked — agent:claude — task created from the human/agent
  analysis; waiting on the skip-and-report mechanics from TL-98. Decisions in
  docs/backlog-human-agent-decisions.md.
</content>
