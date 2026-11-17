---
id: TL-750
title: "A seal records the approver's role and change record"
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
  - id: approver-recorded
    bash: "node --test scripts/tests/seal-approver.test.mjs"
  - id: help-names-flag
    bash: "node scripts/cli.mjs seal --help | grep -q -- '--change-record'"
  - id: consumers-doc
    bash: "grep -q 'changeRecord' docs/external-consumers.md"
  - id: suite
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

`seal` and `amend` take `--role <r>` and `--change-record <ref>`, record both in the ledger, and `show --json` returns them under `seal` and `amendments`, so a record of a contract's approval says which role approved it and under which change request.

## Context

Filed on 2026-11-16 from the branchling-proof workspace (its task PF-23; its architecture section 13 lists this capability as U6). That product reaches branchling only through `--json` envelopes and the writing commands, and a capability that changes what `done` accepts as proven belongs in core, not in a consumer. The shape below is a proposal: it is settled with the maintainer before the work starts.

Under DORA's RTS on ICT risk management, specifications are approved by the business function or the owner of the asset, and a change by a function independent of whoever requested and implemented it; the consumer's concept therefore has the approval record a role as well as a name, and in a financial entity the seal names the change request it belongs to in the IT service management tool.

Core records the claim and the reference; it never fetches or verifies the reference (no network). The consumer verifies the reference when it builds an evidence pack and states an assurance level for each approval (typed, forge-authenticated, signature-bound, system of record); those levels are presentation and stay outside core.

Proposed: `--role` is validated against `roles:` as `done --role` is; `--change-record` is an opaque string stored as given; a project may require either with a new `seal_requires:` key (values `role`, `change_record`; empty by default). Builds on the seal (TL-747).

## Steps

1. Write scripts/tests/seal-approver.test.mjs red-first: role and change record recorded by seal and amend and returned by show --json; an unknown role refused; a project requiring them refuses a seal without them, beside a seal that carries them
2. Add the flags, the `seal_requires` key and the show keys
3. Document them in seal --help, amend --help and docs/external-consumers.md

## Acceptance criteria

- [ ] seal and amend record the approver's role and change record, and show --json returns them [proof: approver-recorded]
- [ ] seal --help names --change-record [proof: help-names-flag]
- [ ] the external consumer contract documents the role and the change record [proof: consumers-doc]
- [ ] the full suite stays green [proof: suite]
