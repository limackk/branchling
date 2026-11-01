---
id: TL-503
title: "A promotion with a traceability gap fails the check"
type: task
labels: []
board: main
epic: "Release tracking across environments"
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-11-01
updated: 2026-11-01
blocked_by: [TL-501]                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: [docs/release-tracking.md] # paths relative to the repository root
verification:
  - id: gaps-tests
    bash: "node --test scripts/tests/release-gaps.test.mjs"
---

## Goal

A promotion with a gap in its traceability FAILS before it happens: `branchling check --release [--env <name>]` exits non-zero and names every gap, so CI can run it as the gate before deploying to an environment.

## Context

Depends on scripts/environments.mjs from the same epic. 'No gaps' in release tracking means the set of changes deployed and the set of tasks the backlog says are finished agree in both directions. The gaps that professional pipelines guard against, each detectable from git plus the task files:

1. A commit on the environment ref that names no task id: an untracked change reaches users.
2. A task id in a deployed commit whose task is still open: shipped while unfinished, or the wrong id in a message.
3. A PARTIAL task: some of its commits are deployed and later ones are not.
4. A commit reachable from a later environment but not from the trunk or an earlier environment: a hotfix that the next ordinary deploy will silently revert.
5. A task closed as done whose commits are not on the trunk: finished on a branch nobody merged (the TL-74 incident in AGENTS.md).
6. A task id that does not exist in the backlog.
7. A deployed commit touching no declared target's paths, when targets declare paths.

Each gap is reported with the commit or task that proves it. Gaps that a project knowingly accepts (for example merge commits without an id) are configured, not hard-coded; an unknown gap name in that configuration fails. A positive control is required: the test must show the gate failing on a fixture with every gap, not only passing on a clean one.

## Steps

1. Implement the seven detectors in scripts/environments.mjs or a sibling module, each returning evidence.
2. Wire them into `branchling check --release` with `--env` and `--json`.
3. Document the CI usage (one line before the deploy step) in docs/manual.md.

## Acceptance criteria

- [ ] Every one of the seven gaps is detected on a fixture that contains it, a clean fixture passes, and the exit code is non-zero when any gap is found. [proof: gaps-tests]
