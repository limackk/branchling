---
id: TL-559
title: "An unknown filter value or role is a refusal envelope"
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
conflict_group: [json-envelope]  # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 3h
confidence: medium                 # how much you trust the estimate
created: 2026-11-04
updated: 2026-11-05
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: unknown-filter-value
    bash: "node --test scripts/tests/unknown-filter-value.test.mjs"
---

## Goal

query --status, --priority and --board, and handoff --to-role, answer a value outside the backlog's vocabulary with a refusal envelope (refusalKind unknown-value) naming the declared values, like set does since TL-543.

## Context

Found by branchling-ui during UI-24. On main, `query --status nope --json` and `handoff <ID> --to-role nope --json` exit 2 with a usage message on stderr and no envelope, so a consumer cannot tell a person's typed value outside the vocabulary from its own wrongly built call. branchling-ui keeps rejectingTypedInput in src/request-error.mjs only to guess at this; it can delete it once the envelope exists. TL-543 established refusalKind unknown-value for set; scripts/json-envelope.mjs holds the kinds and docs/external-consumers.md documents them.

## Steps

1. Answer an undeclared status, priority or board in query, and an undeclared role in handoff, with refusalKind unknown-value, the rejected field and value, and the declared values
2. Keep exit 1 for this refusal and 2 for a wrongly built call
3. Document it in docs/external-consumers.md and test each case

## Acceptance criteria

- [ ] query and handoff answer an undeclared value with an unknown-value envelope naming the declared values. [proof: unknown-filter-value]
