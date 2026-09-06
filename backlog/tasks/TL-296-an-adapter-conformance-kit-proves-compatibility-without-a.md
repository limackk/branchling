---
id: TL-296
title: "An adapter conformance kit proves compatibility without a real provider"
type: task
labels: []
board: main
epic: "Provider-neutral agent execution"
priority: P1
status: pending  # pending | in_progress | blocked | done | cancelled
owner: ""
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-09-05
updated: 2026-09-06
blocked_by: [TL-289, TL-300]
blocks: [TL-293, TL-301]
related_docs:
  - docs/branchling-global-tool.md
  - docs/manual.md
verification:
  - id: conformance-kit
    bash: "node --test scripts/tests/agent-adapter-conformance.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

An adapter author can prove compatibility with branchling locally, without a
provider account, network access or token usage. The same executable
conformance kit validates adapters for Codex, Claude, Kimi, GLM, local models
and future providers against TL-289's public process contract.

## Context

TL-289 makes the adapter boundary provider-neutral and TL-294 checks whether a
configured profile is usable on one machine. Neither gives a third-party
adapter author a deterministic way to prove that an implementation observes
the entire contract before users entrust real tasks to it.

The kit is compatibility infrastructure, not an SDK or provider registry. It
must exercise an ordinary executable exactly as `run` will, publish stable
human and JSON results, and use fixtures whose provider name does not occur in
production source. A green result must have evidentiary force: every required
input, lifecycle transition and outcome needs a positive and negative control.

The default run must be offline and free of provider usage. A real-provider
smoke test belongs to TL-294's explicit live probe and must not be required for
conformance.

## Pre-flight reading

1. `scripts/run-loop.mjs` — exercise the same launch, input, timeout and logging
   boundary used for real work.
2. `scripts/tests/agent-adapter.test.mjs` — reuse TL-289's contract fixtures
   instead of creating a second protocol.
3. `scripts/tests/agent-check.test.mjs` — keep compatibility testing distinct
   from profile preflight and optional live probes.
4. `docs/branchling-global-tool.md` §3 — preserve extension through ordinary
   executables rather than a plugin API.

## Steps

1. Add a public command that runs the conformance suite for an adapter
   executable and reports the exact contract version under test.
2. Build a disposable repository and fake task so the adapter receives the
   same stdin, working directory and environment as a normal run.
3. Verify prompt, model, effort, actor, role, task id, repository paths and
   retry feedback, including missing and malformed input controls.
4. Exercise successful completion, task failure, adapter unavailability,
   authentication or quota refusal, cancellation and timeout using the stable
   outcome categories defined by the adapter contract.
5. Prove cancellation reaches spawned child processes and leaves no process or
   claimed-task state behind.
6. Inject sentinel credentials and prove their values cannot appear in stdout,
   stderr, JSON results or stored run logs.
7. Document the command as the compatibility gate third-party adapter authors
   run before publishing an executable.

## Acceptance criteria

- [ ] A fake adapter passes the complete contract offline in both human and
      JSON modes, with the protocol version visible in each result.
      [proof: conformance-kit]
- [ ] Negative fixtures identify the violated contract rule and return a
      stable non-zero exit without claiming or modifying a real task.
      [proof: conformance-kit]
- [ ] Success, task failure, unavailable adapter, authentication or quota
      refusal, cancellation and timeout have distinct tested outcomes.
      [proof: conformance-kit]
- [ ] Cancelling an adapter terminates its child process, and injected sentinel
      credentials are absent from every emitted or stored surface.
      [proof: conformance-kit]
- [ ] Existing adapters and raw command execution remain compatible.
      [proof: suite-green]
