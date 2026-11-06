---
id: TL-584
title: "The workflow guides point at deploy status and release planning"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P1                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-06
updated: 2026-11-06
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: guides-mention-deploy
    bash: "node --test scripts/tests/instructions*.test.mjs"
---

## Goal

The workflow guides printed by `instructions` tell an agent when to ask `deploy status` and `deploy status --release`, and that a task may carry `release:`, so a user who upgrades the package gets an agent that knows the promotion features exist.

## Context

The packaged skill `backlog-workflow` deliberately holds no procedure; it sends the agent to `instructions overview`, so the guides in scripts/instructions.mjs are the only channel through which an agent learns about a feature. As of 2026-11-06 none of overview, task-creation, task-execution, task-finalization or autonomous-loop mentions `deploy status`, `deploy record`, `--release`, `releases:` or `check --release`; the only hits for 'release' are 'release the task' (the claim command) and 'a weekly deploy' as a non-task example. An agent asked 'what is waiting for production' or 'what ships in 1.2' therefore has no pointer and will fall back to reading task files, which the context rule forbids. The guides are rendered with the backlog's vocabulary, so a project without `deploy_targets` or `releases:` must not be shown these lines.

## Steps

1. Decide which guide owns each question: planning a release in task-creation, the promotion state in overview or task-finalization.
2. Render the lines only when config.yaml declares `deploy_targets` or `releases:`, using the declared names.
3. Add a test with a fixture that declares both and one that declares neither.

## Acceptance criteria

- [ ] With deploy_targets and releases declared, a guide names `deploy status` and `--release`; without them, no guide does. [proof: guides-mention-deploy]
