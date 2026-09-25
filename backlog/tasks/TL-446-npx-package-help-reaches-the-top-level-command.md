---
id: TL-446
title: "npx package help reaches the top-level command"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1h
confidence: medium                 # how much you trust the estimate
created: 2026-09-25
updated: 2026-09-25
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: npx-help-top-level
    bash: "node --test scripts/tests/npx-first-contact.test.mjs"
---

## Goal

The documented first-contact invocation `npx --yes <path-to-repo> -- --help` prints the top-level branchling help, so a stranger sees the command table instead of being dropped into the default `serve` command's help.

## Context

Surfaced while running the publication gate for TL-444 on 2026-09-25. From a directory outside the repository, `npx --yes <path-to-repo> -- --help` exited 0 but printed `serve — run the viewer...` and the serve-only usage. The publication skill names this exact invocation as the first-five-minutes check. The package invocation without the separator may behave differently, but the documented form is the contract to reproduce. Keep this separate from TL-444: it concerns the CLI shim/global separator boundary, not decision retrieval. Pre-flight: read `bin/branchling.mjs` to trace installed argument forwarding, `scripts/cli.mjs` to understand the global separator and help resolution, and `.agents/skills/branchling-release/SKILL.md` to preserve the exact command that exposed the defect.

## Steps

1. Add a deterministic package-entry regression that runs the documented npx-style argument shape and distinguishes top-level help from serve help.
2. Correct argument normalization at the narrowest boundary without changing `--` semantics inside command arguments.
3. Keep direct `branchling --help`, command help, and separator regression tests green.

## Acceptance criteria

- [ ] The documented npx first-contact invocation reaches top-level help while existing separator behavior remains explicit. [proof: npx-help-top-level]
