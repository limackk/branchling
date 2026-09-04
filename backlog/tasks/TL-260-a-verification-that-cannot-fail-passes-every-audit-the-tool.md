---
id: TL-260
title: "A verification that cannot fail passes every audit the tool has"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
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
  - id: unfalsifiable-contract-named
    bash: "node --test scripts/tests/check-contract-falsifiable.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

A `verification:` command that cannot fail is named by the tool, not by
whoever happens to read the task carefully. Today `check --proofs` runs
every contract and reports it green, and a contract green from birth is
indistinguishable in that output from one green because the work is done.

## Context

Measured on 2026-09-04, in wave 9. TL-143 arrived with this contract:

    verification:
      - id: template-still-english
        bash: "! grep -qE '[a-z accented set]' backlog/_template.md"

Run before any work started, it exited 0. It grepped a file that TL-143's
own third acceptance criterion forbids the task to touch, and that had been
English since 2026-09-01. No work the task described could have made it
fail, and closing on it would have proved only that the named file still
exists.

Nothing in the tool noticed. `check` was green, `check --proofs` would have
run the command and reported a pass, and `done` would have accepted it. It
was caught because the hand executing the task had been told, in its
charter, to run its own contract before touching anything - a rule that
lives outside the repository and applies to nobody who does not happen to
receive it.

**A second instance was found in the same wave, still open.** TL-144's
contract greps a hard-coded task filename:

    bash: "! grep -q 'licencja-i-kontrybucje' backlog/tasks/TL-112-….md"

It failed correctly before the work and passes now, so it is sound today.
It stops being sound the moment that file is renamed: `grep -q` over a
missing path exits 1, the negation makes it 0, and the contract goes green
having read nothing. TL-259 touches naming across the backlog, so this is
not hypothetical.

**Why this is the tool's job and not the author's.** CLAUDE.md already
states the rule - "a guard that passes on a zero sample is green with no
evidentiary force" - so the standard is settled and the gap is enforcement.
The tool has the two runs it needs: `check --proofs` executes contracts
already, and a task that is `pending` has, by definition, not had its work
done yet. A contract that passes while its task is open is either
unfalsifiable or the task is already finished, and both are worth saying
out loud.

**The cheap cases first.** A `grep` over a path that does not exist, and a
negated `grep` over a file the task's own criteria forbid it to touch, are
both decidable without running anything. They cover both instances found
here.

## Steps

1. Decide what the tool asserts. The candidates: `check --proofs` reports a
   contract that passes while its task is still open; `done` refuses to
   close on a contract that also passed against the tree before the work;
   a static rule that names a `grep` over a path that is absent. Record the
   answer with `branchling decide`.
2. Implement whichever was chosen, with a test that fails against today's
   code using TL-143's original contract as the fixture.
3. Sweep the open tasks for the same shape and report the count. Do not fix
   them in this task - a wrong contract is the owning task's business.

## Acceptance criteria

- [ ] A contract that passes against an unchanged tree while its task is
      open is named by the tool, proven by a test that fails against
      today's code. [proof: unfalsifiable-contract-named]
- [ ] Nothing that is sound today starts being reported. [proof: suite-green]
- [ ] The choice between reporting, refusing and a static rule is a
      `__decision__` event in `backlog/history/TL-260.jsonl`.
