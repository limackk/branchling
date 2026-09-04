---
id: TL-262
title: "new writes a verification placeholder that check immediately warns about"
type: bug
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
  - id: new-task-is-clean
    bash: "node --test scripts/tests/new-task-passes-check.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

A task the tool just created passes the tool's own guards. Today `new`
writes a placeholder that `check` warns about on the next run, so the first
thing an author does with a fresh task is delete something the tool put
there.

## Context

Measured on 2026-09-04 by an agent filing TL-259, and again while filing
TL-257 and TL-258. `branchling new` writes:

    verification:                      # HOW to check the task is really done
      - id: the-name                   # optional; a criterion below points at this id
        bash: "command to run"

and `check` answers:

    ! TL-259-….md
        `verification` entry `the-name` proves no criterion — either link it
        or drop the `id:`

The `id:` is documented as optional in the very comment beside it, and the
placeholder supplies one anyway, so the guard fires on a state the tool
authored. The remedy is to delete two of the three lines that were just
written.

**Why the obvious fix is wrong.** Dropping `id:` from the placeholder would
silence the warning and lose the example - the shape a real entry takes is
worth showing, and `criteria_links: warn` exists because the link between a
criterion and its proof is something the project wants. The placeholder
needs to be recognisable AS a placeholder, to `check` as well as to a
reader.

**It is not TL-165 and not TL-237.** TL-165 is about the template's
explanatory banner being copied into every task. TL-237 is about `new`
being unable to SET fields it accepts no flags for. This one is about the
default content tripping a guard - the three are the same file and three
different complaints about it.

## Steps

1. Decide how a placeholder announces itself: a reserved id the guard
   knows, a commented-out entry, or an empty `verification: []` with the
   example in the comment. Record it with `branchling decide`.
2. Whatever is chosen, a task straight out of `new` must leave `check`
   silent about it.
3. Check the same question for the other placeholder the template carries -
   `related_docs`, `blocked_by` and the rest are empty lists and are fine;
   `verification` is the only one that fabricates content.

## Acceptance criteria

- [ ] `branchling new` followed immediately by `branchling check` produces
      no warning about the created task, proven by a test that fails
      against today's code. [proof: new-task-is-clean]
- [ ] A real `verification` entry that proves no criterion is still
      reported. [proof: suite-green]
