---
id: TL-540
title: "query can be asked for the archived or every task by scope"
type: task
labels: []
board: main
epic: "External UI contract"
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
created: 2026-11-03
updated: 2026-11-03
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: query-scope
    bash: "node --test scripts/tests/query-scope.test.mjs"
---

## Goal

`query --json` can be asked for the active, the archived or every task without naming a single status, and its envelope says which scope it answered.

## Context

Found by branchling-ui (its UI-33), a consumer that may reach a backlog only through the --json answers; checked against 7af44b6 and still open. Without --status, query searches only the active tasks; `--status ""` gives the same set, and `all` or `*` are refused as unknown statuses. The only way to reach archived tasks is to name their statuses, which makes a consumer hard-code the vocabulary or derive it from the keys of `stats --json` byStatus, and both miss a task whose status is outside config.yaml. An Open / Archived / All switch in a task list cannot be built from the contract today.

## Steps

1. Add `--scope active|archived|all` to query (default `active`, today's behaviour); `archived` is the set archived_statuses names, `all` every task in tasks/ and the archive alike
2. Refuse `--scope` together with `--status` as a usage error (2), since one would silently override the other
3. Add `scope` to the query envelope, and document the flag and the key in docs/external-consumers.md

## Acceptance criteria

- [ ] A fixture with an active and an archived task answers the first under active, the second under archived and both under all, each envelope naming its scope; --scope with --status exits 2. [proof: query-scope]
