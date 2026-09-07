---
id: TL-343
title: "Fleet setup selects intended roles before profile routing"
type: task
labels: []
board: main
epic: "CLI onboarding"              # free text — the group this task counts towards
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:codex
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-09-07
updated: 2026-09-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: [scripts/agent-profiles.mjs, scripts/agent-launches.mjs, scripts/tests/agent-profile-setup.test.mjs, node_modules/@clack/prompts/README.md] # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: fleet-role-selection
    bash: "node --test scripts/tests/agent-profile-setup.test.mjs scripts/tests/agent-launches.test.mjs"
---

## Goal

Fleet setup asks for a profile for every repository role, including roles the
person never intends to automate. The interview selects the intended roles in
one multiple-choice step, then asks for a profile only for those roles. Work
outside the selected roles retains a visible general-agent fallback.

## Context

After creating `codex-general`, the current onboarding asks whether to configure
a specialist fleet and then serially asks about `docs`, `spec`, `dev`, `review`,
and unroled work. This makes the repository vocabulary look mandatory and
leaves the default routing unassigned. A fleet is an override map, not a pledge
to serve every configured role.

Use Clack's built-in `multiselect` for an interactive terminal: arrow keys move,
Space toggles, and Enter continues. Keep a documented plain-text equivalent for
the terminal-independent conversation tests and any future non-Clack UI; a
comma-separated list of displayed role numbers is sufficient. Do not invent a
second role vocabulary or store selection state outside the launch's existing
`profile_for` mapping.

The first general profile is the natural default fallback when the optional
fleet invitation follows its creation. A standalone fleet setup must make the
fallback choice explicit and must not silently select a profile when more than
one is available.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/agent-profiles.mjs` — terminal-independent setup state machine and
   Clack boundary.
2. `scripts/agent-launches.mjs` — persisted general fallback and role override
   format.
3. `scripts/tests/agent-profile-setup.test.mjs` — transcript contract, shared
   write boundary, and cancellation controls.
4. `scripts/tests/agent-launches.test.mjs` — launch resolution contract.
5. `node_modules/@clack/prompts/README.md` — supported multiselect behavior;
   reuse the installed dependency rather than adding a terminal library.

## Steps

1. Add one role-set selection primitive at the interactive boundary, backed by
   Clack multiselect and a deterministic typed fallback.
2. Change fleet setup to select roles before routing and prompt for profiles
   only for the selected roles.
3. Pass the newly created general profile as a visible default fallback when
   the first-profile onboarding offers fleet setup; preserve an explicit choice
   for standalone fleet setup.
4. State that unselected roles use the general fallback in the summary and
   cancel without writing either profile or launch data.
5. Extend tests for a partial role set, different profiles for selected roles,
   default fallback, typed fallback, cancellation, and normal launch resolution.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [x] A fleet setup with four configured roles can select only `dev` and
  `review`, and the interview asks for no other role mappings. [proof: fleet-role-selection]
- [x] The fleet summary and persisted launch make the general fallback and the
  selected role overrides unambiguous. [proof: fleet-role-selection]
- [x] The interactive selector uses arrow keys, Space and Enter; the
  terminal-independent path accepts a documented numeric multiple selection.
  [proof: fleet-role-selection]
- [x] Cancelled or invalid selections write no launch, and existing launch
  resolution still routes selected roles correctly. [proof: fleet-role-selection]
