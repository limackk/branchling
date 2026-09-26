---
id: TL-448
title: "The viewer has an explicit snapshot and live-editing contract"
type: task
labels: []
board: main
epic: "Backlog viewer"
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-09-26
updated: 2026-09-26
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: viewer-contract
    bash: "node --test scripts/tests/viewer-mode-contract.test.mjs scripts/tests/docs-terminal-surface.test.mjs"
  - id: release-gates
    bash: "node scripts/cli.mjs check"
---

## Goal

The product has one durable viewer contract: a generated snapshot is read-only and portable, while the loopback-served page is live and may edit through the server. README, the manual, terminal output, the viewer skill and implementation all describe the same boundary.

## Context

On 2026-09-26 the owner deliberately reversed the product direction established by TL-379 and cleaned up by TL-442. Manual editing and a richer dashboard are wanted again. The old implementation was removed because it created a second write path without a strong actor, validation or server-lifecycle boundary. This task records the replacement decision before code is restored. It does not authorize remote hosting or multi-machine collaboration: the server stays on 127.0.0.1, the Markdown task remains authoritative, and a mailed viewer.html remains read-only.

## Steps

1. Rewrite the viewer contract in docs/viewer-redesign-brief.md and docs/manual.md, naming snapshot and live modes separately.
2. Update README.md, the viewer skill and serve startup text so none promises behavior another surface denies.
3. Define which actions belong in the live viewer, which remain CLI-only, and how actor identity, reasons, validation, history and rebuilds travel with every write.
4. Add a semantic contract test that fails when public documentation, terminal messages and exposed routes disagree about whether editing exists.
5. Keep the loopback-only, self-contained HTML, generated palette, URL-state and zero-dependency constraints explicit.

## Acceptance criteria

- [ ] Snapshot and live modes, public documentation and terminal messages state one consistent editing contract. [proof: viewer-contract]
- [ ] The revised public contract passes every publication guard. [proof: release-gates]
