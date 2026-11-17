---
id: TL-752
title: "done --dry-run stops at the first failing entry by contract"
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
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: stop-named
    bash: "node --test scripts/tests/done-dry-run-stops.test.mjs"
  - id: help-says-stop
    bash: "node scripts/cli.mjs done --help | grep -qi 'first failing entry'"
  - id: consumers-doc
    bash: "grep -q 'notRun' docs/external-consumers.md"
  - id: suite
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

The stop at the first failing entry that `done --dry-run` already performs is a stated contract: its help and the manual say so, and the `verification-run` envelope names the entries the run did not reach. A consumer that relies on the stop for its cost then relies on a promise, and a run that stopped never reads as a shorter contract that passed.

## Context

Filed on 2026-11-16 from the branchling-proof workspace (its task PF-23; its architecture section 13 lists this capability as U8). That product reaches branchling only through `--json` envelopes and the writing commands, and a capability that changes what `done` accepts as proven belongs in core, not in a consumer. The shape below is a proposal: it is settled with the maintainer before the work starts.

`runContract` in scripts/done-task.mjs stops at the first failure for a close and for a dry run alike; the consumer checked that on 0.3.0 and 0.4.0. Its mutation gate runs the contract once per mutant and counts on that stop for its cost. But `done --help` says `--dry-run` runs "the whole contract", the manual's example says the same, and two comments in done-task.mjs say a dry run "promises to run the whole contract". A maintainer who made the behaviour match those words would break the consumer, and one who made the words match the behaviour would leave no trace in the envelope: today it lists only the entries that ran, so a contract stopped at its second entry of three reads like a contract of two.

Proposed: the envelope gains `notRun: [{id, index}]` (index counted from 1, id null for an entry without one), empty when every entry ran; the help, the manual, docs/external-consumers.md and the two comments say that a dry run runs the contract as a close would, stopping at the first failing entry, and changes nothing. Red-before under `--base` (TL-748) runs every entry on the base tree on purpose; that is stated there, not changed here.

## Steps

1. Write scripts/tests/done-dry-run-stops.test.mjs red-first: a three-entry contract failing at its second entry neither runs the third (its marker file is absent) nor leaves it out of notRun; the positive control, a contract that passes, has every marker present and notRun empty
2. Add notRun to the verification-run envelope for close and dry run
3. Correct done --help, docs/manual.md, docs/external-consumers.md and the two comments in scripts/done-task.mjs

## Acceptance criteria

- [ ] a dry run stops at the first failing entry and names each entry it did not run [proof: stop-named]
- [ ] done --help says a dry run stops at the first failing entry [proof: help-says-stop]
- [ ] the external consumer contract documents notRun [proof: consumers-doc]
- [ ] the full suite stays green [proof: suite]
