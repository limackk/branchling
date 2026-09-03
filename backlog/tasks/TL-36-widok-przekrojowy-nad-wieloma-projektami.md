---
id: TL-36
title: "Cross-project view over multiple projects"
type: code
labels: [post-launch]
board: main
epic: "Backlog — open source publication"
priority: P3
status: done
owner: agent:claude
estimate: 1d
confidence: low
created: 2026-08-30
updated: 2026-09-03
blocked_by: [TL-34]
blocks: []
related_docs:
  - docs/worktrail-global-tool.md
verification:
  # `scripts/…`, not `backlog/scripts/…`: written before the extraction, when
  # code and data were co-located. The second entry no longer goes through a
  # PIPE either — `query --json` truncates above one pipe buffer (TL-175), which
  # would have failed this contract for a reason that is not this task's.
  - id: cross-project-fixtures
    bash: "node --test scripts/tests/cross-project.test.mjs"
  - id: every-row-names-its-project
    bash: "node scripts/cli.mjs query --all-projects --status in_progress --json > /tmp/worktrail-tl36.json && node -e \"const d=require('fs').readFileSync('/tmp/worktrail-tl36.json','utf8');const r=JSON.parse(d);if(!r.tasks.every(t=>t.project))throw new Error('a row with no project name');if(!Array.isArray(r.unavailable))throw new Error('the pass does not report what it could not reach');console.log('rows:',r.tasks.length,'unavailable:',r.unavailable.length)\""
  - id: registry-is-not-a-dependency
    bash: "WORKTRAIL_HOME=$(mktemp -d) node scripts/cli.mjs query --count --dir backlog"
  - id: measurement-recorded
    bash: "grep -q '| 5 | 865 |' backlog/tasks/TL-36-widok-przekrojowy-nad-wieloma-projektami.md"
---

## Goal

One answer to the question **"what am I working on across all projects"** —
impossible today, because no place knows there is ever more than one project.

## Context

This is the only step in the global-tool project that **gives the user
something new**; TL-33/1440/1441 clear things that block publication out of
the way. That is why it comes last, not first.

**It explicitly has an uncertain audience** ([worktrail-global-tool.md §11](../../docs/worktrail-global-tool.md) item 1): today there is only one
project. If, a quarter after TL-34, the registry still has a single entry,
this task **should not be created** — rather than built "just in case". The
estimate entered here assumes the condition has been met.

The constraint that shapes everything else: **this is a view, not a second
source of truth.** The cross-project pass reads N backlog directories and
assembles the result in memory. It assumes no storage of its own, does not
copy tasks, does not cache them into a file that needs invalidating. Deleting
the registry only takes away this view (Law 2).

Performance is a real question, not a hypothetical one: this backlog has 1389
tasks, and `query.mjs` reads `tasks/*.md` on every invocation. With five
projects of this size that is ~7000 files per command. The task is to
**measure** the cross-project pass's time and only then decide, based on the
number, whether an index is needed — not to build a cache preemptively.

## Pre-flight reading

1. `docs/architecture/worktrail-global-tool.md` — §3 Laws 2 and 4, §7 (the
   registry as an index), §11 items 1–2.
2. `backlog/scripts/query.mjs` — the filter contract, `--json`, `--count`,
   `--files`; an unknown flag FAILS.
3. `backlog/scripts/build-backlog.mjs` — how single-project views are built
   today.
4. `backlog/scripts/registry.mjs` (TL-34) — revalidating entries.

## Steps

1. `--all-projects` in `query.mjs` — iterate over the registry, every result
   carries a `project` field. **Without this field the cross-project pass is
   useless**: "BL-12 in_progress" means nothing when three projects have a
   BL-12.
2. ID collisions: BL numbers are unique **within a project**, not globally.
   The identity in the cross-project pass is the pair `(project, id)` and it
   is to be printed that way.
3. A project from the registry whose path does not exist, or does not pass
   `looksLikeBacklogDir()`, is **listed as unavailable**, and the
   cross-project pass continues. A silent skip would turn "you moved the
   repo" into "this project has no tasks".
4. A partial failure is **visible in the result**, including in `--json`
   (the `unavailable` field), not only on stderr — otherwise a script
   consuming the JSON would count an incomplete set as complete.
5. Measurement: cross-project pass time for 1, 3, and 5 projects of this
   backlog's size, result recorded in `## Log`. Build an index **only** if
   the number requires it.
6. A view in the viewer — a "project / all" switcher. Only after the CLI: the
   cross-project pass must work in the terminal first and have `--json`,
   because that is the extension surface (Law 4).

## Acceptance criteria

- [x] `query --all-projects` returns rows with a `project` field; every row
      is identifiable by the pair `(project, id)`. [proof: cross-project-fixtures, every-row-names-its-project]
- [x] A task number collision between projects neither loses nor merges rows —
      a test on two fixtures whose first task has the same number. [proof: cross-project-fixtures]
