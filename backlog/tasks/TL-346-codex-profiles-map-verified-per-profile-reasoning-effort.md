---
id: TL-346
title: "Codex profiles map verified per-profile reasoning effort"
type: code
labels: [agents, codex]
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-09-07
updated: 2026-09-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: adapter-tests
    bash: "node --test scripts/tests/agent-reference-adapters.test.mjs scripts/tests/run-agent-profiles.test.mjs"
---

## Goal

An optional `effort` value on a Codex profile must either be translated to a
documented, per-invocation Codex setting or refused before work is claimed.
Profiles with different effort values must not depend on one global Codex
configuration that changes the behaviour of every other profile.

## Context

The provider-neutral profile contract already transports `BRANCHLING_EFFORT`.
The shipped Codex CLI adapter deliberately exits with an error when it receives
that value because it does not know a safe mapping. The profile setup therefore
stores no effort for Codex today; any global Codex configuration would make a
per-profile value misleading.

This task must not guess a Codex configuration key or supported effort values.
Establish the current Codex CLI contract first, including a positive live or
fixture-backed control for every accepted value. Keep the capability
provider-specific in the adapter; Branchling's neutral profile schema remains
unchanged. If the CLI cannot provide an invocation-scoped setting, keep refusing
effort and improve the setup explanation rather than silently applying it
globally.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `examples/agent-adapters/codex-cli.mjs` — inspect the present deliberate
   refusal and the invocation construction.
2. `scripts/agent-contract.mjs` and `scripts/run-loop.mjs` — preserve the
   provider-neutral effort environment contract.
3. `scripts/tests/agent-reference-adapters.test.mjs` — extend adapter behavior
   with positive and negative controls.
4. Current official Codex CLI documentation — verify configuration spelling,
   allowed values and invocation scope before accepting a mapping.

## Steps

1. Verify the Codex CLI's current, invocation-scoped reasoning-effort contract.
2. Define an explicit capability map in the Codex adapter; reject unsupported
   values before starting Codex.
3. Pass the verified effort only for a profile that declares it, without reading
   or changing ambient user configuration.
4. Add tests proving empty effort remains unchanged, accepted effort reaches the
   generated Codex invocation, and an unsupported value fails without launching
   a worker.
5. Update setup and README guidance to distinguish supported per-profile effort
   from unsupported provider configuration.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [ ] A supported Codex effort is invocation-scoped and can differ between two
  local Branchling profiles. [proof: adapter-tests]
- [ ] Unsupported effort is refused before task work starts; it is never
  silently delegated to global Codex configuration. [proof: adapter-tests]
- [ ] An empty Codex effort remains a valid profile and preserves Codex's own
  default. [proof: adapter-tests]
