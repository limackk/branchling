---
id: TL-178
title: "The viewer's browser storage keys still carry the originating project's name"
type: code
labels: []
board: main
epic: "Backlog viewer"
priority: P2
status: pending
owner: unassigned
role: ""
executor: ""
estimate: 2h
confidence: medium
created: 2026-09-03
updated: 2026-09-03
blocked_by: []
blocks: []
related_docs: []
verification:
  - id: no-foreign-storage-keys
    bash: "node --test scripts/tests/viewer-storage-keys.test.mjs"
---

## Goal

Nothing the viewer writes into a stranger's browser is named after the project
this tool was extracted from, and the one-time cost of renaming those keys is
paid deliberately rather than discovered by a user.

## Context

Found while closing TL-37, which cleared the originating project's name out of
`docs/`, `README.md` and `LINEAGE.md`. The name survives in six places that TL-37
deliberately did not touch, because they are not documents and because renaming
them is a decision about MIGRATION rather than about prose:

```
scripts/build-viewer.mjs   BOARD_STORAGE_KEY, ACTOR_STORAGE_KEY,
                           DASH_RANGE_STORE, DASH_BURN_STORE,
                           the IndexedDB database name, showDirectoryPicker id
scripts/tests/boards.test.mjs   temporary-directory prefixes
```

Two different problems wearing one word:

- **The storage keys are a FROZEN identity**, in the sense CLAUDE.md gives that
  word for `BLOCK_MARKER_NAME`: renaming one does not move the value, it
  abandons it. Every viewer that has already stored a board selection, an actor
  or a dashboard range under the old key silently forgets it, and the
  `showDirectoryPicker` id forgets the directory permission the user granted.
- **The test fixtures are not an identity at all** — a temporary-directory
  prefix — and can simply be renamed.

The moment matters. This repository has no remote and has not been published
(see TL-158), so the number of browsers holding state under the old keys is
small and known. That window closes on the first publication, and after it a
rename costs somebody their settings.

## Pre-flight reading

1. `scripts/build-viewer.mjs` — the six occurrences, and how each key is read.
2. `CLAUDE.md`, "Two identities, not one" — the reasoning about a display name
   that may change versus a frozen key that may not, applied here.
3. `scripts/product.mjs` — where a name is allowed to come from, if these keys
   should be derived rather than written out.

## Steps

1. Decide, and record, whether the new keys are derived from `PRODUCT_NAME` or
   written out as frozen constants. Derived means a future rename of the product
   orphans them again; frozen means the name is a literal the product-name guard
   has to be told about. Neither is free — state which cost is being taken.
2. Rename, with a one-time read of the OLD key when the new one is absent, so
   the existing state migrates instead of being dropped. Delete the fallback in
   a later task, not this one.
3. The IndexedDB database and the `showDirectoryPicker` id are the two that
   cannot be migrated by reading a fallback — say so in the release note rather
   than pretending otherwise.
4. Rename the test fixtures' temporary-directory prefixes; they carry nothing.
5. A guard: no storage key, database name or picker id in `scripts/` contains a
   word from `foreign_context_words` (TL-37) — with a positive control.

## Acceptance criteria

- [ ] No browser storage key, IndexedDB name or picker id names the originating
      project. [proof: no-foreign-storage-keys]
- [ ] A viewer holding state under an old key still finds it after the rename,
      for the keys where that is possible. [proof: no-foreign-storage-keys]
- [ ] The guard catches a reintroduced foreign key, and its positive control
      proves it can fire. [proof: no-foreign-storage-keys]
- [ ] The keys that CANNOT be migrated are named, in the task and in the
      release note. [proof: no-foreign-storage-keys]

## Decisions

- Not folded into TL-37. That task's contract is about documents, and its
  criteria were written and agreed as a grep over `docs/` and `README.md`.
  Renaming a frozen key is a migration decision with a user-visible cost, which
  is a different question with a different answer.
