---
id: TL-392
title: "The Claude Code session surface ships with the repository"
type: task
labels: []
board: main
epic: "Agent harness"
priority: P2
status: done
owner: agent:claude
role: ""
executor: ""
estimate: 2h
confidence: medium
created: 2026-09-21
updated: 2026-09-21
blocked_by: []
blocks: []
related_docs: []
verification:
  - id: commands-are-thin
    bash: "node --test scripts/tests/agent-hooks.test.mjs"
---

## Goal

The three moments this repository's own rules define — pick up work, prove it,
land it — are one invocation each in a session, and the allowlist stops asking
about the commands every one of them runs.

## Context

`.claude/` carries a settings file and four skill symlinks and nothing else.
Two things follow.

First, the rituals in `AGENTS.md` that the tool deliberately does NOT do in one
step are retyped from memory every time. Landing a task is four commands in a
fixed order — merge with `--ff-only`, rebuild the views because they are
computed and therefore stale after a merge, remove the worktree, and never
push — and the cost of forgetting the third one is documented in `AGENTS.md`:
on 2026-09-01 `next` handed TL-74 to a second session two minutes after it was
closed on an unmerged branch.

Second, every `node scripts/cli.mjs …` and every read-only `git` call stops for
approval, which is friction with no safety bought: these are the repository's
own tools reading its own data.

WHAT THESE COMMANDS MUST NOT BE. The packaged `backlog-workflow` skill states
its own reason for holding no procedure and no vocabulary: it points at
`branchling instructions`, which is rendered from THIS project's `config.yaml`,
because "a skill that listed statuses would be a second truth about them, wrong
the moment you renamed one". A slash command that spelled out the workflow would
be that second truth with an extra step. So each command calls the tool and lets
the tool speak; what a command may contain is the ORDER of invocations, which is
the one thing the tool does not know.

WHAT STAYS OUT OF THE ALLOWLIST, and why it is a decision. `git push` is listed
in `AGENTS.md` as needing an explicit request — pre-approving it would delete
that rule silently. `git worktree remove` and `branchling done` both destroy or
close something on a judgement call. `git commit` is allowed: `AGENTS.md` grants
that permission in advance and says so twice.

NOT DONE HERE, deliberately: no `.mcp.json`. This repository ships an MCP server
(`branchling mcp`) for agents that have no shell, and registering it in the repo
that owns the CLI would load a duplicate of every command's schema into every
session — a standing context cost, against the tool's own "ask, do not read"
rule, to reach commands that are already one `node scripts/cli.mjs` away.

## Pre-flight reading

1. `AGENTS.md`, sections "A commit for every finished task" and "After the
   commit: merge into `main` and close the worktree" — the two orders the `land`
   command encodes, including why the view rebuild is not optional.
2. `.agents/skills/backlog-workflow/SKILL.md` — the precedent for how thin an
   instruction file in this repository is allowed to be.
3. `node scripts/cli.mjs skills --help` — the same argument, in the tool's words.

## Steps

1. Add `.claude/commands/` with one file per moment: pick up, prove, land.
   Each names the commands to run and their order, and nothing about statuses,
   priorities, boards or any other value that lives in `config.yaml`.
2. Add a `permissions.allow` list to `.claude/settings.json` covering the
   repository's own read and build commands, and leave the destructive and
   publishing ones off it.
3. Extend the hook guard from TL-391 to also read `.claude/commands/*.md` and
   fail if one of them hard-codes a vocabulary value instead of asking the tool.

## Acceptance criteria

- [x] No file under `.claude/commands/` contains a status, priority or board
      value copied out of `config.yaml`. [proof: commands-are-thin]
- [x] `git push`, `git worktree remove` and `branchling done` are absent from
      `permissions.allow`. [proof: commands-are-thin]
