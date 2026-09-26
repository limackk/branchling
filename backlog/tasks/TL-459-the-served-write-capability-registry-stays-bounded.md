---
id: TL-459
title: "The served write capability registry stays bounded"
type: task
labels: []
board: main
epic: "Backlog viewer"
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:codex
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 4h
confidence: medium                 # how much you trust the estimate
created: 2026-09-26
updated: 2026-09-26
blocked_by: [TL-449]               # ids of tasks that MUST be closed before this one starts
blocks: [TL-450]                   # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: bounded-capabilities
    bash: "node --test scripts/tests/viewer-write-api.test.mjs"
---

## Goal

Repeated page loads cannot grow the live viewer's capability registry without a
fixed bound, while a current served page retains a usable short-lived token.

## Context

TL-449 creates one token for every unauthenticated `GET /` and retains every
unexpired token in a `Map` for fifteen minutes. A foreign page cannot read a
token, but it can issue opaque requests to a guessed loopback port and cause
issuance. Sustained requests therefore grow live memory for the whole TTL. The
boundary needs a fixed cardinality, not only expiry-based cleanup.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/serve-backlog.mjs` — `newCapability()` and the live token map.
2. `scripts/tests/viewer-write-api.test.mjs` — real server request helpers and capability tests.

## Steps

1. Rotate one current capability or enforce a small explicit maximum with deterministic pruning.
2. Keep expiry, same-origin enforcement and stale-token refusal intact.
3. Add a request-flood positive control that observes the bound rather than merely reading source.

## Acceptance criteria

- [x] Capability issuance remains bounded under repeated page requests and current/stale tokens retain their intended behavior. [proof: bounded-capabilities]
