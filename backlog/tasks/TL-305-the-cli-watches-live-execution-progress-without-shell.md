---
id: TL-305
title: "The CLI watches live execution progress without shell helpers"
type: task
labels: []
board: main
epic: "Execution observability"
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 4h
confidence: medium                 # how much you trust the estimate
created: 2026-09-06
updated: 2026-09-06
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs:
  - README.md
verification:
  - id: watch-cli
    bash: "node --test scripts/tests/watch.test.mjs"
  - id: command-contract
    bash: "node --test scripts/tests/cli.test.mjs scripts/tests/json-envelope.test.mjs"
---

## Goal

`branchling watch` gives a live terminal view of execution without requiring
macOS users to install `watch` through Homebrew or write a shell loop. It makes
the current wave, in-progress tasks, owners, recent changes and waiting work
visible while an agent is working.

## Context

Today a user must repeatedly invoke `query --status in_progress` and `plan`, or
wrap them in a platform-specific shell loop. The viewer is useful but requires
a browser. The CLI needs a small read-only monitoring command that stays inside
the same task-file and history truth as every other view. It must not create a
second state file, claim work, or require a TTY for one-shot JSON output.

## Pre-flight reading

1. `scripts/cli.mjs` — add help and command routing consistently.
2. `scripts/plan.mjs` and `scripts/query.mjs` — reuse live selection logic,
   rather than read generated views.
3. `scripts/ui.mjs` — preserve terminal and no-colour conventions.
4. `scripts/tests/cli.test.mjs` — preserve the closed command and JSON contract.

## Steps

1. Define `watch` flags for interval, one-shot mode, filters and JSON.
2. Render a compact refreshable terminal frame from live task files and plan
   state, including active tasks and work waiting on another role or owner.
3. Make non-TTY/JSON output one-shot and machine-readable; never loop forever
   inside automation.
4. Handle Ctrl-C cleanly and state the refresh cadence in plain output.
5. Add deterministic tests with a fake clock or injected refresh function.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [ ] `branchling watch` shows the active wave and live in-progress task owners
      without a shell helper or generated-view staleness. [proof: watch-cli]
- [ ] Interval, one-shot and JSON modes are explicit, testable and safe for
      automation. [proof: watch-cli]
- [ ] The command is documented in `--help` and respects the shared CLI/JSON
      contracts. [proof: command-contract]
