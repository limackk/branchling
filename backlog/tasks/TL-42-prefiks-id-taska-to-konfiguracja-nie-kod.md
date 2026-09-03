---
id: TL-42
title: "Task ID prefix is configuration, not code"
type: code
labels: []
board: main
epic: "Configurability"
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
  - LINEAGE.md
verification:
  - bash: "node --test scripts/tests/id-prefix.test.mjs"
---

## Goal

A project that adopts this tool's backlog should be able to say what its
tasks are called. Today it cannot — `BL-` is hardcoded in 13 files.

## Context

Measured 2026-08-30: the pattern `BL-\d`, `BL-[0`, or the literal `"BL-"`
occurs **31 times across 13 files** (excluding comments that reference
tasks):

| File | Occurrences |
|---|---|
| `build-backlog.mjs` | 8 |
| `history.mjs` | 5 |
| `check-backlog-id-collisions.mjs` | 4 |
| `build-viewer.mjs` | 3 |
| `new-task.mjs`, `task-fields.mjs` | 2 each |
| 7 remaining files | 1 each |

**Why this is the same issue as TL-19.** Back then, the project's vocabulary
(statuses, labels, boards) moved out of the code into `config.yaml` under the
principle "the code knows the SHAPE, the configuration knows the VALUES". The
ID prefix is the last value of one particular project left in the code. The
shape is "prefix + number"; "BL" is a value — and someone else's at that.

**The side effect that triggered this.** After the backlog was split
(`<origin>` and this repository), both trees issue numbers
independently from the same space. `next-id` returned `1448` in BOTH, and
`BL-1448` today means two different things: here, "Test suite decoupled from
the source repository"; for the consumer, "Expire the backlog-project
board". **This collision is real, not hypothetical** — it exists at the time
of writing this task and is deliberately left unresolved here, because
renumbering after this change happens once, not twice.

Separately, less urgent but still true: an open-source project starting its
backlog at `TL-1` looks like a fragment of someone else's repository.
Because it is one.

## Pre-flight reading

1. `scripts/config.mjs` — how a key is added to config; an unknown key FAILS,
   so the default must exist before anyone uses it.
2. `scripts/paths.mjs` — `looksLikeBacklogDir`; directory detection must not
   depend on the prefix, otherwise changing the prefix breaks backlog
   detection.
3. `scripts/next-backlog-id.mjs` — scans across ALL branches; the pattern
   also lives in the arguments passed to git.
4. `LINEAGE.md` — cross-repo references there already use the form
   `<repo>#BL-NNNN`.

## Steps

1. Add `task_id_prefix` to the configuration with a generic default. **The
   default must NOT be `BL`** — that is the value of the project we are
   detaching from; `TASK` or `T` are neutral. Changing the default is a
   breaking change for anyone who already has a backlog, so the migration
   goes in step 4.
2. Replace the 31 occurrences with a reference to the configuration. Build
   patterns from the prefix, don't concatenate strings at the point of use —
   one function `taskIdPattern(cfg)`.
3. The task filename also carries the prefix (`BL-NNN-slug.md`) — cover that
   the same way.
4. Write a migration: renumber the existing backlog to the new prefix,
   including `history/<ID>.jsonl`, `blocked_by`, `blocks`, and references in
   the body text. **Without this, step 1 is a trap**, not a change.
5. Decide whether THIS backlog moves to its own prefix. Recommendation: yes
   — the `BL-1448` collision disappears on its own, and numbering stops
   starting at 1303. Record the decision and the reason in `LINEAGE.md`.

## Acceptance criteria

- [x] `task_id_prefix` in the configuration, with a generic (NOT `BL`)
      default.
- [x] `grep -rE '"BL-|BL-\\d' scripts/*.mjs` returns nothing besides comments
      referencing tasks — gate in Verification.
- [x] A backlog with a prefix other than `BL` goes through the full cycle:
      `init`, `new`, `build`, `check`, `next-id`, `query`, viewer. End-to-end
      test on a fixture.
- [x] `next-id` counts from the correct pattern — test on a tree with TWO
      prefixes, guarding that the foreign one is not counted.
- [x] The migration also moves `history/<ID>.jsonl` and rewires
      `blocked_by`/`blocks` — test on tasks that block each other.
- [x] References of the form `<repo>#PREFIX-NNNN` still work (see TL-41).
- [x] The `BL-1448` collision **deliberately resolved as: STAYS for now**,
      reason below. The mechanism that resolves it is delivered and
      verified.

## Verification

```bash
# expected: pass
node --test scripts/tests/id-prefix.test.mjs

# The prefix no longer lives in the code — expected: no matches besides comments
grep -rnE '"BL-|BL-\\\\d|BL-\[0' scripts/*.mjs | grep -v '^\s*\*' || echo "clean"

# A foreign prefix goes through the full cycle — expected: all ✓
node scripts/cli.mjs init --dir /tmp/prefix-probe
# (set task_id_prefix: TASK in /tmp/prefix-probe/config.yaml)
node scripts/cli.mjs new --dir /tmp/prefix-probe --title "Try it"
node scripts/cli.mjs build --dir /tmp/prefix-probe && node scripts/cli.mjs check --dir /tmp/prefix-probe
```

