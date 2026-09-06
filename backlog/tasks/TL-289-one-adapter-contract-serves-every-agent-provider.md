---
id: TL-289
title: "One adapter contract serves every agent provider"
type: task
labels: []
board: main
epic: "Provider-neutral agent execution"
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:codex
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-09-05
updated: 2026-09-06
blocked_by: [TL-288]
blocks: [TL-290, TL-291, TL-292, TL-294, TL-296, TL-300]
related_docs:
  - docs/branchling-global-tool.md
verification:
  - id: adapter-contract
    bash: "node --test scripts/tests/agent-adapter.test.mjs scripts/tests/run.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

Every named profile launches through one documented process contract that does
not know provider names. A user can connect any CLI or API-backed agent harness
without changing branchling, while Codex and Claude remain easy examples rather
than privileged cases in the implementation.

## Context

The current loop already gives a command the task and retry feedback on stdin,
runs it from the repository root, exports actor, role, task and backlog paths,
and judges the result by output, tree changes and the verification contract.
Preserve those semantics.

The missing part is a stable boundary for profile data. The adapter must receive
the prompt, model and effort without branchling translating vendor-specific
flags. A small environment-and-stdin protocol keeps extension through
composition: a shell wrapper, installed CLI, local model runner or remote API
harness can all implement it. Do not add provider conditionals or a plugin API.

Avoid passing structured values through a shell command assembled from profile
data. Profiles are user-controlled, but argument arrays and an explicit
executable produce clearer errors and remove accidental quoting behavior.

## Pre-flight reading

1. `scripts/run-loop.mjs` — preserve stdin, cwd, environment, timeout, logging
   and verification behavior.
2. `scripts/tests/run.test.mjs` — retain the existing raw-command contract and
   its positive controls.
3. `docs/branchling-global-tool.md` §3 — keep extension through composition.
4. `backlog/tasks/TL-288-named-agent-profiles-belong-to-the-user-layer.md` — use
   the profile shape chosen there.

## Steps

1. Specify and record the adapter inputs, environment, lifecycle and exit
   behavior, including retry feedback and cancellation.
2. Launch profile adapters as an executable plus arguments rather than a
   provider-specific branch in the loop.
3. Expose profile name, prompt, model, effort, actor, role, task id, backlog
   directory and repository root through stable documented inputs.
4. Preserve raw `--agent` and `--agent-for` command strings as the compatibility
   path.
5. Prove extensibility with a fake provider whose name is absent from production
   source and whose adapter still completes a task.

## Acceptance criteria

- [x] One stable contract carries prompt, model and effort without knowing how
      a provider spells its CLI or API options. [proof: adapter-contract]
- [x] A fixture provider not named in production code can edit a task and pass
      its verification through the normal loop. [proof: adapter-contract]
- [x] Timeouts, retries, logs and raw command invocations behave as before.
      [proof: suite-green]
