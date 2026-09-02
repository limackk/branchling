---
id: TL-38
title: "Test suite detached from its source repository"
type: code
labels: []
board: main
epic: "Portability"
priority: P2
status: done
owner: claude
estimate: 1d
confidence: medium
created: 2026-08-30
updated: 2026-08-30
blocked_by: []
blocks: []
related_docs:
  - docs/worktrail-global-tool.md
verification:
  - bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

The suite has to pass **in this repository**, not only in the one the module
was extracted from. Today 14 of 226 tests fail, because they describe someone
else's tree.

## Context

Found on the first run of the suite after extraction (BL-1445). Distribution
of failures, measured 2026-08-30:

| File | Failed |
|---|---|
| `boards.test.mjs` | 7 |
| `history-merge.test.mjs` | 2 |
| `config.test.mjs` | 2 |
| `views-not-versioned.test.mjs` | 1 |
| `task-fields.test.mjs` | 1 |
| `backlog-id-collisions.test.mjs` | 1 |

This is NOT two separate issues, but two classes of one:

**Class A — co-location in tests.** Five files compute the backlog directory
as `join(HERE, "..", "..")`. This is exactly the bug BL-1445 fixed in
`build-backlog.mjs` and `cli.mjs`: a shortcut that only works when the code
sits ABOVE the data, and stays silent about being an assumption. In this
repository `scripts/tests/../..` is the repo root, not the backlog — so `git
check-ignore INDEX.yaml` asks about a non-existent file in the wrong
directory.

**Class B — assertions about someone else's project.** Some tests check
VALUES that were a fact about that repository: its vocabularies in
`config.yaml`, its `pre-commit` manifest, its labels. These tests have
nothing to guard here and cannot be "moved" — they have to be rewritten
against a fixture or removed with a justification.

**What NOT to do:** loosen assertions so they pass. Several of them (for
example the `INDEX.yaml` size ratchet and the positive control for a views
conflict) carry real evidentiary force, and passing on an empty tree would be
green with no value.

## Pre-flight reading

1. `CLAUDE.md` §"Before you change the code" — the rule about
   `resolveBacklogDir()`.
2. `scripts/tests/non-colocated-layout.test.mjs` — the regression test from
   BL-1445; shows how to build a tree shaped like this repository.
3. `scripts/paths.mjs` — the four sources of the data directory.

## Steps

1. **Class A:** replace `join(HERE, "..", "..")` with a call to
   `resolveBacklogDir()` or — better — a fixture set up by the test. A test
   that asks about the REAL tree depends on which repo it is run in; a test
   against its own fixture does not.
2. **Class B:** for each test, decide whether it guards a property of the
   TOOL (→ fixture) or a property of that project (→ remove, with a reason
   in the commit).
3. Tests that must see the real tree (ratchets, positive controls) stay —
   but they must read the tree of THIS repository.
4. Leave no test that passes on a zero sample.

## Acceptance criteria

- [x] `node --test scripts/tests/*.test.mjs` — 0 failures in this repository.
- [x] No test computes the backlog directory as `join(HERE, "..", "..")`.
- [x] Every removed test has a reason in the commit — it does not disappear
      silently.
- [x] No assertion was loosened just to pass; tests with evidentiary force
      (ratchets, positive controls) still have it.
- [x] No test that passes on an empty tree exists — each one has a positive
      control or its own fixture.

## Verification

```bash
# expected: 0 fail
node --test scripts/tests/*.test.mjs

# No test guesses the directory via co-location — expected: no matches
grep -rn '"\.\.", "\.\."' scripts/tests/ && echo "WARNING: co-location in tests" || echo "clean"
```

## Notes

- This is debt brought over from the extraction, not a new defect — the tool
  works (`build`, `check`, 212 tests green). But the suite is what convinces
  a stranger that it works, so red in it costs credibility.

## Log

