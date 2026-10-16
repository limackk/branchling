---
id: TL-474
title: "A fresh repository's Claude Code session finds the backlog pointer"
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
created: 2026-10-16
updated: 2026-10-16
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: fresh-repo-claude
    bash: "node --test scripts/tests/init-agent-pointer.test.mjs"
---

## Goal

A Claude Code session opened in a repository that `branchling init` set up from nothing learns that a backlog is there and which command to run, without the user writing anything.

## Context

Observed on 2026-10-16 in a fresh `git init` repository: `ensureNudge()` in `scripts/instructions.mjs` appends to whichever of `AGENT_FILES` (CLAUDE.md, AGENTS.md) exists, and when neither exists it creates only AGENTS.md. Claude Code loads CLAUDE.md, not AGENTS.md, so in that repository the pointer is invisible to it. The packaged skill would compensate, but it is installed only with `init --skills`, which is opt-in. The default `init` therefore leaves a Claude Code session with no path to `branchling instructions overview`. When CLAUDE.md already exists the pointer is appended there correctly; only the from-nothing case is broken. The fix is a design decision (for example a CLAUDE.md that imports AGENTS.md, or the skill by default); the rule that an existing agent file is appended to and never rewritten stays.

## Steps

1. Decide how the from-nothing case reaches both editor-neutral agents and Claude Code without writing the pointer twice
2. Implement it in ensureNudge or init, keeping the versioned marker block as the only written text
3. Add a test that runs init in an empty git repository and asserts what Claude Code would load names `instructions overview`

## Acceptance criteria

- [ ] init in an empty git repository leaves a pointer that Claude Code loads, and an existing CLAUDE.md or AGENTS.md is still only appended to [proof: fresh-repo-claude]
