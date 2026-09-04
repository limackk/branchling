---
id: TL-238
title: "The suite is green only when it is not run in a terminal"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P0
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
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
  - id: colour-cannot-decide-it
    bash: "node --test scripts/tests/suite-is-terminal-independent.test.mjs"
  - id: suite-green-in-colour
    bash: "FORCE_COLOR=1 node --test scripts/tests/*.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
  - id: guards-green
    bash: "node scripts/cli.mjs check"
---

## Goal

The suite gives the same verdict whether or not it is run in a terminal. Today
it passes when stdout is a pipe and fails twelve tests when it is a TTY, so the
answer depends on who is asking.

## Context

Reported by a person on 2026-09-04, running the closing contract of TL-122 in
their own terminal. Twelve tests failed across seven files. Every failure is one
shape: an assertion on rendered text meeting ANSI escapes.

```
AssertionError: The input did not match /branchling query: unknown flag: --statu/
  Input: '\x1B[31m✗\x1B[0m \x1B[1mbranchling query\x1B[0m: unknown flag: --statu'
```

Reproduced exactly, with no terminal, by setting the variable a terminal implies:

```
$ node --test scripts/tests/ui.test.mjs              -> pass 13, fail 0
$ FORCE_COLOR=1 node --test scripts/tests/ui.test.mjs -> fail
```

`colourAllowed()` in `scripts/ui.mjs` is correct and is not the defect: NO_COLOR
wins, then FORCE_COLOR, then `isTTY`. The defect is that the tests never state
which rendering they assert against, so they inherit one.

WHY IT WENT UNSEEN. Every agent in this project runs the suite through a tool
whose stdout is a pipe — no TTY, no FORCE_COLOR, no colour, green. A person runs
it in a terminal and gets red. The suite has therefore been reporting the state
of the observer, and so has every "green" this project has recorded, including
the ones written into closing records by `done`.

`done` inherits it too: it spawns the contract, so the same task closes for an
unattended run and refuses for a person at a keyboard.

Files: `cross-branch-state`, `id-prefix`, `json-envelope`, `next-id-empty-backlog`,
`next-id-root-backlog`, `plan-command`, `ui`.

## Steps

1. A test asserting on human-facing text must PIN the rendering, not inherit it.
   Add one declaration per affected file rather than stripping escapes at the
   assertion, which would leave the next test free to inherit again.
2. Spawned children inherit `process.env`, so one declaration covers both the
   in-process renderers and the subprocesses a test starts.
3. `scripts/tests/suite-is-terminal-independent.test.mjs` — runs the previously
   failing files again under `FORCE_COLOR=1` and requires exit 0. The positive
   control is a fixture test that DOES depend on colour, which the guard must
   catch; without it the guard passes for a suite that no longer runs anything.

## Decisions

**Not `NO_COLOR` on the command line.** A rule that the suite must be invoked a
particular way is checked by the person who already forgot it, and CI, `done`
and every agent invoke it differently. The declaration belongs in the tests.

**`ui.test.mjs` keeps testing colour.** It asserts the renderer, so it must set
its own expectation explicitly per case rather than inherit the terminal's.
