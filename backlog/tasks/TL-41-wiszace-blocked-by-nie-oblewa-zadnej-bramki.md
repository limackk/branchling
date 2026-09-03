---
id: TL-41
title: "A dangling blocked_by fails no gate"
type: code
labels: []
board: main
epic: "Data integrity"
priority: P1
status: done
owner: claude
estimate: 4h
confidence: high
created: 2026-08-30
updated: 2026-08-30
blocked_by: []
blocks: []
related_docs: []
verification:
  - bash: "node --test scripts/tests/dangling-refs.test.mjs"
---

## Goal

`blocked_by`/`blocks` pointing at a task that does not exist must **fail**.
Today it passes through `build` and `check` without a word.

## Context

Measured on 2026-08-30, on a live case. After removing the consumer's tasks
from this repository, `TL-37` was left with `blocked_by: [BL-1445]` pointing
at a file that no longer exists. `worktrail build` and `worktrail check` were
**green**:

```
✓ backlog generated: 40 tasks → 11 active
✓ backlog: 40 tasks, each BL-NNN used once
✓ backlog: 40 task(s) checked, each with a board from the registry
```

**Why this hurts more than a typo.** `blocked_by` drives the order of work —
it is the field the tool consults to answer "can I take this". A dangling
reference produces a task that **forever looks blocked by nothing**. There is
no signal that something is wrong; there is a signal to wait.

**This is the same class that the ID-collision and board guards closed:** a
detector that has no way to fail is a warning, not a safeguard. Except here
there is not even a warning.

**Where the dangling reference came from** — not a typo, but **deleting a
task**. This will recur: every backlog split, archival with deletion, or
moving a task to another repository produces the same situation.

## Pre-flight reading

1. `scripts/build-backlog.mjs` — reads the whole tree, so it knows the set of
   existing IDs; this is the natural place for the check.
2. `scripts/check-backlog-id-collisions.mjs` — the pattern for a guard that
   judges a SET, and its message (it says what to do, not just that something
   is wrong).
3. `scripts/cli.mjs` — `parseCheckArgs`; the new selector follows the same
   convention as `--id-collisions` and `--boards`.

## Steps

1. Red-first: a fixture with a task whose `blocked_by` points at a nonexistent
   number. It must fail.
2. Settle the scope: `blocked_by` and `blocks` — both. Check whether other
   fields reference IDs (`related_docs` is sometimes a path, not an ID).
3. Settle **archived tasks**: a reference to a `done` task is CORRECT (the
   blocker was satisfied), a reference to a NONEXISTENT one is not. Do not
   conflate the two cases — that is the difference between "done" and "lost".
4. Settle **cross-repo references**: after a backlog split, the form
   `<repo>#BL-NNNN` exists (used in `LINEAGE.md`). The guard should let it
   through as deliberately external, not fail it — otherwise it would force a
   lie into the data.
5. Expose as `check --refs`, add to the default `check`.

## Acceptance criteria

- [x] `blocked_by` pointing at a nonexistent number **fails** — red-first test.
- [x] `blocks` checked in the same pass.
- [x] A reference to a `done`/`cancelled` task **passes** — negative test,
      otherwise the guard would force deleting real dependency history.
- [x] ~~A reference in the form `<repo>#BL-NNNN` passes and is recognized as
      external~~ → **resolved the OPPOSITE way: such a reference FAILS**, with
      a message saying where to record it instead. Reason in `## Log`.
- [x] The message says WHICH task points at WHAT and what to do about it.
- [x] `check --refs` works standalone and is part of the default `check`.
- [x] The real tree of this repository passes — with a positive control that
      the guard actually checked something (number of references checked > 0).

## Verification

```bash
# expected: pass
node --test scripts/tests/dangling-refs.test.mjs

# Real tree — expected: ✓ and a NONZERO count of references checked
node scripts/cli.mjs check --refs

# Positive control on the live tree — expected: exit != 0
cp backlog/tasks/TL-41-wiszace-blocked-by-nie-oblewa-zadnej-bramki.md /tmp/bl1451.bak
sed -i '' 's/^blocked_by: \[\]/blocked_by: [BL-999999]/' backlog/tasks/TL-41-wiszace-blocked-by-nie-oblewa-zadnej-bramki.md
node scripts/cli.mjs check --refs; echo "exit=$?"
cp /tmp/bl1451.bak backlog/tasks/TL-41-wiszace-blocked-by-nie-oblewa-zadnej-bramki.md
```

## Notes

- Found by hand, not by a test — meaning nothing today guards this class of
  bug.
- Step 3 is the most substantively important one here: the simplest
  implementation ("every number in `blocked_by` must be a file in `tasks/`")
  is CORRECT only as long as the archive stays in `tasks/`. If `done` tasks
  ever moved out to a separate directory, this guard would start failing on
  correct data.

## Log

- 2026-08-30 done — claude — `scripts/check-backlog-refs.mjs` + `check --refs`, added to the default `check`. 8 tests, all red-first. Full suite 240/240.
- 2026-08-30 STEP 4 RESOLVED THE OPPOSITE WAY FROM THE PLAN — claude — the task assumed the guard should LET `<repo>#BL-NNNN` THROUGH as "deliberately external". Measurement disproved this twice. **First, such a value has no way to arise today:** `task-fields.mjs` has `itemPattern: "^BL-[0-9]+$"` on both fields, so the viewer rejects it — I would be writing handling for input that cannot be entered. **Second, and more important: letting it through would break the field's meaning.** The tool does not know whether `another-repo#BL-1` is done, so `blocked_by` would stop being a complete answer to "can I take this" — silently, because the entry would look verified. The guard REJECTS such an entry and says where to record the dependency instead: as prose in `## Log`/`## Notes`. Exactly what I did by hand in `origin#BL-1445`, before this guard existed.
- 2026-08-30 guard scope — claude — judges the SET (like the collision guard), not a single file (like the board guard). A reference is only wrong RELATIVE to the whole tree; no single file carries enough information to determine that on its own.
- 2026-08-30 `done` is not "lost" — claude — a reference to a closed blocker PASSES, with a negative test guarding this distinction. The cheaper rule ("must point at an active task") would look correct and would force deleting real dependency history to get a green result — that is, it would teach the guard to lie. Known limit recorded at the top of the file: resolution walks files in `tasks/`, so if the archive ever moved to a separate directory, the guard would start failing on correct data and must learn about that directory in the SAME change.
- 2026-08-30 positive control in the message — claude — a clean run prints the NUMBER of references checked, because a "✓" over zero means "there was nothing to check". A test on an empty tree guards against the guard fabricating a nonzero count.
- 2026-08-30 checked against the CONSUMER before release — claude — the guard enters the default `check`, meaning it immediately reaches the origin repository's `pre-commit` hook. Measured there BEFORE the commit: **562 references, 0 dangling** — the hook will not turn red on the founder.
- 2026-08-30 two mistakes of my own — claude — (1) a Polish closing quote `"` inside a `"…"` literal broke the string and the file failed to parse; (2) `takeDirFlag` returns `{dir, argv}`, not `{dir, rest}`. Both caught on first run, both because the guard was invoked, not just read.
- 2026-08-30 created — claude — found while splitting the consumer's backlog: after removing tasks `origin#BL-1445`/`#BL-1446` from this repo, `TL-37` was left with a dangling `blocked_by`, and `build` and `check` were green
