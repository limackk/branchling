---
id: TL-445
title: "Commit bodies preserve intended paragraph breaks"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:codex-subagent
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-09-25
updated: 2026-09-26
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: commit-paragraphs
    bash: "node --test scripts/tests/commit-message-shape.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

Commit messages written through shell-facing workflows preserve intended paragraph breaks, so repository history never records literal backslash-n escape sequences in place of formatting.

## Context

While closing TL-413, commit da14e71 was created with a body argument containing escaped paragraph separators; the shell preserved them as literal \n\n text. Repository history is immutable, so that commit must not be amended. The missing protection is prospective: identify the commit construction path used by agents, add a guard or safe helper that can fail on this shape before a commit is written, and document the supported invocation without introducing a second commit-message policy.

## Steps

1. Read AGENTS.md commit-shape rules and the existing hook/guard tests that inspect git metadata.
2. Add a failing control that constructs or inspects a commit body containing literal backslash-n paragraph separators and proves the guard detects it.
3. Implement one repository-owned protection or safe commit path that preserves real paragraph breaks while keeping ordinary commit bodies valid.
4. Run the focused guard and the full repository suite.

## Acceptance criteria

- [x] A commit body with literal backslash-n paragraph separators is rejected, while a body containing real paragraph breaks passes. [proof: commit-paragraphs]
- [x] The prospective commit-message protection preserves every existing repository contract. [proof: suite-green]
