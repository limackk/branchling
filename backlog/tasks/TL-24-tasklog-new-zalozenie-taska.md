---
id: TL-24
title: "worktrail new — creating a task with a number scanned from all branches"
type: task
labels: [pre-launch]
board: main
epic: "branchling — the tool"
priority: P2
status: done
owner: claude
estimate: 3h
confidence: high
created: 2026-08-29
updated: 2026-08-29
blocked_by: []
blocks: []
related_docs: []
verification:
  - bash: "./scripts/worktrail new --title \"Test\" --priority P3  # number matches `worktrail next-id`"
  - bash: "node --test backlog/scripts/tests/new-task.test.mjs"
---

## Goal

Close the last command from the list deferred in
[TL-23](TL-23-tasklog-init-i-stats.md): creating a task from the template,
with a number, a slug, and filled-in frontmatter.

## Context

Creating a task was manual until now: copy `_template.md`, run
`next-backlog-id.mjs`, type in the number, invent a slug, fill in the dates.
Five steps, **one of which is dangerous**.

**This command's risk is the NUMBER, not the file.** The workspace rule says
"never max+1 from your own tree", because another session can be holding the
next ID on its branch before any file exists — two tasks with the same number
only surface at merge time. Hence three safeguards:

1. The number comes from `next-backlog-id.mjs`, which scans ALL worktrees and
   branches.
2. When that scan does not work (a fresh backlog with not a single `BL-*`, a
   directory outside a git repository), a fallback local scan kicks in — and
   the command **loudly announces** that it fell back to this path. A local
   max+1 is exactly what the rule warns against; staying silent would turn a
   known risk into an invisible one.
3. The write is **exclusive** (`flag: "wx"`) — a taken number ends in an
   error, never in overwriting someone else's task.

**Bug found along the way, by a test:** the first version computed the number
from the repository the SHELL is standing in, not the one containing the
specified backlog — `next-backlog-id.mjs` resolves the repo via `git
rev-parse --show-toplevel` on the current directory. `worktrail new --dir
/somewhere/else` was getting numbers from the origin project. Fixed with `cwd: root` on the
call.

## Steps

1. `new-task.mjs`: `slugify` (diacritics → ASCII, trimmed at a word
   boundary), number resolution with an explicit source, value validation
   against configuration DICTIONARIES, template filling, exclusive write.
2. Registration in the `cli.mjs` command table.

## Acceptance criteria

- [x] `worktrail new --title "Zażółć gęślą jaźń"` yields
      `BL-N-zazolc-gesla-jazn.md` — diacritics fold down to ASCII, they do not
      vanish.
- [x] The number matches `worktrail next-id`; verified on the real tree (1413,
      then next-id = 1414).
- [x] An empty backlog yields `BL-1` instead of an error, and the fallback
      number source is ANNOUNCED.
- [x] A taken number does NOT overwrite the file (the test plants
      `BL-1-someone-elses.md` and checks the bytes).
- [x] Missing `--title`, a title without a single letter, a value outside the
      dictionary, and an unknown flag all FAIL; none of these cases leaves a
      file behind.
- [x] A board outside the registry fails — the board dictionary is CLOSED;
      without `--board`, `default` is used and this is printed.
- [x] The created task PASSES `check`, enters `build`, and is visible in
      `stats` — an assertion on "the rest of the tool accepts it", not on
      "the file exists".
- [x] 17 tests in `new-task.test.mjs`; the full suite is green.

## Notes

**A test fix, not a code fix:** the first assertion, "the file contains no
`YYYY-MM-DD`", failed on a correct file — that string also appears in the
template's `## Log` section as a FORMAT DESCRIPTION. The assertion was
narrowed to the frontmatter; the broader one confused documentation with an
unfilled field.

**Deliberately out of scope:** `--body` / opening an editor after creation,
automatic `suggest-board` (the router reads PATHS that a new task does not
yet have), reserving a number between concurrent sessions (requires a lock —
[worktrail-state-and-sync.md §6.1](../../docs/branchling-state-and-sync.md)).

## Log

- 2026-08-29 created — claude — the last command from the list deferred in TL-23
- 2026-08-29 done — claude — `new` plus the fix to the number source with `--dir`
