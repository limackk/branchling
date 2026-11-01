---
id: TL-505
title: "Planned release scope is compared with what shipped"
type: task
labels: []
board: main
epic: "Release tracking across environments"
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-11-01
updated: 2026-11-01
blocked_by: [TL-501, TL-502]                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: [docs/release-tracking.md] # paths relative to the repository root
verification:
  - id: scope-tests
    bash: "node --test scripts/tests/release-scope.test.mjs"
---

## Goal

A task can name the release it is PLANNED for, and the tool compares the plan with what is actually deployed: `release status --release <name>` lists planned tasks not yet on production (the launch blockers) and deployed tasks the release did not plan (scope that arrived unplanned).

## Context

This is Jira's fixVersion: the INTENT, which is legitimately versioned data (Law 1), as opposed to deployment state, which is computed (the environments module in the same epic). Mixing the two in one field was rejected because intent is written by a person and deployment is observed.

Proposed shape: a `release:` frontmatter field drawing from a `releases:` list in config.yaml, closed like boards, so a typo fails instead of creating a release nobody plans. `epic` was considered and rejected as the carrier: an epic is WHAT is delivered and spans releases; a release is WHEN it ships. Labels were rejected because they are open by default and would let a misspelt release silently drop tasks from the readiness report.

**Decided 2026-11-01 by the owner:** an open P0 task planned for a release blocks the release check for the last stage of its targets (a gap even under `report`, failing under `require`). A release carries no target date.

## Steps

1. Add `releases:` to config validation and `release:` to the template, `new --release`, query filters and the viewer filter.
2. Extend `release status` with `--release <name>`: planned-not-deployed, deployed-not-planned, and planned tasks still open.
3. Test with fixtures.

## Acceptance criteria

- [ ] Planned-but-undeployed and deployed-but-unplanned tasks are both reported, and an unknown release value fails validation. [proof: scope-tests]
