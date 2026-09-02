---
id: TL-137
title: "Translate the last two Polish directories: tasks and docs"
type: task
labels: []
board: main
epic: "Backlog — publikacja open source"
priority: P1                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
estimate: 1w                       # 30m | 2h | 1d | 1w | 1mo
created: 2026-09-01
updated: 2026-09-02
blocked_by: []
blocks: []
related_docs: []
verification:                      # HOW to check that the task is really done
  - id: guard-covers-tasks
    bash: "node scripts/cli.mjs check --language"
  - id: tree-green
    bash: "node scripts/cli.mjs check && node scripts/cli.mjs doctor"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

No file in this repository is written in Polish, and `worktrail check
--language` says so instead of a convention nobody can check.

## Context

CLAUDE.md now states one rule with no directory-shaped exception: everything in
this repository is English, the git surface included. On 2026-09-01 that rule
was applied to everything small enough to finish in one pass — `CLAUDE.md`
itself, `LINEAGE.md`, `backlog/config.yaml`, `backlog/plan.yaml`,
`backlog/boards.yaml`, `backlog/_template.md`, both `.gitignore` files and
`.gitattributes`.

Two directories were too large to translate in passing, and they are what this
task is for:

| area | files | Polish characters | lines |
|---|---|---|---|
| `backlog/tasks/` | 137 | 20420 | 13420 |
| `docs/` | 8 | 3600 | 1512 |

**Why the boundary moved at all.** It used to be drawn around what ships in the
npm tarball, which put `docs/` and `backlog/` outside it. It is now drawn around
what a stranger reads when they OPEN the repository, and the backlog clears that
bar more strongly than the code does: `LINEAGE.md` states outright that the
tasks ARE this tool's development history, because the git history was flattened
at extraction.

**Why this is a migration and not a tidy-up.** A task's title feeds its filename
through `slugify()` (`scripts/new-task.mjs:56`). Translating a title therefore
renames a file, and a rename touches the file itself, the id-to-name agreement
`doctor` checks, and every prose reference that spells the path rather than the
bare id. `worktrail renumber` solved the same class for numbers — plan first,
write second, report what was skipped — but it keys on the ID, and the ID is
exactly the part that does NOT change here.

**Deliberately out of scope, and not an oversight:** `backlog/history/*.jsonl`
(92 files, 333 Polish characters, all in `reason` fields). The log is
append-only. A reason written by a person is their sentence, not a field a later
pass may correct — the same argument that stops `renumber` from rewriting it.
The Polish characters left in `scripts/` are the transliteration table and test
fixtures, each already marked `language-guard: allow`.

**Two decisions this task has to make, not assume.**

1. **Do filenames follow the translated titles at all?** Keeping the old slug
   costs nothing and breaks nothing — the ID is what the tool reads. It only
   looks wrong to a person browsing `tasks/`. Renaming is the more honest option
   and the more expensive one.
2. **How far does `check --language` grow?** Today it reads `scripts/`, `bin/`,
   `README.md` and `_template.md` (`scripts/check-public-language.mjs`). It has
   to end up covering `backlog/` and `docs/`, but it cannot be switched on until
   the last file is done — which is why the guard is the LAST step here, not the
   first.

**What must NOT happen.** Translating opportunistically while doing other work.
Half a backlog in each language is worse than all of it in one: a reader cannot
tell whether a Polish task is old or simply missed, and the guard stays off the
whole time. CLAUDE.md states this as a rule.

**Closed tasks are in scope.** 69 of the 137 are archived, and they are exactly
what `LINEAGE.md` points at as the reasoning that survived the flattening.
Skipping them would translate the part with the least evidence in it.

## Decisions

**1. Filenames do NOT follow the translated titles.** Every existing slug in
`backlog/tasks/` and `docs/` stays exactly as it is; only the prose inside each
file changes. Reasons:

- The tool reads the ID, never the filename — `next`, `take`, `blocked_by`,
  `blocks` and every cross-reference between tasks already address each other
  by `TL-<number>`. A slug is a filename, not a fact `worktrail` depends on.
- The Context section above already prices the alternative correctly: a rename
  touches the file itself, the id-to-name agreement `doctor` checks, and every
  prose reference that spells the path rather than the bare id — for 145 files
  at once, on top of a translation pass that already touches all 145. Bundling
  two migrations that fail for different reasons make the one failure mode
  harder to isolate from the other.
- The cost of NOT renaming is exactly what the Context section says it is: a
  slug that looks wrong to a person browsing the directory. That is cosmetic —
  the rule this task enforces is about the language of what a stranger READS,
  and a stranger reads the title and body on the page, not the URL segment.
- Keeping the slug is reversible on its own schedule: a rename is a narrowly
  scoped follow-up (mechanical, one concern, easy to verify with `doctor`)
  that does not have to ride on a content migration to happen. It is filed
  separately rather than folded in here, per CLAUDE.md's own rule that a
  surfaced topic outside the current thesis becomes a new task, not scope
  creep on this one.

**2. `check --language` grows by two entries in `PUBLIC_PATHS`: `backlog` and
`docs`.** Not `backlog/tasks` alone — the whole `backlog` directory, which also
picks up `backlog/config.yaml`, `backlog/plan.yaml`, `backlog/boards.yaml` and
`backlog/_template.md`. Those four were already translated by hand on
2026-09-01 (see Context) but were never brought under the guard that would keep
them that way; adding the directory rather than the one subdirectory closes
that gap as a side effect, for free, without widening scope — a regression in
any of them is exactly the kind of drift this guard exists to catch. This is
safe for `backlog/history/*.jsonl`, which the rule everywhere else in this
project holds untouched: the walk that feeds the guard already reads only
`.mjs`, `.js` and `.md` files (`check-public-language.mjs`'s `walk()`), so a
`.jsonl` file is invisible to it independent of which directory is listed —
the append-only log is protected by file extension, not by a special case
carved out of the guard's path list.

## Steps

1. Settle the two decisions above and write them down here before touching a
   file. Done — see Decisions.
2. If filenames follow: build the rename plan as DATA first, the way `renumber`
   does, and refuse the whole run on any collision.
3. Translate `docs/` first — 8 files, and every task body points into it, so its
   terminology sets the vocabulary for the rest.
4. Translate `backlog/tasks/`, archived ones included. Terminology comes from
   the tool's own English surface: `status`, `blocked_by`, `verification` are
   already English and must not be re-invented.
5. Only after the last file: extend `check --language` to cover `backlog/` and
   `docs/`, with a positive control — a fixture carrying a Polish task that the
   guard MUST report. A guard that passes on an empty sample is green with no
   evidentiary force.
6. Update CLAUDE.md: drop the paragraph saying Polish tasks and docs stay until
   translated, and move both directories into the guarded list.

## Acceptance criteria

- [x] The two decisions are written in this file, with reasons. [proof: guard-covers-tasks]
- [x] No file under `backlog/tasks/` or `docs/` contains Polish, archived tasks included. [proof: guard-covers-tasks]
- [x] `check --language` reads `backlog/` and `docs/` and fails on a Polish file. [proof: guard-covers-tasks]
- [x] The guard has a positive control that must report a planted Polish fixture. [proof: suite-green]
- [x] `backlog/history/*.jsonl` is untouched — the log stayed append-only. [proof: tree-green]
- [x] `check` and `doctor` green, and every id-to-filename pair still agrees. [proof: tree-green]
- [x] The full suite is green. [proof: suite-green]
