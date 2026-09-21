---
id: TL-44
title: "Renumbering to our own prefix — and the BL that survived in the code"
type: task
labels: []
board: main
epic: "Backlog — open source publication"
priority: P2
status: done
owner: claude
estimate: 4h
confidence: high
created: 2026-08-31
updated: 2026-08-31
blocked_by: []
blocks: []
related_docs:
  - docs/backlog-config-and-portability.md
verification:
  - bash: "node --test scripts/tests/*.test.mjs"
  - bash: "node scripts/cli.mjs check && node scripts/cli.mjs build"
---

## Goal

This backlog numbers itself with its own prefix (`TL-`), not the prefix of the
project the tool came out of. The `BL-1448` collision — one number, two
different tasks in two different repositories — stops existing, because the
shared number space stops existing.

## Context

TL-42 turned the prefix into configuration and delivered `migrate-prefix`, but
**deliberately deferred the renumbering step**: the dry run showed 215
mentions in PROSE that the migration does not touch, because `BL-1445` in the
body text might point to a task in the other repository. This task carries
out the renumbering together with a review of the prose.

**The numbers stay, only the prefix changes** (`BL-1449` → `TL-39`). This is
not aesthetics: commit messages are immutable and contain the old numbers, so
keeping the number means the old history can still be resolved mechanically.
Renumbering from 1 would sever that link for no gain at all.

## Steps

1. `migrate-prefix --to TL` — file names, `id:`, `blocked_by`/`blocks`, history
   logs and `task_id_prefix` in the configuration.
2. Prose: split mentions into those that UNAMBIGUOUSLY point at this backlog,
   those that point at the consumer, and those that need to be read.
3. Fix what the renumbering EXPOSED in the code.
4. Consumer: rewire `worktrail#BL-NNNN` references to `worktrail#TL-NNNN`.

## Acceptance criteria

- [x] `check` and `build` green, full suite 263/263.
- [x] Prose mentions resolved down to the last one; mentions of consumer tasks
      STAY as `BL-`, and the prefix alone now tells them apart.
- [x] Exposed code defects fixed, not worked around in the test.
- [x] Guards judge the backlog THEY WERE GIVEN, not the one from cwd.

## Notes

- The class of thing this confirms: **changing the value is the only proof
  that the value truly came out of the code.** TL-42 passed green with four
  live hardcoded `BL`s, because the only backlog anything ran against had the
  `BL` prefix. A test on the configuration ≠ a test on a different value.

## Log

- 2026-08-31 done — claude — renumbered 43 tasks / 85 files; 287 prose mentions rewritten automatically after sorting into buckets (42 numbers unambiguously our own), 5 left deliberately (all in TL-42, where the sentence DESCRIBES the `BL-1448` collision and rewriting it would have made it false), 2 fixed by hand. Mentions of consumer tasks (BL-1445, BL-1446, BL-1170…) stay — after the prefix change the notation itself now says they are foreign.

- 2026-08-31 THE RENUMBERING EXPOSED FOUR LIVE DEFECTS — claude — which TL-42 could not have seen, because until yesterday every backlog at hand had the `BL` prefix: (1) `query.mjs` sorted by `Number(id.replace(/^BL-/,""))`, so `--sort id` gave 0 for every task and arranged the list in an order nobody asked for; (2) the viewer, reading the directory through the File System Access API, filtered on `^BL-\d+.*\.md$` — under a different prefix it loaded ZERO tasks; (3) and (4) two number-based sorts in the viewer and on the dashboard, the same mistake. All silent: none of them throws an error, each just returns "nothing" or "zero".

- 2026-08-31 second class, more serious — claude — the guards `check-backlog-id-collisions` and `check-backlog-boards` took the DIRECTORY from an argument, but the PREFIX from configuration found by walking up from cwd. The tree pointed at was therefore judged by another backlog's vocabulary: zero matched files and "✓ 0 tasks, each used once", exit 0. **Green with zero evidentiary force.** Invisible in a single repository, because cwd and the target are always the same tree there. The root now comes from what the guard was given (`backlogForTaskPath` moved to `paths.mjs`), and when the configuration is silent, the prefix is inferred from the OBSERVED file names, not from a default value.

- 2026-08-31 DELIBERATELY UNTOUCHED — claude — 75 GENERIC mentions (`BL-NNN` as a placeholder, "BL number", "BL number collisions") in the README, `docs/`, and task content. These are not references to any task, just document vocabulary — and cleaning documents of the origin project's context is the content of TL-37. Separated deliberately: this task was to change IDENTIFIERS, not rewrite prose along the way. The count is here so TL-37 starts from a measurement, not from zero.

- 2026-08-31 in_progress — claude — 15 tests failed right after the migration. Four were tests pinning the `BL` literal where a contract was meant (fixed by taking the prefix from configuration), the rest were a SIGNAL from production code. Telling one from the other, file by file, was the real content of this task.
</content>
