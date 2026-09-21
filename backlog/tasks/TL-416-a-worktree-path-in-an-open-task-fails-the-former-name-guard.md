---
id: TL-416
title: "A worktree path in an open task fails the former-name guard"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-21
updated: 2026-09-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: the-guard-is-green
    bash: "node --test scripts/tests/former-name.test.mjs"
---

## Goal

The suite is green again: TL-415's open task file names a worktree path carrying the tool's former name, and `scripts/tests/former-name.test.mjs` fails on it.

## Context

Observed on 2026-09-21 while closing TL-396, on a branch taken off main at 241e048, where the full suite ran 1776 tests with exactly this one failure:

<!-- former-name: allow -->
    no open task tells anybody to run a command that no longer exists
    TL-415-a-node-modules-symlink-is-not-ignored-so-every-worktree.md:42
      TL-256 in `tasklog-worktrees/tl-256`.

The sentence is a quoted OBSERVATION — where the defect was seen — and the directory really is called that on disk, which is one of the two roles AGENTS.md says the marker exists for. The guard cannot tell a path on disk from an instruction, which is why the marker is the author's declaration rather than something inferred.

The failure is not TL-396's: that branch never touched the file. It arrived with TL-415's own commit (241e048) and makes the suite red for every session that runs it, so the next agent has to decide, from scratch, whether the one failure it sees is its own.

## Steps

1. Read line 42 of backlog/tasks/TL-415-a-node-modules-symlink-is-not-ignored-so-every-worktree.md and scripts/tests/former-name.test.mjs, where the marker and its placement rules are stated.
2. Either mark that ONE line `former-name: allow` — the path is a real directory, not an instruction — or rewrite the sentence so it records the observation without the retired name.
3. Run the whole suite and confirm the count: the failure goes and nothing else moves.

## Acceptance criteria

- [ ] no open task names a retired tool, and the guard says so rather than failing [proof: the-guard-is-green]
