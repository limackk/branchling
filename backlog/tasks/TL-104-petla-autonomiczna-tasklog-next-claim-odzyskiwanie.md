---
id: TL-104
title: "Autonomous loop: worktrail next --claim, recovering abandoned tasks, fresh-session pattern"
type: code
labels: [post-launch]
board: main
epic: "CLI surface"
priority: P1
status: done
owner: agent:claude-opus-5
estimate: 1d
confidence: medium
created: 2026-09-01
updated: 2026-09-01
blocked_by: [TL-82]
blocks: []
related_docs:
  - docs/funkcjonalnosci.md
  - docs/branchling-state-and-sync.md
verification:
  - bash: "node --test scripts/tests/next-claim.test.mjs"
  - manual: "Two parallel loops of `while worktrail next --claim` on the same backlog never take the same task; an abandoned task (in_progress, stale `updated`) returns to the pool with an entry in the log, not silently"
---

## Goal

The backlog can drive an autonomous loop — `claude -p` or `codex exec` in a
fresh session per task — with no selection logic on the loop's side.
`worktrail next` says what's now; `--claim` takes it atomically; a task
abandoned by a dead session returns to the pool by itself. The session's exit
criterion is `worktrail done` (TL-82), not the agent's own opinion.

## Context

Context compaction at both vendors is lossy by construction: degradation from
~70% fill, decision context as the first casualty of summarization (Claude),
stalls at the threshold and cycles returning immediately to ~80% (Codex,
issues #19116, #35032). Anthropic's official advice: whatever needs to survive
the compaction boundary must live OUTSIDE the conversation. The correct
architecture for autonomous mode is therefore a fresh session per task — and
our task file (Goal / Context / Pre-flight / Steps / verification) is already
designed as a rehydration package for someone with no memory of the
conversation. This task closes three gaps that today keep this loop from
existing:

1. **Selection policy lives in the loop, not in the tool.** `query` filters,
   but "pending, unblocked, highest priority, oldest" would be written by
   every loop itself — and each differently. The policy must be ONE and
   testable.
2. **No atomic take.** Two loops in two worktrees (our own model of parallel
   work) would take the same task. Note the boundary of difficulty: two
   PROCESSES on one tree are settled by the file write; two WORKTREES only see
   each other after a commit — `--claim` guarantees atomicity within a single
   tree, and for multiple worktrees documents the pattern (a branch scan like
   in `next-id` / TL-73), instead of promising an atomicity git does not give.
3. **A dead session leaves `in_progress` forever** and the loop stalls.
   Staleness: `in_progress` + `updated` older than a window → the task
   returns to the pool with an entry in the log and in history (actor
   `agent:`), never silently. The window is a project configuration key. This
   is adjacent to heartbeats (TL-28), but does not require them — `updated` is
   enough to start.

Decided: `next` does NOT perform work and does NOT launch an agent. Selection
and taking are worktrail commands; the outer loop (shell, cron, hook) is
outside the tool and gets a sample script in the documentation. Rationale: Law
IV — composition instead of a built-in orchestrator that would have to know
about vendors.

The dependency on TL-82 is real: without the `done` gate the loop has no
mechanical exit criterion and "autonomy" means "the agent trusts itself".

## Pre-flight reading

1. `scripts/query.mjs` — existing filters and sorting; `next` should build on
   this, not compute it a second time.
2. `scripts/check-backlog-refs.mjs` — resolving `blocked_by`; "unblocked"
   means: every blocker in an archival status per `config.yaml`, not a
   literal.
3. `scripts/history-record.mjs` — history entry for the claim and for
   recovery.
4. `backlog/tasks/TL-82-*.md` — the `done` contract that closes the loop.
5. `backlog/tasks/TL-28-*.md` — heartbeats; do not duplicate, leave a hook
   point.

## Steps

1. `worktrail next [--json]`: one task, or an explicit "empty queue" (exit 0
   with a message, distinguishable from an error) — pending, unblocked,
   highest priority, oldest `created`, ties settled by ID.
2. `worktrail next --claim --owner <actor>`: atomically `in_progress` + `owner`
   + `updated` + a history entry. Actor mandatory with a namespace.
3. Recovery: `next` treats an expired `in_progress` as available; the takeover
   is recorded in `## Log` and history, saying from whom and why. The window
   is in the project configuration; an unknown key fails (Law III).
4. `--json` in the envelope from TL-72.
5. Documentation of the pattern: a sample loop for `claude -p` and
   `codex exec`, a SessionStart hook → `worktrail instructions overview`, a
   PreCompact hook → checkpoint into `## Log`. As the `autonomous-loop` topic
   in `instructions` (TL-74), not a separate file.
6. `scripts/tests/next-claim.test.mjs`: selection order on a fixture with
   ties; a blocked task not selectable until the blocker is archival; two
   `--claim` calls in a row do not give the same task; an expired
   `in_progress` returns with an entry; an empty queue is not an error.
   Positive control: fixture with NON-DEFAULT statuses in the config.

## Acceptance criteria

- [ ] `next` returns exactly one task per one documented policy, or an
      explicit empty queue.
- [ ] The take is atomic within a tree; the boundary of the guarantee for
      multiple worktrees is documented, not left unsaid.
- [ ] An abandoned task returns to the pool after the configured window, with
      a history entry and a warning on stdout — never silently.
- [ ] Selection respects `blocked_by` through archival statuses from the
      config, not literals.
- [ ] The loop pattern (Claude and Codex, with hooks) is a topic in
      `instructions`.
- [ ] Tests cover ties, blocks, double claim, staleness and an empty queue, on
      a non-default config.

## Log

2026-09-01 pending — agent:claude — founded on an analysis of autonomous mode: compaction at both vendors is lossy, so the architecture is a fresh session per task; the task file is a rehydration package, what was missing was selection, atomic taking, and recovery of abandoned tasks.
</content>
