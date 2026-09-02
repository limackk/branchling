---
id: TL-136
title: "renumber does not distinguish a reference from an example in a comment"
type: task
labels: []
board: main
epic: "Data integrity"
priority: P2                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
estimate: 2h                       # 30m | 2h | 1d | 1w | 1mo
created: 2026-09-01
updated: 2026-09-02
blocked_by: []
blocks: []
related_docs: []
verification:                      # HOW to check the task is really done
  - id: przyklad-nietkniety
    bash: "node --test scripts/tests/renumber.test.mjs"
---

## Goal

`worktrail renumber` must **not rewrite an ID that is an example, not a
reference** — or, if there is no way to tell them apart mechanically, it must
print them before writing, so a human has a chance to react.

## Context

Measured 2026-09-01, on a real renumbering run of this repository
([[TL-135]]). Comments in the code illustrated the migration's behavior with
an example:

```
 * function: `TL-1303` becomes `TL-1` only because of where it sat in one
 *           ordering of one tree at one moment.
```

`TL-1303` was in the map as a real task, so it was rewritten to `TL-1`, and
the sentence collapsed into the nonsensical "`TL-1` becomes `TL-1`". The same
in three files: `scripts/renumber.mjs` (3 places), `scripts/history.mjs`,
`scripts/task-id.mjs` (3 places).

**Why this is not a typo.** The rewriter behaved exactly according to spec —
these IDs WERE real IDs and the migration was meant to move them. The defect
is that in documentation text an ID plays two different roles, and the tool
sees only one. The damage is also SILENT: no guard fails, the tests pass, and
the sentence explaining the hardest decision in the module stops explaining
anything. This is the worst kind of documentation damage — the kind that
looks correct.

**How it was fixed by hand** (and why that does not close the topic): the
examples were repointed to the foreign prefix `PROJ-`, which no map of this
repository will ever cover. It works, but it is an agreement nobody knows
about — the next comment's author will write `TL-1303`, because that is what
an ID in this project looks like.

## Steps

1. Decide whether this can be told apart mechanically at all. Candidates:
   - an ID in a comment/prose standing next to the word "becomes", "→",
     "e.g." — fragile;
   - an explicit marker on the line, like `product-name: allow` in
     [[TL-117]] — consistent with what the repository already does for guard
     exceptions;
   - a sample-prefix convention (`PROJ-`), DOCUMENTED and guarded, instead of
     a verbal agreement.
2. If telling them apart is impossible: `renumber` must print, before writing,
   the IDs hit in SOURCE files (`scripts/`, `bin/`) separately from those in
   the backlog and in `docs/`, since that is where examples live.
3. Whatever comes out of this — the header of `scripts/renumber.mjs` must say
   so. Today it promises that an unknown ID stays untouched, and stays silent
   about a KNOWN ID in the role of an example being rewritten.

## Acceptance criteria

- [x] An ID used as an example survives a `renumber` run untouched, or is printed before writing. [proof: przyklad-nietkniety]
- [x] The test has a positive control: a fixture with an example that, without the fix, gets damaged. [proof: przyklad-nietkniety]
- [x] The convention (marker or sample prefix) is recorded where the comment's author will see it, not only in this task. [proof: przyklad-nietkniety]
