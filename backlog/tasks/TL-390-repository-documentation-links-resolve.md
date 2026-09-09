---
id: TL-390
title: "Repository documentation links resolve"
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
created: 2026-09-09
updated: 2026-09-09
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs:
  - README.md
  - docs/manual.md
  - scripts/check-docs-links.mjs
  - scripts/tests/docs-links.test.mjs
verification:                      # HOW to check the task is really done
  - id: links
    bash: "node --test scripts/tests/docs-links.test.mjs"
  - id: suite
    bash: "node --test scripts/tests/*.test.mjs"
  - id: guards
    bash: "node scripts/cli.mjs check"
---

## Goal

Repository documentation must not send a reader to a missing file, an invalid
anchor, or an unavailable project-local resource. A repeatable check must cover
Markdown links so a fixed reference does not regress.

## Context

The request concerns dead links, but guessing from a text search is unreliable:
some URL-like values are examples and some relative links intentionally point
outside the repository. Inspect the current documentation surface and add a
focused local-link test rather than introducing a network-dependent link crawler.
External URLs remain outside the test because their availability is mutable and
not a property this repository can reproduce deterministically.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `README.md` — inspect the primary reader-facing links and their conventions.
2. `docs/manual.md` — inspect links to commands, documents and anchors.
3. `scripts/tests/` — reuse the repository's test and fixture conventions.

## Steps

1. Enumerate Markdown links in reader-facing repository documents and separate
   local references from external URLs and illustrative text.
2. Repair confirmed broken local references and anchors.
3. Add a deterministic test that validates local Markdown targets and anchors.
4. Run the focused test, the complete suite and repository guards.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [x] Every checked repository-local Markdown target exists and every checked
  fragment resolves to a heading in its target document. [proof: links]
- [x] The link check has positive controls for a missing target and a missing
  fragment, so an empty or ineffective scan cannot pass. [proof: links]
- [x] The full automated suite remains green. [proof: suite]
- [x] Repository consistency checks remain green. [proof: guards]
