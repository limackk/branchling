---
id: TL-589
title: "A command no agent guide names is marked as not for agents"
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
blocked_by: [TL-584]  # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: guide-coverage-guard
    bash: "node --test scripts/tests/instructions-coverage.test.mjs"
---

## Goal

Adding a command fails the suite until an agent guide names it or its entry in the command table says it is not for agents, so a new feature cannot ship without a decision about whether agents learn of it.

## Context

The packaged skill and the agent pointer send an agent to `branchling instructions`; what the guides do not name, an agent does not use. On 2026-11-06, of the commands in `branchling --help`, these are named in none of the five guides: serve viewer next-id log show follow body release set deploy declare resume seed import plan-from docs-drift pr-summary where vocabulary hooks commit-message skills init profile conformance doctor plan migrate-prefix renumber mcp regen-hook. Some are rightly absent (init, hooks, renumber are a person's setup), others are exactly what an agent needs (show, set, body, deploy, vocabulary, plan). TL-584 adds deploy and release planning; this task adds the guard that would have caught it. MCP exposure is derived from the command table already, so it needs no guard.

## Steps

1. Add an audience field to each entry of the command table in scripts/cli.mjs (for example `agent` or `setup`), required for every entry.
2. Add a test that renders every guide against a fixture backlog and fails for each `agent` command no guide names, with a positive control command that is named.
3. Classify the commands listed above, and for each `agent` one add a line to the guide that owns its question.

## Acceptance criteria

- [ ] Every command marked for agents is named by at least one rendered guide, and removing one such line fails the test. [proof: guide-coverage-guard]
