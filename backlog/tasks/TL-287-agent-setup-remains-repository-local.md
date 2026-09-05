---
id: TL-287
title: "Agent setup remains repository-local"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:codex
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 30m
confidence: medium                 # how much you trust the estimate
created: 2026-09-05
updated: 2026-09-05
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: shared-local-setup
    bash: "test \"$(cat CLAUDE.md)\" = '@AGENTS.md' && test -f .agents/skills/backlog-workflow/SKILL.md && test -L .claude/skills/backlog-workflow && test -L .claude/skills/branchling-cli && test -L .claude/skills/branchling-release && test -L .claude/skills/branchling-viewer"
  - id: product-unchanged
    bash: "git diff --exit-code f731262^ -- README.md CONTRIBUTING.md backlog/config.yaml backlog/plan.yaml scripts ':(exclude)scripts/install-skills.mjs' ':(exclude)scripts/tests/skills-install.test.mjs' ':(exclude)scripts/tests/context-budget.test.mjs'"
---

## Goal

Keep the Claude and Codex setup local to this repository. The shared instruction
and skill sources remain, while branchling's user-facing behavior and public
documentation stay as they were before TL-274. Only the packaged skill's source
path follows its move into the canonical directory.

## Context

TL-274 correctly consolidated `AGENTS.md`, `CLAUDE.md`, `.agents/skills`,
`.claude/skills` and the two hook adapters, but it also changed the reusable
branchling implementation. The owner said that this setup belongs only to
the `tasklog` repository. Preserve the repository-local files and reverse the
product-facing changes in a new commit; do not rewrite the completed commit.

## Pre-flight reading

1. Commit `f731262` — distinguish repository setup from product changes.
2. `AGENTS.md` — preserve the canonical repository instructions.
3. `.agents/skills/` — preserve the canonical repository skills.

## Steps

1. Restore product code, tests, package behavior and public documentation to
   their state before TL-274.
2. Keep `AGENTS.md`, the minimal `CLAUDE.md`, canonical `.agents/skills`, Claude
   symlinks and host-specific hook adapters.
3. Verify both the kept local structure and the absence of product drift.

## Acceptance criteria

- [x] Claude and Codex read the same repository instructions and skills without
      duplicate skill files. [proof: shared-local-setup]
- [x] TL-274 leaves no user-facing change in the branchling CLI, installer or
      public documentation; only the packaged skill source path follows its
      canonical file. [proof: product-unchanged]
