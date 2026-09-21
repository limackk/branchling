---
id: TL-87
title: "worktrail next — atomic task assignment for an agent"
type: task
labels: []
board: main
epic: "Agentic distinguishers"
priority: P1
status: done
owner: agent:claude
estimate: 1d
confidence: medium
created: 2026-08-31
updated: 2026-09-01
blocked_by: []
blocks: [TL-96, TL-98, TL-99, TL-101]
related_docs:
  - docs/branchling-state-and-sync.md
  - docs/backlog-time-tracking.md
verification:
  # One entry for the WHOLE file, not one per criterion via `--test-name-pattern`:
  # a pattern that matches no test ends up green with zero tests, so such
  # proof would be green with no evidentiary force. Tests in this file are
  # named after the criteria and each has its own positive control.
  - id: suite
    bash: "node --test scripts/tests/next.test.mjs"
  - id: no-regression
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

Two primitives on one reservation mechanism:

- **`worktrail take TL-NNNN --actor agent:<name>`** — explicit taking of a
  SPECIFIED task: lock, `status: in_progress`, `owner`, session focus, an
  event in the history. This is the direct mode ("do TL-1234" said to an
  agent in Claude Code / Codex) — without selection and without roles.
  `take` on a task locked by another session refuses loudly: you learn about
  the collision when taking it, not at merge time.
- **`worktrail next`** = candidate selection → `take`. Selection is a thin
  layer over the same primitive.

`worktrail next --actor agent:<name>` picks the nearest executable task
(highest priority, `status: pending`, `blocked_by` empty or entirely closed),
atomically reserves it, sets `status: in_progress` + `owner`, writes an event
to `history/` and prints the task to stdout (with `--json` for machines). Two
sessions calling `next` concurrently on the same machine NEVER get the same
task.

Once this works, N agent sessions in N worktrees pick up backlog work on
their own, without a server and without an orchestrator — the backlog
becomes a work queue for a fleet of agents. This is a category
distinguisher, not another read command.

## Context

Grew out of a review of distinguishers against Backlog.md (2026-08-31):
competing tools are "agent-friendly" passively; none of them distributes
work. The foundation already exists: an event log with ULIDs (TL-21), an
attribution chain and the notion of a session (the time-tracking project),
locks scoped to a machine described in
[docs/branchling-state-and-sync.md](../../docs/branchling-state-and-sync.md) §6.1 —
atomicity on a single machine is guaranteed by a single writer, not by
consensus.

Variants rejected:
- **A dispatcher daemon** — breaks the "no daemon" decision
  ([docs/branchling-global-tool.md](../../docs/branchling-global-tool.md) §10).
- **A lock as an event in the log** — LWW resolves after the fact, so it does
  not give mutual exclusion (state-and-sync §6.1). The lock has to be a local
  primitive: a SQLite transaction, and until that exists, a lockfile created
  with `O_EXCL` (`wx`) in a directory outside git.
- **Selection on the agent's side** ("read the query and take the first
  one") — the race window between read and write is exactly what this
  command removes.

Scope is deliberately local: the guarantee covers a single machine (shared
disk, worktrees). Mutual exclusion across machines is the hosted version —
do not pretend to provide it here.

## Pre-flight reading

- [docs/branchling-state-and-sync.md](../../docs/branchling-state-and-sync.md) §5–§6
  — who wins on divergence, the boundary of local locks.
- `scripts/task-fields.mjs` — the single definition of frontmatter writes;
  `next` writes through it, not with its own code.
- `scripts/history.mjs` — writing the event for taking a task.
- `scripts/query.mjs` — existing selection and sorting; `next` is to reuse
  it, not duplicate it.

## Steps

0. The `take <ID>` primitive: validate the task's existence and status, lock,
   write the fields through the one existing path (`task-fields.mjs`),
   session focus, an event in the history; a busy lock = a loud refusal
   naming whose session holds it. `take` on a task with a non-empty role
   other than the one the caller declares PASSES, but records in the event
   that the take happened outside the role (the role gates the dispatcher,
   not an explicit human command — TL-97/1508).
1. Candidate selection: reuse `query`'s filters (status, priority per the
   order in `config.yaml`, resolved `blocked_by`); narrowing flags `--board`,
   `--label`, `--priority`.
2. Reservation: a `wx` lockfile per task in a state directory outside git; a
   busy lock = next candidate. Lock expiry after `lock_ttl_minutes` from the
   configuration (the code knows the shape, the configuration the values).
3. Write: `status: in_progress`, `owner`, `updated` via `task-fields.mjs`; an
   event to `history/` with the actor from `--actor` (namespace mandatory).
4. Output: the full task on stdout, `--json` structurally; no candidate = a
   message + an exit code distinguishable from a call error.
5. Concurrency test: two parallel `next` calls on the same tree get two
   different tasks — positive control: without the lock this test MUST fail.

## Acceptance criteria

- [x] Two parallel `next` calls never return the same task — a test with real
      concurrency, not sequential. [proof: suite]
- [x] `take` on a task locked by another session refuses with a message and
      error code; it does not overwrite someone else's lock. [proof: suite]
- [x] `next` is implemented as selection + `take` — there is no second
      reservation path (import test). [proof: suite]
- [x] A task blocked by an unresolved `blocked_by` is not handed out.
      [proof: suite]
- [x] `--actor` without a namespace fails (consistent with TL-21).
      [proof: suite]
- [x] An empty backlog / no candidate gives an unambiguous message, not silence.
      [proof: suite]
- [x] The event for taking a task is in `history/` with the correct actor.
      [proof: suite]
- [x] The rest of the tool does not regress under concurrent writes.
      [proof: no-regression]

The criterion "taking outside the role is recorded in the event, never
blocked" was MOVED to [TL-97](TL-97-task-role-field-role-requirement-from-the-configuration.md),
which introduces the `role:` field. It cannot be proven here: the field is
in neither the frontmatter nor the configuration dictionary, so a test would
take a fixture with a field that nothing else writes — green on a sample
that is not in the tree. The half that is true today is done: `take` does
NOT have a role gate and will not have one (the role gates the dispatcher —
decision from TL-97).

## Log

Append-only. Format: `YYYY-MM-DD status — who — note`.

- 2026-08-31 pending — agent:claude — task created from a review of agentic
  distinguishers against Backlog.md; source: docs/branchling-state-and-sync.md §6.1.
- 2026-08-31 revised — agent:claude — split into the take/next primitives, so
  that direct mode ("do TL-1234" said to an agent) gets a lock, attribution
  and focus without a dispatcher; taking outside a role is recorded, not
  blocked.
