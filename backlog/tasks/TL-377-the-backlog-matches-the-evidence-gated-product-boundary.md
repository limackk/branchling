---
id: TL-377
title: "The backlog matches the evidence-gated product boundary"
type: task
labels: []
board: main
epic: "Evidence-gated product focus"
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-09-08
updated: 2026-09-08
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs:
  - README.md
  - backlog/plan.yaml
verification:
  - id: boundary-plan
    bash: "node --test scripts/tests/product-boundary-plan.test.mjs"
  - id: plan-green
    bash: "node scripts/cli.mjs check --plan"
---

## Goal

The active backlog and execution plan express one product: a repository-owned
protocol for evidence-gated agent delivery. Work whose outcome is telemetry,
portfolio management, tracker convenience, rich browser editing or managed
fleet infrastructure is cancelled with a stated reason, and the remaining plan
starts with product reduction rather than `run --workers N`.

## Context

The product was reviewed against its private founder decision on 2026-09-08.
That decision is intentionally unavailable to a future public checkout, so the
boundary is restated here: Branchling owns task selection, scope, verification
and the durable ledger. It does not own productivity analytics, multi-project
portfolios, provider distribution, rich tracker UI or parallel worktree
lifecycle.

Cancel these superseded open tasks through the supported history path, with a
reason naming the replacement task where one exists: TL-55, TL-76, TL-77,
TL-78, TL-79, TL-103, TL-149, TL-177, TL-209, TL-215, TL-226, TL-229, TL-236,
TL-245, TL-250, TL-252, TL-267, TL-269, TL-278, TL-279, TL-286, TL-317,
TL-344 and TL-348. TL-245 is also a duplicate of TL-241. Historical task files
and history records remain; cancellation is a decision, not deletion.

TL-102 remains the first refusal demonstration. TL-89 remains because an
evidence-centred PR summary is part of the product boundary. Publication tasks
that are not superseded stay open but must not precede TL-384's validation.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `README.md` — compare the public promise with the reduced boundary.
2. `backlog/plan.yaml` — replace the active managed-fleet direction.
3. `scripts/cli.mjs` — identify the commands owned by TL-378 through TL-383.
4. The named task files — confirm each cancellation is superseded rather than
   merely inconvenient.

## Steps

1. Record each cancellation with a concrete reason and preserve its history.
2. Replace the execution plan with reduction work in dependency order:
   TL-378 through TL-383 after this task, then TL-384.
3. Remove cancelled work from every plan wave without deleting its task file.
4. Add a focused test that asserts the cancellation set and that no cancelled
   task remains scheduled.
5. Rebuild computed views and run the plan guard.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [ ] Every named superseded task is cancelled with a non-reserved reason in
      its history. [proof: boundary-plan]
- [ ] No cancelled task remains in `plan.yaml`. [proof: boundary-plan]
- [ ] The reduction tasks precede the onboarding validation task and the plan
      contains no managed-fleet wave. [proof: boundary-plan]
- [ ] The resulting execution plan is structurally executable. [proof: plan-green]