- [x] An unavailable project is reported **in the result**, including in
      `--json`; the cross-project pass does not abort on it. [proof: cross-project-fixtures, every-row-names-its-project]
- [x] Deleting the registry only takes away `--all-projects`; commands within
      a repo work unchanged. [proof: cross-project-fixtures, registry-is-not-a-dependency]
- [x] All existing `query.mjs` filters work with `--all-projects` (`--status`,
      `--board`, `--epic`, `--label`, `--owner`, `--type`, `--text`). [proof: cross-project-fixtures]
- [x] An unknown flag still FAILS — the cross-project pass does not loosen
      the CLI contract. [proof: cross-project-fixtures]
- [x] The cross-project pass time is measured and recorded — in `## Measurement`
      below rather than in `## Log`, which TL-105 stopped writing; the decision
      on an index is **justified by the number**, not a hunch. [proof: measurement-recorded]
- [x] The cross-project pass creates no persistent task storage of its own
      (Law 2) — there is a test for this: after `--all-projects` no files
      accumulate in the home directory. [proof: cross-project-fixtures]

## Verification

```bash
# 1. Cross-project tests — expected: pass, including ID collision and unavailable project
node --test backlog/scripts/tests/cross-project.test.mjs

# 2. Every row knows its project — expected: row count, no assertion failure
node backlog/scripts/cli.mjs query --all-projects --status in_progress --json | python3 -c \
  "import json,sys; r=json.load(sys.stdin); assert all('project' in t for t in r); print('rows:', len(r))"

# 3. No registry only takes away the cross-project pass — expected: query works, --all-projects says why
WORKTRAIL_HOME=/tmp/tl-x node backlog/scripts/cli.mjs query --count
WORKTRAIL_HOME=/tmp/tl-x node backlog/scripts/cli.mjs query --all-projects --count; echo "exit=$?"

# 4. Time measurement — expected: a number to record in ## Log
time node backlog/scripts/cli.mjs query --all-projects --count
```

## Notes

- **Entry gate:** the registry has ≥2 entries in real use. Without that this
  task is building for nobody and should be closed as `cancelled` with a
  reason, rather than left open indefinitely.
- **No storage of its own and no daemon** — the cross-project pass is a view
  read on demand.
- If the measurement from step 5 comes out badly, an index is a separate task
  with its own numeric justification; SQLite as a reproducible index is
  already anticipated in
  [worktrail-state-and-sync.md §5.4](../../docs/worktrail-state-and-sync.md)
  and that is its natural home.

## Log

- 2026-08-30 created — claude — from the global-tool project
  (docs/architecture/worktrail-global-tool.md); the only step that changes
  the product, with an explicitly uncertain audience and an entry gate of
  "≥2 registry entries"

## Measurement (2026-09-03, step 5)

Five copies of this backlog (173 tasks each), registered in an isolated
registry, `query --all-projects --status pending --count`:

| projects | tasks read | wall clock |
|---|---|---|
| 1 | 173 | 95 ms |
| 3 | 519 | 139 ms |
| 5 | 865 | 167 ms |

About 18 ms per additional project, roughly linear, dominated by the per-project
branch scan rather than by reading task files. **No index is built.** A cache
here would be a second source of truth (law 2) bought to save 70 ms.

A second measurement, taken by accident and worth recording: this machine's
registry held 1239 entries, 892 of which answered, and the pass over all of them
took 13.5 s. That is not an argument for an index — it is what TL-176 is for.

## Decisions

- **The identity is the pair `(project, id)`, and `project` is written onto a row
  only when there IS one.** A single-project answer keeps exactly the shape it
  always had; adding `project: null` to every row would change an existing
  contract for nothing, and which mode produced an answer is already stated once,
  at the envelope level, by `projects`.
- **One pipeline, not two.** `collectProject()` is what the single-project path
  runs as well, so asking five projects gives exactly the five answers asking
  each of them separately would. Two pipelines would be two definitions of what
  a row is.
- **Filtering happens PER PROJECT, then the results are concatenated.** Which
  status counts as closed is a project's own decision (`archived_statuses`), so
  one shared set would apply somebody else's definition of "done" to a project
  that never agreed to it.
- **A filter value is refused only if EVERY project refuses it.** Judging against
  one project's vocabulary would refuse a query meaningful in the second;
  judging against nothing would bring back the defect TL-161 closed, where a
  typo answers "there is no such work" and an agent stops.
- **`--all-projects` with `--dir` or `--tasks` is refused**, not resolved: both
  name one backlog, so the combination has two answers and no way to choose.
- **The viewer switcher (step 6) is TL-177**, not part of this task. It was
  listed as a step, comes explicitly after the CLI, and none of the acceptance
  criteria covered it — folding it in would have blurred a task that has a
  contract with one that does not yet.
