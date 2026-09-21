---
id: TL-391
title: "A configured hook points at a script that exists"
type: task
labels: []
board: main
epic: "Agent harness"
priority: P1
status: done
owner: agent:claude
role: ""
executor: ""
estimate: 1h
confidence: high
created: 2026-09-21
updated: 2026-09-21
blocked_by: []
blocks: []
related_docs: []
verification:
  - id: hook-targets-exist
    bash: "node --test scripts/tests/agent-hooks.test.mjs"
---

## Goal

Every command a harness hook is configured to run can actually be run. Today
two of them cannot, and the harness says nothing about it.

## Context

`.claude/settings.json` and `.codex/hooks.json` both register a `PostToolUse`
hook with matcher `*` that runs `scripts/activity-hook.sh`. That file was
deleted in `b5ade06` (TL-378, "Telemetry entry points no longer ship") together
with the activity commands and their tests. The two configurations were not
touched, so since that commit every tool call in every session spawns a command
that exits 127 with `No such file or directory`.

Nothing broke visibly, which is the whole problem: a hook that fails is
indistinguishable from a hook that ran and had nothing to say. The telemetry it
fed is gone, so the fix is to remove the registration, not to restore the
script — `backlog/activity/rollup/` has been frozen since the deletion and is a
separate question (TL-197).

The second hook in both files is healthy: `regen-hook` is a registered command
and exits 0. Its matcher still names `MultiEdit`, a tool the harness no longer
exposes, and does not name `NotebookEdit`, one it does — dead vocabulary on one
side and a gap on the other.

The reason this is a guard and not a one-line edit: the deletion that caused it
was a careful commit that removed twenty files and their tests, and it still
missed two JSON references because nothing pointed at them. A test that reads
both configurations and resolves every command back to a file on disk is what
makes the next such deletion fail loudly.

## Pre-flight reading

1. `.claude/settings.json` — the two hooks, and `$CLAUDE_PROJECT_DIR` as the
   root the command is resolved against.
2. `.codex/hooks.json` — the same two hooks, resolved through
   `git rev-parse --show-toplevel` instead. The test has to handle both spellings.
3. `git show --stat b5ade06` — what was removed, and that the configurations
   were not part of it.

## Steps

1. Remove the `*` / `activity-hook.sh` entry from both configurations.
2. Correct the surviving matcher to the tools the harness actually exposes.
3. Add `scripts/tests/agent-hooks.test.mjs`: for every hook in both files,
   resolve the command's script argument to a path and assert it exists, or
   assert the command is a registered `cli.mjs` subcommand. Assert a non-zero
   number of hooks was examined, so the test cannot pass on an empty sample.

## Acceptance criteria

- [x] No hook in `.claude/settings.json` or `.codex/hooks.json` names a file
      that is absent from the tree. [proof: hook-targets-exist]
- [x] The guard counts the hooks it checked and fails on a zero sample.
      [proof: hook-targets-exist]
