---
id: TL-108
title: "worktrail plan command with --json: plan execution state"
type: task
labels: []
board: main
epic: "Execution plan"
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
estimate: 2h
created: 2026-09-01
updated: 2026-09-01
blocked_by: [TL-107]
blocks: []
related_docs: []
verification:                      # HOW to check the task is actually done
  - bash: "node --test scripts/tests/plan-command.test.mjs"
  - bash: "node scripts/cli.mjs plan --json"
---

## Goal

`worktrail plan` shows the execution state of the plan from
`backlog/plan.yaml`: which wave is active, what is "next up," what is in
progress, what is outside the plan. With `--json` it becomes input for an
implementing agent — the agent asks for the next task with a single command,
instead of assembling the graph from 70 files itself.

## Context

Part of the "Execution plan" epic (analysis 2026-09-01, full decisions in
TL-107's Context). This task is the READ layer over the data from TL-107: the
file format, the parser (`scripts/plan.mjs`) and the guard already exist —
here it is only about computing the state and presenting it. Do not
duplicate validation: the command has to use the parser from TL-107, and on
an inconsistent plan it fails with the same message as the guard.

Definitions (computed from the live `tasks/*.md`, NEVER from generated views
— those are a snapshot of the last build):

- **active wave** — the first wave containing an open task
  (a status outside `archived_statuses` from config.yaml),
- **next up** — open tasks of the active wave whose `blocked_by` entries are
  all closed; `together` groups reported together,
- **in progress** — plan tasks with status `in_progress`, regardless of wave,
- **unplanned** — open tasks outside the plan (an explicit count + IDs; the
  plan rots silently if we do not show this),
- **stale** — plan tasks already closed in waves AFTER the active wave (a
  signal that the plan needs reshuffling).

Text output in the style of the rest of the CLI (through `scripts/ui.mjs` —
TL-52: color is emphasis, everything must also be said in words). `--json`
returns the full structure (waves with task statuses, next_up, unplanned,
stale). Law 4 from CLAUDE.md: `--json` on every reading command.

No `plan.yaml` = exit 0 with a "no plan file" message and empty JSON
(`{"waves": []}` + empty fields) — consistent with the guard from TL-107.

## Pre-flight reading

1. TL-107's Context — the plan format and the design decisions.
2. `scripts/plan.mjs` (created in TL-107) — parser and validation to reuse.
3. `scripts/query.mjs` — the pattern for a reading command: loading tasks,
   `--json`, exit codes.
4. `scripts/ui.mjs` — terminal output style, NO_COLOR/TTY handling.
5. `scripts/cli.mjs` — the command table, flag validation, the `--help` entry.
6. `.claude/skills/worktrail-cli/SKILL.md` — CLI surface conventions.

## Steps

1. Implement the state computation (active wave, next up, unplanned, stale)
   in `scripts/plan.mjs` alongside the parser — the viewer (TL-109) has to
   reuse THIS SAME function, so the CLI and the view cannot drift apart in
   their definitions.
2. Add the `plan` command in `scripts/cli.mjs`: text output + `--json`; an
   unknown flag fails; an entry in `--help` and `help plan`.
3. Tests on a fixture from `_repo.mjs`: a multi-wave plan with tasks in
   various statuses; cases: no file, a closed wave, an unplanned task, a
   stale task, a `together` group in next up.

## Acceptance criteria

- [ ] `node --test scripts/tests/plan-command.test.mjs` green.
- [ ] `worktrail plan` shows the active wave, next up (with `together`
      groups), in progress, the count and IDs of unplanned and stale.
- [ ] `worktrail plan --json` returns the same information structurally;
      `--json` and text are computed by one function.
- [ ] No `plan.yaml`: exit 0, a readable message, empty JSON.
- [ ] Inconsistent plan: nonzero exit, the guard's message from TL-107.
- [ ] The command is in `--help`; an unknown flag fails (exit 2).
- [ ] `worktrail check --language` green.

## Log

Append-only. Format: `YYYY-MM-DD status — who — note`.

2026-09-01 pending — agent:claude — task created from the "execution plan"
analysis; waiting on the format and parser from TL-107.
</content>
