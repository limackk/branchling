---
id: TL-217
title: "Four commands accept flags their --help never declares"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: high                   # how much you trust the estimate
created: 2026-09-03
updated: 2026-09-03
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: exemption-list-empty
    bash: "grep -q 'const UNDOCUMENTED = {};' scripts/tests/help-covers-flags.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

TL-194 added `scripts/tests/help-covers-flags.test.mjs`, a guard that compares
the flags a command ACCEPTS (read from its own `available: …` refusal) with the
flags its `--help` DECLARES (read through `describeFlags()`). TL-194 documented
`query` and left the same defect standing in four other commands, recorded there
as the named `UNDOCUMENTED` exemption map:

    build:    --root
    board:    --paths --registry
    history:  --quiet
    init:     --no-gitignore --no-example --no-nudge --skills

Once this is done, those eight flags are described in their commands' `usage:`
entries in `scripts/cli.mjs`, and `UNDOCUMENTED` is empty — which is what the
verification asserts, so the exemption cannot be quietly widened instead.

## Context

Measured on 2026-09-03 while closing TL-194. The eight above were the complete
set at that moment; `--dir`, `--help` and `-h` are deliberately outside the
count, because the main help documents them once as working on every command.

TL-194 documented `query` alone on purpose: `--text` and `--limit` are what make
`query` answerable inside a context budget, so they were the urgent half, and
writing eight further descriptions in this repository's register is its own
piece of work rather than an aside on somebody else's task.

Note that the guard only reaches commands that print `available: …` when they
refuse an unknown flag — about a quarter of the table. Every command refuses,
but most say only "unknown flag". Widening the guard to the rest would mean
giving them all the same refusal shape, which is a THIRD task and should not be
folded in here; if it is opened, it makes the two lists comparable everywhere
and is likely to surface more of these.

## Pre-flight reading

1. `scripts/tests/help-covers-flags.test.mjs` — the guard, the exemption map,
   and the reasoning about which two lists are being compared.
2. `scripts/cli.mjs` — the `build`, `board`, `history` and `init` entries of the
   command table, where the `usage:` text lives, and `describeFlags()` around
   line 1275, which defines what counts as a DECLARATION: a synopsis line or a
   line whose first token is the flag. A flag named mid-sentence does not count.
3. The `query` entry of the same table — the shape TL-194 settled on, so the
   eight new descriptions match their neighbours instead of inventing a style.

## Steps

1. Describe the eight flags in their commands' `usage:` entries: on the synopsis
   line where they belong there, as a flag line with prose where they need an
   explanation.
2. Empty the `UNDOCUMENTED` map in the guard, leaving `const UNDOCUMENTED = {};`
   and the comment that says what it is for — a later exemption needs the same
   argument this one had.
3. Run `node --test scripts/tests/*.test.mjs`. The guard's own
   "the exemption list does not outlive the defect it records" case is what
   catches an entry left behind.

## Acceptance criteria

- [ ] `build --help`, `board --help`, `history --help` and `init --help` each
      declare every flag their refusal lists, `--dir`/`--help`/`-h` aside.
      [proof: exemption-list-empty]
- [ ] The suite stays green. [proof: suite-green]
