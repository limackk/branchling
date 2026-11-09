---
id: TL-660
title: "the viewer shows a wave held shut the way plan does"
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
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-08
updated: 2026-11-08
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: viewer-plan-held
    bash: "node --test scripts/tests/viewer-plan.test.mjs"
---

## Goal

The viewer's Execution view and dashboard compute the plan with the same holds `branchling plan` applies, so a wave held shut by tasks no unattended run will take is shown as held in the page too, and the page's next up never lists a task `next --plan` hands out to nobody.

## Context

TL-645 added `unattendedHold` to scripts/plan.mjs: `planState` now marks each open task with a hold (awaiting a vouch, a protected status not yet discharged, a fresh or parked claim, person-only, over-size), marks a wave `held` when every open task carries one, and drops non-startable holds from `nextUp`. The terminal (`scripts/plan-report.mjs`) and `run --dry-run --plan` (`scripts/run-loop.mjs`) pass the whole configuration plus `now`. The viewer does not: `renderExecution_()` and `dashboardPlanState()` in scripts/build-viewer.mjs call `planState` with only `archivedStatuses` and `inProgressStatus`, so in the page an `awaiting_vouch` task or an undischarged `blocked` task is still next up, no claim is ever aged into a parked one, and no wave is shown as held. scripts/viewer-plan.mjs renders the state and has no wording for a hold. The page and the terminal therefore disagree about the same plan, which is the disagreement `planState`'s header exists to prevent.

## Steps

1. Pass the configuration keys `unattendedHold` reads (awaitingVouchStatus, reasonRequiredStatuses, auditStaleDays, abandonedAfterDays, estimates, maxUnattendedEstimate) and `now: Date.now()` to both `planState` calls in scripts/build-viewer.mjs.
2. Render a held wave in scripts/viewer-plan.mjs with one reason per task, using `describeHold` from scripts/plan.mjs (already pasted into the page).
3. Test in scripts/tests/viewer-plan.test.mjs: a fixture whose active wave holds only an awaiting-vouch task renders as held with that reason and lists no next up; a positive control with the task pending renders it as next up.

## Acceptance criteria

- [ ] the viewer shows a held wave and its reasons the way `plan` prints them [proof: viewer-plan-held]
