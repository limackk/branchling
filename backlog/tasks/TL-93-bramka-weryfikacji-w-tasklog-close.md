---
id: TL-93
title: "The verification gate in worktrail close"
type: task
labels: []
board: main
epic: "Agent differentiators"
priority: P1
status: done
owner: agent:claude
estimate: 1d
confidence: medium
created: 2026-08-31
updated: 2026-09-01
blocked_by: []
blocks: [TL-96, TL-101]
related_docs:
  - docs/backlog-field-editing-history.md
verification:
  - id: gate
    bash: "node --test scripts/tests/verification-gate.test.mjs"
  - id: one-door
    bash: 'grep -q "setFrontmatterField(text, .status." scripts/done-task.mjs && ! grep -qF "text.replace(/^status:" scripts/done-task.mjs'
  - id: no-force
    bash: "grep -q 'there is no .--force. flag' README.md"
---

## Goal

`worktrail close TL-NNNN` runs the commands from a task's `verification:`
block and moves it to `status: done` ONLY when all of them exit with code 0.
The result (which commands, which exit codes, when) goes into `history/` as an
event — "done" stops being a declaration and becomes proof that an agent
cannot bypass by simply writing the status into the file.

This is a direct answer to the main fear of users running agents unsupervised,
and it is consistent with the philosophy of failing loudly (a silent no-op
looks like it worked).

## Context

Grew out of a review of differentiators against Backlog.md (2026-08-31). The
protocol "close = run verification" already exists as a convention (the
backlog-workflow skill); this task turns the convention into a command. The
class of bug is real: commit 27776f0 ("TL-52 was done and said pending") and
TL-68 as the guard that would have caught it.

Scope decisions:
- **Editing the file directly stays possible** — an agent can still write
  `status: done` with an Edit; the architecture (state-and-sync §5.1)
  deliberately allows this. The gate is the preferred path, and the drift
  "done with no verification event" is caught by `worktrail audit` (TL-90).
  Do not build a write police.
- **Running someone else's commands is explicit**: `close` shows what it will
  run and executes from the repository root; `--dry-run` only prints. The
  `verification` block comes from a repository the user already trusts (it is
  their own code), but the output must name every command being run.
- **A missing block or a placeholder** (the "command to run" from the
  template) means refusal to close with a message, not a silent done. A
  `--no-verify` flag exists, is loud in the output, and records in the event
  that verification was skipped.
- After passing: `status: done`, `updated:`, an event in `history/` (actor
  from `--actor`), `build` — through the one existing write path
  (`task-fields.mjs`), with no new code writing frontmatter.

## Resolution (2026-09-01)

The gate was delivered by **TL-82** — under the name `worktrail done`, not
`close`; this task described it a second time and was created the same day
from the same review. Criteria 1–3 were satisfied and covered by tests before
anyone picked up TL-93.

Criterion 5 remained, and it was not cosmetic. `done` wrote frontmatter with a
regex over the WHOLE file (`text.replace(/^status: .*$/m, …)`), while `take`
wrote the same field through `setFrontmatterField`. Two measurable effects:

- a comment next to the value (`status: pending  # …`) was erased on close,
  while it survived `take` — the two commands disagreed about what a task
  file even is (TL-70: a comment is a comment in EVERY reader);
- on a task with no `updated:` field, the regex matched nothing and wrote
  nothing, **silently**: the task closed with exit code 0 and no field saying
  when.

The second point is exactly the class of bug this tool exists for — a no-op
that reports success.

## Pre-flight reading

- `_template.md` — the shape of the `verification:` block (a list of `bash:`
  entries).
- `scripts/task-fields.mjs` — the only write path for frontmatter.
- `scripts/history.mjs` — event writing; settle the representation of a
  verification result (pseudo-field vs. plain event) consistent with
  `PSEUDO_FIELDS` in `task-fields.mjs`.
- [docs/backlog-field-editing-history.md](../../docs/backlog-field-editing-history.md)
  §2–§3 — the three write paths and the entry format.

## Steps

1. A parser for the `verification:` block in frontmatter (`bash:` entries);
   recognize and reject the placeholder from the template.
2. Sequential execution, printing each command and its output; the first
   failure stops the gate and the task stays at its current status.
3. Write the success path: change status through `task-fields.mjs`, a
   verification event to `history/`, regenerate the views.
4. `--dry-run`, `--no-verify` (loud, recorded in the event), `--json`.
5. Tests: passing verification, failing, missing, placeholder; a positive
   control — a failing command MUST leave the status untouched.

## Acceptance criteria

- [x] A failed verification changes no field on the task. [proof: gate]
- [x] A missing `verification:` block or a placeholder = refusal with a message. [proof: gate]
- [x] The event in `history/` carries the verification result and the actor. [proof: gate]
- [x] ~~`--no-verify` is visible both in the output and in the recorded event.~~
  REJECTED in TL-82, not left undone. Bypassing the gate is a manual file
  edit, which is visible in the diff; the flag would have left one word in a
  CI job nobody reads. The README states this outright. [proof: no-force]
- [x] Frontmatter writing goes exclusively through `task-fields.mjs`. [proof: one-door]

## Log

Append-only. Format: `YYYY-MM-DD status — who — note`.

- 2026-08-31 pending — agent:claude — task created from a review of agent
  differentiators; turns a convention from the backlog-workflow skill into an
  enforced command.
