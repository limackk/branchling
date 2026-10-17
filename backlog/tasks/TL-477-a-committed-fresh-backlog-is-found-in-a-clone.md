---
id: TL-477
title: "A committed fresh backlog is found in a clone"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-10-17
updated: 2026-10-17
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: clone-finds-backlog
    bash: "node --test scripts/tests/init-survives-clone.test.mjs"
---

## Goal

A backlog that `branchling init` created and that was committed as-is is found by every command in a fresh clone of that repository.

## Context

Observed on 2026-10-17 initialising a separate project repository with `init --dir backlog --skills --no-example`: init creates tasks/, archive/, history/ and boards/ empty, git does not track empty directories, so the commit carried only config.yaml, boards.yaml, _template.md and the dotfiles. In a fresh clone `looksLikeBacklogDir()` (scripts/paths.mjs) requires a tasks/ subdirectory, finds none, and `doctor` answers `no backlog here`; `new` cannot create the first task either. The workaround applied in that repository was a committed `.gitkeep` in tasks/ and history/. Whether the fix is init writing placeholders or detection accepting config.yaml without tasks/ is a decision for this task; either way a test must clone (or copy only the git-tracked files of) a freshly initialised backlog and run a command there.

## Steps

1. Decide between placeholders written by init and detection that does not require tasks/
2. Implement it so a committed-as-is backlog survives a clone
3. Add a test that reproduces the clone from git-tracked files only and runs doctor and new there

## Acceptance criteria

- [ ] a freshly initialised backlog, committed and cloned, is found by doctor and accepts its first task from new [proof: clone-finds-backlog]
