---
id: TL-426
title: "A subcommand refusal keeps the one anatomy"
type: task
labels: []
board: main
epic: "CLI onboarding"
priority: P2                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-21
updated: 2026-09-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: [scripts/ui.mjs, scripts/agent-profiles.mjs, scripts/install-skills.mjs, scripts/tests/refusal-shape.test.mjs]
verification:                      # HOW to check the task is really done
  # The guard is the proof, and it must FAIL against today's tree: both cases
  # below are measured on this repository, not on a fixture.
  - id: subcommand-refusals
    bash: "node --test scripts/tests/refusal-shape.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

A command refused one level down answers in the same anatomy as one refused at
the top, and `scripts/tests/refusal-shape.test.mjs` reaches both.

## Context

TL-220 gave every command in `COMMANDS` one refusal anatomy, and
`refusal-shape.test.mjs` holds it — but it asks each command only at the top
level, so a command with subcommands has an unguarded second surface. Two
deviations were measured while TL-342 was deriving the terminal surface for its
documentation guard:

- `branchling profile create dev --zzz` prints TWO `available:` lines: the
  anatomy's indented one naming the subcommands, and an UNINDENTED one naming
  the union of every flag any `profile` subcommand takes. It is the same answer
  whichever subcommand was typed, so it tells the reader that `profile list`
  accepts `--adapter`, which it does not. Only the indented line comes from
  `refusal()`.
- `branchling skills install --zzz` prints no `available:` line at all and ends
  with `→ branchling skills --help` rather than the subcommand's own. A
  subcommand that accepts no flags has nothing to list, which is legitimate —
  but then the anatomy has to say what an empty accepted set looks like, rather
  than leaving each command to decide.

Neither is a crash, and both were invisible because the guard's reach stops at
the table. `scripts/tests/docs-terminal-surface.test.mjs` reads an accepted set
out of these refusals, so its answer about a subcommand is only as good as the
refusal it asks.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/ui.mjs` — `refusal()` and the header comment stating the anatomy
   and why the three event words are distinguished.
2. `scripts/agent-profiles.mjs` — where the second, unindented `available:`
   line is built, and whether the accepted set is known per subcommand.
3. `scripts/install-skills.mjs` — the refusal with no alternatives to name.
4. `scripts/tests/refusal-shape.test.mjs` — `shapeProblem()`, and how to extend
   its reach to subcommands without asserting a hand-written list of them.

## Steps

1. Decide what the anatomy says for an empty accepted set, and write it down in
   `ui.mjs` beside `refusal()`.
2. Make each subcommand answer for ITSELF: its own accepted flags, its own
   `--help` line.
3. Extend `refusal-shape.test.mjs` to every subcommand a command names in its
   own `available:` list, so the reach follows the code rather than a literal.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [ ] `profile create --zzz` and `profile list --zzz` name different accepted
      sets, and neither prints an unindented `available:` line.
      [proof: subcommand-refusals]
- [ ] `skills install --zzz` answers in the anatomy, including what an empty
      accepted set looks like, and points at its own `--help`.
      [proof: subcommand-refusals]
- [ ] The guard reaches every subcommand named by a command's own refusal, and
      fails if one stops answering. [proof: subcommand-refusals]
- [ ] The suite is green. [proof: suite-green]
