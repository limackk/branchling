---
id: TL-135
title: "Renumbering the backlog from 1: map, migration and redirects"
type: task
labels: []
board: main
epic: "Data integrity"
priority: P3                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
estimate: 1w                       # 30m | 2h | 1d | 1w | 1mo
created: 2026-09-01
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs: []
verification:                      # HOW to check the task is actually done
  - id: decyzja-zapisana
    manual: "This file records the resolved VARIANT (A/B/C) with justification, or the task is cancelled with a reason."
  - id: tree-green
    bash: "node scripts/cli.mjs check && node scripts/cli.mjs doctor"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

The backlog has continuous numbering `TL-1`..`TL-135`, and no reference
points, after the migration, to a DIFFERENT task than it did before it.
**Done 2026-09-01.**

## Decision

**Variant A — full renumbering — was chosen.** The analysis recommended
variant C (the ordinal number as a computed view, `id:` unchanged), because
the cost of A lands in places the migration cannot reach. The repository
owner's decision fell on A and was upheld after that cost was presented.

What this cost, plainly — these three things remain true and cannot be
undone by a migration:

1. **62 commits carry the old number in their title**, and 108 unique IDs
   appear in `git log` titles and bodies. History is immutable.
2. **192 `BL-*` markers across 50 of 101 `scripts/` files** stopped lining
   up with the tree by number. Left deliberately: this is a trace of origin
   from before the extraction, not a reference the tool has the right to
   repoint.
3. **Mentions inside `history/*.jsonl` records** (4 of them) use the old
   numbers. The log is append-only — a `reason` written by a person is
   their sentence, not a field a migration may correct.

All three are covered by the **redirect table in `LINEAGE.md`**, keyed by
NUMBER, not prefix — so it serves both `TL-1404` and `BL-1404`.

## How it was done

`worktrail renumber` (`scripts/renumber.mjs`) — a separate command, not a
flag on `migrate-prefix`, because the two differ in kind:

- **The record carries the WHOLE map.** Prefix migration is a function of
  the old ID and its record can be a rule; renumbering is not a function.
  Hence `kind: "renumber"` in `history/.migrations.jsonl`, and
  `applyPrefixMigrations` was renamed to `applyIdMigrations` and branches by
  kind.
- **Prose is REWRITTEN, not counted.** After a prefix change, a reference
  left in prose leads nowhere, and the reader knows something has shifted.
  After renumbering, the old number still exists and means a different
  task — the reader is not stopped, only misled.
- **ID spaces overlap**, so the rename goes through a temporary name in two
  passes.

Run: 135 tasks, 135 history logs, **1375 references rewritten across 368
files**, 20 IDs unknown to the map left untouched and printed out.

## What came up along the way and is a separate topic

The command **does not distinguish a reference from an EXAMPLE**.
Illustrative comments ("`TL-1303` becomes `TL-1`") collapsed into "`TL-1`
becomes `TL-1`" in `scripts/renumber.mjs`, `scripts/history.mjs`, and
`scripts/task-id.mjs`. Fixed by hand by repointing the examples to a
foreign prefix, `PROJ-`, which no map will ever cover. Separate task for
this: [[TL-136]].

## Acceptance criteria

- [x] The variant (A / B / C) is decided and justified in this file. [proof: decyzja-zapisana]
- [x] If A: the `old → new` map is a committed file, not a side effect of a run. [proof: decyzja-zapisana]
- [x] If A: `LINEAGE.md` carries a redirect table for IDs mentioned in `git log`. [proof: decyzja-zapisana]
- [x] If A: no reference in prose points, after the migration, to a DIFFERENT task than before it — omissions are printed out, not passed over in silence. [proof: tree-green]
- [x] `check` and `doctor` are green after the change. [proof: tree-green]
- [x] The full suite is green after the change. [proof: suite-green]
