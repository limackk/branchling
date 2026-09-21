---
id: TL-208
title: "The viewer's snapshot banner says Tryb snapshot"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-03
updated: 2026-09-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  # REWRITTEN 2026-09-21, because the original block carried BOTH known defects.
  # `language-control` named `branchling check --language`, a selector TL-298
  # removed together with the detector itself — a criterion nobody could ever
  # meet, and the flag class of the defect TL-424 names for test files. And
  # `check` alone passes against an unchanged tree (TL-260): it says the backlog
  # is consistent, never that the viewer says anything in particular. The proof
  # is now a test file that EXISTS, over a fixed enumeration of the viewer's
  # chrome, with its own positive controls. It is deliberately not a rebuilt
  # language detector: AGENTS.md rules that out, and the removed one is exactly
  # what read this banner as English.
  - id: chrome-verbatim
    bash: "node --test scripts/tests/viewer-ui-language.test.mjs"
  - id: suite
    bash: "node --test scripts/tests/*.test.mjs"
  - id: guards-green
    bash: "node scripts/cli.mjs check"
---

## Goal

`branchling check --language` fails on `scripts/build-viewer.mjs:2937`, and the
banner over a snapshot page reads in English.

## Context

Found on 2026-09-03 while looking at the decision panel in a rendered page
(TL-205). The banner across the top of a `file://` viewer says:

    scripts/build-viewer.mjs:2937
    # language-guard: allow — the shipped label IS the sample
    status.textContent = "Tryb snapshot";

It is the first line a non-technical reader sees on a page that was mailed to
them, and it is in Polish. The English is "Snapshot" — the sentence beside it
already explains what a snapshot is ("Data from the moment of the build").

**The guard passed over it, and that is the larger half of this task.**
`check --language` reads `scripts/` and reported 100593 lines clean while this
line sat in the middle of them. The word carries no diacritics and its shape
apparently matches nothing in the guard's word lists, so a two-word Polish
string in the most-read surface in the repository is invisible to the check
written to find exactly that. Fixing the string without extending the guard
leaves the next one just as invisible.

## Pre-flight reading

1. `scripts/build-viewer.mjs:2937` and the banner around it — what the two
   states of that element say.
2. `scripts/check-language.mjs` (whatever `check --language` is implemented in)
   — the word lists and shape rules, and why `tryb` matches none of them.
3. `CLAUDE.md`, the language section — the three things the guard enforces, and
   the `language-guard: allow` marker for a deliberate exception.

## Steps

1. Translate the string.
2. Extend the guard so it would have caught this one, and prove it with a
   positive control: a fixture line the guard must reject.
3. Re-run `check --language` over the tree and read what else the widened
   guard now finds — a widened word list is likely to hit test data and quoted
   transcripts, each of which is either a real find or a marked exception.

## Acceptance criteria

- [x] The banner and the header tabs carry the reviewed English wording, and
      the built page is asserted to contain each one verbatim.
      [proof: chrome-verbatim]
- [x] A banner translated out of English IS rejected, and the same string
      sitting in a task title does not satisfy the assertion.
      [proof: chrome-verbatim]
- [x] Nothing else in the suite or in the release gates moved.
      [proof: suite, guards-green]
