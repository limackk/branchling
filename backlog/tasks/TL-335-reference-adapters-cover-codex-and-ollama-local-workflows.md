---
id: TL-335
title: "Reference adapters cover Codex and Ollama local workflows"
type: task
labels: []
board: main
epic: "Provider-neutral agent execution" # free text — the group this task counts towards
priority: P1                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:codex
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1d                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-07
updated: 2026-09-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: [backlog/tasks/TL-382-provider-execution-uses-one-thin-user-owned-adapter-path.md, scripts/agent-profiles.mjs, scripts/tests/provider-adapter-boundary.test.mjs]
verification:                      # HOW to check the task is really done
  - id: reference-adapter-contract
    bash: "node --test scripts/tests/agent-reference-adapters.test.mjs scripts/tests/agent-profile-setup.test.mjs"
  - id: offline-conformance
    bash: "node --test scripts/tests/agent-adapter-conformance.test.mjs"
---

## Goal

Ship copyable Codex CLI and Ollama reference adapters so a new contributor can
choose either path in guided setup without writing a provider wrapper first.

## Context

The guided setup lists only reference adapters that are versioned in
`examples/agent-adapters/`; today that leaves Codex and Ollama absent despite
their provider-neutral execution support. A reference adapter is not a provider
registry or a promise about every provider flag: it is a transparent, local
example of the stable Branchling process contract. It must not contact a
provider during conformance or profile checks, embed credentials, or turn task
input into shell syntax.

Codex is the subscription-backed CLI path. Ollama is the local-model path and
must state that a pulled local model is required. Both references should pass
through `BRANCHLING_MODEL` and `BRANCHLING_EFFORT` only where their installed
CLI supports those settings; an unsupported value must produce an actionable
adapter error rather than silently changing execution semantics.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `examples/agent-adapters/claude-code.mjs` — reference process lifecycle,
   offline conformance branch and safe child-process invocation.
2. `examples/agent-adapters/aider-api.mjs` — API-harness contrast and model/
   effort forwarding conventions.
3. `scripts/agent-contract.mjs` — environment and stdin contract that every
   adapter receives.
4. `scripts/tests/agent-reference-adapters.test.mjs` — fixture strategy proving
   adapters without installed providers, credentials or network access.
5. `examples/agent-adapters/README.md` — public instructions and security
   boundary that must remain provider-neutral.

## Steps

1. Add `codex-cli.mjs` and `ollama.mjs` under `examples/agent-adapters/`, each
   with the same offline conformance protocol as the existing references.
2. Probe only the corresponding executable (`codex` or `ollama`) when
   `BRANCHLING_PROFILE_PROBE=1`; never make a model request in that path.
3. Read task input from stdin and invoke the child with `spawn`/`spawnSync` and
   `shell: false`; preserve child stdout, stderr and exit status without
   interpolating task input into a shell command.
4. Set Codex and Ollama model semantics explicitly in comments and docs. For
   Ollama, make an absent model a clear preflight/configuration failure rather
   than guessing a local default. Do not claim a provider flag until it has been
   checked against that provider's current CLI documentation or installed help.
5. Extend `referenceAdapterTemplates()` so guided setup exposes the four shipped
   references with accurate labels and hints.
6. Extend offline fixture tests for both adapters, then document copy, local
   model preparation, `conformance`, `profile check` and a dry-run launch.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [x] Guided setup offers separate, accurately labelled Codex CLI and Ollama
  references beside the existing references. [proof: reference-adapter-contract]
- [x] Both new references pass every offline conformance scenario without a
  provider executable, credential or network access. [proof: offline-conformance]
- [x] Each adapter reads untrusted task input only through stdin and invokes no
  shell; its probe checks availability only. [proof: reference-adapter-contract]
- [x] Public instructions state how to copy each adapter, which local executable
  and model preparation it requires, and how to prove it before real work.
  [proof: reference-adapter-contract]
