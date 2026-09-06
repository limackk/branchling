---
id: TL-314
title: "A guided profile configures a provider-neutral generalist"
type: task
labels: []
board: main
epic: "Guided agent setup"
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-09-06
updated: 2026-09-06
blocked_by: [TL-313]               # ids of tasks that MUST be closed before this one starts
blocks: [TL-315]                   # ids this task will unblock
related_docs:
  - examples/agent-adapters/README.md
  - examples/agent-adapters/claude-code.mjs
  - examples/agent-adapters/aider-api.mjs
  - README.md
verification:                      # HOW to check the task is really done
  - id: focused-tests
    bash: "node --test scripts/tests/agent-profile-setup.test.mjs scripts/tests/agent-reference-adapters.test.mjs"
  - id: profile-contract
    bash: "node --test scripts/tests/agent-profiles.test.mjs scripts/tests/agent-check.test.mjs"
---

## Goal

Make the guided path able to create one safe, usable generalist profile. A
first-time user should reach `profile check` and a no-claim dry run without
needing to understand profile fields, adapter contracts or provider flags.

## Context

The core supports every provider through a user-owned executable adapter. The
wizard must preserve that boundary: it may offer shipped reference adapters and
an arbitrary executable path, but it must not hard-code a closed provider list,
download code, infer credentials or turn a model name into product vocabulary.

The model and effort are opaque provider values. Offer an empty value and any
safe defaults derived from the selected adapter template, but accept a free
value and show exactly what will be stored. Secrets are never a question that
accepts a secret value: the only allowed input is a comma-separated list of
environment-variable names.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `examples/agent-adapters/README.md` — respect the current adapter contract
   and the distinction between subscription CLI and API harness examples.
2. `scripts/agent-profiles.mjs` and `scripts/agent-contract.mjs` — use existing
   validation and secret-delivery rules.
3. `README.md` — replace the first-run wall of flags with an optional guided
   path without removing copyable automation examples.

## Steps

1. Build the generalist branch of `profile setup`: profile name, adapter source,
   optional model and effort, local prompt, and named secret variables.
2. Offer only local, auditable adapter sources: an existing executable, or a
   versioned reference adapter shipped with this installed package and copied to
   a user-chosen location. The summary identifies its source and path. Never
   fetch adapters or execute one during setup.
3. Make the adapter selection extensible: a custom executable remains a first
   class choice, so Codex, Ollama, Kimi, GLM and a future provider need no
   Branchling release.
4. After confirmation, show one clear next action: `profile check <name>`, then
   `run --profile <name> --dry-run`. An optional live probe is described but
   never started from the wizard.
5. Cover the choices with transcript tests, including a custom adapter, a
   reference copy, arbitrary model/effort, secret-name validation and no
   accidental credential in output or on disk.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [ ] A first-time user can create and dry-run one generalist through the
  guided path without typing a raw profile command. [proof: focused-tests]
- [ ] The wizard preserves a provider-neutral custom-adapter path and does not
  download, launch or credential-test a provider. [proof: focused-tests]
- [ ] Generated profiles remain compatible with normal validation and secret
  preflight. [proof: profile-contract]
