---
id: TL-313
title: "Interactive profile setup preserves the scriptable contract"
type: task
labels: []
board: main
epic: "Guided agent setup"
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-09-06
updated: 2026-09-06
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs:
  - scripts/agent-profiles.mjs
  - scripts/cli.mjs
  - docs/backlog-config-and-portability.md
verification:                      # HOW to check the task is really done
  - id: focused-tests
    bash: "node --test scripts/tests/agent-profile-setup.test.mjs"
  - id: contract-tests
    bash: "node --test scripts/tests/agent-profiles.test.mjs scripts/tests/json-envelope.test.mjs"
---

## Goal

Provide the terminal interaction foundation for `branchling profile setup`.
It must make profile configuration discoverable without replacing the existing
flag-based API that scripts, CI and MCP clients rely on. A session that exits or
is interrupted must leave the local profile store unchanged.

## Context

The provider-neutral execution epic deliberately made `profile create` fully
non-interactive: a profile is local user data and an adapter is an executable,
not a provider record. It is correct but asks a new user to assemble several
flags before they can see a safe dry run. This task adds a guided surface over
that contract; it must not add a second profile schema or provider registry.

Do not name the command `create subagent`. It creates configuration, not a
running process or an autonomous agent. `profile setup` is honest, discoverable
beside `profile create`, and can say "Create an agent profile" in its text.

The existing `profile create`, `update`, `list`, `show`, `check` and `remove`
commands remain the non-interactive automation surface. `--json` is never an
interactive transcript.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/agent-profiles.mjs` — reuse its parser, validation and write path;
   identify a narrow exported operation rather than duplicating them.
2. `scripts/cli.mjs` — add a truthful command entry, help and exit behaviour.
3. `scripts/ui.mjs` and `scripts/done-task.mjs` — follow the repository's TTY
   and confirmation conventions.
4. `scripts/tests/agent-profiles.test.mjs` — retain proof that the flag API is
   non-interactive and machine-local.

## Steps

1. Define the interaction transcript as a small injectable input/output
   boundary, with pure validation/state transitions where possible. Tests must
   not need a real terminal.
2. Add `branchling profile setup` with a short explanation, numbered choices,
   defaults shown before accepting them, Back/Cancel at every decision point,
   and one final exact summary before any write.
3. Refuse the command when stdin or stdout is not a TTY, and refuse `--json` or
   unsupported flags rather than emitting a half-readable prompt into a pipe.
4. Route confirmed values through the same profile creation/validation operation
   as `profile create`; write once after validation, never field by field.
5. Add focused transcript tests for validation, back/cancel, a non-TTY refusal,
   write atomicity and help. Keep the existing flag-command tests green.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [ ] `profile setup` is a documented interactive command and existing profile
  commands retain their non-interactive, flag-based contract. [proof: contract-tests]
- [ ] Invalid input, cancellation, EOF and a non-TTY invocation leave
  `agent-profiles.yaml` byte-for-byte unchanged. [proof: focused-tests]
- [ ] A confirmed transcript produces a profile accepted by the existing parser,
  rather than a wizard-only data shape. [proof: focused-tests]
