---
id: TL-25
title: "Closing the flag validation gap in 5 worktrail commands (build/viewer/next-id/board/history)"
type: task
labels: [pre-launch]
board: main
epic: "branchling — the tool"
priority: P2
status: done
owner: claude
estimate: 2h
confidence: high
created: 2026-08-30
updated: 2026-08-30
blocked_by: []
blocks: []
related_docs: []
verification:
  - bash: "worktrail history --frobnicate  # should FAIL, today it does a full reconciliation"
  - bash: "worktrail build --frobnicate     # should FAIL, today it ignores it and builds"
  - bash: "worktrail viewer --frobnicate    # should FAIL"
  - bash: "worktrail next-id --frobnicate   # should FAIL"
  - bash: "worktrail board --frobnicate     # should FAIL"
---

## Goal

TL-22 fixed exactly one symptom of one class of bug: the server ignored
unknown flags and silently opened a browser tab instead of doing anything.
The same class lives on in five commands that the dispatcher (`cli.mjs`)
only WRAPS, without changing — because TL-22 fixed the server, and
TL-23/1413 only gave validation to the new scripts (`init-backlog.mjs`,
`stats-report.mjs`, `new-task.mjs`).

**Found while updating the README** — by manually checking every command
with `--frobnicate`, not by guessing:

| Command | Unknown flag | Effect |
|---|---|---|
| `serve`, `query`, `new`, `init`, `stats` | FAILS (exit ≠ 0) | ✅ as it should be |
| `build`, `viewer`, `next-id`, `board` | ignored | the command still performs its normal action — misleading, but without a side effect beyond what it would have done anyway |
| `history` | ignored | **with a side effect**: `arg("--file", "")` in `history-record.mjs` simply does not find `--file`, so it takes the "whole directory" path and performs a REAL reconciliation — appending history entries to disk |

`worktrail history --help` in this very session actually appended entries to
`backlog/history/BL-1170.jsonl` (`status` and `owner` changes made by another
session) — not a fabrication, just a real but UNINTENDED side effect of
checking help output. That is worse than `build`/`viewer`/`next-id`/`board`,
which in the worst case rebuild something unnecessarily.

## Steps

1. `next-backlog-id.mjs` — add a list of known flags (`--explain`, `--dir`)
   and reject the rest, following `serve-backlog.mjs` from TL-22.
2. `suggest-board.mjs` — flags `--paths`, `--registry`, `--dir` + a
   positional file; everything else fails.
3. `build-backlog.mjs` — `--dir`/`--root` + everything else fails.
4. `build-viewer.mjs` — `--dir` + everything else fails (note: it has an
   `invokedDirectly` mode; check that validation does not break importing it
   as a module from other scripts).
5. `history-record.mjs` — **priority in this set of five**: `--file`,
   `--actor`, `--source`, `--dir`, `--quiet` + everything else fails BEFORE
   entering `reconcile()`.
6. A test in `cli.test.mjs` or a new file: each of the five commands with
   `--frobnicate` ends with `status !== 0` and no side effect (for
   `history`: `git status` / history file state untouched).

## Acceptance criteria

- [x] All 11 `worktrail` commands react the same way to an unknown flag:
      exit ≠ 0, a message with the list of allowed flags, ZERO side effect.
- [x] `history --frobnicate` does NOT append anything to
      `backlog/history/*.jsonl` — checked on a real backlog (`git status
      backlog/history/` identical before and after).
- [x] README updated — the "Input validation status" table replaced with one
      sentence: all 11 commands FAIL uniformly.
- [x] Regression tests for the whole set of five (16 cases in
      `flag-validation.test.mjs`), not just for `history`.

## Notes

Deliberately not done now: the user asked for a README update with the full
list of commands, not a fix. This task exists so the finding does not
evaporate from the conversation — the README already names it and links here.

## Log

- 2026-08-30 created — claude — found by manually checking `--frobnicate` on
  every command while updating the README; `history --help` actually
  appended history entries in this session
- 2026-08-30 board — claude — `suggest-board.mjs <task-file>` gave the
  default (because `related_docs` pointed only at the README); `--paths
  backlog/scripts/history-record.mjs` confirmed `backlog-project` — left set
  manually.
- 2026-08-30 done — claude — validation closed in all five scripts.
  `suggest-board.mjs` turned out to have THREE gaps, not one: my first tests
  (copied from the list in this task) only caught the "flag before file"
  case, and that one happened to pass BY ACCIDENT (a hardcoded `argv[2]`
  index), not thanks to validation. Manual checking revealed that a flag
  AFTER the file and a flag mixed into `--paths` passed without error —
  added as separate tests, then fixed with one mechanism. `next-backlog-id.mjs`
  revealed, along the way, another defect not described in this task: a
  backlog located AT THE ROOT of a git repository (relative path empty)
  silently substitutes 'backlog' for the empty path and finds nothing — a
  real scenario for `worktrail init --dir .`, but SEPARATE from flag
  validation; not fixed here, the test for next-backlog-id deliberately
  nests the backlog in a subdirectory of the repo, so as not to measure the
  wrong thing.
