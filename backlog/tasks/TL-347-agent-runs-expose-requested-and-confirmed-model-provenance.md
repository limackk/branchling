---
id: TL-347
title: "Agent runs expose requested and confirmed model provenance"
type: code
labels: [agents, observability]
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-09-07
updated: 2026-09-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: provenance-tests
    bash: "node --test scripts/tests/run-agent-profiles.test.mjs scripts/tests/session-report.test.mjs"
---

## Goal

Every agent attempt must have an auditable execution receipt: provider-neutral
profile identity, requested model and effort, adapter identity, task role and
attempt. When a provider can authoritatively report the model it actually used,
the receipt records it separately as confirmed. A reader can inspect this from
the task's execution view without putting one user's local provider choice into
the shared task frontmatter.

## Context

`run` currently passes profile name, model and effort to an adapter in its
environment, but its result JSON and per-attempt log expose only the adapter
command. The Codex adapter passes `--model`, while `profile models` correctly
reports that Codex account aliases cannot be enumerated. Its live probe only
checks that the CLI starts; it is not proof that a requested alias served a
completion.

The task file describes work that travels through Git and may be handled by
different contributors and providers. Writing `model:` into its frontmatter
would falsely turn many executions into one shared fact. Raw execution data is
already local activity data; `session-report` is designed to read model/token
fields once an adapter writes them. The design must distinguish `requested`
from `confirmed`, never label a requested value as verified, and preserve the
provider-neutral adapter boundary.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/run-loop.mjs` — identify the dispatch boundary, log construction
   and JSON run report shape.
2. `scripts/agent-contract.mjs` — version any new adapter receipt contract.
3. `scripts/activity.mjs` and `scripts/session-report.mjs` — use local activity
   data and the existing model-aware reporting path.
4. `examples/agent-adapters/codex-cli.mjs` — determine whether Codex JSON events
   contain an authoritative selected model or can only attest a request.
5. `scripts/tests/run-agent-profiles.test.mjs` and
   `scripts/tests/session-report.test.mjs` — add end-to-end positive controls.

## Steps

1. Specify a versioned adapter receipt with `requested` and optional
   `confirmed` provenance, including provider, profile, model, effort, adapter
   fingerprint, task, role and attempt.
2. Make `run` collect a receipt without allowing adapter output to forge a
   confirmed value; missing provider evidence must remain explicitly unconfirmed.
3. Persist per-attempt provenance in the existing local execution/activity
   surface and expose it through `run --json`, `session` and the task-facing
   viewer or CLI reader.
4. Have the Codex adapter record `requested` model from the actual argv and add
   `confirmed` model only if a provider-produced, documented event supports it.
5. Add retention, redaction and compatibility tests; no credential, raw prompt
   or account identifier may enter the receipt.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [ ] A `run --json` attempt identifies its profile, requested model and effort,
  role and adapter provenance. [proof: provenance-tests]
- [ ] A provider-confirmed model is visibly distinct from a requested model;
  missing confirmation is not displayed as success. [proof: provenance-tests]
- [ ] Two contributors can execute the same task with different local profiles
  without mutating shared task frontmatter. [proof: provenance-tests]
- [ ] Session and task-facing execution reports expose the local trace without
  recording credentials, raw prompts or account identifiers. [proof: provenance-tests]
