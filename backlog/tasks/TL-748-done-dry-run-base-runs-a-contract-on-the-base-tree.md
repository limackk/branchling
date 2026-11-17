---
id: TL-748
title: "done --dry-run --base runs a contract on the base tree"
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
blocks: [TL-749]  # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: red-before
    bash: "node --test scripts/tests/done-red-before.test.mjs"
  - id: help-names-base
    bash: "node scripts/cli.mjs done --help | grep -q -- '--base'"
  - id: consumers-doc
    bash: "grep -q 'redBefore' docs/external-consumers.md"
  - id: suite
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

`done <ID> --dry-run --base <rev> --json` runs the contract the head defines on the tree of <rev>, with the change's test files carried onto it, runs every entry there, and returns a red-before verdict beside the head's run. Whether a contract fails without its change becomes a fact core establishes, not one a script outside core computes by its own rules.

## Context

Filed on 2026-11-16 from the branchling-proof workspace (its task PF-23; its architecture section 13 lists this capability as U4). That product reaches branchling only through `--json` envelopes and the writing commands, and a capability that changes what `done` accepts as proven belongs in core, not in a consumer. The shape below is a proposal: it is settled with the maintainer before the work starts.

A contract that already passes before its change proves nothing about the change; `contractCapability` (the run executed a file this task changed) is a weaker form of the same question. The consumer measured red-before with research scripts that read git objects: the base checked out, the files the work added or changed under the test directory overlaid on it (the test patch, as SWE-bench applies it), every task-specific entry run at the base and at the head, with four verdicts. Its gate never runs a contract entry itself (it prepares a clean clone and asks core), so red-before has to be a core verdict, and so does the choice of which files of the change are carried onto the base, because that choice decides what counts as red.

Proposed shape: core makes a temporary worktree at <rev>, copies onto it the head's files that match the globs of a new `red_before_carry:` key in config.yaml (the command refuses when the key is empty, rather than guess), runs every bash entry of the head's contract there WITHOUT stopping at the first failure (each entry's result at the base is the point), removes the worktree, then runs the head as a dry run does. The `verification-run` envelope gains `redBefore`: {base: full sha, carried: [paths], verdict, entries: [{id, ok, exitCode, ms}]}, null without --base. The verdicts are the consumer's: `red`, at least one entry fails at the base and passes at the head; `weak`, every entry passes at the base; `unreproducible`, entries fail at the base and none of them passes at the head; `inconclusive`, an entry was interrupted or ran out of time. `--base` without `--dry-run` is a usage error until contract kinds (TL-749) decide when a real close requires `red`.

Rejected: carrying the files the entries name (a whole-suite entry names none) and carrying every changed file (that is the change itself, so everything would pass at the base).

## Steps

1. Write scripts/tests/done-red-before.test.mjs red-first over a fixture repository: a contract whose test fails at the base is `red`, one that passes at the base is `weak` (the positive control for the same fixture), a base where the entries fail and the head fails too is `unreproducible`; the carried paths are named; an empty `red_before_carry` is refused and nothing runs
2. Add `red_before_carry` to the configuration with its validation and its documentation
3. Run the base in a temporary worktree that is removed on every path, interrupt included, and run every entry there without stopping
4. Add `redBefore` to the verification-run envelope and `--base` to done --help, and document both in docs/external-consumers.md and docs/manual.md

## Acceptance criteria

- [ ] done --dry-run --base returns each entry's result on the base tree, the carried files and the red-before verdict [proof: red-before]
- [ ] done --help names --base [proof: help-names-base]
- [ ] the external consumer contract documents redBefore [proof: consumers-doc]
- [ ] the full suite stays green [proof: suite]
