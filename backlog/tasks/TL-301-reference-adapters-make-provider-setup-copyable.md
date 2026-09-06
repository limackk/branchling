---
id: TL-301
title: "Reference adapters make provider setup copyable"
type: task
labels: []
board: main
epic: "Provider-neutral agent execution"
priority: P1
status: in_progress  # pending | in_progress | blocked | done | cancelled
owner: agent:codex
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-09-06
updated: 2026-09-06
blocked_by: [TL-290, TL-291, TL-292, TL-294, TL-296, TL-300]
blocks: [TL-293]
related_docs:
  - README.md
  - docs/manual.md
  - docs/branchling-global-tool.md
verification:
  - id: reference-adapters
    bash: "node --test scripts/tests/agent-reference-adapters.test.mjs"
  - id: public-surface
    bash: "node scripts/cli.mjs check --language && node scripts/cli.mjs check --product-name"
---

## Goal

A user can copy or install small reference adapters for a subscription-backed
CLI and an API-backed harness, validate them with the conformance kit and use
them from named profiles. The examples make adding another provider mechanical
without placing a provider registry or vendor branch in branchling core.

## Context

The generic adapter contract is only theoretical if every new user must design
a wrapper before the first run. TL-293 can document a five-minute setup only
after at least two materially different reference paths exist and are executed
in tests: a local CLI whose subscription owns authentication, and an API-backed
harness whose credential is named through the environment.

Reference adapters are examples of composition, not privileged providers.
Keep them outside provider-neutral core logic, pass model and effort through the
public contract, and state where users obtain current provider-specific model
names. Do not embed API keys, endorse a timeless model id or implement a raw
chat-completions call that lacks a coding-agent tool loop.

## Pre-flight reading

1. The completed TL-289 and TL-296 contracts — implement and validate exactly
   one adapter protocol.
2. The completed TL-290 API harness path — reuse a real coding harness boundary
   rather than treating a language-model response as an agent.
3. The completed TL-291 and TL-292 run modes — prove both generalist and role
   routing with the same reference definitions.
4. `package.json` — decide deliberately whether examples ship in the tarball.

## Steps

1. Add one minimal reference adapter for an authenticated coding-agent CLI and
   one for an API-backed executable harness.
2. Keep provider-specific argument translation inside each adapter and the
   common protocol in shared tests, not duplicated core branches.
3. Provide copyable profile definitions with prompt, model, effort and secret
   references represented safely.
4. Run both adapters through the offline conformance kit and isolated generalist
   and role-routing fixtures.
5. Document how a third party copies the pattern for Kimi, GLM, a local model or
   a future provider without requesting a branchling release.

## Acceptance criteria

- [ ] Two materially different reference adapters pass the public conformance
      kit without network access or real credentials. [proof: reference-adapters]
- [ ] Copyable profiles exercise prompt, model and effort through generalist and
      role-based runs. [proof: reference-adapters]
- [ ] No provider name or argument convention is added to provider-neutral core
      modules. [proof: reference-adapters]
- [ ] The public documentation explains how to add an unlisted provider and
      contains no credential or timeless recommended model id.
      [proof: public-surface]
