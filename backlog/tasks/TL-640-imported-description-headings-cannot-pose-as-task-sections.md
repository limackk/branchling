---
id: TL-640
title: "Imported description headings cannot pose as task sections"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-1
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: [import]  # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-07
updated: 2026-11-09
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: imported-headings-tests
    bash: "node --test scripts/tests/import-body.test.mjs"
  - id: import-suites-unchanged
    bash: "node --test scripts/tests/import-github.test.mjs scripts/tests/import-jira.test.mjs"
---

## Goal

A heading inside an imported issue's description can no longer be read as one of the task's own sections. Today `renderImportedBody()` in `scripts/import-body.mjs` pastes the source description under `## Goal` unchanged, so a GitHub body or a converted Jira description (`adfToMarkdown()` in `scripts/import-jira.mjs`) that contains `## Acceptance criteria` — a heading Jira tickets carry routinely — produces a task whose criteria section is the ticket's prose: `CRITERIA_HEADING` in `scripts/criteria.mjs` matches any `#{2,}` heading of that name, and `## Notes` or `## Steps` in a description collide the same way.

## Context

Found while implementing TL-581 (Jira import). Both sources share the body renderer, so the fix belongs there, once. Candidate approaches, to be weighed by whoever takes this: demote every heading in the imported text below the task's own level (e.g. `## X` becomes `### X` under `## Goal`), or fence the description. Demoting keeps it readable markdown; note that `CRITERIA_HEADING` matches `###` too, so demotion alone may not be enough and the criteria parser's rule may need to look only at second-level headings, or the import must rename a colliding heading. The product layer's planned Jira adapter maps ticket criteria into a contract through `import`; that is a separate, later task and must not be pre-empted here. Do not change what the marker line `Imported from <Source>: <url>` looks like: re-import deduplication and TL-582 read it.

## Steps

1. Reproduce: import a GitHub issue whose body contains `## Acceptance criteria\n\n- [ ] works`, then run `branchling check` and the criteria guard on the result.
2. Choose and implement the rule in `scripts/import-body.mjs` (and `scripts/criteria.mjs` only if the chosen rule needs it).
3. Add a test covering both sources.

## Acceptance criteria

- [x] A description containing `## Acceptance criteria`, `## Notes` or `## Steps` yields a task whose own sections are the importer's, for GitHub and Jira input alike. [proof: imported-headings-tests]
- [x] Both import sources still pass their own suites. [proof: import-suites-unchanged]
