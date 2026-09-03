---
id: TL-183
title: "next and run do not read plan.yaml, so a fleet works against priority"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-09-03
updated: 2026-09-03
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: ["docs/branchling-global-tool.md"]
verification:                      # HOW to check the task is really done
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
  - id: guards-green
    bash: "node scripts/cli.mjs check"
  - id: plan-order
    bash: "node --test scripts/tests/plan-order.test.mjs"
---

## Goal

`branchling next` and `branchling run` order candidates by priority and id, and
never open `plan.yaml`. A project that wrote a plan therefore watches its fleet
work in a different order than the one it decided — and the plan is the only
place where the ORDER of the work is stated at all.

Once this is done, `next` can be asked to respect the plan and `run --dry-run`
prints the waves it would work through, in wave order, not in priority order.

## Context

Measured on 2026-09-03 on this repository: a new plan was written with seven
waves, `check --plan` accepted it, and `run --dry-run` immediately listed
22 tasks led by `TL-149` — a task from wave 6 — because it is the highest
priority open task. Wave 1 held exactly one task and it came third.

**The plan is ADVISORY and stays that way.** The truth about state is the task
file's `status:`; the plan says only what somebody decided to do first. So this
is not "the plan starts governing the dispatcher" — it is a FILTER the caller
asks for, exactly like `--board` or `--role`:

- `next --plan` hands out only tasks the plan schedules, from the earliest wave
  that still has an open task. With no `plan.yaml` it fails with a usage error
  rather than silently handing out everything — a filter that matches
  everything reads as an empty plan.
- `run --plan` passes the same filter down; `--dry-run` then prints the order
  grouped by wave, with the wave name, so a reader can see the plan being
  followed.
- Without the flag NOTHING changes. A project with no plan must not pay for
  this, and priority order stays the default.

**Why a flag and not the default.** Making the plan implicit would mean an
unplanned task can never be handed out while a plan exists — the plan would
have become a truth it was never meant to be (law 2), and 15 open tasks in this
very repository are unplanned by deliberate choice.

**What this is NOT.** It is not re-ranking inside a wave: within one wave the
existing policy (priority, then id) still decides, because a wave is a batch and
the plan makes no claim about the order of its members. And the loop still does
not sort anything itself — the policy stays in `next`, where it is tested.

## Pre-flight reading

1. `scripts/plan.mjs` — the parser and the consistency guard; the wave shape and
   `blocked_by` reconciliation are already there, this task only consumes them.
2. `scripts/next.mjs` — where the candidate filters live and where the claim is
   made; the plan filter belongs beside `--board` and `--role`, before the claim.
3. `scripts/run.mjs` — how filters are passed from the loop into `next`, and how
   `--dry-run` renders the order it would work in.
4. `docs/branchling-global-tool.md` §3 — the four laws, in particular why a
   computed thing may be deleted and what that forbids here.

## Steps

1. Add a `--plan` flag to `next`: read `plan.yaml`, take the earliest wave with
   an open task, restrict candidates to that wave's ids, apply the existing
   policy inside it.
2. Fail with exit 2 when `--plan` is given and no plan exists, naming the file.
3. Pass `--plan` through `run`, and make `--dry-run` print the wave names.
4. A test that a task from a later wave is not handed out while an earlier wave
   still has an open task, on a FIXTURE tree — never on this repository's data.

## Decisions

Nothing decided yet beyond what is written above.
