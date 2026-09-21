---
id: TL-40
title: "check with guard selection and regen-hook in the CLI"
type: task
labels: []
board: main
epic: "CLI surface"
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
  - bash: "node --test scripts/tests/cli.test.mjs"
---

## Goal

A project that consumes `worktrail` from an installation should have a
**command** for everything it does today by calling a file by path. Today two
needs have no command, so the only option is reaching into
`node_modules/worktrail/scripts/…` — exactly the file-layout dependency the
installation was meant to remove.

## Context

Measured 2026-08-30 on a real `pre-commit` hook in a project that split this
tool out. Three gaps:

**1. `check` cannot select a guard.** It always runs both. The hook needs them
separately, because they have a **deliberately different scope**: an id
collision is a property of the SET (it reads the whole tree), while a board is
a property of a SINGLE file (it reads staged files — otherwise my commit would
fail over someone else's work in progress). Merging them into one call erases
that distinction.

**2. `check` does not accept a list of files.** The board guard in file mode
receives paths as positional arguments. Without this the hook has to call
`check-backlog-boards.mjs` by path.

**3. There is no command for the PostToolUse hook.** `regen-on-task-edit.sh`
computes its siblings via `BASH_SOURCE`, so it *technically* also works from
`node_modules` — and that is a trap, not a feature: it looks portable, and
requires the consumer to know the path into the package's internals. The
package layout then stops being an implementation detail.

**A fourth thing, found along the way:** `check` IGNORES unknown flags.
`worktrail check --help` runs the guards instead of showing help. This is the
same silent no-op that TL-25 was created for — except `check` was created
later and fell outside that net.

## Pre-flight reading

1. `scripts/cli.mjs` — `runCheck()`; today it reads only `--dir` and is silent
   about the rest.
2. `scripts/check-backlog-boards.mjs` — `--all` versus positional arguments.
3. `scripts/check-backlog-id-collisions.mjs` — the directory as `argv[2]`.
4. `scripts/regen-on-task-edit.sh` — the input shape (the hook's JSON on stdin).

## Steps

1. `check` accepts `--id-collisions` and `--boards` as selectors. No selector =
   both, as today (backward compatibility).
2. `check --boards <file…>` passes the paths to the guard; with no files and no
   `--all` — `--all` mode.
3. Flag validation: an unknown flag **fails** with exit 2, `--help` prints
   usage.
4. `regen-hook` — a new command, reads the hook's JSON on stdin, does the same
   thing as `regen-on-task-edit.sh`. ~~The script stays as the implementation~~
   — **changed along the way: the script REMOVED**, reason in `## Log`.
5. Exit code: with two guards, the **worse** one wins, not the last one.

## Acceptance criteria

- [x] `check --id-collisions` runs ONLY the collision guard — proven by the
      output, not by assumption.
- [x] `check --boards <file>` checks the given file, not the whole tree.
- [x] `check --frobnicate` fails with exit 2; `check --help` prints usage and
      does not run the guards.
- [x] `regen-hook` regenerates the views and appends to the history from the
      JSON on stdin.
- [x] `regen-hook` is silent and exits 0 for a file outside `tasks/BL-*.md`.
- [x] Without a selector `check` runs both guards and returns the worse code —
      tested on a pair (green, red), not just the happy path.

## Verification

```bash
# expected: pass
node --test scripts/tests/cli.test.mjs

# An unknown flag fails — expected: exit 2
node scripts/cli.mjs check --frobnicate; echo "exit=$?"

# A selector narrows the scope — expected: one line about collisions, ZERO about boards
node scripts/cli.mjs check --id-collisions
```

## Notes

- Step 3 is here because without it steps 1–2 are unmeasurable: when an
  unknown flag slips through, `check --id-collisions` on the old code also
  "passes" — while running both guards. A green pass would then be describing
  the absence of validation, not the selector.

## Log

- 2026-08-30 done — claude — 8 tests in `cli.test.mjs`, 7 red-first (the eighth — "worse exit code wins" — was already correct and got a net). Full suite: 220/234, the same 14 known failures from TL-38, zero new ones.
- 2026-08-30 change of decision — claude — `regen-on-task-edit.sh` REMOVED instead of kept. Reason: `regen-hook.mjs` is not a wrapper around it, but a second implementation of the same rule ("what counts as a task" + "what happens after an edit"). Two places knowing one decision is a guaranteed drift, and the script no longer had any caller in this repo. The consumer (the origin repository) calls its own copy and switches over in BL-1446.
- 2026-08-30 mistake in the test — claude — the first version looked for a trace of the guard with the pattern `/numer|board/`, which also matches the HELP TEXT of `check`; the test reported a guard as run where only the help text had been printed. Patterns narrowed to sentences that only the guard prints.
- 2026-08-30 created — claude — gap measured on the pre-commit hook of a consuming project (BL-1446); without these commands the consumer has to call files from node_modules by path
