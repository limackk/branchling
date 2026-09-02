---
id: TL-36
title: "Cross-project view over multiple projects"
type: code
labels: [post-launch]
board: main
epic: "Backlog — open source publication"
priority: P3
status: pending
owner: unassigned
estimate: 1d
confidence: low
created: 2026-08-30
updated: 2026-08-30
blocked_by: [TL-34]
blocks: []
related_docs:
  - docs/worktrail-global-tool.md
verification:
  - bash: "node --test backlog/scripts/tests/cross-project.test.mjs"
  - bash: "node backlog/scripts/cli.mjs query --all-projects --status in_progress --json | python3 -c \"import json,sys; r=json.load(sys.stdin); assert all('project' in t for t in r), 'row missing project name'; print('rows:', len(r))\""
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

- [ ] `query --all-projects` returns rows with a `project` field; every row
      is identifiable by the pair `(project, id)`.
- [ ] A BL number collision between projects neither loses nor merges rows —
      a test on two fixtures with the same `BL-001`.
- [ ] An unavailable project is reported **in the result**, including in
      `--json`; the cross-project pass does not abort on it.
- [ ] Deleting the registry only takes away `--all-projects`; commands within
      a repo work unchanged.
- [ ] All existing `query.mjs` filters work with `--all-projects` (`--status`,
      `--board`, `--epic`, `--label`, `--owner`, `--type`, `--text`).
- [ ] An unknown flag still FAILS — the cross-project pass does not loosen
      the CLI contract.
- [ ] The cross-project pass time is measured and recorded in `## Log`; the
      decision on an index is **justified by the number**, not a hunch.
- [ ] The cross-project pass creates no persistent task storage of its own
      (Law 2) — there is a test for this: after `--all-projects` no files
      accumulate in the home directory.

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
