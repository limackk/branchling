---
id: TL-454
title: "Public repository metadata makes branchling discoverable"
type: task
labels: []
board: main
epic: "Backlog — open source publication"
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: ""
role: review  # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-09-26
updated: 2026-10-15
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: package-metadata
    bash: "node --test scripts/tests/publish-gate.test.mjs scripts/tests/repository-metadata.test.mjs"
  - id: github-metadata
    manual: "Open the public GitHub repository while signed out and confirm its description, homepage and topics state the product purpose and lead to the canonical documentation."
---

## Goal

GitHub and npm metadata describe the actual product in searchable language, point to the canonical documentation and surface its agent workflow and evidence-gated closure rather than repeating only the project name.

## Context

On 2026-09-26 the public GitHub description was only branchling, homepage was empty and repository topics were unset. package.json is complete enough to publish, but its description and keywords emphasize a generic Markdown backlog more than the agent execution contract that distinguishes the tool. This task changes metadata only; it does not publish a release.

## Steps

1. Write one concise description shared in meaning by GitHub and package.json: Git-native task execution for people and coding agents with verification-gated closure.
2. Select focused repository topics and npm keywords covering Git, Markdown tasks, coding agents, CLI and verification without keyword stuffing.
3. Set the canonical homepage and confirm repository, bugs and license metadata resolve publicly.
4. Add an offline test for package metadata and a documented owner-reviewed checklist for the external GitHub settings.
5. Verify the public repository landing card and social preview do not rely on private or generated assets.

## Acceptance criteria

- [x] The versioned package metadata carries the canonical URLs, focused description and searchable product vocabulary. [proof: package-metadata]
- [x] A stranger can discover and understand the repository from GitHub metadata alone. [proof: github-metadata]
