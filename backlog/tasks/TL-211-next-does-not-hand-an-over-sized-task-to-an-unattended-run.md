---
id: TL-211
title: "next does not hand an over-sized task to an unattended run"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: in_progress  # pending | in_progress | blocked | done | cancelled
owner: agent:dev
role: dev  # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 4h
confidence: medium                 # how much you trust the estimate
created: 2026-09-03
updated: 2026-09-04
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
  - id: guards-green
    bash: "node scripts/cli.mjs check"
  - id: size-gate
    bash: "node --test scripts/tests/next-size-gate.test.mjs"
---

## Goal

A task whose estimate is above a threshold this project states is not handed to
an unattended run. `take <ID>` still works, so a person can start a session for
it deliberately.

## Context

Decided by the project owner on 2026-09-03, answering three open questions at
once: two on TL-137 and one on TL-149.

The evidence is in the log. TL-137 (estimate `1w`) was handed back twice by the
same run, the second time with:

    nothing in the tree marks a task as too large for a session, so next
    re-offers it immediately

TL-149 (also `1w`) was handed back for the same reason and is still in the
queue, where every run can take it again:

    a week of work: worktree lifecycle, fast-forward merge, parking a conflict
    and a multi-worker report are four separate designs, and the task's own
    text forbids splitting the merge rule from the dispatcher — it needs its
    own session, not the tail of one

**Why a threshold and not a split.** Splitting TL-149 was considered and
rejected: its own text forbids separating the merge rule from the dispatcher,
because a divergence between them shows only if both are written at once.
Marking each large task `executor: human` was also rejected — it answers this
instance and leaves the class open, and nobody remembers to set it until a run
has already handed the task back twice.

**Why it composes.** `estimates` is already a vocabulary in `config.yaml`, so
the threshold is a VALUE this project states and not a number in the code. The
filter itself has two precedents in `next`: `executor:` (TL-113) and `role:`
(TL-98) both narrow the candidates BEFORE the claim, and both report what they
passed over rather than looking like an empty queue. This is a third of the
same kind — no new layer, no second source of truth.

**What it must not become.** Not a block on the task: an over-sized task is
still executable, by a person, by `take`, and by a run someone points at it
deliberately. The gate is about what an UNATTENDED dispatcher offers, which is
the same distinction `executor:` draws.

**The threshold is ordered, and that is the subtlety.** `estimates: [30m, 2h,
1d, 1w]` is a list, and "above the threshold" means later in that list, not a
parsed duration. Parsing `1w` into hours would invent a scale this project has
not stated and would break the moment somebody writes `2mo`.

**The report must say so.** A run that passed over a task for its size has to
name it, exactly as the executor filter names what it could not be handed.
Otherwise the queue reads as empty while a week of work sits in it.

## Pre-flight reading

1. `scripts/next-task.mjs` — the candidate filters and the `skippedExecutor`
   reporting; this is the shape to copy, both the filter and the message.
2. `scripts/config.mjs` — `DEFAULTS`, `KNOWN_KEYS` and where a new key is
   declared; the key belongs to the project layer, never the user layer.
3. `backlog/config.yaml` — `estimates:` and the comments around the other
   vocabularies, for how a value is documented here.
4. `backlog/history/TL-137.jsonl` and `TL-149.jsonl` — the questions and the
   decision that answers them.

## Steps

1. A key in `config.yaml` naming the largest estimate an unattended run may be
   handed. Absent means no gate — a project that has not stated one gets the
   behaviour it has today.
2. `next` passes over anything above it and NAMES what it passed over.
3. `run` reports the same, beside the executor block.
4. `take <ID>` is unaffected, and a test proves it.
5. `scripts/tests/next-size-gate.test.mjs` over a fixture with its own
   `estimates` list — never this project's values.

## Decisions

The owner decided the direction on 2026-09-03. The threshold VALUE for this
backlog is not decided and belongs in the commit that sets it; `1d` is the
obvious candidate, since both tasks that provoked this are `1w`.
