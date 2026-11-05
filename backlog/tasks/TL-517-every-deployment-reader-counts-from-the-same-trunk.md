---
id: TL-517
title: "Every deployment reader counts from the same trunk"
type: task
labels: []
board: main
epic: "Release tracking across environments"
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 1h
confidence: medium                 # how much you trust the estimate
created: 2026-11-02
updated: 2026-11-02
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: [docs/release-tracking.md] # paths relative to the repository root
verification:
  - id: query-trunk
    bash: "node --test scripts/tests/query-trunk.test.mjs scripts/tests/environments.test.mjs scripts/tests/show.test.mjs"
---

## Goal

Every command that reports deployment counts from the same trunk: `query --json`, `--env` and `--not-env` use `defaultTrunk()` like `show` and the deploy status report, and each names the trunk it used.

## Context

Decided 2026-11-02 by the owner. TL-501 made `query` count from `HEAD`; TL-502 added `defaultTrunk()` (the remote's default branch, else HEAD) for the report and the gate, and TL-509's `show` used it too. On a feature branch the same task could therefore read deployed in `show` and not in `query`, and the difference is invisible unless one reads both headers. A `--trunk` flag was considered and not chosen: one answer per question first; a flag can be added when somebody needs to ask about a branch deliberately.

Change only the default: deploymentState() keeps its `trunk` parameter. The envelope-level `deploy` in `query --json` already names the trunk; the text output must name it too whenever deployment is shown.

## Steps

1. Pass defaultTrunk() in scripts/query.mjs wherever deploymentState() is called.
2. Name the trunk and its source in query's text output when --env or --not-env is used.
3. Add a test that runs query and show on a feature branch with an unmerged commit naming a task and gets the same answer from both.

## Acceptance criteria

- [x] On a feature branch query and show give the same deployment state for a task, and query names the trunk it used. [proof: query-trunk]
