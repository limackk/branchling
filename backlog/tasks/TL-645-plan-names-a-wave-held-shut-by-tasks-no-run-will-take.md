---
id: TL-645
title: "plan names a wave held shut by tasks no run will take"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: [dispatch]  # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 3h
confidence: medium                 # how much you trust the estimate
created: 2026-11-07
updated: 2026-11-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: plan-held-wave
    bash: "node --test scripts/tests/plan-held-wave.test.mjs"
---

## Goal

`branchling plan` says when the active wave is held shut by tasks no unattended run will take, and names why for each one, so a stalled plan stops reading like a plan with work in it. `next up` never lists a task that `next --plan` will not hand out, and `plan` agrees with `run --dry-run --plan` about where the projection stops.

## Context

Observed on 2026-11-07. Wave 3 still held one open task, TL-498, in `awaiting_vouch`. `plan` printed it as "next up (wave 3): TL-498", while `run --dry-run --plan` answered "0 task(s) would run ... the projection stops at wave 3: 1 of 1 open task(s) in it are not this run's to take". Thirty-six pending tasks in later waves were unreachable for `next --plan`. The same holds for wave 8 today: its only open task, TL-451, is claimed by agent:codex-subagent since 2026-09-26, which `audit` already reports as parked (42 days), and `plan` lists it as plain "in progress". TL-199 made `plan` mark tasks only a PERSON can take (executor, role). It does not cover a task awaiting a vouch, a task in a status `reason_required_statuses` protects, or a claim `audit` calls parked. The code is the plan view (scripts/plan*.mjs); the run projection is the reference.

## Steps

1. Find where `plan` builds `next up` and where `run --dry-run --plan` decides a task is not this run's to take; make both use one predicate.
2. When every open task of the active wave fails it, print the wave as held, with one reason per task (awaiting a vouch, protected status, claim parked for N days per `audit_stale_days`, person-only).
3. Test: a fixture whose earliest open wave holds only an awaiting_vouch task and a parked claim; `plan` and `plan --json` say it is held and why, list no `next up`, and agree with `run --dry-run --plan`.

## Acceptance criteria

- [ ] plan names a wave held shut by tasks no run will take and agrees with run --dry-run --plan [proof: plan-held-wave]
