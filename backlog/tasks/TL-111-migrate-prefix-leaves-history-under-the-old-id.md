---
id: TL-111
title: "migrate-prefix leaves history under the old ID"
type: task
labels: []
board: main
epic: ""
priority: P1
status: done
owner: agent:claude
estimate: 2h
created: 2026-09-01
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs: []
verification:                      # HOW to verify that the task is truly done
  - bash: "node --test scripts/tests/migrate-prefix-history.test.mjs"
  - bash: "node --test scripts/tests/history.test.mjs"
---

## Goal

After `worktrail migrate-prefix`, no task has a history record saying it was
deleted. Today EVERY one does: the `BL-` → `TL-` migration in this repository
produced 42 `history/BL-*.jsonl` files, each with one `__deleted__` record,
plus a full set of `__created__` records under the new IDs. The history said
the whole backlog had been deleted and recreated on the same day.

When this task is done, the prefix migration is a RENAME as far as history is
concerned, not a delete+create pair.

## Context

Found 2026-09-01 while cleaning up the working tree: 42 untracked
`backlog/history/BL-*.jsonl` files, all with one record, all
`{"field":"__deleted__","actor":"unknown","source":"boot"}`, all with
timestamp `2026-09-01T07:13:34.277Z` — one reconcile run. The files were
deleted (they carried no history beyond the tombstone; each task's real
history is in its `TL-*` twin, which is in the repo). This task removes the
CAUSE, so the next migration does not recreate them.

**Cause.** `scripts/migrate-prefix.mjs` carefully renames four things (see
the comment at the top of the file): the task file, `id:` in the
frontmatter, `blocked_by`/`blocks`, the `history/<ID>.jsonl` file along with
the `task` field inside it, and `task_id_prefix` in config.yaml. It does not
touch the **fifth**: `history/.snapshot.json` — `grep snapshot
scripts/migrate-prefix.mjs` has zero matches. The snapshot is "the last seen
frontmatter of every task", keyed by task ID. After migration the snapshot
holds 74 `BL-*` keys, while the tree has 74 `TL-*` tasks. The next reconcile
(`source: "boot"`) compares one against the other and honestly reports 74
disappearances and 74 new tasks — it does exactly what it was written to do.
The defect is in the migration, which left it a stale reference point.

**Why this is not cosmetic.** Field history is versioned and has the
`merge=union` rule (`scripts/git-rules.mjs`); tombstones go into the repo and
stay there. TL-28–TL-31 build an attribution chain and estimate calibration
from real data on top of this history — data in which every task "was
created" on migration day would corrupt any age and pace computed from it.

**A second defect, found along the way.** One of the tombstones had ID
`BL-1417-domknij-walidacje-flag-w-5` — meaning the snapshot key was computed
from the FILE NAME (number + slug truncated at `-5`), not from the `id:`
field in the frontmatter. Task `TL-25` exists and has its own, correct
history. Check where the snapshot key is computed from the file name, and
whether that is a separate bug class requiring its own task.

**A decision to make along the way.** The snapshot is gitignored
(`IGNORE_RULES` in `git-rules.mjs`), so rewriting it in the clone that
performs the migration does not help a CLONE SITTING ALONGSIDE IT: it will
pull the `TL-*` tree, compare it against its own `BL-*` snapshot, and produce
the same 74 tombstones. Options:

- **(a)** `migrate-prefix` rewrites the local snapshot's keys — the necessary
  minimum, not sufficient for other clones;
- **(b)** reconcile recognizes a BULK rename (ID `X-N` disappeared, `Y-N`
  appeared with the same number and the same content) and records a rename
  instead of a delete+create pair — works in every clone, but it is a guess,
  and `history.mjs` declares "honesty instead of guessing";
- **(c)** the migration leaves an explicit, versioned record in the repo
  saying "the prefix changed from X to Y at this moment", and reconcile reads
  it — explicit, works in every clone, but adds a file to the data format.

Recommendation: **(a) + (c)** — (a) fixes the migrating clone immediately,
(c) gives the rest a FACT to read instead of a heuristic. Record the decision
in a comment at implementation time, because it is a choice, not something
obvious.

## Pre-flight reading

1. `scripts/migrate-prefix.mjs` — the comment at the top lists what the
   migration renames; that is the list the snapshot joins.
2. `scripts/history.mjs` — `snapshotPath`, `loadSnapshot`, `saveSnapshot`
   and `reconcile()`; especially the comments near `__created__`/`__deleted__`
   (lines ~144 and ~390) — they explain why reconcile behaved correctly.
3. `scripts/git-rules.mjs` — `IGNORE_RULES` (snapshot ignored) and
   `ATTRIBUTE_RULES` (`history/*.jsonl merge=union`); these are what decide
   that tombstones are permanent while the snapshot is local.
4. `scripts/tests/history.test.mjs` and `scripts/tests/id-prefix.test.mjs` —
   test patterns for both areas.
5. `scripts/tests/_repo.mjs` — the backlog directory ALWAYS comes from here.

## Steps

1. Reproduce the defect in a test: fixture with `BL-*` tasks, history and
   snapshot → `migrate-prefix --to TL` → reconcile → assert that NOT A SINGLE
   `__deleted__` or `__created__` record was produced. This test must FAIL
   today.
2. Implement (a): `migrate-prefix` rewrites the `.snapshot.json` keys
   together with the rest of the rename plan — in the same transaction, so an
   interrupted migration does not leave the snapshot out of sync with the
   tree (the file already takes care of ordering: validation first, then
   writes).
3. Decide on and implement (c), or deliberately reject it — record the
   decision in a code comment along with the reason.
4. Check whether `--dry-run` reports the snapshot the same way it reports the
   other files (the migration is meant to be predictable before it runs).
5. Investigate the second defect: where does the snapshot key
   `BL-1417-domknij-walidacje-flag-w-5` come from. If it is a separate bug
   class — open a separate task and link it here under `blocks`.
6. Add detection of a snapshot↔tree mismatch to `doctor` or `check`, if it
   turns out to be cheap — tombstones should be caught by the tool, not by a
   human reading `git status`.

## Acceptance criteria

- [x] `node --test scripts/tests/migrate-prefix-history.test.mjs` green,
      with a positive control (the test fails against the pre-fix code).
- [x] After migration on the fixture, reconcile produces NOT A SINGLE
      `__deleted__` / `__created__` record.
- [x] After migration, no file remains in `history/` under the old prefix.
- [x] `.snapshot.json` after migration has keys only under the new prefix.
- [x] `--dry-run` lists the snapshot among the files that will change.
- [x] The choice between (b) and (c) is decided and justified in a code
      comment.
- [x] `node --test scripts/tests/*.test.mjs` with no regressions;
      `worktrail check` green.

## Log

Append-only. Format: `YYYY-MM-DD status — who — note`.

2026-09-01 pending — agent:claude — opened after finding 42 tombstones in
`history/BL-*.jsonl` from the BL→TL migration. Files deleted (pure
tombstones, no history); this task removes the cause. Cause established: the
migration does not rewrite `history/.snapshot.json`.
