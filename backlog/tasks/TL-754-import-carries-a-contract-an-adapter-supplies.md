---
id: TL-754
title: "import carries a contract an adapter supplies"
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
estimate: 4h
confidence: medium                 # how much you trust the estimate
created: 2026-11-16
updated: 2026-11-16
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: import-contract
    bash: "node --test scripts/tests/import-contract.test.mjs"
  - id: github-import-unchanged
    bash: "node --test scripts/tests/import-github.test.mjs"
  - id: consumers-doc
    bash: "grep -q 'withContract' docs/external-consumers.md"
  - id: suite
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

An imported item may carry a `verification` array in the shape `new` and `seed` read; `import` writes it as the task's contract, with the criteria its `proves` texts name, validates it as `seed` does, and reports how many tasks arrived with a contract. An adapter that maps a specification's or a ticket's acceptance criteria to checks then writes the contract through the one-off import instead of leaving `verification:` empty.

## Context

Filed on 2026-11-16 from the branchling-proof workspace (its task PF-23; its architecture section 13 lists this capability as U10). That product reaches branchling only through `--json` envelopes and the writing commands, and a capability that changes what `done` accepts as proven belongs in core, not in a consumer. The shape below is a proposal: it is settled with the maintainer before the work starts.

Teams write specifications before agents work (GitHub Spec Kit, Kiro, OpenSpec, tickets). The consumer plans adapters that turn their acceptance criteria into a branchling contract through `import`, the composition import already uses for forge data, and that decide nothing about what counts as proven. Checked against the installed import on 2026-11-16 (0.4.0): `--from github` is the only source, no input key carries a contract, and `verification:` stays empty by design, counted as unfinishable in the report. `new` and `seed` do take a contract on stdin, but neither recognises a re-run by its source link, so an adapter run again after its specification changed would create every task a second time. TL-581 (Jira issues) notes that the consumer's Jira adapter would map criteria through import.

Proposed: each input item may hold `verification`; a malformed entry refuses the whole import with every complaint at once, as seed does; an item already imported (recognised by its source link) creates nothing and leaves the existing task's contract alone, because a contract changes only through an amendment (TL-747); the `import` envelope gains `withContract`, the number of tasks created with one.

To settle before the work: if the maintainer prefers that adapters write through `seed`, this task is cancelled with that reason; it is filed because import is the door the consumer's concept names.

## Steps

1. Write scripts/tests/import-contract.test.mjs red-first: an item with verification becomes a task whose contract and criteria match it; an item without one is imported as today and counted unfinishable (the positive control for the count); a malformed entry refuses the whole import and writes nothing; a re-import creates nothing and leaves the contract as it was
2. Accept and validate `verification` per item, reusing the validation seed uses rather than a second one
3. Add withContract to the import envelope, and update import --help and docs/external-consumers.md

## Acceptance criteria

- [ ] import writes a contract an item carries, refuses a malformed one, and leaves a re-imported task's contract alone [proof: import-contract]
- [ ] an import without contracts behaves as before [proof: github-import-unchanged]
- [ ] the external consumer contract documents withContract [proof: consumers-doc]
- [ ] the full suite stays green [proof: suite]
