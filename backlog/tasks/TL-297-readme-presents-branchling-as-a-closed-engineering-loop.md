---
id: TL-297
title: "README presents branchling as a closed engineering loop"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:codex
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-09-05
updated: 2026-09-05
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs:
  - README.md
  - docs/manual.md
  - docs/branchling-global-tool.md
verification:
  - id: public-docs
    bash: "node --test scripts/tests/docs-links.test.mjs scripts/tests/docs-drift.test.mjs scripts/tests/public-language.test.mjs scripts/tests/publish-gate.test.mjs"
  - id: guarantees
    bash: "node --test scripts/tests/next-claim.test.mjs scripts/tests/verification-gate.test.mjs scripts/tests/plan-order.test.mjs scripts/tests/run-follows-handoff.test.mjs scripts/tests/history.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

The public documentation presents branchling as the closed engineering loop it
already implements: plan, claim, execute, capture discoveries, verify and
merge. A new reader can distinguish that durable, provider-neutral control
plane from the session-local subagents and worktrees supplied by an agent
harness.

## Context

The README currently leads with three real strengths: the queue, verification
contract and ledger. It then describes `run`, roles, plans, human-only work and
the morning-after view, but it does not connect them into the feedback loop
that makes the system valuable. In particular, a separate topic found during
work becomes a new self-contained task instead of disappearing in a session or
inflating the current task.

Do not position subagents, models or worktree creation as unique. Current agent
harnesses already provide those execution mechanisms. The distinction is that
branchling keeps project truth in Git, makes readiness executable, assigns one
ready task atomically, requires evidence before closure, and preserves the
reasoning when a session or provider changes.

Document only behavior already present and tested. Named agent profiles, the
provider adapter contract and managed worker fleets remain pending work and
must not be presented as released functionality. Avoid the unverifiable claim
that branchling produces better software; name the failure modes its rules
prevent instead.

## Pre-flight reading

1. `README.md` — preserve the five-minute path while sharpening the first-screen
   explanation and removing statements that conflict with the current `run`
   behavior.
2. `docs/manual.md` — ensure the detailed workflow uses the same conceptual
   model without duplicating the README.
3. `docs/branchling-global-tool.md` — keep the four architectural laws and the
   composition boundary intact.
4. `scripts/tests/next-claim.test.mjs`, `verification-gate.test.mjs`,
   `plan-order.test.mjs`, `run-follows-handoff.test.mjs` and `history.test.mjs`
   — tie every prominent guarantee to behavior the suite proves.

## Steps

1. Rewrite the README opening around a compact closed-loop explanation, with
   the one-agent path first and the same rules scaling to role-based hands.
2. Explain how a discovery becomes a self-contained future task rather than an
   aside or an expansion of the task in progress.
3. Contrast the durable project control plane with provider-owned agent
   execution without attacking or depending on a named vendor.
4. Audit later README sections and the manual for contradictions, especially
   around whether `run` launches the user's command.
5. Keep claims concrete: atomic claim, dependency readiness, verification-gated
   closure, Git-travelling state, recorded reasons and bounded context cost.
6. Run the publication gate and the full suite before committing the public
   documentation.

## Acceptance criteria

- [x] The README's first screen names the closed loop and the specific failure
      prevented at each transition, before introducing fleet configuration.
      [proof: public-docs]
- [x] The simple one-agent workflow remains the first runnable path, and the
      role-based path is presented as the same contract at larger scale.
      [proof: public-docs]
- [x] Discoveries, dependency waves, atomic claims, verification and recorded
      reasons are described only where existing tests prove their behavior.
      [proof: guarantees]
- [x] No released documentation promises named profiles, provider adapters or
      managed parallel workers before their tasks are complete.
      [proof: public-docs]
- [x] The public text remains English, internally linked and safe to publish.
      [proof: suite-green]
