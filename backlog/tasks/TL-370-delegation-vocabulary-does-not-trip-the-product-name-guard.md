---
id: TL-370
title: "Delegation vocabulary does not trip the product-name guard"
type: task
labels: []
board: main
epic: "Controlled and observable agent execution"
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 30m
confidence: medium                 # how much you trust the estimate
created: 2026-09-07
updated: 2026-09-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: product-name-green
    bash: "node scripts/cli.mjs check --product-name"
---

## Goal

The delegation vocabulary introduced for controlled execution passes the
product-name guard without weakening that guard. Generic policy values and
machine protocol markers must not be mistaken for the display name of the tool.

## Context

Found by `branchling check` during a real profile-run test on 2026-09-07. The
guard flags policy values in `agent-contract.mjs`, user-facing guidance in the
CLI and setup, and the `BRANCHLING_PROGRESS` protocol marker. The result makes
the repository-wide check red after the controlled-execution epic.

Do not broadly suppress the guard. The fix must either derive true user-facing
product text from `scripts/product.mjs` or establish narrow, documented
allowances for protocol identifiers and vocabulary that cannot be product text.

## Pre-flight reading

1. `scripts/check-product-name.mjs` — inspect the detector and its narrow
   exception mechanism.
2. `scripts/agent-contract.mjs`, `scripts/agent-profiles.mjs`, and
   `scripts/run-loop.mjs` — classify each finding as vocabulary, protocol, or
   user-facing product text.
3. Existing product-name guard tests — extend the positive and negative
   controls for the chosen treatment.

## Steps

1. Classify every current finding from `check --product-name`.
2. Correct user-facing product text through the product-name source, and use
   only narrow per-line allowances for non-text protocol or vocabulary values.
3. Add a regression test that keeps generic delegation words legal while a real
   literal product name remains forbidden.

## Acceptance criteria

- [ ] `check --product-name` is green in this repository. [proof: product-name-green]
- [ ] The guard still rejects a deliberately literal product name in a fixture.
      [proof: product-name-green]
