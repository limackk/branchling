---
id: TL-535
title: "A plan can be started by a command"
type: task
labels: []
board: main
epic: "External UI contract"
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-02
updated: 2026-11-03
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: plan-init
    bash: "node --test scripts/tests/plan-write.test.mjs"
---

## Goal

A backlog without plan.yaml can get one through a command that records the argument for the order, so tools and tests never write plan.yaml by hand.

## Context

Consumer: branchling-ui (limackk/branchling-ui), which may reach a backlog only through this CLI's --json answers. Its UI-22 test fixture writes a two-line plan.yaml by hand, and so did that repository's first plan. `plan add --wave … --why …` on a backlog without plan.yaml answers that there is no plan to edit, because a file it created would be an order with no argument for it; `seed`'s `wave` key accepts only an existing wave. Requiring the argument answers the refusal's own reason.

## Steps

1. `plan init --rationale "<why this order>"` writes plan.yaml with `updated`, `rationale` and an empty `waves:`, and refuses when a plan exists
2. After it, `plan add <ID> --wave "<name>" --why "<sentence>"` creates the first wave as it already can
3. `--json` answers a `plan` envelope

## Acceptance criteria

- [x] init on a backlog without a plan, then plan add --why, gives a plan that plan --json reads, and init on an existing plan is refused and changes nothing. [proof: plan-init]
