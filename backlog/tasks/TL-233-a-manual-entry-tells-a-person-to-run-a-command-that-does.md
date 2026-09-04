---
id: TL-233
title: "A manual entry tells a person to run a command that does not exist"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:dev
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-04
updated: 2026-09-04
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: contracts-name-the-tool
    bash: "node --test scripts/tests/contract-product-name.test.mjs"
  - id: guards-green
    bash: "node scripts/cli.mjs check"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

A `manual:` entry names the tool a person must actually run. Fourteen of them
name a binary that does not exist, so the one part of a contract a machine
cannot execute is the one part a person cannot follow either.

## Context

Met while vouching for TL-122, whose contract reads:

> With a page open from `worktrail serve` in the main checkout: running
> `worktrail take <ID>` in a SECOND worktree makes the badge appear

`package.json` says the product is `branchling`. There is no `worktrail` on any
path. The person asked to vouch is asked to run a command that will answer
`command not found`, and the only way through is to guess the translation.

Counted in this tree: the old name appears in 134 of 231 task files, 18 of them
open, and inside **14 `manual:` entries**.

Prose is not the concern. CLAUDE.md is explicit that `check --product-name`
covers `scripts/` and `bin/` and deliberately not the backlog, and a task's
narrative describing what the tool was called at the time is history, not debt.
A `manual:` entry is different in kind: it is an INSTRUCTION, executed by a
person, today, and its correctness is the same question as a `bash:` line's.

## Steps

1. `scripts/tests/contract-product-name.test.mjs` — every `manual:` and `bash:`
   entry of every OPEN task, checked for a command name that is not the product
   name from `scripts/product.mjs`. The positive control is a fixture entry
   carrying a foreign name, which must fail the guard.
2. Rewrite the fourteen entries. Only the `verification:` block — the surrounding
   prose stays as it was written.
3. Consider whether this belongs in `check` rather than only in the suite. A
   contract that cannot be followed is a defect of the same family as a broken
   criteria link, which `check` already covers.

## Decisions

**Open tasks only.** A closed task's contract was executed against the tool as
it was named then; rewriting it would falsify a record of what was actually
run, which is the same reasoning `renumber: allow` rests on.

**Not a rename migration.** `migrate-prefix` exists for ids; there is no such
command for a product name, and inventing one for fourteen lines would be a
larger, separate decision. The narrow fix is the contracts.

**The count was five invocations in four tasks, not fourteen entries.** Eleven
`manual:` entries in the whole tree name the old binary; seven of them belong to
closed tasks and stay. What was rewritten: TL-102, TL-122 (two invocations in
one entry), TL-77 and TL-89. The `bash:` entries of open tasks were clean — the
old name survives in `bash:` only in the archive.

**The signal is `<name> <subcommand>` in command position, not the name alone.**
A `manual:` entry is prose with commands embedded in it, so only the first token
of a backticked span or of a shell segment is read as a command, and only when
the token after it is one of this tool's own verbs. A bare mention with no verb
after it is therefore not caught. That is accepted: telling such a mention from
an ordinary noun needs a list of every word the product has ever been called,
which is the literal this guard exists not to hold.

**`git init` is why there is a short list of foreign programs.** The rejected
alternative was to ask whether the word resolves on `PATH` — that makes the
verdict depend on what is installed, so a machine without `git` would fail the
suite over a task file nobody touched.

**Not wired into `check` here.** It belongs there — step 3 is right — but
`check-backlog.mjs` was being edited in another worktree while this ran, and a
guard's registration is a change to a shared table. It is TL-234.
