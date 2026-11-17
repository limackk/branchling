---
id: TL-747
title: "A sealed contract changes only through a recorded amendment"
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
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-11-16
updated: 2026-11-16
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: [TL-749, TL-750, TL-755, TL-756]  # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: seal-amend
    bash: "node --test scripts/tests/contract-seal.test.mjs"
  - id: done-refuses
    bash: "node --test scripts/tests/done-sealed-contract.test.mjs"
  - id: run-refuses
    bash: "node --test scripts/tests/run-sealed-contract.test.mjs"
  - id: consumers-doc
    bash: "grep -q 'task-seal' docs/external-consumers.md && grep -q 'sealed-contract-changed' docs/external-consumers.md"
  - id: suite
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

A named actor can seal a task's contract, `done` and `done --dry-run` refuse a task whose contract differs from the one last sealed or amended, and the only way to change a sealed contract is `amend`, which records a reason and is refused to the task's owner. The checks that close a task are then the checks somebody approved before the work, which is what a third party needs before it trusts a closing.

## Context

Filed on 2026-11-16 from the branchling-proof workspace (its task PF-23; its architecture section 13 lists this capability as U3). That product reaches branchling only through `--json` envelopes and the writing commands, and a capability that changes what `done` accepts as proven belongs in core, not in a consumer. The shape below is a proposal: it is settled with the maintainer before the work starts.

Today nothing records an approved contract: a contract edited by hand closes as proven, and an approved change has no command to record it (the consumer's own PF-23 contract was edited by hand after its founder approved an extension: decision 01M6PHCHEVYH3A1S9MXP9X44FA in that backlog is the approval, 01M6PHDVR4NPNFAC2ZPGBG9G4Y the agent's record of the hand edit). The proposed shape, from the consumer's worked proposal (docs/upstream/u3-seal-and-amendment.md there), which the consumer's founder approved as filed on 2026-11-17 (decision on question 01M7K5W7Z2VK5TRM3QH4DBHNDB in that backlog):

(1) `seal <ID> --actor <ns:name> [--json]` appends a `__sealed__` record to history/<ID>.jsonl with the trunk commit and a sha256 digest of the contract; the trunk is resolved as `check --release` resolves it (origin/HEAD, else HEAD); it refuses when the working tree's contract differs from the contract at that commit, or when that commit is not reachable from the trunk. Rejected: an implicit seal at the first trunk commit holding the contract, because every task an agent committed would then count as sealed with nobody approving.

(2) The digest's input is what `show --json` returns under `verification` (TL-561): each entry's id, its bash or manual text, and the texts of the criteria linked to it by [proof: id], with the checkbox state stripped (a closing ticks criteria, and that must not read as an amendment), serialised canonically. Any other change counts, an added entry included.

(3) `amend <ID> --reason "…" --actor <ns:name> [--json]` appends an `__amended__` record with the new digest; the reason is required; it is refused when the actor is the task's current owner.

(4) `done` and `done --dry-run` on a sealed task whose contract digest differs from the latest sealed or amended digest refuse before running any entry, with refusalKind `sealed-contract-changed`. An unsealed task closes as today and its envelope says `seal: null`.

(5) `show --json` gains `seal` ({commit, digest, actor, ts} or null) and `amendments` ([{digest, actor, reason, ts}]); the kinds `task-seal` and `task-amend` are registered, and docs/external-consumers.md documents all of it under the TL-72 schemaVersion policy.

(6) Under `run`, a hand that weakens a sealed contract does not get its task closed, and the refusal reaches its next attempt.

Each of these is a task of its own and out of scope here: red-before against a base tree (TL-748), contract kinds (TL-749), the approver's role and change record (TL-750), history integrity (TL-753), the held-out digest (TL-755) and the refusal of a seal approved by the executor (TL-756). In local mode an actor is typed, not verified: the seal stops a lenient agent, not one that writes `user:` itself.

## Steps

1. Write the red-first tests: scripts/tests/contract-seal.test.mjs (seal records the commit and the digest; it refuses a working tree that differs from the commit and a commit the trunk does not reach; amend records its reason and is refused without one and to the owner; show --json returns seal and amendments), scripts/tests/done-sealed-contract.test.mjs (done and done --dry-run refuse a changed sealed contract before any entry runs, beside the positive controls: an unchanged sealed contract and an amended one both close) and scripts/tests/run-sealed-contract.test.mjs (end to end under run)
2. Compute the digest from the parsed entries `show --json` returns, never from the file's bytes, so reformatting is not an amendment and ticking a criterion is not either
3. Add `seal` and `amend` as writing commands with --json envelopes and history records, and register their kinds
4. Refuse in done, dry run included, before the first entry runs
5. Document the commands, the refusal kind and the new show keys in docs/external-consumers.md and docs/manual.md

## Acceptance criteria

- [ ] seal and amend record the approved contract in the ledger, and each of their refusals holds [proof: seal-amend]
- [ ] done and done --dry-run refuse a sealed contract changed without an amendment, and close an unchanged or amended one [proof: done-refuses]
- [ ] a run cannot close a task whose sealed contract its hand weakened [proof: run-refuses]
- [ ] the external consumer contract documents the seal, the amendment and the refusal [proof: consumers-doc]
- [ ] the full suite stays green [proof: suite]
