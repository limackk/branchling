---
id: TL-578
title: "Sprints are recorded as deliberately not built"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 30m
confidence: medium                 # how much you trust the estimate
created: 2026-11-05
updated: 2026-11-05
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: row-present
    bash: "grep -qE '^\\| \\*\\*Sprints' docs/functionality.md"
  - id: docs-links
    bash: "node scripts/cli.mjs check --docs"
---

## Goal

The decision not to model sprints is recorded in the table of things that deliberately will not happen, `docs/functionality.md` §4, with the reason, so the idea does not come back as "maybe after all".

## Context

On 2026-11-05 the owner asked whether branchling should have sprints. The analysis decomposed a sprint into five functions and found four already covered or deliberately excluded: committed scope (`release:`, plan waves, `epic:`, labels), goal (a wave's name, the plan's `rationale`), progress (`plan`, the viewer's burndown, `deploy status --release`) and velocity (the productivity analytics TL-377 put outside the product boundary and TL-378 removed). The remaining function, a time window, serves human teams; work handed out by `next` is bounded by a person's vouch, not by a session's time. The repository's own plan on 2026-11-05 also showed that an ordering without dates did not hold for three weeks: 25 tasks closed in waves after the active one and 12 of 22 open tasks sat outside every wave.

Modelling a sprint as a release was also rejected: `check --release` gates shipping on the current release's scope (TL-515), so a sprint read as a release would change what that gate means.

§4 already holds the closest precedent, "Milestones as files with their own IDs". This task records the decision only; it does not touch the rest of `docs/functionality.md`, whose stale claims are a separate task.

## Steps

1. Add a dated row for sprints to the table in `docs/functionality.md` §4, stating what a team that plans in sprints can use today and the only form in which the question may be reopened.
2. Adjust the sentence above the table so a row with a later date does not contradict it.
3. Run the documentation link guard.

## Acceptance criteria

- [x] The table of things that deliberately will not happen has a row for sprints. [proof: row-present]
- [x] Every link in the documentation still resolves. [proof: docs-links]
