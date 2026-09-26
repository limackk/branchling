---
id: TL-453
title: "The README is a short public front door with no placeholders"
type: task
labels: []
board: main
epic: "Backlog — open source publication"
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-09-26
updated: 2026-09-26
blocked_by: [TL-102]               # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: front-door
    bash: "node --test scripts/tests/readme-front-door.test.mjs scripts/tests/docs-links.test.mjs scripts/tests/publish-gate.test.mjs"
  - id: release-gates
    bash: "node scripts/cli.mjs check"
---

## Goal

A stranger can decide in thirty seconds whether branchling fits their workflow and reach a first successful command in five minutes, while detailed reference material remains in the manual rather than expanding the README back into a thousand-line command catalogue.

## Context

TL-153 previously reduced the README below 400 lines, but it has regressed to 1033 lines. The current clone instructions still contain the literal placeholder <repository-url>. TL-297 established the correct thesis: plan, claim, execute, capture discoveries, verify and review. TL-102 already owns the sixty-second recording, so this task links that artifact when available rather than duplicating it. Named competitor comparisons remain deliberately excluded because they drift with somebody else releases.

## Steps

1. Keep the first screen to the product thesis, the evidence-gated loop, one concrete differentiator and the tested demo.
2. Replace every repository placeholder with the canonical public URL.
3. Present one installation path, one five-minute path and one compact end-to-end example before any advanced feature.
4. Move command reference, adapters, profiles, import, configuration and format details to docs/manual.md or to commands that already print them.
5. Add a regression test for length, placeholders, the canonical URL and the presence of the first-success path.
6. Keep category-level comparisons and explicit non-goals, but do not name competitors.

## Acceptance criteria

- [ ] README stays compact, contains no repository placeholder and leads to a runnable first success with valid links. [proof: front-door]
- [ ] The shortened public documentation remains safe to publish. [proof: release-gates]
