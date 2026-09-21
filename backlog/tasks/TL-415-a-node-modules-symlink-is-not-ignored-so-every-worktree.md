---
id: TL-415
title: "A node_modules symlink is not ignored, so every worktree looks dirty"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P3
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-21
updated: 2026-09-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  # A directory and a symlink of the same name are both ignored, checked with
  # `git check-ignore` in a throwaway repository rather than against this tree.
  - id: symlink-ignored
    bash: "node --test scripts/tests/gitignore-shape.test.mjs"
---

## Goal

`git status` is clean in a worktree whose `node_modules` is a symlink into the
main checkout, instead of reporting `?? node_modules` as it does today.

## Context

`.gitignore` line 1 is `node_modules/`, with a trailing slash, which matches a
DIRECTORY and not a symlink of that name. A worktree set up by linking the main
checkout's dependencies — the cheapest way to make `node --test` runnable in a
throwaway tree — therefore carries one permanent untracked entry.

The cost is not cosmetic. Everybody reading `git status --short` before a commit
has one line of noise they must learn to ignore, and a rule learned as "ignore
the first line" stops being read at all. Observed on 2026-09-21 while closing
TL-256 in a linked worktree of this clone.

## Steps

1. Decide between `node_modules` without the slash — which matches a directory
   and a symlink alike — and an explicit second line. One line is preferable.
2. Check that no other linked path in a worktree has the same shape.

## Acceptance criteria

- [ ] `git status --short` is empty in a worktree whose `node_modules` is a
      symlink, with nothing else changed. [proof: symlink-ignored]
- [ ] The rule still ignores a real `node_modules` directory. [proof: symlink-ignored]
