---
id: TL-361
title: "Reference adapters declare and honor delegation control"
type: code
labels: []
board: main
epic: "Controlled and observable agent execution"
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-09-07
updated: 2026-09-07
blocked_by: [TL-355]               # ids of tasks that MUST be closed before this one starts
blocks: [TL-362]                   # ids this task will unblock
related_docs: [examples/agent-adapters/README.md, examples/agent-adapters/codex-cli.mjs, scripts/agent-adapter-conformance.mjs]
verification:                      # HOW to check the task is really done
  - id: adapter-delegation
    bash: "node --test scripts/tests/agent-adapter-conformance.test.mjs scripts/tests/agent-adapters.test.mjs scripts/tests/run-agent-profiles.test.mjs"
---

## Goal

Reference adapters translate the provider-neutral delegation policy into the
strongest control their harness supports and honestly declare whether it was
enforced, requested through instructions, or unsupported.

## Context

Provider capabilities differ. An API may expose an explicit multi-agent flag,
a subscription CLI may accept only instructions, and another harness may offer
no control. Branchling core must not know these details. The adapter contract
from TL-355 carries the requested policy; each wrapper maps it and reports the
strength of enforcement. Start with the shipped Codex, Claude, Ollama and API
examples, but design conformance so Kimi, GLM and third-party wrappers can
implement the same declaration later.

## Pre-flight reading

1. `examples/agent-adapters/README.md` — keep the copy-and-modify extension path
   understandable without provider registration.
2. `examples/agent-adapters/codex-cli.mjs` and `claude-code.mjs` — map policy at
   the wrapper boundary.
3. `scripts/agent-adapter-conformance.mjs` — verify declarations offline and
   prevent adapters from claiming a stronger guarantee than they implement.

## Steps

1. Extend conformance with delegation-policy scenarios and a capability result.
2. Implement policy mapping in every shipped reference adapter.
3. Fail closed when managed delegation is requested but cannot be controlled,
   unless the outer run carries its explicit override.
4. Document how a new provider reports exact control, instruction-only control
   or no control.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [ ] Every shipped adapter declares delegation control through the common
      contract and passes offline conformance. [proof: adapter-delegation]
- [ ] Codex and Claude mappings do not leak provider conditionals into core.
      [proof: adapter-delegation]
- [ ] Ollama and API examples have an explicit truthful result even when they
      have no internal subagent feature. [proof: adapter-delegation]
- [ ] A false enforcement claim is rejected by the conformance positive
      control. [proof: adapter-delegation]
