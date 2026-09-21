---
id: TL-265
title: "check --proofs runs for an hour and says nothing while it does"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-04
updated: 2026-09-04
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: audit-reports-progress
    bash: "node --test scripts/tests/proofs-progress.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

`check --proofs` says what it is doing while it does it, and its default
scope is one somebody would actually wait for. Today it ran for 68 minutes
and printed nothing, and the only way to tell it apart from a hung process
was `ps`.

## Context

Measured on 2026-09-04 in this repository:

    $ branchling check --proofs
    (68 minutes, zero bytes on stdout and stderr, then killed)

The cost is inherent and the silence is not. This backlog holds 203 closed
tasks carrying 325 `bash` entries between them, and 19 of those entries are
`node --test scripts/tests/*.test.mjs`, which takes 80 seconds. Those 19
alone are 25 minutes; the rest spawn `init`, `doctor` and `serve` in
temporary trees.

`scripts/check-backlog-proofs.mjs` accumulates everything and prints once:

    const started = Date.now();
    for (const c of selected) { runContract(c.entries, repoRoot, …) }
    if (!broken.length) console.log(`${OKM} proofs: …`)

So there is no first line until the last command has finished. A run that
is working and a run that is wedged are byte-identical from outside, and
the operator has no basis for deciding whether to wait.

**The scope is the other half.** `--since <sha>` exists precisely to narrow
this — "keep the closings the range could plausibly have" — and the
unnarrowed form is the default. A command whose default takes over an hour
on its own repository is one nobody runs, which is the same failure TL-236
describes for `check` as a whole: a guard that is too expensive to run is a
guard that is not run.

**Stopping it takes three kills, not one.** Measured while cleaning up:

<!-- former-name: allow — a transcript of a real run, not an instruction -->

    $ pkill -f 'cli.mjs check --proofs'      # wrapper dies
    $ ps | grep tasklog
      9175  check-backlog-proofs.mjs …       # still running, 1h11m
    $ kill 9175                              # audit dies
    $ ps | grep tasklog
      … ~200 processes: cli.mjs init, new, done, query in temp trees
      90995 node --test --test-concurrency=0 …

Each layer outlives the one above it. The audit had a whole `node --test`
run in flight - one of the 19 whole-suite contracts - and killing the audit
left the runner spawning subprocesses into temporary directories. Three
signals were needed, and after the first two the tree was still growing.
An operator who reads the silence as a hang and kills the command has not
stopped it, and has no way to know that.

**Not a request to make it faster.** Re-running a closed task's contract
means running it; that is the whole point. What is missing is a line per
task as it goes, a count of what remains, and a defensible default scope.

## Steps

1. Print progress as the audit walks: the task, the entry, and how many are
   left. A long-running command with no output is indistinguishable from a
   hung one, and this one runs for an hour.
2. Decide the default scope. The candidates: keep it unnarrowed and require
   the operator to accept the cost; default to `--since` the last tag or a
   fixed depth of history; refuse without a scope above some number of
   closings. Record it with `branchling decide`.
3. Handle a signal: stop the contract in flight and its children before
   exiting, so one interrupt ends the audit.
4. Report the cost up front — the number of closings selected and the number
   of commands they carry — before the first one runs, so the operator can
   stop at the start rather than at minute 68.

## Acceptance criteria

- [ ] The audit writes a line before its first contract and one per task as
      it goes, proven by a test that fails against today's code.
      [proof: audit-reports-progress]
- [ ] The final report is unchanged in content. [proof: suite-green]
