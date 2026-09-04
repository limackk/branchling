---
id: TL-258
title: "history --attribute claims the whole log when no file is named"
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
  - id: unscoped-attribute-refused
    bash: "node --test scripts/tests/history-attribute-scope.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

Claiming authorship of somebody else's recorded change requires saying so.
Today `branchling history --attribute` with no `--file` claims every
unattributed entry in the whole log, under one reason, with no confirmation
and no way back.

## Context

Measured on 2026-09-04 in the main checkout. The intent was to claim ONE
entry, the `type` edit on a task filed a minute earlier:

    $ branchling history --attribute --actor agent:claude \
        --reason "filed while composing wave 9's queue"
      TL-27 - blocks
      TL-28 - blocks
      TL-31 - __created__
      ... and 762 more
      the original entries still say `unknown` - this log is append-only, so a
      claim stands BESIDE the change rather than rewriting it.

765 entries across 181 history files were claimed. The reason attached to
all of them is true of exactly one. `git status` afterwards showed 181
modified files; the work was recoverable only because nothing had been
committed yet.

**Three things make this the wrong default.**

The scope is inverted. `--file <task.md>` is documented as "just this task,
not the whole directory", which makes the whole directory the default for a
command whose subject is one author's claim over one change. Every other
writing command in the tool names its target: `take <ID>`, `done <ID>`,
`decide <ID>`. This one has no positional argument at all.

The reason cannot be true. `--reason` is documented as "why, for the whole
run - that is the granularity this route has". At a scope of one task that
is a fair trade. At a scope of 765 entries spanning months it guarantees a
false sentence in the record, and a false reason is worse than `unknown`,
which at least does not claim to explain anything.

It cannot be undone. The log is append-only by design, and every other
writing command is correctable by a later write - a status set wrongly is
set again. A claim of authorship is not: once committed, the record says
this actor made 765 changes they did not make, and the correction can only
sit beside it. `--attribute` is the tool's one irreversible write, and it
asks less than any other.

**What the output does not do.** The list appears AFTER the write, is
truncated at three entries plus a count, and its closing sentence explains
the append-only design rather than saying how many entries were just
claimed. Read quickly it looks like a report of what was found.

**It is not TL-185.** TL-185, closed, was the opposite failure - a whole
directory run that absorbed ten changes and recorded none. Here the write
lands, in full, and the problem is that it lands on everything.

## Steps

1. Decide the scope rule. The candidates: require `--file` (or a positional
   id) whenever `--attribute` is given; or keep the unscoped form behind an
   explicit `--all` that has to be typed. Record the answer with
   `branchling decide`.
2. Print what will be claimed BEFORE claiming it, with the count first, and
   have the unscoped form refuse without confirmation.
3. Whatever is decided, the count of entries claimed belongs in the closing
   line, not left to be inferred from a truncated list.

## Acceptance criteria

- [ ] `history --attribute` with no file and no explicit opt-in writes
      nothing and exits non-zero, proven by a test that fails against
      today's code. [proof: unscoped-attribute-refused]
- [ ] The scoped form still works unchanged. [proof: suite-green]
- [ ] The decision between requiring a scope and requiring `--all` is a
      `__decision__` event in `backlog/history/TL-258.jsonl`, not prose here.
