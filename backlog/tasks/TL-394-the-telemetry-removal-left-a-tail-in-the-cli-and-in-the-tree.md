---
id: TL-394
title: "The telemetry removal left a tail in the CLI and in the tree"
type: task
labels: []
board: main
epic: "Agent harness"
priority: P2
status: pending
owner: unassigned
role: ""
executor: ""
estimate: 3h
confidence: medium
created: 2026-09-21
updated: 2026-09-21
blocked_by: []
blocks: []
related_docs: []
verification:
  - id: no-entry-names-a-missing-script
    bash: "node --test scripts/tests/agent-hooks.test.mjs"
---

## Goal

Nothing in the tree describes, ships or displays a capability that was removed.
Three leftovers of TL-378 still do.

## Context

TL-378 removed activity collection, scorecards, calibration and session reports
— twenty files, five thousand lines. The removal itself is sound and its
dispatcher decision is stated outright in `scripts/cli.mjs`: the five command
names are deleted from `COMMANDS` in one loop beside the dispatcher, so the
terminal, the MCP server and `--help` lose them together. Running any of them
fails with exit 2 and names the commands that exist, which is what AGENTS.md
requires.

Three things did not follow, and none of them is covered by that reasoning.

FIRST, roughly 250 lines of usage text for `activity`, `focus`, `quote`,
`session` and `sessions` are still in `COMMANDS`, each with a `script:` naming a
file that is not in the tree. It is unreachable today, and it is a trap for
exactly the person the removal list is written for: take a name out of that loop
— which the comment invites, since that is the seam it documents — and the
command dispatches to a missing file. The stated decision covers keeping the
NAMES beside the dispatcher. It says nothing about keeping the prose.

SECOND, that prose is documentation of a contract the tool no longer honours. It
describes retention windows, `forget`, `reassign` and a privacy report, in the
present tense, in a file that ships in the package.

THIRD, `backlog/activity/rollup/` holds 206 per-task aggregates, 204 of them
committed. Nothing writes them any more: the hook was removed by TL-378 and its
last two references by TL-391. They are frozen measurements of hours worked,
still in a public history, still carrying the meaning "this is what the tool
knows about when somebody worked" — and two of them were never committed at all,
so the directory does not even agree with itself. The `--help` text above
justifies committing the aggregate by the existence of `prune` and `forget`,
which are gone; the justification and the mechanism left at different times.

WHAT THIS TASK IS NOT. It is not a re-argument of TL-378. The capability stays
removed. The question is only what its removal owes the tree it left.

## Pre-flight reading

1. `scripts/cli.mjs`, the `COMMANDS` entries around `activity-command.mjs`, and
   the deletion loop after the table — the decision that WAS made, in its own
   words, so this task extends it rather than contradicting it.
2. `git show --stat b5ade06` — what left, and what did not.
3. `backlog/activity/rollup/` — 206 files, and `git ls-files` over the same
   directory for the two that are not tracked.

## Steps

1. Remove the five unreachable `COMMANDS` entries and shorten the deletion loop
   to the names that still need suppressing, keeping the comment's reasoning
   intact for those.
2. Decide what `backlog/activity/rollup/` is now — a historical record kept on
   purpose, or data with no writer, no reader and no way to be corrected. Record
   the choice as a `__decision__` event, not as prose in this file.
3. Extend the guard in `scripts/tests/agent-hooks.test.mjs` so that a `COMMANDS`
   entry naming a `script:` that is not in `scripts/` fails, whether or not the
   dispatcher deletes it afterwards.

## Acceptance criteria

- [ ] No entry in `COMMANDS` names a `script:` that is absent from `scripts/`.
      [proof: no-entry-names-a-missing-script]
- [ ] `backlog/activity/rollup/` either agrees with `git ls-files` over itself,
      or is gone. [proof: no-entry-names-a-missing-script]