- 2026-08-30 mutation test after commit — claude — `_repo.mjs` pointed at
  `scripts/` instead of `backlog/`: the suite went **RED** (7 failures) and
  the test count dropped from 232 to 138, because throwing at import time
  kills whole files. A broken resolver has no way to produce a green run —
  that was the point. A note for the future: this mutation has to be judged
  by the COUNT, not just "fail 7"; 94 tests did not run at all.
- 2026-08-30 done — claude — 232/232. Solution: ONE module,
  `scripts/tests/_repo.mjs`, answers the question "where is the backlog of
  THIS repository", and every test asks it. It settles BOTH layouts
  (`<repo>/backlog` and the co-located `<repo>`), because the tool supports
  both — so its own tests cannot hardcode either.
- 2026-08-30 why not `resolveBacklogDir()` — claude — its third source is
  detection upwards from **cwd**, so a suite run from a different directory
  would judge someone else's backlog and still show green. The search has to
  start from the test file's location, not from cwd.
- 2026-08-30 two tests REMOVED with a reason in the code — claude — (1) "the
  guard is declared in the pre-commit manifest": permanently outdated, not
  merely non-portable — the consumer deliberately removed both guards from
  `GUARD_MANIFEST` (BL-1446), because the manifest's contract is "the guard
  is a TRACKED file in this repo". (2) "the origin project's config.yaml mirrors the
  vocabularies": a one-off parity proof for TL-19, delivered where it made
  sense. Both left a comment saying what we NO LONGER have because of this.
- 2026-08-30 ratchet REBASED, not removed — claude — the threshold
  `INDEX.yaml < 75,000 B` was computed from 337 tasks of that project; at 42
  tasks it would pass even if every row were a full mirror of the
  frontmatter — that is, it was GREEN WITH ZERO EVIDENTIARY FORCE, exactly
  what this task forbids. Replaced with a cost PER ROW (threshold 250 B),
  because that is the invariant that mattered. Measured: 155 B/row here,
  168 B/row at the consumer (the header counted separately — spread over 14
  rows it raises the average by ~90 B, over 353 by ~4 B). The defect the
  ratchet was built for is 442 B/task; a positive control on a synthetic
  "fat" index gives 451 B and the ratchet CATCHES it.
- 2026-08-30 one deliberate loosening — claude — "boards.yaml knows at least
  2 boards" → "at least 1". That was a property of that project's registry;
  a project with one board is valid. In exchange, the test gained a positive
  control it did NOT have before: "read at least one task" — without it, an
  empty directory gave a green "zero bad boards".
- 2026-08-30 positive controls added — claude — four, in places where a
  green pass did not distinguish "I checked and it was fine" from "there was
  nothing to check": the real board tree, the collision guard on the real
  tree, `project_name` (missing file → default), `labels_closed` (the other
  side of the switch).
- 2026-08-30 gate fixed, not bypassed — claude — `grep '"..", ".."'` also
  fired on `packaging.test.mjs`, where that path was CORRECT (repo root, not
  backlog). Instead of working around the regex, `packaging` now also goes
  through `_repo.mjs` — the repository root is now computed in one place,
  the same as the backlog directory.
- 2026-08-30 taken — claude
- 2026-08-30 appended — claude — two additions after BL-1446 in the
  consumer repo:
  1. The test "guard: is declared in the pre-commit manifest" is now
     **permanently outdated**, not merely non-portable. The consumer
     deliberately removed both guards from `GUARD_MANIFEST`, because the
     manifest's contract reads "the guard is a TRACKED file in this repo",
     and the installed dependency does not satisfy that. This test has
     nothing to guard ANYWHERE — it belongs to class B (remove with a
     reason), not to class A.
  2. The same class sits in ~20 lines of COMMENTS (`node backlog/scripts/…`
     in the headers of `scripts/*.mjs`). It fails nothing, so it does not
     block this task, but it is the same baked-in knowledge of someone
     else's tree. One occurrence was **user-facing** — the boards guard's
     message told the user to run a path that does not exist at the
     consumer; fixed by hand, the rest stays.

- 2026-08-30 created — claude — found on the first run of the suite after
  the repo extraction (BL-1445); 14/226 failed, two classes: co-location in
  tests and assertions about someone else's project
