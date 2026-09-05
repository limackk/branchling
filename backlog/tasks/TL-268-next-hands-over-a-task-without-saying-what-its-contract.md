---
id: TL-268
title: "next hands over a task without saying what its contract says right now"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-04
updated: 2026-09-05
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: probe-prints-contract-state
    bash: "node --test scripts/tests/next-probe.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

`branchling next` can hand a task over WITH the current result of its
`verification:` contract, entry by entry: which commands fail now, and what
they said. The agent then starts from "this is what is red" instead of from
a description of what green would be, and a contract that is already green
before any work is named at the moment it is handed out.

## Context

**The single cheapest thing a weak model can be given is its target.** A
task file says what should be true when the work is done. The contract says
how that will be checked. Neither says what is true NOW, and the difference
between those two is the work. A strong model reconstructs it by reading
the code; a weaker one guesses, and its guesses are the attempts that
`--max-attempts` counts.

Today every hand in this repository's runs is told, by a charter outside
the repository, to run its own contract first. The rule caught TL-143 on
2026-09-04: its contract was green before any work, grepping a file the
task was forbidden to touch, and the tool would have closed it on that. The
rule is general, cheap, and lives in a shell script in a temporary
directory (TL-264). It belongs to the tool.

**What the tool already has.** `done --dry-run` runs the contract and
prints the result without closing. `next` prints the task. This task is
the composition of the two at the moment the task is claimed.

**What the output is for.** Two readers. The agent reads which entries fail
and what stderr said, and has its first move. The dispatcher reads that
EVERY entry passed before any work was done, which is either a task already
finished or a contract with no evidentiary force — TL-260's subject — and
can say so before an attempt is spent.

**Why opt-in and not default.** A contract may cost 80 seconds (this
repository's whole-suite entries) and `next` is called by loops that want
the task in a second. `--probe` is the flag; `run` passes it when asked.
The agent receives the probe result on stdin after the task file, in the
same place a refused `done`'s output arrives from the second attempt on —
so the two feedback channels have one shape.

**Not TL-260.** That task makes the tool NAME an unfalsifiable contract in
an audit. This one puts the contract's live state in front of the hand
about to work on it, which is the earlier and cheaper place to see the same
thing.

## Steps

1. `next --probe` (and `take --probe`): after claiming, run the contract as
   `done --dry-run` does, and print the per-entry result after the task
   file, under a heading the agent cannot miss.
2. If every entry passed, say so in one line at the top of that block: the
   task may be finished, or the contract cannot fail.
3. `run --probe` passes it through, and the probe result is part of what
   the agent receives on stdin.
4. `--json`: the probe result is a field beside the task.

## Acceptance criteria

- [x] `next --probe` prints each verification entry with its exit code and
      output, proven by a test whose fixture has one failing and one passing
      entry. [proof: probe-prints-contract-state]
- [x] A contract that passes in full before any work is named in one line.
      [proof: probe-prints-contract-state]
- [x] Without `--probe`, `next` is unchanged and runs nothing.
      [proof: suite-green]
