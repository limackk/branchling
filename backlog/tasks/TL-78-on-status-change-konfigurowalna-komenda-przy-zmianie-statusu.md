---
id: TL-78
title: "on_status_change — configurable command on status change"
type: code
labels: [post-launch]
board: main
epic: "Configurability"
priority: P3
status: pending
owner: unassigned
estimate: 3h
confidence: medium
created: 2026-08-31
updated: 2026-08-31
blocked_by: []
blocks: []
related_docs:
  - docs/backlog-config-and-portability.md
verification:
  - bash: "node --test scripts/tests/on-status-change.test.mjs"
---

## Goal

A task's status change can trigger a command from configuration, with the ID,
title, and the old and new status in the environment. A generalization of
`regen-hook` from one hardcoded case into a trigger the user configures
themselves.

## Context

`worktrail regen-hook` handles ONE scenario: the editor saved a task, rebuild
the views. The input exists, the mechanism exists, all that is missing is
letting the user attach their own reaction (a notification, a CI entry, `git
commit`) without patching our code. This is Law IV — extensibility through
composition — applied to the writing side.

Backlog.md has `onStatusChange` with `$TASK_ID`, `$OLD_STATUS`, `$NEW_STATUS`,
`$TASK_TITLE`, and a per-task override in the frontmatter.

Decisions:

1. **Layer.** The key belongs to the USER layer or the project layer — decide
   and justify it in the task. A versioned shell command that runs for anyone
   who clones the repo is arbitrary code execution on `worktrail build`. Lean
   toward the user layer and explicit consent.
2. **A failing command must not swallow the task write.** The status is
   written, the hook failed — the tool says so loudly and exits with code
   !=0, but does not undo the write.
3. **A per-task override** (as they have) — consider only once the layer is
   settled; a frontmatter key is the same trust question.

## Pre-flight reading

1. `scripts/regen-hook.mjs` — the existing hook entry point and its stdin
   contract.
2. `scripts/config.mjs` — configuration layers and what each is responsible
   for.
3. `docs/backlog-config-and-portability.md` — decisions already made about
   configuration portability; do not second-guess them in passing.

## Steps

1. Decide the key's layer and record the justification (security, not taste).
2. Detect a status change on write and run the command with environment
   variables.
3. A nonzero exit code from the hook is reported and propagated; the task
   write stays.
4. Document it in the README, along with a warning about running someone
   else's command.
5. `scripts/tests/on-status-change.test.mjs` — the hook receives the right
   variables; a failing hook does not undo the write; no key means no
   invocation.

## Acceptance criteria

- [ ] A status change runs a command with the ID, title, old and new status.
- [ ] The key's layer is settled and justified on security grounds.
- [ ] A failing hook is loud and does not undo the written status.
- [ ] With no key configured, nothing runs.

## Log

2026-08-31 pending — agent:claude — created from analysis of Backlog.md (github.com/MrLesk/Backlog.md), point 7.
