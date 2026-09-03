---
id: TL-77
title: "Shell completions with values from config.yaml vocabularies"
type: code
labels: [post-launch]
board: main
epic: "CLI surface"
priority: P3
status: pending
owner: unassigned
executor: ""
estimate: 4h
confidence: medium
created: 2026-08-31
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs: []
verification:
  - bash: "node --test scripts/tests/completions.test.mjs"
  - manual: "In a fresh zsh shell after installation: `worktrail query --status <TAB>` suggests statuses from this backlog's config.yaml, not literals from the code"
---

## Goal

`worktrail completion install` sets up completion in bash/zsh/fish, and the
suggested values come from the vocabularies in the `config.yaml` of the
backlog being read.

## Context

Today the user has to REMEMBER that statuses are
`pending/in_progress/blocked/done/cancelled` — values that belong to their
project, not to the tool. Since an unknown value fails anyway (Law III), the
whole completion feature is already computable: the vocabularies are closed
and live in the config. Completions are essentially reading what we
validate against anyway.

Backlog.md has this for four shells, with dynamic completion of task IDs on
`edit <TAB>`.

Decided: values ALWAYS from the config of the backlog resolved by
`resolveBacklogDir()`, never from literals hardcoded into the completion
script. A static script with baked-in statuses diverges from the project at
the first config change and teaches values that fail.

Open: we are letting go of PowerShell until someone asks for it — we do not
have an environment to test it, and an untested completion script is worse
than none at all.

## Pre-flight reading

1. `scripts/cli.mjs` — the table of commands and flags; the list has to be
   generated from it, not from a second, manually maintained copy.
2. `scripts/config.mjs` — reading the project's vocabularies.
3. `scripts/paths.mjs` — `resolveBacklogDir()`; completion has to work in
   whatever directory the user is currently standing in.

## Steps

1. `worktrail completion <shell>` — prints the script to stdout.
2. `worktrail completion install [--shell <s>]` — detects the shell and
   installs; states EXACTLY which file it changed.
3. The completion script calls back into `worktrail` for dynamic values
   (task IDs, statuses, priorities, boards, labels, owners) — no literals.
4. The list of commands and flags is generated from the table in `cli.mjs`,
   not duplicated.
5. `scripts/tests/completions.test.mjs` — the generated script contains
   every command from the `cli.mjs` table (the test fails after a command
   is added without a refresh) and offers statuses from a fixture config
   that is deliberately NOT the default one.

## Acceptance criteria

- [ ] `completion` supports bash, zsh and fish.
- [ ] Dynamic values come from the `config.yaml` of the resolved backlog.
- [ ] The list of commands and flags is generated from the definitions in
      `cli.mjs`.
- [ ] `install` names the file it changes and does not overwrite it
      silently.
- [ ] A test ties the script to the command table, so a new command fails
      without a refresh.

## Log

2026-08-31 pending — agent:claude — created from an analysis of Backlog.md
(github.com/MrLesk/Backlog.md), point 6.
2026-09-01 pending — agent:claude — lowered P2→P3 from a competitive
analysis — like TL-76: parity waits behind the differentiator.
