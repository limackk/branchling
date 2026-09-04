---
id: TL-221
title: "done prints every passing entry's output in full, and a session pays for it"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-03
updated: 2026-09-04
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: quiet-close
    bash: "node --test scripts/tests/done-output.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

Closing a task must not cost the closer a context window. `branchling done`
streams the whole stdout of every verification entry, including the entries
that PASSED, and there is no flag to ask for less.

## Context

Measured on 2026-09-03 while closing TL-193 and TL-200 in this repository.
Both contracts name `node --test scripts/tests/*.test.mjs`, so `done` printed
1698 lines of `✔ …` before the two lines a reader actually needs:

    ✓ passed (109440 ms)
    ✓ TL-193 closed — status in_progress → done

`done --help` offers `--dry-run`, `--json`, `--actor`, `--status`,
`--confirm-manual` and `--reason`. None of them narrows the output, and
`--json` widens it — it publishes the result of every entry.

This is the project's own context-economy rule turned on the tool itself
(`scripts/context-budget.mjs`): a command should cost what its answer is
worth. The answer here is a verdict per entry; the transcript of a passing
command is evidence nobody reads, and the FAILING entry's output is already
handled separately (`done` writes it to stderr and the run loop feeds it back
to the agent).

Not a defect in the run loop: `run` sends the agent's and the gate's output to
a log file outside the repository, so an unattended loop already pays nothing.
It is the interactive and agent-session path that pays, and that is the path
this project's own conventions send every closing agent down.

## Pre-flight reading

1. `scripts/done-task.mjs` — where each entry's output is written, and the
   `--json` shape that must keep carrying it.
2. `scripts/cli.mjs` — the `done` entry in the command table, its usage block
   and its flag list; an unknown flag has to keep failing.
3. `scripts/context-budget.mjs` — `CONTEXT_RULE`, which is the standard this
   task is measured against.
4. `scripts/ui.mjs` — how other commands decide what to print on a TTY.

## Steps

1. Decide what the default should be. A passing entry's output being silent by
   default, with a flag to ask for it, is one answer; a flag to suppress it is
   the other. State which and why in Decisions — the default is what every
   agent following this repository's conventions will get.
2. A FAILING entry's output stays whole, whatever is decided. The refusal is
   the one place the transcript is the answer.
3. `--json` is unchanged: a caller that parses the envelope asked for
   everything.
4. Add the test beside the existing `done` tests, asserting on the SIZE and
   shape of what a passing close prints, not only on its last line.

## Acceptance criteria

- [x] Closing a task whose contract passes does not print the passing entries'
      stdout by default, or prints it only when asked — whichever Decisions
      settles on. [proof: quiet-close]
- [x] A closing that FAILS still prints the failing entry's output in full.
      [proof: quiet-close]
- [x] `done --help` describes whatever flag was added, and an unknown flag
      still fails. [proof: suite-green]

## Decisions

**Silent by default; `--verbose` to stream.** The default is what every agent
following this repository's conventions gets, and an agent has no use for a
passing transcript — it reads the verdict. A person watching a slow contract is
the exception, and an exception takes the flag. A `--quiet` flag would have
left the expensive path as the one that costs nothing to type.

**The verdict line says what was withheld** — `passed (109440 ms, 1698 lines not
shown)` — so a silent close is distinguishable from a silent command, and a
contract whose green output is growing stays visible without being printed.

**The failing entry's output is written whole, to stderr, BEFORE the refusal.**
This was already the `--json` behaviour; it is now every mode's. The order is
deliberate: the last screen a reader sees is the verdict, and the transcript
above it is what to scroll into.

**`--json` is untouched.** It already captured; `entries` carries the same rows
as before and no prose.

**`maxBuffer` raised to 64 MB** in `runBash`, matching `run-loop.mjs`: capture
is now the default path, and Node's 1 MB default would have turned a long green
suite into a spurious failure.
