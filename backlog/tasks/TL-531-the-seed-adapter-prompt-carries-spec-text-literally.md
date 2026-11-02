---
id: TL-531
title: "The seed adapter prompt carries spec text literally"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-02
updated: 2026-11-02
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: prompt-literal
    bash: "node --test scripts/tests/seed-adapter-prompt-literal.test.mjs"
---

## Goal

The seed adapter prompt carries the spec text and the rejection reasons byte for byte, whatever characters they contain.

## Context

Found while closing TL-527, which made `new` insert caller text through replacer functions. `renderPrompt()` in scripts/seed-adapter.mjs fills its prompt template with `body.replace(/\{\{spec\}\}/g, String(spec))` and `.replace(/\{\{errors\}\}/g, complaints)`: both are replacement STRINGS, so a dollar sign followed by an apostrophe, a backtick, an ampersand, a digit or a second dollar sign in the spec document (a shell command in a design document carries exactly these) or in a rejection message is expanded by JavaScript instead of being copied. The model then receives a prompt with template text spliced into the spec, or a spec with a dollar sign silently dropped, and nothing reports it. This is a different writer from `new` (it builds a prompt, not a task file), which is why TL-527 did not cover it.

## Steps

1. Write a failing test: renderPrompt with each JavaScript replacement token in the spec and in an error returns the spec and the error literally
2. Replace both replacement strings in renderPrompt with replacer functions

## Acceptance criteria

- [ ] The spec and the rejection reasons reach the adapter prompt literally, replacement tokens included. [proof: prompt-literal]
