---
id: TL-298
title: "The language guard does not single out one foreign language"
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
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: language-guard-removed
    bash: "! rg -n 'check-public-language|language-guard|--language' scripts bin README.md docs AGENTS.md package.json"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
  - id: guards-green
    bash: "node scripts/cli.mjs check"
---

## Goal

The repository no longer presents a Polish-specific heuristic as a language
guard. The English-only repository convention remains a review rule, not an
automated claim that treats one foreign language differently from every other
one.

## Context

TL-243 removed the generated project-word snapshot because it rejected ordinary
new English. What remains in `check-public-language.mjs` searches specifically
for Polish diacritics, Polish words and Polish-looking word shapes. It neither
recognises English nor detects foreign language generally.

The project may require English prose, but a Polish-only detector is an
arbitrary proxy for that policy and its green output can be mistaken for
evidence covering languages it never examines. Remove the detector rather than
expanding it into language identification or adding more language-specific
blocklists. Review, contributors and ordinary spellchecking are separate
concerns and are not introduced by this task.

## Pre-flight reading

1. `scripts/check-public-language.mjs` — the detector and the claims its output
   currently makes.
2. `scripts/cli.mjs` — the `check` guard table and public selector.
3. `scripts/tests/public-language.test.mjs` and
   `scripts/tests/language-guard-reach.test.mjs` — the contracts that exist only
   for the detector.
4. `AGENTS.md` — the repository policy currently describes this guard as one of
   its enforcement mechanisms.

## Steps

1. Remove the detector, its `check --language` registration and its dedicated
   tests.
2. Remove `language-guard: allow` markers and remaining current documentation
   that instructs contributors to use the removed mechanism.
3. Preserve the English-only convention as prose and state that it is not
   automatically identified.
4. Verify that no public CLI surface or source reference remains and that the
   complete suite and remaining guards pass.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [x] No language guard, selector, exception marker or implementation reference
  remains in the current product surface. [proof: language-guard-removed]
- [x] The complete test suite passes without the language-guard tests.
  [proof: suite-green]
- [x] Every remaining repository guard passes. [proof: guards-green]
