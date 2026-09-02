---
id: TL-141
title: "A task handed back as too large is re-offered by next immediately"
type: task
labels: []
board: main
epic: ""
priority: P2                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
estimate: 4h                       # 30m | 2h | 1d | 1w | 1mo
created: 2026-09-02
updated: 2026-09-02
blocked_by: []
blocks: []
related_docs: []
verification:                      # HOW to check that the task is really done
  - id: handed-back-is-not-reoffered
    bash: "node --test scripts/tests/next.test.mjs"
---

## Goal

A task a session hands back because it does not fit a session is not the very
next thing `next` offers — to that session or to the next one in the same run.

## Context

Measured on 2026-09-02, twice in a row. A run working the queue was handed
TL-137 (a migration estimated at `1w`, whose own text forbids doing it in
parts). The session handed it back with `handoff` and a stated reason. `next`
offered it again on the following call, because nothing about the handoff is
part of selection: `handoff` clears the owner and returns the status, and the
task is once more the highest-priority executable candidate. Handing it back a
second time changed nothing either.

**Why this is not the same as an unfinished attempt.** `run` already parks a
task whose contract fails `--max-attempts` times, in the status
`reason_required_statuses` protects, and the dispatcher stops offering it. That
path covers "the agent tried and could not". This one is different and has no
mechanism at all: the session judged BEFORE starting that the task does not fit
a session, which is the judgement `handoff` exists to record — and the record
has no effect on what happens next.

**Why `--to-role` does not answer it.** A handoff aimed at a role is skipped by
`next --role` (TL-98) only when the caller names roles. A backlog that declares
none — this one — has nothing to hand to, so the flag cannot express "somebody
other than this run".

**What must not be built.** A filter in the loop. Selection policy belongs to
`next` and is tested; a session that skips candidates on its own is a queue with
the choosing put back in (`instructions autonomous-loop`). Whatever the answer
is, it is a fact written in the tree or in the dispatcher, not a rule an agent
keeps to itself.

Candidates, none of them settled:

- **A handoff is remembered for the actor that made it.** `next` passes over a
  task whose most recent `__comment__`/`role` handoff came from THIS actor,
  unless nothing else is left. Cheap, needs no new field, and reads the history
  the handoff already writes.
- **A size the dispatcher respects.** `estimate` is already in the frontmatter;
  a `--max-estimate` on `next`/`run` would let a caller say what fits. It states
  the fact in the caller's layer, where "how long my session is" belongs.
- **A field on the task.** Something like `needs_own_session: true`, travelling
  with the branch through review. Honest, and one more field to keep true.

## Pre-flight reading

1. `scripts/handoff-task.mjs` — what a handoff writes, and what it does not.
2. `scripts/next-task.mjs` — `selectCandidates()`; where a pass-over would go
   and how the existing ones (`heldElsewhere`, executor, roles) are counted and
   named.
3. `scripts/run-loop.mjs` — the parking path for a task that failed its
   contract, so the two mechanisms stay distinct.
4. `backlog/history/TL-137.jsonl` — the two handoffs and their reasons, which
   are the measurement this task starts from.

## Steps

1. Choose among the candidates above (or a better one) and write down why,
   including what each rejected option would have cost.
2. Implement it in the dispatcher, never in a caller's loop.
3. A pass-over is NEVER silent: it is counted and named on stdout and in
   `--json`, like every other in `next`.
4. Test with a positive control: the task IS offered again once the condition
   that held it back is gone (a different actor, a larger budget, the field
   cleared) — a rule that only ever hides work would empty the queue quietly.

## Acceptance criteria

- [x] A task handed back by an actor is not the next thing offered to that same actor. [proof: handed-back-is-not-reoffered]
- [x] The pass-over is named on stdout and present in `--json`. [proof: handed-back-is-not-reoffered]
- [x] POSITIVE CONTROL: the task is still offered when the condition no longer holds. [proof: handed-back-is-not-reoffered]
- [x] No selection logic moved into `run` or into any caller's loop. [proof: handed-back-is-not-reoffered]
