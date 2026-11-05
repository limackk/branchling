---
id: TL-577
title: "GitHub import names milestones among what it leaves behind"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
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
  - id: help-names-milestones
    bash: "node scripts/cli.mjs import --help | grep -qi milestone"
  - id: import-tests
    bash: "node --test scripts/tests/import-github.test.mjs"
---

## Goal

`branchling import --help` names GitHub milestones among the things the import does not bring over, so a team whose sprint or milestone assignment lives in GitHub learns before the run that it stays behind.

## Context

`scripts/import-github.mjs` documents its own omissions in USAGE: "WHAT IT DOES NOT BRING OVER: comments, attachments, status history, assignees." The `gh issue list --json number,title,body,state,labels,url` command it recommends never requests `milestone`, so every milestone is dropped, yet the list does not say so. A milestone is not conversation around a task like the four named items: for a team that plans in GitHub it is the iteration or release the issue was committed to, which is exactly what a reader of the omission list needs to know is lost.

Surfaced while analysing whether branchling should have sprints (2026-11-05). That analysis concluded against a sprint entity; this task does NOT add one and does NOT map milestones into any field.

Mapping `milestone.title` to a label or to `release:` was considered and is deliberately left out of this task: a label would write project vocabulary that `labels_closed` may refuse, and `release:` carries deploy-gate meaning (`check --release`, `deploy status --release`) that a GitHub milestone does not have. Either mapping is a separate design decision.

## Steps

1. Add milestones to the omission line in USAGE in `scripts/import-github.mjs`, with one clause saying why it matters (a planning assignment, not conversation).
2. Mention the same omission wherever `docs/manual.md` or `docs/guide.md` describes what the import leaves behind, if either does.
3. Run the import tests.

## Acceptance criteria

- [ ] `import --help` names milestones among what the import does not bring over. [proof: help-names-milestones]
- [ ] The import's existing behaviour is unchanged. [proof: import-tests]
