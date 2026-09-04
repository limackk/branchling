---
id: TL-259
title: "The epic worktrail — the tool still carries the tool's former name"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P3                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 30m                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-04
updated: 2026-09-04
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: no-old-name
    bash: "! grep -q 'epic: .worktrail' backlog/tasks/*.md"
  - id: check-green
    bash: "node scripts/cli.mjs check"
---

## Goal

No task's `epic:` field names the tool `worktrail`. The ten tasks that carry
`epic: "worktrail — the tool"` today name it whatever the epic is renamed to,
all ten in one commit, and `branchling stats` reports one epic rather than two.

## Context

The tool was called `tasklog` until 2026-09-01 and `worktrail` until
2026-09-03, when TL-169 found `worktrail` was an incumbent's name on this
shelf and TL-20 renamed it to `branchling`. That rename swept `scripts/`,
`bin/` and the docs — `scripts/product.mjs` is now the single source and
`branchling check --product-name` keeps it that way — but it did not reach
task frontmatter, which no guard reads for the product name.

    grep -l 'epic: "worktrail' backlog/tasks/*.md | wc -l   # 10

Found on 2026-09-04 while closing TL-128, whose own frontmatter carries it.

**Why it was not fixed there.** An epic is free text and is what groups tasks
in `stats` and on the boards. Correcting the string on ONE task does not fix a
stale label, it SPLITS the epic: nine tasks under the old name and one under
the new, and neither list is the epic any more. The change is only correct
taken across all ten at once, which is a different unit of work from the task
that noticed it.

**Not a `migrate-prefix` or a `renumber`.** Neither command touches `epic:` —
those rewrite ids. There is no command for this today, so the question the
work has to settle is whether ten hand edits are the answer or whether an epic
rename is a gap in the CLI worth closing.

## Steps

1. Decide the new epic name. `branchling — the tool` is the obvious reading,
   but the epic groups the tool's own development against other work in this
   backlog, so check what the other epics are called before assuming it.
2. Rewrite the field in all ten task files in ONE commit.
3. `branchling build`, then confirm `stats` shows one epic and not two.

## Acceptance criteria

- [ ] No task file has `epic:` naming the tool by its former name.
      [proof: no-old-name]
- [ ] The full check stays green. [proof: check-green]

## Decisions

Nothing decided. Step 1 is deliberately open: the replacement name is a
vocabulary decision, and picking it before reading the other epics would be a
guess.
