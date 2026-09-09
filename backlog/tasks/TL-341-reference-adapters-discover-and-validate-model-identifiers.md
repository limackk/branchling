---
id: TL-341
title: "Reference adapters discover and validate model identifiers honestly"
type: task
labels: []
board: main
epic: "Provider-neutral agent execution"
priority: P1                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:codex
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-09-07
updated: 2026-09-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: [scripts/agent-contract.mjs, scripts/agent-profiles.mjs, scripts/tests/agent-adapter-conformance.test.mjs, backlog/tasks/TL-382-provider-execution-uses-one-thin-user-owned-adapter-path.md] # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: catalog-contract
    bash: "node --test scripts/tests/agent-model-catalog.test.mjs scripts/tests/agent-adapter-conformance.test.mjs"
---

## Goal

Users can discover a model identifier through an adapter when its provider can
answer honestly, and Branchling reports the limits of validation instead of
accepting a guessed string as verified.

## Context

Model availability is provider- and account-specific. Ollama can list models
pulled on this machine (`ollama list`) and an exact selected name can be checked
locally. Codex CLI exposes no stable machine-readable catalogue of aliases, so
blank must mean its configured default and an override may be passed through but
not claimed valid before execution. API adapters may discover models only with
an explicit network/authenticated operation. Setup currently promises not to
start an adapter or contact a provider, so discovery must be opt-in and outside
its passive default path.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/agent-contract.mjs` — versioned adapter environment and output
   boundary.
2. `scripts/agent-profiles.mjs` — profile setup and validation presentation.
3. `examples/agent-adapters/ollama.mjs` — local provider with a truthful model
   inventory.
4. `examples/agent-adapters/codex-cli.mjs` — provider whose aliases cannot be
   truthfully enumerated by the CLI.

## Steps

1. Specify an optional adapter model-catalog operation with explicit outcomes
   for listed, unavailable and not-verifiable models.
2. Add an opt-in profile command and reference-adapter implementations; it must
   never expose credentials in output.
3. Offer a selected Ollama model from its local catalogue during setup only when
   the user explicitly asks to discover models.
4. Keep empty Codex model as an explained use of the provider default and report
   that an override is passed through, not pre-validated.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [x] A local Ollama catalogue lists only locally installed model names and an
  absent requested name fails before a run. [proof: catalog-contract]
- [x] A provider that cannot list account-specific aliases reports that limit;
  Branchling never labels an arbitrary override as verified. [proof: catalog-contract]
- [x] Catalog discovery is an explicit opt-in and no credential value appears
  in its human or JSON output. [proof: catalog-contract]
