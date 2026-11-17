---
id: TL-755
title: "A seal commits to its held-out checks by digest"
type: task
labels: []
board: main
epic: "Proof core"
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-16
updated: 2026-11-16
blocked_by: [TL-747]  # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: held-out-recorded
    bash: "node --test scripts/tests/seal-held-out.test.mjs"
  - id: consumers-doc
    bash: "grep -q 'heldOut' docs/external-consumers.md"
  - id: suite
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

`seal` and `amend` take `--held-out <sha256:hex>` (repeatable), record the digests in the ledger, and `show --json` returns them under `seal.heldOut`. A verifier holding checks the executor never saw can then show they were fixed before the work, without core storing, fetching or running them.

## Context

Filed on 2026-11-16 from the branchling-proof workspace (its task PF-23; its architecture section 13 lists this capability as U11). That product reaches branchling only through `--json` envelopes and the writing commands, and a capability that changes what `done` accepts as proven belongs in core, not in a consumer. The shape below is a proposal: it is settled with the maintainer before the work starts.

In the consumer's concept, part of a contract may be held out: stored outside the executor's working tree and fetched only by the verifier, so it cannot be gamed by special-casing the visible tests; an independent witness is where it would run. No build step schedules it yet, hence the priority. Core's part is only the commitment, a digest inside the seal record; the format of the held-out set and its runner belong to the verifier.

Proposed: a digest is `sha256:` followed by 64 lowercase hexadecimal digits, and anything else is refused; the commitment changes only through `amend --held-out`, under the amendment's rules. Builds on the seal (TL-747).

## Steps

1. Write scripts/tests/seal-held-out.test.mjs red-first: digests recorded by seal and amend and returned by show --json; a malformed digest refused beside a well-formed one
2. Add the flag to seal and amend and the key to show --json
3. Document it in docs/external-consumers.md

## Acceptance criteria

- [ ] a seal records the digests of its held-out checks and show --json returns them [proof: held-out-recorded]
- [ ] the external consumer contract documents heldOut [proof: consumers-doc]
- [ ] the full suite stays green [proof: suite]
