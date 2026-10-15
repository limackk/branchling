---
id: TL-461
title: "The commit-msg hook positive control runs without an installed binary"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-10-15
updated: 2026-10-15
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: [TL-455]                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: hook-control
    bash: "env PATH=/usr/bin:/bin \"$(command -v node)\" --test scripts/tests/commit-message-shape.test.mjs"
  - id: suite
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

`POSITIVE CONTROL: the installed commit-msg hook blocks a literal separator`
(`scripts/tests/commit-message-shape.test.mjs:69`) passes on a machine where no
`branchling` binary is on `PATH`, as on every CI runner.

## Context

GitHub Actions run 38738911603 (commit f11b5b6, 2026-10-15) failed on all seven
matrix jobs, and this test failed on every one of them with
`.git/hooks/pre-commit: 5: branchling: not found`. It passes locally only
because the owner's machine has a global install under
`~/.nvm/.../bin/branchling`, which hides the dependency.

The test runs `hooks install`, which writes BOTH a `pre-commit` and a
`commit-msg` hook, then rewrites only the commit-msg hook's `branchling ...`
lines to `process.execPath + CLI`. The untouched pre-commit hook still calls
the bare name, so `git commit` dies in pre-commit before the commit-msg hook
can be measured — the assertion on the separator message then fails on the
wrong output. The same test also fails inside
`suite-is-terminal-independent.test.mjs` under forced colour, which is the
same cause, not a second one.

## Pre-flight reading

1. `scripts/tests/commit-message-shape.test.mjs` — the fixture's rewrite.
2. The hook templates written by `branchling hooks install`.

## Steps

1. Rewrite every installed hook in the fixture, not only commit-msg, or install
   with an explicit binary path if the tool already offers one.
2. Prove it with `PATH` stripped of any global install.

## Acceptance criteria

- [x] The hook control passes with no `branchling` on `PATH`. [proof: hook-control]
- [x] The whole suite stays green. [proof: suite]
