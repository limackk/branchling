---
id: TL-756
title: "A contract approved by the task's executor is refused"
type: task
labels: []
board: main
epic: "Proof core"
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 4h
confidence: medium                 # how much you trust the estimate
created: 2026-11-16
updated: 2026-11-16
blocked_by: [TL-747]  # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: executor-refused
    bash: "node --test scripts/tests/seal-executor.test.mjs"
  - id: consumers-doc
    bash: "grep -q 'contract-approved-by-executor' docs/external-consumers.md"
  - id: suite
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

Core refuses a contract approved by the actor who executes the task: `seal` refuses an actor who holds the task, as `amend` does under TL-747, and `done` refuses to close a sealed task when the closing actor, or an actor who held the task in progress after the seal, is the actor who sealed it or approved its latest amendment. An agent cannot approve its own contract.

## Context

Filed on 2026-11-16 from the branchling-proof workspace (its task PF-23; its architecture section 13 lists this capability as U12). That product reaches branchling only through `--json` envelopes and the writing commands, and a capability that changes what `done` accepts as proven belongs in core, not in a consumer. The shape below is a proposal: it is settled with the maintainer before the work starts.

Decided by the consumer's founder on 2026-11-05 (its architecture Q-5, recorded in its concept §5.1): core refuses a seal approved by the task's executor; independence from the requester, whose identity lives in the IT service management record, is reported by the consumer and not enforced. The executor is known at two moments, so the rule applies at both: when the contract is sealed or amended (the current owner) and when the task closes (the closing actor, and every actor the history shows holding the task since the seal). Actors are compared by their full `ns:name`.

Proposed refusal kinds: `approver-is-executor` from seal (the kind amend's refusal of the owner shares), `contract-approved-by-executor` from done. In local mode actors are typed, not verified: the rule stops a lenient agent, not one that writes another actor's name. Builds on the seal (TL-747).

## Steps

1. Write scripts/tests/seal-executor.test.mjs red-first: a seal by the owner refused beside a seal by another actor; done refused when the sealer took the task or closes it, beside a close by an actor who did neither
2. Implement the refusals from the history records, before any entry runs
3. Document the refusal kinds in docs/external-consumers.md

## Acceptance criteria

- [ ] a seal or an amendment approved by the task's executor is refused at the seal and at the close [proof: executor-refused]
- [ ] the external consumer contract documents the refusal kinds [proof: consumers-doc]
- [ ] the full suite stays green [proof: suite]
