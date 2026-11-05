---
id: TL-565
title: "A nested check --proofs does not re-run every contract again"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-2
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: [proofs]  # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-05
updated: 2026-11-05
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: nested-proofs
    bash: "node --test scripts/tests/proofs-reentrance.test.mjs"
  - id: help-says-nested
    bash: "node scripts/cli.mjs check --help | grep -qi 'nested'"
  - id: suite
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

A `check --proofs` started from inside a contract entry that a `check --proofs` run is executing does not re-run every closed contract again. A closed contract that holds the entry `branchling check --proofs` then no longer makes every later proofs run recurse without end, and the help says what a nested run does.

## Context

Found by a consumer. In the branchling-proof repository, task PF-3 was closed on 2026-11-05 with the entry `earlier-proofs-hold: branchling check --proofs`, meaning every contract closed before it still passes on the changed tree. Closing worked, because during `done PF-3` the task was still open and the inner run did not re-run it. From then on every `check --proofs` re-ran PF-3's contract, which started another `check --proofs`, which re-ran PF-3 again. About 158 nested processes were running after roughly ten minutes and were stopped by hand. A stuck run does not end when its caller gives up: every contract entry is started as a session leader, so even killing the outermost process group leaves the nested runs recursing (seen on macOS: each nested `check --proofs` had its own process group, state `Ss`). Stopping one took freezing every descendant by parent pid before killing any. The consumer's next task dropped the entry, and PF-3's contract was amended there to re-run the earlier contracts by name with `done <ID> --dry-run`; that is a workaround each consumer has to discover after the hang.

The hazard is already named: the help of `--proofs` says 'NEVER part of a bare `check`: those contracts are test suites, and one of them may be this command', and the TL-147 comment in scripts/cli.mjs (where `--proofs` is left out of the bare run) explains that a bare `check` would otherwise call itself for as long as the machine let it. That reasoning covers a contract that runs a bare `check`. It does not cover a contract that runs `check --proofs` itself, and 'every earlier contract still passes' is a reasonable entry for a consumer to write, so the tool has to make it safe rather than each consumer.

Proposed mechanism: the proofs run marks the environment of every contract entry it executes (an environment variable naming the run). A `check --proofs` started with that mark set does not re-run contracts. It prints that it is nested inside a run that already re-runs every closed contract and exits 0, and the enclosing run names each entry that hit the guard, so an entry whose only effect was the nested call is visible in the report instead of reading as a pass that proved something. Rejected: failing the nested call, because every proofs run would then report the task holding the entry as broken although nothing in the tree changed; a depth limit, because it stays exponential in the number of closed contracts that carry the entry; refusing the entry in `check --contracts`, because that guard judges open tasks only and the closed contracts are the ones that recurse. Out of scope: `done <ID> --dry-run` called from a contract, which re-runs one named contract and terminates unless contracts call each other in a cycle; and a `check --proofs` run by `done` for a task still open, which no enclosing proofs run covers, so it must keep running for real.

Pre-flight reading: scripts/check-backlog-proofs.mjs, where a proofs run executes each closed task's entries and where the mark is set and read; scripts/cli.mjs at the TL-147 comment beside the `--proofs` flag, for why proofs stay out of a bare `check`; scripts/tests/proofs.test.mjs and scripts/tests/_repo.mjs, for how a fixture backlog with a closed task is built.

## Steps

1. Write scripts/tests/proofs-reentrance.test.mjs red first: a fixture backlog with a task whose contract is `branchling check --proofs`, closed with `done`; spawn `check --proofs` with a time limit, and on timeout stop, then kill, every process descended from it by parent pid (a process-group kill misses the nested runs, which are session leaders), so a red run leaves no process behind. Assert that the run finishes, exits 0 and names the nested entry. Positive control in the same fixture: a second closed task whose contract now fails is still reported as failing by the same run
2. In scripts/check-backlog-proofs.mjs, set the mark in the environment of every entry a proofs run executes; at the start of a proofs run, if the mark is set, print the nested notice and return without re-running anything; report the entries that hit the guard
3. Say in the `--proofs` paragraph of `check --help` what a nested run does, and add the same to the documentation that describes `check --proofs`

## Acceptance criteria

- [x] A closed contract holding `branchling check --proofs` no longer makes a proofs run recurse: the run finishes, passes, names the nested entry, and still reports a broken contract beside it [proof: nested-proofs]
- [x] The help of `check --proofs` says what a run started inside another proofs run does [proof: help-says-nested]
- [x] The full suite stays green [proof: suite]
