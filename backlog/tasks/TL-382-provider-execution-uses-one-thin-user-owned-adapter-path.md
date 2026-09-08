---
id: TL-382
title: "Provider execution uses one thin user-owned adapter path"
type: task
labels: []
board: main
epic: "Evidence-gated product focus"
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-08
updated: 2026-09-08
blocked_by: [TL-377, TL-381]
blocks: []                         # ids this task will unblock
related_docs:
  - docs/backlog-config-and-portability.md
  - README.md
verification:
  - id: adapter-boundary
    bash: "node --test scripts/tests/provider-adapter-boundary.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

Provider-neutral execution has one understandable boundary: a user-owned
executable receives the task and returns a process outcome. Local profiles may
name that executable, prompt and secret variable names, but Branchling no
longer copies, discovers, routes or updates provider adapters.

## Context

Provider choice is necessary for the replacement demonstration but is not the
product moat. Keep a small non-interactive profile store only if it materially
protects secrets and repeatability; `run --agent <command>` remains the direct
composition path. `conformance` may remain as an offline check of the stable
process contract.

Remove the guided profile interview, shipped adapter-copy workflow, update
lifecycle, named launch/fleet layer and provider-specific discovery. Examples
may show adapters, but an installed Branchling version never owns the user's
copy.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/agent-contract.mjs` and `scripts/adapter-conformance.mjs` — identify
   the smallest stable executable contract.
2. `scripts/agent-profiles.mjs` and `scripts/agent-launches.mjs` — separate
   repeatable local configuration from provider lifecycle and routing.
3. `examples/agent-adapters/` — decide whether examples remain documentation or
   should move outside the installed package.
4. `scripts/run-loop.mjs` — keep secret forwarding narrow and output redaction
   independent of the removed setup UI.

## Steps

1. Specify one stdin/environment/exit-code contract for a user-owned adapter.
2. Retain direct `--agent` execution and, if justified, minimal non-interactive
   profile create/check/list/remove commands.
3. Remove guided setup, copied reference adapters, adapter update state,
   launches/fleets and provider discovery.
4. Keep declared secret forwarding and redaction; never inherit or persist
   credential values accidentally.
5. Prove two incompatible adapters can execute the same task contract without
   changing repository data or Branchling core.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [ ] A user-owned CLI and an API-backed harness execute the same stable adapter
      contract. [proof: adapter-boundary]
- [ ] Provider, model and credential choices remain outside repository state.
      [proof: adapter-boundary]
- [ ] No shipped workflow copies, updates or registers provider adapters or
      constructs a named fleet. [proof: adapter-boundary]
- [ ] Missing executables and declared secrets fail before a task is claimed.
      [proof: adapter-boundary]
- [ ] The complete remaining suite passes. [proof: suite-green]
