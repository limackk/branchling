---
id: TL-99
title: "worktrail handoff — handing off a task with a reason and a trail"
type: task
labels: []
board: main
epic: "Agentic differentiators"
priority: P1
status: done
owner: agent:claude
estimate: 4h
confidence: medium
created: 2026-08-31
updated: 2026-09-01
blocked_by: [TL-87, TL-97]
blocks: [TL-114]
related_docs:
  - docs/backlog-field-editing-history.md
  - docs/worktrail-state-and-sync.md
verification:
  - id: handoff
    bash: "node --test scripts/tests/handoff.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

`worktrail handoff TL-NNNN --to-role analyst --reason "…" --actor agent:claude`
hands off a task to another role: changes `role:` (and resets `owner` to
`unassigned`), releases the current session's lock, records the reason as
a comment event and a line in the task's `## Log`. The task returns to the
queue and waits for the target role's executor.

Target scenario: agent-developer runs into a decision outside its mandate,
hands the task off to an analyst with a question; the analyst (agent or
human) records the decision and hands it back. The whole exchange — who
asked, who decided, when — is in the task and in the history, not in session
scrollback.

## Context

Emerged from the decision about subagent roles (2026-08-31). Handoff is a
command composed from existing primitives: field change through
`task-fields.mjs`, events through `history.mjs`, lock from TL-87. Only one
thing is new: **the first use of the reserved event type `__comment__`**
([worktrail-state-and-sync.md](../../docs/worktrail-state-and-sync.md) §7 item 5,
`PSEUDO_FIELDS` in `task-fields.mjs`) — the reason for the handoff is a
comment, not a field change, and like comments it is append-only and
conflict-free (§5.1 of that document). The `__comment__` implementation is
meant to be general enough that future comments (the viewer, non-technical
people) use it unchanged — but the comment UI is OUT of scope for this task.

Decisions:
- **`--reason` is mandatory.** A handoff without a reason is, for the
  recipient, a task without context — exactly the same class as `blocked`
  with an empty `blocked_by`.
- **Handoff does not change status.** The task returns to `pending` only if
  it was `in_progress` for the person handing it off (because it stops being
  in progress); `blocked` stays `blocked`. No new statuses — roles are not a
  workflow.
- **`--to-role` validates against the dictionary** (TL-97); `--to-owner` as
  a variant for handing off to a specific person within the same role.
- The viewer shows `__comment__` events on the task's history timeline
  (rendering of the event list already exists; a comment is a new kind of
  row, not a new mechanism).

## Pre-flight reading

- [docs/backlog-field-editing-history.md](../../docs/backlog-field-editing-history.md)
  §2 — pseudo-fields, dedup rules; a comment has to fit into them.
- [docs/worktrail-state-and-sync.md](../../docs/worktrail-state-and-sync.md)
  §5.1–§5.2 — comments as an append-only, conflict-free class.
- `scripts/task-fields.mjs` — `PSEUDO_FIELDS`; `scripts/history.mjs` —
  writing and reading events.
- `backlog/tasks/TL-87-tasklog-next-atomowy-przydzial-taska-dla-agenta.md`
  — the lock contract that handoff releases.

## Steps

1. `__comment__` event: written through `history.mjs` (task, content, actor,
   ULID), read and rendered in the viewer alongside the history timeline;
   dedup by `id` like regular events (a comment is not subject to the
   `__created__` dedup rule, because two identical comments at different
   times are two events).
2. `handoff` command: role/owner validation, field change through one
   existing write path, session lock release, comment with the reason, line
   in the task file's `## Log`, `build`.
3. Exit codes and messages: missing `--reason` = invocation error;
   nonexistent task / role outside the dictionary = as everywhere else.
4. Tests: full handoff (fields + lock + comment + log), handoff of a task
   without a lock (works — a task taken manually can also be handed off),
   missing reason fails, `blocked` stays `blocked`.

## Acceptance criteria

Each criterion on ONE line: wrapping to a second loses text and `[proof:]`
for today's parser (TL-118).

- [x] Handoff changes `role`, clears `owner`, releases the lock. [proof: handoff]
- [x] History gains a `__comment__` with the reason, actor, and its own id. [proof: handoff]
- [x] `handoff` without `--reason` exits with code 2 and writes NOTHING. [proof: handoff]
- [x] A role outside the dictionary fails before any write. [proof: handoff]
- [x] A backlog without `roles:` says where to declare them. [proof: handoff]
- [x] Two identical comments at different times remain two events. [proof: handoff]
- [x] A row inserted twice by union-merge remains one. [proof: handoff]
- [x] The viewer carries the comment content and renders it through the `historyEntryKind()` rule. [proof: handoff]
- [x] A handed-off task returns to the queue — `next` issues it again. [proof: handoff]
- [x] `blocked` stays `blocked`; status returns to wherever the task was taken from. [proof: handoff]
- [x] Suite green after the `owner` contract change. [proof: suite-green]

Three things from the original wording are NOT done, and these are decisions,
not oversights:

- **A line in the `Log` section.** The section was abolished in TL-105 at
  zero adoption, and the reason has since traveled with the RECORD (the
  record's `reason` field). Appending prose would be a second copy of what
  the history already holds.
- **`next --role <target>`.** Selection by role belongs EXCLUSIVELY to
  TL-98 ("The scope of role enforcement is this task alone"), which is still
  waiting on TL-96. The half that can be verified today is done: the task
  returns to the queue and `next` issues it again. The role filter will
  arrive there.
- **`owner: unassigned`.** `unassigned` is a value from SOMEONE ELSE'S
  project (`owners:` in `config.yaml`), and nothing in this dictionary says
  which entry means "nobody". Instead of hardcoding that word, `owner` got
  `allowEmpty`: an unowned task is NO claim — the dashboard already grouped
  it by `!t.owner` anyway.

Where the status returns to is decided not by the dictionary, but by the
HISTORY of that task: `take` recorded the transition that handoff undoes.
The default configuration leaves TWO statuses meaning "waiting for someone"
(`pending` and `blocked`), so a rule reading `config.yaml` alone would be
ambiguous in the ordinary case, not just at the edge.

## Log

Append-only. Format: `YYYY-MM-DD status — who — note`.

- 2026-08-31 blocked — agent:claude — task created from the decision about
  roles; waiting on the role field (TL-97) and the lock from next (TL-87).
  First use of the reserved `__comment__`.
- 2026-09-01 blocked — agent:claude — added dependent TL-114 (the
  `__decision__` event builds on the `__comment__` implementation from this
  task).
