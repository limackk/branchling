---
id: TL-677
title: "plan add places a new wave before or after a named wave"
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
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-10
updated: 2026-11-10
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: plan-add-position
    bash: "node --test scripts/tests/plan-write.test.mjs"
---

## Goal

`plan add --wave` can create a new wave at a stated position, so a wave meant to run soon is not created behind a wave that waits on a person.

## Context

Observed on 2026-11-10. `branchling plan add <ID>... --wave "<new name>" --why "…"` (scripts/plan-write.mjs) always appends a newly created wave at the end of `waves:` in backlog/plan.yaml. In this repository the end of the plan holds the human publication gates and the release waves, so a new wave of agent follow-ups landed behind "Human publication gates", where `plan` holds it shut until a person acts. It had to be moved by editing plan.yaml by hand, which also left the `--why` comment unwrapped on one long line. `plan move` moves a TASK between waves; nothing moves or places a WAVE.

## Steps

1. Add `--before "<wave name>"` and `--after "<wave name>"` to `plan add` for the case where it creates a wave; naming a wave that does not exist, or using either flag when the wave already exists, is refused before any write
2. Wrap the `--why` comment at the width the rest of plan.yaml uses
3. Document both flags in `plan --help` and test a wave created before, after, and at the end (the default unchanged)

## Acceptance criteria

- [ ] plan add creates a new wave before or after a named wave, and refuses an unknown one [proof: plan-add-position]