## Notes

- The ordering with step 4 is not cosmetic: shipping a configurable prefix
  without a migration produces a tool where changing the setting silently
  cuts the user off from their own tasks (`next-id` stops seeing them,
  `build` stops collecting them). That would be data loss disguised as
  success.
- Deliberately out of scope: the number format (leading zeros, length).
  Today it is `\d+` and nothing flags an issue.

## Log

- 2026-08-31 done — claude — `task_id_prefix` in the configuration, patterns
  from `scripts/task-id.mjs`, `migrate-prefix` command, drift guard. 12 new
  tests, full suite 251/251. Consumer (the origin repository) checked after every
  change: 1363 tasks, all three guards green.
- 2026-08-31 STEP 5 RESOLVED THE OPPOSITE WAY — claude — I had recommended
  renumbering THIS backlog to its own prefix. **I am not doing that**,
  because `--dry-run` measured it: 78 files to change and **215 mentions of
  `BL-NNN` in task BODIES**, which the migration deliberately does NOT touch
  (there is no way to distinguish a local reference from `<repo>#BL-NNNN`).
  The migration would leave 215 sentences pointing at numbers that no longer
  exist — trading one known collision for two hundred silent ones. The
  mechanism is delivered and verified; renumbering this repository is a
  separate decision with its own prose-review step. The `BL-1448` collision
  is documented on both sides and costs little today.
- 2026-08-31 mid-task design change: INFERENCE — claude — a plain "default =
  TASK" would break **every existing backlog**: its `config.yaml` has no
  such key, so after the update it would be read under `TASK` and would find
  none of its own tasks. Measured on our own suite — 13 tests at once. Added
  rule: **an explicit setting always wins; only its ABSENCE hands the
  decision to the tree.** The configuration remains the source of truth, and
  an untouched backlog works with no edits at all.
- 2026-08-31 the drift guard is the core of it, not an add-on — claude —
  without it, `BL-*.md` files under a `TASK` configuration read as ZERO
  tasks, and `build` rebuilds the views as empty ON REAL DATA and prints ✓.
  That is data loss with a success message. The guard FAILS before any
  write; the test checks that `INDEX.yaml` is not produced at all. Negative
  control kept separate: an empty backlog is a legitimate state, not drift.
- 2026-08-31 defect caught by a positive control on a real tree — claude —
  foreign-prefix detection was GREEDY and read the prefix
  `TL-25-domknij-walidacje-flag-w` from
  `TL-25-domknij-walidacje-flag-w-5-komendach.md` (because a further `-5-`
  also appears). The drift message reported garbage instead of the name.
  Fixed with a lazy quantifier, pinned with a test. I would only have seen
  this on real filenames — the fixture with `BL-1-x.md` passed.
- 2026-08-31 A SECOND instance of the same greediness, found from an
  ARTIFACT — claude — `git status` showed a file
  `backlog/history/TL-25-domknij-walidacje-flag-w-5.jsonl` that no one had
  created. Extracting the ID from the filename (`ANY_TASK_FILE_ID`) had the
  same greedy pattern, so the hook wrote history under a fabricated
  identifier. This was not found by a test or a code review, only by a stray
  file on disk. Fixed, the file removed, the class pinned with a test on the
  REAL filename — the `BL-1-x.md` fixture had passed both defects.
- 2026-08-31 in passing: `next-id` no longer requires git — claude — outside
  a git repository it used to fail, but `--dir` can point at any directory.
  Now it falls back to scanning its own directory and **loudly says** that
  this is a narrower source (the number may be taken on a foreign branch);
  `new` forwards this warning instead of swallowing it. An empty backlog now
  yields `1` instead of an error.
- 2026-08-31 three of my own mistakes — claude — (1) a Python-based
  replacement ate backslashes and `"^TASK-\\d+"` became `^TASK-d+` (the same
  class as a template literal swallowing regexes); fixed by building patterns
  in tests from the tool's own FUNCTION, not from a copied string; (2) a
  backtick in a comment inside a template literal broke `init-backlog.mjs`;
  (3) an import inserted after the last `import` line landed IN THE MIDDLE
  of a multi-line import in `serve-backlog.mjs`.
- 2026-08-31 deliberately NOT done — claude — `history.mjs`, `regen-hook.mjs`
  and the path validator in `serve-backlog.mjs` were given patterns WITHOUT a
  prefix (`ANY_TASK_*`). The history log is keyed by whatever ID a task has;
  giving it an opinion about vocabulary would make it stop reading its own
  history after a migration — exactly when it is needed most.
- 2026-08-30 created — claude — 31 occurrences across 13 files measured;
  triggered by a real `BL-1448` collision between this repository and
  `<origin>` after the backlog split
